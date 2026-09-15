/**
 * Invisible Flow — apps/lines game-side EFFECT registry (Phase 5, design doc §3, §9 row 5,
 * §11.4).
 *
 * The choreography vocabulary (Broadcast / Sequence / Parallel / Delay / Branch / ForEach)
 * expresses the emitter timeline of a book event, but a coded `bookEventHandlerMap` handler
 * also does NON-emitter work the bounded vocabulary deliberately cannot express: state
 * mutations (`stateGame.gameType = …`, `stateBet.winBookEventAmount = …`, the `stateUi.*`
 * flags), board operations (`enhancedBoard.spin(…)`, the Book-of column morph), and the
 * conditional win-level sound clusters (which read LIVE state, not the trigger payload).
 *
 * Each such leaf is lifted VERBATIM from `bookEventHandlerMap.ts` into a NAMED effect here —
 * the `declare ≠ implement` bridge (design doc §3), the exact analogue of
 * `registerComponentActions`. The FlowDoc *declares* `{ kind: 'effect', name, payload }`; this
 * module *implements* it. Because the bodies are the coded leaves unchanged, an effect is
 * byte-identical to its coded counterpart BY CONSTRUCTION — the migration reproduces, never
 * re-derives. This is NOT a scripting VM (§11.4): a CLOSED map of named effects whose code
 * lives in the game, never authored in the doc.
 *
 * Parity (§7): an effect is only invoked when the FlowDoc authors it; with no FlowDoc the
 * coded handler map runs unchanged. The effect bodies and the coded handler share the same
 * helpers below, so there is one source of truth for each leaf.
 */

import { runCameraEffect } from 'pixi-svelte';
import { isCameraEffectKind } from 'constants-shared/camera';
import { recordBookEvent, checkIsMultipleRevealEvents } from 'utils-book';
import {
	stateBet,
	stateUi,
	showMessage as showGameMessage,
	INFINITY_MARK,
	type GameMessageKind,
} from 'state-shared';
import { stateBonus, stateBonusDerived } from 'components-ui-html';
import { waitForResolve, waitForTimeout } from 'utils-shared/wait';
import { roundSkip } from 'utils-shared/skipToken';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
import { BOOK_AMOUNT_MULTIPLIER } from 'constants-shared/bet';
import { SECOND } from 'constants-shared/time';
import type { FlowEffect } from 'engine-flow';
import {
	formatWinText,
	resolveSymbolName,
	resolveToastTemplate,
	resolveWinLineMessage,
	symbolDrawsWinLine,
	wrapInlineImage,
} from 'engine-layout';

import { eventEmitter } from './eventEmitter';
import { playWildExplodeSound } from './soundBindings';
import { getFlowV2 } from './flowV2InterpreterHolder';
import { stateApp } from './stateApp';
import { type WinLevelData } from 'engine-game';
import { stateGame, stateGameDerived, getSymbolSeat, stackedScrollStrip } from './stateGame.svelte';
import { tumbleBoardCombined } from './stateTumble.svelte';
import { awaitCue, slamHold, SLAM_MESSAGE_HOLD_MS } from './unskippablePresentation';
import { buildAnticipationArming } from './anticipation';
import type { BookEvent, BookEventOfType } from './typesBookEvent';
import type { Position, SymbolName } from './types';
import type { WinLineShape } from '../components/WinLine.svelte';
import {
	activeBigTierThresholds,
	activeWinLevelData,
	activeWinModel,
	boardDimensions,
	paddingReels,
	paylineColor,
} from './gameConfig';
import {
	bakedSymbolNames,
	bakedWinLineConfig,
	bakedWinLineEnabled,
	bakedWinText,
} from '../editor-scenes';

// ---------------------------------------------------------------------------
// Shared leaves — the SAME helpers the coded handlers use. The coded
// `bookEventHandlerMap` and these effects both call into these, so each leaf has a
// single source of truth (parity by construction).
// ---------------------------------------------------------------------------

export const winLevelSoundsPlay = ({
	winLevelData,
}: {
	winLevelData: WinLevelData | undefined;
}) => {
	if (winLevelData?.alias === 'max') eventEmitter.broadcastAsync({ type: 'uiHide' });
	if (winLevelData?.sound?.sfx) {
		eventEmitter.broadcast({ type: 'soundOnce', name: winLevelData.sound.sfx });
	}
	if (winLevelData?.sound?.bgm) {
		eventEmitter.broadcast({ type: 'soundMusic', name: winLevelData.sound.bgm });
	}
	if (winLevelData?.type === 'big') {
		eventEmitter.broadcast({ type: 'soundLoop', name: 'sfx_bigwin_coinloop' });
	}
};

export const winLevelSoundsStop = () => {
	eventEmitter.broadcast({ type: 'soundStop', name: 'sfx_bigwin_coinloop' });
	if (stateBet.activeBetModeKey === 'SUPERSPIN' || stateGame.gameType === 'freegame') {
		// check if SUPERSPIN, when finishing a bet.
		eventEmitter.broadcast({ type: 'soundMusic', name: 'bgm_freespin' });
	} else {
		eventEmitter.broadcast({ type: 'soundMusic', name: 'bgm_main' });
	}
	eventEmitter.broadcastAsync({ type: 'uiShow' });
};

/**
 * An awaited PRESENTATION broadcast, raced against the round's slam token. EVERY awaited
 * `broadcastAsync` in this file must go through here: several of these holds are resolved ONLY by
 * a player tap (`PressToContinue`), so an un-raced one does not merely run slow on a slam — it
 * stalls the round outright until the player taps.
 *
 * The race lives here, per broadcast, and NOT around the whole effect registry
 * (`flowRuntime`/`flowV2Runtime` hand `flowEffect` to the interpreter directly). Racing the
 * registry would look like a tidier catch-all but would DETACH board-driving effects: on a
 * whole-feature skip `revealBoard` resolves instantly for all ten free spins, so ten reveals would
 * run concurrently on the same reels and the board would land on whichever finished last. Effects
 * that own the board must stay fully awaited; only presentation may be cut short.
 *
 * `awaitCue` applies the UNSKIPPABLE carve-out on top (`unskippablePresentation.ts`): inside the
 * book reveal / free-spin intro the wait is not raced at all, so a rig timeline can never be left
 * playing detached over the next spin. Player-gated cues keep racing there too.
 */
const awaitPresentation = (emitterEvent: Parameters<typeof eventEmitter.broadcastAsync>[0]) =>
	awaitCue(emitterEvent.type, eventEmitter.broadcastAsync(emitterEvent));

/** The awaited symbol-spine animation — the `winInfo` / `freeSpinTrigger` leaf. `color` (the paying
 *  line's authored colour, `#rrggbb`) is threaded onto the lit cells so a `winLine`-tinted highlight
 *  frame glows in that line's colour; absent ⇒ the frame renders untinted (byte-identical). */
export const animateSymbols = async ({
	positions,
	color,
}: {
	positions: Position[];
	color?: string;
}) => {
	eventEmitter.broadcast({ type: 'boardShow' });
	// The symbols are only PRESENTATION — the win amount is carried by `setTotalWin` / `setWin`,
	// which still run — so releasing early cannot drop a win.
	await awaitPresentation({
		type: 'boardWithAnimateSymbols',
		symbolPositions: positions,
		winLineColor: color,
	});
};

/**
 * The single source of truth for the `winInfo` WIN-LINE leaf — shared by the coded
 * `bookEventHandlerMap.winInfo` handler (win line + symbol animation) AND the `showWinLine` /
 * `hideWinLine` flow effects, so both draw byte-identically (parity by construction).
 *
 * For a LINE win the server reports the FULL payline path in `positions`, but only the leftmost
 * `kind` symbols form the paying combination (a left-to-right line starts on reel 1 and stops at the
 * first non-matching reel). Trace just those.
 *
 * A SCATTER / expanding-special win is different: `positions` already lists EXACTLY the paying cells
 * — and for the Book-of expanding special that is several cells per reel (whole columns), while
 * `kind` is the number of REELS covered, NOT the number of cells. Slicing to `kind` there keeps only
 * the first covered reel's cells and silently drops every other expanded column from the highlight
 * and the win line — the "only the first column paid" bug. So the slice is applied ONLY to a true
 * line win; a cluster win (any reel paying more than one cell — impossible for a single payline)
 * keeps all its positions.
 */
export const winningPositionsOf = (win: { positions: Position[]; kind: number }): Position[] => {
	const sorted = [...win.positions].sort((a, b) => a.reel - b.reel);
	const reelsSeen = new Set<number>();
	let isCluster = false;
	for (const position of sorted) {
		if (reelsSeen.has(position.reel)) {
			isCluster = true;
			break;
		}
		reelsSeen.add(position.reel);
	}
	return isCluster ? sorted : sorted.slice(0, win.kind);
};

/**
 * Whether a win draws the traced line + stamped amount + authored message: scatter pays
 * "anywhere" — not a line — so it's skipped, and the whole overlay is gated by the
 * Symbol-State-Machine toggle (defaults on, so an un-baked game keeps drawing it).
 *
 * The excluded-symbol rule lives in `engine-layout` (`symbolDrawsWinLine`) rather than as a
 * literal here, because the `/win-text` grid needs the SAME answer to avoid offering a cell that
 * can never render. One fact, one home.
 *
 * A SLAM DRAWS THE LINE TOO — just fast, not skipped (owner direction 2026-07-28). It draws
 * INSTANT-complete (`WinLine.svelte` gates its animated reveal on `!roundSkip.isSkipped()`) and stays
 * on screen for the slam's minimum symbol-hold (`SLAM_SYMBOL_HOLD_MS`, held by the following
 * `animateWinSymbols`), so a slammed win still shows its line + stamped amount + message — the whole
 * point of "a slam shows the win faster, it doesn't hide it". This gate is therefore NO LONGER
 * time-dependent (it ignores the slam token); `hideWinLine` stays unconditional anyway, which is
 * harmless. Reverses the earlier "a slammed spin draws no line" choice.
 */
export const winLineEnabledForWin = (win: { symbol: SymbolName }): boolean =>
	symbolDrawsWinLine(win.symbol) && bakedWinLineEnabled();

/**
 * The symbol + count of the win the flow most recently ANNOUNCED (`showWinLine`), so the toast that
 * follows it in the same `winInfo` iteration can name that symbol even when its own `symbol` pin is
 * unwired.
 *
 * This exists because the `showMessage` node predates the `symbol` param: every FlowDoc authored
 * before it — including the ones already published — wires only `amount` + `kind`, and without a
 * symbol the toast can say nothing about WHAT paid, which is the entire point of the named text. A
 * graph re-saved with the pin wired passes its own symbol and never consults this.
 *
 * Deliberately narrow, because a stale value would put the wrong word in an unrelated message:
 * - Only `showWinLine` writes it — the per-win leaf, fed the current forEach item.
 * - It is only read when the toast's `kind` MATCHES the remembered one, so a generic
 *   `showMessage` (no count, or a different count) can never pick it up.
 */
let lastWinSymbol: { symbol: SymbolName; kind: number } | undefined;

const rememberWinSymbol = (symbol: SymbolName, kind: number): void => {
	lastWinSymbol = symbol ? { symbol, kind } : undefined;
};

const rememberedWinSymbol = (kind: number | undefined): SymbolName | undefined =>
	kind !== undefined && lastWinSymbol?.kind === kind ? lastWinSymbol.symbol : undefined;

/**
 * The free-spin count the CURRENT book awards (`freeSpinTrigger.totalFs`), looked up ahead of the
 * trigger spin's `winInfo` by `dispatchBookEvent` (game/utils.ts) — because the scatter's `winInfo`
 * entry arrives BEFORE `freeSpinTrigger` yet is the moment we announce the award on the base board
 * (see {@link showWinInfoMessage}). `undefined` on any book that doesn't trigger free spins, so a
 * plain zero-pay entry stays suppressed. Not load-bearing game state — display only, one set point.
 */
let pendingScatterAwardFs: number | undefined;

/** Set by `dispatchBookEvent` before a `winInfo`: the round's awarded free-spin count, or undefined. */
export const setPendingScatterAwardFs = (totalFs: number | undefined): void => {
	pendingScatterAwardFs = totalFs;
};

/**
 * Show the info message for ONE win — the text half of the win-info presentation, resolved through
 * the Invisible Win Text contract (`resolveToastTemplate` picks the branch matching the vars
 * supplied; `formatWinText` localizes the template BEFORE interpolating, the order that makes it
 * translatable). The SHARED leaf behind both the flow-authored `showMessage` effect and the coded
 * `winInfo` handler's slam summary, so a slammed spin says exactly what an authored toast says.
 *
 * Returns whether anything was actually shown, so a caller can hold only for a real message.
 *
 * FAULT-ISOLATED, because this runs INSIDE the awaited book-event chain. Everything it touches is
 * data the game does not control end-to-end — `Intl` via the currency formatter (a `RangeError` on
 * an unexpected currency/locale), the baked win-text doc, an authored template — and a throw here
 * propagates out of the handler, out of `sequence`, and ABORTS `playBookEvents`. Every remaining
 * book event is then silently dropped: the free-spin counter freezes on the spin the round died on,
 * `freeSpinEnd` never runs, and the game is left in `freegame` with no outro. A toast is pure
 * presentation and must never cost the player the rest of the round, so it degrades to "showed
 * nothing" and reports on the console instead.
 */
export const showWinInfoMessage = ({
	amount,
	kind,
	symbol,
	messageKind = 'info',
	durationMs,
}: {
	amount?: number;
	kind?: number;
	symbol?: SymbolName;
	messageKind?: GameMessageKind;
	durationMs?: number;
}): boolean => {
	try {
		// A ZERO-PAYOUT entry is never a coin win — it is the feature TRIGGER (the scatter/book match
		// that pays no coins, only free spins). The generic toast would render the nonsensical "You win
		// $0.00 with N Scatters".
		if (amount === 0) {
			// Under a v2 flow that OWNS `freeSpinTrigger`, that event immediately mounts the intro
			// CONTAINER (a screen takeover), so a toast fired there is never seen — the only place the
			// player still sees the info bar is HERE, on the base board while the scatters animate (the
			// same slot the old "$0.00" toast used). So repurpose this zero-pay scatter toast into the
			// free-spin AWARD line. `pendingScatterAwardFs` is the round's `freeSpinTrigger.totalFs`, set
			// in `dispatchBookEvent` (game/utils.ts); `gameType==='basegame'` scopes it to the TRIGGER
			// spin, never a free-spin retrigger's scatters. The coded (non-flow) path keeps showing this
			// from the `freeSpinTrigger` handler instead, so this branch is flow-only to avoid doubling.
			const flowOwnsTrigger = getFlowV2()?.ownsEvent('freeSpinTrigger') ?? false;
			if (
				flowOwnsTrigger &&
				symbol !== undefined &&
				!symbolDrawsWinLine(symbol) &&
				pendingScatterAwardFs !== undefined &&
				stateGame.gameType === 'basegame'
			) {
				const scatters = kind ?? 0;
				const fs = pendingScatterAwardFs;
				const text = `${scatters} ${scatters === 1 ? 'Scatter' : 'Scatters'} award ${fs} Free ${
					fs === 1 ? 'Spin' : 'Spins'
				}`;
				showGameMessage(text, { kind: 'info', durationMs });
				return true;
			}
			return false;
		}
		const vars = {
			amount: amount === undefined ? undefined : bookEventAmountToCurrencyString(amount),
			count: kind,
			symbol,
			// The word the player reads for this symbol, inflected for `kind` and localized. Absent
			// when the caller doesn't know which symbol paid — `resolveToastTemplate` then picks a
			// branch that doesn't name one, instead of printing a bare `{symbolName}`.
			symbolName:
				symbol === undefined ? undefined : resolveSymbolName(bakedSymbolNames(), symbol, kind),
		};
		const winText = bakedWinText();
		// An EXPANDED win says something different, because `kind` counts REELS there, not the icons
		// the expansion painted (the player counts twelve boots under a sentence saying four). Gated
		// on the SPIN — `expandedSymbol` is set only by this spin's `expandBookColumns` — and on the
		// symbol, so a low symbol paying alongside in the same free spin stays an ordinary line win.
		const expanded = symbol !== undefined && stateGame.expandedSymbol === symbol;
		const template = resolveToastTemplate(winText, { ...vars, expanded });
		if (!template) return false;
		const text = formatWinText(template, vars);
		if (!text) return false;
		// "Show symbol as image" (Invisible Win Text): build a RICH twin of the toast where the
		// `{symbolName}` token is an inline sprite of the paying symbol. `text` (the written name)
		// stays the clean fallback so the coded HTML toast + any string reader keep the name; only the
		// info-bar Pixi node renders `richText`. Applied only when the toggle is on AND this branch
		// actually named a symbol (`amountOnly` has none to swap). The inline image degrades to the
		// name at render time when a symbol has no sprite art (see `registerInlineImageResolver`).
		const richText =
			winText.toast.symbolAsImage && symbol !== undefined && vars.symbolName !== undefined
				? formatWinText(template, {
						...vars,
						symbolName: wrapInlineImage(symbol, vars.symbolName),
					})
				: undefined;
		showGameMessage(text, { kind: messageKind, durationMs, richText });
		return true;
	} catch (error) {
		console.error('showWinInfoMessage failed; the round continues without a message', error);
		return false;
	}
};

/** Row index of the padding row above the visible board — a book `position.row` indexes the PADDED
 *  strip (one buffer row top and bottom), so the lattice row it seats is one less. */
const PADDING_ROW = -1;

/**
 * The board-local centre points the line traces: the cell's SEAT x + the live symbol centre Y.
 * Mounted inside WinLine's <BoardContainer> so these align with the rendered reels.
 */
export const winLinePointsFor = (positions: Position[]) =>
	positions.map((position) => ({
		x: getSymbolSeat(position.reel, position.row + PADDING_ROW).x,
		y: stateGame.board[position.reel].reelState.symbols[position.row].symbolY(),
	}));

/**
 * WHICH SHAPE the win line draws for a win — decided by the project's declared win model
 * (`/config` → `winModel`, Phase D of docs/design/game-type-templates.md) rather than by counting
 * duplicate reels, because a duplicate reel means something different in each model:
 *
 *   - `'path'`  — the connected polyline through the paying cells. An ordinary payline.
 *   - `'cells'` — a disconnected vertical bar PER PAYING CELL. The Book-of expanding special fills
 *     whole reels, so its scatter-style win carries several cells per column; tracing those as one
 *     connected polyline draws an unreadable criss-cross zig-zag. Bars stacked in a reel touch, so
 *     an expanded column still reads as one continuous bar.
 *   - `'reels'` — ONE merged bar per winning REEL, spanning that reel's winning cells. A ways win
 *     has no line geometry at all: it pays by whole-reel participation, so the readable shape is
 *     "these reels pay", not a dash on each individual cell (and certainly not a zig-zag).
 *
 * The duplicate-reel heuristic survives ONLY inside the `lines` arm, which is the case it was
 * written for: a lines game whose special symbol expands (Book of Borut). Every ordinary payline
 * has exactly one cell per reel ⇒ `'path'` ⇒ the connected diagonal is unchanged.
 */
export const winLineShapeFor = (positions: Position[]): WinLineShape => {
	switch (activeWinModel().type) {
		case 'ways':
			return 'reels';
		case 'cluster':
		case 'scatter':
			return 'cells';
		default:
			return hasRepeatedReel(positions) ? 'cells' : 'path';
	}
};

/** Whether any reel contributes more than one paying cell — impossible for a single payline, and
 *  the signature of an expanding-special win on a lines game. */
const hasRepeatedReel = (positions: Position[]): boolean => {
	const seen = new Set<number>();
	for (const position of positions) {
		if (seen.has(position.reel)) return true;
		seen.add(position.reel);
	}
	return false;
};

/**
 * The FULL payline's points (all reels), for the optional "Show full payline" underlay drawn
 * beneath the winning segment (Invisible Symbols State Machine → `winLine.line.fullPayline`).
 * Returns `undefined` when the author hasn't enabled it, so parity is preserved and the caller
 * simply omits the field. The full path is `win.positions` sorted by reel — a superset of the
 * paying `winningPositionsOf`. Fed to `winLineShow.fullPoints`, which `WinLine.svelte` draws.
 */
export const winLineFullPointsFor = (win: { positions: Position[] }) => {
	if (!bakedWinLineConfig().line.fullPayline) return undefined;
	const full = [...win.positions].sort((a, b) => a.reel - b.reel);
	return full.length >= 2 ? winLinePointsFor(full) : undefined;
};

/**
 * The authored per-payline colour (Invisible Game Config) for a win, by its `meta.lineIndex`, fed
 * to `winLineShow.color`. `undefined` when the line isn't coloured (or no config authored it), so
 * `WinLine.svelte` falls back to the single Symbols-tool win-line colour — parity preserved. Shared
 * by all three win-line dispatch sites (coded handler, flow effect, resting cycle) so the drawn
 * line and the broadcast reusable colour always agree.
 */
export const winLineColorFor = (line: number | undefined): string | undefined => paylineColor(line);

/**
 * The single source of truth for the win line's TEXT — the `amount` stamp plus the authored
 * per-win `message` (Invisible Win Text). Shared by the coded `bookEventHandlerMap.winInfo`
 * handler and the `showWinLine` flow effect, exactly like `winLinePointsFor`, so both stamp
 * byte-identically (parity by construction).
 *
 * Both strings are AUTHORED templates resolved through `formatWinText`, which localizes the
 * template BEFORE interpolating — the order that makes them translatable (the composed string
 * never becomes the catalog key). `{amount}` interpolates the game's own currency formatter, so
 * it follows the URL's currency.
 *
 * Unauthored: `amountFormat` defaults to `'{amount}'` (the bare currency string this stamped
 * before) and the message defaults to empty ⇒ nothing drawn. Byte-identical to today.
 */
export const winLineTextFor = ({
	symbol,
	kind,
	amount,
	line,
}: {
	symbol: SymbolName;
	kind: number;
	amount: number;
	line?: number;
}): {
	amount: string;
	message: string;
	amountValue: number;
	amountAt: (value: number) => string;
} => {
	const winText = bakedWinText();
	const vars = {
		count: kind,
		symbol,
		symbolName: resolveSymbolName(bakedSymbolNames(), symbol, kind),
		line,
		amount: bookEventAmountToCurrencyString(amount),
	};
	return {
		amount: formatWinText(winText.amountFormat, vars),
		message: formatWinText(resolveWinLineMessage(winText, symbol, kind).template, vars),
		// The count's TARGET (raw book units) and a re-formatter for every tick in between. The stamp
		// is re-rendered through the SAME authored `amountFormat` + currency formatter as the final
		// value, so a project's template and currency govern the counting frames too rather than only
		// the one that lands.
		amountValue: amount,
		amountAt: (value: number) =>
			formatWinText(winText.amountFormat, {
				...vars,
				amount: bookEventAmountToCurrencyString(value),
			}),
	};
};

/** The fields any win-line dispatch site needs from a win — the shape shared by a book `winInfo`
 *  entry and a recorded win-cycle entry, so {@link showAllWinLines} takes either. */
type WinLineWin = {
	symbol: SymbolName;
	kind: number;
	positions: Position[];
	win: number;
	meta?: { lineIndex?: number };
};

/**
 * EVERY win the CURRENT BOARD pays, gathered from the whole book — the set {@link showAllWinLines}
 * draws when `bookEvent` is the board's FIRST `winInfo`, and an empty list for every later one.
 *
 * WHY LOOK AHEAD. How many `winInfo` events a spin emits is a property of the SOURCE BOOK, not of
 * the game: the reference books put every win in ONE event (`wins: [w1, w2, w3]`), while the
 * Play4Fun facade — what the shipped games run on — flushes one event PER win. Drawing only
 * `bookEvent.wins` would therefore land the lines one whole symbol-celebration apart on exactly the
 * games that pay several, which is not "at the same time". Collecting the run of `winInfo` events
 * that belong to this board puts them all up a beat apart on both book shapes.
 *
 * The board's run ends at the next event that INVALIDATES it — a new `reveal` (the next free spin)
 * or a `tumbleBoard` (a cascade blows the paying cells away), the same two boundaries the resting
 * win cycle clears its recorded wins on. Everything else in between is presentation.
 *
 * Returns [] when an earlier `winInfo` in the same run already drew the set, so the lines are
 * stamped ONCE per board however many events carry them.
 */
export const winsOnThisBoard = (
	bookEvent: BookEventOfType<'winInfo'>,
	bookEvents: BookEvent[],
): WinLineWin[] => {
	const invalidates = (event: BookEvent) => event.type === 'reveal' || event.type === 'tumbleBoard';
	const at = bookEvents.indexOf(bookEvent);
	// Not in the list (a synthesised event): fall back to just this event's wins — one board, one
	// draw, which is what a lone event means.
	if (at < 0) return bookEvent.wins;
	for (let i = at - 1; i >= 0 && !invalidates(bookEvents[i]); i -= 1) {
		if (bookEvents[i].type === 'winInfo') return [];
	}
	const wins: WinLineWin[] = [];
	for (let i = at; i < bookEvents.length && !invalidates(bookEvents[i]); i += 1) {
		const event = bookEvents[i];
		if (event.type === 'winInfo') wins.push(...event.wins);
	}
	return wins;
};

/**
 * ALL-AT-ONCE WIN LINES — draw EVERY paying line of the round together, each in its own payline
 * colour, and leave them up (Invisible Symbols State Machine → "Show all win lines at once").
 *
 * The alternative to the default narration, which shows one line, animates its symbols, hides it,
 * and moves on. Here the lines are stamped out back-to-back — separated only by the authored
 * `allAtOnceDelay` beat, so they read as arriving together rather than in a queue — and NOTHING
 * hides them: `WinLine.svelte` ignores the per-win `winLineHide` in this mode, so the set survives
 * the symbol celebration and the resting board until the next spin clears it (`clearWinPresentation`).
 *
 * Broadcast, never awaited: an awaited animated draw would serialise the lines back into a queue,
 * which is exactly what this mode exists to avoid. Each line still traces at its authored speed —
 * they just trace at the same time.
 *
 * The per-win gate is the SAME `winLineEnabledForWin` the default path uses, so a scatter win still
 * draws no line and the overlay's master toggle still has the final say.
 *
 * Returns whether it drew anything, so a caller can tell "the set is on screen" from "nothing
 * qualified" (the resting cycle uses it to decide whether it owns a line to clear).
 */
export const showAllWinLines = async (
	wins: WinLineWin[],
	{ stamp = true }: { stamp?: boolean } = {},
): Promise<boolean> => {
	const { allAtOnceDelay } = bakedWinLineConfig().line;
	let drew = false;
	for (const win of wins) {
		if (!winLineEnabledForWin(win)) continue;
		const positions = winningPositionsOf(win);
		if (!positions.length) continue;
		// The beat BETWEEN two lines — never before the first, so the set starts the instant the win
		// does. A slam collapses it (`roundSkip.wait`), which is the right reading of "show me the
		// result now": every line appears in the same frame.
		if (drew) await roundSkip.wait(Math.max(0, allAtOnceDelay) * SECOND);
		drew = true;
		eventEmitter.broadcast({
			type: 'winLineShow',
			points: winLinePointsFor(positions),
			shape: winLineShapeFor(positions),
			fullPoints: winLineFullPointsFor(win),
			color: winLineColorFor(win.meta?.lineIndex),
			// `stamp: false` keeps the lines while dropping their amounts (the resting cycle's
			// `showText` switch). Empty strings ⇒ `WinLine.svelte` draws the line and stamps nothing.
			...(stamp
				? winLineTextFor({
						symbol: win.symbol,
						kind: win.kind,
						amount: win.win,
						line: win.meta?.lineIndex,
					})
				: { amount: '', message: '' }),
		});
	}
	return drew;
};

const winLevelDataOf = (winLevel: number): WinLevelData | undefined => activeWinLevelData(winLevel);

/**
 * THE BIG WIN'S RUN-UP — the win amount text counting up as the cue that the overlay is coming
 * (Invisible Symbols State Machine → "Count up to cue the big win").
 *
 * The round TOTAL is stamped in the middle of the reels and counted from zero to the SMALLEST
 * big-win threshold; the round holds for that count, then the stamp is hidden and the big-win
 * overlay comes up and carries the number the rest of the way to the total. The two halves of one
 * number, told by two renderers — which is why the cue stops exactly where the overlay starts.
 *
 * EVERY gate below is a parity gate: with the switch un-authored (or on a round that never reaches
 * a big tier, or on a project whose config declares none) this returns before broadcasting
 * anything, so the round is byte-identical to before. `awaitPresentation` → `broadcastAsync`
 * resolves on `Promise.all([])` when `WinLine` is not mounted, so an unmounted host degrades to a
 * no-op rather than hanging the round on a listener that will never answer.
 *
 * Shared by the coded `setWin` handler and the v2 `winShow` effect, exactly like `winLineTextFor` —
 * parity between the two dispatch paths by construction, not by two edits staying in step.
 */
export const cueBigWinCountUp = async ({
	amount,
	winLevelData,
}: {
	amount: number;
	winLevelData: WinLevelData | undefined;
}): Promise<void> => {
	const text = bakedWinLineConfig().text;
	if (!text.enabled || !text.countUp || !text.cueBigWin) return;
	if (winLevelData?.type !== 'big') return;
	// A slam means "show me the result now" — the overlay's own count-up still runs, so nothing is
	// lost by dropping the cue that introduces it.
	if (roundSkip.isSkipped()) return;
	// The SMALLEST big tier: the number at which the round became a big win, which is exactly where
	// the overlay takes over. A project with no big tiers has no such moment to cue.
	const threshold = activeBigTierThresholds()[0];
	if (!threshold) return;
	// Thresholds are bet-MULTIPLIERS; the book amount is fixed-point. Capped at the round's own
	// total so the cue can never count past the number it is introducing.
	const target = Math.min(threshold * BOOK_AMOUNT_MULTIPLIER, amount);
	if (target <= 0) return;
	const winText = bakedWinText();
	await awaitPresentation({
		type: 'winAmountCue',
		target,
		// The SAME authored `amountFormat` the line stamps use, with only `{amount}` bound — a total
		// has no symbol or line to name. `formatWinText` leaves an unknown token verbatim, which is
		// its documented behaviour, so a template that names one degrades to showing that token
		// rather than breaking the stamp.
		amountAt: (value: number) =>
			formatWinText(winText.amountFormat, { amount: bookEventAmountToCurrencyString(value) }),
	});
	eventEmitter.broadcast({ type: 'winAmountCueHide' });
};

/** A flow payload field as a real number, or `undefined` so the callee's own default applies. The
 *  payload is `Record<string, unknown>` fed from an authored doc, so a bare `as number` cast is an
 *  assumption, not a check — an unwired pin arrives `undefined` and a bad literal arrives a string. */
const numberOrUndefined = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/**
 * Coerce a sequential-stop knob payload into a PER-REEL override array (or null). A `list<float>`
 * from the Flow node is used as-is (indexed by reel); a lone number is broadcast to every reel; a
 * short array leaves later reels on the coded constant (the getter falls back per index). Anything
 * else ⇒ null ⇒ every reel uses the constant.
 */
const toReelOverrides = (value: unknown): number[] | null => {
	if (Array.isArray(value)) return value.length ? (value as number[]) : null;
	if (typeof value === 'number') return Array(boardDimensions().x).fill(value);
	return null;
};

/** Coerce a Flow payload confidence field onto the two-member enum, or `undefined` for "keep the
 *  current confidence" — an unwired pin arrives `undefined`, a junk literal is ignored (the payload
 *  is authored data, so a bare cast would let a bad string through). */
const toConfidence = (value: unknown): 'possible' | 'guaranteed' | undefined =>
	value === 'possible' || value === 'guaranteed' ? value : undefined;

/** A Flow payload boolean, or `fallback` when the pin is unwired/junk (only a real boolean counts). */
const boolOr = (value: unknown, fallback: boolean): boolean =>
	typeof value === 'boolean' ? value : fallback;

/**
 * The VISIBLE cells of a column, as explode positions.
 *
 * A column is a PADDED strip (one buffer row above the board, one below), and blowing up symbols
 * nobody can see would buy a beat-race per hidden cell for no picture — the same reason
 * `tumbleBoardSlideDown` lands only the rows between the buffers. The indices are into the tumble
 * board's own `base` column, which is built from the padded strip, so the visible band is
 * `1 … length - 2`.
 *
 * A cell the WIN-EXPLOSION POP already took off the board (Invisible Symbols → "Winning symbols
 * explode") is deliberately still IN the set. It costs nothing — the overlay's explode step
 * recognises a seat that is already gone and returns before it waits on anything
 * (`TumbleBoard.svelte`) — and it keeps this step's exploding set equal to the seats the step OWNS,
 * which is what the board-wide removal after it is keyed on. Filtering here instead would have made
 * the clear's removal and its exploding set two different lists, and would have re-ranked the
 * authored explosion pattern around the holes.
 */
const visibleColumnPositions = (reelIndex: number, strip: readonly unknown[]) =>
	strip
		.map((_cell, row) => ({ reel: reelIndex, row }))
		.filter(({ row }) => row > 0 && row < strip.length - 1);

/**
 * CLEAR the outgoing symbols — they play their authored `clearReel` state and leave,
 * instead of simply being replaced (`/config` → Reel behaviour → "Clear the board before the new symbols fall
 * in").
 *
 * `reelIndex` is what makes this serve BOTH styles from one implementation:
 *  - absent — the whole board clears at once, which is the drop-in's opener. Without it the drop-in
 *    just replaces: `boardHide` takes the old board off screen in the same frame the overlay mounts,
 *    so the new symbols fall onto a board that was never seen to empty.
 *  - a column — that column clears on its own beat, IN PLACE OF ITS DRAIN under a column cascade.
 *    The column pops away rather than sliding out of the window; the sweep, the stagger and the
 *    refill are otherwise unchanged.
 *
 * THE REMOVAL IS SCOPED TO THE COLUMN, and that is correctness rather than symmetry: a cascade runs
 * its columns concurrently on an absolute stagger, so column `i + 1` can be mid-explosion while
 * column `i` reaches its removal. An unscoped filter takes every symbol currently in the
 * `clearReel` state — the neighbour's included, mid-animation.
 *
 * NO NEW CUES. It is `tumbleBoardInit` (the resting board as the survivor layer, nothing queued
 * above it) → `tumbleBoardExplode` → `tumbleBoardRemoveExploded`: precisely the two steps a swap
 * reveal otherwise leaves out of the cascade, run for their own sake. Each caller's own scoped init
 * follows and rebuilds the layers, so this beat's only lasting effect is the animation.
 */
const clearOutgoingSymbols = async (reelIndex?: number) => {
	const board = stateGameDerived.boardRaw();
	if (reelIndex === undefined) {
		eventEmitter.broadcast({ type: 'tumbleBoardInit', addingBoard: [] });
		await eventEmitter.broadcastAsync({
			type: 'tumbleBoardExplode',
			explodingPositions: board.flatMap((strip, reel) => visibleColumnPositions(reel, strip)),
		});
		eventEmitter.broadcast({ type: 'tumbleBoardRemoveExploded' });
		return;
	}
	// The cascade has already seeded `base` with the whole resting board, so this column needs no
	// init of its own — only its own cells exploded, and only its own survivors filtered.
	//
	// `patternScope: 'board'` because THIS CALL IS ONE COLUMN OF A BOARD-WIDE EVENT. The authored
	// explosion pattern orders seats by dense-ranking them among themselves, which is right when the
	// caller hands over the whole exploding set — and wrong here, where it would see one column's
	// worth of identical column keys, answer "all wave 0", and hand every column the same instant.
	// With every column also launched together (`columnStaggerMs` defaults to 0 under `emerge`), that
	// made the whole board pop in one frame no matter which pattern was picked — on the one beat a
	// swap-in-place player watches on EVERY spin.
	await eventEmitter.broadcastAsync({
		type: 'tumbleBoardExplode',
		explodingPositions: visibleColumnPositions(reelIndex, board[reelIndex] ?? []),
		patternScope: 'board',
	});
	eventEmitter.broadcast({ type: 'tumbleBoardRemoveExploded', reelIndex });
};

/**
 * THE DROP-IN REVEAL — the opening board of a round arriving on a board that does not roll
 * (docs/design/perspective-board-mode.md §"The mode switch").
 *
 * It is the CASCADE's own sequence minus the two steps a reveal has no business doing: nothing has
 * won yet, so nothing explodes (`tumbleBoardExplode`) and nothing is filtered out
 * (`tumbleBoardRemoveExploded`). What is left is exactly the beats that carry a board in from above —
 * hide the reels, mount the overlay, queue the new board above the window, slide it down, hand the
 * result back to the reels, unmount. Same components, same cues, no new presentation code.
 *
 * Those two steps come BACK, ahead of everything else, when the project asks the outgoing board to
 * leave first — see {@link clearOutgoingSymbols}. Off by default, so the sequence above is what an
 * un-authored project still gets.
 *
 * `keepBase: false` is the one thing the cascade never says: the whole board is being replaced, so
 * there are no survivors (see the flag's doc on `tumbleBoardInit`). That is also what makes the
 * SETTLE correct — with an empty base `tumbleBoardCombined()` IS the adding layer, i.e. exactly
 * `bookEvent.board`, which is precisely the strip `enhancedBoard.spin` would have left on each reel
 * (`createEnhanceBoardSpin` sets `reelState.symbols` from `revealEvent.board[reelIndex]`). So the
 * reel board ends this beat holding the revealed symbols — which is what every downstream consumer
 * reads: win lines, `winInfo`, and the resting-board win cycle all address `stateGame.board`.
 *
 * NOT skippable, deliberately: the shipped cascade is not either (it holds its own tweens with no
 * skip token), and inventing a second slam path for the same overlay is how the two drift. The stop
 * button still enables for a bonus reveal; pressing it settles reels that are already at rest, which
 * is the same no-op it already is during a cascade.
 */
const dropInRevealBoard = async (bookEvent: BookEventOfType<'reveal'>) => {
	eventEmitter.broadcast({ type: 'boardHide' });
	eventEmitter.broadcast({ type: 'tumbleBoardShow' });
	// Off by default ⇒ the sequence below is the whole reveal, cue for cue, exactly as it shipped.
	if (stateGameDerived.boardClearsOutgoing()) await clearOutgoingSymbols();
	eventEmitter.broadcast({
		type: 'tumbleBoardInit',
		addingBoard: bookEvent.board,
		keepBase: false,
	});
	await eventEmitter.broadcastAsync({ type: 'tumbleBoardSlideDown' });
	eventEmitter.broadcast({
		type: 'boardSettle',
		board: tumbleBoardCombined().map((tumbleReel) =>
			tumbleReel.map((tumbleSymbol) => tumbleSymbol.rawSymbol),
		),
	});
	eventEmitter.broadcast({ type: 'tumbleBoardReset' });
	eventEmitter.broadcast({ type: 'tumbleBoardHide' });
	eventEmitter.broadcast({ type: 'boardShow' });
};

/**
 * Default ms between one column starting its swap and the next one starting — the `columnCascade`
 * sweep's speed when the author sets no `columnStaggerMs`.
 *
 * 140 sits beside the reel spin's own per-reel stagger (`reelSpinDelay: 145` in the engine's spin
 * constants), so a swapping board sweeps left to right at the speed the reels already do — the
 * number an author's eye is calibrated on. It is also comfortably SHORTER than the floor a column
 * takes (its drain plus its slide, before a single `land` beat), which is what makes the default
 * read as a WAVE: column `i + 1` always starts while column `i` is still moving. Author a stagger
 * longer than a whole column to get the strictly sequential reading instead — that is the one knob
 * covering both, and the reason there is no second switch for it.
 */
const COLUMN_CASCADE_STAGGER_MS = 140;

/**
 * THE COLUMN CASCADE — the other swap-in-place reveal (docs/design/perspective-board-mode.md
 * §"The mode switch", `swapStyle: 'columnCascade'`).
 *
 * The resting board DRAINS instead of being replaced wholesale: column by column, left to right,
 * the standing symbols fall out of the bottom of the window and the column's replacements fall in
 * from above behind them. Same overlay, same components, same cues as the drop-in — only the
 * grouping and the timing differ, which is the whole reason the tumble board is an overlay in the
 * first place.
 *
 * WHY THE COLUMNS ARE SWAPPED THROUGH `base` AND A SCOPED INIT, not through one up-front
 * `tumbleBoardInit` with the new board as the adding layer. `tumbleBoardCombined` stacks a column's
 * `adding` ABOVE its `base`, and `TumbleBoardBase` reads each symbol's ROW — its x and its row
 * scale — from that combined index. Queueing every column's replacements at the start would
 * therefore push the columns that have NOT drained yet down by a whole strip of indices, and on a
 * perspective board (the board this style exists for) they would snap to the wrong x and the wrong
 * size the instant the cascade began, while still sitting at their resting y. Queued per column,
 * only the column being swapped ever has both layers, and it is empty by then — so the replacements
 * take indices 0…n and land on exactly the seats they were aimed at.
 *
 * `keepBase: false` on the scoped init is load-bearing, not belt and braces: without it the init
 * would rebuild that column's survivor layer from the LIVE reel board, resurrecting the symbols the
 * drain just removed.
 *
 * THE STAGGER IS ABSOLUTE, not chained: column `i` starts at `i * staggerMs` from the top of the
 * sweep whatever the columns before it are doing. That is what makes ONE knob cover both readings of
 * "left to right" — short ⇒ the columns overlap into a wave, longer than a whole column ⇒ column
 * `i + 1` cannot start until column `i` has finished, which is the strictly sequential reading. A
 * chained "wait for the previous column, then wait the stagger" could only ever express the second.
 *
 * The END STATE is the same contract the drop-in asserts: with every column's `base` drained empty
 * and its `adding` holding that column's revealed strip, `tumbleBoardCombined()` IS
 * `bookEvent.board`, which is precisely what `enhancedBoard.spin` would have left on each reel. The
 * reel board therefore ends this beat holding the revealed symbols, which is what every downstream
 * consumer reads — win lines, `winInfo`, the resting-board win cycle.
 */
const columnCascadeRevealBoard = async (bookEvent: BookEventOfType<'reveal'>) => {
	const staggerMs = stateGameDerived.boardColumnStaggerMs() ?? COLUMN_CASCADE_STAGGER_MS;
	// Read ONCE, before the sweep: every column must empty the same way, and re-reading it per column
	// would let a mid-round config swap produce a board that half drained and half popped.
	const clearsOutgoing = stateGameDerived.boardClearsOutgoing();
	eventEmitter.broadcast({ type: 'boardHide' });
	eventEmitter.broadcast({ type: 'tumbleBoardShow' });
	// The resting board becomes the survivor layer — that is the thing that drains (or clears).
	// `addingBoard: []` queues nothing: every column's replacements arrive later, on its own beat.
	eventEmitter.broadcast({ type: 'tumbleBoardInit', addingBoard: [] });
	await Promise.all(
		bookEvent.board.map(async (_reel, reelIndex) => {
			// Column 0 starts immediately; the rest wait their absolute slot. A `0` stagger is a legal
			// authored value and correctly makes every column start together.
			if (reelIndex > 0) await waitForTimeout(staggerMs * reelIndex);
			// HOW the column empties, and the two are alternatives rather than a sequence: a drain
			// slides it out of the bottom of the window, a clear pops it in place. Both leave the
			// column empty for the refill below, so nothing downstream changes.
			if (clearsOutgoing) await clearOutgoingSymbols(reelIndex);
			else await eventEmitter.broadcastAsync({ type: 'tumbleBoardDrain', reelIndex });
			eventEmitter.broadcast({
				type: 'tumbleBoardInit',
				addingBoard: bookEvent.board,
				keepBase: false,
				reelIndex,
			});
			await eventEmitter.broadcastAsync({ type: 'tumbleBoardSlideDown', reelIndex });
		}),
	);
	eventEmitter.broadcast({
		type: 'boardSettle',
		board: tumbleBoardCombined().map((tumbleReel) =>
			tumbleReel.map((tumbleSymbol) => tumbleSymbol.rawSymbol),
		),
	});
	eventEmitter.broadcast({ type: 'tumbleBoardReset' });
	eventEmitter.broadcast({ type: 'tumbleBoardHide' });
	eventEmitter.broadcast({ type: 'boardShow' });
};

/**
 * THE EMERGE REVEAL — the opening board of a round SURFACING in place, with no travel at all
 * (docs/design/perspective-board-mode.md §"The mode switch", `swapStyle: 'emerge'`).
 *
 * The other two styles answer "where does the board come from" — above the window, or the column
 * next door. This one answers "nowhere": each symbol takes its own seat instantly and plays its
 * authored `intro` state there, so the ARRIVAL ANIMATION is the whole presentation. That is the
 * picture a game whose symbols rise out of water needs, and it is not reachable by shortening a
 * fall: a fall that lands in 1 ms is still a fall, and its `land` beat still fires after the
 * movement rather than instead of it.
 *
 * STRUCTURALLY IT IS THE COLUMN CASCADE with the two motions removed. Same opener (the resting
 * board becomes the survivor layer, nothing queued above it), same per-column absolute stagger, same
 * scoped re-init, same settle — only the column's own beat differs: no drain, no slide, just
 * `tumbleBoardAppear`. Reusing that skeleton is what makes the sweep, the clear step and the settled
 * board provably the same in all three styles rather than three hand-written near-twins.
 *
 * THE STAGGER DEFAULTS TO ZERO here, where the cascade defaults to {@link COLUMN_CASCADE_STAGGER_MS}.
 * A cascade is sequential by nature and reads wrong without a sweep; an emerge is the opposite —
 * "the board appears" is the style, and a left-to-right wave is a flourish an author opts into. `0`
 * makes every column's beat start together, which collapses the loop below to a single simultaneous
 * appear without a second code path for it.
 *
 * WITHOUT the clear step, a column's old symbols are simply gone the moment its replacements are
 * queued (`keepBase: false` on the scoped init), which is the drop-in's own "simply replaced"
 * behaviour applied per column. WITH it, they play their authored explosion and leave first — which
 * is the pairing this style exists for: symbols that sink out of sight, then symbols that surface.
 */
const emergeRevealBoard = async (bookEvent: BookEventOfType<'reveal'>) => {
	const staggerMs = stateGameDerived.boardColumnStaggerMs() ?? 0;
	// Read ONCE, before the sweep — same reason the cascade does: every column must empty the same
	// way, and re-reading per column would let a mid-round config swap half-clear the board.
	const clearsOutgoing = stateGameDerived.boardClearsOutgoing();
	eventEmitter.broadcast({ type: 'boardHide' });
	eventEmitter.broadcast({ type: 'tumbleBoardShow' });
	// The resting board becomes the survivor layer, so a column that has not had its beat yet still
	// shows the OLD symbols rather than a hole — and so the clear below has something to explode.
	eventEmitter.broadcast({ type: 'tumbleBoardInit', addingBoard: [] });
	await Promise.all(
		bookEvent.board.map(async (_reel, reelIndex) => {
			if (reelIndex > 0 && staggerMs > 0) await waitForTimeout(staggerMs * reelIndex);
			if (clearsOutgoing) await clearOutgoingSymbols(reelIndex);
			eventEmitter.broadcast({
				type: 'tumbleBoardInit',
				addingBoard: bookEvent.board,
				keepBase: false,
				reelIndex,
			});
			await eventEmitter.broadcastAsync({ type: 'tumbleBoardAppear', reelIndex });
		}),
	);
	eventEmitter.broadcast({
		type: 'boardSettle',
		board: tumbleBoardCombined().map((tumbleReel) =>
			tumbleReel.map((tumbleSymbol) => tumbleSymbol.rawSymbol),
		),
	});
	eventEmitter.broadcast({ type: 'tumbleBoardReset' });
	eventEmitter.broadcast({ type: 'tumbleBoardHide' });
	eventEmitter.broadcast({ type: 'boardShow' });
};

/**
 * THE REVEAL, for BOTH drivers — the coded `bookEventHandlerMap.reveal` handler and the flow-v2
 * `revealBoard` effect (`__IE_FLOW_V2__` owns `reveal` when a doc authors it).
 *
 * There are two call sites and only ever one of them runs, which is exactly why this is one
 * function: the two bodies were already line-for-line twins ("the coded `reveal` handler's twin,
 * verbatim"), and the board MODE is a branch that would otherwise have to be added to both. A mode
 * switch that reached the coded path but not the flow one — or the reverse — is a game that rolls on
 * some spins and drops in on others, with nothing authored to explain it.
 *
 * Everything the reveal does BESIDES presenting the board is in here too, in the original order: the
 * bonus-game record + stop-button enable, `gameType`, and clearing `expandedSymbol`. The coded
 * handler's trailing `soundScatterCounterClear` stays with its caller — the flow authors that as a
 * Broadcast node instead, which is the one genuine difference between the two.
 */
export const presentReveal = async ({
	bookEvent,
	bookEvents,
}: {
	bookEvent: BookEventOfType<'reveal'>;
	bookEvents: BookEvent[];
}) => {
	const isBonusGame = checkIsMultipleRevealEvents({ bookEvents });
	if (isBonusGame) {
		// The per-spin slam re-arm is NOT here: a free spin's first event is `updateFreeSpin`, not
		// `reveal`, so re-arming here left the counter update of the next spin to be presented under
		// the previous spin's tripped token (`unskippablePresentation.ts`). The multiple-reveal guard
		// still governs these two, which genuinely belong to the reveal: the stop button is enabled
		// for the roll, and `recordBookEvent` records THIS reveal's index for the resume path.
		eventEmitter.broadcast({ type: 'stopButtonEnable' });
		recordBookEvent({ bookEvent });
	}

	stateGame.gameType = bookEvent.gameType;
	// A new board ⇒ last spin's expansion is over. Cleared BEFORE the board arrives so a `winInfo` can
	// only claim "on N reels" when THIS spin's `expandBookColumns` set it again.
	stateGame.expandedSymbol = null;

	// THE MODE SWITCH. A swap-in-place board has no reel path at all, so the opening board drops in
	// instead of rolling. Absent `swapInPlace` this is false and the spin below is reached exactly as
	// it always was — the reel path is untouched, `lines` and `bookOf` still roll.
	if (stateGameDerived.boardSwapsInPlace()) {
		// The swap STYLE, early-returned rather than generalised. `'dropIn'` — which is what an absent
		// `swapStyle` resolves to, i.e. every board authored before this existed — reaches the exact
		// call it reached yesterday, not a per-column path parameterised down to one column. Each
		// added style gets its own arm for the same reason: this is the shared `_runtime/lines`
		// bundle, so the shipped path must stay the shipped path, not an instance of a new one.
		const swapStyle = stateGameDerived.boardSwapStyle();
		if (swapStyle === 'columnCascade') {
			await columnCascadeRevealBoard(bookEvent);
			return;
		}
		if (swapStyle === 'emerge') {
			await emergeRevealBoard(bookEvent);
			return;
		}
		await dropInRevealBoard(bookEvent);
		return;
	}

	await stateGameDerived.enhancedBoard.spin({
		revealEvent: bookEvent,
		// Stacked-picture mode seeds the scroll strip with natural-height blocks so tall pictures roll
		// during the spin; a no-op (returns the strip unchanged) when the mode is off or stood down
		// (byte-parity).
		paddingBoard: stackedScrollStrip(paddingReels(bookEvent.gameType)),
		// Sequential reel stop stands down with the roll. It needs no branch of its own: this whole
		// call is unreachable on a swap-in-place board, and `sequentialStopActive()` reads false there
		// anyway — belt and braces, so a future caller that reaches the spin some other way still
		// cannot re-arm a per-reel stop stagger on a board with no reels to stagger.
		forceSequentialStop: stateGameDerived.sequentialStopActive(),
		// Client-computed reel anticipation — MUST be here rather than at either caller: a flow-v2 game
		// (the Book-of remake) drives its reveals through the effect while the coded path drives the
		// rest, so a policy passed at only one of them silently never arms on the other. That is what
		// this function being shared buys. Off by default ⇒ `undefined` (parity), and it returns
		// `undefined` on a swap-in-place board for the same reason as above.
		computeArming: buildAnticipationArming(bookEvent),
	});
};

// ---------------------------------------------------------------------------
// The named-effect map — the implementation side of every `effect` node in the
// apps/lines FlowDoc (`flowDoc.ts`). Bodies are the coded handler leaves, verbatim.
// ---------------------------------------------------------------------------

const effects: Record<string, FlowEffect> = {
	/**
	 * Full-screen camera effect (`cameraEffect`) — shake / flash / zoom punch / chromatic wobble,
	 * played over the whole game. The kinds are engine-generic (`pixi-svelte`'s `cameraEffects`
	 * drives the `Application.stage`); this effect is only the flow→engine bridge, so every game
	 * that mounts `<App>` gets the same four by declaring the same action.
	 *
	 * `blocking` picks the return: a promise (the interpreter awaits it, holding the beat) versus
	 * nothing (the flourish plays under the following nodes). Non-blocking is the default because a
	 * shake that stalls the chain would delay the very reveal it is punctuating.
	 *
	 * An unknown/unset `kind` is a no-op rather than a throw — a mis-authored flourish must not take
	 * a round down with it. The editor's dropdown makes that unreachable in practice; this guards a
	 * doc authored against an older vocabulary.
	 */
	cameraEffect: (payload) => {
		const kind = payload.kind;
		if (!isCameraEffectKind(kind)) return;
		const playing = runCameraEffect(stateApp.pixiApplication, {
			kind,
			durationMs: numberOrUndefined(payload.durationMs),
			intensity: numberOrUndefined(payload.intensity),
		});
		return payload.blocking ? playing : undefined;
	},

	/**
	 * `reveal` leaf — the whole reveal, through {@link presentReveal}, which the coded
	 * `bookEventHandlerMap.reveal` handler calls as well. It used to be that handler's body copied
	 * here; it is now literally the same function, so the two can no longer answer the board MODE
	 * question differently. The `soundScatterCounterClear` the coded handler broadcasts afterwards is
	 * authored as a Broadcast node instead.
	 */
	revealBoard: async (payload) =>
		presentReveal({
			bookEvent: payload.bookEvent as BookEventOfType<'reveal'>,
			bookEvents: payload.bookEvents as BookEvent[],
		}),

	/**
	 * Enable free-spin sequential reel stop — each reel stops consecutively (`sequentialReelStop`).
	 * `gaps` (`reelPaddingMultiplierSequential`, higher = longer beat before that reel stops) and
	 * `speeds` (`reelSpinSpeedSequential`, higher = faster that reel spins) are PER-REEL arrays
	 * indexed by reel (entry 0 = leftmost reel); a missing/short entry falls back to the coded
	 * SPIN_OPTIONS constant, so `speeds: [2, 3, 4, 5, 6]` gives an accelerating cascade. A lone
	 * number is accepted too (broadcast to every reel). Omit both ⇒ the uniform coded constants.
	 */
	enableSequentialReelStop: (payload) => {
		stateGame.sequentialReelStop = true;
		stateGame.sequentialGapOverrides = toReelOverrides(payload.gaps ?? payload.gap);
		stateGame.sequentialSpeedOverrides = toReelOverrides(payload.speeds ?? payload.speed);
	},

	/** Disable free-spin sequential reel stop + clear the per-reel overrides (`sequentialReelStop`). */
	disableSequentialReelStop: () => {
		stateGame.sequentialReelStop = false;
		stateGame.sequentialGapOverrides = null;
		stateGame.sequentialSpeedOverrides = null;
	},

	/**
	 * Enable client-computed reel ANTICIPATION mode (docs/design/reel-anticipation.md) — reels HOLD +
	 * escalating tease FX while a big win / feature trigger is still reachable from the reels not yet
	 * stopped. OFF by default, so authoring this effect is what turns it on (byte-parity until then);
	 * the same enable/disable + payload shape as `enableSequentialReelStop`.
	 *
	 * `confidence` picks the reachable-win bound: `possible` (max — suspenseful, teases near-misses)
	 * vs `guaranteed` (min — honest, only once the big win is locked in). Unset ⇒ keep the current
	 * value, so an author can re-arm with a bare `enableAnticipationMode {}` without re-picking.
	 * `minAnticipateReel` (default 2) suppresses the trivial early arm (a run/count below 3 can't reach
	 * a big win or trigger). `greyOut` / `zoom` (default true) toggle the dim of the non-anticipating
	 * reels and the board zoom-in. Idempotent: re-firing re-applies the payload over the toggle
	 * defaults, so the SAME effect can carry a different confidence per screen (e.g. `possible` in base
	 * game, `guaranteed` in free spins) with no stale state.
	 */
	enableAnticipationMode: (payload) => {
		stateGame.anticipationMode = true;
		const confidence = toConfidence(payload.confidence);
		if (confidence) stateGame.anticipationConfidence = confidence;
		const minReel = numberOrUndefined(payload.minAnticipateReel);
		if (minReel !== undefined) stateGame.minAnticipateReel = Math.max(0, Math.floor(minReel));
		stateGame.anticipationGreyOut = boolOr(payload.greyOut, true);
		stateGame.anticipationZoom = boolOr(payload.zoom, true);
	},

	/** Disable reel anticipation + reset the confidence/toggles to their defaults (`possible`,
	 *  `minAnticipateReel` 2, grey-out + zoom on) — mirrors {@link disableSequentialReelStop} clearing
	 *  its overrides, so a later `enableAnticipationMode {}` starts from a clean baseline. */
	disableAnticipationMode: () => {
		stateGame.anticipationMode = false;
		stateGame.anticipationConfidence = 'possible';
		stateGame.minAnticipateReel = 2;
		stateGame.anticipationGreyOut = true;
		stateGame.anticipationZoom = true;
	},

	/**
	 * Enable the STACKED-PICTURE reel mode (docs/design/stacked-picture-mode.md) — a LINES visual: a
	 * contiguous vertical run of a stacked symbol draws one tall picture over the run, cropped to the top
	 * `runLength ÷ height` and top-aligned; a stacked symbol never shows its single icon. OFF by default,
	 * so authoring this effect is what turns it on (byte-parity until then). NO payload — WHICH symbols
	 * stack, their heights, and the picture art are all authored in the Symbols State Machine
	 * (`bakedStackedConfig()`); this effect is purely the on switch, so it can be turned on per screen.
	 */
	enableStackedPictures: () => {
		stateGame.stackedPictureMode = true;
	},

	/** Disable the stacked-picture mode (`stackedPictureMode`). */
	disableStackedPictures: () => {
		stateGame.stackedPictureMode = false;
	},

	/** Set the win-meter amount (`setTotalWin`). */
	setWinBookEventAmount: (payload) => {
		stateBet.winBookEventAmount = payload.amount as number;
	},

	/** Set the round's special/expanding symbol (`setExpandingSymbol`). The awaited
	 *  `specialBookReveal` broadcast that follows is authored as an awaited Broadcast node. */
	setSpecialSymbol: (payload) => {
		stateGame.specialSymbol = payload.symbol as SymbolName;
	},

	/**
	 * Book-of column morph (`expandBookColumns`) — the per-cell explode→swap→land sequence,
	 * lifted verbatim. It awaits each symbol's `oncomplete` spine + a staggered wait, so the whole
	 * effect blocks until the columns finish (the wins only animate after) — both skippable.
	 */
	expandBookColumns: async (payload) => {
		const special = payload.symbol as SymbolName;
		const reels = payload.reels as number[];
		// The fact the win text needs — see the coded handler's twin.
		stateGame.expandedSymbol = special;
		for (const reelIndex of reels) {
			const reel = stateGame.board[reelIndex];
			if (!reel) continue;
			const symbols = reel.reelState.symbols;
			for (let row = 1; row <= boardDimensions().y && row < symbols.length - 1; row++) {
				const reelSymbol = symbols[row];
				if (!reelSymbol || reelSymbol.rawSymbol.name === special) continue;
				playWildExplodeSound();
				reelSymbol.symbolState = 'explosion';
				await roundSkip.race(waitForResolve((resolve) => (reelSymbol.oncomplete = resolve)));
				reelSymbol.rawSymbol = { ...reelSymbol.rawSymbol, name: special };
				reelSymbol.symbolState = 'land';
				await roundSkip.wait(0.12 * SECOND);
			}
		}
	},

	/**
	 * Set the awarded free-spin total (`freeSpinTrigger`) — before the intro shows.
	 *
	 * Also SEEDS `current` to 1, because nothing else can: `current` is only ever written by
	 * `updateFreeSpinCounter`, which runs on `updateFreeSpin` — and that event does not arrive
	 * until the first free spin has already RESOLVED. Without the seed the counter is shown by
	 * `freeSpinCounterShow` reading a `current` nobody wrote (0 on a first session, or the last
	 * session's final count on a repeat, since `exitFreeSpinOutro` used to leave it set), so spin
	 * one rendered "10 OF 10" and only spin two onward counted correctly.
	 */
	setFreeSpinCounterTotal: (payload) => {
		stateUi.freeSpinCounterTotal = payload.total as number;
		stateUi.freeSpinCounterCurrent = 1;
	},

	/** Show the free-spin intro flag (`freeSpinTrigger`). */
	freeSpinIntroShow: () => {
		stateUi.freeSpinIntroShow = true;
	},

	/** Switch to free-game (`freeSpinTrigger`) — `stateGame.gameType = 'freegame'`. */
	setFreeGameType: () => {
		stateGame.gameType = 'freegame';
	},

	/** Hide the intro flag (`freeSpinTrigger`) — `stateUi.freeSpinIntroShow = false`. */
	freeSpinIntroHide: () => {
		stateUi.freeSpinIntroShow = false;
	},

	/** Show the free-spin counter flag (`freeSpinTrigger` / `updateFreeSpin`). */
	freeSpinCounterShow: () => {
		stateUi.freeSpinCounterShow = true;
	},

	/** Track the free-spin counter total (`freeSpinTrigger`). Seeds `current` for the same reason
	 *  {@link setFreeSpinCounterTotal} does — the two differ only in which chain authors them. */
	setFreeSpinCounterTotalOnly: (payload) => {
		stateUi.freeSpinCounterTotal = payload.total as number;
		stateUi.freeSpinCounterCurrent = 1;
	},

	/** Broadcast the live free-spin counter update (`updateFreeSpin`) — `current = amount + 1`
	 *  (the `+1` is arithmetic the bounded accessor model deliberately can't express, §11.4). */
	freeSpinCounterUpdate: (payload) => {
		eventEmitter.broadcast({
			type: 'freeSpinCounterUpdate',
			current: (payload.amount as number) + 1,
			total: payload.total as number,
		});
	},

	/** Update the live free-spin counter current/total state (`updateFreeSpin`). */
	updateFreeSpinCounter: (payload) => {
		stateUi.freeSpinCounterCurrent = (payload.amount as number) + 1;
		stateUi.freeSpinCounterTotal = payload.total as number;
	},

	/** Enter the free-spin OUTRO: hide UI flag was already broadcast; set gameType + outro flag. */
	enterFreeSpinOutro: () => {
		stateGame.gameType = 'basegame';
		stateUi.freeSpinOutroShow = true;
	},

	/** The win-level sound cluster played as the outro/win count-up begins. */
	winLevelSoundsPlay: (payload) => {
		winLevelSoundsPlay({ winLevelData: winLevelDataOf(payload.winLevel as number) });
	},

	/** The win-level sound cluster stopped as the outro/win count-up ends. */
	winLevelSoundsStop: () => {
		winLevelSoundsStop();
	},

	/** Awaited free-spin outro count-up (`freeSpinEnd`). Carries the win-level data the gate reads.
	 *  The gate's hold is released ONLY by a player tap, so this MUST be raced (see
	 *  `awaitPresentation`) or a slammed round stalls here waiting for one. */
	freeSpinOutroCountUp: async (payload) => {
		await awaitPresentation({
			type: 'freeSpinOutroCountUp',
			amount: payload.amount as number,
			winLevelData: winLevelDataOf(payload.winLevel as number),
			// PER-INSTANCE count-up interaction — authored on THIS node. Unset ⇒ off.
			holdToSpeedUp: payload.holdToSpeedUp === true,
			tapToSkip: payload.tapToSkip === true,
		});
	},

	/** Clear the outro/counter flags + special symbol at the end of free spins (`freeSpinEnd`).
	 *  `current` is reset too, so the NEXT session's counter cannot briefly show this session's
	 *  final count before its first `updateFreeSpin` lands. */
	exitFreeSpinOutro: () => {
		stateUi.freeSpinOutroShow = false;
		stateGame.specialSymbol = null;
		stateGame.expandedSymbol = null;
		stateUi.freeSpinCounterShow = false;
		stateUi.freeSpinCounterCurrent = 0;
	},

	/** Show the win presentation flags (`setWin`), after the optional big-win RUN-UP has counted the
	 *  round total to the tier threshold — the same cue the coded `setWin` handler runs, awaited
	 *  here BEFORE the flags so the overlay comes up exactly where the count stops. Un-authored ⇒
	 *  `cueBigWinCountUp` returns immediately and this is the effect it always was. */
	winShow: async (payload) => {
		const winLevelData = winLevelDataOf(payload.winLevel as number);
		// `amount` is what the cue counts, and an authored node need not wire it (the reference
		// choreography only passes `winLevel` here). Unwired ⇒ 0 ⇒ the cue's own `target <= 0` gate
		// returns, so the effect stays exactly what it was rather than counting to NaN.
		await cueBigWinCountUp({ amount: numberOrUndefined(payload.amount) ?? 0, winLevelData });
		stateUi.winShow = true;
		stateUi.bigWinShow = winLevelData?.type === 'big';
	},

	/** Awaited win count-up (`setWin`). Carries the win-level data the win panel reads. */
	winUpdate: async (payload) => {
		await awaitPresentation({
			type: 'winUpdate',
			amount: payload.amount as number,
			winLevelData: winLevelDataOf(payload.winLevel as number),
			// PER-INSTANCE count-up interaction — authored on THIS node. Unset ⇒ off.
			holdToSpeedUp: payload.holdToSpeedUp === true,
			tapToSkip: payload.tapToSkip === true,
		});
	},

	/** Hide the win presentation flags (`setWin`). */
	winHide: () => {
		stateUi.winShow = false;
		stateUi.bigWinShow = false;
	},

	/**
	 * Generic transient-message ("toast") effect. Fires `state-shared` `showMessage`, which
	 * populates `stateMessage.current` — the feed the Info Bar's `message` value + `messageShow`
	 * gate read (Game.svelte). Any FlowDoc can invoke it; it is NOT winInfo-specific.
	 *
	 * The bounded accessor model can't template a string (§11.4), so the TEXT is assembled HERE
	 * from the structured payload — but from an AUTHORED template (Invisible Win Text), not an
	 * English literal. `resolveToastTemplate` picks the branch matching the payload it actually
	 * got (amount + a named symbol ⇒ `full`, amount alone ⇒ `amountOnly`, a named symbol alone ⇒
	 * `countOnly`, nothing ⇒ no message), and `formatWinText` localizes that template BEFORE
	 * interpolating `{amount}` / `{count}` / `{symbolName}` — the order that makes it translatable
	 * at all (see `engine-layout/winText.ts`). `{amount}` interpolates the SAME currency formatter
	 * the win-meter uses, so it matches the game's formatting and follows the URL's currency.
	 *
	 * `symbol` is what lets the message NAME what paid ("4 Bananas") instead of counting in the
	 * abstract; wire it from the `winInfo` forEach item. Unwired, it falls back to the win the last
	 * `showWinLine` announced (`rememberWinSymbol`) before degrading to the amount-only branch.
	 *
	 * Unauthored, the defaults render a `winInfo` win as "You win $1.00 with 2 Bananas"; with only
	 * `amount`, "You win $1.00". Auto-clears via the state timer (`messageKind` selects the toast
	 * style, default `info`; `durationMs` overrides the hold).
	 */
	showMessage: async (payload) => {
		const kind = typeof payload.kind === 'number' ? payload.kind : undefined;
		const shown = showWinInfoMessage({
			amount: typeof payload.amount === 'number' ? payload.amount : undefined,
			kind,
			symbol:
				typeof payload.symbol === 'string'
					? (payload.symbol as SymbolName)
					: rememberedWinSymbol(kind),
			messageKind: (payload.messageKind as GameMessageKind) ?? 'info',
			durationMs: payload.durationMs as number | undefined,
		});
		// SLAM SHOWS THE MESSAGE TOO — just held briefly, not skipped (owner direction 2026-07-28,
		// paired with the win LINE now drawing on a slam; see `winLineEnabledForWin`). Without a hold
		// each win's message of a multi-win slam would overwrite the previous within one frame and only
		// the last be seen, so a bare timer (`slamHold`, settles regardless of what the slam collapsed)
		// keeps each readable. Unslammed this never runs, so the authored pacing is untouched.
		if (shown && roundSkip.isSkipped()) await slamHold(SLAM_MESSAGE_HOLD_MS);
	},

	/**
	 * `winInfo` WIN-LINE leaf (show) — trace the line through ONLY the paying symbols and stamp the
	 * pay amount below its end. Fed a single win's fields from the `winInfo` forEach (`positions`,
	 * `kind`, `symbol`, `amount` = the win's `win`). Awaited: when the line is configured to animate,
	 * WinLine.svelte resolves the broadcast only after the line has drawn first→last and the amount is
	 * revealed (mirroring the coded `await`); non-animated draws resolve immediately. Scatter wins /
	 * a disabled overlay are a no-op via the shared gate.
	 */
	/**
	 * `winInfo` SYMBOL-ANIMATION leaf — light ONLY the symbols that actually pay. The server reports
	 * the FULL payline path in a win's `positions`, but a left-to-right line pays just the leftmost
	 * `kind` symbols and stops at the first non-matching reel, so feeding the raw `positions` to the
	 * `boardWithAnimateSymbols` cue lights the non-paying tail (and any scatter the line crosses) too.
	 * Slices with the SAME `winningPositionsOf` the coded handler + `showWinLine` use, so the lit cells
	 * always match the traced line. Awaited: the chain blocks until the spines finish, so a following
	 * `hideWinLine` clears the line only after the symbols are done.
	 */
	animateWinSymbols: async (payload) => {
		await animateSymbols({
			positions: winningPositionsOf({
				positions: payload.positions as Position[],
				kind: payload.kind as number,
			}),
			// Same per-line colour the sibling `showWinLine` uses, so a `winLine`-tinted highlight glows
			// in this line's colour on the v2 path too; absent `line` ⇒ undefined ⇒ untinted.
			color: winLineColorFor(payload.line as number | undefined),
		});
	},

	showWinLine: async (payload) => {
		const win = {
			positions: payload.positions as Position[],
			kind: payload.kind as number,
			symbol: payload.symbol as SymbolName,
		};
		// Remembered BEFORE the gate, so a scatter win (which draws no line) still names itself in the
		// toast that follows — see `rememberWinSymbol`.
		rememberWinSymbol(win.symbol, win.kind);
		if (!winLineEnabledForWin(win)) return;
		// All-at-once mode drew the whole round's lines together in `dispatchBookEvent`; re-showing
		// this one here would only re-stamp it. (Its sibling `hideWinLine` needs no such guard —
		// `WinLine.svelte` ignores a per-win hide in this mode.)
		if (bakedWinLineConfig().line.allAtOnce) return;
		await awaitPresentation({
			type: 'winLineShow',
			points: winLinePointsFor(winningPositionsOf(win)),
			shape: winLineShapeFor(winningPositionsOf(win)),
			fullPoints: winLineFullPointsFor(win),
			color: winLineColorFor(payload.line as number | undefined),
			...winLineTextFor({
				symbol: win.symbol,
				kind: win.kind,
				amount: payload.amount as number,
				line: payload.line as number | undefined,
			}),
		});
	},

	/**
	 * `winInfo` WIN-LINE leaf (hide) — clear the traced line + stamped amount after the win's symbol
	 * animation.
	 *
	 * UNCONDITIONAL, unlike the show. It used to re-evaluate `winLineEnabledForWin`, which is fine
	 * while that answer is constant but not now the slam suppresses the line: a press landing between
	 * a win's show and its hide would flip the gate to false and leave the drawn line on screen for
	 * the rest of the round. Clearing a line that was never shown is a no-op (`WinLine.svelte` just
	 * re-empties already-empty points), so the safe direction is to always clear.
	 */
	hideWinLine: () => {
		eventEmitter.broadcast({ type: 'winLineHide' });
	},

	/**
	 * Flow v2 `stopReel(index)` command — settle one reel by index. The reference book-of board
	 * spins whole-board (via `revealBoard`), so per-reel stop is exposed as a real `reelStop` emitter
	 * broadcast: a reel component binds it to land that column (the hook the `StaggerStop` function
	 * drives). Backs the `stopReel` command declared in `BOOK_OF_VOCAB` so an authored per-reel stagger
	 * fires a real signal rather than a silent no-op (Phase 4c — the template implements its vocabulary).
	 */
	stopReel: (payload) => {
		eventEmitter.broadcast({ type: 'reelStop', index: payload.index as number });
	},

	/**
	 * Arm the picked buy-bonus bet mode (`selectBetMode`) — the flow analogue of a buy-feature card's
	 * `onSelect` (`registerBuyFeature`), which sets `stateBonus.selectedBetModeKey` before the confirm
	 * step. Writes the SAME shared `stateBonus` rune the confirm dialog reads, so an authored buy flow
	 * arms the mode exactly as the coded select screen does. `commitBuyBonus` then reads this key.
	 */
	selectBetMode: (payload) => {
		stateBonus.selectedBetModeKey = payload.betModeKey as string;
	},

	/**
	 * Commit the picked buy-bonus bet mode (`commitBuyBonus`) — the VERBATIM confirm body of
	 * `BuyBonusConfirm.svelte`: activate the armed mode, then a `buy` mode fires a bet (broadcast
	 * `{ type: 'bet' }`, the SAME emitter path the coded confirm uses → `EnableGameActor` sends
	 * `BET`; XState is never touched here) while an `activate` mode raises the auto-spin limits to
	 * infinity. The mode is armed and the bet fired SYNCHRONOUSLY in one action — never two wired
	 * nodes — so `activeBetModeKey` is set before `BET` reads it (a `buy` mode must be armed first).
	 * The press sound + modal close stay with the confirm dialog; this is only the state commit.
	 */
	commitBuyBonus: () => {
		stateBet.activeBetModeKey = stateBonus.selectedBetModeKey;

		const data = stateBonusDerived.selectedBetModeData();
		if (data.type === 'buy') {
			eventEmitter.broadcast({ type: 'bet' });
		}
		if (data.type === 'activate') {
			stateUi.autoSpinsLossLimitText = INFINITY_MARK;
			stateUi.autoSpinsSingleWinLimitText = INFINITY_MARK;
		}
	},
};

/** The effect resolver the runtime injects (`FlowRuntime.effect` / v2 `FlowV2Env.effect`). Unknown
 *  name ⇒ no-op. */
export const flowEffect = (name: string): FlowEffect | undefined => effects[name];

/** The names of every implemented effect/command (v2 vocabulary coverage — the runtime asserts every
 *  declared `BOOK_OF_VOCAB` action resolves here). */
export const flowEffectNames: readonly string[] = Object.keys(effects);
