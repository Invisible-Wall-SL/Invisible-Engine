/**
 * Mock Play4Fun RGS server — HOLD AND WIN variant (docs/design/hold-and-win.md, Phase 3).
 *
 * ⚠️ THE WIRE IS OURS. The partner has not shown us a Hold and Win round, so every Hold and Win
 * event here is invented and documented as a SWAP SEAM in docs/reference/hold-and-win-wire.md. It
 * is rewritten when the partner delivers their format (Phase 10); nothing above the facade may
 * depend on it. What IS the partner's: the transport, `seq` as a position, the stored-action replay,
 * resume through the boot `config`, and the respin feature as partner-shaped free spins — one
 * context-less `play` per respin between `enterBonus` and `gameEnd`, counted by `playedBonusSpin`.
 *
 * The game is decided ONLY by the project's Game Config, as the launcher hands it over
 * (`holdAndWinMockInputs` in packages/game-config): the `holdAndWin` block, the symbol dictionary's
 * roles and line pays, the paylines and the bet modes. The base game pays lines through the lines
 * mock's own evaluator. Draw RATES (how often a coin lands) are this mock's pacing, not math — the
 * config's weights pick WHICH value lands, never how often something does.
 *
 * Symbols travel under the config's own names (`H1`, `BONUS`, `BOOST` …), and a cell that carries a
 * value carries it after a colon: `BONUS:1.5` (× the base total stake), `JACKPOT:MINI`,
 * `JACKPOT:MINI*2` (a jackpot a multiplier doubled), `BOOST:4`, `MULTI:3`, `COLLECT:12.5`.
 *
 * Forced outcomes: a force spec (see `parseForce`) arrives as `play.context = "force:<spec>"`, as
 * `POST …/force?sid=<sid>&beat=<spec>` (held for that session's next round — how a playtest reaches
 * it from a live client), or as `opts.force` / `FORCE=<spec>` for every round.
 *
 * CLI (the presets are TypeScript, so through the repo's loader):
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs scripts/mock-rgs-server-holdandwin.mjs
 *   PORT=7799 · PRESET=pots|classic|collector|pots-progressive (a test fixture) · SEED=…
 *   START_BALANCE=10000 · FORCE=<spec>
 */

import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

import { evaluatePaylines } from './mock-rgs-server.mjs';

/** The bonus key the respin feature is played under — the partner core's `spinTrigger.bonus`. */
export const RESPIN_BONUS = 'respin';

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
const LUCKY_SPIN_RATE = 0.01;
const RANDOM_METRE_RATE = 0.005;
/** A board that clears (a streak, or letters that sweep their column) never fills, so a forced
 *  chain on one needs a length of its own. */
const CLEARING_CHAIN_LENGTH = 10;
/** Runaway guard on one feature — far above any real one (`respins.cap` is the authored limit). */
const MAX_RESPINS = 200;

const SPECIALS = ['collector', 'multiplier', 'payer', 'mystery'];
/** The `special_properties` role each special's symbols carry (game-config `SPECIAL_SYMBOL_ROLE`). */
const SPECIAL_ROLE = {
	collector: 'collector',
	multiplier: 'coinMultiplier',
	payer: 'payer',
	mystery: 'mystery',
};
const ROLE_SPECIAL = Object.fromEntries(Object.entries(SPECIAL_ROLE).map(([k, r]) => [r, k]));

function hashStr(s) {
	let h = 2166136261 >>> 0;
	for (let i = 0; i < s.length; i++) {
		h ^= s.charCodeAt(i);
		h = Math.imul(h, 16777619) >>> 0;
	}
	return h;
}

/** Values are × the base total stake; four decimals keep `1.5 × 3` from reading `4.499999`. */
const tidy = (n) => Number(n.toFixed(4));

const payCents = (amount) => (amount > 0 ? Math.max(1, Math.round(amount)) : 0);

// ---------- pure HTTP plumbing (the book mock's) ----------

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
const pathEndsWith = (pathname, route) => {
	const p = pathname.replace(/\/+$/, '') || '/';
	return p === route || p.endsWith(route);
};
const makeRoundId = () => 'G' + Math.random().toString(36).slice(2, 14);

const refuse = (req, res, session, error, errorCode = 110) =>
	sendJson(req, res, 200, {
		result: 0,
		error,
		errorCode,
		platform: session ? { balance: session.balance } : {},
	});

// ---------- factory ----------

/**
 * @param {{ label?: string, seed?: string, startBalance?: number, quiet?: boolean,
 *   reels?: number, rows?: number, rowsPerReel?: number[], paylines?: number[][],
 *   betModes?: { mode: string, cost: number, kind: 'base' | 'ante' | 'buy' }[],
 *   holdAndWin: { block: object, lineSymbols: string[],
 *     symbols: Record<string, { roles: string[], wild?: true, paytable?: Record<string, number> }> },
 *   force?: string }} opts
 */
export function createMockRgs(opts = {}) {
	const label = opts.label ?? 'mock-hnw';
	/** Whether a client may force outcomes (`play.context` / `…/force`). The test server allows it on
	 *  a runtime game's AUTHORING mock only, never on the one its players use. */
	const allowForce = opts.allowForce !== false;
	const quiet = opts.quiet === true;
	const startBalance = Number(opts.startBalance ?? process.env.START_BALANCE ?? 10_000);
	const seed = opts.seed ?? process.env.SEED;

	const inputs = opts.holdAndWin;
	if (!inputs?.block || !inputs.symbols) {
		throw new Error(`[${label}] a Hold and Win mock needs the project's holdAndWin block`);
	}
	const block = inputs.block;
	const symbols = inputs.symbols;
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
	/** The progressive tiers (`fixed: false`) and their pools' rules, × base total bet. */
	const progressiveTiers = list(block.jackpots)
		.filter((j) => j.fixed === false)
		.map((j) => ({
			name: j.name,
			seed: Number(j.progressive?.seed ?? j.multiplier),
			contribution: Math.max(0, Number(j.progressive?.contribution ?? 0)),
			cap: j.progressive?.cap === undefined ? Infinity : Number(j.progressive.cap),
		}));
	/** The pools of the session being dealt (set per request — one runs at a time), so a jackpot's
	 *  worth anywhere in the deal is the pool as it stands; tiers won in an action reset after it. */
	let livePools = null;
	const wonProgressive = new Set();
	const tierMultiplier = (tier) => livePools?.[tier] ?? jackpotTable[tier] ?? 0;

	const reelCount = Math.max(1, Math.round(Number(opts.reels ?? 5)));
	const rowHeights = Array.from({ length: reelCount }, (_u, reel) => {
		const perReel = Array.isArray(opts.rowsPerReel) ? opts.rowsPerReel[reel] : undefined;
		return Math.max(1, Math.round(Number(perReel ?? opts.rows ?? 3)));
	});
	const rowCount = Math.max(...rowHeights);
	const isStepped = rowHeights.some((r) => r !== rowHeights[0]);
	const paylines = list(opts.paylines);
	if (!paylines.length)
		throw new Error(`[${label}] a Hold and Win base game pays lines — no paylines`);

	// ---- symbols by role ----
	const names = Object.keys(symbols).sort();
	const withRole = (role) => names.filter((n) => list(symbols[n].roles).includes(role));
	const coinSymbol = withRole('coin')[0] ?? withRole('jackpot')[0];
	const jackpotSymbol = withRole('jackpot')[0] ?? coinSymbol;
	const blankSymbol = withRole('blank')[0] ?? 'BLANK';
	const specialSymbol = Object.fromEntries(
		SPECIALS.map((kind) => [kind, specialsCfg[kind] ? withRole(SPECIAL_ROLE[kind])[0] : undefined]),
	);
	const kindOfSymbol = (name) => {
		for (const kind of SPECIALS) if (specialSymbol[kind] === name) return kind;
		return undefined;
	};
	const lineSymbols = list(inputs.lineSymbols).filter((n) => symbols[n]);
	if (!lineSymbols.length) throw new Error(`[${label}] no base-game line symbols`);
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
	const tableFor = (session) => ('betTable' in session ? session.betTable : betTable);

	// ---- RNG ----
	let rngState = seed ? hashStr(seed) : Date.now() >>> 0;
	const rand = () => {
		rngState = (rngState * 1664525 + 1013904223) >>> 0;
		return rngState / 0x100000000;
	};
	const pick = (items) => items[Math.floor(rand() * items.length)];
	const weighted = (items) => {
		const live = items.filter((i) => i.weight > 0);
		const total = live.reduce((s, i) => s + i.weight, 0);
		if (!live.length) return undefined;
		let r = rand() * total;
		for (const item of live) if ((r -= item.weight) <= 0) return item;
		return live[live.length - 1];
	};
	const onReel = (entry, reel) => !entry.reels || entry.reels.includes(reel);

	// ---- cells ----
	/** A cell: `null` (empty/blank) or `{ symbol, kind, value?, jackpot?, factor? }`. */
	const lineCell = () => ({ symbol: pick(lineSymbols), kind: 'line' });
	const coinEntriesOn = (reel) => list(block.coins).filter((c) => onReel(c, reel));
	const coinFromEntry = (entry, boost = 1) =>
		entry.kind === 'jackpot'
			? { symbol: jackpotSymbol, kind: 'jackpot', jackpot: entry.jackpot, factor: 1 }
			: { symbol: coinSymbol, kind: 'coin', value: tidy(entry.value * boost) };
	const drawCoin = (reel, boost = 1) => {
		const entry = weighted(coinEntriesOn(reel)) ?? weighted(list(block.coins));
		return entry ? coinFromEntry(entry, boost) : null;
	};
	const drawCash = (reel, boost = 1) => {
		const cash = list(block.coins).filter((c) => c.kind === 'cash');
		const entry = weighted(cash.filter((c) => onReel(c, reel))) ?? weighted(cash);
		return entry ? coinFromEntry(entry, boost) : drawCoin(reel, boost);
	};
	const specialCell = (kind) => {
		const symbol = specialSymbol[kind];
		if (!symbol) return null;
		const cfg = specialsCfg[kind];
		if (kind === 'payer' || kind === 'multiplier') {
			const value = weighted(list(cfg.values))?.value ?? (kind === 'multiplier' ? 2 : 1);
			return { symbol, kind, value };
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
				if (rand() < BASE_COIN_RATE && coinEntriesOn(reel).length) return drawCoin(reel);
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
	/** A cell of `role` that can sit on `reel`, or null. */
	const cellForRole = (role, reel) => {
		if (role === 'coin')
			return coinEntriesOn(reel).some((c) => c.kind === 'cash') ? drawCash(reel) : null;
		if (role === 'jackpot') {
			const jackpots = coinEntriesOn(reel).filter((c) => c.kind === 'jackpot');
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
				const role = trigger.count.roles.find((r) => cellForRole(r, reel));
				const cell = role ? cellForRole(role, reel) : null;
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
				const role = req.roles.find((r) => cellForRole(r, req.reel));
				const cell = role ? cellForRole(role, req.reel) : null;
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
	 *   special:<collector|multiplier|payer|mystery>                  lands in respin 1 (and is active)
	 *   mystery:<coin|jackpot:<TIER>|collector|multiplier|payer>      a mystery lands in respin 1, reveals it
	 *   unlock:<collector|multiplier|payer>   the mystery reveals a special NOT active at entry
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
					if (meterId && !meters.some((m) => m.id === meterId)) {
						errors.push(`${token}: no meter "${meterId}"`);
					}
					force.trigger = cause;
					if (meterId) force.meter = meterId;
					break;
				}
				case 'special':
					force.specials.push(needSpecial(args[0], token));
					break;
				case 'mystery':
				case 'unlock': {
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
					if (!/^[A-Za-z][\w-]*$/.test(id) || id === 'holdAndWin')
						errors.push(
							`${token}: "${id}" is not a mode id (a letter, then letters, digits, - or _; not holdAndWin)`,
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
	const defaultForce = (() => {
		const spec = opts.force ?? process.env.FORCE;
		if (!spec) return null;
		const parsed = parseForce(spec);
		if (parsed.errors) throw new Error(`[${label}] FORCE: ${parsed.errors.join('; ')}`);
		return parsed.force;
	})();

	// ---- sessions ----
	const sessions = new Map();
	const settledRounds = new Map();
	const settle = (sid, round) => {
		settledRounds.set(`${sid}:${round.id}`, round);
		if (settledRounds.size > 500) settledRounds.delete(settledRounds.keys().next().value);
	};
	const getSession = (sid) => {
		if (!sessions.has(sid))
			sessions.set(sid, { balance: startBalance, round: null, configSent: false });
		const session = sessions.get(sid);
		// Persistent meters: per session, across rounds — and across a contract swap, which carries
		// `meters` over (`carrySession`). A meter the contract no longer has is dropped; a new one
		// starts empty; a level above a lowered max is clamped.
		const levels = session.meters ?? {};
		session.meters = Object.fromEntries(
			meters.map((m) => [m.id, Math.min(m.maxLevel, Math.max(0, Number(levels[m.id]) || 0))]),
		);
		// Progressive pools: per session, across rounds and contract swaps like the meters. A tier
		// that became progressive starts at its seed; a pool above a lowered cap is clamped.
		const pools = session.jackpots ?? {};
		session.jackpots = Object.fromEntries(
			progressiveTiers.map((t) => {
				const level = Number(pools[t.name]);
				return [t.name, Math.min(t.cap, Number.isFinite(level) && level > 0 ? level : t.seed)];
			}),
		);
		return session;
	};
	const meterList = (session) =>
		meters.map((m) => ({ id: m.id, level: session.meters[m.id], max: m.maxLevel }));
	/** `jackpotLevels` — every progressive pool as it stands, × base total bet. Null without one. */
	const jackpotLevels = (session) =>
		progressiveTiers.length
			? {
					event: 'jackpotLevels',
					context: {
						jackpots: progressiveTiers.map((t) => ({
							name: t.name,
							value: tidy(session.jackpots[t.name]),
						})),
					},
				}
			: null;
	const growPools = (session) => {
		for (const t of progressiveTiers) {
			session.jackpots[t.name] = tidy(Math.min(t.cap, session.jackpots[t.name] + t.contribution));
		}
	};
	const resetWonPools = (session) => {
		for (const t of progressiveTiers)
			if (wonProgressive.has(t.name)) session.jackpots[t.name] = t.seed;
		wonProgressive.clear();
	};

	// ---- the boot config ----
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
		holdAndWin: {
			wire: HOLD_AND_WIN_WIRE_VERSION,
			bonus: RESPIN_BONUS,
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
							value: tidy(session.jackpots[j.name]),
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
		},
	});

	// ---- the feature ----
	const featureState = (f) => ({
		cells: cellsWhere(f.board, (cell) => cell !== null).map(({ reel, row, cell }) =>
			cellInfo(reel, row, cell),
		),
		start: respinRules.start,
		left: f.left,
		played: f.played,
		banked: f.banked,
		activeModifiers: [...f.active],
		collectorLevel: f.collectorLevel,
		coinBoost: f.coinBoost,
		...(boardEnd.type === 'columnLetters' ? { lettersLit: [...f.lettersLit] } : {}),
	});
	const bonusSnapshot = (round) => {
		const f = round.feature;
		const spinTrigger = {
			occurs: [trigger.count?.min ?? 1],
			of: coinSymbol,
			mode: 'holdAndWin',
			from: '',
		};
		return {
			prob: 1,
			additionalPrice: 0,
			triggers: 1,
			played: f.played,
			left: f.left,
			multiplier: {},
			bonusTriggers: { [RESPIN_BONUS]: 1 },
			bonusPlayed: {
				[RESPIN_BONUS]: { count: f.played, base: { count: 0, multiplierCount: 0 }, states: {} },
			},
			spins: f.left > 0 ? [{ spins: f.left, bonus: RESPIN_BONUS, trigger: spinTrigger }] : [],
			playing: RESPIN_BONUS,
			trigger: spinTrigger,
			holdAndWin: featureState(f),
		};
	};

	const jackpotWin = (events, round, tier, source, banked, cell, factor = 1) => {
		const amount = credits(tierMultiplier(tier) * factor, round);
		if (progressiveTiers.some((t) => t.name === tier)) wonProgressive.add(tier);
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
		if (boardEnd.type === 'fullBoardJackpot' && full) {
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
	 * full meters it consumes (their levels reset to 0 here).
	 */
	const startFeature = (events, round, session, board, cause, meterIds) => {
		const force = round.force ?? {};
		const f = {
			board: emptyBoard(),
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
				bonus: RESPIN_BONUS,
				trigger: {
					occurs: [trigger.count?.min ?? 1],
					of: coinSymbol,
					mode: 'holdAndWin',
					from: '',
				},
				cause,
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
		if (first) {
			for (const kind of force.specials ?? []) placeSomewhere(forcedSpecial(kind));
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
			if (kinds.length && rand() < share) place(reel, row, specialCell(pick(kinds)));
			else if (coinEntriesOn(reel).length) place(reel, row, drawCoin(reel, f.coinBoost));
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
			}
		}
		if (stickiness === 'collectorsOnly') clearNonCollectors(events, round);

		// The counter: reset by what LANDED (a mystery counts as what it revealed).
		const newCoins =
			landed.some(({ cell }) => cell.kind === 'coin' || cell.kind === 'jackpot') ||
			revealedCoins.length > 0;
		const reset = respinRules.reset === 'anySpecial' ? landed.length > 0 : newCoins;
		f.left = reset ? respinRules.start : f.left - 1;
		const update = { left: f.left, played: f.played, start: respinRules.start, reset };
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
				if (r === specialReel || !coinEntriesOn(r).some((c) => c.kind === 'cash')) continue;
				const was = board[r][0];
				board[r][0] = drawCash(r);
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
			startFeature(events, round, session, board, cause, full);
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
	 * A `bet` with no `gid` opens a NEW round even while one is open — the partner's behaviour
	 * ("a fresh boot against an open round does not replay"). The one left behind is settled the way
	 * the server settles a round nobody finishes: its feature played out and its win credited.
	 */
	const settleAbandoned = (sid, session, round) => {
		while (round.feature && !round.feature.ended) playRespin([], round);
		session.balance += round.win;
		round.closed = true;
		settle(sid, round);
		session.round = null;
	};

	// ---- the engine endpoint ----
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
		const openRound = (round) => ({ updating: true, id: round.id });
		const sendConfig = () => {
			session.configSent = true;
			session.betTable = betTable;
			const config = { event: 'config', context: configContext(session) };
			if (session.round) {
				config.actions = session.round.stored.map((s) => s.action);
				config.resume = true;
			}
			events.push(config);
		};
		// A line-config game volunteers its config on first contact; a table game only when asked,
		// so a stale tab is never pinned to a table it did not see (the lines mock's rule).
		// From here to the answer nothing awaits, so this request alone reads the pools it points at —
		// set after the body read, the request's only await, or another player's request in between
		// would leave it dealing their pools.
		livePools = session.jackpots;
		wonProgressive.clear();
		if (!session.configSent && !betTable) sendConfig();
		if (actions.length === 0) {
			// The heartbeat restates the progressive pools, so a bar open between rounds stays current.
			const levels = jackpotLevels(session);
			if (levels) events.push(levels);
			const platform = { balance: session.balance };
			if (session.round) platform.gameRound = openRound(session.round);
			return sendJson(req, res, 200, { events, platform });
		}

		// A batch is ATOMIC: a refusal (or a throw) anywhere in it stores nothing, charges nothing and
		// consumes nothing — the partner's rule, and the only one under which a resend is safe.
		const saved = {
			balance: session.balance,
			meters: { ...session.meters },
			jackpots: { ...session.jackpots },
			force: session.force,
			round: session.round ? structuredClone(session.round) : session.round,
		};
		const settledBefore = new Set(settledRounds.keys());
		const rollback = () => {
			session.balance = saved.balance;
			session.meters = saved.meters;
			session.jackpots = saved.jackpots;
			livePools = session.jackpots;
			wonProgressive.clear();
			session.force = saved.force;
			session.round = saved.round;
			for (const k of settledRounds.keys()) if (!settledBefore.has(k)) settledRounds.delete(k);
		};
		const fail = (error, code = 110) => {
			rollback();
			return refuse(req, res, session, error, code);
		};

		let round = session.round;
		// `config` is never stored, so it takes no position — only stored actions advance this.
		let position = seq;
		try {
			for (const a of actions) {
				if (a.action === 'config') {
					if (!events.some((e) => e.event === 'config')) sendConfig();
					continue;
				}
				const target = !gid
					? undefined
					: round?.id === gid
						? round
						: settledRounds.get(`${sid}:${gid}`);
				const stored = target?.stored[position];
				if (stored) {
					if (stored.action.action !== a.action) {
						return fail(
							`replay mismatch at ${position}: stored ${stored.action.action}, got ${a.action}`,
						);
					}
					events.push(...stored.events);
					position += 1;
					continue;
				}
				// A fresh action goes to the NEXT free position of its round, and nowhere else: a gap
				// would put holes in the resume list, and a stale position is another client's.
				const next = a.action === 'bet' ? 0 : (round?.stored.length ?? 0);
				if (position !== next) return fail(`seq ${position} is not the next position (${next})`);
				if (a.action !== 'bet' && round?.played && gid !== round.id) {
					return fail(`${a.action} under gid ${gid ?? '-'}, but the open round is ${round.id}`);
				}
				const dealtFrom = events.length;
				switch (a.action) {
					case 'bet': {
						if (betTable && !('betTable' in session)) {
							return fail('this session never asked for the game config — reload the game');
						}
						const table = tableFor(session);
						const ctx = Array.isArray(a.context)
							? a.context
							: table
								? [0, 1]
								: [paylines.length, 1];
						const option = table ? Number(ctx[0] ?? 0) : 0;
						const multiplier = Number(ctx[1] ?? 1);
						const lines = table ? 1 : Number(ctx[0] ?? paylines.length);
						if (
							!(multiplier > 0) ||
							!(lines > 0) ||
							(table && (!Number.isInteger(option) || option < 0 || option >= table.options.length))
						) {
							return fail(`invalid bet [${ctx[0]}, ${ctx[1]}]`, 101);
						}
						const betPerLine = multiplier;
						const baseTotal = table ? table.options[0] * betPerLine : lines * betPerLine;
						const total = table
							? Math.max(1, Math.round(table.options[option] * betPerLine))
							: baseTotal;
						const isBuy = table ? Boolean(table.buys[option]) : false;
						// A table pinned by another mock (a contract swap) may not name its modes; the
						// option index means the same mode in both.
						const modeName = (table?.modes ?? betTable?.modes)?.[option];
						if (round && !round.closed) {
							settleAbandoned(sid, session, round);
							resetWonPools(session);
						}
						if (session.balance < total) return fail('insufficient balance', 200);
						session.balance -= total;
						growPools(session);
						round = {
							id: makeRoundId(),
							betPerLine,
							total,
							baseTotal,
							isBuy,
							buyTier: isBuy ? list(trigger.buy).find((t) => t.mode === modeName) : undefined,
							win: 0,
							feature: null,
							closed: false,
							stored: [],
						};
						events.push({ event: 'bet', context: { total, betPerLine, paylines, maxWinCap: 0 } });
						events.push({ event: 'gameStart', context: { totalBet: total, betPerLine } });
						break;
					}
					case 'play': {
						if (!round || round.closed) {
							return fail('error executing requested actions: play without bet');
						}
						if (round.feature) {
							if (round.feature.ended) {
								return fail('unexpected action: play (was expecting: collect)');
							}
							playRespin(events, round);
							break;
						}
						if (round.played) return fail('unexpected action: play (was expecting: collect)');
						let context = a.context;
						if (typeof context === 'string' && context.startsWith('force:')) {
							if (!allowForce) return fail('forcing is off on this mock', 101);
							const parsed = parseForce(context.slice('force:'.length));
							if (parsed.errors) return fail(`force: ${parsed.errors.join('; ')}`, 101);
							round.force = parsed.force;
							context = null;
						} else if (session.force) {
							round.force = session.force;
							session.force = null;
						} else if (defaultForce) {
							round.force = defaultForce;
						}
						if (round.force?.instant && round.isBuy) {
							return fail('force: instant cannot ride a bought feature', 101);
						}
						round.played = true;
						playBase(events, round, session, context);
						break;
					}
					case 'collect': {
						if (
							!round ||
							round.id !== gid ||
							(round.feature && !round.feature.ended) ||
							!round.played
						) {
							return fail('error executing requested actions: unexpected action: collect');
						}
						if (!round.closed) {
							session.balance += round.win;
							round.closed = true;
						}
						events.push({ event: 'gameRoundOver', context: { win: round.win } });
						break;
					}
					default:
						return fail(`error executing requested actions: unknown action: ${a.action}`);
				}
				round.stored[position] = { action: a, events: events.slice(dealtFrom) };
				resetWonPools(session);
				// A bet grows the pools before its play is dealt, so it reports them too: every jackpot
				// worth in the play's answer is read against the pools it was dealt at.
				const grown = a.action === 'bet' ? jackpotLevels(session) : null;
				if (grown) {
					events.push(grown);
					round.stored[position].events.push(grown);
				}
				if (a.action === 'play' && meters.length) {
					// Every play answer reports the meters as they stand — the client never computes one.
					const levels = { event: 'meterLevels', context: { meters: meterList(session) } };
					events.push(levels);
					round.stored[position].events.push(levels);
				}
				// …and the progressive pools, after any this play won went back to their seed.
				const pools = a.action === 'play' ? jackpotLevels(session) : null;
				if (pools) {
					events.push(pools);
					round.stored[position].events.push(pools);
				}
				position += 1;
			}
		} catch (err) {
			rollback();
			throw err;
		}

		if (round?.closed) settle(sid, round);
		session.round = round && !round.closed ? round : null;
		const platform = { balance: session.balance };
		if (round && !round.closed) platform.gameRound = openRound(round);
		return sendJson(req, res, 200, { events, platform });
	};

	/** `…/force?sid=&beat=<spec>` — hold a force for that session's next round (`beat=` clears it). */
	const handleForce = (req, res, url) => {
		const sid = url.searchParams.get('sid');
		if (!sid) return sendJson(req, res, 400, { error: 'missing sid' });
		if (!allowForce) {
			return sendJson(req, res, 403, { ok: false, errors: ['forcing is off on this mock'] });
		}
		const spec = url.searchParams.get('beat') ?? '';
		const session = getSession(sid);
		if (!spec) {
			session.force = null;
			return sendJson(req, res, 200, { ok: true, sid, force: null });
		}
		const parsed = parseForce(spec);
		if (parsed.errors) return sendJson(req, res, 400, { ok: false, errors: parsed.errors });
		session.force = parsed.force;
		return sendJson(req, res, 200, { ok: true, sid, force: parsed.force });
	};

	const handle = async (req, res, url) => {
		if (req.method === 'OPTIONS') return sendCorsPreflight(req, res);
		if (req.method === 'GET' && pathEndsWith(url.pathname, '/healthz')) {
			return sendJson(req, res, 200, { ok: true, sessions: sessions.size, protocol: 'holdAndWin' });
		}
		if (req.method === 'GET' && pathEndsWith(url.pathname, '/state')) {
			const sid = url.searchParams.get('sid');
			if (!sid) return sendJson(req, res, 400, { error: 'missing sid' });
			const { round, ...session } = getSession(sid);
			return sendJson(req, res, 200, {
				...session,
				round: round && {
					id: round.id,
					stored: round.stored.length,
					feature: round.feature && featureState(round.feature),
				},
			});
		}
		if ((req.method === 'POST' || req.method === 'GET') && pathEndsWith(url.pathname, '/force')) {
			return handleForce(req, res, url);
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

	return { handle, sessions, startBalance, seed, parseForce };
}

// ---------- standalone CLI entry (local dev) ----------

const isMainModule = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;

if (isMainModule) {
	const gameConfig = await import('../packages/game-config/index.ts');
	const preset = process.env.PRESET ?? gameConfig.DEFAULT_HOLD_AND_WIN_PRESET;
	const raw =
		gameConfig.HOLD_AND_WIN_PRESETS[preset] ?? gameConfig.HOLD_AND_WIN_TEST_FIXTURES[preset];
	if (!raw) {
		const ids = [
			...gameConfig.HOLD_AND_WIN_PRESET_IDS,
			...Object.keys(gameConfig.HOLD_AND_WIN_TEST_FIXTURES),
		];
		console.error(`[mock-hnw] PRESET="${preset}" — use ${ids.join(' | ')}`);
		process.exit(1);
	}
	const doc = gameConfig.normalizeGameConfigDoc(raw);
	const modes = Object.entries(doc.betModes);
	const PORT = Number(process.env.PORT ?? 7799);
	const mock = createMockRgs({
		label: 'mock-hnw',
		reels: doc.numReels,
		rows: Math.max(...doc.numRows),
		rowsPerReel: doc.numRows,
		paylines: Object.values(doc.paylines),
		betModes:
			modes.length > 1
				? modes.map(([mode, m]) => ({ mode, cost: m.cost, kind: m.buyBonus ? 'buy' : 'base' }))
				: undefined,
		holdAndWin: gameConfig.holdAndWinMockInputs(doc),
	});
	createServer((req, res) =>
		mock.handle(req, res, new URL(req.url, `http://${req.headers.host}`)),
	).listen(PORT, () => {
		console.log(
			`[mock-hnw] Hold and Win (${preset}) on http://localhost:${PORT}  balance=${mock.startBalance} seed=${mock.seed ?? '(time)'}`,
		);
		console.log(
			`[mock-hnw] force a beat: curl "http://localhost:${PORT}/force?sid=<sid>&beat=trigger:count"`,
		);
	});
}
