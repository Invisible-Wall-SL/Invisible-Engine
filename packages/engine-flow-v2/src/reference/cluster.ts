/**
 * Invisible Flow v2 — the `cluster` template vocabulary.
 *
 * A cluster game is the STANDARD shared-runtime vocabulary plus one mechanic: the cascade. Winning
 * symbols explode, survivors fall, replacements drop in, and the step repeats until nothing pays.
 * Those surfaces — three book events and the seven cues the tumble overlay binds — are the whole
 * difference, so they are declared here and spliced into the standard palette, the same shape
 * `bookOf.ts` uses for the expanding-symbol mechanic.
 *
 * Transcribed VERBATIM from the runtime's real code: the events are `apps/lines`
 * `typesBookEvent.ts` members and the cues are `TumbleBoard.svelte`'s `EmitterEventTumbleBoard`
 * union — both of which the shared runtime now BACKS, which is what makes declaring them honest.
 *
 * NOT YET AUTHORABLE END-TO-END. The mechanic runs, but a cluster project cannot be published and
 * played: no RGS the engine talks to sends `tumbleBoard`, and `apps/cluster`'s upstream config ships
 * EMPTY reel strips, so there is no committed default to seed a project from. This vocabulary is the
 * presentation contract, declared once the runtime could keep it — the wire and the math are the two
 * pieces still owed. See docs/design/game-type-templates.md.
 */

import type { TemplateVocabulary } from '../types';

import { SYMBOL, INT, list, insertAfter, standardVocabulary } from './standardVocab';

/**
 * `apps/cluster` `config.symbols` keys. A cluster game deals no `L5` and no `H5` — the set is
 * genuinely its own, which is why it is passed in rather than shared with lines.
 */
const CLUSTER_SYMBOLS = ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'S', 'W'] as const;

/** The cascade book events — the RGS drives each tumble step and the totals that ride along. */
const CASCADE_EVENTS: TemplateVocabulary['events'] = [
	{
		name: 'tumbleBoard',
		payload: [
			{
				name: 'explodingSymbols',
				type: list({ t: 'struct', name: 'Position' }),
				description: 'The winning cells about to blow up on this step.',
			},
			{
				name: 'newSymbols',
				type: list(list(SYMBOL)),
				description: 'The replacements that fall in from above, per reel.',
			},
		],
		category: 'book',
		description:
			'One cascade step: the winning cells explode, the survivors fall, and new symbols drop in. Sent repeatedly — once per tumble — until a step pays nothing. Wire it to run the cascade presentation; the overlay mounts and unmounts itself around the step.',
	},
	{
		name: 'updateTumbleWin',
		payload: [
			{
				name: 'amount',
				type: { t: 'float' },
				description: "The cascade's running total so far, in game currency.",
			},
		],
		category: 'book',
		description:
			'The running win ACROSS the cascade chain — not the round total. A tumble round pays once at the end, but the player watches the number climb step by step, which is what this drives.',
	},
	{
		name: 'updateGlobalMult',
		payload: [
			{
				name: 'globalMult',
				type: INT,
				description: 'The cascade multiplier. A value of 1 means the chain has RESET.',
			},
		],
		category: 'book',
		description:
			'The cascade multiplier as it escalates. Careful: `1` is the chain resetting, not a x1 step — branch on it to clear the running total rather than to announce a multiplier.',
	},
];

/** The cascade cues — what the tumble overlay binds, in the order one step fires them. */
const CASCADE_CUES: TemplateVocabulary['cues'] = [
	{ name: 'tumbleBoardShow', payload: [] },
	{ name: 'tumbleBoardHide', payload: [] },
	{ name: 'tumbleBoardInit', payload: [{ name: 'addingBoard', type: list(list(SYMBOL)) }] },
	{ name: 'tumbleBoardReset', payload: [] },
	{
		name: 'tumbleBoardExplode',
		payload: [{ name: 'explodingPositions', type: list({ t: 'struct', name: 'Position' }) }],
	},
	{ name: 'tumbleBoardRemoveExploded', payload: [] },
	{ name: 'tumbleBoardSlideDown', payload: [] },
];

const standard = standardVocabulary({ templateId: 'cluster', symbolNames: CLUSTER_SYMBOLS });

export const CLUSTER_VOCAB: TemplateVocabulary = {
	...standard,
	// The cascade events sit right behind `reveal` — a tumble is what happens NEXT to the board the
	// reveal just landed, so an author reads them in the order the round plays them.
	events: insertAfter(standard.events, 'reveal', CASCADE_EVENTS),
	// The cues open the list, mirroring how the book-of reveal cues open `bookOf`'s.
	cues: [...CASCADE_CUES, ...standard.cues],
};
