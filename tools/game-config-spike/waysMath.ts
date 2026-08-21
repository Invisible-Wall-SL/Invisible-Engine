/**
 * WAYS MATH VERIFIER — measure what a strip set actually pays.
 *
 *   pnpm --filter game-config-spike run waysmath      # the committed ways defaults
 *   pnpm --filter game-config-spike run waysmath -- --game-type lines     # the lines strips, for contrast
 *   pnpm --filter game-config-spike run waysmath -- --config path/to/doc.json --spins 500000 --seed 7
 *
 * WHY THIS EXISTS, and what it deliberately does NOT do.
 *
 * `apps/ways` ships COSMETIC padding reels — every symbol equally often — and says so in its
 * `config.ts`: "inventing those here would be fabricating game math". `apps/lines` ships REAL
 * 217-cell strips that came from the math SDK export, where the frequencies ARE the hit rate. A
 * real ways export has to come from a math engine; it is not something to hand-tune in a client
 * repo.
 *
 * So this tool does not author math. It MEASURES a strip set that already exists — the thing to run
 * the day an export arrives, to check the numbers are what the provider says they are, and the
 * thing that says in one line, today, that the ways strips are a placeholder.
 *
 * Everything it reports is derived from the doc under test: its strips, paytable, board shape and
 * win model. Nothing is hardcoded per game, so it verifies any project's Game Config doc.
 *
 * WHAT THE NUMBER MEANS. The client never computes wins — the RGS does, and in production it is
 * external (Play4Fun). An RTP printed here is the return implied BY THESE STRIPS under this
 * paytable. It is not a claim about what a live game pays, and it does not become one by being
 * printed. It is a check against a math export, never a substitute for one.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { resolveWinModel } from 'game-config';

import {
	buildRules,
	dealFromStrips,
	evaluateWaysDoc,
	makeRng,
	scatterCount,
	type Doc,
} from './waysEvaluator';

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
	const i = argv.indexOf(`--${name}`);
	return i === -1 ? undefined : argv[i + 1];
};

const ROOT = resolve(import.meta.dirname, '../..');
const gameType = flag('game-type') ?? 'ways';
const configFlag = flag('config');
const configPath = configFlag
	? resolve(process.cwd(), configFlag)
	: resolve(ROOT, `apps/launcher-api/src/lib/data/gameConfig/${gameType}.json`);
const spins = Number(flag('spins') ?? 200_000);
const mode = flag('mode') ?? 'basegame';

const doc = JSON.parse(readFileSync(configPath, 'utf8')) as Doc;
const rules = buildRules(doc);
const strips = doc.paddingReels?.[mode];
if (!strips?.length) throw new Error(`no "${mode}" strips in ${configPath}`);

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

console.log(`ways math verifier — ${configPath.replace(ROOT, '.')}`);
console.log(
	`  win model ${resolveWinModel(doc).type} · ${doc.numReels}x${doc.numRows.join('/')} · ` +
		`${rules.waysCount} ways · mode ${mode} · ${spins.toLocaleString()} spins\n`,
);

// --- Strip shape: the diagnostic that makes a placeholder obvious at a glance ---------------
console.log('strip frequencies (per reel):');
let uniform = true;
for (const [i, reel] of strips.entries()) {
	const counts: Record<string, number> = {};
	for (const c of reel) counts[c.name] = (counts[c.name] ?? 0) + 1;
	if (new Set(Object.values(counts)).size > 1) uniform = false;
	const shown = Object.keys(counts)
		.sort()
		.map((k) => `${k}:${counts[k]}`)
		.join(' ');
	console.log(`  reel ${i}  len ${String(reel.length).padStart(4)}  ${shown}`);
}

const missingWild = rules.wilds.filter(
	(w) => !strips.some((reel) => reel.some((c) => c.name === w)),
);
console.log('');
if (uniform) {
	console.log('  [!] UNIFORM — every symbol appears equally often on every reel. These are');
	console.log('      COSMETIC strips: the frequencies carry no hit rate, so the RTP below');
	console.log('      describes nothing real. Replace them with a math export before reading');
	console.log('      any number under this line as the return of a shipped game.');
}
if (missingWild.length) {
	console.log(
		`  [!] wild ${missingWild.join('/')} is declared but never appears on the strips — it can never land.`,
	);
}

/**
 * Scoring a doc whose win model is not `ways` produces a number that describes nothing: `lines`
 * prices its paytable against the LINE count, not 243 ways, so ways-scoring its strips understates
 * the return by the ratio of the two divisors. The strip diagnostic above is still worth reading for
 * ANY doc (it is what makes a placeholder obvious), so the tool prints that and then stops, rather
 * than emitting a plausible-looking RTP for a game it cannot price.
 */
const model = resolveWinModel(doc).type;
if (model !== 'ways') {
	console.log(`\n  Win model is "${model}", not "ways" — no RTP printed.`);
	console.log('  This tool prices a paytable per WAY (`totalBet / waysCount`, #357). Scoring a');
	console.log(`  ${model} doc that way would understate its return by the ratio of the two`);
	console.log('  divisors and read like a measurement. Strip frequencies above are still valid,');
	console.log('  and are the useful contrast: real strips are non-uniform.');
	process.exit(0);
}

// --- The measurement -----------------------------------------------------------------------
const rand = makeRng(Number(flag('seed') ?? 1));
const betPerWay = 1 / rules.waysCount; // a total bet of 1.0 buys every way
let paid = 0;
let hits = 0;
let best = 0;
let triggers = 0;
const contribution: Record<string, number> = {};

for (let i = 0; i < spins; i++) {
	const board = dealFromStrips(strips, doc.numRows, rand);
	let spinPay = 0;
	for (const win of evaluateWaysDoc(board, rules, betPerWay)) {
		spinPay += win.pay;
		contribution[win.symbol] = (contribution[win.symbol] ?? 0) + win.pay;
	}
	paid += spinPay;
	if (spinPay > 0) hits++;
	if (spinPay > best) best = spinPay;
	if (rules.scatters.length && scatterCount(board, rules) >= 3) triggers++;
}

console.log('measured over the strips:');
console.log(`  RTP (symbol pays only)     ${pct(paid / spins)}`);
console.log(`  hit rate                   ${pct(hits / spins)}`);
console.log(`  best single spin           ${best.toFixed(2)}x bet`);
if (rules.scatters.length) {
	const rate = triggers / spins;
	console.log(
		`  3+ ${rules.scatters.join('/')} boards             ${pct(rate)}` +
			(rate > 0 ? `  (1 in ${Math.round(1 / rate).toLocaleString()})` : ''),
	);
}

if (paid > 0) {
	console.log('\n  contribution by symbol:');
	for (const [sym, amount] of Object.entries(contribution).sort((a, b) => b[1] - a[1])) {
		console.log(
			`    ${sym.padEnd(3)} ${pct(amount / paid).padStart(7)} of pays  (${pct(amount / spins)} of bet)`,
		);
	}
}

// --- What the number is NOT ----------------------------------------------------------------
console.log('\nscope:');
console.log('  Base-game symbol pays only. The free-spin feature is NOT simulated — its award');
console.log('  structure (spin count, multipliers) is not declared in the config, so a TOTAL game');
console.log('  RTP cannot be computed here, and none is printed.');
if (doc.rtp !== undefined) {
	console.log(
		`  The doc declares rtp ${doc.rtp}. That is a DECLARED TARGET, not a measurement, and`,
	);
	console.log('  this tool does not reconcile the two — a real export is what makes them agree.');
}
console.log('  The client does not compute wins; the RGS does, and in production it is external.');
