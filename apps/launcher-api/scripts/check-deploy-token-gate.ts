/**
 * Contract check for the shared deploy-token gate (`?k=`):
 *   pnpm --filter launcher-api check:deploy-token-gate
 *
 * Fifteen build/export routes each compared `url.searchParams.get('k') !== secret`, and
 * `projectReadClient` compared both of its tokens the same way: a plain `!==` returns at the first
 * differing character, so its timing leaks how much of a guess was right. They now go through
 * `requireDeployToken` / `tokensMatch`. Pinned here, over the REAL modules:
 *  - the verdict (`deployTokenVerdict`): unset, mismatch (absent, empty, wrong, prefix, suffix,
 *    case) and match;
 *  - `requireDeployToken`: 503 with the route's own message when no token is configured (no DB row
 *    and no `EDITOR_DOC_SECRET`), 401 `Invalid or missing token.` on a mismatch, and through on a
 *    match — from the DB row or the env fallback;
 *  - `projectReadClient`: the deploy token and the project's read token each let a read through,
 *    nothing else does, and an unset deploy token is never matched by anything;
 *  - every one of the fifteen routes answers exactly what it answered before the change: the same
 *    503 message when unset, the same 401 when wrong, and gets past the gate with the token.
 * Replaced: Postgres only (`db/index.ts`: the `app_settings` row and one `projects` row). Every
 * `R2_*` variable is removed first, so a handler that gets past its gate fails on R2 rather than
 * reaching it.
 */
import { mock } from 'node:test';
import { isHttpError } from '@sveltejs/kit';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';

for (const name of Object.keys(process.env)) if (name.startsWith('R2_')) delete process.env[name];
delete process.env.EDITOR_DOC_SECRET;

const DEPLOY = 'deploy-token-0123456789abcdef';
const READ = 'read-token-fedcba9876543210';

/** The `app_settings` deploy-token row, and the one project every lookup finds. */
let dbToken: string | undefined;
let project: { readToken: string | null; clientKey: string | null } | undefined;

const dialect = new PgDialect();
const fakeDb = {
	select: () => ({
		from: (table: PgTable) => ({
			where: async (where: SQL) => {
				const name = getTableName(table);
				if (name === 'app_settings') {
					const key = dialect.sqlToQuery(where).params[0];
					return key === 'deployToken' && dbToken ? [{ value: dbToken }] : [];
				}
				if (name === 'projects') return project ? [{ key: 'arcadeparty', ...project }] : [];
				throw new Error(`fake db: no table ${name}`);
			},
		}),
	}),
};
const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/db/index.ts'), { namedExports: { getDb: () => fakeDb } });

const { deployTokenVerdict, requireDeployToken } = await import(src('lib/server/deployToken.ts'));
const { projectReadClient } = await import(src('lib/server/projects.ts'));
const { UNASSIGNED_CLIENT } = await import(src('lib/server/projectPaths.ts'));

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

// ── The verdict ────────────────────────────────────────────────────────────────────────────────
check('no token configured is unset', deployTokenVerdict(DEPLOY, undefined), 'unset');
check('an empty configured token is unset', deployTokenVerdict('', ''), 'unset');
check('unset even with no ?k=', deployTokenVerdict(null, undefined), 'unset');
check('the token matches', deployTokenVerdict(DEPLOY, DEPLOY), 'ok');
for (const [label, presented] of [
	['no ?k=', null],
	['an empty ?k=', ''],
	['a wrong token', `${DEPLOY.slice(0, -1)}X`],
	['a prefix', DEPLOY.slice(0, 10)],
	['the token plus a suffix', `${DEPLOY}x`],
	['another case', DEPLOY.toUpperCase()],
	['the token with whitespace', ` ${DEPLOY}`],
] as const)
	check(`${label} is a mismatch`, deployTokenVerdict(presented, DEPLOY), 'mismatch');

// ── requireDeployToken ─────────────────────────────────────────────────────────────────────────
type Gate = { status: number; message: string } | 'through';
async function gate(query: string): Promise<Gate> {
	try {
		await requireDeployToken(new URL(`https://app.example/x${query}`), 'Thing is not configured.');
		return 'through';
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, message: e.body.message };
		throw e;
	}
}
const UNSET = { status: 503, message: 'Thing is not configured.' };
const WRONG = { status: 401, message: 'Invalid or missing token.' };

dbToken = undefined;
check('unset: 503 with the caller message', await gate(`?k=${DEPLOY}`), UNSET);
check('unset: 503 with no ?k= either', await gate(''), UNSET);
check('unset: an empty ?k= does not match an empty secret', await gate('?k='), UNSET);

dbToken = DEPLOY;
check('the DB token gets through', await gate(`?k=${DEPLOY}`), 'through');
check('no ?k= is a 401', await gate(''), WRONG);
check('an empty ?k= is a 401', await gate('?k='), WRONG);
check('a wrong ?k= is a 401', await gate(`?k=${DEPLOY.slice(0, -1)}X`), WRONG);
check('a prefix is a 401', await gate(`?k=${DEPLOY.slice(0, 10)}`), WRONG);
check('the token as another parameter is a 401', await gate(`?token=${DEPLOY}`), WRONG);

dbToken = undefined;
process.env.EDITOR_DOC_SECRET = DEPLOY;
check('the env fallback gets through', await gate(`?k=${DEPLOY}`), 'through');
check('the env fallback refuses a wrong token', await gate('?k=nope'), WRONG);
delete process.env.EDITOR_DOC_SECRET;

// ── projectReadClient ──────────────────────────────────────────────────────────────────────────
dbToken = DEPLOY;
project = { readToken: READ, clientKey: 'invisible_wall' };
check('the deploy token reads', await projectReadClient('arcadeparty', DEPLOY), 'invisible_wall');
check('the read token reads', await projectReadClient('arcadeparty', READ), 'invisible_wall');
check('a wrong token does not', await projectReadClient('arcadeparty', 'nope'), null);
check(
	'a read-token prefix does not',
	await projectReadClient('arcadeparty', READ.slice(0, 8)),
	null,
);
check('an empty token does not', await projectReadClient('arcadeparty', ''), null);
project = { readToken: null, clientKey: null };
check(
	'an unassigned project resolves to the unassigned tree',
	await projectReadClient('arcadeparty', DEPLOY),
	UNASSIGNED_CLIENT,
);
check(
	'no read token: only the deploy token reads',
	await projectReadClient('arcadeparty', READ),
	null,
);
project = undefined;
check(
	'an unknown project still answers the deploy token',
	await projectReadClient('x', DEPLOY),
	UNASSIGNED_CLIENT,
);
check('an unknown project refuses anything else', await projectReadClient('x', READ), null);
dbToken = undefined;
project = { readToken: READ, clientKey: 'invisible_wall' };
check(
	'deploy token unset: the read token still reads',
	await projectReadClient('arcadeparty', READ),
	'invisible_wall',
);
check(
	'deploy token unset: nothing else does',
	await projectReadClient('arcadeparty', DEPLOY),
	null,
);

// ── Every route answers as it did before ───────────────────────────────────────────────────────
/** route → its 503 message, as each one threw it before `requireDeployToken`. */
const ROUTES: Record<string, string> = {
	'api/deploy/+server.ts': 'Deploy endpoint is not configured.',
	'api/editor/export-art/+server.ts': 'Editor art export is not configured.',
	'api/editor/export-boot/+server.ts': 'Boot splash export is not configured.',
	'api/editor/export-cinematics/+server.ts': 'Cinematic export is not configured.',
	'api/editor/export-clips/+server.ts': 'Editor clips export is not configured.',
	'api/editor/export-effects/+server.ts': 'Editor effects export is not configured.',
	'api/editor/export-flow/+server.ts': 'Editor flow export is not configured.',
	'api/editor/export-fonts/+server.ts': 'Editor font export is not configured.',
	'api/editor/export-shaders/+server.ts': 'Editor shader export is not configured.',
	'api/editor/export-sounds/+server.ts': 'Sound export is not configured.',
	'api/editor/export-symbols/+server.ts': 'Editor symbols export is not configured.',
	'api/editor/symbol-defaults/+server.ts': 'Symbol-defaults publish is not configured.',
	'api/game-config/doc/+server.ts': 'Game-config export is not configured.',
	'api/localization/strings/+server.ts': 'Localization export is not configured.',
	'api/win-text/doc/+server.ts': 'Win-text export is not configured.',
};

type Outcome = { status: number; message: string } | 'passed-the-gate';
async function call(handler: (e: never) => unknown, query: string): Promise<Outcome> {
	const url = new URL(`https://app.example/x?project=arcadeparty${query}`);
	const event = {
		request: new Request(url, { method: 'POST', body: '{}' }),
		url,
		params: {},
		locals: {},
		cookies: { get: () => undefined },
		getClientAddress: () => '127.0.0.1',
		setHeaders: () => {},
		fetch,
	};
	try {
		const res = await handler(event as never);
		if (res instanceof Response && (res.status === 401 || res.status === 503))
			return { status: res.status, message: await res.text() };
		return 'passed-the-gate';
	} catch (e) {
		if (isHttpError(e) && (e.status === 401 || e.status === 503))
			return { status: e.status, message: e.body.message };
		return 'passed-the-gate';
	}
}

const quiet = { error: console.error, warn: console.warn };
for (const [path, notConfigured] of Object.entries(ROUTES)) {
	const mod = (await import(src(`routes/${path}`))) as Record<string, unknown>;
	const handlers = ['GET', 'POST', 'PUT'].filter((m) => typeof mod[m] === 'function');
	check(`${path} exports a handler`, handlers.length > 0, true);
	for (const method of handlers) {
		const handler = mod[method] as (e: never) => unknown;
		console.error = console.warn = () => {};
		dbToken = undefined;
		const unset = await call(handler, `&k=${DEPLOY}`);
		dbToken = DEPLOY;
		const absent = await call(handler, '');
		const wrong = await call(handler, `&k=${DEPLOY.slice(0, -1)}X`);
		const right = await call(handler, `&k=${DEPLOY}`);
		({ error: console.error, warn: console.warn } = quiet);
		check(`${method} ${path} unset`, unset, { status: 503, message: notConfigured });
		check(`${method} ${path} no ?k=`, absent, WRONG);
		check(`${method} ${path} wrong ?k=`, wrong, WRONG);
		check(`${method} ${path} the token gets past`, right, 'passed-the-gate');
	}
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} deploy-token-gate checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} deploy-token-gate checks pass`);
