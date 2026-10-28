// THE ROOM LOAD TEST (`docs/design/realtime-multiplayer.md` §12, game-families P10.16; not a CI
// gate): fills one room of an online arcade game with bot DEVICES — real `@colyseus/sdk` clients
// in this process, each sending one input per fixed step over a simulated link — and measures, on a
// game server in a process of its own (`room-load-server.mjs`):
//
//   - the tick rates held: the room's steps a second as the devices see them advance (of `tickHz`),
//     and the states a second each device receives (of `patchHz`);
//   - the bandwidth: bytes a second each device receives (its WebSocket's bytes on the wire, TCP
//     and IP headers aside), and what leaves the server in all;
//   - the server: its step time (p50 / p99 / max), its CPU (% of one core) and its memory.
//
// The devices play like people: a salmon swims upstream and weaves, a bear or a fisherman roams
// and swipes / casts now and then. Every device reaches the server through a TCP proxy that delays
// what it sends and what it receives by `--latency` ms ± `--jitter` each way (in order, as TCP
// delivers). The game is Salmons
// (`engine-mechanics` `salmons.js`) unless `--config` names another online config.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/room-load.mjs [--devices 100] [--seconds 30] [--latency 60] [--jitter 20] \
//     [--config <game.json>] [--everyone] [--out <result.json>]
//
// `--everyone` drops the config's `online.nearby`, so every device is sent every player.
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

import { BUTTONS, MOVE_SCALE, clampInput } from '../packages/engine-mechanics/src/online.js';
import { ONLINE_EVENT } from '../packages/engine-mechanics/src/onlineRules.js';
import { createRng } from '../packages/engine-mechanics/src/board.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { ROOM_NAME } from '../services/game-server/src/server.ts';

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
		out: { type: 'string' },
	},
});
const DEVICES = Number(opt.devices);
const SECONDS = Number(opt.seconds);
const LATENCY = Number(opt.latency);
const JITTER = Number(opt.jitter);
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

const authored = opt.config
	? JSON.parse(readFileSync(resolve(opt.config), 'utf8'))
	: salmonsConfig();
// `--everyone`: every device is sent every player (the room as it is without `online.nearby`).
if (opt.everyone) delete authored.arcade?.online?.nearby;
const config = normalizeGameConfigDoc(authored);
const game = onlineGameOf(config);
if (!game || 'refused' in game) throw new Error(`not an online game: ${game?.refused ?? ''}`);
const { online, field } = game;

const freePort = () =>
	new Promise((done) => {
		const probe = createServer().listen(0, () => {
			const { port } = probe.address();
			probe.close(() => done(port));
		});
	});

const dir = mkdtempSync(join(tmpdir(), 'room-load-'));
writeFileSync(join(dir, 'load.json'), JSON.stringify(config));
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
		: await client.joinOrCreate(ROOM_NAME, options);
	const device = {
		n,
		room,
		character,
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

/** The input a device's person would give this step. */
function inputOf(device) {
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
	return clampInput(
		{
			seq: device.seq,
			moveX: mx,
			moveY: my,
			buttons: !salmon && rng() < 0.05 ? BUTTONS.ability1 : 0,
			view,
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

const quantile = (list, q) => {
	if (!list.length) return 0;
	const sorted = [...list].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const reports = serverReports.filter((r) => r.at > measureFrom + 500);
const stepTimes = reports.flatMap((r) => r.steps);
const serverSeconds = reports.reduce((s, r) => s + r.elapsedMs, 0) / 1000;
const perDevice = devices.map((d) => ({
	states: d.states / seconds,
	steps: d.firstStep === undefined ? 0 : (d.lastStep - d.firstStep) / seconds,
}));
const mean = (list) => list.reduce((s, v) => s + v, 0) / (list.length || 1);
const kBps = sockets.map((s) => s.bytes / 1024 / seconds);
const result = {
	game: config.gameName,
	devices: DEVICES,
	nearby: online.nearby ?? null,
	/** Players the first device holds at the end (with `nearby`, only those near it). */
	seenByFirstDevice: first.state.players?.size ?? 0,
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
