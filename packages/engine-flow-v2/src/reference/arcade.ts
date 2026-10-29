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
 *  - `$engine.random` and `randomX` (seeded, so a run replays) and the field's size;
 *  - characters (P10.11, §4.3): `characterState` on each brain transition, and the actions
 *    `setCharacterState` (override a brain) and `setCharacterControl` (player or brain).
 *  - the world camera's (P10.12, on a screen with a world or a camera): `enterView` / `leaveView`,
 *    `cameraFollow`, `cameraMoveTo`, `cameraShake`, `cameraSetAutoScroll`, and `cameraX` /
 *    `cameraY` / `viewWidth` / `viewHeight`, so Flow can spawn ahead of the view.
 *  - an online room's events (P11.2): `playerJoined` / `playerLeft`, `hit` / `caught`,
 *    `roundStart` / `roundEnd`, and `ability` (the device's own raised on the press). Its scores and
 *    round are variables the room writes (`FlowVariable.server`), which Flow only reads.
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
const INT = { t: 'int' } as const;

/** The field edges a body can leave by — `engine-mechanics` `Edge`. */
export const ARCADE_EDGES = ['left', 'right', 'top', 'bottom'] as const;

/** Who drives a character — `engine-game` `CHARACTER_CONTROLS`. */
export const ARCADE_CHARACTER_CONTROLS = ['controller', 'brain'] as const;

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
	{
		name: 'enterView',
		payload: [{ name: 'instance', type: INSTANCE, description: 'The body that came into view.' }],
		category: 'book',
		description:
			"A body's box started to meet the camera's view (on a screen with a world or a camera). Fires once per entry; a body spawned in view fires on its first step.",
	},
	{
		name: 'leaveView',
		payload: [{ name: 'instance', type: INSTANCE, description: 'The body that left the view.' }],
		category: 'book',
		description:
			"A body's box stopped meeting the camera's view. It is still alive: Despawn it here, or let its spawn layer's Despawn outside view do it.",
	},
	{
		name: 'characterState',
		payload: [
			{ name: 'instance', type: INSTANCE, description: 'The character.' },
			{
				name: 'character',
				type: STRING,
				description: "The character's id (Invisible Characters).",
			},
			{ name: 'from', type: STRING, description: 'The brain state it left.' },
			{ name: 'to', type: STRING, description: 'The brain state it entered.' },
		],
		category: 'book',
		description:
			"A character's brain moved to another state on its own (a guard spotted the player: `patrol` → `chase`). Not raised for Set Character State.",
	},
];

const PLAYER = (description: string) => ({ name: 'player', type: STRING, description });
const ME = (description: string) => ({ name: 'me', type: BOOL, description });
const HIT_PAYLOAD = [
	{ name: 'by', type: STRING, description: 'The player whose ability it was.' },
	{ name: 'target', type: STRING, description: 'The player it hit.' },
	{ name: 'effect', type: STRING, description: "The ability's effect (`catch`, `stun`, `tag`)." },
	{ name: 'mine', type: BOOL, description: 'This device’s player hit it.' },
	ME('This device’s player was hit.'),
];

/**
 * An online room's events (`docs/design/realtime-multiplayer.md` §4, P11.2), raised on the device
 * from the room's `event` messages (`engine-mechanics` `flowSignalsOf`) — never in an offline game.
 * Device Flow presents them; the room decides them. A player is its room id.
 */
const ONLINE_EVENTS: EventDecl[] = [
	{
		name: 'playerJoined',
		payload: [PLAYER('The player who joined.'), ME('It is this device’s player.')],
		category: 'book',
		description: 'Online: a player joined the room.',
	},
	{
		name: 'playerLeft',
		payload: [PLAYER('The player who left.'), ME('It is this device’s player.')],
		category: 'book',
		description: 'Online: a player left the room.',
	},
	{
		name: 'hit',
		payload: HIT_PAYLOAD,
		category: 'book',
		description: 'Online: an ability stunned a player (or passed `tag` on).',
	},
	{
		name: 'caught',
		payload: HIT_PAYLOAD,
		category: 'book',
		description: 'Online: an ability caught a player: it is out, and not drawn, until it respawns.',
	},
	{
		name: 'roundStart',
		payload: [{ name: 'round', type: INT, description: 'The round, from 1.' }],
		category: 'book',
		description: 'Online: a round started; every player is back at the spawn with no score.',
	},
	{
		name: 'roundEnd',
		payload: [
			{ name: 'round', type: INT, description: 'The round that ended.' },
			{ name: 'winner', type: STRING, description: "The winner's player id; empty for nobody." },
			{ name: 'won', type: BOOL, description: 'This device’s player won it.' },
		],
		category: 'book',
		description: 'Online: a round ended, at the goal or on its clock. The next starts on its own.',
	},
	{
		name: 'ability',
		payload: [
			PLAYER('The player who used it.'),
			{ name: 'character', type: STRING, description: "Its character's id (`bear`)." },
			{ name: 'button', type: STRING, description: '`ability1` or `ability2`.' },
			{ name: 'x', type: FLOAT, description: 'Where the player is drawn, field px.' },
			{ name: 'y', type: FLOAT, description: 'Field px.' },
			{ name: 'mine', type: BOOL, description: 'This device’s player used it.' },
			{
				name: 'predicted',
				type: BOOL,
				description:
					'Raised on the press, before the room answers (this device’s own; the room may still miss).',
			},
		],
		category: 'book',
		description:
			"Online: a player used an ability (a swipe, a cast). This device's own is raised on the press, so draw it here at once; everyone else's when the room tells.",
	},
];

/** Every online room event's name (`engine-mechanics` `ONLINE_FLOW_EVENTS`' values). */
export const ARCADE_ONLINE_EVENTS: readonly string[] = /* @__PURE__ */ ONLINE_EVENTS.map(
	(event) => event.name,
);

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
		name: 'setCharacterState',
		params: [
			...AIM,
			{ name: 'state', type: STRING, description: "A state of the character's brain." },
		],
		category: 'command',
	},
	{
		name: 'setCharacterControl',
		params: [
			...AIM,
			{
				name: 'control',
				type: { t: 'enum', name: 'ArcadeCharacterControl' },
				description:
					'`controller`: the player drives it; `brain`: it runs on its brain (a bot). A character without that one keeps what it has.',
			},
		],
		category: 'command',
	},
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
	{
		name: 'cameraFollow',
		params: [
			{
				name: 'instance',
				type: INSTANCE,
				optional: true,
				description:
					'The body to follow. Leave it unwired to follow the first body tagged `tagged`.',
			},
			{
				name: 'tagged',
				type: STRING,
				optional: true,
				description:
					'Without an instance: follow the first body carrying this tag. Neither stops following.',
			},
			{
				name: 'snap',
				type: BOOL,
				optional: true,
				description: 'Land on it at once. Default false (eased).',
			},
		],
		category: 'command',
	},
	{
		name: 'cameraMoveTo',
		params: [
			{ name: 'x', type: FLOAT, description: 'The world point to centre the view on, px.' },
			{ name: 'y', type: FLOAT, description: 'World px.' },
			{
				name: 'snap',
				type: BOOL,
				optional: true,
				description: 'Land there at once. Default false (eased).',
			},
		],
		category: 'command',
	},
	{
		name: 'cameraShake',
		params: [
			{ name: 'strength', type: FLOAT, description: 'The largest offset, px; it fades to rest.' },
			{ name: 'duration', type: FLOAT, description: 'How long it lasts, ms.' },
		],
		category: 'command',
	},
	{
		name: 'cameraSetAutoScroll',
		params: [
			{
				name: 'x',
				type: FLOAT,
				optional: true,
				description: 'px per second; unwired keeps it. 0 stops it.',
			},
			{
				name: 'y',
				type: FLOAT,
				optional: true,
				description: 'px per second (negative scrolls up).',
			},
		],
		category: 'command',
	},
];

/** Every action the arcade loop backs (`createArcadeLoop`'s effects). */
export const ARCADE_LOOP_ACTIONS: readonly string[] = /* @__PURE__ */ LOOP_ACTIONS.map(
	(action) => action.name,
);

/** The lifecycle and settings surfaces an arcade game keeps from the standard palette. */
const KEPT_EVENTS = new Set(['load', 'tapToStart', 'settings', 'soundToggle', 'gameRules']);
const KEPT_ACTIONS = new Set([
	'cameraEffect',
	'elementEffect',
	'stopElementEffect',
	'screenTransition',
	'waitForScreenTransition',
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
	// Every vocabulary carries the one symbol enum, filled from the config's symbols (none in an
	// arcade game's seed); no arcade surface is typed by it.
	'SymbolName',
	'CameraEffectKind',
	'ElementFxKind',
	'ElementFxTarget',
	'ScreenTransitionKind',
	'MusicName',
	'SoundEffectName',
	'SoundName',
]);

/** The `$engine` values the arcade loop answers (`createArcadeLoop`'s `value`, whose `ARCADE_VALUES`
 *  `check:arcade-rules` pins this list to: add a value in both places). */
export const ARCADE_LOOP_VALUES: readonly string[] = [
	'random',
	'randomX',
	'fieldWidth',
	'fieldHeight',
	'cameraX',
	'cameraY',
	'viewWidth',
	'viewHeight',
];

// `@__PURE__`: a runtime built without this family drops it (`docs/design/phase-11.md` §2.2);
// Rollup otherwise keeps a top-level call for its possible side effects.
const standard = /* @__PURE__ */ standardVocabulary({ templateId: ARCADE_TEMPLATE_ID });

export const ARCADE_VOCAB: TemplateVocabulary = /* @__PURE__ */ (() => ({
	templateId: ARCADE_TEMPLATE_ID,
	structs: [],
	enums: [
		...standard.enums.filter((e) => KEPT_ENUMS.has(e.name)),
		{ name: 'ArcadeEdge', values: [...ARCADE_EDGES] },
		{ name: 'ArcadeCharacterControl', values: [...ARCADE_CHARACTER_CONTROLS] },
	],
	events: [
		...standard.events.filter((e) => KEPT_EVENTS.has(e.name)),
		...LOOP_EVENTS,
		...ONLINE_EVENTS,
	],
	actions: [...standard.actions.filter((a) => KEPT_ACTIONS.has(a.name)), ...LOOP_ACTIONS],
	cues: standard.cues.filter((c) => KEPT_CUES.has(c.name)),
	collections: [],
	values: [
		{
			name: 'random',
			type: FLOAT,
			description: 'A seeded random number from 0 up to 1, new on every read; a run replays.',
		},
		{
			name: 'randomX',
			type: FLOAT,
			description:
				'A seeded random x on the play field, from 0 up to its width; new on every read.',
		},
		{ name: 'fieldWidth', type: FLOAT, description: "The play field's width, px." },
		{ name: 'fieldHeight', type: FLOAT, description: "The play field's height, px." },
		{
			name: 'cameraX',
			type: FLOAT,
			description:
				"The camera view's left edge in the world, px (a screen with a world or a camera).",
		},
		{ name: 'cameraY', type: FLOAT, description: "The camera view's top edge in the world, px." },
		{ name: 'viewWidth', type: FLOAT, description: "The camera view's width, px." },
		{ name: 'viewHeight', type: FLOAT, description: "The camera view's height, px." },
	],
}))();
