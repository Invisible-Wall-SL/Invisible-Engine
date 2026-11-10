/**
 * Contract check for the helpers the session-authed API routes share:
 *   pnpm --filter launcher-api check:http-helpers
 *
 * - `requireTool` / `requireToolGrants` / `userGrants` (`$lib/server/http.ts`): the one tool gate
 *   that eight per-tool modules and a dozen routes used to re-type — 401 with no session, 403
 *   naming the tool, any-of for a list, role then per-user overrides, and the user handed back.
 * - `readJson` / `jsonBody` / `jsonObjectOrNull` / `parseBody`: a body that is not JSON is a 400
 *   (or `null`), never a silent `{}`, and a schema refusal is a 400 carrying its own message.
 * - `conflictResponse` / `conflictJson` / `conflictFailure` (`conflict.ts`): a lost conditional
 *   write is a JSON 409 `{ ok: false, error: 'conflict', …, message }`; anything else is not
 *   answered here.
 * - `clientKeyOf` / `projectParam` (`projectLookup.ts`): a project's client or `unassigned`, and
 *   `?project=` or the default project.
 * - `requireAdminPanel` (`admin.ts`): the `/admin` gate, redirecting a page and answering an API
 *   401, and 403 without the `adminPanel` capability.
 *
 * Runs the REAL modules; only the Postgres boundary is replaced: the two override tables, the
 * project table (`projectClientKey`) and the database handle.
 */
import { mock } from 'node:test';
import { isActionFailure, isHttpError, isRedirect } from '@sveltejs/kit';
import { z } from 'zod';

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;

/** role → its role overrides; userId → that user's overrides. */
const ROLE_OVERRIDES = new Map<string, Record<string, boolean>>([
	['animator', { fx: false, rigger: false, spineViewer: false }],
	['developer', { adminPanel: true }],
]);
const USER_OVERRIDES = new Map<string, Record<string, boolean>>([['u-granted', { fx: true }]]);
const reads: string[] = [];
mock.module(server('roleToolAccess.ts'), {
	namedExports: {
		getRoleOverrides: async (role: string) => {
			reads.push(`role:${role}`);
			return ROLE_OVERRIDES.get(role) ?? {};
		},
	},
});
mock.module(server('userToolAccess.ts'), {
	namedExports: {
		getToolOverrides: async (userId: string) => {
			reads.push(`user:${userId}`);
			return USER_OVERRIDES.get(userId) ?? {};
		},
	},
});
const PROJECTS = new Map<string, string | null>([
	['bookofborut', 'borut'],
	['sandbox', null],
]);
mock.module(server('projects.ts'), {
	namedExports: {
		DEFAULT_PROJECT_KEY: 'cloud',
		projectClientKey: async (key: string) => PROJECTS.get(key) ?? null,
	},
});
mock.module(server('db/index.ts'), {
	namedExports: {
		getDb: () => {
			throw new Error('no database in this check');
		},
	},
});

const http = await import('../src/lib/server/http.ts');
const conflict = await import('../src/lib/server/conflict.ts');
const { clientKeyOf, projectParam } = await import('../src/lib/server/projectLookup.ts');
const { requireAdminPanel } = await import('../src/lib/server/admin.ts');
const { ConflictError } = await import('../src/lib/server/r2.ts');

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
const user = (id: string, role: User['role']): User =>
	({ id, role, email: `${id}@test`, name: null }) as User;
const locals = (u: User | null): App.Locals => ({ user: u }) as App.Locals;

/** What a call ends in: `ok` + its value, or the status (and message / location) it threw. */
async function outcome(fn: () => Promise<unknown>): Promise<unknown> {
	try {
		return { ok: await fn() };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, message: e.body.message };
		if (isRedirect(e)) return { redirect: e.status, location: e.location };
		throw e;
	}
}

// ── requireTool ──────────────────────────────────────────────────────────────
{
	check(
		'requireTool: no session is a 401',
		await outcome(() => http.requireTool(locals(null), 'sound', 'Invisible Sound')),
		{ status: 401, message: 'Not authenticated' },
	);
	reads.length = 0;
	await outcome(() => http.requireTool(locals(null), 'sound', 'Invisible Sound'));
	check('…and reads no grants', reads, []);

	const dev = user('u-dev', 'developer');
	check(
		'requireTool: a held tool hands back the user',
		await outcome(() => http.requireTool(locals(dev), 'editor', 'Invisible Editor')),
		{ ok: dev },
	);
	reads.length = 0;
	await http.requireTool(locals(dev), 'editor', 'Invisible Editor');
	check('…reading the role and the user overrides once each', reads.sort(), [
		'role:developer',
		'user:u-dev',
	]);

	const animator = user('u-anim', 'animator');
	check(
		'requireTool: a tool the role lacks is a 403 naming it',
		await outcome(() =>
			http.requireTool(locals(animator), ['spineViewer', 'rigger', 'fx'], 'the Rig Viewer'),
		),
		{ status: 403, message: 'Your role does not have access to the Rig Viewer.' },
	);
	check(
		'requireTool: a per-user grant beats the role revoke',
		await outcome(() =>
			http.requireTool(
				locals(user('u-granted', 'animator')),
				['spineViewer', 'rigger', 'fx'],
				'the Rig Viewer',
			),
		).then((r) => (r as { ok?: User }).ok?.id),
		'u-granted',
	);
	check(
		'requireTool: a list admits any one of its tools',
		(await outcome(() =>
			http.requireTool(locals(dev), ['pipelineChanges', 'editor'], 'either'),
		)) as unknown,
		{ ok: dev },
	);
	check(
		'requireTool: an empty list admits nobody',
		await outcome(() => http.requireTool(locals(dev), [], 'nothing')),
		{ status: 403, message: 'Your role does not have access to nothing.' },
	);

	const { grants } = await http.requireToolGrants(locals(dev), 'editor', 'Invisible Editor');
	check(
		'requireToolGrants: hands back the grants it read (role override capability)',
		[grants.hasCapability('adminPanel'), grants.hasTool('editor')],
		[true, true],
	);
	const animGrants = await http.userGrants(animator);
	check('userGrants: the role revoke applies', animGrants.hasTool('fx'), false);
}

// ── JSON bodies ──────────────────────────────────────────────────────────────
{
	const req = (body: string): Request =>
		new Request('http://x/', {
			method: 'POST',
			body,
			headers: { 'content-type': 'application/json' },
		});
	check(
		'readJson: not JSON is a 400 with the default message',
		await outcome(() => http.readJson(req('{nope'))),
		{ status: 400, message: 'Expected a JSON body.' },
	);
	check(
		"readJson: …or the route's own",
		await outcome(() => http.readJson(req(''), 'Invalid JSON body.')),
		{ status: 400, message: 'Invalid JSON body.' },
	);
	check('readJson: any JSON value is returned as is', await http.readJson(req('[1,2]')), [1, 2]);

	check('jsonBody: an array is a 400', await outcome(() => http.jsonBody(req('[]'))), {
		status: 400,
		message: 'Expected a JSON object.',
	});
	check('jsonBody: an object comes back', await http.jsonBody(req('{"a":1}')), { a: 1 });

	check(
		'jsonObjectOrNull: not JSON, null, an array and a number are all null',
		[
			await http.jsonObjectOrNull(req('{nope')),
			await http.jsonObjectOrNull(req('null')),
			await http.jsonObjectOrNull(req('[]')),
			await http.jsonObjectOrNull(req('5')),
		],
		[null, null, null, null],
	);
	check('jsonObjectOrNull: an object comes back', await http.jsonObjectOrNull(req('{"a":1}')), {
		a: 1,
	});
	check(
		'objectOrNull: only a plain object passes',
		[http.objectOrNull({ a: 1 }), http.objectOrNull('s'), http.objectOrNull(null)],
		[{ a: 1 }, null, null],
	);

	const Pod = z.object(
		{ podId: z.string({ message: 'Missing podId.' }).trim().min(1, 'Missing podId.') },
		{ message: 'Expected a JSON object.' },
	);
	check(
		'parseBody: bad JSON is a 400, never a silent {}',
		await outcome(() => http.parseBody(req('not json'), Pod)),
		{ status: 400, message: 'Expected a JSON body.' },
	);
	check(
		"parseBody: a schema refusal is a 400 with the field's message",
		await outcome(() => http.parseBody(req('{"podId":"  "}'), Pod)),
		{ status: 400, message: 'Missing podId.' },
	);
	check(
		'parseBody: a non-object is refused with the object message',
		await outcome(() => http.parseBody(req('[]'), Pod)),
		{ status: 400, message: 'Expected a JSON object.' },
	);
	check(
		'parseBody: a valid body comes back parsed (trimmed, unknown keys dropped)',
		await http.parseBody(req('{"podId":" p1 ","extra":true}'), Pod),
		{ podId: 'p1' },
	);
}

// ── 409 conflict ─────────────────────────────────────────────────────────────
{
	const read = async (r: Response | null) =>
		r && {
			status: r.status,
			type: r.headers.get('content-type'),
			cache: r.headers.get('cache-control'),
			body: await r.text(),
		};
	check(
		'conflictResponse: anything but a ConflictError is not answered',
		[conflict.conflictResponse(new Error('boom'), 'm'), conflict.conflictResponse('x', 'm')],
		[null, null],
	);
	check(
		'conflictResponse: a ConflictError is the JSON 409 envelope',
		await read(conflict.conflictResponse(new ConflictError('k'), 'Someone else saved this.')),
		{
			status: 409,
			type: 'application/json',
			cache: null,
			body: '{"ok":false,"error":"conflict","message":"Someone else saved this."}',
		},
	);
	check(
		'conflictJson: code, extra fields (before the message), headers, no ok flag',
		await read(
			conflict.conflictJson('Taken.', {
				code: 'exists',
				extra: { id: 'a', etag: null },
				headers: { 'cache-control': 'no-store' },
				okFlag: false,
			}),
		),
		{
			status: 409,
			type: 'application/json',
			cache: 'no-store',
			body: '{"error":"exists","id":"a","etag":null,"message":"Taken."}',
		},
	);
	const failed = conflict.conflictFailure(new ConflictError('k'), 'Reload.', { action: 'save' });
	check(
		'conflictFailure: a fail(409) carrying the fields, the reason and the conflict flag',
		[isActionFailure(failed), failed?.status, failed?.data],
		[true, 409, { action: 'save', error: 'Reload.', conflict: true }],
	);
	check(
		'conflictFailure: anything else is not answered',
		conflict.conflictFailure(new Error('x'), 'm'),
		null,
	);
}

// ── project lookup ───────────────────────────────────────────────────────────
{
	check(
		"clientKeyOf: a project's client, unassigned for none and for an unknown key",
		[
			await clientKeyOf('bookofborut'),
			await clientKeyOf('sandbox'),
			await clientKeyOf('no-such-project'),
		],
		['borut', 'unassigned', 'unassigned'],
	);
	const url = (q: string) => new URL(`http://x/api${q}`);
	check(
		'projectParam: the named key, or the default when absent or empty',
		[
			projectParam(url('?project=hotfruits')),
			projectParam(url('')),
			projectParam(url('?project=')),
		],
		['hotfruits', 'cloud', 'cloud'],
	);
}

// ── admin gate ───────────────────────────────────────────────────────────────
{
	check(
		'requireAdminPanel: a page without a session redirects to /login',
		await outcome(() => requireAdminPanel(locals(null), 'page')),
		{ redirect: 303, location: '/login' },
	);
	check(
		'requireAdminPanel: an API without a session is a 401',
		await outcome(() => requireAdminPanel(locals(null), 'api')),
		{ status: 401, message: 'Not authenticated' },
	);
	check(
		'requireAdminPanel: without adminPanel it is a 403 (default and custom message)',
		[
			await outcome(() => requireAdminPanel(locals(user('u-art', 'artist')), 'api')),
			await outcome(() => requireAdminPanel(locals(user('u-art', 'artist')), 'page', 'No.')),
		],
		[
			{ status: 403, message: 'Admins only.' },
			{ status: 403, message: 'No.' },
		],
	);
	const delegate = user('u-dev', 'developer');
	check(
		'requireAdminPanel: a role granted adminPanel passes and gets the user back',
		await outcome(() => requireAdminPanel(locals(delegate), 'api')),
		{ ok: delegate },
	);
	check(
		'requireAdminPanel: the admin role passes',
		(await outcome(() => requireAdminPanel(locals(user('u-admin', 'admin')), 'page'))) as {
			ok?: User;
		},
		{ ok: user('u-admin', 'admin') },
	);
	check(
		'requireAdminPanel: a per-user grant does not open the panel (role overrides only)',
		await outcome(() => {
			USER_OVERRIDES.set('u-art2', { adminPanel: true });
			return requireAdminPanel(locals(user('u-art2', 'artist')), 'api');
		}),
		{ status: 403, message: 'Admins only.' },
	);
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} http-helper checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} http-helper checks pass`);
