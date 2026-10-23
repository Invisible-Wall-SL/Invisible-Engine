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
 *     fresh ids clear of every taken id, its states play the copies, node actors keep their targets,
 *     reuse on other components is dropped,
 *     a state playing a reused timeline keeps it;
 *  4. this game's defaults become the copy's param defaults (never an engine-provided one), and win
 *     over `defaultInstanceParams` as they did;
 *  5. through the REAL route over an in-memory R2: the copy saves create-only to the project key,
 *     loads back with its state machine pointing at its own timelines, and a second create under
 *     the same id is refused (409), never an overwrite;
 *  6. `writeComponentDuplicate` over injected writes: timelines first, then the def; a refused
 *     timeline or def takes back what was created (a failed take-back is named); a def save with no
 *     answer may have landed, so nothing is deleted;
 *  7. the workspace wiring: create-only writes, the draft save rather than `saveComponent`'s
 *     stack-on-top answer, "saved" read off the recorded ETag and "refused" only after a 404, the
 *     unsaved-changes ask (again if the draft changed during the reads), the list held still, and
 *     ⧉ on both lists.
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
const {
	componentOwnTimelines,
	duplicateComponent,
	duplicateComponentName,
	writeComponentDuplicate,
} = await import('../src/routes/(app)/editor/componentDuplicate.client.ts');

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

// 3b. A project override, a node actor, reuse, a reused timeline and baked defaults.
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
	check(
		'3b node actor targets are kept (a component timeline finds its node by name)',
		dup.timelines[0].stage.cast[0].target,
		'n_bare',
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

// 6. Writing the copy: timelines create-only first, then the def; a refusal takes them back.
{
	const doc = (id: string): CinematicDoc => ({
		schemaVersion: 1,
		id,
		name: id,
		duration: 1,
		fps: 30,
		stage: { sceneId: null, cast: [] },
		tracks: [],
		markers: [],
	});
	const copy = { def, timelines: [doc('t1'), doc('t2')] };
	type Outcome = Awaited<ReturnType<Parameters<typeof writeComponentDuplicate>[1]['saveDef']>>;
	function run(opts: { refuseTimeline?: string; def?: Outcome | 'throw'; failDelete?: string }) {
		const log: string[] = [];
		const done = writeComponentDuplicate(copy, {
			createTimeline: async (t) => {
				log.push(`create ${t.id}`);
				return t.id === opts.refuseTimeline ? 'Conflict (409).' : null;
			},
			saveDef: async (d) => {
				log.push(`save ${d.id}`);
				if (opts.def === 'throw') throw new Error('network');
				return opts.def ?? 'saved';
			},
			deleteTimeline: async (id) => {
				log.push(`delete ${id}`);
				if (id === opts.failDelete) throw new Error('offline');
				return true;
			},
		});
		return done.then((message) => ({ message, log }));
	}
	const ok = await run({});
	check('6 stored: timelines in order, then the def, nothing deleted', ok, {
		message: null,
		log: ['create t1', 'create t2', `save ${def.id}`],
	});
	const clash = await run({ refuseTimeline: 't2' });
	check(
		'6 a refused timeline: the def is never saved and the created one is taken back',
		clash.log,
		['create t1', 'create t2', 'delete t1'],
	);
	check('6 and says which', clash.message?.startsWith('Could not copy timeline "t2"'), true);
	const refused = await run({ def: { refused: 'Invalid component.' } });
	check('6 a refused def: every timeline is taken back', refused, {
		message: 'Could not save the copy: Invalid component.',
		log: ['create t1', 'create t2', `save ${def.id}`, 'delete t1', 'delete t2'],
	});
	for (const outcome of ['unknown', 'throw'] as const) {
		const lost = await run({ def: outcome });
		check(
			`6 a def save with no answer (${outcome}) may have landed: nothing is deleted`,
			[
				lost.log.some((l) => l.startsWith('delete')),
				lost.message?.includes('Reload to check'),
				lost.message?.includes('(t1, t2)'),
			],
			[false, true, true],
		);
	}
	const stuck = await run({ def: { refused: 'No.' }, failDelete: 't2' });
	check(
		'6 a timeline that could not be taken back is named',
		stuck.message,
		'Could not save the copy: No. Its timelines t2 could not be removed; delete them in Animate.',
	);
}

// 7. The workspace wiring.
{
	const workspace = readFileSync(
		new URL('../src/routes/(app)/editor/ComponentWorkspace.svelte', import.meta.url),
		'utf8',
	);
	const fn = workspace.slice(workspace.indexOf('async function duplicateComponentDef'));
	const body = fn.slice(0, fn.indexOf('\n\t}\n'));
	check(
		'7 asks about unsaved changes first, and again if they changed during the reads',
		body.match(/confirmLeaveDraft\('Discard and duplicate'\)/g)?.length,
		2,
	);
	check(
		'7 reads the def the project shows (project, shared, built-in)',
		body.includes('/api/editor/component?id='),
		true,
	);
	check(
		'7 timelines are created create-only',
		body.includes("cinematic('save', { doc, baseEtag: null })"),
		true,
	);
	check(
		'7 the def saves create-only, never stacked on top',
		[body.includes('saveState.save({ force: false })'), body.includes('saveComponent(')],
		[true, false],
	);
	check(
		'7 a save the server answered counts as saved, even after the tab moved on',
		body.includes("if (componentEtags[copyDef.id] !== undefined) return 'saved';"),
		true,
	);
	check(
		'7 a refusal is only a refusal once the copy is confirmed absent (404)',
		body.includes("if (stored?.status !== 404) return 'unknown';"),
		true,
	);
	check(
		'7 only the copy itself is closed on a refusal',
		body.includes('if (componentDraft?.id === copyDef.id) await closeComponent(true);'),
		true,
	);
	check(
		'7 the copy opens at the top of the breadcrumb',
		body.includes('trail = [];\n\t\t\t\t\trootLabel = null;'),
		true,
	);
	check(
		'7 the list and ＋ New are held while it runs',
		[
			/if \(duplicating\) \{\s*navStatus = [^\n]*\n\s*return false;/.test(workspace),
			workspace.includes('if (!name || duplicating) return;'),
		],
		[true, true],
	);
	check(
		'7 edits made while the timelines are written refuse the copy (and roll them back)',
		/saveDef: async \(copyDef\) => \{\s*\/\/[^\n]*\n\s*if \(leaveSignature\(\) !== asked && unsavedWork\) \{\s*return \{\s*refused:/.test(
			body,
		),
		true,
	);
	check(
		"7 fresh timeline ids clear every listed timeline of the project, not just the source's",
		body.includes('takenTimelineIds: [...listed, ...BUILTIN_TIMELINES]'),
		true,
	);
	check(
		'7 a listed timeline that reads back empty stops the copy',
		body.includes('componentTimelinesOf(listed, source.id).length !== projectDocs.length'),
		true,
	);
	check(
		'7 closing, leaving for the screens and deleting are held too',
		[
			workspace.includes('if (!confirmed && duplicating) return false;'),
			/async function exitToScreens\(\): Promise<void> \{\s*if \(duplicating\) return;/.test(
				workspace,
			),
			workspace.includes('if (writesBlocked || duplicating) return;'),
		],
		[true, true, true],
	);
	check('7 ⧉ on both lists', workspace.match(/\{@render duplicateButton\(def\)\}/g)?.length, 2);
}

if (failures) {
	console.error(`${failures} of ${checks} component-duplicate checks FAILED`);
	process.exit(1);
}
console.log(`component-duplicate: all ${checks} checks passed`);
