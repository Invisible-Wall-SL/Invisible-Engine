// PACKED PLACES AND 15 STATES A SECOND (docs/design/salmons-performance.md §5 T7; owner,
// 2026-11-27: "go ahead with 16-bit positions and patchHz 15"). A device that joins a nearby room
// with `positions: 'u16'` (`engine-mechanics` `PACKED_POSITIONS`, what `apps/lines` `online.ts`
// joins with) is sent everyone else's place as two uint16 in steps of the room's `posScale`
// (`positionScale`: the finest power of two that covers the field), and its own as float32; a
// device that does not ask — every runtime older than this — is sent float32 for everyone, as
// before. Both kinds play in one room. Salmons ships 15 states a second, drawn two states' time
// behind (`netcode.js` `interpolationDelayFor`); every other game draws as before.
//
// Pure: the scale, the packing, the device's fallback for a server older than packed places
// (`placeOnWire`). Live: a real Colyseus room of Salmons' original map, a real SDK client of each
// kind and the bots, compared at one room step, and the bytes of each one's patches. The other
// deploy order (a new runtime on an old server) is played against main's server by
// `scripts/playtest/salmons-wire-play.mjs`.
//
//   pnpm check:room-wire

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createRng } from '../packages/engine-mechanics/src/board.js';
import {
	INTERPOLATION_DELAY_MS,
	interpolationDelayFor,
} from '../packages/engine-mechanics/src/netcode.js';
import {
	MOVE_SCALE,
	PACKED_POSITIONS,
	clampInput,
	packPosition,
	placeOnWire,
	positionScale,
	unpackPosition,
} from '../packages/engine-mechanics/src/online.js';
import { salmonsConfig } from '../packages/engine-mechanics/src/salmons.js';
import { SALMONS_MAP_SEED, salmonsMapRiver } from '../packages/engine-mechanics/src/salmonsMap.js';
import { normalizeGameConfigDoc, onlineGameOf } from '../packages/game-config/index.ts';
import { ARCADE_ONLINE_DEFAULTS } from '../packages/game-config/src/family.ts';
import { createConfigSource } from '../services/game-server/src/configSource.ts';
import { ROOM_NAME, createGameServer } from '../services/game-server/src/server.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const gameServerRequire = createRequire(join(ROOT, 'services/game-server/package.json'));
const { Client } = await import(pathToFileURL(gameServerRequire.resolve('@colyseus/sdk')).href);

let passed = 0;
const check = async (name, fn) => {
	await fn();
	passed++;
	console.log(`  ok  ${name}`);
};

// --- Pure ----------------------------------------------------------------------------------------

await check('the scale is the finest power of two (≤ 16) a uint16 covers the field in', () => {
	assert.equal(positionScale({ w: 1800, h: 7200 }), 8, 'a generated river: 1/8 px');
	assert.equal(positionScale({ w: 6768, h: 19728 }), 2, "the original's map: 1/2 px");
	assert.equal(positionScale({ w: 1422, h: 800 }), 16);
	assert.equal(positionScale({ w: 65535, h: 10 }), 1);
	assert.equal(positionScale({ w: 70000, h: 10 }), 0, 'too wide to pack: none');
});

await check('a packed place is within half a step of the place, and held to the uint16', () => {
	const rng = createRng('pack');
	for (const field of [
		{ w: 1800, h: 7200 },
		{ w: 6768, h: 19728 },
	]) {
		const scale = positionScale(field);
		for (let i = 0; i < 10_000; i++) {
			const x = rng() * field.w;
			const back = unpackPosition(packPosition(x, scale), scale);
			assert.ok(Math.abs(back - x) <= 0.5 / scale + 1e-9, `${x} → ${back}`);
		}
	}
	assert.equal(packPosition(-3, 8), 0);
	assert.equal(packPosition(1e9, 8), 0xffff);
});

await check('a device reads x / y wherever the room sent no packed place (an older server)', () => {
	assert.deepEqual(placeOnWire({ x: 1.5, y: 2.5 }, undefined), { x: 1.5, y: 2.5 });
	assert.deepEqual(placeOnWire({ x: 1.5, y: 2.5 }, 0), { x: 1.5, y: 2.5 });
	assert.deepEqual(placeOnWire({ x: 1.5, y: 2.5 }, 2), { x: 1.5, y: 2.5 }, 'own: no px');
	assert.deepEqual(placeOnWire({ x: undefined, y: undefined, px: 7, py: 9 }, 2), {
		x: 3.5,
		y: 4.5,
	});
});

await check(
	'Salmons sends 15 states a second, drawn two of them behind; every other game as before',
	() => {
		const salmons = onlineGameOf(
			normalizeGameConfigDoc(salmonsConfig(salmonsMapRiver(SALMONS_MAP_SEED))),
		);
		assert.equal(salmons.online.patchHz, 15);
		assert.ok(Math.abs(interpolationDelayFor(15) - 2000 / 15) < 1e-9);
		assert.equal(ARCADE_ONLINE_DEFAULTS.patchHz, 20, 'the default is unchanged');
		assert.equal(interpolationDelayFor(20), INTERPOLATION_DELAY_MS);
		assert.equal(interpolationDelayFor(30), INTERPOLATION_DELAY_MS);
	},
);

// --- Live ----------------------------------------------------------------------------------------

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (what, test, ms = 8000) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (test()) return;
		await wait(5);
	}
	throw new Error(`timed out waiting for ${what}`);
};

/** The SDK's frame code of a state patch (`@colyseus/shared-types` `Protocol`), and its mask. */
const ROOM_STATE_PATCH = 15;
const PROTOCOL_CODE_MASK = 31;

const river = salmonsMapRiver(SALMONS_MAP_SEED);
const doc = normalizeGameConfigDoc(salmonsConfig(river));
const game = onlineGameOf(doc);
const sample = normalizeGameConfigDoc({
	...doc,
	arcade: { ...doc.arcade, online: { ...doc.arcade.online, nearby: undefined } },
});
const dir = mkdtempSync(join(tmpdir(), 'room-wire-'));
writeFileSync(join(dir, 'salmons.json'), JSON.stringify(doc));
writeFileSync(join(dir, 'plain.json'), JSON.stringify(sample));
const port = await new Promise((resolve) => {
	const probe = createServer();
	probe.listen(0, () => {
		const { port: free } = probe.address();
		probe.close(() => resolve(free));
	});
});
const server = createGameServer({
	loadGame: createConfigSource({ dir }),
	maxRooms: 4,
	commit: 'roomwire0000',
	gracefullyShutdown: false,
});
await server.listen(port);

/** Join as a runtime does — a new one asks for packed places, an old one does not — counting
 *  the bytes of every state patch it is sent. */
const joinRoom = async (gameKey, packed) => {
	const room = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate(ROOM_NAME, {
		game: gameKey,
		character: 'salmon',
		...(packed ? { positions: PACKED_POSITIONS } : {}),
	});
	room.onMessage('*', () => {});
	const tally = { patches: 0, bytes: 0 };
	const { events } = room.connection;
	const handle = events.onmessage;
	events.onmessage = (event) => {
		const bytes = event.data instanceof Uint8Array ? event.data : new Uint8Array(event.data);
		if ((bytes[0] & PROTOCOL_CODE_MASK) === ROOM_STATE_PATCH) {
			tally.patches += 1;
			tally.bytes += bytes.byteLength;
		}
		handle(event);
	};
	await until('its own player', () => room.state?.players?.get(room.sessionId) !== undefined);
	return { room, tally, me: () => room.state.players.get(room.sessionId) };
};
/** Swim, one input a step, for `ms`. */
const swim = async (devices, ms) => {
	const end = Date.now() + ms;
	let seq = 0;
	while (Date.now() < end) {
		seq += 1;
		for (const [i, device] of devices.entries()) {
			const handle = device.room.input();
			const way = Math.floor(seq / 20 + i) % 4;
			const moveX = [MOVE_SCALE, 0, -MOVE_SCALE, 0][way];
			const moveY = [0, -MOVE_SCALE, 0, MOVE_SCALE][way];
			Object.assign(handle.data, clampInput({ seq, moveX, moveY }, game.field));
			handle.send();
		}
		await wait(1000 / game.online.tickHz);
	}
};
/** Both devices at one room step (each decodes its own patches). */
const atOneStep = async (a, b) => {
	for (let i = 0; i < 400; i++) {
		if (a.room.state.step === b.room.state.step) return a.room.state.step;
		await wait(2);
	}
	throw new Error('the two devices never held one step');
};

try {
	const fresh = await joinRoom('salmons', true);
	const old = await joinRoom('salmons', false);
	assert.equal(fresh.room.roomId, old.room.roomId, 'one room');
	const scale = positionScale(game.field);

	await check(
		'live: the room says its scale; an old device decodes it and never uses it',
		async () => {
			assert.equal(fresh.room.state.posScale, scale);
			assert.equal(old.room.state.posScale, scale);
		},
	);

	await swim([fresh, old], 3000);
	const step = await atOneStep(fresh, old);

	await check('live: an old device is sent float32 x / y for everyone, and no packed place', () => {
		let seen = 0;
		old.room.state.players.forEach((p) => {
			assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y), JSON.stringify(p.toJSON()));
			assert.equal(p.px, undefined);
			assert.equal(p.py, undefined);
			seen += 1;
		});
		assert.ok(seen >= 3, `${seen} players seen`);
	});

	await check(
		'live: a new device is sent its own place in float32 and everyone else’s packed',
		() => {
			let others = 0;
			fresh.room.state.players.forEach((p, id) => {
				if (id === fresh.room.sessionId) {
					assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
					assert.equal(p.px, undefined);
					return;
				}
				assert.equal(p.x, undefined, `${id} has x`);
				assert.ok(Number.isInteger(p.px) && Number.isInteger(p.py));
				others += 1;
			});
			assert.ok(others >= 2, `${others} others`);
		},
	);

	await check(
		`live: at one step (${step}) both agree on every place, packed within half a step`,
		() => {
			const oldMe = old.room.state.players.get(fresh.room.sessionId);
			assert.equal(
				fresh.me().x,
				oldMe.x,
				'the new device’s own place is the float32 everyone else had',
			);
			assert.equal(fresh.me().y, oldMe.y);
			let compared = 0;
			fresh.room.state.players.forEach((p, id) => {
				if (id === fresh.room.sessionId) return;
				const truth = old.room.state.players.get(id);
				if (!truth) return;
				const at = placeOnWire(p, fresh.room.state.posScale);
				assert.ok(Math.abs(at.x - truth.x) <= 0.5 / scale + 1e-3, `${id}: ${at.x} vs ${truth.x}`);
				assert.ok(Math.abs(at.y - truth.y) <= 0.5 / scale + 1e-3, `${id}: ${at.y} vs ${truth.y}`);
				compared += 1;
			});
			assert.ok(compared >= 2, `${compared} compared`);
		},
	);

	await check('live: the new device’s patches are smaller for the same room', async () => {
		const from = { fresh: { ...fresh.tally }, old: { ...old.tally } };
		await swim([fresh, old], 4000);
		const per = (now, was) => (now.bytes - was.bytes) / Math.max(1, now.patches - was.patches);
		const freshPer = per(fresh.tally, from.fresh);
		const oldPer = per(old.tally, from.old);
		const bodies = old.room.state.players.size;
		console.log(
			`      ${bodies} players: ${oldPer.toFixed(0)} B a patch float32, ${freshPer.toFixed(0)} B packed (${(100 * (1 - freshPer / oldPer)).toFixed(0)} % less)`,
		);
		assert.ok(freshPer < oldPer * 0.9, `${freshPer} vs ${oldPer}`);
		const rate = (fresh.tally.patches - from.fresh.patches) / 4;
		assert.ok(Math.abs(rate - 15) <= 2, `${rate} patches a second`);
	});
	fresh.room.leave();
	old.room.leave();

	await check(
		'live: a room with no nearby box sends float32 to a device that asks (unchanged)',
		async () => {
			const plain = await joinRoom('plain', true);
			await swim([plain], 500);
			assert.equal(plain.room.state.posScale, undefined);
			plain.room.state.players.forEach((p) => {
				assert.ok(Number.isFinite(p.x));
				assert.equal(p.px, undefined);
			});
			plain.room.leave();
		},
	);
} finally {
	await server.close?.();
	rmSync(dir, { recursive: true, force: true });
}

console.log(`check:room-wire — ${passed} checks passed`);
process.exit(0);
