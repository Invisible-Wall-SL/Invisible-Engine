/**
 * Invisible Flow v2 — the `bookOf` template vocabulary (the Book-of family, Phase 4c).
 *
 * The Book-of mechanic is the STANDARD shared-runtime vocabulary ({@link standardVocabulary}) plus
 * one expanding-symbol feature: a symbol is picked for the free-spin session, it expands to fill
 * whole reels, and a splash reveals it. Those six surfaces — two book events, two actions, two cues
 * — plus the lines wilds that rewrite a landed board (two events, two actions) are the entire
 * difference, so they are declared here and spliced into the standard palette at the positions
 * authors already know them by, rather than duplicating 600 lines that could drift. This is the
 * vocabulary `lines` resolves to (`VOCABULARY_FALLBACKS`).
 *
 * Transcribed VERBATIM from the reference game's real code, like the standard vocabulary itself:
 * the events are `apps/lines` `typesBookEvent.ts` members, the actions are `flowEffects.ts` registry
 * keys, and the cues are `SpecialBook.svelte`'s `EmitterEventSpecialBook` union.
 */

import type { TemplateVocabulary, TypeRef } from '../types';

import { SYMBOL, INT, list, insertAfter, insertBefore, standardVocabulary } from './standardVocab';

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

const POSITION: TypeRef = { t: 'struct', name: 'Position' };
const BOOL: TypeRef = { t: 'bool' };

/**
 * The wilds that rewrite a landed lines board (`docs/design/expanding-and-growing-wilds.md`): an
 * expanding wild fills its reel, a growing wild copies itself onto its neighbours. Both follow the
 * `reveal` and precede the spin's wins; the shared runtime presents them, so they ride this palette.
 */
const WILD_EVENTS: TemplateVocabulary['events'] = [
	{
		name: 'expandWild',
		payload: [
			{ name: 'reel', type: INT, description: 'The reel the wild fills (0 = leftmost).' },
			{ name: 'row', type: INT, description: 'The row the wild landed on.' },
			{ name: 'symbol', type: SYMBOL, description: 'The expanding wild.' },
			{
				name: 'cells',
				type: list(POSITION),
				description: 'The cells of that reel that become the wild (never the landed cell).',
			},
			{
				name: 'paid',
				type: BOOL,
				description:
					'A paying line of this spin crosses the reel. Under the default `show: onWin` an unpaid expansion is not drawn.',
			},
		],
		category: 'book',
		description:
			'An expanding wild landed and fills its reel before the wins are counted. Play the reel fill with the expand-wild effect.',
	},
	{
		name: 'growWild',
		payload: [
			{ name: 'origin', type: POSITION, description: 'The cell the growing wild landed on.' },
			{ name: 'symbol', type: SYMBOL, description: 'The growing wild.' },
			{
				name: 'cells',
				type: list(POSITION),
				description: 'The cells it copies itself onto, in the order they turn.',
			},
		],
		category: 'book',
		description:
			'A growing wild copies itself onto the cells next to it before the wins are counted. Play it with the grow-wild effect.',
	},
];

/** Run the wild rewrites — mechanic ops, after the column expand. */
const WILD_ACTIONS: TemplateVocabulary['actions'] = [
	{
		name: 'expandWild',
		params: [
			{ name: 'reel', type: INT },
			{ name: 'row', type: INT },
			{ name: 'symbol', type: SYMBOL },
			{ name: 'cells', type: list(POSITION) },
			{ name: 'paid', type: BOOL },
		],
		category: 'command',
	},
	{
		name: 'growWild',
		params: [
			{ name: 'origin', type: POSITION },
			{ name: 'symbol', type: SYMBOL },
			{ name: 'cells', type: list(POSITION) },
		],
		category: 'command',
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

const standard = standardVocabulary({ templateId: 'bookOf' });

export const BOOK_OF_VOCAB: TemplateVocabulary = {
	...standard,
	// Spliced, not appended, so the palette keeps the order authors already navigate: the two book
	// events sit right behind `reveal` (the spin they belong to), `setSpecialSymbol` leads the
	// state/presentation effects, the column expand closes the commands, and the reveal splash opens
	// the cue list.
	events: insertAfter(standard.events, 'reveal', [...BOOK_EVENTS, ...WILD_EVENTS]),
	actions: [
		...insertBefore(standard.actions, 'selectBetMode', [SET_SPECIAL_SYMBOL]),
		EXPAND_BOOK_COLUMNS,
		...WILD_ACTIONS,
	],
	cues: [...BOOK_CUES, ...standard.cues],
};
