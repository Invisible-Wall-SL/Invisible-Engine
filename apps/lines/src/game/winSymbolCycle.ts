/**
 * WIN-SYMBOL IDLE CYCLE — the resting-board replay of the round's winning SYMBOLS.
 *
 * `winInfo` animates each win's symbols exactly once and the board then sits static until the next
 * spin. Slots conventionally keep the winning symbols alive while the player looks at the result,
 * so this module re-lights them on a loop from the moment the round's presentation finishes until
 * the next bet starts.
 *
 * SHOWING ALL LINES AT ONCE changes the replay's shape, not its job: the round's lines are already
 * on screen together, so the cycle re-broadcasts the whole set once (keyed, so nothing doubles) and
 * leaves it up for the entire rotation while the symbols keep cycling one win at a time underneath.
 *
 * THE LINE RIDES ALONG, unless switched off. Each pass draws that win's line and stamps its
 * amount before lighting its symbols — the same beat order the spin played — and clears it again
 * between passes, so the rotation reads as the round's own per-win narration on repeat. Turning
 * `winCycle.showLine` off (Symbols State Machine) makes the replay symbols-only, and the cycle
 * then never broadcasts `winLineShow`/`winLineHide` at all, leaving whatever the round put on
 * screen exactly as it was. `winCycle.showText` gates ONLY the stamped amount, INDEPENDENTLY of
 * the line: off keeps the line replaying but drops the amount text.
 *
 * THE INFO TOAST rides along too, but only when `winCycle.showMessage` is on — and unlike the line
 * it defaults OFF, because the toast never replayed before this switch existed, so leaving it unset
 * keeps a project byte-identical (the message shows once, during the round's own presentation). On,
 * each pass re-fires that win's "You win $X with N Bananas" toast alongside its symbols.
 *
 * WHY IT LIVES OUTSIDE THE HANDLER. The cycle is not part of any book event: it starts after the
 * whole book has been presented and must survive as long as nothing else is happening. It is
 * driven from `playBet` (start in `finally`, stop at the top) so it covers all three dispatch
 * paths — coded handler, v1 flow, v2 flow — at one seam, and the wins are recorded in
 * `dispatchBookEvent` for the same reason: a flow-owned `winInfo` never reaches the coded handler.
 *
 * ONE WIN PER PASS, in book order, looping back to the first — the same order the round narrated
 * (owner direction 2026-07-24: "go through all the winning lines sequentially"). A spin with three
 * paying lines therefore shows line 1's symbols, then line 2's, then line 3's, then line 1 again,
 * so each combination is legible on its own. A single-win spin is the degenerate case: one win in
 * the list, replayed over and over.
 */

import { stateBetDerived, clearMessage } from 'state-shared';
import { SECOND } from 'constants-shared/time';
import { waitForTimeout } from 'utils-shared/wait';

import { eventEmitter } from './eventEmitter';
import {
	animateSymbols,
	showAllWinLines,
	showWinInfoMessage,
	winLineColorFor,
	winLineEnabledForWin,
	winLineFullPointsFor,
	winLinePointsFor,
	winLineShapeFor,
	winLineTextFor,
	winningPositionsOf,
} from './flowEffects';
import { setWinDim, stateGameDerived, winDimCellKey } from './stateGame.svelte';
import type { BookEvent, BookEventOfType } from './typesBookEvent';
import type { Position } from './types';
import { bakedWinCycleConfig, bakedWinExplodeEnabled, bakedWinLineConfig } from '../editor-scenes';

type CycleWin = BookEventOfType<'winInfo'>['wins'][number];

/**
 * The floor under the authored gap. A pass is only as long as its awaited cue, and a cue with no
 * subscriber (the board unmounted behind a screen, say) resolves immediately — so a zero gap would
 * turn the loop into a frame-rate-bound busy loop. This keeps it a paced replay whatever the
 * author sets.
 */
const MIN_GAP_MS = 120;

/** The wins of the LAST presented spin — what the cycle replays. */
let wins: CycleWin[] = [];
/** Bumped by every start/stop; a running loop exits as soon as its own token is stale. */
let generation = 0;

/** Identity of a win, for the accumulate-without-doubling guard below. A payline is defined by the
 *  cells it pays on, so the traced positions (plus the symbol/count) name it even when the source
 *  book carries no `lineIndex`. */
const winKey = (win: CycleWin): string =>
	`${win.symbol}|${win.kind}|${win.meta?.lineIndex ?? ''}|${win.positions
		.map((position) => `${position.reel}:${position.row}`)
		.join(',')}`;

/**
 * THE TWO BOOK EVENTS THAT REPLACE THE BOARD — a new spin (`reveal`) and a cascade step
 * (`tumbleBoard`). After either of them the seats the recorded wins name belong to a DIFFERENT
 * board.
 *
 * One set rather than two `if`s because two things key off it and they must never drift: the
 * {@link recordWinCycleWins} clear below, and {@link explodeWinnersBeforeBoardChange} — the pop,
 * which has to fire immediately BEFORE each clear, or the wins it was meant to blow up are simply
 * discarded. That pairing IS "exactly once per paying spin": every clear is preceded by a pop, and
 * the book's end pops whatever the last spin left.
 */
const REPLACES_THE_BOARD: ReadonlySet<BookEvent['type']> = new Set(['reveal', 'tumbleBoard']);

/**
 * Record the wins the cycle will replay. Called for EVERY book event on every dispatch path:
 * `reveal` clears (a new spin's board invalidates the previous spin's wins — this is what makes a
 * free-spin feature cycle its LAST spin rather than the whole book), `tumbleBoard` clears for the
 * same reason (see below), `winInfo` ACCUMULATES.
 *
 * Accumulates, rather than assigns, because the number of `winInfo` events per spin is a property
 * of the SOURCE BOOK, not of the game. The reference books put every win in ONE event
 * (`wins: [w1, w2, w3]`), but the Play4Fun facade — which is what the shipped Book of Borut runs on
 * — flushes one event PER win (`reveal → winInfo×N → setTotalWin`, `engineFacade.adaptEventsForEngine`).
 * Assigning therefore kept only the LAST line on exactly the games that pay several, which is the
 * bug this fixes. Both shapes now land the same list.
 *
 * De-duplicated by {@link winKey} so a book that emits per-line events AND a summary event cannot
 * make a line appear twice in the rotation.
 *
 * A CASCADE INVALIDATES ITS OWN WINS. `tumbleBoard` blows the winning cells off the board and drops
 * new symbols into their seats, so every win recorded before it describes a board that no longer
 * exists. The cycle replays by POSITION, so without this clear the resting board is narrated with
 * the previous step's line traced over whatever tumbled into those cells — a frame around symbols
 * that never paid. Clearing here leaves exactly the wins that landed AFTER the last cascade step,
 * which is what is actually on screen; a chain that ends because nothing more pays therefore
 * replays nothing and the settled board simply rests. Same reasoning as `reveal`, same two clears.
 */
export const recordWinCycleWins = (bookEvent: BookEvent): void => {
	if (REPLACES_THE_BOARD.has(bookEvent.type)) {
		wins = [];
		// The next board invalidates the previous round's win-dim — clear it here (the same
		// "until the next spin" boundary that resets `wins`), so a losing spin's board is full-bright.
		// On a cascade it also lifts the dim before the survivors fall, so the refilled board is not
		// darkened by the cells the previous step paid on.
		setWinDim(false, {});
		return;
	}
	if (bookEvent.type !== 'winInfo') return;
	const seen = new Set(wins.map(winKey));
	for (const win of bookEvent.wins) {
		const key = winKey(win);
		if (seen.has(key)) continue;
		seen.add(key);
		wins.push(win);
	}
	// The win celebration has begun (or grown, on a per-line facade): light the paying cells and dim
	// the rest. A no-op unless the author turned the switch on.
	refreshWinDim();
};

/** A position-set key, order-independent — names the cells a broadcast lit so they can be matched
 *  back to the recorded win that owns them. */
const positionsKey = (positions: Position[]): string =>
	positions
		.map((position) => `${position.reel}:${position.row}`)
		.sort()
		.join(',');

/**
 * The paying line's colour for a set of just-lit cells, looked up from the recorded {@link wins} by
 * the cells themselves — the reliable, FlowDoc-independent source the win-frame tint falls back to.
 *
 * WHY THIS EXISTS. The tint colour normally rides the `boardWithAnimateSymbols` broadcast
 * (`winLineColor`, set from `win.meta.lineIndex`). But the FIRST presentation on a flow-driven game
 * is the baked FlowDoc's RAW `boardWithAnimateSymbols` node, which wires only `symbolPositions` — no
 * colour reaches the frame, so a `winLine`-tinted highlight renders untinted there (while the coded
 * resting cycle tints fine). Rather than depend on every FlowDoc author wiring a colour pin,
 * `Board.svelte` derives it here from the same wins the cycle replays — recorded in
 * `dispatchBookEvent` (`utils.playBookEvent`) BEFORE the flow presents the event, so the owning win
 * is always already in the list.
 *
 * Matches the FULL payline path (the raw broadcast lights `positions`) OR the sliced paying prefix
 * (`winningPositionsOf`, what the coded / `animateWinSymbols` path lights), so it resolves whichever
 * cell set the broadcast carried. Undefined when nothing matches (e.g. a non-win animation) ⇒ no
 * tint, exactly as before.
 */
export const winLineColorForPositions = (positions: Position[]): string | undefined => {
	if (!positions.length) return undefined;
	const target = positionsKey(positions);
	const match = wins.find(
		(win) =>
			positionsKey(win.positions) === target || positionsKey(winningPositionsOf(win)) === target,
	);
	return match ? winLineColorFor(match.meta?.lineIndex) : undefined;
};

/**
 * Recompute the win-celebration DIM set from the recorded wins and publish it (`stateGame.winDim`).
 * Gated by the `winCycle.dimNonWinning` switch — off ⇒ it never activates, so the board stays
 * full-bright (byte-parity). The lit set is exactly the PAYING cells (`winningPositionsOf`, the same
 * cells the round + resting cycle animate), so a symbol reads bright iff it is part of a paying line
 * and every other symbol is darkened. Intentionally INDEPENDENT of `winCycle.enabled`: the dim is a
 * property of the whole board, not the replay, so it holds even when the replay cycle is off.
 */
const refreshWinDim = (): void => {
	if (!bakedWinCycleConfig().dimNonWinning) return;
	const cells: Record<string, boolean> = {};
	for (const win of wins) {
		for (const position of winningPositionsOf(win)) {
			cells[winDimCellKey(position.reel, position.row)] = true;
		}
	}
	// An EMPTY lit set is never a win presentation — it is a win that reached us with no positions,
	// and activating on it darkens all of the board and lights none of it. Leave the dim off and the
	// board simply stays bright, which is what an un-locatable win should look like. (The mock used
	// to send exactly that for a scatter pay; fixed at the source, guarded here so the next one
	// cannot black out the board.)
	if (!Object.keys(cells).length) return;
	setWinDim(true, cells);
};

/** Whether a line THIS cycle drew is currently on screen — so it is cleared exactly once, by
 *  whoever ends the pass, and a cycle that never draws one leaves the round's own line alone. */
let lineOnScreen = false;

/** Clear the line(s) this cycle drew (no-op otherwise — never touches a line the round left).
 *  `all` so it also wipes an all-at-once SET, where a per-win hide is deliberately ignored. */
const clearCycleLine = (): void => {
	if (!lineOnScreen) return;
	lineOnScreen = false;
	eventEmitter.broadcast({ type: 'winLineHide', all: true });
};

/**
 * Drop the recorded wins outright — the ROUND boundary, called once from `playBet` before the book
 * starts.
 *
 * {@link recordWinCycleWins} clears at every board change WITHIN a book, which leaves the last
 * spin's wins standing between rounds. Nothing used to read them there. The per-spin pop
 * ({@link explodeWinnersBeforeBoardChange}) does: it runs immediately before the next round's FIRST
 * `reveal`, so without this the new round would open by popping the previous round's set. In
 * practice those cells are already gone (the previous round's `finally` popped them) and the pop
 * filters them out, but "in practice" is not an invariant — this makes the pop structurally unable
 * to fire for a spin that is not in the book being played.
 */
export const forgetWinCycleWins = (): void => {
	wins = [];
};

/** Stop a running cycle. Idempotent — safe to call when nothing is running. */
export const stopWinCycle = (): void => {
	generation += 1;
	// A stop can land mid-pass with the line drawn; without this it would survive into the spin.
	clearCycleLine();
};

/**
 * Wipe the previous round's win presentation the instant the next spin starts — the win line, its
 * stamped amount/message, AND the info toast — so the reels roll onto a clean board. Called from the
 * spin-start seam (`onNewGameStart`), which fires on the BUTTON PRESS, before the RGS responds, so
 * nothing lingers during the request.
 *
 * Unlike {@link clearCycleLine} this is UNCONDITIONAL: it hides whatever line is on screen — one the
 * cycle drew OR one the round left — because the previous round is over and its presentation must not
 * survive into the spin. It also stops the running cycle so no pass re-draws behind the clear, and
 * clears the transient toast (`showWinInfoMessage`), which auto-clears on its own timer and would
 * otherwise outlive the button press.
 *
 * The non-winning-symbol DIM is lifted here too, so the whole board brightens in one beat ON THE
 * BUTTON PRESS — before the reels roll — rather than only on the later `reveal`, which lands after
 * the spin has already started (owner direction 2026-07-28: "better to have them all go away at the
 * same time"). The `reveal` clear in {@link recordWinCycleWins} stays: it is the seam for a free
 * spin's INTERNAL reveals, which have no button press to run this.
 */
export const clearWinPresentation = (): void => {
	stopWinCycle();
	lineOnScreen = false;
	eventEmitter.broadcast({ type: 'winLineHide', all: true });
	clearMessage();
	setWinDim(false, {});
};

/**
 * THE SPIN'S WINNING CELLS — every seat any recorded win paid on, DEDUPED by seat and in book
 * order, minus the ones already off the board.
 *
 * "The spin's", not "the round's": {@link wins} is cleared at every board change
 * ({@link REPLACES_THE_BOARD}), so the recorded set is always exactly what the board CURRENTLY on
 * screen has paid.
 *
 * Deduped because overlapping paylines share cells: line 1 (`[0,0,0,0,0]`), line 6
 * (`[0,0,1,2,2]`) and line 18 (`[0,0,2,0,0]`) all pay on reels 0-1 of row 0, and a quarter of the
 * reference books' `winInfo` events have at least one cell paid by two wins. The pop must blow each
 * of those up ONCE, not once per win that claimed it.
 *
 * `winningPositionsOf`, not `win.positions`: the same PAYING slice the round and the resting cycle
 * light, so a line win's non-paying tail is never popped.
 */
const spinWinningPositions = (): Position[] => {
	const removed = stateGameDerived.boardRemoved();
	const seen = new Set<string>();
	const positions: Position[] = [];
	for (const win of wins) {
		for (const position of winningPositionsOf(win)) {
			const key = `${position.reel}:${position.row}`;
			if (seen.has(key)) continue;
			seen.add(key);
			if (removed[position.reel]?.[position.row]) continue;
			positions.push(position);
		}
	}
	return positions;
};

/**
 * THE POP (Invisible Symbols → "Winning symbols explode"): every cell THIS SPIN paid on plays its
 * `explosion` TOGETHER, once, and leaves the board.
 *
 * WHY IT IS NOT THE TAIL OF EACH WIN. A spin narrates its wins one after another over the SAME
 * board, and overlapping paylines share cells — so a pop at the end of a win took a cell off the
 * board that a LATER win still had to light. The later win re-lit an unmounted cell, whose
 * `oncomplete` can never fire, and the presentation sat out `WIN_BEAT_CAP_MS` for it (twice, because
 * the pop re-armed a second one): ~8s frozen on about a quarter of paying spins. Deferring it leaves
 * every win's own narration byte-identical to the pop being OFF and makes the explosion one extra
 * beat at the end of the spin.
 *
 * A SPIN, NOT A ROUND — and that distinction was a shipped bug. This used to run only from
 * `playBet`'s `finally`, which is once per BOOK: a bonus book carries ~10 spins inside that one
 * call, and {@link wins} is cleared at every board change, so the pop only ever saw the wins
 * recorded after the LAST `reveal`. Measured on the reference books, that dropped 2225 of 7480
 * paying events in the base game and 227 of 250 in the bonus — and a mid-book winner that is never
 * marked `removed` is swept by the NEXT board's clear playing `clearReel`, i.e. exactly the double
 * pop this feature exists to prevent. So it now runs at THREE seams, which between them cover every
 * way a spin can end:
 *
 *  - {@link explodeWinnersBeforeBoardChange}, at the `playBookEvents` loop — immediately before the
 *    `reveal` / `tumbleBoard` that replaces the board, i.e. while the board those wins were scored
 *    on is still the board on screen. This is the one that makes it per-spin.
 *  - `playBet`'s `finally` — the book's LAST spin, which no board change follows. In the `finally`
 *    so a slammed or thrown round reaches it too.
 *  - the between-spins hold (`freeSpinHold.holdAfterBigWin`) — the other point a spin's
 *    presentation is handed back to the player.
 *
 * They cannot double-pop: the set is filtered by what is already gone, so the second call over the
 * same cells finds nothing and broadcasts nothing.
 *
 * NOT RACED against the slam token, deliberately. This OWNS the board — it removes cells — and
 * board-owning work stays fully awaited (`flowEffects`' `awaitPresentation` doc): released early it
 * would still be removing cells while the next `reveal` clears and rebuilds them.
 *
 * A spin that paid nothing, or a project that never authored the pop, broadcasts NOTHING — so this
 * is one boolean read on every losing spin and byte-parity everywhere the switch is off.
 */
export const explodeSpinWinners = async (): Promise<void> => {
	if (!bakedWinExplodeEnabled()) return;
	const symbolPositions = spinWinningPositions();
	if (!symbolPositions.length) return;
	await eventEmitter.broadcastAsync({ type: 'boardExplodeWinSymbols', symbolPositions });
};

/**
 * THE PER-SPIN SEAM: pop this spin's winners if `bookEvent` is about to take their board away.
 *
 * Keyed to {@link REPLACES_THE_BOARD} — the same set {@link recordWinCycleWins} clears `wins` on —
 * so the pop is, by construction, the last thing that happens to a spin's recorded wins before they
 * are discarded. Awaited by the caller, so the board change cannot start over a pop still running.
 *
 * A celebration is NOT a boundary here: `freeSpinTrigger` / `freeSpinEnd` cover the board with a
 * screen but do not replace it, and the wins are still on it when the next real boundary arrives —
 * the free-spin feature's first `reveal`, or the round's `finally`.
 */
export const explodeWinnersBeforeBoardChange = async (bookEvent: BookEvent): Promise<void> => {
	if (!REPLACES_THE_BOARD.has(bookEvent.type)) return;
	await explodeSpinWinners();
};

/**
 * The per-win entries the cycle steps through, in book order — one per PAYING win, carrying both
 * its traced cells and the win itself (the line's points, amount and message are derived from it
 * when `showLine` is on). Wins that trace no cells are dropped so a stray entry can't introduce a
 * blank beat in the rotation.
 *
 * A cell the POP took off the board ({@link explodeSpinWinners}) is no longer one of
 * them. It draws nothing, so re-lighting it would light nothing and then await an `oncomplete` it
 * can never report — every pass of a loop that races no skip token would sit out the win-beat cap
 * for an empty seat. The pop runs immediately before the cycle starts, so with it on every paying
 * cell is already gone: every entry drops and `startWinCycle` finds nothing to replay, and a board
 * whose winners exploded simply rests. Nothing is ever removed with the pop off ⇒ the rotation is
 * untouched.
 */
const cycleEntries = (): { win: CycleWin; positions: Position[] }[] => {
	const removed = stateGameDerived.boardRemoved();
	return wins
		.map((win) => ({
			win,
			positions: winningPositionsOf(win).filter(
				(position) => !removed[position.reel]?.[position.row],
			),
		}))
		.filter((entry) => entry.positions.length > 0);
};

/**
 * Start cycling the recorded wins' symbols. NOT awaited by the caller — it only ends when
 * {@link stopWinCycle} runs (i.e. the next bet).
 *
 * Skipped while the game is spinning continuously (autoplay / space hold): the next spin is
 * already on its way, so a cycle there would be a flash between rounds rather than a replay.
 */
export const startWinCycle = async (): Promise<void> => {
	const cfg = bakedWinCycleConfig();
	if (!cfg.enabled) return;
	if (stateBetDerived.isContinuousBet()) return;

	const entries = cycleEntries();
	if (!entries.length) return;

	generation += 1;
	const token = generation;
	const gapMs = Math.max(MIN_GAP_MS, cfg.delay * SECOND);

	// ALL-AT-ONCE MODE: the round's lines are ALREADY on screen together and must stay there, so the
	// replay never draws or clears one per pass — it re-broadcasts the whole set ONCE (idempotent:
	// `WinLine.svelte` keys a line by the cells it traces, so a line already up is replaced, not
	// doubled) and then cycles only the SYMBOLS underneath it. Re-broadcasting rather than trusting
	// the round's own draw is what makes the replay self-sufficient: a flow-driven game, or a book
	// whose lines were cleared, still ends up with the full set on the resting board.
	const allAtOnce = bakedWinLineConfig().line.allAtOnce;
	if (allAtOnce && cfg.showLine) {
		if (
			await showAllWinLines(
				entries.map((entry) => entry.win),
				{ stamp: cfg.showText },
			)
		)
			lineOnScreen = true;
		if (token !== generation) return;
	}

	while (token === generation) {
		for (const { win, positions } of entries) {
			if (token !== generation) return;
			// `winLineEnabledForWin` is the SAME gate the round uses, so the replay inherits its
			// rules for free: a scatter pays "anywhere" and draws no line, and the whole overlay
			// obeys the Symbols-State-Machine win-line toggle. Those wins still light their symbols.
			const withLine = !allAtOnce && cfg.showLine && winLineEnabledForWin(win);
			if (withLine) {
				lineOnScreen = true;
				// The stamped AMOUNT is gated INDEPENDENTLY of the line (`showText`): the author can
				// keep the line replaying while dropping the amount. Off ⇒ empty strings ⇒
				// `WinLine.svelte` draws the line but no stamp. Default on ⇒ the full narration.
				const stamp = cfg.showText
					? winLineTextFor({
							symbol: win.symbol,
							kind: win.kind,
							amount: win.win,
							line: win.meta?.lineIndex,
						})
					: { amount: '', message: '' };
				// Awaited like the round's own draw, so an animated line finishes tracing and stamps
				// its amount before the symbols are lit — same beat order the spin played.
				await eventEmitter.broadcastAsync({
					type: 'winLineShow',
					points: winLinePointsFor(positions),
					shape: winLineShapeFor(positions),
					fullPoints: winLineFullPointsFor(win),
					color: winLineColorFor(win.meta?.lineIndex),
					...stamp,
				});
				if (token !== generation) return;
			}
			// Re-show that win's info toast for this pass — the SAME "You win $X with N Bananas"
			// (`messageKind: 'win'`) the round narrated, so the message rides the replay just like the
			// line + amount do. Gated by `showMessage` (default OFF, so a project that never authored
			// it keeps the toast to the round's first presentation). Fired HERE — with the line, BEFORE
			// the symbols light — so it is on screen for the FIRST pass alongside the line, matching the
			// line's start-of-pass timing (firing it after `animateSymbols` delayed it a whole symbol
			// animation, which read as the toast only starting on the second loop). NOT awaited: it is a
			// transient toast that auto-clears, not a beat the cycle should pace on.
			if (cfg.showMessage) {
				showWinInfoMessage({
					amount: win.win,
					kind: win.kind,
					symbol: win.symbol,
					messageKind: 'win',
				});
			}
			await animateSymbols({ positions, color: winLineColorFor(win.meta?.lineIndex) });
			if (token !== generation) return;
			// Never between passes in all-at-once mode — the whole set stays up until the next spin.
			if (!allAtOnce) clearCycleLine();
			await waitForTimeout(gapMs);
		}
	}
};
