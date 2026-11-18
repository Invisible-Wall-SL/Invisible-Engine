// The 3D view's device side of a room (`packages/engine-3d/src/pure/roomView.ts`, runtime step 4):
// two devices, each a `createRoomView3d` fed by a scripted stick at 60 frames a second, play the
// room's own simulation (`services/game-server` `createRoomSim3d`) at its tick rate, over links that
// are late by 40–120 ms and send states at the room's patch rate. It checks that each device's own
// player ends equal to the room's, bit for bit, with no prediction corrected; that each draws the
// other where the room has it once the room stops moving; that the stick walks away from the camera
// and jumps; that a player who leaves is no longer drawn; that a device clock 2 % fast or slow stays
// on the room's (the room's buffer short, no body rested, no correction — each fails without the
// room's `waiting` / `credit`); and that a room playing another world is refused.
//
// Run: node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//        scripts/check-engine-3d-room.mjs

import assert from 'node:assert/strict';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import { hashBodies3d } from '../packages/engine-mechanics/src/motion3d.js';
import {
	BUTTONS3D,
	bodyFlags3d,
	sanitizeInput3d,
	world3dOf,
	worldHash3d,
} from '../packages/engine-mechanics/src/online3d.js';
import { createRoomView3d } from '../packages/engine-3d/pure.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { CREDIT_SECONDS, inputsThisStep } from '../services/game-server/src/roomSim.ts';
import { createRoomSim3d } from '../services/game-server/src/roomSim3d.ts';

let passed = 0;
const check = (name, fn) => {
	try {
		fn();
		passed += 1;
	} catch (error) {
		console.error(`✗ ${name}`);
		throw error;
	}
};

const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
	kind: 'box',
	minX,
	minY,
	minZ,
	maxX,
	maxY,
	maxZ,
});
const config = {
	family: 'arcade',
	outcome: 'rules',
	gameName: 'Room view 3D',
	arcade: {
		field: { w: 40, h: 40 },
		bodies: { hero: { shape: 'circle', r: 0.4, tags: ['player'] } },
		online: { characters: [{ id: 'hero', body: 'hero', speed: 5 }] },
		world3d: {
			level: {
				colliders: [
					box(-20, -1, -20, 20, 0, 20),
					box(-6, 0, -6, 0, 2, 0),
					{ kind: 'ramp', facing: '-x', minX: 0, minY: 0, minZ: -6, maxX: 6, maxY: 2, maxZ: -2 },
					box(-21, 0, -21, 21, 4, -20),
					box(-21, 0, 20, 21, 4, 21),
					box(-21, 0, -20, -20, 4, 20),
					box(20, 0, -20, 21, 4, 20),
				],
				zones: [
					{
						kind: 'trampoline',
						minX: 8,
						minY: -0.1,
						minZ: 8,
						maxX: 10,
						maxY: 0.1,
						maxZ: 10,
						height: 3,
					},
				],
				killY: -10,
			},
			spawns: [
				{ x: 4, z: 6 },
				{ x: -4, z: 6 },
			],
		},
	},
};
const game = onlineGameOf(normalizeGameConfigDoc(config));
assert.ok(game && !('refused' in game), JSON.stringify(game));
const world = world3dOf(config.arcade.world3d);
const { tickHz, patchHz } = game.online;

/** An in-order link, late by `min`–`max` ms. */
const linkOf = (seed, min = 40, max = 120) => {
	const rng = createRng(seed);
	let last = 0;
	const inFlight = [];
	return {
		send(at, message) {
			last = Math.max(last, at + min + rng() * (max - min));
			inFlight.push({ arrive: last, message });
		},
		deliver(now) {
			const out = [];
			while (inFlight.length && inFlight[0].arrive <= now) out.push(inFlight.shift().message);
			return out;
		},
	};
};

/** What the transport does before the room sees an input: the schema's fields, an older seq dropped. */
const receiver = () => {
	let last = 0;
	const queue = [];
	return {
		receive(raw) {
			const input = sanitizeInput3d({ ...raw });
			if (input.seq <= last) return;
			last = input.seq;
			queue.push(input);
		},
		take: (credit) => queue.splice(0, inputsThisStep(queue.length, credit)),
		get size() {
			return queue.length;
		},
	};
};

/** A stick that walks, turns, sprints and jumps on a seeded script, then lets go at `stopAt`. */
const stickOf = (seed, stopAt) => {
	const rng = createRng(seed);
	let left = 0;
	let stick = { right: 0, forward: 0, buttons: 0 };
	return (frame) => {
		if (frame >= stopAt) return { right: 0, forward: 0, buttons: 0 };
		if (left-- <= 0) {
			left = 20 + Math.floor(rng() * 90);
			stick = {
				right: Math.round(rng() * 2) - 1,
				forward: Math.round(rng() * 2) - 1,
				buttons: rng() < 0.5 ? BUTTONS3D.sprint : 0,
			};
		}
		return { ...stick, buttons: stick.buttons | (rng() < 0.02 ? BUTTONS3D.jump : 0) };
	};
};

/** The room's state as the schema carries it: places as float32 for everyone, and each player's
 *  own fields (`arcadeRoom3d.ts` `write`: its whole body and clock) — a device reads only its own.
 *  `waiting` is each player's input buffer (`buffers`, by id). */
const stateOf = (sim, buffers = new Map()) => {
	const players = new Map();
	for (const [id, p] of sim.players) {
		const { body } = p;
		players.set(id, {
			x: Math.fround(body.x),
			y: Math.fround(body.y),
			z: Math.fround(body.z),
			yaw: body.yaw,
			anim: p.anim,
			character: p.character.id,
			ack: p.ack,
			bx: body.x,
			by: body.y,
			bz: body.z,
			vx: body.vx,
			vy: body.vy,
			vz: body.vz,
			coyote: body.coyote,
			buffer: body.buffer,
			flags: bodyFlags3d(body),
			waiting: buffers.get(id)?.size ?? 0,
			credit: p.credit,
		});
	}
	return { step: sim.steps, world: worldHash3d(sim.world), players };
};

const FRAME_MS = 1000 / 60;
const FRAMES = 60 * 40;
const sim = createRoomSim3d(game, world, { seed: 7 });
const ids = ['ann', 'bob'];
const devices = ids.map((id, i) => {
	sim.join(id, { name: id, character: 'hero' });
	const up = linkOf(`up${i}`);
	const device = {
		id,
		up,
		down: linkOf(`down${i}`),
		rx: receiver(),
		stick: stickOf(`stick${i}`, FRAMES - 60 * 5),
		corrected: 0,
		sent: 0,
	};
	device.view = createRoomView3d({
		meId: id,
		world,
		tickHz,
		patchHz,
		send: (input) => {
			device.sent += 1;
			up.send(device.now, input);
		},
	});
	return device;
});
const byId = new Map(devices.map((d) => [d.id, d]));
const buffers = new Map(devices.map((d) => [d.id, d.rx]));

const firstZ = new Map();
let maxPeak = 0;
let nextStep = 0;
let nextPatch = 0;
for (let frame = 0; frame < FRAMES; frame++) {
	const now = frame * FRAME_MS;
	while (nextStep <= now) {
		for (const d of devices) for (const raw of d.up.deliver(nextStep)) d.rx.receive(raw);
		sim.step((id, credit) => byId.get(id)?.rx.take(credit) ?? []);
		nextStep += 1000 / tickHz;
	}
	if (now >= nextPatch) {
		const state = stateOf(sim, buffers);
		for (const d of devices) d.down.send(now, state);
		nextPatch += 1000 / patchHz;
	}
	for (const d of devices) {
		d.now = now;
		for (const state of d.down.deliver(now)) {
			const before = d.view.me?.corrections ?? 0;
			d.view.received(state, now);
			d.corrected += (d.view.me?.corrections ?? 0) - before;
		}
		d.view.frame(FRAME_MS, now, d.stick(frame), 0);
		const me = d.view.me;
		if (me && !firstZ.has(d.id)) firstZ.set(d.id, me.body.z);
		if (me) maxPeak = Math.max(maxPeak, me.body.y);
	}
}
// Drain: the last inputs reach the room and the last states the devices; nothing new is sent.
for (let extra = 0; extra < 120; extra++) {
	const now = (FRAMES + extra) * FRAME_MS;
	for (const d of devices) for (const raw of d.up.deliver(now)) d.rx.receive(raw);
	sim.step((id, credit) => byId.get(id)?.rx.take(credit) ?? []);
	const state = stateOf(sim, buffers);
	for (const d of devices) {
		d.now = now;
		d.down.send(now, state);
		for (const s of d.down.deliver(now)) d.view.received(s, now);
		// A 0 ms frame moves the view's clock and sends nothing.
		d.view.frame(0, now, { right: 0, forward: 0, buttons: 0 }, 0);
	}
}

check('each device sent an input every fixed step it was shown its player', () => {
	for (const d of devices) {
		assert.ok(d.view.me, `${d.id} was shown its player`);
		const seconds = (FRAMES * FRAME_MS) / 1000;
		assert.ok(d.sent > tickHz * seconds * 0.9, `${d.id} sent ${d.sent}`);
		assert.equal(sim.players.get(d.id).ack, d.sent, `${d.id}: the room applied every input`);
	}
});

check("each device's own player is the room's, bit for bit, and was never corrected", () => {
	for (const d of devices) {
		assert.equal(hashBodies3d([d.view.me.body]), hashBodies3d([sim.players.get(d.id).body]), d.id);
		assert.equal(d.corrected, 0, `${d.id} corrections`);
	}
});

check('each device draws both players, the own one as the hero', () => {
	for (const d of devices) {
		const bodies = d.view.bodies();
		assert.deepEqual(bodies.map((b) => b.id).sort(), [...ids].sort());
		assert.equal(bodies.find((b) => b.id === d.id).kind, 'hero');
		assert.equal(bodies.find((b) => b.id !== d.id).kind, 'other');
	}
});

check('once the room is still, each device draws the other where the room has it', () => {
	for (const d of devices) {
		const other = d.view.bodies().find((b) => b.id !== d.id);
		const truth = sim.players.get(other.id).body;
		const off = Math.hypot(other.x - truth.x, other.y - truth.y, other.z - truth.z);
		assert.ok(off < 1e-3, `${d.id} draws ${other.id} ${off} m off`);
	}
});

check('the players moved, and jumped', () => {
	for (const d of devices) {
		const body = sim.players.get(d.id).body;
		const home = sim.players.get(d.id).home;
		assert.ok(Math.hypot(body.x - home.x, body.z - home.z) > 1, `${d.id} moved`);
	}
	assert.ok(maxPeak > 0.8, `the highest feet ${maxPeak}`);
});

check('up on the stick walks away from a camera at yaw 0 (toward −z)', () => {
	const solo = createRoomSim3d(game, world, { seed: 1 });
	solo.join('cy', { name: 'cy', character: 'hero' });
	const rx = receiver();
	const view = createRoomView3d({
		meId: 'cy',
		world,
		tickHz,
		patchHz,
		send: (input) => rx.receive(input),
	});
	view.received(stateOf(solo), 0);
	const z0 = view.me.body.z;
	for (let f = 0; f < 60; f++) {
		view.frame(FRAME_MS, f * FRAME_MS, { right: 0, forward: 1, buttons: 0 }, 0);
		solo.step((id, credit) => (id === 'cy' ? rx.take(credit) : []));
	}
	assert.ok(view.me.body.z < z0 - 2, `${z0} → ${view.me.body.z}`);
	assert.ok(solo.players.get('cy').body.z < z0 - 2, 'and the room agrees');
});

check('a player who leaves is no longer drawn', () => {
	sim.leave('bob');
	const ann = byId.get('ann');
	ann.view.received(stateOf(sim), 1e7);
	assert.deepEqual(
		ann.view.bodies().map((b) => b.id),
		['ann'],
	);
});

/**
 * One device alone in a room for `seconds`, its clock `scale` × the room's (its frames claim that
 * much time). `told` false hides the room's clock from it (`waiting` and `credit` read 0), as before
 * the room sent them. Reports the room's input buffer at its longest over the last 20 s, the body's
 * credit at its highest, and the device's corrections.
 */
const drift = (scale, seconds, told = true) => {
	const room = createRoomSim3d(game, world, { seed: 3 });
	room.join('dee', { name: 'dee', character: 'hero' });
	const rx = receiver();
	const up = linkOf('drift-up');
	const down = linkOf('drift-down');
	let now = 0;
	const view = createRoomView3d({
		meId: 'dee',
		world,
		tickHz,
		patchHz,
		send: (input) => up.send(now, input),
	});
	const stick = stickOf('drift', Infinity);
	let nextStep = 0;
	let nextPatch = 0;
	let waiting = 0;
	let credit = 0;
	for (let frame = 0; frame * FRAME_MS < seconds * 1000; frame++) {
		now = frame * FRAME_MS;
		while (nextStep <= now) {
			for (const raw of up.deliver(nextStep)) rx.receive(raw);
			room.step((id, c) => (id === 'dee' ? rx.take(c) : []));
			nextStep += 1000 / tickHz;
			if (now > (seconds - 20) * 1000) waiting = Math.max(waiting, rx.size);
			credit = Math.max(credit, room.players.get('dee').credit);
		}
		if (now >= nextPatch) {
			const state = stateOf(room, new Map([['dee', rx]]));
			if (!told)
				for (const p of state.players.values()) {
					p.waiting = 0;
					p.credit = 0;
				}
			down.send(now, state);
			nextPatch += 1000 / patchHz;
		}
		for (const state of down.deliver(now)) view.received(state, now);
		view.frame(FRAME_MS * scale, now, stick(frame), 0);
	}
	return { waiting, credit, corrections: view.me.corrections };
};
const CREDIT_STEPS = Math.ceil(tickHz * CREDIT_SECONDS);

check(
	"a device clock 2 % fast keeps the room's input buffer short (it used to grow for good)",
	() => {
		const synced = drift(1.02, 90);
		const unsynced = drift(1.02, 90, false);
		assert.ok(unsynced.waiting > 20, `without the room's clock: ${unsynced.waiting} waiting`);
		assert.ok(synced.waiting <= 6, `${synced.waiting} inputs waiting`);
		assert.equal(synced.corrections, 0);
		console.log(
			`   fast: ${synced.waiting} waiting at most (${unsynced.waiting} without the sync)`,
		);
	},
);

check(
	'a device clock 2 % slow never lets its body fall CREDIT_SECONDS behind: no rest, no correction',
	() => {
		const synced = drift(0.98, 90);
		const unsynced = drift(0.98, 90, false);
		assert.equal(unsynced.credit, CREDIT_STEPS, 'without the room’s clock it is rested');
		assert.ok(unsynced.corrections > 0, 'and corrected');
		assert.ok(synced.credit < CREDIT_STEPS, `credit ${synced.credit}`);
		assert.equal(synced.corrections, 0);
		console.log(
			`   slow: credit ${synced.credit} at most (${unsynced.credit} and ${unsynced.corrections} corrections without the sync)`,
		);
	},
);

/** `value` with every object's keys in reverse order. */
const reversed = (value) =>
	Array.isArray(value)
		? value.map(reversed)
		: value && typeof value === 'object'
			? Object.fromEntries(
					Object.keys(value)
						.reverse()
						.map((key) => [key, reversed(value[key])]),
				)
			: value;

check('a room that plays another world is refused: nothing predicted, nothing sent', () => {
	const raw = config.arcade.world3d;
	assert.equal(
		worldHash3d(world3dOf(reversed(raw))),
		worldHash3d(world),
		'key order is not a world',
	);
	const faster = world3dOf({ ...raw, motion: { speed: 6 } });
	assert.notEqual(worldHash3d(faster), worldHash3d(world), 'another motion is another world');
	const solo = createRoomSim3d(game, faster, { seed: 5 });
	solo.join('eve', { name: 'eve', character: 'hero' });
	let sent = 0;
	const view = createRoomView3d({
		meId: 'eve',
		world,
		tickHz,
		patchHz,
		send: () => (sent += 1),
	});
	view.received(stateOf(solo), 0);
	view.frame(FRAME_MS * 10, 0, { right: 0, forward: 1, buttons: 0 }, 0);
	assert.equal(view.mismatch, true);
	assert.equal(view.me, undefined);
	assert.equal(sent, 0);
	assert.deepEqual(view.bodies(), []);
});

console.log(
	`check:engine-3d-room — ${passed} checks passed (${devices.map((d) => `${d.id} sent ${d.sent}`).join(', ')}, tick ${tickHz} Hz, patch ${patchHz} Hz)`,
);
