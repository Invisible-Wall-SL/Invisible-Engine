/**
 * Contract check for `POST /api/comfy/register`:
 *   pnpm --filter launcher-api check:comfy-register
 *
 * Any signed-in user could store any http(s) URL as their ComfyUI, and the atlas-tool then POSTs
 * render jobs to it from inside Railway's network — a request forger aimed at `*.railway.internal`,
 * loopback or the metadata address. Registering now needs the Atlas Maker or ComfyUI tool, and a
 * loopback / private / link-local / internal host is refused with a 400.
 *
 * Two halves, both over the REAL code:
 *  1. `checkComfyUrl` on its own: public tunnels in (stored in their WHATWG form), every private
 *     range and internal name out, including the numeric spellings of 127.0.0.1 and IPv4 hidden
 *     in IPv6; credentials and query strings refused; the range edges either side.
 *  2. the REAL handler: bearer (the desktop launcher) and cookie both authenticate; a role without
 *     either tool is a 403, a per-user grant opens it and a per-user revoke closes it; a refused
 *     URL is a 400 that writes nothing; GET/DELETE of your own record stay session-only.
 * Replaced: `auth.ts` (a fixed session table), the two override readers, and `r2.ts` (a recorder).
 */
import { mock } from 'node:test';

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;

type User = NonNullable<App.Locals['user']>;
const user = (id: string, role: User['role']): User => ({
	id,
	email: `${id}@test`,
	name: null,
	role,
});
/** session token → user. */
const SESSIONS = new Map<string, User>([
	['tok-artist', user('artist-1', 'artist')],
	['tok-tester', user('tester-1', 'pipelineTester')],
	['tok-animator', user('animator-1', 'animator')],
	['tok-animator-granted', user('animator-2', 'animator')],
	['tok-artist-revoked', user('artist-2', 'artist')],
]);
const USER_OVERRIDES = new Map<string, Record<string, boolean>>([
	['animator-2', { comfyui: true }],
	['artist-2', { atlasTool: false, comfyui: false }],
]);
mock.module(server('auth.ts'), {
	namedExports: {
		SESSION_COOKIE: 'session',
		validateSession: async (token: string | undefined) => (token && SESSIONS.get(token)) || null,
	},
});
mock.module(server('roleToolAccess.ts'), { namedExports: { getRoleOverrides: async () => ({}) } });
mock.module(server('userToolAccess.ts'), {
	namedExports: { getToolOverrides: async (id: string) => USER_OVERRIDES.get(id) ?? {} },
});
/** Every R2 write the handler reached: key → body. */
const writes: [string, string][] = [];
const deletes: string[] = [];
mock.module(server('r2.ts'), {
	namedExports: {
		putObjectText: async (key: string, body: string) => {
			writes.push([key, body]);
		},
		getObjectText: async () => null,
		deleteObject: async (key: string) => {
			deletes.push(key);
		},
	},
});

const { checkComfyUrl } = await import('../src/lib/server/comfyRegister.ts');
const route = await import('../src/routes/api/comfy/register/+server.ts');

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

// ── 1. The URL rule ────────────────────────────────────────────────────────────────────────────
const accepted: [string, string][] = [
	['https://quiet-river-1234.trycloudflare.com', 'https://quiet-river-1234.trycloudflare.com'],
	['https://comfy.invisiblewall.org/', 'https://comfy.invisiblewall.org'],
	['  https://Comfy-Alice.InvisibleWall.org//  ', 'https://comfy-alice.invisiblewall.org'],
	['http://comfy.example.com:8188', 'http://comfy.example.com:8188'],
	['https://comfy.example.com:443/', 'https://comfy.example.com'],
	['https://gpu.example.com/comfy/', 'https://gpu.example.com/comfy'],
	['http://8.8.8.8:8188', 'http://8.8.8.8:8188'],
	['http://[2606:4700::1111]:8188', 'http://[2606:4700::1111]:8188'],
	// Range edges, outside.
	['http://11.0.0.1', 'http://11.0.0.1'],
	['http://172.15.255.255', 'http://172.15.255.255'],
	['http://172.32.0.1', 'http://172.32.0.1'],
	['http://192.169.0.1', 'http://192.169.0.1'],
	['http://169.255.0.1', 'http://169.255.0.1'],
	['http://100.128.0.1', 'http://100.128.0.1'],
	['https://example.internal.com', 'https://example.internal.com'],
	['https://localhost.example.com', 'https://localhost.example.com'],
	// A backslash is a path separator to WHATWG; the STORED form says so, so the atlas-tool's
	// parser cannot read 127.0.0.1 as the host the way urllib3 would read the raw string.
	['http://a.example.com\\@127.0.0.1', 'http://a.example.com/@127.0.0.1'],
];
for (const [raw, url] of accepted) check(`accepted: ${raw}`, checkComfyUrl(raw), { ok: true, url });

const privateHosts = [
	'http://localhost:8188',
	'http://LOCALHOST.:8188',
	'http://comfy.localhost',
	'http://127.0.0.1:8188',
	'http://127.255.255.254',
	'http://127.1',
	'http://0x7f.1',
	'http://0177.0.0.1',
	'http://2130706433',
	'http://0.0.0.0:8188',
	'http://10.0.0.1',
	'http://10.255.255.255',
	'http://172.16.0.1',
	'http://172.31.255.255',
	'http://192.168.1.10',
	'http://169.254.169.254/latest/meta-data',
	'http://100.64.0.1',
	'http://[::1]:8188',
	'http://[::]',
	'http://[fe80::1]',
	'http://[febf::1]',
	'http://[fc00::1]',
	'http://[fd12:3456::1]',
	'http://[::ffff:127.0.0.1]',
	'http://[::ffff:10.0.0.1]',
	'http://[64:ff9b::a00:1]',
	'http://atlas-tool.railway.internal:8080',
	'http://postgres.internal',
	'http://ATLAS-TOOL.RAILWAY.INTERNAL.',
	'http://my-pc.local:8188',
	'http://atlas-tool:8080',
	'http://224.0.0.1',
];
for (const raw of privateHosts) {
	const res = checkComfyUrl(raw);
	check(`refused as private: ${raw}`, res.ok, false);
	if (!res.ok)
		check(`${raw}: the message says why`, /local or private network address/.test(res.error), true);
}

const INVALID = { ok: false, error: 'A valid http(s) ComfyUI url is required' };
for (const raw of ['', '   ', 'comfy.example.com', 'ftp://comfy.example.com', 'file:///etc/passwd'])
	check(`invalid: "${raw}"`, checkComfyUrl(raw), INVALID);
check('javascript: is invalid', checkComfyUrl('javascript:alert(1)'), INVALID);
check('an unparseable host is invalid', checkComfyUrl('http://exa mple.com'), INVALID);
check('credentials are refused', checkComfyUrl('https://user:pw@x.trycloudflare.com').ok, false);
check(
	'credentials hiding a private host are refused',
	checkComfyUrl('https://x.com@127.0.0.1').ok,
	false,
);
check('a query string is refused', checkComfyUrl('https://x.trycloudflare.com/?a=1').ok, false);
check('a fragment is refused', checkComfyUrl('https://x.trycloudflare.com/#a').ok, false);

// ── 2. The handler ─────────────────────────────────────────────────────────────────────────────
type Answer = { status: number; body: Record<string, unknown>; writes: number };
async function send(
	method: 'POST' | 'GET' | 'DELETE',
	auth: { bearer?: string; cookie?: string },
	body?: unknown,
): Promise<Answer> {
	writes.length = 0;
	deletes.length = 0;
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (auth.bearer) headers.authorization = `Bearer ${auth.bearer}`;
	const request = new Request('https://app.example/api/comfy/register', {
		method,
		headers,
		body: body === undefined ? undefined : JSON.stringify(body),
	});
	const event = {
		request,
		url: new URL(request.url),
		cookies: { get: (name: string) => (name === 'session' ? auth.cookie : undefined) },
		locals: {},
	};
	const res: Response = await route[method](event as never);
	return {
		status: res.status,
		body: (await res.json()) as Record<string, unknown>,
		writes: writes.length + deletes.length,
	};
}
const TUNNEL = 'https://quiet-river-1234.trycloudflare.com';

{
	const res = await send('POST', { bearer: 'tok-artist' }, { url: `${TUNNEL}/` });
	check('desktop (bearer) artist registers a tunnel', [res.status, res.body.url], [200, TUNNEL]);
	const [key, stored] = writes[0] ?? ['', '{}'];
	check('written under the user', key, '_users/artist_1/comfy.json');
	check('the stored url is the checked one', JSON.parse(stored).url, TUNNEL);
}
check(
	'portal (cookie) artist registers a tunnel',
	(await send('POST', { cookie: 'tok-artist' }, { url: TUNNEL })).status,
	200,
);
check(
	'a pipeline tester (Atlas Maker, no ComfyUI tool) registers',
	(await send('POST', { bearer: 'tok-tester' }, { url: TUNNEL })).status,
	200,
);
check(
	'a per-user ComfyUI grant opens it for an animator',
	(await send('POST', { bearer: 'tok-animator-granted' }, { url: TUNNEL })).status,
	200,
);

const refused = async (auth: { bearer?: string; cookie?: string }, url: unknown = TUNNEL) => {
	const res = await send('POST', auth, { url });
	return { status: res.status, writes: res.writes };
};
check('no session is a 401', await refused({}), { status: 401, writes: 0 });
check('an unknown token is a 401', await refused({ bearer: 'nope' }), { status: 401, writes: 0 });
check('an animator (neither tool) is a 403', await refused({ bearer: 'tok-animator' }), {
	status: 403,
	writes: 0,
});
check(
	'an artist with both tools revoked is a 403',
	await refused({ bearer: 'tok-artist-revoked' }),
	{ status: 403, writes: 0 },
);
check(
	'a 403 comes before the URL is looked at',
	await refused({ bearer: 'tok-animator' }, 'http://127.0.0.1'),
	{ status: 403, writes: 0 },
);
for (const url of [
	'http://127.0.0.1:8188',
	'http://atlas-tool.railway.internal:8080',
	'http://[::1]',
])
	check(`${url} is a 400, nothing written`, await refused({ bearer: 'tok-artist' }, url), {
		status: 400,
		writes: 0,
	});
{
	const res = await send('POST', { bearer: 'tok-artist' }, { url: 'http://169.254.169.254' });
	check(
		'the 400 names the host and the fix',
		/169\.254\.169\.254.*public tunnel address/.test(String(res.body.error)),
		true,
	);
}
check('a non-http url is a 400', await refused({ bearer: 'tok-artist' }, 'gopher://x.com'), {
	status: 400,
	writes: 0,
});

check(
	'GET of your own record needs only a session',
	(await send('GET', { bearer: 'tok-animator' })).body,
	{ registered: false },
);
{
	const res = await send('DELETE', { bearer: 'tok-animator' });
	check(
		'DELETE of your own record needs only a session',
		[res.status, deletes],
		[200, ['_users/animator_1/comfy.json']],
	);
}
check('GET without a session is a 401', (await send('GET', {})).status, 401);

console.log();
if (failures) {
	console.error(`${failures} of ${checks} comfy-register checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} comfy-register checks pass`);
