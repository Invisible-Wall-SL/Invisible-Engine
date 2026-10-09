/**
 * Mock Play4Fun RGS server.
 *
 * Speaks the /rgs/engine batched-action protocol we captured from a real
 * Hot Fruits session. No auth, no Cloudflare, CORS-permissive — meant for
 * local development of the translator and engine wiring.
 *
 * Two bet shapes, as the partner has (docs/reference/play4fun-protocol.md, "The first bet argument"):
 *   - a LINE-CONFIG game (the default, Hot Fruits): no `betOptions`, and `bet` is `[lines, betPerLine]`;
 *   - a TABLE game, when the project sells an ante or a buy (`opts.betModes`): the config declares
 *     `betOptions`, `bet [x, M]` costs `betOptions[x] × M` with x an option index, an index outside
 *     the table is refused, and a bought option enters the feature. Its config is sent only when a
 *     client asks (`config`), each session is priced by the table it was told (`tableFor`), and a
 *     session that never asked cannot bet. Wins are priced on the BASE stake either way, so a buy's
 *     premium buys the feature, never a bigger win.
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
 *   WIN_MODEL=lines           lines | ways | cluster | scatter — HOW a spin is priced. Fatal on a
 *                             typo (a silent lines deal is indistinguishable from a broken evaluator)
 *   REELS=5 · ROWS=3          the dealt grid; `ROWS=3,4,5,4,3` deals a STEPPED board
 *   MIN_CLUSTER=5 · ADJACENCY=orthogonal   cluster shape (WIN_MODEL=cluster)
 *   MIN_COUNT=8               scatter-pays floor (WIN_MODEL=scatter)
 *   FORCE_TRIGGER=1 · STACKED=1 · CASCADE=1 · MULTIPLIER=1   outcome/presentation forcing
 *   WIN_X=10,20,40            the n-th base spin pays ≥ WIN_X[n] × the stake (`parseWinX`)
 *   BUY=1                     a TABLE game selling the default template's buy (`bonus`, 100×)
 *
 * Endpoints:
 *   POST …/rgs/engine?sid=&seq=&gid=    — main batched-action endpoint
 *   GET  …/healthz                       — { ok: true }
 *   GET  …/state?sid=                    — debug: dump session state
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { createPlatformJackpot } from './mock-platform-jackpot.mjs';

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
/**
 * Every way this mock can DECIDE a win. One list, read by both `createMockRgs` (which falls back to
 * `lines` for anything else) and the CLI's `WIN_MODEL` validator (which refuses anything else) — a
 * second copy is how a typo becomes a silent lines deal on a game that was asked for ways.
 */
const WIN_MODELS = ['lines', 'ways', 'cluster', 'scatter'];
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

/** Free-spin feature. A lines game triggers on a symbol COUNT alone — FS_TRIGGER_MIN+ SCAT unless
 *  the project states its own rule (`opts.freeSpinsTrigger`). Only a game with an expanding special
 *  (`opts.expandingSymbol`) emits `pickRandomly` (→ the `setExpandingSymbol` book event). The free
 *  spins are otherwise the same multi-request round the facade already drives off `enterBonus`. */
const FS_TRIGGER_MIN = 3;
const TOTAL_FS = 10;
/** Extra free spins when the trigger lands again DURING a free spin. */
const RETRIGGER_FS = 5;
/** Fewest reels an expanding special covers to expand, when its candidate names no threshold —
 *  game-config's `DEFAULT_EXPAND_MIN_REELS`. */
const DEFAULT_EXPAND_MIN_REELS = 3;

/**
 * The most free spins ONE round may reach — its entry award plus every retrigger — on every mock that
 * deals free spins (this one and `mock-rgs-server-book.mjs`). A retrigger that would take the round
 * past it awards nothing: no `retrigger` event, the counter runs down, and the round ends, so a
 * feature always closes. Without it an authorable trigger count can make a retrigger, on average,
 * add more spins than the spin used — one measured round at two books never ended. High enough that
 * a game on its default rule never meets it (a default Book-of round reached 60 in the parity
 * transcripts), so every un-authored deal is unchanged. Award rows are held to it too
 * (`awardTableOf`). An imported reels mode keeps its own, lower limit (`MAX_STRIPS_ROUND_SPINS`).
 * game-config's `MAX_FREE_SPINS_PER_ROUND` is the same number
 * (`/config` refuses a row above it); `check:freespins` holds the two equal.
 */
export const MAX_ROUND_FREE_SPINS = 200;

/**
 * The most spins an imported reels mode's round may reach through retriggers — lower than every
 * round's `MAX_ROUND_FREE_SPINS`. Its spins are drawn from its cosmetic padding strips, which can
 * stack scatters far denser than a real reel set — one measured round chained 111 retriggers into the
 * facade's play guard and never ended. Shared by every host of the pots overlay.
 */
export const MAX_STRIPS_ROUND_SPINS = 50;

/**
 * HOW MANY free spins the feature awards — the project's tables when it states them
 * (`freeSpinsAwards`), else `spins` (the mock's own default) whatever the count. A row awards for
 * its own trigger count and up, to the next row; with `random` on, a row with a range awards a
 * uniform whole number across it (both ends included). Module scope so the book mock deals awards
 * by the same rule (`mock-rgs-server-book.mjs`).
 */
export const awardTableOf = (rows, spins, triggerMin) => {
	const usable = (Array.isArray(rows) ? rows : [])
		.filter(
			(row) =>
				Number.isInteger(row?.count) &&
				row.count >= 1 &&
				Number.isInteger(row.spins) &&
				row.spins >= 1,
		)
		.map(({ count, spins: rowSpins, maxSpins }) => {
			const low = Math.min(rowSpins, MAX_ROUND_FREE_SPINS);
			return Number.isInteger(maxSpins) && maxSpins > low
				? { count, spins: low, maxSpins: Math.min(maxSpins, MAX_ROUND_FREE_SPINS) }
				: { count, spins: low };
		})
		.sort((a, b) => a.count - b.count);
	return usable.length ? usable : [{ count: triggerMin, spins }];
};

/**
 * The row that awards for `landed` trigger symbols: the largest count at or below it, the first
 * of them on a tie. Mirrors `game-config`'s `freeSpinsAwardFor` — this file is plain Node and
 * cannot import it — and `check:freespins` holds every award dealt here to that function. A
 * landing below every row takes the lowest one: a forced or bought round whose trigger symbol is
 * never dealt lands none, and a table starting above the trigger is refused by `/config`.
 */
const awardRowFor = (table, landed) => {
	let found = null;
	for (const row of table) {
		if (row.count <= landed && (!found || row.count > found.count)) found = row;
	}
	return found ?? table[0];
};

/** The spins `landed` trigger symbols win from `table`. `rand` is drawn ONLY for a real range with
 *  `random` on, so a game that authored neither deals the stream it always has. */
export const drawAwardFrom = (table, landed, random, rand) => {
	const row = awardRowFor(table, landed);
	const max = random ? (row.maxSpins ?? row.spins) : row.spins;
	return max > row.spins ? row.spins + Math.floor(rand() * (max - row.spins + 1)) : row.spins;
};

/**
 * `WIN_X=10,20,40,70,120` — TEST-ONLY forcing for the current-games harness (each big-win tier on
 * demand): the n-th base spin a mock deals pays at least `WIN_X[n]` × the stake it is priced on.
 * Spins past the list deal normally. Absent or malformed ⇒ an empty list, and nothing changes.
 */
export const parseWinX = (raw) =>
	String(raw ?? '')
		.split(',')
		.filter((t) => t.trim() !== '')
		.map(Number)
		.filter((n) => Number.isFinite(n) && n > 0);

/**
 * The board, built from `dealt`, that pays the smallest multiple of the stake at or above `target`
 * (the largest one when none reaches it). Candidates replace every `scatter` cell with `filler` (so
 * the forced spin never triggers the feature) and fill the first `n` cells, reel by reel, with one
 * `symbols` entry, so the wins on it are the mock's own evaluation of a real board. `multipleOf(board)`
 * prices one.
 */
export const boardPayingAtLeast = (dealt, { symbols, scatter, filler, target, multipleOf }) => {
	const base = dealt.map((column) => column.map((s) => (s === scatter ? filler : s)));
	const cells = base.flatMap((column, reel) => column.map((_s, row) => [reel, row]));
	let best;
	for (const symbol of symbols)
		for (let n = 1; n <= cells.length; n++) {
			const board = base.map((column) => [...column]);
			for (const [reel, row] of cells.slice(0, n)) board[reel][row] = symbol;
			const x = multipleOf(board);
			const better = best
				? x >= target
					? best.x < target || x < best.x
					: best.x < target && x > best.x
				: true;
			if (better) best = { board, x };
		}
	return best?.board ?? base;
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
 *
 * `opts.scatterWild` makes `SCAT` substitute too — the Book-of book, scatter AND wild
 * (`docs/design/book-feature.md` §4, owner decision 2: leading books substitute like any wild). It
 * never pays a line of its own: its pay is the scatter pay, so a line of books alone pays nothing here.
 */
export const evaluatePaylines = (reels, betPerLine, paylines, wild = null, opts = {}) => {
	const wildPay = wild?.paytable ?? null;
	const isWild = (sym) =>
		(wildPay !== null && sym === 'WILD') || (opts.scatterWild === true && sym === 'SCAT');
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
			if (wildPay !== null && sym === 'WILD') wildRun++;
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

/** Every SCAT cell on the board. Split out of {@link evaluateScatters} because the free-spin
 *  trigger is scored on the COUNT alone, whether or not that count has a pay row. */
const scatterPositions = (reels) => {
	const pos = [];
	for (let reel = 0; reel < reels.length; reel++)
		for (let row = 0; row < reels[reel].length; row++)
			if (reels[reel][row] === 'SCAT') pos.push({ reel, row });
	return pos;
};

/**
 * Evaluate the SCAT feature symbol's own pay. SCATs pay anywhere on the board (not bound to a
 * payline).
 *
 * Returns `{ win, count }`, not the win alone: the free-spin trigger is scored on the COUNT, and the
 * caller needs it even for a count the pay table prices at nothing — a game may well award spins on
 * a count it pays zero for, and coupling the trigger to "there happened to be a pay row" would make
 * the feature silently disappear the day that table changes.
 */
const evaluateScatters = (reels, totalStake, table = SCATTER_PAY_TABLE) => {
	const positions = scatterPositions(reels);
	const count = positions.length;
	const mult = table[count];
	const win = mult
		? {
				what: 'SCAT',
				occurs: count,
				mode: 'scatter',
				pay: mult * totalStake,
				mpInfo: { mp: 1, replacements: 0 },
				mpBonusInfo: null,
				// A BARE array, like every sibling evaluator and the book mock — that is the ONLY shape
				// the facade's `winPositions` reads (`Array.isArray(context)`). It used to be a
				// `{ positions }` wrapper, chosen so `payingCells` would skip the scatters when picking
				// the cells a cascade blows up. That worked, but it also stripped the positions from the
				// CLIENT's `winInfo`: no scatter highlight, no free-spin trigger animation, and — on a
				// scatter-only paying spin — an EMPTY win-dim set, which darkened every cell on the board
				// and lit none. The cascade exclusion now lives in `payingCells`, keyed off what the win
				// IS rather than a context shape.
				context: Object.assign(positions, { count }),
			}
		: null;
	return { win, count };
};

/** Free-spin state snapshot, faithful to the Play4Fun `playedBonusSpin` /
 *  `enterBonus` shape. The facade reads `played` + `left` to drive the counter. `trigger` is the
 *  instance's rule (`{ occurs: [min], of: symbol, … }`): 3+ SCAT unless the project states one.
 *  A feature with an expanding special names it as `state`, where the captured Book-of snapshot does. */
const bonusSnapshot = (round, trigger, extra = {}) => ({
	prob: 1,
	additionalPrice: 0,
	triggers: 1,
	played: round.bonus.played,
	left: round.bonus.left,
	multiplier: {},
	bonusTriggers: { feature: 1 },
	bonusPlayed: {
		feature: { count: round.bonus.played, base: { count: 0, multiplierCount: 0 }, states: {} },
	},
	spins:
		round.bonus.left > 0
			? [
					{
						spins: round.bonus.left,
						bonus: 'feature',
						trigger,
						...(round.bonus.special ? { state: round.bonus.special.symbol } : {}),
					},
				]
			: [],
	playing: 'feature',
	...(round.bonus.special ? { state: round.bonus.special.symbol } : {}),
	trigger,
	...extra,
});

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

/**
 * A session as the test server carries it across a contract swap (`swapMock`): the BALANCE (and a
 * Hold and Win player's meters) survive, an open round does not (it was dealt on the previous board).
 *
 * `keepBetShape` (a game served from the shared runtime) also keeps the session's config as SENT, its
 * bet table PINNED (`tableFor`), and whether that config carried the pots overlay (the book mock deals
 * the add-on only to a session told about it). That client keeps the config it booted with, so it
 * must go on being priced and dealt by it; a reload finds no config on its balance probe, asks for
 * `config`, and is re-pinned. Without it — a desktop build, which may predate the runtime's `config`
 * probe and never gets a table — the next heartbeat re-sends the config, as it always has.
 */
export const carrySession = (session, { keepBetShape }) => ({
	balance: session.balance,
	round: null,
	configSent: keepBetShape ? Boolean(session.configSent) : false,
	...(keepBetShape && 'betTable' in session ? { betTable: session.betTable } : {}),
	...(keepBetShape && session.potsOverlay === true ? { potsOverlay: true } : {}),
	// A Hold and Win player's persistent meters are theirs, not the board's, so they survive too…
	...(session.meters ? { meters: session.meters } : {}),
	// …and so are their progressive jackpot pools.
	...(session.jackpots ? { jackpots: session.jackpots } : {}),
});

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
 *   betModes?: { mode: string, cost: number, kind: 'base' | 'ante' | 'buy' }[],
 *   cascade?: boolean, cascadeDemo?: boolean, quiet?: boolean, forceTrigger?: boolean,
 *   freeSpins?: false, freeSpinsTrigger?: { symbol: string, count: number },
 *   freeSpinsAwards?: { awards: object[], retrigger: object[], random: boolean } }} [opts]
 *   `freeSpins: false` (the project's Game Config turned free spins off) means the feature never
 *   opens: no base spin, forced trigger or bought round enters it, a bought option is refused at
 *   `bet`, and scatters still land and pay their scatter pay. `freeSpinsTrigger` is the project's
 *   trigger when it departs from 3+ SCAT — a SERVER symbol and the fewest of it, anywhere on the
 *   board, that award (and retrigger) the feature; the scatter PAY stays on SCAT either way.
 *   `freeSpinsAwards` is how many spins it awards — `{ awards, retrigger, random }`, two tables of
 *   `{ count, spins, maxSpins? }` rows and the random switch — when they depart from 10 / +5.
 *   `betModes` (BASE FIRST) makes this a table game — see `betTable`; absent ⇒ a line-config game.
 *   `symbols` restricts the dealt line pool to the project's in-play symbols in SERVER vocabulary
 *   (PIC* plus SCAT); absent ⇒ the full default pool. `winModel` selects how wins are DECIDED —
 *   everything else (session, seq, round lifecycle, scatters, free spins, the whole event
 *   vocabulary) is identical between the two, which is exactly why this is one option rather than
 *   a forked mock. `cascade` says WHETHER the game tumbles; `cascadeDemo` says the caller turned it
 *   on as a DEMO over a game that has no tumble of its own, which is the only thing that makes a
 *   dead spin tumble (see `nativeCascade`).
 */
export function createMockRgs(opts = {}) {
	/** Default in Play4Fun's native integer-cents convention (100 = $1.00).
	 *  10000 = $100 — matches what we observed from the live Hot Fruits server. */
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 10_000);
	const seed = opts.seed ?? process.env.SEED;
	/** Does this game have free spins at all? Only the project's explicit `false` turns them off. */
	const freeSpinsOn = opts.freeSpins !== false;
	/** FORCE_TRIGGER=1 → every base spin enters the free-spin feature. Testing aid. Inert on a game
	 *  with no free spins: there is no feature to force, so its rounds deal (and `WIN_X`) as usual. */
	const forceTrigger = freeSpinsOn && (opts.forceTrigger ?? process.env.FORCE_TRIGGER === '1');
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
	const winModel = WIN_MODELS.includes(opts.winModel) ? opts.winModel : 'lines';

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

	/**
	 * The `betOptions` table, when the project sells something beyond the base bet (`opts.betModes`,
	 * BASE FIRST, validated by the test server's `validBetModes`), else null.
	 *
	 * Null keeps this a LINE-CONFIG game, the Hot Fruits shape: no table on the wire, `bet` read as
	 * `[lines, betPerLine]`. With a table, `bet` is read the way the partner reads a table game (their
	 * Stargate: 20 lines, `betOptions: [20, 25, 2000]`): `[x, M]` costs `betOptions[x] × M`, x an OPTION
	 * INDEX. `betOptions[0]` is the stake UNIT — the line count, or 1 for a model with no lines — so M
	 * plays exactly the part `betPerLine` plays on a line game and every win prices as before.
	 *
	 * Before this, the mock could not sell anything: a buy went out as a line bet, was charged the base
	 * stake and dealt a base spin, while the card advertised the authored price.
	 *
	 * Option 0 is named `base` whatever the project called it, because the engine's machines address
	 * the base mode as `BASE` and the client keys a NAMED option by its name. The rest keep theirs, so
	 * the client matches each option to its authored card.
	 */
	const betTable = (() => {
		const modes = Array.isArray(opts.betModes) && opts.betModes.length > 1 ? opts.betModes : null;
		if (!modes) return null;
		const unit = paylinesLess ? 1 : paylines.length;
		return {
			// Option 0 is the unit EXACTLY: `unit × c / c` is not always an integer in floating point.
			options: modes.map((mode, index) =>
				index === 0 ? unit : (unit * mode.cost) / modes[0].cost,
			),
			names: modes.map(
				(mode, index) => `${index}:${index === 0 ? 'base' : mode.mode.toLowerCase()}`,
			),
			buys: modes.map((mode) => mode.kind === 'buy'),
		};
	})();

	/** The `betModes` key a table's `option` sells (its name, `<index>:<mode>`), or undefined. */
	const betModeOf = (table, option) =>
		(Array.isArray(opts.betModes) ? opts.betModes : []).find(
			(mode, index) =>
				table.names[option] === `${index}:${index === 0 ? 'base' : mode.mode.toLowerCase()}`,
		)?.mode;

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
	 * The Book-of book (`opts.scatterWild`, sent when the project's in-play scatter is also wild):
	 * `SCAT` substitutes on lines and is declared in `wildSymbols`. A lines game only — no other
	 * evaluator has the rule — and only when the scatter is dealt at all.
	 */
	const scatterWild = opts.scatterWild === true && winModel === 'lines' && scatterEnabled;
	if (opts.scatterWild === true && !scatterWild) {
		console.warn(
			`[${label}] the scatter is also wild, which only a lines game that deals it can play — ignored`,
		);
	}
	/**
	 * What every evaluator on this instance scores, and what it prices with — the project's own pool
	 * and its own paytable, so "the symbols my config deals" and "the symbols my config pays" are the
	 * same list. Spread into each evaluator call below; a standalone caller that passes neither keeps
	 * the captured seven and the captured Hot Fruits values (`poolOf` / `payRowOf`).
	 */
	const evalOpts = {
		pool: LINE_POOL,
		symbolPaytable: opts.symbolPaytable ?? null,
		...(scatterWild ? { scatterWild } : {}),
	};
	/** Every symbol that substitutes on a line, as `config` and `spinStart` declare them. */
	const WILD_SYMBOLS = [...(scatterWild ? ['SCAT'] : []), ...(wild ? ['WILD'] : [])];

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

	/**
	 * The project's AUTHORED scatter pays (× total stake), when `/config` states them — the scatter
	 * symbol's own `paytable`. Paid AND declared, so the info page, the payouts and the wire agree.
	 * Absent ⇒ the placeholder {@link SCATTER_PAY_TABLE}, paid but never declared, exactly as before.
	 */
	const authoredScatter = normalizeWildPaytable(opts.scatterPaytable);
	const SCATTER_PAYS = Object.keys(authoredScatter).length ? authoredScatter : null;

	// Stacked-picture test mode (docs/design/stacked-picture-mode.md): deal contiguous high-symbol
	// runs + a full-height WILD so the engine's stacked-picture reel mode has data to render. Opt-in
	// (`STACKED=1` env or `createMockRgs({ stacked: true })`); OFF ⇒ the normal weighted deal.
	const stackedDeal = opts.stacked === true || process.env.STACKED === '1';
	const winX = parseWinX(opts.winX ?? process.env.WIN_X);
	let baseSpinsDealt = 0;

	/**
	 * WHAT TRIGGERS FREE SPINS — the project's rule when it states one (`opts.freeSpinsTrigger`),
	 * else 3+ SCAT. Counted on its own, apart from the SCAT pay: the scatter keeps paying its scatter
	 * pay whatever triggers the feature, and a game may trigger on a symbol that pays nothing at all.
	 */
	const authoredTrigger = opts.freeSpinsTrigger;
	const triggerSymbol =
		typeof authoredTrigger?.symbol === 'string' && authoredTrigger.symbol
			? authoredTrigger.symbol
			: 'SCAT';
	const triggerMin =
		Number.isInteger(authoredTrigger?.count) && authoredTrigger.count >= 1
			? authoredTrigger.count
			: FS_TRIGGER_MIN;
	/** The `trigger` every bonus snapshot carries: the minimum, and the symbol it counts. */
	const snapshotTrigger = { occurs: [triggerMin], of: triggerSymbol, mode: 'scatter', from: '' };
	/** The `trigger` a `spinTrigger` carries. The partner's 3-scatter feature lists the three counts
	 *  from its minimum (`[3, 4, 5]`); a project's own minimum shifts that window. */
	const spinTriggerRule = {
		...snapshotTrigger,
		occurs: [triggerMin, triggerMin + 1, triggerMin + 2],
	};
	/** Can this instance put the trigger symbol on a board? A forced trigger writes only a symbol the
	 *  deal could have produced — the client has art for those and for nothing else. */
	const triggerDealt =
		DEALT_SYMBOLS.includes(triggerSymbol) ||
		(triggerSymbol === 'WILD' && (Boolean(wild) || stackedDeal));
	// Honoured anyway — it just never triggers naturally — but never quietly: a feature that cannot
	// open looks exactly like a broken one from the client side.
	if (freeSpinsOn && authoredTrigger && !triggerDealt) {
		console.warn(
			`[${label}] free spins trigger on ${triggerSymbol}, which this game never deals — ` +
				'the feature will only open when forced or bought',
		);
	}
	/** How many trigger symbols a board holds, anywhere on it. */
	const triggerCount = (reels) => reels.flat().filter((cell) => cell === triggerSymbol).length;

	const entryAwards = awardTableOf(opts.freeSpinsAwards?.awards, TOTAL_FS, triggerMin);
	const retriggerAwards = awardTableOf(opts.freeSpinsAwards?.retrigger, RETRIGGER_FS, triggerMin);
	const randomAwards = opts.freeSpinsAwards?.random === true;
	const drawAward = (table, landed) => drawAwardFrom(table, landed, randomAwards, nextRand);

	/**
	 * THE EXPANDING SPECIAL — the Book-of mechanic as a feature of any lines game
	 * (`docs/design/book-feature.md` §4). `opts.expandingSymbol.candidates` is game-config's
	 * `resolveExpandingSymbol` in server names: `{ symbol, weight, minReels }` per symbol it may be.
	 *
	 * When free spins start, one candidate is drawn by weight and announced with `pickRandomly`; on
	 * each free spin, once it covers `minReels` reels it expands over them and pays scatter-style (see
	 * `expandingWin`). Only candidates this instance DEALS are kept — a special the board never shows
	 * could never expand. Absent ⇒ null ⇒ no extra RNG draw anywhere, so every game without the
	 * block deals byte-identically. Lines only: an expanded reel "pays on every line".
	 */
	const expanding = (() => {
		const raw = opts.expandingSymbol?.candidates;
		if (!freeSpinsOn || !Array.isArray(raw)) return null;
		if (winModel !== 'lines') {
			console.warn(`[${label}] an expanding special needs a lines game, not ${winModel} — ignored`);
			return null;
		}
		const candidates = raw
			.filter(
				(c) =>
					typeof c?.symbol === 'string' &&
					LINE_POOL.includes(c.symbol) &&
					Number.isFinite(c.weight) &&
					c.weight > 0,
			)
			.map((c) => ({
				symbol: c.symbol,
				weight: c.weight,
				minReels:
					Number.isInteger(c.minReels) && c.minReels >= 1 ? c.minReels : DEFAULT_EXPAND_MIN_REELS,
			}));
		if (!candidates.length) {
			console.warn(`[${label}] no expanding-special candidate is dealt by this game — ignored`);
			return null;
		}
		return { candidates, total: candidates.reduce((sum, c) => sum + c.weight, 0) };
	})();
	/** One weighted draw — the book mock's `pickSpecialSymbol`. */
	const drawSpecial = () => {
		let r = nextRand() * expanding.total;
		for (const c of expanding.candidates) if ((r -= c.weight) <= 0) return c;
		return expanding.candidates[expanding.candidates.length - 1];
	};
	/**
	 * The special's own pay on a free spin, or null below its threshold or where its row prices
	 * nothing at that reel count: on the COUNT of reels it covers, at its line row × the per-line
	 * base × every payline — the symbol paying that N-of-a-kind on every line at once, which is what
	 * the line pass beside it pays per line. On a table game that is the base stake (`betOptions[0]`
	 * is the line count); on a line-config game it holds even when the client stakes fewer lines than
	 * the game pays. Positions are every cell of every covered reel. Unrounded, like every evaluator;
	 * `roundPays` takes it.
	 */
	const expandingWin = (reels, special, round) => {
		const covered = reels.flatMap((reel, index) => (reel.includes(special.symbol) ? [index] : []));
		if (covered.length < special.minReels) return null;
		const mult = payRowOf(evalOpts, special.symbol)?.[covered.length];
		if (!(mult > 0)) return null;
		return {
			win: {
				what: special.symbol,
				occurs: covered.length,
				mode: 'scatter',
				pay: mult * payoutBaseFor(round) * paylines.length,
				mpInfo: { mp: 1, replacements: 0 },
				mpBonusInfo: null,
				context: covered.flatMap((reel) => reels[reel].map((_cell, row) => ({ reel, row }))),
			},
			expanded: reels.map((reel, index) =>
				covered.includes(index) ? reel.map(() => special.symbol) : reel,
			),
		};
	};
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

	const evaluatePayWins = (board, round, o = evalOpts) =>
		roundPays(evaluateRawWins(board, round, o));

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
	 *
	 * All of it off the BASE stake (`round.baseTotal`), never `round.total`: on a table game a bought
	 * round's total carries the premium, and pricing wins off it would pay the feature 100× over —
	 * the fault the book mock had with its expanding special. On a line-config game the two are equal.
	 */
	const payoutBaseFor = (round) => {
		if (winModel === 'ways') return round.baseTotal / waysCount;
		if (winModel === 'cluster' || winModel === 'scatter') return round.baseTotal;
		return round.betPerLine;
	};

	/** `o` is the pool and prices a board is scored with: this game's own, unless a pot's imported
	 *  reels mode deals its free spins (`bonusEvalOpts`). */
	const evaluateRawWins = (board, round, o = evalOpts) => {
		const base = payoutBaseFor(round);
		if (winModel === 'ways') return evaluateWays(board, base, wild, o);
		if (winModel === 'cluster')
			return evaluateClusters(board, base, wild, { ...clusterOpts, ...o });
		if (winModel === 'scatter')
			return evaluateScatterPays(board, base, wild, { ...scatterPaysOpts, ...o });
		return evaluatePaylines(board, base, paylines, wild, o);
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
			for (const [name, n] of counts) if (n > best) ((best = n), (target = name));
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
	// The tall column the stacked deal is built around: WILD, unless the project stated its pool and
	// deals no wild — then its top stacking symbol, so a W its config marks unused never lands.
	const STACK_TALL = wild || !allowedSymbols.length ? 'WILD' : STACK_PICS[0];

	/** sid -> { balance, round | null, configSent, betTable? } — `betTable` is the table the session
	 *  was TOLD about (null for line-config), pinned when its config is sent. See `tableFor`. */
	const sessions = new Map();
	/** Closed rounds by session + id, so a request re-posted under its `gid` replays after the round closed —
	 *  a `collect` whose answer was lost is resent into a round the server has already closed. */
	const settledRounds = new Map();
	const settle = (sid, round) => {
		settledRounds.set(`${sid}:${round.id}`, round);
		if (settledRounds.size > 500) settledRounds.delete(settledRounds.keys().next().value);
	};
	const getSession = (sid) => {
		if (!sessions.has(sid)) {
			sessions.set(sid, { balance: startBalance, round: null, configSent: false });
		}
		return sessions.get(sid);
	};

	/**
	 * The bet table a session prices by: the one it was TOLD about, not necessarily this instance's.
	 *
	 * The test server rebuilds a game's mock when its contract changes and carries the sessions across
	 * (`carrySession`), while a client keeps the first config it saw. A tab open when its project gains
	 * or loses a buy therefore still sends the bet shape it booted with — and priced against the NEW
	 * table, a $1 base spin on a ways game read `[1, 100]` as the 100× buy. The pin moves only when the
	 * session is sent a config again, which a reloaded client asks for (`config`).
	 */
	const tableFor = (session) => ('betTable' in session ? session.betTable : betTable);

	let rngState = seed ? hashStr(seed) : Date.now() >>> 0;
	const nextRand = () => {
		rngState = (rngState * 1664525 + 1013904223) >>> 0;
		return rngState / 0x100000000;
	};
	/**
	 * How often a cell is a scatter. A Book-of book (`scatterWild`) is dealt at the book mock's 5%,
	 * so a Book-of game moved onto this mock triggers as often as it did there (about 3.6% of base
	 * spins on 5×3); every other game keeps 4%, byte-identically.
	 */
	const SCATTER_RATE = scatterWild ? 0.05 : 0.04;
	/** How many trigger symbols a forced or bought board carries: the book mock forces at least four
	 *  books, so a Book-of game does here too; every other game, its trigger count. */
	const FORCED_TRIGGERS =
		scatterWild && triggerSymbol === 'SCAT' ? Math.max(4, triggerMin) : triggerMin;
	const pickSymbol = () => {
		// Weighted draw favouring low-pay symbols, occasional scatter, rare PIC7. Scatter is emitted
		// only when in play (`scatterEnabled`). Under a per-project restriction the rank-weighted
		// distribution below assumes the full PIC1..PIC7 set, so a restricted pool draws uniformly from
		// its allowed line symbols instead. Unrestricted + scatter-enabled ⇒ byte-identical RNG stream.
		const r = nextRand();
		if (scatterEnabled && r < SCATTER_RATE) return 'SCAT';
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
	 * lands a partial at a board edge, which is the whole reason this mode exists), built around
	 * `STACK_TALL` (WILD, or the top stacking symbol when the project deals no wild):
	 *  • reel 0    → a partial run of it pinned to the TOP edge ⇒ the engine draws the BOTTOM of the
	 *    tall picture with its top running off-screen above (a top cutoff).
	 *  • reel 1    → a partial run pinned to the BOTTOM edge ⇒ the TOP of the picture with its bottom
	 *    running off-screen below (a bottom cutoff).
	 *  • last reel → a full-height column of it ⇒ the whole picture (contrast).
	 *  • middle reels → an occasional random high-symbol run for variety.
	 * WILD is the tallest picture (height ≫ a 2–3 cell run), so a short WILD run is ALWAYS a partial
	 * regardless of the project's authored heights — the cutoffs are guaranteed, not probabilistic. A
	 * stacking symbol in its place is a partial only where its authored height exceeds the run.
	 * Non-run cells fall back to the normal weighted draw. Only used when `stackedDeal` is on.
	 */
	const partialRunLen = (height) =>
		Math.max(2, Math.min(height - 1, 2 + Math.floor(nextRand() * 2))); // 2..3, < that column's rows
	const spinReelsStacked = () =>
		Array.from({ length: reelCount }, (_ignored, reel) => {
			// Every bound below is THIS column's height, so the engineered top/bottom cutoffs land on
			// the edges of the column the player actually sees. Uniform ⇒ identical to `rowCount`.
			const rowCount = rowHeights[reel];
			const column = Array.from({ length: rowCount }, pickSymbol);
			// Last reel: the whole tall picture (checked first so a 1- or 2-reel grid still gets a full stack).
			if (reel === reelCount - 1) return Array.from({ length: rowCount }, () => STACK_TALL);
			// Reel 0: a partial run pinned to the TOP edge (rows 0..len-1) ⇒ bottom-of-picture cutoff.
			if (reel === 0 && rowCount >= 2) {
				const len = partialRunLen(rowCount);
				for (let i = 0; i < len; i++) column[i] = STACK_TALL;
				return column;
			}
			// Reel 1: a partial run pinned to the BOTTOM edge (last len rows) ⇒ top-of-picture cutoff.
			if (reel === 1 && rowCount >= 3) {
				const len = partialRunLen(rowCount);
				for (let i = 0; i < len; i++) column[rowCount - len + i] = STACK_TALL;
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

	/**
	 * Write `FORCED_TRIGGERS` trigger symbols onto an ALREADY DEALT board — a guaranteed feature
	 * trigger for `FORCE_TRIGGER=1` and a bought round. Overwrites cells rather than dealing its own
	 * grid, so it composes with whichever deal is in play (stacked or normal) and respects a stepped grid's
	 * per-column heights.
	 *
	 * One per reel, left to right, then round again for a count above the reel count (six on five
	 * reels), each time onto a cell this call has not written yet — so the count is actually reached,
	 * up to a full board. The first pass draws exactly what the old one-per-reel loop drew, so a
	 * 3-scatter trigger deals the board it always has.
	 */
	const forceTriggerSymbols = (reels) => {
		const written = reels.map(() => new Set());
		const target = Math.min(
			FORCED_TRIGGERS,
			reels.reduce((cells, column) => cells + column.length, 0),
		);
		for (let placed = 0, reel = 0; placed < target; reel = (reel + 1) % reels.length) {
			const free = reels[reel].map((_cell, row) => row).filter((row) => !written[reel].has(row));
			if (!free.length) continue;
			const row = free[Math.floor(nextRand() * free.length)];
			reels[reel][row] = triggerSymbol;
			written[reel].add(row);
			placed += 1;
		}
		return reels;
	};

	/** A board drawn from an imported reels mode's `strips`: each reel stops at a random cell of its
	 *  strip, as deep as the reel deals. A mode with fewer strips than this board has reels repeats
	 *  them, so the board is always this game's — its paylines must index every reel. */
	const spinStrips = (strips) =>
		Array.from({ length: reelCount }, (_unused, reel) => {
			const strip = strips[reel % strips.length];
			const stop = Math.floor(nextRand() * strip.length);
			return Array.from(
				{ length: rowHeights[reel] },
				(_cell, row) => strip[(stop + row) % strip.length],
			);
		});
	/** The pool and prices an imported reels mode's free spins are scored with: its own pays over this
	 *  game's, and its own symbols in the pool. */
	const bonusEvalOpts = (bonus) =>
		bonus?.strips
			? {
					...evalOpts,
					pool: [...new Set([...LINE_POOL, ...bonus.strips.flat()])].filter(
						(name) => name !== 'SCAT' && name !== 'WILD',
					),
					symbolPaytable: { ...(evalOpts.symbolPaytable ?? {}), ...bonus.paytable },
				}
			: evalOpts;

	/**
	 * Enter the free spins — the trigger, a forced or bought round, or a pot of the overlay (its
	 * `startFreeSpins` hook). The round STAYS OPEN: the free spins and a `collect` follow. `board` (the
	 * triggering spin's) is sent between the trigger and the entry; `extra` rides on `spinTrigger` (a
	 * pot's `cause` and `meters`). With the expanding special set, it is drawn here and announced with
	 * `pickRandomly` right after `enterBonus`, in the book mock's shape (`item.state` is what the facade
	 * reads; `prob` carries the authored weight).
	 *
	 * A REELS MODE of the project's own (a pot's imported free spins) passes its `bonus` key, the
	 * `strips` its spins are drawn from and the `paytable` of the symbols only it deals. It has no
	 * expanding special: that is the host game's mechanic, not the imported feature's.
	 */
	const startFreeSpins = (
		events,
		round,
		{ occurs, spins: given, board, extra = {}, bonus = 'feature', strips, paytable },
	) => {
		const spins = Math.min(
			given ?? (strips ? TOTAL_FS : drawAward(entryAwards, occurs)),
			MAX_ROUND_FREE_SPINS,
		);
		const special = expanding && !strips ? drawSpecial() : null;
		round.bonus = {
			active: true,
			total: spins,
			played: 0,
			left: spins,
			...(special ? { special } : {}),
			...(strips ? { key: bonus, strips, paytable: paytable ?? {} } : {}),
		};
		events.push({
			event: 'spinTrigger',
			context: {
				spins: [{ prob: 1, spins }],
				occurs,
				bonus,
				trigger: spinTriggerRule,
				...extra,
			},
		});
		if (board) events.push({ event: 'playedSpin', context: board });
		const entry = bonusSnapshot(round, snapshotTrigger, { played: 0, left: spins });
		events.push({ event: 'enterBonus', context: entry });
		if (special) {
			events.push({
				event: 'pickRandomly',
				context: {
					items: expanding.candidates.map((c) => ({ state: c.symbol, prob: c.weight })),
					state: entry,
					scope: 'enterState',
					item: { state: special.symbol, prob: special.weight },
				},
			});
		}
	};

	/**
	 * The seam an add-on deals through (`withPotsOverlay`, `mock-pots-overlay.mjs`), as the book mock
	 * gives it: called once with this host's board and its `startFreeSpins` hook, it returns the hooks
	 * `handleEngine` calls. Absent, not one byte of any answer changes. A session is dealt the add-on
	 * only while the config it was sent carried it (`session.potsOverlay`, kept across a contract swap
	 * by `carrySession`) — see the book mock's factory comment for why.
	 *
	 * The overlay drops onto a rectangle (`rows` deep on every reel), so a stepped board is refused,
	 * as is a pot that would start free spins on a game with none.
	 */
	const overlay = (() => {
		if (!opts.overlay) return null;
		if (isStepped) throw new Error(`[${label}] a pots overlay needs a rectangular board`);
		return opts.overlay({
			label,
			seed,
			reels: reelCount,
			rows: rowCount,
			bonuses: { feature: 'freeSpins' },
			freeSpinsMode: 'freeSpins',
			freeSpinsOn,
			startFreeSpins,
		});
	})();

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
		const isConfigCall = actions.length === 1 && actions[0]?.action === 'config';
		// A session told a different game than this mock deals, and not being re-told now: an open tab
		// from before a contract swap. It is dealt the plain game until it reloads (see `overlay`).
		const stale =
			session.configSent && !isConfigCall && (session.potsOverlay === true) !== Boolean(overlay);
		const addOn = stale ? null : overlay;

		// Emit the boot `config` event once per session — first response gets it — or again on an
		// explicit `config` action. Faithful to Play4Fun's wire format (symbols/window/paylines/
		// wildSymbols/paytable). The facade captures it for cross-checks + reveal filtering.
		//
		// Sending it PINS the session to the bet table it declares (`tableFor`): that is the table this
		// client will price its bets by, for as long as it lives, whatever the contract does later.
		//
		// A session with a round still OPEN is told so, as the partner and the book mock tell it: the
		// round's stored `actions` and `resume: true` ride on the event, and the response names the round
		// on `platform.gameRound`. That is all a reloading client needs to replay it (the positions are
		// already stored, see REPLAY below) rather than abandon it.
		const sendConfig = () => {
			session.configSent = true;
			session.betTable = betTable;
			if (overlay) session.potsOverlay = true;
			else delete session.potsOverlay;
			const open = session.round?.stored?.filter(Boolean) ?? [];
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
					wildSymbols: WILD_SYMBOLS,
					// A table game only. A line-config game's config carries no table, as Hot Fruits'
					// does, and stays byte-identical to before.
					...(betTable
						? {
								betOptions: betTable.options,
								betOptionsName: betTable.names,
								gameCost: betTable.options[0],
							}
						: {}),
					paytable: Object.fromEntries(
						Object.entries({
							...EFFECTIVE_PAY_TABLE,
							...(wild ? { WILD: wild.paytable } : {}),
							...(SCATTER_PAYS ? { SCAT: SCATTER_PAYS } : {}),
						}).map(([sym, byCount]) => {
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
			if (overlay) Object.assign(events.at(-1).context, overlay.configContext(session));
			if (open.length)
				Object.assign(events.at(-1), { actions: open.map((s) => s.action), resume: true });
		};
		// A TABLE game sends it only when asked (`config`), never on a first call or a heartbeat — the
		// shape the partner's own servers can have, which the runtime facade already handles by asking.
		// So a session is pinned only by a client that asked, which is what makes the pin trustworthy:
		// a tab whose session was lost to a test-server restart heartbeats into a NEW session, and had
		// that heartbeat pinned it, its next bet would be priced by a table it never saw (a $1 base spin
		// charged as the 100× buy). Its bet is refused instead (see `bet`), and a reload asks.
		if (!session.configSent && !betTable) sendConfig();

		// Heartbeat: empty body returns balance (plus config if first call), and names a round still
		// open — which is how a client that lost an answer learns its bet was taken.
		if (actions.length === 0) {
			const platform = { balance: session.balance };
			if (session.round) platform.gameRound = { updating: true, id: session.round.id };
			return sendJson(req, res, 200, { events, platform });
		}

		// REPLAY: every action re-posted at a position it already occupies in the round named by `gid`
		// is answered with what was dealt there, and changes nothing. That is the protocol's resend: a
		// client that lost an answer posts the same request again, and must not be dealt — or charged
		// — a second time.
		const known = gid
			? session.round?.id === gid
				? session.round
				: settledRounds.get(`${sid}:${gid}`)
			: undefined;
		if (
			known?.stored &&
			actions.every((a, i) => known.stored[seq + i]?.action.action === a.action)
		) {
			for (let i = 0; i < actions.length; i++) events.push(...known.stored[seq + i].events);
			const platform = { balance: session.balance };
			if (session.round) platform.gameRound = { updating: true, id: session.round.id };
			return sendJson(req, res, 200, { events, platform });
		}

		// The add-on's forced beats are checked before anything is dealt, so a typo charges nothing.
		const refused = addOn?.refuse(actions);
		if (refused) {
			return sendJson(req, res, 200, {
				result: 0,
				error: refused,
				errorCode: 101,
				platform: { balance: session.balance },
			});
		}

		let pendingRound = session.round; // copy reference; may mutate

		for (const [offset, a] of actions.entries()) {
			const dealtFrom = events.length;
			switch (a.action) {
				case 'bet': {
					// A table game's session that never asked for its config cannot say which bet shape it
					// means, so nothing about this bet can be priced safely.
					if (betTable && !('betTable' in session)) {
						return sendJson(req, res, 200, {
							result: 0,
							error: 'this session never asked for the game config — reload the game',
							errorCode: 110,
							platform: { balance: session.balance },
						});
					}
					const table = tableFor(session);
					const ctx = Array.isArray(a.context) ? a.context : table ? [0, 1] : [5, 1];
					const option = table ? Number(ctx[0] ?? 0) : 0;
					const multiplier = table ? Number(ctx[1] ?? 1) : 0;
					// A bought option on a game with no free spins buys nothing, so it is refused like any
					// other option the table cannot sell — never charged the buy price for a base spin. Only
					// a stale contract can still carry one: `/config` refuses to save a buy beside it.
					if (
						table &&
						(!Number.isInteger(option) ||
							option < 0 ||
							option >= table.options.length ||
							!Number.isFinite(multiplier) ||
							multiplier <= 0 ||
							(!freeSpinsOn && table.buys[option] && !addOn?.sellsBuy(betModeOf(table, option))))
					) {
						return sendJson(req, res, 200, {
							result: 0,
							error: `invalid bet [${ctx[0]}, ${ctx[1]}]`,
							errorCode: 101,
							platform: { balance: session.balance },
						});
					}
					// On a table game `ctx[1]` is M, which prices one stake unit exactly as `betPerLine` does
					// on a line game (see `betTable`), so the round below is the same shape either way.
					const betPerLine = table ? multiplier : Number(ctx[1]) || 1;
					const baseTotal = table
						? table.options[0] * betPerLine
						: (Number(ctx[0]) || 5) * betPerLine;
					// Never a free round: a cost small enough to round to nothing still costs a cent.
					const total = table
						? Math.max(1, Math.round(table.options[option] * betPerLine))
						: baseTotal;
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
						total,
						/** What every win is priced on — `total` less any premium the option carried. */
						baseTotal,
						/** A bought option: this round's play enters the feature. */
						isBuy: table ? table.buys[option] : false,
						/** The `betModes` key the option sells — the overlay's buy routes read it. */
						betMode: table ? betModeOf(table, option) : undefined,
						win: 0,
						reels: null,
						/** Null outside the feature; set by the trigger, cleared when the last spin plays. */
						bonus: null,
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
					const turn = addOn?.beginPlay(session, pendingRound, a.context, {
						mode: pendingRound.bonus?.active ? 'freeSpins' : 'basegame',
						sid,
					});
					if (turn?.refused) {
						return sendJson(req, res, 200, {
							result: 0,
							error: turn.refused,
							errorCode: 110,
							platform: {},
						});
					}
					if (turn?.owned) {
						addOn.playOwned(events, session, pendingRound);
						break;
					}
					// Hoisted into a value rather than pushed inline: a free spin opens with the SAME
					// event, and the two paths diverge straight after it.
					const spinStart = {
						event: 'spinStart',
						context: {
							symbols: wild ? [...DEALT_SYMBOLS, 'WILD'] : DEALT_SYMBOLS,
							symbolsPay: {
								line: wild ? [...LINE_POOL, 'WILD'] : LINE_POOL,
								scatter: scatterEnabled ? ['SCAT'] : [],
							},
							wildSymbols: WILD_SYMBOLS,
							lineAlign: 'left',
							lineCoinciding: LINE_COINCIDING,
						},
					};

					// ----- FREE SPIN (the round is already inside the feature) -----
					// The round STAYS OPEN across free spins: the facade keeps POSTing `play` until it
					// sees `gameEnd`, then `collect`s. So `gameEnd` must NOT be emitted until the last
					// free spin has played, or the drive loop closes the round mid-feature.
					if (pendingRound.bonus?.active) {
						const { strips } = pendingRound.bonus;
						const bonusKey = pendingRound.bonus.key ?? 'feature';
						const fsReels = strips
							? spinStrips(strips)
							: stackedDeal
								? spinReelsStacked()
								: spinReels();
						pendingRound.reels = fsReels;
						const special = pendingRound.bonus.special;
						// During the feature the special pays scatter-style too, as the book mock declares it.
						events.push(
							special
								? {
										...spinStart,
										context: {
											...spinStart.context,
											symbolsPay: {
												...spinStart.context.symbolsPay,
												scatter: [...spinStart.context.symbolsPay.scatter, special.symbol],
											},
										},
									}
								: spinStart,
						);
						// `evaluatePayWins`, NOT a direct evaluator call: it routes through `payoutBaseFor`,
						// so a free spin prices a win against the same per-model base as a base spin
						// (per line / per way / whole bet) and `roundPays` it to whole cents there. Calling
						// an evaluator directly would price every free spin per LINE, which is wrong for
						// three of the four models and would break `finalWin ÷ 100 === payoutMultiplier`
						// the moment a feature round paid (see `check:stake`).
						const fsScat = evaluateScatters(
							fsReels,
							pendingRound.baseTotal,
							SCATTER_PAYS ?? SCATTER_PAY_TABLE,
						);
						// The special covering its threshold pays first, then expands, and the OTHER symbols
						// pay their lines on the expanded board — the special left out of that pass, so it
						// is never paid twice. Below the threshold it is a plain symbol on the natural board.
						const expandedPay = special ? expandingWin(fsReels, special, pendingRound) : null;
						const fsWins = expandedPay
							? roundPays([
									expandedPay.win,
									...evaluateRawWins(expandedPay.expanded, pendingRound).filter(
										(w) => w.what !== special.symbol,
									),
								])
							: evaluatePayWins(fsReels, pendingRound, bonusEvalOpts(pendingRound.bonus));
						// The SCAT pay is priced against the WHOLE stake and rounded at the wire — exactly
						// as the base spin below does it, so the two paths cannot drift apart.
						if (fsScat.win) fsWins.push(roundPays([fsScat.win])[0]);
						for (const w of fsWins) {
							events.push({
								event: 'bonusWin',
								context: { bonus: bonusKey, pay: w.pay, isSpinWin: true },
							});
							events.push({ event: 'spinWin', context: w });
							// The ALREADY-ROUNDED pay, so the round total is the exact sum of the wins the
							// client was shown — the parts and the whole can never drift.
							pendingRound.win += w.pay;
						}
						events.push({ event: 'playedSpin', context: fsReels });
						pendingRound.bonus.played += 1;
						pendingRound.bonus.left -= 1;
						// RETRIGGER: the trigger landing again DURING a free spin awards more spins (the
						// retrigger table's row for how many landed), added to the remaining count — up to
						// MAX_ROUND_FREE_SPINS for the round; one that would pass it awards nothing. Emitted
						// BEFORE `playedBonusSpin`, so the counter total the client reads already includes
						// them.
						// An imported reels mode retriggers by the plain default, under its own lower limit.
						const fsTriggers = triggerCount(fsReels);
						const added =
							fsTriggers < triggerMin
								? 0
								: strips
									? RETRIGGER_FS
									: drawAward(retriggerAwards, fsTriggers);
						const limit = strips ? MAX_STRIPS_ROUND_SPINS : MAX_ROUND_FREE_SPINS;
						if (added > 0 && pendingRound.bonus.total + added <= limit) {
							pendingRound.bonus.left += added;
							pendingRound.bonus.total += added;
							events.push({
								event: 'retrigger',
								context: {
									spins: added,
									occurs: fsTriggers,
									total: pendingRound.bonus.total,
									left: pendingRound.bonus.left,
									bonus: bonusKey,
								},
							});
						}
						events.push({
							event: 'playedBonusSpin',
							context: bonusSnapshot(pendingRound, snapshotTrigger),
						});
						if (pendingRound.bonus.left <= 0) {
							pendingRound.bonus.active = false;
							events.push({
								event: 'playedBonusSpins',
								context: bonusSnapshot(pendingRound, snapshotTrigger),
							});
							// The add-on's bonus waiting behind these free spins starts instead of the end.
							if (!addOn?.takeOver(events, session, pendingRound))
								events.push({ event: 'gameEnd', context: { win: pendingRound.win } });
						}
						// No cascade on a free spin: the tumble fixture is a BASE-game presentation aid,
						// and a chain here would overwrite the win the counter is accumulating.
						break;
					}

					// ----- BASE SPIN -----
					const shuffled = stackedDeal ? spinReelsStacked() : spinReels();
					// A round that enters the feature anyway (bought, `FORCE_TRIGGER`) is never forced to pay,
					// and does not use up a `WIN_X` entry.
					// The add-on's `feature` force enters it like `FORCE_TRIGGER`.
					const hostFeature = freeSpinsOn && turn?.hostFeature === true;
					const forcedX =
						pendingRound.isBuy || forceTrigger || hostFeature ? undefined : winX[baseSpinsDealt++];
					// The forced win must not open the feature, so the board it builds holds no trigger
					// symbol: the trigger's cells are refilled and it is never the symbol that pays. With
					// the default 3+ SCAT rule that is exactly the scatter-free board it always built.
					const nonTrigger = LINE_POOL.filter((symbol) => symbol !== triggerSymbol);
					const forcedPool = nonTrigger.length ? nonTrigger : LINE_POOL;
					const dealt =
						forcedX === undefined
							? shuffled
							: boardPayingAtLeast(shuffled, {
									symbols: forcedPool,
									scatter: triggerSymbol,
									filler: forcedPool[forcedPool.length - 1],
									target: forcedX,
									multipleOf: (board) =>
										evaluatePayWins(board, pendingRound).reduce((sum, w) => sum + w.pay, 0) /
										pendingRound.baseTotal,
								});
					// A bought round enters the feature the way `FORCE_TRIGGER` makes every round enter it:
					// the trigger forced onto the dealt board, so the trigger on screen is the one that
					// fired. Not with a trigger symbol this game never deals, which the client has no art
					// for; that round still enters the feature below.
					const bought = pendingRound.isBuy;
					const reels =
						(forceTrigger || bought || hostFeature) && triggerDealt
							? forceTriggerSymbols(dealt)
							: dealt;
					pendingRound.reels = reels;
					const lineWins = evaluatePayWins(reels, pendingRound);
					const scat = evaluateScatters(
						reels,
						pendingRound.baseTotal,
						SCATTER_PAYS ?? SCATTER_PAY_TABLE,
					);
					// Same boundary: the scatter TRIGGER pay is a payout like any other.
					const scatterWin = scat.win ? roundPays([scat.win])[0] : null;
					const wins = scatterWin ? [...lineWins, scatterWin] : lineWins;
					const totalWin = wins.reduce((sum, w) => sum + w.pay, 0);
					pendingRound.win = totalWin;

					events.push(spinStart);
					for (const w of wins) events.push({ event: 'spinWin', context: w });

					// FEATURE TRIGGER — the SCAT pay and the trigger are independent, as in the base
					// game: the scatters pay their scatter win AND award free spins. Deliberately NO
					// `pickRandomly`: that is the book-of expanding special, and this mock serves the
					// lines/ways/cluster/scatter kinds, which have no such symbol. The facade drives the
					// whole bonus off `enterBonus` and treats `setExpandingSymbol` as an optional
					// handler, so nothing stalls without it.
					//
					// Counted on the trigger symbol (SCAT unless the project states its own), and never
					// on a game with free spins off: its round closes below like any base spin, the
					// scatters having paid their scatter pay above.
					const triggers = triggerCount(reels);
					if (freeSpinsOn && (triggers >= triggerMin || forceTrigger || bought || hostFeature)) {
						// The award row for what landed, the board counted as dealt — forced and bought
						// boards too, so the award matches the trigger the player sees.
						const awarded = drawAward(entryAwards, triggers);
						startFreeSpins(events, pendingRound, {
							occurs: triggers,
							spins: awarded,
							board: reels,
						});
						// Do NOT credit and do NOT close — the free spins and the collect follow.
						break;
					}

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
					// …unless the add-on starts its bonus on this spin: the round stays open.
					if (addOn?.takeOver(events, session, pendingRound)) break;
					events.push({ event: 'gameEnd', context: { win: roundWin } });

					// Round-close rules (from real captures):
					//   - play.context = '' (or undefined): auto-collect.
					//   - play.context = null: leave round open IFF there's a win to collect.
					//     If win = 0, the server auto-closes even with null context
					//     (nothing to collect → no point keeping the round open).
					// A forced beat's context is the add-on's; what is left of it is the client's.
					const context = turn ? turn.context : a.context;
					const explicitAutoCollect = context === '' || context === undefined;
					const zeroWinAutoClose = context === null && roundWin === 0;
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
				case 'config': {
					// Not stored, as the partner's is not. The facade asks for it when its balance probe
					// carried no config — which is what a RELOADED tab meets once `carrySession` has kept
					// its session's config sent — so answering re-pins the session to the table in force.
					if (!events.some((e) => e.event === 'config')) sendConfig();
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
			if (addOn && a.action === 'play') addOn.endPlay(events, dealtFrom, session, pendingRound);
			// `config` is not stored, as the partner's is not: it would overwrite the position of an
			// action the round really played, and a resume would replay the config in its place.
			if (pendingRound && a.action !== 'config') {
				pendingRound.stored ??= [];
				pendingRound.stored[seq + offset] = { action: a, events: events.slice(dealtFrom) };
			}
		}

		// Settle session.round state
		if (pendingRound && pendingRound.closed) {
			settle(sid, pendingRound);
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
	/**
	 * WHICH WIN MODEL THE STANDALONE MOCK DEALS. `createMockRgs` has taken `winModel` since ways
	 * shipped, but only the in-process caller (`services/test-server`, which reads a published
	 * project) ever passed it — so `node scripts/mock-rgs-server.mjs` dealt LINES whatever anyone
	 * meant, and there was no way to play a ways/cluster/scatter board without a launcher.
	 *
	 * Validated, and FATAL on a typo. A mock that quietly ignores `WIN_MODEL=way` and deals paylines
	 * is indistinguishable from a ways evaluator that does not work — the operator would be debugging
	 * the engine over a one-character mistake. Absent ⇒ `undefined` ⇒ `lines` ⇒ byte-identical to
	 * every run before this existed.
	 */
	const envWinModel = () => {
		const raw = (process.env.WIN_MODEL ?? '').trim();
		if (!raw) return undefined;
		const value = raw.toLowerCase();
		if (!WIN_MODELS.includes(value)) {
			console.error(
				`[mock] WIN_MODEL="${raw}" is not a win model this mock can deal.\n` +
					`[mock] legal values: ${WIN_MODELS.join(' | ')} (omit it for ${WIN_MODELS[0]}).`,
			);
			process.exit(1);
		}
		return value;
	};
	/** Cluster connectivity, same two values `normalizeWinModel` declares. Fatal on anything else,
	 *  for the reason `WIN_MODEL` is: a silently-orthogonal deal reads as "diagonal clusters are
	 *  broken". */
	const envAdjacency = () => {
		const raw = (process.env.ADJACENCY ?? '').trim();
		if (!raw) return undefined;
		const value = raw.toLowerCase();
		if (value !== 'orthogonal' && value !== 'diagonal') {
			console.error(
				`[mock] ADJACENCY="${raw}" is not a cluster connectivity.\n` +
					'[mock] legal values: orthogonal | diagonal (omit it for orthogonal).',
			);
			process.exit(1);
		}
		return value;
	};
	const winModel = envWinModel();
	// `CASCADE` and `STACKED` are deliberately NOT forwarded here: `createMockRgs` already reads both
	// from the environment itself, and passing `cascade` EXPLICITLY would flip `cascadeIsDemo`
	// (`opts.cascade ?? …` / `opts.cascade === undefined`) and make dead spins tumble on a game that
	// only had the demo flag on. Reading them where they already live keeps CLI behaviour identical.
	const mock = createMockRgs({
		label: 'mock',
		reels: envInt('REELS'),
		rows: envRows(),
		winModel,
		// Cluster/scatter shape knobs. `undefined` ⇒ `createMockRgs`'s own defaults (5 / 8 /
		// orthogonal), which is what every previous CLI run got.
		minCluster: envInt('MIN_CLUSTER'),
		adjacency: envAdjacency(),
		minCount: envInt('MIN_COUNT'),
		// Only ever consulted by the scatter collect fixture (`winModel: 'scatter'` + `CASCADE=1`);
		// `false` and `undefined` are the same answer to its `=== true` gate, so this is inert
		// everywhere else.
		multiplier: process.env.MULTIPLIER === '1',
		// The default template's menu (`apps/lines/src/game/config.ts`), so a local game's BONUS card
		// is sold at the price it shows. Off ⇒ a line-config game, as every previous CLI run was.
		...(process.env.BUY === '1'
			? {
					betModes: [
						{ mode: 'base', cost: 1, kind: 'base' },
						{ mode: 'bonus', cost: 100, kind: 'buy' },
					],
				}
			: {}),
	});
	// PLATFORM_JACKPOT=1 adds the operator platform jackpot on top (`mock-platform-jackpot.mjs`).
	const platform = process.env.PLATFORM_JACKPOT === '1' ? createPlatformJackpot() : null;
	const serve = (req, res, url) =>
		platform ? platform.handle(req, res, url, mock.handle) : mock.handle(req, res, url);
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${req.headers.host}`);
		return serve(req, res, url);
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
		// Say the win model out loud even when it defaulted: "which game am I actually dealing" is
		// the first thing anyone debugging a wrong-looking board needs, and the default is invisible.
		console.log(`[mock] win model: ${winModel ?? `${WIN_MODELS[0]} (default)`}`);
		console.log(
			`[mock] bets: ${process.env.BUY === '1' ? 'betOptions table (BUY=1)' : 'line-config'}`,
		);
		console.log(`[mock] try: curl -X POST http://localhost:${PORT}/rgs/engine?sid=test`);
	});
}
