/**
 * Contract check for the project half of `POST /api/lease`:
 *   pnpm --filter launcher-api check:lease-scope
 *
 * The lease only required a login, so anyone signed in could acquire or take over the lease on
 * another client's doc — a false "someone is editing" banner in front of that client's authors —
 * and the not-held answer named the holder, so it also told them who was editing it. The rule now
 * is the selector's own `canAccessProject` on the body's `projectKey`, and the body's `clientKey`
 * must be that project's own client, so a lease cannot be keyed on a made-up one.
 *
 * Runs the REAL handler. Only the Postgres boundary is replaced: `projects.ts` by a table of which
 * user may reach which project, `auth.ts` by a fixed session, `db` by a holder lookup, and
 * `lease.ts` by a recorder that says whether the handler ever reached it. If the route starts
 * importing another export from one of those modules, the stub below must provide it or this
 * fails at import with "does not provide an export named". The source half (the route still calls
 * the checks) is the scan in `check-launcher-gates.ts`.
 */
import { mock } from 'node:test';
import { isHttpError } from '@sveltejs/kit';

/** projectKey → owning client (`null` = an unassigned project). Absent = no such project. */
const PROJECTS = new Map<string, string | null>([
	['cloud', null],
	['bookofborut', 'borut'],
	['hotfruits', 'eagaming'],
]);
/** userId → the project keys `accessibleProjects` would list for them. */
const ACCESS = new Map<string, Set<string>>([['artist-borut', new Set(['cloud', 'bookofborut'])]]);

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('projects.ts'), {
	namedExports: {
		canAccessProject: async (userId: string, _role: string, key: string) =>
			PROJECTS.has(key) && (ACCESS.get(userId)?.has(key) ?? false),
		projectClientKey: async (key: string) => PROJECTS.get(key) ?? null,
	},
});
mock.module(server('auth.ts'), {
	namedExports: { SESSION_COOKIE: 'session', sessionIdFromToken: async () => 'session-1' },
});
const HOLDER_ROW = { name: 'Holder', email: 'holder@eagaming' };
const query = {
	select: () => query,
	from: () => query,
	where: () => query,
	limit: async () => [HOLDER_ROW],
};
mock.module(server('db/index.ts'), { namedExports: { getDb: () => query } });

/** Every lease operation the handler reached, in order. */
const reached: string[] = [];
const at = new Date(0);
const otherHolder = {
	userId: 'someone-else',
	sessionId: 'session-2',
	acquiredAt: at,
	heartbeatAt: at,
	expiresAt: at,
};
mock.module(server('lease.ts'), {
	namedExports: {
		LEASE_HEARTBEAT_MS: 10_000,
		LEASE_TTL_MS: 45_000,
		acquire: async () => {
			reached.push('acquire');
			return { held: false, heldBy: otherHolder, activeAgoMs: 0 };
		},
		heartbeat: async () => {
			reached.push('heartbeat');
			return { held: false, heldBy: otherHolder };
		},
		release: async () => {
			reached.push('release');
		},
		takeover: async () => {
			reached.push('takeover');
			return { held: true, lease: {} };
		},
	},
});

const { POST } = await import('../src/routes/api/lease/+server.ts');

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
const borutArtist = user('artist-borut');

/** The status and body the handler answered with, and the lease operations it reached. */
async function post(
	caller: User | null,
	body: Record<string, unknown>,
): Promise<{ status: number; body: unknown; reached: string[] }> {
	reached.length = 0;
	const event = {
		request: new Request('http://launcher.test/api/lease', {
			method: 'POST',
			body: JSON.stringify(body),
		}),
		cookies: { get: () => 'raw-session-token' },
		locals: { user: caller },
	} as unknown as Parameters<typeof POST>[0];
	try {
		const res = await POST(event);
		return { status: res.status, body: await res.json(), reached: [...reached] };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, body: null, reached: [...reached] };
		throw e;
	}
}
const key = (clientKey: string, projectKey: string) => ({
	toolId: 'editor',
	clientKey,
	projectKey,
	docKey: 'editor',
});
const REFUSED = { status: 403, body: { error: 'forbidden' }, reached: [] };

// ── Another client's project: refused before any lease is touched ─────────────
for (const action of ['acquire', 'heartbeat', 'release', 'takeover']) {
	check(
		`${action} on another client's project is refused before the lease is touched`,
		await post(borutArtist, { action, ...key('eagaming', 'hotfruits') }),
		REFUSED,
	);
}
check(
	'an unknown project gets the same answer — no oracle for which keys exist',
	await post(borutArtist, { action: 'acquire', ...key('borut', 'no-such-project') }),
	REFUSED,
);

// ── The client half must be the project's own ─────────────────────────────────
check(
	'a reachable project under a made-up client is refused',
	await post(borutArtist, { action: 'acquire', ...key('made-up', 'bookofborut') }),
	REFUSED,
);
check(
	'and so is an assigned project claimed as unassigned',
	await post(borutArtist, { action: 'takeover', ...key('unassigned', 'bookofborut') }),
	REFUSED,
);

// ── A project the caller can reach, keyed as its page keys it: unchanged ──────
{
	const own = await post(borutArtist, { action: 'acquire', ...key('borut', 'bookofborut') });
	check(
		'acquire on an own project reaches the lease and answers not-held with the holder',
		[own.status, own.reached, (own.body as { heldBy?: { email?: string } }).heldBy?.email],
		[200, ['acquire'], HOLDER_ROW.email],
	);
}
for (const action of ['heartbeat', 'release', 'takeover']) {
	const own = await post(borutArtist, { action, ...key('borut', 'bookofborut') });
	check(
		`${action} on an own project reaches the lease`,
		[own.status, own.reached],
		[200, [action]],
	);
}
{
	const unassigned = await post(borutArtist, { action: 'acquire', ...key('unassigned', 'cloud') });
	check(
		'an unassigned project is keyed on the unassigned client, as its loader keys it',
		[unassigned.status, unassigned.reached],
		[200, ['acquire']],
	);
}

// ── What was already refused still is, and before the project lookup ──────────
check(
	'a missing clientKey is still a 400',
	await post(borutArtist, {
		action: 'acquire',
		toolId: 'editor',
		projectKey: 'bookofborut',
		docKey: 'editor',
	}),
	{ status: 400, body: { error: 'bad-request' }, reached: [] },
);
check(
	'no session is still a 401',
	await post(null, { action: 'acquire', ...key('borut', 'bookofborut') }),
	{ status: 401, body: null, reached: [] },
);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} lease-scope checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} lease-scope checks pass`);
