/**
 * Contract check for the Invisible Director adapter gate, hard refusals and tool adapters
 * (ADR-0002; PLAN 2.1–2.6):
 *   pnpm --filter launcher-api check:director-adapters
 *
 * Runs the REAL route `POST /api/director/adapter/[tool]/[op]`, `director/gate.ts`, the registry,
 * the refusals, the Game Maker ops, `duplicateProject.ts`, `projectDuplicate.ts`,
 * `projectScaffold.ts`, the summary built on `buildGameProfile`, and the Admin › Projects
 * "Director template" action. Replaced at their boundaries: R2 (an in-memory bucket) and the
 * Postgres-backed modules (`projects`, `games`, `clients`, the two override tables and the Director
 * store), each by an in-memory table. Any export of a faked module the fixture does not implement
 * throws when called, so a path that reaches past the fakes fails loudly instead of passing.
 *
 * Pinned:
 *  - 2.1 wrong or missing token 401 (a session never stands in), unset 503; unknown op 404; an agent
 *    off the op's allow-list 403; an out-of-scope project 403; a disabled owner or one without
 *    Director 403; a replayed `opId` returns the stored result and does not run again; a failed
 *    write releases its `opId`; a storage conflict is `{ error: 'conflict' }`; writes carry the
 *    owner's `saved_by` stamped `tool: 'director'` and the agent.
 *  - 2.2 each refusal — publish, Game Config write, roles / overrides, merge, agent-definition
 *    write — is tried on purpose and refused, by the gate and by the registry; the target guard
 *    refuses `config/config.json`, `published/**`, `test_server/**` and the agent definitions
 *    whatever op declares them, before its handler runs.
 *  - 2.3 the template flag marks only published projects; `list_templates` / `get_template` return
 *    the GAME / USING chips, locked items and region counts per atlas; `create_from_template` makes
 *    the same `projects` row and R2 tree as Game Maker's own duplicate (scope full) and records the
 *    config ETags on the run; `get_project` reads it back. Every model agent's frontmatter `tools:`
 *    and the server-side allow-lists agree, and the worker's tool catalogue
 *    (`services/director-worker/src/tools.ts`) holds every registered op and no refused one.
 *  - 2.6 Symbols, Scene Editor, Win Text, Localization, Font Maker, Rigger and Flipbook, each over
 *    its tool's real storage module: a read, then a write on a stale baseEtag, is `conflict` and
 *    writes nothing; every doc written carries the `saved_by` stamp; and each op's own refusals —
 *    Scene nodes bound to the math, source-only unreviewed strings, a font bake that waits for the
 *    owner, a rig rebind that cannot re-time.
 *  - 8D (ADR-0008 §3, §4) the technician's ops against the fake atlas-tool: only reviewed image
 *    cards are listed; `/saveconfig` carries only atlas keys (run_on and off-card keys refused);
 *    `/saveadv` gets the whole card; refs are copied create-only; layers only on a scratch atlas
 *    this run made; `set_output` never over a tile the run did not commit; scratch atlases are
 *    never packed or deployed; and the queue gate renders only approved recipe steps.
 *  - OPEN_QUESTIONS 17: every `createProject` caller — Admin › Projects, Game Maker's create, the
 *    desktop launcher's project sync and the duplicate — answers a key whose R2 folder is another
 *    project's (live or deleted, same client) with a refusal naming that project, and leaves no
 *    row, scaffold or copy behind; Admin's re-assign and the sync's client change refuse the same
 *    move and change nothing. The rule itself is `check-project-create.ts`'s.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import type {
	DirectorAtlasJob,
	DirectorOp,
	DirectorRun,
	Game,
	Project,
} from '../src/lib/server/db/schema.ts';

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
const srcPath = (rel: string) => fileURLToPath(src(rel));

/** Every runtime export a module declares, so a fake can stand in for all of them. */
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

/** Fake a module: the given implementations, and a loud failure for every other export. */
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

// ── In-memory R2 ───────────────────────────────────────────────────────────────
type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
let copies = 0;
const byteReads: string[] = [];
const etag = () => `"e${++etagSeq}"`;
const keysUnder = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
type Cond = { ifMatch?: string; ifNoneMatch?: string };
function put(key: string, body: string, cond?: Cond): string {
	const cur = R2.get(key);
	if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
	if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
	const next = { body, etag: etag() };
	R2.set(key, next);
	return next.etag;
}
fake('lib/server/r2.ts', {
	ConflictError,
	precondition: (base: string | null | undefined) =>
		base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
	objectExists: async (key: string) => R2.has(key),
	headObject: async (key: string) =>
		R2.has(key) ? { etag: R2.get(key)!.etag, size: R2.get(key)!.body.length } : null,
	getObjectText: async (key: string) => R2.get(key)?.body ?? null,
	getObjectTextWithEtag: async (key: string) => {
		const o = R2.get(key);
		return o ? { text: o.body, etag: o.etag } : null;
	},
	getObjectBytes: async (key: string) => {
		byteReads.push(key);
		const o = R2.get(key);
		return o ? { body: new TextEncoder().encode(o.body), etag: o.etag } : null;
	},
	putObjectText: async (key: string, text: string, _type: string, cond?: Cond) =>
		put(key, text, cond),
	putObjectBytes: async (key: string, bytes: Uint8Array, _type: string, cond?: Cond) =>
		put(key, Buffer.from(bytes).toString('latin1'), cond),
	copyObject: async (from: string, to: string) => {
		const o = R2.get(from);
		if (!o) return false;
		copies++;
		R2.set(to, { ...o });
		return true;
	},
	deleteObject: async (key: string) => void R2.delete(key),
	deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
	listAllKeys: async (prefix: string) => keysUnder(prefix),
	listAllObjects: async (prefix: string) =>
		keysUnder(prefix).map((key) => ({ key, size: R2.get(key)!.body.length, lastModified: 1 })),
	listObjects: async (prefix: string) => ({ keys: keysUnder(prefix), prefixes: [] }),
});

// ── In-memory Postgres tables ─────────────────────────────────────────────────
const { ProjectFolderTakenError, projectPrefix } = await import(src('lib/server/projectPaths.ts'));
const folderOf = (key: string, client: string | null) => projectPrefix(client ?? 'unassigned', key);
type User = NonNullable<App.Locals['user']> & { active: boolean; expiresAt: Date | null };
const USERS = new Map<string, User>();
const PROJECTS = new Map<string, Project>();
const GAMES: Game[] = [];
const CLIENTS = new Set(['acme', 'other']);
/** userId → client keys granted. */
const CLIENT_GRANTS = new Map<string, Set<string>>();
const ROLE_OVERRIDES = new Map<string, Record<string, boolean>>();
const USER_OVERRIDES = new Map<string, Record<string, boolean>>();
const RUNS = new Map<string, DirectorRun>();
const OPS = new Map<string, DirectorOp>();
const ATLAS_JOBS = new Map<string, DirectorAtlasJob>();
/** runId → its stored recipes (`director_regions.recipe_json`). */
const RECIPES = new Map<string, unknown[]>();

const project = (key: string, over: Partial<Project> = {}): Project => ({
	key,
	name: key,
	clientKey: 'acme',
	gameType: 'lines',
	readToken: null,
	launcherProfile: null,
	deletedAt: null,
	directorTemplate: false,
	createdAt: new Date('2026-01-01T00:00:00Z'),
	...over,
});
const live = (key: string) => {
	const p = PROJECTS.get(key);
	return p && !p.deletedAt ? p : undefined;
};
const mayReach = (userId: string, role: string, key: string) => {
	const p = live(key);
	if (!p) return false;
	if (role === 'admin') return true;
	return p.clientKey !== null && (CLIENT_GRANTS.get(userId)?.has(p.clientKey) ?? false);
};

fake('lib/server/projects.ts', {
	DEFAULT_PROJECT_KEY: 'cloud',
	isValidProjectKey: (v: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),
	listProjects: async () => [...PROJECTS.values()].filter((p) => !p.deletedAt),
	projectExists: async (key: string) => Boolean(live(key)),
	projectKeyTaken: async (key: string) => PROJECTS.has(key),
	projectClientKey: async (key: string) => PROJECTS.get(key)?.clientKey ?? null,
	projectGameType: async (key: string) => PROJECTS.get(key)?.gameType || 'lines',
	storedProjectGameType: async (key: string) => PROJECTS.get(key)?.gameType || null,
	canAccessProject: async (userId: string, role: string, key: string) =>
		mayReach(userId, role, key),
	// The real rule (`check-project-create.ts` pins it): a key whose R2 folder is a project's under
	// the same client, live or deleted, is refused naming that project.
	createProject: async (key: string, name: string, clientKey: string | null, gameType?: string) => {
		const holder = [...PROJECTS.values()]
			.filter((p) => folderOf(p.key, p.clientKey) === folderOf(key, clientKey))
			.map((p) => p.key)
			.sort()[0];
		if (holder) throw new ProjectFolderTakenError(key, holder);
		PROJECTS.set(key, project(key, { name, clientKey, gameType: gameType ?? null }));
	},
	deleteProject: async (key: string) => void PROJECTS.delete(key),
	setProjectDirectorTemplate: async (key: string, on: boolean) => {
		const p = PROJECTS.get(key);
		if (p) p.directorTemplate = on;
	},
	listDirectorTemplateProjects: async () =>
		[...PROJECTS.values()].filter((p) => !p.deletedAt && p.directorTemplate),
});
fake('lib/server/games.ts', {
	listGames: async () => [...GAMES],
	listGamesOwnedByProject: async (key: string) => GAMES.filter((g) => g.projectKey === key),
});
fake('lib/server/clients.ts', {
	isValidClientKey: (v: string) => /^[a-z0-9][a-z0-9_-]{0,63}$/.test(v),
	// The real rule, as `createProject`'s (pinned by `check-project-create.ts`).
	assignProjectToClient: async (key: string, clientKey: string | null) => {
		const holder = [...PROJECTS.values()]
			.filter((p) => p.key !== key && folderOf(p.key, p.clientKey) === folderOf(key, clientKey))
			.map((p) => p.key)
			.sort()[0];
		if (holder) throw new ProjectFolderTakenError(key, holder);
		PROJECTS.get(key)!.clientKey = clientKey;
	},
	clientExists: async (key: string) => CLIENTS.has(key),
	mayCreateUnderClient: async (userId: string, role: string, clientKey: string | null) =>
		role === 'admin' ||
		(clientKey !== null && (CLIENT_GRANTS.get(userId)?.has(clientKey) ?? false)),
});
/** Desktop-launcher bearer tokens → their session user. */
const TOKENS = new Map<string, string>([['tok-owner', 'owner']]);
fake('lib/server/auth.ts', {
	SESSION_COOKIE: 'iw_session',
	validateSession: async (token: string | null) => {
		const u = token ? USERS.get(TOKENS.get(token) ?? '') : undefined;
		return u ? { id: u.id, email: u.email, name: u.name, role: u.role } : null;
	},
});
fake('lib/server/roleToolAccess.ts', {
	getRoleOverrides: async (role: string) => ROLE_OVERRIDES.get(role) ?? {},
});
fake('lib/server/userToolAccess.ts', {
	getToolOverrides: async (userId: string) => USER_OVERRIDES.get(userId) ?? {},
});
let claims = 0;
fake('lib/server/director/store.ts', {
	getRun: async (id: string) => RUNS.get(id) ?? null,
	runRecipes: async (id: string) => RECIPES.get(id) ?? [],
	projectOpResults: async (projectKey: string, op: string) =>
		[...OPS.values()]
			.filter(
				(o) => RUNS.get(o.runId)?.projectKey === projectKey && o.op === op && o.status === 'done',
			)
			.map((o) => o.result),
	doneOpResults: async (runId: string, op: string) =>
		[...OPS.values()]
			.filter((o) => o.runId === runId && o.op === op && o.status === 'done')
			.map((o) => o.result),
	getRunOwner: async (id: string) => {
		const u = USERS.get(id);
		if (!u || !u.active || (u.expiresAt && u.expiresAt.getTime() < Date.now())) return null;
		return { id: u.id, email: u.email, name: u.name, role: u.role };
	},
	markProjectCreateStarted: async (id: string) => {
		RUNS.get(id)!.projectCreateStartedAt = new Date();
	},
	setRunConfigEtags: async (id: string, e: { template: string | null; project: string | null }) => {
		const run = RUNS.get(id)!;
		run.templateConfigEtag = e.template;
		run.projectConfigEtag = e.project;
	},
	claimOp: async (row: {
		opId: string;
		runId: string;
		agent: string;
		op: string;
		inputHash: string;
	}) => {
		claims++;
		const existing = OPS.get(row.opId);
		if (existing) return { claimed: false, existing };
		OPS.set(row.opId, {
			...row,
			status: 'pending',
			result: null,
			createdAt: new Date(),
			completedAt: null,
		});
		return { claimed: true };
	},
	completeOp: async (opId: string, result: unknown) => {
		const row = OPS.get(opId)!;
		row.status = 'done';
		row.result = result;
	},
	releaseOp: async (opId: string) => {
		if (OPS.get(opId)?.status === 'pending') OPS.delete(opId);
	},
	insertAtlasJob: async (row: {
		jobRef: string;
		runId: string;
		agent: string;
		atlas: string;
		regions: string[];
	}) => {
		if (!ATLAS_JOBS.has(row.jobRef)) {
			ATLAS_JOBS.set(row.jobRef, {
				...row,
				status: 'queued',
				result: null,
				doneVia: null,
				queuedAt: new Date(),
				doneAt: null,
			});
		}
	},
	getAtlasJob: async (jobRef: string) => ATLAS_JOBS.get(jobRef) ?? null,
	settleAtlasJob: async (done: {
		jobRef: string;
		runId: string;
		status: DirectorAtlasJob['status'];
		result: unknown;
		via: 'callback' | 'poll';
	}) => {
		const row = ATLAS_JOBS.get(done.jobRef);
		if (!row || row.runId !== done.runId || row.status !== 'queued') return null;
		Object.assign(row, {
			status: done.status,
			result: done.result,
			doneVia: done.via,
			doneAt: new Date(),
		});
		return { ...row };
	},
});

const { POST } = await import(src('routes/api/director/adapter/[tool]/[op]/+server.ts'));
const { POST: DUPLICATE } = await import(src('routes/api/game-maker/duplicate/+server.ts'));
const { GET: CATALOG } = await import(src('routes/api/director/adapter/+server.ts'));
const { runAdapterCall } = await import(src('lib/server/director/gate.ts'));
const {
	ADAPTER_OPS,
	buildRegistry,
	TRANSITION_TOOLS,
	opId: opIdOf,
} = await import(src('lib/server/director/registry.ts'));
const { GAMEMAKER_OPS } = await import(src('lib/server/director/ops/gamemaker.ts'));
const { lockedItemsOf } = await import(src('lib/server/director/templates.ts'));
const { defineOp, DIRECTOR_AGENTS } = await import(src('lib/server/director/adapter.ts'));
const { refusedOp, refusedWriteTarget } = await import(src('lib/server/director/refusals.ts'));
const { putObjectText, precondition } = await import(src('lib/server/r2.ts'));

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

// ── Seed ──────────────────────────────────────────────────────────────────────
const user = (id: string, role: User['role'], over: Partial<User> = {}): User => ({
	id,
	email: `${id}@example.com`,
	name: id,
	role,
	active: true,
	expiresAt: null,
	...over,
});
USERS.set('owner', user('owner', 'admin'));
USERS.set('dev', user('dev', 'developer'));
USERS.set('gone', user('gone', 'admin', { active: false }));
USERS.set('nodirector', user('nodirector', 'admin'));
USER_OVERRIDES.set('dev', { director: true });
USER_OVERRIDES.set('nodirector', { director: false });
CLIENT_GRANTS.set('dev', new Set(['acme']));

const C = 'acme';
const prefix = (p: string) => `${C}/${p}/`;
const CONFIG = (p: string) => ({
	version: 1,
	providerName: 'IW',
	gameName: p,
	gameID: p,
	rtp: 96.5,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: { base: { cost: 1 }, bonus: { cost: 100 } },
	paylines: { 1: [1, 1, 1, 1, 1], 2: [0, 0, 0, 0, 0] },
	symbols: { H1: { paytable: [{ 5: 20 }] }, H2: { paytable: [{ 5: 10 }] }, W: {} },
	paddingReels: { basegame: [['H1', 'H2', 'W']] },
	cascade: true,
	assetRef: `${C}/${p}/manifests/atlas_manifest_symbols.json`,
});
function seedTemplate(key: string, over: Partial<Project> = {}, published = true): void {
	PROJECTS.set(key, project(key, { directorTemplate: true, ...over }));
	const client = over.clientKey === undefined ? C : (over.clientKey ?? 'unassigned');
	const root = `${client}/${key}/`;
	R2.set(`${root}config/config.json`, { body: JSON.stringify(CONFIG(key)), etag: etag() });
	R2.set(`${root}manifests/atlas_manifest_symbols.json`, {
		body: JSON.stringify({ regions: [{ name: 'H1' }, { name: 'H2' }, { name: 'W' }] }),
		etag: etag(),
	});
	R2.set(`${root}manifests/atlas_manifest_ui.json`, {
		body: JSON.stringify({ regions: [{ name: 'spin' }, { name: 'logo' }] }),
		etag: etag(),
	});
	R2.set(`${root}atlas/symbols.png`, { body: 'PNG', etag: etag() });
	R2.set(`${root}published/pointer.json`, { body: '{"current":"v1"}', etag: etag() });
	R2.set(`editor/${key}/components/btn.json`, { body: `{"projectKey":"${key}"}`, etag: etag() });
	if (published) {
		GAMES.push({
			key,
			name: key,
			url: '',
			projectKey: key,
			version: '1',
			builtAt: null,
			debug: false,
			createdAt: new Date(),
		});
	}
}
seedTemplate('tpl_lines');
seedTemplate('tpl_cluster', { gameType: 'cluster' });
seedTemplate('tpl_other', { clientKey: 'other' });
PROJECTS.set('plain', project('plain'));
GAMES.push({ ...GAMES[0], key: 'plain', projectKey: 'plain' });
PROJECTS.set('draft', project('draft'));

const run = (id: string, over: Partial<DirectorRun> = {}): DirectorRun => ({
	id,
	projectKey: `new_${id}`,
	clientKey: C,
	templateProjectKey: 'tpl_lines',
	ownerUserId: 'owner',
	projectCreateStartedAt: null,
	templateConfigEtag: null,
	projectConfigEtag: null,
	createdAt: new Date(),
	updatedAt: new Date(),
	...over,
});
for (const r of [
	run('r1'),
	run('rdev', { ownerUserId: 'dev', templateProjectKey: 'tpl_other' }),
	run('rgone', { ownerUserId: 'gone' }),
	run('rnod', { ownerUserId: 'nodirector' }),
	run('rexisting', { projectKey: 'plain' }),
]) {
	RUNS.set(r.id, r);
}

const TOKEN = 'director-token-0123456789abcdef';
type Answer = { status: number; body: Record<string, unknown>; replay: boolean };
async function call(
	tool: string,
	op: string,
	body: unknown,
	headers: Record<string, string> = { authorization: `Bearer ${TOKEN}` },
): Promise<Answer> {
	const request = new Request(`https://app.example/api/director/adapter/${tool}/${op}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify(body),
	});
	const locals = { user: { id: 'owner', email: 'o@example.com', name: 'o', role: 'admin' } };
	const res: Response = await POST({ params: { tool, op }, request, locals } as never);
	return {
		status: res.status,
		body: (await res.json()) as Record<string, unknown>,
		replay: res.headers.get('x-director-replay') === '1',
	};
}
const getProject = (runId: string, agent = 'coordinator') =>
	call('gamemaker', 'get_project', { runId, agent, input: {} });

// ── 2.1 Service token ─────────────────────────────────────────────────────────
delete process.env.DIRECTOR_SERVICE_TOKEN;
check('unset DIRECTOR_SERVICE_TOKEN is a 503', (await getProject('r1')).status, 503);
process.env.DIRECTOR_SERVICE_TOKEN = TOKEN;
check(
	'no token is a 401 (a session never stands in)',
	(await call('gamemaker', 'get_project', { runId: 'r1', agent: 'coordinator' }, {})).status,
	401,
);
check(
	'a wrong token is a 401',
	(
		await call(
			'gamemaker',
			'get_project',
			{ runId: 'r1', agent: 'coordinator' },
			{ authorization: 'Bearer nope' },
		)
	).status,
	401,
);
check(
	'another scheme is a 401',
	(
		await call(
			'gamemaker',
			'get_project',
			{ runId: 'r1', agent: 'coordinator' },
			{ authorization: `Basic ${TOKEN}` },
		)
	).status,
	401,
);
check(
	'a session cookie is a 401',
	(
		await call(
			'gamemaker',
			'get_project',
			{ runId: 'r1', agent: 'coordinator' },
			{ cookie: 'session=abc' },
		)
	).status,
	401,
);

// ── 2.1 Op, body, agent, run, owner ───────────────────────────────────────────
check(
	'an unknown op is a 404',
	(await call('gamemaker', 'nope', { runId: 'r1', agent: 'coordinator' })).status,
	404,
);
check(
	'a body without runId is a 400',
	(await call('gamemaker', 'get_project', { agent: 'coordinator' })).status,
	400,
);
{
	const res = await getProject('r1', 'qa');
	check(
		'an agent off the allow-list is a 403',
		[res.status, res.body.error],
		[403, 'agent_not_allowed'],
	);
	check('an unknown agent is a 403', (await getProject('r1', 'root')).status, 403);
}
check('an unknown run is a 404', (await getProject('nope')).status, 404);
check('a disabled owner is a 403', (await getProject('rgone')).status, 403);
check(
	'an owner whose Director access was revoked is a 403',
	(await getProject('rnod')).status,
	403,
);
{
	const res = await call('gamemaker', 'get_template', {
		runId: 'r1',
		agent: 'coordinator',
		input: { key: 'BAD KEY' },
	});
	check('input off the schema is a 400', [res.status, res.body.error], [400, 'invalid_input']);
	const extra = await call('gamemaker', 'get_template', {
		runId: 'r1',
		agent: 'coordinator',
		input: { key: 'tpl_lines', x: 1 },
	});
	check('an unknown input property is a 400', extra.status, 400);
}

// ── 2.1 Project scope: checked against the OWNER's grants on every call ───────
{
	const res = await getProject('r1');
	check(
		"the run's project does not exist yet: out of scope",
		[res.status, res.body.error],
		[403, 'out_of_scope'],
	);
	const dev = await call('gamemaker', 'create_from_template', {
		runId: 'rdev',
		agent: 'worker',
		opId: 'rdev:create:1',
		input: { name: 'X' },
	});
	check(
		"a template on a client the owner can't reach is a 403",
		[dev.status, dev.body.error],
		[403, 'out_of_scope'],
	);
	check(
		'...and nothing was claimed or created',
		[OPS.has('rdev:create:1'), PROJECTS.has('new_rdev')],
		[false, false],
	);
	const other = await call('gamemaker', 'get_template', {
		runId: 'rdev',
		agent: 'coordinator',
		input: { key: 'tpl_other' },
	});
	check('get_template on a project the owner cannot reach is a 403', other.status, 403);
}

// ── 2.2 Hard refusals: each tried on purpose ──────────────────────────────────
const REFUSED: [string, string, string][] = [
	['gamemaker', 'publish', 'publish'],
	['publish', 'game', 'publish'],
	['gamemaker', 'publish_all', 'publish'],
	['config', 'save', 'game_config'],
	['gameconfig', 'update_paytable', 'game_config'],
	['scene', 'set_bet_modes', 'game_config'],
	['roles', 'set_override', 'roles'],
	['admin', 'grant_tool', 'roles'],
	['access', 'list_overrides', 'roles'],
	['pipeline', 'merge', 'merge'],
	['github', 'create_branch', 'merge'],
	['changes', 'merge_change', 'merge'],
	['agents', 'write_definition', 'agent_definitions'],
	['run', 'update_agent_definition', 'agent_definitions'],
	// Names the first blocklist missed (code review, PLAN 2.2).
	['gamemaker', 'save_gameconfig', 'game_config'],
	['gamemaker', 'set_math', 'game_config'],
	['scene', 'set_rtp', 'game_config'],
	['symbols', 'update_reels', 'game_config'],
	['gamemaker', 'set_game_type', 'game_config'],
	['launcher', 'set_access', 'roles'],
	['launcher', 'assign_tool', 'roles'],
	['launcher', 'set_permissions', 'roles'],
	['build', 'push', 'merge'],
	['build', 'commit', 'merge'],
	['build', 'open_pr', 'merge'],
	['run', 'approve', 'merge'],
	['run', 'update_agent', 'agent_definitions'],
	// ADR-0008 §3 / §8: the technician's refusals, by name.
	['atlas', 'upload_blueprint', 'library'],
	['atlas', 'delete_card', 'library'],
	['atlas', 'save_card', 'library'],
	['atlas', 'save_taxonomy', 'library'],
	['blueprints', 'save', 'library'],
	['atlas', 'set_run_on', 'run_on'],
	['atlas', 'save_global_style', 'global_config'],
	['atlas', 'saveconfig', 'global_config'],
	['atlas', 'delete_variants', 'art_deletion'],
	['atlas', 'clear_output', 'art_deletion'],
	['atlas', 'remove_region', 'art_deletion'],
	['atlas', 'set_region_rect', 'template_rect'],
	['atlas', 'move_region', 'template_rect'],
	['atlas', 'add_region', 'template_add'],
	['atlas', 'new_atlas', 'template_add'],
];
for (const [tool, op, id] of REFUSED) {
	const res = await call(tool, op, {
		runId: 'r1',
		agent: 'coordinator',
		opId: 'r1:x:1',
		input: {},
	});
	check(
		`${tool}.${op} is refused as ${id}`,
		[res.status, res.body.error, res.body.refusal],
		[403, 'refused', id],
	);
}
for (const [tool, op, id] of REFUSED) {
	let thrown = '';
	try {
		buildRegistry([
			defineOp({
				tool,
				name: op,
				description: 'x',
				inputSchema: { type: 'object', properties: {}, additionalProperties: false },
				agents: ['coordinator'],
				scope: 'project',
				write: false,
				handler: async () => ({}),
			}),
		]);
	} catch (e) {
		thrown = (e as Error).message;
	}
	check(`the registry refuses to load ${tool}.${op}`, thrown.includes(`(${id})`), true);
}
{
	let thrown = '';
	try {
		buildRegistry([
			defineOp({
				tool: 'symbols',
				name: 'reset_project',
				description: 'x',
				inputSchema: { type: 'object', properties: {}, additionalProperties: false },
				agents: ['worker'],
				scope: 'template',
				write: true,
				createsProject: true,
				handler: async () => ({}),
			}),
		]);
	} catch (e) {
		thrown = (e as Error).message;
	}
	check(
		'no op but create_from_template may skip the write guard',
		thrown.includes('only gamemaker.create_from_template'),
		true,
	);
}
const declaredOps: unknown[] = [];
for (const file of readdirSync(srcPath('lib/server/director/ops/')).filter((f) =>
	f.endsWith('.ts'),
)) {
	const mod: Record<string, unknown> = await import(src(`lib/server/director/ops/${file}`));
	for (const [name, value] of Object.entries(mod)) {
		if (name.endsWith('_OPS') && Array.isArray(value)) declaredOps.push(...value);
	}
}
check(
	'every op the ops modules declare is registered',
	[...ADAPTER_OPS.keys()].length,
	declaredOps.length,
);

// ── 2.2 Target-key guard, whatever op declares the key ────────────────────────
let handlerRuns = 0;
const WRITE_OP = defineOp<{ key: string; baseEtag?: string | null }, { etag: string }>({
	tool: 'fixture',
	name: 'write_doc',
	description: 'A test-only write op that saves a doc where its input says.',
	inputSchema: {
		type: 'object',
		properties: { key: { type: 'string' }, baseEtag: { type: 'string' } },
		required: ['key'],
		additionalProperties: false,
	},
	agents: ['builder'],
	scope: 'project',
	write: true,
	writes: (input) => [input.key],
	handler: async (ctx, input) => {
		handlerRuns++;
		const doc = { hello: 'world', saved_by: ctx.savedBy };
		const etagOut = await putObjectText(
			input.key,
			JSON.stringify(doc),
			'application/json',
			precondition(input.baseEtag ?? null),
		);
		return { etag: etagOut };
	},
});
const TEST_REGISTRY = buildRegistry([...GAMEMAKER_OPS, WRITE_OP]);
const direct = (body: Record<string, unknown>) =>
	runAdapterCall(
		{ tool: 'fixture', op: 'write_doc', authorization: `Bearer ${TOKEN}`, body },
		TEST_REGISTRY,
		TOKEN,
	);
RUNS.set('rw', run('rw', { projectKey: 'plain' }));
let seq = 0;
for (const [key, id] of [
	[`${prefix('plain')}config/config.json`, 'game_config'],
	[`${prefix('plain')}published/pointer.json`, 'publish'],
	[`${prefix('plain')}published/v3/runtime.json`, 'publish'],
	['test_server/games.json', 'publish'],
	['test_server/plain/index.html', 'publish'],
	['services/director-worker/agents/qa.md', 'agent_definitions'],
	[prefix('plain'), 'game_config'],
	[`${prefix('plain')}config/`, 'game_config'],
	[`${prefix('plain')}config/backups/config-20261004.json`, 'game_config'],
	[`${prefix('plain')}../other/x.json`, 'publish'],
	['_shared/blueprints/birefnet/card.json', 'library'],
	['_shared/taxonomy.json', 'library'],
	[`${prefix('plain')}atlas_config.json`, 'global_config'],
] as const) {
	const res = await direct({
		runId: 'rw',
		agent: 'builder',
		opId: `rw:guard:${++seq}`,
		input: { key },
	});
	check(
		`a write to ${key} is refused as ${id}`,
		[res.status, (res.body as { refusal?: string }).refusal],
		[403, id],
	);
}
check('...and no refused write reached its handler', handlerRuns, 0);
check(
	'...nor left a claimed opId',
	[...OPS.keys()].filter((k) => k.startsWith('rw:guard')).length,
	0,
);
check(
	'a key outside the run project is out of scope',
	(
		await direct({
			runId: 'rw',
			agent: 'builder',
			opId: 'rw:scope:1',
			input: { key: `${prefix('draft')}symbols/symbols.json` },
		})
	).status,
	403,
);
check(
	'refusedWriteTarget allows an ordinary doc',
	refusedWriteTarget(`${prefix('plain')}symbols/symbols.json`),
	null,
);
check(
	'refusedWriteTarget allows a folder of docs',
	refusedWriteTarget(`${prefix('plain')}manifests/`),
	null,
);

// ── 2.1 Writes: opId, stamp, conflict, replay ─────────────────────────────────
const DOC = `${prefix('plain')}win-text/win-text.json`;
check(
	'a write without an opId is a 400',
	(await direct({ runId: 'rw', agent: 'builder', input: { key: DOC } })).status,
	400,
);
check(
	'an opId of another run is a 400',
	(await direct({ runId: 'rw', agent: 'builder', opId: 'r1:build:1', input: { key: DOC } })).status,
	400,
);
{
	const first = await direct({
		runId: 'rw',
		agent: 'builder',
		opId: 'rw:build:1',
		input: { key: DOC },
	});
	check('a write lands', first.status, 200);
	const stamp = JSON.parse(R2.get(DOC)!.body).saved_by;
	check(
		'...attributed to the owner, stamped tool director and the agent',
		[stamp.uid, stamp.tool, stamp.agent, stamp.runId],
		['owner', 'director', 'builder', 'rw'],
	);
	const runsBefore = handlerRuns;
	const etagBefore = R2.get(DOC)!.etag;
	const replay = await direct({
		runId: 'rw',
		agent: 'builder',
		opId: 'rw:build:1',
		input: { key: DOC },
	});
	check(
		'a replayed opId returns the same result',
		[replay.status, replay.body, replay.replayed],
		[200, first.body, true],
	);
	check('...without running again', [handlerRuns, R2.get(DOC)!.etag], [runsBefore, etagBefore]);
	const reused = await direct({ runId: 'rw', agent: 'coordinator', opId: 'rw:build:1', input: {} });
	check('an opId reused by another agent or op is not replayed to it', reused.status, 403);
	OPS.set('rw:build:9', {
		opId: 'rw:build:9',
		runId: 'rw',
		agent: 'builder',
		op: 'fixture.write_doc',
		inputHash: createHash('sha256')
			.update(JSON.stringify({ key: DOC }))
			.digest('hex'),
		status: 'pending',
		result: null,
		createdAt: new Date(),
		completedAt: null,
	});
	check(
		'an opId still running is a 409',
		(await direct({ runId: 'rw', agent: 'builder', opId: 'rw:build:9', input: { key: DOC } }))
			.status,
		409,
	);
	OPS.set('rw:build:8', {
		opId: 'rw:build:8',
		runId: 'rw',
		agent: 'builder',
		op: 'gamemaker.create_from_template',
		inputHash: '',
		status: 'done',
		result: {},
		createdAt: new Date(),
		completedAt: new Date(),
	});
	const other = await direct({
		runId: 'rw',
		agent: 'builder',
		opId: 'rw:build:8',
		input: { key: DOC },
	});
	check(
		'an opId used for another op is a 409',
		[other.status, (other.body as { error: string }).error],
		[409, 'op_id_reused'],
	);

	const stale = await direct({
		runId: 'rw',
		agent: 'builder',
		opId: 'rw:build:2',
		input: { key: DOC, baseEtag: '"stale"' },
	});
	check(
		'a storage 409 comes back as { error: conflict }',
		[stale.status, (stale.body as { error: string }).error],
		[409, 'conflict'],
	);
	check('...and releases its opId, so a retry runs', OPS.has('rw:build:2'), false);
	const retry = await direct({
		runId: 'rw',
		agent: 'builder',
		opId: 'rw:build:2',
		input: { key: DOC, baseEtag: R2.get(DOC)!.etag },
	});
	check('the retry with a fresh baseEtag lands', retry.status, 200);
}

// ── 2.3 Director template flag (Admin › Projects) ─────────────────────────────
{
	const { actions } = await import(src('routes/(app)/admin/+page.server.ts'));
	const act = async (key: string, on: boolean) => {
		const form = new FormData();
		form.set('key', key);
		form.set('on', String(on));
		const request = new Request('https://app.example/admin?/setDirectorTemplate', {
			method: 'POST',
			body: form,
		});
		const locals = { user: { id: 'owner', email: 'o@example.com', name: 'o', role: 'admin' } };
		const out = (await actions.setDirectorTemplate({ request, locals } as never)) as {
			status?: number;
		};
		return { status: out?.status ?? 200, flag: PROJECTS.get(key)?.directorTemplate };
	};
	check('an unpublished project cannot be marked', await act('draft', true), {
		status: 400,
		flag: false,
	});
	check('a published project can be marked', await act('plain', true), { status: 200, flag: true });
	check('...and unmarked', await act('plain', false), { status: 200, flag: false });
	check('an unknown project is refused', (await act('nope', true)).status, 400);
	let refused = false;
	try {
		await actions.setDirectorTemplate({
			request: new Request('https://app.example/admin', { method: 'POST', body: new FormData() }),
			locals: { user: { id: 'dev', email: 'd@example.com', name: 'd', role: 'developer' } },
		} as never);
	} catch {
		refused = true;
	}
	check('a non-admin cannot mark a template', refused, true);
}

// ── 2.3 list_templates / get_template ─────────────────────────────────────────
{
	seedTemplate('tpl_unpub', {}, false);
	const res = await call('gamemaker', 'list_templates', {
		runId: 'r1',
		agent: 'worker',
		input: { gameType: 'lines' },
	});
	const templates = res.body.templates as {
		key: string;
		chips: { game: { text: string }[]; using: { text: string }[] };
		lockedItems: { id: string; detail: string; facts?: unknown }[];
		regionGroups: { atlas: string; regions: number }[];
	}[];
	check(
		'list_templates: published lines templates the owner can reach',
		templates.map((t) => t.key),
		['tpl_lines', 'tpl_other'],
	);
	const t = templates[0];
	check('...with GAME chips', t.chips.game.length > 0, true);
	check(
		'...and USING chips',
		t.chips.using.map((c) => c.text),
		['Win-line display', 'Winning-symbol replay'],
	);
	check(
		'...the locked items',
		t.lockedItems.map((l) => l.id),
		['math', 'paytable', 'bet_modes', 'paylines', 'feature_rules'],
	);
	check(
		'...bet modes carry their buyBonus flag as data',
		t.lockedItems.find((l) => l.id === 'bet_modes')?.facts,
		{
			betModes: [
				{ id: 'base', buyBonus: false },
				{ id: 'bonus', buyBonus: false },
			],
		},
	);
	const scatterLike = lockedItemsOf({
		rtp: 0.97,
		numReels: 5,
		numRows: [3, 3, 3, 3, 3],
		symbols: {},
		paylines: {},
		betModes: { base: { buyBonus: false }, bonus: { buyBonus: true } },
	} as never).find((l) => l.id === 'bet_modes')!;
	check(
		'...a buy mode is told by its flag, not its name (scatter.json buys through `bonus`)',
		[scatterLike.detail, scatterLike.facts],
		[
			'base, bonus (buy)',
			{
				betModes: [
					{ id: 'base', buyBonus: false },
					{ id: 'bonus', buyBonus: true },
				],
			},
		],
	);
	check(
		'...described from the config',
		t.lockedItems.map((l) => l.detail),
		[
			'RTP 96.5, 5 reels × 3/3/3/3/3 rows',
			'2 paying symbols',
			'base, bonus',
			'2 paylines',
			'cascade',
		],
	);
	check(
		'...and region counts per atlas',
		t.regionGroups.map((g) => [g.atlas, g.regions]),
		[
			['symbols', 3],
			['ui', 2],
		],
	);
	const devList = await call('gamemaker', 'list_templates', {
		runId: 'rdev',
		agent: 'worker',
		input: { gameType: 'lines' },
	});
	check(
		"list_templates leaves out templates the owner can't reach",
		(devList.body.templates as { key: string }[]).map((x) => x.key),
		['tpl_lines'],
	);
	const cluster = await call('gamemaker', 'list_templates', {
		runId: 'r1',
		agent: 'worker',
		input: { gameType: 'cluster' },
	});
	check(
		'list_templates filters by game type',
		(cluster.body.templates as { key: string }[]).map((x) => x.key),
		['tpl_cluster'],
	);
	check(
		"list_templates is the worker's alone",
		(
			await call('gamemaker', 'list_templates', {
				runId: 'r1',
				agent: 'coordinator',
				input: { gameType: 'lines' },
			})
		).status,
		403,
	);

	const one = await call('gamemaker', 'get_template', {
		runId: 'r1',
		agent: 'mockup-analyst',
		input: { key: 'tpl_lines' },
	});
	check(
		'get_template returns the same summary',
		[one.status, one.body.key, one.body.regionGroups],
		[200, 'tpl_lines', t.regionGroups],
	);
	const notTemplate = await call('gamemaker', 'get_template', {
		runId: 'r1',
		agent: 'coordinator',
		input: { key: 'plain' },
	});
	check(
		'get_template on a project that is not a template is a 404',
		[notTemplate.status, notTemplate.body.error],
		[404, 'unknown_template'],
	);
}

// ── 2.3 create_from_template = Game Maker's duplicate, scope full ─────────────
{
	// The reference: a person duplicating the template from Game Maker.
	const ref = await DUPLICATE({
		request: new Request('https://app.example/api/game-maker/duplicate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				source: 'tpl_lines',
				key: 'by_hand',
				name: 'Neon',
				clientKey: C,
				scope: 'full',
			}),
		}),
		locals: { user: { id: 'owner', email: 'o@example.com', name: 'o', role: 'admin' } },
	} as never);
	check('the reference duplicate succeeds', ref.status, 200);

	RUNS.set('rc', run('rc', { projectKey: 'by_director' }));
	const before = { ...R2.get(`${prefix('tpl_lines')}config/config.json`)! };
	const res = await call('gamemaker', 'create_from_template', {
		runId: 'rc',
		agent: 'worker',
		opId: 'rc:create:1',
		input: { name: 'Neon' },
	});
	check('create_from_template succeeds', res.status, 200);
	const a = PROJECTS.get('by_hand')!;
	const b = PROJECTS.get('by_director')!;
	const row = (p: Project) => ({
		name: p.name,
		clientKey: p.clientKey,
		gameType: p.gameType,
		readToken: p.readToken,
		directorTemplate: p.directorTemplate,
		deletedAt: p.deletedAt,
	});
	check('...the same projects row as Game Maker', row(b), row(a));
	const tree = (root: string, key: string) =>
		keysUnder(root).map((k) => [k.slice(root.length), R2.get(k)!.body.replaceAll(key, '<P>')]);
	check(
		'...the same R2 project tree',
		tree(prefix('by_director'), 'by_director'),
		tree(prefix('by_hand'), 'by_hand'),
	);
	check(
		'...the same component tree',
		tree('editor/by_director/', 'by_director'),
		tree('editor/by_hand/', 'by_hand'),
	);
	check(
		'...with no published snapshot copied',
		keysUnder(`${prefix('by_director')}published/`),
		[],
	);
	check(
		'...the art copied (scope full)',
		R2.has(`${prefix('by_director')}atlas/symbols.png`),
		true,
	);
	const runRow = RUNS.get('rc')!;
	check(
		"the template config's ETag is recorded on the run",
		runRow.templateConfigEtag,
		before.etag,
	);
	check(
		"...and the copy's own",
		runRow.projectConfigEtag,
		R2.get(`${prefix('by_director')}config/config.json`)!.etag,
	);
	check(
		'...and returned',
		[res.body.templateConfigEtag, res.body.projectConfigEtag],
		[runRow.templateConfigEtag, runRow.projectConfigEtag],
	);

	const copiesBefore = copies;
	const replay = await call('gamemaker', 'create_from_template', {
		runId: 'rc',
		agent: 'worker',
		opId: 'rc:create:1',
		input: { name: 'Neon' },
	});
	check(
		'a replayed create returns the same result',
		[replay.status, replay.body, replay.replay],
		[200, res.body, true],
	);
	check('...and copies nothing again', copies, copiesBefore);
	const again = await call('gamemaker', 'create_from_template', {
		runId: 'rc',
		agent: 'worker',
		opId: 'rc:create:2',
		input: { name: 'Neon' },
	});
	check(
		'a second create for the run resumes rather than copying again',
		[again.status, again.body.resumed, again.body.projectConfigEtag, copies],
		[200, true, runRow.projectConfigEtag, copiesBefore],
	);
	const changed = await call('gamemaker', 'create_from_template', {
		runId: 'rc',
		agent: 'worker',
		opId: 'rc:create:1',
		input: { name: 'Other' },
	});
	check(
		'an opId replayed with a different input is a 409',
		[changed.status, changed.body.error],
		[409, 'op_id_reused'],
	);
	RUNS.set('rslug', run('rslug', { projectKey: 'by-hand' }));
	const slug = await call('gamemaker', 'create_from_template', {
		runId: 'rslug',
		agent: 'worker',
		opId: 'rslug:create:1',
		input: { name: 'X' },
	});
	check(
		"a key whose R2 tree is another project's (by-hand → by_hand) is refused",
		[slug.status, slug.body.error, PROJECTS.has('by-hand')],
		[409, 'project_exists', false],
	);
	check('...and releases that opId', OPS.has('rslug:create:1'), false);
	GAMES.splice(
		GAMES.findIndex((g) => g.projectKey === 'tpl_lines'),
		1,
	);
	RUNS.set('runpub', run('runpub'));
	const unpub = await call('gamemaker', 'create_from_template', {
		runId: 'runpub',
		agent: 'worker',
		opId: 'runpub:create:1',
		input: { name: 'X' },
	});
	check(
		'a template unpublished since it was marked cannot be copied',
		[unpub.status, unpub.body.error, PROJECTS.has('new_runpub')],
		[404, 'unknown_template', false],
	);
	check(
		'creating over an existing project is refused',
		(
			await call('gamemaker', 'create_from_template', {
				runId: 'rexisting',
				agent: 'worker',
				opId: 'rexisting:create:1',
				input: { name: 'X' },
			})
		).status,
		409,
	);
	check(
		'only the worker creates the project',
		(
			await call('gamemaker', 'create_from_template', {
				runId: 'rc',
				agent: 'coordinator',
				opId: 'rc:create:3',
				input: { name: 'X' },
			})
		).status,
		403,
	);

	const got = await getProject('rc');
	check(
		'get_project reads the new project back',
		[got.status, got.body.key, got.body.templateKey, got.body.published],
		[200, 'by_director', 'tpl_lines', false],
	);
	check('...with its config ETag', got.body.configEtag, runRow.projectConfigEtag);
	check(
		'...and the copied region groups',
		(got.body.regionGroups as { regions: number }[]).map((g) => g.regions),
		[3, 2],
	);
}
check('every adapter call that reached the ledger was a write', claims > 0, true);

// ── 2.4 Atlas Maker adapters, against a fake atlas-tool ───────────────────────
{
	const { createServer } = await import('node:http');
	const { createHmac } = await import('node:crypto');
	const { POST: CALLBACK } = await import(src('routes/api/director/atlas/callback/+server.ts'));
	const cb = await import(src('lib/server/director/atlasCallback.ts'));
	const jobs = await import(src('lib/server/director/atlasJobs.ts'));
	const { costOfRunpodJob, parsePricing } = await import(
		src('lib/server/costs/directorPricing.ts')
	);
	// The reviewed prices the worker bills a reported render with (ADR-0006).
	const PRICING = parsePricing(
		JSON.parse(
			readFileSync(
				fileURLToPath(new URL('../../../services/director-worker/pricing.json', import.meta.url)),
				'utf8',
			),
		),
	);

	const SIGNING = 'atlas-signing-secret-0123456789';
	const CB_SECRET = 'atlas-callback-secret-0123456789';
	process.env.ATLAS_TOOL_SIGNING_SECRET = SIGNING;
	process.env.ATLAS_CALLBACK_SECRET = CB_SECRET;
	process.env.ORIGIN = 'https://app.example';

	// The port matches still_jobs.py byte for byte: these were printed by the Python reference.
	check(
		'mintCallbackToken matches still_jobs.mint_callback_token',
		cb.mintCallbackToken(
			'vector-secret',
			'https://app.example/api/director/atlas/callback?run=r1',
			3600,
			1790000000_000,
		),
		'v1.1790003600.54bac12ed9c5205f13478c07706224f4aeffb8090db41a448a3d40935ce4c72d', // pragma: allowlist secret
	);
	check(
		'signCallbackBody matches still_jobs.sign_body',
		cb.signCallbackBody(
			'vector-secret',
			'{"jobRef": "st_0123456789abcdef", "status": "finished", "variants": []}',
			1790000000_000,
		),
		't=1790000000,v1=e6a70f02a97e36a8b4223383b868ac85b9a2b9e5393768cc4e8609b6af802421', // pragma: allowlist secret
	);

	// The project an atlas run works on, with one atlas.
	PROJECTS.set('atl', project('atl'));
	RUNS.set('ra', run('ra', { projectKey: 'atl' }));
	RUNS.set('rb', run('rb', { projectKey: 'atl' }));
	const MANIFEST = 'acme/atl/manifests/atlas_manifest_symbols.json';
	R2.set(MANIFEST, {
		body: JSON.stringify({
			atlas: { width: 100, height: 100 },
			regions: [
				{ name: 'H1', prompt: 'a ruby', seed: 7, lock: true, x: 0, y: 0, w: 50, h: 50 },
				{ name: 'H2', negative: 'blurry', x: 50, y: 0, w: 50, h: 50 },
				// Written before the explicit lock flag: its stored seed is what locks it.
				{ name: 'L1', prompt: 'old', seed: 9 },
			],
			rotated_regions: [{ name: 'W', prompt: 'a wild', variant: '00001' }],
			settings: { pipeline: 'sdxl', gen_width: 1024, gen_height: 1024 },
			saved_by: { rev: 'rev0', tool: 'atlas' },
		}),
		etag: etag(),
	});

	// ── The fake atlas-tool: verifies the api token, then answers like ui_server.py ──
	type Claims = {
		typ: string;
		client: string;
		project: string;
		uid: string;
		act?: { tool: string; agent: string; run: string };
	};
	const seen: { path: string; claims: Claims; manifest: string | null; body: string }[] = [];
	// The 8D routes (ADR-0008 §4), answered like ui_server.py does.
	const FIXTURE_CATALOGUE = JSON.parse(
		readFileSync(
			fileURLToPath(
				new URL('../../../docs/director/eval/blueprints/catalogue.json', import.meta.url),
			),
			'utf8',
		),
	) as { gpu: string; blueprints: Record<string, unknown>[] };
	let blueprintReads = 0;
	type Routed = {
		status: number;
		type: string;
		body: string | Buffer;
		headers?: Record<string, string>;
	};
	const text = (body: string): Routed => ({ status: 200, type: 'text/plain', body });
	// A manifest as the fake reads and edits it.
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	type Doc = Record<string, any>;
	const manifestOf = (m: string | null) =>
		`acme/atl/manifests/${m ?? 'atlas_manifest_symbols.json'}`;
	const editManifest = (m: string | null, edit: (doc: Doc) => void) => {
		const key = manifestOf(m);
		const doc = JSON.parse(R2.get(key)!.body);
		edit(doc);
		doc.saved_by = { tool: 'director', rev: `rev${R2.size}` };
		const tag = put(key, JSON.stringify(doc));
		return {
			'x-iw-doc-versions': JSON.stringify({
				[`manifests/${m}`]: { etag: tag, rev: doc.saved_by.rev },
			}),
		};
	};
	const regionsOf = (doc: Doc) => [...(doc.regions ?? []), ...(doc.rotated_regions ?? [])];
	function setupRoute(url: URL, raw: string, manifest: string | null): Routed | null {
		const body = raw ? JSON.parse(raw) : {};
		switch (url.pathname) {
			case '/blueprints':
				blueprintReads++;
				return {
					status: 200,
					type: 'application/json',
					body: JSON.stringify({
						gpu: FIXTURE_CATALOGUE.gpu,
						blueprints: [
							...FIXTURE_CATALOGUE.blueprints.map((b) => ({ ...b, status: 'reviewed' })),
							// What an agent must never get, even if the route ever served it.
							{ id: 'draft_one', kind: 'image', status: 'draft', card: {} },
							{ id: 'wan', kind: 'video', status: 'reviewed', card: {} },
						],
					}),
				};
			case '/saveconfig':
				return {
					...text('Settings saved (per-atlas overrides + globals)'),
					headers: editManifest(manifest, (doc) => {
						doc.settings = { ...doc.settings, pipeline: body.atlas_pipeline };
						doc.settings.gen_width = Number(body.gen_width);
						doc.settings.gen_height = Number(body.gen_height);
					}),
				};
			case '/saveadv':
				return {
					...text(`Advanced saved for ${body.name} (2 override(s))`),
					headers: editManifest(manifest, (doc) => {
						const r = regionsOf(doc).find((x) => x.name === body.name);
						for (const [k, v] of Object.entries(body.fields)) {
							if (v === '') delete r[k];
							else r[k] = v;
						}
					}),
				};
			case '/duplicateatlas': {
				const src = JSON.parse(R2.get(manifestOf(manifest))!.body);
				const key = `acme/atl/manifests/atlas_manifest_${body.name}.json`;
				if (R2.has(key))
					return text(`⚠ An atlas '${body.name}' already exists — pick another name.`);
				R2.set(key, {
					body: JSON.stringify({
						...src,
						regions: regionsOf(src).map((r) => ({ name: `${body.prefix}_${r.name}` })),
						rotated_regions: [],
					}),
					etag: etag(),
				});
				return text(`✓ Duplicated into '${body.name}'`);
			}
			case '/addlayer':
				editManifest(manifest, (doc) =>
					doc.regions.push({ name: `${body.base}_${body.suffix}`, layer_of: body.base }),
				);
				return text(`✓ Added layer '${body.base}_${body.suffix}' of '${body.base}'`);
			case '/addregion':
				editManifest(manifest, (doc) => doc.regions.push({ name: body.name }));
				return text(`✓ Added region '${body.name}'.`);
			case '/setmode':
				return text(`${body.name}: ${body.mode} mode — set the controls and ⚙ build`);
			case '/delregion':
				editManifest(manifest, (doc) => {
					doc.regions = doc.regions.filter((r: { name: string }) => r.name !== body.name);
				});
				return text(`✓ Removed region '${body.name}'.`);
			case '/setoutput': {
				const rel = `refs/useroutput/${body.name}_ra_abcdefabcdef.png`;
				return {
					...text(`✓ Committed ${rel} as the tile of ${body.name} (not processed).`),
					headers: editManifest(manifest, (doc) => {
						regionsOf(doc).find((x) => x.name === body.name).output_override = rel;
					}),
				};
			}
			case '/deployatlas':
				return text('✓ Deployed symbols_new.webp → acme/atl/deploy/sprites/symbols.webp');
		}
		if (url.pathname.startsWith('/regionadv/')) {
			const name = decodeURIComponent(url.pathname.slice('/regionadv/'.length));
			const r = regionsOf(JSON.parse(R2.get(manifestOf(manifest))!.body)).find(
				(x) => x.name === name,
			);
			const keys = [
				'pipeline',
				'ipadapter_weight',
				'checkpoint',
				'style_ref',
				'shape_ref',
				'fit_mode',
			];
			return {
				status: 200,
				type: 'application/json',
				body: JSON.stringify({ fields: keys.map((key) => ({ key, value: r?.[key] ?? '' })) }),
			};
		}
		if (url.pathname.startsWith('/vfull/')) {
			return url.searchParams.get('id') === '00002'
				? { status: 200, type: 'image/png', body: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }
				: { status: 200, type: 'image/svg+xml', body: '<svg/>' };
		}
		return null;
	}
	const progress = new Map<string, Record<string, unknown>>();
	let busy = false;
	let refuseCallbacks = false;
	let refSeq = 0;
	const server = createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const url = new URL(req.url ?? '/', 'http://atlas');
			const send = (status: number, type: string, body: string | Buffer, extra = {}) => {
				res.writeHead(status, { 'content-type': type, ...extra });
				res.end(body);
			};
			const token = String(req.headers['x-iw-launch'] ?? '');
			const [v, payload, sig] = token.split('.');
			const want = createHmac('sha256', SIGNING).update(`${v}.${payload}`).digest('base64url');
			if (v !== 'v1' || sig !== want) return send(403, 'text/plain', 'Forbidden');
			const claims = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Claims;
			const manifest = url.searchParams.get('manifest');
			seen.push({ path: url.pathname, claims, manifest, body: raw });
			if (manifest !== null && !R2.has(`acme/atl/manifests/${manifest}`)) {
				return send(404, 'application/json', '{"error":"unknown manifest"}');
			}
			const extra = setupRoute(url, raw, manifest);
			if (extra) return send(extra.status, extra.type, extra.body, extra.headers ?? {});
			const doc = JSON.parse(R2.get(MANIFEST)!.body);
			if (url.pathname.startsWith('/variants/')) {
				return send(200, 'application/json', '[{"id":"00002","seed":3},{"id":"00001","seed":2}]');
			}
			if (url.pathname.startsWith('/vthumb/')) {
				return url.searchParams.get('id') === '00002'
					? send(200, 'image/jpeg', Buffer.from([0xff, 0xd8, 0xff]))
					: send(200, 'image/svg+xml', '<svg/>');
			}
			if (url.pathname === '/save') {
				// docsave: the page's base must still be what R2 holds, unless only machine writes
				// moved it (same rev).
				const bases = JSON.parse(String(req.headers['x-iw-doc-bases'] ?? '{}'));
				const base = bases['manifests/atlas_manifest_symbols.json'];
				const cur = R2.get(MANIFEST)!;
				if (!base || (base.etag !== cur.etag && base.rev !== doc.saved_by?.rev)) {
					return send(409, 'application/json', '{"conflict":true,"reason":"stale"}');
				}
				for (const card of JSON.parse(raw)) {
					const r = [...doc.regions, ...doc.rotated_regions].find((x) => x.name === card.name);
					if (card.prompt) r.prompt = card.prompt;
					if (card.variant) r.variant = card.variant;
					else delete r.variant;
					if (card.negative) r.negative = card.negative;
					else delete r.negative;
					r.lock = card.lock && Boolean(card.seed || card.variant);
					if (card.lock && card.seed) r.seed = Number(card.seed);
					else delete r.seed;
				}
				doc.saved_by = {
					tool: claims.act?.tool ?? 'atlas',
					agent: claims.act?.agent,
					runId: claims.act?.run,
					uid: claims.uid,
					rev: `rev${R2.size}`,
				};
				const tag = put(MANIFEST, JSON.stringify(doc));
				return send(200, 'text/plain', 'Saved (1 prompt change(s))', {
					'x-iw-doc-versions': JSON.stringify({
						'manifests/atlas_manifest_symbols.json': { etag: tag, rev: doc.saved_by.rev },
					}),
				});
			}
			if (url.pathname === '/render') {
				if (refuseCallbacks && JSON.parse(raw).callbackUrl) {
					return send(
						400,
						'application/json',
						'{"started":false,"message":"callbacks are not configured on this server"}',
					);
				}
				if (busy) {
					return send(
						200,
						'application/json',
						'{"started":false,"message":"Ana is rendering","jobRef":null}',
					);
				}
				const jobRef = `st_${String(++refSeq).padStart(16, '0')}`;
				// Started, never finished: the render runs on with nobody waiting on it.
				progress.set(jobRef, {
					jobRef,
					status: 'running',
					total: 2,
					jobs: [],
					variants: [],
					// The GPU time so far, as atlas-tool reports it live (`still_jobs.runpod_summary`).
					runpod: { gpu: 'L40S (48 GB)', seconds: 30.5, delaySeconds: 2, jobs: 1, unreported: 0 },
				});
				return send(
					200,
					'application/json',
					JSON.stringify({ started: true, message: 'ok', jobRef }),
				);
			}
			if (url.pathname === '/createatlas') {
				return send(
					200,
					'application/json',
					JSON.stringify({ started: !busy, message: busy ? 'busy' : 'composing' }),
				);
			}
			if (url.pathname === '/progress') {
				const view = progress.get(url.searchParams.get('jobRef') ?? '');
				return view
					? send(200, 'application/json', JSON.stringify(view))
					: send(404, 'application/json', '{"error":"unknown jobRef"}');
			}
			return send(404, 'text/plain', 'not found');
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const port = (server.address() as { port: number }).port;
	process.env.ATLAS_TOOL_URL = `http://127.0.0.1:${port}`;

	let seqN = 0;
	const TECHNICIAN_OPS = new Set(['queue_variants', 'choose_variant', 'pack_sheet', 'job_status']);
	const atlas = (
		op: string,
		input: unknown,
		agent = TECHNICIAN_OPS.has(op) ? 'atlas-technician' : 'atlas-artist',
		runId = 'ra',
	) =>
		call(op === 'job_status' ? 'comfyui' : 'atlas', op, {
			runId,
			agent,
			opId: `${runId}:atlas:${++seqN}`,
			input,
		});

	// Reads come from R2 directly.
	{
		const listed = await atlas('list_regions', {}, 'mockup-analyst');
		check(
			'list_regions lists every atlas, rotated regions included',
			[
				listed.status,
				(listed.body.atlases as { atlas: string; regions: { name: string }[] }[]).map((a) => [
					a.atlas,
					a.regions.map((r) => r.name),
				]),
			],
			[200, [['symbols', ['H1', 'H2', 'L1', 'W']]]],
		);
		const got = await atlas('get_region', { atlas: 'symbols', region: 'H1' }, 'art-director');
		check(
			'get_region returns the region and the base a write hands back',
			[got.status, got.body.prompt, got.body.seed, got.body.base],
			[200, 'a ruby', 7, { etag: R2.get(MANIFEST)!.etag, rev: 'rev0' }],
		);
		check(
			'an unknown region is a 404',
			(await atlas('get_region', { atlas: 'symbols', region: 'Z9' })).status,
			404,
		);
		check(
			'an unknown atlas is a 404',
			(await atlas('get_region', { atlas: 'nope', region: 'H1' })).status,
			404,
		);
		const stats = await atlas('sheet_stats', { atlas: 'symbols' }, 'qa');
		check(
			'sheet_stats sizes the page and names the gaps',
			[stats.body.page, stats.body.regions, stats.body.fill, stats.body.withoutPrompt],
			[{ width: 100, height: 100 }, 4, 0.5, ['H2']],
		);
	}

	// Writes go through atlas-tool's /save, as the owner, stamped director + agent.
	{
		const base = (await atlas('get_region', { atlas: 'symbols', region: 'H2' })).body.base;
		const set = await call('atlas', 'set_region_prompt', {
			runId: 'ra',
			agent: 'atlas-artist',
			opId: 'ra:prompt:1',
			input: { atlas: 'symbols', region: 'H2', prompt: 'an emerald', base },
		});
		const doc = JSON.parse(R2.get(MANIFEST)!.body);
		const h2 = doc.regions.find((r: { name: string }) => r.name === 'H2');
		check(
			'set_region_prompt lands through /save with the other fields kept',
			[set.status, h2.prompt, h2.negative, doc.regions[0].seed, doc.regions[0].lock],
			[200, 'an emerald', 'blurry', 7, true],
		);
		check(
			'...stamped saved_by tool director, the agent and the run, as the owner',
			[doc.saved_by.tool, doc.saved_by.agent, doc.saved_by.runId, doc.saved_by.uid],
			['director', 'atlas-artist', 'ra', 'owner'],
		);
		const sent = seen.at(-1)!;
		check(
			'...over an api token scoped to the run project, naming its atlas',
			[sent.path, sent.claims.typ, sent.claims.client, sent.claims.project, sent.manifest],
			['/save', 'api', 'acme', 'atl', 'atlas_manifest_symbols.json'],
		);
		check(
			'...and its version comes back for the next write',
			(set.body.version as { rev: string }).rev,
			doc.saved_by.rev,
		);

		const legacy = await atlas('set_region_prompt', {
			atlas: 'symbols',
			region: 'L1',
			prompt: 'a new idol',
		});
		const l1 = JSON.parse(R2.get(MANIFEST)!.body).regions.find(
			(r: { name: string }) => r.name === 'L1',
		);
		check(
			'a region locked the pre-flag way keeps its lock and seed through a prompt change',
			[legacy.status, l1.prompt, l1.lock, l1.seed],
			[200, 'a new idol', true, 9],
		);
		check(
			'a whitespace-only prompt is refused before anything is saved',
			(await atlas('set_region_prompt', { atlas: 'symbols', region: 'H1', prompt: '  ' })).status,
			400,
		);
		check(
			'a region name with a space is refused (the variant routes cannot decode it)',
			(await atlas('get_region', { atlas: 'symbols', region: 'my region' })).status,
			400,
		);

		// A person saves the atlas after the agent read it: choose_variant on the old base conflicts.
		const stale = (await atlas('get_region', { atlas: 'symbols', region: 'W' })).body.base;
		const human = JSON.parse(R2.get(MANIFEST)!.body);
		human.saved_by = { tool: 'atlas', rev: 'human1', name: 'Ana' };
		put(MANIFEST, JSON.stringify(human));
		const chose = await call('atlas', 'choose_variant', {
			runId: 'ra',
			agent: 'atlas-technician',
			opId: 'ra:choose:1',
			input: { atlas: 'symbols', region: 'W', id: '00002', lock: false, base: stale },
		});
		check(
			"choose_variant over a person's newer save is { error: 'conflict' }",
			[chose.status, chose.body.error],
			[409, 'conflict'],
		);
		check(
			"...the person's save stands, and the opId is released",
			[JSON.parse(R2.get(MANIFEST)!.body).saved_by.rev, OPS.has('ra:choose:1')],
			['human1', false],
		);
		const retried = await call('atlas', 'choose_variant', {
			runId: 'ra',
			agent: 'atlas-technician',
			opId: 'ra:choose:2',
			input: { atlas: 'symbols', region: 'W', id: '00002', lock: false },
		});
		check(
			're-read and retried, the pick lands',
			[
				retried.status,
				JSON.parse(R2.get(MANIFEST)!.body).rotated_regions[0].variant,
				JSON.parse(R2.get(MANIFEST)!.body).rotated_regions[0].prompt,
			],
			[200, '00002', 'a wild'],
		);
		check(
			'a variant that was never rendered is a 404',
			(await atlas('choose_variant', { atlas: 'symbols', region: 'W', id: '00009', lock: false }))
				.status,
			404,
		);
	}

	// Variants and images.
	{
		const listed = await atlas('list_variants', { atlas: 'symbols', region: 'W' }, 'art-director');
		check(
			'list_variants returns the ids and the chosen one',
			[listed.body.chosen, (listed.body.variants as { id: string }[]).map((x) => x.id)],
			['00002', ['00002', '00001']],
		);
		const img = await atlas(
			'get_variant_image',
			{ atlas: 'symbols', region: 'W', id: '00002' },
			'qa',
		);
		check(
			'get_variant_image returns the bytes base64',
			[img.status, img.body.contentType, img.body.base64],
			[200, 'image/jpeg', '/9j/'],
		);
		check(
			"a variant atlas-tool answers with its placeholder is a 404, not an 'image'",
			(await atlas('get_variant_image', { atlas: 'symbols', region: 'W', id: '00007' }, 'qa'))
				.status,
			404,
		);
	}

	// The queue gate (ADR-0008 §3, §5): a render needs an approved recipe step.
	const recipe = (region: string, approved: boolean, variants = 3) => ({
		rev: 2,
		region,
		atlas: 'symbols',
		group: 'Symbols',
		approved: approved ? { by: 'owner', at: 'now', rev: 2 } : null,
		steps: [
			{ n: 1, kind: 'generate', pipeline: 'sdxl', atlas: 'symbols', region, genPx: 1024, variants },
		],
	});
	{
		const QUEUE = { atlas: 'symbols', regions: ['H1', 'H2'], variants: 3, step: 'H1#1' };
		const renders = () => seen.filter((x) => x.path === '/render').length;
		const before = renders();
		const none = await atlas('queue_variants', QUEUE);
		check(
			'a render with no recipe is refused before atlas-tool',
			[none.status, none.body.error],
			[409, 'no_approved_step'],
		);
		RECIPES.set('ra', [recipe('H1', true), recipe('H2', false)]);
		const half = await atlas('queue_variants', QUEUE);
		check(
			'...and so is one whose recipe the owner has not approved, naming the region',
			[half.status, half.body.error, String(half.body.message).includes('H2 (sdxl 1024 px ×3)')],
			[409, 'no_approved_step', true],
		);
		RECIPES.set('ra', [recipe('H1', true), recipe('H2', true, 2)]);
		check(
			'...or one whose approved step asks for other variants',
			(await atlas('queue_variants', QUEUE)).body.error,
			'no_approved_step',
		);
		RECIPES.set('ra', [
			recipe('H1', true),
			{ ...recipe('H2', true), approved: { by: 'o', at: 'n', rev: 1 } },
		]);
		check(
			'...or one revised since its approval',
			(await atlas('queue_variants', QUEUE)).body.error,
			'no_approved_step',
		);
		const h2 = recipe('H2', true);
		RECIPES.set('ra', [recipe('H1', true), { ...recipe('L1', true), steps: h2.steps }]);
		check(
			"a recipe never licenses another template region's render",
			(await atlas('queue_variants', QUEUE)).body.error,
			'no_approved_step',
		);
		RECIPES.set('ra', [
			recipe('H1', true),
			{ ...h2, steps: [{ ...h2.steps[0], status: 'queued' }] },
		]);
		check(
			'an approved step already rendered is not rendered again',
			(await atlas('queue_variants', QUEUE)).body.error,
			'no_approved_step',
		);
		RECIPES.set('ra', [
			recipe('H1', true),
			{ ...h2, steps: [{ ...h2.steps[0], settings: [{ key: 'ksampler_steps', value: '28' }] }] },
		]);
		check(
			'an atlas whose settings differ from the approved step does not render',
			(await atlas('queue_variants', QUEUE)).body.error,
			'no_approved_step',
		);
		RECIPES.set('ra', [recipe('H1', true), recipe('H2', true)]);
		check(
			'a step naming a region the call does not render is refused',
			(await atlas('queue_variants', { ...QUEUE, step: 'L1#1' })).status,
			400,
		);
		RUNS.get('ra')!.waitingOn = 'art_plan';
		check(
			'nothing renders while the Art plan is open',
			(await atlas('queue_variants', QUEUE)).body.error,
			'art_plan_open',
		);
		RUNS.get('ra')!.waitingOn = null;
		const doc = JSON.parse(R2.get(MANIFEST)!.body);
		const settings = doc.settings;
		delete doc.settings;
		R2.set(MANIFEST, { body: JSON.stringify(doc), etag: etag() });
		check(
			'an atlas the run has not configured (no atlas pipeline) does not render',
			(await atlas('queue_variants', QUEUE)).body.error,
			'atlas_not_configured',
		);
		doc.settings = settings;
		R2.set(MANIFEST, { body: JSON.stringify(doc), etag: etag() });
		check('...and none of these reached atlas-tool', renders(), before);
	}

	// queue_variants returns a jobRef at once; the render goes on without it.
	let jobRef = '';
	{
		const queued = await call('atlas', 'queue_variants', {
			runId: 'ra',
			agent: 'atlas-technician',
			opId: 'ra:queue:1',
			input: { atlas: 'symbols', regions: ['H1', 'H2', 'H1'], variants: 3, step: 'H1#1' },
		});
		jobRef = String(queued.body.jobRef);
		check(
			'queue_variants answers the recipe steps it matched, for the worker to mark',
			queued.body.steps,
			[
				{ recipe: 'H1', n: 1, region: 'H1' },
				{ recipe: 'H2', n: 1, region: 'H2' },
			],
		);
		check(
			'queue_variants answers with a jobRef while the render is still running',
			[queued.status, /^st_[0-9]{16}$/.test(jobRef), progress.get(jobRef)?.status],
			[200, true, 'running'],
		);
		const sent = JSON.parse(seen.at(-1)!.body);
		check(
			'...asking for a callback to this run, with a token minted for exactly that URL',
			[
				sent.names,
				sent.variants,
				sent.callbackUrl,
				cb.verifyCallbackToken(CB_SECRET, sent.callbackUrl, sent.callbackToken),
			],
			[['H1', 'H2'], 3, 'https://app.example/api/director/atlas/callback?run=ra', true],
		);
		check(
			'...and records the job queued for the run',
			[ATLAS_JOBS.get(jobRef)?.runId, ATLAS_JOBS.get(jobRef)?.status],
			['ra', 'queued'],
		);
		const replay = await call('atlas', 'queue_variants', {
			runId: 'ra',
			agent: 'atlas-technician',
			opId: 'ra:queue:1',
			input: { atlas: 'symbols', regions: ['H1', 'H2', 'H1'], variants: 3, step: 'H1#1' },
		});
		check(
			'a replayed queue returns the same jobRef and renders nothing new',
			[replay.replay, replay.body.jobRef, progress.size],
			[true, jobRef, 1],
		);
		refuseCallbacks = true;
		const plain = await atlas('queue_variants', {
			atlas: 'symbols',
			regions: ['H2'],
			variants: 3,
			step: 'H2#1',
		});
		check(
			'an atlas-tool without the callback secret still renders, settled by the poll',
			[
				plain.status,
				plain.body.callback,
				plain.body.tracked,
				JSON.parse(seen.at(-1)!.body).callbackUrl,
			],
			[200, false, true, undefined],
		);
		refuseCallbacks = false;
		busy = true;
		const refused = await atlas('queue_variants', {
			atlas: 'symbols',
			regions: ['H1'],
			variants: 3,
			step: 'H1#1',
		});
		check('a busy render slot is a 409 busy', [refused.status, refused.body.error], [409, 'busy']);
		const pack = await atlas('pack_sheet', { atlas: 'symbols' });
		check('a busy compose is a 409 busy too', [pack.status, pack.body.error], [409, 'busy']);
		busy = false;
		check(
			'pack_sheet starts the compose',
			[(await atlas('pack_sheet', { atlas: 'symbols' })).status, seen.at(-1)!.path],
			[200, '/createatlas'],
		);
		const status = await atlas('job_status', { jobRef });
		check(
			'comfyui.job_status reads /progress?jobRef= once',
			[status.status, status.body.status, status.body.recorded, seen.at(-1)!.path],
			[200, 'running', 'queued', '/progress'],
		);
		check('...and reports the GPU time spent so far, as the worker bills it', status.body.runpod, {
			gpu: 'L40S (48 GB)',
			seconds: 30.5,
			delaySeconds: 2,
			jobs: 1,
			unreported: 0,
		});
		check(
			"another run's job is not this run's to read",
			(await atlas('job_status', { jobRef }, 'atlas-technician', 'rb')).status,
			404,
		);
	}

	// The completion callback: verified, recorded exactly once.
	{
		const deliver = async (
			body: string,
			opts: { runId?: string; token?: string; signature?: string } = {},
		) => {
			const runId = opts.runId ?? 'ra';
			const url = `https://app.example/api/director/atlas/callback?run=${runId}`;
			const request = new Request(url, {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					'x-atlas-callback-token': opts.token ?? cb.mintCallbackToken(CB_SECRET, url, 3600),
					'x-atlas-signature': opts.signature ?? cb.signCallbackBody(CB_SECRET, body),
				},
				body,
			});
			const res: Response = await CALLBACK({ request, url: new URL(url) } as never);
			return { status: res.status, body: (await res.json()) as Record<string, unknown> };
		};
		const body = JSON.stringify({
			jobRef,
			status: 'finished',
			variants: [{ region: 'H1', variant: 'H1_00003_.png', slot: 1 }],
			// What atlas-tool reports, plus a price a forged body might carry.
			runpod: {
				gpu: 'L40S (48 GB)',
				seconds: 100,
				executionSeconds: 96.5,
				delaySeconds: 3.5,
				jobs: 2,
				unreported: 1,
				usd: 999,
			},
		});
		const first = await deliver(body);
		check('a valid callback records job_done', [first.status, first.body.recorded], [200, true]);
		check(
			'...on the run, from the callback',
			[ATLAS_JOBS.get(jobRef)?.status, ATLAS_JOBS.get(jobRef)?.doneVia],
			['finished', 'callback'],
		);
		const usage = {
			gpu: 'L40S (48 GB)',
			seconds: 100,
			executionSeconds: 96.5,
			delaySeconds: 3.5,
			jobs: 2,
			unreported: 1,
		};
		check(
			"...carrying the render's GPU time for the worker to bill, and no price off the wire",
			(ATLAS_JOBS.get(jobRef)?.result as { runpod?: unknown }).runpod,
			usage,
		);
		check(
			"...which prices from pricing.json: seconds × the GPU's $/s",
			costOfRunpodJob(usage.gpu, usage.seconds, PRICING),
			100 * PRICING.runpod.perSecondByGpu['L40S (48 GB)'],
		);
		const doneAt = ATLAS_JOBS.get(jobRef)?.doneAt;
		const again = await deliver(body);
		check(
			'a redelivery answers 200 and records nothing again',
			[again.status, again.body.recorded, ATLAS_JOBS.get(jobRef)?.doneAt === doneAt],
			[200, false, true],
		);
		const forged = await deliver(body, { signature: cb.signCallbackBody('not-the-secret', body) });
		check(
			'a forged signature is a 400',
			[forged.status, forged.body.error],
			[400, 'bad_signature'],
		);
		const otherBody = body.replace('finished', 'failed');
		check(
			'a body changed after signing is a 400',
			(await deliver(otherBody, { signature: cb.signCallbackBody(CB_SECRET, body) })).status,
			400,
		);
		const expiredUrl = 'https://app.example/api/director/atlas/callback?run=ra';
		check(
			'an expired token is a 400',
			(
				await deliver(body, {
					token: cb.mintCallbackToken(CB_SECRET, expiredUrl, 60, Date.now() - 3600_000),
				})
			).status,
			400,
		);
		check(
			'a stale signature (older than the tolerance) is a 400',
			(
				await deliver(body, {
					signature: cb.signCallbackBody(CB_SECRET, body, Date.now() - 3600_000),
				})
			).status,
			400,
		);
		check(
			"a token minted for another run's URL is a 400",
			(
				await deliver(body, {
					runId: 'rb',
					token: cb.mintCallbackToken(CB_SECRET, expiredUrl, 3600),
				})
			).status,
			400,
		);
		const stray = JSON.stringify({
			jobRef: 'st_ffffffffffffffff',
			status: 'finished',
			variants: [],
		});
		check('a callback for a job the run never queued is a 404', (await deliver(stray)).status, 404);

		// A finished render that reports no usable GPU time: nothing to bill, and it is logged.
		const queued = (ref: string) =>
			ATLAS_JOBS.set(ref, {
				jobRef: ref,
				runId: 'ra',
				agent: 'atlas-artist',
				atlas: 'symbols',
				regions: ['H1'],
				status: 'queued',
				result: null,
				doneVia: null,
				queuedAt: new Date(),
				doneAt: null,
			});
		const warned: string[] = [];
		const realWarn = console.warn;
		console.warn = (...args: unknown[]) => void warned.push(args.join(' '));
		try {
			queued('st_00000000000000ab');
			await deliver(
				JSON.stringify({ jobRef: 'st_00000000000000ab', status: 'finished', variants: [] }),
			);
			queued('st_00000000000000ac');
			await deliver(
				JSON.stringify({
					jobRef: 'st_00000000000000ac',
					status: 'finished',
					variants: [],
					runpod: { gpu: '', seconds: 7 },
				}),
			);
		} finally {
			console.warn = realWarn;
		}
		check(
			'a finished render with no GPU time passes no runpod on, and is logged',
			[
				'runpod' in (ATLAS_JOBS.get('st_00000000000000ab')?.result as object),
				warned.some((w) => w.includes('st_00000000000000ab') && w.includes('without reporting')),
			],
			[false, true],
		);
		check(
			'one with time but no GPU passes the seconds on with gpu null, and names the env to set',
			[
				(ATLAS_JOBS.get('st_00000000000000ac')?.result as { runpod?: unknown }).runpod,
				warned.some((w) => w.includes('st_00000000000000ac') && w.includes('RUNPOD_ENDPOINT_GPU')),
			],
			[{ gpu: null, seconds: 7 }, true],
		);
		delete process.env.ATLAS_CALLBACK_SECRET;
		check(
			'the callback route is a 503 while the secret is unset',
			(await deliver(body)).status,
			503,
		);
		process.env.ATLAS_CALLBACK_SECRET = CB_SECRET;
	}

	// The /progress fallback: code-side, on a backoff; it records only when the callback did not.
	{
		ATLAS_JOBS.set('st_00000000000000aa', {
			jobRef: 'st_00000000000000aa',
			runId: 'ra',
			agent: 'atlas-artist',
			atlas: 'symbols',
			regions: ['H1'],
			status: 'queued',
			result: null,
			doneVia: null,
			queuedAt: new Date(),
			doneAt: null,
		});
		const waits: number[] = [];
		const views: Record<string, unknown>[] = [
			{ status: 'running' },
			{ status: 'running' },
			// A failed render's GPU time was spent too; a malformed count is not passed on.
			{ status: 'failed', runpod: { gpu: 'L40S (48 GB)', seconds: 12, jobs: 'two' } },
		];
		const settled = await jobs.watchAtlasJob(
			{ jobRef: 'st_00000000000000aa', runId: 'ra' },
			{
				sleep: async (ms: number) => void waits.push(ms / 1000),
				read: async () => ({ jobRef: 'st_00000000000000aa', ...views.shift()! }),
				now: () => 0,
			},
		);
		check(
			'the fallback polls on a growing backoff and records the terminal status once',
			[waits, settled?.recorded, ATLAS_JOBS.get('st_00000000000000aa')?.doneVia],
			[[60, 120, 240], true, 'poll'],
		);
		check(
			'...with the GPU time the view reported, reduced to what the worker bills from',
			ATLAS_JOBS.get('st_00000000000000aa')?.result,
			{
				jobRef: 'st_00000000000000aa',
				status: 'failed',
				runpod: { gpu: 'L40S (48 GB)', seconds: 12 },
			},
		);
		const late = await jobs.watchAtlasJob(
			{ jobRef, runId: 'ra' },
			{
				sleep: async () => {},
				read: async () => {
					throw new Error('a settled job is never read');
				},
				now: () => 0,
			},
		);
		check('the fallback stops once the callback has settled the job', late, null);
	}

	// ── 8D: the technician's set-up ops (ADR-0008 §4) ──
	{
		const setup = await import(src('lib/server/director/ops/atlasSetup.ts'));
		setup.resetCatalogueCache();
		const tech = (op: string, input: unknown, opId = `ra:setup:${++seqN}`) =>
			call('atlas', op, { runId: 'ra', agent: 'atlas-technician', opId, input });
		const posted = (path: string) => seen.filter((x) => x.path === path);
		const baseOf = async (atlasId = 'symbols', region = 'H1') =>
			(await atlas('get_region', { atlas: atlasId, region }, 'atlas-technician')).body.base;

		const listed = await tech('list_blueprints', {});
		const ids = (listed.body.blueprints as { id: string }[]).map((b) => b.id);
		check(
			'list_blueprints serves the reviewed image cards with the endpoint GPU',
			[listed.status, listed.body.gpu, ids.includes('sdxl'), ids.includes('birefnet')],
			[200, 'L40S (48 GB)', true, true],
		);
		check(
			'...never a draft card or a video blueprint',
			[ids.includes('draft_one'), ids.includes('wan')],
			[false, false],
		);
		await tech('list_blueprints', {});
		check('...and is cached for a minute', blueprintReads, 1);
		check(
			'the coordinator may read the catalogue too',
			(await call('atlas', 'list_blueprints', { runId: 'ra', agent: 'coordinator', input: {} }))
				.status,
			200,
		);

		// set_atlas_pipeline: a positive whitelist of the atlas's own keys.
		const configs = () => posted('/saveconfig').length;
		const set = await tech('set_atlas_pipeline', {
			atlas: 'symbols',
			pipeline: 'sdxl',
			genPx: 1024,
			settings: [{ key: 'ksampler_steps', value: '28' }],
			base: await baseOf(),
		});
		check(
			'set_atlas_pipeline posts only atlas_pipeline, the size and the card keys, to the named atlas',
			[
				set.status,
				JSON.parse(posted('/saveconfig').at(-1)!.body),
				posted('/saveconfig').at(-1)!.manifest,
			],
			[
				200,
				{ atlas_pipeline: 'sdxl', gen_width: '1024', gen_height: '1024', ksampler_steps: '28' },
				'atlas_manifest_symbols.json',
			],
		);
		const bp = await tech('set_atlas_pipeline', {
			atlas: 'symbols',
			pipeline: 'fixture_upscale',
			genPx: 1024,
			settings: [{ key: 'scale', value: '2' }],
			base: await baseOf(),
		});
		check(
			"a blueprint's settings go to bpParams[<id>], typed by the card",
			[bp.status, JSON.parse(posted('/saveconfig').at(-1)!.body).bpParams],
			[200, { fixture_upscale: { scale: 2 } }],
		);
		const before = configs();
		const refusedConfig = async (name: string, input: Record<string, unknown>, want: unknown[]) => {
			const res = await tech('set_atlas_pipeline', {
				atlas: 'symbols',
				pipeline: 'sdxl',
				genPx: 1024,
				settings: [],
				base: await baseOf(),
				...input,
			});
			check(name, [res.status, res.body.refusal ?? res.body.error], want);
		};
		await refusedConfig(
			'a /saveconfig carrying run_on is refused as run_on',
			{ settings: [{ key: 'run_on', value: 'runpod' }] },
			[403, 'run_on'],
		);
		await refusedConfig(
			'a key off the card (the active atlas) is refused before atlas-tool',
			{ settings: [{ key: 'manifest_path', value: 'x.json' }] },
			[400, 'not_on_card'],
		);
		await refusedConfig(
			'a value outside the card range is refused',
			{ settings: [{ key: 'ksampler_steps', value: '90' }] },
			[400, 'bad_setting'],
		);
		await refusedConfig(
			'a per-region key is not an atlas setting',
			{ settings: [{ key: 'ipadapter_weight', value: '0.4' }] },
			[400, 'wrong_scope'],
		);
		await refusedConfig('a pipeline with no reviewed card is refused', { pipeline: 'draft_one' }, [
			400,
			'no_card',
		]);
		check('...and none of those reached /saveconfig', configs(), before);
		await tech('set_atlas_pipeline', {
			atlas: 'symbols',
			pipeline: 'sdxl',
			genPx: 1024,
			settings: [],
			base: await baseOf(),
		});

		// set_region_pipeline and set_refs re-send the whole advanced card.
		const doc0 = JSON.parse(R2.get(MANIFEST)!.body);
		doc0.regions[0].style_ref = 'refs/userref_H1.png';
		doc0.regions[0].checkpoint = 'mine.safetensors';
		R2.set(MANIFEST, { body: JSON.stringify(doc0), etag: etag() });
		const reg = await tech('set_region_pipeline', {
			atlas: 'symbols',
			region: 'H1',
			pipeline: '',
			fitMode: 'contain',
			settings: [{ key: 'ipadapter_weight', value: '0.5' }],
			base: await baseOf(),
		});
		check(
			'set_region_pipeline sends every advanced field, only the named ones changed',
			[reg.status, JSON.parse(posted('/saveadv').at(-1)!.body).fields],
			[
				200,
				{
					pipeline: '',
					ipadapter_weight: '0.5',
					checkpoint: 'mine.safetensors',
					style_ref: 'refs/userref_H1.png',
					shape_ref: '',
					fit_mode: 'contain',
				},
			],
		);
		check(
			'a per-atlas key is refused as a region setting',
			(
				await tech('set_region_pipeline', {
					atlas: 'symbols',
					region: 'H1',
					pipeline: '',
					fitMode: '',
					settings: [{ key: 'ksampler_steps', value: '30' }],
					base: await baseOf(),
				})
			).body.error,
			'wrong_scope',
		);
		// The atlas in the name, then a digest of (atlas, region, id): names can never collide.
		const variantRef = `refs/director_symbols_${createHash('sha256')
			.update(['symbols', 'W', '00002'].join('\u0000'))
			.digest('hex')
			.slice(0, 12)}.png`;
		const refs = await tech('set_refs', {
			atlas: 'symbols',
			region: 'H1',
			style: { source: 'variant', value: 'symbols/W/00002' },
			shape: { source: 'keep', value: '' },
			base: await baseOf(),
		});
		check(
			'set_refs copies a variant into the project refs (create-only) and points style_ref at it',
			[
				refs.status,
				refs.body.styleRef,
				R2.has(`acme/atl/input/${variantRef}`),
				JSON.parse(posted('/saveadv').at(-1)!.body).fields.checkpoint,
			],
			[200, variantRef, true, 'mine.safetensors'],
		);
		const again = await tech('set_refs', {
			atlas: 'symbols',
			region: 'H1',
			style: { source: 'variant', value: 'symbols/W/00002' },
			shape: { source: 'clear', value: '' },
			base: await baseOf(),
		});
		check('...a second copy of the same variant finds it there', again.status, 200);
		check(
			'a key that is not a Sheet Maker image is refused',
			(
				await tech('set_refs', {
					atlas: 'symbols',
					region: 'H1',
					style: { source: 'key', value: 'acme/atl/config/config.json' },
					shape: { source: 'keep', value: '' },
					base: await baseOf(),
				})
			).body.error,
			'bad_ref',
		);

		check(
			'a mockup crop named by anything but a region is refused before a key is built',
			(
				await tech('set_refs', {
					atlas: 'symbols',
					region: 'H1',
					style: { source: 'mockupCrop', value: '../other' },
					shape: { source: 'keep', value: '' },
					base: await baseOf(),
				})
			).body.error,
			'bad_ref',
		);

		// Layers only on a scratch atlas this run made.
		const addLayers = () => posted('/addlayer').length + posted('/addregion').length;
		const layersBefore = addLayers();
		const onTemplate = await tech('add_layer', {
			atlas: 'symbols',
			base: 'H1',
			suffix: 'gem',
			kind: 'ai',
			mode: '',
		});
		check(
			'add_layer on a template atlas is refused as layers',
			[onTemplate.status, onTemplate.body.refusal],
			[403, 'layers'],
		);
		const removeTemplate = await tech('remove_layer', {
			atlas: 'symbols',
			name: 'H1',
			base: await baseOf(),
		});
		check(
			'remove_layer on a template atlas is refused as layers',
			[removeTemplate.status, removeTemplate.body.refusal],
			[403, 'layers'],
		);
		check(
			'...and neither reached atlas-tool',
			addLayers() + posted('/delregion').length,
			layersBefore,
		);

		const dup = await tech('duplicate_atlas', {
			atlas: 'symbols',
			name: 'symbols_cut',
			tag: 'cut',
		});
		check(
			'duplicate_atlas makes the scratch copy and names its regions',
			[dup.status, dup.body.atlas, (dup.body.regions as { to: string }[]).map((r) => r.to)],
			[200, 'symbols_cut', ['cut_H1', 'cut_H2', 'cut_L1', 'cut_W']],
		);
		const ai = await tech('add_layer', {
			atlas: 'symbols_cut',
			base: 'cut_H1',
			suffix: 'gem',
			kind: 'ai',
			mode: '',
		});
		const fx = await tech('add_layer', {
			atlas: 'symbols_cut',
			base: 'cut_H1',
			suffix: '',
			kind: 'fx',
			mode: 'glow',
		});
		check(
			'on the scratch atlas an AI layer and an FX layer are added',
			[ai.status, ai.body.name, fx.status, fx.body.name, posted('/setmode').at(-1)!.manifest],
			[200, 'cut_H1_gem', 200, 'cut_H1_glow', 'atlas_manifest_symbols_cut.json'],
		);
		const cutBase = await baseOf('symbols_cut', 'cut_H1');
		const notOurs = await tech('remove_layer', {
			atlas: 'symbols_cut',
			name: 'cut_H2',
			base: cutBase,
		});
		check(
			'remove_layer of a region this run did not add is refused as art_deletion',
			notOurs.body.refusal,
			'art_deletion',
		);
		const removed = await tech('remove_layer', {
			atlas: 'symbols_cut',
			name: 'cut_H1_gem',
			base: cutBase,
		});
		check(
			'...and of its own layer, it is removed',
			[removed.status, posted('/delregion').length],
			[200, 1],
		);

		// Committing a chain's result, packing and deploying.
		const cutPack = await tech('pack_sheet', { atlas: 'symbols_cut' });
		check('a scratch atlas is never packed', cutPack.body.error, 'scratch_atlas');
		check(
			'...nor deployed',
			(await tech('deploy_atlas', { atlas: 'symbols_cut' })).body.error,
			'scratch_atlas',
		);
		const toScratch = await tech('set_output', {
			atlas: 'symbols_cut',
			region: 'cut_H1',
			from: { atlas: 'symbols', region: 'W', id: '00002' },
			base: cutBase,
		});
		check('a tile lands only on a template region', toScratch.body.error, 'scratch_atlas');
		const doc1 = JSON.parse(R2.get(MANIFEST)!.body);
		doc1.regions[1].output_override = 'refs/useroutput_H2.png';
		R2.set(MANIFEST, { body: JSON.stringify(doc1), etag: etag() });
		const outputs = () => posted('/setoutput').length;
		const persons = await tech('set_output', {
			atlas: 'symbols',
			region: 'H2',
			from: { atlas: 'symbols', region: 'W', id: '00002' },
			base: await baseOf('symbols', 'H2'),
		});
		check(
			"set_output over a person's committed tile is refused as art_deletion, before atlas-tool",
			[persons.status, persons.body.refusal, outputs()],
			[403, 'art_deletion', 0],
		);
		const committed = await tech('set_output', {
			atlas: 'symbols',
			region: 'H1',
			from: { atlas: 'symbols', region: 'W', id: '00002' },
			base: await baseOf(),
		});
		check(
			'set_output commits the variant PNG on the template region',
			[
				committed.status,
				JSON.parse(posted('/setoutput').at(-1)!.body).data,
				posted('/setoutput').at(-1)!.manifest,
			],
			[
				200,
				Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'),
				'atlas_manifest_symbols.json',
			],
		);
		const recommit = await tech('set_output', {
			atlas: 'symbols',
			region: 'H1',
			from: { atlas: 'symbols', region: 'W', id: '00002' },
			base: await baseOf(),
		});
		check('...and the run may replace its own tile', recommit.status, 200);
		check(
			'isRunTile recognises only this run’s versioned tile',
			[
				setup.isRunTile('refs/useroutput/H1_ra_abcdefabcdef.png', 'H1', 'ra'),
				setup.isRunTile('refs/useroutput/H1_rb_abcdefabcdef.png', 'H1', 'ra'),
				setup.isRunTile('refs/useroutput_H1.png', 'H1', 'ra'),
			],
			[true, false, false],
		);
		// A scratch atlas an earlier run of this project made is a scratch atlas too.
		R2.set('acme/atl/manifests/atlas_manifest_old_scratch.json', {
			body: JSON.stringify({ regions: [{ name: 'old_H1' }], saved_by: { rev: 'r' } }),
			etag: etag(),
		});
		OPS.set('rb:dup:1', {
			opId: 'rb:dup:1',
			runId: 'rb',
			agent: 'atlas-technician',
			op: 'atlas.duplicate_atlas',
			inputHash: 'x',
			status: 'done',
			result: { atlas: 'old_scratch' },
			createdAt: new Date(),
			completedAt: new Date(),
		});
		check(
			"another run's scratch atlas is never packed, deployed or given a tile",
			[
				(await tech('pack_sheet', { atlas: 'old_scratch' })).body.error,
				(await tech('deploy_atlas', { atlas: 'old_scratch' })).body.error,
				(
					await tech('set_output', {
						atlas: 'old_scratch',
						region: 'old_H1',
						from: { atlas: 'symbols', region: 'W', id: '00002' },
						base: await baseOf('old_scratch', 'old_H1'),
					})
				).body.error,
			],
			['scratch_atlas', 'scratch_atlas', 'scratch_atlas'],
		);
		const deployed = await tech('deploy_atlas', { atlas: 'symbols' });
		check(
			'deploy_atlas deploys a template atlas',
			[deployed.status, posted('/deployatlas').length],
			[200, 1],
		);
		const doc2 = JSON.parse(R2.get(MANIFEST)!.body);
		doc2.deploy_path = 'acme/atl/sprites/elsewhere';
		R2.set(MANIFEST, { body: JSON.stringify(doc2), etag: etag() });
		check(
			'...but not to a fully-qualified key outside deploy/',
			[
				(await tech('deploy_atlas', { atlas: 'symbols' })).body.error,
				posted('/deployatlas').length,
			],
			['deploy_path', 1],
		);
		doc2.deploy_path = 'acme/atl';
		R2.set(MANIFEST, { body: JSON.stringify(doc2), etag: etag() });
		check(
			"...nor to the project's root",
			(await tech('deploy_atlas', { atlas: 'symbols' })).body.error,
			'deploy_path',
		);
		delete doc2.deploy_path;
		R2.set(MANIFEST, { body: JSON.stringify(doc2), etag: etag() });

		const locked = await tech('choose_variant', {
			atlas: 'symbols',
			region: 'H2',
			id: '00002',
			lock: true,
		});
		check(
			"choose_variant with lock pins the pick with the variant's own seed",
			[
				locked.status,
				JSON.parse(posted('/save').at(-1)!.body)[0].lock,
				JSON.parse(posted('/save').at(-1)!.body)[0].seed,
			],
			[200, true, '3'],
		);
		const noStep = await tech('queue_variants', { atlas: 'symbols', regions: ['H2'], variants: 3 });
		check(
			'the technician must name its recipe step',
			[noStep.status, noStep.body.error],
			[400, 'invalid_input'],
		);
		RECIPES.set('ra', []);
		const legacy = await call('atlas', 'queue_variants', {
			runId: 'ra',
			agent: 'atlas-artist',
			opId: 'ra:legacy:1',
			input: { atlas: 'symbols', regions: ['H2'], variants: 1 },
		});
		check(
			"until its narrowed definition ships, the artist's definition still queues the pre-8D way",
			[legacy.status, typeof legacy.body.jobRef],
			[200, 'string'],
		);
		const legacyPick = await call('atlas', 'choose_variant', {
			runId: 'ra',
			agent: 'atlas-artist',
			opId: 'ra:legacy:2',
			input: { atlas: 'symbols', region: 'H2', id: '00002' },
		});
		check(
			"...and picks without `lock`, the region's pin left as it is",
			[legacyPick.status, legacyPick.body.locked],
			[200, true],
		);
		const unpin = await tech('choose_variant', {
			atlas: 'symbols',
			region: 'H2',
			id: '00002',
			lock: false,
		});
		check(
			'lock: false never unpins a pinned region',
			[unpin.status, unpin.body.locked, JSON.parse(posted('/save').at(-1)!.body)[0].lock],
			[200, true, true],
		);
		check(
			'every /saveconfig carried only atlas keys (no global, no run_on)',
			posted('/saveconfig')
				.flatMap((x) => Object.keys(JSON.parse(x.body)))
				.filter((k) => !setup.PER_ATLAS_KEYS.has(k) && k !== 'atlas_pipeline' && k !== 'bpParams'),
			[],
		);
	}

	// One disallowed agent per op.
	const DISALLOWED: [string, string, Record<string, unknown>][] = [
		['list_regions', 'builder', {}],
		['get_region', 'qa', { atlas: 'symbols', region: 'H1' }],
		['set_region_prompt', 'art-director', { atlas: 'symbols', region: 'H1', prompt: 'x' }],
		['queue_variants', 'coordinator', { atlas: 'symbols', regions: ['H1'], variants: 1 }],
		['list_variants', 'qa', { atlas: 'symbols', region: 'H1' }],
		['get_variant_image', 'atlas-artist', { atlas: 'symbols', region: 'H1', id: '00002' }],
		['choose_variant', 'art-director', { atlas: 'symbols', region: 'H1', id: '00002' }],
		['pack_sheet', 'builder', { atlas: 'symbols' }],
		['sheet_stats', 'atlas-artist', { atlas: 'symbols' }],
	];
	const before = seen.length;
	for (const [op, agent, input] of DISALLOWED) {
		const res = await atlas(op, input, agent);
		check(
			`atlas.${op}: ${agent} is refused`,
			[res.status, res.body.error],
			[403, 'agent_not_allowed'],
		);
	}
	const js = await atlas('job_status', { jobRef }, 'qa');
	check(
		'comfyui.job_status: qa is refused',
		[js.status, js.body.error],
		[403, 'agent_not_allowed'],
	);
	check('...and no refused call reached atlas-tool', seen.length, before);

	// Nothing an atlas op writes is a refused target, and every op names its own atlas.
	check(
		'the atlas ops declare no forbidden write target',
		[...ADAPTER_OPS.values()]
			.filter((op: { tool: string; write: boolean }) => op.tool === 'atlas' && op.write)
			.flatMap((op: { writes: (i: unknown, s: unknown) => string[] }) =>
				op.writes({ atlas: 'symbols' }, { clientKey: 'acme', projectKey: 'atl' }),
			)
			.filter((key: string) => refusedWriteTarget(key)),
		[],
	);
	check(
		'no atlas-tool route that publishes or writes the library was called, and only deploy_atlas deployed',
		seen
			.filter((s) =>
				[
					'/uploadblueprint',
					'/card/save',
					'/deleteblueprint',
					'/taxonomy/save',
					'/deployatlas',
				].includes(s.path),
			)
			.map((s) => `${s.path} ${s.manifest}`),
		['/deployatlas atlas_manifest_symbols.json'],
	);
	check(
		'every call but /progress and /blueprints named its atlas, so none used the shared active one',
		seen
			.filter((s) => !['/progress', '/blueprints'].includes(s.path) && s.manifest === null)
			.map((s) => s.path),
		[],
	);
	check(
		'every call to atlas-tool named the acting agent',
		seen.every((s) => s.claims.act?.tool === 'director' && s.claims.act.run !== ''),
		true,
	);

	delete process.env.ATLAS_TOOL_SIGNING_SECRET;
	const unsigned = await atlas('list_variants', { atlas: 'symbols', region: 'W' }, 'art-director');
	check(
		'without a signing secret no attributable call can be made: 503',
		[unsigned.status, unsigned.body.error],
		[503, 'atlas_unconfigured'],
	);
	server.close();
}

// ── 2.6 Symbols, Scene, Win Text, Localization, Fonts, Rigger, Flipbook ───────
{
	const paths = await import(src('lib/server/projectPaths.ts'));
	const { saveSymbolsDoc } = await import(src('lib/server/symbolsStorage.ts'));
	PROJECTS.set('tools', project('tools'));
	RUNS.set('rt', run('rt', { projectKey: 'tools' }));
	const P = 'acme/tools';
	let toolSeq = 0;
	const tool = (name: string, agent: string, input: unknown, write = false) => {
		const [t, o] = name.split('.');
		return call(t, o, {
			runId: 'rt',
			agent,
			...(write ? { opId: `rt:t26:${++toolSeq}` } : {}),
			input,
		});
	};
	/** A person's save from the tool's own page: the bytes stay, the version moves on. */
	const personSaves = (key: string) => R2.set(key, { ...R2.get(key)!, etag: etag() });
	const seedDoc = (key: string, doc: unknown) =>
		R2.set(key, { body: JSON.stringify(doc), etag: etag() });
	const stored = (key: string) => JSON.parse(R2.get(key)!.body);
	const stampOf = (key: string, agent: string, owner: string | null = 'owner') => {
		const s = stored(key).saved_by ?? {};
		return check(
			`${key.slice(P.length + 1)}: stamped saved_by tool director, ${agent}, the run and its owner`,
			[s.tool, s.agent, s.runId, s.uid ?? null],
			['director', agent, 'rt', owner],
		);
	};
	/** Read, a person saves, then a write on the read's baseEtag: a conflict that changes nothing. */
	async function staleIsConflict(
		label: string,
		key: string,
		write: (baseEtag: string) => Promise<Answer>,
		baseEtag: string,
	) {
		personSaves(key);
		const before = R2.get(key)!;
		const answer = await write(baseEtag);
		check(
			`${label}: a write on a stale baseEtag is a conflict`,
			[answer.status, answer.body.error],
			[409, 'conflict'],
		);
		check(`${label}: ...and writes nothing`, R2.get(key), before);
	}

	// Symbols
	const SYM = paths.symbolsDocKey(C, 'tools');
	seedDoc(SYM, {
		version: 1,
		symbols: { H1: { static: { type: 'sprite', assetKey: `${P}/manifests/a.json::h1` } } },
		winLine: { enabled: false },
		newerBlock: { kept: true },
	});
	const map = await tool('symbols.get_map', 'animator', {});
	check('symbols.get_map reads the bindings', map.body.symbols, {
		H1: { static: { type: 'sprite', assetKey: `${P}/manifests/a.json::h1` } },
	});
	check('symbols.get_map hands out the stored ETag', map.body.baseEtag, R2.get(SYM)!.etag);
	const winBinding = { type: 'spine', assetKey: 'h1_rig', animationName: 'win', loop: false };
	const setState = (baseEtag: string, binding: unknown = winBinding) =>
		tool('symbols.set_state', 'animator', { symbol: 'H1', state: 'win', binding, baseEtag }, true);
	await staleIsConflict('symbols.set_state', SYM, setState, String(map.body.baseEtag));
	const set = await setState(R2.get(SYM)!.etag);
	check('symbols.set_state lands', set.status, 200);
	check(
		'...binding the one state and keeping the rest of the doc',
		[
			stored(SYM).symbols.H1.win,
			stored(SYM).symbols.H1.static.type,
			stored(SYM).winLine,
			stored(SYM).newerBlock,
		],
		[winBinding, 'sprite', { enabled: false }, { kept: true }],
	);
	stampOf(SYM, 'animator');
	check(
		'symbols.set_state refuses a binding the tool would refuse',
		[(await setState(R2.get(SYM)!.etag, { type: 'flipbook', assetKey: 'x' })).body.error],
		['invalid_input'],
	);
	check(
		"symbols.set_state is the animator's: the builder is refused",
		(
			await tool(
				'symbols.set_state',
				'builder',
				{ symbol: 'H1', state: 'win', binding: winBinding, baseEtag: 'new' },
				true,
			)
		).status,
		403,
	);
	await saveSymbolsDoc(C, 'tools', stored(SYM), R2.get(SYM)!.etag);
	check("a person's later save drops the Director stamp", stored(SYM).saved_by, undefined);

	// Scene Editor
	const SCENE = paths.editorDocKey(C, 'tools');
	const sprite = (id: string, over: object = {}) => ({
		id,
		kind: 'sprite',
		x: 10,
		y: 10,
		assetKey: 'a::x',
		...over,
	});
	seedDoc(SCENE, {
		version: 2,
		projectKey: 'tools',
		mainSizesMap: {
			desktop: { width: 1920, height: 1080 },
			portrait: { width: 576, height: 1024 },
		},
		updatedAt: '',
		scenes: [
			{
				id: 'base',
				name: 'Base',
				role: 'basegame',
				nodes: [
					sprite('logo'),
					{ id: 'grid', kind: 'reelGrid', x: 0, y: 0, reels: 5, rows: 3, cellSize: 100 },
					{
						id: 'plus',
						kind: 'componentInstance',
						x: 0,
						y: 0,
						componentId: 'button',
						params: { action: 'increase' },
					},
					{
						id: 'spinBtn',
						kind: 'componentInstance',
						x: 0,
						y: 0,
						componentId: 'button',
						params: { action: 'spin' },
					},
					{
						id: 'group',
						kind: 'container',
						x: 0,
						y: 0,
						children: [
							{
								id: 'betLabel',
								kind: 'componentInstance',
								x: 0,
								y: 0,
								componentId: 'textBox',
								params: { source: 'bet' },
							},
						],
					},
					{ id: 'bg', kind: 'spine', x: 0, y: 0, assetKey: 'bg_rig' },
					{
						id: 'betWrap',
						kind: 'container',
						x: 0,
						y: 0,
						pressAction: 'betMenu',
						children: [sprite('betArt')],
					},
					sprite('pinned', { locked: true }),
					{ id: 'readout', kind: 'componentInstance', x: 0, y: 0, componentId: 'readout' },
					{
						id: 'oldMeter',
						kind: 'componentInstance',
						x: 0,
						y: 0,
						componentId: 'meter',
						componentVersion: 1,
					},
					{ id: 'ghost', kind: 'componentInstance', x: 0, y: 0, componentId: 'ghost' },
					{
						id: 'perLayout',
						kind: 'componentInstance',
						x: 0,
						y: 0,
						componentId: 'button',
						params: { action: 'spin' },
						overrides: { portrait: { params: { action: 'buyFeature' } } },
					},
				],
			},
			{ id: 'buy', name: 'Buy', role: 'buyFeature', nodes: [sprite('card')] },
			{ id: 'buyConfirm', name: 'Confirm', nodes: [sprite('confirmArt')] },
		],
	});
	const meter = (version: number, source: string) =>
		JSON.stringify({
			id: 'meter',
			name: 'Meter',
			version,
			scope: 'project',
			category: 'ui',
			root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
			params: [{ key: 'source', kind: 'string', default: source }],
		});
	R2.set(paths.projectComponentKey('tools', 'meter'), { body: meter(2, 'win'), etag: etag() });
	R2.set(paths.projectComponentVersionKey('tools', 'meter', 1), {
		body: meter(1, 'bet'),
		etag: etag(),
	});
	R2.set(paths.projectComponentKey('tools', 'readout'), {
		body: JSON.stringify({
			id: 'readout',
			name: 'Readout',
			version: 1,
			scope: 'project',
			category: 'ui',
			root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
			params: [{ key: 'source', kind: 'string', default: 'bet' }],
		}),
		etag: etag(),
	});
	const layout = await tool('scene.get_layout', 'builder', {});
	const bound = Object.fromEntries(
		(layout.body.screens as { nodes: { id: string; locked: string | null }[] }[]).flatMap((s) =>
			s.nodes.map((n) => [n.id, n.locked !== null]),
		),
	);
	check('scene.get_layout marks the nodes bound to the math', bound, {
		logo: false,
		grid: true,
		plus: true,
		spinBtn: false,
		group: true,
		bg: false,
		betWrap: true,
		pinned: true,
		readout: true,
		oldMeter: true,
		ghost: true,
		perLayout: true,
		card: true,
		confirmArt: true,
	});
	const changes = [
		{ screen: 'base', node: 'logo', x: 42, y: 7, assetKey: 'a::newlogo' },
		{ screen: 'base', node: 'grid', x: 99 },
		{ screen: 'base', node: 'plus', x: 99 },
		{ screen: 'base', node: 'group', x: 99 },
		{ screen: 'base', node: 'betLabel', assetKey: 'a::b' },
		{ screen: 'buy', node: 'card', assetKey: 'a::gold' },
		{ screen: 'base', node: 'bg', layout: 'portrait', x: 5, y: 6 },
		{ screen: 'base', node: 'bg', skin: 'gold' },
		{ screen: 'base', node: 'logo', clipId: 'spark' },
		{ screen: 'base', node: 'spinBtn', y: 3 },
		{ screen: 'base', node: 'betArt', assetKey: 'a::chip' },
		{ screen: 'base', node: 'pinned', x: 1 },
		{ screen: 'base', node: 'readout', x: 1 },
		{ screen: 'base', node: 'oldMeter', x: 1 },
		{ screen: 'base', node: 'ghost', x: 1 },
		{ screen: 'base', node: 'perLayout', x: 1 },
		{ screen: 'buyConfirm', node: 'confirmArt', assetKey: 'a::gold' },
	];
	const update = (baseEtag: string, list: unknown[] = changes) =>
		tool('scene.update_nodes', 'builder', { changes: list, baseEtag }, true);
	await staleIsConflict('scene.update_nodes', SCENE, update, String(layout.body.baseEtag));
	const updated = await update(R2.get(SCENE)!.etag);
	check('scene.update_nodes lands', updated.status, 200);
	check(
		'...refusing and listing every node bound to the math (or under a parent that is, or bound by its component), a locked node, and a field the node has not',
		(updated.body.refused as { node: string }[]).map((r) => r.node),
		[
			'grid',
			'plus',
			'group',
			'betLabel',
			'card',
			'logo',
			'betArt',
			'pinned',
			'readout',
			'oldMeter',
			'ghost',
			'perLayout',
			'confirmArt',
		],
	);
	const reasonOf = (node: string) =>
		(updated.body.refused as { node: string; reason: string }[]).find((r) => r.node === node)!
			.reason;
	check(
		'...reading the component version a node pins, failing closed on a def it cannot read, and locking a per-layout action and a buy screen found by its id alone',
		[
			reasonOf('oldMeter').includes('source defaults to "bet"'),
			reasonOf('ghost').includes('could not be read'),
			reasonOf('perLayout').includes('action on one layout is "buyFeature"'),
			reasonOf('confirmArt').includes('"buyConfirm" screen'),
		],
		[true, true, true, true],
	);
	check(
		'...and applying the rest',
		(updated.body.applied as { node: string }[]).map((r) => r.node),
		['logo', 'bg', 'bg', 'spinBtn'],
	);
	const scenes = stored(SCENE).scenes;
	const nodeOf = (screen: number, id: string) =>
		scenes[screen].nodes.find((n: { id: string }) => n.id === id);
	check(
		'...moving and re-skinning only what it applied',
		[
			nodeOf(0, 'logo').x,
			nodeOf(0, 'logo').assetKey,
			nodeOf(0, 'grid').x,
			nodeOf(0, 'plus').x,
			nodeOf(0, 'group').x,
			nodeOf(1, 'card').assetKey,
			nodeOf(0, 'bg').skin,
			nodeOf(0, 'bg').overrides,
			nodeOf(0, 'bg').x,
		],
		[42, 'a::newlogo', 0, 0, 0, 'a::x', 'gold', { portrait: { x: 5, y: 6 } }, 0],
	);
	check(
		'...with the same screens and nodes as before',
		scenes.map((s: { id: string; nodes: { id: string }[] }) => [s.id, s.nodes.map((n) => n.id)]),
		[
			[
				'base',
				[
					'logo',
					'grid',
					'plus',
					'spinBtn',
					'group',
					'bg',
					'betWrap',
					'pinned',
					'readout',
					'oldMeter',
					'ghost',
					'perLayout',
				],
			],
			['buy', ['card']],
			['buyConfirm', ['confirmArt']],
		],
	);
	stampOf(SCENE, 'builder');
	const sceneBefore = R2.get(SCENE);
	const unknown = await update(R2.get(SCENE)!.etag, [{ screen: 'base', node: 'newNode', x: 1 }]);
	check(
		'scene.update_nodes cannot add a node',
		[unknown.status, unknown.body.error],
		[404, 'unknown_node'],
	);
	const noScreen = await update(R2.get(SCENE)!.etag, [{ screen: 'newScreen', node: 'logo', x: 1 }]);
	check('...or a screen', [noScreen.status, noScreen.body.error], [404, 'unknown_screen']);
	const allLocked = await update('"held-by-the-agent"', [{ screen: 'base', node: 'grid', x: 1 }]);
	check(
		'a call whose every change is refused writes nothing, and hands back the baseEtag it was given',
		[allLocked.status, R2.get(SCENE), allLocked.body.baseEtag],
		[200, sceneBefore, '"held-by-the-agent"'],
	);
	R2.delete(SCENE);
	check(
		'scene.update_nodes on a project with no layout writes none',
		[(await update('new', [{ screen: 'base', node: 'logo', x: 1 }])).body.error, R2.has(SCENE)],
		['no_layout', false],
	);
	R2.set(SCENE, sceneBefore!);

	// Win Text
	const WT = paths.winTextDocKey(C, 'tools');
	seedDoc(WT, { version: 1, amountFormat: '{amount}', newerBlock: { kept: true } });
	const wt = await tool('wintext.get_doc', 'builder', {});
	check('wintext.get_doc reads the doc', wt.body.doc, { version: 1, amountFormat: '{amount}' });
	const edits = [
		{ path: 'toast.full', value: 'WIN {amount}' },
		{ path: 'lineMessage.byCount.5', value: 'FIVE {symbolName}' },
		{ path: 'amountFormat', value: '' },
	];
	const editWt = (baseEtag: string, list: unknown[] = edits) =>
		tool('wintext.update_doc', 'builder', { edits: list, baseEtag }, true);
	await staleIsConflict('wintext.update_doc', WT, editWt, String(wt.body.baseEtag));
	check('wintext.update_doc lands', (await editWt(R2.get(WT)!.etag)).status, 200);
	check(
		'...setting and clearing templates, keeping what a newer launcher wrote',
		[stored(WT).toast, stored(WT).lineMessage, stored(WT).amountFormat, stored(WT).newerBlock],
		[{ full: 'WIN {amount}' }, { byCount: { 5: 'FIVE {symbolName}' } }, undefined, { kept: true }],
	);
	stampOf(WT, 'builder');
	check(
		'wintext.update_doc refuses a field the doc does not have',
		[
			(await editWt(R2.get(WT)!.etag, [{ path: 'toast.bogus', value: 'x' }])).body.error,
			(await editWt(R2.get(WT)!.etag, [{ path: 'bogus', value: 'x' }])).body.error,
		],
		['invalid_input', 'invalid_input'],
	);

	// Localization
	const LOC = paths.localizationDocKey(C, 'tools');
	seedDoc(LOC, {
		sourceLang: 'en',
		targetLangs: ['es'],
		context: '',
		protectedTerms: [],
		updatedAt: '',
		entries: [
			{
				id: '1',
				key: 'title',
				source: 'Hello',
				origin: 'manual',
				translations: { es: { text: 'Hola', reviewed: true } },
			},
			{
				id: '2',
				key: 'scene.spin',
				source: 'Spin',
				origin: 'editor',
				translations: { es: { text: 'Girar', reviewed: true } },
			},
		],
	});
	const strings = await tool('localization.get_strings', 'builder', {});
	const shown = strings.body.strings as { key: string; origin: string }[];
	check(
		'localization.get_strings reads the stored rows, with their owners and review state',
		shown.slice(0, 2),
		[
			{ key: 'title', source: 'Hello', origin: 'manual', translations: { es: { reviewed: true } } },
			{
				key: 'scene.spin',
				source: 'Spin',
				origin: 'editor',
				translations: { es: { reviewed: true } },
			},
		],
	);
	check(
		'...and the text other tools own, as the page shows it',
		shown.find((e) => e.key === 'BET')?.origin,
		'uiText',
	);
	const writeStrings = (baseEtag: string, list: unknown[]) =>
		tool('localization.update_strings', 'builder', { strings: list, baseEtag }, true);
	const sourceEdits = [
		{ key: 'title', source: 'Hello there' },
		{ key: 'bonus.intro', source: 'Bonus!' },
		{ key: 'scene.spin', source: 'Go' },
		{ key: 'BET', source: 'STAKE' },
	];
	await staleIsConflict(
		'localization.update_strings',
		LOC,
		(b) => writeStrings(b, sourceEdits),
		String(strings.body.baseEtag),
	);
	const wrote = await writeStrings(R2.get(LOC)!.etag, sourceEdits);
	check(
		"localization.update_strings adds and changes source strings, refusing another tool's",
		[
			wrote.status,
			wrote.body.added,
			wrote.body.changed,
			(wrote.body.refused as { key: string }[]).map((r) => r.key),
		],
		[200, ['bonus.intro'], ['title'], ['scene.spin', 'BET']],
	);
	const entry = (key: string) => stored(LOC).entries.find((e: { key: string }) => e.key === key);
	check(
		'...a changed source keeps its translation, now unreviewed; a new one has none',
		[
			entry('title').source,
			entry('title').translations,
			entry('bonus.intro').translations,
			entry('bonus.intro').origin,
		],
		['Hello there', { es: { text: 'Hola', reviewed: false } }, {}, 'manual'],
	);
	check("...and the other tool's row is untouched", entry('scene.spin'), {
		id: '2',
		key: 'scene.spin',
		source: 'Spin',
		translations: { es: { text: 'Girar', reviewed: true } },
		origin: 'editor',
	});
	stampOf(LOC, 'builder');
	check(
		'...and never shadows a harvested key with a manual row the next page load takes back',
		entry('BET'),
		undefined,
	);
	check(
		'localization.update_strings never takes a translation or a review',
		[
			(
				await writeStrings(R2.get(LOC)!.etag, [
					{ key: 'title', source: 'Hi', translations: { es: { text: 'Hola', reviewed: true } } },
				])
			).body.error,
			(await writeStrings(R2.get(LOC)!.etag, [{ key: 'title', source: 'Hi', reviewed: true }])).body
				.error,
		],
		['invalid_input', 'invalid_input'],
	);

	for (const [label, key, op, input] of [
		[
			'wintext.update_doc',
			WT,
			'wintext.update_doc',
			{ edits: [{ path: 'amountFormat', value: 'x' }] },
		],
		[
			'localization.update_strings',
			LOC,
			'localization.update_strings',
			{ strings: [{ key: 'k', source: 'x' }] },
		],
	] as const) {
		R2.set(key, { body: '{ not json', etag: etag() });
		const before = R2.get(key);
		const answer = await tool(op, 'builder', { ...input, baseEtag: before!.etag }, true);
		check(
			`${label} refuses to write over an unreadable doc`,
			[answer.body.error, R2.get(key)],
			['unreadable_doc', before],
		);
	}

	// Font Maker
	const CATALOG = `${P}/fonts/fonts.json`;
	seedDoc(CATALOG, {
		prefix: `${P}/fonts`,
		fonts: [{ id: 'gold', name: 'Gold', kind: 'bitmap', folder: 'gold' }],
	});
	R2.set(`${P}/uploads/brand.ttf`, { body: '\u0000\u0001\u0000\u0000rest-of-font', etag: etag() });
	R2.set(`${P}/uploads/notes.ttf`, { body: 'not a font', etag: etag() });
	R2.set('other/x/uploads/brand.ttf', { body: '\u0000\u0001\u0000\u0000', etag: etag() });
	const catalogBefore = R2.get(CATALOG);
	const bake = (input: object, agent = 'builder') =>
		tool(
			'fonts.bake_from_ttf',
			agent,
			{
				folder: 'brand',
				face: 'Brand',
				source: `${P}/uploads/brand.ttf`,
				preset: 'digits',
				bakeSize: 64,
				baseEtag: 'new',
				...input,
			},
			true,
		);
	const baked = await bake({ fillColor: '#ffcc00' });
	const REQUEST = `${P}/director/fonts/brand/request.json`;
	check(
		'fonts.bake_from_ttf stages the bake, waiting for the owner',
		[
			baked.status,
			baked.body.status,
			stored(REQUEST).status,
			stored(REQUEST).recipe.effects.fill.color,
		],
		[200, 'awaiting_owner', 'awaiting_owner', '#ffcc00'],
	);
	check(
		'...copying the source beside it',
		R2.has(`${P}/director/fonts/brand/${stored(REQUEST).sourceFile}`),
		true,
	);
	check("...and adding nothing to the game's font catalog", R2.get(CATALOG), catalogBefore);
	stampOf(REQUEST, 'builder');
	const fonts = await tool('fonts.list', 'mockup-analyst', {});
	check(
		'fonts.list reads the catalog and the staged bakes',
		[
			(fonts.body.fonts as { id: string }[]).map((f) => f.id),
			(fonts.body.pending as { folder: string; status: string }[]).map((f) => [f.folder, f.status]),
		],
		[['gold'], [['brand', 'awaiting_owner']]],
	);
	const pendingEtag = (fonts.body.pending as { baseEtag: string }[])[0].baseEtag;
	await staleIsConflict(
		'fonts.bake_from_ttf',
		REQUEST,
		(baseEtag) => bake({ baseEtag }),
		pendingEtag,
	);
	R2.set(`${P}/uploads/brand2.ttf`, { body: '\u0000\u0001\u0000\u0000other-font', etag: etag() });
	const filesBefore = keysUnder(`${P}/director/fonts/brand/`);
	check(
		'...and restaging it as new is a conflict too',
		(await bake({ source: `${P}/uploads/brand2.ttf` })).body.error,
		'conflict',
	);
	check(
		'...that copies no source beside the request',
		keysUnder(`${P}/director/fonts/brand/`),
		filesBefore,
	);
	check(
		'fonts.bake_from_ttf will not shadow a font that exists',
		(await bake({ folder: 'gold' })).body.error,
		'font_exists',
	);
	check(
		'...reads no source outside the project',
		(await bake({ folder: 'b2', source: 'other/x/uploads/brand.ttf' })).body.error,
		'out_of_scope',
	);
	check(
		'...and stages only a real font',
		(await bake({ folder: 'b3', source: `${P}/uploads/notes.ttf` })).body.error,
		'bad_font',
	);
	check(
		"fonts.bake_from_ttf is the builder's alone",
		(await bake({ folder: 'b4' }, 'mockup-analyst')).status,
		403,
	);
	const HUGE = `${P}/uploads/huge.ttf`;
	R2.set(HUGE, {
		body: '\u0000\u0001\u0000\u0000'.padEnd(20 * 1024 * 1024 + 1, 'x'),
		etag: etag(),
	});
	const huge = await bake({ folder: 'b5', source: HUGE });
	check(
		'...and refuses a source over 20 MB without downloading it',
		[huge.status, huge.body.error, byteReads.includes(HUGE), keysUnder(`${P}/director/fonts/b5/`)],
		[413, 'too_large', false, []],
	);
	R2.delete(HUGE);

	// Rigger
	const RIG_DIR = `${P}/spines/hero`;
	const skeleton = {
		skeleton: { spine: '4.2.0' },
		bones: [{ name: 'root' }],
		slots: [
			{ name: 'body', bone: 'root', attachment: 'body' },
			{ name: 'hit', bone: 'root' },
			{ name: 'glow', bone: 'root' },
		],
		skins: [
			{
				name: 'default',
				attachments: {
					body: { body: { x: 1 } },
					hit: { box: { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 1, 1, 2, 2] } },
					glow: { fx: { name: 'body_gold' } },
				},
			},
		],
		animations: {
			idle: {
				slots: { body: { attachment: [{ time: 0.5, name: 'body' }] } },
				bones: {
					root: {
						rotate: [
							{ time: 0, value: 0 },
							{ time: 1, value: 10 },
						],
					},
				},
			},
		},
	};
	seedDoc(`${RIG_DIR}/hero.json`, skeleton);
	R2.set(`${RIG_DIR}/hero.atlas`, {
		body: 'hero.png\nsize: 64,64\nfilter: Linear,Linear\nbody\nbounds: 0,0,10,10\nbody_gold\nbounds: 10,0,10,10\n',
		etag: etag(),
	});
	R2.set(`${RIG_DIR}/hero.png`, { body: 'PNG', etag: etag() });
	seedDoc(`${RIG_DIR}/hero..v2.json`, skeleton);
	const sourceBefore = R2.get(`${RIG_DIR}/hero.json`);
	const rigs = await tool('rigger.list_rigs', 'animator', {});
	const hero = (rigs.body.rigs as Record<string, unknown>[])[0];
	check(
		'rigger.list_rigs lists the rigs whose names rebind cannot address, apart',
		[(rigs.body.rigs as unknown[]).length, rigs.body.unsupported, rigs.body.truncated],
		[1, ['hero/hero..v2'], false],
	);
	check(
		'rigger.list_rigs reads the rig, its atlas and what each attachment draws',
		[
			hero.dir,
			hero.stem,
			hero.hasIrig,
			hero.atlas,
			hero.animations,
			hero.attachments,
			hero.baseEtag,
		],
		[
			'hero',
			'hero',
			false,
			'hero.atlas',
			['idle'],
			[
				{ skin: 'default', slot: 'body', attachment: 'body', type: 'region', region: 'body' },
				{ skin: 'default', slot: 'hit', attachment: 'box', type: 'boundingbox', region: null },
				{ skin: 'default', slot: 'glow', attachment: 'fx', type: 'region', region: 'body_gold' },
			],
			'new',
		],
	);
	const rebind = (baseEtag: string, rebinds: unknown[], extra: object = {}) =>
		tool(
			'rigger.rebind_attachments',
			'animator',
			{ dir: 'hero', stem: 'hero', rebinds, baseEtag, ...extra },
			true,
		);
	const rebound = await rebind('new', [
		{ slot: 'body', attachment: 'body', region: 'body_gold' },
		{ slot: 'hit', attachment: 'box', region: 'body_gold' },
		{ slot: 'body', attachment: 'missing', region: 'body_gold' },
		{ slot: 'body', attachment: 'body', region: 'not_in_atlas' },
	]);
	check(
		'rigger.rebind_attachments re-points region attachments, refusing and listing the rest',
		[
			rebound.status,
			(rebound.body.applied as unknown[]).length,
			(rebound.body.refused as { attachment: string }[]).map((r) => r.attachment),
		],
		[200, 1, ['box', 'missing', 'body']],
	);
	const IRIG = `${RIG_DIR}/hero.irig`;
	check(
		'...saving the rig as its .irig, with the attachment pointed at the new region',
		stored(IRIG).skins[0].attachments.body.body,
		{ x: 1, path: 'body_gold' },
	);
	check(
		'...and no re-timing: bones, slots and every animation are byte-identical',
		[stored(IRIG).bones, stored(IRIG).slots, stored(IRIG).animations],
		[skeleton.bones, skeleton.slots, skeleton.animations],
	);
	check("...the artist's source .json is untouched", R2.get(`${RIG_DIR}/hero.json`), sourceBefore);
	check(
		'...and the skeleton index lists the rig',
		JSON.parse(R2.get(`${P}/spines/skeletons.json`)?.body ?? '{}').skeletons?.some(
			(s: { skeleton_file: string }) => s.skeleton_file === 'hero.irig',
		),
		true,
	);
	stampOf(IRIG, 'animator', null);
	check(
		'...naming no owner in a file that ships in the game bundle',
		stored(IRIG).saved_by.name,
		undefined,
	);
	await staleIsConflict(
		'rigger.rebind_attachments',
		IRIG,
		(b) => rebind(b, [{ slot: 'body', attachment: 'body', region: 'body' }]),
		String(rebound.body.baseEtag),
	);
	check(
		'rigger.rebind_attachments takes no timing',
		(
			await rebind(R2.get(IRIG)!.etag, [
				{ slot: 'body', attachment: 'body', region: 'body', time: 2 },
			])
		).body.error,
		'invalid_input',
	);
	for (const [dir, stem] of [
		['hero', 'hero..v2'],
		['hero/..', 'hero'],
	]) {
		check(
			`rigger.rebind_attachments refuses the path ${dir}/${stem}`,
			(
				await tool(
					'rigger.rebind_attachments',
					'animator',
					{ dir, stem, rebinds: [], baseEtag: 'new' },
					true,
				)
			).body.error,
			'invalid_input',
		);
	}
	check(
		'...and no animations',
		(await rebind(R2.get(IRIG)!.etag, [], { animations: {} })).body.error,
		'invalid_input',
	);
	const irigBefore = R2.get(IRIG);
	const same = await rebind(irigBefore!.etag, [
		{ slot: 'glow', attachment: 'fx', region: 'body_gold' },
	]);
	check(
		'a rebind to the region an attachment already draws (by its name) is unchanged, and writes nothing',
		[
			same.status,
			(same.body.applied as unknown[]).length,
			(same.body.unchanged as { attachment: string }[]).map((r) => r.attachment),
			R2.get(IRIG),
			same.body.baseEtag,
		],
		[200, 0, ['fx'], irigBefore, irigBefore!.etag],
	);
	const back = await rebind(irigBefore!.etag, [
		{ slot: 'body', attachment: 'body', region: 'body' },
		{ slot: 'glow', attachment: 'fx', region: 'body' },
	]);
	check(
		"a rebind sets `path` only where Spine needs it: dropped back to the key's own region, set over a `name`",
		[
			back.status,
			stored(IRIG).skins[0].attachments.body.body,
			stored(IRIG).skins[0].attachments.glow.fx,
		],
		[200, { x: 1 }, { name: 'body_gold', path: 'body' }],
	);

	// Flipbook
	const CLIP = paths.clipDocKey(C, 'tools', 'coin');
	seedDoc(CLIP, {
		id: 'coin',
		name: 'Coin',
		assetKey: `${P}/manifests/atlas_manifest_fx.json`,
		frames: ['c1', 'c2'],
		fps: 12,
	});
	const clips = await tool('flipbook.list_clips', 'animator', { id: 'coin' });
	check(
		'flipbook.list_clips reads the clips and the one named',
		[
			(clips.body.clips as { id: string; frames: number }[]).map((c) => [c.id, c.frames]),
			(clips.body.clip as { frames: string[] }).frames,
		],
		[[['coin', 2]], ['c1', 'c2']],
	);
	const saveClip = (baseEtag: string, over: object = {}) =>
		tool(
			'flipbook.save_clip',
			'animator',
			{
				id: 'coin',
				assetKey: `${P}/manifests/atlas_manifest_fx.json`,
				frames: ['c1', 'c1', 'c2'],
				fps: 24,
				baseEtag,
				...over,
			},
			true,
		);
	await staleIsConflict('flipbook.save_clip', CLIP, saveClip, String(clips.body.baseEtag));
	check('flipbook.save_clip lands', (await saveClip(R2.get(CLIP)!.etag)).status, 200);
	check(
		"...with the new frames and fps, keeping the clip's name",
		[stored(CLIP).frames, stored(CLIP).fps, stored(CLIP).name],
		[['c1', 'c1', 'c2'], 24, 'Coin'],
	);
	stampOf(CLIP, 'animator');
	check('a new clip takes baseEtag new', (await saveClip('new', { id: 'spark' })).status, 200);
	check(
		'...and a second create is a conflict',
		(await saveClip('new', { id: 'spark' })).body.error,
		'conflict',
	);
	check(
		'flipbook.save_clip refuses an empty clip',
		(await saveClip(R2.get(CLIP)!.etag, { frames: [] })).body.error,
		'invalid_input',
	);
}

// ── Allow-lists agree with the agents' frontmatter `tools:` ───────────────────
{
	const dir = fileURLToPath(new URL('../../../services/director-worker/agents/', import.meta.url));
	const tools = new Map<string, Set<string>>();
	for (const file of readdirSync(dir).filter((f) => f.endsWith('.md'))) {
		const front = /^---\n([\s\S]*?)\n---/.exec(readFileSync(`${dir}${file}`, 'utf8'))?.[1] ?? '';
		const name = /^name:\s*(\S+)/m.exec(front)?.[1] ?? '';
		const list = /^tools:\n((?:\s+-\s+\S+\n?)+)/m.exec(front)?.[1] ?? '';
		tools.set(name, new Set([...list.matchAll(/-\s+(\S+)/g)].map((m) => m[1])));
	}
	const models = DIRECTOR_AGENTS.filter((agent: string) => agent !== 'worker');
	// ADR-0008 card 8D ships its code before its three agent definitions, each its own PR (one file
	// per agent-eval run). Until they land, these allow-list entries have no definition naming them:
	// the technician has no definition yet, the artist still names the four ops it gives up, and the
	// coordinator does not name the catalogue yet. Remove each entry with the PR that lands it.
	const AWAITING_DEFINITION = new Set(['atlas-technician']);
	const TRANSITION = TRANSITION_TOOLS;
	check(
		'every runtime agent definition is a known agent, and every known agent but those awaiting theirs has one',
		[...tools.keys()].sort(),
		models.filter((agent: string) => tools.has(agent) || !AWAITING_DEFINITION.has(agent)).sort(),
	);
	const named = [...tools.values()].flatMap((set) => [...set]);
	check(
		'no tool an agent definition names is a hard refusal',
		named.filter((id) => refusedOp(id.split('.')[0], id.split('.')[1] ?? '')),
		[],
	);
	for (const op of ADAPTER_OPS.values()) {
		const id = opIdOf(op);
		const listing = models.filter((agent: string) => tools.get(agent)?.has(id));
		const allowed = op.agents.filter(
			(agent: string) =>
				agent !== 'worker' &&
				(tools.get(agent)?.has(id) ||
					!(
						(AWAITING_DEFINITION.has(agent) && !tools.has(agent)) ||
						TRANSITION.has(`${id} ${agent}`)
					)),
		);
		check(
			`${id}: the allow-list matches the agents whose tools: name it`,
			[...allowed].sort(),
			listing.sort(),
		);
	}
}

// ── The catalog the worker offers tools from (GET /api/director/adapter) ──────
{
	const catalog = async (headers: Record<string, string>) => {
		const request = new Request('https://app.example/api/director/adapter', { headers });
		const res: Response = await CATALOG({ request } as never);
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	};
	check('the catalog without a token is a 401', (await catalog({})).status, 401);
	check(
		'the catalog with a wrong token is a 401',
		(await catalog({ authorization: 'Bearer nope' })).status,
		401,
	);
	delete process.env.DIRECTOR_SERVICE_TOKEN;
	check(
		'the catalog with DIRECTOR_SERVICE_TOKEN unset is a 503',
		(await catalog({ authorization: `Bearer ${TOKEN}` })).status,
		503,
	);
	process.env.DIRECTOR_SERVICE_TOKEN = TOKEN;
	const answer = await catalog({ authorization: `Bearer ${TOKEN}` });
	const ops = (answer.body.ops ?? []) as { id: string; inputSchema: unknown; write: boolean }[];
	check('the catalog answers 200', answer.status, 200);
	check(
		'the catalog lists exactly the registered ops, sorted by id',
		ops.map((op) => op.id),
		[...ADAPTER_OPS.values()].map(opIdOf).sort(),
	);
	check(
		'each catalog entry carries its op schema and write flag',
		ops.filter((op) => {
			const registered = ADAPTER_OPS.get(op.id);
			return (
				registered?.write !== op.write ||
				JSON.stringify(registered.inputSchema) !== JSON.stringify(op.inputSchema)
			);
		}),
		[],
	);
}

// ── The worker's tool catalogue covers the registry (its agent loader refuses any other tool) ──
{
	const catalogue: typeof import('../../../services/director-worker/src/tools.ts') = await import(
		new URL('../../../services/director-worker/src/tools.ts', import.meta.url).href
	);
	const adapterOps: readonly string[] = catalogue.ADAPTER_OPS;
	const workerTools: readonly string[] = catalogue.WORKER_TOOLS;
	const registered = [...ADAPTER_OPS.values()].map(opIdOf);
	check(
		'every registered op is in the worker catalogue ADAPTER_OPS',
		registered.filter((id) => !adapterOps.includes(id)),
		[],
	);
	check(
		'no registered op is one the worker serves itself',
		registered.filter((id) => workerTools.includes(id)),
		[],
	);
	check(
		'no tool in the worker catalogue is a hard refusal',
		[...adapterOps, ...workerTools].filter((id) =>
			refusedOp(id.split('.')[0], id.split('.')[1] ?? ''),
		),
		[],
	);
}

// ── Every agent's request fits the strict tool-use limits: 20 strict tools, 24 optional parameters
//    and 16 union-type parameters per request (the API's Structured outputs docs). No CI run calls
//    the API, so a registry op that pushes an agent past one would only fail live, as a 400. ──
{
	const worker = (rel: string) =>
		new URL(`../../../services/director-worker/${rel}`, import.meta.url);
	const loader: typeof import('../../../services/director-worker/src/agents.ts') = await import(
		worker('src/agents.ts').href
	);
	const workerTools: typeof import('../../../services/director-worker/src/workerTools.ts') =
		await import(worker('src/workerTools.ts').href);
	const model: typeof import('../../../services/director-worker/src/model.ts') = await import(
		worker('src/model.ts').href
	);
	const catalogue: typeof import('../../../services/director-worker/src/tools.ts') = await import(
		worker('src/tools.ts').href
	);
	const agents = loader.loadAgents(fileURLToPath(worker('agents')), {
		models: loader.pricedModels(fileURLToPath(worker('pricing.json'))),
		tools: catalogue.KNOWN_TOOLS,
	});
	type Schema = { [key: string]: unknown };
	const specs: Partial<Record<string, { description: string; inputSchema: Schema }>> =
		workerTools.workerToolSpecs([...agents.keys()]);
	const tally = (schema: Schema, totals: { tools: number; optional: number; unions: number }) => {
		if (Array.isArray(schema.anyOf) || Array.isArray(schema.type)) totals.unions++;
		const required = new Set((schema.required ?? []) as string[]);
		for (const [key, child] of Object.entries(
			(schema.properties ?? {}) as Record<string, Schema>,
		)) {
			if (!required.has(key)) totals.optional++;
			tally(child, totals);
		}
		if (schema.items && typeof schema.items === 'object') tally(schema.items as Schema, totals);
	};
	const over: string[] = [];
	for (const agent of agents.values()) {
		const totals = { tools: 0, optional: 0, unions: 0 };
		for (const id of agent.tools) {
			const spec = specs[id] ?? ADAPTER_OPS.get(id);
			if (!spec) continue;
			const tool = model.apiTool({
				id,
				description: spec.description,
				inputSchema: spec.inputSchema,
			});
			totals.tools++;
			tally(tool.input_schema as Schema, totals);
		}
		if (totals.tools > 20 || totals.optional > 24 || totals.unions > 16) {
			over.push(`${agent.name} ${JSON.stringify(totals)}`);
		}
	}
	check("every agent's request fits the strict tool-use limits", over, []);
}

// ── OPEN_QUESTIONS 17: every createProject caller refuses a key aliasing a project's folder ──
{
	PROJECTS.set('folder-game', project('folder-game'));
	PROJECTS.set('gone-game', project('gone-game', { deletedAt: new Date() }));
	const owner = { id: 'owner', email: 'o@example.com', name: 'o', role: 'admin' as const };
	const named = (message: unknown, holder: string) =>
		typeof message === 'string' && message.includes(`"${holder}"`);
	const form = (fields: Record<string, string>) => {
		const f = new FormData();
		for (const [k, v] of Object.entries(fields)) f.set(k, v);
		return f;
	};
	const formAction = async (
		run: (event: never) => Promise<unknown>,
		url: string,
		fields: Record<string, string>,
	) => {
		const out = (await run({
			request: new Request(url, { method: 'POST', body: form(fields) }),
			locals: { user: owner },
			cookies: { get: () => undefined },
		} as never)) as { status?: number; data?: { error?: string } };
		return { status: out?.status ?? 200, error: out?.data?.error };
	};

	const { actions: admin } = await import(src('routes/(app)/admin/+page.server.ts'));
	const adminCreate = (key: string, clientKey = C) =>
		formAction(admin.createProject, 'https://app.example/admin?/createProject', {
			key,
			name: key,
			clientKey,
		});
	const adminAlias = await adminCreate('folder_game');
	check(
		'Admin › create of a key aliasing a live project is 400 naming it, no row',
		[adminAlias.status, named(adminAlias.error, 'folder-game'), PROJECTS.has('folder_game')],
		[400, true, false],
	);
	const adminGone = await adminCreate('gone_game');
	check(
		'…and of a key aliasing a soft-deleted one',
		[adminGone.status, named(adminGone.error, 'gone-game'), PROJECTS.has('gone_game')],
		[400, true, false],
	);
	check(
		'Admin › the same slug under another client is created',
		[(await adminCreate('folder_game', 'other')).status, PROJECTS.get('folder_game')?.clientKey],
		[200, 'other'],
	);
	PROJECTS.delete('folder_game');

	const { actions: gameMaker } = await import(src('routes/(app)/game-maker/+page.server.ts'));
	const gmAlias = await formAction(gameMaker.create, 'https://app.example/game-maker?/create', {
		key: 'folder_game',
		name: 'Folder',
		clientKey: C,
	});
	check(
		'Game Maker › create of an aliasing key is 400 naming the project, no row, no scaffold',
		[
			gmAlias.status,
			named(gmAlias.error, 'folder-game'),
			PROJECTS.has('folder_game'),
			keysUnder(`${C}/folder_game/`).length,
		],
		[400, true, false, 0],
	);

	const { POST: launcherProjects } = await import(src('routes/api/launcher/projects/+server.ts'));
	const sync = async (key: string, name = key) => {
		const res = await launcherProjects({
			request: new Request('https://app.example/api/launcher/projects', {
				method: 'POST',
				headers: { authorization: 'Bearer tok-owner', 'content-type': 'application/json' },
				body: JSON.stringify({ key, name, clientKey: C, profile: {} }),
			}),
		} as never);
		return { status: res.status, body: (await res.json()) as { error?: string } };
	};
	const syncAlias = await sync('folder_game');
	check(
		'desktop sync › an aliasing key is 409 naming the project, no row',
		[syncAlias.status, named(syncAlias.body.error, 'folder-game'), PROJECTS.has('folder_game')],
		[409, true, false],
	);

	const copiesBefore = copies;
	const dup = await DUPLICATE({
		request: new Request('https://app.example/api/game-maker/duplicate', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				source: 'tpl_lines',
				key: 'folder_game',
				name: 'Copy',
				clientKey: C,
				scope: 'full',
			}),
		}),
		locals: { user: owner },
	} as never);
	const dupBody = (await dup.json()) as { error?: string };
	check(
		'duplicate › an aliasing key is 409 naming the project, no row, nothing copied',
		[dup.status, named(dupBody.error, 'folder-game'), PROJECTS.has('folder_game'), copies],
		[409, true, false, copiesBefore],
	);

	// Re-homing an existing project is the same move into a folder: `folder_game` under `other`
	// moved to acme would land beside `folder-game`.
	PROJECTS.set('folder_game', project('folder_game', { clientKey: 'other' }));
	const reassign = (clientKey: string) =>
		formAction(admin.assignProjectClient, 'https://app.example/admin?/assignProjectClient', {
			projectKey: 'folder_game',
			clientKey,
		});
	const moved = await reassign(C);
	check(
		'Admin › moving a project beside its alias is 400 naming it, the client unchanged',
		[moved.status, named(moved.error, 'folder-game'), PROJECTS.get('folder_game')?.clientKey],
		[400, true, 'other'],
	);
	const resync = await sync('folder_game', 'Renamed');
	check(
		'desktop sync › a client change beside an alias is 409 naming it; neither moved nor renamed',
		[
			resync.status,
			named(resync.body.error, 'folder-game'),
			PROJECTS.get('folder_game')?.clientKey,
			PROJECTS.get('folder_game')?.name,
		],
		[409, true, 'other', 'folder_game'],
	);
	check(
		'Admin › a move into a free folder (unassigned) still lands',
		[(await reassign('')).status, PROJECTS.get('folder_game')?.clientKey],
		[200, null],
	);
	PROJECTS.delete('folder_game');
}

console.log(`director-adapters: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
