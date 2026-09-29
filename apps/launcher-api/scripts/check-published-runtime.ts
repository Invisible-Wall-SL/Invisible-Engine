/**
 * Contract check for published runtime snapshots — what a PLAYER boots:
 *   pnpm --filter launcher-api check:published-runtime
 *
 * Runs the REAL `publishedRuntime.ts`, `/api/editor/runtime`, `/api/published/f/…` and the two
 * concurrency primitives Publish holds (`createKeyedMutex`, `createLimiter`) over an in-memory R2
 * that honours `If-Match` / `If-None-Match`, so a lost pointer race fails here the way it would in
 * production. Only I/O is stubbed: R2, the project lookups, the deploy-token setting and the live
 * assemble.
 *
 * What it pins, each because getting it wrong is silent in production:
 *  - a snapshot freezes `deploy/`: rewriting the live tree afterwards changes nothing a player loads;
 *  - players get the snapshot, authoring boots and unsnapshotted games get the live assemble;
 *  - retention keeps {@link RETAINED_SNAPSHOTS}, never drops the live one, and deletes the rest;
 *  - rollback is a pointer flip to a RETAINED id only;
 *  - a reload revalidates to a 304, and a rollback changes the ETag.
 */
import { mock } from 'node:test';
import { isHttpError } from '@sveltejs/kit';

// ── In-memory R2 ─────────────────────────────────────────────────────────────
type Obj = { body: string; etag: string };
const R2 = new Map<string, Obj>();
let etagSeq = 0;
const put = (key: string, body: string) => R2.set(key, { body, etag: `"e${++etagSeq}"` });

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`conflict ${key}`);
	}
}
const sortedKeys = (prefix: string) => [...R2.keys()].filter((k) => k.startsWith(prefix)).sort();

const src = (rel: string) => new URL(`../src/${rel}`, import.meta.url).href;
mock.module(src('lib/server/r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (base: string | null | undefined) =>
			base === undefined ? undefined : base === null ? { ifNoneMatch: '*' } : { ifMatch: base },
		getObjectTextWithEtag: async (key: string) => {
			const o = R2.get(key);
			return o ? { text: o.body, etag: o.etag } : null;
		},
		getObjectBytes: async () => null,
		getObjectStream: async (key: string) => {
			const o = R2.get(key);
			if (!o) return null;
			return { body: new Response(o.body).body!, contentLength: o.body.length };
		},
		putObjectText: async (
			key: string,
			text: string,
			_type: string,
			cond?: { ifMatch?: string; ifNoneMatch?: string },
		) => {
			const cur = R2.get(key);
			if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
			if (cond?.ifMatch && cur?.etag !== cond.ifMatch) throw new ConflictError(key);
			put(key, text);
			return R2.get(key)!.etag;
		},
		copyObject: async (from: string, to: string) => {
			const o = R2.get(from);
			if (!o) return false;
			put(to, o.body);
			return true;
		},
		deleteObjects: async (keys: string[]) => keys.forEach((k) => R2.delete(k)),
		listAllKeys: async (prefix: string) => sortedKeys(prefix),
		listAllObjects: async (prefix: string) =>
			sortedKeys(prefix).map((key) => ({
				key,
				size: R2.get(key)?.body.length ?? 0,
				lastModified: 1,
			})),
		listObjects: async (prefix: string) => {
			const prefixes = new Set<string>();
			const keys: string[] = [];
			for (const k of sortedKeys(prefix)) {
				const rest = k.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash === -1) keys.push(k);
				else prefixes.add(prefix + rest.slice(0, slash + 1));
			}
			return { keys, prefixes: [...prefixes] };
		},
	},
});

const PROJECTS: Record<string, { client: string; token: string }> = {
	remake: { client: 'invisible_wall', token: 'TOK' },
	legacy: { client: 'invisible_wall', token: 'LEG' },
};
mock.module(src('lib/server/projects.ts'), {
	namedExports: {
		DEFAULT_PROJECT_KEY: 'lines',
		projectAllowsRead: async (p: string, t: string) => PROJECTS[p]?.token === t,
		projectReadClient: async (p: string, t: string) =>
			PROJECTS[p]?.token === t ? PROJECTS[p].client : null,
		projectClientKey: async (p: string) => PROJECTS[p]?.client ?? null,
		projectName: async (p: string) => `Name of ${p}`,
	},
});
mock.module(src('lib/server/appSettings.ts'), {
	namedExports: { getDeployToken: async () => 'DEPLOY' },
});
/** The live assemble — a marker, so a response says which source answered. */
mock.module(src('lib/server/runtimeBundleCache.ts'), {
	namedExports: {
		getRuntimeBundle: async (p: string, authoring: boolean) => ({ live: p, authoring }),
	},
});

const pub = await import(src('lib/server/publishedRuntime.ts'));
const { createKeyedMutex, createLimiter } = await import(src('lib/server/concurrency.ts'));
const runtimeRoute = await import(src('routes/api/editor/runtime/+server.ts'));
const assetRoute = await import(
	src('routes/api/published/f/[token]/[project]/[snapshot]/[...rel]/+server.ts')
);

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

const ORIGIN = 'https://app.invisiblewall.org';
const DEPLOY = 'invisible_wall/remake/deploy/';

async function boot(project: string, token: string, extra = '', etag?: string) {
	const url = new URL(`${ORIGIN}/api/editor/runtime?project=${project}&k=${token}${extra}`);
	const request = new Request(url, etag ? { headers: { 'if-none-match': etag } } : {});
	try {
		const res: Response = await runtimeRoute.GET({ url, request } as never);
		return {
			status: res.status,
			source: res.headers.get('x-ie-runtime-source'),
			etag: res.headers.get('etag'),
			body: res.status === 200 ? ((await res.json()) as Record<string, unknown>) : null,
		};
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, source: null, etag: null, body: null };
		throw e;
	}
}

async function asset(url: string) {
	const prefix = `${ORIGIN}/api/published/f/`;
	const [token, project, snapshot, ...rel] = url.slice(prefix.length).split('/');
	const res: Response = await assetRoute.GET({
		params: { token, project, snapshot, rel: rel.join('/') },
	} as never);
	return {
		status: res.status,
		body: res.status === 200 ? await res.text() : null,
		cache: res.headers.get('cache-control'),
	};
}

// ── Concurrency primitives ───────────────────────────────────────────────────
{
	const lock = createKeyedMutex();
	const order: string[] = [];
	const step = (tag: string, ms: number) => () =>
		new Promise<string>((r) =>
			setTimeout(() => {
				order.push(tag);
				r(tag);
			}, ms),
		);
	await Promise.all([
		lock('a', step('a1', 30)),
		lock('a', step('a2', 1)),
		lock('b', step('b1', 5)),
		lock('a', () => Promise.reject(new Error('boom'))).catch(() => order.push('a3!')),
		lock('a', step('a4', 1)),
	]);
	check('mutex: same key runs in order, other keys overlap, a failure releases', order, [
		'b1',
		'a1',
		'a2',
		'a3!',
		'a4',
	]);

	const limit = createLimiter(2);
	let active = 0;
	let peak = 0;
	await Promise.all(
		Array.from({ length: 6 }, () =>
			limit(async () => {
				peak = Math.max(peak, ++active);
				await new Promise((r) => setTimeout(r, 5));
				active--;
			}),
		),
	);
	check('limiter: never more than the limit at once', peak, 2);
}

// ── No snapshot yet: players fall back to live, logged ──────────────────────
{
	const res = await boot('legacy', 'LEG');
	check('unsnapshotted game: player boot is the live assemble', res.source, 'live-fallback');
	check(
		'…with the live deploy/ assetBase',
		(res.body as { assetBase: string }).assetBase,
		`${ORIGIN}/api/deploy/f/LEG/invisible_wall/legacy/`,
	);
}

// ── Publish #1 ──────────────────────────────────────────────────────────────
put(`${DEPLOY}editor-art/bg/bg.json`, 'atlas v1');
put(`${DEPLOY}_pages/abc.webp`, 'page v1');
const bundle1 = { doc: { scenes: [{ id: 'basegame' }] }, marker: 'bundle 1' };
const s1 = await pub.stageSnapshot('invisible_wall', 'remake', bundle1, {
	by: 'a@x',
	flow: 'valid',
	runtime: 'lines',
});
check('stage: copies every deploy/ file', s1.files, 2);
check(
	'stage: a staged snapshot is not live until committed',
	(await boot('remake', 'TOK')).source,
	'live-fallback',
);
await pub.commitSnapshot('invisible_wall', 'remake', s1);

const p1 = await boot('remake', 'TOK');
check('player boot: served from the snapshot', p1.source, 'snapshot');
check('player boot: the frozen bundle', (p1.body as { marker: string }).marker, 'bundle 1');
check('player boot: ETag is the snapshot id', p1.etag, `"${s1.id}"`);
const base1 = (p1.body as { assetBase: string }).assetBase;
check(
	'player boot: assetBase points into the snapshot',
	base1,
	`${ORIGIN}/api/published/f/TOK/remake/${s1.id}/`,
);
check('authoring boot: still live', (await boot('remake', 'TOK', '&authoring=1')).source, 'live');
check('wrong token: refused', (await boot('remake', 'NOPE')).status, 401);
check('reload with the ETag: 304', (await boot('remake', 'TOK', '', `"${s1.id}"`)).status, 304);

// The live tree moves on (an authoring boot re-exports, prunes the page) — the snapshot must not.
put(`${DEPLOY}editor-art/bg/bg.json`, 'atlas v2');
R2.delete(`${DEPLOY}_pages/abc.webp`);
check(
	'snapshot asset: frozen content',
	(await asset(`${base1}editor-art/bg/bg.json`)).body,
	'atlas v1',
);
check(
	'snapshot asset: survives the live prune',
	(await asset(`${base1}_pages/abc.webp`)).body,
	'page v1',
);
check(
	'snapshot asset: immutable caching',
	(await asset(`${base1}_pages/abc.webp`)).cache,
	'public, max-age=31536000, immutable',
);
check('snapshot asset: miss is 404 no-store', await asset(`${base1}nope.png`), {
	status: 404,
	body: null,
	cache: 'no-store',
});
check(
	'snapshot asset: foreign token refused',
	(await asset(base1.replace('/TOK/', '/LEG/') + 'editor-art/bg/bg.json')).status,
	401,
);
check(
	'snapshot asset: malformed snapshot id refused',
	(await asset(`${ORIGIN}/api/published/f/TOK/remake/..%2Fdeploy/x`)).status,
	400,
);

// ── Retention: publish six more ─────────────────────────────────────────────
// A crashed stage from long ago: unreferenced AND old, so the next commit sweeps it.
put('invisible_wall/remake/published/20200101T000000Z-dead/runtime.json', '{}');
const ids = [s1.id];
for (let i = 2; i <= 7; i++) {
	// Distinct, increasing ids regardless of the clock's resolution.
	const meta = await pub.stageSnapshot(
		'invisible_wall',
		'remake',
		{ marker: `bundle ${i}` },
		{
			by: null,
			flow: 'absent',
			runtime: 'lines',
		},
	);
	// Re-id so the order is deterministic whatever the clock's resolution; the folder staged under
	// the random id is left behind as an orphan, which the sweep must remove.
	meta.id = `2099010${i}T000000Z-000${i}`;
	put(
		`invisible_wall/remake/published/${meta.id}/runtime.json`,
		JSON.stringify({ marker: `bundle ${i}` }),
	);
	await pub.commitSnapshot('invisible_wall', 'remake', meta);
	ids.push(meta.id);
}
const ptr = await pub.currentPointer('invisible_wall', 'remake');
check('retention: keeps five', ptr?.snapshots.length, pub.RETAINED_SNAPSHOTS);
check('retention: newest is live', ptr?.current, ids[6]);
const folders = new Set(
	sortedKeys('invisible_wall/remake/published/')
		.map((k) => k.split('/')[3])
		.filter((f) => pub.isSnapshotId(f)),
);
/** Folders staged under a fresh (random) id in this run, never committed. */
const youngOrphans = [...folders].filter((f) => !ids.includes(f) && f.startsWith('2026'));
check(
	'retention: dropped + OLD orphans are swept; young unreferenced ones (a concurrent publish mid-stage) are kept',
	[...folders].filter((f) => !youngOrphans.includes(f)).sort(),
	[...ids.slice(2)].sort(),
);
check('retention: the young orphans are the six re-id stages', youngOrphans.length, 6);
check('retention: the first snapshot, dropped by retention, is gone', folders.has(s1.id), false);

// ── Rollback ─────────────────────────────────────────────────────────────────
const back = await pub.rollbackSnapshot('invisible_wall', 'remake', ids[3]);
check('rollback: pointer flips', back.current, ids[3]);
check('rollback: history is unchanged', back.snapshots.length, pub.RETAINED_SNAPSHOTS);
const after = await boot('remake', 'TOK', '', `"${ids[6]}"`);
check('rollback: the old ETag no longer matches', after.status, 200);
check('rollback: players get the rolled-back bundle', after.etag, `"${ids[3]}"`);
let refused = '';
try {
	await pub.rollbackSnapshot('invisible_wall', 'remake', ids[0]);
} catch (e) {
	refused = (e as Error).name;
}
check('rollback: a swept snapshot is refused', refused, 'UnknownSnapshotError');

// The guard sees the target inside the CAS and can refuse it (non-owner reviving a flow override).
let guarded = '';
try {
	await pub.rollbackSnapshot('invisible_wall', 'remake', ids[4], () => 'owner only');
} catch (e) {
	guarded = (e as Error).name;
}
check('rollback: a guard refusal throws RollbackRefusedError', guarded, 'RollbackRefusedError');
check(
	'rollback: …and leaves the pointer where it was',
	(await pub.currentPointer('invisible_wall', 'remake'))?.current,
	ids[3],
);

// A proxy weakens the ETag; the browser echoes W/"…". Still a 304.
check(
	'reload with a WEAK ETag: 304',
	(await boot('remake', 'TOK', '', `W/"${ids[3]}"`)).status,
	304,
);

// A file that vanishes between list and copy fails the stage — no hole frozen into a snapshot.
{
	put(`${DEPLOY}editor-art/gone/gone.json`, 'x');
	const realGet = R2.get.bind(R2);
	R2.get = (k: string) => (k.endsWith('gone/gone.json') ? undefined : realGet(k));
	let failedStage = '';
	try {
		await pub.stageSnapshot(
			'invisible_wall',
			'remake',
			{},
			{ by: null, flow: 'absent', runtime: 'lines' },
		);
	} catch (e) {
		failedStage = (e as Error).message;
	}
	R2.get = realGet;
	check('stage: a vanished source fails the stage', /vanished/.test(failedStage), true);
	R2.delete(`${DEPLOY}editor-art/gone/gone.json`);
}

// A live snapshot older than five newer ones is never pushed out.
check(
	'retain: keeps the live snapshot even when it is the oldest',
	pub
		.retain(
			ids.map((id: string) => ({ id })),
			ids[0],
		)
		.map((s: { id: string }) => s.id),
	[ids[6], ids[5], ids[4], ids[3], ids[0]],
);

// ── Lost pointer race: a concurrent writer between read and write is retried, not clobbered ──
{
	const key = 'invisible_wall/remake/published/pointer.json';
	const before = JSON.parse(R2.get(key)!.body) as { current: string };
	const meta = {
		id: '20990201T000000Z-aaaa',
		createdAt: 'x',
		by: null,
		flow: 'absent',
		runtime: 'lines',
		files: 0,
		bytes: 0,
	};
	put(`invisible_wall/remake/published/${meta.id}/runtime.json`, '{}');
	// Interleave: another replica rolls back while this commit is in flight.
	const racing = pub.commitSnapshot('invisible_wall', 'remake', meta);
	const other = JSON.parse(R2.get(key)!.body);
	other.current = ids[4];
	put(key, JSON.stringify(other));
	const committed = await racing;
	check('pointer CAS: the commit still lands', committed.current, meta.id);
	check(
		'pointer CAS: the racing writer was re-read, not overwritten blind',
		before.current,
		ids[3],
	);
	check(
		'pointer CAS: the stored pointer is the committed one',
		JSON.parse(R2.get(key)!.body).current,
		meta.id,
	);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
