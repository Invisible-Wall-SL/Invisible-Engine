/**
 * Mock Play4Fun RGS server.
 *
 * Speaks the /rgs/engine batched-action protocol we captured from a real
 * Hot Fruits session. No auth, no Cloudflare, CORS-permissive — meant for
 * local development of the translator and engine wiring.
 *
 * Run from the repo root:
 *   node scripts/mock-rgs-server.mjs
 *
 * Optional env vars:
 *   PORT=7777                 (default)
 *   START_BALANCE=1300        (default — credits, integer)
 *   SEED=anything             (deterministic spin outcomes)
 *
 * Endpoints:
 *   POST /rgs/engine?sid=&seq=&gid=    — main batched-action endpoint
 *   GET  /healthz                       — { ok: true }
 *   GET  /state?sid=                    — debug: dump session state
 */

import { createServer } from 'node:http';

const PORT = Number(process.env.PORT ?? 7777);
const START_BALANCE = Number(process.env.START_BALANCE ?? 1300);
const SEED = process.env.SEED;

// ---------- session store ----------

/** sid -> { balance, round | null } */
const sessions = new Map();

const getSession = (sid) => {
	if (!sessions.has(sid)) {
		sessions.set(sid, { balance: START_BALANCE, round: null });
	}
	return sessions.get(sid);
};

// ---------- spin engine (deterministic-ish) ----------

const SYMBOLS = ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5', 'PIC6', 'PIC7', 'SCAT'];
const LINE_SYMBOLS = SYMBOLS.filter((s) => s !== 'SCAT');
const PAYLINES = [
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
];
const PAY_TABLE = {
	PIC1: { 3: 5, 4: 25, 5: 100 },
	PIC2: { 3: 5, 4: 25, 5: 100 },
	PIC3: { 3: 10, 4: 40, 5: 150 },
	PIC4: { 3: 10, 4: 40, 5: 150 },
	PIC5: { 3: 15, 4: 50, 5: 200 },
	PIC6: { 3: 20, 4: 75, 5: 300 },
	PIC7: { 3: 50, 4: 200, 5: 1000 },
};

let rngState = SEED ? hashStr(SEED) : Date.now() >>> 0;
function nextRand() {
	rngState = (rngState * 1664525 + 1013904223) >>> 0;
	return rngState / 0x100000000;
}
function hashStr(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h;
}
const pickSymbol = () => {
	// Slightly favour low-pay symbols
	const r = nextRand();
	if (r < 0.05) return 'SCAT';
	if (r < 0.4) return LINE_SYMBOLS[Math.floor(nextRand() * 3)]; // PIC1/2/3
	if (r < 0.75) return LINE_SYMBOLS[3 + Math.floor(nextRand() * 2)]; // PIC4/5
	if (r < 0.95) return LINE_SYMBOLS[5 + Math.floor(nextRand() * 1)]; // PIC6
	return 'PIC7';
};

/** 5 reels × 3 visible rows */
const spinReels = () => Array.from({ length: 5 }, () => Array.from({ length: 3 }, pickSymbol));

/** Evaluate paylines. Each payline is 5 row-indices (one per reel).
 *  A win occurs when the leftmost N matching symbols form a run. */
const evaluatePaylines = (reels, betPerLine) => {
	const wins = [];
	for (let p = 0; p < PAYLINES.length; p++) {
		const line = PAYLINES[p];
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
	return wins;
};

// ---------- request handler ----------

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
			'Vary': 'Origin',
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

const handleEngine = async (req, res, url) => {
	const sid = url.searchParams.get('sid');
	const seq = Number(url.searchParams.get('seq') ?? 0);
	const gid = url.searchParams.get('gid');

	if (!sid) return sendJson(req, res, 400, { error: { code: 'ERR_VAL', message: 'missing sid' } });

	const session = getSession(sid);
	const bodyText = await readBody(req);
	let actions;
	try {
		actions = bodyText ? JSON.parse(bodyText) : [];
	} catch {
		return sendJson(req, res, 400, { error: { code: 'ERR_VAL', message: 'body must be JSON array' } });
	}
	if (!Array.isArray(actions)) {
		return sendJson(req, res, 400, { error: { code: 'ERR_VAL', message: 'body must be an array' } });
	}

	console.log(`[mock] sid=${sid} seq=${seq} gid=${gid ?? '-'} actions=${JSON.stringify(actions.map((a) => a.action))}`);

	// Heartbeat: empty body returns balance only.
	if (actions.length === 0) {
		return sendJson(req, res, 200, { events: [], platform: { balance: session.balance } });
	}

	const events = [];
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
					context: { total, betPerLine, paylines: PAYLINES, maxWinCap: 0 },
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
				const reels = spinReels();
				pendingRound.reels = reels;
				const wins = evaluatePaylines(reels, pendingRound.betPerLine);
				const totalWin = wins.reduce((s, w) => s + w.pay, 0);
				pendingRound.win = totalWin;

				events.push({
					event: 'spinStart',
					context: {
						symbols: SYMBOLS,
						symbolsPay: { line: LINE_SYMBOLS, scatter: ['SCAT'] },
						wildSymbols: [],
						lineAlign: 'left',
						lineCoinciding: false,
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
						error: 'error executing requested actions: unexpected action: collect (was expecting: play)',
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

// ---------- server ----------

const server = createServer(async (req, res) => {
	const url = new URL(req.url, `http://${req.headers.host}`);

	if (req.method === 'OPTIONS') return sendCorsPreflight(req, res);

	if (req.method === 'GET' && url.pathname === '/healthz') {
		return sendJson(req, res, 200, { ok: true, sessions: sessions.size });
	}

	if (req.method === 'GET' && url.pathname === '/state') {
		const sid = url.searchParams.get('sid');
		if (!sid) return sendJson(req, res, 400, { error: 'missing sid' });
		return sendJson(req, res, 200, getSession(sid));
	}

	if (req.method === 'POST' && url.pathname === '/rgs/engine') {
		try {
			return await handleEngine(req, res, url);
		} catch (err) {
			console.error('[mock] handler error:', err);
			return sendJson(req, res, 500, { error: { code: 'ERR_UE', message: String(err) } });
		}
	}

	sendJson(req, res, 404, { error: 'not found' });
});

server.listen(PORT, () => {
	console.log(`[mock] Play4Fun RGS mock listening on http://localhost:${PORT}`);
	console.log(`[mock] starting balance: ${START_BALANCE}, seed: ${SEED ?? '(time-based)'}`);
	console.log(`[mock] try: curl -X POST http://localhost:${PORT}/rgs/engine?sid=test`);
});
