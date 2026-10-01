/**
 * Invisible Flow v2 — the `holdAndWin` template's canonical per-event PRESENTATION choreographies.
 *
 * 1:1 with `apps/lines` `bookEventHandlerMap`: every presented Hold and Win event's coded handler is
 * one `holdAndWinPresentation.ts` function, and each is a flow effect of the same body fed the whole
 * event (`bookEvent: $trigger`). The beat broadcasts its own cues, so a choreography adds none.
 *
 * Split by WHERE the event plays, because the starter flow puts each set in a different graph:
 *  - {@link HOLD_AND_WIN_BASE_CHOREO} rides on a base spin (Lucky Spin, the pots filling, a base
 *    jackpot) — the global graph.
 *  - {@link HOLD_AND_WIN_FEATURE_CHOREO} plays while the `holdAndWin` mode is on screen — the mode's
 *    own section (`FlowDoc.modes.holdAndWin`). `holdAndWinTrigger` belongs here too: the play seam
 *    enters the mode BEFORE presenting the event that opens it, and closes it only after presenting
 *    the one that ends it.
 *
 * Absent on purpose (no beat yet, so they stay on their coded handler, which re-syncs the board):
 * `meterLevels`, `coinInstantCollect`, `randomMetreTrigger`, `holdAndWinWheel`, `columnComplete`.
 */

import { trig, type ChoreoStep } from './bookOfChoreo';

const beat = (ref: string): ChoreoStep[] => [{ k: 'action', ref, inputs: { bookEvent: trig() } }];

export const HOLD_AND_WIN_BASE_CHOREO: Record<string, ChoreoStep[]> = {
	luckySpin: [{ k: 'action', ref: 'playLuckySpinIntro' }],
	meterUpdate: beat('fillMeter'),
	jackpotWin: beat('showJackpotWin'),
};

export const HOLD_AND_WIN_FEATURE_CHOREO: Record<string, ChoreoStep[]> = {
	holdAndWinTrigger: beat('showRespinBoard'),
	respinReveal: beat('spinRespin'),
	coinsLand: beat('stickCoins'),
	mysteryReveal: beat('revealMystery'),
	coinPay: beat('payCoins'),
	coinBoost: beat('boostCoins'),
	specialBecomesCoin: beat('turnSpecialIntoCoin'),
	coinCollect: beat('collectCoins'),
	cellsCleared: beat('clearRespinCells'),
	jackpotWin: beat('showJackpotWin'),
	respinUpdate: beat('setRespinCounter'),
	holdAndWinState: beat('restoreRespinBoard'),
	holdAndWinEnd: beat('hideRespinBoard'),
};
