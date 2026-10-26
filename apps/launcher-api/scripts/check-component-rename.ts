/**
 * The Components list's ✎ Rename (`componentRename.client.ts` + `renameComponentDef` in
 * `ComponentWorkspace.svelte`):
 *   pnpm --filter launcher-api check:component-rename
 *
 *  1. the name: trimmed, never empty, never another listed component's (case-blind), its own is
 *     fine; only the project's own components rename (a shared or built-in one is duplicated first);
 *  2. through the REAL route over an in-memory R2: a rename keeps the id and the version (no new
 *     snapshot, so no pinned placement is flagged "↑ vN"), the version's snapshot keeps the name it
 *     was saved under, and the next content change still bumps;
 *  3. it is a CAS on the ETag it read: a save landing between the read and the write refuses the
 *     rename and leaves the stored def as that save wrote it; a def the project no longer owns is
 *     never written;
 *     a built-in's project copy renames from its stored bytes, not the merged def, so it keeps its
 *     version too;
 *  4. the open draft takes the new name in place, its saved baseline too (unsaved edits stay
 *     unsaved);
 *  5. the workspace wiring: ✎ on both lists, a tooltip pointing shared and built-in rows at ⧉, the
 *     draft save held while it runs, the new ETag adopted only by a draft based on what was read,
 *     and no placement label rewritten (timelines bind nodes by label).
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import type { ComponentDef } from 'engine-layout';
import type { RenameWrites } from '../src/routes/(app)/editor/componentRename.client.ts';

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

const { projectComponentKey, projectComponentVersionKey } =
	await import('../src/lib/server/projectPaths.ts');
const { loadComponent } = await import('../src/lib/server/componentStorage.ts');
const { BUILTIN_COMPONENTS, mergeBuiltinCodedParams } = await import('engine-layout');
const componentRoute = await import('../src/routes/api/editor/component/+server.ts');
const { canRenameComponent, componentRenameProblem, renamedSnapshot, writeComponentRename } =
	await import('../src/routes/(app)/editor/componentRename.client.ts');

type RouteEvent = Parameters<typeof componentRoute.POST>[0];
const locals = { user: { id: 'u', role: 'admin' } };
async function call(
	handler: (event: RouteEvent) => Promise<Response>,
	url: URL,
	init?: RequestInit,
): Promise<{ status: number; body: unknown }> {
	const event = { request: new Request(url, init), url, locals };
	try {
		const res = await handler(event as unknown as RouteEvent);
		return { status: res.status, body: await res.json() };
	} catch (e) {
		const http = e as { status?: number; body?: { message?: string } };
		if (typeof http.status !== 'number') throw e;
		return { status: http.status, body: http.body ?? {} };
	}
}
const post = (body: unknown) =>
	call(componentRoute.POST, new URL('http://launcher.test/api/editor/component'), {
		method: 'POST',
		body: JSON.stringify(body),
	});
const get = (id: string) =>
	call(
		componentRoute.GET,
		new URL(`http://launcher.test/api/editor/component?id=${id}&project=${PROJECT}&stored=project`),
	);
const routeWrites: RenameWrites = {
	read: async (id) => {
		const res = await get(id);
		if (res.status !== 200) return { status: res.status };
		const body = res.body as { def: ComponentDef; etag: string | null };
		return { def: body.def, etag: body.etag };
	},
	save: async (def, baseEtag) => {
		const res = await post({ ...def, project: PROJECT, baseEtag });
		const body = res.body as { version?: number; etag?: string | null; message?: string };
		if (res.status !== 200) return { status: res.status, message: body.message ?? 'refused' };
		return { version: body.version as number, etag: body.etag ?? null };
	},
};

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

// 1. The name, and who may rename.
{
	const listed = [
		{ id: 'c_a', name: 'Pot Meter' },
		{ id: 'c_b', name: 'Counter Segment' },
	];
	check(
		'1 its own name, other case, is fine',
		componentRenameProblem(' pot meter ', 'c_a', listed),
		null,
	);
	check('1 a free name is fine', componentRenameProblem('Pot Meter 2', 'c_a', listed), null);
	check(
		'1 empty and blank are refused',
		[componentRenameProblem('', 'c_a', listed), componentRenameProblem('   ', 'c_a', listed)],
		['The name cannot be empty.', 'The name cannot be empty.'],
	);
	check(
		"1 another component's name is refused, case-blind and trimmed",
		componentRenameProblem('  counter SEGMENT ', 'c_a', listed),
		'Another component of this project is already called "Counter Segment".',
	);
	check(
		'1 only project components rename',
		(['project', 'shared', 'builtin'] as const).map((scope) => canRenameComponent({ scope })),
		[true, false, false],
	);
}

const ID = 'c_rename01';
const def: ComponentDef = {
	id: ID,
	name: 'Pot Meter',
	version: 1,
	scope: 'project',
	category: 'ui',
	root: {
		id: 'n_root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [{ id: 'n_t', kind: 'text', label: 'Pot Meter', text: 'x', x: 0, y: 0 }],
	} as ComponentDef['root'],
};
const stored = (): ComponentDef => JSON.parse(bucket.get(projectComponentKey(PROJECT, ID))!.text);
const snapshot = (v: number): ComponentDef | null => {
	const hit = bucket.get(projectComponentVersionKey(PROJECT, ID, v));
	return hit ? JSON.parse(hit.text) : null;
};

// 2. Through the real route: the id and the version stay.
{
	check('2 created', (await post({ ...def, project: PROJECT, baseEtag: null })).status, 200);
	const v1Etag = bucket.get(projectComponentKey(PROJECT, ID))!.etag;
	const edited = { ...def, category: 'overlay' };
	const v2 = await post({ ...edited, project: PROJECT, baseEtag: v1Etag });
	check('2 a content change bumps to v2', (v2.body as { version: number }).version, 2);
	const keysBefore = [...bucket.keys()].sort();
	const result = await writeComponentRename(ID, '  Jackpot Pot  ', routeWrites);
	check(
		'2 renamed: trimmed name, same id, same version',
		'def' in result && [result.def.id, result.def.name, result.def.version],
		[ID, 'Jackpot Pot', 2],
	);
	check(
		'2 stored under the new name at the same version',
		[stored().id, stored().name, stored().version, stored().category],
		[ID, 'Jackpot Pot', 2, 'overlay'],
	);
	check(
		'2 no new snapshot is written (no "↑ vN" for a pin)',
		[...bucket.keys()].sort(),
		keysBefore,
	);
	check(
		"2 the version's snapshot keeps the name it was saved under",
		snapshot(2)?.name,
		'Pot Meter',
	);
	check('2 a pinned read of v2 still resolves', (await loadComponent(ID, PROJECT, 2))?.version, 2);
	check(
		'2 the node labels inside are untouched',
		JSON.stringify(stored().root).includes('"label":"Pot Meter"'),
		true,
	);
	check(
		'2 the returned ETag is the stored one',
		'def' in result && result.etag,
		bucket.get(projectComponentKey(PROJECT, ID))!.etag,
	);
	const again = await post({
		...stored(),
		category: 'ui',
		project: PROJECT,
		baseEtag: 'def' in result ? result.etag : null,
	});
	check('2 the next content change still bumps', (again.body as { version: number }).version, 3);
	check('2 and its snapshot carries the new name', snapshot(3)?.name, 'Jackpot Pot');
	const beforeGuides = [...bucket.keys()].sort();
	const guided = await post({
		...stored(),
		guides: { desktop: { x: [120], y: [40] } },
		project: PROJECT,
		baseEtag: bucket.get(projectComponentKey(PROJECT, ID))!.etag,
	});
	check(
		'2 a guides-only save keeps the version (ruler guides are editor-only)',
		[(guided.body as { version: number }).version, stored().guides],
		[3, { desktop: { x: [120], y: [40] } }],
	);
	check('2 and writes no new snapshot', [...bucket.keys()].sort(), beforeGuides);
}

// 3. A CAS on what was read.
{
	const before = stored();
	const raced = await writeComponentRename(ID, 'Raced', {
		read: routeWrites.read,
		save: async (renamed, baseEtag) => {
			const etag = bucket.get(projectComponentKey(PROJECT, ID))!.etag;
			await post({ ...before, category: 'scenery', project: PROJECT, baseEtag: etag });
			return routeWrites.save(renamed, baseEtag);
		},
	});
	check(
		'3 a save landing in between refuses the rename',
		'problem' in raced && raced.problem.startsWith('Someone else saved this component'),
		true,
	);
	check(
		'3 and the stored def is what that save wrote',
		[stored().name, stored().category, stored().version],
		['Jackpot Pot', 'scenery', 4],
	);
	let saved = false;
	const shared = await writeComponentRename('c_shared', 'Mine', {
		read: async () => ({ def: { ...def, id: 'c_shared', scope: 'shared' }, etag: '"s1"' }),
		save: async () => {
			saved = true;
			return { version: 1, etag: null };
		},
	});
	check(
		'3 a def the project no longer owns is never written',
		[saved, 'problem' in shared],
		[false, true],
	);
	const missing = await writeComponentRename('c_missing', 'X', routeWrites);
	check(
		'3 a read that fails says so',
		'problem' in missing && missing.problem,
		'Could not read the component (404).',
	);
}

// 3b. A project copy of a built-in, stored before its coded twin gained params: the rename saves
// the stored def back (not the merged one the editor opens), so it still keeps the version.
{
	const twin = BUILTIN_COMPONENTS.find((b) => (b.params?.length ?? 0) > 1);
	if (!twin) throw new Error('no built-in with params to test against');
	const copy = { ...structuredClone(twin), scope: 'project' as const, version: 3 };
	copy.params = copy.params?.slice(0, 1);
	check(
		'3b the coded twin adds what the stored copy lacks',
		JSON.stringify(mergeBuiltinCodedParams(copy)) === JSON.stringify(copy),
		false,
	);
	check('3b stored', (await post({ ...copy, project: PROJECT, baseEtag: null })).status, 200);
	const key = projectComponentKey(PROJECT, twin.id);
	const keysBefore = [...bucket.keys()].sort();
	const result = await writeComponentRename(twin.id, 'My Twin', routeWrites);
	const after = JSON.parse(bucket.get(key)!.text) as ComponentDef;
	check(
		'3b renamed at the same version, nothing merged in',
		['def' in result && result.def.version, after.version, after.name, after.params?.length],
		[3, 3, 'My Twin', 1],
	);
	check('3b no new snapshot', [...bucket.keys()].sort(), keysBefore);
	check(
		'3b a component the project has no copy of reads 404 (never the shared or built-in one)',
		(await get('c_nowhere')).status,
		404,
	);
}

// 4. The open draft's saved baseline.
{
	const draft = { ...def, category: 'overlay' };
	const baseline = JSON.stringify(def);
	const patched = renamedSnapshot(baseline, 'New');
	check('4 the name replaced, key order kept', patched, JSON.stringify({ ...def, name: 'New' }));
	check(
		'4 an unsaved edit stays unsaved',
		JSON.stringify({ ...draft, name: 'New' }) === patched,
		false,
	);
}

// 5. The workspace wiring.
{
	const workspace = readFileSync(
		new URL('../src/routes/(app)/editor/ComponentWorkspace.svelte', import.meta.url),
		'utf8',
	);
	const fn = workspace.slice(workspace.indexOf('async function renameComponentDef'));
	const body = fn.slice(0, fn.indexOf('\n\t}\n'));
	check('5 ✎ on both lists', workspace.match(/\{@render renameButton\(def\)\}/g)?.length, 2);
	check(
		'5 shared and built-in rows point at ⧉',
		workspace.includes("'Duplicate it first to rename your copy'"),
		true,
	);
	check(
		'5 only own components, never past the lease',
		body.includes(
			'if (!canRenameComponent(def) || (componentDraft?.id === def.id && lease.readOnly)) return;',
		),
		true,
	);
	check(
		'5 the name is checked before any write',
		body.includes('componentRenameProblem(name, def.id, components)'),
		true,
	);
	check(
		'5 the draft save is held while it runs',
		workspace.includes('blockWhen: () => lease.readOnly || writesBlocked || renaming,'),
		true,
	);
	check(
		'5 the new ETag is adopted only by a draft based on what was read',
		body.includes('if (saveState.etag === result.readEtag) saveState.adoptEtag(result.etag);'),
		true,
	);
	check(
		'5 the open draft and its baseline take the new name',
		[
			body.includes('componentDraft.name = renamed.name;'),
			body.includes('savedSnapshot = renamedSnapshot(savedSnapshot, renamed.name)'),
			body.includes('componentDraft.version'),
		],
		[true, true, false],
	);
	check(
		'5 the list entry is merged with its coded twin, as every listed def is',
		body.includes('const renamed = mergeBuiltinCodedParams(result.def);'),
		true,
	);
	check(
		'5 reads the stored project def, not the merged one',
		body.includes('&stored=project'),
		true,
	);
	check(
		'5 waits while the open draft is still reading its ETag',
		body.includes('saveState.etag === null'),
		true,
	);
	check('5 no placement label is rewritten', /\.label\s*=/.test(body), false);
}

if (failures) {
	console.error(`${failures} of ${checks} component-rename checks FAILED`);
	process.exit(1);
}
console.log(`component-rename: all ${checks} checks passed`);
