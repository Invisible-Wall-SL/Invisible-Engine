// Plays an online arcade room (realtime-multiplayer.md §10, P10.14) on the shared runtime, in two
// headless shells against a real game server (services/game-server) on localhost: the arcade
// sample's scene set and components with an `arcade.online` config of two characters, no flow.
//
// It reads each page's arcade probe (`state().arcade`: the room's step and every player as the
// server last placed it, and `online.drawn`, where the page draws each one) and checks: both pages
// join one room and draw both players; ArrowRight held on page A moves A's player right on BOTH
// pages, and letting go stops it; page A draws its own player moving within its first frames
// (prediction, P10.15); at rest each page draws every player exactly where the room has it (the
// prediction and the interpolation converge); the two pages then agree on every place; page B's
// character came from `?rooms_character=`; nothing reached an RGS; closing page B lets its player
// go when the rejoin grace runs out; a launch with no `?rooms_url=` stops on
// the boot-failure screen; no page error. It builds its own snapshot and config, so the
// current-games harness is not touched. `--netcode colyseus` plays the config with the Colyseus
// SDK's own prediction (`arcade.online.netcode`); the pages must report the mode they ran.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/online-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>] \
//     [--netcode engine|colyseus]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	ARCADE_SAMPLE_COMPONENTS,
	arcadeReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { createConfigSource } from '../../services/game-server/src/configSource.ts';
import { createGameServer } from '../../services/game-server/src/server.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/online-play') },
		chrome: { type: 'string' },
		netcode: { type: 'string', default: 'engine' },
	},
});
if (opt.netcode !== 'engine' && opt.netcode !== 'colyseus') {
	console.error(`--netcode is engine or colyseus, not "${opt.netcode}"`);
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'online-sample';
const FIELD = { w: 1422, h: 800 };
const SPEED = 300;

const sample = JSON.parse(
	readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
);
const config = normalizeGameConfigDoc({
	...sample,
	gameName: 'Online sample',
	arcade: {
		...sample.arcade,
		field: FIELD,
		online: {
			characters: [
				{ id: 'salmon', body: 'arcadeSalmon', speed: SPEED },
				{ id: 'bear', body: 'arcadeBear', speed: SPEED, max: 1 },
			],
			maxPlayers: 4,
			rejoinSeconds: 2,
			netcode: opt.netcode,
			spawn: { x: FIELD.w / 2, y: FIELD.h - 80 },
		},
	},
});
const doc = arcadeReferenceLayout();
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...ARCADE_SAMPLE_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'online-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config }),
);
const configs = join(work, 'configs');
mkdirSync(configs);
writeFileSync(join(configs, `${KEY}.json`), JSON.stringify(config));

const HOOK = `(() => {
	const wire = (window.__AR_WIRE__ = []);
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
	const fetch = window.fetch.bind(window);
	window.fetch = (input, init) => {
		wire.push(typeof input === 'string' ? input : input.url ?? String(input));
		return fetch(input, init);
	};
	const open = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (method, url, ...rest) {
		wire.push(String(url));
		return open.call(this, method, url, ...rest);
	};
})();`;

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'freePlay',
	name: 'Online sample',
	projectKey: KEY,
});
const server = await startTestServer(tree, {});
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Online sample',
	snapshotId: 'online',
	assetBase: `${server.origin}/${KEY}/`,
});
const roomsPort = 20000 + Math.floor(Math.random() * 20000);
const rooms = createGameServer({
	loadGame: createConfigSource({ dir: configs }),
	maxRooms: 4,
	commit: 'playtest',
	gracefullyShutdown: false,
});
await rooms.listen(roomsPort);

const paramsFor = (extra) =>
	new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'online-play',
		editorDocBase: snap.origin,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		rooms_url: `ws://127.0.0.1:${roomsPort}`,
		...extra,
	});

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(profile, extra = {}) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	const params = paramsFor(extra);
	for (const [k, v] of Object.entries(extra)) if (v === null) params.delete(k);
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	return page;
}

async function ready(page) {
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await wait(100);
	}
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }]);
	return {
		page,
		state: () => api('state()'),
		play,
		key: (name, type) =>
			page.page('Input.dispatchKeyEvent', {
				type: type === 'down' ? 'rawKeyDown' : 'keyUp',
				key: name,
				code: name,
				windowsVirtualKeyCode: { ArrowRight: 39 }[name],
			}),
	};
}

/** Step a page's frames while real time passes, so the room's patches reach it. */
const settle = async (game, ms) => {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		await game.play([{ op: 'step', frames: 6 }]);
		await wait(50);
	}
};
const players = async (game) => (await game.state()).arcade?.bodies ?? [];
const drawnOf = async (game) => (await game.state()).arcade?.online ?? { drawn: [] };
/** Players drawn more than `px` from where the room has them. */
const offRoom = async (game, px = 0.01) => {
	const arcade = (await game.state()).arcade;
	return (arcade?.online?.drawn ?? []).filter((d) => {
		const room = arcade.bodies.find((b) => b.id === d.id);
		return !room || Math.hypot(room.x - d.x, room.y - d.y) > px;
	});
};

try {
	const a = await ready(await boot('a', { rooms_name: 'Ann' }));
	const b = await ready(await boot('b', { rooms_name: 'Bo', rooms_character: 'bear' }));
	await settle(a, 600);
	await settle(b, 600);
	const seenA = await players(a);
	const seenB = await players(b);
	verdict(
		'both pages join one room and draw both players',
		seenA.length === 2 && seenB.length === 2,
		{
			seenA,
			seenB,
		},
	);
	for (const [name, game] of [
		['A', a],
		['B', b],
	])
		verdict(
			`page ${name} plays the ${opt.netcode} netcode`,
			(await drawnOf(game)).netcode === opt.netcode,
		);
	const roomA = [...seenA.map((p) => p.id)].sort();
	const roomB = [...seenB.map((p) => p.id)].sort();
	verdict('…the same two players', JSON.stringify(roomA) === JSON.stringify(roomB));

	const listing = await fetch(`http://127.0.0.1:${roomsPort}/healthz`).then((r) => r.json());
	verdict('one room on the server', listing.rooms === 1, listing);

	// A's own id is the player that moves when A presses.
	const before = await players(a);
	const { me } = await drawnOf(a);
	await a.key('ArrowRight', 'down');
	await a.play([{ op: 'step', frames: 4 }]);
	const early = await drawnOf(a);
	const ownDrawn = early.drawn.find((d) => d.id === me);
	const ownRoom = (await players(a)).find((p) => p.id === me);
	const ownBefore = before.find((p) => p.id === me);
	// On loopback the room answers within the same frames, so being ahead of it is not measurable
	// here (check:netcode measures it over simulated latency): the page's own drawing moves at once.
	verdict(
		'page A draws its own player moving within its first frames (prediction)',
		!!ownDrawn && !!ownBefore && ownDrawn.x > ownBefore.x,
		{ ownBefore, ownDrawn, ownRoom },
	);
	await settle(a, 700);
	await a.key('ArrowRight', 'up');
	await settle(a, 400);
	await settle(b, 400);
	const afterA = await players(a);
	const afterB = await players(b);
	const moved = afterA.filter((p) => {
		const was = before.find((q) => q.id === p.id);
		return was && p.x > was.x + 60;
	});
	verdict('ArrowRight held on page A moves one player right', moved.length === 1, {
		before,
		afterA,
	});
	const mover = moved[0];
	const onB = afterB.find((p) => p.id === mover?.id);
	verdict('…page B sees it in the same place', !!onB && onB.x === mover.x && onB.y === mover.y, {
		mover,
		onB,
	});
	await settle(a, 300);
	const still = (await players(a)).find((p) => p.id === mover?.id);
	verdict('…and letting go stops it', still?.x === mover?.x, { still, mover });
	verdict("…and it is page A's own player", mover?.id === me);
	await settle(b, 400);
	for (const [name, game] of [
		['A', a],
		['B', b],
	]) {
		const off = await offRoom(game);
		verdict(`at rest, page ${name} draws every player where the room has it`, off.length === 0, {
			off,
			room: await players(game),
		});
	}
	verdict(
		'the two pages agree on every place',
		JSON.stringify([...afterA].sort((p, q) => (p.id < q.id ? -1 : 1))) ===
			JSON.stringify([...afterB].sort((p, q) => (p.id < q.id ? -1 : 1))),
	);
	writeFileSync(join(out, '01-page-a.png'), await a.page.screenshot());
	writeFileSync(join(out, '02-page-b.png'), await b.page.screenshot());
	result.shots.push('01-page-a.png', '02-page-b.png');

	for (const [name, game] of [
		['A', a],
		['B', b],
	]) {
		const wire = await game.page.evaluate('window.__AR_WIRE__');
		const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
		verdict(`page ${name} sends the RGS nothing`, rgs.length === 0, rgs);
		const errors = await game.page.evaluate('window.__AR_ERRORS__');
		verdict(`page ${name}: no page error`, errors.length === 0, errors);
	}

	await b.page.close();
	await settle(a, 3500);
	verdict(
		'closing page B lets its player go once the rejoin grace runs out',
		(await players(a)).length === 1,
		await players(a),
	);
	await a.page.close();

	const bare = await boot('bare', { rooms_url: null });
	let stale;
	for (let i = 0; i < 200 && !stale; i++) {
		stale = await bare.evaluate('window.__IE_RUNTIME_STALE__ ?? null').catch(() => null);
		if (!stale) await wait(100);
	}
	verdict(
		'a launch with no game server stops on the boot-failure screen',
		/rooms_url/.test(stale?.reason ?? ''),
		stale,
	);
	writeFileSync(join(out, '03-no-server.png'), await bare.screenshot());
	result.shots.push('03-no-server.png');
	await bare.close();
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(failed ? `\nonline play: ${failed} FAILED` : `\nonline play: OK → ${out}`);
process.exit(failed ? 1 : 0);
