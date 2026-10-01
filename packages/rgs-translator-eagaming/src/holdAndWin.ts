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
 * (`pickMappingForConfig`), so they agree with the mapped `reveal` board.
 */

import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';

/** The `holdAndWin` block of the boot `config` — the fields the translation reads. */
export type HoldAndWinWireConfig = {
	wire: number;
	roles: Record<string, string[]>;
	jackpots: { name: string; multiplier: number }[];
	stickiness?: 'allCoins' | 'collectorsOnly';
};

/** The only wire this module was written for — `config.holdAndWin.wire`. */
export const HOLD_AND_WIN_WIRE = 1;

export const readHoldAndWinConfig = (cfg: unknown): HoldAndWinWireConfig | null => {
	const block = (cfg as { holdAndWin?: Partial<HoldAndWinWireConfig> } | null)?.holdAndWin;
	if (!block || typeof block !== 'object') return null;
	if (block.wire !== HOLD_AND_WIN_WIRE) {
		console.error(
			`[engine-facade] Hold and Win wire ${String(block.wire)} — this client reads wire ${HOLD_AND_WIN_WIRE}; its feature will not be shown`,
		);
		return null;
	}
	return {
		wire: block.wire,
		roles: block.roles ?? {},
		jackpots: block.jackpots ?? [],
		...(block.stickiness ? { stickiness: block.stickiness } : {}),
	};
};

export type HoldAndWinSymbol = { name: string; value?: number; jackpot?: string; factor?: number };
type Position = { reel: number; row: number };
type Cell = Position & { symbol: HoldAndWinSymbol };
type CellAmount = Cell & { amount: number };

/** `BONUS:1.5` → a value · `JACKPOT:MINI*2` → a jackpot and its factor · `H1` → a plain symbol. */
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
};

export type HoldAndWinTranslation = {
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
		return (tier?.multiplier ?? 0) * (symbol.factor ?? 1);
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
		},
	};
};

const withAmounts = (t: HoldAndWinTranslation, cells: unknown): CellAmount[] =>
	((cells as (WireCell & { amount?: number })[] | undefined) ?? []).map((c) => ({
		...cellOf(c),
		amount: t.toAmount(c.amount ?? 0),
	}));

type Ctx = Record<string, unknown>;

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
			return {
				type: 'meterUpdate',
				meter: ctx.meter,
				level: ctx.level,
				max: ctx.max,
				full: Boolean(ctx.full),
				from: cellsOf(ctx.from),
				...(ctx.forced ? { forced: true } : {}),
			};
		case 'meterLevels':
			return {
				type: 'meterLevels',
				meters: ((ctx.meters as { id: string; level: number; max: number }[]) ?? []).map(
					({ id, level, max }) => ({ id, level, max }),
				),
			};
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
				mode: 'holdAndWin',
				cause: ctx.cause,
				payload: {
					cells: cellsOf(ctx.cells),
					respins: ctx.respins,
					stickiness: ctx.stickiness,
					activeModifiers: ctx.activeModifiers ?? [],
					...(ctx.meters ? { meters: ctx.meters } : {}),
				},
			};
		case 'holdAndWinWheel': {
			const prize = (ctx.prize ?? {}) as Record<string, unknown>;
			const { type } = prize;
			if (type !== 'coinBoost' && type !== 'extraCollect' && type !== 'jackpot') return null;
			return {
				type: 'holdAndWinWheel',
				index: ctx.index,
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
				mode: 'holdAndWin',
				total: t.toAmount((ctx.total as number) ?? 0),
				payload: {
					cells: withAmounts(t, ctx.cells),
					banked: t.toAmount((ctx.banked as number) ?? 0),
				},
			};
		default:
			return null;
	}
};
