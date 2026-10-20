/**
 * The shared timeline library's SHIP CHAIN (Rive plan Phase 9d, CLAUDE.md rule 8):
 *   pnpm --filter launcher-api check:shared-timeline-ship
 *
 * A timeline promoted to `_shared/cinematics/` and placed in another project must reach pixels in
 * that project's game, not just show in the editor. This runs the REAL route handlers
 * (`/api/cinematics/shared/promote`, `shared`, `shared/get`, `save`, `get`, and the desktop bake's
 * `/api/editor/export-cinematics`) and the real storage, export and engine modules. Only the
 * boundaries are replaced: `r2.ts` is an in-memory bucket honouring `If-Match` / `If-None-Match`
 * as R2 does, the session gate and the role-override reads return a caller the test picks, and
 * the bake's deploy token / project lookup / deploy lock are stubbed.
 *
 *  1. promote: the `componentPublish` capability is required; v1 then v2 write a pointer and an
 *     immutable snapshot each; a stale `baseEtag` is a 409 and writes nothing; a link cannot be
 *     promoted; starters list beside the R2 copies;
 *  2. place: a link saved in ANOTHER project stores only its placement (sent content is dropped);
 *     `get` resolves it against its pinned version with the actors retargeted, and reports the
 *     update;
 *  3. bake: the export writes the RESOLVED timeline to `deploy/cinematics/` (no link field) and
 *     returns it for the bundle; the game registers it and its own `ComponentTimelinePlayer` plays
 *     it on the placed component's node, reaching the authored values;
 *  4. update re-pins (the next bake ships v2); detach saves a copy that ships after the shared
 *     copy is gone; a link whose version is gone ships nothing; a starter places and ships too.
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { error, isHttpError } from '@sveltejs/kit';
import type { CinematicDoc, LayoutNode } from 'engine-layout';

interface Stored {
	text: string;
	etag: string;
}
interface Cond {
	ifMatch?: string;
	ifNoneMatch?: string;
}

const bucket = new Map<string, Stored>();
/** Runs just before the next PUT to `key` is judged: another author's write landing mid-request. */
const beforePut = new Map<string, () => Promise<void> | void>();
/** Keys whose next reads fail as a transient R2 error would. */
const failReads = new Set<string>();
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
		getObjectTextWithEtag: async (key: string) => {
			if (failReads.has(key)) throw new Error(`R2 read failed: ${key}`);
			return bucket.get(key) ?? null;
		},
		getObjectText: async (key: string) => {
			if (failReads.has(key)) throw new Error(`R2 read failed: ${key}`);
			return bucket.get(key)?.text ?? null;
		},
		putObjectText: async (key: string, text: string, _type: string, cond?: Cond) => {
			const hook = beforePut.get(key);
			beforePut.delete(key);
			await hook?.();
			const current = bucket.get(key);
			if (cond?.ifNoneMatch === '*' && current) throw new ConflictError(key);
			if (cond?.ifMatch !== undefined && current?.etag !== cond.ifMatch)
				throw new ConflictError(key);
			const etag = etagOf(text);
			bucket.set(key, { text, etag });
			return etag;
		},
		deleteObject: async (key: string) => void bucket.delete(key),
		deleteObjects: async (keys: string[]) => keys.forEach((k) => bucket.delete(k)),
		listAllObjects: async (prefix: string) =>
			[...bucket.keys()]
				.filter((key) => key.startsWith(prefix))
				.map((key) => ({ key, size: 0, lastModified: 0 })),
	},
});

/** The project the session is on (the test moves between two). */
let session = { clientKey: 'acme', projectKey: 'alpha' };
mock.module(server('toolScope.ts'), {
	namedExports: {
		gate: async (locals: { user?: unknown }) => {
			if (!locals.user) throw error(401, 'Not authenticated');
			return { ...session, prefixes: [] };
		},
	},
});
mock.module(server('roleToolAccess.ts'), { namedExports: { getRoleOverrides: async () => ({}) } });
mock.module(server('userToolAccess.ts'), {
	namedExports: { getToolOverrides: async () => ({}), getToolOverridesFor: async () => ({}) },
});
mock.module(server('appSettings.ts'), { namedExports: { getDeployToken: async () => 'tok' } });
mock.module(server('projects.ts'), {
	namedExports: {
		DEFAULT_PROJECT_KEY: 'cloud',
		projectClientKey: async () => session.clientKey,
	},
});
mock.module(server('runtimeBundleCache.ts'), {
	namedExports: { withDeployWrite: <T>(_p: string, work: () => Promise<T>) => work() },
});

const sharedList = await import('../src/routes/api/cinematics/shared/+server.ts');
const sharedGet = await import('../src/routes/api/cinematics/shared/get/+server.ts');
const promote = await import('../src/routes/api/cinematics/shared/promote/+server.ts');
const save = await import('../src/routes/api/cinematics/save/+server.ts');
const get = await import('../src/routes/api/cinematics/get/+server.ts');
const bake = await import('../src/routes/api/editor/export-cinematics/+server.ts');
const { loadAuthoredCinematics, exportCinematics } =
	await import('../src/lib/server/cinematicExport.ts');
const { linkStub, STARTER_TARGET } = await import('../src/lib/timeline/sharedTimelines.ts');
const { promoteSharedCinematic } = await import('../src/lib/server/sharedCinematics.ts');
const { toSharedContent } = await import('../src/lib/timeline/sharedTimelines.ts');
const { ComponentTimelinePlayer, componentTimelinesFor, registerGameTimelines } =
	await import('engine-layout');

type Handler = (event: never) => Promise<Response>;
interface Answer {
	status: number;
	body: Record<string, unknown>;
}
let role = 'admin';
async function call(handler: Handler, path: string, body?: unknown): Promise<Answer> {
	const url = new URL(`http://launcher.test${path}`);
	const init = body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) };
	const event = {
		request: new Request(url, init),
		url,
		locals: { user: { id: 'u', role } },
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
		console.error(`  ✗ ${name}${detail === undefined ? '' : `\n      ${JSON.stringify(detail)}`}`);
	}
}

const alphaTimeline = (alphaTo: number): CinematicDoc => ({
	schemaVersion: 1,
	id: 'c_badge_pop',
	name: 'Pop',
	duration: 1,
	fps: 30,
	host: { kind: 'component', componentId: 'badge' },
	playOn: 'enter',
	stage: {
		sceneId: null,
		cast: [{ actorId: 'node_coin', kind: 'node', target: 'Coin', place: {} }],
	},
	tracks: [
		{
			id: 'p',
			actorId: 'node_coin',
			kind: 'property',
			channels: {
				alpha: [
					{ time: 0, value: 0, ease: 'linear' },
					{ time: 1, value: alphaTo },
				],
			},
		},
		{ id: 'cue', actorId: null, kind: 'cue', keys: [{ time: 0.5, cue: 'signal:shine' }] },
	],
	markers: [],
});
const sharedEtag = async (id: string): Promise<string | null> =>
	(await call(sharedGet.GET, `/api/cinematics/shared/get?id=${id}`)).body.etag as string | null;
const deployKey = (project: string, id: string) => `acme/${project}/deploy/cinematics/${id}.json`;

// ---- 1. promote ----------------------------------------------------------------------------------
console.log('1. promote to _shared/cinematics/');
role = 'artist';
const refused = await call(promote.POST, '/api/cinematics/shared/promote', {
	doc: alphaTimeline(1),
	name: 'Pop',
	baseEtag: null,
});
ok('a role without componentPublish gets 403', refused.status === 403, refused);
role = 'admin';
const v1 = await call(promote.POST, '/api/cinematics/shared/promote', {
	doc: alphaTimeline(1),
	name: 'Pop',
	baseEtag: await sharedEtag('pop'),
});
ok('v1 promotes', v1.status === 200 && v1.body.version === 1, v1);
ok(
	'a pointer and an immutable v1 snapshot',
	bucket.has('_shared/cinematics/pop.json') && bucket.has('_shared/cinematics/pop.v1.json'),
);
const pointer = JSON.parse(bucket.get('_shared/cinematics/pop.json')!.text) as Record<
	string,
	unknown
>;
ok(
	'the shared copy carries no placement (host, playOn) and its version',
	!('host' in pointer) && !('playOn' in pointer) && pointer.version === 1 && pointer.id === 'pop',
	pointer,
);
const stale = await call(promote.POST, '/api/cinematics/shared/promote', {
	doc: alphaTimeline(0.5),
	name: 'Pop',
	baseEtag: null,
});
ok('a stale baseEtag is a 409', stale.status === 409 && stale.body.error === 'conflict', stale);
ok('…and wrote no v2', !bucket.has('_shared/cinematics/pop.v2.json'));
const noEtag = await call(promote.POST, '/api/cinematics/shared/promote', {
	doc: alphaTimeline(1),
	name: 'Pop',
});
ok('a promote without its baseEtag is a 400', noEtag.status === 400, noEtag);
const listed = await call(sharedList.GET, '/api/cinematics/shared');
const rows = listed.body.timelines as { id: string; starter?: boolean; targets: string[] }[];
ok(
	'the list has the promoted one and the starters',
	rows.some((r) => r.id === 'pop' && r.targets[0] === 'Coin') && rows.some((r) => r.starter),
);
ok('the caller is told it may publish', listed.body.canPublish === true);

// ---- 2. place in another project -----------------------------------------------------------------
console.log('2. place it in another project');
session = { clientKey: 'acme', projectKey: 'beta' };
const placement: CinematicDoc = {
	...alphaTimeline(1),
	id: 'c_card_pop',
	host: { kind: 'component', componentId: 'card' },
};
const sentWithContent = {
	...linkStub(placement, { id: 'pop', version: 1, targets: { Coin: 'Gem' } }),
	tracks: [{ id: 'sneaky', actorId: null, kind: 'cue', keys: [{ time: 0, cue: 'fx:x' }] }],
};
const placed = await call(save.POST, '/api/cinematics/save', {
	doc: sentWithContent,
	baseEtag: null,
	projectKey: 'beta',
});
ok('the link saves', placed.status === 200, placed);
const stored = JSON.parse(bucket.get('acme/beta/cinematics/c_card_pop.json')!.text) as CinematicDoc;
ok(
	'it stores only its placement (sent content dropped)',
	stored.tracks.length === 0 && stored.stage.cast.length === 0 && stored.shared?.id === 'pop',
	stored,
);
ok('nothing went to project alpha', !bucket.has('acme/alpha/cinematics/c_card_pop.json'));
const v2 = await call(promote.POST, '/api/cinematics/shared/promote', {
	doc: alphaTimeline(0.5),
	name: 'Pop',
	baseEtag: await sharedEtag('pop'),
});
ok('v2 promotes on top', v2.status === 200 && v2.body.version === 2, v2);
const opened = await call(get.GET, '/api/cinematics/get?id=c_card_pop&projectKey=beta');
const resolved = opened.body.doc as CinematicDoc;
const linkInfo = opened.body.link as { version: number; latest: number; missing: boolean };
ok(
	'get resolves the pinned v1, retargeted to "Gem"',
	resolved.stage.cast[0]?.target === 'Gem' && resolved.tracks.length === 2,
	resolved,
);
ok(
	'…under the placement (id, host, playOn)',
	resolved.id === 'c_card_pop' &&
		resolved.host?.kind === 'component' &&
		resolved.playOn === 'enter',
);
ok(
	'…and reports the update (v1 → v2)',
	linkInfo.version === 1 && linkInfo.latest === 2 && !linkInfo.missing,
	linkInfo,
);
const promoteLink = await call(promote.POST, '/api/cinematics/shared/promote', {
	doc: stored,
	name: 'Again',
	baseEtag: null,
});
ok('a link cannot be promoted', promoteLink.status === 400, promoteLink);

// ---- 3. bake and play ----------------------------------------------------------------------------
console.log('3. bake → bundle → the game plays it');
const baked = await call(bake.POST, '/api/editor/export-cinematics?k=tok&project=beta');
const bundled = (baked.body.cinematics ?? []) as CinematicDoc[];
ok('the desktop bake exports it', baked.status === 200 && bundled.length === 1, baked);
const deployed = JSON.parse(
	bucket.get(deployKey('beta', 'c_card_pop'))?.text ?? 'null',
) as CinematicDoc | null;
ok(
	'deploy/cinematics/ holds the RESOLVED timeline',
	deployed?.stage.cast[0]?.target === 'Gem' && deployed.tracks.length === 2,
	deployed,
);
ok('…with no link field (the game never sees a link)', !!deployed && !('shared' in deployed));
const online = await exportCinematics('acme', 'beta', await loadAuthoredCinematics('acme', 'beta'));
ok(
	'the online bundle path embeds the same doc',
	JSON.stringify(online.cinematics) === JSON.stringify(bundled),
);

const near = (a: number | undefined, b: number): boolean =>
	a !== undefined && Math.abs(a - b) < 1e-6;
const nodes = [{ id: 'gem1', kind: 'sprite', label: 'Gem', x: 0, y: 0 }] as unknown as LayoutNode[];
const play = (docs: CinematicDoc[]): { alpha?: number; cues: string[] } => {
	registerGameTimelines(docs);
	const player = new ComponentTimelinePlayer(componentTimelinesFor('card'), nodes);
	player.trigger('enter');
	const cues: string[] = [];
	// Frame-sized steps: the game's cue pass treats a jump over 0.25s as a seek, firing nothing.
	for (let i = 0; i < 10; i++) cues.push(...player.advance(0.1).cues.map((c) => c.cue));
	return { alpha: player.sample('gem1')?.alpha, cues };
};
const v1Play = play(bundled);
ok('the game plays it on the placed node, reaching v1’s alpha 1', near(v1Play.alpha, 1), v1Play);
ok('…and its Report event cue fires', v1Play.cues.includes('signal:shine'), v1Play);

// ---- 4. update, detach, missing, starter ---------------------------------------------------------
console.log('4. update, detach, a missing version, a starter');
const etagBeta = opened.body.etag as string;
const updated = await call(save.POST, '/api/cinematics/save', {
	doc: linkStub(resolved, { id: 'pop', version: 2, targets: { Coin: 'Gem' } }),
	baseEtag: etagBeta,
	projectKey: 'beta',
});
ok('Update re-pins to v2', updated.status === 200, updated);
const v2Play = play(
	(await call(bake.POST, '/api/editor/export-cinematics?k=tok&project=beta')).body
		.cinematics as CinematicDoc[],
);
ok('the next bake ships v2 (alpha 0.5)', near(v2Play.alpha, 0.5), v2Play);

const reopened = await call(get.GET, '/api/cinematics/get?id=c_card_pop&projectKey=beta');
const silent = await call(save.POST, '/api/cinematics/save', {
	doc: reopened.body.doc,
	baseEtag: reopened.body.etag,
	projectKey: 'beta',
});
ok(
	'a resolved link saved back WITHOUT detach (a /rigger save) is refused',
	silent.status === 423 && silent.body.error === 'linked',
	silent,
);
const detached = await call(save.POST, '/api/cinematics/save', {
	doc: reopened.body.doc,
	baseEtag: reopened.body.etag,
	projectKey: 'beta',
	detach: true,
});
ok(
	'Detach saves the resolved copy as the project’s own',
	detached.status === 200 &&
		!('shared' in JSON.parse(bucket.get('acme/beta/cinematics/c_card_pop.json')!.text)),
	detached,
);
for (const key of [...bucket.keys()])
	if (key.startsWith('_shared/cinematics/pop')) bucket.delete(key);
const afterDelete = play(
	(await call(bake.POST, '/api/editor/export-cinematics?k=tok&project=beta')).body
		.cinematics as CinematicDoc[],
);
ok(
	'the detached copy still ships after the shared one is gone',
	near(afterDelete.alpha, 0.5),
	afterDelete,
);

const orphan = linkStub({ ...placement, id: 'c_card_ghost' }, { id: 'pop', version: 1 });
await call(save.POST, '/api/cinematics/save', { doc: orphan, baseEtag: null, projectKey: 'beta' });
const ghostOpen = await call(get.GET, '/api/cinematics/get?id=c_card_ghost&projectKey=beta');
ok(
	'a link whose version is gone opens as missing',
	(ghostOpen.body.link as { missing: boolean }).missing === true,
	ghostOpen.body.link,
);
const ghostBake = (await call(bake.POST, '/api/editor/export-cinematics?k=tok&project=beta')).body
	.cinematics as CinematicDoc[];
ok(
	'…and ships nothing',
	!ghostBake.some((d) => d.id === 'c_card_ghost') && !bucket.has(deployKey('beta', 'c_card_ghost')),
	ghostBake.map((d) => d.id),
);

const starterLink = linkStub(
	{ ...placement, id: 'c_card_fade' },
	{ id: 'starter_fade_in', version: 1, targets: { [STARTER_TARGET]: 'Gem' } },
);
await call(save.POST, '/api/cinematics/save', {
	doc: starterLink,
	baseEtag: null,
	projectKey: 'beta',
});
const withStarter = (await call(bake.POST, '/api/editor/export-cinematics?k=tok&project=beta')).body
	.cinematics as CinematicDoc[];
const fade = withStarter.find((d) => d.id === 'c_card_fade');
ok(
	'a placed starter ships resolved',
	fade?.stage.cast[0]?.target === 'Gem' && fade.duration === 0.4,
	fade,
);
registerGameTimelines(withStarter.filter((d) => d.id === 'c_card_fade'));
const fadePlayer = new ComponentTimelinePlayer(componentTimelinesFor('card'), nodes);
fadePlayer.trigger('enter');
fadePlayer.advance(0.2);
const mid = fadePlayer.sample('gem1')?.alpha ?? -1;
ok('…and fades the node in the game', mid > 0 && mid < 1, mid);

// ---- 4b. a shared read failing at publish -----------------------------------------------------
console.log('4b. the shared library cannot be read at publish');
const flaky = linkStub({ ...placement, id: 'c_card_flaky' }, { id: 'flaky', version: 1 });
await call(promote.POST, '/api/cinematics/shared/promote', {
	doc: alphaTimeline(1),
	name: 'Flaky',
	baseEtag: null,
});
await call(save.POST, '/api/cinematics/save', { doc: flaky, baseEtag: null, projectKey: 'beta' });
await call(bake.POST, '/api/editor/export-cinematics?k=tok&project=beta');
ok('a link ships once', bucket.has(deployKey('beta', 'c_card_flaky')));
failReads.add('_shared/cinematics/flaky.json');
const flakyBake = (await call(bake.POST, '/api/editor/export-cinematics?k=tok&project=beta')).body
	.cinematics as CinematicDoc[];
ok(
	'a failed shared read ships the last exported copy instead of dropping it',
	flakyBake.some((d) => d.id === 'c_card_flaky') && bucket.has(deployKey('beta', 'c_card_flaky')),
	flakyBake.map((d) => d.id),
);
failReads.add(deployKey('beta', 'c_card_flaky'));
const before = [...bucket.keys()]
	.filter((k) => k.startsWith('acme/beta/deploy/cinematics/'))
	.sort();
await call(bake.POST, '/api/editor/export-cinematics?k=tok&project=beta');
const after = [...bucket.keys()].filter((k) => k.startsWith('acme/beta/deploy/cinematics/')).sort();
ok(
	'when even that copy cannot be read, the export prunes nothing from deploy/',
	JSON.stringify(before) === JSON.stringify(after),
	{ before, after },
);
failReads.clear();

// ---- 5. two promoters race ------------------------------------------------------------------------
console.log('5. two promoters of one id race');
const content = (alphaTo: number) =>
	toSharedContent(alphaTimeline(alphaTo), 'race', 'Race', 1) as Parameters<
		typeof promoteSharedCinematic
	>[0];
await promoteSharedCinematic(content(1), null);
const raceBase = bucket.get('_shared/cinematics/race.json')!.etag;
// A and B both read v1's pointer; B's whole promote lands while A is about to write its pointer.
let bResult: unknown = null;
beforePut.set('_shared/cinematics/race.json', async () => {
	bResult = await promoteSharedCinematic(content(0.25), raceBase).catch((e: Error) => e.name);
});
const aResult = await promoteSharedCinematic(content(0.75), raceBase).catch((e: Error) => e.name);
ok(
	'exactly one wins v2',
	JSON.stringify([aResult, bResult].filter((r) => typeof r === 'string')) === '["ConflictError"]',
	{ aResult, bResult },
);
const racePointer = bucket.get('_shared/cinematics/race.json')!.text;
const raceSnap = bucket.get('_shared/cinematics/race.v2.json')?.text;
ok('the v2 snapshot holds exactly the pointer’s v2 bytes', raceSnap === racePointer, {
	racePointer,
	raceSnap,
});
ok(
	'v1’s snapshot is untouched',
	JSON.parse(bucket.get('_shared/cinematics/race.v1.json')!.text).version === 1,
);

// A stray snapshot (a crash between a pointer write and its snapshot, an old orphan) is repaired
// from the pointer before the pointer moves on, so the version a link pins reads the pointer's bytes.
bucket.set('_shared/cinematics/race.v2.json', { text: '{"stray":true}', etag: '"stray"' });
await promoteSharedCinematic(content(0.1), bucket.get('_shared/cinematics/race.json')!.etag);
ok(
	'a stray snapshot of the current version is rewritten from the pointer',
	bucket.get('_shared/cinematics/race.v2.json')!.text === racePointer,
);
ok(
	'…before v3 is written',
	JSON.parse(bucket.get('_shared/cinematics/race.json')!.text).version === 3,
);

bucket.set('_shared/cinematics/race.json', { text: 'not json', etag: '"bad"' });
const corrupt = await promoteSharedCinematic(content(1), '"bad"').catch((e: Error) => e.name);
ok(
	'an unreadable pointer is refused, not guessed at',
	corrupt === 'SharedPointerCorruptError',
	corrupt,
);
bucket.delete('_shared/cinematics/race.json');
const afterDelete2 = await promoteSharedCinematic(content(1), null);
ok(
	'a deleted pointer continues after the highest snapshot (v4), never reusing v1',
	afterDelete2.version === 4,
	afterDelete2,
);

console.log(`\n${failures ? '❌' : '✅'} ${passes} passed, ${failures} failed`);
if (failures) process.exit(1);
