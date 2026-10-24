/**
 * Invisible Flow v2 — the `match3` template vocabulary (`docs/design/game-families.md` §3.4).
 *
 * A match-3 game shares the standard palette's PRESENTATION surfaces — screens, the camera and
 * element effects, sounds, the UI cues — and none of its reel, spin, bet or payline ones: the board
 * never spins and, in a rules-decided game, there is no wallet. What it adds is the board's own
 * signals and the actions that drive the board.
 *
 * Every step after a swap is the cascade the shared runtime already plays, so the tumble cues are
 * declared here exactly as `cluster.ts` declares them. The cascade's `tumbleBoard` BOOK event is not:
 * the runtime raises it from the board module and its coded handler presents it on both paths, so a
 * flow reacts to the board through the signals below instead of re-presenting the step.
 *
 * Cells are the board's own: `{ reel, row }` with row 0 the top VISIBLE row (`engine-mechanics`
 * `board.js`), not the padded book row a slot's `Position` carries.
 */

import type { ActionDecl, CueDecl, EventDecl, TemplateVocabulary } from '../types';

import { MATCH3_TEMPLATE_ID } from './match3Seed';
import { INT, SYMBOL, list, standardVocabulary } from './standardVocab';

const POSITION = { t: 'struct', name: 'Position' } as const;
const MATCH_GROUP = { t: 'struct', name: 'MatchGroup' } as const;
const BOOL = { t: 'bool' } as const;
const FLOAT = { t: 'float' } as const;

/** How a matched group is shaped — `engine-mechanics` `MatchShape`. */
export const MATCH_SHAPES = ['line2', 'line3', 'line4', 'line5', 'L', 'T'] as const;

/** Why an RGS-decided round ended (P10.6). */
export const ROUND_END_REASONS = ['noMoves', 'movesUsed'] as const;

/** The board's signals, in the order a move plays them. */
const BOARD_EVENTS: EventDecl[] = [
	{
		name: 'boardReady',
		payload: [
			{
				name: 'moves',
				type: INT,
				description: "The moves the round allows (Game Config's Moves).",
			},
			{
				name: 'target',
				type: INT,
				description: 'The score goal, or 0 when the config sets none.',
			},
		],
		category: 'book',
		description:
			'A fresh board is on screen: the first deal, and every new deal after it (Refill board). Wire it to reset the round: the score, the moves left, the goal.',
	},
	{
		name: 'swap',
		payload: [
			{ name: 'from', type: POSITION, description: 'The cell the player moved.' },
			{ name: 'to', type: POSITION, description: 'The cell it was swapped with.' },
			{
				name: 'accepted',
				type: BOOL,
				description: 'True when the swap made a match; false when it snapped back.',
			},
		],
		category: 'book',
		description:
			'Two gems traded places, or tried to. Fires once the swap has played: an accepted swap is followed by its cascade, a refused one has already snapped back. Spend a move here when `accepted` is true.',
	},
	{
		name: 'match',
		payload: [
			{ name: 'groups', type: list(MATCH_GROUP), description: 'What matched, group by group.' },
			{ name: 'points', type: INT, description: "This step's points, from the score table." },
			{ name: 'step', type: INT, description: '1 for the swap itself, 2+ for each cascade.' },
		],
		category: 'book',
		description:
			"Gems matched and are about to explode. Fires once per cascade step, before the explosion. Add `points` to the score here; a collect goal counts its symbol's cells in `groups`.",
	},
	{
		name: 'cascadeStep',
		payload: [
			{ name: 'step', type: INT, description: '1 for the swap itself, 2+ for each cascade.' },
			{ name: 'groups', type: list(MATCH_GROUP), description: 'What this step cleared.' },
		],
		category: 'book',
		description:
			'One cascade step has played: the matched gems exploded, the survivors fell and the refills landed.',
	},
	{
		name: 'settled',
		payload: [
			{ name: 'steps', type: INT, description: 'How many cascade steps the move made.' },
			{ name: 'points', type: INT, description: 'Every step of the move, added up.' },
		],
		category: 'book',
		description:
			'The move is over and nothing more matches. The place to check the goal and the moves left.',
	},
	{
		name: 'noMoves',
		payload: [],
		category: 'book',
		description:
			'No swap on the board can make a match. A rules game usually shuffles here (Shuffle board).',
	},
	{
		name: 'roundEnd',
		payload: [
			{ name: 'totalWin', type: FLOAT, description: "The round's win, in game currency." },
			{
				name: 'reason',
				type: { t: 'enum', name: 'RoundEndReason' },
				description: 'Why the round ended.',
			},
		],
		category: 'book',
		description:
			'RGS-decided games only: the server closed the round. A rules game decides its own end and never receives this.',
	},
];

/** The board's actions. A cell is `{ reel, row }`, row 0 the top visible row. */
const BOARD_ACTIONS: ActionDecl[] = [
	{ name: 'boardSelect', params: [{ name: 'cell', type: POSITION }], category: 'command' },
	{ name: 'boardHint', params: [], category: 'command' },
	{
		name: 'boardSwap',
		params: [
			{ name: 'from', type: POSITION },
			{ name: 'to', type: POSITION },
		],
		category: 'command',
	},
	{ name: 'boardSetInput', params: [{ name: 'enabled', type: BOOL }], category: 'command' },
	{ name: 'boardResolve', params: [], category: 'command' },
	{ name: 'boardRefill', params: [], category: 'command' },
	{ name: 'boardShuffle', params: [], category: 'command' },
];

/** Every board action's name — what a runtime that backs the vocabulary must implement. */
export const MATCH3_BOARD_ACTIONS: readonly string[] = BOARD_ACTIONS.map((action) => action.name);

/**
 * The actions that decide the board, which only a rules-decided game may call (§2.2 #2): in an
 * RGS-decided game the server deals, refills and resolves. P10.6's `withOutcome(vocab, 'rgs')`
 * removes them.
 */
export const MATCH3_RULES_ONLY_ACTIONS: readonly string[] = [
	'boardResolve',
	'boardRefill',
	'boardShuffle',
];

/** The cascade cues the tumble overlay binds — the same seven `cluster.ts` declares. */
const TUMBLE_CUES: CueDecl[] = [
	{ name: 'tumbleBoardShow', payload: [] },
	{ name: 'tumbleBoardHide', payload: [] },
	{ name: 'tumbleBoardInit', payload: [{ name: 'addingBoard', type: list(list(SYMBOL)) }] },
	{ name: 'tumbleBoardReset', payload: [] },
	{ name: 'tumbleBoardExplode', payload: [{ name: 'explodingPositions', type: list(POSITION) }] },
	{ name: 'tumbleBoardRemoveExploded', payload: [] },
	{ name: 'tumbleBoardSlideDown', payload: [] },
];

/** The standard palette's lifecycle and settings surfaces a board game keeps. */
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
	'boardShow',
	'boardHide',
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

const standard = standardVocabulary({ templateId: MATCH3_TEMPLATE_ID });

export const MATCH3_VOCAB: TemplateVocabulary = {
	templateId: MATCH3_TEMPLATE_ID,
	structs: [
		...standard.structs.filter((s) => s.name === 'Position'),
		{
			name: 'MatchGroup',
			fields: [
				{ name: 'symbol', type: SYMBOL },
				{ name: 'cells', type: list(POSITION) },
				{ name: 'shape', type: { t: 'enum', name: 'MatchShape' } },
			],
		},
	],
	enums: [
		...standard.enums.filter((e) => KEPT_ENUMS.has(e.name)),
		{ name: 'MatchShape', values: [...MATCH_SHAPES] },
		{ name: 'RoundEndReason', values: [...ROUND_END_REASONS] },
	],
	events: [...standard.events.filter((e) => KEPT_EVENTS.has(e.name)), ...BOARD_EVENTS],
	actions: [...standard.actions.filter((a) => KEPT_ACTIONS.has(a.name)), ...BOARD_ACTIONS],
	cues: [...TUMBLE_CUES, ...standard.cues.filter((c) => KEPT_CUES.has(c.name))],
	collections: [],
	values: [],
};
