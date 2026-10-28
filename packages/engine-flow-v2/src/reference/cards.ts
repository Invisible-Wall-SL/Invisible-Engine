/**
 * Invisible Flow v2 — the `card` template vocabulary (`docs/design/card-games.md` §5.3, C3).
 *
 * A card game shares the standard palette's PRESENTATION surfaces — screens, the camera and element
 * effects, sounds, the UI cues — and none of its reel, spin, bet or payline ones: there is no board
 * and no wallet. What it adds is the match driver's signals (one per `cards.js` event the
 * presentation reacts to), the actions that drive a match, and the match's numbers as `$engine`
 * values. Flow decides nothing: the rules are all in `engine-mechanics` `cards.js`.
 *
 * Cards are named by their library id (`card`, `attacker`), so a flow can react to which card it
 * was; a target is a unit's card id, `myHero` or `enemyHero`. `mine` is true for the player's side.
 */

import type { ActionDecl, EventDecl, TemplateVocabulary } from '../types';

import { CARD_TEMPLATE_ID } from './cardsSeed';
import { standardVocabulary } from './standardVocab';

const STRING = { t: 'string' } as const;
const INT = { t: 'int' } as const;
const BOOL = { t: 'bool' } as const;

/** The phases a turn runs — `engine-mechanics` `Phase`. */
export const CARD_PHASES = ['start', 'draw', 'main', 'combat', 'end'] as const;

/** Why a match ended — `engine-mechanics` `MatchResult.reason`. */
export const CARD_END_REASONS = ['hero', 'concede', 'loop', 'turnLimit'] as const;

const CARD = (description: string) => ({ name: 'card', type: STRING, description });
const MINE = { name: 'mine', type: BOOL, description: "True for the player's side." };
const TARGET = {
	name: 'target',
	type: STRING,
	description: "A unit's card id, `myHero` or `enemyHero`.",
};

const MATCH_EVENTS: EventDecl[] = [
	{
		name: 'matchReady',
		payload: [{ name: 'first', type: BOOL, description: 'True when the player goes first.' }],
		category: 'book',
		description: 'A new match is dealt and waits on its first turn. Show the table here.',
	},
	{
		name: 'turnStarted',
		payload: [MINE, { name: 'turn', type: INT, description: '1, 2, 3 …; both turns count.' }],
		category: 'book',
		description: "A turn began: the player's when `mine`, else the AI's.",
	},
	{
		name: 'phaseChanged',
		payload: [{ name: 'phase', type: { t: 'enum', name: 'CardPhase' }, description: 'The phase.' }],
		category: 'book',
		description: 'The turn moved to another phase (main, then combat, then end).',
	},
	{
		name: 'cardDrawn',
		payload: [
			CARD('The drawn card.'),
			MINE,
			{
				name: 'burned',
				type: BOOL,
				description: 'True when the hand was full and the card went to the discard pile.',
			},
		],
		category: 'book',
		description: 'A card was drawn.',
	},
	{
		name: 'cardPlayed',
		payload: [CARD('The played card.'), MINE],
		category: 'book',
		description: 'A card was played from the hand: a unit lands, a spell resolves.',
	},
	{
		name: 'unitAttacked',
		payload: [{ name: 'attacker', type: STRING, description: 'The attacking unit.' }, TARGET],
		category: 'book',
		description: 'A unit attacked, before its damage.',
	},
	{
		name: 'damaged',
		payload: [TARGET, { name: 'amount', type: INT, description: 'Damage dealt (0 on a shield).' }],
		category: 'book',
		description: 'A unit or a hero took damage.',
	},
	{
		name: 'healed',
		payload: [TARGET, { name: 'amount', type: INT, description: 'Health restored.' }],
		category: 'book',
		description: 'A unit or a hero was healed.',
	},
	{
		name: 'unitSummoned',
		payload: [CARD('The summoned unit.'), MINE],
		category: 'book',
		description: 'An effect put a unit on the board.',
	},
	{
		name: 'unitDied',
		payload: [CARD('The unit that died.')],
		category: 'book',
		description: 'A unit died and left the board.',
	},
	{
		name: 'matchEnded',
		payload: [
			{
				name: 'won',
				type: BOOL,
				description: 'True when the player won; false on a loss or a draw.',
			},
			{
				name: 'reason',
				type: { t: 'enum', name: 'CardEndReason' },
				description: 'Why it ended.',
			},
		],
		category: 'book',
		description: 'The match is over. Show the result screen here.',
	},
];

const MATCH_ACTIONS: ActionDecl[] = [
	{ name: 'cardsEndPhase', params: [], category: 'command' },
	{ name: 'cardsConcede', params: [], category: 'command' },
	{
		name: 'cardsNewMatch',
		params: [
			{
				name: 'deck',
				type: STRING,
				description: "The player deck's id; empty for the config's first player deck.",
			},
		],
		category: 'command',
	},
	{ name: 'cardsSetInput', params: [{ name: 'enabled', type: BOOL }], category: 'command' },
	{ name: 'cardsHint', params: [], category: 'command' },
];

/** Every action the card runtime backs. */
export const CARD_MATCH_ACTIONS: readonly string[] = /* @__PURE__ */ MATCH_ACTIONS.map(
	(action) => action.name,
);

/** The `$engine` values the card runtime answers. */
export const CARD_MATCH_VALUES: readonly string[] = [
	'myHealth',
	'enemyHealth',
	'resource',
	'resourceMax',
	'deckCount',
	'enemyDeckCount',
	'turn',
	'phase',
];

const KEPT_EVENTS = new Set(['load', 'tapToStart', 'settings', 'soundToggle', 'gameRules']);
const KEPT_ACTIONS = new Set([
	'cameraEffect',
	'elementEffect',
	'stopElementEffect',
	'openGameRules',
	'openSettings',
	'toggleSound',
	'toggleFullscreen',
]);
const KEPT_CUES = new Set([
	'soundMusic',
	'soundOnce',
	'soundLoop',
	'soundStop',
	'uiShow',
	'uiHide',
	'transition',
]);
const KEPT_ENUMS = new Set([
	'SymbolName',
	'CameraEffectKind',
	'ElementFxKind',
	'ElementFxTarget',
	'MusicName',
	'SoundEffectName',
	'SoundName',
]);

const VALUE_HELP: Record<string, string> = {
	myHealth: "The player hero's health.",
	enemyHealth: "The AI hero's health.",
	resource: 'The resource the player has left this turn.',
	resourceMax: "The player's resource maximum this turn.",
	deckCount: "Cards left in the player's deck.",
	enemyDeckCount: "Cards left in the AI's deck.",
	turn: 'The turn number; both turns count.',
	phase: "The current phase's name.",
};

// `@__PURE__`: a runtime built without this family drops it (`docs/design/phase-11.md` §2.2);
// Rollup otherwise keeps a top-level call for its possible side effects.
const standard = /* @__PURE__ */ standardVocabulary({ templateId: CARD_TEMPLATE_ID });

export const CARD_VOCAB: TemplateVocabulary = /* @__PURE__ */ (() => ({
	templateId: CARD_TEMPLATE_ID,
	structs: [],
	enums: [
		...standard.enums.filter((e) => KEPT_ENUMS.has(e.name)),
		{ name: 'CardPhase', values: [...CARD_PHASES] },
		{ name: 'CardEndReason', values: [...CARD_END_REASONS] },
	],
	events: [...standard.events.filter((e) => KEPT_EVENTS.has(e.name)), ...MATCH_EVENTS],
	actions: [...standard.actions.filter((a) => KEPT_ACTIONS.has(a.name)), ...MATCH_ACTIONS],
	cues: standard.cues.filter((c) => KEPT_CUES.has(c.name)),
	collections: [],
	values: CARD_MATCH_VALUES.map((name) => ({
		name,
		type: name === 'phase' ? STRING : INT,
		description: VALUE_HELP[name],
	})),
}))();
