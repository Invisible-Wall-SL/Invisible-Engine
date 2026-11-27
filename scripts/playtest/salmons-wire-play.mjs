// Plays PACKED PLACES across versions (docs/design/salmons-performance.md §5 T7; owner,
// 2026-11-27): both deploy orders, in headless shells on localhost, with two runtime builds and two
// game servers. A runtime that asks for packed places (this branch's, `online.ts` joins with
// `positions: 'u16'`) and one that does not (any build from before it) share a room; a server that
// packs (this checkout's `services/game-server`) and one that does not (`--old-server`, a checkout
// of main) each host one.
//
// The game is the online sample's (`arcade.rules.json`) with a nearby box over its whole field, so
// its room is a nearby room, which is the only kind that packs. Each page's arcade probe gives the
// room's places (`bodies`), where it draws each player (`online.drawn`) and how it is sent them
// (`online.wire`: the room's `posScale` and how many others came packed; absent from an old
// runtime). Verdicts, per order: both pages join one room and see both players; the new page is
// sent the other packed by the new server (posScale 16) and float32 by the old (posScale 0); the
// old page is sent float32 either way; ArrowRight held on each page moves its player on both; at
// rest each page draws every player where its room has it, and the two pages agree on every place
// to half a packed step; no page error.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-wire-play.mjs --runtime apps/lines/build --old-runtime <build> \
//     --old-server <checkout of main> --out <dir> [--chrome <exe>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	ARCADE_SAMPLE_COMPONENTS,
	arcadeReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import { positionScale } from '../../packages/engine-mechanics/src/online.js';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		'old-runtime': { type: 'string' },
		'old-server': { type: 'string' },
		out: { type: 'string', default: join(ROOT, '.cache/salmons-wire-play') },
		chrome: { type: 'string' },
	},
});
if (!opt['old-runtime'] || !opt['old-server']) {
	console.error('--old-runtime <build> and --old-server <checkout> are both needed');
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'wire-sample';
const FIELD = { w: 1422, h: 800 };
const SCALE = positionScale(FIELD);

const sample = JSON.parse(
	readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/arcade.rules.json'), 'utf8'),
);
const config = normalizeGameConfigDoc({
	...sample,
	gameName: 'Wire sample',
	arcade: {
		...sample.arcade,
		field: FIELD,
		online: {
			characters: [
				{ id: 'salmon', body: 'arcadeSalmon', speed: 300 },
				{ id: 'bear', body: 'arcadeBear', speed: 300 },
			],
			maxPlayers: 4,
			rejoinSeconds: 2,
			spawn: { x: FIELD.w / 2, y: FIELD.h - 80 },
			// Over the whole field: every page is sent every player, through a nearby room's view.
			nearby: { w: 2 * FIELD.w, h: 2 * FIELD.h },
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

const result = { verdicts: [], shots: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'salmons-wire-play-'));
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
	const errors = (window.__AR_ERRORS__ = []);
	addEventListener('error', (e) => errors.push(String(e.message)));
	addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
})();`;

/** One test server per runtime build, serving the same snapshot. */
const serveRuntime = async (dir, name) => {
	const tree = testServerTree(join(work, `tree-${name}`), resolve(dir), KEY, {
		protocol: 'freePlay',
		name: 'Wire sample',
		projectKey: KEY,
	});
	return startTestServer(tree, {});
};
const runtimes = {
	new: await serveRuntime(opt.runtime, 'new'),
	old: await serveRuntime(opt['old-runtime'], 'old'),
};
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Wire sample',
	snapshotId: 'wire',
	assetBase: `${runtimes.new.origin}/${KEY}/`,
});

/** A game server from a checkout: its own `server.ts` and `configSource.ts`. */
const startRooms = async (root) => {
	const src = join(resolve(root), 'services/game-server/src');
	const { createGameServer } = await import(pathToFileURL(join(src, 'server.ts')).href);
	const { createConfigSource } = await import(pathToFileURL(join(src, 'configSource.ts')).href);
	const port = 20000 + Math.floor(Math.random() * 20000);
	const rooms = createGameServer({
		loadGame: createConfigSource({ dir: configs }),
		maxRooms: 4,
		commit: 'playtest',
		gracefullyShutdown: false,
	});
	await rooms.listen(port);
	return { rooms, url: `ws://127.0.0.1:${port}` };
};

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function boot(runtime, profile, roomsUrl, extra) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	const params = new URLSearchParams({
		runtime: '1',
		project: KEY,
		k: 'wire-play',
		editorDocBase: snap.origin,
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
		ie_determinism: '7',
		rooms_url: roomsUrl,
		...extra,
	});
	await page.navigate(`${runtimes[runtime].origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await wait(100);
	}
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	await play([{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 }, { op: 'tapToStart' }]);
	return {
		page,
		play,
		state: () => page.evaluate('window.__IE_DETERMINISM__.state()'),
		key: (type) =>
			page.page('Input.dispatchKeyEvent', {
				type: type === 'down' ? 'rawKeyDown' : 'keyUp',
				key: 'ArrowRight',
				code: 'ArrowRight',
				windowsVirtualKeyCode: 39,
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
const arcadeOf = async (game) => (await game.state()).arcade ?? {};
const bodyOf = (arcade, id) => arcade.bodies?.find((b) => b.id === id);

/** One order: a page of each runtime in one room of `server`, named for the verdicts. */
async function playOrder(name, server, expectPacked) {
	const fresh = await boot('new', `${name}-new`, server.url, { rooms_name: 'Nia' });
	const old = await boot('old', `${name}-old`, server.url, {
		rooms_name: 'Olm',
		rooms_character: 'bear',
	});
	await settle(fresh, 600);
	await settle(old, 600);
	const a = await arcadeOf(fresh);
	const b = await arcadeOf(old);
	verdict(
		`${name}: both pages join one room and see both players`,
		a.bodies?.length === 2 &&
			b.bodies?.length === 2 &&
			JSON.stringify(a.bodies.map((x) => x.id).sort()) ===
				JSON.stringify(b.bodies.map((x) => x.id).sort()),
		{ a: a.bodies, b: b.bodies },
	);
	const wire = a.online?.wire;
	verdict(
		expectPacked
			? `${name}: the new page is sent the other player packed (scale ${SCALE})`
			: `${name}: the new page is sent float32 by a server that does not pack, and reads it`,
		expectPacked
			? wire?.posScale === SCALE && wire?.packed === 1
			: wire?.posScale === 0 && wire?.packed === 0,
		wire,
	);
	verdict(
		`${name}: the old page is sent float32 for everyone and has no packed reading`,
		b.online?.wire === undefined && b.bodies.every((x) => Number.isFinite(x.x)),
		b.online?.wire ?? null,
	);
	for (const [who, mover, watcher] of [
		['new', fresh, old],
		['old', old, fresh],
	]) {
		const id = (await arcadeOf(mover)).online.me;
		const before = bodyOf(await arcadeOf(watcher), id);
		await mover.key('down');
		await settle(mover, 700);
		await mover.key('up');
		await settle(mover, 400);
		await settle(watcher, 500);
		const seen = bodyOf(await arcadeOf(watcher), id);
		const own = bodyOf(await arcadeOf(mover), id);
		verdict(
			`${name}: ArrowRight on the ${who} page moves its player, and the other page sees it there`,
			!!before &&
				!!seen &&
				!!own &&
				seen.x > before.x + 60 &&
				Math.abs(seen.x - own.x) <= 0.5 / SCALE + 1e-3 &&
				Math.abs(seen.y - own.y) <= 0.5 / SCALE + 1e-3,
			{ before, seen, own },
		);
	}
	await settle(fresh, 400);
	await settle(old, 400);
	for (const [who, game] of [
		['new', fresh],
		['old', old],
	]) {
		const arcade = await arcadeOf(game);
		const off = (arcade.online?.drawn ?? []).filter((d) => {
			const room = bodyOf(arcade, d.id);
			return !room || Math.hypot(room.x - d.x, room.y - d.y) > 0.01;
		});
		verdict(
			`${name}: at rest the ${who} page draws every player where its room has it`,
			off.length === 0,
			{
				off,
				bodies: arcade.bodies,
			},
		);
		const errors = await game.page.evaluate('window.__AR_ERRORS__');
		verdict(`${name}: ${who} page, no page error`, errors.length === 0, errors);
	}
	writeFileSync(join(out, `${name}-new.png`), await fresh.page.screenshot());
	writeFileSync(join(out, `${name}-old.png`), await old.page.screenshot());
	result.shots.push(`${name}-new.png`, `${name}-old.png`);
	await fresh.page.close();
	await old.page.close();
}

// One game server at a time: each checkout's Colyseus keeps its own matchmaker.
let open;
try {
	open = await startRooms(ROOT);
	await playOrder('new server', open, true);
	await open.rooms.close();
	open = await startRooms(opt['old-server']);
	await playOrder('old server', open, false);
} finally {
	for (const runtime of Object.values(runtimes)) runtime.stop();
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await open?.rooms.close().catch(() => {});
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(failed ? `\nwire play: ${failed} FAILED` : `\nwire play: OK → ${out}`);
process.exit(failed ? 1 : 0);
