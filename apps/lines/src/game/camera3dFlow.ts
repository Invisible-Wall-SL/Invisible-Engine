import {
	ARCADE_LOOP_ACTIONS,
	ARCADE_VOCAB,
	type ActionDecl,
	type FlowV2Effect,
	type TemplateVocabulary,
} from 'engine-flow-v2';

import { registerBoardEffects, registerBoardValues } from './flowBoardEffects';
import { getFlowV2 } from './flowV2InterpreterHolder';

/**
 * The 3D camera's Flow words (`docs/design/3d/animation-evaluation.md` §4), compiled only into the
 * `arcade3d` runtime: `families/arcade3d.ts` exports {@link ARCADE3D_FLOW_VOCABULARIES} in place of the
 * arcade family's, so `engine-flow-v2`'s shared vocabulary — in every runtime — never changes.
 *
 * It is the arcade vocabulary with the 2D world camera's words (`cameraFollow` on an instance,
 * `cameraMoveTo`, `cameraSetAutoScroll` and the px view values) swapped for the 3D director's:
 * `cameraActivate`, `cameraShake`, `cameraFollow` (a body), `cameraPlayMove` (awaited, then
 * `cameraMoveFinished`), and `$engine.cameraYaw` / `cameraPitch` for aim.
 */

/** The ease names `engine-3d` `CAMERA_EASES` blends by (kept here: the vocabulary is read at boot,
 *  before the lazy 3D chunk). `check:engine-3d-camera` holds the two lists equal. */
export const CAMERA3D_EASES = [
	'smooth',
	'linear',
	'easeIn',
	'easeOut',
	'easeInOut',
	'cut',
] as const;

const STRING = { t: 'string' } as const;
const FLOAT = { t: 'float' } as const;
const BOOL = { t: 'bool' } as const;
const EASE = { t: 'enum', name: 'Camera3dEase' } as const;

const CAMERA3D_ACTIONS: ActionDecl[] = [
	{
		name: 'cameraActivate',
		params: [
			{
				name: 'rig',
				type: STRING,
				description:
					"A camera rig's id (`arcade.world3d.camera.rigs`): follow, orbit, shoulder, firstPerson, overview by default.",
			},
			{
				name: 'blendMs',
				type: FLOAT,
				optional: true,
				description: "How long the switch blends, ms. Unwired: the camera block's blendMs (600).",
			},
			{
				name: 'ease',
				type: EASE,
				optional: true,
				description: 'How the blend runs; cut jumps. Unwired: smooth.',
			},
		],
		category: 'command',
	},
	{
		name: 'cameraShake',
		params: [
			{
				name: 'strength',
				type: FLOAT,
				description: 'Trauma added, 0 to 1 (1 is the hardest shake).',
			},
			{ name: 'duration', type: FLOAT, description: 'How long it takes to come to rest, ms.' },
		],
		category: 'command',
	},
	{
		name: 'cameraFollow',
		params: [
			{
				name: 'target',
				type: STRING,
				description: "A body's id: `player` for the own player (online: a player's session id).",
			},
		],
		category: 'command',
	},
	{
		name: 'cameraPlayMove',
		params: [
			{
				name: 'clip',
				type: STRING,
				description:
					"A camera clip's name in the game's camera moves (`anim/cameras/<arena>.glb`).",
			},
			{
				name: 'blendIn',
				type: FLOAT,
				optional: true,
				description: 'ms from the pose on screen into the move. Unwired: 0 (a cut).',
			},
			{
				name: 'blendOut',
				type: FLOAT,
				optional: true,
				description:
					"ms back to the live rig when the move ends. Unwired: the camera block's blendMs.",
			},
			{
				name: 'relative',
				type: BOOL,
				optional: true,
				description:
					"True: the clip's origin is the followed body (orbit the winner). Default false.",
			},
		],
		category: 'command',
	},
];

/** The 2D world camera's surfaces, which the 3D field does not back. */
const DROPPED_ACTIONS = new Set([
	'cameraFollow',
	'cameraMoveTo',
	'cameraShake',
	'cameraSetAutoScroll',
]);
const DROPPED_VALUES = new Set(['cameraX', 'cameraY', 'viewWidth', 'viewHeight']);

export const ARCADE3D_VOCAB: TemplateVocabulary = {
	...ARCADE_VOCAB,
	enums: [...ARCADE_VOCAB.enums, { name: 'Camera3dEase', values: [...CAMERA3D_EASES] }],
	events: [
		...ARCADE_VOCAB.events,
		{
			name: 'cameraMoveFinished',
			payload: [{ name: 'clip', type: STRING, description: 'The move that ended.' }],
			category: 'book',
			description:
				'An authored camera move (Play Camera Move) played its last frame; the camera is going back to the live rig.',
		},
	],
	actions: [
		...ARCADE_VOCAB.actions.filter((a) => !DROPPED_ACTIONS.has(a.name)),
		...CAMERA3D_ACTIONS,
	],
	values: [
		...ARCADE_VOCAB.values.filter((v) => !DROPPED_VALUES.has(v.name)),
		{
			name: 'cameraYaw',
			type: FLOAT,
			description:
				"The camera's heading, degrees: 0 looks down −z, growing anticlockwise from above.",
		},
		{ name: 'cameraPitch', type: FLOAT, description: "The camera's tilt, degrees, up positive." },
	],
};

export const ARCADE3D_FLOW_VOCABULARIES: Readonly<Record<string, TemplateVocabulary>> = {
	[ARCADE3D_VOCAB.templateId]: ARCADE3D_VOCAB,
};

export const ARCADE3D_FLOW_ACTIONS: readonly string[] = [
	...ARCADE_LOOP_ACTIONS.filter((name) => !DROPPED_ACTIONS.has(name)),
	...CAMERA3D_ACTIONS.map((a) => a.name),
];

/** What the stage's camera director answers to Flow (`ArcadeStage3D.svelte` attaches it). */
export type Camera3dFlowHost = {
	activate(rig: string, blendMs: number | undefined, ease: string | undefined): void;
	shake(strength: number, durationMs: number): void;
	follow(target: string): void;
	/** Resolves when the move has played (at once for an unknown clip, with a warning). */
	playMove(
		clip: string,
		blendInMs: number | undefined,
		blendOutMs: number | undefined,
		relative: boolean,
	): Promise<void>;
	yaw(): number;
	pitch(): number;
};

let host: Camera3dFlowHost | undefined;
/** Calls made before the play field mounted, run in order when it does. */
const waiting: ((h: Camera3dFlowHost) => void)[] = [];

const withHost = <T>(run: (h: Camera3dFlowHost) => T | Promise<T>): Promise<T> =>
	host
		? Promise.resolve(run(host))
		: new Promise((resolve, reject) =>
				waiting.push((h) => {
					Promise.resolve(run(h)).then(resolve, reject);
				}),
			);

const finite = (value: unknown): number | undefined =>
	typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const EFFECTS: Readonly<Record<string, FlowV2Effect>> = {
	// A switch, a shake or a follow asked for before the field mounts is kept for it, without
	// holding the flow; a move holds the flow until it has played.
	cameraActivate: (p) => {
		void withHost((h) =>
			h.activate(String(p.rig ?? ''), finite(p.blendMs), p.ease as string | undefined),
		);
	},
	cameraShake: (p) => {
		void withHost((h) => h.shake(finite(p.strength) ?? 0, finite(p.duration) ?? 0));
	},
	cameraFollow: (p) => {
		void withHost((h) => h.follow(String(p.target ?? '')));
	},
	cameraPlayMove: async (p) => {
		const clip = String(p.clip ?? '');
		await withHost((h) =>
			h.playMove(clip, finite(p.blendIn), finite(p.blendOut), p.relative === true),
		);
		void getFlowV2()?.dispatch('cameraMoveFinished', { clip });
	},
};

/**
 * Back the camera words with the director the stage attaches. Called at seam import: the offline
 * 3D field runs no 2D arcade loop, so nothing else registers the family's effects. The stage calls
 * it again with its own (`openGraphics`), which sit beside the camera's, and once more without them
 * when it goes.
 */
export const registerCamera3dFlow = (extra: Readonly<Record<string, FlowV2Effect>> = {}) => {
	registerBoardEffects({ ...EFFECTS, ...extra });
	registerBoardValues((key) =>
		key === 'cameraYaw'
			? (host?.yaw() ?? 0)
			: key === 'cameraPitch'
				? (host?.pitch() ?? 0)
				: undefined,
	);
};

/** The stage's director takes the Flow's calls; returns the detach. */
export const attachCamera3dFlow = (next: Camera3dFlowHost): (() => void) => {
	host = next;
	for (const call of waiting.splice(0)) call(next);
	return () => {
		if (host === next) host = undefined;
	};
};
