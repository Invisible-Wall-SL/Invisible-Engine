/**
 * Contract check for `requireProjectScope` (`$lib/server/toolScope.ts`) — the project half of
 * the session-gated authoring endpoints (`/api/game-config` + `server-paytable`, `/api/win-text`,
 * `/api/editor/symbols`, `/api/sounds` + `file`):
 *   pnpm --filter launcher-api check:project-scope
 *
 * Those endpoints used to resolve whatever `?project=` they were handed, so a user with the TOOL
 * could read and write any client's project by editing one query param — the tool grant was being
 * treated as a project grant. The rule now is the selector's own `canAccessProject`; this pins
 * that the resolver asks it about the key it actually returns (trimmed, defaulted), refuses with a
 * 403 before resolving anything, and resolves the client exactly as the page scope does.
 *
 * Runs the REAL module. Only `projects.ts` is replaced — it is the Postgres boundary — by a table
 * of which user may reach which project, so the check needs no database. The route half (every
 * handler that reads `?project=` goes through the resolver) is the source scan in
 * `check-launcher-gates.ts`.
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

const asked: string[] = [];
mock.module(new URL('../src/lib/server/projects.ts', import.meta.url).href, {
	namedExports: {
		DEFAULT_PROJECT_KEY,
		canAccessProject: async (userId: string, _role: string, key: string) => {
			asked.push(key);
			return PROJECTS.has(key) && (ACCESS.get(userId)?.has(key) ?? false);
		},
		projectClientKey: async (key: string) => PROJECTS.get(key) ?? null,
	},
});

const { requireProjectScope } = await import('../src/lib/server/toolScope.ts');
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

type User = NonNullable<App.Locals['user']>;
const user = (id: string): User => ({ id, email: `${id}@test`, name: null, role: 'artist' });

/** The scope, or the HTTP status it was refused with. */
async function outcome(
	u: User,
	project: string | null,
): Promise<{ clientKey: string; projectKey: string } | { status: number }> {
	try {
		return await requireProjectScope(u, project);
	} catch (e) {
		if (isHttpError(e)) return { status: e.status };
		throw e;
	}
}

const borutArtist = user('artist-borut');

check('a granted project resolves to its client', await outcome(borutArtist, 'bookofborut'), {
	clientKey: 'borut',
	projectKey: 'bookofborut',
});
check(
	"another client's project is refused — the tool grant is not a project grant",
	await outcome(borutArtist, 'hotfruits'),
	{ status: 403 },
);
check(
	'an unassigned project the user was never granted is refused too',
	await outcome(borutArtist, 'sandbox'),
	{ status: 403 },
);
check(
	'an unknown key is a 403, not a 404 — no oracle for which keys exist',
	await outcome(borutArtist, 'no-such-project'),
	{ status: 403 },
);

asked.length = 0;
check('no ?project= means the default project', await outcome(borutArtist, null), {
	clientKey: UNASSIGNED_CLIENT,
	projectKey: DEFAULT_PROJECT_KEY,
});
check('and the default is access-checked like any other key', asked, [DEFAULT_PROJECT_KEY]);
check('an empty ?project= is the default too', await outcome(borutArtist, ''), {
	clientKey: UNASSIGNED_CLIENT,
	projectKey: DEFAULT_PROJECT_KEY,
});
check(
	'a user who cannot reach the default is refused, never handed it',
	await outcome(user('orphaned'), null),
	{ status: 403 },
);

asked.length = 0;
check(
	'the key is trimmed before the check, and the checked key is the one returned',
	await outcome(borutArtist, '  bookofborut '),
	{ clientKey: 'borut', projectKey: 'bookofborut' },
);
check('so the check saw the trimmed key', asked, ['bookofborut']);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} project-scope checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} project-scope checks pass`);
