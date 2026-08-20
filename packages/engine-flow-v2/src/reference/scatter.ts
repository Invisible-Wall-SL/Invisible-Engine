/**
 * Invisible Flow v2 — the `scatter` template vocabulary.
 *
 * A scatter game is the CASCADE game plus one more mechanic: multipliers landed during a tumble play
 * in place, fly to the board centre, and combine into a board multiplier. So this is deliberately
 * built on {@link CLUSTER_VOCAB} rather than on the standard palette — the two share the whole
 * cascade, and expressing that as inheritance is what stops the tumble surfaces being declared twice
 * and drifting.
 *
 * Transcribed VERBATIM from the runtime's real code: `boardMultiplierInfo` is an `apps/lines`
 * `typesBookEvent.ts` member and the six cues are `MultiplierBoard.svelte`'s
 * `EmitterEventMultiplierBoard` union, both now backed by the shared runtime.
 *
 * NOT YET AUTHORABLE END-TO-END, for the same two reasons cluster is not: no RGS the engine talks to
 * sends `tumbleBoard` or `boardMultiplierInfo`, and the wire for a cascade has never been captured.
 * `scatter` is better off than cluster in one respect — it ships a committed config default
 * (`gameConfig/scatter.json`, `winModel {type:'scatter', minCount:8}`), where cluster's upstream
 * strips are empty placeholders. See docs/design/game-type-templates.md.
 */

import type { TemplateVocabulary } from '../types';

import { CLUSTER_VOCAB } from './cluster';
import { INT, list, insertAfter } from './standardVocab';

/**
 * `apps/scatter` `config.symbols` keys. `M` is the multiplier symbol — the one this template adds a
 * mechanic for. Note the runtime does NOT identify it by that name (it tests `RawSymbol.multiplier`),
 * so a project may rename it; the enum is the author's dropdown, not the mechanic's trigger.
 */
const SCATTER_SYMBOLS = ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'M', 'S', 'W'] as const;

const POSITION_WITH_MULTIPLIER = { t: 'struct' as const, name: 'Position' };

/** The multiplier-collect book event. */
const COLLECT_EVENTS: TemplateVocabulary['events'] = [
	{
		name: 'boardMultiplierInfo',
		payload: [
			{
				name: 'tumbleWin',
				type: { t: 'float' },
				description: "The cascade's running win, before the board multiplier is applied.",
			},
			{
				name: 'boardMult',
				type: INT,
				description: 'The combined multiplier the collected symbols add up to.',
			},
			{
				name: 'totalWin',
				type: { t: 'float' },
				description: 'The win after the board multiplier — what the beat ends on.',
			},
			{
				name: 'positions',
				type: list(POSITION_WITH_MULTIPLIER),
				description: 'The cells holding a multiplier, each with its own value.',
			},
		],
		category: 'book',
		description:
			'Multiplier symbols landed on this cascade step: they play where they sit, fly to the board centre, and combine into one board multiplier. Wire it to run the collect presentation and to show the win before and after the multiplier lands.',
	},
];

/** The collect cues — what the multiplier overlay binds, in the order one beat fires them. */
const COLLECT_CUES: TemplateVocabulary['cues'] = [
	{ name: 'multiplierBoardShow', payload: [] },
	{ name: 'multiplierBoardHide', payload: [] },
	{ name: 'multiplierBoardInit', payload: [] },
	{ name: 'multiplierBoardReset', payload: [] },
	{ name: 'multiplierBoardAnimate', payload: [] },
	{ name: 'multiplierBoardMove', payload: [] },
];

export const SCATTER_VOCAB: TemplateVocabulary = {
	...CLUSTER_VOCAB,
	templateId: 'scatter',
	// Its own symbol set — scatter deals the multiplier symbol cluster never sees.
	enums: CLUSTER_VOCAB.enums.map((entry) =>
		entry.name === 'SymbolName' ? { ...entry, values: [...SCATTER_SYMBOLS] } : entry,
	),
	// The collect event sits right behind the tumble it belongs to: a step lands the multipliers, then
	// they collect. Reading the palette top to bottom reads the round in order.
	events: insertAfter(CLUSTER_VOCAB.events, 'tumbleBoard', COLLECT_EVENTS),
	cues: [...COLLECT_CUES, ...CLUSTER_VOCAB.cues],
};
