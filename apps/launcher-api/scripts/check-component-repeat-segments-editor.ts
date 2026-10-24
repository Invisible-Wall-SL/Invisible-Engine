/**
 * The editor side of the count-mode repeater (segmented counters — free spins / respins left):
 *   pnpm --filter launcher-api check:component-repeat-segments-editor
 *
 *  1. creation: the Components side's "Repeat (count)" element spawns a count-mode repeater
 *     (`newCountRepeater`: `source: ''`, preview 3, a row 8 px apart) of the first component that
 *     lights by `index` (`defaultSegmentComponent`), and the palette / canvas drop / Properties are
 *     wired to it (source-scanned);
 *  2. geometry, over the game's own helpers: N from the preview count (rounded, default cap 20,
 *     `max`, hard cap 50), first / middle / last variants, row / column / grid offsets with end caps
 *     wider than a middle segment, the group anchored against its whole footprint, the selection box
 *     (`nodeBox`) framing the same footprint;
 *  3. each segment's params `{ index, count }` and its state-machine inputs (index / count given,
 *     the author's test values);
 *  4. the settled pose (`settledSegmentPose` / `segmentPoseNodes`) on a real Lit / Unlit machine
 *     (`value >= {index}`): at value 0..3 of 3 segments exactly the first `value` are lit; no
 *     machine or no timelines ⇒ the base pose; a hidden node is left out;
 *     the built-in Segmented Counter previews from the built-in timelines;
 *  5. parity: a source-list repeater (the seeded buy-feature cards) frames and expands exactly as
 *     before this change;
 *  6. the State machine panel's preview reads a param's default (`index` on a segment opened alone);
 *  7. end caps made by ⧉ Duplicate (`duplicateComponent`) of a segment drawn from rig looks, as the
 *     owner's Respin counter: each segment's shown look (what the rig layer draws, which has no
 *     alpha) is the one its machine lights; a variant naming no def draws the middle segment, as in
 *     game; the rig layer walks count-mode repeaters and the canvas mounts it for their rigs
 *     (source-scanned);
 *  8. a segment's root box (the Components side's **Size**): the canvas lays rig-only segments out
 *     by it, as the game does, and the field writes `root.width` / `root.height` (source-scanned).
 *
 * What it cannot prove: the canvas and Properties in a browser — the owner's pass.
 */
import { readFileSync } from 'node:fs';
import type { CinematicDoc, ComponentDef, LayoutNode } from 'engine-layout';

const H = await import('../src/routes/(app)/editor/editorCanvas.helpers.ts');
const SP = await import('../src/lib/timeline/segmentPreview.ts');
const S = await import('../src/lib/timeline/screenTimeline.ts');
const L = await import('../../../packages/engine-layout/src/lib/index.ts');

let failures = 0;
let passes = 0;
function eq(name: string, actual: unknown, expected: unknown): void {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		passes++;
		return;
	}
	failures++;
	console.error(`✗ ${name}\n    expected ${e}\n    got      ${a}`);
}
const read = (path: string): string =>
	readFileSync(new URL(`../src/routes/(app)/editor/${path}`, import.meta.url), 'utf8');

type Repeater = Extract<LayoutNode, { kind: 'repeater' }>;
type CountRepeater = Repeater & { count: NonNullable<Repeater['count']> };

/** A sized segment component: one rect of `w` × `h` with its top-left at the origin. */
const sized = (id: string, w: number, h: number, extra: Partial<ComponentDef> = {}): ComponentDef =>
	({
		id,
		name: id,
		version: 1,
		root: {
			id: `${id}-root`,
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{ id: `${id}-bg`, kind: 'rect', x: w / 2, y: h / 2, width: w, height: h, color: 0 },
			],
		},
		...extra,
	}) as ComponentDef;
const seg = sized('seg', 40, 20, { params: [{ key: 'index', kind: 'number', default: 1 }] });
const cap = sized('cap', 60, 20);
const plain = sized('plain', 40, 20);
const map = new Map<string, ComponentDef>([
	[seg.id, seg],
	[cap.id, cap],
	[plain.id, plain],
]);
const counter = (patch: Partial<CountRepeater> = {}): CountRepeater => ({
	...H.newCountRepeater({ id: 'bar', x: 0, y: 0 }, 'seg'),
	...patch,
});

// ---- 1. creation ------------------------------------------------------------------------------

eq(
	'"Repeat (count)" spawns a count-mode repeater: no source list, 3 segments in a row 8 px apart',
	H.newCountRepeater({ id: 'n1', x: 10, y: 20, anchor: { x: 0.5, y: 0.5 } }, 'seg'),
	{
		id: 'n1',
		x: 10,
		y: 20,
		anchor: { x: 0.5, y: 0.5 },
		kind: 'repeater',
		label: 'Segments',
		source: '',
		componentId: 'seg',
		count: { preview: 3 },
		layout: { direction: 'row', gap: 8 },
	},
);
eq(
	'…of the first component that declares an `index`',
	H.defaultSegmentComponent([plain, seg]),
	'seg',
);
eq(
	'…a number input named `index` counts too',
	H.defaultSegmentComponent([
		plain,
		sized('byInput', 10, 10, { inputs: [{ id: 'index', kind: 'number' }] }),
	]),
	'byInput',
);
eq(
	'…else the first offered, else none',
	[H.defaultSegmentComponent([plain, cap]), H.defaultSegmentComponent([])],
	['plain', ''],
);
{
	const canvas = read('EditorCanvas.svelte');
	const palette = read('EditorElementsPalette.svelte');
	const workspace = read('ComponentWorkspace.svelte');
	const props = read('EditorProperties.svelte');
	const panel = read('EditorRepeaterCount.svelte');
	eq(
		'the canvas drop spawns it (a keyless drop) and draws count mode on its own path',
		[
			/case 'segments':\s*return newCountRepeater\(base, p\.key\)/.test(canvas),
			/payload\.kind === 'segments'/.test(canvas),
			/if \(isCountRepeater\(node\)\) \{\s*drawCountRepeater\(/.test(canvas),
		],
		[true, true, true],
	);
	eq(
		'the palette row is "Repeat (count)", offered on the Components side only',
		[
			palette.includes('<span class="name">Repeat (count)</span>'),
			/kind: 'segments'/.test(palette),
			/<EditorElementsPalette[\s\S]{0,80}segments=\{componentDraft/.test(workspace),
			/<EditorElementsPalette[\s\S]{0,40}segments=/.test(read('+page.svelte')),
		],
		[true, true, true, false],
	);
	eq(
		'Properties opens the count panel for a count-mode repeater, before the source-list one',
		props.indexOf("node.kind === 'repeater' && isCountRepeater(node)") <
			props.indexOf("{:else if node.kind === 'repeater'}") &&
			props.includes('<EditorRepeaterCount'),
		true,
	);
	eq(
		'the count panel carries every authored field',
		[
			'segment',
			'same as segment',
			'preview count',
			'max',
			'count from',
			'direction',
			'column',
			'Pass to each segment',
			'from value',
			'test value',
			'given by the repeater',
		].filter((label) => !panel.includes(label)),
		[],
	);
}

// ---- 2. geometry ------------------------------------------------------------------------------

eq(
	'N is the preview count, rounded and never below 0',
	[3, 2.6, -1, Number.NaN].map((preview) =>
		H.repeaterPreviewCount(counter({ count: { preview } })),
	),
	[3, 3, 0, 0],
);
eq(
	'…capped at 20 by default, at `max`, and never above 50',
	[
		H.repeaterPreviewCount(counter({ count: { preview: 30 } })),
		H.repeaterPreviewCount(counter({ count: { preview: 9, max: 5 } })),
		H.repeaterPreviewCount(counter({ count: { preview: 80, max: 99 } })),
	],
	[20, 5, 50],
);
{
	const capped = counter({ variants: { first: 'cap', last: 'cap' } });
	const ids = (n: number) =>
		Array.from({ length: n }, (_, i) => L.repeaterSegmentComponent(capped, i, n));
	eq('variants: first, middle…, last', ids(4), ['cap', 'seg', 'seg', 'cap']);
	eq(
		'…a single segment is the first; two are first + last',
		[ids(1), ids(2)],
		[['cap'], ['cap', 'cap']],
	);

	const row = H.repeaterPreviewLayout(capped, map, 'desktop');
	eq('row: each segment advances by its own width + the gap (end caps 60, middle 40)', row, {
		offsets: [
			{ x: 0, y: 0 },
			{ x: 68, y: 0 },
			{ x: 116, y: 0 },
		],
		width: 176,
		height: 20,
	});
	eq(
		'column: along +y, as wide as the widest',
		H.repeaterPreviewLayout(
			counter({ variants: { first: 'cap', last: 'cap' }, layout: { direction: 'column', gap: 8 } }),
			map,
			'desktop',
		),
		{
			offsets: [
				{ x: 0, y: 0 },
				{ x: 0, y: 28 },
				{ x: 0, y: 56 },
			],
			width: 60,
			height: 76,
		},
	);
	eq(
		'grid: the uniform stride of the segment component, wrapping every `columns`',
		H.repeaterPreviewLayout(
			counter({ layout: { direction: 'grid', gap: 8, columns: 2 } }),
			map,
			'desktop',
		),
		{
			offsets: [
				{ x: 0, y: 0 },
				{ x: 48, y: 0 },
				{ x: 0, y: 28 },
			],
			width: 88,
			height: 48,
		},
	);
	const { boxes } = H.repeaterCountBoxes(capped, map, 'desktop', 0.5, 0.5);
	eq(
		'boxes: each segment at its offset, the group centred on the node by its anchor',
		boxes.map((b) => [b.def.id, b.container.x, b.container.y]),
		[
			['cap', -88, -10],
			['seg', -20, -10],
			['cap', 28, -10],
		],
	);
	const t = L.resolveTransform({ ...capped, anchor: { x: 0.5, y: 0.5 } }, 'desktop');
	eq(
		'the selection box frames the same footprint',
		H.nodeBox({ ...capped, anchor: { x: 0.5, y: 0.5 } }, t, () => null, map, 'desktop'),
		{ w: 176, h: 20, ax: 0.5, ay: 0.5 },
	);
	eq(
		'…and a stand-in when nothing is drawn (no segment, or a component that is missing)',
		[
			H.nodeBox(
				counter({ count: { preview: 0 } }),
				L.resolveTransform(capped, 'desktop'),
				() => null,
				map,
				'desktop',
			),
			H.nodeBox(
				counter({ componentId: 'gone' }),
				L.resolveTransform(capped, 'desktop'),
				() => null,
				map,
				'desktop',
			),
		],
		[
			{ w: 80, h: 80, ax: 0, ay: 0 },
			{ w: 80, h: 80, ax: 0, ay: 0 },
		],
	);
	eq(
		'a missing variant draws the segment an unset one would (as in game), not nothing',
		H.repeaterCountBoxes(counter({ variants: { first: 'gone' } }), map, 'desktop', 0, 0).boxes.map(
			(b) => [b.index, b.def.id],
		),
		[
			[1, 'seg'],
			[2, 'seg'],
			[3, 'seg'],
		],
	);
}

// ---- 3. params and inputs ---------------------------------------------------------------------

{
	const withInputs = sized('lamp', 40, 20, {
		params: [{ key: 'index', kind: 'number', default: 1 }],
		inputs: [
			{ id: 'value', kind: 'number', default: 0 },
			{ id: 'index', kind: 'number', default: 0 },
			{ id: 'count', kind: 'number', default: 0 },
			{ id: 'big', kind: 'number', default: 5 },
			{ id: 'on', kind: 'bool' },
		],
	});
	const m = new Map([[withInputs.id, withInputs]]);
	const node = counter({ componentId: 'lamp', previewInputs: { value: 2 } });
	const { boxes } = H.repeaterCountBoxes(node, m, 'desktop', 0, 0);
	eq(
		'each segment gets params { index: 1-based position, count: N }',
		boxes.map((b) => [b.params.index, b.params.count]),
		[
			[1, 3],
			[2, 3],
			[3, 3],
		],
	);
	eq(
		'…and as its number inputs index / count, then the test values (others keep their default)',
		H.repeaterSegmentInputs(node, withInputs, L.repeaterSegmentValues(1, 3)),
		{ value: 2, index: 2, count: 3 },
	);
}

// ---- 4. the settled pose ----------------------------------------------------------------------

const lamp: ComponentDef = {
	id: 'lamp',
	name: 'Lamp',
	version: 1,
	params: [{ key: 'index', kind: 'number', default: 1 }],
	inputs: [{ id: 'value', kind: 'number', default: 0 }],
	root: {
		id: 'lamp-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'n_unlit',
				label: 'Unlit',
				kind: 'rect',
				x: 20,
				y: 10,
				width: 40,
				height: 20,
				color: 0x550000,
			},
			{
				id: 'n_lit',
				label: 'Lit',
				kind: 'rect',
				x: 20,
				y: 10,
				width: 40,
				height: 20,
				color: 0xff8800,
			},
			{
				id: 'n_num',
				label: 'Number',
				kind: 'text',
				x: 20,
				y: 10,
				text: '1',
				paramBindings: { text: 'index' },
			},
		],
	} as ComponentDef['root'],
	stateMachine: {
		layers: [
			{
				id: 'main',
				entry: 'unlit',
				states: [
					{ id: 'unlit', timeline: 'c_lamp_unlit' },
					{ id: 'lit', timeline: 'c_lamp_lit' },
				],
				transitions: [
					{
						id: 'on',
						from: 'unlit',
						to: 'lit',
						conditions: [{ input: 'value', op: '>=', param: 'index' }],
						blend: 150,
					},
					{
						id: 'off',
						from: 'lit',
						to: 'unlit',
						conditions: [{ input: 'value', op: '<', param: 'index' }],
					},
				],
			},
		],
	},
};
const fade = (id: string, target: string): CinematicDoc =>
	({
		...S.newComponentTimeline({ id, name: id, componentId: 'lamp' }),
		duration: 0.4,
		stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'node', target, place: {} }] },
		tracks: [
			{
				id: 'p',
				kind: 'property',
				actorId: 'a',
				channels: {
					alpha: [
						{ time: 0, value: 1 },
						{ time: 0.4, value: 0 },
					],
				},
			},
		],
	}) as unknown as CinematicDoc;
// Lit fades the Unlit look out; Unlit fades the Lit look out.
const docs = [fade('c_lamp_lit', 'Unlit'), fade('c_lamp_unlit', 'Lit')];
const alphaOf = (nodes: LayoutNode[], id: string) => nodes.find((n) => n.id === id)?.alpha ?? 1;
const lit = (nodes: LayoutNode[]) =>
	alphaOf(nodes, 'n_unlit') === 0 && alphaOf(nodes, 'n_lit') === 1;
const unlit = (nodes: LayoutNode[]) =>
	alphaOf(nodes, 'n_lit') === 0 && alphaOf(nodes, 'n_unlit') === 1;
{
	const m = new Map([[lamp.id, lamp]]);
	const pose = (
		def: ComponentDef,
		inputs: Record<string, number>,
		params: Record<string, unknown>,
	) => SP.segmentPoseNodes(def, docs, inputs, params);
	const lights = [0, 1, 2, 3, 5].map((value) =>
		H.repeaterCountBoxes(
			counter({ componentId: 'lamp', previewInputs: { value } }),
			m,
			'desktop',
			0,
			0,
			undefined,
			pose,
		).boxes.map((b) =>
			lit(b.container.children) ? 'lit' : unlit(b.container.children) ? 'dark' : '?',
		),
	);
	eq(
		'value 0..3 of 3 segments lights exactly the first `value` (value >= {index}), past the blend',
		lights,
		[
			['dark', 'dark', 'dark'],
			['lit', 'dark', 'dark'],
			['lit', 'lit', 'dark'],
			['lit', 'lit', 'lit'],
			['lit', 'lit', 'lit'],
		],
	);
	eq(
		'…with no test value the input default (0) shows: all dark',
		H.repeaterCountBoxes(
			counter({ componentId: 'lamp' }),
			m,
			'desktop',
			0,
			0,
			undefined,
			pose,
		).boxes.map((b) => unlit(b.container.children)),
		[true, true, true],
	);
	eq(
		'the pose keeps the def untouched and the undriven nodes shared',
		[
			lamp.root.children.every((n) => n.alpha === undefined),
			pose(lamp, { value: 1 }, { index: 1 })?.[2] === lamp.root.children[2],
		],
		[true, true],
	);
	eq(
		'no state machine, or none of its timelines loaded ⇒ the base pose (null)',
		[
			SP.segmentPoseNodes({ ...lamp, stateMachine: undefined }, docs, { value: 1 }, { index: 1 }),
			SP.segmentPoseNodes(lamp, [], { value: 1 }, { index: 1 }),
			SP.settledSegmentPose(lamp, [], { value: 1 }, { index: 1 }),
		],
		[null, null, null],
	);
	eq(
		'the settle reads the state each layer ends in, sampled at its timeline’s end',
		[...(SP.settledSegmentPose(lamp, docs, { value: 3 }, { index: 2 }) ?? new Map()).entries()].map(
			([id, drive]) => [id, drive.sample.alpha],
		),
		[['n_unlit', 0]],
	);
	const posed = SP.posedNodes(
		[
			{
				id: 'a',
				kind: 'rect',
				x: 1,
				y: 2,
				width: 1,
				height: 1,
				color: 0,
				overrides: { portrait: { x: 5 } },
			},
			{ id: 'b', kind: 'rect', x: 0, y: 0, width: 1, height: 1, color: 0 },
		],
		new Map([
			['a', { bindings: [{ target: 'x' }, { target: 'alpha' }], sample: { x: 10, alpha: 0.5 } }],
			['b', { bindings: [{ target: 'visible' }], sample: { visible: false } }],
		]),
	);
	eq(
		'a drive folds into the node and its per-layout overrides as the canvas folds it; hidden ⇒ left out',
		posed.map((n) => [n.id, n.x, n.alpha, n.overrides?.portrait?.x]),
		[['a', 11, 0.5, 15]],
	);
}

{
	// The built-in starter previews from the built-in timelines, as the editor loads them.
	const bar = L.SEGMENTED_COUNTER_DEF;
	const segment = L.SEGMENTED_COUNTER_SEGMENT_DEF;
	const m = new Map([[segment.id, segment]]);
	const repeater = bar.root.children.find((n) => n.kind === 'repeater') as CountRepeater;
	const builtin = S.componentTimelinesOf([...L.BUILTIN_TIMELINES], segment.id);
	const looks = (value: number) =>
		H.repeaterCountBoxes(
			{ ...repeater, previewInputs: { value } },
			m,
			'desktop',
			0.5,
			0.5,
			undefined,
			(def, inputs, params) => SP.segmentPoseNodes(def, builtin, inputs, params),
		).boxes.map((b) => b.container.children.find((n) => n.label === 'lit')?.alpha);
	eq(
		'the built-in Segmented Counter previews its test value: 2 of 3 lit, then 1 of 3',
		[looks(2), looks(1)],
		[
			[1, 1, 0],
			[1, 0, 0],
		],
	);
}

// ---- 5. parity: the source-list repeater --------------------------------------------------------

{
	const node = L.defaultBuyFeatureScene().nodes.find((n) => n.kind === 'repeater') as Repeater;
	const def = L.FEATURE_CARD_DEF;
	const m = new Map([[def.id, def]]);
	const t = L.resolveTransform(node, 'desktop');
	eq('the seeded buy-feature repeater is a source-list one', L.isCountRepeater(node), false);
	// Frozen from the build before count mode existed.
	const before: Record<string, { w: number; xs: number[] }> = {
		fallback: { w: 888, xs: [-444, -140, 164] },
		'2': { w: 584, xs: [-292, 12] },
		'4': { w: 1192, xs: [-596, -292, 12, 316] },
	};
	for (const count of [undefined, 2, 4]) {
		const key = count === undefined ? 'fallback' : String(count);
		const g = H.repeaterPlaceholderGrid(node, { count, def });
		eq(
			`its selection box and boxes are unchanged (${key} cards)`,
			{
				box: H.nodeBox(node, t, () => null, m, 'desktop', undefined, count),
				boxes: H.repeaterBoxes(node, def, g, [], 0.5, 0.5).map((b) => [
					b.container.x,
					b.container.y,
					b.container.children === def.root.children,
				]),
			},
			{
				box: { w: before[key].w, h: 380, ax: 0.5, ay: 0.5 },
				boxes: before[key].xs.map((x) => [x, -190, true]),
			},
		);
	}
}

// ---- 6. the State machine panel reads param defaults -------------------------------------------

eq(
	'the panel’s preview runner reads each param’s default (a segment’s `index` opened alone)',
	/new ComponentStateMachineRunner\([\s\S]{0,120}\(key\) => params\.find\(\(p\) => p\.key === key\)\?\.default/.test(
		read('EditorStateMachinePanel.svelte'),
	),
	true,
);

// ---- 7. rig-look end caps, and a variant naming no def -----------------------------------------

{
	const D = await import('../src/routes/(app)/editor/componentDuplicate.client.ts');
	const rigLook = (look: NonNullable<LayoutNode>): LayoutNode =>
		look.kind === 'container'
			? {
					...look,
					children: [
						{
							id: `${look.id}-rig`,
							kind: 'spine',
							x: 0,
							y: 0,
							assetKey: 'R_RespinTile',
							defaultAnimation: look.label === 'lit' ? 'ON' : 'OFF',
						} as LayoutNode,
					],
				}
			: look;
	const starter = L.SEGMENTED_COUNTER_SEGMENT_DEF;
	const middle: ComponentDef = {
		...starter,
		root: { ...starter.root, children: starter.root.children.map(rigLook) },
	};
	let minted = 0;
	const cap = (id: string, x: number) => {
		const copy = D.duplicateComponent(middle, {
			id,
			name: `${id} copy`,
			mintNodeId: () => `n_${minted++}`,
			timelines: L.SEGMENTED_COUNTER_TIMELINES,
			takenTimelineIds: L.BUILTIN_TIMELINES.map((d) => d.id),
		});
		copy.def.root.children.push({
			id: `${id}-border`,
			kind: 'sprite',
			x,
			y: 0,
			anchor: { x: 0.5, y: 0.5 },
			assetKey: 'borders',
			region: id,
			width: 60,
			height: 106,
		} as LayoutNode);
		return copy;
	};
	const first = cap('capL', -85);
	const last = cap('capR', 85);
	const timelines = new Map<string, readonly CinematicDoc[]>([
		[middle.id, L.SEGMENTED_COUNTER_TIMELINES],
		[first.def.id, first.timelines],
		[last.def.id, last.timelines],
	]);
	const counter = (variants: { first: string; last: string }): CountRepeater => ({
		...H.newCountRepeater({ id: 'bar', x: 0, y: 0, anchor: { x: 0.5, y: 0.5 } }, middle.id),
		layout: { direction: 'row', gap: 6 },
		previewInputs: { value: 2 },
		variants,
	});
	const defs = new Map([middle, first.def, last.def].map((d) => [d.id, d]));
	const boxesOf = (node: CountRepeater) =>
		H.repeaterCountBoxes(node, defs, 'desktop', 0.5, 0.5, {}, (def, inputs, params) =>
			SP.segmentPoseNodes(def, timelines.get(def.id) ?? [], inputs, params),
		).boxes;
	const shownLooks = (box: ReturnType<typeof boxesOf>[number]) =>
		box.container.children
			.filter((c) => c.kind === 'container' && c.alpha !== 0)
			.map((c) => c.label);
	const owner = boxesOf(counter({ first: first.def.id, last: last.def.id }));
	eq(
		'rig-look end caps at 2 left: each segment shows the look its machine lights',
		owner.map((b) => [b.def.id, b.index, shownLooks(b)]),
		[
			['capL', 1, ['lit']],
			[middle.id, 2, ['lit']],
			['capR', 3, ['unlit']],
		],
	);
	eq(
		'…laid out by the end caps’ sprites (a rig-only middle measures 0)',
		owner.map((b) => b.container.x),
		[-66, 0, 6],
	);
	eq(
		'a first end cap naming no def: the middle segment draws there',
		boxesOf(counter({ first: 'ghostCap', last: last.def.id })).map((b) => b.def.id),
		[middle.id, middle.id, 'capR'],
	);

	const rigLayer = read('EditorRigLayer.svelte');
	eq(
		'the rig layer walks count-mode repeaters, at the top level and nested',
		rigLayer.match(/isCountRepeater\(n\)\) \{\s*collectSegmentRigs\(/g)?.length,
		2,
	);
	eq(
		'…through the canvas’s own boxes and poses, leaving out a look faded to alpha 0',
		/function collectSegmentRigs[\s\S]{0,600}repeaterCountBoxes\([\s\S]{0,300}segmentPoseNodes\([\s\S]{0,300}\.alpha !== 0/.test(
			rigLayer,
		),
		true,
	);
	eq(
		'the canvas mounts the rig layer for a rig inside a segment',
		/function nodesHaveRig[\s\S]{0,2500}isCountRepeater\(n\)[\s\S]{0,200}repeaterComponentIds\(n\)/.test(
			read('EditorCanvas.svelte'),
		),
		true,
	);
}

// ---- 8. a segment's root box -----------------------------------------------------------------

{
	const rigTile = (box?: { width: number; height: number }): ComponentDef => ({
		id: 'tile',
		name: 'Tile',
		version: 1,
		root: {
			id: 'tile-root',
			kind: 'container',
			x: 0,
			y: 0,
			...box,
			children: [{ id: 'tile-rig', kind: 'spine', x: 0, y: 0, assetKey: 'tile' } as LayoutNode],
		},
	});
	const row = (def: ComponentDef) =>
		H.repeaterPreviewLayout(
			{
				...H.newCountRepeater({ id: 'bar', x: 0, y: 0 }, 'tile'),
				layout: { direction: 'row', gap: 6 },
			},
			new Map([[def.id, def]]),
			'desktop',
		).offsets.map((o) => o.x);
	eq('rig-only segments with no box stack on the canvas, as in game', row(rigTile()), [0, 6, 12]);
	eq('…with a box they step by it', row(rigTile({ width: 160, height: 120 })), [0, 166, 332]);
	const workspace = read('ComponentWorkspace.svelte');
	eq(
		'the Size field sets and clears root.width / root.height',
		/function setComponentSize[\s\S]{0,300}delete componentDraft\.root\[axis\][\s\S]{0,80}componentDraft\.root\[axis\] = value/.test(
			workspace,
		) &&
			/setComponentSize\('width'/.test(workspace) &&
			/setComponentSize\('height'/.test(workspace),
		true,
	);
}

if (failures) {
	console.error(`\n${failures} failed, ${passes} passed`);
	process.exit(1);
}
console.log(`✓ component repeat segments (editor): ${passes} checks`);
