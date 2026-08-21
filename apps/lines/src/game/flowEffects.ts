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
import { waitForResolve } from 'utils-shared/wait';
import { roundSkip } from 'utils-shared/skipToken';
import { bookEventAmountToCurrencyString } from 'utils-shared/amount';
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
import { getFlowV2 } from './flowV2InterpreterHolder';
import { stateApp } from './stateApp';
import { type WinLevelData } from 'engine-game';
import { stateGame, stateGameDerived, getSymbolSeat, stackedScrollStrip } from './stateGame.svelte';
import { awaitCue, slamHold, SLAM_MESSAGE_HOLD_MS } from './unskippablePresentation';
import { buildAnticipationArming } from './anticipation';
import type { BookEvent, BookEventOfType } from './typesBookEvent';
import type { Position, SymbolName } from './types';
import type { WinLineShape } from '../components/WinLine.svelte';
import {
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
}): { amount: string; message: string } => {
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
	};
};

const winLevelDataOf = (winLevel: number): WinLevelData | undefined => activeWinLevelData(winLevel);

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
	 * `reveal` leaf — the bonus-game record + the awaited board spin. Mirrors the coded
	 * `reveal` handler exactly: the bonus-game branch records the event (for resume) +
	 * enables stop, sets `gameType`, then spins the board awaited. The `soundScatterCounterClear`
	 * that follows in the coded handler is a plain broadcast — authored as a Broadcast node.
	 */
	revealBoard: async (payload) => {
		const bookEvent = payload.bookEvent as BookEventOfType<'reveal'>;
		const bookEvents = payload.bookEvents as BookEvent[];
		const isBonusGame = checkIsMultipleRevealEvents({ bookEvents });
		if (isBonusGame) {
			// The per-spin slam re-arm is NOT here — it hangs off `updateFreeSpin`, the free spin's
			// FIRST event (`unskippablePresentation.ts`). The coded `reveal` handler's twin, verbatim.
			eventEmitter.broadcast({ type: 'stopButtonEnable' });
			recordBookEvent({ bookEvent });
		}
		stateGame.gameType = bookEvent.gameType;
		// The coded `reveal` handler's twin: a new board ends the last spin's expansion, so only THIS
		// spin's `expandBookColumns` can license the "on N reels" win text.
		stateGame.expandedSymbol = null;
		await stateGameDerived.enhancedBoard.spin({
			revealEvent: bookEvent,
			// Stacked-picture mode seeds the scroll strip with natural-height blocks so tall pictures roll
			// during the spin; a no-op (returns the strip unchanged) when the mode is off (byte-parity).
			paddingBoard: stackedScrollStrip(paddingReels(bookEvent.gameType)),
			forceSequentialStop: stateGame.sequentialReelStop,
			// Client-computed reel anticipation — MUST be passed here too, not only in the coded
			// `bookEventHandlerMap` reveal handler: a flow-v2 game (the Book-of remake) drives its
			// reveals through THIS effect, so without this the whole anticipation feature (win + scatter
			// + book axes) silently never arms on a flow-authored board — exactly why the free-spin book
			// tease didn't show. Off by default ⇒ `buildAnticipationArming` returns undefined (parity).
			computeArming: buildAnticipationArming(bookEvent),
		});
	},

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
				eventEmitter.broadcast({ type: 'soundOnce', name: 'sfx_wild_explode' });
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

	/** Show the win presentation flags (`setWin`). */
	winShow: (payload) => {
		const winLevelData = winLevelDataOf(payload.winLevel as number);
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
