/**
 * Contract check for the current-games harness's game list, `GET /api/pipeline/games`:
 *   pnpm --filter launcher-api check:pipeline-games
 *
 * Runs the REAL route handler, `pipelineGames.ts`, `listGames()` and `listProjects()`. Two
 * boundaries are replaced: Postgres (`db/index.ts`), by an in-memory `games` + `projects` store
 * whose `projects` filter is read back through Drizzle's own PG dialect, and the R2 listing behind
 * `hasOwnBuiltBundle` (`publishGame.ts`), by a fixed set of desktop-built keys.
 *
 * Pinned: no token, a wrong one, another scheme or a session cookie is a 401; an unset
 * `PIPELINE_CI_TOKEN` is a 503 and reads nothing; the list is `listGames()` minus the games of
 * soft-deleted projects; no project's `readToken` reaches the response.
 */
import { mock } from 'node:test';
import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import type { Game, Project } from '../src/lib/server/db/schema.ts';

const project = (key: string, over: Partial<Project> = {}): Project => ({
	key,
	name: key,
	clientKey: null,
	gameType: null,
	readToken: `READ_TOKEN_${key}`,
	launcherProfile: null,
	deletedAt: null,
	createdAt: new Date('2026-01-01T00:00:00Z'),
	...over,
});
const game = (key: string, projectKey: string | null, over: Partial<Game> = {}): Game => ({
	key,
	name: key.toUpperCase(),
	url: `https://games.example/${key}/`,
	projectKey,
	version: '',
	builtAt: null,
	debug: false,
	createdAt: new Date('2026-01-01T00:00:00Z'),
	...over,
});

const PROJECTS: Project[] = [
	project('hotfruits', { clientKey: 'eagaming', gameType: 'ways' }),
	project('bookofborut', { clientKey: 'invisible_wall', gameType: 'lines' }),
	project('sandbox'),
	project('gone', { clientKey: 'eagaming', deletedAt: new Date('2026-09-01T00:00:00Z') }),
];
const GAMES: Game[] = [
	game('hotfruits', 'hotfruits', { version: '7', builtAt: new Date('2026-09-30T12:00:00Z') }),
	game('bookofborut', 'bookofborut', { version: '42' }),
	game('sandboxgame', 'sandbox'),
	game('globalgame', null),
	game('gonegame', 'gone'),
];
/** Keys with their own `test_server/<key>/` bundle — the desktop-built games. */
const DESKTOP_BUILT = new Set(['bookofborut']);

let dbReads = 0;
const dialect = new PgDialect();
const byName = (a: Game, b: Game) => a.name.localeCompare(b.name);
const fakeDb = {
	select: () => ({
		from: (table: PgTable) => {
			const name = getTableName(table);
			dbReads++;
			if (name === 'games') return { orderBy: async () => [...GAMES].sort(byName) };
			if (name === 'projects') {
				return {
					where: (condition: SQL) => {
						const { sql } = dialect.sqlToQuery(condition);
						if (sql !== '"projects"."deleted_at" is null') {
							throw new Error(`fake db: unexpected projects filter: ${sql}`);
						}
						return { orderBy: async () => PROJECTS.filter((p) => p.deletedAt === null) };
					},
				};
			}
			throw new Error(`fake db: no table ${name}`);
		},
	}),
};

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/db/index.ts'), { namedExports: { getDb: () => fakeDb } });
mock.module(src('lib/server/publishGame.ts'), {
	namedExports: { hasOwnBuiltBundle: async (key: string) => DESKTOP_BUILT.has(key) },
});

const route = await import(src('routes/api/pipeline/games/+server.ts'));
const { listGames } = await import(src('lib/server/games.ts'));

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

/** One GET through the real handler, with a signed-in admin on `locals` to prove it is ignored. */
async function get(headers: Record<string, string>): Promise<Answer> {
	dbReads = 0;
	const request = new Request('https://app.example/api/pipeline/games', { headers });
	const locals = { user: { id: 'u1', role: 'admin' } };
	const res: Response = await route.GET({ request, locals } as never);
	return { status: res.status, body: await res.text(), read: dbReads, headers: res.headers };
}

const TOKEN = 'ci-token-0123456789abcdef';
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

// ── Unset is a 503, whatever the request carries ──────────────────────────────
delete process.env.PIPELINE_CI_TOKEN;
{
	const res = await get(bearer(TOKEN));
	check('unset PIPELINE_CI_TOKEN is a 503', res.status, 503);
	check('and the message names the variable', res.body.includes('PIPELINE_CI_TOKEN'), true);
	check('and nothing is read', res.read, 0);
}
process.env.PIPELINE_CI_TOKEN = '';
check('an empty PIPELINE_CI_TOKEN is unset too', (await get(bearer(''))).status, 503);
process.env.PIPELINE_CI_TOKEN = ' \n';
check('so is a whitespace-only one', (await get(bearer(''))).status, 503);

// ── Set: only the exact bearer token gets in ──────────────────────────────────
process.env.PIPELINE_CI_TOKEN = TOKEN;
const refusals: [string, Record<string, string>][] = [
	['no Authorization header', {}],
	['a wrong token', bearer('ci-token-0123456789abcdeX')],
	['a prefix of the token', bearer(TOKEN.slice(0, -1))],
	['the token plus a suffix', bearer(`${TOKEN}x`)],
	['another scheme', { authorization: `Basic ${TOKEN}` }],
	['a session cookie instead of the token', { cookie: 'session=valid-admin-session' }],
];
for (const [label, headers] of refusals) {
	const res = await get(headers);
	check(`${label} is a 401`, res.status, 401);
	check(`${label} reads nothing`, res.read, 0);
	check(`${label} names the Bearer scheme`, res.headers.get('www-authenticate'), 'Bearer');
}

process.env.PIPELINE_CI_TOKEN = `${TOKEN}\n`;
check('a pasted trailing newline is trimmed', (await get(bearer(TOKEN))).status, 200);
process.env.PIPELINE_CI_TOKEN = TOKEN;

// ── The list ──────────────────────────────────────────────────────────────────
const ok = await get(bearer(TOKEN));
check('the CI token is a 200', ok.status, 200);
check('it is never cached', ok.headers.get('cache-control'), 'no-store');
const { games } = JSON.parse(ok.body) as { games: Record<string, unknown>[] };

const listed: Game[] = await listGames();
const liveProjects = new Set(PROJECTS.filter((p) => !p.deletedAt).map((p) => p.key));
check(
	'the list is listGames() minus soft-deleted projects, in its order',
	games.map((g) => g.key),
	listed.filter((g) => g.projectKey === null || liveProjects.has(g.projectKey)).map((g) => g.key),
);
check(
	"a soft-deleted project's game is excluded",
	games.some((g) => g.key === 'gonegame'),
	false,
);

const row = (key: string) => games.find((g) => g.key === key);
check('a client project row', row('hotfruits'), {
	key: 'hotfruits',
	name: 'HOTFRUITS',
	projectKey: 'hotfruits',
	clientKey: 'eagaming',
	gameType: 'ways',
	version: '7',
	builtAt: '2026-09-30T12:00:00.000Z',
	publishedPointerKey: 'eagaming/hotfruits/published/pointer.json',
	hasOwnBuiltBundle: false,
});
check('a desktop-built game says so', row('bookofborut')?.hasOwnBuiltBundle, true);
check('an unassigned project row', row('sandboxgame'), {
	key: 'sandboxgame',
	name: 'SANDBOXGAME',
	projectKey: 'sandbox',
	clientKey: null,
	gameType: 'lines',
	version: '',
	builtAt: null,
	publishedPointerKey: 'unassigned/sandbox/published/pointer.json',
	hasOwnBuiltBundle: false,
});
check('a global game has no project fields', row('globalgame'), {
	key: 'globalgame',
	name: 'GLOBALGAME',
	projectKey: null,
	clientKey: null,
	gameType: null,
	version: '',
	builtAt: null,
	publishedPointerKey: null,
	hasOwnBuiltBundle: false,
});

// ── No secrets ────────────────────────────────────────────────────────────────
check('no readToken field', ok.body.includes('readToken'), false);
check('no readToken value', /READ_TOKEN_/.test(ok.body), false);
check('the CI token is not echoed', ok.body.includes(TOKEN), false);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} pipeline-games checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} pipeline-games checks pass`);
