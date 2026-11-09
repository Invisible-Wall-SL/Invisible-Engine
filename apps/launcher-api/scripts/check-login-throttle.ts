/**
 * Contract check for the password-login throttle and the sign-in password cap:
 *   pnpm --filter launcher-api check:login-throttle
 *
 * Runs the REAL `loginThrottle.ts`, `auth.ts`, both sign-in routes (`/login` and
 * `POST /api/launcher/login`) and the password rules, over a database stand-in that records every
 * query (`lib/recordingDb.ts`).
 *
 * Why: the throttle used to READ a scope's count, add one in JavaScript and write the sum back. A
 * burst of parallel bad logins all read the same count, so the whole burst counted as one failure
 * and never reached a lockout. Now the database does the arithmetic in one upsert and answers the
 * new count. What is pinned here:
 *  - the lockout policy (free attempts, doubling, caps) for both scopes;
 *  - recording a failure never reads the row it writes, and the one statement it issues increments
 *    the STORED count (the rendered SQL, not a parameter computed here);
 *  - the lock is written for the count the database answered, and only while the row still holds
 *    that count, so a later failure's longer lock cannot be shortened;
 *  - a password over the cap is refused by both sign-in routes before the throttle or any account
 *    lookup, and every password the new-password rule accepts fits under the cap.
 *
 * Verified once against a real Postgres (PGlite) as well: 20 parallel bumps store 20 under the new
 * statement and 1 under the old read-then-write.
 */
import { mock } from 'node:test';
import { isActionFailure } from '@sveltejs/kit';
import { drizzle } from 'drizzle-orm/postgres-js';
import { argsOf, recordingDb, renderSql, type DbCall } from './lib/recordingDb.ts';

/** `login_attempts` failure count the next upsert answers, per scope key. */
const answeredCount = new Map<string, number>();
const { db, log } = recordingDb((call: DbCall) => {
	if (call.op !== 'insert' || call.table !== 'login_attempts') return [];
	const values = argsOf(call, 'values')?.[0] as { key: string };
	const failures = answeredCount.get(values.key);
	return failures === undefined ? [] : [{ failures }];
});

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('db/index.ts'), { namedExports: { getDb: () => db } });

const { EMAIL_POLICY, IP_POLICY, countFailure, lockedUntilFor, recordLoginFailure } =
	await import('../src/lib/server/loginThrottle.ts');
const { verifyCredentials } = await import('../src/lib/server/auth.ts');
const { MAX_PASSWORD_LENGTH, passwordTooLong } = await import('../src/lib/passwordLimit.ts');
const { passwordLengthProblem } = await import('../src/lib/passwordPolicy.ts');
const webLogin = await import('../src/routes/login/+page.server.ts');
const apiLogin = await import('../src/routes/api/launcher/login/+server.ts');

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

const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);
const MIN = 60_000;
const lockIn = (policy: typeof IP_POLICY, count: number): number | null => {
	const until = lockedUntilFor(policy, count, NOW);
	return until ? until.getTime() - NOW : null;
};

// ── The policy: unchanged by the move into SQL ────────────────────────────────
check('IP: ten failures are free', lockIn(IP_POLICY, 10), null);
check('IP: the eleventh locks for a minute', lockIn(IP_POLICY, 11), MIN);
check('IP: then it doubles', lockIn(IP_POLICY, 12), 2 * MIN);
check('IP: capped at an hour', lockIn(IP_POLICY, 30), 60 * MIN);
check('email: five failures are free', lockIn(EMAIL_POLICY, 5), null);
check('email: the sixth locks for 30 s', lockIn(EMAIL_POLICY, 6), 30_000);
check('email: capped at 15 min', lockIn(EMAIL_POLICY, 30), 15 * MIN);

// ── The count is the database's ───────────────────────────────────────────────
{
	const { sql, params } = countFailure(drizzle.mock(), 'ip:203.0.113.7', IP_POLICY).toSQL();
	check(
		'one statement: insert … on conflict do update … returning the new count',
		/^insert into "login_attempts" .* on conflict \("key"\) do update set .* returning "failures"$/.test(
			sql,
		),
		true,
	);
	check(
		'the update adds one to the STORED count, not to a number read earlier',
		/"failures" = case when .* then "login_attempts"\."failures" \+ 1 else 1 end/.test(sql),
		true,
	);
	check('a first failure inserts a count of 1', params.slice(0, 2), ['ip:203.0.113.7', 1]);
	check('the decay window is the scope policy', params.includes(IP_POLICY.decayMs), true);
}

async function failOnce(ip: string, email: string): Promise<DbCall[]> {
	log.length = 0;
	await recordLoginFailure(ip, email);
	return [...log];
}

{
	answeredCount.clear();
	const calls = await failOnce('198.51.100.1', 'ana@invisiblewall.org');
	check(
		'recording a failure never reads the row it writes',
		calls.filter((c) => c.op === 'select').length,
		0,
	);
	check(
		'one upsert per scope, IP and email',
		calls.map((c) => `${c.op} ${c.table}`),
		['insert login_attempts', 'insert login_attempts'],
	);
}
{
	answeredCount.clear();
	answeredCount.set('ip:198.51.100.2', 4);
	answeredCount.set('email:bo@invisiblewall.org', 3);
	const calls = await failOnce('198.51.100.2', 'bo@invisiblewall.org');
	check(
		'below the free allowance no lock is written',
		calls.filter((c) => c.op === 'update').length,
		0,
	);
}
{
	answeredCount.clear();
	answeredCount.set('ip:198.51.100.3', 11);
	const before = Date.now();
	const calls = await failOnce('198.51.100.3', 'cy@invisiblewall.org');
	const updates = calls.filter((c) => c.op === 'update');
	check('past it, one lock is written', updates.length, 1);
	const set = argsOf(updates[0], 'set')?.[0] as { lockedUntil: Date } | undefined;
	const lockMs = set ? set.lockedUntil.getTime() - before : -1;
	check(
		'for the count the database answered (11 → one minute)',
		lockMs >= MIN && lockMs < MIN + 5_000,
		true,
	);
	const where = renderSql(argsOf(updates[0], 'where')?.[0]);
	check(
		'only while the row still holds that count — a later, longer lock is never shortened',
		[/"key" = \$\d/.test(where.sql), /"failures" = \$\d/.test(where.sql), where.params],
		[true, true, ['ip:198.51.100.3', 11]],
	);
}

// ── The sign-in password cap ──────────────────────────────────────────────────
const IP = '203.0.113.9';
const LONG = 'x'.repeat(MAX_PASSWORD_LENGTH + 1);
const AT_CAP = 'y'.repeat(MAX_PASSWORD_LENGTH);

check('the cap is 256', MAX_PASSWORD_LENGTH, 256);
check(
	'every password the new-password rule accepts fits under the sign-in cap',
	[passwordLengthProblem(AT_CAP), passwordTooLong(AT_CAP), passwordLengthProblem(LONG) !== null],
	[null, false, true],
);

answeredCount.clear();
log.length = 0;
check(
	'verifyCredentials refuses an over-long password',
	await verifyCredentials('a@b.c', LONG),
	null,
);
check('without looking the account up', log.length, 0);

type WebEvent = Parameters<typeof webLogin.actions.default>[0];
async function webSignIn(password: string): Promise<{ status: number; error: unknown }> {
	const body = new FormData();
	body.set('email', 'ana@invisiblewall.org');
	body.set('password', password);
	const event = {
		request: new Request('http://launcher.test/login', { method: 'POST', body }),
		cookies: { set: () => {} },
		getClientAddress: () => IP,
	} as unknown as WebEvent;
	const result = await webLogin.actions.default(event);
	if (!isActionFailure(result)) throw new Error('expected the sign-in to fail');
	return { status: result.status, error: (result.data as { error: unknown }).error };
}

type ApiEvent = Parameters<typeof apiLogin.POST>[0];
async function apiSignIn(password: string): Promise<{ status: number; error: unknown }> {
	const event = {
		request: new Request('http://launcher.test/api/launcher/login', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ email: 'ana@invisiblewall.org', password }),
		}),
		getClientAddress: () => IP,
	} as unknown as ApiEvent;
	const response = await apiLogin.POST(event);
	return { status: response.status, error: ((await response.json()) as { error: unknown }).error };
}

const tables = (): string[] => log.map((c) => `${c.op} ${c.table}`);
const GENERIC = 'Invalid email or password.';

for (const [route, signIn, status] of [
	['/login', webSignIn, 400],
	['POST /api/launcher/login', apiSignIn, 401],
] as const) {
	log.length = 0;
	check(`${route}: an over-long password gets the generic refusal`, await signIn(LONG), {
		status,
		error: GENERIC,
	});
	check(`${route}: before the throttle or any account lookup`, tables(), []);

	// The control: a wrong password AT the cap goes the whole way, so the empty log above is the
	// cap's doing and not a harness that never reaches the database.
	log.length = 0;
	check(`${route}: a wrong password at the cap is refused`, await signIn(AT_CAP), {
		status,
		error: GENERIC,
	});
	check(`${route}: …after the throttle, the account lookup and a counted failure`, tables(), [
		'select login_attempts',
		'select users',
		'insert login_attempts',
		'insert login_attempts',
	]);
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} login-throttle checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} login-throttle checks pass`);
