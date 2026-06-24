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
export const FLOW_VOCABULARIES: Record<string, EmitterVocabulary> = {
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
				],
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
				],
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
		],
		effects: [
			{
				name: 'revealBoard',
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
				],
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
				],
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
		],
		effects: [
			{
				name: 'revealBoard',
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
		],
	},
};

/** Resolve the authoring vocabulary for a project's `gameType`; unknown ⇒ the coded default. */
export const resolveFlowVocabulary = (gameType: string | undefined): EmitterVocabulary =>
	(gameType ? FLOW_VOCABULARIES[gameType] : undefined) ?? DEFAULT_EMITTER_VOCABULARY;
