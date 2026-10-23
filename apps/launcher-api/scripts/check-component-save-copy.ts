/**
 * Saving an edited shared or built-in component inside a project (owner report 2026-10-23: the
 * re-skinned Counter Segment answered "Save failed", the console a 400 on every save and a 400 on
 * `/api/editor/asset?key=`):
 *   pnpm --filter launcher-api check:component-save-copy
 *
 *  1. the cause, kept as a regression record: the request the editor used to send for a built-in
 *     (`scope:'shared'`, no project) answers 400 through the real route once the segment places
 *     this project's rig, with the server's reason naming the rig;
 *  2. `componentSaveRequest` sends a shared/built-in draft as this project's copy under the same
 *     id, creating it (`baseEtag: null`, whatever the shared key's etag was); through the real
 *     route the segment, the Segmented Counter bar and a new component that places a rig each save
 *     (200) to the project key, and a forced save still carries `force` alone;
 *  3. a project draft keeps its own precondition, and with no project open a shared draft still
 *     saves to the shared library;
 *  4. the editor shows the server's reason: `componentSaveError` reads it (status when absent) and
 *     the Component Editor's error pill renders the message, not a bare "Save failed";
 *  5. no empty-key asset request: `canvasImageUrl('')` is `null`, a real key keeps its URL, and
 *     the canvas builds every full-image URL through it.
 *
 * Runs the REAL route handler and `saveComponent` over an in-memory R2.
 */
import { readFileSync } from 'node:fs';
import { mock } from 'node:test';
import type { ComponentDef, ContainerNode, LayoutNode } from 'engine-layout';

const CLIENT = 'invisible_wall';
const PROJECT = 'commonoverlayproject';
const RIG = `${CLIENT}/${PROJECT}/spines/R_RespinTile/`;

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
// The rig is this project's own and is not in the shared rig library.
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

const { editorComponentKey, projectComponentKey } =
	await import('../src/lib/server/projectPaths.ts');
const { SEGMENTED_COUNTER_DEF, SEGMENTED_COUNTER_SEGMENT_DEF } = await import('engine-layout');
const componentRoute = await import('../src/routes/api/editor/component/+server.ts');
const { componentSaveError, componentSaveRequest } =
	await import('../src/routes/(app)/editor/componentSave.client.ts');
const { canvasImageUrl } = await import('../src/routes/(app)/editor/editorRegions.client.ts');

type RouteEvent = Parameters<typeof componentRoute.POST>[0];
/** POST `body` through the real route as an admin; a thrown `error()` reads as its response. */
async function post(body: unknown): Promise<{ status: number; message?: string }> {
	const url = new URL('http://launcher.test/api/editor/component');
	const request = new Request(url, { method: 'POST', body: JSON.stringify(body) });
	const event = { request, url, locals: { user: { id: 'u', role: 'admin' } } };
	try {
		const res = await componentRoute.POST(event as unknown as RouteEvent);
		const out = (await res.json()) as { message?: string };
		return { status: res.status, message: out.message };
	} catch (e) {
		const http = e as { status?: number; body?: { message?: string } };
		if (typeof http.status !== 'number') throw e;
		return { status: http.status, message: http.body?.message };
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

const rigNode = (id: string): LayoutNode => ({
	id,
	label: 'R_RespinTile',
	kind: 'spine',
	x: 40,
	y: 28,
	assetKey: RIG,
});
/** The owner's edit: each look's art replaced by the project's `R_RespinTile` rig. */
function reskinnedSegment(): ComponentDef {
	const def = structuredClone(SEGMENTED_COUNTER_SEGMENT_DEF);
	for (const child of def.root.children) {
		if (child.kind === 'container') child.children = [rigNode(`${child.id}-rig`)];
	}
	return def;
}
const storedScope = (key: string): unknown =>
	(JSON.parse(bucket.get(key)?.text ?? '{}') as { scope?: unknown }).scope;

// 1. The cause: the shared save the editor used to send.
{
	const draft = reskinnedSegment();
	const res = await post({ ...draft, baseEtag: null });
	check('1 a built-in saved to the shared library with a project rig is a 400', res.status, 400);
	check(
		'1 the reason names the rig and the fix',
		[res.message?.includes(RIG), res.message?.includes('shared rig library')],
		[true, true],
	);
	check('1 nothing was written', bucket.has(editorComponentKey(draft.id)), false);
}

// 2. A shared/built-in draft saves as this project's copy.
{
	const draft = reskinnedSegment();
	const { body, copiesToProject } = componentSaveRequest(draft, PROJECT, {
		baseEtag: '"shared-etag"',
		force: false,
	});
	check('2 the segment copies to the project', copiesToProject, true);
	check(
		'2 the copy keeps the id, is project-scoped and creates',
		[body.id, body.scope, body.project, body.baseEtag, 'force' in body],
		[draft.id, 'project', PROJECT, null, false],
	);
	check('2 the draft passed in is not mutated', draft.scope, 'shared');
	const res = await post(body);
	check('2 the segment copy saves', [res.status, res.message], [200, undefined]);
	const key = projectComponentKey(PROJECT, draft.id);
	check('2 stored as the project copy', storedScope(key), 'project');
	check('2 the shared library is untouched', bucket.has(editorComponentKey(draft.id)), false);

	const forced = componentSaveRequest(draft, PROJECT, { baseEtag: '"x"', force: true }).body;
	check('2 a forced copy carries force alone', [forced.force, 'baseEtag' in forced], [true, false]);
	check('2 a forced copy saves on top', (await post(forced)).status, 200);

	const bar = structuredClone(SEGMENTED_COUNTER_DEF);
	bar.name = 'Respin bar';
	const barReq = componentSaveRequest(bar, PROJECT, { baseEtag: null, force: false });
	check('2 the Segmented Counter bar copies', barReq.copiesToProject, true);
	check('2 the bar copy saves', (await post(barReq.body)).status, 200);
	check(
		'2 bar stored in the project',
		storedScope(projectComponentKey(PROJECT, bar.id)),
		'project',
	);

	const root: ContainerNode = {
		id: 'c_new_root',
		kind: 'container',
		x: 0,
		y: 0,
		children: [rigNode('c_new_rig')],
	};
	const fresh: ComponentDef = {
		id: 'c_new',
		name: 'My tile',
		version: 1,
		scope: 'project',
		category: 'ui',
		root,
	};
	const freshReq = componentSaveRequest(fresh, PROJECT, { baseEtag: null, force: false });
	check('2 a new component is not a copy', freshReq.copiesToProject, false);
	check('2 a new component that places a rig saves', (await post(freshReq.body)).status, 200);
}

// 3. Other scopes keep their own target.
{
	const own: ComponentDef = { ...reskinnedSegment(), scope: 'project' };
	const req = componentSaveRequest(own, PROJECT, { baseEtag: '"p1"', force: false });
	check(
		'3 a project draft keeps its precondition',
		[req.copiesToProject, req.body.baseEtag, req.body.project],
		[false, '"p1"', PROJECT],
	);
	const shared = componentSaveRequest(SEGMENTED_COUNTER_SEGMENT_DEF, '', {
		baseEtag: '"s1"',
		force: false,
	});
	check(
		'3 no project open: a shared draft saves to the shared library',
		[shared.copiesToProject, shared.body.scope, 'project' in shared.body, shared.body.baseEtag],
		[false, 'shared', false, '"s1"'],
	);
}

// 4. The editor shows the server's reason.
{
	const json = (status: number, body: unknown): Response =>
		new Response(JSON.stringify(body), { status });
	check(
		'4 the server message is shown',
		await componentSaveError(json(400, { message: 'Places a rig from another project.' })),
		'Places a rig from another project.',
	);
	check(
		'4 no message: the status is shown',
		await componentSaveError(new Response('oops', { status: 502 })),
		'Component save failed (502).',
	);
	const workspace = readFileSync(
		new URL('../src/routes/(app)/editor/ComponentWorkspace.svelte', import.meta.url),
		'utf8',
	);
	check(
		'4 the error pill renders the message',
		/<span class="save-pill error"[^>]*>\{saveStatus\.message\}<\/span>/.test(workspace),
		true,
	);
	check(
		'4 the draft save builds its request with the helper',
		workspace.includes('componentSaveRequest('),
		true,
	);
}

// 5. No empty-key asset request.
{
	check('5 an empty key requests nothing', canvasImageUrl('', '0'), null);
	check(
		'5 a real key keeps its gated URL',
		canvasImageUrl('a/b/page.png', '0'),
		'/api/editor/asset?key=a%2Fb%2Fpage.png&v=0',
	);
	check(
		'5 a static page is served directly',
		canvasImageUrl('/builtin/p.png', '0'),
		'/builtin/p.png',
	);
	const canvas = readFileSync(
		new URL('../src/routes/(app)/editor/EditorCanvas.svelte', import.meta.url),
		'utf8',
	);
	check(
		'5 the canvas builds image URLs only through canvasImageUrl',
		[canvas.includes('canvasImageUrl(key,'), canvas.includes('/api/editor/asset?key=')],
		[true, false],
	);
}

if (failures) {
	console.error(`${failures} of ${checks} component-save-copy checks FAILED`);
	process.exit(1);
}
console.log(`component-save-copy: all ${checks} checks passed`);
