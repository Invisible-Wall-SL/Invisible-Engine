import type { PropGraphicOp, PropGraphicProps, PropPoint, PropScalar } from './propGraphic';
import {
	REPEATER_COUNT_HARD_MAX,
	SM_ANY_STATE,
	type CinematicDoc,
	type ComponentDef,
	type ComponentParam,
	type LayoutNode,
	type SmLayer,
} from './types';

/**
 * THE PROP BUILT-INS (`docs/design/arcade-prop-components.md`): the seed def of each prop zone kind,
 * its piece defs and the timelines their machines play. They are in `BUILTIN_COMPONENTS` /
 * `BUILTIN_TIMELINES` (the launcher's lowest layer, which a project copies with **Save a copy**)
 * and NOT in the lists every runtime carries (`RUNTIME_BUILTIN_COMPONENTS` /
 * `RUNTIME_BUILTIN_TIMELINES`). A prop is placed by a zone-art entry, never by a layout doc, so a
 * boot resolving a doc's ids never needs one, and the slot, match-3 and card runtimes stay their
 * bytes. Each def is `internal`: no screen palette offers it. Inert until a zone-art entry names it.
 *
 * It imports no other module's values but `types.ts`'s: a new import edge moves where the bundler
 * places a module every runtime carries, and that alone changes their bytes. So Salmons' sizes and
 * `PROP_INPUTS` are written out here, and `check:prop-shape` §3 holds them equal to
 * `salmonsElevation.ts` and `componentInterface.ts`. Every export is one `@__PURE__` call, so a
 * bundle that never reads them drops all of it.
 */

/** The seed bridge's ids: the prop and the defs of its pieces. */
export const BRIDGE_PROP_IDS = {
	prop: 'bridgeProp',
	water: 'bridgePropWater',
	pillar: 'bridgePropPillar',
	deckNear: 'bridgePropDeckNear',
	deckMiddle: 'bridgePropDeckMiddle',
	deckFar: 'bridgePropDeckFar',
	slope: 'bridgePropSlope',
} as const;

/** The pieces' timelines: `c_<component id, lower case>_<name>`, as the editor names them. */
export const BRIDGE_PROP_TIMELINES = {
	sway: 'c_bridgepropwater_sway',
	idle: 'c_bridgepropwater_idle',
	occupied: 'c_bridgepropwater_occupied',
	belowBare: 'c_bridgepropwater_bare',
	belowShown: 'c_bridgepropwater_pillar',
	pillarBare: 'c_bridgeproppillar_bare',
	pillarShown: 'c_bridgeproppillar_pillar',
	still: 'c_bridgepropdeck_still',
	stepOn: 'c_bridgepropdeck_stepon',
	stepOff: 'c_bridgepropdeck_stepoff',
} as const;

/** The node names (labels) the timelines key. */
const NODES = {
	reflection: 'Reflection',
	below: 'Pillar reflection',
	pillar: 'Pillar',
	tile: 'Tile',
} as const;

/** Salmons' cell, the old client's scale and its height unit (`salmonsElevation.ts`). */
export const BRIDGE_PROP_SIZES = { cell: 48, k: 1.5, heightUnit: 16 } as const;
const { cell: CELL, k: K, heightUnit: HEIGHT_UNIT } = BRIDGE_PROP_SIZES;

// The code bridge (`salmonsArt/river.ts`), piece for piece: its colours, a pillar's width (the old
// client's 64 × 0.45), the deck's side (8 K), the plank lines a quarter cell off its middle, and the
// deck as high as `liftOf(height)` (16 K a cell). `check:prop-depth` holds every piece to the code's.
const COLORS = {
	reflection: 0x4a3020,
	below: 0x3a2412,
	wood: 0x5b3a20,
	near: 0xa0703f,
	middle: 0x966637,
	far: 0x8a5c30,
	slope: 0x7a4f2a,
	edge: 0x4a2e16,
} as const;
const PILLAR_W = 64 * 0.45 * K;
const SIDE = 8 * K;
const LIFT_PER_CELL = HEIGHT_UNIT * K;
/** Every third cell has a pillar, and both ends do (`river.ts`: `i % 3 === 0`, the first, the last). */
const PILLAR_EVERY = 3;
const HALF = CELL / 2;

const lift = (times: number): PropScalar => ({ param: 'height', times: times * LIFT_PER_CELL });
const DIAMOND: PropPoint[] = [
	[-HALF, -HALF],
	[HALF, -HALF],
	[HALF, HALF],
	[-HALF, HALF],
];

const fed = (key: string, kind: ComponentParam['kind'], value: unknown, label: string) =>
	({ key, kind, default: value, engineProvided: true, label }) satisfies ComponentParam;
const PARAMS = {
	zone: fed('zone', 'string', '', 'the zone it is on (the prop sets it)'),
	height: fed('height', 'number', 6, 'deck height, cells (the zone sets it)'),
	index: fed('index', 'number', 1, 'its cell, 1 = the first (the prop sets it)'),
	count: fed('count', 'number', 6, 'cells in the deck (the prop sets it)'),
};
const INDEX_INPUTS = [
	{ id: 'index', kind: 'number' as const, default: 1 },
	{ id: 'count', kind: 'number' as const, default: 6 },
];

/** A node drawn by the `PropGraphic` bound part. */
const graphic = (id: string, label: string, props: PropGraphicProps, at = { x: 0, y: 0 }) =>
	({
		id,
		label,
		kind: 'container',
		x: at.x,
		y: at.y,
		alpha: 1,
		children: [],
		bind: { component: 'PropGraphic', props },
	}) satisfies LayoutNode;

const piece = (
	id: string,
	name: string,
	children: LayoutNode[],
	extra: Partial<ComponentDef> = {},
): ComponentDef => ({
	id,
	name,
	version: 1,
	scope: 'shared',
	category: 'scenery',
	internal: true,
	root: { id: `${id}-root`, kind: 'container', x: 0, y: 0, children },
	signalScope: 'zone',
	...extra,
});

/** A layer showing `node` on the cells with a pillar: the first, the last, every third between. */
const pillarLayer = (shown: string, bare: string): SmLayer => {
	const cells: number[] = [1];
	for (let i = 1 + PILLAR_EVERY; i <= REPEATER_COUNT_HARD_MAX; i += PILLAR_EVERY) cells.push(i);
	return {
		id: 'pillar',
		name: 'Pillar',
		entry: 'bare',
		states: [
			{ id: 'bare', timeline: bare },
			{ id: 'pillar', timeline: shown },
		],
		transitions: [
			{
				id: 'pillar-last',
				from: 'bare',
				to: 'pillar',
				conditions: [{ input: 'index', op: '==', param: 'count' }],
			},
			...cells.map((cell) => ({
				id: `pillar-${cell}`,
				from: 'bare',
				to: 'pillar',
				conditions: [{ input: 'index', op: '==' as const, value: cell }],
			})),
		],
	};
};

/**
 * A cell's water (`water` band): its reflection a quarter cell down, swaying as the code's shimmer
 * from the cell's own `phase` (seconds; the mount sets it per cell), and under a pillar the
 * pillar's reflection, drawn after it as the code draws them. `ambience` steps between `idle` and
 * `occupied`, which key nothing: the author's hook.
 */
const waterDef = (): ComponentDef =>
	piece(
		BRIDGE_PROP_IDS.water,
		'Bridge water',
		[
			graphic(
				`${BRIDGE_PROP_IDS.water}-reflection`,
				NODES.reflection,
				{ ops: [{ poly: DIAMOND, fill: { color: COLORS.reflection, alpha: 0.5 } }] },
				{ x: 0, y: CELL / 4 },
			),
			graphic(`${BRIDGE_PROP_IDS.water}-below`, NODES.below, {
				ops: [
					{
						rect: [-PILLAR_W / 2, 0, PILLAR_W, lift(0.6)],
						fill: { color: COLORS.below, alpha: 0.3 },
					},
				],
			}),
		],
		{
			params: [
				PARAMS.zone,
				PARAMS.height,
				PARAMS.index,
				PARAMS.count,
				{
					key: 'phase',
					kind: 'number',
					default: 0,
					engineProvided: true,
					label: 'its sway starts this far in, s',
				},
			],
			inputs: [...INDEX_INPUTS, { id: 'occupied', kind: 'number', default: 0 }],
			stateMachine: {
				layers: [
					{
						id: 'shimmer',
						name: 'Shimmer',
						entry: 'sway',
						states: [
							{
								id: 'sway',
								timeline: BRIDGE_PROP_TIMELINES.sway,
								loop: true,
								offsetParam: 'phase',
							},
						],
						transitions: [],
					},
					{
						id: 'ambience',
						name: 'Ambience',
						entry: 'idle',
						states: [
							{ id: 'idle', timeline: BRIDGE_PROP_TIMELINES.idle, loop: true },
							{ id: 'occupied', timeline: BRIDGE_PROP_TIMELINES.occupied, loop: true },
						],
						transitions: [
							{
								id: 'ambience-occupied',
								from: 'idle',
								to: 'occupied',
								conditions: [{ input: 'occupied', op: '>', value: 0 }],
							},
							{
								id: 'ambience-idle',
								from: 'occupied',
								to: 'idle',
								conditions: [{ input: 'occupied', op: '<=', value: 0 }],
							},
						],
					},
					pillarLayer(BRIDGE_PROP_TIMELINES.belowShown, BRIDGE_PROP_TIMELINES.belowBare),
				],
			},
		},
	);

/** A cell's pillar (`behind` band), from the ground up to the deck, with its shaded edge. */
const pillarDef = (): ComponentDef =>
	piece(
		BRIDGE_PROP_IDS.pillar,
		'Bridge pillar',
		[
			graphic(`${BRIDGE_PROP_IDS.pillar}-pillar`, NODES.pillar, {
				ops: [
					{ rect: [-PILLAR_W / 2, lift(-1), PILLAR_W, lift(1)], fill: { color: COLORS.wood } },
					{
						rect: [-PILLAR_W / 2, lift(-1), PILLAR_W / 4, lift(1)],
						fill: { color: 0x000000, alpha: 0.25 },
					},
				],
			}),
		],
		{
			params: [PARAMS.zone, PARAMS.height, PARAMS.index, PARAMS.count],
			inputs: INDEX_INPUTS,
			stateMachine: {
				layers: [pillarLayer(BRIDGE_PROP_TIMELINES.pillarShown, BRIDGE_PROP_TIMELINES.pillarBare)],
			},
		},
	);

/**
 * A deck cell (`sorted` band), drawn at the deck's height over its ground place: the side under
 * its near edges, the plank tile and two plank lines. `stepOn` / `stepOff` dip it.
 */
const deckDef = (id: string, name: string, color: number): ComponentDef => {
	const up = (p: readonly [number, number], dy = 0): PropPoint => [p[0], p[1], dy];
	const right = [HALF, -HALF] as const;
	const near = [HALF, HALF] as const;
	const left = [-HALF, HALF] as const;
	const ops: PropGraphicOp[] = [
		{
			poly: [up(right), up(near), up(left), up(left, SIDE), up(near, SIDE), up(right, SIDE)],
			fill: { color: COLORS.wood },
		},
		{ poly: DIAMOND, fill: { color }, stroke: { width: 2, color: COLORS.edge } },
		...[-0.25, 0.25].map((k): PropGraphicOp => ({
			line: [
				[-HALF, k * CELL],
				[HALF, k * CELL],
			],
			stroke: { width: 1, color: COLORS.wood, alpha: 0.6 },
		})),
	];
	return piece(id, name, [graphic(`${id}-tile`, NODES.tile, { ops, y: lift(-1) })], {
		params: [PARAMS.zone, PARAMS.height, PARAMS.index, PARAMS.count],
		inputs: [
			...INDEX_INPUTS,
			{ id: 'stepOn', kind: 'trigger' },
			{ id: 'stepOff', kind: 'trigger' },
		],
		stateMachine: {
			layers: [
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
	});
};

/**
 * A slope (`behind` band), from the ground at its land cell (its place) `run` cells along the deck
 * up to the deck's end: + 2 for the near one, − 2 for the far one.
 */
const slopeDef = (): ComponentDef => {
	const run: PropScalar = { param: 'run', times: CELL };
	return piece(
		BRIDGE_PROP_IDS.slope,
		'Bridge slope',
		[
			graphic(`${BRIDGE_PROP_IDS.slope}-slope`, 'Slope', {
				ops: [
					{
						poly: [
							[0, -HALF],
							[0, HALF],
							[run, HALF, lift(-1)],
							[run, -HALF, lift(-1)],
						],
						fill: { color: COLORS.slope },
						stroke: { width: 2, color: COLORS.edge },
					},
				],
			}),
		],
		{
			params: [
				PARAMS.zone,
				PARAMS.height,
				{
					key: 'run',
					kind: 'number',
					default: 2,
					label: 'cells from its foot to the deck (near + , far −)',
				},
			],
		},
	);
};

const cells = (id: string, label: string, componentId: string) => ({
	id: `${BRIDGE_PROP_IDS.prop}-${id}`,
	label,
	kind: 'repeater' as const,
	x: 0,
	y: 0,
	source: '',
	componentId,
	layout: { direction: 'row' as const, gap: 0 },
	count: { preview: 6, max: REPEATER_COUNT_HARD_MAX },
});

/**
 * THE SEED BRIDGE: Salmons' code bridge as a prop. Its collider is today's rule and compiles to
 * `{ from, zoneKind }` (`check:prop-shape` §3). Its root children are its pieces (`propPieces.ts`),
 * each a band at the code's depth: the water per cell (`water`), the pillars per cell (`behind`,
 * 400), the deck cells near / middle / far (`sorted`, 1100), and the two slopes at their land cells
 * (`behind`, 500). Every piece draws as the code bridge draws (`check:prop-depth`), hears its own
 * zone's triggers (scoped by `zone`) and reads the deck's `height`.
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
			{ ...cells('water', 'Water', BRIDGE_PROP_IDS.water), propDepth: 'water' },
			{
				...cells('pillars', 'Pillars', BRIDGE_PROP_IDS.pillar),
				propDepth: 'behind',
				propZOffset: 400,
			},
			{
				...cells('deck', 'Deck', BRIDGE_PROP_IDS.deckMiddle),
				variants: {
					first: BRIDGE_PROP_IDS.deckNear,
					middle: BRIDGE_PROP_IDS.deckMiddle,
					last: BRIDGE_PROP_IDS.deckFar,
				},
				propDepth: 'sorted',
				propZOffset: 1100,
			},
			{
				id: `${BRIDGE_PROP_IDS.prop}-nearSlope`,
				label: 'Near slope',
				kind: 'componentInstance',
				x: 0,
				y: 0,
				componentId: BRIDGE_PROP_IDS.slope,
				params: { run: 2 },
				propDepth: 'behind',
				propZOffset: 500,
				propCell: -2,
			},
			{
				id: `${BRIDGE_PROP_IDS.prop}-farSlope`,
				label: 'Far slope',
				kind: 'componentInstance',
				x: 0,
				y: 0,
				componentId: BRIDGE_PROP_IDS.slope,
				params: { run: -2 },
				propDepth: 'behind',
				propZOffset: 500,
				propCell: { param: 'length', plus: 1 },
			},
		],
	},
	params: [
		{
			key: 'length',
			kind: 'number',
			default: 6,
			engineProvided: true,
			label: 'deck cells (the zone sets it)',
		},
		PARAMS.height,
		PARAMS.zone,
	],
	signalScope: 'zone',
	inputs: [
		{ id: 'occupied', kind: 'number', default: 0 },
		{ id: 'stepOn', kind: 'trigger' },
		{ id: 'stepOff', kind: 'trigger' },
	],
	prop: {
		zoneKind: 'bridge',
		fromZone: { length: 'length', height: 'height' },
		collider: {
			deck: { from: 0, to: { param: 'length', plus: -1 }, height: { param: 'height' } },
			snap: 0.5,
			ramps: { near: { length: 2 }, far: { length: 2 } },
			hole: 'deckAndRamps',
		},
		preview: { length: 6, height: 6 },
	},
});

let built: ComponentDef[] | undefined;
const propDefs = (): ComponentDef[] =>
	(built ??= [
		bridgeDef(),
		waterDef(),
		pillarDef(),
		deckDef(BRIDGE_PROP_IDS.deckNear, 'Bridge deck (near end)', COLORS.near),
		deckDef(BRIDGE_PROP_IDS.deckMiddle, 'Bridge deck (middle)', COLORS.middle),
		deckDef(BRIDGE_PROP_IDS.deckFar, 'Bridge deck (far end)', COLORS.far),
		slopeDef(),
	]);
const bridgeOf = (): ComponentDef => propDefs()[0];

/** The prop built-ins, every piece def a seed prop places included. */
export const PROP_COMPONENTS: ComponentDef[] = /* @__PURE__ */ propDefs();
/** The seed bridge ({@link bridgeDef}). */
export const BRIDGE_PROP_DEF: ComponentDef = /* @__PURE__ */ bridgeOf();

type Key = readonly [number, number];
/** A component timeline of `componentId` keying channels of named nodes. */
const timeline = (
	id: string,
	name: string,
	componentIds: readonly string[],
	duration: number,
	keys: Record<string, Partial<Record<'x' | 'y' | 'scaleX' | 'visible', readonly Key[]>>>,
): CinematicDoc => ({
	schemaVersion: 1,
	id,
	name,
	duration,
	fps: 60,
	markers: [],
	host: { kind: 'component', componentId: componentIds[0] },
	...(componentIds.length > 1 ? { playOnComponents: componentIds.slice(1) } : {}),
	stage: {
		sceneId: null,
		cast: Object.keys(keys).map((node) => ({
			actorId: node,
			kind: 'node',
			target: node,
			place: {},
		})),
	},
	tracks: Object.entries(keys).flatMap(([node, { visible, ...channels }]) => [
		...(Object.keys(channels).length
			? [
					{
						id: `${node}-property`,
						kind: 'property' as const,
						actorId: node,
						channels: Object.fromEntries(
							Object.entries(channels).map(([channel, at]) => [
								channel,
								at.map(([time, value]) => ({ time, value })),
							]),
						),
					},
				]
			: []),
		...(visible
			? [
					{
						id: `${node}-visibility`,
						kind: 'visibility' as const,
						actorId: node,
						keys: visible.map(([time, on]) => ({ time, visible: on === 1 })),
					},
				]
			: []),
	]),
});

/**
 * The code shimmer (`river.ts`): at frame f (60 a second) and a cell's phase, `t = 0.04 f + phase`,
 * the reflection is `(sin t · 1.5 + sin 1.7 t · 0.6) K` px off its place and `1 + 0.04 sin t` wide.
 * Its period is 20π in `t` (both sines close there), keyed at every frame; a cell's phase is its
 * state's offset, `phase / 2.4` s.
 */
export const SWAY_PER_SECOND = 0.04 * 60;
const SWAY_DURATION = (20 * Math.PI) / SWAY_PER_SECOND;
const swayKeys = (): { x: Key[]; scaleX: Key[] } => {
	const x: Key[] = [];
	const scaleX: Key[] = [];
	const at = (time: number) => {
		const t = time * SWAY_PER_SECOND;
		x.push([time, (Math.sin(t) * 1.5 + Math.sin(1.7 * t) * 0.6) * K]);
		scaleX.push([time, 1 + Math.sin(t) * 0.04]);
	};
	for (let f = 0; f / 60 < SWAY_DURATION; f++) at(f / 60);
	at(SWAY_DURATION);
	return { x, scaleX };
};
const dip = (depth: number): Key[] => [
	[0, 0],
	[0.12, depth],
	[0.3, 0],
];
const DECKS = [BRIDGE_PROP_IDS.deckNear, BRIDGE_PROP_IDS.deckMiddle, BRIDGE_PROP_IDS.deckFar];

const propTimelines = (): CinematicDoc[] => [
	timeline(BRIDGE_PROP_TIMELINES.sway, 'Water: sway', [BRIDGE_PROP_IDS.water], SWAY_DURATION, {
		[NODES.reflection]: swayKeys(),
	}),
	timeline(BRIDGE_PROP_TIMELINES.idle, 'Water: idle', [BRIDGE_PROP_IDS.water], 1, {}),
	timeline(BRIDGE_PROP_TIMELINES.occupied, 'Water: occupied', [BRIDGE_PROP_IDS.water], 1, {}),
	timeline(BRIDGE_PROP_TIMELINES.belowBare, 'Water: no pillar', [BRIDGE_PROP_IDS.water], 1, {
		[NODES.below]: { visible: [[0, 0]] },
	}),
	timeline(BRIDGE_PROP_TIMELINES.belowShown, 'Water: pillar', [BRIDGE_PROP_IDS.water], 1, {
		[NODES.below]: { visible: [[0, 1]] },
	}),
	timeline(BRIDGE_PROP_TIMELINES.pillarBare, 'Pillar: none', [BRIDGE_PROP_IDS.pillar], 1, {
		[NODES.pillar]: { visible: [[0, 0]] },
	}),
	timeline(BRIDGE_PROP_TIMELINES.pillarShown, 'Pillar: shown', [BRIDGE_PROP_IDS.pillar], 1, {
		[NODES.pillar]: { visible: [[0, 1]] },
	}),
	timeline(BRIDGE_PROP_TIMELINES.still, 'Deck: still', DECKS, 1, {
		[NODES.tile]: { y: [[0, 0]] },
	}),
	timeline(BRIDGE_PROP_TIMELINES.stepOn, 'Deck: step on', DECKS, 0.3, {
		[NODES.tile]: { y: dip(3 * K) },
	}),
	timeline(BRIDGE_PROP_TIMELINES.stepOff, 'Deck: step off', DECKS, 0.3, {
		[NODES.tile]: { y: dip(1.5 * K) },
	}),
];

/** The timelines the prop built-ins' machines play. No `playOn`: only the machines play them. */
export const PROP_TIMELINES: readonly CinematicDoc[] = /* @__PURE__ */ propTimelines();
