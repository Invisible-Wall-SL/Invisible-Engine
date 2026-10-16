/**
 * A nested component's params exposed on the component it sits in ("⇡ Expose on ‹parent›"):
 *   pnpm --filter launcher-api check:component-param-forwarding
 *
 * A nested instance's `paramBindings['params.<key>'] = '<parentKey>'` gives its `<key>` the
 * ENCLOSING instance's `<parentKey>`, a param the parent def declares — so each placement of the
 * parent sets it on a screen like any of its params.
 *
 *  1. the helper (`forwardInstanceParams`): the same map back when nothing is forwarded, the
 *     forwarded value over the instance's own, an `undefined` outer value skipped, chains;
 *  2. the runtime getters (`defineForwardedParams`): read at read time (a parent's per-ratio value
 *     follows), the instance's own while the parent's is undefined, a live feed still wins; the
 *     state machine's `{lightAt}` reads the forwarded value; `<ComponentInstance>`'s wiring and
 *     its no-forward branch (source-scanned — this gate cannot mount the Svelte component);
 *  3. the editor edits: expose (unique keys clear of reserved ones, the decl copied, the default
 *     the value shown now, groups kept per placement, a rig param's `spineParam` followed), link
 *     (same kind only), unlink (the parent param stays), Light order writing through a forward;
 *  4. a deleted parent param drops its forwards (`pruneOrphanParamBindings`), inside a part too;
 *  5. the save keeps forwards and drops one naming no param (`normalizeComponent`);
 *  6. a part param only a forward reads is still offered on a placement (`unusedPartParamKeys`);
 *  7. editor preview: a selection box sized by a forwarded param (`nodeBox`), on a screen and on
 *     the Components side, and every editor walker that expands an instance forwards (scanned);
 *  8. the localization harvest reads a forwarded text, nested text as deep as the game draws, and
 *     no deeper;
 *  9. ship (rule 8): the REAL `exportEditorArt` over an in-memory R2 ships the sheet and the rig a
 *     placement picks through the parent's exposed params, and the exposed default's sheet.
 *
 * What it cannot prove: the Properties rows and the canvas in a browser — the owner's pass
 * (`docs/status/component-editor.md`).
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import type {
	ComponentDef,
	ComponentInstanceNode,
	ComponentParam,
	ComponentStateMachine,
	ContainerNode,
	LayoutDoc,
	LayoutNode,
} from 'engine-layout';

interface Stored {
	text: string;
	modified: number;
}
const bucket = new Map<string, Stored>();
const under = (prefix: string) =>
	[...bucket.entries()]
		.filter(([key]) => key.startsWith(prefix))
		.map(([key, o]) => ({ key, size: o.text.length, lastModified: o.modified }));
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
mock.module(r2Url, {
	namedExports: {
		...(await import(r2Url)),
		getObjectText: async (key: string) => bucket.get(key)?.text ?? null,
		getObjectTextWithEtag: async (key: string) => {
			const o = bucket.get(key);
			return o ? { text: o.text, etag: null } : null;
		},
		getObjectBytes: async (key: string) => {
			const o = bucket.get(key);
			return o
				? { body: new TextEncoder().encode(o.text), contentType: 'application/json', etag: null }
				: null;
		},
		putObjectText: async (key: string, text: string) => {
			bucket.set(key, { text, modified: Date.now() });
		},
		copyObject: async (from: string, to: string) => {
			const o = bucket.get(from);
			if (o) bucket.set(to, { ...o });
			return !!o;
		},
		deleteObjects: async (keys: string[]) => {
			for (const key of keys) bucket.delete(key);
		},
		listAllKeys: async (prefix: string) => under(prefix).map((o) => o.key),
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: null, size: o.text.length, lastModified: o.modified } : null;
		},
		objectExists: async (key: string) => bucket.has(key),
		listAllObjects: async (prefix: string) => under(prefix),
		listObjects: async (prefix: string) => ({
			keys: under(prefix).map((o) => o.key),
			prefixes: [],
		}),
	},
});

const P = await import('../../../packages/engine-layout/src/lib/componentParams.ts');
const M = await import('../../../packages/engine-layout/src/lib/stateMachine.ts');
const { unusedPartParamKeys, BOUND_COMPONENT_DEFAULTS } =
	await import('../../../packages/engine-layout/src/lib/boundComponentCatalog.ts');
const { resolveTransform } = await import('../../../packages/engine-layout/src/lib/index.ts');
const W = await import('../src/routes/(app)/editor/instanceParamForwarding.ts');
const { nodeBox } = await import('../src/routes/(app)/editor/editorCanvas.helpers.ts');
const { normalizeComponent } = await import('../src/lib/server/componentStorage.ts');
const { harvestSceneText } = await import('../src/lib/server/localizationHarvest.ts');
const { exportEditorArt } = await import('../src/lib/server/editorArtExport.ts');
const { editorDocKey, projectComponentKey, SUB } =
	await import('../src/lib/server/projectPaths.ts');

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
const ok = (name: string, cond: boolean): void => eq(name, cond, true);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const read = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8');

const instance = (
	id: string,
	componentId: string,
	extra: Partial<ComponentInstanceNode> = {},
): ComponentInstanceNode => ({ id, kind: 'componentInstance', componentId, x: 0, y: 0, ...extra });
const container = (id: string, children: LayoutNode[], extra: Partial<ContainerNode> = {}) =>
	({ id, kind: 'container', x: 0, y: 0, children, ...extra }) as ContainerNode;
const def = (id: string, params: ComponentParam[], children: LayoutNode[] = []): ComponentDef => ({
	id,
	name: id,
	version: 1,
	scope: 'project',
	category: 'ui',
	params,
	root: container('root', children),
});

// ---- 1. the helper ------------------------------------------------------------------------------

const cracker = def('cracker', [
	{ key: 'lightAt', kind: 'number', default: 1 },
	{ key: 'tint', kind: 'color', default: 0xffffff },
]);
const own = { lightAt: 0.2, tint: 0xff0000 };
const forwarding = instance('p1', 'cracker', {
	params: own,
	paramBindings: { 'params.lightAt': 'lightAt_1', text: 'caption', 'params.': 'x', 'params.y': '' },
});
eq(
	'1 only `params.<key>` bindings with a key and a parent are forwards',
	P.forwardedParams(forwarding),
	[['lightAt', 'lightAt_1']],
);
const plain = instance('p0', 'cracker', { params: own, paramBindings: { text: 'caption' } });
ok('1 no `params.*` binding ⇒ the same map back', P.forwardInstanceParams(plain, own, {}) === own);
ok(
	'1 … and no params stay no params',
	P.forwardInstanceParams(instance('p', 'cracker'), undefined, { lightAt_1: 1 }) === undefined,
);
ok(
	'1 every forwarded outer value undefined ⇒ the same map back',
	P.forwardInstanceParams(forwarding, own, { lightAt_1: undefined }) === own,
);
eq(
	'1 the forwarded value wins over the instance’s own',
	P.forwardInstanceParams(forwarding, own, { lightAt_1: 0.6 }),
	{ lightAt: 0.6, tint: 0xff0000 },
);
eq('1 … and the instance’s own map is not touched', own, { lightAt: 0.2, tint: 0xff0000 });
eq(
	'1 an undefined outer value leaves the own value',
	P.resolveComponentParams(cracker, P.forwardInstanceParams(forwarding, own, {})).lightAt,
	0.2,
);
eq(
	'1 … or, with none, the def default',
	P.resolveComponentParams(
		cracker,
		P.forwardInstanceParams(
			instance('p', 'cracker', { paramBindings: forwarding.paramBindings }),
			{},
			{},
		),
	).lightAt,
	1,
);
eq(
	'1 a per-ratio own value is beaten too (the binding wins, as other bindings do)',
	P.forwardInstanceParams(forwarding, { ...own, lightAt: 0.9 }, { lightAt_1: 0.4 })?.lightAt,
	0.4,
);
{
	const potDef = def('pot', [{ key: 'level3', kind: 'number', default: 0.3 }]);
	const midDef = def('mid', [{ key: 'midAt', kind: 'number', default: 0.5 }]);
	const midNode = instance('mid', 'mid', { paramBindings: { 'params.midAt': 'level3' } });
	const leaf = instance('leaf', 'cracker', { paramBindings: { 'params.lightAt': 'midAt' } });
	const top = P.resolveComponentParams(potDef, { level3: 0.7 });
	const mid = P.resolveComponentParams(midDef, P.forwardInstanceParams(midNode, undefined, top));
	const end = P.resolveComponentParams(cracker, P.forwardInstanceParams(leaf, undefined, mid));
	eq('1 a chain composes: grandchild ← child ← the placed parent', end.lightAt, 0.7);
	eq(
		'1 … and an unset parent passes its default down the chain',
		P.resolveComponentParams(
			cracker,
			P.forwardInstanceParams(
				leaf,
				undefined,
				P.resolveComponentParams(
					midDef,
					P.forwardInstanceParams(midNode, undefined, P.resolveComponentParams(potDef)),
				),
			),
		).lightAt,
		0.3,
	);
}

// ---- 2. the runtime getters ---------------------------------------------------------------------

{
	let ratio = 'desktop';
	const parentProvided: Record<string, unknown> = {};
	Object.defineProperty(parentProvided, 'lightAt_1', {
		enumerable: true,
		get: () => (ratio === 'portrait' ? 0.9 : 0.4),
	});
	let parentValue: number | undefined;
	Object.defineProperty(parentProvided, 'live', { enumerable: true, get: () => parentValue });
	const node = instance('p1', 'cracker', {
		params: own,
		paramBindings: { 'params.lightAt': 'lightAt_1', 'params.tint': 'live' },
	});
	const provided: Record<string, unknown> = { ...own };
	P.defineForwardedParams(provided, node, parentProvided, (key) => own[key as keyof typeof own]);
	eq('2 a forwarded key reads the parent’s value', provided.lightAt, 0.4);
	ratio = 'portrait';
	eq('2 … at READ time, so a parent’s per-ratio value follows', provided.lightAt, 0.9);
	eq('2 the parent’s value undefined ⇒ the instance’s own', provided.tint, 0xff0000);
	parentValue = 0x00ff00;
	eq('2 … until it arrives', provided.tint, 0x00ff00);
	ok('2 forwarded keys stay enumerable', Object.keys(provided).includes('lightAt'));
	Object.defineProperty(provided, 'lightAt', { enumerable: true, get: () => 'live feed' });
	eq('2 a live feed defined after it still takes its key', provided.lightAt, 'live feed');
	const untouched: Record<string, unknown> = { ...own };
	P.defineForwardedParams(untouched, plain, parentProvided, () => 'never');
	ok(
		'2 no forward ⇒ no getter (plain data properties)',
		Object.values(Object.getOwnPropertyDescriptors(untouched)).every((d) => 'value' in d),
	);

	// The state machine reads `{lightAt}` off the static params, as `<ComponentInstance>` hands them.
	const machine: ComponentStateMachine = {
		layers: [
			{
				id: 'main',
				entry: 'off',
				states: [
					{ id: 'off', timeline: 'c_off' },
					{ id: 'lit', timeline: 'c_lit', loop: true },
				],
				transitions: [
					{
						id: 't_light',
						from: 'off',
						to: 'lit',
						conditions: [{ input: 'share', op: '>=', param: 'lightAt' }],
					},
				],
			},
		],
	};
	const runner = (enclosing: Record<string, unknown>) => {
		const staticParams = P.resolveComponentParams(
			cracker,
			P.forwardInstanceParams(node, node.params, enclosing),
		);
		const r = new M.ComponentStateMachineRunner(
			machine,
			[{ id: 'share', kind: 'number' }],
			new Map([
				['c_off', 0],
				['c_lit', 1],
			]),
			(key) => staticParams[key],
		);
		r.setInput('share', 0.5);
		r.advance(0.1);
		return r.stateOf('main');
	};
	eq(
		'2 the state machine’s {lightAt} reads the forwarded 0.4: lit at 0.5',
		runner({ lightAt_1: 0.4 }),
		'lit',
	);
	eq('2 … and the forwarded 0.8: still off at 0.5', runner({ lightAt_1: 0.8 }), 'off');
	eq('2 … and its own 0.2 when the parent leaves it unset', runner({}), 'lit');
}
{
	const src = read('../../../packages/engine-layout/src/lib/ComponentInstance.svelte');
	const at = (needle: string | RegExp): number =>
		typeof needle === 'string' ? src.indexOf(needle) : (needle.exec(src)?.index ?? -1);
	const enclosing = at('const enclosingParams = getComponentParams();');
	const forward = at('forwardInstanceParams(node, node.params, enclosingParams)');
	const statics = at('const staticParams =');
	const parity = at(
		/forwardedInstanceParams !== node\.params\s*\?\s*resolveComponentParams\(def, forwardedInstanceParams, projectDefaults\)\s*:\s*ownParams/,
	);
	const ratioLoop = at('for (const key of layoutOverrideParamKeys)');
	const getters = at(
		'defineForwardedParams(providedParams, node, enclosingParams, ownLayoutParam)',
	);
	const liveValue = at(/if \(valueSource\) \{\s*Object\.defineProperty\(providedParams, 'value'/);
	const provide = at('setComponentParams(allowed && def ? providedParams : {})');
	ok(
		'2 runtime: the enclosing params are read before this instance provides its own',
		enclosing >= 0 && enclosing < provide,
	);
	ok(
		'2 runtime: the forward is applied before the static params resolve',
		forward > enclosing && forward < statics,
	);
	ok('2 runtime: no forward ⇒ the static params ARE the own resolve (parity)', parity > statics);
	ok(
		'2 runtime: the forward getters sit after the per-ratio getters and before the live feeds',
		ratioLoop >= 0 && getters > ratioLoop && liveValue > getters && provide > liveValue,
	);
	ok(
		'2 runtime: the per-ratio getter falls back to the own resolve (unchanged for unforwarded keys)',
		/override && key in override \? override\[key\] : ownParams\[key\]/.test(src),
	);
}

// ---- 3. the editor edits ------------------------------------------------------------------------

const piece = def('piece', [
	{ key: 'lightAt', kind: 'number', default: 1 },
	{ key: 'pieceArt', kind: 'image', label: 'art', default: 'S_Default::cracker_off' },
	{ key: 'source', kind: 'string' },
	{ key: 'mode', kind: 'string', options: ['a', 'b'] },
	{ key: 'titleText', kind: 'string', group: 'Title', label: 'text', default: 'BOOM' },
	{ key: 'titleSize', kind: 'number', group: 'Title', label: 'size', default: 30 },
	{ key: 'rig', kind: 'spine', default: 'cracker' },
	{ key: 'anim', kind: 'spineAnimation', spineParam: 'rig' },
	{ key: 'value', kind: 'number', engineProvided: true },
]);
const pieces = [
	instance('c1', 'piece', { params: { lightAt: 0.333 } }),
	instance('c2', 'piece', { params: { lightAt: 0.667 } }),
	instance('c3', 'piece'),
];
const potCopy = def(
	'potCopy',
	[{ key: 'meter', kind: 'string', default: 'red' }],
	[container('pot', pieces, { bind: { component: 'HoldAndWinPot' } })],
);
const [c1, c2, c3] = pieces;
eq(
	'3 expose: the base key when free',
	W.exposeInstanceParam(potCopy, c1, piece, 'lightAt'),
	'lightAt',
);
eq(
	'3 … the param copies the kind, is the author’s, defaults to the value shown now',
	potCopy.params?.find((p) => p.key === 'lightAt'),
	{ key: 'lightAt', kind: 'number', author: true, default: 0.333 },
);
eq('3 … and the instance forwards from it', c1.paramBindings, { 'params.lightAt': 'lightAt' });
eq(
	'3 a second piece gets its own key',
	W.exposeInstanceParam(potCopy, c2, piece, 'lightAt'),
	'lightAt_2',
);
eq('3 … with its own value', potCopy.params?.find((p) => p.key === 'lightAt_2')?.default, 0.667);
eq('3 already forwarded ⇒ nothing', W.exposeInstanceParam(potCopy, c1, piece, 'lightAt'), null);
eq(
	'3 an engine-provided param is not exposable',
	W.exposeInstanceParam(potCopy, c1, piece, 'value'),
	null,
);
eq('3 an unknown param is not exposable', W.exposeInstanceParam(potCopy, c1, piece, 'nope'), null);
{
	const scratch = clone(potCopy);
	const bare = clone(c3);
	W.exposeInstanceParam(scratch, bare, piece, 'lightAt', { lightAt: 0.5 });
	eq(
		'3 an unset instance defaults to the child’s project default',
		scratch.params?.find((p) => p.key === 'lightAt_3')?.default,
		0.5,
	);
	const bare2 = clone(c3);
	W.exposeInstanceParam(scratch, bare2, piece, 'lightAt');
	eq(
		'3 … else to the child’s own default',
		scratch.params?.find((p) => p.key === 'lightAt_4')?.default,
		1,
	);
}
eq('3 an image param', W.exposeInstanceParam(potCopy, c1, piece, 'pieceArt'), 'pieceArt');
eq(
	'3 … keeps its kind and label, the frame it shows is the default',
	potCopy.params?.find((p) => p.key === 'pieceArt'),
	{ key: 'pieceArt', kind: 'image', author: true, label: 'art', default: 'S_Default::cracker_off' },
);
eq(
	'3 a reserved key (`source`) is never taken',
	W.exposeInstanceParam(potCopy, c1, piece, 'source'),
	'source_2',
);
for (const key of [
	'action',
	'text',
	'label',
	'bet',
	'visibleSource',
	'tapToContinue',
	'imageHover',
])
	ok(`3 … nor \`${key}\``, W.uniqueParentKey(potCopy, key) !== key);
W.exposeInstanceParam(potCopy, c1, piece, 'mode');
const mode = potCopy.params?.find((p) => p.key === 'mode');
eq('3 options are copied', mode?.options, ['a', 'b']);
ok('3 … as a fresh list', mode?.options !== piece.params?.find((p) => p.key === 'mode')?.options);
W.exposeInstanceParam(potCopy, c1, piece, 'titleText');
W.exposeInstanceParam(potCopy, c1, piece, 'titleSize');
W.exposeInstanceParam(potCopy, c2, piece, 'titleText');
eq(
	'3 a group stays together for one placement, and a second placement gets its own',
	['titleText', 'titleSize', 'titleText_2'].map(
		(k) => potCopy.params?.find((p) => p.key === k)?.group,
	),
	['Title', 'Title', 'Title 2'],
);
eq('3 a label is copied', potCopy.params?.find((p) => p.key === 'titleSize')?.label, 'size');
W.exposeInstanceParam(potCopy, c1, piece, 'anim');
eq(
	'3 an animation param whose rig is not forwarded drops its `spineParam`',
	potCopy.params?.find((p) => p.key === 'anim')?.spineParam,
	undefined,
);
W.exposeInstanceParam(potCopy, c1, piece, 'rig');
eq(
	'3 … and gets the rig’s copy once the rig is exposed',
	potCopy.params?.find((p) => p.key === 'anim')?.spineParam,
	'rig',
);
W.exposeInstanceParam(potCopy, c2, piece, 'rig');
W.exposeInstanceParam(potCopy, c2, piece, 'anim');
eq(
	'3 an animation param exposed after its rig follows the rig’s copy',
	potCopy.params?.find((p) => p.key === 'anim_2')?.spineParam,
	'rig_2',
);
eq(
	'3 linkable: the parent’s params of the same kind',
	W.linkableParentParams(potCopy, piece.params![1]).map((p) => p.key),
	['pieceArt'],
);
ok('3 link: same kind', W.linkInstanceParam(potCopy, c3, piece, 'pieceArt', 'pieceArt'));
eq('3 … several pieces share one parent param', W.forwardedFrom(c3, 'pieceArt'), 'pieceArt');
ok('3 link refused across kinds', !W.linkInstanceParam(potCopy, c3, piece, 'lightAt', 'pieceArt'));
ok(
	'3 link refused to a param the parent lacks',
	!W.linkInstanceParam(potCopy, c3, piece, 'lightAt', 'gone'),
);
ok(
	'3 link refused for an engine-provided param',
	!W.linkInstanceParam(potCopy, c3, piece, 'value', 'lightAt'),
);
const paramCount = potCopy.params?.length;
ok('3 unlink', W.unlinkInstanceParam(c3, 'pieceArt'));
eq('3 … drops the forward only: the instance has no bindings left', c3.paramBindings, undefined);
eq('3 … the parent param stays', potCopy.params?.length, paramCount);
ok('3 unlink twice ⇒ nothing', !W.unlinkInstanceParam(c3, 'pieceArt'));
W.writeInstanceParam(potCopy, c1, 'lightAt', 0.25);
eq(
	'3 Light order on a forwarded piece writes the parent param’s default',
	[potCopy.params?.find((p) => p.key === 'lightAt')?.default, c1.params?.lightAt],
	[0.25, 0.333],
);
W.writeInstanceParam(potCopy, c3, 'lightAt', 1);
eq('3 … and on one that is not, its own value', c3.params, { lightAt: 1 });

// ---- 4. a deleted parent param drops its forwards -----------------------------------------------

{
	const pruned = clone(potCopy);
	pruned.params = pruned.params?.filter((p) => p.key !== 'lightAt_2');
	ok('4 deleting a parent param prunes', P.pruneOrphanParamBindings(pruned));
	const [p1, p2] = (pruned.root.children[0] as ContainerNode).children;
	eq('4 … the forward from it, inside the part', p2.paramBindings?.['params.lightAt'], undefined);
	eq('4 … and keeps the others', p1.paramBindings?.['params.lightAt'], 'lightAt');
	ok('4 a clean def prunes nothing', !P.pruneOrphanParamBindings(clone(potCopy)));
}

// ---- 5. the save -------------------------------------------------------------------------------

{
	const raw = clone(potCopy);
	const p3 = (raw.root.children[0] as ContainerNode).children[2];
	p3.paramBindings = { 'params.lightAt': 'undeclared' };
	const saved = normalizeComponent(raw);
	const [s1, , s3] = (saved.root.children[0] as ContainerNode).children;
	eq('5 the save keeps every forward to a declared param', s1.paramBindings, c1.paramBindings);
	eq('5 … and drops one to an undeclared param', s3.paramBindings, undefined);
	eq('5 … and keeps the exposed params', saved.params?.length, potCopy.params?.length);
}

// ---- 6. a part param read only through a forward ------------------------------------------------

{
	const [part, entry] = Object.entries(BOUND_COMPONENT_DEFAULTS).find(([, e]) => e.tileImage)!;
	const key = entry.tileImage!.imageParam;
	const without = container('root', [instance('i', 'piece')]);
	ok(`6 a ${part} param nothing reads is hidden`, unusedPartParamKeys(without).has(key));
	const read = container('root', [
		instance('i', 'piece', { paramBindings: { 'params.pieceArt': key } }),
	]);
	ok('6 … but one a nested instance forwards is offered', !unusedPartParamKeys(read).has(key));
}

// ---- 7. editor preview --------------------------------------------------------------------------

{
	const labelBox = def(
		'labelBox',
		[
			{ key: 'boxWidth', kind: 'number', default: 100 },
			{ key: 'boxHeight', kind: 'number', default: 40 },
		],
		[
			{
				id: 't',
				kind: 'text',
				x: 0,
				y: 0,
				text: 'Hi',
				width: 100,
				height: 40,
				anchor: { x: 0, y: 0 },
				paramBindings: { width: 'boxWidth', height: 'boxHeight' },
			} as LayoutNode,
		],
	);
	const lbl = instance('lbl', 'labelBox', {
		params: { boxWidth: 120 },
		paramBindings: { 'params.boxWidth': 'labelWidth' },
	});
	const panel = def('panel', [{ key: 'labelWidth', kind: 'number', default: 300 }], [lbl]);
	const map = new Map([
		['labelBox', labelBox],
		['panel', panel],
	]);
	const box = (node: LayoutNode, params?: Record<string, unknown>) =>
		nodeBox(
			node,
			resolveTransform(node, 'desktop'),
			() => null,
			map,
			'desktop',
			undefined,
			undefined,
			{},
			params,
		).w;
	eq(
		'7 a placed parent frames the width its placement forwards',
		box(instance('pan', 'panel', { params: { labelWidth: 280 } })),
		280,
	);
	eq('7 … or its default', box(instance('pan', 'panel')), 300);
	eq(
		'7 the Components side frames the open component’s default',
		box(lbl, P.resolveComponentParams(panel)),
		300,
	);
	eq('7 the same instance on a screen keeps its own width', box(lbl, {}), 120);
	eq(
		'7 no forward ⇒ the own width (parity)',
		box(instance('l2', 'labelBox', { params: { boxWidth: 120 } }), P.resolveComponentParams(panel)),
		120,
	);
	const walkers: [string, RegExp[]][] = [
		[
			'../src/routes/(app)/editor/EditorCanvas.svelte',
			[
				/forwardInstanceParams\(n, resolveLayoutInstanceParams\(n, layoutType\), outerParams\)/,
				/forwardInstanceParams\(node, resolveLayoutInstanceParams\(node, layoutType\), outerParams\)/,
				/nodesHaveRig\(s\.nodes, 0, \[\], undefined, componentParams\)/,
			],
		],
		[
			'../src/routes/(app)/editor/EditorRigLayer.svelte',
			[
				/forwardInstanceParams\(n, n\.params, componentParams\)/,
				/forwardInstanceParams\(n, n\.params, instanceParams \?\? componentParams\)/,
			],
		],
		[
			'../src/routes/(app)/editor/EditorTextLayer.svelte',
			[/forwardInstanceParams\(n, resolveLayoutInstanceParams\(n, layoutType\), params\)/],
		],
	];
	for (const [file, patterns] of walkers) {
		const src = read(file);
		for (const pattern of patterns)
			ok(`7 ${file.split('/').pop()} forwards: ${pattern.source}`, pattern.test(src));
		ok(
			`7 ${file.split('/').pop()} resolves no instance param map without the forward`,
			!/resolveComponentParams\(\s*def,\s*(n|node)\.params/.test(src) &&
				!/resolveComponentParams\(\s*def,\s*resolveLayoutInstanceParams\(/.test(src),
		);
	}
	const canvas = read('../src/routes/(app)/editor/EditorCanvas.svelte');
	eq(
		'7 both canvas draws hand the enclosing params to drawComponentInstance',
		(canvas.match(/componentStack,\s*instanceParams \?\? componentParams,\s*\)/g) ?? []).length,
		2,
	);
	eq(
		'7 both rig layers get the open component’s params',
		(canvas.match(/\{componentDefaults\}\s*\{componentParams\}\s*\{rigPreview\}/g) ?? []).length,
		2,
	);
	const props = read('../src/routes/(app)/editor/EditorProperties.svelte');
	const workspace = read('../src/routes/(app)/editor/ComponentWorkspace.svelte');
	ok(
		'7 the forward picker is read-only while inspecting',
		/class="forward-pick"\s*value=""\s*disabled=\{componentReadOnly\}/.test(props),
	);
	ok(
		'7 … and so is ×',
		/disabled=\{componentReadOnly\}\s*title="Stop taking this from/.test(props),
	);
	ok(
		'7 the workspace wires expose / link / unlink and refuses them while inspecting',
		/onExposeInstanceParam=\{exposeNestedParam\}/.test(workspace) &&
			/onLinkInstanceParam=\{linkNestedParam\}/.test(workspace) &&
			/onUnlinkInstanceParam=\{unlinkNestedParam\}/.test(workspace) &&
			/if \(!componentDraft \|\| isInspecting \|\| selectedNode\?\.kind !== 'componentInstance'\) return null;/.test(
				workspace,
			),
	);
}

// ---- 8. the localization harvest ----------------------------------------------------------------

{
	const caption = def(
		'caption',
		[{ key: 'text', kind: 'string', default: 'Caption' }],
		[
			{
				id: 't',
				kind: 'text',
				x: 0,
				y: 0,
				text: 'static',
				paramBindings: { text: 'text' },
			} as LayoutNode,
		],
	);
	const deep = def(
		'deep',
		[],
		[{ id: 't', kind: 'text', x: 0, y: 0, text: 'DEEP TEXT' } as LayoutNode],
	);
	const mid = def(
		'mid',
		[],
		[{ id: 't', kind: 'text', x: 0, y: 0, text: 'MID TEXT' } as LayoutNode, instance('d', 'deep')],
	);
	const loop = def(
		'loop',
		[],
		[
			{ id: 't', kind: 'text', x: 0, y: 0, text: 'LOOP TEXT' } as LayoutNode,
			instance('again', 'loop'),
		],
	);
	const prize = def(
		'prize',
		[{ key: 'prizeLabel', kind: 'string', default: 'GRAND' }],
		[
			instance('c', 'caption', {
				params: { text: 'HIDDEN OWN' },
				paramBindings: { 'params.text': 'prizeLabel' },
			}),
			instance('m', 'caption', { params: { text: 'MINI' } }),
			instance('mid', 'mid'),
		],
	);
	const defs = new Map([caption, deep, mid, loop, prize].map((d) => [d.id, d]));
	const doc = {
		scenes: [
			{
				id: 's',
				name: 'S',
				nodes: [
					instance('a', 'prize', {
						params: { prizeLabel: 'MEGA PRIZE' },
						overrides: { portrait: { params: { prizeLabel: 'PORTRAIT PRIZE' } } },
					}),
					instance('b', 'prize'),
					instance('l', 'loop'),
				],
			},
		],
	} as unknown as LayoutDoc;
	const keys =
		(await harvestSceneText(doc, async (id) => defs.get(id)))[0]?.items.map((i) => i.key) ?? [];
	for (const text of ['MEGA PRIZE', 'PORTRAIT PRIZE', 'GRAND', 'MINI', 'MID TEXT', 'LOOP TEXT'])
		ok(`8 harvested: ${text}`, keys.includes(text));
	ok('8 an own value hidden behind a forward is not harvested', !keys.includes('HIDDEN OWN'));
	ok('8 a third level the game does not draw is not harvested', !keys.includes('DEEP TEXT'));
	eq(
		'8 a component holding itself is harvested once',
		keys.filter((k) => k === 'LOOP TEXT').length,
		1,
	);
}

// ---- 9. ship -------------------------------------------------------------------------------------

{
	const CLIENT = 'invisible_wall';
	const PROJECT = 'forward_art';
	const put = (key: string, body: unknown) =>
		bucket.set(key, { text: typeof body === 'string' ? body : JSON.stringify(body), modified: 1 });
	const sheet = (stem: string, frame: string): string => {
		const manifest = `${SUB.manifests(CLIENT, PROJECT)}/atlas_manifest_${stem}.json`;
		const page = `${SUB.sheets(CLIENT, PROJECT)}/${stem}/${stem}.webp`;
		put(page, 'x');
		put(manifest, {
			atlas: { source_image_path: page },
			regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
		});
		return manifest;
	};
	const PICKED = sheet('S_Picked', 'cracker_red');
	const DEFAULT = sheet('S_Default', 'cracker_off');
	const RIG = 'pickedRig';
	const rigFolder = `${SUB.spines(CLIENT, PROJECT)}/${RIG}`;
	put(`${SUB.spines(CLIENT, PROJECT)}/skeletons.json`, {
		skeletons: [
			{ folder: RIG, name: RIG, atlas_file: `${RIG}.atlas`, skeleton_file: `${RIG}.json` },
		],
	});
	put(`${rigFolder}/${RIG}.atlas`, `${RIG}.webp\nsize: 8,8\nbone\n  bounds: 0,0,8,8\n`);
	put(`${rigFolder}/${RIG}.json`, { skeleton: { spine: '4.2' } });
	put(`${rigFolder}/${RIG}.webp`, 'x');
	const child = def(
		'shipPiece',
		[
			{ key: 'pieceArt', kind: 'image' },
			{ key: 'rig', kind: 'spine' },
		],
		[
			{
				id: 's',
				kind: 'sprite',
				x: 0,
				y: 0,
				assetKey: '',
				region: '',
				paramBindings: { region: 'pieceArt' },
			} as LayoutNode,
			{
				id: 'r',
				kind: 'spine',
				x: 0,
				y: 0,
				assetKey: '',
				paramBindings: { assetKey: 'rig' },
			} as LayoutNode,
		],
	);
	const nested = instance('n', 'shipPiece', { params: { pieceArt: `${DEFAULT}::cracker_off` } });
	const parent = def('shipPot', [], [nested]);
	W.exposeInstanceParam(parent, nested, child, 'pieceArt');
	W.exposeInstanceParam(parent, nested, child, 'rig');
	put(projectComponentKey(PROJECT, 'shipPiece'), child);
	put(projectComponentKey(PROJECT, 'shipPot'), normalizeComponent(parent));
	put(editorDocKey(CLIENT, PROJECT), {
		scenes: [
			{
				id: 'pots',
				name: 'Pots',
				nodes: [
					instance('pot', 'shipPot', {
						params: { pieceArt: `${PICKED}::cracker_red`, rig: RIG },
					}),
				],
			},
		],
	});
	const index = await exportEditorArt(CLIENT, PROJECT);
	ok(
		'9 the sheet a placement picks through the exposed param ships',
		index.sheets.some((s) => s.key === PICKED),
	);
	ok('9 … its frame counts as covered', !index.missing.includes('cracker_red'));
	ok(
		'9 the exposed default’s sheet ships',
		index.sheets.some((s) => s.key === DEFAULT),
	);
	ok(
		'9 the rig a placement picks through the exposed param ships',
		index.spines.some((s) => s.key === RIG),
	);
}

console.log(
	failures === 0
		? `component param forwarding: ${passes} checks passed`
		: `component param forwarding: ${failures} of ${passes + failures} FAILED`,
);
if (failures > 0) process.exit(1);
