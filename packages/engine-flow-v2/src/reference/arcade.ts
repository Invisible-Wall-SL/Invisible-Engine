/**
 * Invisible Flow v2 — the `arcade` template vocabulary (`docs/design/game-families.md` §3.4, P10.8).
 *
 * An arcade game shares the standard palette's PRESENTATION surfaces — screens, the camera and
 * element effects, sounds, the UI cues — and none of its reel, spin, bet or payline ones: there is no
 * board and no wallet. Its play field is spawned instances moved by the arcade loop (`engine-game`
 * `createArcadeLoop`, over `engine-mechanics` `motion.js`). What it adds:
 *
 *  - the loop's signals, each raised on the step it happens: `collide` (two bodies whose tags a
 *    configured pair names start touching), `enterZone` / `leaveZone`, `leaveBounds` (a `pass` body
 *    left the field);
 *  - the actions that move bodies — `setVelocity`, `moveTo`, `setTag` — each aimed at one instance,
 *    or with `tagged` at every body carrying a tag;
 *  - `$engine.random` (seeded, so a run replays) and the field's size.
 *
 * Time and input (`onTick`, `onTimer`, `onInput`, the timers) and spawning (`spawn`, `despawn`, `$live`)
 * are Flow node kinds every vocabulary has (P10.3, P10.7), so they are not declared here.
 */

import type { ActionDecl, EventDecl, TemplateVocabulary } from '../types';

import { ARCADE_TEMPLATE_ID } from './arcadeSeed';
import { standardVocabulary } from './standardVocab';

const INSTANCE = { t: 'instance' } as const;
const STRING = { t: 'string' } as const;
const FLOAT = { t: 'float' } as const;
const BOOL = { t: 'bool' } as const;

/** The field edges a body can leave by — `engine-mechanics` `Edge`. */
export const ARCADE_EDGES = ['left', 'right', 'top', 'bottom'] as const;

const LOOP_EVENTS: EventDecl[] = [
	{
		name: 'collide',
		payload: [
			{ name: 'a', type: INSTANCE, description: "The body carrying the pair's first tag." },
			{ name: 'b', type: INSTANCE, description: 'The body carrying its second tag.' },
			{
				name: 'tagA',
				type: STRING,
				description: "The pair's first tag (Game Config → Collisions).",
			},
			{ name: 'tagB', type: STRING, description: "The pair's second tag." },
		],
		category: 'book',
		description:
			'Two bodies started touching, and a collision pair in Game Config names their tags. Fires once per touch, not while they stay touching. Branch on `tagB` to tell a hazard from a pickup.',
	},
	{
		name: 'enterZone',
		payload: [
			{ name: 'instance', type: INSTANCE, description: 'The body that entered.' },
			{ name: 'zone', type: STRING, description: "The zone's id (Game Config → Zones)." },
		],
		category: 'book',
		description: "A body moved into one of the play field's zones.",
	},
	{
		name: 'leaveZone',
		payload: [
			{ name: 'instance', type: INSTANCE, description: 'The body that left.' },
			{ name: 'zone', type: STRING, description: "The zone's id." },
		],
		category: 'book',
		description: 'A body moved out of a zone it was in.',
	},
	{
		name: 'leaveBounds',
		payload: [
			{ name: 'instance', type: INSTANCE, description: 'The body that left.' },
			{
				name: 'edge',
				type: { t: 'enum', name: 'ArcadeEdge' },
				description: 'The edge it left by.',
			},
		],
		category: 'book',
		description:
			'A body whose Edges are `pass` was on the play field and is now wholly off it (one spawned off the field to come in has not left it). Usually Despawn it here (it is still alive until you do).',
	},
];

/** The body an action aims at: one instance, else every body tagged `tagged`. */
const AIM = [
	{
		name: 'instance',
		type: INSTANCE,
		optional: true,
		description: 'The body to change. Leave it unwired to aim at every body tagged `tagged`.',
	},
	{
		name: 'tagged',
		type: STRING,
		optional: true,
		description: 'Without an instance: every body carrying this tag (`player`).',
	},
];

const LOOP_ACTIONS: ActionDecl[] = [
	{
		name: 'setVelocity',
		params: [
			...AIM,
			{ name: 'vx', type: FLOAT, optional: true, description: 'px per second; unwired keeps it.' },
			{ name: 'vy', type: FLOAT, optional: true, description: 'px per second; unwired keeps it.' },
		],
		category: 'command',
	},
	{
		name: 'moveTo',
		params: [
			...AIM,
			{ name: 'x', type: FLOAT, optional: true, description: 'Field px; unwired keeps it.' },
			{ name: 'y', type: FLOAT, optional: true, description: 'Field px; unwired keeps it.' },
		],
		category: 'command',
	},
	{
		name: 'setTag',
		params: [
			...AIM,
			{ name: 'tag', type: STRING, description: 'The tag to give or take away.' },
			{ name: 'on', type: BOOL, optional: true, description: 'False takes it away. Default true.' },
		],
		category: 'command',
	},
];

/** Every action the arcade loop backs (`createArcadeLoop`'s effects). */
export const ARCADE_LOOP_ACTIONS: readonly string[] = LOOP_ACTIONS.map((action) => action.name);

/** The lifecycle and settings surfaces an arcade game keeps from the standard palette. */
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
	'CameraEffectKind',
	'ElementFxKind',
	'ElementFxTarget',
	'MusicName',
	'SoundEffectName',
	'SoundName',
]);

const standard = standardVocabulary({ templateId: ARCADE_TEMPLATE_ID });

export const ARCADE_VOCAB: TemplateVocabulary = {
	templateId: ARCADE_TEMPLATE_ID,
	structs: [],
	enums: [
		...standard.enums.filter((e) => KEPT_ENUMS.has(e.name)),
		{ name: 'ArcadeEdge', values: [...ARCADE_EDGES] },
	],
	events: [...standard.events.filter((e) => KEPT_EVENTS.has(e.name)), ...LOOP_EVENTS],
	actions: [...standard.actions.filter((a) => KEPT_ACTIONS.has(a.name)), ...LOOP_ACTIONS],
	cues: standard.cues.filter((c) => KEPT_CUES.has(c.name)),
	collections: [],
	values: [
		{
			name: 'random',
			type: FLOAT,
			description: 'A seeded random number from 0 up to 1, new on every read; a run replays.',
		},
		{ name: 'fieldWidth', type: FLOAT, description: "The play field's width, px." },
		{ name: 'fieldHeight', type: FLOAT, description: "The play field's height, px." },
	],
};
