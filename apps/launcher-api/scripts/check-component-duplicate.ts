/**
 * The Components list's ⧉ Duplicate (`componentDuplicate.client.ts` + `duplicateComponentDef` in
 * `ComponentWorkspace.svelte`):
 *   pnpm --filter launcher-api check:component-duplicate
 *
 *  1. names: "<name> copy", then " copy 2", " copy 3", …;
 *  2. the built-in Counter Segment copies to a project component under a fresh id, version 1, with
 *     every node re-id'd (no id shared with the source or with a second copy), its params, inputs
 *     and state machine; the source is not mutated;
 *  3. its timelines (built-in, overridden by id by the project's) are copied onto the copy under
 *     fresh ids clear of every taken id, its states play the copies, node actors keep naming their
 *     node (an unnamed node's id follows to the copy's node), reuse on other components is dropped,
 *     a state playing a reused timeline keeps it;
 *  4. this game's defaults become the copy's param defaults (never an engine-provided one), and win
 *     over `defaultInstanceParams` as they did;
 *  5. through the REAL route over an in-memory R2: the copy saves create-only to the project key,
 *     loads back with its state machine pointing at its own timelines, and a second create under
 *     the same id is refused (409), never an overwrite;
 *  6. the workspace wiring: create-only timeline writes before the def, the draft save rather than
 *     `saveComponent`'s stack-on-top answer, the unsaved-changes ask, and ⧉ on both lists.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import type { CinematicDoc, ComponentDef, LayoutNode } from 'engine-layout';

const CLIENT = 'invisible_wall';
const PROJECT = 'commonoverlayproject';

const bucket = new Map<string, { text: string; etag: string }>();
let etagSeq = 0;
class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
interface Cond {
	ifMatch?: string;
	ifNoneMatch?: string;
}
const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (baseEtag: string | null | undefined): Cond | undefined =>
			baseEtag === undefined
				? undefined
				: baseEtag === null
					? { ifNoneMatch: '*' }
					: { ifMatch: baseEtag },
		putObjectText: async (key: string, text: string, _type: string, cond?: Cond) => {
			const current = bucket.get(key);
			if (cond?.ifNoneMatch === '*' && current) throw new ConflictError(key);
			if (cond?.ifMatch !== undefined && current?.etag !== cond.ifMatch) {
				throw new ConflictError(key);
			}
			const etag = `"e${++etagSeq}"`;
			bucket.set(key, { text, etag });
			return etag;
		},
		getObjectTextWithEtag: async (key: string) => bucket.get(key) ?? null,
		getObjectText: async (key: string) => bucket.get(key)?.text ?? null,
		headObject: async () => null,
		copyObject: async () => false,
		deleteObject: async (key: string) => void bucket.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		listAllObjects: async (prefix: string) =>
			[...bucket.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((key) => ({ key, size: 0, lastModified: 0 })),
		listAllKeys: async (prefix: string) => [...bucket.keys()].filter((k) => k.startsWith(prefix)),
		listObjects: async () => ({ keys: [], prefixes: [] }),
		jsonBaseEtag: (v: unknown) => (v === null ? null : typeof v === 'string' ? v : undefined),
		formBaseEtag: (v: unknown) => (typeof v !== 'string' ? undefined : v === '' ? null : v),
		objectExists: async (key: string) => bucket.has(key),
	},
});
mock.module(server('rig.ts'), { namedExports: { loadSharedSkeletonIndex: async () => [] } });
mock.module(server('projects.ts'), { namedExports: { projectClientKey: async () => CLIENT } });
mock.module(server('roleToolAccess.ts'), { namedExports: { getRoleOverrides: async () => ({}) } });
mock.module(server('userToolAccess.ts'), { namedExports: { getToolOverrides: async () => ({}) } });
mock.module(server('toolScope.ts'), {
	namedExports: {
		requireOptionalProjectKey: async (_user: unknown, project: string | null | undefined) =>
			project?.trim() ? project : undefined,
	},
});

const { projectComponentKey } = await import('../src/lib/server/projectPaths.ts');
const { SEGMENTED_COUNTER_SEGMENT_DEF, SEGMENTED_COUNTER_TIMELINES, BUILTIN_TIMELINES } =
	await import('engine-layout');
const { loadComponent } = await import('../src/lib/server/componentStorage.ts');
const componentRoute = await import('../src/routes/api/editor/component/+server.ts');
const { componentSaveRequest } = await import('../src/routes/(app)/editor/componentSave.client.ts');
const { componentOwnTimelines, duplicateComponent, duplicateComponentName } =
	await import('../src/routes/(app)/editor/componentDuplicate.client.ts');

type RouteEvent = Parameters<typeof componentRoute.POST>[0];
async function post(body: unknown): Promise<number> {
	const url = new URL('http://launcher.test/api/editor/component');
	const request = new Request(url, { method: 'POST', body: JSON.stringify(body) });
	const event = { request, url, locals: { user: { id: 'u', role: 'admin' } } };
	try {
		return (await componentRoute.POST(event as unknown as RouteEvent)).status;
	} catch (e) {
		const http = e as { status?: number };
		if (typeof http.status !== 'number') throw e;
		return http.status;
	}
}

let checks = 0;
let failures = 0;
function check(label: string, actual: unknown, expected: unknown): void {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const ids = (node: LayoutNode): string[] => [
	node.id,
	...(node.kind === 'container' ? node.children.flatMap(ids) : []),
];
let seq = 0;
const mint = (): string => `c_n${String(++seq).padStart(6, '0')}`;
const states = (def: ComponentDef): string[] =>
	(def.stateMachine?.layers ?? []).flatMap((l) => l.states.map((s) => s.timeline));

// 1. Names.
check(
	'1 first copy',
	duplicateComponentName('Counter Segment', ['Counter Segment']),
	'Counter Segment copy',
);
check(
	'1 next free number',
	duplicateComponentName('Counter Segment', ['Counter Segment copy', 'Counter Segment copy 2']),
	'Counter Segment copy 3',
);
check('1 blank name', duplicateComponentName('  ', []), 'Component copy');

// 2 + 3. The built-in Counter Segment and its built-in timelines.
const source = SEGMENTED_COUNTER_SEGMENT_DEF;
const before = JSON.stringify(source);
const builtinOwn = componentOwnTimelines(source.id, BUILTIN_TIMELINES, []);
check(
	'3 the built-in segment plays its two built-in timelines',
	builtinOwn.map((d) => d.id).sort(),
	SEGMENTED_COUNTER_TIMELINES.map((d) => d.id).sort(),
);
const taken = BUILTIN_TIMELINES.map((d) => d.id);
const first = duplicateComponent(source, {
	id: 'c_first001',
	name: 'Counter Segment copy',
	mintNodeId: mint,
	timelines: builtinOwn,
	takenTimelineIds: taken,
});
const second = duplicateComponent(source, {
	id: 'c_second01',
	name: 'Counter Segment copy 2',
	mintNodeId: mint,
	timelines: builtinOwn,
	takenTimelineIds: [...taken, ...first.timelines.map((d) => d.id)],
});
const { def } = first;
check(
	'2 a project component, fresh id, version 1, the new name',
	[def.id, def.scope, def.version, def.name],
	['c_first001', 'project', 1, 'Counter Segment copy'],
);
check('2 the source is not mutated', JSON.stringify(source), before);
const srcIds = ids(source.root);
const firstIds = ids(def.root);
const secondIds = ids(second.def.root);
check('2 same node count', firstIds.length, srcIds.length);
check(
	'2 the root id is a fresh _root',
	def.root.id.endsWith('_root') && def.root.id !== source.root.id,
	true,
);
check(
	'2 no node id is shared with the source or between copies',
	new Set([...srcIds, ...firstIds, ...secondIds]).size,
	srcIds.length * 3,
);
check(
	'2 labels, params, inputs, category and the machine shape are kept',
	[
		JSON.stringify(def.root).replace(/"id":"[^"]*"/g, ''),
		def.params,
		def.inputs,
		def.category,
		def.stateMachine?.layers.map((l) => [l.id, l.entry, l.states.map((s) => s.id), l.transitions]),
	],
	[
		JSON.stringify(source.root).replace(/"id":"[^"]*"/g, ''),
		source.params,
		source.inputs,
		source.category,
		source.stateMachine?.layers.map((l) => [
			l.id,
			l.entry,
			l.states.map((s) => s.id),
			l.transitions,
		]),
	],
);
const copyIds = first.timelines.map((d) => d.id);
check('3 one copy per timeline', copyIds.length, builtinOwn.length);
check(
	'3 the copies take fresh ids',
	copyIds.some((id) => taken.includes(id)),
	false,
);
check(
	'3 two copies never share a timeline id',
	new Set([...copyIds, ...second.timelines.map((d) => d.id)]).size,
	copyIds.length * 2,
);
check(
	"3 every state plays one of the copy's own timelines",
	states(def).every((t) => copyIds.includes(t)),
	true,
);
check(
	'3 the copies are hosted on the copy',
	first.timelines.map((d) => d.host),
	first.timelines.map(() => ({ kind: 'component', componentId: def.id })),
);
check(
	'3 node actors keep naming their node',
	first.timelines.map((d) => d.stage.cast.map((c) => c.target)),
	builtinOwn.map((d) => d.stage.cast.map((c) => c.target)),
);
check(
	'3 the original timelines are untouched',
	builtinOwn.map((d) => d.host),
	builtinOwn.map(() => ({ kind: 'component', componentId: source.id })),
);

// 3b. A project override, an unnamed node actor, reuse, and a reused timeline.
{
	const base: ComponentDef = {
		id: 'c_src00001',
		name: 'Cap',
		version: 4,
		scope: 'project',
		category: 'ui',
		internal: true,
		root: {
			id: 'c_src00001_root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [
				{ id: 'n_named', label: 'Glow', kind: 'rect', x: 0, y: 0, width: 1, height: 1, color: 0 },
				{ id: 'n_bare', kind: 'rect', x: 0, y: 0, width: 1, height: 1, color: 0 },
			],
		},
		params: [
			{ key: 'tint', kind: 'color', default: 0x111111 },
			{ key: 'value', kind: 'number', engineProvided: true, default: 0 },
			{ key: 'label', kind: 'string', default: 'A' },
		],
		defaultInstanceParams: { label: 'B' },
		stateMachine: {
			layers: [
				{
					id: 'l',
					entry: 'On',
					states: [
						{ id: 'On', timeline: 'c_c_src00001_on' },
						{ id: 'Shared', timeline: 'c_other_reused' },
					],
					transitions: [],
				},
			],
		},
	};
	const timeline = (id: string, componentId: string, target: string): CinematicDoc => ({
		schemaVersion: 1,
		id,
		name: 'On',
		duration: 1,
		fps: 30,
		host: { kind: 'component', componentId },
		playOnComponents: ['c_elsewhere'],
		stage: { sceneId: null, cast: [{ actorId: 'a', kind: 'node', target, place: {} }] },
		tracks: [],
		markers: [],
	});
	const own = componentOwnTimelines(
		base.id,
		[timeline('c_c_src00001_on', base.id, 'Glow')],
		[timeline('c_c_src00001_on', base.id, 'n_bare'), timeline('c_other_reused', 'c_other', 'Glow')],
	);
	check(
		'3b the project timeline overrides the built-in of its id; another host is not its own',
		own.map((d) => [d.id, d.stage.cast[0].target]),
		[['c_c_src00001_on', 'n_bare']],
	);
	const dup = duplicateComponent(base, {
		id: 'c_dup00001',
		name: 'Cap copy',
		mintNodeId: mint,
		timelines: own,
		takenTimelineIds: ['c_c_src00001_on', 'c_other_reused'],
		projectDefaults: { tint: 0xff0000, value: 9, label: 'C', undeclared: 1 },
	});
	const bare = dup.def.root.children[1];
	check(
		'3b an unnamed node actor follows its node to the copy',
		dup.timelines[0].stage.cast[0].target,
		bare.id,
	);
	check("3b the source's reuse stays the source's", 'playOnComponents' in dup.timelines[0], false);
	check('3b a state playing a reused timeline keeps it', states(dup.def), [
		dup.timelines[0].id,
		'c_other_reused',
	]);
	check("3b an engine-placed component's copy is placeable", 'internal' in dup.def, false);
	// 4. This game's defaults.
	check(
		'4 defaults baked into the params; an engine-provided one is not',
		dup.def.params?.map((p) => [p.key, p.default]),
		[
			['tint', 0xff0000],
			['value', 0],
			['label', 'C'],
		],
	);
	check('4 a baked default wins over defaultInstanceParams', dup.def.defaultInstanceParams, {
		label: 'C',
	});
	check(
		'4 an undeclared key is not invented',
		JSON.stringify(dup.def).includes('undeclared'),
		false,
	);
	check('4 the source keeps its own defaults', base.params?.[0].default, 0x111111);
}

// 5. Through the real route: create-only.
{
	const req = componentSaveRequest(def, PROJECT, { baseEtag: null, force: false });
	check('5 the copy saves as a create', [req.copiesToProject, req.body.baseEtag], [false, null]);
	check('5 the copy saves', await post(req.body), 200);
	const stored = await loadComponent(def.id, PROJECT);
	check('5 stored under the project key', bucket.has(projectComponentKey(PROJECT, def.id)), true);
	check(
		'5 loads back with its own nodes and timelines',
		[stored?.scope, stored?.version, stored && ids(stored.root), stored && states(stored)],
		['project', 1, firstIds, states(def)],
	);
	check('5 a second create under the same id is refused', await post(req.body), 409);
	check('5 the stored copy is untouched', (await loadComponent(def.id, PROJECT))?.name, def.name);
}

// 6. The workspace wiring.
{
	const workspace = readFileSync(
		new URL('../src/routes/(app)/editor/ComponentWorkspace.svelte', import.meta.url),
		'utf8',
	);
	const fn = workspace.slice(workspace.indexOf('async function duplicateComponentDef'));
	const body = fn.slice(0, fn.indexOf('\n\t}\n'));
	check(
		'6 asks about unsaved changes first',
		body.includes("confirmLeaveDraft('Discard and duplicate')"),
		true,
	);
	check(
		'6 reads the def the project shows (project, shared, built-in)',
		body.includes('/api/editor/component?id='),
		true,
	);
	check('6 timelines are created create-only', body.includes('baseEtag: null, projectKey'), true);
	check(
		'6 timelines are written before the def',
		body.indexOf('/api/cinematics/save') < body.indexOf('saveState.save('),
		true,
	);
	check(
		'6 the def saves create-only, never stacked on top',
		[body.includes('saveState.save({ force: false })'), body.includes('saveComponent(')],
		[true, false],
	);
	check(
		'6 a copy that does not save takes its timelines back',
		body.includes('/api/cinematics/delete'),
		true,
	);
	check('6 ⧉ on both lists', workspace.match(/\{@render duplicateButton\(def\)\}/g)?.length, 2);
}

if (failures) {
	console.error(`${failures} of ${checks} component-duplicate checks FAILED`);
	process.exit(1);
}
console.log(`component-duplicate: all ${checks} checks passed`);
