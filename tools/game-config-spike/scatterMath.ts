/**
 * SCATTER MATH VERIFIER — measure what a scatter-pays strip set actually pays, cascade included.
 *
 *   pnpm --filter game-config-spike run scattermath                       # the committed scatter defaults
 *   pnpm --filter game-config-spike run scattermath -- --config path/to/doc.json --spins 200000
 *   pnpm --filter game-config-spike run scattermath -- --no-cascade       # score the dealt board only
 *   pnpm --filter game-config-spike run scattermath -- --min-count 15     # try a threshold before authoring it
 *
 * The sibling of `waysMath`, and the same posture: it does not author math, it MEASURES a doc that
 * already exists. Everything is read from the doc under test — strips, paytable, board shape, win
 * model — so it verifies any project's config with nothing hardcoded per game.
 *
 * WHAT IT ADDS OVER THE WAYS TOOL, and why it had to.
 *
 * A scatter game pays by COUNT ANYWHERE, so its threshold has to be read against the BOARD SIZE:
 * `minCount` is only a threshold if it sits meaningfully above the average number of a symbol on a
 * board. Below that average, paying becomes the default state and NOT paying is the rare event —
 * which is a different game from the one the config appears to describe, and is invisible in every
 * number a per-line tool would print.
 *
 * So the headline here is not the RTP. It is `expected` vs `minCount` per symbol, and the share of
 * boards that clear it. The RTP follows from those.
 *
 * And a scatter game CASCADES, so its return is chain-dependent: the dealt board is only the first
 * of several, and scoring one board understates the game by whatever the chain multiplies. The
 * simulation plays each spin to the end of its chain, refilling from the same strips, and reports
 * how often the chain hits the mock's 12-step cap — a chain that keeps hitting the cap is a game
 * that never settles.
 *
 * WHAT THE NUMBER IS NOT. The client never computes wins; the RGS does, and in production it is
 * external. An RTP printed here is the return implied BY THESE STRIPS under this paytable. It is a
 * check against a math export, never a substitute for one.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveWinModel } from 'game-config';

import { buildRules, dealFromStrips, makeRng, scatterCount, type Doc } from './waysEvaluator';
import {
	CASCADE_MAX_STEPS,
	evaluateScatterPaysDoc,
	minCountOf,
	playSpin,
	scatterPayingSymbols,
} from './scatterEvaluator';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? undefined : argv[i + 1];
};
const has = (name: string) => argv.includes(`--${name}`);

const ROOT = resolve(import.meta.dirname, '../..');
const gameType = flag('game-type') ?? 'scatter';
const configFlag = flag('config');
const configPath = configFlag
	? resolve(process.cwd(), configFlag)
	: resolve(ROOT, `apps/launcher-api/src/lib/data/gameConfig/${gameType}.json`);
const spins = Number(flag('spins') ?? 200_000);
const mode = flag('mode') ?? 'basegame';
const cascade = !has('no-cascade');

const doc = JSON.parse(readFileSync(configPath, 'utf8')) as Doc;
const rules = buildRules(doc);
const strips = doc.paddingReels?.[mode];
if (!strips?.length) throw new Error(`no "${mode}" strips in ${configPath}`);

/** `--min-count` overrides the doc, so a threshold can be TRIED before it is authored. */
const declaredMinCount = minCountOf(doc);
const minCount = Number(flag('min-count') ?? declaredMinCount);

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;
const cells = doc.numRows.slice(0, doc.numReels).reduce((sum, r) => sum + Math.max(1, r), 0);

console.log(`scatter math verifier — ${configPath.replace(ROOT, '.')}`);
console.log(
	`  win model ${resolveWinModel(doc).type} · ${doc.numReels}x${doc.numRows.join('/')} · ` +
		`${cells} cells · minCount ${minCount}${minCount === declaredMinCount ? '' : ` (doc says ${declaredMinCount})`} · ` +
		`cascade ${cascade ? 'ON' : 'OFF'} · mode ${mode} · ${spins.toLocaleString()} spins\n`,
);

const model = resolveWinModel(doc).type;
if (model !== 'scatter') {
	console.log(`  Win model is "${model}", not "scatter" — no RTP printed.`);
	console.log('  This tool prices a paytable against the TOTAL bet and pays on a count ANYWHERE.');
	console.log(`  Scoring a ${model} doc that way would read like a measurement of a game nobody`);
	console.log('  is playing. Run `waysmath` for a ways doc.');
	process.exit(0);
}

// --- The threshold, read against the board — the headline ----------------------------------
const paying = scatterPayingSymbols(rules);
const stripShare = (symbol: string): number => {
	let hits = 0;
	let total = 0;
	for (const reel of strips) {
		for (const c of reel) {
			total += 1;
			if (c.name === symbol || rules.wilds.includes(c.name)) hits += 1;
		}
	}
	return total ? hits / total : 0;
};

console.log(`is minCount ${minCount} a threshold, on ${cells} cells?`);
let aboveThreshold = 0;
for (const symbol of paying) {
	const expected = stripShare(symbol) * cells;
	const flagged = expected >= minCount;
	if (flagged) aboveThreshold += 1;
	console.log(
		`  ${symbol.padEnd(3)} expected ${expected.toFixed(1).padStart(5)} per board  ` +
			`${flagged ? '<-- ABOVE the threshold: this symbol pays on a typical board' : ''}`,
	);
}
console.log('');
if (aboveThreshold > 0) {
	console.log(
		`  [!] ${aboveThreshold} of ${paying.length} symbols average AT OR ABOVE minCount ${minCount}.`,
	);
	console.log('      For those, paying is the default state and not paying is the rare event —');
	console.log('      the mechanic is inverted. A threshold has to sit meaningfully above the');
	console.log(
		`      average count (${cells} cells / ${paying.length} paying symbols ≈ ` +
			`${(cells / Math.max(1, paying.length)).toFixed(1)} each).`,
	);
	console.log('      Raise minCount, put more symbols in play, or shrink the board.');
}

// --- The measurement -----------------------------------------------------------------------
const rand = makeRng(Number(flag('seed') ?? 1));
const betPerSpin = 1; // a scatter multiplier applies to the WHOLE bet (payoutDivisor 1)
let paid = 0;
let hits = 0;
let best = 0;
let triggers = 0;
let totalSteps = 0;
let cappedChains = 0;
let dealtPayingSymbols = 0;
const contribution: Record<string, number> = {};
const clears: Record<string, number> = {};

for (let i = 0; i < spins; i++) {
	const board = dealFromStrips(strips, doc.numRows, rand);
	const result = playSpin(board, strips, rules, minCount, betPerSpin, rand, cascade);

	paid += result.pay;
	if (result.pay > 0) hits += 1;
	if (result.pay > best) best = result.pay;
	totalSteps += result.steps;
	if (result.capped) cappedChains += 1;
	dealtPayingSymbols += result.dealtWins.length;
	for (const win of result.dealtWins) clears[win.symbol] = (clears[win.symbol] ?? 0) + 1;
	// Contribution is attributed on the DEALT board: a chain's later boards are a consequence of it,
	// and splitting them per symbol would credit refills rather than the strips under test.
	for (const win of evaluateScatterPaysDoc(board, rules, minCount, betPerSpin)) {
		contribution[win.symbol] = (contribution[win.symbol] ?? 0) + win.pay;
	}
	if (rules.scatters.length && scatterCount(board, rules) >= 3) triggers += 1;
}

console.log('measured over the strips:');
console.log(`  RTP (symbol pays only)     ${pct(paid / spins)}`);
console.log(`  hit rate                   ${pct(hits / spins)}`);
console.log(`  best single spin           ${best.toFixed(2)}x bet`);
console.log(`  symbols paying per board   ${(dealtPayingSymbols / spins).toFixed(2)} on the deal`);
if (cascade) {
	console.log(`  average chain              ${(totalSteps / spins).toFixed(2)} tumbles per spin`);
	const cappedRate = cappedChains / spins;
	console.log(
		`  hit the ${CASCADE_MAX_STEPS}-step cap        ${pct(cappedRate)}` +
			(cappedRate > 0.01
				? '  <-- the board is still paying when the chain is cut off; it never settles'
				: ''),
	);
}
if (rules.scatters.length) {
	const rate = triggers / spins;
	console.log(
		`  3+ ${rules.scatters.join('/')} boards             ${pct(rate)}` +
			(rate > 0 ? `  (1 in ${Math.round(1 / rate).toLocaleString()})` : ''),
	);
}

if (paying.length) {
	console.log('\n  share of DEALT boards each symbol pays on:');
	for (const symbol of paying) {
		console.log(`    ${symbol.padEnd(3)} ${pct((clears[symbol] ?? 0) / spins).padStart(7)}`);
	}
}

if (paid > 0) {
	console.log('\n  contribution by symbol (dealt board):');
	const dealtTotal = Object.values(contribution).reduce((s, v) => s + v, 0);
	for (const [sym, amount] of Object.entries(contribution).sort((a, b) => b[1] - a[1])) {
		console.log(
			`    ${sym.padEnd(3)} ${pct(amount / dealtTotal).padStart(7)} of dealt pays  (${pct(amount / spins)} of bet)`,
		);
	}
}

// --- What the number is NOT ----------------------------------------------------------------
console.log('\nscope:');
console.log('  Base-game symbol pays only. The free-spin feature is NOT simulated — its award');
console.log('  structure is not declared in the config, so no TOTAL game RTP is computed here.');
console.log('  The multiplier COLLECT is not simulated either: which symbol carries a multiplier,');
console.log('  and what values it takes, is not in the config — the test server invents both.');
if (doc.rtp !== undefined) {
	console.log(
		`  The doc declares rtp ${doc.rtp}. That is a DECLARED TARGET, not a measurement, and`,
	);
	console.log('  this tool does not reconcile the two — a real export is what makes them agree.');
}
console.log('  The client does not compute wins; the RGS does, and in production it is external.');
