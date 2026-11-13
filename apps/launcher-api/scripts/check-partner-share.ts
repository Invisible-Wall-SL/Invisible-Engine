/**
 * Gate for no-login PARTNER SHARE LINKS (`$lib/partnerShare`, `$lib/server/partnerShare`, the public
 * `/play/<token>` route and `/api/game-maker/partner-share`), over the real modules:
 *   pnpm --filter launcher-api check:partner-share
 *
 * The share-link table is a small in-memory stand-in behind `lib/recordingDb.ts`; the partner's
 * admin endpoint is a fake `fetch`. Pins:
 *  1. Making a link: a 256-bit base64url token, shown once; only its SHA-256 is stored; 7 days by
 *     default; only 1 / 7 / 30.
 *  2. Opening: GET mints nothing (a chat preview spends nothing); every POST mints a FRESH session
 *     through the same path as `/api/partner-session` (stored game id, `rgs_profile` + `sid`, our
 *     `rgs_url`/`sessionID` dropped) and 303s to the published card; nothing the holder adds to the
 *     URL reaches the launch; the admin user / password / admin URL appear in no redirect, page or
 *     log line, and the link token in no log line.
 *  3. Expiry, revoke, unknown and malformed tokens: plain pages, no mint.
 *  4. Rate limit: SHARE_OPENS_PER_MINUTE opens a minute, then 429 + Retry-After and no mint; one
 *     conditional UPDATE spends an open (no read before it), its window test in the SQL itself.
 *  5. A project with no partner launch: no link can be made, and an existing one refuses to open.
 *  6. Who may make links (401 / 403 / 409), and the card's gating.
 *  7. `/api/partner-session` still answers as before over the shared mint path.
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { isRedirect } from '@sveltejs/kit';
import { argsOf, recordingDb, renderSql, type DbCall } from './lib/recordingDb.ts';

const ADMIN_USER = 'admin-user-x9';
const ADMIN_PASS = 's3cret-pass-y7';
const ADMIN_BASE = 'https://gs.partner.test';
process.env.PARTNER_RGS = JSON.stringify({
	'2complex': {
		baseUrl: ADMIN_BASE,
		adminPath: '/webnode/api/admin.js',
		user: ADMIN_USER,
		pass: ADMIN_PASS,
		gameId: '2',
		players: ['player1', 'player2', 'player3'],
	},
});

const CARD_URL =
	'https://games.example.test/play/?runtime=1&project=getting-hot&k=READTOKEN&rgs_url=https%3A%2F%2Frgs.example.test&sessionID=ours';

interface ShareRow {
	id: string;
	tokenHash: string;
	projectKey: string;
	createdBy: string | null;
	createdAt: Date;
	expiresAt: Date;
	revokedAt: Date | null;
	revokedBy: string | null;
	lastOpenedAt: Date | null;
	openCount: number;
	windowStartedAt: Date | null;
	windowOpens: number;
}
const rows: ShareRow[] = [];
const WINDOW_MS = 60_000;

const paramsOf = (call: DbCall): unknown[] => {
	const where = argsOf(call, 'where')?.[0];
	return where ? renderSql(where).params : [];
};
const byHash = (call: DbCall) => rows.filter((r) => paramsOf(call).includes(r.tokenHash));

const { db, log } = recordingDb((call: DbCall) => {
	if (call.table !== 'partner_share_links') return [];
	if (call.op === 'insert') {
		const v = argsOf(call, 'values')?.[0] as Partial<ShareRow>;
		rows.push({
			revokedAt: null,
			revokedBy: null,
			lastOpenedAt: null,
			openCount: 0,
			windowStartedAt: null,
			windowOpens: 0,
			createdBy: null,
			...v,
		} as ShareRow);
		return [];
	}
	if (call.op === 'select') {
		if (argsOf(call, 'leftJoin')) {
			const now = Date.now();
			return rows
				.filter((r) => paramsOf(call).includes(r.projectKey))
				.filter((r) => !r.revokedAt && r.expiresAt.getTime() > now)
				.map((r) => ({ ...r, name: r.createdBy === 'u-owner' ? 'Owner' : null, email: null }));
		}
		return byHash(call);
	}
	if (call.op === 'update') {
		const set = argsOf(call, 'set')?.[0] as Record<string, unknown>;
		const params = paramsOf(call);
		if ('openCount' in set) {
			const now = Date.now();
			return byHash(call).flatMap((r) => {
				const live = !r.revokedAt && r.expiresAt.getTime() > now;
				const over = !r.windowStartedAt || r.windowStartedAt.getTime() <= now - WINDOW_MS;
				if (!live || !(over || r.windowOpens < 5)) return [];
				r.windowOpens = over ? 1 : r.windowOpens + 1;
				if (over) r.windowStartedAt = new Date(now);
				r.lastOpenedAt = new Date(now);
				r.openCount++;
				return [{ id: r.id, projectKey: r.projectKey }];
			});
		}
		return rows
			.filter((r) => params.includes(r.id) && params.includes(r.projectKey) && !r.revokedAt)
			.map((r) => {
				r.revokedAt = set.revokedAt as Date;
				r.revokedBy = set.revokedBy as string;
				return { id: r.id };
			});
	}
	return [];
});

/** Project key → stored partner launch; absent = none. */
const partnerLaunches = new Map<string, unknown>([
	['getting-hot', { gameId: '8', profile: '2complex' }],
	['no-partner', null],
]);
const games = new Map<string, Record<string, unknown>>(
	['getting-hot', 'no-partner'].map((key) => [
		key,
		{ key, name: 'Getting Hot', url: CARD_URL, projectKey: key, version: '', debug: false },
	]),
);

const src = (path: string): string => new URL(`../src/${path}`, import.meta.url).href;
mock.module(src('lib/server/db/index.ts'), { namedExports: { getDb: () => db } });
mock.module(src('lib/server/games.ts'), {
	namedExports: { getGame: async (key: string) => games.get(key) },
});
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		canAccessProject: async (userId: string) => userId !== 'u-outsider',
		getPartnerLaunch: async (key: string) => partnerLaunches.get(key) ?? null,
		projectIsDeleted: async () => false,
	},
});
mock.module(src('lib/server/projectLookup.ts'), {
	namedExports: { clientKeyOf: async () => 'client' },
});
mock.module(src('lib/server/gameConfigStorage.ts'), {
	namedExports: { loadGameConfigDoc: async () => null },
});
mock.module(src('lib/server/partnerDelivery.ts'), {
	namedExports: {
		assertAlias: () => {},
		assertVersionPath: () => {},
		listSealedVersions: async () => [],
	},
});
mock.module(src('lib/server/launcherAuth.ts'), {
	namedExports: { userHasCapability: async (user: { id: string }) => user.id !== 'u-viewer' },
});

/** Every mint the partner's admin endpoint received, as the query it was sent. */
const mints: URLSearchParams[] = [];
globalThis.fetch = (async (input: string | URL) => {
	const url = new URL(String(input));
	mints.push(url.searchParams);
	return new Response(
		JSON.stringify({ status: 200, response: { token: `ptok-${mints.length}`, gameName: 'GH' } }),
		{ headers: { 'content-type': 'application/json' } },
	);
}) as typeof fetch;

const logged: string[] = [];
for (const level of ['info', 'log', 'warn', 'error'] as const) {
	const original = console[level].bind(console);
	console[level] = (...args: unknown[]) => {
		logged.push(args.map(String).join(' '));
		if (level === 'error') original(...args);
	};
}

const { shareLinkButton, parseShareExpiryDays, SHARE_OPENS_PER_MINUTE, SHARE_TOKEN_RE } =
	await import('../src/lib/partnerShare.ts');
const { partnerButtons } = await import('../src/lib/partnerLaunch.ts');
const play = await import('../src/routes/play/[token]/+server.ts');
const api = await import('../src/routes/api/game-maker/partner-share/+server.ts');
const session = await import('../src/routes/api/partner-session/+server.ts');

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

const ORIGIN = 'https://app.example.test';
const owner = { id: 'u-owner', email: 'owner@example.test', name: 'Owner', role: 'admin' };
type Handler = (event: never) => Promise<Response>;
const call = async (
	handler: unknown,
	options: { path: string; method?: string; user?: unknown; body?: unknown; params?: object },
): Promise<Response> => {
	const url = new URL(options.path, ORIGIN);
	const request = new Request(url, {
		method: options.method ?? 'GET',
		...(options.body !== undefined
			? { body: JSON.stringify(options.body), headers: { 'content-type': 'application/json' } }
			: {}),
	});
	try {
		return await (handler as Handler)({
			url,
			request,
			params: options.params ?? {},
			locals: { user: options.user ?? null },
		} as never);
	} catch (thrown) {
		if (isRedirect(thrown)) {
			return new Response(null, { status: thrown.status, headers: { location: thrown.location } });
		}
		throw thrown;
	}
};
const make = async (project: string, days?: unknown, user: unknown = owner) => {
	const res = await call(api.POST, {
		path: '/api/game-maker/partner-share',
		method: 'POST',
		user,
		body: { project, ...(days !== undefined ? { days } : {}) },
	});
	return { res, out: (await res.json()) as Record<string, unknown> };
};
const tokenOf = (url: unknown) => String(url).split('/play/')[1];
const open = (token: string, method: 'GET' | 'POST' = 'POST', query = '') =>
	call(method === 'POST' ? play.POST : play.GET, {
		path: `/play/${token}${query}`,
		method,
		params: { token },
	});
const secretFree = (text: string) =>
	![ADMIN_USER, ADMIN_PASS, ADMIN_BASE, 'admin.js', 'passw'].some((s) => text.includes(s));

// 1. Making a link.
{
	const before = Date.now();
	const { res, out } = await make('getting-hot');
	const token = tokenOf(out.url);
	check('make: 200', res.status, 200);
	check('make: url is origin + /play/<token>', String(out.url).startsWith(`${ORIGIN}/play/`), true);
	check('make: token is 43-char base64url (256 bits)', SHARE_TOKEN_RE.test(token), true);
	const row = rows.at(-1)!;
	check(
		'make: only the SHA-256 is stored',
		row.tokenHash,
		createHash('sha256').update(token).digest('hex'),
	);
	check('make: the token itself is in no stored field', JSON.stringify(row).includes(token), false);
	const days = Math.round((row.expiresAt.getTime() - before) / 86_400_000);
	check('make: 7 days by default', days, 7);
	check('make: the list shows it, with its maker', (out.links as { createdBy: string }[])[0]?.createdBy, 'Owner'); // prettier-ignore
	check('make: the list carries no token', JSON.stringify(out.links).includes(token), false);
	check('make: 30 days on request', (await make('getting-hot', 30)).res.status, 200);
	check(
		'make: 30-day row',
		Math.round((rows.at(-1)!.expiresAt.getTime() - Date.now()) / 86_400_000),
		30,
	);
	check('make: 2 days refused', (await make('getting-hot', 2)).res.status, 400);
	check('parse: "7" → 7, 1 → 1, 0 → null', [parseShareExpiryDays('7'), parseShareExpiryDays(1), parseShareExpiryDays(0)], [7, 1, null]); // prettier-ignore
	check('make: two links get different tokens', tokenOf((await make('getting-hot')).out.url) !== token, true); // prettier-ignore
}

// 2. Opening.
const { out: made } = await make('getting-hot', 1);
const token = tokenOf(made.url);
const linkId = rows.at(-1)!.id;
{
	mints.length = 0;
	const page = await open(token, 'GET');
	const html = await page.text();
	check('GET: 200 page', page.status, 200);
	check('GET: the page POSTs itself', /<form method="post"/.test(html), true);
	check('GET: mints nothing', mints.length, 0);
	check('GET: spends no open', rows.find((r) => r.id === linkId)?.openCount, 0);

	const first = await open(token, 'POST', '?player=evil&game=99&profile=other&on=partner');
	const second = await open(token);
	const a = new URL(first.headers.get('location') ?? '');
	const b = new URL(second.headers.get('location') ?? '');
	check('POST: 303', [first.status, second.status], [303, 303]);
	check('POST: every open mints', mints.length, 2);
	check('POST: a fresh session each open', [a.searchParams.get('sid'), b.searchParams.get('sid')], ['ptok-1', 'ptok-2']); // prettier-ignore
	check('POST: to the published card', `${a.origin}${a.pathname}`, 'https://games.example.test/play/'); // prettier-ignore
	check('POST: rgs_profile set, our RGS dropped', [a.searchParams.get('rgs_profile'), a.searchParams.has('rgs_url'), a.searchParams.has('sessionID')], ['2complex', false, false]); // prettier-ignore
	check('POST: runtime, project and k carried over', [a.searchParams.get('runtime'), a.searchParams.get('project'), a.searchParams.get('k')], ['1', 'getting-hot', 'READTOKEN']); // prettier-ignore
	check('POST: the stored game id, not the query', mints[0].get('game_id'), '8');
	check('POST: no holder-chosen player', mints[0].get('remote_id') === 'evil', false);
	check('POST: plays a pool player', ['player1', 'player2', 'player3'].includes(mints[0].get('remote_id') ?? ''), true); // prettier-ignore
	check(
		'POST: the same link keeps its player',
		mints[1].get('remote_id'),
		mints[0].get('remote_id'),
	);
	check('POST: no on=partner from the holder', mints[0].has('config.versionPath'), false);
	check('POST: no credential in the redirect', [a.href, b.href].every(secretFree), true);
	const row = rows.find((r) => r.id === linkId)!;
	check(
		'POST: last opened + count recorded',
		[row.openCount, row.lastOpenedAt !== null],
		[2, true],
	);
}

// 4. Rate limit (the 2 opens above are in this minute's window).
{
	mints.length = 0;
	const statuses: number[] = [];
	for (let i = 0; i < SHARE_OPENS_PER_MINUTE; i++) statuses.push((await open(token)).status);
	check('rate: opens past the budget refused', statuses, [303, 303, 303, 429, 429]);
	const busy = await open(token);
	check('rate: 429', busy.status, 429);
	const retry = Number(busy.headers.get('retry-after'));
	check('rate: Retry-After within the minute', retry >= 1 && retry <= 60, true);
	check('rate: a refused open mints nothing', mints.length, 3);
	rows.find((r) => r.id === linkId)!.windowStartedAt = new Date(Date.now() - WINDOW_MS - 1);
	check('rate: a new minute opens again', (await open(token)).status, 303);

	const before = log.length;
	await open(token);
	const spent = log.slice(before).filter((c) => c.table === 'partner_share_links');
	check(
		'rate: an open is ONE update, no read first',
		spent.map((c) => c.op),
		['update'],
	);
	const where = renderSql(argsOf(spent[0], 'where')?.[0]);
	check(
		'rate: live + window test is in the statement',
		[
			/"revoked_at" is null/.test(where.sql),
			/"expires_at" > /.test(where.sql),
			/"window_opens" < /.test(where.sql),
			where.params.includes(SHARE_OPENS_PER_MINUTE),
		],
		[true, true, true, true],
	);
	const set = argsOf(spent[0], 'set')?.[0] as Record<string, unknown>;
	check(
		'rate: the counters are updated in SQL, not from a read',
		[/case when/.test(renderSql(set.windowOpens).sql), /\+ \$?\d*\s*1|\+ 1/.test(renderSql(set.openCount).sql)], // prettier-ignore
		[true, true],
	);
}

// 3. Expiry, revoke, unknown.
{
	mints.length = 0;
	const { out } = await make('getting-hot', 1);
	const expiring = tokenOf(out.url);
	rows.at(-1)!.expiresAt = new Date(Date.now() - 1);
	const page = await open(expiring, 'GET');
	check('expired: GET 410', page.status, 410);
	check('expired: says so', /Link expired/.test(await page.text()), true);
	check('expired: POST 410', (await open(expiring)).status, 410);

	const outsider = await call(api.DELETE, {
		path: `/api/game-maker/partner-share?project=no-partner&id=${linkId}`,
		method: 'DELETE',
		user: owner,
	});
	check('revoke: through another project refused', outsider.status, 409);
	const revoked = await call(api.DELETE, {
		path: `/api/game-maker/partner-share?project=getting-hot&id=${linkId}`,
		method: 'DELETE',
		user: owner,
	});
	const after = (await revoked.json()) as { links: { id: string }[] };
	check('revoke: 200', revoked.status, 200);
	check(
		'revoke: gone from the list',
		after.links.some((l) => l.id === linkId),
		false,
	);
	const gone = await open(token);
	check('revoke: POST 410', gone.status, 410);
	check('revoke: says so', /Link revoked/.test(await gone.text()), true);
	const again = await call(api.DELETE, {
		path: `/api/game-maker/partner-share?project=getting-hot&id=${linkId}`,
		method: 'DELETE',
		user: owner,
	});
	check('revoke: twice → 404', again.status, 404);

	check('unknown: 404', (await open('A'.repeat(43))).status, 404);
	const before = log.length;
	check('malformed: 404', (await open('short', 'GET')).status, 404);
	check('malformed: no database read', log.length, before);
	check('expiry/revoke/unknown: no mint', mints.length, 0);
}

// 5. A project with no partner launch.
{
	check('no partner: no link made', (await make('no-partner')).res.status, 409);
	mints.length = 0;
	const stale = 'B'.repeat(43);
	rows.push({
		id: 'stale',
		tokenHash: createHash('sha256').update(stale).digest('hex'),
		projectKey: 'no-partner',
		createdBy: null,
		createdAt: new Date(),
		expiresAt: new Date(Date.now() + 86_400_000),
		revokedAt: null,
		revokedBy: null,
		lastOpenedAt: null,
		openCount: 0,
		windowStartedAt: null,
		windowOpens: 0,
	});
	const refused = await open(stale);
	check('no partner: an existing link refuses (409)', refused.status, 409);
	check('no partner: no env-default mint', mints.length, 0);
	check('no partner: the page is plain and secret-free', secretFree(await refused.text()), true);
}

// 6. Who may make links, and the card.
{
	check('gate: signed out 401', (await make('getting-hot', 7, null)).res.status, 401);
	check('gate: no Publish 403', (await make('getting-hot', 7, { ...owner, id: 'u-viewer' })).res.status, 403); // prettier-ignore
	check('gate: no project access 403', (await make('getting-hot', 7, { ...owner, id: 'u-outsider' })).res.status, 403); // prettier-ignore
	const listed = await call(api.GET, {
		path: '/api/game-maker/partner-share?project=getting-hot',
		user: { ...owner, id: 'u-viewer' },
	});
	check('gate: list needs Publish too', listed.status, 403);

	const buttons = (published: boolean, partner: unknown) =>
		partnerButtons({
			key: 'getting-hot',
			partner: partner as never,
			profiles: ['2complex'],
			published,
			latestDelivery: null,
		});
	const set = { gameId: '8', profile: '2complex' };
	check('card: none without a partner game', shareLinkButton({ partner: buttons(true, null), canPublish: true }), null); // prettier-ignore
	check('card: none with an unconfigured partner', shareLinkButton({ partner: buttons(true, { gameId: '8', profile: 'gone' }), canPublish: true }), null); // prettier-ignore
	check('card: none without Publish', shareLinkButton({ partner: buttons(true, set), canPublish: false }), null); // prettier-ignore
	check('card: disabled until published', shareLinkButton({ partner: buttons(false, set), canPublish: true }), { disabled: 'Publish the game first.' }); // prettier-ignore
	check('card: enabled once published', shareLinkButton({ partner: buttons(true, set), canPublish: true }), {}); // prettier-ignore
}

// 7. `/api/partner-session` over the shared path.
{
	mints.length = 0;
	const res = await call(session.GET, {
		path: '/api/partner-session?key=getting-hot',
		user: owner,
	});
	const to = new URL(res.headers.get('location') ?? '');
	check('session: 302', res.status, 302);
	check('session: stored game id', mints[0]?.get('game_id'), '8');
	check('session: rgs_profile + sid', [to.searchParams.get('rgs_profile'), to.searchParams.get('sid')], ['2complex', 'ptok-1']); // prettier-ignore
	const asJson = await call(session.GET, { path: '/api/partner-session?key=getting-hot&json=1', user: owner }); // prettier-ignore
	const body = (await asJson.json()) as Record<string, unknown>;
	check('session: json keys', Object.keys(body).filter((k) => body[k] !== undefined).sort(), ['gameName', 'token', 'url']); // prettier-ignore
	check('session: signed out 401', (await call(session.GET, { path: '/api/partner-session?key=getting-hot' })).status, 401); // prettier-ignore
	check('session: a query game id still wins for a signed-in user', (await call(session.GET, { path: '/api/partner-session?key=getting-hot&game=9', user: owner }), mints.at(-1)?.get('game_id')), '9'); // prettier-ignore
}

// Logs: no credential anywhere, and no live link token.
check('logs: no credential', logged.every(secretFree), true);
check(
	'logs: no link token',
	logged.some((l) => l.includes(token)),
	false,
);
check('logs: opens are logged by link id', logged.some((l) => l.includes(`link ${linkId} opened`)), true); // prettier-ignore

if (failures) {
	console.error(`\ncheck:partner-share — ${failures} of ${checks} checks FAILED`);
	process.exit(1);
}
process.stdout.write(`check:partner-share — ${checks} checks passed\n`);
