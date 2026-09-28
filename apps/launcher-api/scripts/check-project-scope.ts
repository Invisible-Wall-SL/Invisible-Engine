/**
 * Contract check for `requireProjectScope` and `requireOptionalProjectKey`
 * (`$lib/server/toolScope.ts`) — the project half of every session-gated authoring endpoint that
 * takes its project from the request:
 *   pnpm --filter launcher-api check:project-scope
 *
 * Those endpoints used to resolve whatever project they were handed, so a user with the TOOL could
 * read and write any client's project by editing one query param — the tool grant was being
 * treated as a project grant. The rule now is the selector's own `canAccessProject`; this pins
 * that the resolvers ask it about the key they actually return (trimmed, defaulted), refuse with a
 * 403 without resolving the project's client, and resolve the client exactly as the page scope
 * does. The optional form must treat "no project" as no project — never as the default.
 *
 * Runs the REAL module. Only `projects.ts` is replaced — it is the Postgres boundary — by a table
 * of which user may reach which project, so the check needs no database. If `toolScope.ts` starts
 * importing another export from `projects.ts`, the stub below must provide it or this fails at
 * import with "does not provide an export named". The route half (every handler that takes a
 * project goes through a check) is the source scan in `check-launcher-gates.ts`.
 */
import { mock } from 'node:test';
import { isHttpError } from '@sveltejs/kit';

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

const { requireOptionalProjectKey, requireProjectScope } = await import(
	'../src/lib/server/toolScope.ts'
);
const { UNASSIGNED_CLIENT } = await import('../src/lib/server/projectPaths.ts');

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

console.log();
if (failures) {
	console.error(`${failures} of ${checks} project-scope checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} project-scope checks pass`);
