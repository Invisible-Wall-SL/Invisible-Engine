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
 * ONE WIN PER PASS, in book order, looping back to the first — the same order the round narrated
 * (owner direction 2026-07-24: "go through all the winning lines sequentially"). A spin with three
 * paying lines therefore shows line 1's symbols, then line 2's, then line 3's, then line 1 again,
 * so each combination is legible on its own. A single-win spin is the degenerate case: one win in
 * the list, replayed over and over.
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

/** Stop a running cycle. Idempotent — safe to call when nothing is running. */
export const stopWinCycle = (): void => {
	generation += 1;
};

/**
 * The per-win cell groups the cycle steps through, in book order — one entry per PAYING win, each
 * holding just that win's own cells. Wins that trace no cells are dropped so a stray entry can't
 * introduce a blank beat in the rotation.
 */
const cycleGroups = (): Position[][] =>
	wins.map((win) => winningPositionsOf(win)).filter((positions) => positions.length > 0);

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

	const groups = cycleGroups();
	if (!groups.length) return;

	generation += 1;
	const token = generation;
	const gapMs = Math.max(MIN_GAP_MS, cfg.delay * SECOND);

	while (token === generation) {
		for (const positions of groups) {
			if (token !== generation) return;
			await animateSymbols({ positions });
			if (token !== generation) return;
			await waitForTimeout(gapMs);
		}
	}
};
