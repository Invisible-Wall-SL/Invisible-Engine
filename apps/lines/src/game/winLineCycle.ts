/**
 * WIN-LINE IDLE CYCLE — the resting-board replay of the round's winning lines.
 *
 * `winInfo` presents each win exactly ONCE and the board then sits static until the next spin.
 * Slots conventionally keep cycling the winning lines while the player looks at the result, so
 * this module replays the LAST spin's wins — line + stamped amount + lit symbols, the same leaves
 * the round itself used — on a loop, from the moment the round's presentation finishes until the
 * next bet starts.
 *
 * WHY IT LIVES OUTSIDE THE HANDLER. The cycle is not part of any book event: it starts after the
 * whole book has been presented and must survive as long as nothing else is happening. It is
 * driven from `playBet` (start in `finally`, stop at the top) so it covers all three dispatch
 * paths — coded handler, v1 flow, v2 flow — at one seam, and the wins are recorded in
 * `dispatchBookEvent` for the same reason: a flow-owned `winInfo` never reaches the coded handler.
 *
 * It reuses `flowEffects`' shared leaves (`winningPositionsOf` / `winLineEnabledForWin` /
 * `winLinePointsFor` / `winLineTextFor` / `animateSymbols`), so a cycled pass is byte-identical to
 * the round's own pass — including the excluded-symbol rule (a scatter draws no line) and the
 * Symbols-State-Machine on/off toggle.
 */

import { stateBetDerived } from 'state-shared';
import { SECOND } from 'constants-shared/time';
import { waitForTimeout } from 'utils-shared/wait';

import { eventEmitter } from './eventEmitter';
import {
	animateSymbols,
	winLineEnabledForWin,
	winLinePointsFor,
	winLineTextFor,
	winningPositionsOf,
} from './flowEffects';
import type { BookEvent, BookEventOfType } from './typesBookEvent';
import { bakedWinLineConfig } from '../editor-scenes';

type CycleWin = BookEventOfType<'winInfo'>['wins'][number];

/**
 * The floor under the authored gap. A cycled pass is only as long as its awaited cues, and a cue
 * with no subscriber (the board unmounted behind a screen, say) resolves immediately — so a zero
 * gap would turn the loop into a frame-rate-bound busy loop. This keeps it a paced replay whatever
 * the author sets.
 */
const MIN_GAP_MS = 120;

/** The wins of the LAST presented spin — what the cycle replays. */
let wins: CycleWin[] = [];
/** Bumped by every start/stop; a running loop exits as soon as its own token is stale. */
let generation = 0;

/**
 * Record the wins the cycle will replay. Called for EVERY book event on every dispatch path:
 * `reveal` clears (a new spin's board invalidates the previous spin's lines — this is what makes a
 * free-spin feature cycle its LAST spin rather than the whole book), `winInfo` sets.
 */
export const recordWinLineCycleWins = (bookEvent: BookEvent): void => {
	if (bookEvent.type === 'reveal') wins = [];
	else if (bookEvent.type === 'winInfo') wins = bookEvent.wins;
};

/** Stop a running cycle and clear the line. Idempotent — safe to call when nothing is running. */
export const stopWinLineCycle = (): void => {
	generation += 1;
	eventEmitter.broadcast({ type: 'winLineHide' });
};

/**
 * Start cycling the recorded wins. NOT awaited by the caller — it only ends when
 * {@link stopWinLineCycle} runs (i.e. the next bet).
 *
 * Skipped while the game is spinning continuously (autoplay / space hold): the next spin is
 * already on its way, so a cycle there would be a flash between rounds rather than a replay.
 */
export const startWinLineCycle = async (): Promise<void> => {
	const cfg = bakedWinLineConfig();
	if (!cfg.enabled || !cfg.loop) return;
	if (stateBetDerived.isContinuousBet()) return;

	const cycleWins = wins.filter((win) => winLineEnabledForWin(win));
	if (!cycleWins.length) return;

	generation += 1;
	const token = generation;
	const gapMs = Math.max(MIN_GAP_MS, cfg.loopDelay * SECOND);

	try {
		while (token === generation) {
			for (const win of cycleWins) {
				if (token !== generation) return;
				const positions = winningPositionsOf(win);
				// The points are resolved per pass, not cached: the board's live geometry is what the
				// overlay must align to, and a resize between passes moves it.
				await eventEmitter.broadcastAsync({
					type: 'winLineShow',
					points: winLinePointsFor(positions),
					...winLineTextFor({
						symbol: win.symbol,
						kind: win.kind,
						amount: win.win,
						line: win.meta?.lineIndex,
					}),
				});
				if (token !== generation) return;
				await animateSymbols({ positions });
				if (token !== generation) return;
				eventEmitter.broadcast({ type: 'winLineHide' });
				await waitForTimeout(gapMs);
			}
		}
	} finally {
		// Only the CURRENT loop clears the line: a stale pass unwinding after `stopWinLineCycle`
		// (or after a newer loop started) must not wipe what the live owner has just drawn.
		if (token === generation) eventEmitter.broadcast({ type: 'winLineHide' });
	}
};
