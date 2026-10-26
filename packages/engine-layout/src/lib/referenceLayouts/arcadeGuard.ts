import type { CinematicDoc, ComponentDef, LayoutDoc, LayoutNode, Scene } from '../types';
import { ARCADE_FIELD, arcadeReferenceLayout } from './arcade';

/**
 * The CHARACTERS sample's screens (`docs/design/game-families.md` §4.3, P10.11): the P10.8 scene set
 * with its play field turned into a guarded yard twice the screen wide. The play field's screen has
 * a `world` and a `camera` that follows the runner (P10.12). Its spawn layer holds a runner (the
 * player: a top-down controller on the arrow keys, or follow a held touch), a guard and two kinds of
 * wall; a `path` node (`guardRoute`, a smoothed loop through the yard) is the guard's patrol, and a
 * row of posts along the bottom shows the scroll. The HUD shows LIVES and SPOTTED. Placeholder
 * shapes only.
 *
 * The guard's look ({@link ARCADE_GUARD_COMPONENTS}) has a state machine: a 1D blend state from
 * `guard_idle` to `guard_run` on its `speed` number input, and an alert layer on its `chasing` bool;
 * the config's `animInputs` feeds both from the guard's motion and its brain.
 *
 * Played by the launcher's `check:arcade-characters` and `scripts/playtest/arcade-characters-play.mjs` with
 * `engine-flow-v2`'s `ARCADE_GUARD_SEED_DOC` and the config
 * `packages/engine-mechanics/fixtures/arcade-guard.rules.json`. Not a Game Maker kind, and not
 * exported from the package entry, so no game bundles it.
 */

/** The components, by role. */
export const ARCADE_GUARD = {
	runner: 'arcadeRunner',
	guard: 'arcadeGuard',
	wallH: 'arcadeWallH',
	wallV: 'arcadeWallV',
} as const;

/** The yard: twice the desktop screen wide, as tall. The camera scrolls across it. */
export const ARCADE_GUARD_WORLD = { w: 2844, h: 800 } as const;

/** How the camera follows the runner: a dead zone round the middle of the view, eased. */
export const ARCADE_GUARD_CAMERA = {
	follow: 'player',
	deadZone: { w: 300, h: 200 },
	smoothing: 0.15,
} as const;

/** The guard's patrol: a long loop round the walls in the yard's middle, in the world's px. */
export const ARCADE_GUARD_ROUTE = {
	id: 'guardRoute',
	points: [
		{ x: 440, y: 190 },
		{ x: 2400, y: 190 },
		{ x: 2400, y: 610 },
		{ x: 440, y: 610 },
	],
	smoothing: 0.35,
} as const;

/** The guard's look's timelines and their component inputs. */
export const ARCADE_GUARD_LOOK = {
	idle: 'guard_idle',
	run: 'guard_run',
	calm: 'guard_calm',
	alert: 'guard_alert',
	/** The `speed` at which the run plays alone. */
	runAt: 190,
	inputs: { speed: 'speed', chasing: 'chasing' },
} as const;

/** A flat shape centred on `at` (a rect's default anchor), as a body's x / y is its centre. */
const rect = (
	id: string,
	label: string,
	w: number,
	h: number,
	color: number,
	at = { x: 0, y: 0 },
): LayoutNode =>
	({ id, label, kind: 'rect', x: at.x, y: at.y, width: w, height: h, color }) as LayoutNode;

/** A post along the bottom every few hundred px, so the scroll reads. */
const yardMarkers = (): LayoutNode => ({
	id: 'ag-markers',
	label: 'Yard markers',
	kind: 'container',
	x: 0,
	y: 0,
	children: Array.from({ length: Math.floor(ARCADE_GUARD_WORLD.w / 356) + 1 }, (_, i) =>
		rect(`ag-marker-${i}`, `Marker ${i}`, 12, 24, 0x5c677d, { x: 178 + 356 * i, y: 785 }),
	),
});

const shape = (id: string, name: string, w: number, h: number, color: number): ComponentDef => ({
	id,
	name,
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [],
	root: {
		id: `${id}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [rect(`${id}-shape`, 'Shape', w, h, color)],
	},
});

/** The guard: a body, legs and an alert flag over its head; idle ↔ run by speed, calm ↔ alert. */
const guard: ComponentDef = {
	id: ARCADE_GUARD.guard,
	name: 'Guard (placeholder)',
	version: 1,
	scope: 'project',
	category: 'ui',
	params: [],
	root: {
		id: 'arcadeGuard-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'arcadeGuard-legs',
				label: 'Legs',
				kind: 'container',
				x: 0,
				y: 18,
				children: [rect('arcadeGuard-legs-shape', 'LegsShape', 40, 14, 0xa3b1c6)],
			} as LayoutNode,
			{
				id: 'arcadeGuard-body',
				label: 'Body',
				kind: 'container',
				x: 0,
				y: 0,
				children: [rect('arcadeGuard-body-shape', 'BodyShape', 48, 40, 0x4f5d75)],
			} as LayoutNode,
			{
				id: 'arcadeGuard-alert',
				label: 'Alert',
				kind: 'container',
				x: 0,
				y: -40,
				children: [rect('arcadeGuard-alert-shape', 'AlertShape', 14, 22, 0xef233c)],
			} as LayoutNode,
		],
	},
	inputs: [
		{ id: ARCADE_GUARD_LOOK.inputs.speed, kind: 'number', default: 0 },
		{ id: ARCADE_GUARD_LOOK.inputs.chasing, kind: 'bool', default: false },
	],
	stateMachine: {
		layers: [
			{
				id: 'move',
				entry: 'locomotion',
				states: [
					{
						id: 'locomotion',
						timeline: ARCADE_GUARD_LOOK.idle,
						loop: true,
						blend: {
							input: ARCADE_GUARD_LOOK.inputs.speed,
							points: [
								{ timeline: ARCADE_GUARD_LOOK.idle, at: 0 },
								{ timeline: ARCADE_GUARD_LOOK.run, at: ARCADE_GUARD_LOOK.runAt },
							],
						},
					},
				],
				transitions: [],
			},
			{
				id: 'alert',
				entry: 'calm',
				states: [
					{ id: 'calm', timeline: ARCADE_GUARD_LOOK.calm, loop: true },
					{ id: 'alert', timeline: ARCADE_GUARD_LOOK.alert, loop: true },
				],
				transitions: [
					{
						id: 'spotted',
						from: 'calm',
						to: 'alert',
						conditions: [{ input: ARCADE_GUARD_LOOK.inputs.chasing, op: '==', value: true }],
						blend: 120,
					},
					{
						id: 'lost',
						from: 'alert',
						to: 'calm',
						conditions: [{ input: ARCADE_GUARD_LOOK.inputs.chasing, op: '==', value: false }],
						blend: 300,
					},
				],
			},
		],
	},
};

/** The sample's spawnable components. Sizes match the bodies the config gives them. */
export const ARCADE_GUARD_COMPONENTS: readonly ComponentDef[] = [
	shape(ARCADE_GUARD.runner, 'Runner (placeholder)', 44, 44, 0x06d6a0),
	guard,
	shape(ARCADE_GUARD.wallH, 'Wall, across (placeholder)', 280, 36, 0x8d99ae),
	shape(ARCADE_GUARD.wallV, 'Wall, down (placeholder)', 36, 220, 0x8d99ae),
];

type Key = { time: number; value: number };

const timeline = (
	id: string,
	name: string,
	duration: number,
	actors: Record<string, Record<string, Key[]>>,
): CinematicDoc =>
	({
		schemaVersion: 1,
		id,
		name,
		duration,
		fps: 60,
		markers: [],
		host: { kind: 'component', componentId: ARCADE_GUARD.guard },
		stage: {
			sceneId: null,
			cast: Object.keys(actors).map((target) => ({
				actorId: target,
				kind: 'node',
				target,
				place: {},
			})),
		},
		tracks: Object.entries(actors).map(([actorId, channels]) => ({
			id: `${actorId}-p`,
			kind: 'property',
			actorId,
			channels,
		})),
	}) as CinematicDoc;

/**
 * The guard's timelines: idle breathes (the body swells a little, the legs stand still); run bobs
 * the body and swings the legs; both key the same channels, so the blend mixes them smoothly.
 */
export const ARCADE_GUARD_TIMELINES: readonly CinematicDoc[] = [
	timeline(ARCADE_GUARD_LOOK.idle, 'Guard: idle', 1.2, {
		Body: {
			y: [{ time: 0, value: 0 }],
			scaleY: [
				{ time: 0, value: 1 },
				{ time: 0.6, value: 1.06 },
				{ time: 1.2, value: 1 },
			],
		},
		Legs: { x: [{ time: 0, value: 0 }], rotation: [{ time: 0, value: 0 }] },
	}),
	timeline(ARCADE_GUARD_LOOK.run, 'Guard: run', 0.4, {
		Body: {
			y: [
				{ time: 0, value: 0 },
				{ time: 0.1, value: -5 },
				{ time: 0.2, value: 0 },
				{ time: 0.3, value: -5 },
				{ time: 0.4, value: 0 },
			],
			scaleY: [{ time: 0, value: 1 }],
		},
		Legs: {
			x: [
				{ time: 0, value: -6 },
				{ time: 0.2, value: 6 },
				{ time: 0.4, value: -6 },
			],
			rotation: [
				{ time: 0, value: -14 },
				{ time: 0.2, value: 14 },
				{ time: 0.4, value: -14 },
			],
		},
	}),
	timeline(ARCADE_GUARD_LOOK.calm, 'Guard: calm', 1, {
		Alert: { alpha: [{ time: 0, value: 0 }], scale: [{ time: 0, value: 1 }] },
	}),
	timeline(ARCADE_GUARD_LOOK.alert, 'Guard: alert', 0.5, {
		Alert: {
			alpha: [{ time: 0, value: 1 }],
			scale: [
				{ time: 0, value: 1 },
				{ time: 0.25, value: 1.3 },
				{ time: 0.5, value: 1 },
			],
		},
	}),
];

const textBox = (
	id: string,
	label: string,
	x: number,
	y: number,
	params: Record<string, unknown>,
): LayoutNode => ({ id, label, kind: 'componentInstance', componentId: 'textBox', x, y, params });

const readout = (key: string, caption: string, y: number): LayoutNode[] => [
	textBox(`ag-${key}-caption`, `${caption} caption`, 60, y, { text: caption, fontSize: 28 }),
	textBox(`ag-${key}-value`, caption, 60, y + 38, {
		text: '0',
		source: `var:${key}`,
		fontSize: 44,
	}),
];

export function arcadeGuardReferenceLayout(): LayoutDoc {
	const base = arcadeReferenceLayout();
	const scenes: Scene[] = base.scenes.map((scene) => {
		if (scene.id === 'basegame')
			return {
				...scene,
				world: { ...ARCADE_GUARD_WORLD },
				camera: { ...ARCADE_GUARD_CAMERA, deadZone: { ...ARCADE_GUARD_CAMERA.deadZone } },
				nodes: [
					yardMarkers(),
					{
						id: ARCADE_FIELD.id,
						label: 'Play field',
						kind: 'spawnLayer',
						x: 0,
						y: 0,
						spawnable: ARCADE_GUARD_COMPONENTS.map((def) => def.id),
						placement: 'free',
						cap: ARCADE_FIELD.cap,
					},
					{
						id: ARCADE_GUARD_ROUTE.id,
						label: 'Guard route',
						kind: 'path',
						x: 0,
						y: 0,
						points: ARCADE_GUARD_ROUTE.points.map((p) => ({ ...p })),
						closed: true,
						smoothing: ARCADE_GUARD_ROUTE.smoothing,
					},
				],
			};
		if (scene.id === 'arcadeHud')
			return {
				...scene,
				nodes: [...readout('lives', 'LIVES', 40), ...readout('spotted', 'SPOTTED', 140)],
			};
		if (scene.id === 'roundOver')
			return {
				...scene,
				nodes: scene.nodes.map((node) =>
					node.id === 'roundOver-text' && node.kind === 'componentInstance'
						? { ...node, params: { ...node.params, text: 'CAUGHT! Tap to run again' } }
						: node,
				),
			};
		return scene;
	});
	return { ...base, projectKey: 'arcade-guard', scenes };
}
