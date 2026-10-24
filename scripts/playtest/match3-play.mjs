// Plays the match-3 sample — Game Maker's match-3 scaffold: its scene set, seed config and starter
// flow, as `scripts/current-games/fixtures.mjs` builds the `cg-match3` snapshot — in the headless
// shell, one whole round with real pointer swipes, and records what `docs/playtest/match3-sample.md`
// checks: every request the page makes to an RGS (there must be none: free play), the board after
// each move, and a screenshot at each named moment. Results are deterministic per seed.
//
//   node scripts/current-games/fixtures.mjs …       (once: writes the cg-match3 snapshot)
//   node scripts/playtest/match3-play.mjs --runtime apps/lines/build --out <dir>
//     [--snapshot .cache/current-games/fixtures/snapshots/cg-match3] [--seed 7] [--board-seed s]
//     [--max-moves 20] [--chrome <exe>]
//
// The round: boot, tap to start, one refused swap (it flies there and back and spends nothing),
// then the first legal swap on the board (`engine-mechanics` `findMoves`) until the round-won screen
// holds, then the tap that deals the next round. Output: <out>/result.json (per move: the pair, the
// board before and after, the screens; the wire; the verdicts) and the screenshots. Exit 1 when a
// verdict fails.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { openPage } from '../current-games/lib/browser.mjs';
import { pickSwap, playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		snapshot: {
			type: 'string',
			default: join(ROOT, '.cache/current-games/fixtures/snapshots/cg-match3'),
		},
		out: { type: 'string', default: join(ROOT, '.cache/match3-play') },
		seed: { type: 'string', default: '7' },
		// A deal the first-legal-swap player wins in 13 moves (with the seed config's 20 moves and
		// 1500 goal); any other seed may end on the round-lost screen instead, which is also a pass.
		'board-seed': { type: 'string', default: 'sample-8' },
		'max-moves': { type: 'string', default: '20' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'match3-sample';

// Every request the page makes (fetch, XHR, beacon), recorded before the app's own code runs.
const WIRE_HOOK = `(() => {
	const log = (window.__M3_WIRE__ = []);
	const fetch = window.fetch.bind(window);
	window.fetch = (input, init) => {
		log.push(typeof input === 'string' ? input : input.url ?? String(input));
		return fetch(input, init);
	};
	const open = XMLHttpRequest.prototype.open;
	XMLHttpRequest.prototype.open = function (method, url, ...rest) {
		log.push(String(url));
		return open.call(this, method, url, ...rest);
	};
	const beacon = navigator.sendBeacon?.bind(navigator);
	if (beacon)
		navigator.sendBeacon = (url, data) => {
			log.push(String(url));
			return beacon(url, data);
		};
})();`;

const work = mkdtempSync(join(tmpdir(), 'match3-play-'));
const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'lines',
	name: 'Match-3 sample',
	projectKey: KEY,
});
const server = await startTestServer(tree, { SEED: '7' });
const snap = await serveSnapshot({
	dir: resolve(opt.snapshot),
	name: 'Match-3 sample',
	snapshotId: 'sample',
	assetBase: `${server.origin}/${KEY}/`,
});
const page = await openPage(headlessShell(opt.chrome), join(work, 'profile'));
await page.page('Page.addScriptToEvaluateOnNewDocument', { source: WIRE_HOOK });

const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'match3-play',
	editorDocBase: snap.origin,
	rgs_url: `${server.origin}/api/${KEY}/authoring`.replace(/^http:\/\//, ''),
	sessionID: `m3-${opt.seed}`,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
	m3seed: opt['board-seed'],
});

/** A round-over screen is up: the move that ended the round waits on its tap. */
const ROUND_OVER = {
	anyOf: [
		{ screen: 'roundWon', inSet: true },
		{ screen: 'roundLost', inSet: true },
	],
};

const result = { seed: opt.seed, moves: [], shots: [], verdicts: [] };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail ? { detail } : {}) });
const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
const state = () => api('state()');
let shots = 0;
const shot = async (label) => {
	await api(`step(1, { draw: 'last' })`);
	const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
	writeFileSync(join(out, file), await page.screenshot());
	result.shots.push(file);
};
const play = (steps) =>
	playScenario({ steps }, { page, draw: 'last', capture: async (screen) => shot(screen) });

try {
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	await play([
		{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 },
		{ op: 'tapToStart' },
		{ op: 'waitFor', until: { playerIn: true, boardBusy: false } },
		{ op: 'step', frames: 30 },
		{ op: 'capture', screen: 'board' },
	]);
	const boot = await state();
	verdict(
		'the board is dealt and the HUD is up',
		!!boot.board && boot.screens.includes('match3Hud'),
	);

	const before = (await state()).board;
	await play([
		{ op: 'swap', legal: false },
		{ op: 'step', frames: 10 },
		{ op: 'capture', screen: 'refused' },
	]);
	const refused = (await state()).board;
	verdict(
		'a refused swap leaves the board as it was',
		JSON.stringify(refused.cells) === JSON.stringify(before.cells),
	);

	let ended;
	for (let n = 0; n < Number(opt['max-moves']) && !ended; n++) {
		const was = (await state()).board;
		const pair = pickSwap(was.cells, true, was.minRun);
		if (!pair) {
			verdict('the board always has a legal swap', false, was.cells);
			break;
		}
		await play([
			{ op: 'swap', from: pair.from, to: pair.to, orUntil: ROUND_OVER },
			{ op: 'step', frames: 10 },
		]);
		const now = await state();
		ended = ['roundWon', 'roundLost'].find((screen) => now.screens.includes(screen));
		result.moves.push({ pair, before: was.cells, after: now.board.cells, screens: now.screens });
		if (n === 0) await shot('first-swap');
	}
	result.outcome = ended ?? 'none';
	verdict('the round ends on its goal or its last move, and its screen holds', !!ended);
	verdict('the board takes no input while it holds', !!(await state()).board?.busy);
	await shot(ended ?? 'no-end');
	await play([
		{ op: 'space' },
		{ op: 'waitFor', until: { boardBusy: false } },
		{ op: 'step', frames: 30 },
		{ op: 'capture', screen: 'new-round' },
	]);
	const next = await state();
	verdict(
		'the tap deals a new round',
		!next.screens.includes('roundWon') && !next.screens.includes('roundLost') && !next.board.busy,
	);

	result.wire = await page.evaluate('window.__M3_WIRE__');
	const rgs = result.wire.filter(
		(url) => /\/api\//.test(url) && !/\/api\/editor\/runtime/.test(url),
	);
	verdict('free play sends the RGS nothing', rgs.length === 0, rgs);
	result.errors = (await state()).errors;
	verdict('no page errors', result.errors === 0);
} finally {
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await page.close();
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
console.log(
	`[match3-play] ${result.outcome} after ${result.moves.length} move(s), ${result.shots.length} screenshot(s) → ${out}`,
);
process.exit(result.verdicts.every((v) => v.ok) ? 0 : 1);
