// Plays SALMONS (game-families P10.16) on the shared runtime, in two headless shells against a
// real game server (services/game-server) on localhost: the river a seed made, its online config
// (`engine-mechanics` `salmons.js`: 100 players, bots that fill each room to 20 as bears and
// fishermen, the river's currents and banks, catches, the source as the goal, nearby-only state)
// and its layout (`engine-layout` `salmonsReferenceLayout`, placeholder looks until the S0 art).
//
// It reads each page's arcade probe (`state().arcade`: the room's step and the players the page is
// sent, `online.drawn`, `camera`) and checks: both pages join one room and the bots fill it to 20;
// each page is sent only the players near its own (the bear on its bank is not sent to the salmon
// at the sea); page A's camera frames its own salmon; ArrowUp held on page A swims its salmon
// upstream and the camera follows; at rest page A draws its own salmon where the room has it; nothing
// reached an RGS; no page error. The playbook is docs/playtest/salmons.md. It builds its own
// snapshot and config, so the current-games harness is not touched.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { salmonsConfig, salmonsRiver } from '../../packages/engine-mechanics/src/salmons.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CAMERA,
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
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
		out: { type: 'string', default: join(ROOT, '.cache/salmons-play') },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'salmons';

const river = salmonsRiver();
// The bots start upstream, at least 2000 px from the sea, so nothing hunts page A's salmon while it
// swims (the hunt is check:room-bots'): otherwise a bear bot near the sea may catch it mid-check.
const authored = salmonsConfig(river);
const bots = authored.arcade.online.bots;
bots.spawns = bots.spawns.filter((p) => p.y < river.sea.y - 2000);
const config = normalizeGameConfigDoc(authored);
const doc = salmonsReferenceLayout(river);
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, ...SALMONS_CHARACTER_COMPONENTS].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);

const result = { shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });

const work = mkdtempSync(join(tmpdir(), 'salmons-play-'));
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
	name: 'Salmons',
	projectKey: KEY,
});
const server = await startTestServer(tree, {});
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Salmons',
	snapshotId: 'salmons',
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
				windowsVirtualKeyCode: { ArrowUp: 38 }[name],
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

try {
	const a = await ready(await boot('a', { rooms_name: 'Ann', rooms_character: 'salmon' }));
	const b = await ready(await boot('b', { rooms_name: 'Bo', rooms_character: 'bear' }));
	await settle(a, 800);
	await settle(b, 800);
	const listing = await fetch(`http://127.0.0.1:${roomsPort}/healthz`).then((r) => r.json());
	verdict('one room on the server', listing.rooms === 1, listing);
	const seenA = await players(a);
	const seenB = await players(b);
	const { me } = await drawnOf(a);
	const { me: meB } = await drawnOf(b);
	verdict(
		'both pages are in the room and see themselves',
		!!seenA.find((p) => p.id === me) && !!seenB.find((p) => p.id === meB),
		{ seenA, seenB },
	);
	const botsIn = (list) => list.filter((p) => p.id.startsWith('bot:'));
	verdict(
		'the bots fill the room: page B is sent the bots near its bank',
		botsIn(seenB).length > 0,
		{
			seenB,
		},
	);
	verdict(
		'nearby: the bear on its bank far upstream is not sent to the salmon at the sea, nor it to the bear',
		!seenA.find((p) => p.id === meB) && !seenB.find((p) => p.id === me),
		{ seenA, seenB },
	);
	const ownA = seenA.find((p) => p.id === me);
	verdict('page A’s salmon starts at the sea', ownA && ownA.y > river.sea.y - 200, ownA);
	const cam0 = (await a.state()).arcade?.camera;
	const frames = (cam, p) =>
		!!cam &&
		!!p &&
		p.x >= cam.x &&
		p.x <= cam.x + cam.view.w &&
		p.y >= cam.y &&
		p.y <= cam.y + cam.view.h;
	verdict('page A’s camera frames its own salmon', frames(cam0, ownA), { cam0, ownA });
	writeFileSync(join(out, '01-salmon-at-the-sea.png'), await a.page.screenshot());
	writeFileSync(join(out, '02-bear-on-its-bank.png'), await b.page.screenshot());
	result.shots.push('01-salmon-at-the-sea.png', '02-bear-on-its-bank.png');

	// Held until the salmon is 600 px upstream: how far a stretch of real time takes it depends on
	// how fast the shell steps its frames.
	await a.key('ArrowUp', 'down');
	for (let i = 0; i < 40; i++) {
		await settle(a, 500);
		const at = (await players(a)).find((p) => p.id === me);
		if (at && ownA && at.y < ownA.y - 600) break;
	}
	await a.key('ArrowUp', 'up');
	await settle(a, 600);
	const upA = (await players(a)).find((p) => p.id === me);
	const cam1 = (await a.state()).arcade?.camera;
	verdict('ArrowUp held swims page A’s salmon upstream', upA && ownA && upA.y < ownA.y - 500, {
		ownA,
		upA,
	});
	// The camera holds the salmon in its dead zone: it moves by what the salmon moved past it.
	const inDeadZone =
		!!cam1 &&
		!!upA &&
		Math.abs(upA.y - (cam1.y + cam1.view.h / 2)) <= SALMONS_CAMERA.deadZone.h / 2 + 4;
	verdict(
		'…and the camera follows it, holding it in its dead zone',
		!!cam0 && cam1.y < cam0.y - 100 && inDeadZone,
		{ cam0, cam1, upA },
	);
	const restFrom = (await players(a)).find((p) => p.id === me);
	await settle(a, 1200);
	// Resting in the water, the current carries the salmon down (it acts on every applied input,
	// and the page sends one each step): the page predicts the drift, a little ahead of the room's
	// last state.
	const drift = (await a.state()).arcade;
	const drawnMe = drift?.online?.drawn.find((d) => d.id === me);
	const roomMe = drift?.bodies.find((b) => b.id === me);
	const gap = drawnMe && roomMe ? Math.hypot(drawnMe.x - roomMe.x, drawnMe.y - roomMe.y) : Infinity;
	verdict('resting, page A draws its drifting salmon within 20 px of the room’s place', gap <= 20, {
		drawnMe,
		roomMe,
		gap,
	});
	verdict(
		'…and the current carried it downstream',
		!!roomMe && !!restFrom && roomMe.y > restFrom.y,
		{
			restFrom,
			roomMe,
		},
	);
	writeFileSync(join(out, '03-salmon-upstream.png'), await a.page.screenshot());
	result.shots.push('03-salmon-upstream.png');

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
	await a.page.close();
	await b.page.close();
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await rooms.close();
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(failed ? `\nsalmons play: ${failed} FAILED` : `\nsalmons play: OK → ${out}`);
process.exit(failed ? 1 : 0);
