/**
 * WIN-SYMBOL IDLE CYCLE — the resting-board replay of the round's winning SYMBOLS.
 *
 * `winInfo` animates each win's symbols exactly once and the board then sits static until the next
 * spin. Slots conventionally keep the winning symbols alive while the player looks at the result,
 * so this module re-lights them on a loop from the moment the round's presentation finishes until
 * the next bet starts.
 *
 * SYMBOLS ONLY — deliberately. The win LINE and its stamped amount belong to the round's own
 * per-win narration (draw the line, show what it paid, move to the next win); replaying them at
 * rest re-narrates a story the player has already read. So the cycle touches neither: it never
 * broadcasts `winLineShow`/`winLineHide`, and whatever the round left on screen stays as it was.
 *
 * WHY IT LIVES OUTSIDE THE HANDLER. The cycle is not part of any book event: it starts after the
 * whole book has been presented and must survive as long as nothing else is happening. It is
 * driven from `playBet` (start in `finally`, stop at the top) so it covers all three dispatch
 * paths — coded handler, v1 flow, v2 flow — at one seam, and the wins are recorded in
 * `dispatchBookEvent` for the same reason: a flow-owned `winInfo` never reaches the coded handler.
 *
 * One pass lights EVERY winning cell of the spin at once (the union across wins), rather than
 * stepping win-by-win the way the round does. Without a line to say which win is being shown,
 * sequential groups just read as symbols blinking in and out for no reason.
 */

import { stateBetDerived } from 'state-shared';
import { SECOND } from 'constants-shared/time';
import { waitForTimeout } from 'utils-shared/wait';

import { animateSymbols, winningPositionsOf } from './flowEffects';
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

/**
 * Record the wins the cycle will replay. Called for EVERY book event on every dispatch path:
 * `reveal` clears (a new spin's board invalidates the previous spin's wins — this is what makes a
 * free-spin feature cycle its LAST spin rather than the whole book), `winInfo` sets.
 */
export const recordWinCycleWins = (bookEvent: BookEvent): void => {
	if (bookEvent.type === 'reveal') wins = [];
	else if (bookEvent.type === 'winInfo') wins = bookEvent.wins;
};

/** Stop a running cycle. Idempotent — safe to call when nothing is running. */
export const stopWinCycle = (): void => {
	generation += 1;
};

/** Every winning cell of the spin, deduped — several wins routinely share a symbol. */
const cyclePositions = (): Position[] => {
	const seen = new Set<string>();
	const positions: Position[] = [];
	for (const win of wins) {
		for (const position of winningPositionsOf(win)) {
			const key = `${position.reel}:${position.row}`;
			if (seen.has(key)) continue;
			seen.add(key);
			positions.push(position);
		}
	}
	return positions;
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

	const positions = cyclePositions();
	if (!positions.length) return;

	generation += 1;
	const token = generation;
	const gapMs = Math.max(MIN_GAP_MS, cfg.delay * SECOND);

	while (token === generation) {
		await animateSymbols({ positions });
		if (token !== generation) return;
		await waitForTimeout(gapMs);
	}
};
