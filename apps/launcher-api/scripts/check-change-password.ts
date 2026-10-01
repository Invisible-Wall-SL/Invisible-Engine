/**
 * Contract check for the self-service password change (`/account/password`):
 *   pnpm --filter launcher-api check:change-password
 *
 * Runs the REAL route action, `changePassword`, `auth.ts` (scrypt, `verifyCredentials`,
 * `revokeUserSessions`) and the password policy. Two boundaries are replaced:
 *  - `loginThrottle.ts` by a recorder whose lockout the check sets, so "blocked" and "a failure
 *    was recorded" are observable;
 *  - the database by an in-memory `users` + `sessions` store. Every `where` it receives is the
 *    real Drizzle condition, rendered by Drizzle's own Postgres dialect and evaluated row by row —
 *    so "the current session survives, the others go" is decided by the shipped query, not by a
 *    stub that already knows the answer. An operator the evaluator does not know throws.
 */
import { mock } from 'node:test';
import { createHash } from 'node:crypto';
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm';
import { PgDialect, type PgTable } from 'drizzle-orm/pg-core';
import { isActionFailure, isRedirect } from '@sveltejs/kit';
import { sessions, users } from '../src/lib/server/db/schema.ts';

type Row = Record<string, unknown>;
const tables = new Map<PgTable, Row[]>([
	[users, []],
	[sessions, []],
]);
/** Queries the store answered, by table name — `users` reads are how verification shows. */
const reads: string[] = [];

const dialect = new PgDialect();

/** A row predicate from the real Drizzle condition: `=`, `<>`, `and`, `or`, parentheses. */
function predicate(table: PgTable, condition: SQL): (row: Row) => boolean {
	const { sql, params } = dialect.sqlToQuery(condition);
	const name = getTableName(table);
	const keys = new Map(Object.entries(getTableColumns(table)).map(([key, c]) => [c.name, key]));
	const tokens = sql.match(/"[^"]+"\."[^"]+"|\$\d+|<>|=|\(|\)|and|or|\S+/g) ?? [];
	let at = 0;
	type Node = (row: Row) => unknown;
	const operand = (): Node => {
		const t = tokens[at++];
		const column = /^"([^"]+)"\."([^"]+)"$/.exec(t ?? '');
		if (column && column[1] === name && keys.has(column[2])) {
			const key = keys.get(column[2])!;
			return (row) => row[key];
		}
		if (/^\$\d+$/.test(t ?? '')) {
			const value = params[Number(t.slice(1)) - 1];
			return () => value;
		}
		throw new Error(`fake db: unsupported SQL token "${t}" in: ${sql}`);
	};
	const comparison = (): Node => {
		if (tokens[at] === '(') {
			at++;
			const inner = disjunction();
			if (tokens[at++] !== ')') throw new Error(`fake db: unbalanced: ${sql}`);
			return inner;
		}
		const left = operand();
		const op = tokens[at++];
		const right = operand();
		if (op === '=') return (row) => left(row) === right(row);
		if (op === '<>') return (row) => left(row) !== right(row);
		throw new Error(`fake db: unsupported operator "${op}" in: ${sql}`);
	};
	const conjunction = (): Node => {
		const parts = [comparison()];
		while (tokens[at] === 'and') {
			at++;
			parts.push(comparison());
		}
		return (row) => parts.every((p) => p(row));
	};
	const disjunction = (): Node => {
		const parts = [conjunction()];
		while (tokens[at] === 'or') {
			at++;
			parts.push(conjunction());
		}
		return (row) => parts.some((p) => p(row));
	};
	const root = disjunction();
	if (at !== tokens.length) throw new Error(`fake db: trailing SQL in: ${sql}`);
	return (row) => !!root(row);
}

function rowsOf(table: PgTable): Row[] {
	const rows = tables.get(table);
	if (!rows) throw new Error(`fake db: no table ${getTableName(table)}`);
	return rows;
}

const fakeDb = {
	select: () => ({
		from: (table: PgTable) => ({
			where: async (condition: SQL) => {
				reads.push(getTableName(table));
				return rowsOf(table).filter(predicate(table, condition));
			},
		}),
	}),
	update: (table: PgTable) => ({
		set: (values: Row) => ({
			where: async (condition: SQL) => {
				for (const row of rowsOf(table).filter(predicate(table, condition))) {
					Object.assign(row, values);
				}
			},
		}),
	}),
	delete: (table: PgTable) => ({
		where: async (condition: SQL) => {
			const rows = rowsOf(table);
			const doomed = predicate(table, condition);
			tables.set(
				table,
				rows.filter((row) => !doomed(row)),
			);
		},
	}),
};

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('db/index.ts'), { namedExports: { getDb: () => fakeDb } });
mock.module(server('projects.ts'), {
	namedExports: { DEFAULT_PROJECT_KEY: 'cloud', projectClientKey: async () => null },
});
mock.module(server('projectPaths.ts'), { namedExports: { UNASSIGNED_CLIENT: '_unassigned' } });

let lockedOut = false;
const throttle = { checked: 0, failures: [] as string[][], successes: [] as string[][] };
mock.module(server('loginThrottle.ts'), {
	namedExports: {
		checkLoginThrottle: async () => {
			throttle.checked++;
			return lockedOut
				? { blocked: true, retryAfterSeconds: 30 }
				: { blocked: false, retryAfterSeconds: 0 };
		},
		recordLoginFailure: async (ip: string, email: string) => {
			throttle.failures.push([ip, email]);
		},
		recordLoginSuccess: async (ip: string, email: string) => {
			throttle.successes.push([ip, email]);
		},
	},
});

const { hashPassword, verifyPassword } = await import('../src/lib/server/auth.ts');
const { MIN_PASSWORD_LENGTH, passwordChangeProblem } = await import('../src/lib/passwordPolicy.ts');
const { TOO_MANY_ATTEMPTS, WRONG_CURRENT_PASSWORD } =
	await import('../src/lib/server/changePassword.ts');
const route = await import('../src/routes/(app)/account/password/+page.server.ts');

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

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');
const IP = '203.0.113.7';
const EMAIL = 'ana@invisiblewall.org';
const OLD = 'correct horse battery';
const NEW = 'a brand new passphrase';
const CURRENT_TOKEN = 'raw-token-of-this-browser';
const future = new Date(Date.now() + 86_400_000);

const ana = { id: 'u-ana', email: EMAIL, name: 'Ana', role: 'artist' as const };

/** A fresh store: Ana with three sessions (this browser + two others), Bo with one. */
async function reset(opts: { anaExpiresAt?: Date | null } = {}): Promise<void> {
	lockedOut = false;
	throttle.checked = 0;
	throttle.failures = [];
	throttle.successes = [];
	reads.length = 0;
	tables.set(users, [
		{
			id: ana.id,
			email: EMAIL,
			name: 'Ana',
			role: 'artist',
			passwordHash: await hashPassword(OLD),
			active: true,
			expiresAt: opts.anaExpiresAt ?? null,
		},
		{
			id: 'u-bo',
			email: 'bo@invisiblewall.org',
			name: 'Bo',
			role: 'developer',
			passwordHash: await hashPassword('bo password 123'),
			active: true,
			expiresAt: null,
		},
	]);
	tables.set(sessions, [
		{ id: sha256(CURRENT_TOKEN), userId: ana.id, expiresAt: future },
		{ id: sha256('ana-laptop'), userId: ana.id, expiresAt: future },
		{ id: sha256('ana-phone'), userId: ana.id, expiresAt: future },
		{ id: sha256('bo-desktop'), userId: 'u-bo', expiresAt: future },
	]);
}

const sessionIds = (): string[] =>
	rowsOf(sessions)
		.map((s) => s.id as string)
		.sort();
const anaHash = (): string => rowsOf(users).find((u) => u.id === ana.id)!.passwordHash as string;

type Outcome =
	| { kind: 'ok'; message: unknown }
	| { kind: 'fail'; status: number; error: unknown }
	| { kind: 'redirect'; status: number; location: string };

/** Post the form to the real route action as `caller`, from this browser. */
async function submit(
	caller: typeof ana | null,
	fields: { current: string; next: string; confirm?: string },
): Promise<Outcome> {
	const body = new FormData();
	body.set('current', fields.current);
	body.set('next', fields.next);
	body.set('confirm', fields.confirm ?? fields.next);
	const event = {
		request: new Request('http://launcher.test/account/password', { method: 'POST', body }),
		locals: { user: caller },
		cookies: { get: (name: string) => (name === 'session' ? CURRENT_TOKEN : undefined) },
		getClientAddress: () => IP,
	} as unknown as Parameters<(typeof route.actions)['default']>[0];
	try {
		const result = await route.actions.default(event);
		if (isActionFailure(result)) {
			return {
				kind: 'fail',
				status: result.status,
				error: (result.data as unknown as { error: unknown }).error,
			};
		}
		return { kind: 'ok', message: (result as { ok: unknown }).ok };
	} catch (e) {
		if (isRedirect(e)) return { kind: 'redirect', status: e.status, location: e.location };
		throw e;
	}
}

const allSessions = [
	sha256(CURRENT_TOKEN),
	sha256('ana-laptop'),
	sha256('ana-phone'),
	sha256('bo-desktop'),
].sort();

// ── The policy itself ─────────────────────────────────────────────────────────
check('the minimum is 12 characters', MIN_PASSWORD_LENGTH, 12);
const policy = (next: string, extra: { current?: string; confirm?: string } = {}) =>
	passwordChangeProblem({
		current: extra.current ?? OLD,
		next,
		confirm: extra.confirm ?? next,
		email: EMAIL,
	});
check(
	'11 characters are refused',
	policy('x'.repeat(11)),
	'Password must be at least 12 characters.',
);
check('12 characters are accepted', policy('x'.repeat(12)), null);
check(
	'a mismatched confirmation is refused',
	policy(NEW, { confirm: `${NEW}!` }),
	'The new passwords do not match.',
);
check(
	'the current password is refused as the new one',
	policy(OLD, { current: OLD }),
	'The new password must be different from the current one.',
);
check(
	'the email is refused as the new password (case and spaces ignored)',
	policy(`  ${EMAIL.toUpperCase()} `),
	'The new password must not be your email address.',
);
check(
	'an empty current password is refused',
	policy(NEW, { current: '' }),
	'Enter your current password.',
);

// ── Signed out ───────────────────────────────────────────────────────────────
await reset();
check('a signed-out POST redirects to /login', await submit(null, { current: OLD, next: NEW }), {
	kind: 'redirect',
	status: 303,
	location: '/login',
});
{
	let outcome: unknown = null;
	try {
		await route.load({ locals: { user: null } } as unknown as Parameters<typeof route.load>[0]);
	} catch (e) {
		if (isRedirect(e)) outcome = { status: e.status, location: e.location };
	}
	check('a signed-out visit redirects to /login', outcome, { status: 303, location: '/login' });
}
check('a signed-out POST changes nothing', sessionIds(), allSessions);

// ── A bad new password costs no attempt and touches nothing ──────────────────
for (const [label, fields, error] of [
	[
		'11 characters',
		{ current: OLD, next: 'x'.repeat(11) },
		'Password must be at least 12 characters.',
	],
	[
		'a mismatch',
		{ current: OLD, next: NEW, confirm: `${NEW}?` },
		'The new passwords do not match.',
	],
	[
		'the current password',
		{ current: OLD, next: OLD },
		'The new password must be different from the current one.',
	],
	['the email', { current: OLD, next: EMAIL }, 'The new password must not be your email address.'],
] as const) {
	await reset();
	const before = anaHash();
	check(`${label}: refused with 400`, await submit(ana, fields), {
		kind: 'fail',
		status: 400,
		error,
	});
	check(
		`${label}: no throttle attempt is consumed`,
		[throttle.checked, throttle.failures.length],
		[0, 0],
	);
	check(`${label}: the password is never verified`, reads.includes('users'), false);
	check(`${label}: the hash is unchanged`, anaHash() === before, true);
	check(`${label}: every session survives`, sessionIds(), allSessions);
}

// ── Locked out: 429 before the current password is ever checked ──────────────
await reset();
lockedOut = true;
{
	const before = anaHash();
	check('a locked-out change is refused with 429', await submit(ana, { current: OLD, next: NEW }), {
		kind: 'fail',
		status: 429,
		error: TOO_MANY_ATTEMPTS,
	});
	check('the lockout is checked once', throttle.checked, 1);
	check('locked out: the current password is never verified', reads.includes('users'), false);
	check('locked out: no failure is recorded', throttle.failures.length, 0);
	check('locked out: the hash is unchanged', anaHash() === before, true);
	check('locked out: every session survives', sessionIds(), allSessions);
}

// ── Wrong current password ────────────────────────────────────────────────────
await reset();
{
	const before = anaHash();
	check(
		'a wrong current password is refused with the uniform message',
		await submit(ana, { current: 'not my password', next: NEW }),
		{ kind: 'fail', status: 400, error: WRONG_CURRENT_PASSWORD },
	);
	check('the current password was verified against the account', reads.includes('users'), true);
	check('the failure is recorded against this IP and email', throttle.failures, [[IP, EMAIL]]);
	check('no success is recorded', throttle.successes.length, 0);
	check('wrong current: the hash is unchanged', anaHash() === before, true);
	check('wrong current: every session survives', sessionIds(), allSessions);
}
// An account whose login window lapsed gets the very same answer as a wrong password.
await reset({ anaExpiresAt: new Date(Date.now() - 60_000) });
check(
	'an expired account gets the same message, with the right password',
	await submit(ana, { current: OLD, next: NEW }),
	{ kind: 'fail', status: 400, error: WRONG_CURRENT_PASSWORD },
);
check('expired: the failure is recorded', throttle.failures, [[IP, EMAIL]]);

// ── Success ───────────────────────────────────────────────────────────────────
await reset();
check('the right current password changes it', await submit(ana, { current: OLD, next: NEW }), {
	kind: 'ok',
	message: 'Password changed. Other sessions were signed out.',
});
check('success clears the throttle for this IP and email', throttle.successes, [[IP, EMAIL]]);
check('success records no failure', throttle.failures.length, 0);
check('the new password verifies', await verifyPassword(NEW, anaHash()), true);
check('the old password no longer does', await verifyPassword(OLD, anaHash()), false);
check(
	"Ana's other sessions are signed out; this one and Bo's survive",
	sessionIds(),
	[sha256(CURRENT_TOKEN), sha256('bo-desktop')].sort(),
);
check(
	"Bo's password is untouched",
	await verifyPassword(
		'bo password 123',
		rowsOf(users).find((u) => u.id === 'u-bo')!.passwordHash as string,
	),
	true,
);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} change-password checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} change-password checks pass`);
