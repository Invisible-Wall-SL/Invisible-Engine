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

/** Evaluate paylines. Each payline is one row-index per reel.
 *  A win occurs when the leftmost N matching symbols form a run. */
const evaluatePaylines = (reels, betPerLine, paylines) => {
	const wins = [];
	for (let p = 0; p < paylines.length; p++) {
		const line = paylines[p];
		const seq = line.map((row, reel) => reels[reel][row]);
		const first = seq[0];
		if (!PAY_TABLE[first]) continue;
		let count = 1;
		for (let i = 1; i < seq.length; i++) {
			if (seq[i] === first) count++;
			else break;
		}
		if (count >= 3) {
			const mult = PAY_TABLE[first][count] ?? 0;
			if (mult > 0) {
				wins.push({
					what: first,
					occurs: count,
					mode: 'line',
					pay: mult * betPerLine,
					mpInfo: { mp: 1, replacements: 0 },
					mpBonusInfo: null,
					context: { paylineId: p, payline: line, direction: 'left' },
				});
			}
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
 * @param {{ startBalance?: number, seed?: string, label?: string }} [opts]
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
	const paylines =
		Array.isArray(opts.paylines) && opts.paylines.length ? opts.paylines : DEFAULT_PAYLINES;

	// Stacked-picture test mode (docs/design/stacked-picture-mode.md): deal contiguous high-symbol
	// runs + a full-height WILD so the engine's stacked-picture reel mode has data to render. Opt-in
	// (`STACKED=1` env or `createMockRgs({ stacked: true })`); OFF ⇒ the normal weighted deal.
	const stackedDeal = opts.stacked === true || process.env.STACKED === '1';
	// PICs that the lines facade maps to HIGH symbols (PIC1..PIC4 → H1..H4); WILD → W. These are the
	// symbols the mode stacks, so the test deal draws runs of them.
	const STACK_PICS = ['PIC1', 'PIC2', 'PIC3', 'PIC4'];

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
		// Weighted draw favouring low-pay symbols, occasional scatter, rare PIC7.
		const r = nextRand();
		if (r < 0.04) return 'SCAT';
		if (r < 0.4) return LINE_SYMBOLS[Math.floor(nextRand() * 3)]; // PIC1/2/3
		if (r < 0.75) return LINE_SYMBOLS[3 + Math.floor(nextRand() * 2)]; // PIC4/5
		if (r < 0.95) return LINE_SYMBOLS[5 + Math.floor(nextRand() * 1)]; // PIC6
		return 'PIC7';
	};
	/** 5 reels × 3 visible rows */
	const spinReels = () =>
		Array.from({ length: reelCount }, () => Array.from({ length: rowCount }, pickSymbol));

	/**
	 * Stacked-picture test deal: every reel is likely to carry ONE contiguous run of a high symbol
	 * (length 2..rows, random start ⇒ partial + full crops), and the LAST reel is a full-height WILD
	 * (the 5-tall Wild the mode must render whole). Non-run cells fall back to the normal weighted draw.
	 * Only used when `stackedDeal` is on, so the default deal is untouched.
	 */
	const spinReelsStacked = () =>
		Array.from({ length: reelCount }, (_ignored, reel) => {
			const column = Array.from({ length: rowCount }, pickSymbol);
			if (reel === reelCount - 1) return Array.from({ length: rowCount }, () => 'WILD');
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
					symbols: SYMBOLS,
					window: { reels: reelCount, rows: rowCount },
					paylines,
					wildSymbols: [],
					paytable: Object.fromEntries(
						Object.entries(PAY_TABLE).map(([sym, byCount]) => {
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
					const lineWins = evaluatePaylines(reels, pendingRound.betPerLine, paylines);
					const scatterWin = evaluateScatters(reels, pendingRound.total);
					const wins = scatterWin ? [...lineWins, scatterWin] : lineWins;
					const totalWin = wins.reduce((s, w) => s + w.pay, 0);
					pendingRound.win = totalWin;

					events.push({
						event: 'spinStart',
						context: {
							symbols: SYMBOLS,
							symbolsPay: { line: LINE_SYMBOLS, scatter: ['SCAT'] },
							wildSymbols: [],
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
