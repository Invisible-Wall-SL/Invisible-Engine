/**
 * The Hold and Win half of the facade: the wire family OUR mock speaks
 * (`docs/reference/hold-and-win-wire.md`) → the engine's Hold and Win book events (design §4.3,
 * typed in `engine-game`'s `holdAndWin.ts`).
 *
 * ⚠️ THE SWAP SEAM. Every input shape here is ours, not the partner's: no partner has shown us a Hold
 * and Win round. When their format arrives (Phase 10) this module is rewritten and nothing above
 * the facade changes. The output shapes are restated structurally rather than imported, for the
 * no-engine-deps rule in `gameMappings.ts`.
 *
 * Units: positions stay the wire's VISIBLE 0-based ones (the engine contract uses them too); a
 * wire `amount` is credits and becomes book-event units through `toAmount`; a `value` stays × the
 * base total bet. Symbol names pass through unmapped: a Hold and Win server maps by identity
 * (`pickMappingForConfig`), so they agree with the mapped `reveal` board. A pots-overlay host keeps
 * its host's mapping instead, whose table names none of these symbols, so they pass through there
 * too.
 */

import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';

/** The `holdAndWin` block of the boot `config` — the fields the translation reads. */
export type HoldAndWinWireConfig = {
	wire: number;
	/** The `spinTrigger.bonus` key its feature arrives under. */
	bonus: string;
	roles: Record<string, string[]>;
	/** The respin board's empty cell. */
	blank?: string;
	/** A progressive tier says so and carries its pool (`value`, × base total bet), which
	 *  `jackpotLevels` moves; a fixed tier pays its `multiplier`. */
	jackpots: { name: string; multiplier: number; progressive?: boolean; value?: number }[];
	stickiness?: 'allCoins' | 'collectorsOnly';
	/** Board expansion: the respin board grows from `startRows` to `maxRows` rows. */
	expansion?: { startRows: number; maxRows: number };
};

/** The only wire this module was written for — `config.holdAndWin.wire`. */
export const HOLD_AND_WIN_WIRE = 1;

/** The respin mode a legacy single `holdAndWin` block is — `game-config`'s `HOLD_AND_WIN_MODE`,
 *  restated for the no-engine-deps rule. */
export const HOLD_AND_WIN_MODE = 'holdAndWin';

const readHoldAndWinBlock = (
	block: Partial<HoldAndWinWireConfig> | undefined,
	label: string,
): HoldAndWinWireConfig | null => {
	if (!block || typeof block !== 'object') return null;
	if (block.wire !== HOLD_AND_WIN_WIRE) {
		console.error(
			`[engine-facade] ${label} wire ${String(block.wire)} — this client reads wire ${HOLD_AND_WIN_WIRE}; its feature will not be shown`,
		);
		return null;
	}
	return {
		wire: block.wire,
		bonus: typeof block.bonus === 'string' && block.bonus ? block.bonus : 'respin',
		roles: block.roles ?? {},
		...(typeof block.blank === 'string' && block.blank ? { blank: block.blank } : {}),
		jackpots: (block.jackpots ?? []).map((j) => ({ ...j })),
		...(block.stickiness ? { stickiness: block.stickiness } : {}),
		...(typeof block.expansion?.maxRows === 'number' &&
		typeof block.expansion.startRows === 'number'
			? { expansion: { startRows: block.expansion.startRows, maxRows: block.expansion.maxRows } }
			: {}),
	};
};

export const readHoldAndWinConfig = (cfg: unknown): HoldAndWinWireConfig | null =>
	readHoldAndWinBlock(
		(cfg as { holdAndWin?: Partial<HoldAndWinWireConfig> } | null)?.holdAndWin,
		'Hold and Win',
	);

/**
 * Every respin mode the boot `config` declares, by mode id, and the PRIMARY one — the mode a bonus
 * that names none plays in (design `bonus-games.md` §2.2).
 */
export type HoldAndWinModes = { modes: Map<string, HoldAndWinWireConfig>; primary: string };

/**
 * `config.bonusModes: [{mode, gameType, …HoldAndWinWireConfig}]`, one entry per respin mode with the
 * primary first, or — from a server that sends none (a lone default mode) — the legacy single
 * `config.holdAndWin` as mode `holdAndWin`. An entry without a mode id, a repeated id, or another
 * wire is dropped; none left ⇒ null.
 */
export const readHoldAndWinModes = (cfg: unknown): HoldAndWinModes | null => {
	const declared = (cfg as { bonusModes?: unknown } | null)?.bonusModes;
	const modes = new Map<string, HoldAndWinWireConfig>();
	if (Array.isArray(declared) && declared.length) {
		for (const entry of declared as (Partial<HoldAndWinWireConfig> & { mode?: unknown })[]) {
			const mode = entry?.mode;
			if (typeof mode !== 'string' || !mode || modes.has(mode)) continue;
			const block = readHoldAndWinBlock(entry, `Hold and Win mode ${mode}`);
			if (block) modes.set(mode, block);
		}
	} else {
		const legacy = readHoldAndWinConfig(cfg);
		if (legacy) modes.set(HOLD_AND_WIN_MODE, legacy);
	}
	if (modes.size === 0) return null;
	return { modes, primary: [...modes.keys()][0] };
};

/** A meter's level as the engine reads it (`HoldAndWinMeterLevel` in engine-game). */
export type HoldAndWinMeterLevel = { id: string; level: number; max: number };

/**
 * The meters' levels at boot — `config.holdAndWin.meters[].{id, level, max}`. Meter levels are SERVER
 * state (per player, surviving rounds): this is the only place the client learns them before its
 * first `play` restates them in `meterLevels`. An entry missing a field is dropped; no block, no
 * meters, or a wire this client was not written for ⇒ `[]`.
 */
export const readBootMeterLevels = (cfg: unknown): HoldAndWinMeterLevel[] => {
	const block = (cfg as { holdAndWin?: { wire?: unknown; meters?: unknown } } | null)?.holdAndWin;
	if (!block || block.wire !== HOLD_AND_WIN_WIRE || !Array.isArray(block.meters)) return [];
	return block.meters.flatMap((meter: unknown) => {
		const { id, level, max } = (meter ?? {}) as Record<string, unknown>;
		return typeof id === 'string' &&
			id &&
			typeof level === 'number' &&
			Number.isFinite(level) &&
			typeof max === 'number' &&
			Number.isFinite(max)
			? [{ id, level, max }]
			: [];
	});
};

/** A progressive tier's pool as the engine reads it (`HoldAndWinJackpotLevel` in engine-game). */
export type HoldAndWinJackpotLevel = { name: string; value: number };

const jackpotLevelsOf = (raw: unknown): HoldAndWinJackpotLevel[] =>
	Array.isArray(raw)
		? raw.flatMap((entry: unknown) => {
				const { name, value } = (entry ?? {}) as Record<string, unknown>;
				return typeof name === 'string' && name && typeof value === 'number' && value > 0
					? [{ name, value }]
					: [];
			})
		: [];

/**
 * The progressive pools at boot — `config.holdAndWin.jackpots[]` entries flagged `progressive`, with
 * their `value`. Like a meter level, a pool is SERVER state the client learns here before its first
 * `play` restates it in `jackpotLevels`. No progressive tier (every game before 11c) ⇒ `[]`.
 */
export const readBootJackpotLevels = (cfg: unknown): HoldAndWinJackpotLevel[] => {
	const block = (cfg as { holdAndWin?: { wire?: unknown; jackpots?: unknown } } | null)?.holdAndWin;
	if (!block || block.wire !== HOLD_AND_WIN_WIRE || !Array.isArray(block.jackpots)) return [];
	return jackpotLevelsOf(
		block.jackpots.filter((j: unknown) => (j as { progressive?: unknown })?.progressive === true),
	);
};

/** A `jackpotLevels` answer's pools (an event's context, a heartbeat's included). */
export const readJackpotLevels = (ctx: unknown): HoldAndWinJackpotLevel[] =>
	jackpotLevelsOf((ctx as { jackpots?: unknown } | null)?.jackpots);

/** Move the captured tiers' pools, so a held jackpot coin is worth what the pool now holds. */
export const applyJackpotLevels = (hw: HoldAndWinWireConfig, levels: HoldAndWinJackpotLevel[]) => {
	for (const { name, value } of levels) {
		const tier = hw.jackpots.find((j) => j.name === name);
		if (tier?.progressive) tier.value = value;
	}
};

export type HoldAndWinSymbol = { name: string; value?: number; jackpot?: string; factor?: number };
type Position = { reel: number; row: number };
type Cell = Position & { symbol: HoldAndWinSymbol };
type CellAmount = Cell & { amount: number };

/** `BONUS:1.5` → a value · `JACKPOT:MINI*2` → a jackpot and its factor · `H1` → a plain symbol.
 *  An add-respins (`ADD:2`) and an upgrade (`UPG:0.5`) carry their respins / step as the value. */
export const parseHoldAndWinCell = (text: string): HoldAndWinSymbol => {
	const colon = text.indexOf(':');
	if (colon === -1) return { name: text };
	const name = text.slice(0, colon);
	const rest = text.slice(colon + 1);
	const value = Number(rest);
	if (rest !== '' && Number.isFinite(value)) return { name, value };
	const [jackpot, factor] = rest.split('*');
	const times = Number(factor);
	return factor && Number.isFinite(times) && times > 1
		? { name, jackpot, factor: times }
		: { name, jackpot };
};

type WireCell = Position & { symbol: string; value?: number; jackpot?: string; factor?: number };

const symbolOf = (c: WireCell): HoldAndWinSymbol => ({
	name: c.symbol,
	...(c.jackpot !== undefined
		? { jackpot: c.jackpot, ...(c.factor && c.factor > 1 ? { factor: c.factor } : {}) }
		: c.value !== undefined
			? { value: c.value }
			: {}),
});
const cellOf = (c: WireCell): Cell => ({ reel: c.reel, row: c.row, symbol: symbolOf(c) });
const cellsOf = (cells: unknown): Cell[] => ((cells as WireCell[] | undefined) ?? []).map(cellOf);
const positionsOf = (cells: unknown): Position[] =>
	((cells as Position[] | undefined) ?? []).map(({ reel, row }) => ({ reel, row }));

/** Every cell of a respin board, reel-major — what `respinReveal` carries. */
export const boardCells = (board: string[][]): Cell[] =>
	board.flatMap((reel, r) =>
		reel.map((text, row) => ({ reel: r, row, symbol: parseHoldAndWinCell(text) })),
	);

type WireSnapshot = {
	cells?: WireCell[];
	start?: number;
	left?: number;
	played?: number;
	banked?: number;
	activeModifiers?: string[];
	collectorLevel?: number;
	coinBoost?: number;
	lettersLit?: boolean[];
	rows?: number;
};

export type HoldAndWinTranslation = {
	/** The respin mode these rules are — what `holdAndWinTrigger` / `holdAndWinEnd` carry. */
	mode: string;
	hw: HoldAndWinWireConfig;
	/** Credits → book-event units, against the round's base stake. */
	toAmount: (credits: number) => number;
};

/** A held cell's worth × the base total bet: a coin's or a collector's value, a jackpot coin's
 *  prize × its factor. Payers, multipliers and blanks are worth nothing. */
const worthOf = (hw: HoldAndWinWireConfig, cell: Cell): number => {
	const { symbol } = cell;
	if (symbol.jackpot !== undefined) {
		const tier = hw.jackpots.find((j) => j.name === symbol.jackpot);
		const prize = tier?.progressive && tier.value !== undefined ? tier.value : tier?.multiplier;
		return (prize ?? 0) * (symbol.factor ?? 1);
	}
	const roles = hw.roles[symbol.name] ?? [];
	return roles.includes('coin') || roles.includes('collector') ? (symbol.value ?? 0) : 0;
};

/** The wire's bonus snapshot (`enterBonus` / `playedBonusSpin`) → the engine's `holdAndWinState`. */
export const holdAndWinState = (t: HoldAndWinTranslation, wire: WireSnapshot) => {
	const cells = cellsOf(wire.cells);
	const banked = t.toAmount(wire.banked ?? 0);
	const held = cells.reduce((sum, cell) => sum + worthOf(t.hw, cell), 0);
	return {
		type: 'holdAndWinState',
		snapshot: {
			cells,
			start: wire.start ?? 0,
			left: wire.left ?? 0,
			played: wire.played ?? 0,
			banked,
			total: banked + Math.round(held * BOOK_AMOUNT_MULTIPLIER),
			stickiness: t.hw.stickiness ?? 'allCoins',
			activeModifiers: wire.activeModifiers ?? [],
			collectorLevel: wire.collectorLevel ?? 1,
			coinBoost: wire.coinBoost ?? 1,
			lettersLit: (wire.lettersLit ?? []).flatMap((lit, reel) => (lit ? [reel] : [])),
			...(typeof wire.rows === 'number' ? { rows: wire.rows } : {}),
		},
		mode: t.mode,
	};
};

const withAmounts = (t: HoldAndWinTranslation, cells: unknown): CellAmount[] =>
	((cells as (WireCell & { amount?: number })[] | undefined) ?? []).map((c) => ({
		...cellOf(c),
		amount: t.toAmount(c.amount ?? 0),
	}));

type Ctx = Record<string, unknown>;

/** A meter moved — the Hold and Win meters and the pots overlay's pots alike. */
export const meterUpdateEvent = (ctx: Ctx) => ({
	type: 'meterUpdate',
	meter: ctx.meter,
	level: ctx.level,
	max: ctx.max,
	full: Boolean(ctx.full),
	from: cellsOf(ctx.from),
	...(ctx.forced ? { forced: true } : {}),
});

/** A mode the server announces by name. `meters` (the full pots that started it) travel only on a
 *  pots-overlay host's wire, so only its translation asks for them. */
export const modeEnterEvent = (ctx: Ctx, withMeters = false) =>
	typeof ctx.mode === 'string' && ctx.mode
		? {
				type: 'modeEnter',
				mode: ctx.mode,
				...(typeof ctx.cause === 'string' ? { cause: ctx.cause } : {}),
				...(withMeters && Array.isArray(ctx.meters) ? { meters: ctx.meters } : {}),
				...(ctx.policy === 'queue' || ctx.policy === 'nest' ? { policy: ctx.policy } : {}),
				...(ctx.payload && typeof ctx.payload === 'object' ? { payload: ctx.payload } : {}),
			}
		: null;

/** That mode is over; its `total` is credits on the wire. */
export const modeExitEvent = (ctx: Ctx, toAmount: (credits: number) => number) =>
	typeof ctx.mode === 'string' && ctx.mode
		? {
				type: 'modeExit',
				mode: ctx.mode,
				...(typeof ctx.total === 'number' ? { total: toAmount(ctx.total) } : {}),
			}
		: null;

/** Every meter's level, restated after a play. */
export const meterLevelsEvent = (ctx: Ctx) => ({
	type: 'meterLevels',
	meters: ((ctx.meters as HoldAndWinMeterLevel[]) ?? []).map(({ id, level, max }) => ({
		id,
		level,
		max,
	})),
});

const isExpansion = (v: unknown): v is { rows: number; maxRows: number } =>
	typeof v === 'object' &&
	v !== null &&
	typeof (v as { rows?: unknown }).rows === 'number' &&
	typeof (v as { maxRows?: unknown }).maxRows === 'number';

/**
 * One wire Hold and Win event → its engine event, or null when the name is not one of ours. The
 * round-level events (`playedSpin`, `enterBonus`, `playedBonusSpin`, `gameEnd`) stay in the
 * facade's switch, which knows where the round is.
 */
export const translateHoldAndWinEvent = (
	t: HoldAndWinTranslation,
	name: string,
	ctx: Ctx,
): Record<string, unknown> | null => {
	switch (name) {
		case 'luckySpin':
			return { type: 'luckySpin' };
		case 'meterUpdate':
			return meterUpdateEvent(ctx);
		case 'meterLevels':
			return meterLevelsEvent(ctx);
		case 'jackpotLevels':
			return { type: 'jackpotLevels', jackpots: readJackpotLevels(ctx) };
		case 'coinInstantCollect':
			return {
				type: 'coinInstantCollect',
				specials: cellsOf(ctx.specials),
				multiplier: (ctx.multiplier as number) ?? 1,
				times: (ctx.times as number) ?? 1,
				cells: withAmounts(t, ctx.cells),
				amount: t.toAmount((ctx.amount as number) ?? 0),
			};
		case 'randomMetreTrigger':
			return { type: 'randomMetreTrigger', name: ctx.name, cells: cellsOf(ctx.cells) };
		case 'holdAndWinTrigger':
			return {
				type: 'holdAndWinTrigger',
				mode: t.mode,
				cause: ctx.cause,
				payload: {
					cells: cellsOf(ctx.cells),
					respins: ctx.respins,
					stickiness: ctx.stickiness,
					activeModifiers: ctx.activeModifiers ?? [],
					...(ctx.meters ? { meters: ctx.meters } : {}),
					...(isExpansion(ctx.expansion) ? { expansion: ctx.expansion } : {}),
				},
			};
		case 'holdAndWinWheel': {
			const prize = (ctx.prize ?? {}) as Record<string, unknown>;
			const { type } = prize;
			if (type !== 'coinBoost' && type !== 'extraCollect' && type !== 'jackpot') return null;
			return {
				type: 'holdAndWinWheel',
				segment: ctx.index,
				prize:
					type === 'coinBoost'
						? { type, multiplier: prize.multiplier }
						: type === 'extraCollect'
							? { type, count: prize.count }
							: { type, jackpot: prize.jackpot },
			};
		}
		case 'coinsLand':
			return { type: 'coinsLand', cells: cellsOf(ctx.cells) };
		case 'mysteryReveal':
			return {
				type: 'mysteryReveal',
				cells: ((ctx.cells as (WireCell & { becomes: string })[]) ?? []).map((c) => ({
					...cellOf(c),
					becomes: c.becomes,
				})),
				activates: ctx.activates ?? [],
			};
		case 'coinPay': {
			const payer = ctx.payer as WireCell | undefined;
			if (!payer) return null;
			return {
				type: 'coinPay',
				payer: { ...cellOf(payer), symbol: { name: payer.symbol, value: ctx.value } },
				value: ctx.value,
				cells: ctx.cells ?? [],
			};
		}
		case 'coinBoost': {
			const booster = ctx.booster as WireCell | undefined;
			return {
				type: 'coinBoost',
				source: ctx.source,
				...(booster
					? {
							booster: {
								...cellOf(booster),
								symbol: { name: booster.symbol, value: ctx.multiplier },
							},
						}
					: {}),
				multiplier: ctx.multiplier,
				cells: ctx.cells ?? [],
			};
		}
		case 'respinsAdded': {
			const cell = ctx.cell as WireCell | undefined;
			if (!cell) return null;
			return {
				type: 'respinsAdded',
				cell: cellOf(cell),
				added: ctx.added,
				left: ctx.left,
				total: ctx.total,
			};
		}
		case 'coinUpgrade': {
			const upgrader = ctx.upgrader as WireCell | undefined;
			if (!upgrader) return null;
			type WireUpgrade = Position & {
				from?: number;
				to?: number;
				jackpot?: string;
				fromJackpot?: string;
			};
			return {
				type: 'coinUpgrade',
				upgrader: cellOf(upgrader),
				target: ctx.target,
				step: ctx.step ?? 0,
				// A change missing its `from` reads as no change rather than as an unlabelled coin.
				cells: ((ctx.cells as WireUpgrade[] | undefined) ?? []).map((c) =>
					c.jackpot !== undefined
						? {
								reel: c.reel,
								row: c.row,
								kind: 'jackpot',
								from: c.fromJackpot ?? c.jackpot,
								to: c.jackpot,
							}
						: { reel: c.reel, row: c.row, kind: 'value', from: c.from ?? c.to, to: c.to },
				),
			};
		}
		case 'specialBecomesCoin':
			return {
				type: 'specialBecomesCoin',
				reel: ctx.reel,
				row: ctx.row,
				from: ctx.from,
				symbol: { name: ctx.symbol, value: ctx.value },
			};
		case 'coinCollect': {
			const collector = ctx.collector as WireCell | undefined;
			if (!collector) return null;
			return {
				type: 'coinCollect',
				collector: { ...cellOf(collector), symbol: { name: collector.symbol, value: ctx.value } },
				level: ctx.level,
				cells: withAmounts(t, ctx.cells),
				value: ctx.value,
			};
		}
		case 'cellsCleared':
			return { type: 'cellsCleared', reason: ctx.reason, cells: positionsOf(ctx.cells) };
		case 'rowsUnlocked':
			return typeof ctx.from === 'number' && typeof ctx.rows === 'number'
				? {
						type: 'rowsUnlocked',
						from: ctx.from,
						rows: ctx.rows,
						cause: ctx.cause,
						unlockers: cellsOf(ctx.unlockers),
					}
				: null;
		case 'columnComplete':
			return {
				type: 'columnComplete',
				reel: ctx.reel,
				letter: ctx.letter,
				newlyLit: Boolean(ctx.newlyLit),
				cleared: Boolean(ctx.cleared),
				value: ctx.value,
				amount: t.toAmount((ctx.amount as number) ?? 0),
				cells: positionsOf(ctx.cells),
			};
		case 'jackpotWin':
			return {
				type: 'jackpotWin',
				tier: ctx.tier,
				amount: t.toAmount((ctx.amount as number) ?? 0),
				source: ctx.source,
				banked: Boolean(ctx.banked),
				...(ctx.cell ? { cell: positionsOf([ctx.cell])[0] } : {}),
			};
		case 'respinUpdate':
			return {
				type: 'respinUpdate',
				left: ctx.left,
				played: ctx.played,
				start: ctx.start,
				reset: Boolean(ctx.reset),
			};
		case 'holdAndWinEnd':
			return {
				type: 'holdAndWinEnd',
				mode: t.mode,
				total: t.toAmount((ctx.total as number) ?? 0),
				payload: {
					cells: withAmounts(t, ctx.cells),
					banked: t.toAmount((ctx.banked as number) ?? 0),
				},
			};
		// A second game mode the server announces (queued behind the feature, or nested). The Hold
		// and Win feature itself only ever arrives as holdAndWinTrigger / holdAndWinEnd.
		case 'modeEnter':
			return modeEnterEvent(ctx);
		case 'modeExit':
			return modeExitEvent(ctx, t.toAmount);
		default:
			return null;
	}
};
