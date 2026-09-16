/**
 * Mock Play4Fun RGS server.
 *
 * Speaks the /rgs/engine batched-action protocol we captured from a real
 * Hot Fruits session. No auth, no Cloudflare, CORS-permissive — meant for
 * local development of the translator and engine wiring.
 *
 * Two ways to use it:
 *   1. Standalone CLI (local dev):  node scripts/mock-rgs-server.mjs
 *   2. In-process: `import { createMockRgs }` and mount its `handle` under a
 *      path prefix (the Invisible Test Server does this — `services/test-server`).
 *      `handle` matches /rgs/engine, /healthz, /state by path SUFFIX, so it works
 *      whether mounted at the root or under `/api/<gameKey>`.
 *
 * Optional env vars (CLI):
 *   PORT=7777                 (default)
 *   START_BALANCE=10000       (default — credits in cents, 100 = $1.00)
 *   SEED=anything             (deterministic spin outcomes)
 *
 * Endpoints:
 *   POST …/rgs/engine?sid=&seq=&gid=    — main batched-action endpoint
 *   GET  …/healthz                       — { ok: true }
 *   GET  …/state?sid=                    — debug: dump session state
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

// ---------- pure game data (read-only, shared across instances) ----------

// Symbol vocabulary mirrors what the live Hot Fruits server sends. Translation
// to per-game symbols (H1/L1/S/W for the engine's lines) happens in the facade,
// not here — the mock stays faithful to real Play4Fun output.
const SYMBOLS = ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5', 'PIC6', 'PIC7', 'SCAT'];
const LINE_SYMBOLS = SYMBOLS.filter((s) => s !== 'SCAT');

/**
 * MOCK-ONLY server names, for the client symbols the captured vocabulary cannot express.
 *
 * Play4Fun's Hot Fruits capture has seven line symbols, and the facade maps them one-to-one onto
 * seven of the engine's ten (`PIC1→H1 … PIC7→L5`). So a project whose Game Config puts `H5`, `L3`
 * or `L4` on its strips authored a symbol NO server name could carry: the launcher's in-play pool
 * filters the seven down, and can never add — those three were simply never dealt, however the
 * config was authored. On the live `test6` that lost `H5` and `L3` outright.
 *
 * These names exist so the mock can express the engine's WHOLE dictionary. They are deliberately
 * kept OUT of `SYMBOLS`/`LINE_SYMBOLS`, so they are unreachable except through an explicit
 * `opts.symbols` pool built from a project's own config: the default deal stays the faithful seven,
 * a real Play4Fun server never sends them, and Hot Fruits / Book of Borut are untouched. Like
 * `tumbleStep` and `MULT:5`, this is OURS — a mock extension, not a protocol claim.
 */
const EXTENDED_LINE_SYMBOLS = ['PIC8', 'PIC9', 'PIC10'];

/** Every name a project pool may legitimately contain — the captured set plus the extension above.
 *  Anything else is dropped on arrival: the pool comes from an external manifest, and a symbol this
 *  mock cannot price is a cell the client cannot render. */
const KNOWN_POOL_SYMBOLS = new Set([...SYMBOLS, ...EXTENDED_LINE_SYMBOLS]);

/**
 * The line symbols an evaluator scores. `opts.pool` is the instance's real pool (a project's
 * in-play set, which may include the extended names); absent ⇒ the captured seven, so every
 * standalone caller and fixture behaves exactly as before.
 *
 * This exists because the evaluators used to iterate the module-level `LINE_SYMBOLS` directly.
 * That was invisible while a pool could only ever be a SUBSET of it — the extra names simply were
 * not on the board — and becomes wrong the moment a pool can contain a name that list lacks.
 */
const poolOf = (opts) => (Array.isArray(opts?.pool) && opts.pool.length ? opts.pool : LINE_SYMBOLS);

/**
 * The price row for one symbol: the PROJECT's authored paytable first, then the mock's own captured
 * Hot Fruits table.
 *
 * The project's table used to travel for the `scatter` model alone, on the reasoning that only a
 * count-priced game needed it. That left every lines/ways/cluster game paying Hot Fruits values
 * whatever its `/config` said — and left the extended names above unpriced, since `PAY_TABLE` has
 * no row for them. Both are the same gap: the mock should price what the project authored.
 */
const payRowOf = (opts, symbol) => opts?.symbolPaytable?.[symbol] ?? PAY_TABLE[symbol];

/**
 * A payout in whole CENTS — the only denomination this protocol has (100 = $1.00).
 *
 * The mock's own captured table is integer multipliers (Hot Fruits' `PIC1` 5-of-a-kind = 5000), so
 * `multiplier × stake` was always a whole number and nothing ever had to say this. A PROJECT's
 * paytable is bet-multipliers and is routinely fractional — the live `test6` prices `L1` at `0.4`
 * — so the moment those values started pricing every model, a 3-of-a-kind at a 1-cent stake paid
 * `0.4` cents. That is not a rounding nicety: the fraction lands in `spinWin`, in the chain total,
 * in `gameEnd` and finally in `session.balance`, which then reads €99.996.
 *
 * Rounded, with a FLOOR of one cent for a win that priced above zero — a win the player can see on
 * the board must never pay nothing, which is what `Math.round(0.4)` alone would do. Inert for the
 * captured table (already whole), so an un-authored game is byte-identical.
 */
const payCents = (amount) => (amount > 0 ? Math.max(1, Math.round(amount)) : 0);
// When false (production rule, surfaced in the config event), paylines whose win
// lands on the IDENTICAL cells are one win — pay it once, not once per crossing
// line. See dedupeCoincidingWins below.
const LINE_COINCIDING = false;
// DEFAULT grid + paylines — the faithful Hot Fruits 5×3 board. `createMockRgs` accepts
// `{ reels, rows, paylines }` overrides so the test server can deal the game's AUTHORED grid
// (Invisible Game Config's numReels/numRows/paylines) and a spin shows the board the game draws,
// not a fixed 5×3. Absent overrides ⇒ these values ⇒ byte-identical to before.
const DEFAULT_REELS = 5;
const DEFAULT_ROWS = 3;
const DEFAULT_PAYLINES = [
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
];

/** Rows per reel, from either shape `createMockRgs` accepts: a NUMBER (every reel that tall — the
 *  only shape that existed before stepped grids) or the per-reel ARRAY the game config carries. Short
 *  arrays repeat their last entry rather than collapsing to a default, so a half-written override
 *  still describes a board. */
export const rowsPerReel = (rows, reels, fallback) => {
	if (Array.isArray(rows) && rows.length) {
		const clean = rows.map((r) => Math.max(1, Math.round(Number(r)) || 0) || 1);
		return Array.from({ length: reels }, (_unused, i) => clean[i] ?? clean[clean.length - 1]);
	}
	const flat = Math.max(1, Math.round(Number(rows ?? fallback)) || 0) || 1;
	return Array.from({ length: reels }, () => flat);
};

/** True when the payline set touches every row THAT EXISTS — the gate for keeping an authored set
 *  as-is. A set that skips rows (e.g. the stock 5×3 lines on a resized 5×5 board) leaves those rows
 *  permanently unwinnable, which is exactly the "nothing pays on the bottom row" report.
 *
 *  `rows` may be the per-reel array. On a stepped grid "every row" is per COLUMN: a line cannot
 *  reach row 4 of a 3-row reel, so demanding board-wide coverage there would reject every legal set
 *  and regenerate lines forever. A number behaves exactly as before. */
export const coversAllRows = (paylines, rows) => {
	if (Array.isArray(rows)) {
		if (!paylines.length) return false;
		return rows.every((height, reel) => {
			const used = new Set();
			for (const line of paylines) if (line[reel] !== undefined) used.add(line[reel]);
			for (let r = 0; r < height; r++) if (!used.has(r)) return false;
			return true;
		});
	}
	const used = new Set();
	for (const line of paylines) for (const r of line) used.add(r);
	for (let r = 0; r < rows; r++) if (!used.has(r)) return false;
	return true;
};

/** A sensible standard payline set for an arbitrary `reels`×`rows` grid, generated so the server can
 *  "pick up" a game's real dimensions instead of dealing a fixed 5×3 subset. Not a math-tuned set
 *  (the real RGS owns that) — just full-row coverage in familiar shapes: one horizontal per row, then
 *  a single-dip "V" and single-peak "^" between each adjacent row-pair. Deterministic (no RNG) and
 *  deduped. Horizontals alone guarantee every row is a winning row. */
export const standardPaylines = (reels, rows) => {
	// Per-reel heights; a plain number is the uniform board this always assumed.
	const heights = rowsPerReel(rows, reels, rows);
	const tallest = Math.max(...heights);
	const mid = Math.round((reels - 1) / 2);
	// A line must name a row THAT REEL HAS. On a uniform board every reel has every row and this is
	// the identity, so the generated set is byte-identical to before. On a stepped board the line is
	// pulled onto the nearest row the short column owns — which is what makes a horizontal across a
	// 3/4/5/4/3 diamond bend with the board's own silhouette instead of pointing off it.
	const on = (reel, row) => Math.max(0, Math.min(row, heights[reel] - 1));
	const lines = [];
	for (let r = 0; r < tallest; r++) lines.push(Array.from({ length: reels }, (_u, c) => on(c, r)));
	for (let r = 0; r < tallest - 1; r++) {
		lines.push(Array.from({ length: reels }, (_unused, c) => on(c, c === mid ? r + 1 : r)));
		lines.push(Array.from({ length: reels }, (_unused, c) => on(c, c === mid ? r : r + 1)));
	}
	const seen = new Set();
	return lines.filter((line) => {
		const key = line.join(',');
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
};

/** Coerce a wild paytable ({ occurs → multiplier }, keys possibly strings) to a clean numeric map,
 *  dropping non-positive or non-finite entries. Empty ⇒ the mock treats the game as wild-less. */
export const normalizeWildPaytable = (raw) => {
	const map = {};
	for (const [count, mult] of Object.entries(raw ?? {})) {
		const c = Number(count);
		const m = Number(mult);
		if (Number.isInteger(c) && c > 0 && Number.isFinite(m) && m > 0) map[c] = m;
	}
	return map;
};
/** Hot Fruits paytable — PIC1 is the TOP payer (5-of-a-kind = 5000), PIC7 the
 *  lowest (also pays 2-of-a-kind = 5). Aligned with the real server config
 *  captured during play (see Riassunto_Stato_Lavoro.pdf §"Aggiornamento"). */
const PAY_TABLE = {
	PIC1: { 3: 200, 4: 1000, 5: 5000 },
	PIC2: { 3: 100, 4: 500, 5: 2500 },
	PIC3: { 3: 75, 4: 250, 5: 1000 },
	PIC4: { 3: 20, 4: 100, 5: 500 },
	PIC5: { 3: 15, 4: 75, 5: 200 },
	PIC6: { 3: 10, 4: 40, 5: 100 },
	PIC7: { 2: 5, 3: 5, 4: 25, 5: 50 },
	// The extended names (see `EXTENDED_LINE_SYMBOLS`) need a fallback row for the same reason every
	// other symbol has one: a symbol that can be DEALT must be priceable, or it lands on the board and
	// can never win. The launcher admits a symbol into the deal pool on the in-play gate alone, but
	// only puts it in `symbolPaytable` if the project authored a paytable for it — so a project that
	// puts `H5` on its strips without pricing it would otherwise deal a symbol with no row anywhere.
	// Priced as low symbols (they map to `H5`/`L3`/`L4`); an authored table overrides per-symbol.
	PIC8: { 3: 15, 4: 75, 5: 200 },
	PIC9: { 3: 10, 4: 40, 5: 100 },
	PIC10: { 3: 10, 4: 40, 5: 100 },
};

/** Scatter paytable — SCATs pay anywhere on the board, not on paylines.
 *  Multiplied by TOTAL stake, not betPerLine. Values are placeholders;
 *  real Hot Fruits values to be confirmed from a live session capture. */
const SCATTER_PAY_TABLE = {
	3: 2, // 3 SCAT → 2× total stake
	4: 10, // 4 SCAT → 10× total stake
	5: 100, // 5 SCAT → 100× total stake
};

function hashStr(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h;
}

/**
 * Evaluate paylines. Each payline is one row-index per reel; a win is the leftmost run of matching
 * symbols. When `wild` is passed ({ paytable: { occurs → multiplier } }), the `WILD` symbol (1)
 * SUBSTITUTES for the line's paying symbol — extending a run of any high/low symbol — and (2) pays
 * its OWN paytable for a leading run of pure wilds, whichever is worth more. `wild` absent ⇒ the
 * original plain-equality behaviour, byte-identical (no game deals WILD unless a project opts in).
 */
export const evaluatePaylines = (reels, betPerLine, paylines, wild = null, opts = {}) => {
	const wildPay = wild?.paytable ?? null;
	const isWild = (sym) => wildPay !== null && sym === 'WILD';
	const wins = [];
	for (let p = 0; p < paylines.length; p++) {
		const line = paylines[p];
		const seq = line.map((row, reel) => reels[reel][row]);
		// The paying symbol is the first non-wild cell (leading wilds substitute for it). A line that
		// is ALL wild has no base symbol and pays only via the wild's own paytable.
		const base = seq.find((sym) => !isWild(sym)) ?? null;
		let baseRun = 0;
		for (const sym of seq) {
			if (isWild(sym) || (base !== null && sym === base)) baseRun++;
			else break;
		}
		let wildRun = 0;
		for (const sym of seq) {
			if (isWild(sym)) wildRun++;
			else break;
		}
		let best = null;
		// THE SCATTER NEVER PAYS AS A LINE SYMBOL. `base` is read off the BOARD, so it can be `SCAT`,
		// and the scatter is already paid by its own `evaluateScatters` pass. This never mattered while
		// the only price list was `PAY_TABLE` (no `SCAT` row), and became a real double-pay the moment a
		// PROJECT's table could supply one — every stock template authors a paytable on `S`. The
		// launcher now withholds that row (`projectSymbolPaytable`); this is the mock refusing it too,
		// so no future table can reintroduce the double-pay.
		const baseMult = base !== null && base !== 'SCAT' ? (payRowOf(opts, base)?.[baseRun] ?? 0) : 0;
		if (baseMult > 0) best = { what: base, occurs: baseRun, pay: baseMult * betPerLine };
		const wildMult = wildPay && wildRun > 0 ? (wildPay[wildRun] ?? 0) : 0;
		if (wildMult > 0) {
			const pay = wildMult * betPerLine;
			if (!best || pay > best.pay) best = { what: 'WILD', occurs: wildRun, pay };
		}
		if (best) {
			wins.push({
				...best,
				mode: 'line',
				mpInfo: { mp: 1, replacements: 0 },
				mpBonusInfo: null,
				context: { paylineId: p, payline: line, direction: 'left' },
			});
		}
	}
	return LINE_COINCIDING ? wins : dedupeCoincidingWins(wins);
};

/** The board cells that actually form a win: the leftmost `occurs` reel/row
 *  positions of its payline. */
const winningCells = ({ occurs, context }) =>
	context.payline.slice(0, occurs).map((row, reel) => `${reel}:${row}`);

const isSubset = (a, b) => a.every((c) => b.includes(c));

/** With `lineCoinciding: false`, keep a line win only if its winning cells are
 *  NOT contained in another winning line — collapses both identical-cell
 *  coincidences AND a shorter run subsumed by a longer one (a 2 paid inside a 3).
 *  Identical cells ⇒ identical symbols, so distinct/non-overlapping lines are
 *  never merged. */
const dedupeCoincidingWins = (wins) => {
	const cells = wins.map(winningCells);
	return wins.filter(
		(w, i) =>
			!wins.some((v, j) => {
				if (j === i || !isSubset(cells[i], cells[j])) return false;
				if (cells[j].length > cells[i].length) return true; // j strictly longer ⇒ i subsumed
				return v.pay > w.pay || (v.pay === w.pay && j < i); // equal cells ⇒ keep one
			}),
	);
};

/**
 * Evaluate WAYS pays (`winModel: 'ways'`). Phase D of `docs/design/game-type-templates.md`.
 *
 * A ways win is a symbol appearing on consecutive reels from the LEFTMOST one; the run stops at the
 * first reel that does not contain it. The payout multiplies by the number of distinct paths — the
 * PRODUCT of how many times the symbol appears on each contributing reel (3 on reel 1 × 2 on reel 2
 * = 6 ways). That is the one structural difference from a payline: a win covers EVERY matching cell
 * on the contributing reels, so several cells per reel, which is why its positions cannot be
 * expressed as a payline (one row per reel) and go out as a flat cell list instead.
 *
 * `betPerWay` plays the role `betPerLine` does for lines — the mock's own denomination, not real
 * math. Wilds substitute for the paying symbol exactly as they do on a payline.
 *
 * Positions are emitted as a BARE ARRAY of `{reel,row}` because that is the only non-payline shape
 * `engineFacade`'s `winPositions` reads (`Array.isArray(ctx)`). An object wrapper silently yields no
 * positions — the win would pay but light up nothing.
 */
export const evaluateWays = (reels, betPerWay, wild = null, opts = {}) => {
	const wildPay = wild?.paytable ?? null;
	const isWild = (sym) => wildPay !== null && sym === 'WILD';
	const wins = [];

	for (const symbol of poolOf(opts)) {
		// Per contributing reel, every row holding the symbol (or a substituting wild).
		const perReel = [];
		for (let reel = 0; reel < reels.length; reel++) {
			const rows = [];
			for (let row = 0; row < reels[reel].length; row++) {
				const cell = reels[reel][row];
				if (cell === symbol || isWild(cell)) rows.push(row);
			}
			if (rows.length === 0) break; // the run ends at the first reel without the symbol
			perReel.push(rows);
		}

		const occurs = perReel.length;
		const mult = payRowOf(opts, symbol)?.[occurs] ?? 0;
		if (!mult) continue;

		const ways = perReel.reduce((product, rows) => product * rows.length, 1);
		const positions = perReel.flatMap((rows, reel) => rows.map((row) => ({ reel, row })));
		wins.push({
			what: symbol,
			occurs,
			mode: 'ways',
			pay: mult * ways * betPerWay,
			mpInfo: { mp: 1, replacements: 0 },
			mpBonusInfo: null,
			// Flat cell list — see the note above about `winPositions`. `ways` rides along so a
			// client (or a human reading the wire) can see WHY the pay is a multiple of the paytable.
			context: Object.assign(positions, { ways }),
		});
	}
	return wins;
};

/**
 * Evaluate CLUSTER pays (`winModel: 'cluster'`).
 *
 * A cluster is a connected group of one symbol, `minCluster` cells or larger. Connectivity is
 * `orthogonal` (edge-sharing) or `diagonal` (corners count too) — both come from the project's
 * declared win model, so the mock pays the shape the config says it pays. Wilds substitute, and a
 * wild can join clusters of DIFFERENT symbols at once, which is why the flood fill runs per candidate
 * symbol rather than partitioning the board once.
 *
 * ⚠️ TEST APPROXIMATION on the payout. This mock's paytable is keyed by 3/4/5 `occurs` (a payline
 * game's run lengths), and a cluster is 5+ cells by definition — so a cluster of 9 has no row to read.
 * The size is CLAMPED to the largest row the symbol has. That is deliberately crude: it makes the
 * mock pay something sane for testing PRESENTATION, and it is not a cluster paytable. A real cluster
 * game prices by cluster size and needs a math export — the same line held for the ways strips.
 *
 * A corollary worth knowing when configuring a test project: a cluster SMALLER than the lowest
 * priced run simply does not pay. So a `minCluster` below the paytable's floor (3 here) silently
 * finds clusters that never pay out, which reads as "clusters do not work". Keep `minCluster` at or
 * above the smallest `occurs` the symbols price.
 *
 * Positions go out as a flat `{reel,row}` list, the shape `engineFacade`'s `winPositions` reads for a
 * non-payline win (`Array.isArray(ctx)`), exactly as the ways evaluator does.
 */
export const evaluateClusters = (reels, betPerCluster, wild = null, opts = {}) => {
	const minCluster = Math.max(2, Math.round(Number(opts.minCluster ?? 5)));
	const diagonal = opts.adjacency === 'diagonal';
	const wildPay = wild?.paytable ?? null;
	const isWild = (sym) => wildPay !== null && sym === 'WILD';
	const wins = [];

	const NEIGHBOURS = diagonal
		? [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
				[1, 1],
				[1, -1],
				[-1, 1],
				[-1, -1],
			]
		: [
				[1, 0],
				[-1, 0],
				[0, 1],
				[0, -1],
			];

	for (const symbol of poolOf(opts)) {
		const matches = (reel, row) => {
			const cell = reels[reel]?.[row];
			return cell !== undefined && (cell === symbol || isWild(cell));
		};
		const seen = new Set();
		const key = (reel, row) => `${reel}:${row}`;

		for (let reel = 0; reel < reels.length; reel++) {
			for (let row = 0; row < reels[reel].length; row++) {
				if (seen.has(key(reel, row)) || !matches(reel, row)) continue;

				// Flood fill this connected group.
				const group = [];
				const stack = [[reel, row]];
				seen.add(key(reel, row));
				while (stack.length) {
					const [r, c] = stack.pop();
					group.push({ reel: r, row: c });
					for (const [dr, dc] of NEIGHBOURS) {
						const nr = r + dr;
						const nc = c + dc;
						if (seen.has(key(nr, nc)) || !matches(nr, nc)) continue;
						seen.add(key(nr, nc));
						stack.push([nr, nc]);
					}
				}

				if (group.length < minCluster) continue;
				const table = payRowOf(opts, symbol);
				if (!table) continue;
				// The highest priced tier at or below the cluster size — a row is a THRESHOLD ("8+"),
				// which is also how `evaluateScatterPays` reads its table.
				//
				// This used to be an exact lookup with a clamp (`table[Math.min(size, maxRow)]`), and that
				// was safe only while `table` was ALWAYS the mock's own dense `PAY_TABLE` (rows 3/4/5, so
				// every size ≥ 3 hit one). Now `payRowOf` can return the PROJECT's table, which for a
				// cluster game is routinely sparse — `{5: 1, 8: 5, 12: 20}` is an ordinary authoring — and
				// an exact lookup drops every size in between: measured on the branch, clusters of 6, 7, 9
				// and 11 paid NOTHING while 5, 8 and 12 paid. The player watches six connected symbols
				// light up and score zero. Clamping is subsumed: any size above the largest row resolves
				// to that row, so the dense fallback table behaves exactly as it did before.
				const tier = Object.keys(table)
					.map(Number)
					.filter((n) => n <= group.length)
					.sort((a, b) => a - b)
					.pop();
				const mult = tier === undefined ? 0 : (table[tier] ?? 0);
				if (!mult) continue;

				wins.push({
					what: symbol,
					occurs: group.length,
					mode: 'cluster',
					pay: mult * betPerCluster,
					mpInfo: { mp: 1, replacements: 0 },
					mpBonusInfo: null,
					context: Object.assign(group, { cluster: group.length }),
				});
			}
		}
	}
	return wins;
};

/**
 * Evaluate SCATTER-PAYS wins (`winModel: 'scatter'`) — every symbol pays on COUNT anywhere.
 *
 * ⚠️ Not to be confused with {@link evaluateScatters} directly below, which is a different thing
 * wearing a similar name: that one pays the SCAT feature symbol and triggers free spins, and it runs
 * for EVERY win model. This one is the win model itself, where an ordinary H1/L2 pays because eight
 * of them are on the board, wherever they landed.
 *
 * Unlike the cluster evaluator, this does NOT approximate the payout. A scatter game prices by count
 * (8, 9, 10, 13+ …) and the project ships exactly that table (`grid.symbolPaytable`, in server
 * symbols), so the real values travel. The mock's own run-length table is the fallback for a project
 * that sent none, and it will read oddly — every count above 5 pays the 5-row — which is the honest
 * signal that the paytable did not arrive.
 *
 * Wilds substitute. Positions go out as the flat `{reel,row}` list `engineFacade`'s `winPositions`
 * reads for a non-payline win, same as ways and cluster.
 */
export const evaluateScatterPays = (reels, betPerSpin, wild = null, opts = {}) => {
	const minCount = Math.max(2, Math.round(Number(opts.minCount ?? 8)));
	const wildPay = wild?.paytable ?? null;
	const isWild = (sym) => wildPay !== null && sym === 'WILD';
	const wins = [];

	for (const symbol of poolOf(opts)) {
		const positions = [];
		for (let reel = 0; reel < reels.length; reel++) {
			for (let row = 0; row < reels[reel].length; row++) {
				const cell = reels[reel][row];
				if (cell === symbol || isWild(cell)) positions.push({ reel, row });
			}
		}
		if (positions.length < minCount) continue;

		const priceRow = payRowOf(opts, symbol);
		if (!priceRow) continue;
		// The highest priced tier at or below the count — ordinary paytable semantics, where a row is
		// a THRESHOLD ("10+") rather than an exact match.
		//
		// It matters for a SPARSE table: the sample scatter config happens to list every count from 8
		// to 36, but a table of `{8, 9, 10, 13}` is perfectly legal, and an exact-match lookup pays
		// NOTHING for a count of 11 — a win the player can see on the board that silently scores
		// zero. Also does the clamping the fallback run-length table needs, since any count above 5
		// simply resolves to the 5 row.
		const tier = Object.keys(priceRow)
			.map(Number)
			.filter((n) => n <= positions.length)
			.sort((a, b) => a - b)
			.pop();
		const mult = tier === undefined ? 0 : (priceRow[tier] ?? 0);
		if (!mult) continue;

		wins.push({
			what: symbol,
			occurs: positions.length,
			mode: 'scatterPays',
			pay: mult * betPerSpin,
			mpInfo: { mp: 1, replacements: 0 },
			mpBonusInfo: null,
			context: Object.assign(positions, { count: positions.length }),
		});
	}
	return wins;
};

/** Evaluate scatter pays. SCATs pay anywhere on the board (not bound to a
 *  payline). Returns at most one win event with all scatter positions. */
const evaluateScatters = (reels, totalStake) => {
	const positions = [];
	for (let reel = 0; reel < reels.length; reel++) {
		for (let row = 0; row < reels[reel].length; row++) {
			if (reels[reel][row] === 'SCAT') {
				positions.push({ reel, row });
			}
		}
	}
	const count = positions.length;
	const mult = SCATTER_PAY_TABLE[count];
	if (!mult) return null;
	return {
		what: 'SCAT',
		occurs: count,
		mode: 'scatter',
		pay: mult * totalStake,
		mpInfo: { mp: 1, replacements: 0 },
		mpBonusInfo: null,
		// A BARE array, like every sibling evaluator and the book mock — that is the ONLY shape the
		// facade's `winPositions` reads (`Array.isArray(context)`). It used to be a `{ positions }`
		// wrapper, chosen so `payingCells` would skip the scatters when picking the cells a cascade
		// blows up. That worked, but it also stripped the positions from the CLIENT's `winInfo`: no
		// scatter highlight, no free-spin trigger animation, and — on a scatter-only paying spin — an
		// EMPTY win-dim set, which darkened every cell on the board and lit none. The cascade
		// exclusion now lives in `payingCells`, keyed off what the win IS rather than a context shape.
		context: Object.assign(positions, { count }),
	};
};

// ---------- pure HTTP plumbing ----------

/** Build CORS headers compatible with credentials:'include'. The browser
 *  rejects Access-Control-Allow-Origin: '*' when credentials are present —
 *  the server must echo back the specific Origin and set
 *  Access-Control-Allow-Credentials: true. Falls back to '*' if no Origin
 *  header is present (e.g. curl from terminal). */
const corsHeaders = (req) => {
	const origin = req.headers.origin;
	if (origin) {
		return {
			'Access-Control-Allow-Origin': origin,
			'Access-Control-Allow-Credentials': 'true',
			'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
			'Access-Control-Allow-Headers': 'Content-Type',
			Vary: 'Origin',
		};
	}
	return {
		'Access-Control-Allow-Origin': '*',
		'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
		'Access-Control-Allow-Headers': 'Content-Type',
	};
};

const sendJson = (req, res, status, body) => {
	const text = JSON.stringify(body);
	res.writeHead(status, {
		'Content-Type': 'application/json',
		...corsHeaders(req),
		'Content-Length': Buffer.byteLength(text),
	});
	res.end(text);
};

const sendCorsPreflight = (req, res) => {
	res.writeHead(204, {
		...corsHeaders(req),
		'Access-Control-Max-Age': '86400',
	});
	res.end();
};

const readBody = (req) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});

const makeRoundId = () => 'G' + Math.random().toString(36).slice(2, 14);

/** A path matches a route if it equals or ends with the route (so the same
 *  handler works at the root or mounted under `/api/<gameKey>`). */
const pathEndsWith = (pathname, route) => {
	const p = pathname.replace(/\/+$/, '') || '/';
	return p === route || p.endsWith(route);
};

// ---------- factory: one stateful mock instance ----------

/**
 * Create a Play4Fun RGS mock instance. Each instance owns its own session store
 * and RNG, so mounting several instances side-by-side (e.g. one per game) keeps
 * their balances independent.
 *
 * @param {{ startBalance?: number, seed?: string, label?: string, reels?: number,
 *   rows?: number | number[], rowsPerReel?: number[],
 *   paylines?: number[][], wild?: { paytable: Record<string, number> }, stacked?: boolean,
 *   symbols?: string[], winModel?: 'lines' | 'ways' | 'cluster' | 'scatter',
 *   cascade?: boolean, cascadeDemo?: boolean, quiet?: boolean }} [opts] `symbols` restricts the dealt line
 *   pool to the project's in-play symbols in SERVER vocabulary (PIC* plus SCAT); absent ⇒ the full
 *   default pool. `winModel` selects how wins are DECIDED — everything else (session, seq, round
 *   lifecycle, scatters, free spins, the whole event vocabulary) is identical between the two, which
 *   is exactly why this is one option rather than a forked mock. `cascade` says WHETHER the game
 *   tumbles; `cascadeDemo` says the caller turned it on as a DEMO over a game that has no tumble of
 *   its own, which is the only thing that makes a dead spin tumble (see `nativeCascade`).
 */
export function createMockRgs(opts = {}) {
	/** Default in Play4Fun's native integer-cents convention (100 = $1.00).
	 *  10000 = $100 — matches what we observed from the live Hot Fruits server. */
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 10_000);
	const seed = opts.seed ?? process.env.SEED;
	const label = opts.label ?? 'mock';
	/** Silence the per-request line. For gates, which spin hundreds of rounds and bury their own
	 *  output under it — never for the CLI or the test server, where it is the only trace there is. */
	const quiet = opts.quiet === true;

	// Grid the mock deals — the game's authored grid when the test server injects it, else the
	// faithful Hot Fruits 5×3. `paylines` MUST be numReels-wide (one row index per reel); an
	// injected set out of sync with `reels` would index off the board, so the test server passes
	// the config's own paylines alongside its dimensions.
	const reelCount = Math.max(1, Math.round(Number(opts.reels ?? DEFAULT_REELS)));
	// `rows` is a NUMBER (uniform, the only shape before stepped grids) or the config's per-reel
	// ARRAY. `rowHeights` is the authority for what each column deals; `rowCount` stays the tallest
	// column — the BOUNDING BOX — because that is what the board-wide callers below mean by "rows"
	// (the padded reveal envelope, the free-spin window, the stacked showcase). On a uniform board
	// every entry equals `rowCount` and every draw below is byte-identical to before.
	// Accepts either spelling. The test server spreads a manifest `grid` in wholesale, and that
	// object carries BOTH `rows` (the bounding box, for every reader that wants one number) and
	// `rowsPerReel` (the per-column list, present only when the project authored a stepped grid), so
	// the array wins where it exists and `rows` is the answer everywhere else.
	const rowHeights = rowsPerReel(opts.rowsPerReel ?? opts.rows, reelCount, DEFAULT_ROWS);
	const rowCount = Math.max(...rowHeights);
	const isStepped = rowHeights.some((r) => r !== rowHeights[0]);

	// How wins are decided. `lines` keeps the payline evaluator (default ⇒ every existing caller is
	// byte-identical); `ways` swaps in the ways evaluator. Both then share the same scatter pass and
	// the same event stream.
	const winModel = ['ways', 'cluster', 'scatter'].includes(opts.winModel) ? opts.winModel : 'lines';

	// Only a LINES game has paylines. Ways / cluster / scatter-pays decide a win without them, and
	// their configs authored none — but the fallback below reads an empty list as "absent" and
	// substituted the stock 5×3 set, which then failed `coversAllRows` on their taller boards and
	// got REGENERATED into 13 phantom lines. Those 13 were declared on the wire, so the client
	// derived a per-line stake from lines the server never pays, and the ways/cluster payout base
	// was a thirteenth of what the paytable quotes. Declaring none is the honest wire.
	const paylinesLess = winModel !== 'lines';
	/** How many ways the grid pays — the PRODUCT of each reel's visible rows (a uniform 5×3 board
	 *  pays 3⁵ = 243; a stepped 3/4/5 column set pays 60). Per-reel rather than `rowCount ** reelCount`
	 *  because a stepped grid's short columns deal fewer rows and therefore offer fewer paths — the
	 *  bounding box would over-count them. The client computes the same number in `activeWaysCount()`. */
	const waysCount = Math.max(
		1,
		rowHeights.reduce((n, rows) => n * Math.max(1, rows), 1),
	);
	const authoredPaylines =
		Array.isArray(opts.paylines) && opts.paylines.length ? opts.paylines : DEFAULT_PAYLINES;
	// Keep the authored set when it already touches every row; otherwise the game's real dimensions
	// have outgrown its lines (the classic 5×3 lines on a resized 5×5 board), so deal a generated set
	// that covers the whole grid — the server "picks up" rows/reels instead of a stale line subset.
	const paylines = paylinesLess
		? []
		: coversAllRows(authoredPaylines, isStepped ? rowHeights : rowCount)
			? authoredPaylines
			: standardPaylines(reelCount, isStepped ? rowHeights : rowCount);
	/** Cluster shape, straight from the project's declared win model. Defaults match `normalizeWinModel`. */
	const clusterOpts = {
		minCluster: opts.minCluster ?? 5,
		adjacency: opts.adjacency === 'diagonal' ? 'diagonal' : 'orthogonal',
	};
	/** Scatter-pays shape. Default matches `normalizeWinModel`. The project's own paytable used to
	 *  live here too; it is now on `evalOpts`, which every model reads — one home. */
	const scatterPaysOpts = { minCount: opts.minCount ?? 8 };

	// Opt-in WILD support (per-project, injected by the test server from a game's config). When a
	// project puts a wild symbol IN PLAY (on its strips) with a paytable, `opts.wild.paytable` is the
	// occurs→multiplier map; the mock then declares, deals and pays `WILD` (the lines facade maps
	// `WILD → W`). Absent ⇒ no game deals a wild ⇒ Hot Fruits / Borut behaviour is unchanged.
	const wild =
		opts.wild && opts.wild.paytable && Object.keys(opts.wild.paytable).length
			? { paytable: normalizeWildPaytable(opts.wild.paytable) }
			: null;

	// Per-project line-symbol restriction (injected by the test server from a game's in-play Game
	// Config). `opts.symbols` is the allowed pool in the mock's SERVER vocabulary (PIC*, plus 'SCAT'
	// when the scatter is in play) — the launcher already translated the client-space in-play set
	// (H1/L1/S/…) to it, so the mock needs ZERO mapping knowledge. Absent/empty ⇒ the faithful full
	// pool + scatter. SCAT rides in the pool as a flag; strip it out to get the LINE pool. Guard: an
	// empty line pool (misconfigured filter) falls back to the full default — never deal a blank board.
	//
	// The pool is filtered to names this mock KNOWS, because the manifest it arrives in is external
	// and a name nothing can price or render is worse than no name at all.
	//
	// `MULT` is the case that proves it, and it is stripped here as well as at publish. It is NOT a
	// line symbol — it is dealt only by the collect fixture, WITH a value (`MULT:5`) — but it reaches
	// this pool from the mapping table`s key set, so a manifest published while it was in there would
	// deal bare, valueless `MULT` cells on every board. The client maps those to a symbol with no
	// multiplier and no art. Rejecting it in BOTH places means a project already carrying the bad
	// pool is fixed by this deploy rather than by remembering to republish.
	const allowedSymbols = Array.isArray(opts.symbols)
		? opts.symbols.filter((s) => typeof s === 'string' && KNOWN_POOL_SYMBOLS.has(s))
		: [];
	/**
	 * A pool that IS the captured default is not a restriction — it is the default, spelled out.
	 *
	 * The distinction is load-bearing because `restrictSymbols` also picks the DEAL: a restricted
	 * pool is drawn uniformly, while the default keeps Hot Fruits' weighted tiers. The launcher used
	 * to omit the pool entirely when every symbol was in play, purely to land on this branch — a
	 * shortcut that quietly broke the moment the mapping grew past the captured seven, since "all in
	 * play" then meant a pool the default set does NOT contain. Deciding it here instead lets the
	 * launcher always state the pool and keeps ONE home for what the default is.
	 */
	const sameAsDefaultPool =
		allowedSymbols.length === SYMBOLS.length && SYMBOLS.every((s) => allowedSymbols.includes(s));
	const restrictSymbols = allowedSymbols.length > 0 && !sameAsDefaultPool;
	const scatterEnabled = restrictSymbols ? allowedSymbols.includes('SCAT') : true;
	const linePoolRaw = restrictSymbols ? allowedSymbols.filter((s) => s !== 'SCAT') : LINE_SYMBOLS;
	const LINE_POOL = linePoolRaw.length ? linePoolRaw : LINE_SYMBOLS;

	/**
	 * What every evaluator on this instance scores, and what it prices with — the project's own pool
	 * and its own paytable, so "the symbols my config deals" and "the symbols my config pays" are the
	 * same list. Spread into each evaluator call below; a standalone caller that passes neither keeps
	 * the captured seven and the captured Hot Fruits values (`poolOf` / `payRowOf`).
	 */
	const evalOpts = { pool: LINE_POOL, symbolPaytable: opts.symbolPaytable ?? null };

	/**
	 * The board vocabulary + the price list this instance ACTUALLY uses, for the `config` and
	 * `spinStart` events to advertise.
	 *
	 * Both used to announce the module-level defaults regardless of the pool, so a restricted game
	 * told the client it deals `PIC7` when it never would, and quoted Hot Fruits prices for symbols
	 * it does not pay — the wire disagreeing with the deal is exactly the confusion this whole change
	 * is about. Unrestricted, the pool IS the default set and the table IS `PAY_TABLE`, so an
	 * un-authored game's events are byte-identical.
	 */
	const DEALT_SYMBOLS = [...LINE_POOL, ...(scatterEnabled ? ['SCAT'] : [])];
	const EFFECTIVE_PAY_TABLE = Object.fromEntries(
		LINE_POOL.map((symbol) => [symbol, payRowOf(evalOpts, symbol)]).filter(([, row]) => row),
	);

	// Stacked-picture test mode (docs/design/stacked-picture-mode.md): deal contiguous high-symbol
	// runs + a full-height WILD so the engine's stacked-picture reel mode has data to render. Opt-in
	// (`STACKED=1` env or `createMockRgs({ stacked: true })`); OFF ⇒ the normal weighted deal.
	const stackedDeal = opts.stacked === true || process.env.STACKED === '1';
	/**
	 * Emit the cascade presentation fixture on every spin — see the note at its emit site.
	 *
	 * An EXPLICIT `opts.cascade` always wins, including `false`. That matters because one
	 * Invisible Test Server process serves EVERY game: a purely env-driven flag would cascade
	 * `bookofborutremake` too, which is a shipped game. The server therefore decides per game and
	 * passes a boolean; the bare `CASCADE=1` env stays for the standalone CLI, where there is only
	 * one game and no ambiguity.
	 */
	const cascadeFixture = opts.cascade ?? process.env.CASCADE === '1';

	/**
	 * The multiplier-COLLECT fixture — scatter's second mechanic, riding on the cascade.
	 *
	 * Gated on all three of: a `scatter` win model, the cascade being on (multipliers land IN a
	 * tumble, so with no tumble there is nothing to land in), and the project actually declaring
	 * a multiplier symbol IN PLAY (`opts.multiplier`, set at publish from `special_properties`).
	 * That last gate is what stops a project with no multiplier art having blank cells dealt at
	 * it — and it is a project-level fact rather than a hardcoded symbol id, for the same reason
	 * the client tests `RawSymbol.multiplier !== undefined` instead of `name === 'M'`.
	 */
	const collectFixture = winModel === 'scatter' && cascadeFixture && opts.multiplier === true;

	/**
	 * Does this game cascade because of WHAT IT IS, rather than because a demo flag asked it to?
	 * It decides one thing: whether a spin that paid NOTHING still tumbles (a demo does, so the
	 * overlay is visible; a real tumble game does not).
	 *
	 * The answer is WHO TURNED THE CASCADE ON, not which win model is in play. Keying it off
	 * `cluster`/`scatter` alone was wrong the moment a project could author its own answer: a `ways`
	 * game with `cascade: true` in its Game Config is a tumble game by its author's own declaration,
	 * yet it fell through to the demo pass and blew the most COMMON symbol off the board — twice —
	 * on every losing spin. Measured on the live `test6`: 20 of 20 dead spins tumbled, which reads to
	 * the player as a win that paid nothing. The demo pass is now reachable only by the route it was
	 * built for — the bare `CASCADE=1` / `CASCADE_GAMES` demo flag over a game that does not tumble
	 * on its own (`opts.cascadeDemo`, set by the test server, which is the side that knows WHY).
	 */
	const cascadeIsDemo = opts.cascadeDemo ?? opts.cascade === undefined;
	const nativeCascade =
		cascadeFixture && !(cascadeIsDemo && winModel !== 'cluster' && winModel !== 'scatter');

	/**
	 * The mock's SERVER name for a multiplier cell, and the values it deals.
	 *
	 * ⚠️ The wire shape is OURS, like `tumbleStep`: a cell reads `MULT:<value>`, because the reels
	 * are a `string[][]` and the value has to ride WITH the cell. A side table of positions would
	 * have to be kept in step with every refill, and would desync the first time one moved. The
	 * facade splits on the colon; nothing else in this protocol uses one.
	 */
	const MULT_SYMBOL = 'MULT';
	const MULT_VALUES = [2, 3, 5, 10];
	/** Roughly one refilled cell in six carries a multiplier — enough to see the beat most spins. */
	const MULT_RATE = 1 / 6;

	/**
	 * RUNAWAY GUARD — the bound that stops an infinite loop, deliberately far above anything
	 * gameplay should reach.
	 *
	 * It was 12, and that was wrong in a way worth recording: a cap low enough to be hit is a cap
	 * that SHAPES the game, and the shape it makes is the one thing a cascade must never do —
	 * come to rest on a board that is still paying. The player watches winners sit there unlit and
	 * concludes the game is broken. On the live `test5` it fired on 99.8% of spins.
	 *
	 * The real problem there was never the cap: `minCount 9` on a 64-cell board means every symbol
	 * clears the threshold on a typical deal, so the chain genuinely never ends. A cap cannot fix
	 * broken math, it can only hide it — and hiding it cost a day of hunting a presentation bug
	 * that was a config bug. So the bound moves out of the way, and a game that still reaches it
	 * is told, loudly, that its CONFIG is the problem and which tool measures it.
	 *
	 * A correctly configured scatter game does not come close: measured on the committed template,
	 * chains average well under one tumble.
	 */
	const CASCADE_RUNAWAY_GUARD = 200;

	/**
	 * Score a board the way THIS game's win model scores it — the same switch the spin uses, lifted
	 * out so the cascade chain below cannot drift from it. A second implementation of "what pays" is
	 * exactly how a mock quietly stops describing the game.
	 *
	 * Deliberately EXCLUDES the SCAT free-spin trigger. Whether scatters landing mid-cascade should
	 * retrigger is a game-math decision no capture has answered, and quietly saying yes here would
	 * change how often the bonus fires; the trigger stays scored on the dealt board only.
	 */
	/**
	 * Round a win list to whole CENTS — the mock’s OWN wire boundary, and deliberately NOT inside the
	 * evaluators.
	 *
	 * The evaluators are exported and SHARED: `tools/game-config-spike/scatterCrosscheck.ts` and
	 * `waysCrosscheck.ts` import them and assert, board by board, that the mock scores exactly what
	 * the RTP verifier (`scattermath` / `waysmath`) scores — the same tool the runaway-cascade warning
	 * tells you to run. Rounding INSIDE them broke that: the verifier stayed exact while the mock
	 * rounded, so a `0.5` multiplier row read `1.0` from the mock and both harnesses started failing
	 * on every fractional row — i.e. the thing that measures RTP stopped measuring the dealt game.
	 *
	 * Whole cents are a property of the PROTOCOL (`session.balance` is integer cents), not of the
	 * maths. So the rounding belongs HERE, where a win becomes a payout, and the pure scorers stay
	 * comparable to the tools that verify them. Everything downstream — the chain's `runningWin`,
	 * `gameEnd`, the collect and the balance — derives from these rounded wins, so nothing fractional
	 * escapes.
	 */
	const roundPays = (wins) => wins.map((win) => ({ ...win, pay: payCents(win.pay) }));

	const evaluatePayWins = (board, round) => roundPays(evaluateRawWins(board, round));

	/**
	 * The stake a paytable multiplier is quoted against — the SERVER side of the client's
	 * `payoutDivisor()` (`engine-game/src/game/gameConfig.ts`). It MUST mirror it, or the info page
	 * prices a win differently from the wallet that credits it:
	 *
	 *   lines   → per LINE (`total / numLines`, which IS `betPerLine`)
	 *   ways    → per WAY  (`total / waysCount` — a uniform 5×3 board pays 243 ways)
	 *   cluster → the whole bet (divisor 1)
	 *   scatter → the whole bet (divisor 1)
	 *
	 * `ways` and `cluster` both used to take a per-LINE slice, and for a paylines-less model that
	 * slice was against PHANTOM regenerated lines — so a ways win paid a multiple of what its own
	 * paytable quoted. The base may be fractional (a 243-way slice of a whole-cent stake usually is)
	 * and that is deliberate: rounding it would distort every payout by up to a cent per win. The
	 * rounding belongs on the PAY, once, at the wire — see `roundPays`.
	 */
	const payoutBaseFor = (round) => {
		if (winModel === 'ways') return round.total / waysCount;
		if (winModel === 'cluster' || winModel === 'scatter') return round.total;
		return round.betPerLine;
	};

	const evaluateRawWins = (board, round) => {
		const base = payoutBaseFor(round);
		if (winModel === 'ways') return evaluateWays(board, base, wild, evalOpts);
		if (winModel === 'cluster')
			return evaluateClusters(board, base, wild, { ...clusterOpts, ...evalOpts });
		if (winModel === 'scatter')
			return evaluateScatterPays(board, base, wild, { ...scatterPaysOpts, ...evalOpts });
		return evaluatePaylines(board, base, paylines, wild, evalOpts);
	};

	/**
	 * The cells a win list actually paid on, in the mock's own VISIBLE-grid coordinates (the client
	 * shifts them by its board padding).
	 *
	 * A flat `{reel,row}` context names them directly (cluster / ways / scatter-pays); a payline
	 * context names the whole line, of which only the leftmost `occurs` reels pay — the same slice
	 * the client lights.
	 *
	 * The SCAT trigger/pay win is skipped by WHAT IT IS, so the scatters are never blown off a board
	 * that is triggering. It used to be excluded by shape instead — its context was wrapped in a
	 * `{ positions }` object no reader here understood — but the facade could not read that shape
	 * either, so the scatter cells never reached the client at all. Exclude here, emit there.
	 */
	const payingCells = (wins) => {
		const seen = new Set();
		const cells = [];
		for (const win of wins) {
			if (win.mode === 'scatter' && win.what === 'SCAT') continue;
			const ctx = win.context;
			const list = Array.isArray(ctx)
				? ctx
				: Array.isArray(ctx?.payline)
					? ctx.payline.slice(0, win.occurs).map((row, reel) => ({ reel, row }))
					: [];
			for (const { reel, row } of list) {
				const key = `${reel}:${row}`;
				if (seen.has(key)) continue;
				seen.add(key);
				cells.push({ reel, row });
			}
		}
		return cells;
	};

	/**
	 * THE CASCADE CHAIN: winners leave, survivors fall, the gaps refill — and the NEW board is scored
	 * again, for as long as it keeps paying.
	 *
	 * This used to stop after one step, and that was a real defect rather than a simplification: a
	 * player could read eight matching symbols off the settled board and watch nothing happen. The
	 * one-shot made sense only while the cascade was a presentation fixture with no evaluator behind
	 * it — the mock paid paylines and could not score a cluster or a scatter board at all. Once
	 * `evaluateClusters` / `evaluateScatterPays` landed, refusing to re-score was just wrong.
	 *
	 * THE CELLS THAT PAID ARE THE CELLS THAT EXPLODE, at every step. The client narrates a win over
	 * the cells it was told paid, so exploding anything else shows a win frame around symbols that
	 * survive and survivors falling out of a frame that stays.
	 *
	 * Each step carries the wins of the board it PRODUCED, not the ones it destroyed. That is what
	 * lets the facade narrate each step's payout on the board it belongs to: the dealt board's wins
	 * ride the ordinary spin flush, and every later board's wins are flushed straight after the
	 * tumble that revealed it.
	 *
	 * ⚠️ The wire shape is OURS, not a capture — see the emit site.
	 */
	const cascadeSteps = (reels, wins, round) => {
		const steps = [];
		let board = reels.map((reel) => [...reel]);
		let runningWin = wins.reduce((sum, w) => sum + w.pay, 0);

		/**
		 * One refilled cell. With the collect fixture on, some arrive carrying a multiplier — which
		 * is how a scatter game lands them: DURING a tumble, into the gap the winners left behind.
		 */
		const pickRefill = () =>
			collectFixture && nextRand() < MULT_RATE
				? `${MULT_SYMBOL}:${MULT_VALUES[Math.floor(nextRand() * MULT_VALUES.length)]}`
				: pickCell();

		/** Blow the named cells out of `board`, drop the survivors, refill from the top. */
		const applyExplosion = (exploding) => {
			const gone = new Set(exploding.map((p) => `${p.reel}:${p.row}`));
			const newSymbols = board.map((reel, r) =>
				Array.from({ length: reel.filter((_, row) => gone.has(`${r}:${row}`)).length }, () =>
					pickRefill(),
				),
			);
			board = board.map((reel, r) => [
				...newSymbols[r],
				...reel.filter((_, row) => !gone.has(`${r}:${row}`)),
			]);
			return newSymbols;
		};

		let pending = wins;
		let capped = false;
		for (;;) {
			const exploding = payingCells(pending);
			if (!exploding.length) break;
			if (steps.length >= CASCADE_RUNAWAY_GUARD) {
				capped = true;
				break;
			}
			const newSymbols = applyExplosion(exploding);
			// Score what just fell in. This is the line the old one-shot refused to run.
			const boardWins = evaluatePayWins(board, round);
			runningWin += boardWins.reduce((sum, w) => sum + w.pay, 0);
			steps.push({ exploding, newSymbols, wins: boardWins, runningWin });
			pending = boardWins;
		}

		// Reaching the guard is a statement about the CONFIG, not a routine truncation, so it says
		// so and names the tool that measures it rather than logging a bare number.
		if (capped) {
			console.warn(
				`[${label}] cascade ran ${CASCADE_RUNAWAY_GUARD} tumbles without settling — the board is ` +
					'STILL paying and the chain was cut off. This is a MATH problem, not a presentation ' +
					'one: a win threshold at or below the average symbol count per board means every ' +
					'board pays, forever. Measure it with ' +
					'`pnpm --filter game-config-spike run scattermath -- --config <doc>`.',
			);
		}

		// A DEAD SPIN on a game whose cascade was forced on for the demo (`CASCADE_GAMES` over a
		// lines/book game) still gets the old most-common-symbol pass, so the overlay is exercisable
		// with no win — the reason the fixture existed at all. A cluster/scatter game does NOT: for
		// those the cascade is the mechanic, and a real tumble game whose spin paid nothing simply
		// sits there. Blowing up non-paying symbols was the tell that this was a demo, not a game.
		if (!steps.length && !nativeCascade) {
			const counts = new Map();
			for (const reel of reels) {
				for (const cell of reel) {
					if (cell === 'SCAT' || cell === 'WILD') continue;
					counts.set(cell, (counts.get(cell) ?? 0) + 1);
				}
			}
			let target = null;
			let best = 0;
			for (const [name, n] of counts) if (n > best) (best = n), (target = name);
			if (target) {
				for (let step = 0; step < 2; step++) {
					const exploding = [];
					board.forEach((reel, r) => {
						reel.forEach((cell, row) => {
							if (cell === target) exploding.push({ reel: r, row });
						});
					});
					if (!exploding.length) break;
					const newSymbols = applyExplosion(exploding);
					// `demo: true` marks a step that is DECORATION: it explodes symbols nothing paid on,
					// so it adds no win. It still carries the round's running total rather than 0 — a
					// spin can pay a SCAT trigger (which names no cells, so it cascades nothing) and
					// then take this path, and reporting 0 there would step the meter backwards.
					steps.push({ exploding, newSymbols, wins: [], runningWin, demo: true });
				}
			}
		}

		steps.finalBoard = board;
		steps.chainWin = runningWin;
		return steps;
	};

	/**
	 * The collect beat, read off the board the cascade FINISHED on — the same board the client is
	 * looking at when this fires, which is what makes `multiplierBoardInit` (which re-reads the
	 * settled board rather than trusting the event's positions) agree with it.
	 *
	 * The multipliers SUM. That is a choice, not a capture: it is what the reference game's
	 * `boardMult` does, and it keeps a two-multiplier board meaningfully better than a
	 * one-multiplier board without the runaway a product gives. Returns `null` when there is
	 * nothing to say — no multipliers, or no win for them to multiply, because a collect that
	 * turns 0 into 0 is a cinematic about nothing.
	 */
	const collectStep = (finalBoard, tumbleWin) => {
		if (!collectFixture || !finalBoard || tumbleWin <= 0) return null;
		const positions = [];
		finalBoard.forEach((reel, r) => {
			reel.forEach((cell, row) => {
				if (typeof cell !== 'string' || !cell.startsWith(`${MULT_SYMBOL}:`)) return;
				const multiplier = Number(cell.slice(MULT_SYMBOL.length + 1));
				if (Number.isFinite(multiplier) && multiplier > 0) {
					positions.push({ reel: r, row, multiplier });
				}
			});
		});
		if (!positions.length) return null;
		const boardMult = positions.reduce((sum, p) => sum + p.multiplier, 0);
		return { positions, tumbleWin, boardMult, totalWin: tumbleWin * boardMult };
	};
	// PICs that the lines facade maps to HIGH symbols (PIC1..PIC4 → H1..H4); WILD → W. These are the
	// symbols the mode stacks, so the test deal draws runs of them — intersected with the allowed pool
	// so a restricted project never stacks an out-of-play symbol (fall back to the full line pool).
	const STACK_PICS_ALL = ['PIC1', 'PIC2', 'PIC3', 'PIC4'];
	const stackPicsInPool = STACK_PICS_ALL.filter((s) => LINE_POOL.includes(s));
	const STACK_PICS = stackPicsInPool.length ? stackPicsInPool : LINE_POOL;

	/** sid -> { balance, round | null, configSent } */
	const sessions = new Map();
	const getSession = (sid) => {
		if (!sessions.has(sid)) {
			sessions.set(sid, { balance: startBalance, round: null, configSent: false });
		}
		return sessions.get(sid);
	};

	let rngState = seed ? hashStr(seed) : Date.now() >>> 0;
	const nextRand = () => {
		rngState = (rngState * 1664525 + 1013904223) >>> 0;
		return rngState / 0x100000000;
	};
	const pickSymbol = () => {
		// Weighted draw favouring low-pay symbols, occasional scatter, rare PIC7. Scatter is emitted
		// only when in play (`scatterEnabled`). Under a per-project restriction the rank-weighted
		// distribution below assumes the full PIC1..PIC7 set, so a restricted pool draws uniformly from
		// its allowed line symbols instead. Unrestricted + scatter-enabled ⇒ byte-identical RNG stream.
		const r = nextRand();
		if (scatterEnabled && r < 0.04) return 'SCAT';
		if (restrictSymbols) return LINE_POOL[Math.floor(nextRand() * LINE_POOL.length)];
		if (r < 0.4) return LINE_SYMBOLS[Math.floor(nextRand() * 3)]; // PIC1/2/3
		if (r < 0.75) return LINE_SYMBOLS[3 + Math.floor(nextRand() * 2)]; // PIC4/5
		if (r < 0.95) return LINE_SYMBOLS[5 + Math.floor(nextRand() * 1)]; // PIC6
		return 'PIC7';
	};
	// When a project has a wild in play, sprinkle `WILD` into the weighted draw at a low rate so lines
	// land often enough to see W pay without swamping the board. Gated so a wild-less game keeps the
	// EXACT same RNG stream as before (no extra `nextRand` call) — default deals stay byte-identical.
	const WILD_RATE = 0.05;
	const pickCell = wild ? () => (nextRand() < WILD_RATE ? 'WILD' : pickSymbol()) : pickSymbol;
	/** reelCount reels, each dealing ITS OWN visible rows. Uniform ⇒ every column is `rowCount` deep
	 *  and the RNG stream is byte-identical to before; stepped ⇒ a short column draws fewer cells,
	 *  because dealing it a full-height column and letting the client discard the overflow is how the
	 *  server and the board end up disagreeing about what was scored. */
	const spinReels = () =>
		Array.from({ length: reelCount }, (_unused, reel) =>
			Array.from({ length: rowHeights[reel] }, pickCell),
		);

	/**
	 * Stacked-picture test deal — engineered to showcase ALL crops every spin (the real math rarely
	 * lands a partial at a board edge, which is the whole reason this mode exists):
	 *  • reel 0    → a partial WILD run pinned to the TOP edge ⇒ the engine draws the BOTTOM of the tall
	 *    Wild with its top running off-screen above (a top cutoff).
	 *  • reel 1    → a partial WILD run pinned to the BOTTOM edge ⇒ the TOP of the Wild with its bottom
	 *    running off-screen below (a bottom cutoff).
	 *  • last reel → a full-height WILD column ⇒ the whole picture (contrast).
	 *  • middle reels → an occasional random high-symbol run for variety.
	 * WILD is the tallest picture (height ≫ a 2–3 cell run), so a short WILD run is ALWAYS a partial
	 * regardless of the project's authored heights — the cutoffs are guaranteed, not probabilistic.
	 * Non-run cells fall back to the normal weighted draw. Only used when `stackedDeal` is on.
	 */
	const partialWildLen = (height) =>
		Math.max(2, Math.min(height - 1, 2 + Math.floor(nextRand() * 2))); // 2..3, < that column's rows
	const spinReelsStacked = () =>
		Array.from({ length: reelCount }, (_ignored, reel) => {
			// Every bound below is THIS column's height, so the engineered top/bottom cutoffs land on
			// the edges of the column the player actually sees. Uniform ⇒ identical to `rowCount`.
			const rowCount = rowHeights[reel];
			const column = Array.from({ length: rowCount }, pickSymbol);
			// Last reel: the whole 5-tall Wild (checked first so a 1- or 2-reel grid still gets a full stack).
			if (reel === reelCount - 1) return Array.from({ length: rowCount }, () => 'WILD');
			// Reel 0: partial WILD pinned to the TOP edge (rows 0..len-1) ⇒ bottom-of-picture cutoff.
			if (reel === 0 && rowCount >= 2) {
				const len = partialWildLen(rowCount);
				for (let i = 0; i < len; i++) column[i] = 'WILD';
				return column;
			}
			// Reel 1: partial WILD pinned to the BOTTOM edge (last len rows) ⇒ top-of-picture cutoff.
			if (reel === 1 && rowCount >= 3) {
				const len = partialWildLen(rowCount);
				for (let i = 0; i < len; i++) column[rowCount - len + i] = 'WILD';
				return column;
			}
			// Middle reels: an occasional random high-symbol run (partial or full, per its own height).
			if (nextRand() < 0.7) {
				const symbol = STACK_PICS[Math.floor(nextRand() * STACK_PICS.length)];
				const maxRun = Math.max(2, rowCount);
				const runLength = Math.min(maxRun, 2 + Math.floor(nextRand() * (rowCount - 1)));
				const start = Math.floor(nextRand() * (rowCount - runLength + 1));
				for (let i = 0; i < runLength; i++) column[start + i] = symbol;
			}
			return column;
		});

	const handleEngine = async (req, res, url) => {
		const sid = url.searchParams.get('sid');
		const seq = Number(url.searchParams.get('seq') ?? 0);
		const gid = url.searchParams.get('gid');

		if (!sid)
			return sendJson(req, res, 400, { error: { code: 'ERR_VAL', message: 'missing sid' } });

		const session = getSession(sid);
		const bodyText = await readBody(req);
		let actions;
		try {
			actions = bodyText ? JSON.parse(bodyText) : [];
		} catch {
			return sendJson(req, res, 400, {
				error: { code: 'ERR_VAL', message: 'body must be JSON array' },
			});
		}
		if (!Array.isArray(actions)) {
			return sendJson(req, res, 400, {
				error: { code: 'ERR_VAL', message: 'body must be an array' },
			});
		}

		if (!quiet) {
			console.log(
				`[${label}] sid=${sid} seq=${seq} gid=${gid ?? '-'} actions=${JSON.stringify(actions.map((a) => a.action))}`,
			);
		}

		const events = [];

		// Emit the boot `config` event once per session — first response gets it.
		// Faithful to Play4Fun's wire format (symbols/window/paylines/wildSymbols/
		// paytable). The facade captures it for cross-checks + reveal filtering.
		if (!session.configSent) {
			session.configSent = true;
			events.push({
				event: 'config',
				context: {
					// `MULT` is declared only when the collect fixture can deal it, so the facade's
					// unknown-symbol warning stays meaningful for every other game.
					symbols: [
						...DEALT_SYMBOLS,
						...(wild ? ['WILD'] : []),
						...(collectFixture ? [MULT_SYMBOL] : []),
					],
					// `rows` stays the BOUNDING BOX (the tallest column), which is what every existing
					// reader means by it. `rowsPerReel` is added only for a STEPPED board, so a uniform
					// game's config event is byte-identical to before — and a client that has never
					// heard of stepped grids keeps reading `rows` and behaves exactly as it does today.
					window: {
						reels: reelCount,
						rows: rowCount,
						...(isStepped ? { rowsPerReel: rowHeights } : {}),
					},
					paylines,
					wildSymbols: wild ? ['WILD'] : [],
					paytable: Object.fromEntries(
						Object.entries(
							wild ? { ...EFFECTIVE_PAY_TABLE, WILD: wild.paytable } : EFFECTIVE_PAY_TABLE,
						).map(([sym, byCount]) => {
							const counts = Object.keys(byCount)
								.map(Number)
								.sort((a, b) => a - b);
							return [
								sym,
								{
									occurs: counts,
									pay: counts.map((c) => byCount[c]),
								},
							];
						}),
					),
				},
			});
		}

		// Heartbeat: empty body returns balance only (plus config if first call).
		if (actions.length === 0) {
			return sendJson(req, res, 200, { events, platform: { balance: session.balance } });
		}

		let pendingRound = session.round; // copy reference; may mutate

		for (const a of actions) {
			switch (a.action) {
				case 'bet': {
					const ctx = Array.isArray(a.context) ? a.context : [5, 1];
					const [linesOrConfig, betPerLine] = [Number(ctx[0]) || 5, Number(ctx[1]) || 1];
					const total = linesOrConfig * betPerLine;
					if (session.balance < total) {
						return sendJson(req, res, 200, {
							result: 0,
							error: 'insufficient balance',
							errorCode: 200, // speculative — confirm if/when we capture a real one
							platform: { balance: session.balance },
						});
					}
					session.balance -= total;
					pendingRound = {
						id: makeRoundId(),
						betPerLine,
						linesOrConfig,
						total,
						win: 0,
						reels: null,
						closed: false,
					};
					events.push({
						event: 'bet',
						context: { total, betPerLine, paylines, maxWinCap: 0 },
					});
					events.push({ event: 'gameStart', context: { totalBet: total, betPerLine } });
					break;
				}
				case 'play': {
					if (!pendingRound) {
						return sendJson(req, res, 200, {
							result: 0,
							error: 'error executing requested actions: play without bet',
							errorCode: 110,
							platform: {},
						});
					}
					const reels = stackedDeal ? spinReelsStacked() : spinReels();
					pendingRound.reels = reels;
					const lineWins = evaluatePayWins(reels, pendingRound);
					const rawScatterWin = evaluateScatters(reels, pendingRound.total);
					// Same boundary: the scatter TRIGGER pay is a payout like any other.
					const scatterWin = rawScatterWin ? roundPays([rawScatterWin])[0] : rawScatterWin;
					const wins = scatterWin ? [...lineWins, scatterWin] : lineWins;
					const totalWin = wins.reduce((s, w) => s + w.pay, 0);
					pendingRound.win = totalWin;

					events.push({
						event: 'spinStart',
						context: {
							symbols: wild ? [...DEALT_SYMBOLS, 'WILD'] : DEALT_SYMBOLS,
							symbolsPay: {
								line: wild ? [...LINE_POOL, 'WILD'] : LINE_POOL,
								scatter: scatterEnabled ? ['SCAT'] : [],
							},
							wildSymbols: wild ? ['WILD'] : [],
							lineAlign: 'left',
							lineCoinciding: LINE_COINCIDING,
						},
					});
					for (const w of wins) events.push({ event: 'spinWin', context: w });
					events.push({ event: 'playedSpin', context: reels });
					// PRESENTATION FIXTURE, opt-in and off by default (`CASCADE=1`, same idiom as
					// `FORCE_TRIGGER` / `BIG_WIN` / `STACKED`). It exists so the cascade overlay has
					// something to play against — before this, `TumbleBoard` could not be seen at all,
					// because no RGS the engine talks to sends a tumble.
					//
					// ⚠️ NOT A PROTOCOL CLAIM. There is no capture of a real cascade game, so this shape
					// is OURS, invented for the fixture. Everything else in this mock is faithful to a
					// captured Play4Fun session; this is the one part that is not, which is exactly why it
					// is gated off and labelled. A real provider's cascade almost certainly looks different
					// — treat this as the thing that proves the PRESENTATION works, never as the wire.
					// The round payout, which the collect beat may MULTIPLY. Kept separate from
					// `totalWin` (what the wins themselves add up to) so the two cannot drift: the meter,
					// `gameEnd`, `gameRoundOver` and the balance all read this one.
					let roundWin = totalWin;
					if (cascadeFixture) {
						const steps = cascadeSteps(reels, wins, pendingRound);
						for (const step of steps) {
							events.push({ event: 'tumbleStep', context: step });
						}
						// The chain pays the sum of every board it scored, not just the dealt one.
						roundWin = steps.chainWin;
						// Multipliers landed in the refills → collect them. Emitted AFTER the last tumble
						// and BEFORE `gameEnd`, because the client re-reads the SETTLED board to find
						// them: firing it earlier would collect off a board about to be destroyed. It
						// multiplies the WHOLE chain, which is what makes the beat feel like a payoff.
						const collect = collectStep(steps.finalBoard, roundWin);
						if (collect) {
							events.push({ event: 'multiplierCollect', context: collect });
							roundWin = collect.totalWin;
						}
					}
					pendingRound.win = roundWin;
					events.push({ event: 'gameEnd', context: { win: roundWin } });

					// Round-close rules (from real captures):
					//   - play.context = '' (or undefined): auto-collect.
					//   - play.context = null: leave round open IFF there's a win to collect.
					//     If win = 0, the server auto-closes even with null context
					//     (nothing to collect → no point keeping the round open).
					const explicitAutoCollect = a.context === '' || a.context === undefined;
					const zeroWinAutoClose = a.context === null && roundWin === 0;
					if (explicitAutoCollect || zeroWinAutoClose) {
						session.balance += roundWin;
						events.push({ event: 'gameRoundOver', context: { win: roundWin } });
						pendingRound.closed = true;
					}
					break;
				}
				case 'collect': {
					if (!pendingRound || pendingRound.id !== gid) {
						return sendJson(req, res, 200, {
							result: 0,
							error:
								'error executing requested actions: unexpected action: collect (was expecting: play)',
							errorCode: 110,
							platform: {},
						});
					}
					if (!pendingRound.closed) {
						session.balance += pendingRound.win;
						pendingRound.closed = true;
					}
					events.push({ event: 'gameRoundOver', context: { win: pendingRound.win } });
					break;
				}
				default:
					return sendJson(req, res, 200, {
						result: 0,
						error: `error executing requested actions: unknown action: ${a.action}`,
						errorCode: 110,
						platform: {},
					});
			}
		}

		// Settle session.round state
		if (pendingRound && pendingRound.closed) {
			session.round = null;
		} else if (pendingRound) {
			session.round = pendingRound;
		}

		const platform = { balance: session.balance };
		if (pendingRound) {
			platform.gameRound = { updating: true, id: pendingRound.id };
		}

		return sendJson(req, res, 200, { events, platform });
	};

	/** Path-agnostic dispatcher. `url` is a parsed URL; routes match by suffix. */
	const handle = async (req, res, url) => {
		if (req.method === 'OPTIONS') return sendCorsPreflight(req, res);

		if (req.method === 'GET' && pathEndsWith(url.pathname, '/healthz')) {
			return sendJson(req, res, 200, { ok: true, sessions: sessions.size });
		}

		if (req.method === 'GET' && pathEndsWith(url.pathname, '/state')) {
			const sid = url.searchParams.get('sid');
			if (!sid) return sendJson(req, res, 400, { error: 'missing sid' });
			return sendJson(req, res, 200, getSession(sid));
		}

		if (req.method === 'POST' && pathEndsWith(url.pathname, '/rgs/engine')) {
			try {
				return await handleEngine(req, res, url);
			} catch (err) {
				console.error(`[${label}] handler error:`, err);
				return sendJson(req, res, 500, { error: { code: 'ERR_UE', message: String(err) } });
			}
		}

		return sendJson(req, res, 404, { error: 'not found' });
	};

	return { handle, sessions, startBalance, seed };
}

// ---------- standalone CLI entry (local dev) ----------

const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
	const PORT = Number(process.env.PORT ?? 7777);
	// Deal the game's grid so the mock matches the client. A 5-row CLIENT fed a 3-row deal renders
	// only 4 rows on landing (the padded reveal is 2 cells short of the 5+2 a 5-row board needs), so
	// set `ROWS`/`REELS` to the game's `numReels`/`numRows` when testing a resized board.
	const envInt = (name) => {
		const n = Number(process.env[name]);
		return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
	};
	// `ROWS` takes a single height (`ROWS=5`) or a per-reel list for a STEPPED grid
	// (`ROWS=3,4,5,4,3`), so a diamond board can be dealt from the CLI without a published project.
	// A single value parses to a number, exactly as before.
	const envRows = () => {
		const raw = (process.env.ROWS ?? '').trim();
		if (!raw) return undefined;
		if (!raw.includes(',')) return envInt('ROWS');
		const list = raw
			.split(',')
			.map((part) => Number(part.trim()))
			.filter((n) => Number.isFinite(n) && n > 0)
			.map(Math.floor);
		return list.length ? list : undefined;
	};
	const mock = createMockRgs({ label: 'mock', reels: envInt('REELS'), rows: envRows() });
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	server.listen(PORT, () => {
		// Standard Invisible Wall startup banner (compact corner bracket).
		console.log(
			[
				'',
				'   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
				'   ┃   I N V I S I B L E   W A L L   S L',
				'   ┃   ────────────────────────────────────────',
				'   ┃   MOCK RGS   ·   Play4Fun',
				'   ┃',
				`        http://localhost:${PORT}   ·   Ctrl+C to stop`,
				'',
			].join('\n'),
		);
		console.log(`[mock] Play4Fun RGS mock listening on http://localhost:${PORT}`);
		console.log(
			`[mock] starting balance: ${mock.startBalance}, seed: ${mock.seed ?? '(time-based)'}`,
		);
		console.log(`[mock] try: curl -X POST http://localhost:${PORT}/rgs/engine?sid=test`);
	});
}
