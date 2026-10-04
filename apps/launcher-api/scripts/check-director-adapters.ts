/**
 * Contract check for the Invisible Director adapter gate, hard refusals and Game Maker adapters
 * (ADR-0002; PLAN 2.1–2.3):
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
 *    and the server-side allow-lists agree.
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DirectorOp, DirectorRun, Game, Project } from '../src/lib/server/db/schema.ts';

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
		const o = R2.get(key);
		return o ? { body: new TextEncoder().encode(o.body), etag: o.etag } : null;
	},
	putObjectText: async (key: string, text: string, _type: string, cond?: Cond) =>
		put(key, text, cond),
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
	createProject: async (key: string, name: string, clientKey: string | null, gameType?: string) => {
		if (PROJECTS.has(key)) throw new Error(`duplicate key ${key}`);
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
	clientExists: async (key: string) => CLIENTS.has(key),
	mayCreateUnderClient: async (userId: string, role: string, clientKey: string | null) =>
		role === 'admin' ||
		(clientKey !== null && (CLIENT_GRANTS.get(userId)?.has(clientKey) ?? false)),
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
});

const { POST } = await import(src('routes/api/director/adapter/[tool]/[op]/+server.ts'));
const { POST: DUPLICATE } = await import(src('routes/api/game-maker/duplicate/+server.ts'));
const { runAdapterCall } = await import(src('lib/server/director/gate.ts'));
const {
	ADAPTER_OPS,
	buildRegistry,
	opId: opIdOf,
} = await import(src('lib/server/director/registry.ts'));
const { GAMEMAKER_OPS } = await import(src('lib/server/director/ops/gamemaker.ts'));
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
check('no registered op is refused', [...ADAPTER_OPS.keys()].length, GAMEMAKER_OPS.length);

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
		lockedItems: { id: string; detail: string }[];
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
	check(
		'every runtime agent definition is a known agent',
		[...tools.keys()].sort(),
		[...models].sort(),
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
		const allowed = op.agents.filter((agent: string) => agent !== 'worker');
		check(
			`${id}: the allow-list matches the agents whose tools: name it`,
			[...allowed].sort(),
			listing.sort(),
		);
	}
}

console.log(`director-adapters: ${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
