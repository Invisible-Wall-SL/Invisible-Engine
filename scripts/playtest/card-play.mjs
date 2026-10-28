// Plays the card sample (card-games.md C3) on the shared runtime, in the headless shell: Game
// Maker's card scene set, its seed config (`card.rules.json`, 24 cards and two decks), its starter
// flow and the placeholder card frame, baked into one snapshot. It passes the deck pick, drags a
// card off any target (it snaps back) and onto the board (it is played), ends the turn and waits for
// the device's, reading the table through the determinism probe (`state().cards`). Screenshots and
// `result.json` go to --out.
//
//   pnpm --filter 'lines^...' build && pnpm --filter lines build
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/card-play.mjs --runtime apps/lines/build --out <dir> [--chrome <exe>]
//
// Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import {
	CARD_FRAME_PLACEHOLDER_DEF,
	cardReferenceLayout,
} from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import { CARD_DRIVEN_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/cardsSeed.ts';
import { normalizeGameConfigDoc } from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/card-play') },
		seed: { type: 'string', default: '7' },
		'card-seed': { type: 'string', default: 'sample' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'card-sample';

const config = normalizeGameConfigDoc(
	JSON.parse(
		readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/card.rules.json'), 'utf8'),
	),
);
const doc = cardReferenceLayout();
const library = Object.fromEntries(
	[...BUILTIN_COMPONENTS, CARD_FRAME_PLACEHOLDER_DEF].map((d) => [d.id, d]),
);
const componentDefs = await resolveComponentClosure(
	doc.scenes.flatMap((scene) => scene.nodes),
	(id) => library[id],
);
// The frame is spawned at runtime, so the publish seeds it from the card library
// (`cardGameComponentIds`); the bake here does the same.
componentDefs[CARD_FRAME_PLACEHOLDER_DEF.id] ??= CARD_FRAME_PLACEHOLDER_DEF;

const result = { shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
verdict('the bake ships the card frame', CARD_FRAME_PLACEHOLDER_DEF.id in componentDefs);

const work = mkdtempSync(join(tmpdir(), 'card-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({
		doc,
		componentDefs,
		componentDefaults: {},
		config,
		flowV2: CARD_DRIVEN_SEED_DOC,
	}),
);

// Every request the page makes and every page error, recorded before the app's own code runs.
const HOOK = `(() => {
	const wire = (window.__CD_WIRE__ = []);
	const errors = (window.__CD_ERRORS__ = []);
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
	protocol: 'lines',
	name: 'Card sample',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: opt.seed });
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Card sample',
	snapshotId: 'sample',
	assetBase: `${server.origin}/${KEY}/`,
});
const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'card-play',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `card-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
	cdseed: opt['card-seed'],
	flowlog: '1',
});

/** Open the game on a fresh page, past the deck pick, into the match. */
async function boot(profile) {
	const page = await openPage(headlessShell(opt.chrome), join(work, profile));
	await page.page('Emulation.setDeviceMetricsOverride', {
		width: 1920,
		height: 1080,
		deviceScaleFactor: 1,
		mobile: false,
	});
	await page.page('Page.addScriptToEvaluateOnNewDocument', { source: HOOK });
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
	const state = () => api('state()');
	const play = (steps) => playScenario({ steps }, { page, draw: 'last' });
	await play([
		{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 },
		{ op: 'tapToStart' },
		{ op: 'step', frames: 30 },
	]);
	// The loading screen and the deck pick are taps to continue: Space takes each until the match
	// is dealt.
	for (let i = 0; i < 20 && !((await state()).cards?.turn > 0); i++)
		await play([{ op: 'space' }, { op: 'step', frames: 30 }]);
	return { page, api, state, play };
}

/** Where a point of the 1920 × 1080 design lands on the page: the canvas fits the viewport. */
async function toPage(page, x, y) {
	const box = await page.evaluate(
		'(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()',
	);
	const s = Math.min(box.w / 1920, box.h / 1080);
	return { x: box.x + (box.w - 1920 * s) / 2 + x * s, y: box.y + (box.h - 1080 * s) / 2 + y * s };
}

const ZONE_Y = { hand: 950, board: 640, enemyBoard: 360, enemyHand: 90 };

try {
	const game = await boot('profile');
	let shots = 0;
	const shot = async (label) => {
		await game.api(`step(1, { draw: 'last' })`);
		const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
		writeFileSync(join(out, file), await game.page.screenshot());
		result.shots.push(file);
	};
	const mouse = (type, at) =>
		game.page.page('Input.dispatchMouseEvent', {
			type,
			x: at.x,
			y: at.y,
			button: 'left',
			buttons: type === 'mouseReleased' ? 0 : 1,
			clickCount: 1,
		});
	/** Drag from one design point to another, a frame per move. */
	const drag = async (from, to) => {
		const a = await toPage(game.page, from.x, from.y);
		const b = await toPage(game.page, to.x, to.y);
		await mouse('mousePressed', a);
		for (let i = 1; i <= 12; i++) {
			await mouse('mouseMoved', {
				x: a.x + ((b.x - a.x) * i) / 12,
				y: a.y + ((b.y - a.y) * i) / 12,
			});
			await game.play([{ op: 'step', frames: 1 }]);
		}
		await mouse('mouseReleased', b);
		await game.play([{ op: 'step', frames: 90 }]);
	};
	const zone = (s, z) => s.cards?.cards.filter((c) => c.zone === z) ?? [];

	const start = await game.state();
	verdict(
		'the match starts on the table with both hands dealt',
		!!start.cards && start.screens.includes('basegame') && zone(start, 'hand').length >= 3,
		{ screens: start.screens, cards: start.cards },
	);
	await shot('table');

	// Wait for the player's turn (the device may go first).
	for (let i = 0; i < 40 && !(await game.state()).cards?.mine; i++)
		await game.play([{ op: 'step', frames: 30 }]);
	const mine = await game.state();
	verdict('the player gets the turn', mine.cards?.mine === true, mine.cards);

	// A drop off the table snaps back: the hand is unchanged.
	const hand = zone(mine, 'hand');
	const first = hand[0];
	await drag({ x: 960 + first.x, y: ZONE_Y.hand }, { x: 1800, y: 80 });
	const after = await game.state();
	verdict(
		'a drop off any target snaps the card back to the hand',
		zone(after, 'hand').length === hand.length &&
			zone(after, 'board').length === zone(mine, 'board').length,
		zone(after, 'hand'),
	);

	// Play every card the board takes: drag each hand card onto the board, the cheapest first.
	let played = 0;
	for (const card of [...zone(after, 'hand')]) {
		const now = zone(await game.state(), 'hand').find((c) => c.uid === card.uid);
		if (!now) continue;
		const boardBefore = zone(await game.state(), 'board').length;
		await drag({ x: 960 + now.x, y: ZONE_Y.hand }, { x: 960, y: ZONE_Y.board });
		const s = await game.state();
		if (!zone(s, 'hand').some((c) => c.uid === card.uid)) played++;
		if (zone(s, 'board').length > boardBefore) break;
	}
	await shot('played');
	verdict('dragging a playable card onto the board plays it', played >= 1, played);

	// End the turn with the button; the device plays its turn.
	const end = await toPage(game.page, 1760, 560);
	await mouse('mousePressed', end);
	await mouse('mouseReleased', end);
	await game.play([{ op: 'step', frames: 30 }]);
	await mouse('mousePressed', end);
	await mouse('mouseReleased', end);
	for (let i = 0; i < 60 && !(await game.state()).cards?.mine; i++)
		await game.play([{ op: 'step', frames: 30 }]);
	const back = await game.state();
	verdict(
		'End Turn passes the turn and the device plays it back',
		back.cards?.mine && back.cards.turn > mine.cards.turn,
		back.cards,
	);
	await shot('device-played');

	const wire = await game.page.evaluate('window.__CD_WIRE__');
	const rgs = wire.filter((url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url));
	verdict('free play sends the RGS nothing', rgs.length === 0, rgs);
	const errors = await game.page.evaluate('window.__CD_ERRORS__');
	verdict('no page error', errors.length === 0, errors);
	await game.page.close();
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
const failed = result.verdicts.filter((v) => !v.ok).length;
console.log(failed ? `\ncard play: ${failed} FAILED` : `\ncard play: OK → ${out}`);
// The headless shell's socket can hold the loop open: leave explicitly.
process.exit(failed ? 1 : 0);
