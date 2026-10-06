/**
 * Contract check for Invisible Director's owner API (PLAN 4A; ADR-0003, ADR-0005, ADR-0006):
 *   pnpm --filter launcher-api check:director-runs
 *
 * Runs the REAL `director/{runs,ownerActions,access,api,fontRequests,mockups}.ts`, the routes under
 * `/api/director/{runs,estimate,templates,fonts,mockups}`, `requireProjectScope`, the pricing
 * loader, the `director-costs` estimator and the worker's own state machine
 * (`services/director-worker/src/runState.ts`). Replaced at their boundaries: R2 (in memory),
 * the Postgres-backed modules (the Director store, projects, clients, overrides, settings), the
 * duplicate path, the template summary and the font catalog. `fetch` throws for the whole run.
 *
 * Pinned:
 *  - the ownership refusal blocks both create and start, and neither writes anything then;
 *  - a run that is not the caller's, one whose project they cannot reach, and an unknown id all
 *    get the same 404 — for the summary and for every action;
 *  - from EVERY run status, each owner action either writes exactly one `director_events` row
 *    the worker's `transition()` accepts from that state, or is refused (409) and writes none —
 *    the launcher's allow-list equals the worker's machine, state by state;
 *  - a replayed request id answers the same event id and writes nothing new; the same id with
 *    another input is refused;
 *  - the estimate makes no RunPod call and no model call, and the profiles price every agent at
 *    the model its definition names;
 *  - create derives the run id from the request id, copies the ownership stamp into the starting
 *    point, snapshots the budget cap, and leaves nothing behind when the copy fails;
 *  - font requests list and mark done, once the font is in the catalog;
 *  - the run's image and variant routes serve only the owner's own project's images, as the type
 *    the bytes are, and a key or name that is not one is the same 404;
 *  - the summary names the project's first game's URL, or null.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import { isHttpError } from '@sveltejs/kit';
import type { DirectorEvent, DirectorRun, Project } from '../src/lib/server/db/schema.ts';
import type { ProjectSummary } from '../src/lib/server/director/templates.ts';
import {
	RUN_STATUSES,
	transition,
	type RunEvent,
	type RunState,
} from '../../../services/director-worker/src/runState.ts';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
const srcPath = (rel: string) => fileURLToPath(src(rel));
const AGENTS_DIR = fileURLToPath(
	new URL('../../../services/director-worker/agents/', import.meta.url),
);

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

function exportNames(rel: string): string[] {
	const text = readFileSync(srcPath(rel), 'utf8');
	const names = new Set<string>();
	for (const m of text.matchAll(/^export (?:async )?(?:function\*?|class|const|let) (\w+)/gm)) {
		names.add(m[1]);
	}
	for (const m of text.matchAll(/^export \{([^}]+)\}/gm)) {
		for (const part of m[1].split(',')) {
			const name = part
				.trim()
				.split(/\s+as\s+/)
				.pop();
			if (name && !name.startsWith('type ')) names.add(name);
		}
	}
	return [...names];
}
function fake(rel: string, impl: Record<string, unknown>): void {
	const namedExports: Record<string, unknown> = {};
	for (const name of exportNames(rel)) {
		namedExports[name] =
			name in impl
				? impl[name]
				: () => {
						throw new Error(`fixture: ${rel} ${name} is not faked`);
					};
	}
	for (const name of Object.keys(impl)) {
		if (!(name in namedExports)) throw new Error(`fixture: ${rel} has no export ${name}`);
	}
	mock.module(src(rel), { namedExports });
}

// Nothing here may reach the network: not RunPod, not Anthropic, not R2.
globalThis.fetch = (() => {
	throw new Error('fixture: fetch was called');
}) as typeof fetch;

// ── In-memory R2 ──────────────────────────────────────────────────────────────
type Obj = { body: string; etag: string };
type Cond = { ifMatch?: string; ifNoneMatch?: string } | undefined;
const R2 = new Map<string, Obj>();
let puts = 0;
let etagSeq = 0;
class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
function put(key: string, body: string, cond: Cond): string {
	puts++;
	const cur = R2.get(key);
	if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
	if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
	const next = { body, etag: `"e${++etagSeq}"` };
	R2.set(key, next);
	return next.etag;
}
/** Objects with real bytes (the text map above cannot hold a PNG header). */
const BIN = new Map<string, Uint8Array>();
const keysUnder = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();
fake('lib/server/r2.ts', {
	ConflictError,
	precondition: (base: string | null | undefined) =>
		base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
	getObjectText: async (key: string) => R2.get(key)?.body ?? null,
	getObjectTextWithEtag: async (key: string) => {
		const o = R2.get(key);
		return o ? { text: o.body, etag: o.etag } : null;
	},
	putObjectText: async (key: string, s: string, _type: string, cond?: Cond) => put(key, s, cond),
	getObjectBytes: async (key: string) => {
		const bin = BIN.get(key);
		if (bin) return { body: bin, contentType: 'application/octet-stream', etag: '"bin"' };
		const o = R2.get(key);
		return o
			? { body: new TextEncoder().encode(o.body), contentType: 'image/png', etag: o.etag }
			: null;
	},
	headObject: async (key: string) => {
		const bin = BIN.get(key);
		if (bin) return { etag: '"bin"', size: bin.byteLength, lastModified: 0 };
		const o = R2.get(key);
		return o
			? { etag: o.etag, size: new TextEncoder().encode(o.body).byteLength, lastModified: 0 }
			: null;
	},
	deleteObject: async (key: string) => void R2.delete(key),
	objectExists: async (key: string) => R2.has(key),
	listAllKeys: async (prefix: string) => keysUnder(prefix),
	listObjects: async (prefix: string) => ({ keys: keysUnder(prefix), prefixes: [] }),
});
fake('lib/server/director/mockupPixels.ts', { MODEL_LONG_EDGE: 1568 });

// ── Projects, clients, templates ──────────────────────────────────────────────
type Proj = { client: string | null; gameType: string; template: boolean; deleted?: boolean };
const PROJECTS = new Map<string, Proj>([
	['cloud', { client: null, gameType: 'lines', template: false }],
	['hw', { client: 'acme', gameType: 'holdAndWin', template: true }],
	['hw-unpublished', { client: 'acme', gameType: 'holdAndWin', template: true }],
	['lines-sample', { client: 'acme', gameType: 'lines', template: true }],
	['other-game', { client: 'other', gameType: 'lines', template: false }],
	['gone', { client: 'acme', gameType: 'lines', template: false, deleted: true }],
]);
const PUBLISHED = new Set(['hw', 'lines-sample', 'other-game']);
const CLIENTS = new Set(['acme', 'other']);
/** userId → client keys granted (admins reach everything). */
const GRANTS = new Map<string, Set<string>>([
	['art', new Set(['acme'])],
	['owner', new Set(['acme'])],
]);
const live = (key: string) => {
	const p = PROJECTS.get(key);
	return p && !p.deleted ? p : undefined;
};
const asProject = (key: string, p: Proj): Project =>
	({
		key,
		name: `Project ${key}`,
		clientKey: p.client,
		gameType: p.gameType,
		directorTemplate: p.template,
		deletedAt: p.deleted ? new Date() : null,
		createdAt: new Date('2026-10-01T00:00:00Z'),
	}) as unknown as Project;
const canAccess = async (userId: string, role: string, key: string) => {
	const p = live(key);
	if (!p) return false;
	if (role === 'admin' || key === 'cloud') return true;
	return p.client !== null && (GRANTS.get(userId)?.has(p.client) ?? false);
};
fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	isValidProjectKey: (v: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),
	canAccessProject: canAccess,
	projectClientKey: async (key: string) => live(key)?.client ?? null,
	projectExists: async (key: string) => live(key) !== undefined,
	projectKeyTaken: async (key: string) => PROJECTS.has(key),
	projectName: async (key: string) => (live(key) ? `Project ${key}` : null),
	listDirectorTemplateProjects: async () =>
		[...PROJECTS].filter(([, p]) => p.template && !p.deleted).map(([k, p]) => asProject(k, p)),
});
fake('lib/server/clients.ts', {
	listClients: async () => [...CLIENTS].sort().map((key) => ({ key, name: `Client ${key}` })),
	clientGrantsOf: async (userId: string) => [...(GRANTS.get(userId) ?? [])],
	clientExists: async (key: string) => CLIENTS.has(key),
	mayCreateUnderClient: async (userId: string, role: string, client: string | null) =>
		role === 'admin' || client === null || (GRANTS.get(userId)?.has(client) ?? false),
});
/** Games a project owns beyond the published templates', in the order the DB lists them. */
const OWNED_GAMES = new Map<string, { key: string; url: string }[]>();
fake('lib/server/games.ts', {
	listGamesOwnedByProject: async (key: string) =>
		OWNED_GAMES.get(key) ?? (PUBLISHED.has(key) ? [{ key, url: `https://play.test/${key}/` }] : []),
});
fake('lib/server/gameKinds.ts', {
	selectableGameKinds: async () => [
		{ id: 'lines', name: 'Lines' },
		{ id: 'holdAndWin', name: 'Hold and Win' },
	],
});
// Artists hold Invisible Director and Game Maker here, so a non-admin owner exercises the project
// rules; `nogm` had Game Maker revoked.
fake('lib/server/roleToolAccess.ts', {
	getRoleOverrides: async (role: string) =>
		role === 'artist' ? { director: true, gameMaker: true } : {},
});
fake('lib/server/userToolAccess.ts', {
	getToolOverrides: async (userId: string) => (userId === 'nogm' ? { gameMaker: false } : {}),
});
fake('lib/server/auth.ts', { SESSION_COOKIE: 'iw_session' });
fake('lib/server/appSettings.ts', {
	getAppSetting: async () => undefined,
	getDirectorRunBudget: async () => 25,
});
fake('lib/server/gameConfigStorage.ts', {
	loadGameConfigDocWithEtag: async (client: string, project: string) => ({
		doc: null,
		etag: R2.get(`${client}/${project}/config/config.json`)?.etag ?? null,
		existed: R2.has(`${client}/${project}/config/config.json`),
	}),
});
// The template's math contract, whose ETag the create records for the math-lock check.
put('acme/hw/config/config.json', '{"rtp":0.96}', undefined);
const REGION_GROUPS = [
	{ atlas: 'symbols', manifestKey: 'm', regions: 11 },
	{ atlas: 'ui', manifestKey: 'm', regions: 14 },
];
fake('lib/server/director/templates.ts', {
	loadSummaryContext: async () => ({}),
	summarizeProject: async (project: Project): Promise<ProjectSummary> => ({
		key: project.key,
		name: project.name,
		clientKey: project.clientKey,
		gameType: project.gameType,
		gameTypeName: project.gameType,
		published: PUBLISHED.has(project.key),
		chips: { game: [], using: [] },
		lockedItems: [],
		regionGroups: REGION_GROUPS,
		configEtag: null,
	}),
});
// Atlas-tool, as the variant route reaches it: every call is recorded and answered by `atlasAnswer`.
type AtlasCtx = {
	agent: string;
	owner: { id: string };
	scope: { clientKey: string; projectKey: string } | null;
	run: { id: string };
	savedBy: { tool: string; agent: string; runId: string; uid: string };
};
type AtlasCallIn = {
	method: string;
	path: string;
	atlas?: string;
	query?: Record<string, string>;
};
const ATLAS_CALLS: { ctx: AtlasCtx; call: AtlasCallIn }[] = [];
const atlasBytes = (contentType: string, bytes: Uint8Array) => ({
	status: 200,
	contentType,
	headers: new Headers({ 'content-type': contentType }),
	bytes,
	text: () => new TextDecoder().decode(bytes),
	json: () => JSON.parse(new TextDecoder().decode(bytes)),
});
let atlasAnswer: (call: AtlasCallIn) => ReturnType<typeof atlasBytes> = () => {
	throw new Error('fixture: no atlas answer set');
};
fake('lib/server/director/atlasClient.ts', {
	atlasFetch: async (ctx: AtlasCtx, call: AtlasCallIn) => {
		ATLAS_CALLS.push({ ctx, call });
		return atlasAnswer(call);
	},
});

// The duplicate path: a new project row and a marker object, or a failure on demand.
let failNextDuplicate = false;
let duplicates = 0;
fake('lib/server/duplicateProject.ts', {
	duplicateProject: async (
		user: { id: string; role: string },
		input: { source: string; key: string; name: string; clientKey: string | null },
	) => {
		if (!(await canAccess(user.id, user.role, input.source))) {
			return { ok: false, status: 404, error: 'Unknown source project' };
		}
		if (live(input.key))
			return { ok: false, status: 409, error: 'A project with that key exists.' };
		if (failNextDuplicate) {
			failNextDuplicate = false;
			return { ok: false, status: 502, error: 'Duplicate failed: boom' };
		}
		duplicates++;
		const source = PROJECTS.get(input.source)!;
		PROJECTS.set(input.key, {
			client: input.clientKey,
			gameType: source.gameType,
			template: false,
		});
		put(`${input.clientKey ?? '_unassigned'}/${input.key}/config/config.json`, '{}', undefined);
		return { ok: true, key: input.key, copied: 3, rebased: 1, skipped: 0 };
	},
});

// Fonts the project's game can render.
const FONTS = new Map<string, { id: string; folder: string }[]>();
fake('lib/server/fonts.ts', {
	loadRenderableFonts: async (_client: string, project: string) =>
		(FONTS.get(project) ?? []).map((font) => ({ font, shared: false })),
});

// ── The Director store ────────────────────────────────────────────────────────
const RUNS = new Map<string, DirectorRun>();
const EVENTS: DirectorEvent[] = [];
const OPS = new Map<
	string,
	{ op: string; inputHash: string; status: string; result: unknown; createdAt: Date }
>();
const STALE_MS = 10 * 60_000;
const SPEND = new Map<string, { claudeUsd: number; runpodUsd: number }>();
const CONVOS = new Map<
	string,
	{ agent: string; lastRole: 'user' | 'assistant'; hasToolUse: boolean; at: Date }[]
>();
let eventSeq = 0;
let clock = 0;
/** Another request's create lands right after the next draft is inserted (a double submit). */
let raceOnNextInsert = false;
fake('lib/server/director/store.ts', {
	STALE_CLAIM_MS: STALE_MS,
	getRun: async (id: string) => RUNS.get(id) ?? null,
	findOwnerRequest: async (runId: string, requestId: string) =>
		OPS.get(`${runId}:owner:${requestId}`) ?? null,
	insertDraftRun: async (row: Record<string, unknown>) => {
		if (RUNS.has(row.id as string)) return false;
		const at = new Date(2026, 9, 6, 0, 0, clock++);
		if (raceOnNextInsert) {
			raceOnNextInsert = false;
			const key = row.projectKey as string;
			PROJECTS.set(key, {
				client: row.clientKey as string | null,
				gameType: 'holdAndWin',
				template: false,
			});
			put(`${row.clientKey ?? '_unassigned'}/${key}/config/config.json`, '{}', undefined);
		}
		RUNS.set(
			row.id as string,
			{
				...(row as object),
				budgetCapUsd: null,
				status: 'draft',
				step: 'breakdown',
				waitingOn: null,
				leaseHolder: null,
				leaseUntil: null,
				projectCreateStartedAt: new Date(),
				templateConfigEtag: null,
				projectConfigEtag: null,
				createdAt: at,
				updatedAt: at,
			} as DirectorRun,
		);
		return true;
	},
	deleteDraftRun: async (id: string) => {
		if (RUNS.get(id)?.status === 'draft') RUNS.delete(id);
	},
	setRunConfigEtags: async (
		id: string,
		etags: { template: string | null; project: string | null },
	) => {
		const run = RUNS.get(id)!;
		run.templateConfigEtag = etags.template;
		run.projectConfigEtag = etags.project;
	},
	updateDraftStartingPoint: async (id: string, startingPointJson: unknown) => {
		const run = RUNS.get(id)!;
		if (run.status === 'draft') run.startingPointJson = startingPointJson;
	},
	listRuns: async (filter: { ownerUserId: string; projectKey?: string }) =>
		[...RUNS.values()]
			.filter(
				(r) =>
					r.ownerUserId === filter.ownerUserId &&
					(filter.projectKey === undefined || r.projectKey === filter.projectKey),
			)
			.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
	runSpendTotals: async (ids: string[]) =>
		new Map(ids.filter((id) => SPEND.has(id)).map((id) => [id, SPEND.get(id)!])),
	latestCheckpointOpen: async (runId: string) =>
		[...EVENTS].reverse().find((e) => e.runId === runId && e.kind === 'checkpoint_open') ?? null,
	lastEventId: async (runId: string) => EVENTS.filter((e) => e.runId === runId).at(-1)?.id ?? 0,
	agentConversations: async (runId: string) => CONVOS.get(runId) ?? [],
	appendOwnerEvent: async (args: {
		runId: string;
		requestId: string;
		action: string;
		inputHash: string;
		kind: DirectorEvent['kind'];
		payload: Record<string, unknown>;
	}) => {
		const opId = `${args.runId}:owner:${args.requestId}`;
		const existing = OPS.get(opId);
		// A stale pending claim is reclaimed, as `claimOp` does.
		const stale =
			existing?.status === 'pending' && existing.createdAt.getTime() <= Date.now() - STALE_MS;
		if (existing && !stale) {
			if (existing.op !== `owner.${args.action}` || existing.inputHash !== args.inputHash) {
				return { conflict: 'reused' };
			}
			if (existing.status !== 'done') return { conflict: 'in_progress' };
			return { eventId: (existing.result as { eventId: number }).eventId, replayed: true };
		}
		const id = ++eventSeq;
		EVENTS.push({
			id,
			runId: args.runId,
			at: new Date(2026, 9, 6, 1, 0, id),
			agent: 'owner',
			kind: args.kind,
			tool: null,
			payloadJson: args.payload,
			handledAt: null,
		});
		OPS.set(opId, {
			op: `owner.${args.action}`,
			inputHash: args.inputHash,
			status: 'done',
			result: { eventId: id },
			createdAt: new Date(),
		});
		return { eventId: id, replayed: false };
	},
});

// ── The modules under test ────────────────────────────────────────────────────
const runsMod = await import(src('lib/server/director/runs.ts'));
const owner = await import(src('lib/server/director/ownerActions.ts'));
const mockups = await import(src('lib/server/director/mockups.ts'));
const costs = await import('director-costs');
const runsRoute = await import(src('routes/api/director/runs/+server.ts'));
const runRoute = await import(src('routes/api/director/runs/[runId]/+server.ts'));
const actionsRoute = await import(src('routes/api/director/runs/[runId]/actions/+server.ts'));
const estimateRoute = await import(src('routes/api/director/estimate/+server.ts'));
const templatesRoute = await import(src('routes/api/director/templates/+server.ts'));
const fontsRoute = await import(src('routes/api/director/fonts/+server.ts'));
const cropRoute = await import(src('routes/api/director/runs/[runId]/crop/+server.ts'));
const imageRoute = await import(src('routes/api/director/runs/[runId]/image/+server.ts'));
const variantRoute = await import(src('routes/api/director/runs/[runId]/variant/+server.ts'));
const mockupsRoute = await import(src('routes/api/director/mockups/+server.ts'));
const { projectPrefix } = await import(src('lib/server/projectPaths.ts'));
const { AdapterError } = await import(src('lib/server/director/adapter.ts'));

type User = {
	id: string;
	email: string;
	name: string | null;
	role: 'admin' | 'artist' | 'developer';
};
const ADMIN: User = { id: 'adm', email: 'a@x', name: 'Admin', role: 'admin' };
const OWNER: User = { id: 'owner', email: 'o@x', name: 'Owner', role: 'artist' };
const ART: User = { id: 'art', email: 'r@x', name: 'Art', role: 'artist' };
const DEV: User = { id: 'dev', email: 'd@x', name: 'Dev', role: 'developer' };
const NOBODY: User = { id: 'nobody', email: 'n@x', name: 'Nobody', role: 'artist' };
const NOGM: User = { id: 'nogm', email: 'g@x', name: 'No Game Maker', role: 'artist' };

type Answer = { status: number; body: Record<string, unknown> };
const status = (e: unknown) => (isHttpError(e) ? e.status : e);
async function call(
	handler: (event: never) => Promise<Response>,
	opts: {
		user: User | null;
		url: string;
		method?: 'GET' | 'POST';
		body?: unknown;
		params?: Record<string, string>;
		form?: FormData;
	},
): Promise<Answer> {
	const url = new URL(`http://x${opts.url}`);
	const request = new Request(url, {
		method: opts.method ?? (opts.body === undefined && !opts.form ? 'GET' : 'POST'),
		body:
			opts.form ??
			(opts.body === undefined
				? undefined
				: typeof opts.body === 'string'
					? opts.body
					: JSON.stringify(opts.body)),
		headers: opts.form || opts.body === undefined ? {} : { 'content-type': 'application/json' },
	});
	try {
		const res = await handler({
			request,
			url,
			locals: { user: opts.user },
			cookies: { get: () => undefined },
			params: opts.params ?? {},
		} as never);
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	} catch (e) {
		const s = status(e);
		if (typeof s !== 'number') throw e;
		return { status: s, body: { error: (e as { body?: { message?: string } }).body?.message } };
	}
}

let reqSeq = 0;
const requestId = () => `req-${String(++reqSeq).padStart(4, '0')}`;
/** The run the create below makes; every later section acts on it. */
let RUN_ID = '';
const C = 'acme';
const NEW = 'sunken-temple';
const docKey = (project: string, client = C) => mockups.mockupsDocKey(client, project);
const image = (id: string, tag = 'Base game', styleOnly = false) => ({
	id,
	file: `${id}.png`,
	mediaType: 'image/png',
	w: 1280,
	h: 800,
	bytes: 10,
	tag,
	styleOnly,
	uploadedBy: { uid: 'owner', name: 'Owner' },
	uploadedAt: '2026-10-06T00:00:00Z',
});
function seedMockups(project: string, images: unknown[], confirmed: unknown, client = C) {
	put(
		docKey(project, client),
		JSON.stringify({ version: 1, fidelity: 'match', ownershipConfirmed: confirmed, images }),
		undefined,
	);
}
const createBody = (over: Record<string, unknown> = {}) => ({
	requestId: requestId(),
	key: NEW,
	name: 'Sunken Temple',
	clientKey: C,
	gameType: 'holdAndWin',
	template: 'hw',
	notes: 'Recreate the mockups; friendlier serpent.',
	...over,
});
const create = (user: User, body: unknown) =>
	call(runsRoute.POST, { user, url: '/api/director/runs', body });
const summary = (user: User | null, id: string) =>
	call(runRoute.GET, { user, url: `/api/director/runs/${id}`, params: { runId: id } });
const act = (user: User | null, id: string, body: unknown) =>
	call(actionsRoute.POST, {
		user,
		url: `/api/director/runs/${id}/actions`,
		body,
		params: { runId: id },
	});

// ── Allow-list = the worker's machine ─────────────────────────────────────────
console.log('owner actions vs transition()');
{
	const state = (over: Partial<RunState>): RunState => ({
		status: 'draft',
		step: 'breakdown',
		waitingOn: null,
		checkpoints: { breakdown: true, regionBatch: true, beforePublish: true },
		...over,
	});
	const table: [string, RunState, string[]][] = [
		['draft', state({}), ['start', 'stop']],
		['running', state({ status: 'running', step: 'regions' }), ['pause', 'stop', 'message']],
		[
			'waiting on breakdown',
			state({ status: 'waiting', waitingOn: 'breakdown' }),
			['stop', 'approve', 'revise', 'message'],
		],
		[
			'waiting before publish',
			state({ status: 'waiting', step: 'handoff', waitingOn: 'before_publish' }),
			['stop', 'approve', 'revise', 'message'],
		],
		['paused', state({ status: 'paused', step: 'regions' }), ['resume', 'stop', 'message']],
		['stopping', state({ status: 'stopping' }), []],
		['stopped', state({ status: 'stopped' }), []],
		['failed', state({ status: 'failed' }), []],
		['handed off', state({ status: 'handed_off', step: 'handoff' }), []],
	];
	for (const [label, s, expected] of table) {
		check(`allowed while ${label}`, owner.allowedOwnerActions(s), expected);
		for (const action of owner.OWNER_ACTIONS) {
			if (action === 'message') continue;
			const event = owner.runEventOf(action, s.waitingOn) as RunEvent;
			check(
				`${action} while ${label} agrees with transition()`,
				owner.actionRefusal(s, action) === null,
				transition(s, event).ok,
			);
		}
	}
	check(
		'approving a checkpoint that is not open is refused by the machine',
		typeof owner.actionRefusal(
			state({ status: 'waiting', waitingOn: 'breakdown' }),
			'approve',
			'region_batch',
		),
		'string',
	);
	check('a raised cap is clamped to Settings bounds', owner.raisedCap(25, 9999), 500);
	check('a cap that does not raise is refused', owner.raisedCap(25, 20), null);
	check('a run without a cap takes any valid cap', owner.raisedCap(null, 30), 30);
	check(
		'the request id shape',
		['abcdefgh', 'a'.repeat(64), 'short', 'a'.repeat(65), 'bad id!'].map((v) =>
			owner.REQUEST_ID.test(v),
		),
		[true, true, false, false, false],
	);
}

// ── Create ────────────────────────────────────────────────────────────────────
console.log('create');
{
	check('no session is 401', (await create(null as never, createBody())).status, 401);
	check('without the director tool is 403', (await create(DEV, createBody())).status, 403);
	const refused = async (over: Record<string, unknown>, user: User = OWNER) => {
		const r = await create(user, createBody(over));
		return [r.status, r.body.error];
	};
	check('a missing request id', await refused({ requestId: undefined }), [400, 'bad_request_id']);
	check('without Game Maker it is 403', await refused({}, NOGM), [403, 'game_maker_required']);
	check('a bad key', await refused({ key: 'Bad Key' }), [400, 'bad_key']);
	check(
		'…in Game Maker’s words',
		(await create(OWNER, createBody({ key: 'Bad Key' }))).body.message,
		'Key must match a-z, 0-9, _ or - (max 64).',
	);
	check('no name', await refused({ name: '  ' }), [400, 'name_required']);
	check('an unknown game kind', await refused({ gameType: 'bingo' }), [400, 'unknown_game_kind']);
	check('a template of another kind', await refused({ template: 'lines-sample' }), [
		400,
		'template_kind',
	]);
	check('an unpublished template', await refused({ template: 'hw-unpublished' }), [
		404,
		'unknown_template',
	]);
	check('an unknown template', await refused({ template: 'nope' }), [404, 'unknown_template']);
	check('a template the user cannot open', await refused({}, NOBODY), [404, 'unknown_template']);
	check('an unknown client', await refused({ clientKey: 'nobody' }), [400, 'unknown_client']);
	CLIENTS.add('third');
	check('a client the user may not create under is 403', await refused({ clientKey: 'third' }), [
		403,
		'client_forbidden',
	]);
	check('an existing key', await refused({ key: 'other-game' }), [400, 'key_exists']);
	check('a deleted key', await refused({ key: 'gone' }), [400, 'key_deleted']);
	check('no mockups and no notes', await refused({ notes: '' }), [400, 'notes_required']);
	check('a bad preset', await refused({ preset: { variantsPerRegion: 0 } }), [400, 'bad_preset']);
	check('an unpriced GPU', await refused({ preset: { gpu: 'Abacus' } }), [400, 'bad_preset']);
	check('a bad checkpoint flag', await refused({ checkpoints: { breakdown: 'yes' } }), [
		400,
		'bad_checkpoints',
	]);
	check('nothing was created by refused creates', [RUNS.size, duplicates], [0, 0]);

	// Mockups uploaded under the pending project, ownership not yet confirmed.
	seedMockups(NEW, [image('a1b2c3d4e5f60718'), image('a1b2c3d4e5f60719', 'style', true)], null);
	const unowned = await create(OWNER, createBody());
	check(
		'ownership refusal blocks create',
		[unowned.status, unowned.body.error],
		[409, 'ownership_required'],
	);
	check('…and creates nothing', [RUNS.size, duplicates, live(NEW)], [0, 0, undefined]);

	await mockups.confirmOwnership(C, NEW, { uid: 'owner', name: 'Owner' });
	const body = createBody();
	const made = await create(OWNER, body);
	check('a confirmed create is 201', made.status, 201);
	const run = made.body.run as Record<string, unknown>;
	check('the run id comes from the request id', run.id, runsMod.runIdFor('owner', body.requestId));
	check(
		'the run is a draft at breakdown',
		[run.status, run.step, run.waitingOn],
		['draft', 'breakdown', null],
	);
	check(
		'the project was created from the template',
		[live(NEW)?.client, live(NEW)?.gameType, duplicates],
		['acme', 'holdAndWin', 1],
	);
	check('the project is reported created', run.projectCreated, true);
	check(
		'the cap is null until the worker copies Settings at start',
		(run.spend as { capUsd: unknown }).capUsd,
		null,
	);
	const sp = run.startingPoint as Record<string, unknown>;
	check(
		'the ownership stamp is copied into the starting point',
		(sp.ownershipConfirmed as { by: unknown }).by,
		{ uid: 'owner', name: 'Owner' },
	);
	check(
		'…with the mockups and notes',
		[sp.mockups, sp.notes, sp.fidelity],
		[
			[
				{ id: 'a1b2c3d4e5f60718', tag: 'Base game', styleOnly: false },
				{ id: 'a1b2c3d4e5f60719', tag: 'style', styleOnly: true },
			],
			body.notes,
			'match',
		],
	);
	check('the preset defaults are stored', run.preset, {
		blueprint: 'sdxl',
		draftPx: 512,
		finalPx: 1024,
		variantsPerRegion: 3,
		gpu: 'RTX 4090 (24 GB)',
	});
	check('the checkpoints default on', run.checkpoints, {
		breakdown: true,
		regionBatch: true,
		beforePublish: true,
	});
	check(
		'the config ETags are recorded',
		[
			RUNS.get(run.id as string)!.templateConfigEtag !== null,
			RUNS.get(run.id as string)!.projectConfigEtag !== null,
		],
		[true, true],
	);
	check('a draft may be started or stopped', run.allowedActions, ['start', 'stop']);
	RUN_ID = run.id as string;

	const again = await create(OWNER, body);
	check(
		'a replayed create is 200 and the same run',
		[again.status, again.body.replayed, (again.body.run as { id: string }).id],
		[200, true, run.id],
	);
	check('…and made nothing new', [RUNS.size, duplicates], [1, 1]);
	check('another request for the same key is key_exists', await refused({}), [400, 'key_exists']);
	const other = await create(OWNER, { ...body, template: 'lines-sample', gameType: 'lines' });
	check(
		'a replay naming another template is refused',
		[other.status, other.body.error],
		[409, 'request_id_reused'],
	);
	check('…and still one run, one project', [RUNS.size, duplicates], [1, 1]);

	// A double submit: another request's create lands between the key check and the copy. The
	// second run must not adopt that project: it is refused and leaves nothing behind.
	seedMockups('raced', [], null);
	raceOnNextInsert = true;
	const copiesBefore = duplicates;
	const raced = await create(OWNER, createBody({ key: 'raced', requestId: 'raced-0001' }));
	check(
		'a create whose key was taken meanwhile is refused',
		[raced.status, raced.body.error],
		[409, 'project_exists'],
	);
	check(
		'…copies nothing and leaves no draft',
		[duplicates - copiesBefore, RUNS.has(runsMod.runIdFor('owner', 'raced-0001'))],
		[0, false],
	);
	PROJECTS.delete('raced');

	// A create whose copy fails leaves no draft behind.
	seedMockups('reef', [], null);
	failNextDuplicate = true;
	const failed = await create(OWNER, createBody({ key: 'reef', requestId: 'reef-0001' }));
	check('a failed copy is reported', [failed.status, failed.body.error], [502, 'create_failed']);
	check('…and leaves no draft', RUNS.has(runsMod.runIdFor('owner', 'reef-0001')), false);
	const retried = await create(OWNER, createBody({ key: 'reef', requestId: 'reef-0001' }));
	check(
		'…so the same request id creates it next time',
		[retried.status, live('reef') !== undefined],
		[201, true],
	);
	{
		// A resend while the first call is still copying (the draft is there, the project not yet)
		// must not copy too; once that attempt can no longer be running, the resend finishes it.
		const reef = RUNS.get(runsMod.runIdFor('owner', 'reef-0001'))!;
		const kept = PROJECTS.get('reef')!;
		PROJECTS.delete('reef');
		reef.projectCreateStartedAt = new Date();
		const copies = duplicates;
		const early = await create(OWNER, createBody({ key: 'reef', requestId: 'reef-0001' }));
		check(
			'a resend while the first create is still copying is in_progress',
			[early.status, early.body.error, duplicates - copies],
			[409, 'in_progress', 0],
		);
		reef.projectCreateStartedAt = new Date(Date.now() - STALE_MS - 1);
		const late = await create(OWNER, createBody({ key: 'reef', requestId: 'reef-0001' }));
		check(
			'…and once that attempt is stale the resend finishes the copy',
			[late.status, late.body.replayed, duplicates - copies, live('reef') !== undefined],
			[200, true, 1, true],
		);
		PROJECTS.set('reef', kept);
	}
}

const runRow = () => RUNS.get(RUN_ID)!;
const rowsOf = (id: string) => EVENTS.filter((e) => e.runId === id);

// ── 404 for everyone but the owner ────────────────────────────────────────────
console.log('access');
{
	const mine = await summary(OWNER, RUN_ID);
	check('the owner reads the summary', mine.status, 200);
	const unknown = await summary(OWNER, 'no-such-run');
	check('an unknown id is 404', [unknown.status, unknown.body], [404, { error: 'No such run.' }]);
	const other = await summary(ADMIN, RUN_ID);
	check('a non-owner gets the same 404', other, unknown);
	check(
		'…for an action too',
		await act(ADMIN, RUN_ID, { action: 'start', requestId: requestId() }),
		unknown,
	);
	GRANTS.set('owner', new Set());
	check('an owner who lost the project gets the same 404', await summary(OWNER, RUN_ID), unknown);
	check(
		'…for an action too',
		await act(OWNER, RUN_ID, { action: 'start', requestId: requestId() }),
		unknown,
	);
	GRANTS.set('owner', new Set(['acme']));
	check('no row was written by refused callers', rowsOf(RUN_ID).length, 0);
	check(
		'the list is the caller’s runs in the project',
		(
			(await call(runsRoute.GET, { user: OWNER, url: `/api/director/runs?project=${NEW}` })).body
				.runs as { id: string }[]
		).map((r) => r.id),
		[RUN_ID],
	);
	check(
		'…and all of them without a project',
		((await call(runsRoute.GET, { user: OWNER, url: '/api/director/runs' })).body.runs as unknown[])
			.length,
		2,
	);
	check(
		'…none for someone else',
		(
			(await call(runsRoute.GET, { user: ADMIN, url: `/api/director/runs?project=${NEW}` })).body
				.runs as unknown[]
		).length,
		0,
	);
	check(
		'a pending project lists its (no) runs',
		(
			await call(runsRoute.GET, {
				user: OWNER,
				url: '/api/director/runs?project=not-yet&client=acme',
			})
		).status,
		200,
	);
	check(
		'an inaccessible project is 403',
		(await call(runsRoute.GET, { user: ART, url: '/api/director/runs?project=other-game' })).status,
		403,
	);
}

// ── Start ─────────────────────────────────────────────────────────────────────
console.log('start');
{
	// Mockups added after the create cleared the check (every upload does): start is refused.
	const doc = JSON.parse(R2.get(docKey(NEW))!.body);
	doc.images.push(image('a1b2c3d4e5f6071a', 'Paytable'));
	doc.ownershipConfirmed = null;
	put(docKey(NEW), JSON.stringify(doc), undefined);
	const refused = await act(OWNER, RUN_ID, { action: 'start', requestId: requestId() });
	check(
		'ownership refusal blocks start',
		[refused.status, refused.body.error],
		[409, 'ownership_required'],
	);
	check('…and writes no row', rowsOf(RUN_ID).length, 0);
	await mockups.confirmOwnership(C, NEW, { uid: 'owner', name: 'Owner' });
	const id = requestId();
	const started = await act(OWNER, RUN_ID, { action: 'start', requestId: id });
	check('start writes one owner_request row', [started.status, rowsOf(RUN_ID).length], [200, 1]);
	const row = rowsOf(RUN_ID)[0];
	check(
		'…the row the worker reads',
		[row.agent, row.kind, (row.payloadJson as { action: string }).action],
		['owner', 'owner_request', 'start'],
	);
	check(
		'…the worker accepts it from draft',
		transition(owner.runStateOf(runRow()), { type: 'start' }).ok,
		true,
	);
	check(
		'…and the starting point was refreshed with the new mockup',
		((runRow().startingPointJson as { mockups: unknown[] }).mockups as unknown[]).length,
		3,
	);
	// The worker has applied the row by the time the click is resent: the resend is still replayed.
	Object.assign(runRow(), { status: 'running' });
	const replay = await act(OWNER, RUN_ID, { action: 'start', requestId: id });
	check(
		'a replayed start answers the same event after the run moved',
		[replay.status, replay.body.replayed, replay.body.eventId],
		[200, true, started.body.eventId],
	);
	check('…and writes nothing new', rowsOf(RUN_ID).length, 1);
	Object.assign(runRow(), { status: 'draft' });
	const reused = await act(OWNER, RUN_ID, { action: 'stop', requestId: id });
	check(
		'the same id for another action is refused',
		[reused.status, reused.body.error],
		[409, 'request_id_reused'],
	);
	check('…and writes nothing', rowsOf(RUN_ID).length, 1);
	// Until the worker has applied the row the run is still a draft, so a second start with a new
	// request id is accepted here and refused by the worker (a `refused_request` error event); once
	// the run has moved, the launcher refuses it up front with the machine's own reason.
	Object.assign(runRow(), { status: 'running' });
	const twice = await act(OWNER, RUN_ID, { action: 'start', requestId: requestId() });
	check(
		'a start on a run that has moved is refused by the machine',
		[twice.status, twice.body.error],
		[409, 'not_allowed'],
	);
	Object.assign(runRow(), { status: 'draft' });

	// A draft whose project never got made cannot start.
	const orphan = runsMod.runIdFor('owner', 'orphan-01');
	RUNS.set(orphan, {
		...runRow(),
		id: orphan,
		projectKey: 'never-made',
		clientKey: C,
		status: 'draft',
	});
	const missing = await act(OWNER, orphan, { action: 'start', requestId: requestId() });
	check(
		'a draft with no project cannot start',
		[missing.status, missing.body.error],
		[409, 'project_missing'],
	);
	RUNS.delete(orphan);
}

// ── Every action from every status ────────────────────────────────────────────
console.log('actions × statuses');
{
	const run = runRow();
	// Replace the start row's effect: the worker would have moved the run; here the fixture does.
	const states: [string, Partial<DirectorRun>][] = [
		['draft', { status: 'draft', step: 'breakdown', waitingOn: null }],
		['running', { status: 'running', step: 'regions', waitingOn: null }],
		['waiting:breakdown', { status: 'waiting', step: 'breakdown', waitingOn: 'breakdown' }],
		['waiting:region_batch', { status: 'waiting', step: 'regions', waitingOn: 'region_batch' }],
		['waiting:before_publish', { status: 'waiting', step: 'handoff', waitingOn: 'before_publish' }],
		['paused', { status: 'paused', step: 'regions', waitingOn: null }],
		['stopping', { status: 'stopping', step: 'regions', waitingOn: null }],
		['stopped', { status: 'stopped', step: 'regions', waitingOn: null }],
		['failed', { status: 'failed', step: 'build', waitingOn: null }],
		['handed_off', { status: 'handed_off', step: 'handoff', waitingOn: null }],
	];
	check(
		'every status is covered',
		states
			.map(([, s]) => s.status)
			.filter((s, i, all) => all.indexOf(s) === i)
			.sort(),
		[...RUN_STATUSES].sort(),
	);
	/** What the worker's `applyEvent` turns an owner row into. */
	const eventOfRow = (row: DirectorEvent): RunEvent | null => {
		const p = row.payloadJson as Record<string, unknown>;
		if (row.kind === 'owner_request') {
			const action = p.action as string;
			if (action === 'start') return { type: 'start' };
			if (action === 'pause') return { type: 'pause', reason: 'owner' };
			if (action === 'resume') return { type: 'resume' };
			if (action === 'stop') return { type: 'stop' };
		}
		if (row.kind === 'checkpoint_resolved') {
			return {
				type: 'resolve',
				checkpoint: p.checkpoint as RunEvent extends { checkpoint: infer T } ? T : never,
				decision: p.decision as 'approve' | 'revise',
			};
		}
		return null;
	};
	for (const [label, over] of states) {
		Object.assign(run, over);
		const state = owner.runStateOf(run);
		for (const action of owner.OWNER_ACTIONS) {
			const before = rowsOf(RUN_ID).length;
			const body: Record<string, unknown> = { action, requestId: requestId() };
			if (action === 'message') body.text = 'Do the background first.';
			const answer = await act(OWNER, RUN_ID, body);
			const after = rowsOf(RUN_ID);
			const allowed = owner.actionRefusal(state, action) === null;
			if (!allowed) {
				check(
					`${action} while ${label}: refused, no row`,
					[answer.status, answer.body.error, after.length - before],
					[409, 'not_allowed', 0],
				);
				continue;
			}
			check(`${action} while ${label}: one row`, [answer.status, after.length - before], [200, 1]);
			const row = after[after.length - 1];
			check(
				`${action} while ${label}: the row is the owner's and wakes the worker`,
				[row.agent, ['owner_request', 'owner_message', 'checkpoint_resolved'].includes(row.kind)],
				['owner', true],
			);
			check(
				`${action} while ${label}: the request id and the stamp travel with it`,
				[
					(row.payloadJson as { requestId: string }).requestId,
					(row.payloadJson as { by: unknown }).by,
				],
				[body.requestId, { uid: 'owner', name: 'Owner' }],
			);
			const event = eventOfRow(row);
			if (action === 'message') {
				check(
					`message while ${label}: an owner_message with the text`,
					[row.kind, (row.payloadJson as { text: string }).text],
					['owner_message', 'Do the background first.'],
				);
			} else {
				check(
					`${action} while ${label}: the worker accepts the row from this state`,
					event !== null && transition(state, event).ok,
					true,
				);
			}
			if (action === 'approve' || action === 'revise') {
				check(
					`${action} while ${label}: resolves the open checkpoint`,
					(row.payloadJson as { checkpoint: string }).checkpoint,
					state.waitingOn,
				);
			}
		}
	}

	// Checkpoint arguments.
	Object.assign(run, { status: 'waiting', step: 'regions', waitingOn: 'region_batch' });
	const wrong = await act(OWNER, RUN_ID, {
		action: 'approve',
		requestId: requestId(),
		checkpoint: 'breakdown',
	});
	check(
		'approving a checkpoint that is not open is refused',
		[wrong.status, wrong.body.error],
		[409, 'not_allowed'],
	);
	const noted = await act(OWNER, RUN_ID, {
		action: 'revise',
		requestId: requestId(),
		checkpoint: 'region_batch',
		note: ' Brighter eyes. ',
	});
	check(
		'a revise carries the trimmed note',
		(rowsOf(RUN_ID).at(-1)!.payloadJson as { note: string }).note,
		'Brighter eyes.',
	);
	check(
		'a bad checkpoint name is 400',
		(await act(OWNER, RUN_ID, { action: 'approve', requestId: requestId(), checkpoint: 'budget' }))
			.status,
		400,
	);
	check(
		'a message needs text',
		(await act(OWNER, RUN_ID, { action: 'message', requestId: requestId(), text: ' ' })).status,
		400,
	);
	check(
		'an unknown action is 400',
		(await act(OWNER, RUN_ID, { action: 'launch', requestId: requestId() })).status,
		400,
	);
	check('a non-JSON body is 400', (await act(OWNER, RUN_ID, 'not json')).status, 400);

	{
		// An approve sent without the checkpoint (the open one is filled in) and resent after the
		// worker closed it: the resend is replayed, because the hash covers the body as sent.
		Object.assign(run, { status: 'waiting', step: 'breakdown', waitingOn: 'breakdown' });
		const approveId = requestId();
		const rows = rowsOf(RUN_ID).length;
		const approved = await act(OWNER, RUN_ID, { action: 'approve', requestId: approveId });
		check(
			'approve without a checkpoint resolves the open one',
			[approved.status, (rowsOf(RUN_ID).at(-1)!.payloadJson as { checkpoint: string }).checkpoint],
			[200, 'breakdown'],
		);
		Object.assign(run, { status: 'running', step: 'style_pack', waitingOn: null });
		const resent = await act(OWNER, RUN_ID, { action: 'approve', requestId: approveId });
		check(
			'…and its resend after the checkpoint closed is replayed',
			[resent.status, resent.body.replayed, resent.body.eventId, rowsOf(RUN_ID).length - rows],
			[200, true, approved.body.eventId, 1],
		);
		const otherBody = await act(OWNER, RUN_ID, {
			action: 'approve',
			requestId: approveId,
			note: 'now with a note',
		});
		check(
			'…while another body under that id is refused',
			[otherBody.status, otherBody.body.error],
			[409, 'request_id_reused'],
		);
	}

	{
		// A claim a crash left pending blocks its id only for the stale window; a young one is
		// still being written.
		Object.assign(run, { status: 'running', step: 'regions', waitingOn: null });
		const claim = (id: string, age: number) =>
			OPS.set(`${RUN_ID}:owner:${id}`, {
				op: 'owner.pause',
				inputHash: createHash('sha256')
					.update(JSON.stringify({ action: 'pause' }))
					.digest('hex'),
				status: 'pending',
				result: null,
				createdAt: new Date(Date.now() - age),
			});
		const staleId = requestId();
		const youngId = requestId();
		claim(staleId, STALE_MS + 1);
		claim(youngId, 1000);
		const rows = rowsOf(RUN_ID).length;
		const reclaimed = await act(OWNER, RUN_ID, { action: 'pause', requestId: staleId });
		check(
			'a stale pending claim is reclaimed and the action recorded',
			[reclaimed.status, reclaimed.body.replayed, rowsOf(RUN_ID).length - rows],
			[200, false, 1],
		);
		const young = await act(OWNER, RUN_ID, { action: 'pause', requestId: youngId });
		check(
			'a young pending claim is still in progress',
			[young.status, young.body.error, rowsOf(RUN_ID).length - rows],
			[409, 'in_progress', 1],
		);
	}

	// Resume with a raised cap.
	Object.assign(run, { status: 'paused', step: 'regions', waitingOn: null, budgetCapUsd: 25 });
	const lower = await act(OWNER, RUN_ID, {
		action: 'resume',
		requestId: requestId(),
		budgetCapUsd: 20,
	});
	check(
		'a resume that does not raise the cap is 400',
		[lower.status, lower.body.error],
		[400, 'cap_not_raised'],
	);
	const raiseId = requestId();
	const raised = await act(OWNER, RUN_ID, {
		action: 'resume',
		requestId: raiseId,
		budgetCapUsd: 9999,
	});
	check(
		'a raised cap is clamped into the row',
		[raised.status, (rowsOf(RUN_ID).at(-1)!.payloadJson as { budgetCapUsd: number }).budgetCapUsd],
		[200, 500],
	);
	{
		// The worker raised the cap and resumed the run; the resend is replayed, not cap_not_raised.
		Object.assign(run, { status: 'running', budgetCapUsd: 500 });
		const rows = rowsOf(RUN_ID).length;
		const resent = await act(OWNER, RUN_ID, {
			action: 'resume',
			requestId: raiseId,
			budgetCapUsd: 9999,
		});
		check(
			'a resent resume after the worker raised the cap is replayed',
			[resent.status, resent.body.replayed, resent.body.eventId, rowsOf(RUN_ID).length - rows],
			[200, true, raised.body.eventId, 0],
		);
		Object.assign(run, { status: 'paused', budgetCapUsd: 25 });
	}
	const plain = await act(OWNER, RUN_ID, { action: 'resume', requestId: requestId() });
	check(
		'a plain resume carries no cap',
		[plain.status, 'budgetCapUsd' in (rowsOf(RUN_ID).at(-1)!.payloadJson as object)],
		[200, false],
	);
	check(
		'a cap on another action is 400',
		(await act(OWNER, RUN_ID, { action: 'stop', requestId: requestId(), budgetCapUsd: 30 })).status,
		400,
	);
	check(noted.status === 200 ? 'checkpoint args ok' : 'checkpoint args ok', noted.status, 200);
}

// ── Summary ───────────────────────────────────────────────────────────────────
console.log('summary');
{
	const run = runRow();
	Object.assign(run, {
		status: 'waiting',
		step: 'breakdown',
		waitingOn: 'breakdown',
		budgetCapUsd: 25,
	});
	SPEND.set(RUN_ID, { claudeUsd: 0.4, runpodUsd: 0.05 });
	EVENTS.push({
		id: ++eventSeq,
		runId: RUN_ID,
		at: new Date(2026, 9, 6, 2, 0, 0),
		agent: 'mockup-analyst',
		kind: 'checkpoint_open',
		tool: null,
		payloadJson: { checkpoint: 'breakdown', breakdown: { images: 3 } },
		handledAt: null,
	});
	CONVOS.set(RUN_ID, [
		{
			agent: 'coordinator',
			lastRole: 'assistant',
			hasToolUse: false,
			at: new Date(2026, 9, 6, 2, 0, 1),
		},
		{
			agent: 'mockup-analyst',
			lastRole: 'assistant',
			hasToolUse: true,
			at: new Date(2026, 9, 6, 2, 0, 2),
		},
		{
			agent: 'atlas-artist',
			lastRole: 'user',
			hasToolUse: false,
			at: new Date(2026, 9, 6, 2, 0, 3),
		},
	]);
	const s = (await summary(OWNER, RUN_ID)).body.run as Record<string, unknown>;
	check('the run’s project prefix in R2', s.r2Prefix, projectPrefix(C, NEW));
	check('spend against the cap', s.spend, {
		claudeUsd: 0.4,
		runpodUsd: 0.05,
		totalUsd: 0.45,
		capUsd: 25,
		remainingUsd: 24.55,
	});
	check(
		'the open checkpoint is shown while waiting',
		[
			(s.checkpoint as { checkpoint: string }).checkpoint,
			(s.checkpoint as { payload: unknown }).payload,
		],
		['breakdown', { checkpoint: 'breakdown', breakdown: { images: 3 } }],
	);
	check(
		'agents’ statuses',
		(s.agents as { agent: string; status: string }[]).map((a) => `${a.agent}:${a.status}`),
		[
			'coordinator:idle',
			'mockup-analyst:working',
			'art-director:not_started',
			'atlas-artist:queued',
			'animator:not_started',
			'builder:not_started',
			'qa:not_started',
		],
	);
	check('the allowed actions', s.allowedActions, ['stop', 'approve', 'revise', 'message']);
	check('the last event id is where the stream picks up', s.lastEventId, eventSeq);
	check('the project name and template', [s.name, s.templateProjectKey], [`Project ${NEW}`, 'hw']);
	Object.assign(run, { status: 'running', waitingOn: null });
	check(
		'no checkpoint while running',
		((await summary(OWNER, RUN_ID)).body.run as { checkpoint: unknown }).checkpoint,
		null,
	);
	Object.assign(run, { status: 'paused' });
	check(
		'no checkpoint while paused unless it is the budget one',
		((await summary(OWNER, RUN_ID)).body.run as { checkpoint: unknown }).checkpoint,
		null,
	);
	EVENTS.push({
		id: ++eventSeq,
		runId: RUN_ID,
		at: new Date(),
		agent: 'worker',
		kind: 'checkpoint_open',
		tool: null,
		payloadJson: { checkpoint: 'budget', capUsd: 25 },
		handledAt: null,
	});
	check(
		'the budget checkpoint shows while paused',
		((await summary(OWNER, RUN_ID)).body.run as { checkpoint: { checkpoint: string } }).checkpoint
			.checkpoint,
		'budget',
	);
	const listed = (
		await call(runsRoute.GET, { user: OWNER, url: `/api/director/runs?project=${NEW}` })
	).body.runs as Record<string, unknown>[];
	check(
		'the list carries spend and state',
		[listed[0].status, listed[0].spentUsd, listed[0].name],
		['paused', 0.45, `Project ${NEW}`],
	);
}

// ── Estimate ──────────────────────────────────────────────────────────────────
console.log('estimate');
{
	const answer = await call(estimateRoute.POST, {
		user: OWNER,
		url: '/api/director/estimate',
		body: { template: 'hw', mockups: 3, preset: { variantsPerRegion: 3 }, checkpoints: {} },
	});
	check('the estimate answers', answer.status, 200);
	const est = answer.body.estimate as Record<string, Record<string, unknown>> & {
		checkpoints: number;
		placeholder: boolean;
	};
	check('regions are the template’s', (answer.body.template as { regions: number }).regions, 25);
	check('the cap a run started now would get', answer.body.budgetCapUsd, 25);
	{
		const at = async (mockups: number) =>
			(
				(
					await call(estimateRoute.POST, {
						user: OWNER,
						url: '/api/director/estimate',
						body: { template: 'hw', mockups },
					})
				).body.estimate as { claude: { byAgent: Record<string, unknown> } }
			).claude.byAgent['mockup-analyst'];
		check('the mockup count is capped at the upload limit', await at(99), await at(12));
	}
	check('it is a placeholder until measured', est.placeholder, true);
	check('three checkpoints by default', est.checkpoints, 3);
	const r = (x: unknown) => x as { low: number; high: number };
	check(
		'Claude: a range',
		r(est.claude.usd).low > 0 && r(est.claude.usd).low <= r(est.claude.usd).high,
		true,
	);
	check(
		'RunPod: drafts and finals at the preset GPU',
		[est.runpod.gpu, est.runpod.draftRenders, est.runpod.finalRenders],
		['RTX 4090 (24 GB)', 75, 25],
	);
	check(
		'RunPod: a range',
		r(est.runpod.usd).low > 0 &&
			r(est.runpod.usd).low <= r(est.runpod.usd).high &&
			r(est.runpod.minutes).high >= r(est.runpod.minutes).low,
		true,
	);
	check('the total adds up', r(est.total.usd), {
		low: Math.round((r(est.claude.usd).low + r(est.runpod.usd).low) * 100) / 100,
		high: Math.round((r(est.claude.usd).high + r(est.runpod.usd).high) * 100) / 100,
	});
	check('every agent of the profiles is priced', Object.keys(est.claude.byAgent as object).sort(), [
		'animator',
		'art-director',
		'atlas-artist',
		'builder',
		'coordinator',
		'mockup-analyst',
		'qa',
	]);
	check(
		'an unknown template is 404',
		(
			await call(estimateRoute.POST, {
				user: OWNER,
				url: '/api/director/estimate',
				body: { template: 'nope' },
			})
		).status,
		404,
	);
	check(
		'a bad mockup count is 400',
		(
			await call(estimateRoute.POST, {
				user: OWNER,
				url: '/api/director/estimate',
				body: { template: 'hw', mockups: -1 },
			})
		).status,
		400,
	);
	check(
		'no run, no project, no row was made by estimating',
		[RUNS.size, duplicates, EVENTS.length],
		[2, 3, eventSeq],
	);

	// The pure estimator.
	const profiles = runsMod.ESTIMATE_PROFILES;
	const pricing = costs.parsePricing(
		JSON.parse(
			readFileSync(
				new URL('../../../services/director-worker/pricing.json', import.meta.url),
				'utf8',
			),
		),
	);
	const base = {
		regions: 10,
		mockups: 2,
		variantsPerRegion: 2,
		draftPx: 512,
		finalPx: 1024,
		gpu: 'RTX 4090 (24 GB)',
		checkpoints: { breakdown: true, regionBatch: false },
	};
	const e = costs.estimateRun(base, profiles, pricing);
	check('no region batch checkpoint: two reviews', e.checkpoints, 2);
	const none = costs.estimateRun({ ...base, regions: 0, mockups: 0 }, profiles, pricing);
	check(
		'no regions: no renders',
		[none.runpod.draftRenders, none.runpod.usd],
		[0, { low: 0, high: 0 }],
	);
	check('…but the per-run work remains', none.claude.usd.low > 0, true);
	const bigger = costs.estimateRun({ ...base, finalPx: 2048 }, profiles, pricing);
	check(
		'finals at 2048 px cost four times the GPU seconds of 1024',
		bigger.runpod.usd.high > e.runpod.usd.high,
		true,
	);
	let threw = '';
	try {
		costs.estimateRun({ ...base, gpu: 'Abacus' }, profiles, pricing);
	} catch (err) {
		threw = (err as Error).message;
	}
	check('an unpriced GPU throws rather than estimating nothing', threw.includes('Abacus'), true);
	// The profiles price each agent at the model its definition names.
	const defined: Record<string, string> = {};
	for (const file of readdirSync(AGENTS_DIR)) {
		const text = readFileSync(`${AGENTS_DIR}${file}`, 'utf8');
		const name = /^name:\s*(\S+)/m.exec(text)?.[1];
		const model = /^model:\s*(\S+)/m.exec(text)?.[1];
		if (name && model) defined[name] = model;
	}
	const profiled = costs.profileModels(profiles);
	check(
		'profile models match the agent definitions',
		Object.fromEntries(
			Object.keys(profiled)
				.sort()
				.map((a) => [a, profiled[a]]),
		),
		Object.fromEntries(
			Object.keys(profiled)
				.sort()
				.map((a) => [a, defined[a]]),
		),
	);
	check(
		'every profiled model is priced',
		Object.values(profiled).every((m) => m in pricing.perMTok),
		true,
	);
}

// ── Templates ─────────────────────────────────────────────────────────────────
console.log('templates');
{
	const all = await call(templatesRoute.GET, { user: OWNER, url: '/api/director/templates' });
	check(
		'the usable templates',
		(all.body.templates as { key: string }[]).map((t) => t.key),
		['hw', 'lines-sample'],
	);
	const hw = await call(templatesRoute.GET, {
		user: OWNER,
		url: '/api/director/templates?gameType=holdAndWin',
	});
	check(
		'…filtered by kind',
		(hw.body.templates as { key: string }[]).map((t) => t.key),
		['hw'],
	);
	check(
		'the preset defaults and bounds',
		[
			(hw.body.preset as { default: { gpu: string } }).default.gpu,
			(hw.body.preset as { gpus: string[] }).gpus.length > 0,
			(hw.body.preset as { maxVariantsPerRegion: number }).maxVariantsPerRegion,
		],
		['RTX 4090 (24 GB)', true, 8],
	);
	check(
		'the game kinds',
		(hw.body.gameKinds as { id: string }[]).map((k) => k.id),
		['lines', 'holdAndWin'],
	);
	check(
		'none for a user who can open none',
		(
			(await call(templatesRoute.GET, { user: NOBODY, url: '/api/director/templates' })).body
				.templates as unknown[]
		).length,
		0,
	);
	check(
		'the clients are those the caller may create under, as Game Maker lists them',
		hw.body.clients as { key: string; name: string }[],
		[{ key: 'acme', name: 'Client acme' }],
	);
	check(
		'…every client for an admin',
		(
			(await call(templatesRoute.GET, { user: ADMIN, url: '/api/director/templates' })).body
				.clients as { key: string }[]
		).map((c) => c.key),
		[...CLIENTS].sort(),
	);
	const agents = hw.body.agents as { agent: string; model: string }[];
	check(
		'the agents the run is priced for, at the model each definition names',
		agents.map((a) => a.agent),
		['coordinator', 'mockup-analyst', 'art-director', 'atlas-artist', 'animator', 'builder', 'qa'],
	);
	check(
		'…and the worker is not one of them',
		agents.every((a) => a.agent !== 'worker' && a.model.startsWith('claude-')),
		true,
	);
}

// ── Crops ─────────────────────────────────────────────────────────────────────
console.log('crops');
{
	const crop = (user: User | null, id: string, region: string) =>
		call(cropRoute.GET, {
			user,
			url: `/api/director/runs/${id}/crop?region=${encodeURIComponent(region)}`,
			params: { runId: id },
		});
	const key = `${projectPrefix(C, NEW)}/director/crops/${RUN_ID}/Logo.png`;
	check('a region with no crop is 404', (await crop(OWNER, RUN_ID, 'Logo')).status, 404);
	put(key, 'PNGBYTES', undefined);
	const url = new URL(`http://x/api/director/runs/${RUN_ID}/crop?region=Logo`);
	const res = await cropRoute.GET({
		request: new Request(url),
		url,
		locals: { user: OWNER },
		params: { runId: RUN_ID },
	} as never);
	check(
		'the owner reads the crop as a PNG',
		[res.status, res.headers.get('content-type'), await res.text()],
		[200, 'image/png', 'PNGBYTES'],
	);
	check('a non-owner gets the run’s 404', (await crop(ADMIN, RUN_ID, 'Logo')).status, 404);
	check('no session is 401', (await crop(null, RUN_ID, 'Logo')).status, 401);
	check(
		'a region name outside the adapter’s pattern is 404, never a key',
		[(await crop(OWNER, RUN_ID, '../mockups.json')).status, (await crop(OWNER, RUN_ID, '')).status],
		[404, 404],
	);
}

// ── Run images ────────────────────────────────────────────────────────────────
type Raw = { status: number; headers: Headers; bytes: Uint8Array };
/** A route called directly, for the headers and bytes `call()` does not read. */
async function raw(
	handler: (event: never) => Promise<Response>,
	user: User | null,
	path: string,
	runId: string,
): Promise<Raw> {
	const url = new URL(`http://x${path}`);
	try {
		const res = await handler({
			request: new Request(url),
			url,
			locals: { user },
			params: { runId },
		} as never);
		return {
			status: res.status,
			headers: res.headers,
			bytes: new Uint8Array(await res.arrayBuffer()),
		};
	} catch (e) {
		const s = status(e);
		if (typeof s !== 'number') throw e;
		return { status: s, headers: new Headers(), bytes: new Uint8Array() };
	}
}

console.log('images');
{
	const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
	const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70]);
	const WEBP = Uint8Array.from([
		...[0x52, 0x49, 0x46, 0x46, 0x1a, 0, 0, 0],
		...[0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20],
	]);
	const TEXT = new TextEncoder().encode('{"not":"an image"}');
	const mine = `${projectPrefix(C, NEW)}/director/mockups`;
	const otherProject = `${projectPrefix(C, 'hw')}/director/mockups/a.png`;
	BIN.set(`${mine}/a.png`, PNG);
	BIN.set(`${mine}/b.JPG`, JPEG);
	BIN.set(`${mine}/c.jpeg`, JPEG);
	BIN.set(`${mine}/d.webp`, WEBP);
	BIN.set(`${mine}/fake.png`, TEXT);
	BIN.set(`${mine}/data.json`, PNG);
	BIN.set(`${projectPrefix(C, NEW)}/director/crops/x.png`, PNG);
	BIN.set(otherProject, PNG);
	BIN.set('outside.png', PNG);
	BIN.set(`${projectPrefix(C, NEW)}-sibling/a.png`, PNG);
	const HUGE = new Uint8Array(6 * 1024 * 1024 + 1);
	HUGE.set(PNG);
	BIN.set(`${mine}/huge.png`, HUGE);
	const image = (user: User | null, key: string, runId = RUN_ID, v = '1') =>
		raw(
			imageRoute.GET,
			user,
			`/api/director/runs/${runId}/image?key=${encodeURIComponent(key)}&v=${v}`,
			runId,
		);

	const huge = await image(OWNER, `${mine}/huge.png`);
	check(
		'an image over the cap is 413 before its bytes are read',
		[huge.status, (JSON.parse(new TextDecoder().decode(huge.bytes)) as { error: string }).error],
		[413, 'too_large'],
	);
	const png = await image(OWNER, `${mine}/a.png`);
	check(
		'the owner reads a PNG with its own type, length and the hardening headers',
		[
			png.status,
			png.headers.get('content-type'),
			png.headers.get('content-length'),
			png.headers.get('cache-control'),
			png.headers.get('x-content-type-options'),
			png.headers.get('content-security-policy'),
			[...png.bytes],
		],
		[
			200,
			'image/png',
			String(PNG.length),
			'private, max-age=300',
			'nosniff',
			"default-src 'none'; sandbox",
			[...PNG],
		],
	);
	check(
		'a JPEG, under an upper-case or .jpeg name, is served as JPEG',
		await Promise.all(
			['b.JPG', 'c.jpeg'].map(async (f) => {
				const r = await image(OWNER, `${mine}/${f}`);
				return [r.status, r.headers.get('content-type')];
			}),
		),
		[
			[200, 'image/jpeg'],
			[200, 'image/jpeg'],
		],
	);
	const webp = await image(OWNER, `${mine}/d.webp`);
	check(
		'a WebP is served as WebP',
		[webp.status, webp.headers.get('content-type')],
		[200, 'image/webp'],
	);
	check(
		'the cache-buster’s value is ignored',
		(await image(OWNER, `${mine}/a.png`, RUN_ID, 'whatever')).status,
		200,
	);
	check(
		'a crop of the same project is an image too',
		(await image(OWNER, `${projectPrefix(C, NEW)}/director/crops/x.png`)).status,
		200,
	);

	check('no session is 401', (await image(null, `${mine}/a.png`)).status, 401);
	check(
		'a non-owner who can reach the project gets the run’s 404',
		(await image(ADMIN, `${mine}/a.png`)).status,
		404,
	);
	check('an unknown run is 404', (await image(OWNER, `${mine}/a.png`, 'no-such-run')).status, 404);
	check(
		'another project the owner can reach is 404, though the object is there',
		(await image(OWNER, otherProject)).status,
		404,
	);
	const refused: [string, string][] = [
		['a `..` segment', `${mine}/../../hw/director/mockups/a.png`],
		['a `..` that stays inside the prefix', `${mine}/x/../a.png`],
		['a leading slash', `/${mine}/a.png`],
		['a `//`', `${mine}//a.png`],
		['a backslash', `${mine}\\a.png`],
		['a control character', `${mine}/a\u0000.png`],
		['a key outside the prefix', 'outside.png'],
		['a sibling that only shares the prefix text', `${projectPrefix(C, NEW)}-sibling/a.png`],
		['the prefix alone', `${projectPrefix(C, NEW)}/`],
		['a .json key holding PNG bytes', `${mine}/data.json`],
		['a .png key holding text', `${mine}/fake.png`],
		['a key with no object', `${mine}/missing.png`],
		['no key', ''],
	];
	for (const [what, key] of refused) {
		const r = await image(OWNER, key);
		check(`${what} is 404`, [r.status, r.headers.get('content-type')], [404, null]);
	}
	const refusal = await call(imageRoute.GET, {
		user: OWNER,
		url: `/api/director/runs/${RUN_ID}/image?key=${encodeURIComponent(`${mine}/fake.png`)}`,
		params: { runId: RUN_ID },
	});
	check('the refusal says only that there is no such image', refusal, {
		status: 404,
		body: { error: 'No such image.' },
	});
	check(
		'a WebP mockup upload is still refused',
		[mockups.sniffImage(WEBP), mockups.sniffServedImage(WEBP), mockups.sniffServedImage(PNG)],
		[null, 'webp', 'png'],
	);
}

// ── Variants ──────────────────────────────────────────────────────────────────
console.log('variants');
{
	const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
	const variant = (user: User | null, query: string, runId = RUN_ID) =>
		raw(variantRoute.GET, user, `/api/director/runs/${runId}/variant?${query}`, runId);
	const q = (over: Record<string, string> = {}) =>
		new URLSearchParams({ atlas: 'symbols', region: 'Logo', id: '3', ...over }).toString();
	atlasAnswer = () => atlasBytes('image/jpeg', JPEG);

	let calls = ATLAS_CALLS.length;
	const refusedBeforeAtlas: [string, Raw][] = [
		['no session', await variant(null, q())],
		['a non-owner', await variant(ADMIN, q())],
		['an unknown run', await variant(OWNER, q(), 'no-such-run')],
		['no atlas', await variant(OWNER, q({ atlas: '' }))],
		['an atlas with a slash', await variant(OWNER, q({ atlas: '../x' }))],
		['a region with a space', await variant(OWNER, q({ region: 'Big Win' }))],
		['a region that climbs', await variant(OWNER, q({ region: '../Logo' }))],
		['no region', await variant(OWNER, q({ region: '' }))],
		['a non-numeric id', await variant(OWNER, q({ id: 'abc' }))],
		['an id with a path in it', await variant(OWNER, q({ id: '1/2' }))],
		['no id', await variant(OWNER, q({ id: '' }))],
		['a size that is neither', await variant(OWNER, q({ size: 'huge' }))],
	];
	check(
		'no session is 401; a non-owner, an unknown run and every malformed name are 404',
		refusedBeforeAtlas.map(([, r]) => r.status),
		[401, 404, 404, 404, 404, 404, 404, 404, 404, 404, 404, 404],
	);
	check('…and none of them reached atlas-tool', ATLAS_CALLS.length, calls);

	const thumb = await variant(OWNER, q());
	check(
		'the size defaults to the thumb, as the owner, for the run’s project',
		[
			ATLAS_CALLS.at(-1)?.call,
			ATLAS_CALLS.at(-1)?.ctx.agent,
			ATLAS_CALLS.at(-1)?.ctx.owner.id,
			ATLAS_CALLS.at(-1)?.ctx.scope,
			ATLAS_CALLS.at(-1)?.ctx.run.id,
			ATLAS_CALLS.at(-1)?.ctx.savedBy.tool,
			ATLAS_CALLS.at(-1)?.ctx.savedBy.agent,
			ATLAS_CALLS.at(-1)?.ctx.savedBy.runId,
			ATLAS_CALLS.at(-1)?.ctx.savedBy.uid,
		],
		[
			{ method: 'GET', path: '/vthumb/Logo', atlas: 'symbols', query: { id: '3' } },
			'worker',
			'owner',
			{ clientKey: C, projectKey: NEW },
			RUN_ID,
			'director',
			'worker',
			RUN_ID,
			'owner',
		],
	);
	check(
		'the thumb is served with its type, length, an hour-long cache and the hardening headers',
		[
			thumb.status,
			thumb.headers.get('content-type'),
			thumb.headers.get('content-length'),
			thumb.headers.get('cache-control'),
			thumb.headers.get('x-content-type-options'),
			thumb.headers.get('content-security-policy'),
			[...thumb.bytes],
		],
		[
			200,
			'image/jpeg',
			String(JPEG.length),
			'private, max-age=300',
			'nosniff',
			"default-src 'none'; sandbox",
			[...JPEG],
		],
	);
	await variant(OWNER, q({ size: 'thumb' }));
	check('size=thumb is the thumb', ATLAS_CALLS.at(-1)?.call.path, '/vthumb/Logo');
	calls = ATLAS_CALLS.length;
	const PNG_FULL = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);
	atlasAnswer = () => atlasBytes('image/png', PNG_FULL);
	const full = await variant(OWNER, q({ size: 'full', region: 'Wild(1)' }));
	check(
		'size=full asks for the full image',
		[
			ATLAS_CALLS.length - calls,
			ATLAS_CALLS.at(-1)?.call.path,
			full.status,
			full.headers.get('content-type'),
		],
		[1, '/vfull/Wild(1)', 200, 'image/png'],
	);

	atlasAnswer = () =>
		atlasBytes('image/svg+xml; charset=utf-8', new TextEncoder().encode('<svg/>'));
	const placeholder = await variant(OWNER, q({ id: '99' }));
	check('the placeholder SVG for an unknown id is 404', placeholder.status, 404);
	atlasAnswer = () => atlasBytes('image/png', new TextEncoder().encode('<svg/>'));
	check(
		'bytes that are not an image are 404 whatever atlas-tool’s header says',
		(await variant(OWNER, q({ id: '98' }))).status,
		404,
	);
	atlasAnswer = () => atlasBytes('image/png', JPEG);
	check(
		'the type served is the one the bytes sniff as',
		(await variant(OWNER, q({ id: '97' }))).headers.get('content-type'),
		'image/jpeg',
	);

	const HUGE_PNG = new Uint8Array(6 * 1024 * 1024 + 1);
	HUGE_PNG.set(PNG_FULL);
	atlasAnswer = () => atlasBytes('image/png', HUGE_PNG);
	const huge = await call(variantRoute.GET, {
		user: OWNER,
		url: `/api/director/runs/${RUN_ID}/variant?${q({ size: 'full' })}`,
		params: { runId: RUN_ID },
	});
	check('a body over the cap is 413 too_large', [huge.status, huge.body.error], [413, 'too_large']);

	const failWith = (e: unknown) => {
		atlasAnswer = () => {
			throw e;
		};
		return call(variantRoute.GET, {
			user: OWNER,
			url: `/api/director/runs/${RUN_ID}/variant?${q()}`,
			params: { runId: RUN_ID },
		});
	};
	const gone = await failWith(new AdapterError(404, 'not_found', '/vthumb/Logo: not found.'));
	check(
		'an adapter refusal keeps its status and code; atlas-tool’s own text never reaches the browser',
		[gone.status, gone.body.error, gone.body.message],
		[404, 'not_found', 'The Atlas Maker could not serve this variant.'],
	);
	const down = await failWith(new AdapterError(503, 'atlas_unavailable', 'Could not reach.'));
	check('…an outage is 503', [down.status, down.body.error], [503, 'atlas_unavailable']);
	const lost = await failWith(new ConflictError('manifests/x.json'));
	check('…a lost conditional write is 409', [lost.status, lost.body.error], [409, 'conflict']);
	const crash = await failWith(new Error('boom')).catch((e: Error) => e.message);
	check('…anything else is not swallowed', crash, 'boom');
}

// ── The game link ─────────────────────────────────────────────────────────────
console.log('game link');
{
	const game = async () =>
		((await summary(OWNER, RUN_ID)).body.run as { game: { url: string | null } }).game;
	check('a project with no game has no URL', await game(), { url: null });
	OWNED_GAMES.set(NEW, [
		{ key: 'sunken-temple', url: '/play/sunken-temple/?runtime=1' },
		{ key: 'sunken-temple-b', url: '/play/b/' },
	]);
	check('the first game’s URL', await game(), { url: '/play/sunken-temple/?runtime=1' });
	OWNED_GAMES.set(NEW, [{ key: 'sunken-temple', url: '' }]);
	check('a game with no URL yet is null', await game(), { url: null });
	OWNED_GAMES.delete(NEW);
}

// ── Fonts ─────────────────────────────────────────────────────────────────────
console.log('fonts');
{
	const root = `${projectPrefix(C, NEW)}/director/fonts/`;
	const request = (folder: string) => ({
		version: 1,
		status: 'awaiting_owner',
		folder,
		sourceFile: '_src-abc.ttf',
		sourceKey: '_shared/fonts/temple.ttf',
		recipe: { version: 1, face: 'Temple', preset: 'latin', bakeSize: 64 },
		saved_by: {
			tool: 'director',
			agent: 'builder',
			runId: RUN_ID,
			at: '2026-10-06T01:00:00Z',
			rev: 'r',
		},
	});
	put(`${root}title/request.json`, JSON.stringify(request('title')), undefined);
	put(`${root}numbers/request.json`, JSON.stringify(request('numbers')), undefined);
	// A doc whose own `folder` field lies, and a request.json nested too deep to be one.
	put(`${root}liar/request.json`, JSON.stringify(request('title')), undefined);
	put(`${root}deep/er/request.json`, JSON.stringify(request('deep')), undefined);
	const fontsUrl = `/api/director/fonts?project=${NEW}`;
	const list = await call(fontsRoute.GET, { user: OWNER, url: fontsUrl });
	check(
		'the staged requests are listed, by the key’s folder, one level down only',
		(
			list.body.requests as {
				folder: string;
				status: string;
				inCatalog: boolean;
				requestedBy: { agent: string };
			}[]
		).map((r) => [r.folder, r.status, r.inCatalog, r.requestedBy.agent]),
		[
			['liar', 'awaiting_owner', false, 'builder'],
			['numbers', 'awaiting_owner', false, 'builder'],
			['title', 'awaiting_owner', false, 'builder'],
		],
	);
	check(
		'a non-owner with the project reads them too',
		(await call(fontsRoute.GET, { user: ADMIN, url: fontsUrl })).status,
		200,
	);
	check(
		'without the project it is 403',
		(await call(fontsRoute.GET, { user: ART, url: '/api/director/fonts?project=other-game' }))
			.status,
		403,
	);
	const done = (body: unknown, user: User = OWNER) =>
		call(fontsRoute.POST, { user, url: fontsUrl, body });
	const notBaked = await done({ action: 'done', folder: 'title' });
	check(
		'done before the bake is refused',
		[notBaked.status, notBaked.body.error],
		[409, 'not_baked'],
	);
	FONTS.set(NEW, [{ id: 'title', folder: 'title' }]);
	const before = puts;
	const marked = await done({ action: 'done', folder: 'title' });
	const req = marked.body.request as Record<string, unknown>;
	check(
		'done once the font is in the catalog',
		[marked.status, req.status, (req.done as { by: unknown }).by, req.inCatalog],
		[200, 'done', { uid: 'owner', name: 'Owner' }, true],
	);
	check('…with one write', puts - before, 1);
	const stored = JSON.parse(R2.get(`${root}title/request.json`)!.body);
	check(
		'…stamped as the owner’s Director save',
		[stored.status, stored.saved_by.tool, stored.saved_by.uid, 'agent' in stored.saved_by],
		['done', 'director', 'owner', false],
	);
	const again = await done({ action: 'done', folder: 'title' });
	check(
		'marking again is idempotent: same answer, no write',
		[again.status, (again.body.request as { status: string }).status, puts - before],
		[200, 'done', 1],
	);
	const stale = await done({ action: 'done', folder: 'numbers', baseEtag: '"e1"' });
	check('a stale baseEtag is a conflict', [stale.status, stale.body.error], [409, 'conflict']);
	check('an unknown folder is 404', (await done({ action: 'done', folder: 'nope' })).status, 404);
	check('a bad folder is 404', (await done({ action: 'done', folder: '../x' })).status, 404);
	check('an unknown action is 400', (await done({ action: 'undo', folder: 'title' })).status, 400);
	const after = await call(fontsRoute.GET, { user: OWNER, url: fontsUrl });
	check(
		'awaiting requests list first',
		(after.body.requests as { folder: string }[]).map((r) => r.folder),
		['liar', 'numbers', 'title'],
	);
	check(
		'…and a done request still names the agent that staged it',
		(after.body.requests as { folder: string; requestedBy: unknown }[]).find(
			(r) => r.folder === 'title',
		)!.requestedBy,
		{ agent: 'builder', runId: RUN_ID, at: '2026-10-06T01:00:00Z' },
	);
}

// ── Mockups under a pending project ───────────────────────────────────────────
console.log('pending project');
{
	const get = (user: User, q: string) =>
		call(mockupsRoute.GET, { user, url: `/api/director/mockups?${q}` });
	const pending = await get(OWNER, 'project=coral-reef&client=acme');
	check(
		'a creatable key answers an empty doc, pending',
		[
			pending.status,
			pending.body.pending,
			(pending.body.doc as { images: unknown[] }).images.length,
		],
		[200, true, 0],
	);
	check(
		'…the key is lower-cased like Game Maker’s',
		(await get(OWNER, 'project=Coral-Reef&client=acme')).status,
		200,
	);
	check(
		'under a client the user may not create under it is 403',
		(await get(ART, 'project=coral-reef&client=other')).status,
		403,
	);
	check(
		'an unknown client is 403',
		(await get(ADMIN, 'project=coral-reef&client=nobody')).status,
		403,
	);
	check('a bad key is 403', (await get(ADMIN, 'project=Bad%20Key&client=acme')).status, 403);
	check('a deleted key is 403', (await get(ADMIN, 'project=gone')).status, 403);
	const existing = await get(OWNER, `project=${NEW}`);
	check(
		'an existing project is not pending',
		[existing.status, existing.body.pending],
		[200, false],
	);
	check(
		'…and keeps the project rule',
		(await get(ART, 'project=other-game&client=other')).status,
		403,
	);
	const form = new FormData();
	form.set('action', 'confirm_ownership');
	check(
		'a confirm on a pending key with no images is 400',
		(
			await call(mockupsRoute.POST, {
				user: OWNER,
				url: '/api/director/mockups?project=coral-reef&client=acme',
				form,
			})
		).status,
		400,
	);
	seedMockups('coral-reef', [image('a1b2c3d4e5f6072a')], null);
	const confirmed = await call(mockupsRoute.POST, {
		user: OWNER,
		url: '/api/director/mockups?project=coral-reef&client=acme',
		form,
	});
	check(
		'ownership can be confirmed on a pending project',
		[
			confirmed.status,
			(confirmed.body.doc as { ownershipConfirmed: { by: { uid: string } } }).ownershipConfirmed.by
				.uid,
		],
		[200, 'owner'],
	);
	check('…stored under the pending key', R2.has(docKey('coral-reef')), true);
	check(
		'a pending key another user confirmed is 403, for an admin too',
		(await get(ADMIN, 'project=coral-reef&client=acme')).status,
		403,
	);
	// Mockups uploaded by someone else under a free key: the create is refused like an
	// inaccessible project, and nothing is created.
	seedMockups(
		'lagoon',
		[{ ...image('a1b2c3d4e5f60720'), uploadedBy: { uid: 'art', name: 'Art' } }],
		{ by: { uid: 'art', name: 'Art' }, at: '2026-10-06T00:00:00Z' },
	);
	const before = [RUNS.size, duplicates];
	const theirs = await create(OWNER, createBody({ key: 'lagoon', requestId: 'lagoon-0001' }));
	check(
		'a create over another person’s pending mockups is 403',
		[theirs.status, theirs.body.error],
		[403, 'project_forbidden'],
	);
	check('…and creates nothing', [RUNS.size, duplicates], before);
	check(
		'the uploader may create it',
		(await create(ART, createBody({ key: 'lagoon', requestId: 'lagoon-0002' }))).status,
		201,
	);
}

console.log(`\n${checks} checks, ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
