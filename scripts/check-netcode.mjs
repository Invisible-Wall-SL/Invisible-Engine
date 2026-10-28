// Online netcode (engine-mechanics netcode.js; docs/design/realtime-multiplayer.md §6, §12; P10.15):
// with 50–250 ms latency, ±50 ms jitter and 2–5 % loss simulated between six devices and the room's
// own code, each device's own player converges on the room's place within 200 ms of the state that
// acknowledges its last input, and everyone else is drawn on the room's path, never moving more in a
// frame than the room moved them in a step.
//
// Everything runs on a virtual clock: the room (services/game-server roomSim.ts, the very code the
// Colyseus room runs) steps at its fixed rate and sends its state at its patch rate; each device
// draws at 60 frames a second, sends one input a step and runs the runtime's netcode
// (createPredictor / createSnapshotClock / createInterpolator); every message crosses a simulated
// link. Two links: RELIABLE, the real transport (a WebSocket: a lost packet is resent after a
// timeout and everything behind it waits), and DATAGRAM (lost messages are gone, late ones overtake
// — no input or state is safe), which makes the room miss inputs the device predicted.
//
// Run: pnpm check:netcode

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import { createFixedStep } from '../packages/engine-mechanics/src/motion.js';
import {
	MOVE_SCALE,
	characterBody,
	clampInput,
	onlineLevel,
	sanitizeInput,
	stepContext,
	stepPlayer,
} from '../packages/engine-mechanics/src/online.js';
import {
	INTERPOLATION_DELAY_MS,
	MATCH_PX,
	SNAP_PX,
	createInterpolator,
	createPredictor,
	createSnapshotClock,
	snapFor,
} from '../packages/engine-mechanics/src/netcode.js';
import { STATUS } from '../packages/engine-mechanics/src/onlineRules.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { createRoomSim, inputsThisStep } from '../services/game-server/src/roomSim.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
const check = async (name, fn) => {
	try {
		await fn();
		passed += 1;
	} catch (e) {
		console.error(`✗ ${name}`);
		throw e;
	}
};

const FIELD = { w: 1600, h: 1000 };
const CHARACTERS = [
	{ id: 'salmon', body: 'salmon', speed: 240 },
	{ id: 'bear', body: 'bear', speed: 180 },
	{ id: 'fish', body: 'fish', speed: 420 },
];
const gameOf = (online, zones) => {
	const game = onlineGameOf(
		normalizeGameConfigDoc({
			family: 'arcade',
			outcome: 'rules',
			gameName: 'Netcode',
			arcade: {
				field: FIELD,
				bodies: {
					salmon: { shape: 'circle', r: 20, tags: ['player'] },
					bear: { shape: 'box', w: 60, h: 40, tags: ['player'] },
					fish: { shape: 'circle', r: 8 },
				},
				...(zones ? { zones } : {}),
				online: { characters: CHARACTERS, maxPlayers: 8, ...online },
			},
		}),
	);
	assert.ok(game && !('refused' in game), JSON.stringify(game));
	return game;
};

// --- the simulated world -----------------------------------------------------------------------

/** A min-queue of timed callbacks on the virtual clock (ties run in the order they were added). */
const createClock = () => {
	const queue = [];
	let order = 0;
	let now = 0;
	return {
		get now() {
			return now;
		},
		at(t, fn) {
			const item = { t, order: order++, fn };
			let i = queue.length;
			while (
				i > 0 &&
				(queue[i - 1].t > t || (queue[i - 1].t === t && queue[i - 1].order > item.order))
			)
				i -= 1;
			queue.splice(i, 0, item);
		},
		run(until) {
			while (queue.length && queue[0].t <= until) {
				const item = queue.shift();
				now = item.t;
				item.fn();
			}
			now = until;
		},
	};
};

/**
 * One direction of a device's connection. `latency` one way, `jitter` ± uniform, `loss` the share of
 * packets lost. RELIABLE: a lost packet arrives a retransmit timeout late, and nothing behind it
 * overtakes it. DATAGRAM: a lost packet never arrives, and a late one can arrive after a later one.
 */
const createLink = (clock, rng, { latency, jitter, loss, reliable }) => {
	let last = 0;
	let lost = 0;
	let sent = 0;
	return {
		get lost() {
			return lost;
		},
		get sent() {
			return sent;
		},
		send(deliver) {
			sent += 1;
			let at = clock.now + latency + (rng() * 2 - 1) * jitter;
			if (rng() < loss) {
				lost += 1;
				if (!reliable) return;
				at += 200 + 2 * latency;
			}
			if (reliable) at = Math.max(at, last);
			last = Math.max(last, at);
			clock.at(at, deliver);
		},
	};
};

/** The room's input buffer for one player, as Colyseus keeps it: a `seq` no newer than the newest
 *  accepted is dropped, the oldest goes past 60, and a step takes what `inputsThisStep` allows. */
const createBuffer = (field) => {
	let newest = 0;
	const queue = [];
	return {
		receive(input) {
			const decoded = sanitizeInput({ ...input }, field);
			if (decoded.seq <= newest) return;
			newest = decoded.seq;
			queue.push(decoded);
			if (queue.length > 60) queue.shift();
		},
		take: (credit) => queue.splice(0, inputsThisStep(queue.length, credit)),
	};
};

/** A device's player: moves in a random one of eight ways for a while, then rests long enough for
 *  its prediction to be checked. */
const createPilot = (rng, stepMs) => {
	let left = 0;
	let move = [0, 0];
	let resting = true;
	return {
		get resting() {
			return resting;
		},
		next() {
			if (left <= 0) {
				resting = !resting;
				if (resting) {
					move = [0, 0];
					left = Math.round((900 + rng() * 900) / stepMs);
				} else {
					const way = Math.floor(rng() * 8);
					move = [
						Math.round(Math.cos((way * Math.PI) / 4) * MOVE_SCALE),
						Math.round(Math.sin((way * Math.PI) / 4) * MOVE_SCALE),
					];
					left = Math.round((250 + rng() * 1200) / stepMs);
				}
			}
			left -= 1;
			return { moveX: move[0], moveY: move[1], buttons: 0, aimX: 0, aimY: 0 };
		},
	};
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/**
 * Run a room with `players` devices for `seconds` over links of `net`, and measure what each device
 * draws against what the room did.
 */
const simulate = ({ net, seconds, seed, players = 6, zones, rules, drifts = false }) => {
	const game = gameOf(rules ? { rules } : {}, zones);
	const { online, field } = game;
	const stepMs = 1000 / online.tickHz;
	const patchMs = 1000 / online.patchHz;
	const frameMs = 1000 / 60;
	const ctx = stepContext(online.tickHz, online.subSteps);
	const clock = createClock();
	const rng = createRng(seed);
	const sim = createRoomSim(game);
	/** The room's places after every step: `trail[step]` = id → { x, y }. */
	const trail = [new Map()];
	const buffers = new Map();
	const devices = [];

	for (let i = 0; i < players; i++) {
		const id = `p${i}`;
		const joined = sim.join(id, { character: CHARACTERS[i % CHARACTERS.length].id });
		trail[0].set(id, { x: joined.body.x, y: joined.body.y });
		buffers.set(id, createBuffer(field));
		const character = joined.character;
		const body = characterBody(id, game.bodies[character.body], joined.body);
		devices.push({
			id,
			character,
			// Every device has its own clock: its frame times are offset from the room's by any amount.
			skew: rng() * 10_000,
			up: createLink(clock, rng, net),
			down: createLink(clock, rng, net),
			pilot: createPilot(rng, stepMs),
			steps: createFixedStep({ hz: online.tickHz }),
			seq: 0,
			lastMoving: 0,
			predictor: createPredictor({
				body,
				speed: character.speed,
				ctx,
				field,
				level: onlineLevel(game.zones, online.rules.zones, character.id, field),
			}),
			view: createSnapshotClock({ stepMs }),
			others: createInterpolator(),
			viewStep: 0,
			/** When the state acknowledging the last moving input arrived, if the player rests since. */
			settleFrom: undefined,
			settleChecked: true,
			prevDrawn: new Map(),
			states: 0,
		});
	}

	const stats = {
		settles: 0,
		worstSettleMs: 0,
		corrections: 0,
		snaps: 0,
		exactRests: 0,
		rests: 0,
		worstOtherJump: 0,
		worstOtherJumpRatio: 0,
		worstOffPath: 0,
		worstOwnJump: 0,
		lagSum: 0,
		lagFrames: 0,
		held: 0,
		frames: 0,
		lostUp: 0,
		lostDown: 0,
		sentUp: 0,
	};
	/** The most the room moved a player in one step, per player. */
	const maxStep = new Map(devices.map((d) => [d.id, 0]));

	const roomStep = () => {
		sim.step((id, credit) => buffers.get(id).take(credit));
		const places = new Map();
		for (const [id, p] of sim.players) {
			places.set(id, { x: p.body.x, y: p.body.y });
			const was = trail[trail.length - 1].get(id);
			if (was) maxStep.set(id, Math.max(maxStep.get(id), dist(was, p.body)));
		}
		trail.push(places);
	};

	const patch = () => {
		const state = {
			step: sim.steps,
			players: [...sim.players.values()].map((p) => ({
				id: p.id,
				x: Math.fround(p.body.x),
				y: Math.fround(p.body.y),
				ack: p.ack,
				status: p.status,
			})),
		};
		for (const device of devices) device.down.send(() => deliverState(device, state));
	};

	const deliverState = (device, state) => {
		const now = clock.now + device.skew;
		device.states += 1;
		device.view.observe(state.step, now);
		for (const p of state.players) {
			if (p.id !== device.id) {
				device.others.push(p.id, state.step, p.x, p.y);
				continue;
			}
			device.predictor.reconcile({
				x: p.x,
				y: p.y,
				ack: p.ack,
				still: p.status !== STATUS.free,
				step: state.step,
			});
			if (device.pilot.resting && device.lastMoving && p.ack >= device.lastMoving) {
				if (device.settleFrom === undefined) {
					device.settleFrom = clock.now;
					device.settleChecked = false;
				}
			}
		}
	};

	const frame = (device) => {
		const now = clock.now + device.skew;
		device.viewStep = device.view.advance(now) ?? device.viewStep;
		device.steps.advance(frameMs, () => {
			device.seq += 1;
			const raw = { seq: device.seq, ...device.pilot.next(), view: Math.floor(device.viewStep) };
			const input = clampInput(raw, field);
			if (input.moveX || input.moveY) {
				device.lastMoving = input.seq;
				device.settleFrom = undefined;
				device.settleChecked = true;
			}
			device.up.send(() => buffers.get(device.id).receive(input));
			device.predictor.input(input);
		});
		device.predictor.frame(frameMs);
		stats.frames += 1;

		const own = device.predictor.drawn(device.steps.alpha);
		const ownWas = device.prevDrawn.get(device.id);
		if (ownWas)
			stats.worstOwnJump = Math.max(
				stats.worstOwnJump,
				dist(own, ownWas) / (device.character.speed / online.tickHz),
			);
		device.prevDrawn.set(device.id, own);

		// The own player, at rest: 200 ms after the state that acknowledged its last moving input,
		// it is drawn where the room has it.
		// (In a current a resting player still drifts, and the device is ahead of the room by its
		// inputs in flight: there every state's agreement is the measure.)
		if (
			!drifts &&
			device.settleFrom !== undefined &&
			!device.settleChecked &&
			clock.now - device.settleFrom >= 200
		) {
			device.settleChecked = true;
			const room = sim.players.get(device.id).body;
			const off = dist(own, room);
			stats.rests += 1;
			assert.ok(off <= 0.01, `${device.id} is drawn ${off} px from the room 200 ms after its ack`);
			if (device.predictor.body.x === room.x && device.predictor.body.y === room.y)
				stats.exactRests += 1;
		}

		// Everyone else: on the room's path at the render step, and no faster than the room moved them.
		const v = device.viewStep;
		const lo = Math.floor(v);
		const hi = Math.min(trail.length - 1, Math.ceil(v));
		if (device.states > 2 && lo >= 0) {
			const lag = (sim.steps - v) * stepMs;
			stats.lagSum += lag;
			stats.lagFrames += 1;
			if (v >= device.view.newest) stats.held += 1;
		}
		for (const other of devices) {
			if (other === device) continue;
			const at = device.others.at(other.id, v);
			if (!at) continue;
			const was = device.prevDrawn.get(other.id);
			if (was) {
				const jump = dist(at, was);
				stats.worstOtherJump = Math.max(stats.worstOtherJump, jump);
				const ceiling = maxStep.get(other.id);
				if (ceiling > 0)
					stats.worstOtherJumpRatio = Math.max(stats.worstOtherJumpRatio, jump / ceiling);
				assert.ok(
					jump <= ceiling + 1e-9,
					`${device.id} drew ${other.id} ${jump} px in a frame; the room moved it at most ${ceiling} px in a step`,
				);
			}
			device.prevDrawn.set(other.id, at);
			if (device.states > 2 && lo >= 0 && trail[lo]?.has(other.id) && trail[hi]?.has(other.id)) {
				const a = trail[lo].get(other.id);
				const b = trail[hi].get(other.id);
				const t = hi > lo ? v - lo : 0;
				const truth = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
				const speedStep = other.character.speed / online.tickHz;
				stats.worstOffPath = Math.max(stats.worstOffPath, dist(at, truth) / speedStep);
			}
		}
	};

	for (let t = 0; t < seconds * 1000; t += stepMs) clock.at(t, roomStep);
	for (let t = patchMs; t < seconds * 1000; t += patchMs) clock.at(t, patch);
	for (const device of devices) {
		const phase = rng() * frameMs;
		for (let t = phase; t < seconds * 1000; t += frameMs) clock.at(t, () => frame(device));
	}
	clock.run(seconds * 1000);

	for (const device of devices) {
		stats.corrections += device.predictor.corrections;
		stats.snaps += device.predictor.snaps;
		stats.lostUp += device.up.lost;
		stats.lostDown += device.down.lost;
		stats.sentUp += device.up.sent;
	}
	return { ...stats, lag: stats.lagSum / stats.lagFrames, heldShare: stats.held / stats.lagFrames };
};

// --- 1. the predictor alone ---------------------------------------------------------------------

const PLAIN = gameOf({});
const plainCtx = stepContext(PLAIN.online.tickHz, PLAIN.online.subSteps);
const predictorFor = () =>
	createPredictor({
		body: characterBody('me', PLAIN.bodies.salmon, { x: 400, y: 400 }),
		speed: 240,
		ctx: plainCtx,
		field: PLAIN.field,
	});
const moveInput = (seq, moveX = MOVE_SCALE, moveY = 0) =>
	clampInput({ seq, moveX, moveY, buttons: 0, aimX: 0, aimY: 0, view: 0 }, PLAIN.field);

await check('a prediction the room agrees with keeps the device own float64 fold', () => {
	const me = predictorFor();
	const server = characterBody('me', PLAIN.bodies.salmon, { x: 400, y: 400 });
	for (let seq = 1; seq <= 40; seq++) {
		const input = moveInput(seq, 127, seq % 3 === 0 ? 50 : -30);
		me.input(input);
		stepPlayer(server, input, 240, plainCtx, PLAIN.field);
		if (seq % 3 === 0) {
			const before = { x: me.body.x, y: me.body.y };
			assert.equal(
				me.reconcile({ x: Math.fround(server.x), y: Math.fround(server.y), ack: seq }),
				'match',
			);
			assert.deepEqual({ x: me.body.x, y: me.body.y }, before);
		}
	}
	assert.equal(me.corrections, 0);
	assert.equal(me.body.x, server.x);
	assert.equal(me.body.y, server.y);
});

await check('a lost input is corrected at its ack and the inputs in flight replayed on top', () => {
	const me = predictorFor();
	const server = characterBody('me', PLAIN.bodies.salmon, { x: 400, y: 400 });
	for (let seq = 1; seq <= 10; seq++) {
		const input = moveInput(seq);
		me.input(input);
		if (seq !== 4 && seq <= 6) stepPlayer(server, input, 240, plainCtx, PLAIN.field);
	}
	const drawnBefore = me.drawn();
	assert.equal(me.reconcile({ x: server.x, y: server.y, ack: 6 }), 'corrected');
	assert.equal(me.pending, 4);
	// 6 − 1 lost + 4 in flight = 9 inputs of 8 px.
	assert.ok(Math.abs(me.body.x - (400 + 9 * 8)) < 1e-9, String(me.body.x));
	// Drawn where it was a moment ago; the correction fades.
	assert.deepEqual(me.drawn(), drawnBefore);
	for (let i = 0; i < 12; i++) me.frame(1000 / 60);
	assert.ok(Math.abs(me.drawn().x - me.body.x) <= 0.01, String(me.drawn().x - me.body.x));
});

await check('an old or repeated state changes nothing; a respawn is drawn at once', () => {
	const me = predictorFor();
	for (let seq = 1; seq <= 5; seq++) me.input(moveInput(seq));
	assert.equal(me.reconcile({ x: 408, y: 400, ack: 1 }), 'match');
	assert.equal(me.reconcile({ x: 0, y: 0, ack: 0 }), 'stale');
	assert.equal(me.reconcile({ x: 900, y: 900, ack: 5 }), 'corrected');
	assert.deepEqual(me.drawn(), { x: 900, y: 900 });
	assert.equal(me.snaps, 1);
});

await check('a state older than one taken, by its step, changes nothing', () => {
	const me = predictorFor();
	for (let seq = 1; seq <= 3; seq++) me.input(moveInput(seq));
	assert.equal(me.reconcile({ x: 900, y: 900, ack: 3, step: 10 }), 'corrected');
	// The same ack, stamped earlier (a reordered datagram): not taken.
	assert.equal(me.reconcile({ x: 400, y: 400, ack: 3, step: 9 }), 'stale');
	assert.equal(me.body.x, 900);
});

await check('a player the room holds still is predicted still, and freed again', () => {
	const me = predictorFor();
	for (let seq = 1; seq <= 3; seq++) me.input(moveInput(seq));
	me.reconcile({ x: 400, y: 400, ack: 0, still: true });
	assert.equal(me.body.x, 400, 'the inputs in flight do not move a held player');
	me.input(moveInput(4));
	assert.equal(me.body.x, 400);
	me.reconcile({ x: 400, y: 400, ack: 4, still: false });
	me.input(moveInput(5));
	assert.equal(me.body.x, 408);
});

await check(
	'the interpolator draws between states, holds at the ends, and takes a teleport whole',
	() => {
		const it = createInterpolator({ snapPx: 100 });
		it.push('a', 10, 0, 0);
		it.push('a', 12, 20, 0);
		it.push('a', 12, 99, 99);
		it.push('a', 14, 500, 0);
		assert.deepEqual(it.at('a', 9), { x: 0, y: 0 });
		assert.deepEqual(it.at('a', 11), { x: 10, y: 0 });
		assert.deepEqual(it.at('a', 13), { x: 20, y: 0 }, 'a jump is not slid across');
		assert.deepEqual(it.at('a', 14), { x: 500, y: 0 });
		assert.deepEqual(it.at('a', 99), { x: 500, y: 0 }, 'nothing is guessed past the newest state');
		assert.equal(it.at('b', 1), undefined);
		it.retain(new Set(['b']));
		assert.equal(it.at('a', 12), undefined, 'a player gone from the room is forgotten');
		// A fast character's move between two states is not a teleport.
		assert.equal(snapFor(240, 20), SNAP_PX);
		const fast = snapFor(5000, 20);
		assert.ok(fast >= 2 * (5000 / 20), String(fast));
		const quick = createInterpolator({ snapPx: fast });
		quick.push('f', 0, 0, 0);
		quick.push('f', 2, 500, 0);
		assert.deepEqual(quick.at('f', 1), { x: 250, y: 0 });
	},
);

await check(
	'the render clock keeps a steady delay through jitter and never runs past the newest state',
	() => {
		const stepMs = 1000 / 30;
		const clock = createSnapshotClock({ stepMs });
		assert.equal(clock.advance(0), undefined);
		const rng = createRng('clock');
		let now = 5000;
		const lags = [];
		for (let i = 0; i < 1200; i++) {
			now += 1000 / 60;
			// A state every 50 ms, stamped with the room's step, arriving ±40 ms late.
			if (i % 3 === 0) clock.observe(Math.floor((now - 5000) / stepMs), now + rng() * 80 - 40);
			const at = clock.advance(now);
			assert.ok(at <= clock.newest);
			if (i > 400) lags.push(now - 5000 - at * stepMs);
		}
		const mean = lags.reduce((a, b) => a + b, 0) / lags.length;
		const spread = Math.max(...lags) - Math.min(...lags);
		assert.ok(Math.abs(mean - INTERPOLATION_DELAY_MS) < 20, `mean lag ${mean} ms`);
		assert.ok(spread < 40, `the lag wandered ${spread} ms`);
		// A long gap (a hidden tab) jumps the clock rather than racing through the backlog.
		clock.observe(clock.newest + 300, now + 10_000);
		const after = clock.advance(now + 10_000);
		assert.ok(clock.newest - after < 10, `${clock.newest} vs ${after}`);
	},
);

// --- 2. a room of six over simulated networks ---------------------------------------------------

const NETWORKS = [
	{ latency: 50, jitter: 50, loss: 0.02 },
	{ latency: 150, jitter: 50, loss: 0.03 },
	{ latency: 250, jitter: 50, loss: 0.05 },
];

for (const net of NETWORKS) {
	await check(
		`reliable link, ${net.latency} ms ±${net.jitter}, ${net.loss * 100}% loss: the prediction is exact and everyone is smooth`,
		() => {
			const r = simulate({
				net: { ...net, reliable: true },
				seconds: 40,
				seed: `rel-${net.latency}`,
			});
			assert.ok(r.lostUp > 20, `packets lost: ${r.lostUp}`);
			// Nothing is lost for good on the real transport, so the device never mispredicts.
			assert.equal(r.corrections, 0, `${r.corrections} corrections`);
			assert.ok(r.rests >= 30, `${r.rests} rests checked`);
			assert.equal(r.exactRests, r.rests, 'every rest is the room’s own place, bit for bit');
			assert.ok(r.worstOffPath <= 2, `${r.worstOffPath} steps off the room's path`);
			// A lost packet holds up everything behind it on this link, so the lag here is the
			// transport's (reported, not bounded); the datagram runs below bound the clock's own.
			assert.ok(r.lag >= INTERPOLATION_DELAY_MS + net.latency - net.jitter, `lag ${r.lag}`);
			console.log(
				`  reliable ${net.latency} ms: ${r.rests} rests exact, drawn ≤ ${r.worstOtherJumpRatio.toFixed(2)} of a step a frame, ≤ ${r.worstOffPath.toFixed(2)} steps off path, lag ${r.lag.toFixed(0)} ms, held ${(r.heldShare * 100).toFixed(1)} %`,
			);
		},
	);
	await check(
		`datagram link, ${net.latency} ms ±${net.jitter}, ${net.loss * 100}% loss: corrections converge within 200 ms`,
		() => {
			const r = simulate({
				net: { ...net, reliable: false },
				seconds: 40,
				seed: `dgram-${net.latency}`,
			});
			assert.ok(r.lostUp > 20 && r.lostDown > 20, `lost ${r.lostUp} up, ${r.lostDown} down`);
			assert.ok(r.corrections > 0, 'lost inputs were mispredicted and corrected');
			assert.equal(r.snaps, 0, 'no correction was long enough to draw at once');
			assert.ok(r.rests >= 30, `${r.rests} rests checked`);
			assert.ok(r.worstOffPath <= 2, `${r.worstOffPath} steps off the room's path`);
			assert.ok(r.worstOwnJump <= 1.5, `the own player moved ${r.worstOwnJump} steps in a frame`);
			assert.ok(r.lag >= INTERPOLATION_DELAY_MS + net.latency - net.jitter, `lag ${r.lag}`);
			assert.ok(r.lag <= INTERPOLATION_DELAY_MS + net.latency + net.jitter + 40, `lag ${r.lag}`);
			console.log(
				`  datagram ${net.latency} ms: ${r.corrections} corrections, ${r.rests} rests converged, own ≤ ${r.worstOwnJump.toFixed(2)} steps a frame, others ≤ ${r.worstOtherJumpRatio.toFixed(2)} of a step, lag ${r.lag.toFixed(0)} ms`,
			);
		},
	);
}

await check('a current is predicted exactly: the device steps the same level the room does', () => {
	const zones = [
		{ id: 'river', x: 0, y: 300, w: 1600, h: 400 },
		{ id: 'eddy', x: 600, y: 0, w: 300, h: 1000 },
	];
	const rules = {
		zones: [
			{ zone: 'river', force: { x: -60, y: 0 } },
			{ zone: 'eddy', force: { x: 0, y: 45 }, characters: ['fish'] },
		],
	};
	const r = simulate({
		net: { latency: 150, jitter: 50, loss: 0.03, reliable: true },
		seconds: 30,
		seed: 'current',
		zones,
		rules,
		drifts: true,
	});
	assert.equal(r.corrections, 0, `${r.corrections} of the room's states disagreed`);
	assert.ok(r.worstOffPath <= 2, `${r.worstOffPath} steps off the room's path`);
});

await check(
	'the runtime runs this netcode: predicted own player, interpolated others, view sent',
	() => {
		const source = readFileSync(join(ROOT, 'apps/lines/src/game/online.ts'), 'utf8');
		for (const used of [
			'createPredictor(',
			'createSnapshotClock(',
			'createInterpolator(',
			'.reconcile(',
			'me?.input(input)',
			'onlineLevel(',
			'viewStep',
		]) {
			assert.ok(source.includes(used), `online.ts does not use ${used}`);
		}
	},
);

console.log(`check:netcode — ${passed} checks passed`);
