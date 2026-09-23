/**
 * Invisible Flow — exported emitter vocabularies keyed by game (GENERATED — do not edit).
 *
 * Sources: each game's `typesEmitterEvent.ts` union + `flowEffects.ts` catalog.
 * Regenerate: `node scripts/gen-flow-vocabulary.mjs`. Verified by `flow-spike run vocab`.
 *
 * The `/flow` choreography palette offers the game's REAL Broadcast events + effect names
 * instead of the bundled `DEFAULT_EMITTER_VOCABULARY` (design doc §3, Phase 7). The launcher
 * loads a project from R2 (not game source), so the catalog is passed in as DATA the same way
 * the LayoutDoc + component defs are. Selection is by the LayoutDoc `gameType`; any game with
 * no exported vocabulary falls back to the default (parity-safe, §7). Authoring-fidelity only:
 * the runtime executor broadcasts/invokes whatever the FlowDoc declares regardless of this list.
 */

import { DEFAULT_EMITTER_VOCABULARY, type EmitterVocabulary } from 'engine-flow';

/** Exported vocabularies keyed by LayoutDoc `gameType`. */
export const EMITTER_VOCABULARIES: Record<string, EmitterVocabulary> = {
	lines: {
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
				type: 'bookRevealGateShow',
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
				type: 'transition',
				group: 'Transition',
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
		],
	},
	bookOf: {
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
				type: 'bookRevealGateShow',
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
				type: 'transition',
				group: 'Transition',
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
		],
	},
	ways: {
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
				type: 'bookRevealGateShow',
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
				type: 'transition',
				group: 'Transition',
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
		],
	},
};

/** Resolve the authoring vocabulary for a project's `gameType`; unknown ⇒ the coded default. */
export const resolveEmitterVocabulary = (gameType: string | undefined): EmitterVocabulary =>
	(gameType ? EMITTER_VOCABULARIES[gameType] : undefined) ?? DEFAULT_EMITTER_VOCABULARY;
