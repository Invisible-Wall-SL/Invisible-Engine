/**
 * Contract check for `requireProjectScope` and `requireOptionalProjectKey`
 * (`$lib/server/toolScope.ts`) — the project half of every session-gated authoring endpoint that
 * takes its project from the request — and for `sessionProjectScope`, the re-checked read of the
 * SESSION's stored project behind `gate()` and `resolveToolScope`'s fallback:
 *   pnpm --filter launcher-api check:project-scope
 *
 * Those endpoints used to resolve whatever project they were handed, so a user with the TOOL could
 * read and write any client's project by editing one query param — the tool grant was being
 * treated as a project grant. The rule now is the selector's own `canAccessProject`; this pins
 * that the resolvers ask it about the key they actually return (trimmed, defaulted), refuse with a
 * 403 without resolving the project's client, and resolve the client exactly as the page scope
 * does. The optional form must treat "no project" as no project — never as the default.
 *
 * The stored key is access-checked only when it is SET, so a grant revoked afterwards used to keep
 * working through every session-scoped tool until the user switched project. The checks below pin
 * that `gate()`, `resolveToolScope` and `sessionProjectScope` hand back the default instead, clear
 * the stale value (only while it still names the key that failed), and never check the default.
 *
 * Runs the REAL module. Only the Postgres boundary is replaced: `projects.ts` by a table of which
 * user may reach which project, `auth.ts`'s session reads by a token → stored-key table, and the
 * two tool-override tables by "no overrides", so the check needs no database. If `toolScope.ts`
 * starts importing another export from one of them, the stub below must provide it or this fails
 * at import with "does not provide an export named" — which is why the raw `getActiveProjectKey`
 * is stubbed although nothing calls it: a `gate()` reverted to it must fail HERE, by name. The
 * route half (every handler that takes a project goes through a check, and nothing reads the
 * stored project raw) is the source scan in `check-launcher-gates.ts`.
 */
import { mock } from 'node:test';
import { isHttpError, type Cookies } from '@sveltejs/kit';

const DEFAULT_PROJECT_KEY = 'cloud';

/** projectKey → owning client (`null` = an unassigned project). Absent = no such project. */
const PROJECTS = new Map<string, string | null>([
	['cloud', null],
	['bookofborut', 'borut'],
	['hotfruits', 'eagaming'],
	['sandbox', null],
]);
/** userId → the project keys `accessibleProjects` would list for them. */
const ACCESS = new Map<string, Set<string>>([
	['artist-borut', new Set(['cloud', 'bookofborut'])],
	['orphaned', new Set()],
]);

/** Every key `canAccessProject` was asked about, and every key whose client was resolved. */
const asked: string[] = [];
const resolved: string[] = [];
mock.module(new URL('../src/lib/server/projects.ts', import.meta.url).href, {
	namedExports: {
		DEFAULT_PROJECT_KEY,
		canAccessProject: async (userId: string, _role: string, key: string) => {
			asked.push(key);
			return PROJECTS.has(key) && (ACCESS.get(userId)?.has(key) ?? false);
		},
		projectClientKey: async (key: string) => {
			resolved.push(key);
			return PROJECTS.get(key) ?? null;
		},
	},
});

const { UNASSIGNED_CLIENT, projectPrefix } = await import('../src/lib/server/projectPaths.ts');

/** session token → its stored `sessions.activeProjectKey` (`null` = the default). */
const SESSIONS = new Map<string, string | null>();
/** Every compare-and-clear: `[token, the key it may clear]`. */
const cleared: [string | undefined, string][] = [];
const stored = (token: string | undefined): string | null =>
	(token ? SESSIONS.get(token) : null) ?? null;
mock.module(new URL('../src/lib/server/auth.ts', import.meta.url).href, {
	namedExports: {
		SESSION_COOKIE: 'session',
		getActiveProjectKey: async (token: string | undefined) => stored(token),
		getActiveScope: async (token: string | undefined) => {
			const projectKey = stored(token) ?? DEFAULT_PROJECT_KEY;
			return { projectKey, clientKey: PROJECTS.get(projectKey) ?? UNASSIGNED_CLIENT };
		},
		setActiveProjectKey: async (token: string | undefined, key: string | null) => {
			if (token) SESSIONS.set(token, key);
		},
		clearActiveProjectKey: async (token: string | undefined, expected: string) => {
			cleared.push([token, expected]);
			if (token && SESSIONS.get(token) === expected) SESSIONS.set(token, null);
		},
	},
});
mock.module(new URL('../src/lib/server/roleToolAccess.ts', import.meta.url).href, {
	namedExports: { getRoleOverrides: async () => ({}) },
});
mock.module(new URL('../src/lib/server/userToolAccess.ts', import.meta.url).href, {
	namedExports: { getToolOverrides: async () => ({}) },
});

const {
	gate,
	requireOptionalProjectKey,
	requireProjectScope,
	resolveActionScope,
	resolveToolScope,
	sessionProjectScope,
} = await import('../src/lib/server/toolScope.ts');

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

function reset(): void {
	asked.length = 0;
	resolved.length = 0;
	cleared.length = 0;
}

type User = NonNullable<App.Locals['user']>;
const user = (id: string): User => ({ id, email: `${id}@test`, name: null, role: 'artist' });

/** What a resolver answered, or the HTTP status it refused with. */
async function outcome<T>(run: () => Promise<T>): Promise<T | { status: number }> {
	try {
		return await run();
	} catch (e) {
		if (isHttpError(e)) return { status: e.status };
		throw e;
	}
}
const scope = (u: User, project: string | null) => outcome(() => requireProjectScope(u, project));
const optional = (u: User, project: string | null | undefined) =>
	outcome(async () => (await requireOptionalProjectKey(u, project)) ?? 'no project');

const borutArtist = user('artist-borut');

// ── requireProjectScope ───────────────────────────────────────────────────────
check('a granted project resolves to its client', await scope(borutArtist, 'bookofborut'), {
	clientKey: 'borut',
	projectKey: 'bookofborut',
});
reset();
check(
	"another client's project is refused — the tool grant is not a project grant",
	await scope(borutArtist, 'hotfruits'),
	{ status: 403 },
);
check('and a refusal never resolves the project it refused', resolved, []);
check(
	'an unassigned project the user was never granted is refused too',
	await scope(borutArtist, 'sandbox'),
	{ status: 403 },
);
check(
	'an unknown key is a 403, not a 404 — no oracle for which keys exist',
	await scope(borutArtist, 'no-such-project'),
	{ status: 403 },
);

reset();
check('no ?project= means the default project', await scope(borutArtist, null), {
	clientKey: UNASSIGNED_CLIENT,
	projectKey: DEFAULT_PROJECT_KEY,
});
check('and the default is access-checked like any other key', asked, [DEFAULT_PROJECT_KEY]);
check('an empty ?project= is the default too', await scope(borutArtist, ''), {
	clientKey: UNASSIGNED_CLIENT,
	projectKey: DEFAULT_PROJECT_KEY,
});
check(
	'a user who cannot reach the default is refused, never handed it',
	await scope(user('orphaned'), null),
	{ status: 403 },
);

reset();
check(
	'the key is trimmed before the check, and the checked key is the one returned',
	await scope(borutArtist, '  bookofborut '),
	{ clientKey: 'borut', projectKey: 'bookofborut' },
);
check('so the check saw the trimmed key', asked, ['bookofborut']);

// ── requireOptionalProjectKey (absent = a project-less scope, e.g. the shared library) ──
reset();
check(
	'a named, granted project comes back as its key',
	await optional(borutArtist, 'bookofborut'),
	'bookofborut',
);
check("a named project the user can't reach is refused", await optional(borutArtist, 'hotfruits'), {
	status: 403,
});
reset();
for (const absent of [null, undefined, '', '   ']) {
	check(
		`${JSON.stringify(absent)} names no project — NOT the default`,
		await optional(borutArtist, absent),
		'no project',
	);
}
check('and no project means nothing was checked or resolved', [asked, resolved], [[], []]);
check(
	'even for a user who cannot reach the default',
	await optional(user('orphaned'), null),
	'no project',
);
check('the named key is trimmed', await optional(borutArtist, ' bookofborut'), 'bookofborut');

// ── The session's STORED project: re-checked where it is read, not only where it is set ──
const TOKEN = 'session-token';
const BORUT_SCOPE = { clientKey: 'borut', projectKey: 'bookofborut' };
const DEFAULT_SCOPE = { clientKey: UNASSIGNED_CLIENT, projectKey: DEFAULT_PROJECT_KEY };
const grant = (on: boolean) => {
	const projects = ACCESS.get('artist-borut')!;
	if (on) projects.add('bookofborut');
	else projects.delete('bookofborut');
};
/** The session holds `key`, the artist's grant to it is `granted`, and the trace is clean. */
function given(key: string | null, granted: boolean): void {
	SESSIONS.set(TOKEN, key);
	grant(granted);
	reset();
}
type Scope = { clientKey: string; projectKey: string };
/** Key order is not the contract — `getActiveScope` builds its object the other way round. */
const scopeOf = ({ clientKey, projectKey }: Scope): Scope => ({ clientKey, projectKey });
const session = async (u: User | null, token: string | undefined) =>
	scopeOf(await sessionProjectScope(u, token));
const cookies = { get: (name: string) => (name === 'session' ? TOKEN : undefined) } as Cookies;
const editorGate = (u: User | null) =>
	outcome(() =>
		gate({ user: u } as App.Locals, cookies, { tool: 'editor', forbiddenMessage: 'no editor' }),
	);
const page = async (u: User | null, search = '') =>
	scopeOf(
		await resolveToolScope({
			url: new URL(`https://app.test/editor${search}`),
			sessionToken: TOKEN,
			user: u,
		}),
	);

given('bookofborut', true);
check(
	'a stored project the user can still reach is the session scope',
	await session(borutArtist, TOKEN),
	BORUT_SCOPE,
);
check(
	'it was checked, and left stored',
	[asked, cleared, stored(TOKEN)],
	[['bookofborut'], [], 'bookofborut'],
);

given('bookofborut', false);
check(
	'once the grant is revoked the stored project is NOT handed back — the default is',
	await session(borutArtist, TOKEN),
	DEFAULT_SCOPE,
);
check('the stale value is cleared, only while it still names the key that failed', cleared, [
	[TOKEN, 'bookofborut'],
]);
check('so the session now holds the default', stored(TOKEN), null);
reset();
check(
	'and the next request takes the fast path — the default is never checked',
	[await session(borutArtist, TOKEN), asked, cleared],
	[DEFAULT_SCOPE, [], []],
);
reset();
check(
	'no session token is the default, unchecked',
	[await session(borutArtist, undefined), asked],
	[DEFAULT_SCOPE, []],
);

given('bookofborut', true);
check(
	'without a user nothing is reachable: the default, never the stored project',
	await session(null, TOKEN),
	DEFAULT_SCOPE,
);
check(
	'and, since nothing was revoked, nothing is cleared',
	[cleared, stored(TOKEN)],
	[[], 'bookofborut'],
);

// gate(): the allow-list every R2 endpoint (editor, flipbook, fx, files, */save…) writes through.
given('bookofborut', true);
check('gate() scopes a granted stored project to its own prefix', await editorGate(borutArtist), {
	...BORUT_SCOPE,
	prefixes: [`${projectPrefix('borut', 'bookofborut')}/`],
});
given('bookofborut', false);
check(
	"gate() on a revoked stored project allows the default's prefix — never the revoked one's",
	await editorGate(borutArtist),
	{ ...DEFAULT_SCOPE, prefixes: [`${projectPrefix(UNASSIGNED_CLIENT, DEFAULT_PROJECT_KEY)}/`] },
);
check('and clears it', stored(TOKEN), null);
given('bookofborut', true);
check('gate() still refuses before it reads the session', await editorGate(null), { status: 401 });
check('so an unauthenticated call checks and clears nothing', [asked, cleared], [[], []]);

// resolveToolScope(): every tool page loader.
given('bookofborut', true);
check(
	'a page without ?project= lands on a granted stored project',
	await page(borutArtist),
	BORUT_SCOPE,
);
given('bookofborut', false);
check(
	'a page without ?project= does not fall back to a revoked stored project',
	await page(borutArtist),
	DEFAULT_SCOPE,
);
given('bookofborut', false);
check(
	'nor does one whose ?project= names it: the explicit check refuses, the fallback re-checks',
	[await page(borutArtist, '?project=bookofborut'), stored(TOKEN)],
	[DEFAULT_SCOPE, null],
);
given(null, true);
check(
	'an explicit, granted ?project= still wins and is synced into the session',
	[await page(borutArtist, '?project=bookofborut'), stored(TOKEN)],
	[BORUT_SCOPE, 'bookofborut'],
);

// resolveActionScope(): the editor and localization SAVE actions — a save writes the tab's doc.
const save = (u: User, search = '') =>
	outcome(async () =>
		scopeOf(
			await resolveActionScope({
				url: new URL(`https://app.test/editor${search}`),
				sessionToken: TOKEN,
				user: u,
			}),
		),
	);
given(null, true);
check(
	"a save on the page's granted ?project= writes there, without re-syncing the session",
	[await save(borutArtist, '?project=bookofborut'), stored(TOKEN)],
	[BORUT_SCOPE, null],
);
given('bookofborut', false);
check(
	"a save whose ?project= was revoked is refused — it never lands on the fallback's project",
	[await save(borutArtist, '?project=bookofborut'), resolved],
	[{ status: 403 }, []],
);
given('bookofborut', false);
check(
	'a save with no ?project= writes to the re-checked session project',
	await save(borutArtist),
	DEFAULT_SCOPE,
);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} project-scope checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} project-scope checks pass`);
