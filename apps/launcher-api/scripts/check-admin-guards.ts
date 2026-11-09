/**
 * Contract check for the `/admin` owner-only actions and the admin audit log:
 *   pnpm --filter launcher-api check:admin-guards
 *
 * Posts forms to the REAL `/admin` actions table (`routes/(app)/admin/+page.server.ts`, wrapped by
 * `withAdminGuards`). Two boundaries are replaced: the database, by a stand-in that records every
 * query (`lib/recordingDb.ts`), and the role-override store, so a `developer` holds the delegable
 * `adminPanel` capability — a delegated admin.
 *
 * Why: `adminPanel` can be granted to any role, and the panel used to let such a delegate reveal or
 * rotate the deploy token (owner-only at `PUT /api/launcher/deploy-token`), reset any non-admin's
 * password, grant its own role every capability, and purge projects. Pinned here:
 *  - a delegate is refused each owner-only action with a 403, BEFORE the action touches anything;
 *  - a delegate keeps what stays delegable (its own password, a user's tools), and the owner keeps
 *    everything — the controls that show the refusals are the guard's, not a harness that refuses all;
 *  - every mutating action, refused or not, writes one `admin_audit` row naming the actor, action
 *    and target, and no row carries a password or a deploy token;
 *  - reads leave no row, a thrown refusal is logged and still thrown, and a table that lacks an
 *    owner-only action fails at load instead of leaving it delegable.
 */
import { mock } from 'node:test';
import { isActionFailure, isHttpError } from '@sveltejs/kit';
import { argsOf, recordingDb } from './lib/recordingDb.ts';

const DOC_SECRET = 'env-bootstrap-deploy-token-0123456789abcdef';
process.env.EDITOR_DOC_SECRET = DOC_SECRET;

const { db, log } = recordingDb();
const roleWrites: string[] = [];

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('db/index.ts'), { namedExports: { getDb: () => db } });
mock.module(server('roleToolAccess.ts'), {
	namedExports: {
		getRoleOverrides: async (role: string) => (role === 'developer' ? { adminPanel: true } : {}),
		getAllRoleOverrides: async () => ({}),
		setRoleOverride: async (role: string, key: string, granted: boolean) => {
			roleWrites.push(`${role}:${key}=${granted}`);
		},
		clearRoleOverride: async (role: string, key: string) => {
			roleWrites.push(`${role}:${key}=default`);
		},
	},
});

const { actions } = await import('../src/routes/(app)/admin/+page.server.ts');
const { withAdminGuards } = await import('../src/lib/server/adminActions.ts');
const { OWNER_ONLY_ADMIN_ACTIONS } = await import('../src/lib/accessRules.ts');

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

const OWNER = { id: 'u-owner', email: 'owner@invisiblewall.org', name: 'Owner', role: 'admin' };
const DELEGATE = { id: 'u-dele', email: 'dele@invisiblewall.org', name: 'Dele', role: 'developer' };
const ARTIST = { id: 'u-art', email: 'art@invisiblewall.org', name: 'Art', role: 'artist' };
type Caller = typeof OWNER;

type Outcome =
	| { kind: 'ok'; data: Record<string, unknown> }
	| { kind: 'fail'; status: number; error: unknown }
	| { kind: 'threw'; status: number | null };

type Event = Parameters<(typeof actions)[string]>[0];

/** Post `fields` to `?/<action>` as `caller`; the log then holds only what this request did. */
async function post(
	action: string,
	caller: Caller,
	fields: Record<string, string> = {},
): Promise<Outcome> {
	log.length = 0;
	roleWrites.length = 0;
	const body = new FormData();
	for (const [k, v] of Object.entries(fields)) body.set(k, v);
	const event = {
		request: new Request(`http://launcher.test/admin?/${action}`, { method: 'POST', body }),
		locals: { user: caller },
		cookies: { get: () => 'raw-session-token', set: () => {} },
		url: new URL(`http://launcher.test/admin?/${action}`),
		getClientAddress: () => '203.0.113.5',
	} as unknown as Event;
	try {
		const result = await actions[action](event);
		if (isActionFailure(result)) {
			return {
				kind: 'fail',
				status: result.status,
				error: (result.data as { error?: unknown }).error,
			};
		}
		return { kind: 'ok', data: (result ?? {}) as Record<string, unknown> };
	} catch (e) {
		return { kind: 'threw', status: isHttpError(e) ? e.status : null };
	}
}

interface AuditRow {
	actorId: string;
	action: string;
	target: string | null;
	details: { fields: Record<string, unknown>; outcome: string; status?: number };
}
const auditRows = (): AuditRow[] =>
	log
		.filter((c) => c.op === 'insert' && c.table === 'admin_audit')
		.map((c) => argsOf(c, 'values')?.[0] as AuditRow);
const otherQueries = (): string[] =>
	log.filter((c) => c.table !== 'admin_audit').map((c) => `${c.op} ${c.table}`);

const TOKEN = 'typed-deploy-token-ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PASSWORD = 'a brand new passphrase';

// ── A delegated admin is refused every owner-only action, before it runs ──────
const REFUSED: [action: string, fields: Record<string, string>][] = [
	['revealDeployToken', {}],
	['setDeployToken', { token: TOKEN }],
	['rotateDeployToken', {}],
	['resetPassword', { userId: 'u-other', password: PASSWORD }],
	['setRoleToolAccess', { role: 'developer', toolKey: 'gamePublish', mode: 'grant' }],
	['setToolAccess', { userId: DELEGATE.id, toolKey: 'pipelineBugFix', mode: 'grant' }],
	['purgeProject', { key: 'acme', confirmKey: 'acme' }],
];
check(
	'every owner-only action is exercised here',
	[...new Set(REFUSED.map(([a]) => a))].sort(),
	[...OWNER_ONLY_ADMIN_ACTIONS].sort(),
);
for (const [action, fields] of REFUSED) {
	const outcome = await post(action, DELEGATE, fields);
	check(`delegate ?/${action} is a 403`, outcome.kind === 'fail' && outcome.status, 403);
	check(`delegate ?/${action} touches nothing`, [otherQueries(), roleWrites], [[], []]);
	const rows = auditRows();
	check(
		`delegate ?/${action} is logged as refused`,
		rows.map((r) => [r.actorId, r.action, r.details.outcome, r.details.status]),
		[[DELEGATE.id, action, 'refused', 403]],
	);
	check(
		`…and the log keeps no secret`,
		JSON.stringify(rows).includes(TOKEN) || JSON.stringify(rows).includes(PASSWORD),
		false,
	);
}

// ── What stays delegable still works for the delegate ─────────────────────────
{
	const own = await post('resetPassword', DELEGATE, { userId: DELEGATE.id, password: PASSWORD });
	check('delegate may still reset their OWN password', own.kind, 'ok');
	check('…which writes it', otherQueries().includes('update users'), true);

	const tool = await post('setToolAccess', DELEGATE, {
		userId: ARTIST.id,
		toolKey: 'storybook',
		mode: 'grant',
	});
	check("delegate may still set a user's tools", tool.kind, 'ok');
	check(
		'…and that write is logged with its target',
		auditRows().map((r) => [r.action, r.target, r.details.outcome]),
		[['setToolAccess', `userId=${ARTIST.id}`, 'ok']],
	);
}

// ── The owner keeps every owner-only action ───────────────────────────────────
{
	const reveal = await post('revealDeployToken', OWNER);
	check(
		'owner may reveal the deploy token',
		reveal.kind === 'ok' && reveal.data.deployToken,
		DOC_SECRET,
	);
	check(
		'the reveal is logged without the token',
		[auditRows().length, JSON.stringify(auditRows()).includes(DOC_SECRET)],
		[1, false],
	);

	const set = await post('setDeployToken', OWNER, { token: TOKEN });
	check('owner may set the deploy token', set.kind, 'ok');
	check(
		'the typed token is redacted in the log',
		auditRows().map((r) => r.details.fields.token),
		['[redacted]'],
	);
	check('and appears nowhere in it', JSON.stringify(auditRows()).includes(TOKEN), false);

	const reset = await post('resetPassword', OWNER, { userId: 'u-other', password: PASSWORD });
	check("owner may reset another user's password", reset.kind, 'ok');
	check(
		'the password is redacted in the log',
		auditRows().map((r) => [r.target, r.details.fields.password]),
		[['userId=u-other', '[redacted]']],
	);

	const grant = await post('setRoleToolAccess', OWNER, {
		role: 'developer',
		toolKey: 'gamePublish',
		mode: 'grant',
	});
	check(
		"owner may change a role's grants",
		[grant.kind, roleWrites],
		['ok', ['developer:gamePublish=true']],
	);

	// No such deleted project in the empty store: refused by the action itself, not the guard.
	const purge = await post('purgeProject', OWNER, { key: 'acme', confirmKey: 'acme' });
	check('owner reaches the purge action', purge.kind === 'fail' && purge.status, 400);
	check(
		'…and a refusal from the action is logged with its status',
		auditRows().map((r) => [r.action, r.target, r.details.outcome, r.details.status]),
		[['purgeProject', 'key=acme', 'refused', 400]],
	);
}

// ── The rest of the log's rules ───────────────────────────────────────────────
{
	await post('loadSessions', OWNER, { userId: ARTIST.id });
	check('a read leaves no audit row', auditRows().length, 0);

	const threw = await post('setActive', ARTIST, { userId: DELEGATE.id, active: 'false' });
	check('a caller without adminPanel is still refused by the action', threw, {
		kind: 'threw',
		status: 403,
	});
	check(
		'…and the attempt is logged',
		auditRows().map((r) => [r.actorId, r.action, r.details.outcome, r.details.status]),
		[[ARTIST.id, 'setActive', 'error', 403]],
	);
}
{
	let thrown = '';
	try {
		withAdminGuards({ revealDeployToken: async () => ({}) });
	} catch (e) {
		thrown = e instanceof Error ? e.message : String(e);
	}
	check(
		'a table missing an owner-only action fails at load, naming it',
		thrown.includes('"setDeployToken"'),
		true,
	);
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} admin-guard checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} admin-guard checks pass`);
