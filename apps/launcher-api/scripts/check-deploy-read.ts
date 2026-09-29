/**
 * Contract check for the path-form deploy route — `/api/deploy/f/<token>/<client>/<project>/<...rel>`
 * — and the gate behind it, `projectReadClient` (`$lib/server/projects.ts`):
 *   pnpm --filter launcher-api check:deploy-read
 *
 * Every asset an online game loads comes through that route. It used to check the token against
 * `<project>` and then serve from whatever `<client>` the caller sent, so a project's read token
 * also read `<otherClient>/<project>/deploy/` — an orphan left wherever the key was once used under
 * another client. The rule now: the file comes from the project's OWN client, whatever the URL says.
 * The round-trip half pins the other side of that: the `assetBase` `/api/editor/runtime` hands a
 * game, fed back into the route, lands on that same tree — including after the project moves.
 *
 * Runs the REAL route handlers and the real `projects.ts`. Only the I/O is stubbed: Postgres
 * (`db/index.ts`), the deploy-token setting (`appSettings.ts`), R2 (`r2.ts`) and the runtime
 * assemble (`runtimeBundleCache.ts`). The Postgres stub answers by the key the query actually
 * filtered on, read back through Drizzle's own PG dialect, so a lookup of the wrong key finds
 * nothing instead of being answered anyway.
 */
import { mock } from 'node:test';
import { isHttpError } from '@sveltejs/kit';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

type Row = { clientKey: string | null; readToken: string | null; name: string };

/** The `projects` table. Absent = no such row. */
const PROJECTS = new Map<string, Row>([
	['bookofborutremake', { clientKey: 'invisible_wall', readToken: 'TOKEN_BORUT', name: 'Borut' }],
	['hotfruits', { clientKey: 'eagaming', readToken: 'TOKEN_HOT', name: 'Hot Fruits' }],
	['sandbox', { clientKey: null, readToken: 'TOKEN_SANDBOX', name: 'Sandbox' }],
	['neverpublished', { clientKey: 'eagaming', readToken: null, name: 'Never published' }],
]);

/** R2, by key. `eagaming/bookofborutremake/` is the orphan a stale client segment used to reach. */
const OBJECTS = new Map<string, string>([
	['invisible_wall/bookofborutremake/deploy/art/bg.png', 'borut'],
	['eagaming/bookofborutremake/deploy/art/bg.png', 'ORPHAN'],
	['eagaming/hotfruits/deploy/art/bg.png', 'hot'],
	['unassigned/sandbox/deploy/art/bg.png', 'sandbox'],
]);

let deployToken: string | undefined = 'DEPLOY';
/** Every R2 key read, so a refusal can be shown to have read nothing. */
const reads: string[] = [];

const dialect = new PgDialect();
function projectsRowsFor(where: SQL, columns: string[]): Record<string, unknown>[] {
	const { sql, params } = dialect.sqlToQuery(where);
	if (!/"key" = \$1$/.test(sql) || params.length !== 1) {
		throw new Error(`unexpected projects filter: ${sql} ${JSON.stringify(params)}`);
	}
	const row = PROJECTS.get(String(params[0]));
	if (!row) return [];
	return [Object.fromEntries(columns.map((c) => [c, row[c as keyof Row]]))];
}

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/db/index.ts'), {
	namedExports: {
		getDb: () => ({
			select: (columns: Record<string, unknown>) => ({
				from: () => ({
					where: async (where: SQL) => projectsRowsFor(where, Object.keys(columns)),
				}),
			}),
		}),
	},
});
mock.module(src('lib/server/appSettings.ts'), {
	namedExports: { getDeployToken: async () => deployToken },
});
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		getObjectBytes: async (key: string) => {
			reads.push(key);
			const body = OBJECTS.get(key);
			if (body === undefined) return null;
			return { body: new TextEncoder().encode(body), contentType: 'x', etag: null };
		},
	},
});
mock.module(src('lib/server/runtimeBundleCache.ts'), {
	namedExports: { getRuntimeBundle: async () => ({}) },
});
// No published snapshot: the round trip below is the live `deploy/` path (a snapshot's `assetBase`
// is `/api/published/f/…`, served by its own route).
mock.module(src('lib/server/publishedRuntime.ts'), {
	namedExports: { currentPointer: async () => null, readSnapshotBundle: async () => null },
});

const deployRoute = await import(
	src('routes/api/deploy/f/[token]/[client]/[project]/[...rel]/+server.ts')
);
const runtimeRoute = await import(src('routes/api/editor/runtime/+server.ts'));
const { projectAllowsRead } = await import(src('lib/server/projects.ts'));

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

type Params = { token: string; client: string; project: string; rel: string };
type Served = { status: number; body?: string; cors?: string | null; read: string[] };

/** One GET through the real route: what it answered, and which R2 keys it read to answer. */
async function get(params: Params): Promise<Served> {
	reads.length = 0;
	try {
		const res: Response = await deployRoute.GET({ params } as never);
		return {
			status: res.status,
			body: await res.text(),
			cors: res.headers.get('access-control-allow-origin'),
			read: [...reads],
		};
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, read: [...reads] };
		throw e;
	}
}
const served = (body: string, key: string): Served => ({
	status: 200,
	body,
	cors: '*',
	read: [key],
});
const refused = (status: number): Served => ({ status, read: [] });

const BORUT_KEY = 'invisible_wall/bookofborutremake/deploy/art/bg.png';
const borut = (token: string, client: string, rel = 'art/bg.png') =>
	get({ token, client, project: 'bookofborutremake', rel });

// ── The client segment is not trusted ─────────────────────────────────────────
check(
	'a read token under its own client is served its tree',
	await borut('TOKEN_BORUT', 'invisible_wall'),
	served('borut', BORUT_KEY),
);
check(
	"under another client's segment it is served its OWN tree — never the orphan",
	await borut('TOKEN_BORUT', 'eagaming'),
	served('borut', BORUT_KEY),
);
check(
	'under a client that does not exist, the same',
	await borut('TOKEN_BORUT', 'no_such_client'),
	served('borut', BORUT_KEY),
);
check(
	'the shared deploy token does not reopen the orphan through this route either',
	await borut('DEPLOY', 'eagaming'),
	served('borut', BORUT_KEY),
);
check(
	'an unassigned project is served from the unassigned tree',
	await get({
		token: 'TOKEN_SANDBOX',
		client: 'unassigned',
		project: 'sandbox',
		rel: 'art/bg.png',
	}),
	served('sandbox', 'unassigned/sandbox/deploy/art/bg.png'),
);
check(
	"and still is when the segment names a client it doesn't belong to",
	await get({ token: 'TOKEN_SANDBOX', client: 'eagaming', project: 'sandbox', rel: 'art/bg.png' }),
	served('sandbox', 'unassigned/sandbox/deploy/art/bg.png'),
);
check(
	'the deploy token on a key with no project row resolves to the unassigned tree',
	await get({ token: 'DEPLOY', client: 'eagaming', project: 'norow', rel: 'art/bg.png' }),
	{ status: 404, read: ['unassigned/norow/deploy/art/bg.png'] },
);

// ── The token gate, unchanged ─────────────────────────────────────────────────
check(
	"another project's read token is refused, and nothing is read",
	await borut('TOKEN_HOT', 'eagaming'),
	refused(401),
);
check('a wrong token is refused', await borut('nope', 'invisible_wall'), refused(401));
check('an empty token is refused', await borut('', 'invisible_wall'), refused(401));
check(
	'a project with no read token is not opened by the string "null"',
	await get({ token: 'null', client: 'eagaming', project: 'neverpublished', rel: 'art/bg.png' }),
	refused(401),
);
check(
	'nor by "undefined"',
	await get({ token: 'undefined', client: 'eagaming', project: 'neverpublished', rel: 'x' }),
	refused(401),
);
deployToken = undefined;
check(
	'with the deploy token unset, a read token still reads',
	await borut('TOKEN_BORUT', 'invisible_wall'),
	served('borut', BORUT_KEY),
);
check('and "undefined" is not the deploy token', await borut('undefined', 'x'), refused(401));
deployToken = 'DEPLOY';

check(
	'a missing file is a 404 after the gate',
	await borut('TOKEN_BORUT', 'invisible_wall', 'art/none.png'),
	{ status: 404, read: ['invisible_wall/bookofborutremake/deploy/art/none.png'] },
);
check(
	'traversal is refused',
	await borut('TOKEN_BORUT', 'x', '../hotfruits/deploy/a'),
	refused(400),
);
check('an empty path is refused', await borut('TOKEN_BORUT', 'x', ''), refused(400));

// `projectAllowsRead` now delegates to `projectReadClient`; the other three token-authed routes
// (runtime, doc, mock) gate on it, so it must answer exactly as before.
const allows = async (project: string, token: string) => projectAllowsRead(project, token);
check('projectAllowsRead: own read token', await allows('bookofborutremake', 'TOKEN_BORUT'), true);
check('projectAllowsRead: deploy token', await allows('bookofborutremake', 'DEPLOY'), true);
check('projectAllowsRead: deploy token, no row', await allows('norow', 'DEPLOY'), true);
check('projectAllowsRead: foreign token', await allows('bookofborutremake', 'TOKEN_HOT'), false);
check('projectAllowsRead: no row, read token', await allows('norow', 'TOKEN_BORUT'), false);
check('projectAllowsRead: empty token', await allows('bookofborutremake', ''), false);

// ── Round trip: the runtime's assetBase lands on the tree this route serves ───
const ORIGIN = 'https://app.invisiblewall.org';

async function assetBase(project: string, token: string): Promise<string> {
	const url = new URL(`${ORIGIN}/api/editor/runtime?project=${project}&k=${token}`);
	const res: Response = await runtimeRoute.GET({ url, request: new Request(url) } as never);
	return ((await res.json()) as { assetBase: string }).assetBase;
}

/** Route a URL under `assetBase` the way SvelteKit would: split the path, decode each segment. */
async function fetchUnder(url: string): Promise<Served> {
	const prefix = `${ORIGIN}/api/deploy/f/`;
	if (!url.startsWith(prefix)) throw new Error(`not a path-form deploy URL: ${url}`);
	const [token, client, project, ...rel] = url.slice(prefix.length).split('/');
	return get({
		token: decodeURIComponent(token),
		client: decodeURIComponent(client),
		project: decodeURIComponent(project),
		rel: rel.map(decodeURIComponent).join('/'),
	});
}

const borutBase = await assetBase('bookofborutremake', 'TOKEN_BORUT');
check(
	"the runtime's assetBase names the project's own client",
	borutBase,
	`${ORIGIN}/api/deploy/f/TOKEN_BORUT/invisible_wall/bookofborutremake/`,
);
check(
	'and an asset under it is served from that tree',
	await fetchUnder(`${borutBase}art/bg.png`),
	served('borut', BORUT_KEY),
);
const sandboxBase = await assetBase('sandbox', 'TOKEN_SANDBOX');
check(
	"an unassigned project's assetBase names `unassigned`",
	sandboxBase,
	`${ORIGIN}/api/deploy/f/TOKEN_SANDBOX/unassigned/sandbox/`,
);
check(
	'and round-trips to the unassigned tree',
	await fetchUnder(`${sandboxBase}art/bg.png`),
	served('sandbox', 'unassigned/sandbox/deploy/art/bg.png'),
);

// The project moves client: the tab opened before the move keeps the OLD segment.
PROJECTS.set('bookofborutremake', { ...PROJECTS.get('bookofborutremake')!, clientKey: 'eagaming' });
const MOVED_KEY = 'eagaming/bookofborutremake/deploy/art/bg.png';
check(
	'after a move, a tab holding the old assetBase is served the current tree, not a 404',
	await fetchUnder(`${borutBase}art/bg.png`),
	served('ORPHAN', MOVED_KEY),
);
check(
	'and a fresh boot is handed the new client',
	await assetBase('bookofborutremake', 'TOKEN_BORUT'),
	`${ORIGIN}/api/deploy/f/TOKEN_BORUT/eagaming/bookofborutremake/`,
);
check(
	'while the tree it moved away from is no longer reachable with its token',
	await borut('TOKEN_BORUT', 'invisible_wall'),
	served('ORPHAN', MOVED_KEY),
);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} deploy-read checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} deploy-read checks pass`);
