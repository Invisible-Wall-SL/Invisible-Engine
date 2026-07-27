/**
 * WIN-SYMBOL IDLE CYCLE — the resting-board replay of the round's winning SYMBOLS.
 *
 * `winInfo` animates each win's symbols exactly once and the board then sits static until the next
 * spin. Slots conventionally keep the winning symbols alive while the player looks at the result,
 * so this module re-lights them on a loop from the moment the round's presentation finishes until
 * the next bet starts.
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

import { stateBetDerived } from 'state-shared';
import { SECOND } from 'constants-shared/time';
import { waitForTimeout } from 'utils-shared/wait';

import { eventEmitter } from './eventEmitter';
import {
	animateSymbols,
	showWinInfoMessage,
	winLineColorFor,
	winLineEnabledForWin,
	winLineFullPointsFor,
	winLinePointsFor,
	winLineTextFor,
	winningPositionsOf,
} from './flowEffects';
import type { BookEvent, BookEventOfType } from './typesBookEvent';
import type { Position } from './types';
import { bakedWinCycleConfig } from '../editor-scenes';

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
 * Record the wins the cycle will replay. Called for EVERY book event on every dispatch path:
 * `reveal` clears (a new spin's board invalidates the previous spin's wins — this is what makes a
 * free-spin feature cycle its LAST spin rather than the whole book), `winInfo` ACCUMULATES.
 *
 * Accumulates, rather than assigns, because the number of `winInfo` events per spin is a property
 * of the SOURCE BOOK, not of the game. The reference books put every win in ONE event
 * (`wins: [w1, w2, w3]`), but the Play4Fun facade — which is what the shipped Book of Borut runs on
 * — flushes one event PER win (`reveal → winInfo×N → setTotalWin`, `stakeFacade.adaptEventsForStake`).
 * Assigning therefore kept only the LAST line on exactly the games that pay several, which is the
 * bug this fixes. Both shapes now land the same list.
 *
 * De-duplicated by {@link winKey} so a book that emits per-line events AND a summary event cannot
 * make a line appear twice in the rotation.
 */
export const recordWinCycleWins = (bookEvent: BookEvent): void => {
	if (bookEvent.type === 'reveal') {
		wins = [];
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
};

/** Whether a line THIS cycle drew is currently on screen — so it is cleared exactly once, by
 *  whoever ends the pass, and a cycle that never draws one leaves the round's own line alone. */
let lineOnScreen = false;

/** Clear a line this cycle drew (no-op otherwise — never touches a line the round left). */
const clearCycleLine = (): void => {
	if (!lineOnScreen) return;
	lineOnScreen = false;
	eventEmitter.broadcast({ type: 'winLineHide' });
};

/** Stop a running cycle. Idempotent — safe to call when nothing is running. */
export const stopWinCycle = (): void => {
	generation += 1;
	// A stop can land mid-pass with the line drawn; without this it would survive into the spin.
	clearCycleLine();
};

/**
 * The per-win entries the cycle steps through, in book order — one per PAYING win, carrying both
 * its traced cells and the win itself (the line's points, amount and message are derived from it
 * when `showLine` is on). Wins that trace no cells are dropped so a stray entry can't introduce a
 * blank beat in the rotation.
 */
const cycleEntries = (): { win: CycleWin; positions: Position[] }[] =>
	wins
		.map((win) => ({ win, positions: winningPositionsOf(win) }))
		.filter((entry) => entry.positions.length > 0);

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

	while (token === generation) {
		for (const { win, positions } of entries) {
			if (token !== generation) return;
			// `winLineEnabledForWin` is the SAME gate the round uses, so the replay inherits its
			// rules for free: a scatter pays "anywhere" and draws no line, and the whole overlay
			// obeys the Symbols-State-Machine win-line toggle. Those wins still light their symbols.
			const withLine = cfg.showLine && winLineEnabledForWin(win);
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
			await animateSymbols({ positions });
			if (token !== generation) return;
			clearCycleLine();
			await waitForTimeout(gapMs);
		}
	}
};
