/**
 * Invisible Flow v2 — the `bookOf` template vocabulary (the Book-of family, Phase 4c).
 *
 * The Book-of mechanic is the STANDARD shared-runtime vocabulary ({@link standardVocabulary}) plus
 * one expanding-symbol feature: a symbol is picked for the free-spin session, it expands to fill
 * whole reels, and a splash reveals it. Those six surfaces — two book events, two actions, two cues
 * — are the entire difference, so they are declared here and spliced into the standard palette at
 * the positions authors already know them by, rather than duplicating 600 lines that could drift.
 *
 * Transcribed VERBATIM from the reference game's real code, like the standard vocabulary itself:
 * the events are `apps/lines` `typesBookEvent.ts` members, the actions are `flowEffects.ts` registry
 * keys, and the cues are `SpecialBook.svelte`'s `EmitterEventSpecialBook` union.
 */

import type { TemplateVocabulary } from '../types';

import { SYMBOL, INT, list, insertAfter, insertBefore, standardVocabulary } from './standardVocab';

/**
 * `apps/lines` `config.symbols` keys — the symbol dropdown for a Book-of project. (A ways game
 * ships a different set; see `ways.ts`.)
 */
const BOOK_OF_SYMBOLS = ['H1', 'H2', 'H3', 'H4', 'L1', 'L2', 'L3', 'L4', 'L5', 'S', 'W'] as const;

/** The book events — the RGS drives the expanding-symbol pick and the column expand. */
const BOOK_EVENTS: TemplateVocabulary['events'] = [
	{
		name: 'setExpandingSymbol',
		payload: [
			{
				name: 'symbol',
				type: SYMBOL,
				description:
					'The chosen expanding symbol (e.g. `H1`). Feed it to the reveal splash and the set-special-symbol effect.',
			},
		],
		category: 'book',
		description:
			'The Book-of special (expanding) symbol has been picked for this free-spin session. Use it to reveal the "special symbol" splash before free spins begin.',
	},
	{
		name: 'expandBookColumns',
		payload: [
			{
				name: 'symbol',
				type: SYMBOL,
				description: 'The symbol that expands to fill whole columns.',
			},
			{
				name: 'reels',
				type: list(INT),
				description: 'The reel indexes (0 = leftmost) that expand on this step.',
			},
		],
		category: 'book',
		description:
			'The chosen special symbol expands to fill whole reels. Use it to play the column-expand animation on the listed reels before scoring the free spin.',
	},
];

/** Arm the picked special symbol — leads the standard state/presentation effects. */
const SET_SPECIAL_SYMBOL: TemplateVocabulary['actions'][number] = {
	name: 'setSpecialSymbol',
	params: [{ name: 'symbol', type: SYMBOL }],
	category: 'effect',
};

/** Run the column expand — a mechanic op, so it closes the standard command list. */
const EXPAND_BOOK_COLUMNS: TemplateVocabulary['actions'][number] = {
	name: 'expandBookColumns',
	params: [
		{ name: 'symbol', type: SYMBOL },
		{ name: 'reels', type: list(INT) },
	],
	category: 'command',
};

/** The reveal splash — opens the cue list. */
const BOOK_CUES: TemplateVocabulary['cues'] = [
	// Special book (the book-of reveal).
	{ name: 'specialBookReveal', payload: [{ name: 'symbol', type: SYMBOL }] },
	{ name: 'specialBookHide', payload: [] },
];

const standard = standardVocabulary({ templateId: 'bookOf', symbolNames: BOOK_OF_SYMBOLS });

export const BOOK_OF_VOCAB: TemplateVocabulary = {
	...standard,
	// Spliced, not appended, so the palette keeps the order authors already navigate: the two book
	// events sit right behind `reveal` (the spin they belong to), `setSpecialSymbol` leads the
	// state/presentation effects, the column expand closes the commands, and the reveal splash opens
	// the cue list.
	events: insertAfter(standard.events, 'reveal', BOOK_EVENTS),
	actions: [
		...insertBefore(standard.actions, 'selectBetMode', [SET_SPECIAL_SYMBOL]),
		EXPAND_BOOK_COLUMNS,
	],
	cues: [...BOOK_CUES, ...standard.cues],
};
