/**
 * Count-mode repeaters (segmented counters, `RepeaterNode.count`) — the engine side:
 *   pnpm --filter launcher-api check:component-repeat-segments
 *
 *  1. N: follows the value it reads (3 → 5 → 0), rounds, clamps at 0, reads a non-number as 0, and
 *     with no source is `count.preview`; the cap (default 20, `max`, never above 50);
 *  2. variants: the first / middle / last segment for N = 1, 2, 3, each unset one falling back;
 *  3. geometry (`repeaterCountOffsets`, shared with the editor): a row and a column laid end to end
 *     by each segment's own size, a grid on the node's pitch, the footprint the anchor reads;
 *  4. what each segment is handed: `index` (1-based) and `count`, as params;
 *  5. the starter's state machine, on the real runner, player and built-in timelines: for N = 3
 *     and 5 and every value left 0..N, segment k is Lit exactly when left >= k, and the pose the
 *     player samples is that state's;
 *  6. what saves: the real launcher normalizer keeps `count` / `variants` / `passInputs` /
 *     `previewInputs` (idempotently, byte-identical on a second pass), drops malformed values
 *     (a `count` without a finite `preview` drops whole), and leaves a node without them the same
 *     object; the launcher knows the four fields (`LAYOUT_NODE_FIELDS`);
 *  7. the ship chain (rule 8): `collectComponentIds` and `resolveComponentClosure` (the walk the
 *     bake, the runtime bundle and the art export share) reach the segment and every variant from a
 *     scene placing only the bar; a source-list repeater ships what it did; Flow projects no
 *     `onSelect` pin for a count-mode repeater;
 *  8. the starter is offered to every kind and placed by no reference layout or template;
 *  9. MOUNTED for real: `ComponentInstance.svelte` → `Repeater.svelte` → the segments, compiled by
 *     Vite's Svelte plugin and run under Svelte's client runtime with a real Pixi ticker: the bar
 *     fed `respinsStart` = 3 draws 3 segments numbered 1..3, all lit at 3 left and only the first
 *     at 1, then 5 segments once the start goes to 5, and none at 0; a probe segment that declares
 *     `index` / `count` inputs holds the repeater's constants over a `passInputs` entry for `index`;
 *     an instance outside a repeater is untouched (its own input source); and a bar placed inside
 *     another component (the Hold and Win TOTAL WIN widget: screen → widget → bar → segment, three
 *     levels) still draws its 3 segments, offset by its place in the widget — on a cap of 2 the
 *     game skipped them.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type {
	CinematicDoc,
	ComponentDef,
	LayoutNode,
	RepeaterNode,
	Scene,
	ValueSource,
} from 'engine-layout';

const bucket = new Map<string, string>();
const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError: class extends Error {},
		precondition: () => undefined,
		getObjectTextWithEtag: async (key: string) => {
			const text = bucket.get(key);
			return text === undefined ? null : { text, etag: '"e"' };
		},
		putObjectText: async (key: string, text: string) => {
			bucket.set(key, text);
			return '"e"';
		},
		deleteObject: async (key: string) => void bucket.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		listAllObjects: async (prefix: string) =>
			[...bucket.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((key) => ({ key, size: 0, lastModified: 0 })),
		copyObject: async () => undefined,
		getObjectBytes: async () => null,
		getObjectText: async () => null,
		headObject: async () => null,
		objectExists: async () => false,
		listAllKeys: async () => [],
		listFolder: async () => ({ folders: [], files: [] }),
		listObjects: async () => ({ objects: [], folders: [] }),
		putObjectBytes: async () => '"e"',
		jsonBaseEtag: () => undefined,
		formBaseEtag: () => undefined,
		presignGet: async () => '',
		presignPut: async () => '',
		presignManifestEntries: async (entries: unknown) => entries,
		getObjectStream: async () => null,
	},
});

const LIB = new URL('../../../packages/engine-layout/src/lib/', import.meta.url);
const R = await import('../../../packages/engine-layout/src/lib/repeaterCount.ts');
const T = await import('../../../packages/engine-layout/src/lib/types.ts');
const C = await import('../../../packages/engine-layout/src/lib/builtinComponents.ts');
const B = await import('../../../packages/engine-layout/src/lib/builtinTimelines.ts');
const L = await import('../../../packages/engine-layout/src/lib/componentTimelines.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const I = await import('../../../packages/engine-layout/src/lib/componentInterface.ts');
const P = await import('../../../packages/engine-layout/src/lib/componentParams.ts');
const V = await import('../../../packages/engine-layout/src/lib/valueBindings.ts');
const K = await import('../../../packages/engine-layout/src/lib/collectComponentIds.ts');
const { getFullSceneSet } =
	await import('../../../packages/engine-layout/src/lib/referenceLayouts/index.ts');
const { getTemplate, listTemplateGameTypes } =
	await import('../../../packages/engine-layout/src/lib/templates/index.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const { LAYOUT_NODE_FIELDS } = await import('../src/lib/server/componentFields.ts');
const { projectContainerEvents } = await import('../src/lib/flowV2Projection.ts');

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

const BAR = C.SEGMENTED_COUNTER_DEF;
const SEGMENT = C.SEGMENTED_COUNTER_SEGMENT_DEF;
const barRepeater = BAR.root.children.find((n) => n.kind === 'repeater') as RepeaterNode;
const repeater = (over: Partial<RepeaterNode> = {}): RepeaterNode => ({
	id: 'r',
	kind: 'repeater',
	x: 0,
	y: 0,
	source: '',
	componentId: 'seg',
	layout: { direction: 'row', gap: 6 },
	count: { preview: 3 },
	...over,
});

// ---- 1. N --------------------------------------------------------------------------------------

{
	const node = repeater({ count: { source: 'respinsStart', preview: 3 } });
	eq(
		'N follows the value it reads: 3 → 5 → 0',
		[3, 5, 0].map((v) => R.repeaterCount(node, v)),
		[3, 5, 0],
	);
	eq(
		'rounded, clamped at 0; a numeric string and a boolean read as numbers; anything else is 0',
		[2.4, 2.6, -4, '4', true, 'x', undefined, NaN, Infinity].map((v) => R.repeaterCount(node, v)),
		[2, 3, 0, 4, 1, 0, 0, 0, 0],
	);
	eq('no count ⇒ 0', R.repeaterCount(repeater({ count: undefined }), 3), 0);
	eq(
		'the cap: 999 ⇒ the default 20; max 7 ⇒ 7; max 999 ⇒ the hard 50; max 0 ⇒ 1, as the normalizer stores it',
		[
			R.repeaterCount(node, 999),
			R.repeaterCount(repeater({ count: { preview: 0, max: 7 } }), 999),
			R.repeaterCount(repeater({ count: { preview: 0, max: 999 } }), 999),
			R.repeaterCount(repeater({ count: { preview: 0, max: 0 } }), 999),
		],
		[T.REPEATER_COUNT_DEFAULT_MAX, 7, T.REPEATER_COUNT_HARD_MAX, 1],
	);
	eq('the constants', [T.REPEATER_COUNT_DEFAULT_MAX, T.REPEATER_COUNT_HARD_MAX], [20, 50]);
	eq(
		'a source-list repeater is not count mode',
		R.isCountRepeater(repeater({ count: undefined })),
		false,
	);
	eq('…a count-mode one is', R.isCountRepeater(barRepeater), true);
}

// ---- 2. variants -------------------------------------------------------------------------------

{
	const node = repeater({ variants: { first: 'capL', middle: 'mid', last: 'capR' } });
	const pick = (n: number): string[] =>
		Array.from({ length: n }, (_, i) => R.repeaterSegmentComponent(node, i, n));
	eq('N = 1: the first only', pick(1), ['capL']);
	eq('N = 2: first, last', pick(2), ['capL', 'capR']);
	eq('N = 3: first, middle, last', pick(3), ['capL', 'mid', 'capR']);
	const partial = repeater({ variants: { last: 'capR' } });
	eq(
		'an unset variant falls back to the componentId',
		[0, 1, 2].map((i) => R.repeaterSegmentComponent(partial, i, 3)),
		['seg', 'seg', 'capR'],
	);
	eq(
		'…and first / last to middle when only middle is set',
		[0, 1].map((i) => R.repeaterSegmentComponent(repeater({ variants: { middle: 'm' } }), i, 2)),
		['m', 'm'],
	);
	eq('every component a node can draw', R.repeaterComponentIds(node), [
		'seg',
		'capL',
		'mid',
		'capR',
	]);
	eq(
		'a source-list node draws its componentId only, variants or not',
		R.repeaterComponentIds(repeater({ count: undefined, variants: { first: 'x' } })),
		['seg'],
	);
}

// ---- 3. geometry -------------------------------------------------------------------------------

{
	const sizes: Record<string, { width: number; height: number }> = {
		seg: { width: 80, height: 56 },
		capL: { width: 100, height: 60 },
		capR: { width: 90, height: 50 },
	};
	const sizeOf = (id: string) => sizes[id] ?? null;
	const row = repeater({ variants: { first: 'capL', last: 'capR' } });
	eq('a row lays segments end to end by their own widths', R.repeaterCountOffsets(row, 3, sizeOf), {
		offsets: [
			{ x: 0, y: 0 },
			{ x: 106, y: 0 },
			{ x: 192, y: 0 },
		],
		width: 282,
		height: 60,
	});
	const column = repeater({ layout: { direction: 'column', gap: 4 } });
	eq('a column along +y', R.repeaterCountOffsets(column, 3, sizeOf), {
		offsets: [
			{ x: 0, y: 0 },
			{ x: 0, y: 60 },
			{ x: 0, y: 120 },
		],
		width: 80,
		height: 176,
	});
	const grid = repeater({ layout: { direction: 'grid', gap: 10, columns: 2 } });
	eq('a grid keeps the node’s pitch', R.repeaterCountOffsets(grid, 3, sizeOf), {
		offsets: [
			{ x: 0, y: 0 },
			{ x: 90, y: 0 },
			{ x: 0, y: 66 },
		],
		width: 170,
		height: 122,
	});
	eq('N = 0 draws nothing', R.repeaterCountOffsets(row, 0, sizeOf), {
		offsets: [],
		width: 0,
		height: 0,
	});
	eq(
		'an unsizable component counts as 0 × 0',
		R.repeaterCountOffsets(repeater({ componentId: 'none' }), 2, sizeOf).offsets,
		[
			{ x: 0, y: 0 },
			{ x: 6, y: 0 },
		],
	);

	const rigOnly = (box?: { width?: number; height?: number }): ComponentDef => ({
		...SEGMENT,
		id: 'rigOnly',
		root: {
			id: 'rigOnly-root',
			kind: 'container',
			x: 0,
			y: 0,
			...box,
			children: [
				{ id: 'tile', kind: 'spine', x: 0, y: 0, assetKey: 'tile' } as LayoutNode,
				{ id: 'n', kind: 'text', x: 0, y: 0, text: '1' } as LayoutNode,
			],
		},
	});
	eq(
		'a segment drawn from a rig and a text measures nothing',
		R.repeaterSegmentSize(rigOnly(), 'desktop'),
		null,
	);
	eq(
		'…its root box (the Component Editor’s Size) is its size',
		R.repeaterSegmentSize(rigOnly({ width: 160, height: 120 }), 'desktop'),
		{ width: 160, height: 120 },
	);
	eq(
		'…only both sides count (one side alone is measured as before)',
		R.repeaterSegmentSize(rigOnly({ width: 160 }), 'desktop'),
		null,
	);
	eq(
		'…and a side that is not a finite positive number does not count',
		R.repeaterSegmentSize(rigOnly({ width: Infinity, height: 120 }), 'desktop'),
		null,
	);
	const starter = R.repeaterSegmentSize(SEGMENT, 'desktop');
	eq(
		'a segment with no box is measured from what it draws, as before',
		[starter?.width, starter?.height],
		[80, 56],
	);
	eq(
		'…and a box wins over what it draws',
		R.repeaterSegmentSize(
			{ ...SEGMENT, root: { ...SEGMENT.root, width: 100, height: 70 } },
			'desktop',
		),
		{ width: 100, height: 70 },
	);
}

// ---- 4. what each segment is handed ------------------------------------------------------------

eq(
	'index (1-based) and count',
	[0, 1, 2].map((i) => R.repeaterSegmentValues(i, 3)),
	[
		{ index: 1, count: 3 },
		{ index: 2, count: 3 },
		{ index: 3, count: 3 },
	],
);
eq(
	'…as params the segment resolves (and its state machine compares against)',
	P.resolveComponentParams(SEGMENT, R.repeaterSegmentValues(1, 5)),
	{
		index: 2,
		count: 5,
		litColor: 0xf5a623,
		unlitColor: 0x5a1414,
		labelColor: 0xffffff,
	},
);
eq(
	'the bar’s templates expand to whole source names',
	[
		V.expandSourceTemplate(barRepeater.count?.source ?? '', P.resolveComponentParams(BAR, {})),
		V.expandSourceTemplate(barRepeater.passInputs?.value ?? '', P.resolveComponentParams(BAR, {})),
		V.expandSourceTemplate(
			barRepeater.passInputs?.value ?? '',
			P.resolveComponentParams(BAR, { valueSource: 'freeSpinsLeft' }),
		),
	],
	['respinsStart', 'respinsLeft', 'freeSpinsLeft'],
);

// ---- 5. the starter's state machine ------------------------------------------------------------

L.registerComponentTimelines(B.BUILTIN_TIMELINES);
{
	const { docs, durations } = L.instanceTimelineDocs(SEGMENT.id, SEGMENT.stateMachine);
	eq(
		'its two timelines are built in and resolve',
		docs.map((d: CinematicDoc) => d.id).sort(),
		[C.SEGMENTED_COUNTER_LIT_TIMELINE_ID, C.SEGMENTED_COUNTER_UNLIT_TIMELINE_ID].sort(),
	);
	eq(
		'timeline ids are lower-case, hosted on the segment',
		docs.every(
			(d: CinematicDoc) =>
				d.id === d.id.toLowerCase() &&
				d.host?.kind === 'component' &&
				d.host.componentId === SEGMENT.id,
		),
		true,
	);
	eq(
		'the machine validates clean',
		M.validateStateMachine(SEGMENT, new Set(docs.map((d: CinematicDoc) => d.id))),
		[],
	);
	const nodeIdOf = (label: string): string => {
		const found = (SEGMENT.root.children as LayoutNode[]).find((n) => n.label === label);
		return found?.id ?? '';
	};
	for (const n of [3, 5]) {
		const states: string[][] = [];
		const poses: (number | undefined)[][] = [];
		for (let left = 0; left <= n; left++) {
			const row: string[] = [];
			const pose: (number | undefined)[] = [];
			for (let i = 0; i < n; i++) {
				const params = P.resolveComponentParams(SEGMENT, R.repeaterSegmentValues(i, n));
				const runner = new M.ComponentStateMachineRunner(
					SEGMENT.stateMachine!,
					I.componentInputs(SEGMENT),
					durations,
					(key: string) => params[key],
				);
				runner.setInput(C.SEGMENTED_COUNTER_VALUE_INPUT, left);
				runner.advance(1 / 60);
				const player = new L.ComponentTimelinePlayer(docs, SEGMENT.root.children, () => params);
				runner.plays().forEach((play, layer) => player.drive(play.layer, layer, play));
				row.push(runner.plays()[0].state);
				pose.push(player.sample(nodeIdOf('lit'))?.alpha, player.sample(nodeIdOf('unlit'))?.alpha);
			}
			states.push(row);
			poses.push(pose);
		}
		eq(
			`N = ${n}: segment k is Lit exactly when left >= k, for left = 0..${n}`,
			states,
			Array.from({ length: n + 1 }, (_, left) =>
				Array.from({ length: n }, (_, i) => (left >= i + 1 ? 'Lit' : 'Unlit')),
			),
		);
		eq(
			`N = ${n}: the player shows lit / hides unlit in Lit, and the reverse`,
			poses,
			Array.from({ length: n + 1 }, (_, left) =>
				Array.from({ length: n }, (_, i) => (left >= i + 1 ? [1, 0] : [0, 1])).flat(),
			),
		);
	}
	const params = P.resolveComponentParams(SEGMENT, R.repeaterSegmentValues(1, 3));
	const runner = new M.ComponentStateMachineRunner(
		SEGMENT.stateMachine!,
		I.componentInputs(SEGMENT),
		durations,
		(key: string) => params[key],
	);
	runner.setInput('value', 3);
	runner.advance(1 / 60);
	const trail = [runner.plays()[0].state];
	for (const left of [2, 1, 0, 3]) {
		runner.setInput('value', left);
		runner.advance(1 / 60);
		trail.push(runner.plays()[0].state);
	}
	eq('segment 2 follows the count down and back up', trail, [
		'Lit',
		'Lit',
		'Unlit',
		'Unlit',
		'Lit',
	]);
}

// ---- 6. what saves -----------------------------------------------------------------------------

{
	const asDef = (root: LayoutNode[]): ComponentDef => ({
		id: 'probe',
		name: 'Probe',
		version: 1,
		scope: 'project',
		category: 'ui',
		root: { id: 'probe-root', kind: 'container', x: 0, y: 0, children: root },
	});
	const boxed = normalizeComponent({
		...asDef([]),
		root: { ...asDef([]).root, width: 160, height: 120 },
	} as ComponentDef);
	eq(
		'a root box (Size) survives the normalizer',
		[boxed.root.width, boxed.root.height],
		[160, 120],
	);
	const once = normalizeComponent(structuredClone({ ...BAR, scope: 'project' }) as ComponentDef);
	const kept = once.root.children.find((n) => n.kind === 'repeater') as RepeaterNode;
	eq(
		'the starter’s count fields survive the normalizer',
		[kept.count, kept.variants, kept.passInputs, kept.previewInputs],
		[barRepeater.count, undefined, barRepeater.passInputs, barRepeater.previewInputs],
	);
	const bytes = JSON.stringify(once, null, 2);
	eq(
		'…and a second pass over the stored JSON is byte-identical',
		JSON.stringify(normalizeComponent(JSON.parse(bytes) as ComponentDef), null, 2),
		bytes,
	);
	const plain = repeater({ count: undefined });
	const normalizedPlain = normalizeComponent(asDef([plain]));
	eq(
		'a source-list repeater is the same object (absent stays absent)',
		normalizedPlain.root.children[0] === plain,
		true,
	);
	eq(
		'…its JSON unchanged',
		JSON.stringify(normalizedPlain.root.children[0]),
		JSON.stringify(repeater({ count: undefined })),
	);
	const full = repeater({
		count: { source: 'freeSpinsTotal', preview: 4, max: 10 },
		variants: { first: 'capL', middle: 'mid', last: 'capR' },
		passInputs: { value: 'freeSpinsLeft' },
		previewInputs: { value: 2 },
	});
	eq(
		'a clean count-mode node is the same object',
		normalizeComponent(asDef([full])).root.children[0] === full,
		true,
	);
	const read = (node: Record<string, unknown>): Record<string, unknown> =>
		normalizeComponent(asDef([node as unknown as LayoutNode])).root
			.children[0] as unknown as Record<string, unknown>;
	const dirty = read({
		...repeater(),
		count: { source: '  ', preview: 2.6, max: 999 },
		variants: { first: '', middle: 3, last: 'capR' },
		passInputs: { value: '', other: 5, ok: 'respinsLeft' },
		previewInputs: { value: Infinity, y: 2, z: 'x' },
	});
	eq(
		'malformed values drop: a blank source, an out-of-range preview and max are rounded and clamped',
		[dirty.count, dirty.variants, dirty.passInputs, dirty.previewInputs],
		[{ preview: 3, max: 50 }, { last: 'capR' }, { ok: 'respinsLeft' }, { y: 2 }],
	);
	for (const [label, count] of [
		['NaN', { preview: NaN }],
		['a string', 'three'],
		['no preview', { source: 'respinsStart' }],
		['null', null],
	] as const) {
		const out = read({ ...repeater(), count });
		eq(`a count of ${label} drops whole (a source-list repeater)`, 'count' in out, false);
	}
	const emptied = read({ ...repeater(), variants: {}, passInputs: { a: '' }, previewInputs: [] });
	eq(
		'a field with nothing left drops',
		['variants', 'passInputs', 'previewInputs'].filter((k) => k in emptied),
		[],
	);
	const nested = normalizeComponent(
		asDef([
			{ id: 'g', kind: 'container', x: 0, y: 0, children: [{ ...repeater(), count: 'x' }] },
		] as unknown as LayoutNode[]),
	);
	eq(
		'a repeater inside a group is read too',
		'count' in ((nested.root.children[0] as { children: LayoutNode[] }).children[0] as object),
		false,
	);
	eq(
		'the launcher knows the four fields (a save does not graft them back)',
		['count', 'variants', 'passInputs', 'previewInputs'].map((f) => LAYOUT_NODE_FIELDS.has(f)),
		[true, true, true, true],
	);
}

// ---- 7. the ship chain -------------------------------------------------------------------------

{
	const placed: LayoutNode[] = [
		{ id: 'bar', kind: 'componentInstance', x: 0, y: 0, componentId: BAR.id },
	];
	const builtins = new Map(C.BUILTIN_COMPONENTS.map((d) => [d.id, d]));
	const closure = await K.resolveComponentClosure(placed, async (id) => builtins.get(id));
	eq('the closure of a scene placing the bar ships the segment', Object.keys(closure), [
		BAR.id,
		SEGMENT.id,
	]);
	const capped: ComponentDef = {
		...BAR,
		id: 'cappedBar',
		root: {
			...BAR.root,
			children: BAR.root.children.map((n) =>
				n.kind === 'repeater' ? { ...n, variants: { first: 'capL', last: 'capR' } } : n,
			),
		},
	};
	const caps = (id: string): ComponentDef => ({ ...SEGMENT, id });
	const defs = new Map<string, ComponentDef>([
		...builtins,
		['cappedBar', capped],
		['capL', caps('capL')],
		['capR', caps('capR')],
	]);
	const cappedClosure = await K.resolveComponentClosure(
		[{ id: 'bar', kind: 'componentInstance', x: 0, y: 0, componentId: 'cappedBar' }],
		async (id) => defs.get(id),
	);
	eq(
		'…and every variant',
		Object.keys(cappedClosure).sort(),
		['cappedBar', 'capL', 'capR', SEGMENT.id].sort(),
	);
	eq(
		'collectComponentIds over the bar’s own root names the segment and its variants',
		K.collectComponentIds([capped.root]),
		[SEGMENT.id, 'capL', 'capR'],
	);
	eq(
		'a source-list repeater ships its componentId, as before',
		K.collectComponentIds([repeater({ count: undefined, componentId: 'card' })]),
		['card'],
	);
	const scene = (nodes: LayoutNode[]): Scene => ({ id: 's', name: 's', nodes });
	const events = projectContainerEvents(
		[{ id: 'c', sceneId: 's' }] as Parameters<typeof projectContainerEvents>[0],
		[scene([repeater({ id: 'counter' }), repeater({ id: 'cards', count: undefined })])],
	);
	eq(
		'Flow projects onSelect for the source-list repeater only',
		(events.c ?? []).map((e) => e.componentId).filter((id, i, all) => all.indexOf(id) === i),
		['cards'],
	);
}

// ---- 8. offered, placed by nobody --------------------------------------------------------------

{
	const ids = [BAR.id, SEGMENT.id];
	eq(
		'both are built in, ungated',
		ids.map((id) => {
			const def = C.BUILTIN_COMPONENTS.find((d) => d.id === id);
			return [def?.scope, def?.category, def?.capability, def?.internal];
		}),
		[
			['shared', 'ui', undefined, undefined],
			['shared', 'ui', undefined, undefined],
		],
	);
	eq(
		'offered to every kind',
		['lines', 'bookOf', 'ways', 'cluster', 'scatter', 'holdAndWin', undefined].every(
			(kind) => C.componentOfferedForKind(BAR, kind) && C.componentOfferedForKind(SEGMENT, kind),
		),
		true,
	);
	const names = (value: unknown): boolean =>
		ids.some((id) => JSON.stringify(value ?? null).includes(`"${id}"`));
	const kinds = ['lines', 'bookOf', 'ways', 'cluster', 'scatter', 'holdAndWin'];
	eq(
		'no scene set places them',
		kinds.filter((kind) => names(getFullSceneSet(kind))),
		[],
	);
	eq(
		'no template places them',
		listTemplateGameTypes().filter((kind: string) => names(getTemplate(kind))),
		[],
	);
	const defsPlacing = C.BUILTIN_COMPONENTS.filter(
		(d) => d.id !== BAR.id && K.collectComponentIds([d.root]).some((id) => ids.includes(id)),
	).map((d) => d.id);
	eq('no other built-in nests them', defsPlacing, []);
}

/** A value source the test drives: emits on subscribe, then on every `set`. */
function store(initial: number): ValueSource & { set: (v: number) => void } {
	let value = initial;
	const runs = new Set<(v: number | string) => void>();
	return {
		subscribe(run) {
			runs.add(run);
			run(value);
			return () => void runs.delete(run);
		},
		set(v) {
			value = v;
			for (const run of [...runs]) run(v);
		},
	};
}

/**
 * The real components, bundled by Vite with the Svelte plugin (the compile SvelteKit runs), on a
 * DOM just big enough for Svelte's anchors, inside the contexts a `<LayoutScene>` provides.
 */
async function mounted(): Promise<void> {
	installDom();
	const dir = mkdtempSync(
		join(fileURLToPath(new URL('../node_modules/', import.meta.url)), '.repeat-segments-'),
	);
	process.on('exit', () => rmSync(dir, { recursive: true, force: true }));
	const lib = (file: string): string => fileURLToPath(new URL(file, LIB));
	const entry = join(dir, 'entry.ts');
	writeFileSync(
		entry,
		`import { onMount } from 'svelte';
export { mount, flushSync, unmount } from 'svelte';
export { default as ComponentInstance } from '${lib('ComponentInstance.svelte')}';
export * as E from '${lib('index.ts')}';
export { Container, Graphics, Text, Ticker } from 'pixi.js';
export const parentContext = (parent) => {
	const context = {
		parent,
		addToParent: (node) => {
			onMount(() => {
				context.parent.addChild(node);
				context.parent.sortChildren();
				return () => node.destroy();
			});
		},
	};
	return context;
};
`,
	);
	const { build } = await import('vite');
	const { svelte } = await import('@sveltejs/vite-plugin-svelte');
	await build({
		configFile: false,
		logLevel: 'error',
		root: dir,
		plugins: [svelte({ configFile: false, onwarn: () => undefined })],
		resolve: { conditions: ['svelte', 'browser'] },
		build: {
			outDir: join(dir, 'out'),
			emptyOutDir: true,
			minify: false,
			reportCompressedSize: false,
			lib: { entry, formats: ['es'], fileName: 'mount' },
		},
	});
	const H = (await import(pathToFileURL(join(dir, 'out', 'mount.js')).href)) as MountBundle;
	const { E } = H;

	const ticker = new H.Ticker();
	ticker.autoStart = false;
	ticker.stop();
	let now = 0;
	const step = (frames = 3): void => {
		for (let i = 0; i < frames; i++) {
			now += 16;
			ticker.update(now);
			H.flushSync();
		}
	};

	const respinsStart = store(3);
	const respinsLeft = store(3);
	const probeValue = store(9);
	const byId = (defs: ComponentDef[]) => Object.fromEntries(defs.map((d) => [d.id, d]));
	E.registerComponents(byId(E.BUILTIN_COMPONENTS), { builtin: true });
	E.registerComponentTimelines([...E.BUILTIN_TIMELINES, ...PROBE_TIMELINES]);
	E.registerComponents(byId([PROBE_SEGMENT, PROBE_BAR, WIDGET]));
	E.registerComponentValues({ respinsStart, respinsLeft, probeValue });

	const mountInstance = (node: LayoutNode) => {
		const stage = new H.Container();
		const context = new Map<string, unknown>([
			[
				'@@pixi_svelte',
				{ stateApp: { pixiApplication: { ticker }, loadedAssets: {}, loaded: true, assets: {} } },
			],
			['@@pixi_parent', H.parentContext(stage)],
			[
				'@@layout',
				{
					stateLayoutDerived: {
						layoutType: () => 'desktop',
						canvasSizes: () => ({ width: 1920, height: 1080 }),
						mainLayout: () => ({ width: 1920, height: 1080, scale: 1, x: 0, y: 0 }),
						mainLayoutStandard: () => ({ width: 1920, height: 1080, scale: 1, x: 0, y: 0 }),
						canvasRatioType: () => 'landscape',
						isStacked: () => false,
					},
					stateLayout: { canvasSizes: { width: 1920, height: 1080 } },
				},
			],
		]);
		const app = H.mount(H.ComponentInstance, {
			target: document.createElement('div'),
			props: { node },
			context,
		});
		H.flushSync();
		step();
		return { stage, app };
	};

	try {
		const bar = mountInstance({
			id: 'bar',
			kind: 'componentInstance',
			x: 0,
			y: 0,
			componentId: BAR.id,
		});
		const read = () => segmentsOf(bar.stage, H);
		eq(
			'the bar fed respinsStart = 3 draws 3 segments, numbered 1..3',
			read().map((s) => s.label),
			['1', '2', '3'],
		);
		eq(
			'3 left: all three lit',
			read().map((s) => s.lit),
			[true, true, true],
		);
		eq(
			'the row is centred on the bar (anchor 0.5): 3 × 80 + 2 × 6 wide',
			read().map((s) => s.x),
			[-126, -40, 46],
		);
		respinsLeft.set(1);
		H.flushSync();
		step();
		eq(
			'1 left: only segment 1 lit, 2 and 3 dark',
			read().map((s) => s.lit),
			[true, false, false],
		);
		respinsStart.set(5);
		respinsLeft.set(5);
		H.flushSync();
		step();
		eq(
			'the start goes to 5: 5 segments, all lit',
			read().map((s) => `${s.label}:${s.lit}`),
			['1:true', '2:true', '3:true', '4:true', '5:true'],
		);
		respinsLeft.set(2);
		H.flushSync();
		step();
		eq(
			'2 of 5 left',
			read().map((s) => s.lit),
			[true, true, false, false, false],
		);
		respinsStart.set(0);
		H.flushSync();
		step();
		eq('a start of 0 draws none', read().length, 0);
		H.unmount(bar.app);

		// A segment drawn only from a rig and its number: with a root box the row steps by it; the
		// rig draws nothing here (no asset), so each segment reads by its number.
		const tiles = (box?: { width: number; height: number }): ComponentDef[] => {
			const tile: ComponentDef = {
				...SEGMENT,
				id: 'tileSegment',
				root: {
					id: 'tile-root',
					kind: 'container',
					x: 0,
					y: 0,
					...box,
					children: [
						{ id: 'tile-rig', kind: 'spine', x: 0, y: 0, assetKey: 'tile' } as LayoutNode,
						{
							id: 'tile-number',
							kind: 'text',
							x: 0,
							y: 0,
							text: '1',
							paramBindings: { text: 'index' },
						},
					],
				},
			};
			const tileBar: ComponentDef = {
				...BAR,
				id: 'tileBar',
				root: {
					...BAR.root,
					children: BAR.root.children.map((n) =>
						n.kind === 'repeater' ? { ...n, componentId: tile.id } : n,
					),
				},
			};
			return [tile, tileBar];
		};
		const numbersAt = (box?: { width: number; height: number }) => {
			E.registerComponents(byId(tiles(box)));
			const bar = mountInstance({
				id: 'tiles',
				kind: 'componentInstance',
				x: 0,
				y: 0,
				componentId: 'tileBar',
			});
			const out: [string | undefined, number][] = [];
			walk(bar.stage, (n) => {
				if (n instanceof H.Text) out.push([n.text, Math.round(globalX(n))]);
			});
			H.unmount(bar.app);
			return out.sort((a, b) => a[1] - b[1]);
		};
		respinsStart.set(3);
		respinsLeft.set(3);
		eq('rig-only segments with no box stack, 6 px apart (as before)', numbersAt(), [
			['1', -6],
			['2', 0],
			['3', 6],
		]);
		eq(
			'…with a 160 × 120 box they step by it, centred on the bar',
			numbersAt({ width: 160, height: 120 }),
			[
				['1', -246],
				['2', -80],
				['3', 86],
			],
		);
		respinsStart.set(3);
		respinsLeft.set(3);
		const widget = mountInstance({
			id: 'widget',
			kind: 'componentInstance',
			x: 0,
			y: 0,
			componentId: WIDGET.id,
		});
		eq(
			'a bar inside a component (screen → widget → bar → segment) draws its 3 segments, at its place in the widget',
			segmentsOf(widget.stage, H).map((s) => `${s.label}:${s.x}`),
			['1:-86', '2:0', '3:86'],
		);
		H.unmount(widget.app);

		const probe = mountInstance({
			id: 'probe',
			kind: 'componentInstance',
			x: 0,
			y: 0,
			componentId: PROBE_BAR.id,
		});
		eq(
			'a segment declaring index / count inputs holds the repeater’s constants, over a passInputs entry for index',
			probeStates(probe.stage, H),
			['first', 'middle', 'last'],
		);
		H.unmount(probe.app);

		probeValue.set(1);
		const lone = mountInstance({
			id: 'lone',
			kind: 'componentInstance',
			x: 0,
			y: 0,
			componentId: PROBE_SEGMENT.id,
		});
		eq(
			'an instance outside a repeater keeps its own input source (probeValue = 1 ⇒ first)',
			probeStates(lone.stage, H),
			['first'],
		);
		H.unmount(lone.app);
	} catch (error) {
		failures++;
		console.error('✗ the mount threw', error);
	}
}

type PixiNode = {
	children: PixiNode[];
	parent: PixiNode | null;
	x: number;
	y: number;
	alpha: number;
	visible: boolean;
	text?: string;
	context?: { instructions: { action: string; data: { style: { color: number } } }[] };
};

interface MountBundle {
	mount: (component: unknown, options: Record<string, unknown>) => Record<string, unknown>;
	unmount: (app: Record<string, unknown>) => void;
	flushSync: () => void;
	ComponentInstance: unknown;
	E: typeof import('engine-layout');
	Container: new () => PixiNode;
	Graphics: new () => PixiNode;
	Text: new () => PixiNode;
	Ticker: new () => {
		autoStart: boolean;
		stop: () => void;
		update: (time: number) => void;
	};
	parentContext: (parent: PixiNode) => unknown;
}

const walk = (node: PixiNode, visit: (n: PixiNode) => void): void => {
	visit(node);
	for (const child of node.children) walk(child, visit);
};
const shown = (node: PixiNode): boolean => {
	for (let n: PixiNode | null = node; n; n = n.parent)
		if (!n.visible || n.alpha === 0) return false;
	return true;
};
const globalX = (node: PixiNode): number => {
	let x = 0;
	for (let n: PixiNode | null = node; n; n = n.parent) x += n.x;
	return x;
};
const fillOf = (node: PixiNode): number | undefined =>
	node.context?.instructions.find((i) => i.action === 'fill')?.data.style.color;

/** Each drawn segment, left to right: its number, whether its lit fill shows, its left edge. */
function segmentsOf(stage: PixiNode, H: MountBundle) {
	const lit: PixiNode[] = [];
	const unlit: PixiNode[] = [];
	const labels: PixiNode[] = [];
	walk(stage, (n) => {
		if (n instanceof H.Graphics && fillOf(n) === 0xf5a623) lit.push(n);
		if (n instanceof H.Graphics && fillOf(n) === 0x5a1414) unlit.push(n);
		if (n instanceof H.Text) labels.push(n);
	});
	const byX = (a: PixiNode, b: PixiNode) => globalX(a) - globalX(b);
	lit.sort(byX);
	unlit.sort(byX);
	labels.sort(byX);
	if (lit.length !== unlit.length || lit.length !== labels.length) {
		return [{ label: `mismatch ${lit.length}/${unlit.length}/${labels.length}`, lit: false, x: 0 }];
	}
	return lit.map((node, i) => ({
		label: labels[i].text,
		lit: shown(node) && !shown(unlit[i]),
		x: globalX(node),
	}));
}

/** The probe segments' shown state markers, left to right. */
function probeStates(stage: PixiNode, H: MountBundle): string[] {
	const out: { x: number; state: string }[] = [];
	walk(stage, (n) => {
		if (!(n instanceof H.Graphics) || !shown(n)) return;
		const state = PROBE_COLORS[fillOf(n) ?? -1];
		if (state) out.push({ x: globalX(n), state });
	});
	return out.sort((a, b) => a.x - b.x).map((s) => s.state);
}

// A probe segment whose machine reads `index` and `count` as INPUTS: `first` when index == 1, `last`
// when index reaches the `count` param and the count input is 3, else `middle`. Were the repeater's
// constants not held, `index` would follow the `passInputs` entry (`probeValue` = 9) and `count`
// keep its default 9: every segment would stay `middle`.
const PROBE_COLORS: Record<number, string> = {
	0x111111: 'first',
	0x222222: 'middle',
	0x333333: 'last',
};
const PROBE_POSES = ['first', 'middle', 'last'] as const;
const probeTimelineId = (pose: string): string => `c_probesegment_${pose}`;
const PROBE_TIMELINES: CinematicDoc[] = PROBE_POSES.map(
	(pose) =>
		({
			schemaVersion: 1,
			id: probeTimelineId(pose),
			name: pose,
			duration: 1,
			fps: 60,
			markers: [],
			host: { kind: 'component', componentId: 'probeSegment' },
			stage: {
				sceneId: null,
				cast: PROBE_POSES.map((p) => ({ actorId: p, kind: 'node', target: p, place: {} })),
			},
			tracks: PROBE_POSES.map((p) => ({
				id: `${p}-alpha`,
				kind: 'property',
				actorId: p,
				channels: { alpha: [{ time: 0, value: p === pose ? 1 : 0 }] },
			})),
		}) as unknown as CinematicDoc,
);
const PROBE_SEGMENT: ComponentDef = {
	id: 'probeSegment',
	name: 'Probe segment',
	version: 1,
	scope: 'project',
	category: 'ui',
	root: {
		id: 'probe-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: PROBE_POSES.map((pose, i) => ({
			id: `probe-${pose}`,
			label: pose,
			kind: 'rect',
			x: 0,
			y: 0,
			anchor: { x: 0, y: 0 },
			alpha: 1,
			width: 40,
			height: 40,
			color: 0x111111 * (i + 1),
		})),
	},
	inputs: [
		{ id: 'index', kind: 'number', default: 0, source: 'probeValue' },
		{ id: 'count', kind: 'number', default: 9 },
	],
	stateMachine: {
		layers: [
			{
				id: 'pose',
				entry: 'middle',
				states: PROBE_POSES.map((pose) => ({ id: pose, timeline: probeTimelineId(pose) })),
				transitions: [
					{
						id: 'to-first',
						from: 'any',
						to: 'first',
						conditions: [{ input: 'index', op: '==', value: 1 }],
					},
					{
						id: 'to-last',
						from: 'any',
						to: 'last',
						conditions: [
							{ input: 'index', op: '!=', value: 1 },
							{ input: 'index', op: '>=', param: 'count' },
							{ input: 'count', op: '==', value: 3 },
						],
					},
				],
			},
		],
	},
};
/** The TOTAL WIN widget's shape: a Segmented Counter placed inside an author's component. */
const WIDGET: ComponentDef = {
	id: 'probeTotalWinWidget',
	name: 'Total win widget',
	version: 1,
	scope: 'project',
	category: 'ui',
	root: {
		id: 'probeTotalWinWidget-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'probeTotalWinWidget-counter',
				kind: 'componentInstance',
				componentId: C.SEGMENTED_COUNTER_ID,
				x: 40,
				y: 220,
			},
		],
	},
	params: [],
};

const PROBE_BAR: ComponentDef = {
	id: 'probeBar',
	name: 'Probe bar',
	version: 1,
	scope: 'project',
	category: 'ui',
	root: {
		id: 'probeBar-root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [
			{
				id: 'probeBar-segments',
				kind: 'repeater',
				x: 0,
				y: 0,
				source: '',
				componentId: PROBE_SEGMENT.id,
				layout: { direction: 'row', gap: 10 },
				count: { preview: 3 },
				passInputs: { index: 'probeValue' },
			},
		],
	},
};

/**
 * The DOM Svelte's anchors need: a tree of nodes, nothing rendered. A `<template>` parses the only
 * markup a Pixi-only component compiles to — comment anchors and text — and refuses any element.
 */
function installDom(): void {
	class Node {
		parentNode: Node | null = null;
		childNodes: Node[] = [];
		nodeType = 1;
		get firstChild() {
			return this.childNodes[0] ?? null;
		}
		get lastChild() {
			return this.childNodes.at(-1) ?? null;
		}
		get nextSibling(): Node | null {
			const siblings = this.parentNode?.childNodes;
			return siblings ? (siblings[siblings.indexOf(this) + 1] ?? null) : null;
		}
		insertBefore(node: Node, ref: Node | null) {
			const nodes = node instanceof DocumentFragment ? [...node.childNodes] : [node];
			for (const child of nodes) {
				child.remove();
				const at = ref ? this.childNodes.indexOf(ref) : -1;
				this.childNodes.splice(at < 0 ? this.childNodes.length : at, 0, child);
				child.parentNode = this;
			}
			return node;
		}
		appendChild(node: Node) {
			return this.insertBefore(node, null);
		}
		append(...nodes: Node[]) {
			for (const node of nodes) this.insertBefore(node, null);
		}
		removeChild(node: Node) {
			node.remove();
			return node;
		}
		replaceWith(node: Node) {
			this.parentNode?.insertBefore(node, this);
			this.remove();
		}
		before(...nodes: Node[]) {
			for (const node of nodes) this.parentNode?.insertBefore(node, this);
		}
		after(...nodes: Node[]) {
			const next = this.nextSibling;
			for (const node of nodes) this.parentNode?.insertBefore(node, next);
		}
		remove() {
			const siblings = this.parentNode?.childNodes;
			if (siblings) siblings.splice(siblings.indexOf(this), 1);
			this.parentNode = null;
		}
		cloneNode(deep = false): Node {
			const copy = this.copy();
			if (deep) for (const child of this.childNodes) copy.appendChild(child.cloneNode(true));
			return copy;
		}
		copy(): Node {
			return new (this.constructor as new () => Node)();
		}
		set textContent(_: string) {
			for (const child of [...this.childNodes]) child.remove();
		}
		addEventListener() {}
		removeEventListener() {}
	}
	class Element extends Node {}
	class DocumentFragment extends Node {
		nodeType = 11;
	}
	class CharacterData extends Node {
		constructor(public data = '') {
			super();
		}
		get nodeValue() {
			return this.data;
		}
		set nodeValue(value: string) {
			this.data = value;
		}
		copy(): Node {
			return new (this.constructor as new (data: string) => Node)(this.data);
		}
	}
	class Text extends CharacterData {
		nodeType = 3;
	}
	class Comment extends CharacterData {
		nodeType = 8;
	}
	class Template extends Element {
		content = new DocumentFragment();
		set innerHTML(html: string) {
			this.content = new DocumentFragment();
			for (const [, comment, text] of html.matchAll(/<!--([\s\S]*?)-->|([^<]+)/g)) {
				this.content.appendChild(comment !== undefined ? new Comment(comment) : new Text(text));
			}
			if (html.replace(/<!--[\s\S]*?-->/g, '').includes('<'))
				throw new Error(`the DOM stand-in parses no elements: ${html}`);
		}
	}
	Object.assign(globalThis, {
		window: globalThis,
		Node,
		Element,
		Text,
		Comment,
		DocumentFragment,
		document: {
			createElement: (tag: string) => (tag === 'template' ? new Template() : new Element()),
			createTextNode: (data: string) => new Text(data),
			createComment: (data: string) => new Comment(data),
			createDocumentFragment: () => new DocumentFragment(),
			importNode: (node: Node, deep: boolean) => node.cloneNode(deep),
			addEventListener() {},
			removeEventListener() {},
		},
	});
}

// ---- 9. mounted for real -----------------------------------------------------------------------

await mounted();

console.log(
	`\n${failures === 0 ? '✅' : '❌'} component repeat segments: ${passes} passed, ${failures} failed`,
);
if (failures) process.exit(1);
