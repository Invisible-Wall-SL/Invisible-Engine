// Plays the RGS match-3 sample: Game Maker's RGS-decided match-3 scaffold (the RGS scene set, the
// `match3.rgs` seed config and the RGS starter flow) on the shared runtime, against the Invisible
// Test Server's `match3` mock (`docs/reference/match3-wire.md`). One whole round with real pointer
// swipes, plus a reload mid-round, and records what `docs/playtest/match3-sample.md` S7 checks: the
// requests the page posts and what the mock answered, the board and moves after each swap, the
// balance at each step, and a screenshot at each named moment.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/match3-rgs-play.mjs --runtime apps/lines/build --out <dir>
//     [--seed 7] [--reload-after 3] [--chrome <exe>]
//
// It builds its own snapshot (as `scripts/current-games/fixtures.mjs` builds `cg-match3`, from the
// same three seeds) so the harness is not touched. Exit 1 when a verdict fails.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { BUILTIN_COMPONENTS } from '../../packages/engine-layout/src/lib/builtinComponents.ts';
import { resolveComponentClosure } from '../../packages/engine-layout/src/lib/collectComponentIds.ts';
import { match3RgsReferenceLayout } from '../../packages/engine-layout/src/lib/referenceLayouts/index.ts';
import { MATCH3_RGS_DRIVEN_SEED_DOC } from '../../packages/engine-flow-v2/src/reference/match3RgsSeed.ts';
import {
	betModeCardIds,
	match3MockInputs,
	normalizeGameConfigDoc,
} from '../../packages/game-config/index.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { pickSwap, playScenario } from '../current-games/lib/play.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		runtime: { type: 'string', default: join(ROOT, 'apps/lines/build') },
		out: { type: 'string', default: join(ROOT, '.cache/match3-rgs-play') },
		seed: { type: 'string', default: '7' },
		'reload-after': { type: 'string', default: '3' },
		chrome: { type: 'string' },
	},
});
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const KEY = 'match3-rgs-sample';
const SESSION = `m3rgs-${opt.seed}`;

const config = normalizeGameConfigDoc(
	JSON.parse(
		readFileSync(join(ROOT, 'apps/launcher-api/src/lib/data/gameConfig/match3.rgs.json'), 'utf8'),
	),
);
const doc = match3RgsReferenceLayout();
const builtins = Object.fromEntries(BUILTIN_COMPONENTS.map((def) => [def.id, def]));

const work = mkdtempSync(join(tmpdir(), 'match3-rgs-play-'));
const snapshot = join(work, 'snapshot');
mkdirSync(join(snapshot, 'deploy'), { recursive: true });
writeFileSync(
	join(snapshot, 'runtime.json'),
	JSON.stringify({
		doc,
		componentDefs: resolveComponentClosure(
			doc.scenes.flatMap((scene) => scene.nodes),
			(id) => builtins[id],
			{ extraSeedIds: betModeCardIds(config) },
		),
		componentDefaults: {},
		config,
		flowV2: MATCH3_RGS_DRIVEN_SEED_DOC,
	}),
);

// Every engine POST the page makes, with its body and the answer's events, recorded before the
// app's own code runs.
const WIRE_HOOK = `(() => {
	const log = (window.__M3_WIRE__ = []);
	const fetch = window.fetch.bind(window);
	window.fetch = async (input, init) => {
		const url = typeof input === 'string' ? input : input.url ?? String(input);
		const answer = await fetch(input, init);
		if (/\\/rgs\\/engine/.test(url)) {
			const entry = { url, body: init?.body ? JSON.parse(init.body) : [] };
			log.push(entry);
			answer.clone().json().then((json) => (entry.events = json.events ?? [], entry.error = json.error)).catch(() => {});
		}
		return answer;
	};
})();`;

const tree = testServerTree(join(work, 'tree'), resolve(opt.runtime), KEY, {
	protocol: 'match3',
	name: 'Match-3 RGS sample',
	projectKey: KEY,
	grid: {
		reels: config.numReels,
		rows: config.numRows[0],
		paylines: [],
		match3: match3MockInputs(config),
	},
});
const server = await startTestServer(tree, { SEED: opt.seed });
const snap = await serveSnapshot({
	dir: snapshot,
	name: 'Match-3 RGS sample',
	snapshotId: 'sample',
	assetBase: `${server.origin}/${KEY}/`,
});
const page = await openPage(headlessShell(opt.chrome), join(work, 'profile'));
await page.page('Page.addScriptToEvaluateOnNewDocument', { source: WIRE_HOOK });

const RGS = `${server.origin}/api/${KEY}/authoring`;
const params = new URLSearchParams({
	runtime: '1',
	project: KEY,
	k: 'match3-rgs-play',
	editorDocBase: snap.origin,
	rgs_url: RGS.replace(/^http:\/\//, ''),
	sessionID: SESSION,
	lang: 'en',
	currency: 'USD',
	device: 'desktop',
	ie_determinism: opt.seed,
});

const result = { seed: opt.seed, moves: [], shots: [], verdicts: [], balances: {} };
const verdict = (name, ok, detail) =>
	result.verdicts.push({ name, ok, ...(detail !== undefined ? { detail } : {}) });
const api = (call) => page.evaluate(`window.__IE_DETERMINISM__.${call}`);
const state = () => api('state()');
const wire = () => page.evaluate('window.__M3_WIRE__');
const balance = async () =>
	(await (await fetch(`${RGS}/state?sid=${encodeURIComponent(SESSION)}`)).json()).balance;
let shots = 0;
const shot = async (label) => {
	await api(`step(1, { draw: 'last' })`);
	const file = `${String(++shots).padStart(2, '0')}-${label}.png`;
	writeFileSync(join(out, file), await page.screenshot());
	result.shots.push(file);
};
const play = (steps) =>
	playScenario({ steps }, { page, draw: 'last', capture: async (screen) => shot(screen) });
/** Step frames until `test(state)` holds; the state, or null. */
const stepUntil = async (test, maxFrames = 3600) => {
	for (let ran = 0; ran <= maxFrames; ran += 10) {
		const s = await state();
		if (test(s)) return s;
		await api(`step(10, { draw: 'last' })`);
	}
	return null;
};
const boot = async () => {
	await page.navigate(`${server.origin}/${KEY}/?${params}`);
	for (let i = 0; i < 300; i++) {
		if (await page.evaluate('!!window.__IE_DETERMINISM__').catch(() => false)) break;
		await new Promise((r) => setTimeout(r, 100));
	}
	await play([
		{ op: 'waitFor', until: { loaded: true }, maxFrames: 7200 },
		{ op: 'tapToStart' },
		{ op: 'waitFor', until: { playerIn: true } },
		{ op: 'step', frames: 30 },
	]);
};
const actionsOf = (entries) => entries.map((e) => e.body.map((a) => a.action).join('+'));

try {
	await boot();
	const booted = await state();
	result.balances.boot = await balance();
	verdict(
		'boots on the board and the slot HUD, with no round open',
		booted.screens.includes('basegame') &&
			booted.screens.includes('hudBar') &&
			booted.board?.roundOpen === false,
		booted.screens,
	);
	await shot('boot');

	// S7.1 — the bet deals the board.
	await play([{ op: 'space' }]);
	const opened = await stepUntil((s) => s.board?.roundOpen && !s.board.busy);
	const afterBet = await wire();
	const betAnswer = afterBet.find((e) => e.body[0]?.action === 'bet');
	const stake = betAnswer?.events?.find((e) => e.event === 'bet')?.context?.total;
	result.balances.bet = await balance();
	verdict('Spin places the bet (bet + play)', Boolean(betAnswer) && stake > 0, actionsOf(afterBet));
	verdict(
		"the server's board lands with the config's moves",
		Boolean(opened) && opened.board.movesLeft === config.match3.moves,
		opened?.board,
	);
	verdict(
		'the bet debits the stake and nothing else',
		result.balances.bet === result.balances.boot - stake,
		result.balances,
	);
	await shot('board');

	// S7.2 — a swap the board cannot match is refused here, without a request.
	const postsBefore = (await wire()).length;
	const cellsBefore = JSON.stringify(opened?.board.cells);
	await play([
		{ op: 'swap', legal: false },
		{ op: 'step', frames: 10 },
	]);
	const refused = await state();
	verdict(
		'a refused swap posts nothing and changes nothing',
		(await wire()).length === postsBefore &&
			JSON.stringify(refused.board.cells) === cellsBefore &&
			refused.board.movesLeft === opened?.board.movesLeft,
	);

	// S7.3 — legal swaps, each one `move`; a reload mid-round resumes on the same board.
	let reloaded = false;
	let ended = false;
	for (let n = 0; n < 40 && !ended; n++) {
		const was = await state();
		const pair = pickSwap(was.board.cells, true, was.board.minRun);
		if (!pair) {
			verdict('the board always has a legal swap', false, was.board.cells);
			break;
		}
		await play([{ op: 'swap', from: pair.from, to: pair.to }]);
		const now = await stepUntil((s) => !s.board.busy);
		ended = !now.board.roundOpen;
		result.moves.push({
			pair,
			movesLeft: now.board.movesLeft,
			before: was.board.cells,
			after: now.board.cells,
		});
		if (n === 0) await shot('first-move');
		if (!reloaded && !ended && n + 1 === Number(opt['reload-after'])) {
			reloaded = true;
			const mid = JSON.stringify(now.board.cells);
			const midMoves = now.board.movesLeft;
			await boot();
			const resumed = await stepUntil((s) => s.board?.roundOpen && !s.board.busy);
			verdict(
				'a reload mid-round resumes on the same board and moves',
				Boolean(resumed) &&
					JSON.stringify(resumed.board.cells) === mid &&
					resumed.board.movesLeft === midMoves,
				{ mid: JSON.parse(mid), resumed: resumed?.board },
			);
			await shot('resumed');
		}
	}
	verdict('the server ends the round once its moves are used', ended);
	verdict(
		'each accepted swap spends one move',
		result.moves.every((m, i, all) => i === 0 || m.movesLeft === all[i - 1].movesLeft - 1),
		result.moves.map((m) => m.movesLeft),
	);
	await stepUntil((s) => s.idle && !s.board.busy, 7200);
	await api(`step(120, { draw: 'last' })`);
	await shot('round-end');

	// S7.4 — collected once; the balance moved only by the round's total.
	const all = await wire();
	result.wire = all.map((e) => ({
		url: e.url,
		actions: e.body.map((a) => a.action),
		error: e.error,
	}));
	const end = all.flatMap((e) => e.events ?? []).find((e) => e.event === 'match3End');
	result.balances.end = await balance();
	const moves = all.filter((e) => e.body[0]?.action === 'move' && !e.error);
	verdict(
		'every swap posted one move under the round',
		moves.length >= result.moves.length && moves.every((e) => /[?&]gid=/.test(e.url)),
		moves.length,
	);
	verdict(
		'the round is collected exactly once',
		all.filter((e) => e.body.some((a) => a.action === 'collect')).length === 1,
		actionsOf(all),
	);
	verdict(
		"the balance changes only by the round's total",
		Boolean(end) && result.balances.end === result.balances.boot - stake + end.context.totalWin,
		{ ...result.balances, stake, totalWin: end?.context.totalWin },
	);
	result.errors = (await state()).errors;
	verdict('no page errors', result.errors === 0);
} finally {
	result.rawWire ??= await wire().catch(() => null);
	writeFileSync(join(out, 'result.json'), JSON.stringify(result, null, '\t'));
	await page.close();
	await server.close?.();
	await snap.close?.();
	rmSync(work, { recursive: true, force: true });
}

for (const v of result.verdicts) console.log(`  ${v.ok ? 'PASS' : 'FAIL'}  ${v.name}`);
console.log(
	`[match3-rgs-play] ${result.moves.length} move(s), ${result.shots.length} screenshot(s) → ${out}`,
);
process.exit(result.verdicts.every((v) => v.ok) ? 0 : 1);
