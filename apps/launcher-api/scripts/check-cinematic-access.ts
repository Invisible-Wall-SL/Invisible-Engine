/**
 * Who may reach which cinematic through `/api/cinematics/*` (Rive plan Phases 3 and 4):
 *   pnpm --filter launcher-api check:cinematic-access
 *
 * Runs the REAL route handlers (`list`, `get`, `save`, `delete`) and the real `cinematicAccess` /
 * `cinematicStorage` / `writeGuard`. Only the boundaries are replaced: `r2.ts` becomes an in-memory
 * bucket that honours `If-Match` / `If-None-Match` the way R2 does, and the session gate becomes a
 * caller whose entitlements the test picks (`rigger`, `editor`, both, neither) and whose project is
 * fixed. The real gate's own behaviour is `check-launcher-gates.ts` / `check-project-scope.ts`.
 *
 * The contract: `rigger` reaches every cinematic as before; `editor` alone reaches exactly the
 * timelines whose host is a screen or a component — it never lists, opens, overwrites or deletes a
 * rig cinematic, not even by saving a screen or component doc under a rig cinematic's id, and its
 * writes are always conditional on the version it checked. Neither tool ⇒ 403 everywhere.
 *
 * What it cannot prove: R2 itself, and the browser side (the Animate panel's conflict prompt).
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { error, isHttpError } from '@sveltejs/kit';

interface Stored {
	text: string;
	etag: string;
}
interface Cond {
	ifMatch?: string;
	ifNoneMatch?: string;
}

const bucket = new Map<string, Stored>();
/** Runs just before the next PUT is judged: another author's save landing mid-request. */
let beforePut: (() => void) | null = null;

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
const etagOf = (text: string): string => `"${createHash('md5').update(text).digest('hex')}"`;

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		ConflictError,
		precondition: (baseEtag: string | null | undefined): Cond | undefined => {
			if (baseEtag === undefined) return undefined;
			return baseEtag === null ? { ifNoneMatch: '*' } : { ifMatch: baseEtag };
		},
		jsonBaseEtag: (v: unknown) => (v === null ? null : typeof v === 'string' ? v : undefined),
		formBaseEtag: (v: unknown) => (typeof v !== 'string' ? undefined : v === '' ? null : v),
		getObjectTextWithEtag: async (key: string) => bucket.get(key) ?? null,
		putObjectText: async (key: string, text: string, _type: string, cond?: Cond) => {
			const hook = beforePut;
			beforePut = null;
			hook?.();
			const current = bucket.get(key);
			if (cond?.ifNoneMatch === '*' && current) throw new ConflictError(key);
			if (cond?.ifMatch !== undefined && current?.etag !== cond.ifMatch) {
				throw new ConflictError(key);
			}
			const etag = etagOf(text);
			bucket.set(key, { text, etag });
			return etag;
		},
		deleteObject: async (key: string) => void bucket.delete(key),
		listAllObjects: async (prefix: string) =>
			[...bucket.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((key) => ({ key, size: 0, lastModified: 0 })),
	},
});

const SESSION = { clientKey: 'acme', projectKey: 'borut' };
/** The tools the current caller holds. */
let entitled = new Set<string>();
mock.module(server('toolScope.ts'), {
	namedExports: {
		gate: async (locals: { user?: unknown }, _cookies: unknown, opts: { tool: string }) => {
			if (!locals.user) throw error(401, 'Not authenticated');
			if (!entitled.has(opts.tool)) throw error(403, 'forbidden');
			return { ...SESSION, prefixes: [] };
		},
	},
});

const list = await import('../src/routes/api/cinematics/list/+server.ts');
const get = await import('../src/routes/api/cinematics/get/+server.ts');
const save = await import('../src/routes/api/cinematics/save/+server.ts');
const del = await import('../src/routes/api/cinematics/delete/+server.ts');
const { cinematicKey } = await import('../src/lib/server/cinematicStorage.ts');

type Handler = (event: never) => Promise<Response>;
interface Answer {
	status: number;
	body: Record<string, unknown>;
}

async function call(handler: Handler, path: string, body?: unknown): Promise<Answer> {
	const url = new URL(`http://launcher.test${path}`);
	const init = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) };
	const event = {
		request: new Request(url, init),
		url,
		locals: { user: { id: 'u', role: 'artist' } },
		cookies: { get: () => 'session-token' },
	};
	try {
		const res = await handler(event as never);
		return { status: res.status, body: (await res.json()) as Record<string, unknown> };
	} catch (e) {
		if (isHttpError(e)) return { status: e.status, body: { message: e.body.message } };
		throw e;
	}
}

let failures = 0;
let passes = 0;
function ok(name: string, cond: boolean, detail?: unknown): void {
	if (cond) {
		passes++;
		console.log(`  ✓ ${name}`);
	} else {
		failures++;
		console.log(`  ✗ ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`);
	}
}

const rigDoc = (id: string) => ({
	schemaVersion: 1,
	id,
	name: 'Bonus intro',
	duration: 2,
	fps: 30,
	stage: { sceneId: null, cast: [{ actorId: 'a1', rigFolder: 'hero', place: {} }] },
	tracks: [],
	markers: [],
});
const screenDoc = (id: string, name = 'Intro') => ({
	schemaVersion: 1,
	id,
	name,
	duration: 1,
	fps: 30,
	stage: {
		sceneId: null,
		cast: [{ actorId: 'node_logo', kind: 'node', target: 'Logo', place: {} }],
	},
	host: { kind: 'screen', sceneId: 'base' },
	tracks: [],
	markers: [],
});
const componentDoc = (id: string, name = 'Pop in') => ({
	...screenDoc(id, name),
	host: { kind: 'component', componentId: 'coin' },
	playOn: 'enter',
});
function seed(doc: { id: string }): string {
	const text = JSON.stringify(doc);
	const etag = etagOf(text);
	bucket.set(cinematicKey(SESSION.clientKey, SESSION.projectKey, doc.id), { text, etag });
	return etag;
}
const stored = (id: string) => {
	const o = bucket.get(cinematicKey(SESSION.clientKey, SESSION.projectKey, id));
	return o ? (JSON.parse(o.text) as Record<string, unknown>) : null;
};
function reset(): void {
	bucket.clear();
	beforePut = null;
}
const ids = (a: Answer) => ((a.body.cinematics as { id: string }[]) ?? []).map((c) => c.id).sort();

console.log('\n1. rigger — every cinematic, as before');
{
	reset();
	entitled = new Set(['rigger']);
	seed(rigDoc('bonus'));
	const screenEtag = seed(screenDoc('base_intro'));
	const l = await call(list.GET as Handler, '/api/cinematics/list');
	ok(
		'lists the rig cinematic and the screen timeline',
		JSON.stringify(ids(l)) === '["base_intro","bonus"]',
		ids(l),
	);
	const row = (l.body.cinematics as { id: string; host?: unknown }[]).find(
		(c) => c.id === 'base_intro',
	);
	ok(
		'a summary carries its host',
		JSON.stringify(row?.host) === '{"kind":"screen","sceneId":"base"}',
		row,
	);
	ok(
		'opens a rig cinematic',
		(await call(get.GET as Handler, '/api/cinematics/get?id=bonus')).status === 200,
	);
	const s = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: { ...rigDoc('base_intro') },
		baseEtag: screenEtag,
		projectKey: SESSION.projectKey,
	});
	ok('may turn a screen timeline into a rig cinematic (full access)', s.status === 200, s);
	ok(
		'deletes a rig cinematic',
		(await call(del.POST as Handler, '/api/cinematics/delete', { id: 'bonus' })).status === 200,
	);
}

console.log('\n2. editor alone — screen timelines only');
{
	reset();
	entitled = new Set(['editor']);
	const rigEtag = seed(rigDoc('bonus'));
	seed(screenDoc('base_intro'));
	const l = await call(list.GET as Handler, '/api/cinematics/list');
	ok('lists only the screen timeline', JSON.stringify(ids(l)) === '["base_intro"]', ids(l));
	ok(
		'opens a screen timeline',
		(await call(get.GET as Handler, '/api/cinematics/get?id=base_intro')).status === 200,
	);
	const g = await call(get.GET as Handler, '/api/cinematics/get?id=bonus');
	ok('a rig cinematic is refused (403), not returned', g.status === 403 && !('doc' in g.body), g);
	ok(
		'a missing one is still 404',
		(await call(get.GET as Handler, '/api/cinematics/get?id=nope')).status === 404,
	);

	const create = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('base_outro', 'Outro'),
		baseEtag: null,
		projectKey: SESSION.projectKey,
	});
	ok(
		'creates a screen timeline',
		create.status === 200 && stored('base_outro')?.name === 'Outro',
		create,
	);
	const update = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('base_outro', 'Outro 2'),
		baseEtag: create.body.etag,
		projectKey: SESSION.projectKey,
	});
	ok(
		'updates it with its etag',
		update.status === 200 && stored('base_outro')?.name === 'Outro 2',
		update,
	);
	const stale = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('base_outro', 'Outro 3'),
		baseEtag: create.body.etag,
		projectKey: SESSION.projectKey,
	});
	ok(
		'a stale etag is the ordinary 409 conflict',
		stale.status === 409 && stale.body.error === 'conflict',
		stale,
	);

	const rigWrite = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: rigDoc('base_outro'),
		baseEtag: update.body.etag,
		projectKey: SESSION.projectKey,
	});
	ok('may not write a rig cinematic', rigWrite.status === 403, rigWrite);
	const hijack = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('bonus'),
		baseEtag: rigEtag,
		projectKey: SESSION.projectKey,
	});
	ok(
		'may not overwrite a rig cinematic with a screen doc of the same id',
		hijack.status === 403,
		hijack,
	);
	const forced = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('bonus'),
		force: true,
		projectKey: SESSION.projectKey,
	});
	ok('not even with force', forced.status === 403, forced);
	ok(
		'the rig cinematic is untouched',
		stored('bonus')?.host === undefined && stored('bonus')?.name === 'Bonus intro',
	);

	const createOver = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('base_intro'),
		baseEtag: null,
		projectKey: SESSION.projectKey,
	});
	ok('a create over an existing timeline is a conflict', createOver.status === 409, createOver);

	// Between the host check and the put, a Rigger user writes a rig cinematic under the id.
	const raceEtag = seed(screenDoc('race'));
	beforePut = () => seed(rigDoc('race'));
	const race = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('race', 'Mine'),
		force: true,
		projectKey: SESSION.projectKey,
	});
	ok(
		'a forced save only overwrites the version it checked (race ⇒ 409, rig doc kept)',
		race.status === 409 && stored('race')?.host === undefined,
		{ race, raceEtag },
	);

	const mismatch = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('base_intro'),
		force: true,
		projectKey: 'other',
	});
	ok(
		'the project-scope guard still refuses another project',
		mismatch.status === 409 && mismatch.body.error === 'scope-mismatch',
		mismatch,
	);

	const delOther = await call(del.POST as Handler, '/api/cinematics/delete', {
		id: 'base_outro',
		projectKey: 'other',
	});
	ok(
		'a delete sent from a tab on another project is refused (scope-mismatch), nothing deleted',
		delOther.status === 409 &&
			delOther.body.error === 'scope-mismatch' &&
			stored('base_outro') !== null,
		delOther,
	);
	const listOther = await call(list.GET as Handler, '/api/cinematics/list?projectKey=other');
	ok(
		'a list for another project is refused too',
		listOther.status === 409 && listOther.body.error === 'scope-mismatch',
		listOther,
	);
	const getOther = await call(
		get.GET as Handler,
		'/api/cinematics/get?id=base_intro&projectKey=other',
	);
	ok('and a get', getOther.status === 409, getOther);
	const delRig = await call(del.POST as Handler, '/api/cinematics/delete', { id: 'bonus' });
	ok('may not delete a rig cinematic', delRig.status === 403 && stored('bonus') !== null, delRig);
	const delScreen = await call(del.POST as Handler, '/api/cinematics/delete', { id: 'base_outro' });
	ok(
		'deletes a screen timeline',
		delScreen.status === 200 && stored('base_outro') === null,
		delScreen,
	);

	bucket.set(cinematicKey(SESSION.clientKey, SESSION.projectKey, 'broken'), {
		text: '{oops',
		etag: '"x"',
	});
	ok(
		'a malformed doc is refused to editor-only (403)',
		(await call(get.GET as Handler, '/api/cinematics/get?id=broken')).status === 403,
	);
	ok(
		'and cannot be deleted by it',
		(await call(del.POST as Handler, '/api/cinematics/delete', { id: 'broken' })).status === 403,
	);
}

console.log('\n2b. editor alone — component timelines too (Phase 4)');
{
	reset();
	entitled = new Set(['editor']);
	const rigEtag = seed(rigDoc('bonus'));
	seed(screenDoc('base_intro'));
	seed(componentDoc('c_coin_pop'));
	const l = await call(list.GET as Handler, '/api/cinematics/list');
	ok(
		'lists the screen and the component timeline, not the rig cinematic',
		JSON.stringify(ids(l)) === '["base_intro","c_coin_pop"]',
		ids(l),
	);
	const g = await call(get.GET as Handler, '/api/cinematics/get?id=c_coin_pop');
	ok(
		'opens a component timeline, playOn intact',
		g.status === 200 && (g.body.doc as { playOn?: string })?.playOn === 'enter',
		g,
	);
	const create = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: componentDoc('c_coin_win', 'Win'),
		baseEtag: null,
		projectKey: SESSION.projectKey,
	});
	ok(
		'creates a component timeline',
		create.status === 200 && stored('c_coin_win')?.name === 'Win',
		create,
	);
	const update = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: { ...componentDoc('c_coin_win', 'Win'), playOn: 'potWin' },
		baseEtag: create.body.etag,
		projectKey: SESSION.projectKey,
	});
	ok(
		'updates it with its etag',
		update.status === 200 && stored('c_coin_win')?.playOn === 'potWin',
		update,
	);
	const toRig = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: rigDoc('c_coin_win'),
		baseEtag: update.body.etag,
		projectKey: SESSION.projectKey,
	});
	ok('may not turn it into a rig cinematic', toRig.status === 403, toRig);
	const hijack = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: componentDoc('bonus'),
		baseEtag: rigEtag,
		projectKey: SESSION.projectKey,
	});
	ok(
		'may not overwrite a rig cinematic with a component doc of the same id',
		hijack.status === 403 && stored('bonus')?.host === undefined,
		hijack,
	);
	const blank = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: { ...componentDoc('c_blank'), host: { kind: 'component', componentId: '' } },
		baseEtag: null,
		projectKey: SESSION.projectKey,
	});
	ok(
		'a component host naming no component is not a component timeline',
		blank.status === 403,
		blank,
	);
	const delComponent = await call(del.POST as Handler, '/api/cinematics/delete', {
		id: 'c_coin_win',
	});
	ok(
		'deletes a component timeline',
		delComponent.status === 200 && stored('c_coin_win') === null,
		delComponent,
	);
}

console.log('\n3. both tools — full access');
{
	reset();
	entitled = new Set(['editor', 'rigger']);
	seed(rigDoc('bonus'));
	seed(screenDoc('base_intro'));
	const l = await call(list.GET as Handler, '/api/cinematics/list');
	ok('lists everything', JSON.stringify(ids(l)) === '["base_intro","bonus"]', ids(l));
}

console.log('\n4. neither tool — 403 everywhere');
{
	reset();
	entitled = new Set(['flow']);
	seed(screenDoc('base_intro'));
	ok('list 403', (await call(list.GET as Handler, '/api/cinematics/list')).status === 403);
	ok(
		'get 403',
		(await call(get.GET as Handler, '/api/cinematics/get?id=base_intro')).status === 403,
	);
	const s = await call(save.POST as Handler, '/api/cinematics/save', {
		doc: screenDoc('base_intro'),
		force: true,
		projectKey: SESSION.projectKey,
	});
	ok('save 403', s.status === 403, s);
	ok(
		'delete 403',
		(await call(del.POST as Handler, '/api/cinematics/delete', { id: 'base_intro' })).status ===
			403,
	);
}

console.log(`\n${failures === 0 ? '✅' : '❌'} ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
