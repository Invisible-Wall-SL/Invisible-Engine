import { respinCounterText } from './holdAndWinText';
import { stateRespinBoard } from './stateRespinBoard.svelte';

/**
 * What the respin counter says now ("RESPINS 3", "RESPINS RESET", …). The coded counter draws it
 * and the `respinCounterText` source feeds it to an authored one, so the two cannot disagree.
 */
export const respinCounterLine = () =>
	respinCounterText(stateRespinBoard.counter.left, stateRespinBoard.counter.note);

/** The beat the counter is announcing — `award` or `reset` — and `''` while it only counts. */
export const respinCounterNote = () => stateRespinBoard.counter.note ?? '';
