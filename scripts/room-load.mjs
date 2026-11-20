// THE ROOM LOAD TEST (`docs/design/realtime-multiplayer.md` §12, game-families P10.16; not a CI
// gate): fills one room of an online arcade game with bot DEVICES — real `@colyseus/sdk` clients
// in this process, each sending one input per fixed step over a simulated link — and measures, on a
// game server in a process of its own (`room-load-server.mjs`):
//
//   - the tick rates held: the room's steps a second as the devices see them advance (of `tickHz`),
//     and the states a second each device receives (of `patchHz`);
//   - the bandwidth: bytes a second each device receives (its WebSocket's bytes on the wire, TCP
//     and IP headers aside), and what leaves the server in all;
//   - the server: its step time (p50 / p99 / max), the time of each patch's pass over the devices'
//     nearby regions (not part of a step), its CPU (% of one core) and its memory.
//
// The devices play like people: a salmon swims upstream and weaves, a bear or a fisherman roams
// and swipes / casts now and then. Every device reaches the server through a TCP proxy that delays
// what it sends and what it receives by `--latency` ms ± `--jitter` each way (in order, as TCP
// delivers). The game is Salmons
// (`engine-mechanics` `salmons.js`) unless `--config` names another online config.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/room-load.mjs [--devices 100] [--seconds 30] [--latency 60] [--jitter 20] \
//     [--config <game.json>] [--everyone] [--nearby <w>x<h>] [--nearby-max <w>x<h>|none] \
//     [--shown <mix>] [--jump <chance>] [--respawn] [--3d] [--out <result.json>]
//
// `--3d` plays a 16-seat 3D arena (`arcade.world3d`, a floor with tiers, ramps and trampolines)
// in the 3D room (`arcade3d`) unless `--config` names a 3D config; its devices run, sprint and jump.
//
// `--everyone` drops the config's `online.nearby`, so every device is sent every player; `--nearby
// 3300x3300` plays the config with that box instead of its own.
//
// `--shown <mix>` has the devices say what their screens show (`engine-mechanics` `shown.js`), as
// the runtime does on a world screen; without it they say nothing, as before. The mix is
// `<share>:<window>,…`: a window is `<w>x<h>` in CSS px (`m` after it: a phone or a tablet, the
// camera's mobile zoom), `max` (the whole `nearby.max` box as a flat view, on every input: the most
// a device can ask for) or `none`. `45:390x844m,5:844x390m,25:1920x1080,15:1536x864,5:2560x1440,
// 5:1280x800m` is a guess at who plays. The windows are shown through Salmons' camera and its
// isometric screen (`engine-layout` `SALMONS_CAMERA`), and each device adds what the runtime adds:
// its largest body on every side, how far a camera that eases over `smoothing` is from its own
// player (trailing a swim, sweeping to a respawn), and its own salmon's leap. `--nearby-max 6400x6400` plays the config with that
// `max` on its box, `--nearby-max none` with none (the room then ignores what devices say).
//
// `--jump 0.02` has each salmon's device tap jump with that chance a step, and `--respawn` has a
// caught device press Respawn as its own character. Without them a salmon stays on the first
// sandbank it meets and a caught player stays out, so on the original's levels (the config
// `scripts/salmons/export.mjs` writes) the room goes still and its cost reads far too low.
//
// Exit 1 when a budget is missed (BUDGET below). It only ever starts its own server on localhost.

import { fork } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { connect, createServer, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { cameraZoom, resolveCameraSpec } from '../packages/engine-mechanics/src/camera.js';
import { BUTTONS, MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import {
	BUTTONS3D,
	clampInput3d,
	moveFromStick,
	yawFromRadians,
} from '../packages/engine-mechanics/src/online3d.js';
import { ONLINE_EVENT, STATUS } from '../packages/engine-mechanics/src/onlineRules.js';
import { createRng } from '../packages/engine-mechanics/src/board.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { CELL } from '../packages/engine-mechanics/src/salmonsMap.js';
import { SHOWN_SHAPE, shownOf } from '../packages/engine-mechanics/src/shown.js';
import { ISO_PROJECTOR_MIRRORED } from '../packages/engine-layout/src/lib/projection.ts';
import { SALMONS_CAMERA } from '../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { liftOf } from '../packages/engine-layout/src/lib/salmonsArt/leap.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { ROOM_NAME, ROOM_NAME_3D } from '../services/game-server/src/server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRequire = createRequire(join(ROOT, 'services/game-server/package.json'));
const { Client } = await import(pathToFileURL(gameServerRequire.resolve('@colyseus/sdk')).href);

const { values: opt } = parseArgs({
	options: {
		devices: { type: 'string', default: '100' },
		seconds: { type: 'string', default: '30' },
		latency: { type: 'string', default: '60' },
		jitter: { type: 'string', default: '20' },
		config: { type: 'string' },
		everyone: { type: 'boolean', default: false },
		nearby: { type: 'string' },
		'nearby-max': { type: 'string' },
		shown: { type: 'string' },
		jump: { type: 'string', default: '0' },
		respawn: { type: 'boolean', default: false },
		'3d': { type: 'boolean', default: false },
		out: { type: 'string' },
	},
});
const DEVICES = Number(opt.devices);
const SECONDS = Number(opt.seconds);
const LATENCY = Number(opt.latency);
const JITTER = Number(opt.jitter);
const JUMP = Number(opt.jump);
if (!(JUMP >= 0 && JUMP < 1))
	throw new Error(`--jump is a chance a step, from 0 to under 1, not "${opt.jump}"`);
/** The first seconds (joining, the first full states) are not measured. */
const WARMUP_S = 3;

/**
 * What a full room may cost (design §5's estimate, §6's gate). A device receives 10 KB/s (80 kbit/s)
 * on average and at most 16 KB/s — a round's start, when every salmon is at the sea in one shoal
 * and each is sent all the others, is the worst — the server sends at most 1 MB/s, a step takes
 * under 8 ms at the 99th percentile, and the rates hold to 95 %.
 */
const BUDGET = { deviceKBps: 10, deviceMaxKBps: 16, egressMBps: 1, stepP99Ms: 8, rateHeld: 0.95 };

// A state's events reach a device before it can listen for them (`onMessage` once joined).
const warn = console.warn;
console.warn = (...args) => {
	if (!String(args[0]).includes('onMessage() not registered')) warn(...args);
};

/** A 16-seat 3D arena: a 60 m floor, four 3 m tiers with a ramp each, four trampolines. */
const arena3dConfig = () => {
	const box = (minX, minY, minZ, maxX, maxY, maxZ) => ({
		kind: 'box',
		minX,
		minY,
		minZ,
		maxX,
		maxY,
		maxZ,
	});
	const colliders = [box(-30, -1, -30, 30, 0, 30)];
	const zones = [];
	for (const [sx, sz] of [
		[1, 1],
		[-1, 1],
		[1, -1],
		[-1, -1],
	]) {
		const x = 15 * sx;
		const z = 15 * sz;
		colliders.push(box(x - 4, 0, z - 4, x + 4, 3, z + 4));
		colliders.push({
			kind: 'ramp',
			facing: sx > 0 ? '+x' : '-x',
			minX: sx > 0 ? x - 12 : x + 4,
			minY: 0,
			minZ: z - 2,
			maxX: sx > 0 ? x - 4 : x + 12,
			maxY: 3,
			maxZ: z + 2,
		});
		zones.push({
			kind: 'trampoline',
			minX: -sx * 8 - 1,
			minY: -0.1,
			minZ: sz * 4 - 1,
			maxX: -sx * 8 + 1,
			maxY: 0.1,
			maxZ: sz * 4 + 1,
			height: 4,
		});
	}
	return {
		family: 'arcade',
		outcome: 'rules',
		gameName: 'Load arena 3D',
		arcade: {
			field: { w: 60, h: 60 },
			bodies: { hero: { shape: 'circle', r: 0.4, tags: ['player'] } },
			online: { characters: [{ id: 'hero', body: 'hero', speed: 5 }], maxPlayers: 16 },
			world3d: {
				level: { colliders, zones, killY: -20 },
				spawns: Array.from({ length: 16 }, (_, i) => ({
					x: (i % 4) * 3 - 4.5,
					z: Math.floor(i / 4) * 3 - 4.5,
				})),
			},
		},
	};
};
const authored = opt.config
	? JSON.parse(readFileSync(resolve(opt.config), 'utf8'))
	: opt['3d']
		? arena3dConfig()
		: salmonsConfig();
const is3d = authored.arcade?.world3d !== undefined;
// `--everyone`: every device is sent every player (the room as it is without `online.nearby`).
if (opt.everyone) delete authored.arcade?.online?.nearby;
if (opt.nearby) {
	const [w, h] = opt.nearby.split('x').map(Number);
	if (!(w > 0 && h > 0)) throw new Error(`--nearby is <w>x<h>, not "${opt.nearby}"`);
	if (opt.everyone || is3d || !authored.arcade?.online)
		throw new Error('--nearby sets a 2D room’s box: not with --everyone or a 3D game');
	authored.arcade.online.nearby = { ...authored.arcade.online.nearby, w, h };
}
if (opt['nearby-max']) {
	const box = authored.arcade?.online?.nearby;
	if (is3d || !box) throw new Error('--nearby-max sets the max of a 2D room’s nearby box');
	if (opt['nearby-max'] === 'none') delete box.max;
	else {
		const [w, h] = opt['nearby-max'].split('x').map(Number);
		if (!(w > 0 && h > 0))
			throw new Error(`--nearby-max is <w>x<h> or none, not "${opt['nearby-max']}"`);
		box.max = { w, h };
	}
}
const config = normalizeGameConfigDoc(authored);
const game = onlineGameOf(config);
if (!game || 'refused' in game) throw new Error(`not an online game: ${game?.refused ?? ''}`);
const { online, field } = game;

/**
 * `--shown`: the window each device plays in, in the mix's shares (shuffled, so a window says
 * nothing of a character). `undefined` for a device that says nothing.
 */
const windows = (() => {
	if (!opt.shown) return [];
	if (is3d) throw new Error('--shown is what a 2D room’s devices say: not with a 3D game');
	const entries = opt.shown.split(',').map((entry) => {
		const [share, spec] = entry.split(':');
		const sized = /^(\d+)x(\d+)(m?)$/.exec(spec ?? '');
		if (!(Number(share) > 0) || !(sized || spec === 'max' || spec === 'none'))
			throw new Error(`--shown is <share>:<w>x<h>[m]|max|none,…, not "${entry}"`);
		const window = sized
			? { w: Number(sized[1]), h: Number(sized[2]), mobile: sized[3] === 'm' }
			: undefined;
		return { share: Number(share), spec, window, devices: 0 };
	});
	const total = entries.reduce((sum, e) => sum + e.share, 0);
	const list = [];
	// The largest remainders make the counts add up to the devices.
	const exact = entries.map((e) => (e.share / total) * DEVICES);
	entries.forEach((e, i) => (e.devices = Math.floor(exact[i])));
	const order = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
	for (let left = DEVICES - entries.reduce((sum, e) => sum + e.devices, 0), i = 0; left > 0; left--)
		entries[order[i++ % order.length][1]].devices += 1;
	for (const e of entries) for (let n = 0; n < e.devices; n++) list.push(e);
	const rng = createRng('load:shown');
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(rng() * (i + 1));
		[list[i], list[j]] = [list[j], list[i]];
	}
	return list;
})();
/** The largest body's longer side, as the runtime's `reach` (`apps/lines` `online.ts`). */
const reach = Math.max(
	0,
	...online.characters.map(({ body }) => {
		const { shape, r, w, h } = game.bodies[body] ?? {};
		return shape === 'circle' ? 2 * r : shape === 'box' ? Math.max(w, h) : 0;
	}),
);
const { smoothing } = resolveCameraSpec(SALMONS_CAMERA);
/** How far a camera closes on its target in one step (`camera.js` `stepCamera`'s ease). */
const CAMERA_EASE = smoothing > 0 ? 1 - Math.exp(-1 / online.tickHz / smoothing) : 1;

/** What a device in `entry`'s window says with its camera `off` its own player (`shown.js`). */
function shownIn(entry, off) {
	if (!entry || entry.spec === 'none') return {};
	if (entry.spec === 'max') {
		const most = online.nearby?.max ?? online.nearby ?? { w: 0, h: 0 };
		return { shownW: most.w, shownH: most.h, shownIso: SHOWN_SHAPE.flat };
	}
	const { w, h, mobile } = entry.window;
	return shownOf({
		window: { w, h },
		zoom: cameraZoom(SALMONS_CAMERA, { mobile, windowScale: 1 }),
		iso: true,
		margin: reach,
		off,
	});
}

/**
 * What a device says its screen shows this step, its own player `me` as the room last placed it:
 * the runtime's own sum (`apps/lines` `online.ts` `follow`). Its camera eases to its player over
 * Salmons' `smoothing`, so it trails a swim and sweeps to a respawn, and the drawing is moved by
 * its own salmon's leap.
 */
function shownBy(device, me) {
	if (!device.window?.window || !me) return shownIn(device.window);
	const camera = (device.camera ??= { x: me.x, y: me.y });
	camera.x += (me.x - camera.x) * CAMERA_EASE;
	camera.y += (me.y - camera.y) * CAMERA_EASE;
	const from = ISO_PROJECTOR_MIRRORED.project(me.x - camera.x, me.y - camera.y);
	return shownIn(device.window, { x: from.x, y: from.y + liftOf((me.z ?? 0) / CELL) });
}

const freePort = () =>
	new Promise((done) => {
		const probe = createServer().listen(0, () => {
			const { port } = probe.address();
			probe.close(() => done(port));
		});
	});

const dir = mkdtempSync(join(tmpdir(), 'room-load-'));
// The server reads `arcade.world3d` from the raw doc (`game-config` does not keep it).
writeFileSync(join(dir, 'load.json'), JSON.stringify(is3d ? authored : config));
const port = await freePort();
const child = fork(join(ROOT, 'scripts/room-load-server.mjs'), [dir, String(port)], {
	execArgv: ['--experimental-strip-types', '--no-warnings', '--import', './scripts/ts-loader.mjs'],
	cwd: ROOT,
});
const serverReports = [];
await new Promise((ready, fail) => {
	child.on('message', (m) => (m.ready ? ready() : serverReports.push({ at: Date.now(), ...m })));
	child.once('exit', (code) => fail(new Error(`the server exited (${code})`)));
});

/**
 * A link that delays each chunk by the latency ± the jitter, never overtaking the one before: one
 * queue and one timer (Node does not keep timers of different lengths in order).
 */
const link = () => {
	const queue = [];
	let last = 0;
	let timer;
	const run = () => {
		timer = undefined;
		while (queue.length && queue[0].at <= performance.now()) queue.shift().fn();
		if (queue.length) timer = setTimeout(run, queue[0].at - performance.now());
	};
	return (fn) => {
		const at = Math.max(last, performance.now() + LATENCY + (Math.random() * 2 - 1) * JITTER);
		last = at;
		queue.push({ at, fn });
		timer ??= setTimeout(run, at - performance.now());
	};
};

/**
 * The devices' network: a TCP proxy in front of the server. A WebSocket's chunks are delayed each
 * way on their own link, and the bytes the server sends down it are counted (frames and their
 * headers, as they cross the wire). A matchmaking request passes straight through: its latency is
 * not what is measured, and a delayed close would race the HTTP client's reuse of the connection.
 */
const sockets = [];
const proxy = createNetServer((down) => {
	const up = connect(port, '127.0.0.1');
	down.once('data', (head) => {
		down.pause();
		const ws = /^GET [^\r]*\r\n[\s\S]*upgrade: websocket/i.test(head.toString('latin1'));
		if (!ws) {
			up.write(head);
			down.pipe(up);
			up.pipe(down);
			down.resume();
			return;
		}
		const socket = { bytes: 0 };
		sockets.push(socket);
		const toServer = link();
		const toDevice = link();
		toServer(() => up.write(head));
		down.on('data', (chunk) => toServer(() => up.write(chunk)));
		up.on('data', (chunk) => {
			if (measuring) socket.bytes += chunk.length;
			toDevice(() => down.write(chunk));
		});
		// A side that closes closes the other once what it sent before has been delivered.
		down.on('close', () => toServer(() => up.end()));
		up.on('close', () => toDevice(() => down.end()));
		down.resume();
	});
	down.on('error', () => up.destroy());
	up.on('error', () => down.destroy());
});
const proxyPort = await new Promise((done) =>
	proxy.listen(0, '127.0.0.1', () => done(proxy.address().port)),
);

/** Which character the n-th device plays: the room's characters in turn, within each one's max. */
const characterFor = (() => {
	const taken = new Map();
	return (n) => {
		const list = online.characters;
		for (let i = 0; i < list.length; i++) {
			const c = list[(n + i) % list.length];
			if (c.max !== undefined && (taken.get(c.id) ?? 0) >= c.max) continue;
			taken.set(c.id, (taken.get(c.id) ?? 0) + 1);
			return c.id;
		}
		return list[0].id;
	};
})();

const devices = [];
const tickMs = 1000 / online.tickHz;

async function joinDevice(n, roomId) {
	const character = characterFor(n);
	const client = new Client(`ws://127.0.0.1:${proxyPort}`);
	const options = { game: 'load', name: `Load ${n}`, character };
	const room = roomId
		? await client.joinById(roomId, options)
		: await client.joinOrCreate(is3d ? ROOM_NAME_3D : ROOM_NAME, options);
	const device = {
		n,
		room,
		character,
		window: windows[n],
		camera: undefined,
		states: 0,
		firstStep: undefined,
		lastStep: 0,
		seq: 0,
		rng: createRng(`load:${n}`),
		heading: 0,
	};
	room.onMessage(ONLINE_EVENT, () => {});
	room.onStateChange((state) => {
		if (!measuring) return;
		device.states += 1;
		device.firstStep ??= state.step;
		device.lastStep = state.step;
	});
	devices.push(device);
	return room;
}

/** A 3D device's person: runs where it heads, turns now and then, sprints, jumps. */
function inputOf3d(device) {
	const { rng } = device;
	if (rng() < 0.03) device.heading = rng() * 2 * Math.PI;
	device.seq += 1;
	const yaw = yawFromRadians(device.heading);
	const move = moveFromStick(0, rng() < 0.15 ? 0 : 1, yaw);
	return clampInput3d({
		seq: device.seq,
		...move,
		buttons: (rng() < 0.02 ? BUTTONS3D.jump : 0) | (rng() < 0.3 ? BUTTONS3D.sprint : 0),
		yaw,
		pitch: 0,
		view: Math.max(0, device.lastStep - Math.round(100 / tickMs)),
	});
}

/** The input a device's person would give this step. */
function inputOf(device) {
	if (is3d) return inputOf3d(device);
	const { rng } = device;
	if (rng() < 0.03) device.heading = (rng() - 0.5) * 1.4;
	const salmon = device.character === online.characters[0].id;
	let mx;
	let my;
	if (salmon) {
		mx = Math.sin(device.heading) * MOVE_SCALE;
		my = -Math.cos(device.heading) * MOVE_SCALE;
	} else {
		const angle = device.heading * 4.5;
		const still = rng() < 0.2;
		mx = still ? 0 : Math.cos(angle) * MOVE_SCALE;
		my = still ? 0 : Math.sin(angle) * MOVE_SCALE;
	}
	device.seq += 1;
	const view = Math.max(0, device.lastStep - Math.round(100 / tickMs));
	const me =
		opt.respawn || device.window
			? device.room.state.players?.get(device.room.sessionId)
			: undefined;
	return clampInput(
		{
			seq: device.seq,
			moveX: mx,
			moveY: my,
			buttons:
				(!salmon && rng() < 0.05 ? BUTTONS.ability1 : 0) |
				(salmon && JUMP > 0 && rng() < JUMP ? BUTTONS.jump : 0),
			view,
			...(opt.respawn && me?.status === STATUS.out
				? { respawn: 1 + online.characters.findIndex((c) => c.id === device.character) }
				: {}),
			...shownBy(device, me),
		},
		field,
	);
}

let measuring = false;
const startedAt = performance.now();
const first = await joinDevice(0);
for (let n = 1; n < DEVICES; n++) await joinDevice(n, first.roomId);
const joinedMs = performance.now() - startedAt;

const sending = setInterval(() => {
	for (const device of devices) {
		const handle = device.room.input();
		Object.assign(handle.data, inputOf(device));
		handle.send();
	}
}, tickMs);

const wait = (ms) => new Promise((done) => setTimeout(done, ms));
await wait(WARMUP_S * 1000);
const measureFrom = Date.now();
measuring = true;
const t0 = performance.now();
await wait(SECONDS * 1000);
measuring = false;
const seconds = (performance.now() - t0) / 1000;
clearInterval(sending);

const mean = (list) => list.reduce((s, v) => s + v, 0) / (list.length || 1);
const quantile = (list, q) => {
	if (!list.length) return 0;
	const sorted = [...list].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const reports = serverReports.filter((r) => r.at > measureFrom + 500);
const stepTimes = reports.flatMap((r) => r.steps);
const nearbyTimes = reports.flatMap((r) => r.nearby ?? []);
const held = devices.map((d) => d.room.state.players?.size ?? 0);
/** The mix as it was played: each window's devices, what one says at rest, and what they held and
 *  were sent. */
const shownMix = [...new Set(windows)].map((entry) => {
	const mine = devices.map((d, i) => [d, i]).filter(([d]) => d.window === entry);
	return {
		window: entry.spec,
		devices: mine.length,
		says: shownIn(entry),
		playersHeld: Math.round(mean(mine.map(([, i]) => held[i])) * 10) / 10,
		kBps:
			Math.round(mean(mine.map(([, i]) => (sockets[i]?.bytes ?? 0) / 1024 / seconds)) * 100) / 100,
	};
});
const serverSeconds = reports.reduce((s, r) => s + r.elapsedMs, 0) / 1000;
const perDevice = devices.map((d) => ({
	states: d.states / seconds,
	steps: d.firstStep === undefined ? 0 : (d.lastStep - d.firstStep) / seconds,
}));
const kBps = sockets.map((s) => s.bytes / 1024 / seconds);
const result = {
	game: config.gameName,
	devices: DEVICES,
	nearby: online.nearby ?? null,
	...(JUMP > 0 || opt.respawn ? { devicesPlay: { jump: JUMP, respawn: opt.respawn } } : {}),
	...(windows.length ? { shown: shownMix } : {}),
	/** Players the first device holds at the end (with `nearby`, only those near it). */
	seenByFirstDevice: first.state.players?.size ?? 0,
	/** Players a device holds at the end, itself among them. */
	playersHeld: { mean: Math.round(mean(held) * 10) / 10, max: Math.max(0, ...held) },
	link: { latencyMs: LATENCY, jitterMs: JITTER },
	rates: { tickHz: online.tickHz, subSteps: online.subSteps, patchHz: online.patchHz },
	joinedMs: Math.round(joinedMs),
	measuredSeconds: Math.round(seconds * 10) / 10,
	stepsPerSecond: {
		server: Math.round((stepTimes.length / serverSeconds) * 10) / 10,
		seenMin: Math.round(Math.min(...perDevice.map((d) => d.steps)) * 10) / 10,
	},
	statesPerSecond: {
		mean: Math.round(mean(perDevice.map((d) => d.states)) * 10) / 10,
		min: Math.round(Math.min(...perDevice.map((d) => d.states)) * 10) / 10,
	},
	deviceKBps: {
		mean: Math.round(mean(kBps) * 100) / 100,
		p95: Math.round(quantile(kBps, 0.95) * 100) / 100,
		max: Math.round(Math.max(...kBps) * 100) / 100,
	},
	egressMBps: Math.round((kBps.reduce((s, v) => s + v, 0) / 1024) * 1000) / 1000,
	stepMs: {
		p50: Math.round(quantile(stepTimes, 0.5) * 1000) / 1000,
		p99: Math.round(quantile(stepTimes, 0.99) * 1000) / 1000,
		max: Math.round(Math.max(0, ...stepTimes) * 1000) / 1000,
	},
	/** Each patch's pass over every device's nearby region (`arcadeRoom.ts` `nearby()`): beside the
	 *  step, not in it. Absent for a room that sends everyone everything. */
	...(nearbyTimes.length
		? {
				nearbyMs: {
					p50: Math.round(quantile(nearbyTimes, 0.5) * 1000) / 1000,
					p99: Math.round(quantile(nearbyTimes, 0.99) * 1000) / 1000,
					max: Math.round(Math.max(0, ...nearbyTimes) * 1000) / 1000,
				},
			}
		: {}),
	serverCpuPercent: Math.round(
		(reports.reduce((s, r) => s + r.cpuMs, 0) / 1000 / serverSeconds) * 100,
	),
	serverRssMb: Math.round(Math.max(0, ...reports.map((r) => r.rssMb))),
	budget: BUDGET,
};
const misses = [];
if (result.stepsPerSecond.seenMin < online.tickHz * BUDGET.rateHeld)
	misses.push(`steps held ${result.stepsPerSecond.seenMin}/s of ${online.tickHz}`);
if (result.statesPerSecond.min < online.patchHz * BUDGET.rateHeld)
	misses.push(`states ${result.statesPerSecond.min}/s of ${online.patchHz}`);
if (result.deviceKBps.mean > BUDGET.deviceKBps)
	misses.push(`a device receives ${result.deviceKBps.mean} KB/s on average`);
if (result.deviceKBps.max > BUDGET.deviceMaxKBps)
	misses.push(`a device receives up to ${result.deviceKBps.max} KB/s`);
if (result.egressMBps > BUDGET.egressMBps) misses.push(`egress ${result.egressMBps} MB/s`);
if (result.stepMs.p99 > BUDGET.stepP99Ms) misses.push(`step p99 ${result.stepMs.p99} ms`);
result.misses = misses;

console.log(JSON.stringify(result, null, 2));
if (opt.out) writeFileSync(resolve(opt.out), JSON.stringify(result, null, 2));

await Promise.allSettled(devices.map((d) => d.room.leave()));
child.kill();
proxy.close();
rmSync(dir, { recursive: true, force: true });
console.log(
	misses.length ? `room-load: MISSED — ${misses.join('; ')}` : 'room-load: within budget',
);
process.exit(misses.length ? 1 : 0);
