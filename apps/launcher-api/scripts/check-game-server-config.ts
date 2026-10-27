/**
 * Contract check for the Invisible Game Server's config read, `GET /api/game-server/config`, and
 * the one secret behind it, `GAME_SERVER_CONFIG_SECRET`:
 *   pnpm --filter launcher-api check:game-server-config
 *
 * Runs the REAL route, `gameServerConfig.ts` and `projects.ts`, and the REAL handlers of every route
 * the deploy token opens (found by scanning `src/routes` for `getDeployToken`, `projectReadClient(`
 * and `projectAllowsRead(`, so the path-form `/api/deploy/f/…` and `/api/published/f/…` too). Replaced: Postgres (`db/index.ts`, its `projects` filter read back through
 * Drizzle's own PG dialect, and its `app_settings` row holding the deploy token) and the
 * published-snapshot reads (`publishedRuntime.ts`). Every `R2_*` variable is removed first, so
 * nothing can reach R2.
 *
 * Pinned: the secret, as a bearer token, reads the PUBLISHED config (never the authored doc); it is
 * refused in the query string, as another scheme, and when the variable is unset (401, nothing
 * read — no fallback to the deploy token, which is refused here too); every deploy-token route
 * refuses it, as a bearer token and as `?k=`, while still letting the deploy token past its gate;
 * the project key is validated before anything is read; and no other source file names the secret.
 */
import { mock } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isHttpError } from '@sveltejs/kit';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';

for (const name of Object.keys(process.env)) if (name.startsWith('R2_')) delete process.env[name];

type Row = { clientKey: string | null; deleted: boolean };
const PROJECTS = new Map<string, Row>([
	['arcadeparty', { clientKey: 'invisible_wall', deleted: false }],
	['sandbox', { clientKey: null, deleted: false }],
	['neverpublished', { clientKey: 'invisible_wall', deleted: false }],
	['noconfig', { clientKey: 'invisible_wall', deleted: false }],
	['brokensnapshot', { clientKey: 'invisible_wall', deleted: false }],
	['corruptpointer', { clientKey: 'invisible_wall', deleted: false }],
	['r2down', { clientKey: 'invisible_wall', deleted: false }],
	['tombstoned', { clientKey: 'invisible_wall', deleted: true }],
]);

const PUBLISHED_DOC = { version: 1, which: 'published' };
/** `<client>/<project>` → the snapshot its pointer names, and that snapshot's bundle. */
const SNAPSHOTS = new Map<string, { id: string; bundle: Record<string, unknown> | null }>([
	[
		'invisible_wall/arcadeparty',
		{ id: '20261027T101530Z-3fa9', bundle: { config: PUBLISHED_DOC } },
	],
	['unassigned/sandbox', { id: '20261027T101530Z-0001', bundle: { config: PUBLISHED_DOC } }],
	['invisible_wall/noconfig', { id: '20261027T101530Z-0002', bundle: {} }],
	['invisible_wall/corruptpointer', { id: '', bundle: null }],
	['invisible_wall/brokensnapshot', { id: '20261027T101530Z-0003', bundle: null }],
	['invisible_wall/tombstoned', { id: '20261027T101530Z-0004', bundle: { config: PUBLISHED_DOC } }],
]);

const DEPLOY = 'deploy-token-0123456789abcdef';
let reads = 0;
const dialect = new PgDialect();
const fakeDb = {
	select: (columns: Record<string, unknown>) => ({
		from: (table: PgTable) => ({
			/** A session lookup: no session exists, so the secret is never someone's session. */
			innerJoin: () => ({ where: async () => [] }),
			where: async (where: SQL) => {
				reads++;
				const { sql, params } = dialect.sqlToQuery(where);
				if (getTableName(table) === 'app_settings') {
					return params[0] === 'deployToken' ? [{ value: DEPLOY }] : [];
				}
				if (getTableName(table) !== 'projects') {
					throw new Error(`fake db: no table ${getTableName(table)}`);
				}
				if (!/"projects"\."key" = \$1/.test(sql) || params.length !== 1) {
					throw new Error(`fake db: unexpected projects filter: ${sql}`);
				}
				const row = PROJECTS.get(String(params[0]));
				if (!row || (row.deleted && sql.includes('"deleted_at" is null'))) return [];
				return [
					{
						key: params[0],
						...Object.fromEntries(Object.keys(columns).map((c) => [c, row[c as keyof Row]])),
					},
				];
			},
		}),
	}),
};

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/db/index.ts'), { namedExports: { getDb: () => fakeDb } });
mock.module(src('lib/server/publishedRuntime.ts'), {
	namedExports: {
		currentPointer: async (client: string, project: string) => {
			reads++;
			if (project === 'r2down') throw new Error('R2 is down');
			const snap = SNAPSHOTS.get(`${client}/${project}`);
			// An empty id stands for a pointer object that exists but does not parse.
			return snap?.id ? { version: 1, current: snap.id, snapshots: [] } : null;
		},
		isSnapshotId: (id: string) => /^\d{8}T\d{6}Z-[0-9a-f]{4}$/.test(id),
		snapshotDeployKey: (client: string, project: string, id: string, rel: string) =>
			`${client}/${project}/published/${id}/deploy/${rel}`,
		publishedPointerExists: async (client: string, project: string) => {
			reads++;
			return SNAPSHOTS.has(`${client}/${project}`);
		},
		readSnapshotBundle: async (client: string, project: string, id: string) => {
			reads++;
			const snap = SNAPSHOTS.get(`${client}/${project}`);
			return snap && snap.id === id ? snap.bundle : null;
		},
	},
});

const SECRET = 'game-server-secret-0123456789abcdef';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

const route = await import(src('routes/api/game-server/config/+server.ts'));

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

type Answer = { status: number; body: string; read: number; headers: Headers };

/** One GET through the real route, with a signed-in admin on `locals` to prove it is ignored. */
async function get(query: string, headers: Record<string, string> = {}): Promise<Answer> {
	reads = 0;
	const url = new URL(`https://app.example/api/game-server/config${query}`);
	const request = new Request(url, { headers });
	const locals = { user: { id: 'u1', role: 'admin' } };
	const res: Response = await route.GET({ request, url, locals } as never);
	return { status: res.status, body: await res.text(), read: reads, headers: res.headers };
}
const status = async (query: string, headers?: Record<string, string>) => {
	const res = await get(query, headers);
	return { status: res.status, read: res.read };
};
const refused = { status: 401, read: 0 };

// ── Unset: a 401 whatever the request carries, and no fallback to the deploy token ────────────
delete process.env.GAME_SERVER_CONFIG_SECRET;
check(
	'unset: the old secret is a 401',
	await status('?project=arcadeparty', bearer(SECRET)),
	refused,
);
check(
	'unset: the deploy token is a 401',
	await status('?project=arcadeparty', bearer(DEPLOY)),
	refused,
);
check(
	'unset: ?k=<deploy token> is a 401',
	await status(`?project=arcadeparty&k=${DEPLOY}`),
	refused,
);
check('unset: an empty bearer is a 401', await status('?project=arcadeparty', bearer('')), refused);
process.env.GAME_SERVER_CONFIG_SECRET = ' \n';
check('whitespace-only is unset too', await status('?project=arcadeparty', bearer('')), refused);
{
	const res = await get('?project=arcadeparty', bearer(SECRET));
	check('a 401 says Bearer', res.headers.get('www-authenticate'), 'Bearer');
}

// ── Set: only `Authorization: Bearer <secret>` gets in ─────────────────────────────────────────
process.env.GAME_SERVER_CONFIG_SECRET = `${SECRET}\n`;
const refusals: [string, string, Record<string, string>][] = [
	['no Authorization header', '?project=arcadeparty', {}],
	['the secret in the query string', `?project=arcadeparty&k=${SECRET}`, {}],
	['the secret as ?token=', `?project=arcadeparty&token=${SECRET}`, {}],
	['the deploy token as a bearer', '?project=arcadeparty', bearer(DEPLOY)],
	['the deploy token as ?k=', `?project=arcadeparty&k=${DEPLOY}`, {}],
	['a wrong token', '?project=arcadeparty', bearer(`${SECRET.slice(0, -1)}X`)],
	['a prefix of the secret', '?project=arcadeparty', bearer(SECRET.slice(0, 10))],
	['the secret plus a suffix', '?project=arcadeparty', bearer(`${SECRET}x`)],
	['another scheme', '?project=arcadeparty', { authorization: `Basic ${SECRET}` }],
	['the bare secret', '?project=arcadeparty', { authorization: SECRET }],
	['a cookie', '?project=arcadeparty', { cookie: `session=${SECRET}` }],
];
for (const [label, query, headers] of refusals) {
	check(`${label} is a 401, nothing read`, await status(query, headers), refused);
}

// ── The project key is validated before anything is read ───────────────────────────────────────
for (const bad of [
	'',
	'?project=',
	'?project=Arcade',
	'?project=-x',
	'?project=a%2Fb',
	`?project=${'a'.repeat(65)}`,
	'?project=..%2Fx',
]) {
	check(`project "${bad}" is a 400, nothing read`, await status(bad, bearer(SECRET)), {
		status: 400,
		read: 0,
	});
}
check('a bad key without the secret is still a 401', await status('?project=..%2Fx'), refused);

// ── It serves the PUBLISHED config ────────────────────────────────────────────────────────────
{
	const res = await get('?project=arcadeparty', bearer(SECRET));
	check('the secret reads a published config', res.status, 200);
	check('the published snapshot, not the authored doc', JSON.parse(res.body), {
		projectKey: 'arcadeparty',
		snapshot: '20261027T101530Z-3fa9',
		doc: PUBLISHED_DOC,
	});
	check('never cached', res.headers.get('cache-control'), 'no-store');
	check('the secret is not echoed', res.body.includes(SECRET), false);
}
check(
	'an unassigned project reads from the unassigned tree',
	JSON.parse((await get('?project=sandbox', bearer(SECRET))).body).snapshot,
	'20261027T101530Z-0001',
);
const notPlayable = async (project: string) => {
	const res = await get(`?project=${project}`, bearer(SECRET));
	return { status: res.status, reason: (JSON.parse(res.body) as { reason?: string }).reason };
};
check('no such project is a 404', await notPlayable('nosuchgame'), {
	status: 404,
	reason: 'no-project',
});
check('a soft-deleted project is a 404', await notPlayable('tombstoned'), {
	status: 404,
	reason: 'no-project',
});
check('never published is a 404', await notPlayable('neverpublished'), {
	status: 404,
	reason: 'unpublished',
});
check('a snapshot with no config is a 404', await notPlayable('noconfig'), {
	status: 404,
	reason: 'no-config',
});
check(
	'an unreadable snapshot is a 502',
	(await get('?project=brokensnapshot', bearer(SECRET))).status,
	502,
);
check(
	'a pointer that exists but does not parse is a 502, not a 404',
	(await get('?project=corruptpointer', bearer(SECRET))).status,
	502,
);
check('an R2 failure is a 502', (await get('?project=r2down', bearer(SECRET))).status, 502);

// ── Every deploy-token route refuses the secret ───────────────────────────────────────────────
const routesDir = fileURLToPath(new URL('../src/routes', import.meta.url));
const walk = (dir: string): string[] =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : [path];
	});
const allSources = walk(fileURLToPath(new URL('../src', import.meta.url)));
const deployRoutes = walk(routesDir)
	.filter((p) => p.endsWith('+server.ts'))
	.filter((p) =>
		/getDeployToken|projectReadClient\(|projectAllowsRead\(/.test(readFileSync(p, 'utf8')),
	)
	.map((p) => relative(routesDir, p));
const mustCover = [
	'api/deploy/+server.ts',
	'api/deploy/f/[token]/[client]/[project]/[...rel]/+server.ts',
	'api/published/f/[token]/[project]/[snapshot]/[...rel]/+server.ts',
	'api/game-config/mock/+server.ts',
	'api/game-config/doc/+server.ts',
	...[
		'art',
		'boot',
		'cinematics',
		'clips',
		'effects',
		'flow',
		'fonts',
		'shaders',
		'sounds',
		'symbols',
	].map((k) => `api/editor/export-${k}/+server.ts`),
];
for (const path of mustCover)
	check(`${path} is among the deploy-token routes`, deployRoutes.includes(path), true);

type Outcome = number | 'passed-the-gate';
/** The status a handler refuses with, or `passed-the-gate` when it got past its token check (it
 *  then fails on the stubbed I/O, which is all a control needs). */
async function call(
	handler: (e: never) => unknown,
	token: string,
	as: 'bearer' | 'query',
): Promise<Outcome> {
	const url = new URL(
		`https://app.example/x?project=arcadeparty${as === 'query' ? `&k=${token}` : ''}`,
	);
	const headers: Record<string, string> = as === 'bearer' ? bearer(token) : {};
	const request = new Request(url, { headers });
	const params = {
		token,
		client: 'invisible_wall',
		project: 'arcadeparty',
		snapshot: '20261027T101530Z-3fa9',
		rel: 'a.json',
	};
	const event = {
		request,
		url,
		params,
		locals: {},
		cookies: { get: () => undefined },
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		fetch,
	};
	try {
		const res = await handler(event as never);
		return res instanceof Response && res.status === 401 ? 401 : 'passed-the-gate';
	} catch (e) {
		if (isHttpError(e) && e.status === 401) return 401;
		return 'passed-the-gate';
	}
}

const quiet = console.error;
for (const path of deployRoutes) {
	const mod = (await import(src(`routes/${path}`))) as Record<string, unknown>;
	const handlers = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(
		(m) => typeof mod[m] === 'function',
	);
	check(`${path} exports a handler`, handlers.length > 0, true);
	for (const method of handlers) {
		const handler = mod[method] as (e: never) => unknown;
		console.error = () => {};
		const asBearer = await call(handler, SECRET, 'bearer');
		const asQuery = await call(handler, SECRET, 'query');
		const control = path.startsWith('api/launcher/') ? null : await call(handler, DEPLOY, 'query');
		console.error = quiet;
		check(`${method} ${path} refuses the secret as a bearer`, asBearer, 401);
		check(`${method} ${path} refuses the secret as ?k=`, asQuery, 401);
		if (control !== null)
			check(`${method} ${path} still lets the deploy token past`, control, 'passed-the-gate');
	}
}

// ── Nothing else reads the secret ─────────────────────────────────────────────────────────────
const OWNERS = [
	'lib/server/env.ts',
	'lib/server/gameServerConfig.ts',
	'routes/api/game-server/config/+server.ts',
];
const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const naming = allSources
	.filter((p) => /\.(ts|js|svelte)$/.test(p))
	.filter((p) => /GAME_SERVER_CONFIG_SECRET|gameServerAuthorized/.test(readFileSync(p, 'utf8')))
	.map((p) => relative(srcDir, p))
	.sort();
check('only the config read names the secret', naming, [...OWNERS].sort());

console.log();
if (failures) {
	console.error(`${failures} of ${checks} game-server-config checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} game-server-config checks pass`);
