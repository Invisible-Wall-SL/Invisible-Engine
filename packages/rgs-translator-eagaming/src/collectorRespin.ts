/**
 * The partner's collector respin wire (Fortune Vault Force 5, our Getting Hot — partner game 8) →
 * OUR Hold and Win wire (`docs/reference/hold-and-win-wire.md`), which `holdAndWin.ts` and the
 * facade's switch then translate into book events as for any Hold and Win server.
 *
 * Read off the 2026-11-09 capture and the partner's real round of 2026-11-13
 * (`docs/reference/play4fun-collector-respin-capture.md`). The
 * partner's server owns every outcome; this only renames what it sent:
 *
 * - cells: `COIN_<n>` (n × the base total bet) → `COIN:<n>`; `COIN_<TIER>` → `COIN:<TIER>`;
 *   `COLLECT_<cents>` → `COLLECT:<cents ÷ base>`; `BLANK` and the line symbols pass through.
 * - a base-game collect (no trigger) → `coinInstantCollect`, one `times` per collector, since each
 *   collector takes every coin's full value, and `collectors`: what each gathered and its total.
 * - a surprise trigger (`surpriseTrigger`): the coins and collectors on the board after the spin
 *   that `playWindow` does not have → `featureTopUp {cells, state}`, after the dealt board and
 *   before the trigger, so the client drops them onto the stopped reels.
 * - a trigger → `holdAndWinTrigger {cause: 'run'}` holding only the collectors, then the trigger
 *   spin's collect as an entry `coinCollect` (the collectors carry it into the bonus), then
 *   `enterBonus` with its snapshot. `boostsAwarded` → `enhancements`; Expand opens its rows at entry.
 * - each respin: its dealt board, `coinsLand`, the `boost` / `multiplier` hits (`enhancementHit`) or
 *   X misses (`enhancementMiss`) in the wire's order, a `coinCollect` per collector, the coins
 *   cleared, `respinUpdate` from `playedBonusSpin` (`retrigger` resets), and the snapshot.
 * - the bonus board's rows: the wire numbers the rows an Expand opened first; ours keep the base
 *   rows' index and number the opened ones after them (see `seatRowShift`).
 * - the last respin → `holdAndWinEnd` (the feature pays the sum of the collectors), then the
 *   partner's `playedBonusSpins` / `gameEnd`.
 *
 * Never seen in a capture, handled defensively: a board growing during the bonus (the snapshot's
 * `rows` follows it), Force 5 (`powerFive`, its 5-row board read off the first respin), a boost and
 * a multiply on the same coin (each hit's own `startingPay` is its `from`, so either order reads
 * right) and coins landing with no collector in view (left for the snapshot to settle).
 */

import { HOLD_AND_WIN_WIRE, type HoldAndWinWireConfig } from './holdAndWin';

type WireEvent = { event: string; context?: unknown };
type Ctx = Record<string, unknown>;

const COIN = 'COIN';
const COLLECT = 'COLLECT';
const BLANK = 'BLANK';

/** The tallest board seen of the bonus: Force 5 opens a full 5×5 (the partner's web page). */
const MAX_ROWS = 5;

export type CollectorRespinConfig = {
	hw: HoldAndWinWireConfig;
	/** `betOptions[0]`'s cost: the base total bet is `gameCost × betPerLine`. */
	gameCost: number;
	/** The base game's rows (`window.rows`). */
	rows: number;
};

type BootConfig = {
	symbols?: unknown;
	holdAndWin?: unknown;
	bonusModes?: unknown;
	potsOverlay?: unknown;
	match3?: unknown;
	gameCost?: unknown;
	betOptions?: unknown;
	window?: { rows?: unknown };
};

/** `jackpots {MINI: 25, …}` — each tier × the base total bet. */
const jackpotTiers = (ctx: unknown) =>
	Object.entries((ctx ?? {}) as Record<string, unknown>).flatMap(([name, multiplier]) =>
		typeof multiplier === 'number' && multiplier > 0 ? [{ name, multiplier }] : [],
	);

/**
 * The partner's collector respin game, recognised from its boot `config`: it deals `COIN` and
 * `COLLECT` and sends none of our own blocks. Null for every other server, so nothing else changes.
 * `events` is the boot answer, whose `jackpots` names the tiers.
 */
export const readCollectorRespinConfig = (
	boot: unknown,
	events: readonly WireEvent[] | undefined,
): CollectorRespinConfig | null => {
	const cfg = (boot ?? {}) as BootConfig;
	const symbols = Array.isArray(cfg.symbols) ? cfg.symbols : [];
	if (!symbols.includes(COIN) || !symbols.includes(COLLECT)) return null;
	if (cfg.holdAndWin || cfg.bonusModes || cfg.potsOverlay || cfg.match3) return null;
	const options = Array.isArray(cfg.betOptions) ? cfg.betOptions : [];
	const gameCost =
		typeof cfg.gameCost === 'number' && cfg.gameCost > 0
			? cfg.gameCost
			: typeof options[0] === 'number' && options[0] > 0
				? options[0]
				: 0;
	const rows = typeof cfg.window?.rows === 'number' ? cfg.window.rows : 3;
	return {
		gameCost,
		rows,
		hw: {
			wire: HOLD_AND_WIN_WIRE,
			bonus: 'respin',
			roles: { [COIN]: ['coin', 'jackpot'], [COLLECT]: ['collector'] },
			blank: BLANK,
			jackpots: jackpotTiers(events?.find((e) => e.event === 'jackpots')?.context),
			stickiness: 'collectorsOnly',
			expansion: { startRows: rows, maxRows: Math.max(MAX_ROWS, rows) },
		},
	};
};

type Position = { reel: number; row: number };
type WireCell = Position & { symbol: string; value?: number; jackpot?: string };

const ENHANCEMENT_FLAGS = [
	['expand', 'extraRow'],
	['boost', 'boost'],
	['powerFive', 'superBonus'],
	['multiply', 'multiply'],
	['respin', 'extraRespins'],
] as const;

/** The five flags, as `{expand, boost, powerFive, multiply, respin}` or the bit string `"00011"`. */
const enhancementsOf = (flags: unknown): string[] | undefined => {
	if (typeof flags === 'string' && /^[01]{5}$/.test(flags))
		return ENHANCEMENT_FLAGS.filter((_, i) => flags[i] === '1').map(([, kind]) => kind);
	if (!flags || typeof flags !== 'object') return undefined;
	const set = flags as Record<string, unknown>;
	return ENHANCEMENT_FLAGS.filter(([flag]) => set[flag] === true || Number(set[flag]) === 1).map(
		([, kind]) => kind,
	);
};

const isBoard = (v: unknown): v is string[][] =>
	Array.isArray(v) && v.every((reel) => Array.isArray(reel));

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

const isCoin = (text: string) => text === COIN || text.startsWith(`${COIN}_`);
const isCollector = (text: string) => text === COLLECT || text.startsWith(`${COLLECT}_`);

/**
 * One round's events, in the partner's order → ours, in the order our wire sends them. Pure over the round: the facade translates a round's whole event
 * stream at once (a resume replays it from `seq` 0), so the state below starts fresh each call.
 */
export const normalizeCollectorRespin = (
	config: CollectorRespinConfig,
	events: readonly WireEvent[],
): WireEvent[] => {
	const out: WireEvent[] = [];
	const { hw } = config;
	let base = 0;

	const cellText = (text: string): string => {
		if (text.startsWith(`${COIN}_`)) return `${COIN}:${text.slice(COIN.length + 1)}`;
		if (text.startsWith(`${COLLECT}_`)) {
			const cents = Number(text.slice(COLLECT.length + 1));
			return Number.isFinite(cents) && base > 0 ? `${COLLECT}:${round6(cents / base)}` : COLLECT;
		}
		return text;
	};
	const boardOf = (board: string[][]) => board.map((reel) => reel.map(cellText));
	const wireCell = (text: string, reel: number, row: number): WireCell => {
		const ours = cellText(text);
		const colon = ours.indexOf(':');
		if (colon === -1) return { reel, row, symbol: ours };
		const symbol = ours.slice(0, colon);
		const rest = ours.slice(colon + 1);
		const value = Number(rest);
		return Number.isFinite(value)
			? { reel, row, symbol, value }
			: { reel, row, symbol, jackpot: rest };
	};
	const cellsWhere = (board: string[][], keep: (text: string) => boolean): WireCell[] =>
		board.flatMap((reel, r) =>
			reel.flatMap((text, row) => (keep(text) ? [wireCell(text, r, row)] : [])),
		);
	const at = (board: string[][] | undefined, p: Position) => board?.[p.reel]?.[p.row];
	const cents = (value: number) => Math.round(value * base);
	const isSpecial = (text: string | undefined) => !!text && (isCoin(text) || isCollector(text));
	/**
	 * The coins and collectors the server ADDED after the deal (a surprise trigger): on the board
	 * after the spin but not on `playWindow`. A collector is bare, as it is before its first collect.
	 */
	const toppedUp = (dealt: string[][], after: string[][]): WireCell[] =>
		after.flatMap((reel, r) =>
			reel.flatMap((text, row) =>
				isSpecial(text) && !isSpecial(dealt[r]?.[row])
					? [wireCell(isCollector(text) ? COLLECT : text, r, row)]
					: [],
			),
		);

	// The bonus, as the facade must restate it after every respin.
	let inBonus = false;
	let start = 0;
	let left = 0;
	let played = 0;
	let rows: number | undefined;
	let enhancements: string[] | undefined;
	let collectors: WireCell[] = [];

	const snapshot = () => ({
		cells: collectors,
		start,
		left,
		played,
		banked: 0,
		activeModifiers: ['collector'],
		...(rows !== undefined ? { rows } : {}),
		...(enhancements ? { enhancements } : {}),
	});

	// The first bonus board, and its height: the rows an Expand (or Force 5) opened at entry.
	const firstBonusBoard = (() => {
		const entry = events.findIndex((e) => e.event === 'enterBonus');
		if (entry === -1) return undefined;
		const board = events
			.slice(entry + 1)
			.find((e) => (e.event === 'playWindow' || e.event === 'playedSpin') && isBoard(e.context));
		return board?.context as string[][] | undefined;
	})();
	const firstBonusRows = (() => {
		const height = firstBonusBoard ? Math.max(...firstBonusBoard.map((reel) => reel.length)) : 0;
		return height > 0 ? height : undefined;
	})();

	/*
	 * Where the wire numbers the rows an Expand (or Force 5) opened. Our board keeps the base rows
	 * where they were and numbers the opened ones after them (the reducer's "a held cell's row never
	 * changes"). The partner's wire numbers the opened rows FIRST, because they go on top: in their
	 * 2026-11-13 rounds the entry collector at row 0 of the 3-row board is at row 1 of Expand's 4-row
	 * one and at row 2 of Force 5's 5-row one. Read off the round where it can be (the shift that
	 * seats the entry's collectors on a collector of the first bonus board), else that convention.
	 */
	let rowShift = 0;
	const seatRowShift = (entryCollectors: readonly Position[], height: number) => {
		const opened = height - config.rows;
		if (opened <= 0 || !firstBonusBoard) return 0;
		const seated = (shift: number) =>
			entryCollectors.filter((c) =>
				isCollector(at(firstBonusBoard, { ...c, row: c.row + shift }) ?? ''),
			).length;
		return seated(0) > seated(opened) ? 0 : opened;
	};
	/*
	 * Wire row → ours. The opened rows sit ABOVE the base rows on their board (the partner,
	 * 2026-11-13: rows count top-down, and Expand's row and both of Force 5's go on top), so the wire's
	 * row 0 is the opened row furthest from the base rows: our last. Ours number the opened rows
	 * outward from the base rows, the order an unlocking board opens them, which a Game Config
	 * `addRowsAt: 'above'` draws upward (`respinSeatRow`).
	 */
	const ourRow = (row: number) => {
		if (!inBonus || rowShift === 0 || rows === undefined) return row;
		const base = rows - rowShift;
		return row >= rowShift ? row - rowShift : base + (rowShift - 1 - row);
	};
	const ourBoard = (board: string[][]) => {
		if (!inBonus || rowShift === 0 || rows === undefined) return board;
		return board.map((reel) => {
			const seated = [...reel];
			reel.forEach((text, row) => (seated[ourRow(row)] = text));
			return seated;
		});
	};

	type Segment = {
		head: WireEvent[];
		dealt?: string[][];
		final?: string[][];
		collected?: string[][];
		pays: (Position & { pay: number; value: unknown })[];
		collects: (Position & { pay: number })[];
		hits: WireEvent[];
		trigger?: Ctx;
		awarded?: unknown;
		enter?: Ctx;
		retrigger: boolean;
		bonusSpin?: Ctx;
		spinsOver: boolean;
		bonusWin?: number;
		/** `surpriseTrigger`: the server topped the dealt board up to a trigger. */
		surprise?: Ctx;
		tail: WireEvent[];
	};
	const fresh = (): Segment => ({
		head: [],
		pays: [],
		collects: [],
		hits: [],
		retrigger: false,
		spinsOver: false,
		tail: [],
	});

	const coinsCollected = (seg: Segment, board: string[][]) =>
		seg.pays.map((p) => {
			const text = at(board, p) ?? '';
			const cell = wireCell(isCoin(text) ? text : `${COIN}_${String(p.value)}`, p.reel, p.row);
			return cell.jackpot !== undefined
				? { ...cell, amount: p.pay }
				: { ...cell, value: round6(p.pay / base), amount: p.pay };
		});

	const jackpotWins = (
		cells: (WireCell & { amount: number })[],
		source: 'collect' | 'instantCollect',
	) =>
		cells.flatMap((c) =>
			c.jackpot !== undefined
				? [
						{
							event: 'jackpotWin',
							context: {
								tier: c.jackpot,
								amount: c.amount,
								source,
								banked: false,
								cell: { reel: c.reel, row: c.row },
							},
						},
					]
				: [],
		);

	/** A collector's running total off a board, `COLLECT_<cents>`; undefined for a bare `COLLECT`. */
	const totalCents = (text: string | undefined) => {
		const total = text?.startsWith(`${COLLECT}_`) ? Number(text.slice(COLLECT.length + 1)) : NaN;
		return Number.isFinite(total) ? total : undefined;
	};

	/** Each collector's `collect`, with its value read off the board after the collect. */
	const collectsOf = (seg: Segment, before: WireCell[], after: string[][] | undefined) => {
		const board = seg.dealt ?? seg.final ?? [];
		const coins = coinsCollected(seg, board);
		return {
			coins,
			events: seg.collects.flatMap((c) => {
				const was = before.find((h) => h.reel === c.reel && h.row === c.row) ?? {
					reel: c.reel,
					row: c.row,
					symbol: COLLECT,
				};
				// `collect.pay` is the collector's NEW total (the partner, 2026-11-13), as its
				// `COLLECT_<cents>` on the board after the collect reads.
				const afterCents = totalCents(at(after, c)) ?? c.pay;
				return [
					{
						event: 'coinCollect',
						context: {
							collector: was,
							level: 1,
							cells: coins,
							value: round6(afterCents / base),
						},
					},
				];
			}),
		};
	};

	const flush = (seg: Segment) => {
		out.push(...seg.head);
		const board = seg.dealt ?? seg.final;
		const after = seg.collected ?? seg.final ?? board;
		if (board) out.push({ event: 'playedSpin', context: boardOf(board) });

		if (!inBonus) {
			const entering = seg.enter !== undefined || seg.trigger !== undefined;
			const added = board && after && after !== board ? toppedUp(board, after) : [];
			if (added.length)
				out.push({
					event: 'featureTopUp',
					context: {
						cells: added,
						...(typeof seg.surprise?.state === 'number' ? { state: seg.surprise.state } : {}),
					},
				});
			const dealtCollectors = [
				...(board ? cellsWhere(board, isCollector) : []),
				...added.filter((c) => c.symbol === COLLECT),
			].sort((a, b) => a.reel - b.reel || a.row - b.row);
			if (!entering && seg.collects.length) {
				const coins = coinsCollected(seg, board ?? []);
				const sum = seg.collects.reduce((s, c) => s + c.pay, 0);
				out.push({
					event: 'coinInstantCollect',
					context: {
						specials: dealtCollectors,
						multiplier: 1,
						times: Math.max(1, seg.collects.length),
						cells: coins,
						amount: seg.bonusWin ?? sum,
						collectors: seg.collects.map((c) => ({
							reel: c.reel,
							row: c.row,
							symbol: COLLECT,
							value: round6((totalCents(at(after, c)) ?? c.pay) / base),
							amount: c.pay,
						})),
					},
				});
				out.push(...jackpotWins(coins, 'instantCollect'));
			}
			if (entering) {
				enhancements =
					enhancementsOf(seg.awarded) ??
					enhancementsOf(seg.trigger?.bonus) ??
					enhancementsOf(seg.enter?.bonusTriggers) ??
					[];
				const opensRows = enhancements.includes('extraRow') || enhancements.includes('superBonus');
				rows = opensRows
					? Math.min(
							hw.expansion?.maxRows ?? MAX_ROWS,
							firstBonusRows ?? config.rows + (enhancements.includes('superBonus') ? 2 : 1),
						)
					: undefined;
				start = typeof seg.enter?.left === 'number' ? seg.enter.left : 0;
				left = start;
				played = 0;
				out.push({
					event: 'spinTrigger',
					context: { bonus: seg.trigger?.bonus ?? 'respin', spins: seg.trigger?.spins ?? [] },
				});
				out.push({
					event: 'holdAndWinTrigger',
					context: {
						cause: 'run',
						cells: dealtCollectors,
						respins: start,
						stickiness: 'collectorsOnly',
						activeModifiers: ['collector'],
						...(rows !== undefined ? { expansion: { rows, maxRows: rows } } : {}),
						enhancements,
					},
				});
				const { coins, events: collected } = collectsOf(seg, dealtCollectors, after);
				out.push(...collected, ...jackpotWins(coins, 'collect'));
				if (collected.length && coins.length)
					out.push({
						event: 'cellsCleared',
						context: { reason: 'collected', cells: coins.map(({ reel, row }) => ({ reel, row })) },
					});
				collectors = after ? cellsWhere(after, isCollector) : dealtCollectors;
				rowShift = rows === undefined ? 0 : seatRowShift(collectors, rows);
				out.push({ event: 'enterBonus', context: { holdAndWin: snapshot() } });
				inBonus = true;
			}
			out.push(...seg.tail);
			return;
		}

		// A respin.
		const held = new Set(collectors.map((c) => `${c.reel}:${c.row}`));
		const landed = board
			? cellsWhere(board, (text) => isCoin(text) || isCollector(text)).filter(
					(c) => !held.has(`${c.reel}:${c.row}`),
				)
			: [];
		if (landed.length) out.push({ event: 'coinsLand', context: { cells: landed } });
		out.push(...seg.hits);
		const before = [...collectors, ...landed.filter((c) => c.symbol === COLLECT)];
		const { coins, events: collected } = collectsOf(seg, before, after);
		out.push(...collected, ...jackpotWins(coins, 'collect'));
		if (collected.length && coins.length)
			out.push({
				event: 'cellsCleared',
				context: { reason: 'collected', cells: coins.map(({ reel, row }) => ({ reel, row })) },
			});
		if (after) {
			collectors = cellsWhere(after, isCollector);
			const height = Math.max(...after.map((reel) => reel.length));
			if (rows !== undefined || height > config.rows) rows = Math.max(rows ?? 0, height);
		}
		const spin = seg.bonusSpin;
		if (spin) {
			const nextLeft = typeof spin.left === 'number' ? spin.left : Math.max(0, left - 1);
			const reset = seg.retrigger || nextLeft >= left;
			played = typeof spin.played === 'number' ? spin.played : played + 1;
			left = nextLeft;
			if (left > start) start = left;
			out.push({ event: 'respinUpdate', context: { left, played, start, reset } });
			out.push({ event: 'playedBonusSpin', context: { holdAndWin: snapshot() } });
		}
		if (seg.spinsOver) {
			const tally = collectors.map((c) => ({ ...c, amount: cents(c.value ?? 0) }));
			out.push({
				event: 'holdAndWinEnd',
				context: {
					cells: tally,
					banked: 0,
					total: tally.reduce((sum, c) => sum + c.amount, 0),
				},
			});
			out.push({ event: 'playedBonusSpins', context: {} });
			inBonus = false;
			collectors = [];
			rows = undefined;
			rowShift = 0;
		}
		out.push(...seg.tail);
	};

	let seg = fresh();
	const hasBoard = () => seg.dealt !== undefined || seg.final !== undefined;
	for (const e of events) {
		const ctx = (e.context ?? {}) as Ctx;
		if ((e.event === 'spinStart' || e.event === 'playWindow') && hasBoard()) {
			flush(seg);
			seg = fresh();
		}
		switch (e.event) {
			case 'bet': {
				const perLine = typeof ctx.betPerLine === 'number' ? ctx.betPerLine : 0;
				base = config.gameCost * perLine || (typeof ctx.total === 'number' ? ctx.total : 0);
				seg.head.push({ event: 'bet', context: { ...ctx, baseTotal: base } });
				break;
			}
			case 'jackpots': {
				for (const tier of jackpotTiers(ctx)) {
					const known = hw.jackpots.find((j) => j.name === tier.name);
					if (known) known.multiplier = tier.multiplier;
					else hw.jackpots.push(tier);
				}
				break;
			}
			case 'playWindow':
				if (isBoard(e.context)) seg.dealt = ourBoard(e.context);
				break;
			case 'playedSpin':
				if (isBoard(e.context)) seg.final = ourBoard(e.context);
				break;
			case 'collectWindow':
				if (isBoard(e.context)) seg.collected = ourBoard(e.context);
				break;
			case 'surpriseTrigger':
				seg.surprise = ctx;
				break;
			case 'cellPayAmount':
				if (typeof ctx.reel === 'number' && typeof ctx.row === 'number')
					seg.pays.push({
						reel: ctx.reel,
						row: ourRow(ctx.row),
						pay: typeof ctx.pay === 'number' ? ctx.pay : 0,
						value: ctx.value,
					});
				break;
			case 'collect':
				if (typeof ctx.reel === 'number' && typeof ctx.row === 'number')
					seg.collects.push({
						reel: ctx.reel,
						row: ourRow(ctx.row),
						pay: typeof ctx.pay === 'number' ? ctx.pay : 0,
					});
				break;
			case 'boost':
			case 'multiplier': {
				const kind = e.event === 'boost' ? 'boost' : 'multiply';
				const field = e.event === 'boost' ? 'boost' : 'multiplier';
				if (!Array.isArray(e.context)) {
					seg.hits.push({ event: 'enhancementMiss', context: { kind } });
					break;
				}
				for (const hit of e.context as Ctx[]) {
					const from = typeof hit.startingPay === 'number' ? hit.startingPay : 0;
					const by = typeof hit[field] === 'number' ? (hit[field] as number) : 0;
					const to = kind === 'boost' ? from + by : from * by;
					seg.hits.push({
						event: 'enhancementHit',
						context: {
							kind,
							by: kind === 'boost' ? round6(by / base) : by,
							cells: [
								{
									reel: hit.reel,
									row: typeof hit.row === 'number' ? ourRow(hit.row) : hit.row,
									from: round6(from / base),
									to: round6(to / base),
								},
							],
						},
					});
				}
				break;
			}
			case 'bonusWin':
				if (!inBonus && typeof ctx.pay === 'number') seg.bonusWin = ctx.pay;
				break;
			case 'spinTrigger':
				seg.trigger = ctx;
				break;
			case 'boostsAwarded':
				seg.awarded = e.context;
				break;
			case 'boostsEnabled':
				if (!enhancements) enhancements = enhancementsOf(e.context);
				break;
			case 'enterBonus':
				seg.enter = ctx;
				break;
			case 'retrigger':
				seg.retrigger = true;
				break;
			case 'playedBonusSpin':
				seg.bonusSpin = ctx;
				break;
			case 'playedBonusSpins':
				seg.spinsOver = true;
				break;
			case 'bonusSymbol':
				break;
			// The facade draws a line win only when it reads it before the board's `playedSpin`.
			case 'spinWin':
				seg.head.push(e);
				break;
			case 'gameEnd':
				// The feature's end is its last respin's, even when a server leaves out the summary.
				if (inBonus || seg.enter) seg.spinsOver = true;
				seg.tail.push(e);
				break;
			case 'gameRoundOver':
				seg.tail.push(e);
				break;
			default:
				if (hasBoard()) seg.tail.push(e);
				else seg.head.push(e);
		}
	}
	flush(seg);
	return out;
};
