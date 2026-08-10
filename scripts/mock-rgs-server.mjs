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
// to per-game symbols (H1/L1/S/W for Stake's lines) happens in the facade,
// not here — the mock stays faithful to real Play4Fun output.
const SYMBOLS = ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5', 'PIC6', 'PIC7', 'SCAT'];
const LINE_SYMBOLS = SYMBOLS.filter((s) => s !== 'SCAT');
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

/** True when the payline set touches EVERY row of a `rows`-tall grid — the gate for keeping an
 *  authored set as-is. A set that skips rows (e.g. the stock 5×3 lines on a resized 5×5 board) leaves
 *  those rows permanently unwinnable, which is exactly the "nothing pays on the bottom row" report. */
export const coversAllRows = (paylines, rows) => {
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
	const mid = Math.round((reels - 1) / 2);
	const lines = [];
	for (let r = 0; r < rows; r++) lines.push(Array.from({ length: reels }, () => r));
	for (let r = 0; r < rows - 1; r++) {
		lines.push(Array.from({ length: reels }, (_unused, c) => (c === mid ? r + 1 : r)));
		lines.push(Array.from({ length: reels }, (_unused, c) => (c === mid ? r : r + 1)));
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
export const evaluatePaylines = (reels, betPerLine, paylines, wild = null) => {
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
		const baseMult = base !== null ? (PAY_TABLE[base]?.[baseRun] ?? 0) : 0;
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
		context: { positions },
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
 * @param {{ startBalance?: number, seed?: string, label?: string, reels?: number, rows?: number,
 *   paylines?: number[][], wild?: { paytable: Record<string, number> }, stacked?: boolean,
 *   symbols?: string[] }} [opts] `symbols` restricts the dealt line pool to the project's in-play
 *   symbols in SERVER vocabulary (PIC* plus SCAT); absent ⇒ the full default pool.
 */
export function createMockRgs(opts = {}) {
	/** Default in Play4Fun's native integer-cents convention (100 = $1.00).
	 *  10000 = $100 — matches what we observed from the live Hot Fruits server. */
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 10_000);
	const seed = opts.seed ?? process.env.SEED;
	const label = opts.label ?? 'mock';

	// Grid the mock deals — the game's authored grid when the test server injects it, else the
	// faithful Hot Fruits 5×3. `paylines` MUST be numReels-wide (one row index per reel); an
	// injected set out of sync with `reels` would index off the board, so the test server passes
	// the config's own paylines alongside its dimensions.
	const reelCount = Math.max(1, Math.round(Number(opts.reels ?? DEFAULT_REELS)));
	const rowCount = Math.max(1, Math.round(Number(opts.rows ?? DEFAULT_ROWS)));
	const authoredPaylines =
		Array.isArray(opts.paylines) && opts.paylines.length ? opts.paylines : DEFAULT_PAYLINES;
	// Keep the authored set when it already touches every row; otherwise the game's real dimensions
	// have outgrown its lines (the classic 5×3 lines on a resized 5×5 board), so deal a generated set
	// that covers the whole grid — the server "picks up" rows/reels instead of a stale line subset.
	const paylines = coversAllRows(authoredPaylines, rowCount)
		? authoredPaylines
		: standardPaylines(reelCount, rowCount);

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
	const allowedSymbols = Array.isArray(opts.symbols)
		? opts.symbols.filter((s) => typeof s === 'string')
		: [];
	const restrictSymbols = allowedSymbols.length > 0;
	const scatterEnabled = restrictSymbols ? allowedSymbols.includes('SCAT') : true;
	const linePoolRaw = restrictSymbols ? allowedSymbols.filter((s) => s !== 'SCAT') : LINE_SYMBOLS;
	const LINE_POOL = linePoolRaw.length ? linePoolRaw : LINE_SYMBOLS;

	// Stacked-picture test mode (docs/design/stacked-picture-mode.md): deal contiguous high-symbol
	// runs + a full-height WILD so the engine's stacked-picture reel mode has data to render. Opt-in
	// (`STACKED=1` env or `createMockRgs({ stacked: true })`); OFF ⇒ the normal weighted deal.
	const stackedDeal = opts.stacked === true || process.env.STACKED === '1';
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
	/** reelCount reels × rowCount visible rows */
	const spinReels = () =>
		Array.from({ length: reelCount }, () => Array.from({ length: rowCount }, pickCell));

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
	const partialWildLen = () => Math.max(2, Math.min(rowCount - 1, 2 + Math.floor(nextRand() * 2))); // 2..3, < rows
	const spinReelsStacked = () =>
		Array.from({ length: reelCount }, (_ignored, reel) => {
			const column = Array.from({ length: rowCount }, pickSymbol);
			// Last reel: the whole 5-tall Wild (checked first so a 1- or 2-reel grid still gets a full stack).
			if (reel === reelCount - 1) return Array.from({ length: rowCount }, () => 'WILD');
			// Reel 0: partial WILD pinned to the TOP edge (rows 0..len-1) ⇒ bottom-of-picture cutoff.
			if (reel === 0 && rowCount >= 2) {
				const len = partialWildLen();
				for (let i = 0; i < len; i++) column[i] = 'WILD';
				return column;
			}
			// Reel 1: partial WILD pinned to the BOTTOM edge (last len rows) ⇒ top-of-picture cutoff.
			if (reel === 1 && rowCount >= 3) {
				const len = partialWildLen();
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

		console.log(
			`[${label}] sid=${sid} seq=${seq} gid=${gid ?? '-'} actions=${JSON.stringify(actions.map((a) => a.action))}`,
		);

		const events = [];

		// Emit the boot `config` event once per session — first response gets it.
		// Faithful to Play4Fun's wire format (symbols/window/paylines/wildSymbols/
		// paytable). The facade captures it for cross-checks + reveal filtering.
		if (!session.configSent) {
			session.configSent = true;
			events.push({
				event: 'config',
				context: {
					symbols: wild ? [...SYMBOLS, 'WILD'] : SYMBOLS,
					window: { reels: reelCount, rows: rowCount },
					paylines,
					wildSymbols: wild ? ['WILD'] : [],
					paytable: Object.fromEntries(
						Object.entries(wild ? { ...PAY_TABLE, WILD: wild.paytable } : PAY_TABLE).map(
							([sym, byCount]) => {
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
							},
						),
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
					const lineWins = evaluatePaylines(reels, pendingRound.betPerLine, paylines, wild);
					const scatterWin = evaluateScatters(reels, pendingRound.total);
					const wins = scatterWin ? [...lineWins, scatterWin] : lineWins;
					const totalWin = wins.reduce((s, w) => s + w.pay, 0);
					pendingRound.win = totalWin;

					events.push({
						event: 'spinStart',
						context: {
							symbols: wild ? [...SYMBOLS, 'WILD'] : SYMBOLS,
							symbolsPay: {
								line: wild ? [...LINE_SYMBOLS, 'WILD'] : LINE_SYMBOLS,
								scatter: ['SCAT'],
							},
							wildSymbols: wild ? ['WILD'] : [],
							lineAlign: 'left',
							lineCoinciding: LINE_COINCIDING,
						},
					});
					for (const w of wins) events.push({ event: 'spinWin', context: w });
					events.push({ event: 'playedSpin', context: reels });
					events.push({ event: 'gameEnd', context: { win: totalWin } });

					// Round-close rules (from real captures):
					//   - play.context = '' (or undefined): auto-collect.
					//   - play.context = null: leave round open IFF there's a win to collect.
					//     If win = 0, the server auto-closes even with null context
					//     (nothing to collect → no point keeping the round open).
					const explicitAutoCollect = a.context === '' || a.context === undefined;
					const zeroWinAutoClose = a.context === null && totalWin === 0;
					if (explicitAutoCollect || zeroWinAutoClose) {
						session.balance += totalWin;
						events.push({ event: 'gameRoundOver', context: { win: totalWin } });
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
	const mock = createMockRgs({ label: 'mock', reels: envInt('REELS'), rows: envInt('ROWS') });
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
