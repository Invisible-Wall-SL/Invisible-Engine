/**
 * Mock Play4Fun RGS server — BOOK-OF variant (Book of Thermopylae / Book of Borut).
 *
 * Speaks the /rgs/engine batched-action protocol, faithful to a real Book of
 * Thermopylae session capture (2026-05-25). Adds the two things the Hot Fruits
 * mock never exercised:
 *   - BUY FEATURE: `bet` context [x, M] read as the partner reads it for a game that declares
 *     `betOptions`: x is the OPTION INDEX (0 base, 1 buy), M the multiplier, and the stake is
 *     `BET_OPTIONS[x] × M` cents, so a buy costs 100× the base spin at the same M. An index outside
 *     the table is refused. See docs/reference/play4fun-protocol.md, "The first bet argument".
 *   - FREE-SPIN BONUS: multi-request round. The trigger response stays OPEN
 *     (no gameRoundOver) and emits spinTrigger + enterBonus + pickRandomly
 *     (the special expanding symbol). Each subsequent `play` is one free spin
 *     (playedBonusSpin); the last adds playedBonusSpins + gameEnd; `collect`
 *     closes the round (gameRoundOver) and credits the accumulated win.
 *   - RESUME: every stored action is kept at its `seq` position. A boot `config` while a round is
 *     open carries `actions` + `resume: true` and names the round on `platform.gameRound`, and
 *     re-posting an occupied position under the round's `gid` REPLAYS the result already dealt —
 *     the partner's contract (docs/reference/play4fun-protocol.md, "Resume").
 *
 * Kept separate from mock-rgs-server.mjs so the Hot Fruits mock stays untouched.
 *
 * Two ways to use it:
 *   1. Standalone CLI (local dev):  node scripts/mock-rgs-server-book.mjs   # PORT 7788
 *   2. In-process: `import { createMockRgs }` and mount its `handle` under a
 *      path prefix (the Invisible Test Server — `services/test-server`). `handle`
 *      matches routes by path SUFFIX, so it works at root or under `/api/<gameKey>`.
 *
 * Env (CLI): PORT=7788, START_BALANCE=500000 (cents = $5000), SEED=anything,
 *      FORCE_TRIGGER=1 (every base play triggers the bonus — handy for testing),
 *      BIG_WIN=1 (force a top-tier base win to verify the win presentation),
 *      AUTO_COLLECT=0 (the partner's rule: a winning base round stays open until `collect`,
 *      whatever `play.context` says — the only way a round is left open to resume).
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

// ---------- pure game data (verified from the live config event) ----------

const SYMBOLS = ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'ACE', 'KING', 'QUEEN', 'JACK', 'TEN', 'SCAT'];
/** Paying symbols eligible to become the free-spin special expanding symbol. */
const PAY_SYMBOLS = ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'ACE', 'KING', 'QUEEN', 'JACK', 'TEN'];
/** Credit cost of each bet option, base then the bought feature. `BET_OPTIONS[0]` is the game cost
 *  (10 lines), so M is the per-line stake. */
const BET_OPTIONS = [10, 1000];
const NUM_LINES = 10;
// When false (the production rule, surfaced in the config event), two paylines
// whose winning combination lands on the IDENTICAL cells are the same win — it
// must pay ONCE, not once per line that happens to cross those cells. E.g. lines
// [2,2,2,2,2] and [2,2,1,0,0] both pay a 2-of-a-kind on cells (0,2)+(1,2): with
// coinciding off, only one of them counts.
const LINE_COINCIDING = false;
const PAYLINES = [
	[1, 1, 1, 1, 1],
	[0, 0, 0, 0, 0],
	[2, 2, 2, 2, 2],
	[0, 1, 2, 1, 0],
	[2, 1, 0, 1, 2],
	[0, 0, 1, 2, 2],
	[2, 2, 1, 0, 0],
	[1, 2, 2, 2, 1],
	[1, 0, 0, 0, 1],
	[1, 0, 1, 2, 1],
];

/** Line paytable keyed by of-a-kind count. PIC1-4 pay from 2, royals from 3. */
const PAY_TABLE_LINE = {
	PIC1: { 2: 10, 3: 100, 4: 1000, 5: 5000 },
	PIC2: { 2: 10, 3: 30, 4: 400, 5: 2000 },
	PIC3: { 2: 5, 3: 30, 4: 100, 5: 750 },
	PIC4: { 2: 5, 3: 20, 4: 100, 5: 750 },
	ACE: { 3: 5, 4: 50, 5: 150 },
	KING: { 3: 5, 4: 50, 5: 150 },
	QUEEN: { 3: 5, 4: 20, 5: 100 },
	JACK: { 3: 5, 4: 20, 5: 100 },
	TEN: { 3: 5, 4: 20, 5: 100 },
};
const SCATTER_PAY = { 3: 2, 4: 20, 5: 200 }; // SCAT (the Book): only the 3/4/5 trigger gate now

/**
 * The line table an instance ACTUALLY pays, declares and expands with: the PROJECT's authored row
 * per symbol (`symbolPaytable`, server vocabulary, from its Invisible Game Config), else the captured
 * `PAY_TABLE_LINE` row — the lines mock's `payRowOf` rule, whole row per symbol, never merged per
 * count. One table feeds the payline pass, the expanding special and the boot `config` event, so
 * what the mock declares is what it pays. No table ⇒ `PAY_TABLE_LINE` exactly.
 */
const effectivePayTable = (symbolPaytable) =>
	Object.fromEntries(
		PAY_SYMBOLS.map((symbol) => [symbol, symbolPaytable?.[symbol] ?? PAY_TABLE_LINE[symbol]]),
	);

/**
 * A payout in whole CENTS, the protocol's only denomination — the lines mock's `payCents`. An
 * authored multiplier may be fractional (`0.4 × 1¢`); rounded, with a one-cent floor so a win the
 * player can see never pays nothing. Inert for the captured integer table.
 */
const payCents = (amount) => (amount > 0 ? Math.max(1, Math.round(amount)) : 0);

/** pickRandomly probabilities for the special symbol, from the capture. */
const SPECIAL_WEIGHTS = {
	PIC1: 0.09,
	PIC2: 0.09,
	PIC3: 0.09,
	PIC4: 0.095,
	ACE: 0.095,
	KING: 0.095,
	QUEEN: 0.11,
	JACK: 0.14,
	TEN: 0.195,
};
const TOTAL_FS = 10;
/** Extra free spins awarded when 3+ SCAT land during a free spin (retrigger). */
const RETRIGGER_FS = 10;

function hashStr(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h;
}

/** Build the boot `config` event faithful to the live Book of Thermopylae wire
 *  shape (availablePayLines + nested paytable {line,scatter}). `payTable` is the instance's
 *  `effectivePayTable`, so the declared line rows are the rows it pays. */
const buildConfigContext = (payTable) => ({
	symbols: SYMBOLS,
	availablePayLines: PAYLINES,
	betOptions: BET_OPTIONS,
	gameCost: BET_OPTIONS[0],
	lineAlign: 'left',
	lineCoinciding: LINE_COINCIDING,
	maxWinMp: [10000],
	paytable: {
		line: PAY_SYMBOLS.map((of) => {
			const counts = Object.keys(payTable[of])
				.map(Number)
				.sort((a, b) => a - b);
			return {
				on: { occurs: counts, of, mode: 'line' },
				pay: counts.map((c) => payTable[of][c]),
			};
		}),
		scatter: [
			{
				on: { occurs: [3, 4, 5], of: 'SCAT', mode: 'scatter' },
				pay: [2, 20, 200],
				trigger: 'feature',
			},
		],
	},
	symbolsPay: {
		line: ['PIC1', 'SCAT', ...PAY_SYMBOLS.filter((s) => s !== 'PIC1')],
		scatter: ['SCAT'],
	},
	wildSymbols: ['SCAT'],
	window: { reels: 5, rows: 3 },
});

// ---------- pure win evaluation ----------

const evaluatePaylines = (reels, betPerLine, payTable) => {
	const wins = [];
	for (let p = 0; p < PAYLINES.length; p++) {
		const line = PAYLINES[p];
		const seq = line.map((row, reel) => reels[reel][row]);
		const first = seq[0];
		if (!payTable[first]) continue;
		let count = 1;
		for (let i = 1; i < seq.length; i++) {
			if (seq[i] === first || seq[i] === 'SCAT')
				count++; // SCAT is wild
			else break;
		}
		const mult = payTable[first][count];
		if (mult > 0) {
			wins.push({
				what: first,
				occurs: count,
				mode: 'line',
				pay: payCents(mult * betPerLine),
				mpInfo: { mp: 1, replacements: 0 },
				mpBonusInfo: null,
				context: { paylineId: p + 1, payline: line, direction: 'left' },
			});
		}
	}
	return LINE_COINCIDING ? wins : dedupeCoincidingWins(wins);
};

/** The board cells that actually form a win: the leftmost `occurs` reel/row
 *  positions of its payline (`['0:2','1:2',…]`). */
const winningCells = ({ occurs, context }) =>
	context.payline.slice(0, occurs).map((row, reel) => `${reel}:${row}`);

const isSubset = (a, b) => a.every((c) => b.includes(c));

/** With `lineCoinciding: false`, a line win is kept only if its winning cells
 *  are NOT contained in another winning line. Collapses both flavours of the
 *  same-symbols-paid-twice problem:
 *   - coincidence — two lines pay the IDENTICAL cells (e.g. [2,2,2,2,2] and
 *     [2,2,1,0,0] both 2-of-a-kind on (0,2)+(1,2)); keep the higher pay.
 *   - subsumption — a 2-of-a-kind whose cells are the first two of a 3-of-a-kind
 *     on another line; the shorter run is already paid inside the longer one.
 *  Identical cells ⇒ identical board symbols, so this never merges genuinely
 *  different symbols or non-overlapping lines. */
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

const scatterPositions = (reels) => {
	const pos = [];
	for (let reel = 0; reel < reels.length; reel++)
		for (let row = 0; row < reels[reel].length; row++)
			if (reels[reel][row] === 'SCAT') pos.push({ reel, row });
	return pos;
};

const evaluateScatterTrigger = (reels) => {
	const pos = scatterPositions(reels);
	// SCATTER_PAY is now only the qualifying-count gate (3/4/5) — the scatter/book
	// match TRIGGERS the free-spins feature, it does NOT pay out. The win is kept
	// as a zero-pay entry so the scatter symbols still glow on the trigger spin and
	// the trigger count/positions still flow to the client (freeSpinTrigger).
	if (!SCATTER_PAY[pos.length]) return null;
	return {
		win: {
			what: 'SCAT',
			occurs: pos.length,
			mode: 'scatter',
			pay: 0,
			mpInfo: { mp: 1, replacements: 0 },
			mpBonusInfo: null,
			context: pos,
		},
		count: pos.length,
	};
};

/** The reels on which the chosen special symbol appears (its expansion set). */
const reelsCovering = (reels, special) => {
	const out = [];
	for (let reel = 0; reel < reels.length; reel++) {
		if (reels[reel].some((s) => s === special)) out.push(reel);
	}
	return out;
};

/** The minimum reel coverage that makes the special expand and pay. Mirrors the
 *  paytable: royals and PIC2–4 pay from 3-of-a-kind, so they need 3 reels; PIC1
 *  (the top symbol) pays from 2-of-a-kind, so it expands from 2 — the Book-of-Ra
 *  deluxe rule. This gate MUST match the client morph gate in `engineFacade.ts`
 *  so the reels that visibly expand are exactly the reels that pay. */
const specialExpandsAt = (special, reelCount) => reelCount >= (special === 'PIC1' ? 2 : 3);

/** Free-spin expanding special (Book mechanic): when the chosen special covers
 *  enough reels (see `specialExpandsAt`) it expands to FILL each of those reels.
 *  This returns the EXPANDED board so the OTHER symbols can pay their normal
 *  line wins on it; the special's OWN payout is handled scatter-style by
 *  `evaluateExpandingSpecial`, not by the paylines. Callers only invoke this
 *  when the special qualifies, so the expansion set is unconditional here. */
const expandSpecialBoard = (reels, special) => {
	const reelsWith = reelsCovering(reels, special);
	return reels.map((reel, reelIndex) =>
		reelsWith.includes(reelIndex) ? reel.map(() => special) : reel,
	);
};

/** The expanding special pays like a scatter: on the COUNT OF REELS it covers
 *  (adjacency-independent — a fully expanded reel puts the symbol on every
 *  payline), at its line-paytable value × BASE stake. `mult × baseStake`
 *  equals `mult × betPerLine × NUM_LINES` — the symbol paying that N-of-a-kind
 *  on all ten lines at once. Positions are every cell of every covered reel
 *  (post-expansion the whole reel). Returns null below the expand gate, and also when the special's
 *  row prices nothing at that reel count (an authored row may omit it) — the spin then pays as a
 *  natural board, though the client's reel-count morph gate still expands it on screen. */
const evaluateExpandingSpecial = (reels, special, baseStake, payTable) => {
	const reelsWith = reelsCovering(reels, special);
	if (!specialExpandsAt(special, reelsWith.length)) return null;
	const mult = payTable[special]?.[reelsWith.length];
	if (!(mult > 0)) return null;
	const positions = [];
	for (const reel of reelsWith)
		for (let row = 0; row < reels[reel].length; row++) positions.push({ reel, row });
	return {
		what: special,
		occurs: reelsWith.length,
		mode: 'scatter',
		pay: payCents(mult * baseStake),
		mpInfo: { mp: 1, replacements: 0 },
		mpBonusInfo: null,
		context: positions,
	};
};

// ---------- bonus state snapshot helpers (faithful to capture shape) ----------

const bonusSnapshot = (round, extra = {}) => ({
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
						trigger: { occurs: [4], of: 'SCAT', mode: 'scatter', from: '' },
						state: round.bonus.special,
					},
				]
			: [],
	playing: 'feature',
	state: round.bonus.special,
	trigger: { occurs: [4], of: 'SCAT', mode: 'scatter', from: '' },
	...extra,
});

const spinStartEvent = (round) => ({
	event: 'spinStart',
	context: {
		symbols: SYMBOLS,
		symbolsPay: {
			line: ['PIC1', 'SCAT', ...PAY_SYMBOLS.filter((s) => s !== 'PIC1')],
			// During the bonus the special symbol pays scatter-style too.
			scatter: round.bonus?.active ? ['SCAT', round.bonus.special] : ['SCAT'],
		},
		wildSymbols: ['SCAT'],
		lineAlign: 'left',
		lineCoinciding: LINE_COINCIDING,
		gameCost: BET_OPTIONS[0],
		betOptions: BET_OPTIONS,
		maxWinMp: [10000],
	},
});

// ---------- pure HTTP plumbing ----------

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
	res.writeHead(204, { ...corsHeaders(req), 'Access-Control-Max-Age': '86400' });
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
 * Create a Book-of Play4Fun RGS mock instance. Each instance owns its own
 * session store + RNG.
 *
 * @param {{ startBalance?: number, seed?: string, forceTrigger?: boolean,
 *           bigWin?: boolean, autoCollect?: boolean, label?: string,
 *           symbolPaytable?: Record<string, Record<string, number>> }} [opts]
 *
 * `symbolPaytable` is the project's authored line table in SERVER names (`PIC1`…`TEN`), as the
 * Invisible Test Server receives it in the project's live mock contract (`grid.symbolPaytable`).
 */
export function createMockRgs(opts = {}) {
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 500_000); // cents → $5000
	const seed = opts.seed ?? process.env.SEED;
	const forceTrigger = opts.forceTrigger ?? process.env.FORCE_TRIGGER === '1';
	// BIG_WIN forces a full-screen PIC1 base spin (a top-tier win) so the
	// big/mega/max WIN presentation can be verified on demand. Ignored when a
	// bonus is triggered.
	const bigWin = opts.bigWin ?? process.env.BIG_WIN === '1';
	const autoCollectAllowed = opts.autoCollect ?? process.env.AUTO_COLLECT !== '0';
	const label = opts.label ?? 'mock-book';
	const payTable = effectivePayTable(opts.symbolPaytable);

	const sessions = new Map();
	/** Closed rounds by id, so a request re-posted under its `gid` replays after the round closed —
	 *  a `collect` whose answer was lost is resent into a round the server has already closed. */
	const settledRounds = new Map();
	const settle = (round) => {
		settledRounds.set(round.id, round);
		if (settledRounds.size > 500) settledRounds.delete(settledRounds.keys().next().value);
	};
	const getSession = (sid) => {
		if (!sessions.has(sid))
			sessions.set(sid, { balance: startBalance, round: null, configSent: false });
		return sessions.get(sid);
	};

	let rngState = seed ? hashStr(seed) : Date.now() >>> 0;
	const nextRand = () => {
		rngState = (rngState * 1664525 + 1013904223) >>> 0;
		return rngState / 0x100000000;
	};
	const pickSymbol = () => {
		const r = nextRand();
		if (r < 0.05) return 'SCAT';
		return PAY_SYMBOLS[Math.floor(nextRand() * PAY_SYMBOLS.length)];
	};
	/** Force ≥3 SCAT for a guaranteed trigger (buy / forceTrigger). */
	const spinReelsWithScatters = (n = 4) => {
		const reels = Array.from({ length: 5 }, () => Array.from({ length: 3 }, pickSymbol));
		let placed = 0;
		for (let reel = 0; reel < 5 && placed < n; reel++) {
			reels[reel][Math.floor(nextRand() * 3)] = 'SCAT';
			placed++;
		}
		return reels;
	};
	const spinReels = () => Array.from({ length: 5 }, () => Array.from({ length: 3 }, pickSymbol));
	const pickSpecialSymbol = () => {
		const total = Object.values(SPECIAL_WEIGHTS).reduce((s, w) => s + w, 0);
		let r = nextRand() * total;
		for (const [sym, w] of Object.entries(SPECIAL_WEIGHTS)) {
			if ((r -= w) <= 0) return sym;
		}
		return 'TEN';
	};

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
		if (!Array.isArray(actions))
			return sendJson(req, res, 400, {
				error: { code: 'ERR_VAL', message: 'body must be an array' },
			});

		console.log(
			`[${label}] sid=${sid} seq=${seq} gid=${gid ?? '-'} actions=${JSON.stringify(actions.map((a) => a.action))}`,
		);

		const events = [];
		const openRound = (round) => ({
			updating: true,
			id: round.id,
			...(round.bonus ? { outcome: 'bonus', inGameBet: round.baseBet } : {}),
		});
		// Send the boot `config` on the first call AND on every heartbeat (empty
		// body = the auth call). A real server sends it once per session, but the
		// facade module resets on each browser reload while this mock keeps the
		// session — re-sending on heartbeat ensures every (re)load re-captures it
		// (and re-selects the book symbol mapping).
		const isConfigCall = actions.length === 1 && actions[0].action === 'config';
		if (!session.configSent || actions.length === 0 || isConfigCall) {
			session.configSent = true;
			const config = { event: 'config', context: buildConfigContext(payTable) };
			if (session.round) {
				config.actions = session.round.stored.map((s) => s.action);
				config.resume = true;
			}
			events.push(config);
		}
		if (actions.length === 0 || isConfigCall) {
			const platform = { balance: session.balance };
			if (session.round) platform.gameRound = openRound(session.round);
			return sendJson(req, res, 200, { events, platform });
		}

		let round = session.round;

		for (const [offset, a] of actions.entries()) {
			// An occupied position under the round's own gid is a REPLAY: answer with what was dealt.
			const position = seq + offset;
			const target = !gid ? undefined : round?.id === gid ? round : settledRounds.get(gid);
			const stored = target?.stored[position];
			if (stored) {
				if (stored.action.action !== a.action) {
					return sendJson(req, res, 200, {
						result: 0,
						error: `replay mismatch at ${position}: stored ${stored.action.action}, got ${a.action}`,
						errorCode: 110,
						platform: {},
					});
				}
				events.push(...stored.events);
				continue;
			}
			const dealtFrom = events.length;
			switch (a.action) {
				case 'bet': {
					const ctx = Array.isArray(a.context) ? a.context : [0, 1];
					const option = Number(ctx[0] ?? 0);
					if (!Number.isInteger(option) || option < 0 || option >= BET_OPTIONS.length) {
						return sendJson(req, res, 200, {
							result: 0,
							error: `invalid bet option ${ctx[0]}`,
							errorCode: 101,
							platform: { balance: session.balance },
						});
					}
					const isBuy = option > 0;
					const betPerLine = Number(ctx[1]) || 1;
					const total = BET_OPTIONS[option] * betPerLine;
					if (session.balance < total) {
						return sendJson(req, res, 200, {
							result: 0,
							error: 'insufficient balance',
							errorCode: 200,
							platform: { balance: session.balance },
						});
					}
					session.balance -= total;
					round = {
						id: makeRoundId(),
						betPerLine,
						total,
						baseBet: betPerLine * NUM_LINES,
						isBuy,
						win: 0,
						bonus: null,
						closed: false,
						stored: [],
					};
					events.push({ event: 'bet', context: { total, betPerLine, paylines: PAYLINES } });
					events.push({ event: 'gameStart', context: { totalBet: total, betPerLine } });
					break;
				}
				case 'play': {
					if (!round) {
						return sendJson(req, res, 200, {
							result: 0,
							error: 'play without bet',
							errorCode: 110,
							platform: {},
						});
					}

					// ----- FREE SPIN (round already in bonus) -----
					if (round.bonus?.active) {
						const reels = spinReels();
						events.push(spinStartEvent(round));
						// Book mechanic: the chosen special is an expanding symbol. If it
						// covers enough reels it pays scatter-style (on the reel count, × BASE
						// stake — adjacency-independent), THEN expands and lets the
						// OTHER symbols pay their normal line wins on the expanded board.
						// The special itself is excluded from the line pass so it is never
						// paid twice. Below the gate it is a plain symbol: normal line
						// evaluation on the natural board.
						const special = round.bonus.special;
						// The BASE stake, never `round.total`: a bought round's total carries the buy
						// premium, which would pay the special 100× over.
						const specialWin = evaluateExpandingSpecial(reels, special, round.baseBet, payTable);
						let wins;
						if (specialWin) {
							const paidBoard = expandSpecialBoard(reels, special);
							const lineWins = evaluatePaylines(paidBoard, round.betPerLine, payTable).filter(
								(w) => w.what !== special,
							);
							wins = [specialWin, ...lineWins];
						} else {
							wins = evaluatePaylines(reels, round.betPerLine, payTable);
						}
						for (const w of wins) {
							events.push({
								event: 'bonusWin',
								context: { bonus: 'feature', pay: w.pay, isSpinWin: true },
							});
							events.push({ event: 'spinWin', context: w });
							round.win += w.pay;
						}
						events.push({ event: 'playedSpin', context: reels });
						round.bonus.played += 1;
						round.bonus.left -= 1;
						// RETRIGGER: 3+ SCAT (the Book) landing DURING a free spin awards +10
						// more free spins, added to the remaining count (unlimited chaining).
						// Only the scatter retriggers — the special expanding symbol never does.
						// Emitted BEFORE playedBonusSpin so the counter (total = played + left)
						// already reflects the new total on this spin.
						const retrig = evaluateScatterTrigger(reels);
						if (retrig && retrig.count >= 3) {
							round.bonus.left += RETRIGGER_FS;
							round.bonus.total += RETRIGGER_FS;
							events.push({
								event: 'retrigger',
								context: {
									spins: RETRIGGER_FS,
									occurs: retrig.count,
									total: round.bonus.total,
									left: round.bonus.left,
									bonus: 'feature',
								},
							});
						}
						events.push({ event: 'playedBonusSpin', context: bonusSnapshot(round) });
						if (round.bonus.left <= 0) {
							round.bonus.active = false;
							events.push({ event: 'playedBonusSpins', context: bonusSnapshot(round) });
							events.push({ event: 'gameEnd', context: { win: round.win } });
						}
						break;
					}

					// ----- BASE SPIN -----
					const trigger = round.isBuy || forceTrigger;
					// bigWin: PIC1 4-of-a-kind on the middle line (broken at reel 4) →
					// a MEGA-tier win, enough to show the big-win banner without hitting
					// the MAX special-case.
					const reels = trigger
						? spinReelsWithScatters(4)
						: bigWin
							? [
									['TEN', 'PIC1', 'TEN'],
									['TEN', 'PIC1', 'TEN'],
									['TEN', 'PIC1', 'TEN'],
									['TEN', 'PIC1', 'TEN'],
									['TEN', 'KING', 'TEN'],
								]
							: spinReels();
					events.push(spinStartEvent(round));
					const lineWins = evaluatePaylines(reels, round.betPerLine, payTable);
					const scat = evaluateScatterTrigger(reels);
					const wins = scat ? [...lineWins, scat.win] : lineWins;
					for (const w of wins) {
						events.push({ event: 'spinWin', context: w });
						round.win += w.pay;
					}
					const triggered = (scat && scat.count >= 3) || trigger;

					if (triggered) {
						// Enter the bonus: round STAYS OPEN. Draw the special symbol.
						const special = pickSpecialSymbol();
						round.bonus = { active: true, total: TOTAL_FS, played: 0, left: TOTAL_FS, special };
						events.push({
							event: 'spinTrigger',
							context: {
								spins: [{ prob: 1, spins: TOTAL_FS }],
								occurs: scat?.count ?? 4,
								bonus: 'feature',
								trigger: { occurs: [3, 4, 5], of: 'SCAT', mode: 'scatter', from: '' },
							},
						});
						events.push({ event: 'playedSpin', context: reels });
						events.push({
							event: 'enterBonus',
							context: bonusSnapshot(round, { played: 0, left: TOTAL_FS }),
						});
						events.push({
							event: 'pickRandomly',
							context: {
								items: PAY_SYMBOLS.map((s) => ({ state: s, prob: SPECIAL_WEIGHTS[s] })),
								state: bonusSnapshot(round, { played: 0, left: TOTAL_FS, playing: 'feature' }),
								scope: 'enterState',
								item: { state: special, prob: SPECIAL_WEIGHTS[special] },
							},
						});
						// Do NOT credit yet, do NOT close — free spins + collect follow.
						break;
					}

					// No trigger → base round resolves now.
					events.push({ event: 'playedSpin', context: reels });
					events.push({ event: 'gameEnd', context: { win: round.win } });
					const autoCollect = autoCollectAllowed && (a.context === '' || a.context === undefined);
					if (autoCollect || round.win === 0) {
						session.balance += round.win;
						events.push({ event: 'gameRoundOver', context: { win: round.win } });
						round.closed = true;
					}
					break;
				}
				case 'collect': {
					if (!round || round.id !== gid) {
						return sendJson(req, res, 200, {
							result: 0,
							error: 'unexpected action: collect',
							errorCode: 110,
							platform: {},
						});
					}
					if (!round.closed) {
						session.balance += round.win;
						round.closed = true;
					}
					events.push({ event: 'gameRoundOver', context: { win: round.win } });
					break;
				}
				default:
					return sendJson(req, res, 200, {
						result: 0,
						error: `unknown action: ${a.action}`,
						errorCode: 110,
						platform: {},
					});
			}
			round?.stored.push({ action: a, events: events.slice(dealtFrom) });
		}

		if (round?.closed) settle(round);
		session.round = round && round.closed ? null : round;

		const platform = { balance: session.balance };
		if (round && !round.closed) {
			platform.gameRound = openRound(round);
		}
		return sendJson(req, res, 200, { events, platform });
	};

	/** Path-agnostic dispatcher. `url` is a parsed URL; routes match by suffix. */
	const handle = async (req, res, url) => {
		if (req.method === 'OPTIONS') return sendCorsPreflight(req, res);
		if (req.method === 'GET' && pathEndsWith(url.pathname, '/healthz'))
			return sendJson(req, res, 200, { ok: true, sessions: sessions.size });
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

	return { handle, sessions, startBalance, seed, forceTrigger, autoCollect: autoCollectAllowed };
}

// ---------- standalone CLI entry (local dev) ----------

const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
	const PORT = Number(process.env.PORT ?? 7788);
	const mock = createMockRgs({ label: 'mock-book' });
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${req.headers.host}`);
		return mock.handle(req, res, url);
	});
	server.listen(PORT, () => {
		console.log(
			[
				'',
				'   ┏━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
				'   ┃   I N V I S I B L E   W A L L   S L',
				'   ┃   ────────────────────────────────────────',
				'   ┃   MOCK RGS   ·   Play4Fun   ·   BOOK-OF',
				'   ┃',
				`        http://localhost:${PORT}   ·   Ctrl+C to stop`,
				'',
			].join('\n'),
		);
		console.log(
			`[mock-book] listening on http://localhost:${PORT}  balance=${mock.startBalance} seed=${mock.seed ?? '(time)'} forceTrigger=${mock.forceTrigger} autoCollect=${mock.autoCollect}`,
		);
	});
}
