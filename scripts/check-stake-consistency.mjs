/**
 * The client and the RGS must agree about MONEY — for every win model.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/check-stake-consistency.mjs
 *   (or just `pnpm check:stake`)
 *
 * Unlike the other gates this drives the REAL facade (`engine-facade.ts`) against the REAL mock, so it
 * covers the seam where both halves were wrong at once and neither half looked it:
 *
 *   - `requestBet` declared a hardcoded 5 lines while the server declared, evaluated and paid its
 *     own set (20 on the shared `lines` default). The facade then normalised every win against
 *     `betPerLine × 20` — the count-up showed a QUARTER of the multiplier the wallet credited, and
 *     nothing in the pipeline disagreed with itself loudly enough to notice.
 *   - A paylines-less model (cluster / scatter-pays) had 13 phantom paylines regenerated for it, so
 *     its payout base was a thirteenth of what its own paytable quotes.
 *
 * The load-bearing assertion is `finalWin ÷ BOOK_AMOUNT_MULTIPLIER === round.payoutMultiplier`: the
 * number the win presentation counts up to, against the number the wallet settles. They are computed
 * from different fields by different code paths, so they only agree when the stake agrees.
 *
 * Also pins the position payload, because a win that pays but lights up nothing reads as an art bug
 * rather than a protocol one — the SCAT (free-spin trigger) win reached the client with an empty
 * cell list for months, which emptied the win-dim set and darkened the whole board (#441).
 */

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMockRgs } from './mock-rgs-server.mjs';

const facade = await import('../packages/rgs-translator-eagaming/engine-facade.ts');

const HERE = dirname(fileURLToPath(import.meta.url));
/** The engine's BOOK_AMOUNT_MULTIPLIER — book-event amounts are fixed-point bet multipliers. */
const BOOK_AMOUNT_MULTIPLIER = 100;
/** finalWin is rounded to a whole book-event unit, so it can sit half a unit off the exact ratio. */
const TOLERANCE = 1 / BOOK_AMOUNT_MULTIPLIER;

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};

/** The shipped `lines` default really does author 20 paylines — the case the hardcoded 5 broke. */
const linesPaylines = (() => {
	const doc = JSON.parse(
		readFileSync(join(HERE, '../apps/launcher-api/src/lib/data/gameConfig/lines.json'), 'utf8'),
	);
	return Object.values(doc.paylines ?? {});
})();

/** A count-keyed table in the mock's SERVER vocabulary, the shape `projectSymbolPaytable` ships. */
const scatterPaytable = Object.fromEntries(
	['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5', 'PIC6', 'PIC7'].map((s) => [
		s,
		{ 8: 1, 9: 2.5, 10: 6, 13: 20 },
	]),
);

const MODELS = [
	{ name: 'lines', opts: { reels: 5, rows: 3, paylines: linesPaylines } },
	{ name: 'ways', opts: { winModel: 'ways', reels: 5, rows: 3, paylines: [] } },
	{
		name: 'cluster',
		opts: { winModel: 'cluster', reels: 6, rows: 5, paylines: [], minCluster: 5 },
	},
	{
		name: 'scatter',
		opts: {
			winModel: 'scatter',
			reels: 6,
			rows: 5,
			paylines: [],
			minCount: 8,
			symbolPaytable: scatterPaytable,
		},
	},
];

/** Spin one model to exhaustion-of-budget, collecting what the assertions below need. */
async function play(model) {
	const mock = createMockRgs({
		label: `stake-${model.name}`,
		seed: `stake-consistency-${model.name}`,
		startBalance: 100_000_000,
		quiet: true,
		...model.opts,
	});
	const server = createServer((req, res) => mock.handle(req, res, new URL(req.url, 'http://x')));
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const rgsUrl = `http://127.0.0.1:${server.address().port}`;
	const sessionID = `stake-${model.name}`;

	await facade.requestAuthenticate({ rgsUrl, sessionID, language: 'en' });

	const out = { betEcho: null, winRounds: [], winsSeen: 0, scatterWin: null, emptyPositions: 0 };
	for (let i = 0; i < 200; i++) {
		const bet = await facade.requestBet({
			rgsUrl,
			sessionID,
			currency: 'USD',
			mode: 'BASE',
			amount: 1,
		});
		if (bet.error) break;
		const raw = bet._raw?.events ?? [];
		out.betEcho ??= raw.find((e) => e.event === 'bet')?.context ?? null;

		const state = bet.round?.state ?? [];
		for (const e of state) {
			if (e.type !== 'winInfo') continue;
			for (const w of e.wins ?? []) {
				out.winsSeen++;
				if (!w.positions?.length) out.emptyPositions++;
				if (w.symbol === 'S') out.scatterWin ??= w;
			}
		}
		const finalWin = state.find((e) => e.type === 'finalWin');
		if (finalWin && finalWin.amount > 0) {
			out.winRounds.push({ finalWin: finalWin.amount, mult: bet.round?.payoutMultiplier ?? 0 });
		}
		await facade.requestEndRound({ rgsUrl, sessionID });
		if (out.winRounds.length >= 20 && out.scatterWin) break;
	}
	server.close();
	return out;
}

for (const model of MODELS) {
	console.log(`\n${model.name}:`);
	const r = await play(model);

	// 1. The stake the client BOUGHT is the stake the server CHARGED. `betPerLine × numLines` is the
	//    facade's normalisation base; `total` is the debit. A paylines-less model declares no lines
	//    and buys one unit, which is the same statement with numLines = 1.
	const echo = r.betEcho;
	check(!!echo, 'the server echoes the bet');
	if (echo) {
		const numLines = Math.max(1, Array.isArray(echo.paylines) ? echo.paylines.length : 0);
		check(
			echo.betPerLine * numLines === echo.total,
			'betPerLine × numLines === the charged total',
			` (${echo.betPerLine} × ${numLines} vs ${echo.total})`,
		);
	}

	// 2. THE assertion. What the win presentation counts up to, against what the wallet settles.
	check(r.winRounds.length > 0, 'at least one paying round', ` (${r.winRounds.length})`);
	const desynced = r.winRounds.filter(
		(w) => Math.abs(w.finalWin / BOOK_AMOUNT_MULTIPLIER - w.mult) > TOLERANCE,
	);
	check(
		desynced.length === 0,
		'every round: finalWin ÷ 100 === round.payoutMultiplier',
		desynced.length
			? ` (${desynced.length}/${r.winRounds.length} desynced, e.g. counts up to ${
					desynced[0].finalWin / BOOK_AMOUNT_MULTIPLIER
				}× while the wallet credits ${desynced[0].mult}×)`
			: ` (${r.winRounds.length} rounds)`,
	);

	// 3. A win that pays must light something up.
	check(r.winsSeen > 0, 'wins reach the client', ` (${r.winsSeen})`);
	check(
		r.emptyPositions === 0,
		'no win arrives with an empty position list',
		` (${r.emptyPositions}/${r.winsSeen} empty)`,
	);

	// 4. The SCAT (free-spin trigger) win specifically — the one whose cells used to go missing.
	check(!!r.scatterWin, 'a SCAT (free-spin trigger) win occurs');
	if (r.scatterWin) {
		check(
			r.scatterWin.positions.length === r.scatterWin.kind,
			'the SCAT win carries one position per scatter',
			` (${r.scatterWin.positions.length} positions, kind ${r.scatterWin.kind})`,
		);
	}
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nstake consistency OK');
process.exit(failed ? 1 : 0);
