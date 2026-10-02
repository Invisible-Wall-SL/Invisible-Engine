/**
 * Invisible Flow — apps/lines EMITTER VOCABULARY (GENERATED — do not edit by hand).
 *
 * Source: `apps/lines/src/game/typesEmitterEvent.ts` (the emitter union) + `apps/lines/src/game/flowEffects.ts` (the effect catalog).
 * Regenerate: `pnpm gen:flow-vocab`. Verified by `flow-spike run vocab`.
 *
 * This is the game's REAL Broadcast/effect vocabulary as DATA, fed to the `/flow` choreography
 * palette in place of the bundled `DEFAULT_EMITTER_VOCABULARY` (design doc §3, Phase 7). It is
 * an authoring-fidelity catalog only — the runtime executor broadcasts/invokes whatever the
 * FlowDoc declares regardless of this list, so there is zero game-parity risk.
 */

import type { EmitterVocabulary } from 'engine-flow';

export const LINES_EMITTER_VOCABULARY: EmitterVocabulary = {
	source: 'lines',
	events: [
		{
			type: 'boardSettle',
			group: 'Board',
			fields: [
				{
					key: 'board',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'boardShow',
			group: 'Board',
		},
		{
			type: 'boardHide',
			group: 'Board',
		},
		{
			type: 'boardWithAnimateSymbols',
			group: 'Board',
			fields: [
				{
					key: 'symbolPositions',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'boardExplodeWinSymbols',
			group: 'Board',
			fields: [
				{
					key: 'symbolPositions',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'reelStop',
			group: 'Board',
			fields: [
				{
					key: 'index',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'boardFrameGlowShow',
			group: 'Board frame',
		},
		{
			type: 'boardFrameGlowHide',
			group: 'Board frame',
		},
		{
			type: 'winShow',
			group: 'Win',
		},
		{
			type: 'winHide',
			group: 'Win',
		},
		{
			type: 'winUpdate',
			group: 'Win',
			fields: [
				{
					key: 'amount',
					kind: 'number',
					required: true,
				},
				{
					key: 'winLevelData',
					kind: 'object',
					required: true,
				},
				{
					key: 'holdToSpeedUp',
					kind: 'boolean',
					required: false,
				},
				{
					key: 'tapToSkip',
					kind: 'boolean',
					required: false,
				},
			],
		},
		{
			type: 'winCountUpComplete',
			group: 'Win',
		},
		{
			type: 'winPresentationForget',
			group: 'WinLine',
		},
		{
			type: 'winLineShow',
			group: 'WinLine',
			fields: [
				{
					key: 'points',
					kind: 'list',
					required: true,
				},
				{
					key: 'amount',
					kind: 'string',
					required: true,
				},
				{
					key: 'message',
					kind: 'string',
					required: true,
				},
			],
		},
		{
			type: 'winLineHide',
			group: 'WinLine',
		},
		{
			type: 'winAmountCue',
			group: 'WinLine',
			fields: [
				{
					key: 'target',
					kind: 'number',
					required: true,
				},
				{
					key: 'amountAt',
					kind: 'object',
					required: true,
				},
			],
		},
		{
			type: 'winAmountCueHide',
			group: 'WinLine',
		},
		{
			type: 'freeSpinIntroShow',
			group: 'Free spins',
		},
		{
			type: 'freeSpinIntroHide',
			group: 'Free spins',
		},
		{
			type: 'freeSpinIntroUpdate',
			group: 'Free spins',
			fields: [
				{
					key: 'totalFreeSpins',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'freeSpinCounterShow',
			group: 'Free spins',
		},
		{
			type: 'freeSpinCounterHide',
			group: 'Free spins',
		},
		{
			type: 'freeSpinCounterUpdate',
			group: 'Free spins',
			fields: [
				{
					key: 'current',
					kind: 'number',
					required: false,
				},
				{
					key: 'total',
					kind: 'number',
					required: false,
				},
			],
		},
		{
			type: 'freeSpinOutroShow',
			group: 'Free spins',
		},
		{
			type: 'freeSpinOutroHide',
			group: 'Free spins',
		},
		{
			type: 'freeSpinOutroCountUp',
			group: 'Free spins',
			fields: [
				{
					key: 'amount',
					kind: 'number',
					required: true,
				},
				{
					key: 'winLevelData',
					kind: 'object',
					required: true,
				},
				{
					key: 'holdToSpeedUp',
					kind: 'boolean',
					required: false,
				},
				{
					key: 'tapToSkip',
					kind: 'boolean',
					required: false,
				},
			],
		},
		{
			type: 'freeSpinOutroCountUpComplete',
			group: 'Free spins',
		},
		{
			type: 'specialBookReveal',
			group: 'Special book',
			fields: [
				{
					key: 'symbol',
					kind: 'string',
					required: true,
				},
			],
		},
		{
			type: 'specialBookHide',
			group: 'Special book',
		},
		{
			type: 'soundMusic',
			group: 'Sound',
			fields: [
				{
					key: 'name',
					kind: 'string',
					required: true,
				},
				{
					key: 'volume',
					kind: 'number',
					required: false,
				},
			],
		},
		{
			type: 'soundOnce',
			group: 'Sound',
			fields: [
				{
					key: 'name',
					kind: 'string',
					required: true,
				},
				{
					key: 'forcePlay',
					kind: 'boolean',
					required: false,
				},
				{
					key: 'volume',
					kind: 'number',
					required: false,
				},
			],
		},
		{
			type: 'soundLoop',
			group: 'Sound',
			fields: [
				{
					key: 'name',
					kind: 'string',
					required: true,
				},
			],
		},
		{
			type: 'soundStop',
			group: 'Sound',
			fields: [
				{
					key: 'name',
					kind: 'string',
					required: true,
				},
			],
		},
		{
			type: 'soundFade',
			group: 'Sound',
			fields: [
				{
					key: 'name',
					kind: 'string',
					required: true,
				},
				{
					key: 'from',
					kind: 'number',
					required: true,
				},
				{
					key: 'to',
					kind: 'number',
					required: true,
				},
				{
					key: 'duration',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'soundScatterCounterIncrease',
			group: 'Sound',
		},
		{
			type: 'soundScatterCounterClear',
			group: 'Sound',
		},
		{
			type: 'tumbleBoardShow',
			group: 'Cascade',
		},
		{
			type: 'tumbleBoardHide',
			group: 'Cascade',
		},
		{
			type: 'tumbleBoardInit',
			group: 'Cascade',
			fields: [
				{
					key: 'addingBoard',
					kind: 'object',
					required: true,
				},
			],
		},
		{
			type: 'tumbleBoardReset',
			group: 'Cascade',
		},
		{
			type: 'tumbleBoardExplode',
			group: 'Cascade',
			fields: [
				{
					key: 'explodingPositions',
					kind: 'object',
					required: true,
				},
			],
		},
		{
			type: 'tumbleBoardRemoveExploded',
			group: 'Cascade',
		},
		{
			type: 'tumbleBoardSlideDown',
			group: 'Cascade',
		},
		{
			type: 'tumbleBoardDrain',
			group: 'Cascade',
			fields: [
				{
					key: 'reelIndex',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'tumbleBoardAppear',
			group: 'Cascade',
			fields: [
				{
					key: 'reelIndex',
					kind: 'number',
					required: false,
				},
			],
		},
		{
			type: 'multiplierBoardShow',
			group: 'Multipliers',
		},
		{
			type: 'multiplierBoardHide',
			group: 'Multipliers',
		},
		{
			type: 'multiplierBoardInit',
			group: 'Multipliers',
		},
		{
			type: 'multiplierBoardReset',
			group: 'Multipliers',
		},
		{
			type: 'multiplierBoardAnimate',
			group: 'Multipliers',
		},
		{
			type: 'multiplierBoardMove',
			group: 'Multipliers',
		},
		{
			type: 'respinBoardShow',
			group: 'Hold and Win',
		},
		{
			type: 'respinBoardHide',
			group: 'Hold and Win',
		},
		{
			type: 'respinBoardSpin',
			group: 'Hold and Win',
			fields: [
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinCoinsLand',
			group: 'Hold and Win',
			fields: [
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinCounterUpdate',
			group: 'Hold and Win',
			fields: [
				{
					key: 'left',
					kind: 'number',
					required: true,
				},
				{
					key: 'start',
					kind: 'number',
					required: true,
				},
				{
					key: 'reset',
					kind: 'boolean',
					required: true,
				},
			],
		},
		{
			type: 'respinCoinPay',
			group: 'Hold and Win',
			fields: [
				{
					key: 'payer',
					kind: 'object',
					required: true,
				},
				{
					key: 'value',
					kind: 'number',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinAddRespins',
			group: 'Hold and Win',
			fields: [
				{
					key: 'cell',
					kind: 'object',
					required: true,
				},
				{
					key: 'added',
					kind: 'number',
					required: true,
				},
				{
					key: 'left',
					kind: 'number',
					required: true,
				},
				{
					key: 'total',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'respinCoinUpgrade',
			group: 'Hold and Win',
			fields: [
				{
					key: 'upgrader',
					kind: 'object',
					required: true,
				},
				{
					key: 'target',
					kind: 'object',
					required: true,
				},
				{
					key: 'step',
					kind: 'number',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinCoinBoost',
			group: 'Hold and Win',
			fields: [
				{
					key: 'source',
					kind: 'object',
					required: true,
				},
				{
					key: 'booster',
					kind: 'object',
					required: false,
				},
				{
					key: 'multiplier',
					kind: 'number',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinSpecialBecomesCoin',
			group: 'Hold and Win',
			fields: [
				{
					key: 'cell',
					kind: 'object',
					required: true,
				},
				{
					key: 'from',
					kind: 'string',
					required: true,
				},
			],
		},
		{
			type: 'respinCoinCollect',
			group: 'Hold and Win',
			fields: [
				{
					key: 'collector',
					kind: 'object',
					required: true,
				},
				{
					key: 'level',
					kind: 'number',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
				{
					key: 'value',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'respinCollectStep',
			group: 'Hold and Win',
			fields: [
				{
					key: 'cell',
					kind: 'object',
					required: true,
				},
				{
					key: 'collector',
					kind: 'object',
					required: true,
				},
				{
					key: 'index',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'respinMysteryReveal',
			group: 'Hold and Win',
			fields: [
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
				{
					key: 'activates',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinModifierUnlock',
			group: 'Hold and Win',
			fields: [
				{
					key: 'activates',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinCellsCleared',
			group: 'Hold and Win',
			fields: [
				{
					key: 'reason',
					kind: 'object',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinRowsUnlocked',
			group: 'Hold and Win',
			fields: [
				{
					key: 'from',
					kind: 'number',
					required: true,
				},
				{
					key: 'rows',
					kind: 'number',
					required: true,
				},
				{
					key: 'cause',
					kind: 'object',
					required: true,
				},
				{
					key: 'unlockers',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'respinJackpotWin',
			group: 'Hold and Win',
			fields: [
				{
					key: 'tier',
					kind: 'string',
					required: true,
				},
				{
					key: 'amount',
					kind: 'number',
					required: true,
				},
				{
					key: 'source',
					kind: 'object',
					required: true,
				},
				{
					key: 'banked',
					kind: 'boolean',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'potFill',
			group: 'Hold and Win',
			fields: [
				{
					key: 'meter',
					kind: 'string',
					required: true,
				},
				{
					key: 'level',
					kind: 'number',
					required: true,
				},
				{
					key: 'max',
					kind: 'number',
					required: true,
				},
				{
					key: 'full',
					kind: 'boolean',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'potLevelUp',
			group: 'Hold and Win',
			fields: [
				{
					key: 'meter',
					kind: 'string',
					required: true,
				},
				{
					key: 'level',
					kind: 'number',
					required: true,
				},
				{
					key: 'max',
					kind: 'number',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'potStageUp',
			group: 'Hold and Win',
			fields: [
				{
					key: 'meter',
					kind: 'string',
					required: true,
				},
				{
					key: 'stage',
					kind: 'number',
					required: true,
				},
				{
					key: 'level',
					kind: 'number',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'potFull',
			group: 'Hold and Win',
			fields: [
				{
					key: 'meter',
					kind: 'string',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'potsConsume',
			group: 'Hold and Win',
			fields: [
				{
					key: 'meters',
					kind: 'list',
					required: true,
				},
				{
					key: 'activates',
					kind: 'list',
					required: true,
				},
				{
					key: 'scope',
					kind: 'list',
					required: false,
				},
			],
		},
		{
			type: 'luckySpinIntro',
			group: 'Hold and Win',
		},
		{
			type: 'randomMetreFire',
			group: 'Hold and Win',
			fields: [
				{
					key: 'name',
					kind: 'string',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'jackpotCelebration',
			group: 'Hold and Win',
			fields: [
				{
					key: 'tier',
					kind: 'string',
					required: true,
				},
				{
					key: 'amount',
					kind: 'number',
					required: true,
				},
				{
					key: 'source',
					kind: 'object',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'respinTallyStep',
			group: 'Hold and Win',
			fields: [
				{
					key: 'index',
					kind: 'number',
					required: true,
				},
				{
					key: 'amount',
					kind: 'number',
					required: true,
				},
				{
					key: 'total',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'respinColumnComplete',
			group: 'Hold and Win',
			fields: [
				{
					key: 'reel',
					kind: 'number',
					required: true,
				},
				{
					key: 'letter',
					kind: 'string',
					required: true,
				},
				{
					key: 'newlyLit',
					kind: 'boolean',
					required: true,
				},
				{
					key: 'cleared',
					kind: 'boolean',
					required: true,
				},
				{
					key: 'amount',
					kind: 'number',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'respinColumnStep',
			group: 'Hold and Win',
			fields: [
				{
					key: 'reel',
					kind: 'number',
					required: true,
				},
				{
					key: 'index',
					kind: 'number',
					required: true,
				},
				{
					key: 'total',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'wheelShow',
			group: 'Hold and Win',
			fields: [
				{
					key: 'prizes',
					kind: 'list',
					required: true,
				},
			],
		},
		{
			type: 'wheelSpin',
			group: 'Hold and Win',
			fields: [
				{
					key: 'segment',
					kind: 'number',
					required: true,
				},
				{
					key: 'prize',
					kind: 'object',
					required: true,
				},
			],
		},
		{
			type: 'wheelLand',
			group: 'Hold and Win',
			fields: [
				{
					key: 'segment',
					kind: 'number',
					required: true,
				},
				{
					key: 'prize',
					kind: 'object',
					required: true,
				},
			],
		},
		{
			type: 'instantCollectWin',
			group: 'Hold and Win',
			fields: [
				{
					key: 'specials',
					kind: 'list',
					required: true,
				},
				{
					key: 'multiplier',
					kind: 'number',
					required: true,
				},
				{
					key: 'times',
					kind: 'number',
					required: true,
				},
				{
					key: 'cells',
					kind: 'list',
					required: true,
				},
				{
					key: 'amount',
					kind: 'number',
					required: true,
				},
			],
		},
		{
			type: 'platformJackpotCelebration',
			group: 'Platform jackpot',
			fields: [
				{
					key: 'tier',
					kind: 'string',
					required: true,
				},
				{
					key: 'amount',
					kind: 'number',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'transition',
			group: 'Transition',
		},
		{
			type: 'flightArrive',
			group: 'Flights',
			fields: [
				{
					key: 'flight',
					kind: 'string',
					required: true,
				},
				{
					key: 'target',
					kind: 'string',
					required: true,
				},
				{
					key: 'index',
					kind: 'number',
					required: true,
				},
				{
					key: 'scope',
					kind: 'string',
					required: false,
				},
			],
		},
		{
			type: 'stopButtonEnable',
			group: 'UI',
		},
		{
			type: 'uiShow',
			group: 'UI',
		},
		{
			type: 'uiHide',
			group: 'UI',
		},
		{
			type: 'drawerUnfold',
			group: 'UI',
		},
		{
			type: 'drawerFold',
			group: 'UI',
		},
		{
			type: 'drawerButtonShow',
			group: 'UI',
		},
		{
			type: 'drawerButtonHide',
			group: 'UI',
		},
		{
			type: 'soundPressStop',
			group: 'UI',
		},
	],
	effects: [
		{
			name: 'cameraEffect',
			group: 'Effect',
		},
		{
			name: 'revealBoard',
			group: 'Effect',
		},
		{
			name: 'enableSequentialReelStop',
			group: 'Effect',
		},
		{
			name: 'disableSequentialReelStop',
			group: 'Effect',
		},
		{
			name: 'enableAnticipationMode',
			group: 'Effect',
		},
		{
			name: 'disableAnticipationMode',
			group: 'Effect',
		},
		{
			name: 'enableStackedPictures',
			group: 'Effect',
		},
		{
			name: 'disableStackedPictures',
			group: 'Effect',
		},
		{
			name: 'showRespinBoard',
			group: 'Effect',
		},
		{
			name: 'spinRespin',
			group: 'Effect',
		},
		{
			name: 'stickCoins',
			group: 'Effect',
		},
		{
			name: 'setRespinCounter',
			group: 'Effect',
		},
		{
			name: 'restoreRespinBoard',
			group: 'Effect',
		},
		{
			name: 'hideRespinBoard',
			group: 'Effect',
		},
		{
			name: 'payCoins',
			group: 'Effect',
		},
		{
			name: 'addRespins',
			group: 'Effect',
		},
		{
			name: 'upgradeCoins',
			group: 'Effect',
		},
		{
			name: 'boostCoins',
			group: 'Effect',
		},
		{
			name: 'turnSpecialIntoCoin',
			group: 'Effect',
		},
		{
			name: 'collectCoins',
			group: 'Effect',
		},
		{
			name: 'revealMystery',
			group: 'Effect',
		},
		{
			name: 'clearRespinCells',
			group: 'Effect',
		},
		{
			name: 'unlockRows',
			group: 'Effect',
		},
		{
			name: 'showJackpotWin',
			group: 'Effect',
		},
		{
			name: 'fillMeter',
			group: 'Effect',
		},
		{
			name: 'playLuckySpinIntro',
			group: 'Effect',
		},
		{
			name: 'fireRandomMetre',
			group: 'Effect',
		},
		{
			name: 'lightLetter',
			group: 'Effect',
		},
		{
			name: 'instantCollect',
			group: 'Effect',
		},
		{
			name: 'spinWheel',
			group: 'Effect',
		},
		{
			name: 'flyTo',
			group: 'Effect',
		},
		{
			name: 'setWinBookEventAmount',
			group: 'Effect',
		},
		{
			name: 'setSpecialSymbol',
			group: 'Effect',
		},
		{
			name: 'expandBookColumns',
			group: 'Effect',
		},
		{
			name: 'setFreeSpinCounterTotal',
			group: 'Effect',
		},
		{
			name: 'freeSpinIntroShow',
			group: 'Effect',
		},
		{
			name: 'setFreeGameType',
			group: 'Effect',
		},
		{
			name: 'freeSpinIntroHide',
			group: 'Effect',
		},
		{
			name: 'freeSpinCounterShow',
			group: 'Effect',
		},
		{
			name: 'setFreeSpinCounterTotalOnly',
			group: 'Effect',
		},
		{
			name: 'freeSpinCounterUpdate',
			group: 'Effect',
		},
		{
			name: 'updateFreeSpinCounter',
			group: 'Effect',
		},
		{
			name: 'enterFreeSpinOutro',
			group: 'Effect',
		},
		{
			name: 'winLevelSoundsPlay',
			group: 'Effect',
		},
		{
			name: 'winLevelSoundsStop',
			group: 'Effect',
		},
		{
			name: 'freeSpinOutroCountUp',
			group: 'Effect',
		},
		{
			name: 'exitFreeSpinOutro',
			group: 'Effect',
		},
		{
			name: 'winShow',
			group: 'Effect',
		},
		{
			name: 'winUpdate',
			group: 'Effect',
		},
		{
			name: 'winHide',
			group: 'Effect',
		},
		{
			name: 'showMessage',
			group: 'Effect',
		},
		{
			name: 'animateWinSymbols',
			group: 'Effect',
		},
		{
			name: 'showWinLine',
			group: 'Effect',
		},
		{
			name: 'hideWinLine',
			group: 'Effect',
		},
		{
			name: 'stopReel',
			group: 'Effect',
		},
		{
			name: 'selectBetMode',
			group: 'Effect',
		},
		{
			name: 'setBetAmount',
			group: 'Effect',
		},
		{
			name: 'openBetMenu',
			group: 'Effect',
		},
		{
			name: 'setAutoSpins',
			group: 'Effect',
		},
		{
			name: 'setAutoSpinLossLimit',
			group: 'Effect',
		},
		{
			name: 'setAutoSpinWinLimit',
			group: 'Effect',
		},
		{
			name: 'startAutoSpins',
			group: 'Effect',
		},
		{
			name: 'stopAutoSpins',
			group: 'Effect',
		},
		{
			name: 'commitBuyBonus',
			group: 'Effect',
		},
	],
	bookEvents: [
		{
			type: 'reveal',
		},
		{
			type: 'winInfo',
		},
		{
			type: 'setTotalWin',
		},
		{
			type: 'freeSpinTrigger',
		},
		{
			type: 'updateFreeSpin',
		},
		{
			type: 'createBonusSnapshot',
		},
		{
			type: 'tumbleBoard',
		},
		{
			type: 'updateTumbleWin',
		},
		{
			type: 'updateGlobalMult',
		},
		{
			type: 'boardMultiplierInfo',
		},
		{
			type: 'finalWin',
		},
		{
			type: 'setWin',
		},
		{
			type: 'freeSpinEnd',
		},
		{
			type: 'setExpandingSymbol',
		},
		{
			type: 'expandBookColumns',
		},
		{
			type: 'freeSpinRetrigger',
		},
		{
			type: 'luckySpin',
		},
		{
			type: 'meterUpdate',
		},
		{
			type: 'meterLevels',
		},
		{
			type: 'jackpotLevels',
		},
		{
			type: 'platformJackpotWin',
		},
		{
			type: 'coinInstantCollect',
		},
		{
			type: 'randomMetreTrigger',
		},
		{
			type: 'holdAndWinTrigger',
		},
		{
			type: 'holdAndWinWheel',
		},
		{
			type: 'respinReveal',
		},
		{
			type: 'coinsLand',
		},
		{
			type: 'mysteryReveal',
		},
		{
			type: 'coinPay',
		},
		{
			type: 'respinsAdded',
		},
		{
			type: 'coinUpgrade',
		},
		{
			type: 'coinBoost',
		},
		{
			type: 'specialBecomesCoin',
		},
		{
			type: 'coinCollect',
		},
		{
			type: 'cellsCleared',
		},
		{
			type: 'rowsUnlocked',
		},
		{
			type: 'columnComplete',
		},
		{
			type: 'jackpotWin',
		},
		{
			type: 'respinUpdate',
		},
		{
			type: 'holdAndWinState',
		},
		{
			type: 'holdAndWinEnd',
		},
		{
			type: 'overlayDrop',
		},
		{
			type: 'modeEnter',
		},
		{
			type: 'modeExit',
		},
	],
};
