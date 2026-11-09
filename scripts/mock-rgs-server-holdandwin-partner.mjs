/**
 * Mock Play4Fun RGS — the PARTNER'S collector-respin wire (Hold and Win Phase 14, slice 14d).
 *
 * Our other Hold and Win mock (`mock-rgs-server-holdandwin.mjs`) speaks OUR wire, a swap seam. This
 * one answers the way the partner's server answers for their collector respin game (EAGaming /
 * Play4Fun Fortune Vault Force 5, which Getting Hot reskins as their game 8): the same actions,
 * events, shapes and order as the capture, docs/reference/play4fun-collector-respin-capture.md. It
 * exists so the client can be authored and tested without their server.
 *
 * ⚠️ THE NUMBERS ARE PACING, NOT MATH. The partner's server owns every outcome. Every rate, weight
 * and table below ({@link DEFAULT_PARTNER_PACING}, shaped like docs/design/hold-and-win-enhancements.md
 * §3.1–§3.4) only shapes the rounds this mock deals. Never tune a player's game from them.
 *
 * What is the partner's here (captured): `betOptions` [10, 50, 500, 1000] named Base / Powerup /
 * BuyCenterCoin / goldStrike at `gameCost` 10; money in cents; `COIN_<n>` (n × the base bet),
 * `COIN_<TIER>`, `COLLECT` / `COLLECT_<cents>`; whole reel-major boards; the five-bit bonus id
 * (expand, boost, powerFive, multiply, respin); `boostsAwarded` / `boostsEnabled`; `boost` /
 * `multiplier` hits and `"X"` misses on a fresh cash coin only; one `collect` per collector, each
 * taking every coin's full value; `retrigger {games}`; a feature (and a winning base round) closed by
 * the client's `collect`; `config` before the first `bet` (errorCode 110); `seq` as a position.
 *
 * What is OURS, because the capture does not show it: the five paylines' rows, the `from` of
 * `spinTrigger.trigger`, the fields of `enterBonus` / `playedBonusSpin` beyond those named, Force 5's
 * exact strength (it opens 5×5 at entry here), and boost-then-multiply when both hit one coin.
 *
 * Forced beats (authoring and tests): `play.context = "force:<token>[,<token>…]"`, or held for a
 * session's next round by `POST …/force?sid=<sid>&beat=<tokens>`. Tokens: `enhancements:<bits>`,
 * `boostHit`, `multiplyHit`, `superBonus`, `twoCollectors`, `trigger`, `baseCollect`
 * ({@link parsePartnerForce}).
 *
 * Selected per game on the test server by `PARTNER_WIRE_GAMES=<key>[,<key>…]`
 * (services/test-server/makeMock.mjs). CLI:
 *   node scripts/mock-rgs-server-holdandwin-partner.mjs   PORT=7798 · SEED=… · START_BALANCE=<cents>
 *   · FORCE=<tokens> · DISABLED_OPTIONS=1,2,3 (the operator switching the ante and buys off)
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

// ---------- the partner's game, as their boot `config` describes it ----------

export const PARTNER_GAME = Object.freeze({
	reels: 5,
	rows: 3,
	gameCost: 10,
	betOptions: [10, 50, 500, 1000],
	betOptionNames: ['Base', 'Powerup', 'BuyCenterCoin', 'goldStrike'],
	maxWinMp: [5000, 5000],
	/** × the base total bet (`gameCost × betPerLine`). */
	jackpots: { MINI: 25, MINOR: 50, MAJOR: 150, GRAND: 1000 },
	lineSymbols: ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5', 'PIC6', 'PIC7', 'PIC8', 'PIC9'],
	/** × the bet per line, for 3 / 4 / 5 on a line. */
	paytable: {
		PIC1: [400, 600, 1000],
		PIC2: [300, 400, 800],
		PIC3: [200, 300, 400],
		PIC4: [100, 150, 200],
		PIC5: [100, 150, 200],
		PIC6: [30, 50, 80],
		PIC7: [30, 50, 80],
		PIC8: [30, 50, 80],
		PIC9: [10, 20, 30],
	},
	/** Ours: the capture names five lines but not their rows. */
	paylines: [
		[1, 1, 1, 1, 1],
		[0, 0, 0, 0, 0],
		[2, 2, 2, 2, 2],
		[0, 1, 2, 1, 0],
		[2, 1, 0, 1, 2],
	],
	/** Coins land on reels 1, 2, 4, 5; the collector on reel 3 only (0-based). */
	coinReels: [0, 1, 3, 4],
	collectorReel: 2,
});

/** The bonus id's bits, in the partner's order (`boostsAwarded`, `spinTrigger.bonus`). */
export const ENHANCEMENT_BITS = ['expand', 'boost', 'powerFive', 'multiply', 'respin'];
/** Our enhancement kinds (design §3.3) for each bit but `powerFive`, which is the super bonus. */
const BIT_KIND = {
	expand: 'extraRow',
	boost: 'boost',
	multiply: 'multiply',
	respin: 'extraRespins',
};

const w = (pairs) => pairs.map(([value, weight]) => ({ value, weight }));
const picWeights = [2, 3, 4, 5, 5, 7, 7, 7, 9];
const reelTable = (extra) => [
	...PARTNER_GAME.lineSymbols.map((symbol, i) => ({ symbol, weight: picWeights[i] })),
	...extra,
];
const coinOnly = (special, weight) => [
	{ symbol: special, weight },
	{ symbol: 'BLANK', weight: 10 - weight },
];

/**
 * MOCK PACING ONLY — the shapes of design §3.1–§3.4, with numbers that make plausible rounds. The
 * partner's server holds the real ones (the boot `config` sends no odds).
 */
export const DEFAULT_PARTNER_PACING = Object.freeze({
	/** §3.4 — the deal set each bet option spins with. */
	betModeStrips: {
		Base: 'basegame',
		Powerup: 'ante',
		BuyCenterCoin: 'centerCoin',
		goldStrike: 'basegame',
	},
	/** Per deal set, one weighted table per reel (a strip set's stand-in), and a guaranteed symbol. */
	strips: {
		basegame: {
			reels: [0, 1, 2, 3, 4].map((reel) =>
				reelTable([{ symbol: reel === 2 ? 'COLLECT' : 'COIN', weight: reel === 2 ? 5 : 9 }]),
			),
		},
		ante: {
			reels: [0, 1, 2, 3, 4].map((reel) =>
				reel === 2 ? coinOnly('COLLECT', 2) : coinOnly('COIN', 3),
			),
		},
		centerCoin: {
			reels: [0, 1, 2, 3, 4].map((reel) =>
				reel === 2 ? coinOnly('COLLECT', 3) : coinOnly('COIN', 3),
			),
			guarantee: { reel: 2, symbol: 'COLLECT' },
		},
	},
	/** Which value a coin carries: a cash multiple of the base bet, or a jackpot tier. */
	coins: {
		cash: w([
			[1, 30],
			[2, 25],
			[3, 15],
			[4, 10],
			[5, 8],
			[8, 5],
			[10, 4],
			[15, 2],
			[20, 1],
		]),
		jackpots: w([
			['MINI', 3],
			['MINOR', 1.5],
			['MAJOR', 0.4],
			['GRAND', 0.1],
		]),
	},
	/** §3.1 — `run`: 3+ adjacent reels showing a coin or collector; `chance`: Force 5's roll. */
	trigger: {
		run: { min: 3, roles: ['coin', 'collector'] },
		chance: { role: 'collector', reels: [2], rate: 0.01, name: 'superBonus' },
	},
	/** §3.2 — coins added to the trigger board before it locks. The partner sends the board whole,
	 *  so a top-up is invisible on the wire: the added coins are simply on it. */
	topUp: {
		rate: 0.25,
		count: w([
			[1, 3],
			[2, 1],
		]),
		roles: ['coin'],
	},
	/** The respin board: how often a respin lands anything, how many, and the collector's share
	 *  (the capture averaged ~9 respins a bonus). */
	respins: {
		start: 3,
		landRate: 0.4,
		count: w([
			[1, 6],
			[2, 3],
			[3, 1],
		]),
		collectorShare: 0.12,
	},
	/** §3.3 — the bonus: at least one of four enhancements. */
	enhancements: {
		pool: [
			{ kind: 'extraRow', weight: 1, rows: 1 },
			{
				kind: 'boost',
				weight: 1,
				hitRate: 0.35,
				values: w([
					[1, 4],
					[2, 3],
					[3, 2],
					[4, 1],
					[5, 1],
				]),
			},
			{
				kind: 'multiply',
				weight: 1,
				hitRate: 0.3,
				values: w([
					[2, 6],
					[3, 3],
					[4, 1],
					[5, 1],
				]),
			},
			{ kind: 'extraRespins', weight: 1, start: 4 },
		],
		draw: {
			type: 'atLeastOne',
			counts: w([
				[1, 6],
				[2, 3],
				[3, 1.5],
				[4, 0.5],
			]),
		},
	},
	/** §3.3 — the super bonus (Force 5): every enhancement, stronger. */
	superBonus: {
		enhancements: {
			pool: [
				{ kind: 'extraRow', weight: 1, rows: 2 },
				{
					kind: 'boost',
					weight: 1,
					hitRate: 0.5,
					values: w([
						[2, 4],
						[3, 3],
						[5, 2],
						[8, 1],
						[10, 1],
					]),
				},
				{
					kind: 'multiply',
					weight: 1,
					hitRate: 0.45,
					values: w([
						[2, 5],
						[3, 3],
						[5, 2],
						[10, 1],
					]),
				},
				{ kind: 'extraRespins', weight: 1, start: 5 },
			],
			draw: { type: 'all' },
		},
	},
});

// ---------- forced beats ----------

const FORCE_FLAGS = [
	'boostHit',
	'multiplyHit',
	'superBonus',
	'twoCollectors',
	'trigger',
	'baseCollect',
];

/**
 * `enhancements:<bits>,boostHit,…` → `{ force }` or `{ errors }`. Every token but `baseCollect`
 * starts the bonus; `baseCollect` pays a collect with no trigger.
 */
export function parsePartnerForce(spec) {
	const errors = [];
	const force = {};
	const tokens = String(spec ?? '')
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean);
	if (!tokens.length) errors.push('an empty force');
	for (const token of tokens) {
		const [name, arg] = token.split(':');
		if (name === 'enhancements') {
			if (!/^[01]{5}$/.test(arg ?? '')) {
				errors.push(`enhancements:<bits> takes five 0/1 flags (${ENHANCEMENT_BITS.join(', ')})`);
				continue;
			}
			force.bits = arg;
		} else if (FORCE_FLAGS.includes(name) && arg === undefined) force[name] = true;
		else errors.push(`unknown force "${token}"`);
	}
	if (force.bits) {
		const on = flagsOf(force.bits);
		if (on.powerFive && force.bits !== '11111')
			errors.push('Force 5 draws all four enhancements: enhancements:11111');
		if (!on.powerFive && !['expand', 'boost', 'multiply', 'respin'].some((b) => on[b]))
			errors.push('the bonus draws at least one enhancement');
		if (force.superBonus && force.bits !== '11111') errors.push('superBonus is enhancements:11111');
		if (force.boostHit && !on.boost) errors.push('boostHit needs the boost bit');
		if (force.multiplyHit && !on.multiply) errors.push('multiplyHit needs the multiply bit');
	}
	if (force.baseCollect && Object.keys(force).some((k) => k !== 'baseCollect'))
		errors.push('baseCollect pays a collect with no bonus; it takes no other token');
	force.bonus = !force.baseCollect;
	return errors.length ? { errors } : { force };
}

export const flagsOf = (bits) =>
	Object.fromEntries(ENHANCEMENT_BITS.map((b, i) => [b, bits[i] === '1' ? 1 : 0]));
const bitsOf = (flags) => ENHANCEMENT_BITS.map((b) => (flags[b] ? '1' : '0')).join('');

// ---------- the engine: one seeded deal, no HTTP ----------

/**
 * @param {{ seed?: string, rand?: () => number, pacing?: typeof DEFAULT_PARTNER_PACING }} opts
 */
export function createPartnerCollectorEngine(opts = {}) {
	const pacing = { ...DEFAULT_PARTNER_PACING, ...(opts.pacing ?? {}) };
	let state = opts.seed ? hashStr(opts.seed) : Date.now() >>> 0;
	const rand =
		opts.rand ??
		(() => {
			// mulberry32: a plain LCG's low-quality runs dealt exactly one coin on every respin.
			state = (state + 0x6d2b79f5) >>> 0;
			let t = state;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 0x100000000;
		});
	const pick = (items) => items[Math.floor(rand() * items.length)];
	const weighted = (items) => {
		const live = items.filter((i) => i.weight > 0);
		let r = rand() * live.reduce((s, i) => s + i.weight, 0);
		for (const item of live) if ((r -= item.weight) <= 0) return item;
		return live[live.length - 1];
	};
	const G = PARTNER_GAME;
	const { collectorReel, coinReels } = G;

	// ---- cells: { symbol: 'PIC3' | 'BLANK' } · { coin: n | 'MINI' } · { collector: cents } ----
	const drawCoin = () => {
		const cash = pacing.coins.cash.reduce((s, c) => s + c.weight, 0);
		const jp = pacing.coins.jackpots.reduce((s, c) => s + c.weight, 0);
		return rand() * (cash + jp) < jp
			? weighted(pacing.coins.jackpots).value
			: weighted(pacing.coins.cash).value;
	};
	const isJackpot = (coin) => typeof coin === 'string';
	const coinPay = (coin, base) => (isJackpot(coin) ? G.jackpots[coin] : coin) * base;
	const coinName = (coin) => `COIN_${coin}`;
	const cellName = (cell) =>
		'coin' in cell
			? coinName(cell.coin)
			: 'collector' in cell
				? cell.collector > 0
					? `COLLECT_${cell.collector}`
					: 'COLLECT'
				: cell.symbol;
	const windowOf = (board) => board.map((reel) => reel.map(cellName));
	const shows = (board, reel) => board[reel].some((c) => 'coin' in c || 'collector' in c);
	const blankRows = (board, reel, test) =>
		board[reel].map((c, row) => (test(c) ? row : -1)).filter((r) => r >= 0);

	const dealCell = (table) => {
		const { symbol } = weighted(table);
		if (symbol === 'COIN') return { coin: drawCoin() };
		if (symbol === 'COLLECT') return { collector: 0 };
		return { symbol };
	};
	const dealBoard = (stripsKey) => {
		const set = pacing.strips[stripsKey] ?? pacing.strips.basegame;
		const board = set.reels.map((table) => Array.from({ length: G.rows }, () => dealCell(table)));
		const g = set.guarantee;
		if (g && !board[g.reel].some((c) => 'collector' in c))
			board[g.reel][Math.floor(rand() * G.rows)] = { collector: 0 };
		return board;
	};
	/** The longest run of adjacent reels each showing a coin or a collector. */
	const runOf = (board) => {
		let best = [];
		let cur = [];
		for (let reel = 0; reel < board.length; reel++) {
			if (shows(board, reel)) cur.push(reel);
			else cur = [];
			if (cur.length > best.length) best = [...cur];
		}
		return best;
	};
	const placeCoin = (board, reel, test = (c) => !('coin' in c) && !('collector' in c)) => {
		const rows = blankRows(board, reel, test);
		if (rows.length) board[reel][pick(rows)] = { coin: drawCoin() };
	};
	const placeCollector = (board) => {
		const rows = blankRows(board, collectorReel, (c) => !('collector' in c));
		if (rows.length) board[collectorReel][pick(rows)] = { collector: 0 };
	};
	/** Force a trigger run onto a dealt board: a collector on reel 3 and a coin on each other reel of
	 *  a run of three. */
	const satisfyRun = (board) => {
		if (!board[collectorReel].some((c) => 'collector' in c)) placeCollector(board);
		const window = pick([
			[0, 1, 2],
			[1, 2, 3],
			[2, 3, 4],
		]);
		for (const reel of window) if (!shows(board, reel)) placeCoin(board, reel);
	};
	const collectorsOf = (board) =>
		board[collectorReel]
			.map((c, row) => ('collector' in c ? { reel: collectorReel, row, cell: c } : null))
			.filter(Boolean);
	const coinsOf = (board) =>
		board.flatMap((reel, r) =>
			reel.map((c, row) => ('coin' in c ? { reel: r, row, cell: c } : null)).filter(Boolean),
		);

	const evaluateLines = (board, betPerLine) => {
		const wins = [];
		G.paylines.forEach((line, p) => {
			const seq = line.map((row, reel) => board[reel][row]?.symbol);
			const what = seq[0];
			if (!G.paytable[what]) return;
			let occurs = 0;
			while (occurs < seq.length && seq[occurs] === what) occurs++;
			const mult = G.paytable[what][occurs - 3];
			if (!mult) return;
			wins.push({
				what,
				occurs,
				pay: mult * betPerLine,
				mode: 'line',
				context: { paylineId: p, payline: line, direction: 'left' },
			});
		});
		return wins;
	};

	const jackpotsEvent = () => ({ event: 'jackpots', context: { ...G.jackpots } });
	const spinStartEvent = () => ({
		event: 'spinStart',
		context: {
			symbols: [...G.lineSymbols, 'COIN', 'COLLECT', 'BLANK'],
			symbolsPay: { line: [...G.lineSymbols] },
			gameCost: G.gameCost,
			betOptions: [...G.betOptions],
			betOptionNames: [...G.betOptionNames],
			maxWinMp: [...G.maxWinMp],
		},
	});
	/** `bonusSymbol` per coin, the board, then `cellPayAmount` per coin (its final value). */
	const pushCoins = (events, board, coins, base) => {
		for (const { reel, row, cell, original } of coins) {
			const from = original ?? cell.coin;
			events.push({
				event: 'bonusSymbol',
				context: {
					reel,
					row,
					symbol: coinName(from),
					win: isJackpot(from) ? from : coinPay(from, base),
				},
			});
		}
		events.push({ event: 'playWindow', context: windowOf(board) });
		return () => {
			for (const { reel, row, cell, original } of coins) {
				const from = original ?? cell.coin;
				events.push({
					event: 'cellPayAmount',
					context: {
						reel,
						row,
						original: from,
						value: cell.coin,
						pay: coinPay(cell.coin, base),
					},
				});
			}
		};
	};
	/** Every collector in view takes the full value of every coin. Returns what they paid. */
	const collectAll = (events, collectors, coins, base) => {
		const gathered = coins.reduce((s, c) => s + coinPay(c.cell.coin, base), 0);
		if (!gathered || !collectors.length) return 0;
		for (const { reel, row, cell } of collectors) {
			cell.collector += gathered;
			events.push({ event: 'collect', context: { reel, row, pay: gathered } });
		}
		return gathered * collectors.length;
	};

	/** The enhancement set: forced bits, else the draw. Force 5 draws all. */
	const drawBits = (superBonus, force) => {
		if (force?.bits) return force.bits;
		if (superBonus) return '11111';
		const pool = pacing.enhancements.pool;
		const kinds = new Set();
		const draw = pacing.enhancements.draw;
		const count =
			draw.type === 'all' ? pool.length : Math.min(pool.length, weighted(draw.counts).value);
		while (kinds.size < count) {
			kinds.add(weighted(pool.filter((e) => !kinds.has(e.kind))).kind);
		}
		if (force?.boostHit) kinds.add('boost');
		if (force?.multiplyHit) kinds.add('multiply');
		return bitsOf(
			Object.fromEntries(
				ENHANCEMENT_BITS.map((b) => [b, b !== 'powerFive' && kinds.has(BIT_KIND[b])]),
			),
		);
	};
	const enhancementOf = (pool, kind) => pool.find((e) => e.kind === kind);

	/**
	 * The base spin of a round (`round`: betPerLine, base, option, stripsKey, isBuy, force, win). Adds
	 * what it pays to `round.win`; starts `round.feature` on a trigger.
	 */
	const playBase = (events, round) => {
		const force = round.force;
		const board = dealBoard(round.stripsKey);
		if (force?.baseCollect) {
			for (let reel = 0; reel < G.reels; reel++)
				for (let row = 0; row < G.rows; row++)
					if ('coin' in board[reel][row] || 'collector' in board[reel][row])
						board[reel][row] = { symbol: 'BLANK' };
			board[collectorReel][Math.floor(rand() * G.rows)] = { collector: 0 };
			placeCoin(board, pick([0, 4]));
		}
		if (round.isBuy || force?.bonus) satisfyRun(board);
		if (force?.twoCollectors && collectorsOf(board).length < 2) placeCollector(board);
		const collectorsLanded = collectorsOf(board).length > 0;
		const chance = pacing.trigger.chance;
		const superBonus =
			Boolean(force?.superBonus || force?.bits === '11111') ||
			(!force && collectorsLanded && rand() < chance.rate);
		const triggered =
			!force?.baseCollect && (superBonus || runOf(board).length >= pacing.trigger.run.min);
		if (triggered && !force && rand() < pacing.topUp.rate) {
			const n = weighted(pacing.topUp.count).value;
			for (let i = 0; i < n; i++) placeCoin(board, pick(coinReels), (c) => 'symbol' in c);
		}
		const run = runOf(board);
		const dealt = windowOf(board);

		events.push(jackpotsEvent(), spinStartEvent());
		const coins = coinsOf(board);
		pushCoins(events, board, coins, round.base)();
		const wins = evaluateLines(board, round.betPerLine);
		for (const win of wins) {
			events.push({ event: 'spinWin', context: win });
			round.win += win.pay;
		}
		const collectors = collectorsOf(board);
		const paid = collectAll(events, collectors, coins, round.base);
		if (paid) {
			round.win += paid;
			events.push({
				event: 'bonusWin',
				context: { bonus: 'initialspin', pay: paid, isSpinWin: false },
			});
			events.push({ event: 'collectWindow', context: windowOf(board) });
		}
		if (!triggered) {
			events.push({ event: 'playedSpin', context: dealt });
			return;
		}
		const bits = drawBits(superBonus, force);
		const flags = flagsOf(bits);
		const pool = (superBonus ? pacing.superBonus.enhancements : pacing.enhancements).pool;
		const rows = G.rows + (flags.expand ? (enhancementOf(pool, 'extraRow')?.rows ?? 1) : 0);
		const start = flags.respin
			? (enhancementOf(pool, 'extraRespins')?.start ?? pacing.respins.start + 1)
			: pacing.respins.start;
		events.push({ event: 'boostsAwarded', context: { ...flags } });
		const occurs = superBonus && run.length < pacing.trigger.run.min ? 1 : run.length;
		events.push({
			event: 'spinTrigger',
			context: {
				spins: [{ prob: 1, spins: start }],
				occurs,
				bonus: bits,
				trigger: { occurs: [3, 4, 5], from: superBonus ? chance.name : 'run' },
			},
		});
		events.push({ event: 'playedSpin', context: dealt });
		const triggering = coins
			.concat(collectors)
			.filter((c) => run.includes(c.reel) || (superBonus && c.reel === collectorReel))
			.map(({ reel, row }) => ({ reel, row }));
		// Only the collectors stay, each with what it gathered in this spin.
		const keep = collectors.map(({ reel, row, cell }) => ({ reel, row, total: cell.collector }));
		round.feature = {
			bits,
			flags,
			superBonus,
			pool,
			rows,
			start,
			left: start,
			played: 0,
			collectors: keep,
			ended: false,
		};
		events.push({
			event: 'enterBonus',
			context: {
				left: start,
				played: 0,
				triggers: 1,
				bonusTriggers: bits,
				spins: [{ spins: start, bonus: bits }],
				triggering,
				playing: bits,
				window: { reels: G.reels, rows },
			},
		});
	};

	/** One respin of the open feature. */
	const playRespin = (events, round) => {
		const f = round.feature;
		const force = round.force;
		const base = round.base;
		const board = Array.from({ length: G.reels }, () =>
			Array.from({ length: f.rows }, () => ({ symbol: 'BLANK' })),
		);
		for (const c of f.collectors) board[c.reel][c.row] = { collector: c.total };
		const landed = [];
		const empty = (reels) =>
			reels.flatMap((reel) =>
				blankRows(board, reel, (c) => 'symbol' in c).map((row) => ({ reel, row })),
			);
		if (rand() < pacing.respins.landRate) {
			const n = weighted(pacing.respins.count).value;
			for (let i = 0; i < n; i++) {
				const asCollector = rand() < pacing.respins.collectorShare;
				const free = empty(asCollector ? [collectorReel] : coinReels);
				if (!free.length) continue;
				const at = pick(free);
				board[at.reel][at.row] = asCollector ? { collector: 0 } : { coin: drawCoin() };
				landed.push(at);
			}
		}
		const wantsCash = (force?.boostHit || force?.multiplyHit) && f.played === 0;
		if (wantsCash && !coinsOf(board).some((c) => !isJackpot(c.cell.coin))) {
			const at = pick(empty(coinReels));
			board[at.reel][at.row] = { coin: pick(pacing.coins.cash).value };
			landed.push(at);
		}
		const coins = coinsOf(board).map((c) => ({ ...c, original: c.cell.coin }));
		const cash = coins.filter((c) => !isJackpot(c.cell.coin));
		const dealt = windowOf(board);

		events.push(jackpotsEvent(), spinStartEvent());
		events.push({ event: 'boostsEnabled', context: { ...f.flags } });
		const flushPays = pushCoins(events, board, coins, base);

		const hits = [];
		const roll = (kind, forced) => {
			const e = enhancementOf(f.pool, kind);
			const hit = cash.length > 0 && (forced || rand() < e.hitRate);
			if (!hit) return null;
			return { coin: pick(cash), value: weighted(e.values).value };
		};
		if (f.flags.boost) {
			const hit = roll('boost', force?.boostHit);
			if (hit) {
				const startingPay = coinPay(hit.coin.cell.coin, base);
				hit.coin.cell.coin += hit.value;
				hits.push({
					event: 'boost',
					context: [
						{ reel: hit.coin.reel, row: hit.coin.row, startingPay, boost: hit.value * base },
					],
				});
			} else hits.push({ event: 'boost', context: { boost: 'X' } });
		}
		if (f.flags.multiply) {
			const hit = roll('multiply', force?.multiplyHit);
			if (hit) {
				const startingPay = coinPay(hit.coin.cell.coin, base);
				hit.coin.cell.coin *= hit.value;
				hits.push({
					event: 'multiplier',
					context: [{ reel: hit.coin.reel, row: hit.coin.row, startingPay, multiplier: hit.value }],
				});
			} else hits.push({ event: 'multiplier', context: { multiplier: 'X' } });
		}
		flushPays();
		events.push(...hits);

		const collectors = collectorsOf(board);
		const paid = collectAll(events, collectors, coins, base);
		if (paid) {
			round.win += paid;
			events.push({ event: 'bonusWin', context: { bonus: f.bits, pay: paid, isSpinWin: false } });
		}
		// Coins do not stick: once gathered they leave, and only the collectors stay.
		const after = board.map((reel) => reel.map((c) => ('coin' in c ? { symbol: 'BLANK' } : c)));
		events.push({ event: 'collectWindow', context: windowOf(after) });
		f.collectors = collectorsOf(after).map(({ reel, row, cell }) => ({
			reel,
			row,
			total: cell.collector,
		}));

		f.left -= 1;
		if (landed.length) {
			events.push({ event: 'retrigger', context: { games: f.start - f.left } });
			f.left = f.start;
		}
		f.played += 1;
		events.push({ event: 'playedSpin', context: dealt });
		const snapshot = { played: f.played, left: f.left, bonus: f.bits };
		events.push({ event: 'playedBonusSpin', context: snapshot });
		if (f.left === 0) {
			f.ended = true;
			events.push({ event: 'playedBonusSpins', context: snapshot });
			events.push({ event: 'gameEnd', context: { win: round.win } });
		}
	};

	const configEvents = () => [
		jackpotsEvent(),
		{
			event: 'config',
			context: {
				symbols: [...G.lineSymbols, 'COIN', 'COLLECT', 'BLANK'],
				symbolsPay: { line: [...G.lineSymbols] },
				wildSymbols: [],
				lineAlign: 'left',
				lineCoinciding: false,
				gameCost: G.gameCost,
				betOptions: [...G.betOptions],
				betOptionNames: [...G.betOptionNames],
				maxWinMp: [...G.maxWinMp],
				window: { reels: G.reels, rows: G.rows },
				availablePayLines: G.paylines.map((l) => [...l]),
				paytable: Object.entries(G.paytable).map(([of, pay]) => ({
					on: { occurs: [3, 4, 5], of, mode: 'line' },
					pay: [...pay],
				})),
			},
		},
	];

	return { pacing, playBase, playRespin, configEvents };
}

export function hashStr(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h;
}

// ---------- HTTP plumbing ----------

const corsHeaders = (req) =>
	req.headers.origin
		? {
				'Access-Control-Allow-Origin': req.headers.origin,
				'Access-Control-Allow-Credentials': 'true',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
				Vary: 'Origin',
			}
		: {
				'Access-Control-Allow-Origin': '*',
				'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
				'Access-Control-Allow-Headers': 'Content-Type',
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
const readBody = (req) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
		req.on('error', reject);
	});
const pathEndsWith = (pathname, route) => {
	const p = pathname.replace(/\/+$/, '') || '/';
	return p === route || p.endsWith(route);
};

/**
 * @param {{ label?: string, seed?: string, quiet?: boolean, allowForce?: boolean,
 *   startBalance?: number, force?: string, disabledOptions?: number[],
 *   pacing?: typeof DEFAULT_PARTNER_PACING }} opts
 */
export function createMockRgs(opts = {}) {
	const label = opts.label ?? 'mock-hnw-partner';
	const allowForce = opts.allowForce !== false;
	const quiet = opts.quiet === true;
	/** Cents, as the partner's wallet. */
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 1_000_000);
	const seed = opts.seed ?? process.env.SEED;
	const engine = createPartnerCollectorEngine({ seed, pacing: opts.pacing });
	const disabled = new Set(
		(opts.disabledOptions ?? String(process.env.DISABLED_OPTIONS ?? '').split(','))
			.map((n) => String(n).trim())
			.filter(Boolean)
			.map(Number),
	);
	const defaultForce = (() => {
		const spec = opts.force ?? process.env.FORCE;
		if (!spec) return null;
		const parsed = parsePartnerForce(spec);
		if (parsed.errors) throw new Error(`[${label}] FORCE: ${parsed.errors.join('; ')}`);
		return parsed.force;
	})();
	let roundCounter = 0;
	const roundId = () => {
		roundCounter += 1;
		return seed
			? `G${hashStr(`${seed}:${roundCounter}`).toString(36)}`
			: `G${Math.random().toString(36).slice(2, 14)}`;
	};

	const sessions = new Map();
	const settled = new Map();
	const getSession = (sid) => {
		if (!sessions.has(sid))
			sessions.set(sid, { balance: startBalance, round: null, configSent: false });
		return sessions.get(sid);
	};
	const platformOf = (session, round) => ({
		balance: session.balance,
		...(round
			? { gameRound: round.closed ? { id: round.id } : { id: round.id, updating: true } }
			: {}),
	});

	const handleEngine = async (req, res, url) => {
		const sid = url.searchParams.get('sid');
		const seq = Number(url.searchParams.get('seq') ?? 0);
		const gid = url.searchParams.get('gid');
		if (!sid)
			return sendJson(req, res, 400, { error: { code: 'ERR_VAL', message: 'missing sid' } });
		const session = getSession(sid);
		let actions;
		try {
			const text = await readBody(req);
			actions = text ? JSON.parse(text) : [];
		} catch {
			return sendJson(req, res, 400, {
				error: { code: 'ERR_VAL', message: 'body must be JSON array' },
			});
		}
		if (!Array.isArray(actions))
			return sendJson(req, res, 400, {
				error: { code: 'ERR_VAL', message: 'body must be an array' },
			});
		if (!quiet)
			console.log(
				`[${label}] sid=${sid} seq=${seq} gid=${gid ?? '-'} actions=${JSON.stringify(actions.map((a) => a?.action))}`,
			);
		if (!actions.length)
			return sendJson(req, res, 200, { events: [], platform: platformOf(session, session.round) });

		// A batch is atomic: a refusal anywhere stores, charges and consumes nothing.
		const saved = structuredClone({
			balance: session.balance,
			round: session.round,
			force: session.force,
			configSent: session.configSent,
		});
		const fail = (error, errorCode = 110) => {
			Object.assign(session, saved);
			return sendJson(req, res, 200, {
				result: 0,
				error,
				errorCode,
				platform: { balance: session.balance },
			});
		};
		const events = [];
		let round = session.round;
		let position = seq;
		for (const a of actions) {
			if (a?.action === 'config') {
				session.configSent = true;
				const [jackpots, config] = engine.configEvents();
				if (round && !round.closed) {
					config.actions = round.stored.map((s) => s.action);
					config.resume = true;
				}
				events.push(jackpots, config);
				continue;
			}
			const target = !gid ? undefined : round?.id === gid ? round : settled.get(`${sid}:${gid}`);
			const stored = target?.stored[position];
			if (stored) {
				if (stored.action.action !== a.action)
					return fail(
						`replay mismatch at ${position}: stored ${stored.action.action}, got ${a.action}`,
					);
				events.push(...stored.events);
				position += 1;
				continue;
			}
			const next = a.action === 'bet' ? 0 : (round?.stored.length ?? 0);
			if (position !== next) return fail(`seq ${position} is not the next position (${next})`);
			if (a.action !== 'bet' && round && gid !== round.id && round.stored.length > 1)
				return fail(`${a.action} under gid ${gid ?? '-'}, but the open round is ${round.id}`);
			const from = events.length;
			switch (a.action) {
				case 'bet': {
					if (!session.configSent)
						return fail('error executing requested actions: unexpected action: bet');
					if (round && !round.closed)
						return fail(
							'error executing requested actions: unexpected action: bet (was expecting: collect)',
						);
					const ctx = Array.isArray(a.context) ? a.context : [0, 1];
					const option = Number(ctx[0]);
					const betPerLine = Number(ctx[1]);
					const G = PARTNER_GAME;
					if (
						!Number.isInteger(option) ||
						option < 0 ||
						option >= G.betOptions.length ||
						disabled.has(option) ||
						!Number.isInteger(betPerLine) ||
						betPerLine <= 0
					)
						return fail('unexpected args for action bet');
					const total = G.betOptions[option] * betPerLine;
					if (session.balance < total) return fail('insufficient balance', 200);
					session.balance -= total;
					const name = G.betOptionNames[option];
					round = {
						id: roundId(),
						option,
						betPerLine,
						total,
						base: G.gameCost * betPerLine,
						stripsKey: engine.pacing.betModeStrips[name] ?? 'basegame',
						isBuy: name === 'goldStrike',
						win: 0,
						feature: null,
						played: false,
						closed: false,
						stored: [],
					};
					events.push({
						event: 'bet',
						context: { total, betPerLine, paylines: G.paylines.map((l) => [...l]) },
					});
					events.push({ event: 'gameStart', context: { totalBet: total, betPerLine } });
					break;
				}
				case 'play': {
					if (!round || round.closed)
						return fail('error executing requested actions: unexpected action: play');
					if (round.feature) {
						if (round.feature.ended)
							return fail(
								'error executing requested actions: unexpected action: play (was expecting: collect)',
							);
						engine.playRespin(events, round);
						break;
					}
					if (round.played)
						return fail(
							'error executing requested actions: unexpected action: play (was expecting: collect)',
						);
					const context = a.context;
					if (typeof context === 'string' && context.startsWith('force:')) {
						if (!allowForce) return fail('forcing is off on this mock', 101);
						const parsed = parsePartnerForce(context.slice('force:'.length));
						if (parsed.errors) return fail(`force: ${parsed.errors.join('; ')}`, 101);
						round.force = parsed.force;
					} else if (session.force) {
						round.force = session.force;
						session.force = null;
					} else if (defaultForce) round.force = defaultForce;
					if (round.isBuy && round.force?.baseCollect)
						return fail('force: baseCollect cannot ride a bought bonus', 101);
					round.played = true;
					engine.playBase(events, round);
					if (!round.feature) {
						events.push({ event: 'gameEnd', context: { win: round.win } });
						// A losing round closes in its own batch; anything that paid waits for `collect`.
						if (round.win === 0) {
							round.closed = true;
							events.push({ event: 'gameRoundOver', context: { win: 0 } });
						}
					}
					break;
				}
				case 'collect': {
					if (
						!round ||
						round.closed ||
						round.id !== gid ||
						!round.played ||
						(round.feature && !round.feature.ended)
					)
						return fail('error executing requested actions: unexpected action: collect');
					session.balance += round.win;
					round.closed = true;
					events.push({ event: 'gameRoundOver', context: { win: round.win } });
					break;
				}
				default:
					return fail(`error executing requested actions: unknown action: ${a?.action}`);
			}
			round.stored[position] = { action: a, events: events.slice(from) };
			position += 1;
		}
		if (round?.closed) {
			settled.set(`${sid}:${round.id}`, round);
			if (settled.size > 500) settled.delete(settled.keys().next().value);
		}
		session.round = round && !round.closed ? round : null;
		return sendJson(req, res, 200, { events, platform: platformOf(session, round) });
	};

	/** `…/force?sid=&beat=<tokens>` — held for that session's next round (`beat=` clears it). */
	const handleForce = (req, res, url) => {
		const sid = url.searchParams.get('sid');
		if (!sid) return sendJson(req, res, 400, { error: 'missing sid' });
		if (!allowForce)
			return sendJson(req, res, 403, { ok: false, errors: ['forcing is off on this mock'] });
		const spec = url.searchParams.get('beat') ?? '';
		const session = getSession(sid);
		if (!spec) {
			session.force = null;
			return sendJson(req, res, 200, { ok: true, sid, force: null });
		}
		const parsed = parsePartnerForce(spec);
		if (parsed.errors) return sendJson(req, res, 400, { ok: false, errors: parsed.errors });
		session.force = parsed.force;
		return sendJson(req, res, 200, { ok: true, sid, force: parsed.force });
	};

	const handle = async (req, res, url) => {
		if (req.method === 'OPTIONS') {
			res.writeHead(204, { ...corsHeaders(req), 'Access-Control-Max-Age': '86400' });
			return res.end();
		}
		if (req.method === 'GET' && pathEndsWith(url.pathname, '/healthz'))
			return sendJson(req, res, 200, {
				ok: true,
				sessions: sessions.size,
				protocol: 'holdAndWinPartner',
			});
		if (req.method === 'GET' && pathEndsWith(url.pathname, '/state')) {
			const sid = url.searchParams.get('sid');
			if (!sid) return sendJson(req, res, 400, { error: 'missing sid' });
			const { round, ...session } = getSession(sid);
			return sendJson(req, res, 200, {
				...session,
				round: round && { id: round.id, stored: round.stored.length, feature: round.feature },
			});
		}
		if ((req.method === 'POST' || req.method === 'GET') && pathEndsWith(url.pathname, '/force'))
			return handleForce(req, res, url);
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

	return { handle, sessions, startBalance, seed, parseForce: parsePartnerForce };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
	const PORT = Number(process.env.PORT ?? 7798);
	const mock = createMockRgs({ label: 'mock-hnw-partner' });
	createServer((req, res) =>
		mock.handle(req, res, new URL(req.url, `http://${req.headers.host}`)),
	).listen(PORT, () => {
		console.log(
			`[mock-hnw-partner] partner collector-respin wire on http://localhost:${PORT}/rgs/engine  balance=${mock.startBalance}¢ seed=${mock.seed ?? '(time)'}`,
		);
		console.log(
			`[mock-hnw-partner] force a beat: curl "http://localhost:${PORT}/force?sid=<sid>&beat=enhancements:11010,twoCollectors"`,
		);
	});
}
