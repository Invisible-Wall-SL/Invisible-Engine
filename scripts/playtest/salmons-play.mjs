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
// reached an RGS; no page error. With P11.2 it plays Salmons' flow (`engine-flow-v2`
// `SALMONS_SEED_DOC`) too: the HUD shows the room's score and round (variables the room owns); page
// B's J draws the bear's swipe on the press, before the room tells of it; and page C, in a room
// of its own whose rounds last 5 s (`rooms_game=salmons-short`), sees the round-over screen come up
// at the round's end and go at the next. P11.2 (e): each room plays a river of its own, made from
// the seed its state carries — pages A and B (one room) make the same river, page C (another room)
// a different one, each the river whose sea the server started its salmon at. The playbook is
// docs/playtest/salmons.md. It builds its own
// snapshot and config, so the current-games harness is not touched. `--netcode colyseus` plays it
// with the Colyseus SDK's own prediction (`arcade.online.netcode`): a nearby room and the world
// camera under that netcode; the pages must report the mode they ran.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/salmons-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>] \
//     [--netcode engine|colyseus]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { generatedOnlineGame } from '../../packages/engine-mechanics/src/onlineGenerators.js';
import { salmonsConfig, salmonsRiver } from '../../packages/engine-mechanics/src/salmons.js';
import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	SALMONS_CAMERA,
	SALMONS_CHARACTER_COMPONENTS,
	salmonsReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/salmons.ts';
import { SALMONS_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/salmonsSeed.ts';
import { normalizeGameConfigDoc, onlineGameOf } from '../../packages/game-config/index.ts';
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
		netcode: { type: 'string', default: 'engine' },
	},
});
if (opt.netcode !== 'engine' && opt.netcode !== 'colyseus') {
	console.error(`--netcode is engine or colyseus, not "${opt.netcode}"`);
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'salmons';

const river = salmonsRiver();
// Each room makes its own river, bots' banks included, so the bots here are bears that stand still:
// nothing hunts page A's salmon while it swims (the hunt is check:room-bots').
const authored = salmonsConfig(river);
const bots = authored.arcade.online.bots;
bots.characters = bots.characters.filter((bot) => bot.character === 'bear');
for (const character of authored.arcade.characters)
	character.brain = {
		initial: 'rest',
		states: [{ id: 'rest', behaviour: 'idle' }],
		transitions: [],
	};
authored.arcade.online.netcode = opt.netcode;
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
	JSON.stringify({ doc, componentDefs, componentDefaults: {}, config, flowV2: SALMONS_SEED_DOC }),
);
const configs = join(work, 'configs');
mkdirSync(configs);
writeFileSync(join(configs, `${KEY}.json`), JSON.stringify(config));
// The same game with 5 s rounds and 3 s between them, for page C's round over.
const SHORT = 'salmons-short';
const short = structuredClone(authored);
short.arcade.online.rules.round = {
	...short.arcade.online.rules.round,
	seconds: 5,
	nextRoundSeconds: 3,
};
short.arcade.online.bots.fillTo = 0;
writeFileSync(join(configs, `${SHORT}.json`), JSON.stringify(normalizeGameConfigDoc(short)));

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
				key: { KeyJ: 'j' }[name] ?? name,
				code: name,
				windowsVirtualKeyCode: { ArrowUp: 38, KeyJ: 74 }[name],
			}),
		flow: (expr) => page.evaluate(`(() => { const f = window.__IE_FLOW_V2__; return ${expr}; })()`),
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
const shown = (game) => game.flow('f ? f.ordered().map((c) => c.id) : []');
const zonesOf = (game) => game.zones.map((z) => [z.id, z.x, z.y, z.w, z.h]);
/** What a page made of its room's field, and what the room's seed makes here, in Node. */
const riverOf = async (page, doc) => {
	const online = (await page.state()).arcade?.online ?? {};
	const made =
		typeof online.seed === 'number' ? generatedOnlineGame(onlineGameOf(doc), online.seed) : null;
	return { seed: online.seed, field: online.field, zones: online.zones, made };
};
const variable = (game, id) => game.flow(`f?.state?.read(${JSON.stringify(id)})`);

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
	for (const [name, game] of [
		['A', a],
		['B', b],
	])
		verdict(
			`page ${name} plays the ${opt.netcode} netcode`,
			(await drawnOf(game)).netcode === opt.netcode,
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
	const riverA = await riverOf(a, config);
	const riverB = await riverOf(b, config);
	verdict(
		'pages A and B (one room) make the river of the room’s seed and draw it',
		riverA.made !== null &&
			riverA.seed === riverB.seed &&
			riverA.field === 'river' &&
			riverB.field === 'river' &&
			JSON.stringify(riverA.zones) === JSON.stringify(zonesOf(riverA.made.game)) &&
			JSON.stringify(riverB.zones) === JSON.stringify(riverA.zones),
		{ seeds: [riverA.seed, riverB.seed], fields: [riverA.field, riverB.field] },
	);
	verdict(
		'…the river the server plays: page A’s salmon started at that river’s sea',
		!!riverA.made &&
			!!ownA &&
			ownA.x === riverA.made.game.online.spawn.x &&
			ownA.y === riverA.made.game.online.spawn.y,
		{ ownA, spawn: riverA.made?.game.online.spawn },
	);
	verdict(
		'…and not the authored river',
		JSON.stringify(riverA.zones) !== JSON.stringify(zonesOf(onlineGameOf(config))),
	);
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

	// The HUD: the room's own values, bound as variables the room owns.
	const hudA = await shown(a);
	const roomA = (await a.state()).arcade?.online;
	const hud = {
		shown: hudA,
		score: await variable(a, 'score'),
		round: await variable(a, 'round'),
		secondsLeft: await variable(a, 'secondsLeft'),
		room: { round: roomA?.round, score: roomA?.scores?.[me] },
	};
	verdict(
		'page A shows the HUD over the river, with the room’s round and its own score',
		hudA.includes('salmonsHud') &&
			hudA.includes('basegame') &&
			!hudA.includes('salmonsRoundOver') &&
			hud.round === roomA?.round &&
			hud.round >= 1 &&
			hud.score === roomA?.scores?.[me] &&
			hud.secondsLeft > 0,
		hud,
	);

	// The bear's swipe, drawn on the press.
	await b.key('KeyJ', 'down');
	await b.play([{ op: 'step', frames: 3 }]);
	const pressed = (await b.state()).arcade?.online;
	await b.key('KeyJ', 'up');
	const predicted = pressed?.signals.filter((s) => s.name === 'ability' && s.payload.mine);
	const toldYet = pressed?.events.filter((e) => e.type === 'ability' && e.by === meB);
	verdict(
		'page B’s J draws the bear’s swipe on the press, before the room tells of it',
		predicted?.length === 1 &&
			predicted[0].payload.predicted === true &&
			predicted[0].payload.character === 'bear' &&
			pressed.spawned.includes('salmonsSwipe') &&
			toldYet.length === 0,
		{ predicted, spawned: pressed?.spawned, toldYet },
	);
	writeFileSync(join(out, '04-bear-swipes.png'), await b.page.screenshot());
	result.shots.push('04-bear-swipes.png');
	await settle(b, 800);
	const after = (await b.state()).arcade?.online;
	verdict(
		'…the room then tells of it, the device does not draw it twice, and the swipe is gone',
		after.events.some((e) => e.type === 'ability' && e.by === meB) &&
			after.signals.filter((s) => s.name === 'ability' && s.payload.mine).length === 1 &&
			!after.spawned.includes('salmonsSwipe'),
		{ events: after.events, spawned: after.spawned },
	);

	// A round's end and the next round, in a room of 5 s rounds.
	const c = await ready(
		await boot('c', { rooms_name: 'Cy', rooms_character: 'salmon', rooms_game: SHORT }),
	);
	await settle(c, 600);
	const riverC = await riverOf(c, normalizeGameConfigDoc(short));
	verdict(
		'page C (another room) plays another river, its own room’s',
		riverC.made !== null &&
			riverC.seed !== riverA.seed &&
			riverC.field === 'river' &&
			JSON.stringify(riverC.zones) === JSON.stringify(zonesOf(riverC.made.game)) &&
			JSON.stringify(riverC.made.made.bands) !== JSON.stringify(riverA.made?.made.bands),
		{ seeds: [riverA.seed, riverC.seed] },
	);
	writeFileSync(join(out, '05-another-river.png'), await c.page.screenshot());
	result.shots.push('05-another-river.png');
	const roundOne = await variable(c, 'round');
	let over;
	for (let i = 0; i < 40 && !over; i++) {
		await settle(c, 300);
		if ((await shown(c)).includes('salmonsRoundOver'))
			over = {
				shown: await shown(c),
				secondsLeft: await variable(c, 'secondsLeft'),
				signals: (await c.state()).arcade?.online?.signals.map((s) => s.name),
			};
	}
	verdict(
		'page C: the round ends, its flow hears it and shows the round over, counting down',
		!!over &&
			roundOne === 1 &&
			over.signals.includes('roundEnd') &&
			over.secondsLeft > 0 &&
			over.secondsLeft <= 3,
		{ roundOne, over },
	);
	if (over) writeFileSync(join(out, '06-round-over.png'), await c.page.screenshot());
	if (over) result.shots.push('06-round-over.png');
	let next;
	for (let i = 0; i < 30 && !next; i++) {
		await settle(c, 300);
		if ((await variable(c, 'round')) === 2) next = await shown(c);
	}
	verdict(
		'…and the next round hides it again',
		!!next && !next.includes('salmonsRoundOver') && next.includes('salmonsHud'),
		next,
	);

	for (const [name, game] of [
		['A', a],
		['B', b],
		['C', c],
	]) {
		const wire = await game.page.evaluate('window.__AR_WIRE__');
		const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
		verdict(`page ${name} sends the RGS nothing`, rgs.length === 0, rgs);
		const errors = await game.page.evaluate('window.__AR_ERRORS__');
		verdict(`page ${name}: no page error`, errors.length === 0, errors);
	}
	await a.page.close();
	await b.page.close();
	await c.page.close();
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
