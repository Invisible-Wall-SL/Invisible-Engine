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
 *      WIN_X=10,20,40 (the n-th base spin pays ≥ WIN_X[n] × the base stake — `parseWinX`),
 *      AUTO_COLLECT=0 (the partner's rule: a winning base round stays open until `collect`,
 *      whatever `play.context` says — the only way a round is left open to resume).
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { createPlatformJackpot } from './mock-platform-jackpot.mjs';
import {
	awardTableOf,
	boardPayingAtLeast,
	drawAwardFrom,
	MAX_ROUND_FREE_SPINS,
	MAX_STRIPS_ROUND_SPINS,
	parseWinX,
} from './mock-rgs-server.mjs';

// ---------- pure game data (verified from the live config event) ----------

const SYMBOLS = ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'ACE', 'KING', 'QUEEN', 'JACK', 'TEN', 'SCAT'];
/** Paying symbols eligible to become the free-spin special expanding symbol. */
const PAY_SYMBOLS = ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'ACE', 'KING', 'QUEEN', 'JACK', 'TEN'];
/** Credit cost of each bet option, base then the bought feature. `BET_OPTIONS[0]` is the game cost
 *  (10 lines), so M is the per-line stake. */
const BET_OPTIONS = [10, 1000];
const NUM_LINES = 10;
/** The captured cap on a round's win, as a multiple of the base stake. */
const MAX_WIN_MP = [10000];
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
 * The symbols an instance deals, picks its expanding special from and declares: the project's in-play
 * pool (`opts.symbols`, SERVER names, kept to the ones this mock knows) — so a symbol its Invisible
 * Game Config marks unused never lands — else the captured set. A pool naming every symbol is the
 * captured set, and one naming no paying symbol keeps them all: the lines mock's rules, never a blank
 * board.
 */
const symbolPool = (symbols) => {
	const named = Array.isArray(symbols) ? SYMBOLS.filter((s) => symbols.includes(s)) : [];
	const restricted = named.length > 0 && named.length < SYMBOLS.length;
	const pay = restricted ? PAY_SYMBOLS.filter((s) => named.includes(s)) : [];
	return {
		pay: pay.length ? pay : PAY_SYMBOLS,
		scatter: restricted ? named.includes('SCAT') : true,
	};
};

/** Every symbol a pool deals, in the captured order. */
const dealtSymbols = (pool) => [...pool.pay, ...(pool.scatter ? ['SCAT'] : [])];

/** The line-paying symbols as the capture lists them: the top payer, then the Book, then the rest. */
const linePaying = (pool) => [pool.pay[0], ...(pool.scatter ? ['SCAT'] : []), ...pool.pay.slice(1)];

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
/** Free spins awarded on entering, when the project authors no table (game-config's
 *  `BOOK_FREE_SPINS_DEFAULTS.award`). */
const TOTAL_FS = 10;
/** Extra free spins awarded when the trigger lands again during a free spin, when the project
 *  authors no retrigger table — the Book-of default, +10 (game-config's
 *  `BOOK_FREE_SPINS_DEFAULTS.retrigger`; a lines game's is +5). */
const RETRIGGER_FS = 10;
/** Fewest books that trigger (and retrigger) the feature when the project states no count. */
const FS_TRIGGER_MIN = 3;

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
 *  `effectivePayTable`, so the declared line rows are the rows it pays; `pool` its `symbolPool`, so
 *  the declared symbols are the ones it deals. */
const buildConfigContext = (payTable, pool, betOptions) => ({
	symbols: dealtSymbols(pool),
	availablePayLines: PAYLINES,
	betOptions,
	gameCost: betOptions[0],
	lineAlign: 'left',
	lineCoinciding: LINE_COINCIDING,
	maxWinMp: MAX_WIN_MP,
	paytable: {
		line: pool.pay.map((of) => {
			const counts = Object.keys(payTable[of])
				.map(Number)
				.sort((a, b) => a - b);
			return {
				on: { occurs: counts, of, mode: 'line' },
				pay: counts.map((c) => payTable[of][c]),
			};
		}),
		scatter: pool.scatter
			? [
					{
						on: { occurs: [3, 4, 5], of: 'SCAT', mode: 'scatter' },
						pay: [2, 20, 200],
						trigger: 'feature',
					},
				]
			: [],
	},
	symbolsPay: {
		line: linePaying(pool),
		scatter: pool.scatter ? ['SCAT'] : [],
	},
	wildSymbols: pool.scatter ? ['SCAT'] : [],
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

const evaluateScatterTrigger = (reels, authoredMin) => {
	const pos = scatterPositions(reels);
	// SCATTER_PAY is now only the qualifying-count gate (3/4/5) — the scatter/book
	// match TRIGGERS the free-spins feature, it does NOT pay out. The win is kept
	// as a zero-pay entry so the scatter symbols still glow on the trigger spin and
	// the trigger count/positions still flow to the client (freeSpinTrigger). A project that states
	// its own count (`authoredMin`, from `/config`'s Free spins section) qualifies from that count
	// up, with no top.
	const qualifies = authoredMin ? pos.length >= authoredMin : SCATTER_PAY[pos.length];
	if (!qualifies) return null;
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
/** The captured thresholds: PIC1 expands from 2 reels, every other special from 3. */
const SPECIAL_MIN_REELS = { PIC1: 2 };
const SPECIAL_DEFAULT_MIN_REELS = 3;
const specialExpandsAt = (special, reelCount) =>
	reelCount >= (SPECIAL_MIN_REELS[special] ?? SPECIAL_DEFAULT_MIN_REELS);

/**
 * The captured Book of Thermopylae numbers this mock deals, as one read-only record — what
 * game-config's Book of Thermopylae preset (`bookOfThermopylaePreset`) restates in a project's own
 * names. `check:book-preset` holds the two equal through `bookMapping`, so neither can drift.
 */
export const BOOK_OF_THERMOPYLAE = Object.freeze({
	window: { reels: 5, rows: 3 },
	paylines: PAYLINES,
	lineCoinciding: LINE_COINCIDING,
	payTableLine: PAY_TABLE_LINE,
	scatterPay: SCATTER_PAY,
	betOptions: BET_OPTIONS,
	maxWinMp: MAX_WIN_MP[0],
	triggerMin: FS_TRIGGER_MIN,
	totalFreeSpins: TOTAL_FS,
	retriggerFreeSpins: RETRIGGER_FS,
	specialWeights: SPECIAL_WEIGHTS,
	specialMinReels: SPECIAL_MIN_REELS,
	specialDefaultMinReels: SPECIAL_DEFAULT_MIN_REELS,
});

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

const spinStartEvent = (round, pool, betOptions) => ({
	event: 'spinStart',
	context: {
		symbols: dealtSymbols(pool),
		symbolsPay: {
			line: linePaying(pool),
			// During the bonus the special symbol pays scatter-style too.
			scatter: [
				...(pool.scatter ? ['SCAT'] : []),
				...(round.bonus?.active ? [round.bonus.special] : []),
			],
		},
		wildSymbols: pool.scatter ? ['SCAT'] : [],
		lineAlign: 'left',
		lineCoinciding: LINE_COINCIDING,
		gameCost: betOptions[0],
		betOptions,
		maxWinMp: MAX_WIN_MP,
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
 *           symbolPaytable?: Record<string, Record<string, number>>,
 *           symbols?: string[],
 *           freeSpins?: false, freeSpinsTrigger?: { symbol: string, count: number },
 *           freeSpinsAwards?: { awards: object[], retrigger: object[], random: boolean },
 *           overlay?: (host: object) => object }} [opts]
 *
 * `symbolPaytable` is the project's authored line table in SERVER names (`PIC1`…`TEN`), as the
 * Invisible Test Server receives it in the project's live mock contract (`grid.symbolPaytable`).
 * `symbols` is the project's in-play pool in the same names (`grid.symbols`) — see `symbolPool`.
 *
 * The free-spins rule from the project's Invisible Game Config (`grid.freeSpins*`, sent only on a
 * departure from the Book-of defaults: on, 3+ books, 10 spins, +10 on a retrigger, never random):
 * `freeSpins: false` ⇒ the feature never opens (no base trigger, `FORCE_TRIGGER` inert, and the
 * buy option leaves the table, so a buy is refused at `bet`); `freeSpinsTrigger.count` ⇒ the fewest
 * books that trigger and retrigger it (a Book-of game always triggers on its book, so any other
 * `symbol` is ignored); `freeSpinsAwards` ⇒ the award tables, read by the lines mock's own
 * `awardTableOf` / `drawAwardFrom`. None of them ⇒ not one byte of an answer changes.
 *
 * `overlay` is the seam an add-on deals through (`withPotsOverlay`, `mock-pots-overlay.mjs`): called
 * once with this host's board and its `startFreeSpins` hook, it returns the hooks below. Absent, not
 * one byte of an answer to a session never told about it changes.
 *
 * A session is dealt the add-on only while the config it was sent carried it (`session.potsOverlay`,
 * kept across a contract swap by `carrySession`). A client keeps the first config it saw, so a tab
 * booted before the add-on was switched on is dealt the plain game, and so is a tab booted with it
 * after it was switched off (its pots just sit). That session's heartbeat carries no config, so a
 * reload finds none, asks for `config`, and is re-pinned to the game this mock deals.
 */
export function createMockRgs(opts = {}) {
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 500_000); // cents → $5000
	const seed = opts.seed ?? process.env.SEED;
	// Inert on a game with no free spins: there is no feature to force.
	const forceTrigger =
		opts.freeSpins !== false && (opts.forceTrigger ?? process.env.FORCE_TRIGGER === '1');
	// BIG_WIN forces a full-screen PIC1 base spin (a top-tier win) so the
	// big/mega/max WIN presentation can be verified on demand. Ignored when a
	// bonus is triggered.
	const bigWin = opts.bigWin ?? process.env.BIG_WIN === '1';
	const winX = parseWinX(opts.winX ?? process.env.WIN_X);
	let baseSpinsDealt = 0;
	const autoCollectAllowed = opts.autoCollect ?? process.env.AUTO_COLLECT !== '0';
	const label = opts.label ?? 'mock-book';
	const payTable = effectivePayTable(opts.symbolPaytable);
	const pool = symbolPool(opts.symbols);
	const freeSpinsOn = opts.freeSpins !== false;
	const authoredTrigger = opts.freeSpinsTrigger;
	if (authoredTrigger?.symbol && authoredTrigger.symbol !== 'SCAT') {
		console.warn(
			`[${label}] a Book-of game triggers free spins on its book; ignoring trigger symbol ${authoredTrigger.symbol}`,
		);
	}
	/** The project's own trigger count, or null for the captured 3/4/5 gate. */
	const authoredMin =
		Number.isInteger(authoredTrigger?.count) && authoredTrigger.count >= 1
			? authoredTrigger.count
			: null;
	const triggerMin = authoredMin ?? FS_TRIGGER_MIN;
	const entryAwards = awardTableOf(opts.freeSpinsAwards?.awards, TOTAL_FS, triggerMin);
	const retriggerAwards = awardTableOf(opts.freeSpinsAwards?.retrigger, RETRIGGER_FS, triggerMin);
	const randomAwards = opts.freeSpinsAwards?.random === true;
	/** The bet options this game sells: no buy when it has no free spins to buy. */
	const betOptions = freeSpinsOn ? BET_OPTIONS : BET_OPTIONS.slice(0, 1);

	const sessions = new Map();
	/** Closed rounds by session + id, so a request re-posted under its `gid` replays after the round closed —
	 *  a `collect` whose answer was lost is resent into a round the server has already closed. */
	const settledRounds = new Map();
	const settle = (sid, round) => {
		settledRounds.set(`${sid}:${round.id}`, round);
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
		if (pool.scatter && r < 0.05) return 'SCAT';
		return pool.pay[Math.floor(nextRand() * pool.pay.length)];
	};
	/** Force `n` SCAT for a guaranteed trigger (buy / forceTrigger) — none when the Book is not in
	 *  play: such a round still enters the free spins, on the board it was dealt. One per reel first
	 *  (what it always drew); a count above the reel count goes on, left to right and top down, onto
	 *  cells that hold no book yet. */
	const spinReelsWithScatters = (n) => {
		const reels = Array.from({ length: 5 }, () => Array.from({ length: 3 }, pickSymbol));
		if (!pool.scatter) return reels;
		let placed = 0;
		for (let reel = 0; reel < 5 && placed < n; reel++) {
			reels[reel][Math.floor(nextRand() * 3)] = 'SCAT';
			placed++;
		}
		for (let row = 0; row < 3 && scatterPositions(reels).length < n; row++) {
			for (let reel = 0; reel < 5 && scatterPositions(reels).length < n; reel++) {
				reels[reel][row] = 'SCAT';
			}
		}
		return reels;
	};
	/** The spins `landed` books win from `table` (the project's, else the Book-of default). */
	const drawAward = (table, landed) => drawAwardFrom(table, landed, randomAwards, nextRand);
	const spinReels = () => Array.from({ length: 5 }, () => Array.from({ length: 3 }, pickSymbol));
	const specialWeights = Object.entries(SPECIAL_WEIGHTS).filter(([sym]) => pool.pay.includes(sym));
	const pickSpecialSymbol = () => {
		const total = specialWeights.reduce((s, [, w]) => s + w, 0);
		let r = nextRand() * total;
		for (const [sym, w] of specialWeights) {
			if ((r -= w) <= 0) return sym;
		}
		return pool.pay[pool.pay.length - 1];
	};
	/** The forced big win (BIG_WIN): the captured board — PIC1 on the middle line, broken at reel 5 by
	 *  KING, on TEN — with each symbol the pool lacks swapped for one it has. */
	const inPool = (symbol, fallback) => (pool.pay.includes(symbol) ? symbol : fallback);
	const bigTop = inPool('PIC1', pool.pay[0]);
	const bigFill = inPool('TEN', pool.pay[pool.pay.length - 1]);
	const bigBreak = inPool('KING', bigFill);
	const bigWinBoard = [
		[bigFill, bigTop, bigFill],
		[bigFill, bigTop, bigFill],
		[bigFill, bigTop, bigFill],
		[bigFill, bigTop, bigFill],
		[bigFill, bigBreak, bigFill],
	];
	/** A board drawn from `strips` (one per reel): each reel stops at a random cell, 3 rows deep. */
	const spinStrips = (strips) =>
		strips.map((strip) => {
			const stop = Math.floor(nextRand() * strip.length);
			return Array.from({ length: 3 }, (_unused, row) => strip[(stop + row) % strip.length]);
		});
	/**
	 * Enter the free spins: draw the special and announce it. The round STAYS OPEN — free spins and a
	 * `collect` follow. `board` (the triggering spin's) is sent between the trigger and the entry, as
	 * the capture has it; `extra` rides on `spinTrigger` (a pot's `cause` and `meters`).
	 *
	 * A REELS MODE of the project's own (a pot's imported free spins, `mock-pots-overlay.mjs`) passes
	 * its `bonus` key, the `strips` its spins are drawn from and the `paytable` of the symbols only it
	 * deals. It has no expanding special: that is this book's own mechanic, not the imported
	 * feature's, so no `pickRandomly` is sent and no special pays. Without them — every free-spin round
	 * before imports existed — nothing here changes.
	 */
	const startFreeSpins = (
		events,
		round,
		{ occurs, spins: given, board, extra = {}, bonus = 'feature', strips, paytable },
	) => {
		// A pot's bonus may name no spin count: the host's own award table decides, as for a trigger.
		// An imported reels mode keeps the plain default — the table is this book's, not the import's.
		const spins = Math.min(
			given ?? (strips ? TOTAL_FS : drawAward(entryAwards, occurs)),
			MAX_ROUND_FREE_SPINS,
		);
		const special = strips ? null : pickSpecialSymbol();
		round.bonus = {
			active: true,
			total: spins,
			played: 0,
			left: spins,
			special,
			...(strips ? { key: bonus, strips, payTable: { ...payTable, ...paytable } } : {}),
		};
		events.push({
			event: 'spinTrigger',
			context: {
				spins: [{ prob: 1, spins }],
				occurs,
				bonus,
				trigger: {
					occurs: [triggerMin, triggerMin + 1, triggerMin + 2],
					of: 'SCAT',
					mode: 'scatter',
					from: '',
				},
				...extra,
			},
		});
		if (board) events.push({ event: 'playedSpin', context: board });
		events.push({
			event: 'enterBonus',
			context: bonusSnapshot(round, { played: 0, left: spins }),
		});
		if (special)
			events.push({
				event: 'pickRandomly',
				context: {
					items: pool.pay.map((s) => ({ state: s, prob: SPECIAL_WEIGHTS[s] })),
					state: bonusSnapshot(round, { played: 0, left: spins, playing: 'feature' }),
					scope: 'enterState',
					item: { state: special, prob: SPECIAL_WEIGHTS[special] },
				},
			});
	};
	const overlay = opts.overlay
		? opts.overlay({
				label,
				seed,
				reels: 5,
				rows: 3,
				bonuses: { feature: 'freeSpins' },
				freeSpinsMode: 'freeSpins',
				freeSpinsOn,
				startFreeSpins,
			})
		: null;

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
		const isConfigCall = actions.length === 1 && actions[0].action === 'config';
		// A session told a different game than this mock deals, and not being re-told now: an open tab
		// from before a contract swap. It is dealt the plain game (see the factory's comment).
		const stale =
			session.configSent && !isConfigCall && (session.potsOverlay === true) !== Boolean(overlay);
		const addOn = stale ? null : overlay;
		const openRound = (round) => ({
			updating: true,
			id: round.id,
			...(round.bonus || addOn?.inBonus(round)
				? { outcome: 'bonus', inGameBet: round.baseBet }
				: {}),
		});
		// Send the boot `config` on the first call AND on every heartbeat (empty
		// body = the auth call). A real server sends it once per session, but the
		// facade module resets on each browser reload while this mock keeps the
		// session — re-sending on heartbeat ensures every (re)load re-captures it
		// (and re-selects the book symbol mapping). A stale session's heartbeat is
		// the exception: its reload must ask for `config` to be re-pinned.
		if (!session.configSent || isConfigCall || (actions.length === 0 && !stale)) {
			session.configSent = true;
			if (overlay) session.potsOverlay = true;
			else delete session.potsOverlay;
			const context = buildConfigContext(payTable, pool, betOptions);
			const config = {
				event: 'config',
				context: overlay ? { ...context, ...overlay.configContext(session) } : context,
			};
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

		for (const [offset, a] of actions.entries()) {
			// An occupied position under the round's own gid is a REPLAY: answer with what was dealt.
			const position = seq + offset;
			const target = !gid
				? undefined
				: round?.id === gid
					? round
					: settledRounds.get(`${sid}:${gid}`);
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
					if (!Number.isInteger(option) || option < 0 || option >= betOptions.length) {
						return sendJson(req, res, 200, {
							result: 0,
							error: `invalid bet option ${ctx[0]}`,
							errorCode: 101,
							platform: { balance: session.balance },
						});
					}
					const isBuy = option > 0;
					const betPerLine = Number(ctx[1]) || 1;
					const total = betOptions[option] * betPerLine;
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

					const turn = addOn?.beginPlay(session, round, a.context, {
						mode: round.bonus?.active ? 'freeSpins' : 'basegame',
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
						addOn.playOwned(events, session, round);
						break;
					}

					// ----- FREE SPIN (round already in bonus) -----
					if (round.bonus?.active) {
						const reels = round.bonus.strips ? spinStrips(round.bonus.strips) : spinReels();
						const roundPays = round.bonus.payTable ?? payTable;
						events.push(spinStartEvent(round, pool, betOptions));
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
						const specialWin =
							special && evaluateExpandingSpecial(reels, special, round.baseBet, roundPays);
						let wins;
						if (specialWin) {
							const paidBoard = expandSpecialBoard(reels, special);
							const lineWins = evaluatePaylines(paidBoard, round.betPerLine, roundPays).filter(
								(w) => w.what !== special,
							);
							wins = [specialWin, ...lineWins];
						} else {
							wins = evaluatePaylines(reels, round.betPerLine, roundPays);
						}
						for (const w of wins) {
							events.push({
								event: 'bonusWin',
								context: { bonus: round.bonus.key ?? 'feature', pay: w.pay, isSpinWin: true },
							});
							events.push({ event: 'spinWin', context: w });
							round.win += w.pay;
						}
						events.push({ event: 'playedSpin', context: reels });
						round.bonus.played += 1;
						round.bonus.left -= 1;
						// RETRIGGER: 3+ SCAT (the Book) landing DURING a free spin awards +10
						// more free spins, added to the remaining count — up to MAX_ROUND_FREE_SPINS
						// for the round (an imported reels mode: MAX_STRIPS_ROUND_SPINS); one that would
						// pass it awards nothing.
						// Only the scatter retriggers — the special expanding symbol never does.
						// Emitted BEFORE playedBonusSpin so the counter (total = played + left)
						// already reflects the new total on this spin.
						const retrig = evaluateScatterTrigger(reels, authoredMin);
						const added =
							retrig && retrig.count >= triggerMin
								? round.bonus.strips
									? RETRIGGER_FS
									: drawAward(retriggerAwards, retrig.count)
								: 0;
						const capped =
							round.bonus.total + added >
							(round.bonus.strips ? MAX_STRIPS_ROUND_SPINS : MAX_ROUND_FREE_SPINS);
						if (added > 0 && !capped) {
							round.bonus.left += added;
							round.bonus.total += added;
							events.push({
								event: 'retrigger',
								context: {
									spins: added,
									occurs: retrig.count,
									total: round.bonus.total,
									left: round.bonus.left,
									bonus: round.bonus.key ?? 'feature',
								},
							});
						}
						events.push({ event: 'playedBonusSpin', context: bonusSnapshot(round) });
						if (round.bonus.left <= 0) {
							round.bonus.active = false;
							events.push({ event: 'playedBonusSpins', context: bonusSnapshot(round) });
							// The add-on's bonus waiting behind these free spins starts instead of the end.
							if (!addOn?.takeOver(events, session, round))
								events.push({ event: 'gameEnd', context: { win: round.win } });
						}
						break;
					}

					// ----- BASE SPIN -----
					const trigger = round.isBuy || forceTrigger || turn?.hostFeature === true;
					// bigWin: PIC1 4-of-a-kind on the middle line (broken at reel 4) →
					// a MEGA-tier win, enough to show the big-win banner without hitting
					// the MAX special-case.
					const forcedX = trigger ? undefined : winX[baseSpinsDealt++];
					const reels = trigger
						? spinReelsWithScatters(Math.max(4, triggerMin))
						: forcedX !== undefined
							? boardPayingAtLeast(spinReels(), {
									symbols: pool.pay,
									scatter: 'SCAT',
									filler: pool.pay[pool.pay.length - 1],
									target: forcedX,
									multipleOf: (board) =>
										evaluatePaylines(board, round.betPerLine, payTable).reduce(
											(sum, w) => sum + w.pay,
											0,
										) / round.baseBet,
								})
							: bigWin
								? bigWinBoard.map((column) => [...column])
								: spinReels();
					events.push(spinStartEvent(round, pool, betOptions));
					const lineWins = evaluatePaylines(reels, round.betPerLine, payTable);
					const scat = evaluateScatterTrigger(reels, authoredMin);
					const wins = scat ? [...lineWins, scat.win] : lineWins;
					for (const w of wins) {
						events.push({ event: 'spinWin', context: w });
						round.win += w.pay;
					}
					// A game with free spins off still lands and shows its books, but never enters the feature.
					const triggered = (freeSpinsOn && scat && scat.count >= triggerMin) || trigger;

					if (triggered) {
						// Do NOT credit yet, do NOT close — free spins + collect follow. The award is the
						// row for the books on the board as dealt — forced and bought boards too.
						const spins = drawAward(entryAwards, scatterPositions(reels).length);
						startFreeSpins(events, round, { occurs: scat?.count ?? 4, spins, board: reels });
						break;
					}

					// No trigger → base round resolves now.
					events.push({ event: 'playedSpin', context: reels });
					// …unless the add-on starts its bonus on this spin: the round stays open.
					if (addOn?.takeOver(events, session, round)) break;
					events.push({ event: 'gameEnd', context: { win: round.win } });
					const context = turn ? turn.context : a.context;
					const autoCollect = autoCollectAllowed && (context === '' || context === undefined);
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
			if (addOn && a.action === 'play') addOn.endPlay(events, dealtFrom, session, round);
			round?.stored.push({ action: a, events: events.slice(dealtFrom) });
		}

		if (round?.closed) settle(sid, round);
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
	// PLATFORM_JACKPOT=1 adds the operator platform jackpot on top (`mock-platform-jackpot.mjs`).
	const platform = process.env.PLATFORM_JACKPOT === '1' ? createPlatformJackpot() : null;
	const serve = (req, res, url) =>
		platform ? platform.handle(req, res, url, mock.handle) : mock.handle(req, res, url);
	const server = createServer((req, res) => {
		const url = new URL(req.url, `http://${req.headers.host}`);
		return serve(req, res, url);
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
