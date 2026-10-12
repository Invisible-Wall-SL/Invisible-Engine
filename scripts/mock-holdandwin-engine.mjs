/**
 * THE HOLD AND WIN GAME ENGINE — everything the Hold and Win mock deals, without its sessions or its
 * HTTP: the config read into the shape a spin assumes, the base deal, the triggers, the forced beats,
 * the boot `holdAndWin` block and the respin feature (docs/reference/hold-and-win-wire.md).
 *
 * Two callers. `mock-rgs-server-holdandwin.mjs` is a Hold and Win GAME built on it. The pots overlay
 * (`mock-pots-overlay.mjs`) starts its feature as another kind's BONUS: `base: false` lifts the base
 * game's requirements (paylines, line symbols) and `rand` makes it draw from the caller's stream.
 *
 * One engine plays ONE respin mode (docs/design/bonus-games.md §2.2): `mode` is its id and `bonus`
 * its strip key, the bonus key its feature is played under. With `wire: true` every Hold and Win
 * context it answers carries `mode`; without it (the lone default mode) the answer is what it was.
 *
 * A round is the caller's object: the feature reads `baseTotal` (credits per 1 × stake), `force`,
 * `isBuy`/`buyTier`, keeps its state on `feature` and adds what it pays to `win`. A session carries
 * `meters` (levels by id, zeroed as the feature consumes them) and `jackpots` (the progressive pools,
 * selected per request with `setLivePools`).
 */

import { evaluatePaylines } from './mock-rgs-server.mjs';

/** Wire version, sent in the boot config so a facade can refuse a wire it was not written for. */
export const HOLD_AND_WIN_WIRE_VERSION = 1;

// ---------- pacing (the mock's, not the math's) ----------

/** A base-game cell is a coin this often (5×3: ~2 per spin, a count-6 trigger ~1 spin in 50). */
const BASE_COIN_RATE = 0.15;
/** …and each special that lands in the base game this often. */
const BASE_SPECIAL_RATE = 0.05;
/** An empty respin cell lands something this often. */
const RESPIN_LAND_RATE = 0.06;
/** Of what lands on a respin, a special (when one is active on that reel) this share of the time;
 *  doubled for a bought tier with `boostedSpecials`. */
const RESPIN_SPECIAL_SHARE = 0.2;
export const LUCKY_SPIN_RATE = 0.01;
export const RANDOM_METRE_RATE = 0.005;
/** A board that clears (a streak, or letters that sweep their column) never fills, so a forced
 *  chain on one needs a length of its own. */
const CLEARING_CHAIN_LENGTH = 10;
/** Runaway guard on one feature — far above any real one (`respins.cap` is the authored limit). */
const MAX_RESPINS = 200;

const SPECIALS = ['collector', 'multiplier', 'payer', 'mystery', 'addRespins', 'upgrade'];
/** The `special_properties` role each special's symbols carry (game-config `SPECIAL_SYMBOL_ROLE`). */
const SPECIAL_ROLE = {
	collector: 'collector',
	multiplier: 'coinMultiplier',
	payer: 'payer',
	mystery: 'mystery',
	addRespins: 'addRespins',
	upgrade: 'upgrade',
};
const UPGRADE_TARGETS = ['all', 'adjacent', 'jackpotTier'];
const EXPANSION_RULES = ['fullRow', 'unlockSymbol', 'coinCount'];
const ROLE_SPECIAL = Object.fromEntries(Object.entries(SPECIAL_ROLE).map(([k, r]) => [r, k]));

export function hashStr(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h;
}

/** Values are × the base total stake; four decimals keep `1.5 × 3` from reading `4.499999`. */
export const tidy = (n) => Number(n.toFixed(4));

const payCents = (amount) => (amount > 0 ? Math.max(1, Math.round(amount)) : 0);

/** The default respin mode, and its strip key — the partner core's `spinTrigger.bonus`. */
export const DEFAULT_RESPIN_MODE = { mode: 'holdAndWin', bonus: 'respin' };

// ---------- factory ----------

/**
 * @param {{ label?: string, seed?: string, rand?: () => number, base?: boolean,
 *   mode?: string, bonus?: string, blank?: string, wire?: boolean,
 *   reels?: number, rows?: number, rowsPerReel?: number[], paylines?: number[][],
 *   betModes?: { mode: string, cost: number, kind: 'base' | 'ante' | 'buy' }[],
 *   holdAndWin: { block: object, lineSymbols: string[],
 *     symbols: Record<string, { roles: string[], wild?: true, paytable?: Record<string, number> }> } }} opts
 */
/**
 * The tier names progressive (`fixed: false`) in two or more of `blocks` — each such tier keeps a
 * pool per respin mode, its `jackpotLevels` entries tagged with the mode. Every other progressive
 * tier keeps the one pool shared by name, as before pools could be per mode.
 */
export function splitPoolNames(blocks) {
	const seen = new Set();
	const split = new Set();
	for (const block of blocks) {
		const names = new Set(
			(Array.isArray(block?.jackpots) ? block.jackpots : [])
				.filter((j) => j?.fixed === false)
				.map((j) => j.name),
		);
		for (const name of names) (seen.has(name) ? split : seen).add(name);
	}
	return split;
}

export function createHoldAndWinEngine(opts = {}) {
	const label = opts.label ?? 'mock-hnw';
	const seed = opts.seed;
	const inputs = opts.holdAndWin;
	if (!inputs?.block || !inputs.symbols) {
		throw new Error(`[${label}] a Hold and Win mock needs the project's holdAndWin block`);
	}
	const block = inputs.block;
	const symbols = inputs.symbols;
	const mode = opts.mode ?? DEFAULT_RESPIN_MODE.mode;
	const bonusKey = opts.bonus ?? DEFAULT_RESPIN_MODE.bonus;
	/** `{ mode }` on every Hold and Win context, or nothing for the lone default mode. */
	const tagged = opts.wire === true ? { mode } : {};
	const list = (v) => (Array.isArray(v) ? v : []);
	// The launcher hands over a NORMALIZED block, but the manifest copy is external: every field a
	// spin reads is re-read here into the shape the code assumes, so a malformed one deals nothing
	// rather than throwing mid-round.
	const rawTrigger = block.trigger ?? {};
	const trigger = {
		...rawTrigger,
		count: rawTrigger.count
			? { min: Number(rawTrigger.count.min) || 1, roles: list(rawTrigger.count.roles) }
			: undefined,
		pattern: list(rawTrigger.pattern).map((req) => ({
			reel: Number(req?.reel) || 0,
			roles: list(req?.roles),
			min: Number(req?.min) || 1,
		})),
		buy: list(rawTrigger.buy),
	};
	const respinRules = {
		start: block.respins?.start ?? 3,
		reset: block.respins?.reset ?? 'anyCoin',
		cap: block.respins?.cap,
	};
	const stickiness = block.stickiness ?? 'allCoins';
	const boardEnd = { ...(block.boardEnd ?? { type: 'none' }) };
	if (boardEnd.type === 'columnLetters') boardEnd.letters = String(boardEnd.letters ?? '');
	if (boardEnd.type === 'fullBoardJackpot') boardEnd.roles = list(boardEnd.roles);
	const specialsCfg = block.specials ?? {};
	const applyOrder = list(block.applyOrder);
	const meters = list(block.meters);
	const jackpotTable = Object.fromEntries(list(block.jackpots).map((j) => [j.name, j.multiplier]));
	/** The session pool a tier of this mode reads: its own (`<name>@<mode>`) when the name is one of
	 *  `opts.splitPools` (progressive in several modes, {@link splitPoolNames}), else the one shared
	 *  by name. */
	const splitPools = opts.splitPools instanceof Set ? opts.splitPools : null;
	const poolKey = (name) => (splitPools?.has(name) ? `${name}@${mode}` : name);
	/** The progressive tiers (`fixed: false`) and their pools' rules, × base total bet. `mode` only on
	 *  a pool of this mode's own. */
	const progressiveTiers = list(block.jackpots)
		.filter((j) => j.fixed === false)
		.map((j) => ({
			key: poolKey(j.name),
			...(splitPools?.has(j.name) ? { mode } : {}),
			name: j.name,
			seed: Number(j.progressive?.seed ?? j.multiplier),
			contribution: Math.max(0, Number(j.progressive?.contribution ?? 0)),
			cap: j.progressive?.cap === undefined ? Infinity : Number(j.progressive.cap),
		}));
	/** The pools of the session being dealt (set per request — one runs at a time), so a jackpot's
	 *  worth anywhere in the deal is the pool as it stands; tiers won in an action reset after it. */
	let livePools = null;
	const setLivePools = (pools) => {
		livePools = pools;
	};
	const wonProgressive = new Set();
	const tierMultiplier = (tier) => livePools?.[poolKey(tier)] ?? jackpotTable[tier] ?? 0;
	/** Tiers lowest prize first — the ladder a `jackpotTier` upgrade climbs (`jackpotLadder`). */
	const jackpotLadder = list(block.jackpots)
		.slice()
		.sort((a, b) => a.multiplier - b.multiplier)
		.map((j) => j.name);
	const upgradeTargets = list(specialsCfg.upgrade?.targets).filter((t) =>
		UPGRADE_TARGETS.includes(t?.target),
	);
	/** Board expansion (11b): rows open BELOW the base grid up to `maxRows`. Null when it never grows. */
	const expansion = (() => {
		const raw = block.expansion;
		if (!raw || !EXPANSION_RULES.includes(raw.rule)) return null;
		const startRows = Math.max(1, Math.round(Number(raw.startRows) || 1));
		const maxRows = Math.max(startRows, Math.round(Number(raw.maxRows) || startRows));
		return {
			startRows,
			maxRows,
			rule: raw.rule,
			thresholds: list(raw.thresholds).map(Number),
			unlockReels: Array.isArray(raw.unlockReels) ? raw.unlockReels : undefined,
			resetsRespins: raw.resetsRespins !== false,
			rowJackpots: list(raw.rowJackpots).filter((rj) => rj?.jackpot in jackpotTable),
		};
	})();

	const reelCount = Math.max(1, Math.round(Number(opts.reels ?? 5)));
	const rowHeights = Array.from({ length: reelCount }, (_u, reel) => {
		const perReel = Array.isArray(opts.rowsPerReel) ? opts.rowsPerReel[reel] : undefined;
		return Math.max(1, Math.round(Number(perReel ?? opts.rows ?? 3)));
	});
	const rowCount = Math.max(...rowHeights);
	const isStepped = rowHeights.some((r) => r !== rowHeights[0]);
	const paylines = list(opts.paylines);
	if (opts.base !== false && !paylines.length)
		throw new Error(`[${label}] a Hold and Win base game pays lines — no paylines`);

	// ---- symbols by role ----
	const names = Object.keys(symbols).sort();
	const withRole = (role) => names.filter((n) => list(symbols[n].roles).includes(role));
	const coinSymbol = withRole('coin')[0] ?? withRole('jackpot')[0];
	const jackpotSymbol = withRole('jackpot')[0] ?? coinSymbol;
	const blankSymbol = opts.blank ?? withRole('blank')[0] ?? 'BLANK';
	const unlockSymbol = expansion?.rule === 'unlockSymbol' ? withRole('unlock')[0] : undefined;
	const specialSymbol = Object.fromEntries(
		SPECIALS.map((kind) => [kind, specialsCfg[kind] ? withRole(SPECIAL_ROLE[kind])[0] : undefined]),
	);
	const kindOfSymbol = (name) => {
		for (const kind of SPECIALS) if (specialSymbol[kind] === name) return kind;
		return undefined;
	};
	const lineSymbols = list(inputs.lineSymbols).filter((n) => symbols[n]);
	if (opts.base !== false && !lineSymbols.length)
		throw new Error(`[${label}] no base-game line symbols`);
	if (!coinSymbol) throw new Error(`[${label}] no symbol is tagged coin or jackpot`);
	const wildName = names.find((n) => symbols[n].wild);
	const wildPay = wildName ? (symbols[wildName].paytable ?? {}) : null;
	const symbolPaytable = Object.fromEntries(
		lineSymbols.filter((n) => symbols[n].paytable).map((n) => [n, symbols[n].paytable]),
	);

	// ---- the bet table (the lines mock's rule: a table only when something is sold) ----
	const betTable = (() => {
		const modes = Array.isArray(opts.betModes) && opts.betModes.length > 1 ? opts.betModes : null;
		if (!modes) return null;
		const unit = paylines.length;
		return {
			options: modes.map((mode, i) => (i === 0 ? unit : (unit * mode.cost) / modes[0].cost)),
			names: modes.map((mode, i) => `${i}:${i === 0 ? 'base' : mode.mode.toLowerCase()}`),
			modes: modes.map((mode) => mode.mode),
			buys: modes.map((mode) => mode.kind === 'buy'),
		};
	})();

	// ---- RNG ----
	let rngState = seed ? hashStr(seed) : Date.now() >>> 0;
	const rand =
		opts.rand ??
		(() => {
			rngState = (rngState * 1664525 + 1013904223) >>> 0;
			return rngState / 0x100000000;
		});
	const pick = (items) => items[Math.floor(rand() * items.length)];
	const weighted = (items, rng = rand) => {
		const live = items.filter((i) => i.weight > 0);
		const total = live.reduce((s, i) => s + i.weight, 0);
		if (!live.length) return undefined;
		let r = rng() * total;
		for (const item of live) if ((r -= item.weight) <= 0) return item;
		return live[live.length - 1];
	};
	const onReel = (entry, reel) => !entry.reels || entry.reels.includes(reel);

	// ---- cells ----
	/** A cell: `null` (empty/blank) or `{ symbol, kind, value?, jackpot?, factor? }`. */
	const lineCell = () => ({ symbol: pick(lineSymbols), kind: 'line' });
	const coinEntriesOn = (reel, table = block.coins) => list(table).filter((c) => onReel(c, reel));
	/** The base game's coin values (`coinOverlay.coins`), else the respin table: what lands on the
	 *  base reels and what an overlay drops. Absent ⇒ the respin table, so every draw is as before. */
	const baseCoins =
		Array.isArray(inputs.baseCoins) && inputs.baseCoins.length ? inputs.baseCoins : block.coins;
	const coinFromEntry = (entry, boost = 1) =>
		entry.kind === 'jackpot'
			? { symbol: jackpotSymbol, kind: 'jackpot', jackpot: entry.jackpot, factor: 1 }
			: { symbol: coinSymbol, kind: 'coin', value: tidy(entry.value * boost) };
	const drawCoin = (reel, boost = 1, table = block.coins) => {
		const entry = weighted(coinEntriesOn(reel, table)) ?? weighted(list(table));
		return entry ? coinFromEntry(entry, boost) : null;
	};
	const drawCash = (reel, boost = 1, table = block.coins) => {
		const cash = list(table).filter((c) => c.kind === 'cash');
		const entry = weighted(cash.filter((c) => onReel(c, reel))) ?? weighted(cash);
		return entry ? coinFromEntry(entry, boost) : drawCoin(reel, boost, table);
	};
	/** A coin of the base game: on the base reels, or dropped by an overlay — which draws it from its
	 *  own `rng`, so the board this engine deals stays the same with or without it. */
	const drawBaseCoin = (reel, rng = rand) => {
		const entry = weighted(coinEntriesOn(reel, baseCoins), rng) ?? weighted(list(baseCoins), rng);
		return entry ? coinFromEntry(entry) : null;
	};
	const specialCell = (kind) => {
		const symbol = specialSymbol[kind];
		if (!symbol) return null;
		const cfg = specialsCfg[kind];
		if (kind === 'payer' || kind === 'multiplier') {
			const value = weighted(list(cfg.values))?.value ?? (kind === 'multiplier' ? 2 : 1);
			return { symbol, kind, value };
		}
		// An add-respins carries its respins; an upgrade its cash step (none in a tier-only table).
		if (kind === 'addRespins') {
			return { symbol, kind, value: weighted(list(cfg.values))?.value ?? 1 };
		}
		if (kind === 'upgrade') {
			const step = weighted(list(cfg.values))?.value;
			return step === undefined ? { symbol, kind } : { symbol, kind, value: step };
		}
		return kind === 'collector' ? { symbol, kind, value: 0 } : { symbol, kind };
	};
	const specialLandsOn = (kind, reel) => {
		const cfg = specialsCfg[kind];
		return Boolean(cfg && specialSymbol[kind] && onReel(cfg, reel));
	};
	const jackpotWorth = (cell) => tierMultiplier(cell.jackpot) * (cell.factor ?? 1);
	/** What a cell pays at the end, × base total stake. */
	const worth = (cell) =>
		!cell
			? 0
			: cell.kind === 'coin' || cell.kind === 'collector'
				? (cell.value ?? 0)
				: cell.kind === 'jackpot'
					? jackpotWorth(cell)
					: 0;
	const cellString = (cell) => {
		if (!cell) return blankSymbol;
		if (cell.kind === 'jackpot') {
			return `${cell.symbol}:${cell.jackpot}${cell.factor > 1 ? `*${tidy(cell.factor)}` : ''}`;
		}
		if (cell.kind === 'coin' || cell.kind === 'payer' || cell.kind === 'multiplier') {
			return `${cell.symbol}:${tidy(cell.value)}`;
		}
		if ((cell.kind === 'addRespins' || cell.kind === 'upgrade') && cell.value !== undefined) {
			return `${cell.symbol}:${tidy(cell.value)}`;
		}
		if (cell.kind === 'collector' && cell.value > 0) return `${cell.symbol}:${tidy(cell.value)}`;
		return cell.symbol;
	};
	const cellInfo = (reel, row, cell) => ({
		reel,
		row,
		symbol: cell.symbol,
		...(cell.kind === 'jackpot'
			? { jackpot: cell.jackpot, ...(cell.factor > 1 ? { factor: tidy(cell.factor) } : {}) }
			: cell.value !== undefined && cell.kind !== 'line'
				? { value: tidy(cell.value) }
				: {}),
	});
	const boardStrings = (board) => board.map((column) => column.map(cellString));
	const rolesOf = (cell) => (cell ? list(symbols[cell.symbol]?.roles) : []);
	const eachCell = (board, fn) =>
		board.forEach((column, reel) => column.forEach((cell, row) => fn(cell, reel, row)));
	const cellsWhere = (board, test) => {
		const out = [];
		eachCell(board, (cell, reel, row) => {
			if (test(cell, reel, row)) out.push({ reel, row, cell });
		});
		return out;
	};
	const emptyBoard = () => rowHeights.map((rows) => Array.from({ length: rows }, () => null));
	const credits = (value, round) => Math.round(value * round.baseTotal);

	// ---- the base game deal ----
	const baseSpecialKinds = SPECIALS.filter((kind) => specialsCfg[kind]?.landsInBaseGame);
	/** A meter's filling symbol that is no special of its own still has to land somewhere. */
	const meterOnlySymbols = meters
		.map((m) => m.symbol)
		.filter((s) => symbols[s] && !kindOfSymbol(s));
	const dealBase = () =>
		rowHeights.map((rows, reel) =>
			Array.from({ length: rows }, () => {
				if (rand() < BASE_COIN_RATE && coinEntriesOn(reel, baseCoins).length)
					return drawBaseCoin(reel);
				const kinds = baseSpecialKinds.filter((k) => specialLandsOn(k, reel));
				const extras = [...kinds, ...meterOnlySymbols];
				if (extras.length && rand() < BASE_SPECIAL_RATE * extras.length) {
					const choice = pick(extras);
					return SPECIALS.includes(choice)
						? specialCell(choice)
						: { symbol: choice, kind: 'meter' };
				}
				return lineCell();
			}),
		);

	const evaluateLines = (board, round) => {
		const plain = board.map((column) =>
			column.map((cell) =>
				cell && cell.symbol === wildName ? 'WILD' : (cell?.symbol ?? blankSymbol),
			),
		);
		const wins = evaluatePaylines(
			plain,
			round.betPerLine,
			paylines,
			wildPay ? { paytable: wildPay } : null,
			{ pool: lineSymbols, symbolPaytable },
		);
		return wins.map((w) => ({
			...w,
			what: w.what === 'WILD' ? wildName : w.what,
			pay: payCents(w.pay),
		}));
	};

	// ---- triggers ----
	const countMatches = (board) =>
		trigger.count
			? cellsWhere(board, (cell) => rolesOf(cell).some((r) => trigger.count.roles.includes(r)))
					.length
			: 0;
	const countTriggered = (board) =>
		Boolean(trigger.count) && countMatches(board) >= trigger.count.min;
	const patternTriggered = (board) =>
		Boolean(trigger.pattern?.length) &&
		trigger.pattern.every(
			(req) =>
				(board[req.reel] ?? []).filter((cell) => rolesOf(cell).some((r) => req.roles.includes(r)))
					.length >= req.min,
		);
	/** A cell of `role` that can sit on `reel`, or null; its coins from `table`. */
	const cellForRole = (role, reel, table = block.coins) => {
		if (role === 'coin')
			return coinEntriesOn(reel, table).some((c) => c.kind === 'cash')
				? drawCash(reel, 1, table)
				: null;
		if (role === 'jackpot') {
			const jackpots = coinEntriesOn(reel, table).filter((c) => c.kind === 'jackpot');
			return jackpots.length ? coinFromEntry(weighted(jackpots) ?? jackpots[0]) : null;
		}
		const kind = ROLE_SPECIAL[role];
		return kind && specialLandsOn(kind, reel) ? specialCell(kind) : null;
	};
	/** Place what the primary trigger (count, else pattern) still lacks. Returns the cells added. */
	const satisfyTrigger = (board, keep = () => false) => {
		const added = [];
		const put = (reel, row, cell) => {
			board[reel][row] = cell;
			added.push({ reel, row, cell });
		};
		if (trigger.count) {
			let guard = 0;
			while (!countTriggered(board) && guard++ < 500) {
				const free = cellsWhere(
					board,
					(cell, reel, row) =>
						!rolesOf(cell).some((r) => trigger.count.roles.includes(r)) && !keep(reel, row),
				);
				if (!free.length) break;
				const { reel, row } = pick(free);
				const role = trigger.count.roles.find((r) => cellForRole(r, reel, baseCoins));
				const cell = role ? cellForRole(role, reel, baseCoins) : null;
				if (cell) put(reel, row, cell);
			}
			return added;
		}
		for (const req of list(trigger.pattern)) {
			let guard = 0;
			const column = board[req.reel];
			if (!column) continue;
			const hits = () =>
				column.filter((cell) => rolesOf(cell).some((r) => req.roles.includes(r))).length;
			while (hits() < req.min && guard++ < 50) {
				const rows = column
					.map((cell, row) => row)
					.filter(
						(row) =>
							!rolesOf(column[row]).some((r) => req.roles.includes(r)) && !keep(req.reel, row),
					);
				if (!rows.length) break;
				const role = req.roles.find((r) => cellForRole(r, req.reel, baseCoins));
				const cell = role ? cellForRole(role, req.reel, baseCoins) : null;
				if (!cell) break;
				put(req.reel, pick(rows), cell);
			}
		}
		return added;
	};
	/** The cause a trigger that no specific mechanism fired is reported under. */
	const primaryCause = trigger.count
		? 'count'
		: trigger.pattern?.length
			? 'pattern'
			: trigger.luckySpin
				? 'luckySpin'
				: trigger.randomMetre
					? 'randomMetre'
					: meters.length
						? 'meter'
						: 'forced';

	// ---- forced outcomes ----
	const FEATURE_TOKENS = new Set([
		'special',
		'mystery',
		'unlock',
		'expandFull',
		'jackpot',
		'letter',
		'letters',
		'fullBoard',
		'wheel',
		'chain',
		'dead',
		'queuedMode',
	]);
	/**
	 * A force spec: comma-separated tokens, each `name[:arg[:arg]]`.
	 *
	 *   trigger[:count|pattern|luckySpin|randomMetre|meter[:<id>]]   start the feature by that cause
	 *   lucky · meter:<id>                                            aliases of the two above
	 *   special:<collector|multiplier|payer|mystery|addRespins>   lands in respin 1 (and is active)
	 *   special:upgrade[:all|adjacent|jackpotTier]   an upgrade lands in respin 1, applying that
	 *                                         rule: `jackpotTier` also lands the lowest-tier
	 *                                         jackpot coin, `all`/`adjacent` land it beside a held
	 *                                         cash coin
	 *   mystery:<coin|jackpot:<TIER>|<special>>   a mystery lands in respin 1, reveals it
	 *   unlock:<special>                      the mystery reveals a special NOT active at entry
	 *   unlock:<n>                            board expansion: the next respins open n rows by the
	 *                                         game's rule (fill the bottom open row / land an unlock
	 *                                         symbol / land coins up to the threshold), one per respin
	 *   expandFull                            open every row, then fill the whole expanded board
	 *   jackpot:<TIER>                        a jackpot coin lands in respin 1
	 *   letter                                respin 1 fills the first unlit column (columnLetters)
	 *   letters · fullBoard                   respin 1 fills every empty cell (all letters / full board)
	 *   wheel:<index>|coinBoost|extraCollect[:n]|jackpot:<TIER>        the wheel's prize
	 *   chain                                 the longest reset chain: one new coin every respin
	 *   dead                                  nothing lands in the feature
	 *   queuedMode[:<id>]                     a second mode (default `queuedFixture`) is queued behind
	 *                                         the feature and exits, empty, as it ends — the generic
	 *                                         `modeEnter`/`modeExit` pair, no gameplay of its own
	 *   instant                               a base-game instant collect, no feature
	 *
	 * Any feature token implies `trigger`. Returns `{ force }` or `{ errors }` — a typo is refused,
	 * never quietly dealt as a normal round.
	 */
	const parseForce = (spec) => {
		const force = { specials: [], jackpots: [] };
		const errors = [];
		const tokens = String(spec ?? '')
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		const needSpecial = (kind, token) => {
			if (!SPECIALS.includes(kind)) errors.push(`${token}: "${kind}" is not a special`);
			else if (!specialSymbol[kind]) errors.push(`${token}: this game has no ${kind}`);
			return kind;
		};
		const needJackpot = (tier, token) => {
			if (!(tier in jackpotTable))
				errors.push(`${token}: "${tier}" is not one of the jackpot tiers`);
			return tier;
		};
		for (const token of tokens) {
			const [name, ...args] = token.split(':');
			switch (name) {
				case 'trigger':
				case 'lucky':
				case 'meter': {
					const cause =
						name === 'lucky' ? 'luckySpin' : name === 'meter' ? 'meter' : (args[0] ?? 'any');
					const meterId = name === 'meter' ? args[0] : args[1];
					const ok = {
						any: true,
						count: Boolean(trigger.count),
						pattern: Boolean(trigger.pattern?.length),
						luckySpin: Boolean(trigger.luckySpin),
						randomMetre: Boolean(trigger.randomMetre),
						meter: meters.length > 0,
					}[cause];
					if (ok === undefined) errors.push(`${token}: unknown trigger cause "${cause}"`);
					else if (!ok) errors.push(`${token}: this game has no ${cause} trigger`);
					const filled =
						cause === 'meter' ? (meters.find((m) => m.id === meterId) ?? meters[0]) : undefined;
					if (meterId && !meters.some((m) => m.id === meterId)) {
						errors.push(`${token}: no meter "${meterId}"`);
					} else if (filled && !symbols[filled.symbol]) {
						// Forcing it lands its symbol, which no strip deals (`/config` marks it unused).
						errors.push(
							`${token}: the ${filled.id} meter fills from a symbol this game never deals`,
						);
					}
					force.trigger = cause;
					if (meterId) force.meter = meterId;
					break;
				}
				case 'special':
					force.specials.push(needSpecial(args[0], token));
					if (args[0] === 'upgrade' && args[1] !== undefined) {
						if (!upgradeTargets.some((t) => t.target === args[1])) {
							errors.push(`${token}: this game's upgrade has no "${args[1]}" rule`);
						}
						force.upgradeTarget = args[1];
					}
					break;
				case 'unlock':
				case 'expandFull':
					if (name === 'expandFull' || /^\d+$/.test(args[0] ?? '')) {
						const n = name === 'expandFull' ? Infinity : Number(args[0]);
						if (!expansion) errors.push(`${token}: this game's board does not expand`);
						else if (!(n >= 1)) errors.push(`${token}: unlock at least one row`);
						else if (n !== Infinity && n > expansion.maxRows - expansion.startRows)
							errors.push(
								`${token}: only ${expansion.maxRows - expansion.startRows} rows can unlock`,
							);
						else if (expansion.rule === 'unlockSymbol' && !unlockSymbol)
							errors.push(`${token}: no symbol is tagged unlock`);
						force.unlockRows = n;
						if (name === 'expandFull') force.expandFull = true;
						break;
					}
				// falls through — `unlock:<special>` is the mystery's
				case 'mystery': {
					needSpecial('mystery', token);
					const [what, tier] = args;
					if (name === 'unlock' || SPECIALS.includes(what)) {
						const kind = needSpecial(what, token);
						if (kind === 'mystery') errors.push(`${token}: a mystery never reveals a mystery`);
						force.mystery = { type: 'special', special: kind };
						if (name === 'unlock') force.unlock = kind;
					} else if (what === 'coin') {
						force.mystery = { type: 'coin' };
					} else if (what === 'jackpot') {
						force.mystery = { type: 'jackpot', jackpot: needJackpot(tier, token) };
					} else {
						errors.push(`${token}: a mystery reveals coin, jackpot:<TIER> or a special`);
					}
					break;
				}
				case 'jackpot':
					force.jackpots.push(needJackpot(args[0], token));
					break;
				case 'letter':
				case 'letters':
					if (boardEnd.type !== 'columnLetters')
						errors.push(`${token}: this game has no column letters`);
					force[name] = true;
					break;
				case 'fullBoard':
				case 'chain':
				case 'dead':
				case 'instant':
					force[name] = true;
					break;
				case 'queuedMode': {
					const id = args[0] ?? 'queuedFixture';
					if (!/^[A-Za-z][\w-]*$/.test(id) || id === mode)
						errors.push(
							`${token}: "${id}" is not a mode id (a letter, then letters, digits, - or _; not ${mode})`,
						);
					force.queuedMode = id;
					break;
				}
				case 'wheel': {
					const prizes = list(block.wheel?.prizes);
					if (!prizes.length) {
						errors.push(`${token}: this game has no wheel`);
						break;
					}
					const index = /^\d+$/.test(args[0] ?? '')
						? Number(args[0])
						: prizes.findIndex(
								(p) =>
									p.type === args[0] &&
									(p.type !== 'extraCollect' || !args[1] || p.count === Number(args[1])) &&
									(p.type !== 'jackpot' || p.jackpot === args[1]),
							);
					if (!(index >= 0 && index < prizes.length)) errors.push(`${token}: no such wheel prize`);
					force.wheel = index;
					break;
				}
				default:
					errors.push(`${token}: unknown force "${name}"`);
			}
		}
		if (
			force.instant &&
			tokens.some((t) => t.startsWith('trigger') || FEATURE_TOKENS.has(t.split(':')[0]))
		) {
			errors.push('instant is a base-game win without the feature — it cannot combine with one');
		}
		if (force.instant) {
			const instant = SPECIALS.filter(
				(k) => specialsCfg[k]?.instantCollectInBaseGame && specialSymbol[k],
			);
			if (!instant.length) errors.push('instant: this game has no base-game instant collect');
		}
		if (!force.trigger && tokens.some((t) => FEATURE_TOKENS.has(t.split(':')[0])))
			force.trigger = 'any';
		return errors.length ? { errors } : { force };
	};
	// ---- the boot config ----
	/** The boot config's `holdAndWin` block — the feature's rules, the meters and pools as they stand. */
	const holdAndWinConfig = (session) => ({
		wire: HOLD_AND_WIN_WIRE_VERSION,
		bonus: bonusKey,
		roles: Object.fromEntries(
			names.filter((n) => list(symbols[n].roles).length).map((n) => [n, symbols[n].roles]),
		),
		blank: blankSymbol,
		jackpots: list(block.jackpots).map((j) =>
			j.fixed === false
				? {
						name: j.name,
						multiplier: j.multiplier,
						progressive: true,
						value: tidy(session.jackpots[poolKey(j.name)]),
					}
				: { name: j.name, multiplier: j.multiplier },
		),
		respins: respinRules.start,
		stickiness,
		boardEnd:
			boardEnd.type === 'columnLetters'
				? { type: boardEnd.type, letters: boardEnd.letters, jackpot: boardEnd.jackpot }
				: boardEnd.type === 'fullBoardJackpot'
					? { type: boardEnd.type, jackpot: boardEnd.jackpot }
					: { type: 'none' },
		meters: meters.map((m) => ({
			id: m.id,
			symbol: m.symbol,
			level: session.meters[m.id],
			max: m.maxLevel,
			sizeStages: list(m.sizeStages),
			activates: m.activates,
		})),
		luckySpin: trigger.luckySpin === true,
		...(trigger.randomMetre ? { randomMetre: trigger.randomMetre.name } : {}),
		...(expansion
			? {
					expansion: {
						startRows: expansion.startRows,
						maxRows: expansion.maxRows,
						rule: expansion.rule,
					},
				}
			: {}),
	});

	const configContext = (session) => ({
		symbols: names,
		window: { reels: reelCount, rows: rowCount, ...(isStepped ? { rowsPerReel: rowHeights } : {}) },
		availablePayLines: paylines,
		paylines,
		wildSymbols: wildName ? [wildName] : [],
		symbolsPay: { line: lineSymbols, scatter: [] },
		paytable: Object.fromEntries(
			Object.entries({
				...symbolPaytable,
				...(wildName && wildPay && Object.keys(wildPay).length ? { [wildName]: wildPay } : {}),
			}).map(([sym, byCount]) => {
				const counts = Object.keys(byCount)
					.map(Number)
					.sort((a, b) => a - b);
				return [sym, { occurs: counts, pay: counts.map((c) => byCount[c]) }];
			}),
		),
		...(betTable
			? {
					betOptions: betTable.options,
					betOptionsName: betTable.names,
					gameCost: betTable.options[0],
				}
			: {}),
		holdAndWin: holdAndWinConfig(session),
	});

	// ---- the feature ----
	const featureState = (f) => ({
		cells: cellsWhere(f.board, (cell) => cell !== null).map(({ reel, row, cell }) =>
			cellInfo(reel, row, cell),
		),
		start: f.start,
		left: f.left,
		played: f.played,
		banked: f.banked,
		activeModifiers: [...f.active],
		collectorLevel: f.collectorLevel,
		coinBoost: f.coinBoost,
		...(boardEnd.type === 'columnLetters' ? { lettersLit: [...f.lettersLit] } : {}),
		...(expansion ? { rows: f.rows } : {}),
	});
	const bonusSnapshot = (round) => {
		const f = round.feature;
		const spinTrigger = {
			occurs: [trigger.count?.min ?? 1],
			of: coinSymbol,
			mode,
			from: '',
		};
		return {
			prob: 1,
			additionalPrice: 0,
			triggers: 1,
			played: f.played,
			left: f.left,
			multiplier: {},
			bonusTriggers: { [bonusKey]: 1 },
			bonusPlayed: {
				[bonusKey]: { count: f.played, base: { count: 0, multiplierCount: 0 }, states: {} },
			},
			spins: f.left > 0 ? [{ spins: f.left, bonus: bonusKey, trigger: spinTrigger }] : [],
			playing: bonusKey,
			trigger: spinTrigger,
			holdAndWin: featureState(f),
			...tagged,
		};
	};

	const jackpotWin = (events, round, tier, source, banked, cell, factor = 1) => {
		const amount = credits(tierMultiplier(tier) * factor, round);
		if (progressiveTiers.some((t) => t.name === tier)) wonProgressive.add(poolKey(tier));
		events.push({
			event: 'jackpotWin',
			context: {
				tier,
				amount,
				source,
				banked,
				...(cell ? { cell: { reel: cell.reel, row: cell.row } } : {}),
			},
		});
		return amount;
	};
	const bank = (round, amount) => {
		round.feature.banked += amount;
	};

	/**
	 * Every held coin gathered by every collector in `collectors`. Collectors-only (a streak) takes
	 * jackpot coins too — they are cleared with the rest, so this is the only moment they pay — while
	 * a sticky-coins game leaves them on the board for the end tally.
	 */
	const collect = (events, round, collectors) => {
		const f = round.feature;
		const streak = stickiness === 'collectorsOnly';
		const coins = cellsWhere(
			f.board,
			(cell) => cell && (cell.kind === 'coin' || (streak && cell.kind === 'jackpot')),
		);
		if (!coins.length) return coins;
		for (const { reel, row, cell: collector } of collectors) {
			const from = coins.map(({ reel: r, row: w, cell }) => ({
				...cellInfo(r, w, cell),
				amount: credits(worth(cell), round),
			}));
			const gathered = coins.reduce((sum, { cell }) => sum + worth(cell), 0);
			collector.value = tidy((collector.value ?? 0) + f.collectorLevel * gathered);
			events.push({
				event: 'coinCollect',
				context: {
					collector: { reel, row, symbol: collector.symbol },
					level: f.collectorLevel,
					cells: from,
					value: collector.value,
				},
			});
			if (streak) {
				for (const { reel: r, row: w, cell } of coins) {
					if (cell.kind === 'jackpot')
						jackpotWin(
							events,
							round,
							cell.jackpot,
							'collect',
							false,
							{ reel: r, row: w },
							(cell.factor ?? 1) * f.collectorLevel,
						);
				}
			}
		}
		return coins;
	};

	/** Streak rule: after the collect, everything but the collectors leaves the board. */
	const clearNonCollectors = (events, round) => {
		const f = round.feature;
		const gone = cellsWhere(f.board, (cell) => cell && cell.kind !== 'collector');
		for (const { reel, row } of gone) f.board[reel][row] = null;
		if (gone.length) {
			events.push({
				event: 'cellsCleared',
				context: { reason: 'collected', cells: gone.map(({ reel, row }) => ({ reel, row })) },
			});
		}
	};

	/** Column letters and the full board. Returns true when the board has ENDED the feature. */
	const checkBoardEnd = (events, round) => {
		const f = round.feature;
		if (boardEnd.type === 'columnLetters') {
			const letters = [...boardEnd.letters];
			f.board.forEach((column, reel) => {
				if (!column.every((cell) => cell !== null)) return;
				const already = f.lettersLit[reel];
				if (already && !boardEnd.clearOnComplete) return;
				const value = tidy(column.reduce((sum, cell) => sum + worth(cell), 0));
				const amount = boardEnd.clearOnComplete
					? column.reduce((sum, cell) => sum + credits(worth(cell), round), 0)
					: 0;
				f.lettersLit[reel] = true;
				events.push({
					event: 'columnComplete',
					context: {
						reel,
						letter: letters[reel] ?? '',
						newlyLit: !already,
						cleared: boardEnd.clearOnComplete,
						value,
						amount,
						cells: column.map((cell, row) => ({
							...cellInfo(reel, row, cell),
							amount: credits(worth(cell), round),
						})),
					},
				});
				if (boardEnd.clearOnComplete) {
					column.forEach((cell, row) => {
						if (cell.kind === 'jackpot') {
							jackpotWin(
								events,
								round,
								cell.jackpot,
								'column',
								false,
								{ reel, row },
								cell.factor ?? 1,
							);
						}
						column[row] = null;
					});
					bank(round, amount);
				}
			});
			if (!f.lettersJackpot && f.lettersLit.every(Boolean)) {
				f.lettersJackpot = true;
				bank(round, jackpotWin(events, round, boardEnd.jackpot, 'letters', true));
				return true;
			}
		}
		const full = f.board.every((column) => column.every((cell) => cell !== null));
		// An expanding board is full only once every row of `maxRows` is open and held.
		const fullAtMax = full && (!expansion || f.rows === expansion.maxRows);
		if (boardEnd.type === 'fullBoardJackpot' && fullAtMax) {
			const counts = f.board.every((column) =>
				column.every((cell) => rolesOf(cell).some((r) => list(boardEnd.roles).includes(r))),
			);
			if (counts) {
				bank(round, jackpotWin(events, round, boardEnd.jackpot, 'fullBoard', true));
				return true;
			}
		}
		// Nothing more can land on a full board, whatever the board-end rule.
		return full;
	};

	/**
	 * End the feature: `atEnd` collectors gather, then every held cell with a worth is tallied into
	 * the total alongside what was banked on the way. Closes the round's feature, not the round —
	 * the `collect` does that.
	 */
	const finishFeature = (events, round) => {
		const f = round.feature;
		if (specialsCfg.collector?.collects === 'atEnd') {
			const collectors = cellsWhere(f.board, (cell) => cell?.kind === 'collector');
			if (collectors.length) collect(events, round, collectors);
		}
		const held = cellsWhere(f.board, (cell) => worth(cell) > 0);
		const tally = held.map(({ reel, row, cell }) => ({
			...cellInfo(reel, row, cell),
			amount: credits(worth(cell), round),
		}));
		for (const { reel, row, cell } of held) {
			if (cell.kind === 'jackpot') {
				jackpotWin(events, round, cell.jackpot, 'coin', false, { reel, row }, cell.factor ?? 1);
			}
		}
		const total = f.banked + tally.reduce((sum, t) => sum + t.amount, 0);
		events.push({
			event: 'holdAndWinEnd',
			context: {
				cells: tally,
				banked: f.banked,
				total,
				...tagged,
			},
		});
		// The queued mode has nothing of its own to play, so it closes as soon as it starts. `total` is
		// in credits, like every amount on this wire.
		if (round.force?.queuedMode) {
			events.push({ event: 'modeExit', context: { mode: round.force.queuedMode, total: 0 } });
		}
		f.total = total;
		f.ended = true;
		round.win += total;
		events.push({ event: 'playedBonusSpins', context: bonusSnapshot(round) });
		events.push({ event: 'gameEnd', context: { win: round.win } });
	};

	/**
	 * Enter the feature from a triggering base board. `cause` is what started it; `meterIds` the
	 * full meters it consumes (their levels reset to 0 here); `activates` the specials those meters
	 * turn on when they are not this block's own (an overlay's pots).
	 */
	const startFeature = (events, round, session, board, cause, meterIds, activates = []) => {
		const force = round.force ?? {};
		const f = {
			board: emptyBoard(),
			// The counter's cap — what a reset fills back to. An add-respins that `raisesCap` raises it.
			start: respinRules.start,
			left: respinRules.start,
			played: 0,
			banked: 0,
			active: new Set(list(block.activeModifiers?.atEntry)),
			collectorLevel: specialsCfg.collector?.level ?? 1,
			coinBoost: 1,
			lettersLit: Array.from({ length: reelCount }, () => false),
			lettersJackpot: false,
			queue: [],
			boosted: false,
			ended: false,
			mode,
			...(expansion
				? { rows: rowHeights[0], unlocksLeft: force.unlockRows ?? 0, fillAll: force.expandFull }
				: {}),
		};
		round.feature = f;
		const streak = stickiness === 'collectorsOnly';
		eachCell(board, (cell, reel, row) => {
			if (!cell) return;
			const hold = streak
				? cell.kind === 'collector' || cell.kind === 'coin' || cell.kind === 'jackpot'
				: cell.kind === 'coin' || cell.kind === 'jackpot';
			if (hold) f.board[reel][row] = { ...cell };
			const kind = kindOfSymbol(cell.symbol);
			if (kind && block.activeModifiers?.fromTriggeringSpecials) f.active.add(kind);
		});
		for (const id of meterIds) {
			const meter = meters.find((m) => m.id === id);
			if (meter) f.active.add(meter.activates);
			session.meters[id] = 0;
		}
		for (const kind of activates) f.active.add(kind);
		if (cause === 'buy' && round.buyTier) {
			f.boosted = round.buyTier.boostedSpecials === true;
			for (const g of list(round.buyTier.guaranteed)) {
				const kind = ROLE_SPECIAL[g.role];
				if (kind) f.active.add(kind);
				for (let i = 0; i < g.count; i++) f.queue.push({ role: g.role });
			}
		}
		for (const kind of force.specials ?? []) f.active.add(kind);
		if (force.mystery) f.active.add('mystery');
		if (force.unlock) f.active.delete(force.unlock);
		for (const kind of [...f.active]) if (!specialSymbol[kind]) f.active.delete(kind);

		const held = cellsWhere(f.board, (cell) => cell !== null);
		events.push({
			event: 'spinTrigger',
			context: {
				spins: [{ prob: 1, spins: respinRules.start }],
				occurs: countMatches(board) || held.length,
				bonus: bonusKey,
				trigger: {
					occurs: [trigger.count?.min ?? 1],
					of: coinSymbol,
					mode,
					from: '',
				},
				cause,
				...tagged,
			},
		});
		events.push({
			event: 'holdAndWinTrigger',
			context: {
				cause,
				...(meterIds.length ? { meters: meterIds } : {}),
				cells: held.map(({ reel, row, cell }) => cellInfo(reel, row, cell)),
				respins: respinRules.start,
				stickiness,
				activeModifiers: [...f.active],
				...(expansion ? { expansion: { rows: f.rows, maxRows: expansion.maxRows } } : {}),
				...tagged,
			},
		});
		// A second mode in the same round is announced explicitly. Queued: it starts once the feature
		// has ended (the wheel is part of the Hold and Win entry, never a mode of its own).
		if (force.queuedMode) {
			events.push({
				event: 'modeEnter',
				context: { mode: force.queuedMode, cause: 'forced', policy: 'queue' },
			});
		}

		// The pre-feature wheel.
		const prizes = list(block.wheel?.prizes);
		if (prizes.length) {
			const index = force.wheel ?? prizes.indexOf(weighted(prizes));
			const prize = prizes[index];
			const context = { index, prize: { ...prize } };
			delete context.prize.weight;
			events.push({ event: 'holdAndWinWheel', context });
			if (prize.type === 'coinBoost') {
				f.coinBoost = prize.multiplier;
				const cells = cellsWhere(f.board, (cell) => cell?.kind === 'coin').map(
					({ reel, row, cell }) => {
						const from = cell.value;
						cell.value = tidy(from * prize.multiplier);
						return { reel, row, from, to: cell.value };
					},
				);
				events.push({
					event: 'coinBoost',
					context: { source: 'wheel', multiplier: prize.multiplier, cells },
				});
			} else if (prize.type === 'extraCollect') {
				const max = specialsCfg.collector?.maxLevel ?? f.collectorLevel;
				f.collectorLevel = Math.min(max, f.collectorLevel + prize.count);
				f.active.add('collector');
			} else if (prize.type === 'jackpot') {
				bank(round, jackpotWin(events, round, prize.jackpot, 'wheel', true));
			}
		}

		// A streak game's triggering coins go straight into its collectors, then leave the board.
		if (streak) {
			const collectors = cellsWhere(f.board, (cell) => cell?.kind === 'collector');
			if (collectors.length && specialsCfg.collector?.collects !== 'atEnd')
				collect(events, round, collectors);
			clearNonCollectors(events, round);
		}

		events.push({ event: 'enterBonus', context: bonusSnapshot(round) });
		if (checkBoardEnd(events, round)) finishFeature(events, round);
	};

	const besides = (reel, row) => (r, w) =>
		Math.abs(r - reel) <= 1 && Math.abs(w - row) <= 1 && (r !== reel || w !== row);

	/**
	 * An upgrade at `reel,row` applies `target`: `all` / `adjacent` raise the held cash coins (all of
	 * them / the 8 around it) by `step`; `jackpotTier` steps ONE jackpot coin a tier up — the lowest
	 * tier below the top (ties: lowest reel, then row), its factor kept. Returns the wire's changes.
	 */
	const upgradeCoins = (board, reel, row, target, step) => {
		const cells = [];
		if (target === 'jackpotTier') {
			let lowest = null;
			eachCell(board, (cell, r, w) => {
				if (cell?.kind !== 'jackpot') return;
				const at = jackpotLadder.indexOf(cell.jackpot);
				if (at < 0 || at >= jackpotLadder.length - 1) return;
				if (!lowest || at < lowest.at) lowest = { at, cell, reel: r, row: w };
			});
			if (lowest) {
				const from = lowest.cell.jackpot;
				lowest.cell.jackpot = jackpotLadder[lowest.at + 1];
				cells.push({
					reel: lowest.reel,
					row: lowest.row,
					jackpot: lowest.cell.jackpot,
					fromJackpot: from,
				});
			}
			return cells;
		}
		const near = besides(reel, row);
		eachCell(board, (cell, r, w) => {
			if (cell?.kind !== 'coin' || (target === 'adjacent' && !near(r, w))) return;
			const from = cell.value;
			cell.value = tidy(from + step);
			cells.push({ reel: r, row: w, from, to: cell.value });
		});
		return cells;
	};

	// ---- board expansion (11b) ----
	const unlockCell = () => ({ symbol: unlockSymbol, kind: 'unlock' });
	const unlockLandsOn = (f, reel) =>
		Boolean(unlockSymbol) &&
		f.rows < expansion.maxRows &&
		(!expansion.unlockReels || expansion.unlockReels.includes(reel));
	const heldCount = (f) => cellsWhere(f.board, (cell) => cell !== null).length;
	/** The rows the board's state opens now: `fullRow` once the bottom open row is held whole,
	 *  `coinCount` while the held count reaches the next threshold. */
	const rowsEarned = (f) => {
		let rows = f.rows;
		if (expansion.rule === 'fullRow') {
			if (rows < expansion.maxRows && f.board.every((column) => column[rows - 1] !== null))
				rows += 1;
		} else if (expansion.rule === 'coinCount') {
			const held = heldCount(f);
			while (
				rows < expansion.maxRows &&
				held >= (expansion.thresholds[rows - expansion.startRows] ?? Infinity)
			)
				rows += 1;
		}
		return rows;
	};
	/**
	 * A forced unlock (`unlock:<n>` / `expandFull`): make the game's rule open the next row on this
	 * respin; once nothing is left to open, `expandFull` fills the whole expanded board.
	 */
	const forceExpansion = (f, place, empties) => {
		if (f.rows >= expansion.maxRows || f.unlocksLeft <= 0) {
			for (const { reel, row } of empties()) place(reel, row, drawCash(reel, f.coinBoost));
			f.fillAll = false;
			return;
		}
		const free = empties();
		if (expansion.rule === 'fullRow') {
			for (const { reel, row } of free)
				if (row === f.rows - 1) place(reel, row, drawCash(reel, f.coinBoost));
		} else if (expansion.rule === 'coinCount') {
			const need = (expansion.thresholds[f.rows - expansion.startRows] ?? 0) - heldCount(f);
			for (const { reel, row } of free.slice(0, Math.max(0, need)))
				place(reel, row, drawCash(reel, f.coinBoost));
		} else {
			const spot = free.find(({ reel }) => unlockLandsOn(f, reel)) ?? free[0];
			if (spot) place(spot.reel, spot.row, unlockCell());
		}
	};
	/**
	 * Open the rows this respin earned — each unlock symbol that landed opens one (then clears, an
	 * `applied` clear), else the rule's own condition. One `rowsUnlocked`, then every row jackpot
	 * reached. Returns whether a row opened.
	 */
	const expand = (events, round, landed) => {
		const f = round.feature;
		const from = f.rows;
		const unlockers = landed.filter(({ cell }) => cell.kind === 'unlock');
		const rows =
			expansion.rule === 'unlockSymbol'
				? Math.min(expansion.maxRows, from + unlockers.length)
				: rowsEarned(f);
		const stillHeld = unlockers.filter(({ reel, row }) => f.board[reel][row]?.kind === 'unlock');
		for (const { reel, row } of stillHeld) f.board[reel][row] = null;
		const cleared = () => {
			if (!stillHeld.length) return;
			events.push({
				event: 'cellsCleared',
				context: { reason: 'applied', cells: stillHeld.map(({ reel, row }) => ({ reel, row })) },
			});
		};
		if (rows === from) {
			cleared();
			return false;
		}
		for (let r = from; r < rows; r++) for (const column of f.board) column.push(null);
		f.rows = rows;
		if (f.unlocksLeft > 0) f.unlocksLeft = Math.max(0, f.unlocksLeft - (rows - from));
		events.push({
			event: 'rowsUnlocked',
			context: {
				from,
				rows,
				cause: expansion.rule,
				unlockers: unlockers.map(({ reel, row, cell }) => cellInfo(reel, row, cell)),
			},
		});
		cleared();
		for (const rj of expansion.rowJackpots) {
			if (rj.rows > from && rj.rows <= rows)
				bank(round, jackpotWin(events, round, rj.jackpot, 'row', true));
		}
		return true;
	};

	/** What lands on the empty cells this respin, forced items first. Returns `[{reel,row,cell}]`. */
	const landRespin = (round) => {
		const f = round.feature;
		const force = round.force ?? {};
		const first = f.played === 1;
		const empties = () => cellsWhere(f.board, (cell) => cell === null);
		const landed = [];
		const place = (reel, row, cell) => {
			if (!cell) return;
			f.board[reel][row] = cell;
			landed.push({ reel, row, cell });
		};
		/** The first empty cell `make(reel)` can fill (else any empty cell, forced over the reel rule). */
		const placeSomewhere = (make, anyReel = true) => {
			const free = empties();
			for (const { reel, row } of free) {
				const cell = make(reel, false);
				if (cell) return place(reel, row, cell);
			}
			if (anyReel && free.length) place(free[0].reel, free[0].row, make(free[0].reel, true));
		};
		const forcedSpecial = (kind) => (reel, anywhere) =>
			anywhere || specialLandsOn(kind, reel) ? specialCell(kind) : null;
		const forcedCoin = (reel, anywhere) =>
			anywhere || coinEntriesOn(reel).some((c) => c.kind === 'cash')
				? drawCash(reel, f.coinBoost)
				: null;

		if (force.dead) return landed;

		// A bought tier's guarantees: one per respin until spent.
		if (f.queue.length) {
			const { role } = f.queue.shift();
			const kind = ROLE_SPECIAL[role];
			placeSomewhere(
				kind
					? forcedSpecial(kind)
					: role === 'jackpot'
						? (reel) => cellForRole('jackpot', reel) ?? drawCoin(reel, f.coinBoost)
						: forcedCoin,
			);
		}
		/** A forced upgrade, with something to upgrade under its rule. The rule rides the forced cell,
		 *  so it can never leak onto a later upgrade that lands naturally. */
		const placeUpgrade = () => {
			const rule = force.upgradeTarget;
			const upgradeCell = (reel, anywhere) => {
				const cell = forcedSpecial('upgrade')(reel, anywhere);
				if (cell && rule) cell.forcedRule = rule;
				return cell;
			};
			if (rule === 'jackpotTier') {
				const tier = jackpotLadder[0];
				placeSomewhere((reel, anywhere) =>
					anywhere || coinEntriesOn(reel).length
						? { symbol: jackpotSymbol, kind: 'jackpot', jackpot: tier, factor: 1 }
						: null,
				);
			}
			if (rule !== 'all' && rule !== 'adjacent') return placeSomewhere(upgradeCell);
			const cashBeside = (reel, row) =>
				cellsWhere(f.board, (cell, r, w) => cell?.kind === 'coin' && besides(reel, row)(r, w))
					.length > 0;
			const emptyBeside = (reel, row) =>
				cellsWhere(f.board, (cell, r, w) => cell === null && besides(reel, row)(r, w)).length > 0;
			if (!empties().some(({ reel, row }) => cashBeside(reel, row))) {
				const spot = empties().find(({ reel, row }) => emptyBeside(reel, row));
				if (spot) place(spot.reel, spot.row, drawCash(spot.reel, f.coinBoost));
			}
			const spots = empties().filter(({ reel, row }) => cashBeside(reel, row));
			const spot = spots.find(({ reel }) => specialLandsOn('upgrade', reel)) ?? spots[0];
			if (spot) place(spot.reel, spot.row, upgradeCell(spot.reel, true));
			else placeSomewhere(upgradeCell);
		};

		if (first) {
			for (const kind of force.specials ?? []) {
				if (kind === 'upgrade') placeUpgrade();
				else placeSomewhere(forcedSpecial(kind));
			}
			if (force.mystery) {
				placeSomewhere(forcedSpecial('mystery'));
				f.forcedReveal = force.mystery;
			}
			for (const tier of force.jackpots ?? []) {
				placeSomewhere((reel, anywhere) =>
					anywhere || coinEntriesOn(reel).length
						? { symbol: jackpotSymbol, kind: 'jackpot', jackpot: tier, factor: 1 }
						: null,
				);
			}
			if (force.letter) {
				const reel = f.lettersLit.findIndex((lit, r) => !lit && f.board[r].some((c) => c === null));
				if (reel >= 0) {
					f.board[reel].forEach((cell, row) => {
						if (cell === null) place(reel, row, drawCash(reel, f.coinBoost));
					});
				}
			}
			if (force.letters || force.fullBoard) {
				for (const { reel, row } of empties()) place(reel, row, drawCash(reel, f.coinBoost));
			}
		}
		if (expansion && (f.unlocksLeft > 0 || f.fillAll)) {
			forceExpansion(f, place, empties);
			return landed;
		}
		if (force.chain) {
			const clears =
				stickiness === 'collectorsOnly' ||
				(boardEnd.type === 'columnLetters' && boardEnd.clearOnComplete);
			const room = clears ? f.played <= CLEARING_CHAIN_LENGTH : empties().length >= 2;
			if (!landed.length && room) placeSomewhere(forcedCoin, false);
			return landed;
		}
		if (
			first &&
			(force.specials?.length || force.mystery || force.jackpots?.length || force.letter)
		) {
			return landed;
		}

		const share = Math.min(0.8, RESPIN_SPECIAL_SHARE * (f.boosted ? 2 : 1));
		for (const { reel, row } of empties()) {
			if (rand() >= RESPIN_LAND_RATE) continue;
			const kinds = [...f.active].filter((kind) => specialLandsOn(kind, reel));
			if (expansion && unlockLandsOn(f, reel)) kinds.push('unlock');
			if (kinds.length && rand() < share) {
				const kind = pick(kinds);
				place(reel, row, kind === 'unlock' ? unlockCell() : specialCell(kind));
			} else if (coinEntriesOn(reel).length) place(reel, row, drawCoin(reel, f.coinBoost));
		}
		return landed;
	};

	const playRespin = (events, round) => {
		const f = round.feature;
		f.played += 1;
		const landed = landRespin(round);
		events.push({ event: 'playedSpin', context: boardStrings(f.board) });
		if (landed.length) {
			events.push({
				event: 'coinsLand',
				context: { cells: landed.map(({ reel, row, cell }) => cellInfo(reel, row, cell)) },
			});
		}

		// Specials that landed now apply, kind by kind in the authored order.
		const fresh = landed.filter(({ cell }) => SPECIALS.includes(cell.kind));
		const revealedCoins = [];
		for (const kind of applyOrder) {
			const mine = fresh.filter(({ cell }) => cell.kind === kind);
			if (kind === 'collector' && stickiness === 'collectorsOnly') {
				const collectors = cellsWhere(f.board, (cell) => cell?.kind === 'collector');
				if (collectors.length && specialsCfg.collector?.collects !== 'atEnd')
					collect(events, round, collectors);
				continue;
			}
			if (!mine.length) continue;
			if (kind === 'mystery') {
				const cfg = specialsCfg.mystery;
				const reveals = [];
				const activates = [];
				for (const entry of mine) {
					const { reel, row } = entry;
					const reveal = f.forcedReveal ??
						weighted(
							list(cfg.reveals).filter((r) => r.type !== 'special' || specialSymbol[r.special]),
						) ?? { type: 'coin' };
					f.forcedReveal = undefined;
					let cell;
					if (reveal.type === 'special') {
						cell = specialCell(reveal.special);
						if (!f.active.has(reveal.special) && cfg.unlocksInactive) {
							f.active.add(reveal.special);
							activates.push(reveal.special);
						}
						fresh.push({ reel, row, cell });
					} else if (reveal.type === 'jackpot') {
						cell = { symbol: jackpotSymbol, kind: 'jackpot', jackpot: reveal.jackpot, factor: 1 };
						revealedCoins.push(cell);
					} else {
						cell = drawCash(reel, f.coinBoost);
						revealedCoins.push(cell);
					}
					f.board[reel][row] = cell;
					reveals.push({
						...cellInfo(reel, row, cell),
						becomes: reveal.type === 'special' ? reveal.special : reveal.type,
					});
				}
				events.push({ event: 'mysteryReveal', context: { cells: reveals, activates } });
			} else if (kind === 'payer') {
				for (const { reel, row, cell: payer } of mine) {
					const cells = cellsWhere(f.board, (cell) => cell?.kind === 'coin').map(
						({ reel: r, row: w, cell }) => {
							const from = cell.value;
							cell.value = tidy(from + payer.value);
							return { reel: r, row: w, from, to: cell.value };
						},
					);
					events.push({
						event: 'coinPay',
						context: { payer: { reel, row, symbol: payer.symbol }, value: payer.value, cells },
					});
				}
			} else if (kind === 'multiplier') {
				const cfg = specialsCfg.multiplier;
				for (const { reel, row, cell: booster } of mine) {
					const cells = [];
					eachCell(f.board, (cell, r, w) => {
						if (cell?.kind === 'coin') {
							const from = cell.value;
							cell.value = tidy(from * booster.value);
							cells.push({ reel: r, row: w, from, to: cell.value });
						} else if (cell?.kind === 'jackpot' && cfg.multipliesJackpots) {
							const from = cell.factor ?? 1;
							cell.factor = tidy(from * booster.value);
							cells.push({ reel: r, row: w, jackpot: cell.jackpot, from, to: cell.factor });
						}
					});
					events.push({
						event: 'coinBoost',
						context: {
							source: 'special',
							booster: { reel, row, symbol: booster.symbol },
							multiplier: booster.value,
							cells,
						},
					});
					if (cfg.leaveBehind?.type === 'becomesCoin') {
						const value = weighted(list(cfg.leaveBehind.values))?.value ?? 1;
						const coin = { symbol: coinSymbol, kind: 'coin', value: tidy(value) };
						f.board[reel][row] = coin;
						events.push({
							event: 'specialBecomesCoin',
							context: { reel, row, from: booster.symbol, symbol: coinSymbol, value: coin.value },
						});
					}
				}
			} else if (kind === 'collector') {
				if (specialsCfg.collector?.collects !== 'atEnd') collect(events, round, mine);
			} else if (kind === 'addRespins') {
				const cfg = specialsCfg.addRespins;
				for (const { reel, row, cell } of mine) {
					const added = Math.max(0, Math.round(cell.value ?? 0));
					f.left += added;
					if (cfg.raisesCap) f.start += added;
					events.push({
						event: 'respinsAdded',
						context: { cell: cellInfo(reel, row, cell), added, left: f.left, total: f.start },
					});
					if (!cfg.sticky) {
						f.board[reel][row] = null;
						events.push({
							event: 'cellsCleared',
							context: { reason: 'applied', cells: [{ reel, row }] },
						});
					}
				}
			} else if (kind === 'upgrade') {
				for (const { reel, row, cell: upgrader } of mine) {
					const target = upgrader.forcedRule ?? weighted(upgradeTargets)?.target ?? 'all';
					delete upgrader.forcedRule;

					events.push({
						event: 'coinUpgrade',
						context: {
							upgrader: cellInfo(reel, row, upgrader),
							target,
							step: target === 'jackpotTier' ? 0 : (upgrader.value ?? 0),
							cells: upgradeCoins(f.board, reel, row, target, upgrader.value ?? 0),
						},
					});
				}
			}
		}
		// Rows open before a streak sweeps the board, so an unlock symbol leaves as `applied` and a
		// held-count threshold counts what this respin landed.
		const unlocked = expansion ? expand(events, round, landed) : false;
		if (stickiness === 'collectorsOnly') clearNonCollectors(events, round);

		// The counter: reset by what LANDED (a mystery counts as what it revealed), or by an unlock.
		const newCoins =
			landed.some(({ cell }) => cell.kind === 'coin' || cell.kind === 'jackpot') ||
			revealedCoins.length > 0;
		const reset =
			(respinRules.reset === 'anySpecial' ? landed.length > 0 : newCoins) ||
			(unlocked && expansion.resetsRespins);
		// A reset never throws away respins an add-respins put above the cap.
		f.left = reset ? Math.max(f.start, f.left) : f.left - 1;
		const update = { left: f.left, played: f.played, start: f.start, reset };
		events.push({ event: 'respinUpdate', context: update });

		const ended =
			checkBoardEnd(events, round) ||
			f.left <= 0 ||
			(respinRules.cap !== undefined && f.played >= respinRules.cap) ||
			f.played >= MAX_RESPINS;
		// The board-end events follow the counter on the wire, so the respin that ENDS the feature (a
		// full board, the last letter, the cap) restates its counter here: nothing left, no reset —
		// the same `left` its closing snapshot carries.
		if (ended) {
			f.left = 0;
			update.left = 0;
			update.reset = false;
		}
		events.push({ event: 'playedBonusSpin', context: bonusSnapshot(round) });
		if (ended) finishFeature(events, round);
	};

	/** Base-game instant collect: a collector or multiplier that pays the coins beside it at once. */
	const instantCollect = (events, round, board) => {
		const specials = cellsWhere(
			board,
			(cell) =>
				cell &&
				(cell.kind === 'collector' || cell.kind === 'multiplier') &&
				specialsCfg[cell.kind]?.instantCollectInBaseGame,
		);
		const coins = cellsWhere(board, (cell) => cell?.kind === 'coin' || cell?.kind === 'jackpot');
		if (!specials.length || !coins.length) return 0;
		const multipliers = specials.filter(({ cell }) => cell.kind === 'multiplier');
		const collectors = specials.filter(({ cell }) => cell.kind === 'collector');
		const factor = multipliers.reduce((p, { cell }) => p * cell.value, 1);
		const multipliesJackpots = specialsCfg.multiplier?.multipliesJackpots === true;
		const level = specialsCfg.collector?.level ?? 1;
		const times = collectors.length ? collectors.length * level : 1;
		const scaled = coins.map(({ reel, row, cell }) => ({
			reel,
			row,
			cell:
				cell.kind === 'coin'
					? { ...cell, value: tidy(cell.value * factor) }
					: { ...cell, factor: tidy((cell.factor ?? 1) * (multipliesJackpots ? factor : 1)) },
		}));
		const cells = scaled.map(({ reel, row, cell }) => ({
			...cellInfo(reel, row, cell),
			amount: credits(worth(cell), round),
		}));
		const amount = times * cells.reduce((sum, c) => sum + c.amount, 0);
		events.push({
			event: 'coinInstantCollect',
			context: {
				specials: specials.map(({ reel, row, cell }) => cellInfo(reel, row, cell)),
				multiplier: tidy(factor),
				times,
				cells,
				amount,
			},
		});
		for (const { reel, row, cell } of scaled) {
			if (cell.kind === 'jackpot') {
				jackpotWin(
					events,
					round,
					cell.jackpot,
					'instantCollect',
					false,
					{ reel, row },
					(cell.factor ?? 1) * times,
				);
			}
		}
		return amount;
	};

	const playBase = (events, round, session, context) => {
		const force = round.force ?? {};
		const lucky =
			trigger.luckySpin === true &&
			(force.trigger === 'luckySpin' ||
				(!force.trigger && !force.instant && !round.isBuy && rand() < LUCKY_SPIN_RATE));
		const metre =
			Boolean(trigger.randomMetre) &&
			!lucky &&
			(force.trigger === 'randomMetre' ||
				(!force.trigger && !force.instant && !round.isBuy && rand() < RANDOM_METRE_RATE));
		const board = dealBase();

		// A forced full meter: one short, and its symbol on the board to fill it.
		let forcedMeter = null;
		if (force.trigger === 'meter') {
			forcedMeter = meters.find((m) => m.id === force.meter) ?? meters[0];
			session.meters[forcedMeter.id] = forcedMeter.maxLevel - 1;
			const reel = Math.floor(rand() * reelCount);
			const row = Math.floor(rand() * rowHeights[reel]);
			const kind = kindOfSymbol(forcedMeter.symbol);
			board[reel][row] = kind ? specialCell(kind) : { symbol: forcedMeter.symbol, kind: 'meter' };
		}
		// An unlock needs the special NOT active: keep it off the triggering board.
		if (force.unlock && block.activeModifiers?.fromTriggeringSpecials) {
			eachCell(board, (cell, reel, row) => {
				if (cell?.kind === force.unlock) board[reel][row] = lineCell();
			});
		}
		const keepMeter = (reel, row) => forcedMeter && board[reel][row]?.symbol === forcedMeter.symbol;
		let metreCells = [];
		if (round.isBuy || lucky || ['any', 'count', 'pattern'].includes(force.trigger)) {
			satisfyTrigger(board, keepMeter);
		} else if (metre) {
			metreCells = satisfyTrigger(board, keepMeter);
		}
		if (force.instant) {
			// A clean instant collect: one instant special and up to two coins, none of which may
			// complete a trigger (Hotfire's coin–collector–coin IS its trigger pattern).
			const kind = SPECIALS.find(
				(k) => specialsCfg[k]?.instantCollectInBaseGame && specialSymbol[k],
			);
			eachCell(board, (cell, reel, row) => {
				if (cell && cell.kind !== 'line') board[reel][row] = lineCell();
			});
			const reelFor = (test) => [...Array(reelCount).keys()].find(test) ?? 0;
			const specialReel = reelFor((r) => specialLandsOn(kind, r));
			board[specialReel][0] = specialCell(kind);
			let placed = 0;
			for (let r = 0; r < reelCount && placed < 2; r++) {
				if (r === specialReel || !coinEntriesOn(r, baseCoins).some((c) => c.kind === 'cash'))
					continue;
				const was = board[r][0];
				board[r][0] = drawCash(r, 1, baseCoins);
				if (countTriggered(board) || patternTriggered(board)) board[r][0] = was;
				else placed++;
			}
		}

		events.push({
			event: 'spinStart',
			context: {
				symbols: names,
				symbolsPay: { line: lineSymbols, scatter: [] },
				wildSymbols: wildName ? [wildName] : [],
				lineAlign: 'left',
				lineCoinciding: false,
			},
		});
		if (lucky) events.push({ event: 'luckySpin', context: {} });

		const wins = evaluateLines(board, round);
		for (const w of wins) {
			events.push({ event: 'spinWin', context: w });
			round.win += w.pay;
		}
		events.push({ event: 'playedSpin', context: boardStrings(board) });

		// Meters fill from what landed.
		const full = [];
		for (const meter of meters) {
			const from = cellsWhere(board, (cell) => cell?.symbol === meter.symbol);
			if (!from.length) continue;
			const level = Math.min(meter.maxLevel, session.meters[meter.id] + from.length);
			session.meters[meter.id] = level;
			const isFull = level >= meter.maxLevel;
			if (isFull) full.push(meter.id);
			events.push({
				event: 'meterUpdate',
				context: {
					meter: meter.id,
					level,
					max: meter.maxLevel,
					full: isFull,
					from: from.map(({ reel, row, cell }) => ({ reel, row, symbol: cell.symbol })),
					// A forced full meter was set one short first, so this level is not the last one plus
					// `from` — say so rather than have a reader think the arithmetic broke.
					...(forcedMeter?.id === meter.id ? { forced: true } : {}),
				},
			});
		}

		const cause = round.isBuy
			? 'buy'
			: lucky
				? 'luckySpin'
				: full.length
					? 'meter'
					: metre
						? 'randomMetre'
						: countTriggered(board)
							? 'count'
							: patternTriggered(board)
								? 'pattern'
								: force.trigger === 'any'
									? primaryCause
									: null;

		if (metre) {
			events.push({
				event: 'randomMetreTrigger',
				context: {
					name: trigger.randomMetre.name,
					cells: metreCells.map(({ reel, row, cell }) => cellInfo(reel, row, cell)),
				},
			});
		}

		if (cause) {
			// Another respin mode's route starts that mode's engine on this board, consuming only the
			// meters it owns (`setRouter`).
			const routed = router?.(cause, round, full);
			if (routed?.engine)
				routed.engine.startFeature(events, round, session, board, cause, routed.meterIds);
			else startFeature(events, round, session, board, cause, routed?.meterIds ?? full);
			return;
		}

		round.win += instantCollect(events, round, board);
		events.push({ event: 'gameEnd', context: { win: round.win } });
		const explicitAutoCollect = context === '' || context === undefined;
		if (explicitAutoCollect || round.win === 0) {
			session.balance += round.win;
			events.push({ event: 'gameRoundOver', context: { win: round.win } });
			round.closed = true;
		}
	};

	/**
	 * One spin of line symbols on this game's board, its line wins paid under bonus `bonus`: the
	 * approximate free spin a Hold and Win base plays when a bonus sends it into free spins (bonus-games
	 * Phase 7a). Same events as the lines mock's free spin; no coin, special or meter lands.
	 */
	const playSpin = (events, round, bonus) => {
		const board = rowHeights.map((rows) => Array.from({ length: rows }, lineCell));
		events.push({
			event: 'spinStart',
			context: {
				symbols: names,
				symbolsPay: { line: lineSymbols, scatter: [] },
				wildSymbols: wildName ? [wildName] : [],
				lineAlign: 'left',
				lineCoinciding: false,
			},
		});
		for (const w of evaluateLines(board, round)) {
			events.push({ event: 'bonusWin', context: { bonus, pay: w.pay, isSpinWin: true } });
			events.push({ event: 'spinWin', context: w });
			round.win += w.pay;
		}
		events.push({ event: 'playedSpin', context: boardStrings(board) });
	};

	/** `(cause, round, meterIds) → { engine?, meterIds }` — which respin mode a base-game cause starts
	 *  (`engine`, absent for this one) and which of the full meters it consumes: the Hold and Win game
	 *  mock's routes to its other modes. */
	let router = null;
	const setRouter = (fn) => {
		router = fn;
	};

	return {
		mode,
		bonus: bonusKey,
		rand,
		setRouter,
		list,
		trigger,
		patternTriggered,
		meters,
		progressiveTiers,
		wonProgressive,
		setLivePools,
		paylines,
		betTable,
		drawCoin,
		drawBaseCoin,
		cellInfo,
		emptyBoard,
		parseForce,
		configContext,
		holdAndWinConfig,
		featureState,
		startFeature,
		playRespin,
		playBase,
		playSpin,
	};
}
