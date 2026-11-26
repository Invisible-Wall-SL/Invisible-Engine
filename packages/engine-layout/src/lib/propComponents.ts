import {
	REPEATER_COUNT_HARD_MAX,
	SM_ANY_STATE,
	type CinematicDoc,
	type ComponentDef,
	type LayoutNode,
	type PropDepth,
} from './types';

/**
 * THE PROP BUILT-INS (`docs/design/arcade-prop-components.md`): the seed def of each prop zone kind
 * and the timelines its machines play. They are in `BUILTIN_COMPONENTS` / `BUILTIN_TIMELINES` (the
 * launcher's lowest layer, which a project copies with **Save a copy**) and NOT in the lists every
 * runtime carries (`RUNTIME_BUILTIN_COMPONENTS` / `RUNTIME_BUILTIN_TIMELINES`). A prop is placed by
 * a zone-art entry, never by a layout doc, so a boot resolving a doc's ids never needs one, and the
 * slot, match-3 and card runtimes stay their bytes. Each def is `internal`: no screen palette offers
 * it. Inert until a zone-art entry names it (P6).
 *
 * It imports no other module's values but `types.ts`'s: a new import edge moves where the bundler
 * places a module every runtime carries, and that alone changes their bytes. So Salmons' sizes and
 * `PROP_INPUTS` are written out here, and `check:prop-shape` §3 holds them equal to
 * `salmonsElevation.ts` and `componentInterface.ts`.
 */

/** The seed bridge's ids: the prop, its deck segments (near / middle / far) and its reflection. */
export const BRIDGE_PROP_IDS = {
	prop: 'bridgeProp',
	deckNear: 'bridgePropDeckNear',
	deckMiddle: 'bridgePropDeckMiddle',
	deckFar: 'bridgePropDeckFar',
	reflection: 'bridgePropReflection',
} as const;

/** The bridge's timelines, by name: `c_<component id, lower case>_<name>`, as the editor names a
 *  component's own timeline. */
export const BRIDGE_PROP_TIMELINES = {
	idle: 'c_bridgeprop_idle',
	occupied: 'c_bridgeprop_occupied',
	still: 'c_bridgeprop_still',
	stepOn: 'c_bridgeprop_stepon',
	stepOff: 'c_bridgeprop_stepoff',
	pillar: 'c_bridgepropdeckmiddle_pillar',
	bare: 'c_bridgepropdeckmiddle_bare',
} as const;

/** The node names (labels) the bridge's timelines key. */
const NODES = {
	reflections: 'Reflections',
	deck: 'Deck',
	pillar: 'Pillar',
	pillarReflection: 'Pillar reflection',
} as const;

// The code bridge's sizes (`salmonsArt/river.ts`, `bridge.ts`), screen px at the default height of
// 6 cells: a cell's tile is CELL × CELL turned into a 2:1 diamond; the deck stands `liftOf(6)` over
// the ground; a pillar is the old client's 64 × 0.45. Placeholder art: the seed's depths and
// collider are today's (P5's `check:prop-depth`), its drawing is close, not equal.
/** Salmons' cell, the old client's scale and its height unit (`salmonsElevation.ts`). */
export const BRIDGE_PROP_SIZES = { cell: 48, k: 1.5, heightUnit: 16 } as const;
const { cell: CELL, k: K, heightUnit: HEIGHT_UNIT } = BRIDGE_PROP_SIZES;
const DECK_HEIGHT_CELLS = 6;
const LIFT = DECK_HEIGHT_CELLS * HEIGHT_UNIT * K;
const PILLAR_W = 64 * 0.45 * K;
const TILE_SIDE = CELL * Math.SQRT2;
/** One cell along the deck on screen (`isoProject(CELL, 0)`). */
const STEP = { x: CELL, y: CELL / 2 };
/** Every third deck cell has a pillar, and both ends do (`river.ts`: `i % 3 === 0`). */
const PILLAR_EVERY = 3;

/** A rect turned into a 2:1 ground diamond, a cell wide, centred on its container's origin. */
const diamond = (
	id: string,
	label: string,
	y: number,
	color: number,
	depth: PropDepth,
	extra: { alpha?: number; propZOffset?: number } = {},
): LayoutNode => ({
	id,
	label,
	kind: 'container',
	x: 0,
	y,
	scale: { x: 1, y: 0.5 },
	propDepth: depth,
	...extra,
	children: [
		{
			id: `${id}-tile`,
			kind: 'rect',
			x: 0,
			y: 0,
			anchor: { x: 0.5, y: 0.5 },
			rotation: Math.PI / 4,
			width: TILE_SIDE,
			height: TILE_SIDE,
			color,
			...(depth === 'sorted' ? { borderWidth: 2, borderColor: 0x4a2e16 } : {}),
		},
	],
});

/**
 * One deck cell, its origin the cell's middle on the deck top (where the prop mount places it): the
 * tile (`sorted` at the code deck's 1100), and, with a pillar, the pillar (`behind` at the code
 * pillar's 400) and its reflection on the water.
 */
const deckSegment = (id: string, name: string, color: number, pillar: boolean): ComponentDef => ({
	id,
	name,
	version: 1,
	scope: 'shared',
	category: 'scenery',
	internal: true,
	root: {
		id: `${id}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			...(pillar
				? [
						{
							id: `${id}-pillar`,
							label: NODES.pillar,
							kind: 'rect' as const,
							x: 0,
							y: 0,
							alpha: 1,
							anchor: { x: 0.5, y: 0 },
							width: PILLAR_W,
							height: LIFT,
							color: 0x5b3a20,
							propDepth: 'behind' as const,
							propZOffset: 400,
						},
						{
							id: `${id}-pillarReflection`,
							label: NODES.pillarReflection,
							kind: 'rect' as const,
							x: 0,
							y: LIFT,
							alpha: 1,
							anchor: { x: 0.5, y: 0 },
							width: PILLAR_W,
							height: LIFT * 0.6,
							color: 0x3a2412,
							propDepth: 'water' as const,
						},
					]
				: []),
			{
				id: `${id}-edge`,
				label: 'Deck edge',
				kind: 'rect',
				x: 0,
				y: 6 * K,
				anchor: { x: 0.5, y: 0.5 },
				width: 2 * CELL,
				height: 8 * K,
				color: 0x5b3a20,
				propDepth: 'sorted',
				propZOffset: 1100,
			},
			diamond(`${id}-tile`, 'Tile', 0, color, 'sorted', { propZOffset: 1100 }),
		],
	},
});

/** The middle cells' pillar: shown on every {@link PILLAR_EVERY}th cell from the first. */
const middleSegment = (): ComponentDef => {
	const base = deckSegment(BRIDGE_PROP_IDS.deckMiddle, 'Bridge deck (middle)', 0x966637, true);
	const cells: number[] = [];
	for (let i = 1 + PILLAR_EVERY; i <= REPEATER_COUNT_HARD_MAX; i += PILLAR_EVERY) cells.push(i);
	return {
		...base,
		inputs: [
			{
				id: 'index',
				kind: 'number',
				default: 1,
				note: 'Its cell, 1 = the first (the deck sets it).',
			},
		],
		stateMachine: {
			layers: [
				{
					id: 'pillar',
					name: 'Pillar',
					entry: 'bare',
					states: [
						{ id: 'bare', timeline: BRIDGE_PROP_TIMELINES.bare },
						{ id: 'pillar', timeline: BRIDGE_PROP_TIMELINES.pillar },
					],
					transitions: cells.map((cell) => ({
						id: `pillar-${cell}`,
						from: 'bare',
						to: 'pillar',
						conditions: [{ input: 'index', op: '==' as const, value: cell }],
					})),
				},
			],
		},
	};
};

const reflectionDef = (): ComponentDef => ({
	id: BRIDGE_PROP_IDS.reflection,
	name: 'Bridge reflection',
	version: 1,
	scope: 'shared',
	category: 'scenery',
	internal: true,
	root: {
		id: `${BRIDGE_PROP_IDS.reflection}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			diamond(
				`${BRIDGE_PROP_IDS.reflection}-tile`,
				'Reflection',
				LIFT + CELL / 4,
				0x4a3020,
				'water',
				{
					alpha: 0.5,
				},
			),
		],
	},
});

/** A slope from the deck's end (the origin) down to the ground `along` cells off it. */
const slope = (id: string, label: string, along: number): LayoutNode => {
	const dx = along * STEP.x;
	const dy = along * STEP.y + LIFT;
	const across = Math.hypot(CELL / 2, CELL / 4);
	return {
		id,
		label,
		kind: 'rect',
		x: 0,
		y: 0,
		anchor: { x: 0, y: 0.5 },
		rotation: Math.atan2(dy, dx),
		width: Math.hypot(dx, dy),
		height: 2 * across,
		color: 0x7a4f2a,
		borderWidth: 2,
		borderColor: 0x4a2e16,
		propDepth: 'behind',
		propZOffset: 500,
	};
};

const count = (preview: number) => ({ preview, max: REPEATER_COUNT_HARD_MAX });

/**
 * THE SEED BRIDGE: Salmons' code bridge as a prop (design §7 P4). Its collider is today's rule and
 * compiles to `{ from, zoneKind }` (`check:prop-shape` §3). Its origin is the first deck cell's
 * middle on the deck top. Bands as §5: the reflections on the `water`; the pillars and the two
 * slopes `behind`; the deck a count-mode repeater of near / middle / far cells, `sorted`. The
 * per-zone `length`, `height` and `zone` are engine-provided; the prop mount (P5) places each
 * segment at its cell, so the repeaters' row layout is the editor's flat preview only, and the far
 * slope follows `length` along the deck. The machine: `idle` loops the water's sway (the code
 * shimmer, one phase for the whole bridge) and `occupied` holds it still while a fisherman is on
 * it; `stepOn` / `stepOff` play a short dip of the deck. Scoped by `zone`, so `bridge0`'s steps
 * never reach `bridge2`.
 */
const bridgeDef = (): ComponentDef => ({
	id: BRIDGE_PROP_IDS.prop,
	name: 'Bridge (prop)',
	version: 1,
	scope: 'shared',
	category: 'scenery',
	internal: true,
	root: {
		id: `${BRIDGE_PROP_IDS.prop}-root`,
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: `${BRIDGE_PROP_IDS.prop}-reflections`,
				label: NODES.reflections,
				kind: 'repeater',
				x: 0,
				y: 0,
				source: '',
				componentId: BRIDGE_PROP_IDS.reflection,
				layout: { direction: 'row', gap: 0 },
				count: count(DECK_HEIGHT_CELLS),
				propDepth: 'water',
			},
			slope(`${BRIDGE_PROP_IDS.prop}-nearSlope`, 'Near slope', -2),
			{
				...slope(`${BRIDGE_PROP_IDS.prop}-farSlope`, 'Far slope', 2),
				valueBindings: [
					{ target: 'x', param: 'length', inMin: 1, inMax: 50, outMin: 0, outMax: 49 * STEP.x },
					{ target: 'y', param: 'length', inMin: 1, inMax: 50, outMin: 0, outMax: 49 * STEP.y },
				],
			},
			{
				id: `${BRIDGE_PROP_IDS.prop}-deck`,
				label: NODES.deck,
				kind: 'repeater',
				x: 0,
				y: 0,
				source: '',
				componentId: BRIDGE_PROP_IDS.deckMiddle,
				variants: {
					first: BRIDGE_PROP_IDS.deckNear,
					middle: BRIDGE_PROP_IDS.deckMiddle,
					last: BRIDGE_PROP_IDS.deckFar,
				},
				layout: { direction: 'row', gap: 0 },
				count: count(DECK_HEIGHT_CELLS),
				propDepth: 'sorted',
				propZOffset: 1100,
			},
		],
	},
	params: [
		{
			key: 'length',
			kind: 'number',
			default: DECK_HEIGHT_CELLS,
			engineProvided: true,
			label: 'deck cells (the zone sets it)',
		},
		{
			key: 'height',
			kind: 'number',
			default: DECK_HEIGHT_CELLS,
			engineProvided: true,
			label: 'deck height, cells (the zone sets it)',
		},
		{ key: 'zone', kind: 'string', default: '', engineProvided: true, label: 'the zone it is on' },
	],
	signalScope: 'zone',
	inputs: [
		{ id: 'occupied', kind: 'number', default: 0 },
		{ id: 'stepOn', kind: 'trigger' },
		{ id: 'stepOff', kind: 'trigger' },
	],
	stateMachine: {
		layers: [
			{
				id: 'ambience',
				name: 'Ambience',
				entry: 'idle',
				states: [
					{ id: 'idle', timeline: BRIDGE_PROP_TIMELINES.idle, loop: true },
					{ id: 'occupied', timeline: BRIDGE_PROP_TIMELINES.occupied },
				],
				transitions: [
					{
						id: 'ambience-occupied',
						from: 'idle',
						to: 'occupied',
						conditions: [{ input: 'occupied', op: '>', value: 0 }],
						blend: 300,
					},
					{
						id: 'ambience-idle',
						from: 'occupied',
						to: 'idle',
						conditions: [{ input: 'occupied', op: '<=', value: 0 }],
						blend: 300,
					},
				],
			},
			{
				id: 'steps',
				name: 'Steps',
				entry: 'still',
				states: [
					{ id: 'still', timeline: BRIDGE_PROP_TIMELINES.still },
					{ id: 'stepOn', timeline: BRIDGE_PROP_TIMELINES.stepOn },
					{ id: 'stepOff', timeline: BRIDGE_PROP_TIMELINES.stepOff },
				],
				transitions: [
					{
						id: 'steps-on',
						from: SM_ANY_STATE,
						to: 'stepOn',
						conditions: [{ input: 'stepOn', op: 'fired' }],
					},
					{
						id: 'steps-off',
						from: SM_ANY_STATE,
						to: 'stepOff',
						conditions: [{ input: 'stepOff', op: 'fired' }],
					},
					{ id: 'steps-on-done', from: 'stepOn', to: 'still', exitTime: 1 },
					{ id: 'steps-off-done', from: 'stepOff', to: 'still', exitTime: 1 },
				],
			},
		],
	},
	prop: {
		zoneKind: 'bridge',
		fromZone: { length: 'length', height: 'height' },
		collider: {
			deck: { from: 0, to: { param: 'length', plus: -1 }, height: { param: 'height' } },
			snap: 0.5,
			ramps: { near: { length: 2 }, far: { length: 2 } },
			hole: 'deckAndRamps',
		},
		preview: { length: DECK_HEIGHT_CELLS, height: DECK_HEIGHT_CELLS },
	},
});

let built: ComponentDef[] | undefined;
/** Built once, on first read: the module's exports are single `@__PURE__` calls, so a runtime that
 *  never reads them (every one today) drops all of it. */
const propDefs = (): ComponentDef[] =>
	(built ??= [
		bridgeDef(),
		deckSegment(BRIDGE_PROP_IDS.deckNear, 'Bridge deck (near end)', 0xa0703f, true),
		middleSegment(),
		deckSegment(BRIDGE_PROP_IDS.deckFar, 'Bridge deck (far end)', 0x8a5c30, true),
		reflectionDef(),
	]);
const bridgeOf = (): ComponentDef => propDefs()[0];

/** The prop built-ins, every def a seed prop places included. */
export const PROP_COMPONENTS: ComponentDef[] = /* @__PURE__ */ propDefs();
/** The seed bridge ({@link bridgeDef}). */
export const BRIDGE_PROP_DEF: ComponentDef = /* @__PURE__ */ bridgeOf();

/** A component timeline of `componentId` keying one channel of each named node. */
const timeline = (
	id: string,
	name: string,
	componentId: string,
	duration: number,
	keys: Record<string, { channel: 'x' | 'y' | 'alpha'; at: [number, number][] }>,
): CinematicDoc => ({
	schemaVersion: 1,
	id,
	name,
	duration,
	fps: 60,
	markers: [],
	host: { kind: 'component', componentId },
	stage: {
		sceneId: null,
		cast: Object.keys(keys).map((node) => ({
			actorId: node,
			kind: 'node',
			target: node,
			place: {},
		})),
	},
	tracks: Object.entries(keys).map(([node, { channel, at }]) => ({
		id: `${node}-${channel}`,
		kind: 'property',
		actorId: node,
		channels: { [channel]: at.map(([time, value]) => ({ time, value })) },
	})),
});

/** The code shimmer's sway (`river.ts`: `sin(frame · 0.04)` px × 1.5 K, 2.6 s a period at 60 fps). */
const SWAY = 1.5 * K;
const SWAY_PERIOD = (2 * Math.PI) / (0.04 * 60);
const dip = (depth: number): [number, number][] => [
	[0, 0],
	[0.12, depth],
	[0.3, 0],
];

const propTimelines = (): CinematicDoc[] => {
	const sway: [number, number][] = [0, 0.25, 0.5, 0.75, 1].map((f) => [
		f * SWAY_PERIOD,
		Math.round(Math.sin(f * 2 * Math.PI) * SWAY * 1000) / 1000,
	]);
	return [
		timeline(BRIDGE_PROP_TIMELINES.idle, 'Bridge: idle', BRIDGE_PROP_IDS.prop, SWAY_PERIOD, {
			[NODES.reflections]: { channel: 'x', at: sway },
		}),
		timeline(BRIDGE_PROP_TIMELINES.occupied, 'Bridge: occupied', BRIDGE_PROP_IDS.prop, 1, {
			[NODES.reflections]: { channel: 'x', at: [[0, 0]] },
		}),
		timeline(BRIDGE_PROP_TIMELINES.still, 'Bridge: still', BRIDGE_PROP_IDS.prop, 1, {
			[NODES.deck]: { channel: 'y', at: [[0, 0]] },
		}),
		timeline(BRIDGE_PROP_TIMELINES.stepOn, 'Bridge: step on', BRIDGE_PROP_IDS.prop, 0.3, {
			[NODES.deck]: { channel: 'y', at: dip(3 * K) },
		}),
		timeline(BRIDGE_PROP_TIMELINES.stepOff, 'Bridge: step off', BRIDGE_PROP_IDS.prop, 0.3, {
			[NODES.deck]: { channel: 'y', at: dip(1.5 * K) },
		}),
		timeline(BRIDGE_PROP_TIMELINES.pillar, 'Deck: pillar', BRIDGE_PROP_IDS.deckMiddle, 1, {
			[NODES.pillar]: { channel: 'alpha', at: [[0, 1]] },
			[NODES.pillarReflection]: { channel: 'alpha', at: [[0, 1]] },
		}),
		timeline(BRIDGE_PROP_TIMELINES.bare, 'Deck: bare', BRIDGE_PROP_IDS.deckMiddle, 1, {
			[NODES.pillar]: { channel: 'alpha', at: [[0, 0]] },
			[NODES.pillarReflection]: { channel: 'alpha', at: [[0, 0]] },
		}),
	];
};

/** The timelines the prop built-ins' machines play. No `playOn`: only the machines play them. */
export const PROP_TIMELINES: readonly CinematicDoc[] = /* @__PURE__ */ propTimelines();
