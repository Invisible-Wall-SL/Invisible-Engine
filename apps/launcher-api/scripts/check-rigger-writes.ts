/**
 * Contract check for the Rigger's shared writes — the animation + rig library saves, the New-rig /
 * upload create claim, and every route that rewrites a project's `skeletons.json`:
 *   pnpm --filter launcher-api check:rigger-writes
 *
 * Runs the REAL route handlers (`rigger/animations/save`, `rigger/rigs/save`, `rigger/new`,
 * `rigger/upload`, `rigger/delete`, `editor/rigs/reindex`) and the real `rigIndex` /
 * `rigReindex` / `riggerIrigWrite` / `riggerLibraryWrite` / `writeGuard`. Only the boundaries are
 * replaced: `r2.ts` becomes an in-memory bucket that honours `If-Match` / `If-None-Match` the way
 * R2 does and can hold a request at a chosen step (so two creates can be interleaved), the session
 * gate becomes a fixed caller whose project comes from the test, the Postgres catalog upserts are
 * recorded, and the atlas-sync / region / page-image helpers become trivial stand-ins (an atlas is
 * "re-derived" only for a folder that has a `source.json`).
 *
 * What it cannot prove: R2 itself (that a stale `If-Match` is a 412 is `r2.ts`'s mapping), and the
 * browser side of the confirm → retry loop in `static/rigger/view.html`.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { error, isHttpError } from '@sveltejs/kit';

interface Stored {
	body: Uint8Array;
	etag: string;
	/** Epoch ms of the write — what a listing / HEAD reports as `lastModified`. */
	modified: number;
}
interface Cond {
	ifMatch?: string;
	ifNoneMatch?: string;
}

const bucket = new Map<string, Stored>();
/** Every successful mutation, in order: `<op> <key>`. */
const writes: string[] = [];
/** Which request (`A` / `B`) an R2 call belongs to, for interleaving two concurrent creates. */
const who = new AsyncLocalStorage<string>();
/** Awaited after a write lands / before a listing runs — the interleaving seams. */
let afterPut: ((key: string, caller: string | undefined) => Promise<void>) | null = null;
/** Awaited before a write checks its precondition — a request held between its read and its write. */
let beforePut: ((key: string, caller: string | undefined) => Promise<void>) | null = null;
let beforeList: ((caller: string | undefined) => Promise<void>) | null = null;
let afterDelete: ((key: string, caller: string | undefined) => void) | null = null;
/** A key whose writes answer no ETag, as an R2 answer without one would. */
let noEtagFor: string | null = null;
/** Awaited before a HEAD reads the object / after it has read it. */
let beforeHead: ((key: string, caller: string | undefined) => Promise<void>) | null = null;
let afterHead: ((key: string, caller: string | undefined) => Promise<void>) | null = null;

class ConflictError extends Error {
	constructor(readonly key: string) {
		super(`Conditional write failed for ${key}`);
		this.name = 'ConflictError';
	}
}
const enc = new TextEncoder();
const dec = new TextDecoder();
const etagOf = (body: Uint8Array): string => `"${createHash('md5').update(body).digest('hex')}"`;

async function put(key: string, body: Uint8Array, cond?: Cond): Promise<string> {
	await beforePut?.(key, who.getStore());
	const current = bucket.get(key);
	if (cond?.ifNoneMatch === '*' && current) throw new ConflictError(key);
	if (cond?.ifMatch !== undefined && current?.etag !== cond.ifMatch) throw new ConflictError(key);
	const etag = etagOf(body);
	bucket.set(key, { body, etag, modified: Date.now() });
	writes.push(`put ${key}`);
	await afterPut?.(key, who.getStore());
	return etag;
}
function remove(key: string): void {
	if (!bucket.delete(key)) return;
	writes.push(`delete ${key}`);
	afterDelete?.(key, who.getStore());
}
async function keysUnder(prefix: string): Promise<string[]> {
	await beforeList?.(who.getStore());
	return [...bucket.keys()].filter((k) => k.startsWith(prefix)).sort();
}

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
		putObjectText: async (key: string, text: string, _type?: string, cond?: Cond) => {
			const etag = await put(key, enc.encode(text), cond);
			return key === noEtagFor ? null : etag;
		},
		putObjectBytes: (key: string, body: Uint8Array, _type?: string, cond?: Cond) =>
			put(key, body, cond),
		getObjectBytes: async (key: string) => {
			const o = bucket.get(key);
			return o ? { body: o.body, contentType: 'application/octet-stream', etag: o.etag } : null;
		},
		getObjectText: async (key: string) => {
			const o = bucket.get(key);
			return o ? dec.decode(o.body) : null;
		},
		getObjectTextWithEtag: async (key: string) => {
			const o = bucket.get(key);
			return o ? { text: dec.decode(o.body), etag: o.etag } : null;
		},
		headObject: async (key: string) => {
			await beforeHead?.(key, who.getStore());
			const o = bucket.get(key);
			const head = o ? { etag: o.etag, size: o.body.length, lastModified: o.modified } : null;
			await afterHead?.(key, who.getStore());
			return head;
		},
		copyObject: async (src: string, dest: string, _type?: string, sourceEtag?: string) => {
			const o = bucket.get(src);
			if (!o || (sourceEtag !== undefined && o.etag !== sourceEtag)) return false;
			await put(dest, o.body);
			return true;
		},
		listAllKeys: keysUnder,
		listAllObjects: async (prefix: string) =>
			(await keysUnder(prefix)).map((key) => {
				const o = bucket.get(key)!;
				return {
					key,
					size: o.body.length,
					lastModified: o.modified,
					etag: o.etag.replace(/"/g, ''),
				};
			}),
		deleteObject: async (key: string) => remove(key),
		deleteObjects: async (keys: string[]) => keys.forEach(remove),
		presignPut: async (key: string, contentType: string) => `https://r2.test/${key}#${contentType}`,
	},
});

const CLIENT = 'acme';
mock.module(server('toolScope.ts'), {
	namedExports: {
		gate: async (locals: { user?: unknown; project?: string }) => {
			if (!locals.user) throw error(401, 'Not authenticated');
			return { clientKey: CLIENT, projectKey: locals.project ?? 'p1', prefixes: [] };
		},
	},
});

const catalog: string[] = [];
mock.module(server('riggerLibrary.ts'), {
	namedExports: {
		saveAnimation: async (row: { id: string }) => void catalog.push(`animation ${row.id}`),
		saveRig: async (row: { id: string }) => void catalog.push(`rig ${row.id}`),
	},
});

/** Re-derives `atlasFile` only for a folder that remembers its source — the real rule. */
mock.module(server('rigBundleSync.ts'), {
	namedExports: {
		ensureBundleAtlasFresh: async (
			_client: string,
			_project: string,
			folderPrefix: string,
			atlasFile: string,
		) => {
			if (!bucket.has(`${folderPrefix}/source.json`)) return null;
			await put(`${folderPrefix}/${atlasFile}`, enc.encode('page.png\nsize: 1,1\n'));
			return { atlasFile };
		},
		bundleRevision: async () => 'rev',
	},
});
mock.module(server('editorRegions.ts'), {
	namedExports: {
		loadRegionSet: async () => ({ regions: [], pageKey: '', pageWidth: 0, pageHeight: 0 }),
	},
});
mock.module(server('rig.ts'), {
	namedExports: {
		regionsToRigAtlas: (page: string, w: number, h: number) => `${page}\nsize: ${w},${h}\n`,
		reorientRotatedRegionsForRig: async (body: Uint8Array) => body,
	},
});

const routes = '../src/routes/api';
const animSave = await import(`${routes}/rigger/animations/save/+server.ts`);
const rigSave = await import(`${routes}/rigger/rigs/save/+server.ts`);
const rigGet = await import(`${routes}/rigger/rigs/get/+server.ts`);
const newRig = await import(`${routes}/rigger/new/+server.ts`);
const upload = await import(`${routes}/rigger/upload/+server.ts`);
const del = await import(`${routes}/rigger/delete/+server.ts`);
const irigSave = await import(`${routes}/rigger/save/+server.ts`);
const { irigDocProblem } = await import('../src/lib/server/riggerIrig.ts');
const { stampSavedBy } = await import('../src/lib/server/savedBy.ts');
const { migrateIrigs } = await import('../src/lib/server/irigMigration.ts');
const { irigBackupsPrefix } = await import('../src/lib/server/riggerIrig.ts');
const reindex = await import(`${routes}/editor/rigs/reindex/+server.ts`);
const importBegin = await import(`${routes}/rigger/import/+server.ts`);
const importFinish = await import(`${routes}/rigger/import/finish/+server.ts`);
const importUpgrade = await import(`${routes}/rigger/import/upgrade/+server.ts`);
const tplSave = await import(`${routes}/rigger/templates/save/+server.ts`);
const tplDelete = await import(`${routes}/rigger/templates/delete/+server.ts`);
const tplList = await import(`${routes}/rigger/templates/+server.ts`);
const tplOne = await import(`${routes}/rigger/template/+server.ts`);
const backupsRoute = await import(`${routes}/rigger/backups/+server.ts`);
const rig3dFx = await import('./lib/rig3dFixture.ts');
const ctrlFx = await import('./lib/rigControlsFixture.ts');
const { pairMark } = await import('../src/lib/server/riggerIrigWrite.ts');

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

type Handler = (event: never) => Response | Promise<Response>;
interface Answer {
	status: number;
	body: Record<string, unknown>;
}
async function call(
	handler: Handler,
	body: unknown,
	project = 'p1',
	caller = 'solo',
): Promise<Answer> {
	const url = new URL('http://launcher.test/api');
	const event = {
		request: new Request(url, { method: 'POST', body: JSON.stringify(body) }),
		url,
		locals: { user: { id: 'u', role: 'artist' }, project },
		cookies: { get: () => 'session-token' },
	};
	return who.run(caller, async () => {
		try {
			const res = await handler(event as never);
			return { status: res.status, body: (await res.json()) as Record<string, unknown> };
		} catch (e) {
			if (isHttpError(e)) return { status: e.status, body: { message: e.body.message } };
			throw e;
		}
	});
}
/** A GET handler with `query` as its search params. */
async function get(handler: Handler, query: Record<string, string>): Promise<Answer> {
	const url = new URL(`http://launcher.test/api?${new URLSearchParams(query)}`);
	const event = {
		request: new Request(url),
		url,
		locals: { user: { id: 'u', role: 'artist' }, project: 'p1' },
		cookies: { get: () => 'session-token' },
	};
	const res = await handler(event as never);
	return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

const text = (key: string): string | null => {
	const o = bucket.get(key);
	return o ? dec.decode(o.body) : null;
};
const reset = (): void => {
	bucket.clear();
	writes.length = 0;
	catalog.length = 0;
	afterPut = null;
	beforePut = null;
	beforeList = null;
	afterDelete = null;
	beforeHead = null;
	afterHead = null;
	noEtagFor = null;
};

// ── 6a: the animation library save is create-only / If-Match ─────────────────────────────────
{
	reset();
	const key = '_shared/animations/wave.json';
	const clip = (n: number) => ({ name: 'Wave', animation: { bones: { root: { n } } } });

	const created = await call(animSave.POST, { ...clip(1), baseEtag: null }, 'p1');
	check(
		'anim: a new id is created',
		[created.status, created.body.ok, catalog],
		[200, true, ['animation wave']],
	);
	const firstTag = bucket.get(key)?.etag;
	check('anim: the create answers the etag it wrote', created.body.etag, firstTag);
	const savedAt = JSON.parse(text(key) ?? '{}').savedAt;

	writes.length = 0;
	catalog.length = 0;
	const taken = await call(animSave.POST, { ...clip(2), baseEtag: null }, 'p2');
	check(
		'anim: a taken id is a 409 exists carrying the etag, the saving project and when',
		[taken.status, taken.body.error, taken.body.etag, taken.body.project, taken.body.savedAt],
		[409, 'exists', firstTag, 'p1', savedAt],
	);
	check(
		'anim: the 409 message names the project',
		/project "p1"/.test(String(taken.body.message)),
		true,
	);
	check(
		'anim: exists writes nothing (blob or catalog row)',
		[writes, catalog, bucket.get(key)?.etag],
		[[], [], firstTag],
	);

	const overwrite = await call(animSave.POST, { ...clip(2), baseEtag: taken.body.etag }, 'p2');
	const secondTag = bucket.get(key)?.etag;
	check(
		'anim: the confirmed overwrite (If-Match on that etag) lands',
		[overwrite.status, JSON.parse(text(key) ?? '{}').source?.project, overwrite.body.etag],
		[200, 'p2', secondTag],
	);

	writes.length = 0;
	catalog.length = 0;
	const stale = await call(animSave.POST, { ...clip(3), baseEtag: firstTag }, 'p3');
	check(
		'anim: a stale etag is a 409 conflict naming the current etag',
		[stale.status, stale.body.error, stale.body.etag, stale.body.project],
		[409, 'conflict', secondTag, 'p2'],
	);
	check(
		'anim: conflict writes nothing',
		[writes, catalog, bucket.get(key)?.etag],
		[[], [], secondTag],
	);

	const oldTab = await call(animSave.POST, clip(4), 'p3');
	check(
		'anim: a tab that sends no baseEtag is a 400 asking for a reload, and writes nothing',
		[oldTab.status, /reload/.test(String(oldTab.body.message)), bucket.get(key)?.etag],
		[400, true, secondTag],
	);
}

// ── 6a: the rig library save still answers the same 409 after the shared-helper refactor ────
{
	reset();
	const rig = { name: 'Hero', skeleton: { bones: [{ name: 'root' }], slots: [], skins: [] } };
	check(
		'rig lib: create',
		(await call(rigSave.POST, { ...rig, baseEtag: null }, 'p1')).status,
		200,
	);
	const tag = bucket.get('_shared/rigs/hero.json')?.etag;
	writes.length = 0;
	const taken = await call(rigSave.POST, { ...rig, baseEtag: null }, 'p2');
	check(
		'rig lib: a taken id is a 409 exists with etag + project, and writes nothing',
		[taken.status, taken.body.error, taken.body.etag, taken.body.project, writes],
		[409, 'exists', tag, 'p1', []],
	);
	check(
		'rig lib: the confirmed overwrite lands',
		(await call(rigSave.POST, { ...rig, baseEtag: tag }, 'p2')).status,
		200,
	);
}

// ── Item 2: no route that rewrites skeletons.json drops an atlas-less rig ────────────────────
const RIGS = `${CLIENT}/p1/spines`;
const skel = (name: string): string =>
	JSON.stringify({ skeleton: { spine: '4.2.40' }, bones: [{ name: 'root' }], slots: [], name });
const b64 = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const entry = (folder: string) => ({
	name: `${folder}/${folder}`,
	folder,
	skeleton_file: `${folder}.irig`,
	atlas_file: `${folder}.atlas`,
	format: 'json',
	version: '4.2.40',
	runtime: '4.2',
	pma: false,
	dir_b64: b64(folder),
});
/** `ageMs` back-dates the object — how long ago it was written. */
const seedStore = (key: string, body: string, ageMs = 0): void => {
	const bytes = enc.encode(body);
	bucket.set(key, { body: bytes, etag: etagOf(bytes), modified: Date.now() - ageMs });
};
/** A healthy rig A, and an atlas-less rig B with no source to rebuild one — both listed. */
function seedProject(): void {
	reset();
	seedStore(`${RIGS}/A/A.irig`, skel('A'));
	seedStore(`${RIGS}/A/A.atlas`, 'A.png\nsize: 1,1\n');
	seedStore(`${RIGS}/A/A.png`, 'png');
	seedStore(`${RIGS}/B/B.irig`, skel('B'));
	seedStore(`${RIGS}/B/B.png`, 'png');
	const skeletons = [entry('A'), entry('B')].map((e, id) => ({ ...e, id }));
	seedStore(`${RIGS}/skeletons.json`, JSON.stringify({ prefix: RIGS, skeletons }));
}
const listed = (): string[] =>
	(
		JSON.parse(text(`${RIGS}/skeletons.json`) ?? '{"skeletons":[]}') as {
			skeletons: { folder: string }[];
		}
	).skeletons.map((s) => s.folder);
const PAGE = Buffer.from('png').toString('base64');

{
	seedProject();
	const res = await call(reindex.POST, { projectKey: 'p1' });
	check('reindex: keeps the atlas-less rig B', [res.status, listed()], [200, ['A', 'B']]);
	check(
		'reindex: answers the count, and how many were preserved / re-derived',
		[res.body.count, res.body.preserved, res.body.rederived, res.body.atlasMissing],
		[2, 1, 0, ['B']],
	);

	seedProject();
	seedStore(`${RIGS}/E/E.irig`, skel('E'));
	seedStore(`${RIGS}/E/source.json`, '{"manifestKey":"m"}');
	const healed = await call(reindex.POST, { projectKey: 'p1' });
	check(
		'reindex: an atlas-less rig with a source gets its atlas re-derived and listed',
		[listed(), healed.body.rederived, bucket.has(`${RIGS}/E/E.atlas`)],
		[['A', 'B', 'E'], 1, true],
	);

	// The editor names its tab's project: a reindex for another one, or for none, writes nothing.
	seedProject();
	const before = text(`${RIGS}/skeletons.json`);
	const other = await call(reindex.POST, { projectKey: 'p2' });
	const bare = await call(reindex.POST, {});
	check(
		'reindex: a tab on another project is a 409 scope-mismatch; naming none is a 400',
		[
			other.status,
			other.body.error,
			bare.status,
			bare.body.error,
			text(`${RIGS}/skeletons.json`) === before,
		],
		[409, 'scope-mismatch', 400, 'project-required', true],
	);

	seedProject();
	const created = await call(newRig.POST, { noAtlas: true, name: 'C' });
	check('new: keeps the atlas-less rig B', [created.status, listed()], [200, ['A', 'B', 'C']]);

	seedProject();
	const uploaded = await call(upload.POST, {
		name: 'D',
		page: PAGE,
		pageWidth: 1,
		pageHeight: 1,
		regions: [{ name: 'r', x: 0, y: 0, w: 1, h: 1 }],
	});
	check('upload: keeps the atlas-less rig B', [uploaded.status, listed()], [200, ['A', 'B', 'D']]);

	seedProject();
	const deletedA = await call(del.POST, { dir: b64('A'), skeleton_file: 'A.irig' });
	check(
		'delete: removing rig A keeps the atlas-less rig B',
		[deletedA.status, deletedA.body.count, listed()],
		[200, 1, ['B']],
	);

	seedProject();
	const deletedB = await call(del.POST, { dir: b64('B'), skeleton_file: 'B.irig' });
	check(
		'delete: removing the atlas-less rig B itself unlists it and purges its folder',
		[deletedB.status, listed(), [...bucket.keys()].some((k) => k.startsWith(`${RIGS}/B/`))],
		[200, ['A'], false],
	);

	seedProject();
	seedStore(`${RIGS}/B/Other.json`, skel('Other'));
	const deletedShared = await call(del.POST, { dir: b64('B'), skeleton_file: 'B.irig' });
	check(
		'delete: a rig deleted from a folder another atlas-less skeleton still uses is not resurrected',
		[deletedShared.status, listed()],
		[200, ['A']],
	);
}

// ── A person's `.irig` save is theirs: the stamp a Director rebind left does not ride along ──────
{
	seedProject();
	const key = `${RIGS}/A/A.irig`;
	const saved_by = { tool: 'director', agent: 'animator', runId: 'r1', at: 't', rev: 'r' };
	const res = await call(irigSave.POST, {
		dir: b64('A'),
		stem: 'A',
		skeleton: { ...JSON.parse(skel('A')), saved_by },
		baseEtag: bucket.get(key)?.etag,
	});
	check(
		"save: a person's save drops the Director stamp the rig carried",
		[res.status, 'saved_by' in JSON.parse(text(key) ?? '{}'), JSON.parse(text(key) ?? '{}').bones],
		[200, false, [{ name: 'root' }]],
	);
}

// ── irig v1 (docs/design/irig-format.md, Phase 2): the server checks it as the runtime does ─────
{
	const v1 = (extra: Record<string, unknown> = {}) => ({
		irig: 1,
		skeleton: { importedFrom: '4.2.40' },
		bones: [{ name: 'root' }],
		slots: [{ name: 's', bone: 'root' }],
		...extra,
	});
	check('irig: a v1 document passes the check', irigDocProblem(v1()), null);
	check(
		'irig: a v1 document with a key outside the schema is refused',
		/not an irig field/.test(irigDocProblem(v1({ name: 'A' })) ?? ''),
		true,
	);
	check(
		'irig: a v1 document with a wrong-typed value is refused (a 4.2 file would coerce it)',
		/expected a number/.test(irigDocProblem(v1({ bones: [{ name: 'root', x: '1' }] })) ?? ''),
		true,
	);
	check(
		'irig: a v1 document still gets the reference checks',
		/does not exist/.test(irigDocProblem(v1({ slots: [{ name: 's', bone: 'ghost' }] })) ?? ''),
		true,
	);
	check(
		'irig: a newer irig version is refused',
		/newer/.test(irigDocProblem(v1({ irig: 2 })) ?? ''),
		true,
	);
	const stamp = { tool: 'director', agent: 'animator', runId: 'r1', at: 't', rev: 'r' };
	check(
		"irig: Director's saved_by stamp keeps a v1 document loadable",
		irigDocProblem(stampSavedBy(v1(), stamp)),
		null,
	);

	seedProject();
	const key = `${RIGS}/A/A.irig`;
	const saved = await call(irigSave.POST, {
		dir: b64('A'),
		stem: 'A',
		skeleton: v1(),
		baseEtag: bucket.get(key)?.etag,
	});
	check(
		'irig: the Rigger save stores a v1 document as sent',
		[saved.status, JSON.parse(text(key) ?? '{}')],
		[200, v1()],
	);
	const before = text(key);
	const refused = await call(irigSave.POST, {
		dir: b64('A'),
		stem: 'A',
		skeleton: v1({ name: 'A' }),
		baseEtag: bucket.get(key)?.etag,
	});
	check(
		'irig: the Rigger save refuses a v1 document the runtime would refuse, and writes nothing',
		[refused.status, refused.body.error, text(key) === before],
		[422, 'invalid-skeleton', true],
	);

	reset();
	await call(rigSave.POST, { name: 'Lib', skeleton: v1(), baseEtag: null });
	const libDoc = JSON.parse(text('_shared/rigs/lib.json') ?? '{}').skeleton;
	check(
		'irig: the rig library stores a v1 document without a 4.2 header version',
		[libDoc?.skeleton, irigDocProblem(libDoc)],
		[{ importedFrom: '4.2.40' }, null],
	);
	reset();
	await call(rigSave.POST, {
		name: 'Old',
		skeleton: { bones: [{ name: 'root' }] },
		baseEtag: null,
	});
	check(
		'irig: the rig library still gives a 4.2 skeleton its version',
		JSON.parse(text('_shared/rigs/old.json') ?? '{}').skeleton?.skeleton,
		{ spine: '4.2' },
	);
}

// ── irig v1, Phase 5: the R2 migration upgrades what no save has ─────────────────────────────
{
	const seed = (): void => {
		seedProject();
		seedStore(`${RIGS}/V/V.irig`, JSON.stringify({ irig: 1, bones: [{ name: 'root' }] }));
		seedStore(
			`${RIGS}/X/X.irig`,
			JSON.stringify({ bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: '5' }] }),
		);
		seedStore(`${RIGS}/Z/Z.irig`, '{not json');
	};
	const texts = (): string => JSON.stringify([...bucket.entries()].map(([k, o]) => [k, o.etag]));
	const rel = (key: string): string => key.slice(RIGS.length + 1);

	seed();
	const before = texts();
	const dry = await migrateIrigs({ prefix: `${RIGS}/` });
	check(
		'migration: a dry run gives every rig a verdict and writes nothing',
		[dry.map((r) => [rel(r.key), r.verdict, r.outcome]), texts() === before],
		[
			[
				['A/A.irig', 'upgrade', undefined],
				['B/B.irig', 'upgrade', undefined],
				['V/V.irig', 'already', undefined],
				['X/X.irig', 'changes-a-value', undefined],
				['Z/Z.irig', 'unreadable', undefined],
			],
			true,
		],
	);

	seed();
	const untouched = ['V', 'X', 'Z'].map((s) => text(`${RIGS}/${s}/${s}.irig`));
	const wrote = await migrateIrigs({ prefix: `${RIGS}/`, write: true });
	const a = JSON.parse(text(`${RIGS}/A/A.irig`) ?? '{}');
	check(
		'migration: --write upgrades only the upgrade rows, through the save (index re-derived where it can be)',
		[
			wrote.map((r) => [rel(r.key), r.outcome]),
			a.irig,
			irigDocProblem(a),
			['V', 'X', 'Z'].map((s) => text(`${RIGS}/${s}/${s}.irig`)),
		],
		[
			[
				['A/A.irig', 'written'],
				['B/B.irig', 'written-not-indexed'],
				['V/V.irig', undefined],
				['X/X.irig', undefined],
				['Z/Z.irig', undefined],
			],
			1,
			null,
			untouched,
		],
	);
	check(
		'migration: the 4.2 file it replaced is in the rig history',
		[...bucket.keys()].filter((k) => k.startsWith(irigBackupsPrefix(CLIENT, 'p1', 'A', 'A')))
			.length,
		1,
	);

	seed();
	const key = `${RIGS}/A/A.irig`;
	beforeHead = async (k) => {
		if (k !== key) return;
		beforeHead = null;
		seedStore(key, skel('saved meanwhile'));
	};
	const raced = await migrateIrigs({ prefix: `${RIGS}/A/`, write: true });
	beforeHead = null;
	check(
		'migration: a rig saved after it was read keeps that save',
		[raced.map((r) => r.outcome), JSON.parse(text(key) ?? '{}').name],
		[['saved-meanwhile'], 'saved meanwhile'],
	);
}

// ── irig v1, Phase 4a: the Rigger save imports a 4.2 skeleton ─────────────────────────────────
{
	const key = `${RIGS}/A/A.irig`;
	const save = async (skeleton: Record<string, unknown>) => {
		seedProject();
		const res = await call(irigSave.POST, {
			dir: b64('A'),
			stem: 'A',
			skeleton,
			baseEtag: bucket.get(key)?.etag,
		});
		return { status: res.status, doc: JSON.parse(text(key) ?? '{}') };
	};
	const rig42 = {
		skeleton: { spine: '4.2.40', iwLockBounds: true },
		bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 5, transform: 'normal' }],
		slots: [{ name: 's', bone: 'arm' }],
		skins: { default: {} },
	};
	const imported = await save(rig42);
	check(
		'irig: a 4.2 skeleton saved from the Rigger is stored as irig v1, keys the reader ignores dropped',
		[imported.status, imported.doc, irigDocProblem(imported.doc)],
		[
			200,
			{
				irig: 1,
				skeleton: { importedFrom: '4.2.40', iwLockBounds: true },
				bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: 5 }],
				slots: [{ name: 's', bone: 'arm' }],
				skins: [{ name: 'default', attachments: {} }],
			},
			null,
		],
	);
	const coerced = {
		...rig42,
		bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: '5' }],
		skins: [{ name: 'default', attachments: {} }],
	};
	const kept = await save(coerced);
	check(
		'irig: a 4.2 skeleton whose import would change a value is stored as 4.2, as sent',
		[kept.status, kept.doc],
		[200, coerced],
	);
}

// ── irig v1, Phase 3: new rigs and uploads are written as irig v1 ─────────────────────────────
{
	type Entry = { folder: string; version: string; runtime: string };
	const entry = (folder: string): Entry | undefined =>
		(
			JSON.parse(text(`${RIGS}/skeletons.json`) ?? '{"skeletons":[]}') as { skeletons: Entry[] }
		).skeletons.find((s) => s.folder === folder);
	const stored = (folder: string) => JSON.parse(text(`${RIGS}/${folder}/${folder}.irig`) ?? '{}');

	seedProject();
	seedStore(`${RIGS}/H/H.irig`, JSON.stringify({ irig: 1, bones: [{ name: 'root' }] }));
	seedStore(`${RIGS}/H/H.atlas`, 'H.png\nsize: 1,1\n');
	const created = await call(newRig.POST, { noAtlas: true, name: 'C' });
	check(
		'irig: a new blank rig is irig v1, loads, and is indexed as irig on the 4.2 runtime line',
		[
			created.status,
			stored('C').irig,
			irigDocProblem(stored('C')),
			entry('C')?.version,
			entry('C')?.runtime,
		],
		[200, 1, null, 'irig 1', '4.2'],
	);
	check('irig: a v1 rig with no header is still indexed', entry('H')?.version, 'irig 1');

	seedProject();
	const uploaded = await call(upload.POST, {
		name: 'D',
		page: PAGE,
		pageWidth: 1,
		pageHeight: 1,
		regions: [{ name: 'r', x: 0, y: 0, w: 1, h: 1 }],
	});
	check(
		'irig: a rig built from uploaded images is irig v1',
		[uploaded.status, stored('D').irig, irigDocProblem(stored('D'))],
		[200, 1, null],
	);

	const fromLibrary = async (skeleton: Record<string, unknown>) => {
		seedProject();
		seedStore('_shared/rigs/lib.json', JSON.stringify({ name: 'Lib', skeleton }));
		const res = await call(newRig.POST, { noAtlas: true, name: 'L', rigId: 'lib' });
		return { status: res.status, doc: stored('L') };
	};
	const lib42 = {
		skeleton: { spine: '4.2.40' },
		bones: [
			{ name: 'root', icon: 'editor-only' },
			{ name: 'arm', parent: 'root', x: 5 },
		],
	};
	const imported = await fromLibrary(lib42);
	check(
		'irig: a 4.2 library rig is imported to v1 when applied (an ignored key drops)',
		[
			imported.status,
			imported.doc.irig,
			imported.doc.skeleton,
			imported.doc.bones,
			irigDocProblem(imported.doc),
		],
		[
			200,
			1,
			{ importedFrom: '4.2.40' },
			[{ name: 'root' }, { name: 'arm', parent: 'root', x: 5 }],
			null,
		],
	);
	const coerced = await fromLibrary({
		...lib42,
		bones: [{ name: 'root' }, { name: 'arm', parent: 'root', x: '5' }],
	});
	check(
		'irig: a 4.2 library rig whose import would change a value stays 4.2, as it always loaded',
		[coerced.status, coerced.doc.irig, coerced.doc.skeleton, coerced.doc.bones[1].x],
		[200, undefined, { spine: '4.2' }, '5'],
	);
	const v1Lib = {
		irig: 1,
		skeleton: { importedFrom: '4.2.40', iwLockBounds: true },
		bones: [{ name: 'root' }],
	};
	const kept = await fromLibrary(v1Lib);
	check('irig: a v1 library rig is applied as stored', [kept.status, kept.doc], [200, v1Lib]);
}

// ── 6b: `Hero` and `hero` created at once — at most one survives ─────────────────────────────
/**
 * Resolves once `n` callers have arrived — or after a short wait, so a route that never arrives
 * (one that does not list after claiming) finishes and fails its checks instead of hanging.
 */
function barrier(n: number): () => Promise<void> {
	let arrived = 0;
	let open: () => void = () => {};
	const gate = new Promise<void>((resolve) => {
		open = resolve;
		setTimeout(resolve, 250);
	});
	return () => {
		if (++arrived >= n) open();
		return gate;
	};
}
const HERO_CLAIM = /\/spines\/hero\/hero\.irig$/i;
const heroKeys = (): string[] =>
	[...bucket.keys()].filter((k) => /\/spines\/hero\//i.test(k)).sort();
const regions = [{ name: 'r', x: 0, y: 0, w: 1, h: 1 }];
const creates = [
	{
		label: 'new',
		run: (name: string, caller: string) => call(newRig.POST, { noAtlas: true, name }, 'p1', caller),
	},
	{
		label: 'upload',
		run: (name: string, caller: string) =>
			call(upload.POST, { name, page: PAGE, pageWidth: 1, pageHeight: 1, regions }, 'p1', caller),
	},
];

/**
 * Both name checks run before either claim, and both claims land before either lists again —
 * so each create's pre-claim read passes. With `releaseFirst`, B's post-claim listing is held
 * until A has released its claim.
 */
function interleave(releaseFirst: boolean): void {
	seedProject();
	const checked = barrier(2);
	const claimed = barrier(2);
	let releasedByA: () => void = () => {};
	const released = new Promise<void>((resolve) => {
		releasedByA = resolve;
		setTimeout(resolve, 250);
	});
	const lists = new Map<string, number>();
	beforeList = async (caller) => {
		const n = (lists.get(caller ?? '') ?? 0) + 1;
		lists.set(caller ?? '', n);
		// Listing 1 is the abandoned-claim check, 2 the name check, 3 the post-claim re-check.
		if (n === 2) await checked();
		else if (n === 3 && releaseFirst && caller === 'B') await released;
	};
	afterPut = async (key) => {
		if (HERO_CLAIM.test(key)) await claimed();
	};
	afterDelete = (key, caller) => {
		if (caller === 'A' && HERO_CLAIM.test(key)) releasedByA();
	};
}

for (const create of creates) {
	interleave(false);
	const [a, b] = await Promise.all([create.run('Hero', 'A'), create.run('hero', 'B')]);
	check(
		`${create.label} claim-claim-list-list: never both created (both back off)`,
		[a.status, b.status],
		[409, 409],
	);
	check(
		`${create.label} claim-claim-list-list: both claims are released, nothing else was written`,
		heroKeys(),
		[],
	);
	check(`${create.label} claim-claim-list-list: the index is untouched`, listed(), ['A', 'B']);

	interleave(true);
	const [a2, b2] = await Promise.all([create.run('Hero', 'A'), create.run('hero', 'B')]);
	check(
		`${create.label} claim-claim-list-release-list: exactly one is created`,
		[a2.status, b2.status],
		[409, 200],
	);
	check(
		`${create.label} claim-claim-list-release-list: the loser's .irig is gone, the winner's stands`,
		[bucket.has(`${RIGS}/Hero/Hero.irig`), bucket.has(`${RIGS}/hero/hero.irig`)],
		[false, true],
	);
	check(`${create.label} claim-claim-list-release-list: only the winner is listed`, listed(), [
		'A',
		'B',
		'hero',
	]);

	seedProject();
	await create.run('Hero', 'solo');
	writes.length = 0;
	const again = await create.run('hERO', 'solo');
	check(
		`${create.label} sequential: a case-only clash is a 409 before any write`,
		[again.status, writes],
		[409, []],
	);
}

// ── A create that died after its claim does not hold the name forever ────────────────────────
const STALE = 11 * 60_000;
const backupsOf = (folder: string): string[] =>
	[...bucket.keys()].filter((k) => k.startsWith(`${CLIENT}/p1/rigger-backups/${b64(folder)}/`));
const created = (folder: string): boolean =>
	[`${folder}.irig`, `${folder}.atlas`].every((f) => bucket.has(`${RIGS}/${folder}/${f}`)) &&
	text(`${RIGS}/${folder}/${folder}.irig`) !== '{}';

for (const create of creates) {
	seedProject();
	seedStore(`${RIGS}/Hero/Hero.irig`, skel('orphan'), STALE);
	const same = await create.run('Hero', 'solo');
	check(
		`${create.label} abandoned: a lone stale claim of the same name is reclaimed and the rig created`,
		[same.status, created('Hero'), listed()],
		[200, true, ['A', 'B', 'Hero']],
	);
	check(
		`${create.label} abandoned: the reclaimed .irig is kept in the name's 🕘 backups`,
		backupsOf('Hero').map((k) => text(k)),
		[skel('orphan')],
	);

	seedProject();
	seedStore(`${RIGS}/HERO/HERO.irig`, skel('orphan'), STALE);
	seedStore(`${RIGS}/HERO/page.png`, 'png', STALE);
	const other = await create.run('hero', 'solo');
	check(
		`${create.label} abandoned: a stale claim + its page under another case is removed, the rig created`,
		[other.status, heroKeys().filter((k) => k.includes('/HERO/')), created('hero')],
		[200, [], true],
	);
}

{
	const refused = async (label: string, seed: () => void, name = 'Hero'): Promise<void> => {
		seedProject();
		seed();
		const before = [...bucket.keys()].sort();
		const res = await creates[0].run(name, 'solo');
		check(
			`abandoned: ${label} — refused, nothing touched`,
			[res.status, [...bucket.keys()].sort()],
			[409, before],
		);
	};
	await refused('a claim still young (a create in flight)', () =>
		seedStore(`${RIGS}/Hero/Hero.irig`, skel('orphan'), 60_000),
	);
	await refused(
		'a listed atlas-less rig, however old',
		() => {
			seedStore(`${RIGS}/B/B.irig`, skel('B'), STALE);
			seedStore(`${RIGS}/B/B.png`, 'png', STALE);
		},
		'b',
	);
	await refused('a folder holding an atlas', () => {
		seedStore(`${RIGS}/Hero/Hero.irig`, skel('orphan'), STALE);
		seedStore(`${RIGS}/Hero/Hero.atlas`, 'x', STALE);
	});
	await refused('a folder holding another file', () => {
		seedStore(`${RIGS}/Hero/Hero.irig`, skel('orphan'), STALE);
		seedStore(`${RIGS}/Hero/source.json`, '{}', STALE);
	});
	await refused('a folder whose skeleton is not <folder>.irig', () =>
		seedStore(`${RIGS}/Hero/Other.irig`, skel('orphan'), STALE),
	);
	await refused('a folder written to recently', () => {
		seedStore(`${RIGS}/Hero/Hero.irig`, skel('orphan'), STALE);
		seedStore(`${RIGS}/Hero/page.png`, 'png', 1000);
	});
	await refused('an unreadable index', () => {
		seedStore(`${RIGS}/Hero/Hero.irig`, skel('orphan'), STALE);
		seedStore(`${RIGS}/skeletons.json`, '{not json');
	});
}

// Two creates of the same name, both judging the same stale claim abandoned: A reclaims it AND
// claims the freed name while B is between its listing and its takeover — held before its HEAD
// (the HEAD then reads A's claim, not what was listed) or after it (its `If-Match` then fails).
// Either way B must not take over A's claim.
for (const hold of ['before', 'after'] as const) {
	seedProject();
	seedStore(`${RIGS}/Hero/Hero.irig`, skel('orphan'), STALE);
	let aClaimed: () => void = () => {};
	const claimedByA = new Promise<void>((resolve) => {
		aClaimed = resolve;
		setTimeout(resolve, 250);
	});
	const holdB = async (key: string, caller: string | undefined): Promise<void> => {
		if (caller === 'B' && HERO_CLAIM.test(key)) await claimedByA;
	};
	if (hold === 'before') beforeHead = holdB;
	else afterHead = holdB;
	afterPut = async (key, caller) => {
		if (caller === 'A' && HERO_CLAIM.test(key) && text(key) !== '{}') aClaimed();
	};
	const [a, b] = await Promise.all([creates[0].run('Hero', 'A'), creates[0].run('Hero', 'B')]);
	check(
		`abandoned, same name at once (B held ${hold} its HEAD): A creates, B is refused and removes nothing of A`,
		[a.status, b.status, created('Hero'), listed()],
		[200, 409, true, ['A', 'B', 'Hero']],
	);
}

// Both creates read the stale claim before either takes it over: the `If-Match` lets only one win.
{
	seedProject();
	seedStore(`${RIGS}/HERO/HERO.irig`, skel('orphan'), STALE);
	const headed = barrier(2);
	afterHead = async (key) => {
		if (key.endsWith('/HERO/HERO.irig')) await headed();
	};
	const [a, b] = await Promise.all([creates[0].run('Hero', 'A'), creates[0].run('hero', 'B')]);
	const ok = [a, b].filter((r) => r.status === 200).length;
	check(
		'abandoned, both read it first: never both created, the stale folder is gone',
		[ok <= 1, heroKeys().filter((k) => k.includes('/HERO/'))],
		[true, []],
	);
	check(
		'abandoned, both read it first: every create that answered 200 left a whole rig',
		[a.status !== 200 || created('Hero'), b.status !== 200 || created('hero')],
		[true, true],
	);
}

// ── Import an exported rig: begin (convert + claim + presign) → PUT pages → finish (atlas + list) ─
{
	const ATLAS =
		'hero.png\nsize: 4,4\nhead\n  bounds: 0,0,2,2\n\nhero2.png\nsize: 4,4\narm\n  bounds: 0,0,1,1\n';
	const export42 = {
		skeleton: { spine: '4.2.40', hash: 'x' },
		bones: [{ name: 'root' }, { name: 'head', parent: 'root', y: 10 }],
		slots: [{ name: 'head', bone: 'head', attachment: 'head' }],
		skins: [{ name: 'default', attachments: { head: { head: { width: 2, height: 2 } } } }],
		animations: { idle: { bones: { head: { rotate: [{ time: 0.5, value: 10 }] } } } },
	};
	const pages = [
		{ name: 'hero.png', size: 10 },
		{ name: 'hero2.png', size: 10 },
	];
	const begin = (over: Record<string, unknown> = {}) =>
		call(importBegin.POST, {
			name: 'Hero',
			projectKey: 'p1',
			skeleton: export42,
			atlas: ATLAS,
			pages,
			...over,
		});
	const finish = (over: Record<string, unknown> = {}) =>
		call(importFinish.POST, { name: 'Hero', projectKey: 'p1', atlas: ATLAS, ...over });
	const heroFiles = () =>
		[...bucket.keys()]
			.filter((k) => k.startsWith(`${RIGS}/Hero/`))
			.map((k) => k.slice(RIGS.length + 6));

	seedProject();
	const b = await begin();
	const stored = JSON.parse(text(`${RIGS}/Hero/Hero.irig`) ?? '{}');
	check(
		'import: begin converts the export to irig v1, claims it and presigns every atlas page',
		[
			b.status,
			b.body.irig,
			stored.irig,
			stored.skeleton?.importedFrom,
			(b.body.uploads as { name: string; contentType: string }[]).map((u) => [
				u.name,
				u.contentType,
			]),
		],
		[
			200,
			true,
			1,
			'4.2.40',
			[
				['hero.png', 'image/png'],
				['hero2.png', 'image/png'],
			],
		],
	);
	check(
		'import: begin writes no atlas and does not list the rig',
		[heroFiles(), listed().includes('Hero')],
		[['Hero.irig'], false],
	);

	const early = await finish();
	check(
		'import: finish before the pages are up is a 400 and writes no atlas',
		[early.status, /hero\.png/.test(String(early.body.message)), heroFiles()],
		[400, true, ['Hero.irig']],
	);
	seedStore(`${RIGS}/Hero/hero.png`, 'png');
	seedStore(`${RIGS}/Hero/hero2.png`, 'png');
	const done = await finish();
	check(
		'import: finish writes <name>.atlas as sent and lists the rig, keeping the others',
		[done.status, text(`${RIGS}/Hero/Hero.atlas`) === ATLAS, listed()],
		[200, true, ['A', 'B', 'Hero']],
	);
	const again = await finish({ atlas: 'other.png\nsize: 1,1\n' });
	seedStore(`${RIGS}/Hero/other.png`, 'png');
	const replace = await finish({ atlas: 'other.png\nsize: 1,1\n' });
	check(
		'import: finish never replaces an existing atlas',
		[again.status, replace.status, text(`${RIGS}/Hero/Hero.atlas`) === ATLAS],
		[400, 409, true],
	);
	const taken = await begin({ name: 'hero' });
	check('import: a taken name (any case) is a 409', taken.status, 409);

	const refusals: [string, Record<string, unknown>, number][] = [
		['a page the atlas names but was not sent', { pages: [pages[0]] }, 400],
		[
			'an atlas page with a path',
			{ atlas: '../x.png\nsize: 1,1\n', pages: [{ name: '../x.png', size: 1 }] },
			400,
		],
		[
			'an atlas page that is not an image',
			{ atlas: 'x.txt\nsize: 1,1\n', pages: [{ name: 'x.txt', size: 1 }] },
			400,
		],
		['an empty page', { pages: [{ name: 'hero.png', size: 0 }, pages[1]] }, 400],
		['a 3.7 export', { skeleton: { ...export42, skeleton: { spine: '3.7.94' } } }, 422],
		[
			'a slot on a missing bone',
			{ skeleton: { ...export42, slots: [{ name: 's', bone: 'nope' }] } },
			422,
		],
		['JSON that is not a skeleton', { skeleton: { hello: 1 } }, 400],
		['no projectKey', { projectKey: undefined }, 400],
		['another project', { projectKey: 'p2' }, 409],
	];
	for (const [label, over, status] of refusals) {
		seedProject();
		const r = await begin({ name: 'Fresh', ...over });
		check(`import: ${label} is a ${status} and writes nothing`, [r.status, writes], [status, []]);
	}

	seedProject();
	const asIrig = await begin({ name: 'Copy', skeleton: stored });
	check('import: an .irig is taken as it is', [asIrig.status, asIrig.body.irig], [200, true]);

	// A 3.8 export is upgraded on the way in: its rotate key's `angle` becomes `value`.
	seedProject();
	const export38 = {
		...export42,
		skeleton: { spine: '3.8.75' },
		animations: { idle: { bones: { head: { rotate: [{ time: 0.5, angle: 10 }] } } } },
	};
	const from38 = await begin({ name: 'Old', skeleton: export38 });
	const old = JSON.parse(text(`${RIGS}/Old/Old.irig`) ?? '{}');
	check(
		'import: a 3.8 export is upgraded and stored as irig v1',
		[
			from38.status,
			old.irig,
			old.skeleton?.importedFrom,
			old.animations?.idle?.bones?.head?.rotate,
		],
		[200, 1, '4.2', [{ time: 0.5, value: 10 }]],
	);
	const upgraded = await call(importUpgrade.POST, { skeleton: export38 });
	check(
		'import/upgrade answers the 4.2 skeleton and writes nothing; a 3.7 export is a 422',
		[
			upgraded.status,
			upgraded.body.from,
			(upgraded.body.skeleton as { skeleton?: { spine?: string } })?.skeleton?.spine,
			(await call(importUpgrade.POST, { skeleton: { ...export38, skeleton: { spine: '3.7.94' } } }))
				.status,
			writes.filter((w) => w.includes('/Old/')).length,
		],
		[200, '3.8.75', '4.2', 422, 1],
	);

	seedProject();
	seedStore(`${RIGS}/Hero/Hero.irig`, skel('orphan'), STALE);
	seedStore(`${RIGS}/Hero/hero.png`, 'png', STALE);
	const reclaim = await begin();
	check(
		'import: an abandoned import of the same name is reclaimed by the next one',
		[reclaim.status, JSON.parse(text(`${RIGS}/Hero/Hero.irig`) ?? '{}').irig, heroFiles()],
		[200, 1, ['Hero.irig']],
	);
}

// Rig templates (docs/design/rig-templates.md, T1): a create from a template writes the template's
// skeleton over the art's regions, remembers it in `template.json`, and reports the missing parts.
{
	const art = ['body', 'head', 'mouth_rest', 'mouth_A'].map((name, i) => ({
		name,
		x: i * 10,
		y: 0,
		w: 10,
		h: 12,
	}));
	seedProject();
	const tpl = await call(upload.POST, {
		name: 'Bust',
		page: PAGE,
		pageWidth: 40,
		pageHeight: 12,
		regions: art,
		templateId: 'bust-face',
	});
	const t = tpl.body.template as { id: string; missingRequired: string[]; missing: string[] };
	const doc = JSON.parse(text(`${RIGS}/Bust/Bust.irig`) ?? '{}') as {
		skins: { attachments: Record<string, Record<string, { width: number }>> }[];
	};
	// ＋ New rig makes the built-in (bust-face, version 3: the face block with depth).
	check(
		'template upload: created, remembered, required gaps reported',
		[tpl.status, t.id, t.missingRequired, JSON.parse(text(`${RIGS}/Bust/template.json`) ?? '{}')],
		[
			200,
			'bust-face',
			['eyelid_l_closed', 'eyelid_r_closed', 'brow_l_neutral', 'brow_r_neutral', 'mouth_O'],
			{ id: 'bust-face', version: 3 },
		],
	);
	check(
		'template upload: the art attaches by name, a missing shape is left out',
		[Object.keys(doc.skins[0].attachments.mouth), doc.skins[0].attachments.mouth.mouth_A.width],
		[['mouth_rest', 'mouth_A'], 10],
	);
	check(
		'template upload: an existing-rig skeleton never gets a template.json',
		text(`${RIGS}/A/template.json`),
		null,
	);

	seedProject();
	const both = await call(upload.POST, {
		name: 'Both',
		page: PAGE,
		pageWidth: 40,
		pageHeight: 12,
		regions: art,
		templateId: 'bust-face',
		rigId: 'lib',
	});
	const unknown = await call(newRig.POST, { noAtlas: true, name: 'U', templateId: 'nope' });
	check(
		'template: a saved rig AND a template, or an unknown template, create nothing',
		[both.status, unknown.status, text(`${RIGS}/Both/Both.irig`), text(`${RIGS}/U/U.irig`)],
		[400, 404, null, null],
	);

	seedProject();
	const bare = await call(newRig.POST, { noAtlas: true, name: 'Blank', templateId: 'bust-face' });
	const bareT = bare.body.template as { missingRequired: string[] };
	check(
		'template new without art: listed, remembered, every required part reported',
		[
			bare.status,
			listed(),
			text(`${RIGS}/Blank/template.json`) !== null,
			bareT.missingRequired.length,
		],
		[200, ['A', 'B', 'Blank'], true, 9],
	);
	const gone = await call(del.POST, { dir: b64('Blank'), skeleton_file: 'Blank.irig' });
	check(
		'template: deleting the rig takes its template.json with it',
		[gone.status, text(`${RIGS}/Blank/template.json`)],
		[200, null],
	);

	seedProject();
	const body = await call(upload.POST, {
		name: 'Hero',
		page: PAGE,
		pageWidth: 40,
		pageHeight: 12,
		regions: ['torso', 'head', 'hand_l_open', 'hand_l_fist'].map((name, i) => ({
			name,
			x: i * 10,
			y: 0,
			w: 10,
			h: 12,
		})),
		templateId: 'full-body',
	});
	const bodyT = body.body.template as { missingRequired: string[] };
	const heroDoc = JSON.parse(text(`${RIGS}/Hero/Hero.irig`) ?? '{}') as {
		skins: { attachments: Record<string, Record<string, unknown>> }[];
	};
	check(
		'full-body upload: remembered, hands attach by name, the needed limbs reported',
		[
			body.status,
			JSON.parse(text(`${RIGS}/Hero/template.json`) ?? '{}'),
			Object.keys(heroDoc.skins[0].attachments.hand_l),
			bodyT.missingRequired.includes('hand_r_open') && bodyT.missingRequired.includes('foot_l'),
		],
		[200, { id: 'full-body', version: 2 }, ['hand_l_open', 'hand_l_fist'], true],
	);

	const half = await call(upload.POST, {
		name: 'Waver',
		page: PAGE,
		pageWidth: 50,
		pageHeight: 12,
		regions: ['torso', 'head', 'hand_l', 'hand_l_fist', 'index_1_l'].map((name, i) => ({
			name,
			x: i * 10,
			y: 0,
			w: 10,
			h: 12,
		})),
		templateId: 'half-body',
	});
	const halfT = half.body.template as { missingRequired: string[] };
	const waverDoc = JSON.parse(text(`${RIGS}/Waver/Waver.irig`) ?? '{}') as {
		skins: { attachments: Record<string, Record<string, unknown>> }[];
	};
	check(
		'half-body upload: remembered, the hand and a finger segment attach by name, the arms reported',
		[
			half.status,
			JSON.parse(text(`${RIGS}/Waver/template.json`) ?? '{}'),
			Object.keys(waverDoc.skins[0].attachments.hand_l),
			Object.keys(waverDoc.skins[0].attachments.index_1_l),
			halfT.missingRequired.includes('hand_r') && halfT.missingRequired.includes('upper_arm_l'),
		],
		[200, { id: 'half-body', version: 2 }, ['hand_l', 'hand_l_fist'], ['index_1_l'], true],
	);
}

// 📐 Save as template (docs/design/rig-templates.md §7): the shared template store through its real
// routes — create, a taken name, a new version, a stale confirm, refusals, the list, a New rig from a
// saved template, the version a rig remembers, a racing create, and delete.
{
	const { BUST_FACE, templateRig } = await import('../src/lib/server/rigTemplates.ts');
	const T = '_shared/rig-templates/my_bust';
	const art = BUST_FACE.parts.map((p) => ({ name: p.name, w: p.size[0], h: p.size[1] }));
	const rig = {
		...templateRig(BUST_FACE, art).skeleton,
		animations: {
			wave: {
				bones: { head: { rotate: [{ value: 0 }, { time: 0.5, value: 8 }, { time: 1, value: 0 }] } },
			},
		},
	};
	const spec = (extra: Record<string, unknown> = {}) => ({
		label: 'My bust',
		required: BUST_FACE.parts.filter((p) => p.required).map((p) => p.name),
		channels: BUST_FACE.channels,
		clips: ['wave'],
		motion: BUST_FACE.motion,
		...extra,
	});
	const save = (baseEtag: string | null, project = 'p1', s = spec(), caller = 'solo') =>
		call(tplSave.POST, { name: 'My bust', rig, spec: s, baseEtag }, project, caller);
	const head = () =>
		JSON.parse(text(`${T}/head.json`) ?? 'null') as { version: number; project: string } | null;
	const tplKeys = () =>
		[...bucket.keys()].filter((k) => k.startsWith('_shared/rig-templates/')).sort();
	const get = async (handler: Handler, query = '') => {
		const url = new URL(`http://launcher.test/api${query}`);
		const res = await handler({
			url,
			locals: { user: { id: 'u', role: 'artist' }, project: 'p1' },
			cookies: { get: () => 'session-token' },
		} as never);
		return (await res.json()) as Record<string, unknown>;
	};
	type Summary = {
		id: string;
		version: number;
		origin: string;
		clips: { name: string }[];
		saved?: { project: string; etag: string };
	};

	reset();
	const created = await save(null);
	check(
		'template: a new name is version 1, the version written before the head',
		[created.status, created.body.id, created.body.version, writes],
		[200, 'my_bust', 1, [`put ${T}/v1.json`, `put ${T}/head.json`]],
	);
	check(
		'template: the create answers the head etag',
		created.body.etag,
		bucket.get(`${T}/head.json`)?.etag,
	);
	const v1Tag = bucket.get(`${T}/v1.json`)?.etag;

	const list = (await get(tplList.GET)).templates as Summary[];
	check(
		'template list: the built-ins, then the saved one at its version, with who saved it',
		list.map((t) => [t.id, t.version, t.origin, t.saved?.project ?? null]),
		[
			['bust-face', 3, 'builtin', null],
			['full-body', 2, 'builtin', null],
			['half-body', 2, 'builtin', null],
			['my_bust', 1, 'user', 'p1'],
		],
	);
	check(
		'template list: a saved template carries its own clip as timelines',
		list[3].clips.map((c) => c.name),
		['wave'],
	);

	writes.length = 0;
	const taken = await save(null, 'p2');
	check(
		'template: a taken name is 409 exists with the head etag, version and project; nothing written',
		[
			taken.status,
			taken.body.error,
			taken.body.etag,
			taken.body.version,
			taken.body.project,
			writes,
		],
		[409, 'exists', created.body.etag, 1, 'p1', []],
	);
	const v2 = await save(taken.body.etag as string, 'p2');
	check(
		'template: the confirmed save is version 2; version 1 is never rewritten',
		[
			v2.status,
			v2.body.version,
			head()?.version,
			head()?.project,
			bucket.get(`${T}/v1.json`)?.etag,
		],
		[200, 2, 2, 'p2', v1Tag],
	);
	writes.length = 0;
	const stale = await save(created.body.etag as string, 'p3');
	check(
		'template: a stale confirm is 409 conflict naming the current head; nothing written',
		[stale.status, stale.body.error, stale.body.etag, stale.body.version, writes],
		[409, 'conflict', v2.body.etag, 2, []],
	);
	const forced = await call(tplSave.POST, { name: 'My bust', rig, spec: spec(), force: true });
	const noTag = await call(tplSave.POST, { name: 'My bust', rig, spec: spec() });
	check(
		'template: a forced or precondition-less save is a 400',
		[forced.status, noTag.status],
		[400, 400],
	);

	writes.length = 0;
	const refusals: [string, Record<string, unknown>, RegExp][] = [
		[
			'a control on a bone the rig lacks',
			{
				...spec(),
				channels: [
					{
						id: 'tail',
						label: 'Tail',
						tip: '',
						min: 0,
						max: 1,
						rest: 0,
						drives: [{ bone: 'tail', prop: 'rotate', per: 1 }],
					},
				],
			},
			/drives a missing bone "tail"/,
		],
		['a field the template does not have', { ...spec(), colour: 'red' }, /Unrecognized key/],
		['a needed part the rig lacks', { ...spec(), required: ['wings'] }, /"wings" is marked needed/],
	];
	for (const [label, s, want] of refusals) {
		const r = await save(v2.body.etag as string, 'p1', s as ReturnType<typeof spec>);
		check(
			`template: ${label} is refused (422) with the reason`,
			[r.status, want.test(String(r.body.message))],
			[422, true],
		);
	}
	const deform = await call(tplSave.POST, {
		name: 'My bust',
		rig: { ...rig, animations: { wave: { attachments: { default: {} } } } },
		spec: spec(),
		baseEtag: v2.body.etag,
	});
	check(
		'template: a starter clip with a mesh deform is refused (422)',
		[deform.status, /"attachments" timelines/.test(String(deform.body.message))],
		[422, true],
	);
	check('template: no refusal wrote anything', writes, []);

	// A New rig from the saved template: its art attaches by name, the bundle remembers v2.
	const kept = tplKeys().map((k) => [k, bucket.get(k)!] as const);
	seedProject();
	for (const [k, o] of kept) bucket.set(k, o);
	const kid = await call(upload.POST, {
		name: 'Kid',
		page: PAGE,
		pageWidth: 40,
		pageHeight: 12,
		regions: ['body', 'head', 'mouth_rest', 'mouth_A'].map((name, i) => ({
			name,
			x: i * 10,
			y: 0,
			w: 10,
			h: 12,
		})),
		templateId: 'my_bust',
	});
	const kidT = kid.body.template as { id: string; version: number; missingRequired: string[] };
	const kidDoc = JSON.parse(text(`${RIGS}/Kid/Kid.irig`) ?? '{}') as {
		skins: { attachments: Record<string, Record<string, unknown>> }[];
	};
	check(
		'template: a New rig from a saved template attaches its art and remembers id + version',
		[
			kid.status,
			kidT.id,
			kidT.missingRequired.includes('mouth_O'),
			Object.keys(kidDoc.skins[0].attachments.mouth),
			JSON.parse(text(`${RIGS}/Kid/template.json`) ?? '{}'),
		],
		[200, 'my_bust', true, ['mouth_rest', 'mouth_A'], { id: 'my_bust', version: head()?.version }],
	);
	const open = (await get(tplOne.GET, `?dir=${b64('Kid')}`)).template as Summary | null;
	check(
		'template: the open rig gets its saved template, controls and clips',
		[open?.id, open?.origin, open?.version, open?.clips.map((c) => c.name)],
		['my_bust', 'user', head()?.version, ['wave']],
	);
	// Only the latest version of a built-in is kept: a rig that names another one opens as a rig with
	// no template (no Controls; its keys are plain timelines, so it still plays).
	const builtinAt = async (version: number) => {
		seedStore(`${RIGS}/Old/template.json`, JSON.stringify({ id: 'bust-face', version }));
		const t = (await get(tplOne.GET, `?dir=${b64('Old')}`)).template as
			(Summary & { channels: unknown[] }) | null;
		return t ? [t.version, t.channels.length] : null;
	};
	check(
		'template: a rig made from the built-in opens with it; one naming a version we no longer keep, with none',
		[await builtinAt(1), await builtinAt(2), await builtinAt(BUST_FACE.version)],
		[null, null, [BUST_FACE.version, BUST_FACE.channels.length]],
	);

	// Racing creates of one name: B lists while A's version is written but its head is not, so B
	// takes the next number and wins the head; A's create-only head is refused and nothing of A shows.
	reset();
	let releaseA = () => {};
	const aHeld = new Promise<void>((r) => (releaseA = r));
	let aWrote = () => {};
	const aVersion = new Promise<void>((r) => (aWrote = r));
	afterPut = async (key, caller) => {
		if (caller === 'A' && key === `${T}/v1.json`) {
			aWrote();
			await aHeld;
		}
	};
	const a = save(null, 'p1', spec(), 'A');
	await aVersion;
	const b = await save(null, 'p2', spec(), 'B');
	releaseA();
	const aDone = await a;
	afterPut = null;
	check(
		'template race: B takes version 2 past A’s unfinished v1, A is a 409 conflict',
		[b.status, b.body.version, aDone.status, aDone.body.error, head()?.version, head()?.project],
		[200, 2, 409, 'conflict', 2, 'p2'],
	);
	const next = await save(b.body.etag as string);
	check('template race: the next save steps over the orphan to version 3', next.body.version, 3);

	// A rig remembers the exact version it was made from, not the newest.
	for (const v of [2, 3]) {
		seedStore(`${RIGS}/Kid/template.json`, JSON.stringify({ id: 'my_bust', version: v }));
		check(
			`template: a rig made from v${v} opens with v${v}'s template`,
			((await get(tplOne.GET, `?dir=${b64('Kid')}`)).template as Summary | null)?.version,
			v,
		);
	}
	const v2Text = text(`${T}/v2.json`);

	// Delete: conditional on the head the author saw; then the template is gone everywhere.
	const tag = bucket.get(`${T}/head.json`)?.etag;
	writes.length = 0;
	const staleDel = await call(tplDelete.POST, { id: 'my_bust', etag: b.body.etag });
	check(
		'template delete: a stale etag is 409, nothing deleted',
		[staleDel.status, writes],
		[409, []],
	);
	const builtinDel = await call(tplDelete.POST, { id: 'bust-face', etag: 'x' });
	check('template delete: a built-in cannot be deleted', builtinDel.status, 400);
	const gone = await call(tplDelete.POST, { id: 'my_bust', etag: tag });
	check(
		'template delete: the head goes first, then every version',
		[gone.status, writes[0], tplKeys()],
		[200, `delete ${T}/head.json`, []],
	);
	check(
		'template delete: no longer listed, and a New rig from it is a 404',
		[
			((await get(tplList.GET)).templates as Summary[]).map((t) => t.id),
			(await call(newRig.POST, { noAtlas: true, name: 'Late', templateId: 'my_bust' })).status,
		],
		[['bust-face', 'full-body', 'half-body'], 404],
	);
	seedStore(`${RIGS}/Kid/template.json`, JSON.stringify({ id: 'my_bust', version: 2 }));
	check(
		'template delete: a rig made from it opens with no template (its keys stay ordinary timelines)',
		(await get(tplOne.GET, `?dir=${b64('Kid')}`)).template,
		null,
	);
	// A delete that died after the head left its versions: still no template anywhere.
	seedStore(`${T}/v2.json`, v2Text ?? '');
	check(
		'template delete: versions left behind by a half-done delete are no template',
		[
			(await get(tplOne.GET, `?dir=${b64('Kid')}`)).template,
			((await get(tplList.GET)).templates as Summary[]).map((t) => t.origin),
			(await call(newRig.POST, { noAtlas: true, name: 'Later', templateId: 'my_bust' })).status,
		],
		[null, ['builtin', 'builtin', 'builtin'], 404],
	);

	// Two first saves of one name that both list before either writes: both pick version 1, and
	// the create-only version write lets only one of them land it.
	reset();
	let bListed = () => {};
	const bDone = new Promise<void>((r) => (bListed = r));
	let aAtPut = () => {};
	const aReady = new Promise<void>((r) => (aAtPut = r));
	beforePut = async (key, caller) => {
		if (caller === 'A' && key === `${T}/v1.json`) {
			aAtPut();
			await bDone;
		}
	};
	const first = save(null, 'p1', spec({ label: 'From A' }), 'A');
	await aReady;
	const second = await save(null, 'p2', spec({ label: 'From B' }), 'B');
	bListed();
	const firstDone = await first;
	beforePut = null;
	check(
		'template race: of two version-1 writes only one lands; the other is a 409 and v1 stays its',
		[
			second.status,
			second.body.version,
			firstDone.status,
			JSON.parse(text(`${T}/v1.json`) ?? '{}').label,
		],
		[200, 1, 409, 'From B'],
	);
}

// ── A 2.5D rig: its `.irig` and its `rig3d.json`, written together (docs/design/rig-2p5d.md, P2) ──
{
	const H = `${RIGS}/H`;
	const IRIG = `${H}/H.irig`;
	const SIDE = `${H}/rig3d.json`;
	const BACKUPS = `${irigBackupsPrefix(CLIENT, 'p1', 'H', 'H')}`;
	type Doc = Record<string, unknown> & { animations: Record<string, Record<string, unknown>> };
	const seed3d = (): void => {
		reset();
		seedStore(IRIG, JSON.stringify(rig3dFx.irigOf()));
		seedStore(`${H}/H.atlas`, 'H.png\nsize: 1,1\n');
		seedStore(`${H}/H.png`, 'png');
		const skeletons = [{ ...entry('H'), id: 0 }];
		seedStore(`${RIGS}/skeletons.json`, JSON.stringify({ prefix: RIGS, skeletons }));
	};
	const tag = (key: string) => bucket.get(key)?.etag;
	const stored = (key: string): Doc => JSON.parse(text(key) ?? '{}');
	/** What a tab holds after opening the stored rig: the Rigger fills key defaults on load. */
	const opened = (): Doc => rig3dFx.asRiggerLoads(stored(IRIG));
	const save2d = (skeleton: unknown, extra: object = {}, caller = 'solo') =>
		call(
			irigSave.POST,
			{ dir: b64('H'), stem: 'H', skeleton, projectKey: 'p1', baseEtag: tag(IRIG), ...extra },
			'p1',
			caller,
		);
	const save3d = (skeleton: unknown, rig3d: unknown, extra: object = {}, caller = 'solo') =>
		save2d(skeleton, { rig3d, rig3dBaseEtag: tag(SIDE) ?? null, ...extra }, caller);
	const pairWrites = () => writes.filter((w) => w === `put ${SIDE}` || w === `put ${IRIG}`);
	const bakedArm = (doc: Doc) => (doc.animations.reach.bones as Record<string, unknown>).upper_arm;
	const history = async () =>
		(await get(backupsRoute.GET, { dir: b64('H'), stem: 'H' })).body.backups as {
			id: string;
			rig3d: boolean;
		}[];

	seed3d();
	const sidecar = rig3dFx.sidecarOf('H');
	const made = await save3d(rig3dFx.irigOf(), { ...sidecar, rig: 'someone-else' });
	const side = stored(SIDE) as unknown as {
		rig: string;
		clips: { reach: { baked: { hash: string; bones: string[]; slots: string[] } } };
	};
	check(
		'rig3d: a 3D save writes the sidecar, then the .irig, in one request, and bakes the 3D clip',
		[made.status, made.body.rebaked, pairWrites(), made.body.etag, made.body.rig3dEtag],
		[200, ['reach'], [`put ${SIDE}`, `put ${IRIG}`], tag(IRIG), tag(SIDE)],
	);
	check(
		'rig3d: the sidecar is bound to its rig and records what the bake owns',
		[side.rig, side.clips.reach.baked.bones, side.clips.reach.baked.slots],
		['H', ['chest', 'upper_arm', 'forearm', 'hand', 'hand_image'], ['hand']],
	);
	const afterMade = stored(IRIG);
	check(
		"rig3d: the .irig holds the bake, the follower's derived setup, and its 2D clip as it was",
		[
			Array.isArray((bakedArm(afterMade) as { rotate?: unknown }).rotate),
			(afterMade.bones as { name: string; x?: number }[]).find((b) => b.name === 'hand_image')
				?.x !== undefined,
			afterMade.animations.idle,
		],
		[true, true, rig3dFx.irigOf().animations.idle],
	);
	const got = await get(irigSave.GET, { dir: b64('H'), stem: 'H' });
	const got3d = got.body.rig3d as { etag: string; doc: { rig: string } };
	check(
		'rig3d: the precondition GET answers the sidecar and its etag with the .irig etag',
		[got.body.etag, got3d.etag, got3d.doc.rig],
		[tag(IRIG), tag(SIDE), 'H'],
	);

	// Today's 2D Rigger (it sends no `rig3d`) saving the rig it opened, unchanged.
	writes.length = 0;
	const sideTag = tag(SIDE);
	const plain = await save2d(opened());
	check(
		"rig3d: today's Rigger saving the 3D rig unchanged bakes nothing and leaves the sidecar alone",
		[plain.status, plain.body.rebaked, pairWrites(), tag(SIDE), plain.body.rig3dEtag],
		[200, [], [`put ${IRIG}`], sideTag, sideTag],
	);
	check(
		"rig3d: the .irig's backup keeps a copy of its sidecar",
		[
			(await history())[0].rig3d,
			text(`${BACKUPS}${(await history())[0].id}.rig3d.json`) === text(SIDE),
		],
		[true, true],
	);

	const elsewhere = opened();
	(
		elsewhere.animations.idle.bones as Record<string, { rotate: { value: number }[] }>
	).chest.rotate[1].value = 9;
	const tinted = await save2d(elsewhere);
	check(
		'rig3d: a 2D edit of what the bake does not own (a 2D clip) saves, unbaked',
		[
			tinted.status,
			tinted.body.rebaked,
			stored(IRIG).animations.idle.bones as typeof elsewhere.animations.idle.bones,
		],
		[200, [], elsewhere.animations.idle.bones],
	);

	// A 2D edit of a baked track: refused, nothing written, and what changed is named.
	const keyed = opened();
	(bakedArm(keyed) as { rotate: { value: number }[] }).rotate[1].value += 25;
	writes.length = 0;
	const refused = await save2d(keyed);
	const clips = refused.body.clips as { clip: string; parts: string[] }[] | undefined;
	check(
		'rig3d: a 2D edit of a baked track is refused (baked-edited), naming the clip and the bone, writing nothing',
		[refused.status, refused.body.error, clips?.[0]?.clip, clips?.[0]?.parts, writes],
		[409, 'baked-edited', 'reach', ['upper_arm'], []],
	);
	check(
		'rig3d: …with a message today’s Rigger shows as it is',
		/Not saved — clip "reach" is baked from 3D keys/.test(String(refused.body.message)),
		true,
	);
	const gone = opened();
	delete gone.animations.reach;
	const removed = await save2d(gone);
	check(
		'rig3d: deleting (or renaming) a 3D clip in 2D is refused the same way',
		[removed.status, removed.body.error, (removed.body.clips as { parts: string[] }[])[0].parts],
		[409, 'baked-edited', ['the whole clip, deleted or renamed']],
	);

	const armBefore = JSON.stringify(bakedArm(stored(IRIG)));
	const rebaked = await save2d(keyed, { resolve: { reach: 'rebake' } });
	check(
		'rig3d: `resolve: rebake` lets 3D win: the 2D edit is baked over',
		[rebaked.status, rebaked.body.rebaked, JSON.stringify(bakedArm(stored(IRIG))) === armBefore],
		[200, ['reach'], true],
	);
	const detached = await save2d(keyed, { resolve: { reach: 'detach' } });
	check(
		'rig3d: `resolve: detach` keeps the 2D edit and the clip leaves the sidecar as a plain 2D clip',
		[
			detached.status,
			detached.body.detached,
			'reach' in ((stored(SIDE) as { clips?: object }).clips ?? {}),
			JSON.stringify(bakedArm(stored(IRIG))) === JSON.stringify(bakedArm(keyed)),
		],
		[200, ['reach'], false, true],
	);

	// A tab that keeps the rig open after its own save re-baked it: it still holds the earlier bake.
	seed3d();
	await save3d(rig3dFx.irigOf(), sidecar);
	const tab = opened();
	(tab.bones as { name: string; x?: number }[]).find((b) => b.name === 'upper_arm')!.x = 86;
	const moved = await save2d(tab);
	const afterMove = JSON.stringify(bakedArm(stored(IRIG)));
	const again = await save2d(tab);
	check(
		'rig3d: moving a baked bone in 2D re-bakes the clip; the tab saving again (holding the bake before) is no 2D edit',
		[
			moved.status,
			moved.body.rebaked,
			again.status,
			again.body.rebaked,
			JSON.stringify(bakedArm(stored(IRIG))) === afterMove,
		],
		[200, ['reach'], 200, ['reach'], true],
	);

	// A drawing the 3D data names, deleted in 2D: the sidecar no longer fits, so the save is refused.
	const unart = opened();
	const skin = (unart.skins as { attachments: Record<string, Record<string, unknown>> }[])[0];
	delete skin.attachments.hand.hand_side_l;
	writes.length = 0;
	const misfit = await save2d(unart);
	check(
		'rig3d: a 2D save that leaves the 3D data naming a missing drawing is refused (rig3d-invalid), writing nothing',
		[
			misfit.status,
			misfit.body.error,
			/drawing hand_side_l is not one of its attachments/.test(String(misfit.body.message)),
			writes,
		],
		[422, 'rig3d-invalid', true, []],
	);
	// A bone the bake owns, renamed in 2D: its baked timelines moved, which is a 2D edit.
	const renamed = opened();
	for (const b of renamed.bones as { name: string; parent?: string }[]) {
		if (b.name === 'forearm') b.name = 'lower_arm';
		if (b.parent === 'forearm') b.parent = 'lower_arm';
	}
	for (const s of renamed.slots as { bone: string }[])
		if (s.bone === 'forearm') s.bone = 'lower_arm';
	const reachBones = renamed.animations.reach.bones as Record<string, unknown>;
	reachBones.lower_arm = reachBones.forearm;
	delete reachBones.forearm;
	const rename = await save2d(renamed);
	check(
		'rig3d: renaming a baked bone in 2D is refused, naming it',
		[rename.status, rename.body.error, (rename.body.clips as { parts: string[] }[])[0].parts],
		[409, 'baked-edited', ['forearm']],
	);

	// The turnaround is chosen once.
	writes.length = 0;
	const turned = await save3d(opened(), { ...sidecar, turnaround: 'full' });
	check(
		'rig3d: changing the turnaround is refused (turnaround-fixed), writing nothing',
		[turned.status, turned.body.error, writes],
		[422, 'turnaround-fixed', []],
	);

	// The sidecar's own precondition.
	const staleSide = await save2d(opened(), { rig3d: sidecar, rig3dBaseEtag: '"stale"' });
	check(
		'rig3d: a 3D save on a stale sidecar etag is a 409 conflict carrying the current one, writing nothing',
		[staleSide.status, staleSide.body.error, staleSide.body.rig3dEtag, writes],
		[409, 'conflict', tag(SIDE), []],
	);
	const noBase = await save2d(opened(), { rig3d: sidecar });
	const badResolve = await save2d(opened(), { resolve: { reach: 'merge' } });
	check(
		'rig3d: a 3D save with no rig3dBaseEtag, or a resolve that is not rebake / detach, is a 400',
		[noBase.status, badResolve.status],
		[400, 400],
	);
	const staleIrig = await save2d(opened(), {
		baseEtag: '"stale"',
		rig3d: { ...sidecar, hysteresis: 9 },
		rig3dBaseEtag: tag(SIDE),
	});
	check(
		'rig3d: a 3D save on a stale .irig etag is a 409 that writes nothing, not even a sidecar to put back',
		[staleIrig.status, staleIrig.body.error, writes],
		[409, 'conflict', []],
	);
	const staleEdit = opened();
	(bakedArm(staleEdit) as { rotate: { value: number }[] }).rotate[1].value += 25;
	const staleEdited = await save2d(staleEdit, { baseEtag: '"stale"' });
	check(
		'rig3d: a stale save is answered as a conflict first (the overwrite prompt), before what it changed',
		[staleEdited.status, staleEdited.body.error, staleEdited.body.etag],
		[409, 'conflict', tag(IRIG)],
	);
	const sideRecord = JSON.stringify((stored(SIDE) as unknown as typeof side).clips.reach.baked);
	const forged = structuredClone(stored(SIDE)) as unknown as typeof side;
	forged.clips.reach.baked.hash = 'forged';
	const ignored = await save3d(opened(), forged);
	check(
		"rig3d: a client's bake record is ignored: the save's own is kept",
		[
			ignored.status,
			ignored.body.rebaked,
			JSON.stringify((stored(SIDE) as unknown as typeof side).clips.reach.baked) === sideRecord,
		],
		[200, [], true],
	);
	// Someone saves the 3D data between this save's checks and its sidecar write.
	const racing = JSON.stringify({ ...stored(SIDE), hysteresis: 7 });
	beforePut = async (key, caller) => {
		if (caller !== 'A' || key !== SIDE) return;
		beforePut = null;
		await put(SIDE, enc.encode(racing));
	};
	writes.length = 0;
	const irigUntouched = text(IRIG);
	const overtaken = await save3d(opened(), { ...sidecar, hysteresis: 8 }, {}, 'A');
	check(
		'rig3d: a sidecar written by someone else since this save read it is a 409, and the .irig is not written',
		[overtaken.status, overtaken.body.error, text(SIDE) === racing, text(IRIG) === irigUntouched],
		[409, 'conflict', true, true],
	);
	await save3d(opened(), sidecar);
	const ik = opened();
	ik.ik = [{ name: 'reach', bones: ['forearm'], target: 'hand', mix: 1 }];
	const constrained = await save2d(ik);
	check(
		'rig3d: a constraint added in 2D on a baked bone is refused before any bake, naming it',
		[
			constrained.status,
			constrained.body.error,
			/does not fit it: constraint ik reach acts on forearm/.test(String(constrained.body.message)),
		],
		[422, 'rig3d-invalid', true],
	);

	// The .irig loses its race after the sidecar landed: the sidecar is put back as it was.
	const sideBytes = text(SIDE);
	const sideEtag = tag(SIDE);
	const theirs = JSON.stringify({ ...stored(IRIG), skeleton: { hash: 'theirs' } });
	afterPut = async (key, caller) => {
		if (caller === 'A' && key === SIDE) await put(IRIG, enc.encode(theirs));
	};
	const lost = await save3d(opened(), { ...sidecar, hysteresis: 9 }, {}, 'A');
	afterPut = null;
	check(
		'rig3d: when the .irig loses its race after the sidecar was written, the sidecar is put back and nothing of the save stays',
		[lost.status, lost.body.error, text(SIDE) === sideBytes, tag(SIDE), text(IRIG) === theirs],
		[409, 'conflict', true, sideEtag, true],
	);
	seed3d();
	afterPut = async (key, caller) => {
		if (caller === 'A' && key === SIDE)
			await put(IRIG, enc.encode(JSON.stringify({ ...rig3dFx.irigOf(), skeleton: { hash: 'b' } })));
	};
	const lostCreate = await save3d(rig3dFx.irigOf(), sidecar, {}, 'A');
	afterPut = null;
	check(
		'rig3d: …and a sidecar the save created is removed again',
		[lostCreate.status, bucket.has(SIDE)],
		[409, false],
	);

	// History: a restore puts back the rig as it was then, 3D data included (or not).
	seed3d();
	await save3d(rig3dFx.irigOf(), sidecar);
	await save2d(opened());
	const kept = await history();
	check(
		'rig3d: the history lists which versions had 3D data',
		kept.map((b) => b.rig3d),
		[true, false],
	);
	const pairBefore = [text(IRIG), text(SIDE)];
	// The restore's .irig loses its race: the sidecar it would remove is never touched.
	const theirIrig = JSON.stringify({ ...stored(IRIG), skeleton: { hash: 'theirs' } });
	beforePut = async (key, caller) => {
		if (caller !== 'A' || key !== IRIG) return;
		beforePut = null;
		await put(IRIG, enc.encode(theirIrig));
	};
	writes.length = 0;
	const lostRestore = await call(
		backupsRoute.POST,
		{ dir: b64('H'), stem: 'H', id: kept[1].id, projectKey: 'p1', baseEtag: tag(IRIG) },
		'p1',
		'A',
	);
	check(
		'rig3d: a restore that loses its race never deletes the sidecar it would have removed',
		[lostRestore.status, writes.some((w) => w.endsWith(SIDE)), text(SIDE) === pairBefore[1]],
		[409, false, true],
	);
	seedStore(IRIG, pairBefore[0] ?? '');
	// Someone writes the sidecar after the restore's .irig landed: theirs stays.
	const newer = JSON.stringify({ ...JSON.parse(pairBefore[1] ?? '{}'), hysteresis: 5 });
	afterPut = async (key, caller) => {
		if (caller !== 'A' || key !== IRIG) return;
		afterPut = null;
		await put(SIDE, enc.encode(newer));
	};
	const raced = await call(
		backupsRoute.POST,
		{ dir: b64('H'), stem: 'H', id: kept[1].id, projectKey: 'p1', baseEtag: tag(IRIG) },
		'p1',
		'A',
	);
	check(
		'rig3d: …and one whose sidecar is written after its .irig landed leaves that newer sidecar',
		[raced.status, text(SIDE) === newer, raced.body.rig3dEtag === tag(SIDE)],
		[200, true, true],
	);
	seedStore(IRIG, pairBefore[0] ?? '');
	seedStore(SIDE, pairBefore[1] ?? '');
	const to2d = await call(backupsRoute.POST, {
		dir: b64('H'),
		stem: 'H',
		id: kept[1].id,
		projectKey: 'p1',
		baseEtag: tag(IRIG),
	});
	check(
		'rig3d: restoring a version from before the rig had 3D data removes its sidecar',
		[to2d.status, bucket.has(SIDE), text(IRIG) === JSON.stringify(rig3dFx.irigOf())],
		[200, false, true],
	);
	const undo = (await history())[0];
	const back3d = await call(backupsRoute.POST, {
		dir: b64('H'),
		stem: 'H',
		id: undo.id,
		projectKey: 'p1',
		baseEtag: tag(IRIG),
	});
	check(
		'rig3d: …and restoring the version that restore replaced puts the pair back, byte for byte',
		[undo.rig3d, back3d.status, [text(IRIG), text(SIDE)]],
		[true, 200, pairBefore],
	);
	seedStore(SIDE, JSON.stringify({ ...stored(SIDE), hysteresis: 1 }));
	writes.length = 0;
	const staleRestore = await call(backupsRoute.POST, {
		dir: b64('H'),
		stem: 'H',
		id: undo.id,
		projectKey: 'p1',
		baseEtag: '"stale"',
	});
	check(
		'rig3d: a restore on a stale .irig etag is a 409 that writes nothing (no backup, no sidecar)',
		[staleRestore.status, staleRestore.body.error, writes],
		[409, 'conflict', []],
	);
	seedStore(SIDE, JSON.stringify({ ...sidecar, rig: 'G' }));
	const intoOther = await call(backupsRoute.POST, {
		dir: b64('H'),
		stem: 'H',
		id: undo.id,
		projectKey: 'p1',
		baseEtag: tag(IRIG),
	});
	check(
		"rig3d: a restore never puts its 3D data over another rig's",
		[intoOther.status, JSON.parse(text(SIDE) ?? '{}').rig],
		[409, 'G'],
	);
	seedStore(SIDE, pairBefore[1] ?? '');

	// Retention prunes a backup's sidecar copy with it.
	const oldIds = Array.from(
		{ length: 22 },
		(_, i) => `irig-20260101T0000000${String(i).padStart(2, '0')}Z-0000000${i % 10}`,
	);
	for (const id of oldIds) {
		seedStore(`${BACKUPS}${id}.json`, JSON.stringify(rig3dFx.irigOf()));
		seedStore(`${BACKUPS}${id}.rig3d.json`, text(SIDE) ?? '');
	}
	await save2d(opened());
	const left = [...bucket.keys()].filter((k) => k.startsWith(BACKUPS));
	const copies = left.filter((k) => k.endsWith('.rig3d.json'));
	check(
		'rig3d: retention keeps 20 backups and drops the oldest with their sidecar copies, leaving none behind',
		[
			left.length - copies.length,
			copies.every((k) => left.includes(k.replace(/\.rig3d\.json$/, '.json'))),
			left.some((k) => k.startsWith(`${BACKUPS}${oldIds[0]}`)),
		],
		[20, true, false],
	);

	// The skeleton index never lists the sidecar, even one whose head reads like a skeleton.
	seedStore(SIDE, JSON.stringify({ rig3d: 1, rig: 'H', bones: { skeleton: { depth: 1 } } }));
	await call(reindex.POST, { projectKey: 'p1' });
	check(
		'rig3d: the reindex lists the .irig and ignores rig3d.json',
		(
			JSON.parse(text(`${RIGS}/skeletons.json`) ?? '{}').skeletons as {
				folder: string;
				skeleton_file: string;
			}[]
		)
			.filter((s) => s.folder === 'H')
			.map((s) => s.skeleton_file),
		['H.irig'],
	);
	seedStore(
		`${RIGS}/X/rig3d.json`,
		JSON.stringify({ rig3d: 1, rig: 'X', bones: { skeleton: {} } }),
	);
	const leftover = await call(reindex.POST, { projectKey: 'p1' });
	check(
		'rig3d: …nor takes a folder holding only a sidecar for an atlas-less rig',
		(leftover.body.atlasMissing as string[]).includes('X'),
		false,
	);

	// Someone else's, unreadable, or left over.
	seed3d();
	seedStore(SIDE, JSON.stringify({ ...sidecar, rig: 'G' }));
	const otherBytes = text(SIDE);
	const besideOther = await save2d(opened());
	const claim = await save3d(opened(), sidecar);
	check(
		"rig3d: another rig's sidecar is left alone by a 2D save (and not kept in this rig's backup), and a 3D save of this rig is refused (rig3d-other-rig)",
		[
			besideOther.status,
			text(SIDE) === otherBytes,
			[...bucket.keys()].some((k) => k.startsWith(BACKUPS) && k.endsWith('.rig3d.json')),
			claim.status,
			claim.body.error,
		],
		[200, true, false, 409, 'rig3d-other-rig'],
	);
	seed3d();
	const noTurnaround = await save3d(rig3dFx.irigOf(), {
		rig3d: 1,
		rig: 'H',
		views: sidecar.views,
	});
	check(
		'rig3d: drawings by angle with no turnaround chosen are refused even with no 3D clip to bake',
		[noTurnaround.status, /choose the rig's turnaround/.test(String(noTurnaround.body.message))],
		[422, true],
	);
	seedStore(SIDE, '{"rig3d": 1, "rig": "H", ');
	const unreadable = await save2d(opened());
	check(
		'rig3d: a 2D save beside an unreadable sidecar is refused (rig3d-unreadable), pointing at the history',
		[unreadable.status, unreadable.body.error, /History/.test(String(unreadable.body.message))],
		[409, 'rig3d-unreadable', true],
	);
	seed3d();
	bucket.delete(IRIG);
	seedStore(SIDE, JSON.stringify(sidecar));
	const recreated = await call(irigSave.POST, {
		dir: b64('H'),
		stem: 'H',
		skeleton: rig3dFx.irigOf(),
		projectKey: 'p1',
		baseEtag: null,
	});
	check(
		'rig3d: a sidecar left behind by a deleted .irig goes with the next 2D create of that name',
		[recreated.status, bucket.has(SIDE), bucket.has(IRIG)],
		[200, false, true],
	);

	// A writer that passes no sidecar (the irig migration) still keeps the rig's own in the backup,
	// and never another rig's.
	const migrated = async (owner: string) => {
		reset();
		seedStore(`${RIGS}/M/M.irig`, skel('M'));
		seedStore(`${RIGS}/M/rig3d.json`, JSON.stringify({ rig3d: 1, rig: owner }));
		await migrateIrigs({ prefix: `${RIGS}/M/`, write: true });
		const prefix = irigBackupsPrefix(CLIENT, 'p1', 'M', 'M');
		return [...bucket.keys()]
			.filter((k) => k.startsWith(prefix))
			.map((k) => (k.endsWith('.rig3d.json') ? 'rig3d' : 'irig'))
			.sort();
	};
	check(
		"rig3d: the migration's backup keeps the rig's sidecar, and not another rig's",
		[await migrated('M'), await migrated('other')],
		[['irig', 'rig3d'], ['irig']],
	);

	// The pair is marked: the sidecar names the `.irig` text it was written with.
	seed3d();
	await save3d(rig3dFx.irigOf(), sidecar);
	const markOk = () => (stored(SIDE) as { irig?: string }).irig === pairMark(text(IRIG) ?? '');
	const marked3d = markOk();
	const walked = opened();
	(
		walked.animations.idle.bones as Record<string, { rotate: { value: number }[] }>
	).chest.rotate[1].value = 7;
	writes.length = 0;
	await save2d(walked);
	check(
		'rig3d: the sidecar carries the mark of its .irig, re-marked (first) by a 2D save that changes it',
		[marked3d, markOk(), pairWrites()],
		[true, true, [`put ${SIDE}`, `put ${IRIG}`]],
	);
	// Lost answers: a write that landed is not undone, nor reported as a conflict.
	const landedThrow = (k: string) => {
		afterPut = async (key, caller) => {
			if (caller !== 'A' || key !== k) return;
			afterPut = null;
			throw new ConflictError(key);
		};
	};
	for (const [k, what] of [
		[IRIG, '.irig'],
		[SIDE, 'sidecar'],
	] as const) {
		landedThrow(k);
		const lostAnswer = await save3d(
			opened(),
			{ ...sidecar, hysteresis: k === IRIG ? 5 : 4 },
			{},
			'A',
		);
		check(
			`rig3d: a ${what} write that landed but lost its answer (a retry's 412) is a save, not undone`,
			[lostAnswer.status, (stored(SIDE) as { hysteresis?: number }).hysteresis, markOk()],
			[200, k === IRIG ? 5 : 4, true],
		);
	}
	// Torn: a sidecar written for another .irig (a save cut off between its writes).
	seedStore(IRIG, JSON.stringify({ ...stored(IRIG), skeleton: { hash: 'cut-off' } }));
	writes.length = 0;
	const tornSave = await save2d(opened());
	const tornGet = await get(irigSave.GET, { dir: b64('H'), stem: 'H' });
	check(
		'rig3d: a torn pair refuses every save (rig3d-torn), writing nothing, and the GET says so',
		[tornSave.status, tornSave.body.error, writes, (tornGet.body.rig3d as { torn?: boolean }).torn],
		[409, 'rig3d-torn', [], true],
	);
	const tornClaim = await save3d(opened(), sidecar);
	const healed = await call(backupsRoute.POST, {
		dir: b64('H'),
		stem: 'H',
		id: (await history())[0].id,
		projectKey: 'p1',
		baseEtag: tag(IRIG),
	});
	const afterHeal = await save2d(opened());
	check(
		'rig3d: …a 3D save too, and restoring a version from the history mends the pair',
		[tornClaim.body.error, healed.status, markOk(), afterHeal.status],
		['rig3d-torn', 200, true, 200],
	);
	// No ETag to undo over: the sidecar is left (the pair then reads as torn), never overwritten blind.
	noEtagFor = SIDE;
	afterPut = async (key, caller) => {
		if (caller !== 'A' || key !== SIDE) return;
		afterPut = null;
		await put(IRIG, enc.encode(JSON.stringify({ ...stored(IRIG), skeleton: { hash: 'b' } })));
	};
	const blind = await save3d(opened(), { ...sidecar, hysteresis: 3 }, {}, 'A');
	noEtagFor = null;
	check(
		'rig3d: with no ETag to put the sidecar back over, it is left, and the pair then refuses saves as torn',
		[
			blind.status,
			(stored(SIDE) as { hysteresis?: number }).hysteresis,
			(await save2d(opened())).body.error,
		],
		[409, 3, 'rig3d-torn'],
	);
	// A backup keeps the sidecar the save read, not one written since.
	seed3d();
	await save3d(rig3dFx.irigOf(), sidecar);
	const asRead = text(SIDE);
	beforeHead = async (key, caller) => {
		if (caller !== 'B' || key !== IRIG) return;
		beforeHead = null;
		await put(SIDE, enc.encode(JSON.stringify({ ...stored(SIDE), hysteresis: 2 })));
	};
	const moving = opened();
	(
		moving.animations.idle.bones as Record<string, { rotate: { value: number }[] }>
	).chest.rotate[1].value = 6;
	const overtakenB = await save2d(moving, {}, 'B');
	check(
		'rig3d: the backup keeps the pair as the save read it, and the save then loses to the newer sidecar',
		[text(`${BACKUPS}${(await history())[0].id}.rig3d.json`) === asRead, overtakenB.status],
		[true, 409],
	);

	// Delete: the .irig's 3D data goes with it (first); another rig's delete leaves it.
	seed3d();
	await save3d(rig3dFx.irigOf(), sidecar);
	seedStore(`${H}/G.irig`, skel('G'));
	const delG = await call(del.POST, { dir: b64('H'), skeleton_file: 'G.irig' });
	check(
		'rig3d: deleting another rig in the folder keeps the sidecar',
		[delG.status, bucket.has(SIDE)],
		[200, true],
	);
	writes.length = 0;
	const delH = await call(del.POST, { dir: b64('H'), skeleton_file: 'H.irig' });
	check(
		'rig3d: deleting the .irig deletes its sidecar first, then purges the emptied folder',
		[delH.status, writes.slice(0, 2), [...bucket.keys()].some((k) => k.startsWith(`${H}/`))],
		[200, [`delete ${SIDE}`, `delete ${IRIG}`], false],
	);
	seed3d();
	seedStore(SIDE, JSON.stringify(sidecar));
	seedStore(`${H}/H.json`, skel('H'));
	await call(del.POST, { dir: b64('H'), skeleton_file: 'H.json' });
	check(
		"rig3d: deleting the artist's source .json keeps the .irig's sidecar",
		[bucket.has(SIDE), bucket.has(IRIG)],
		[true, true],
	);
}

// ── A rig's controls: its `controls.json`, written with the .irig (docs/design/rig-controls.md, C1) ──
{
	const C = `${RIGS}/C`;
	const IRIG = `${C}/C.irig`;
	const CTRL = `${C}/controls.json`;
	const BACKUPS = irigBackupsPrefix(CLIENT, 'p1', 'C', 'C');
	type Doc = Record<string, unknown>;
	type Ctrl = ReturnType<typeof ctrlFx.controlsOf>;
	const seedC = (): void => {
		reset();
		seedStore(IRIG, JSON.stringify(ctrlFx.controlsIrig()));
		seedStore(`${C}/C.atlas`, 'C.png\nsize: 1,1\n');
		seedStore(`${C}/C.png`, 'png');
		const skeletons = [{ ...entry('C'), id: 0 }];
		seedStore(`${RIGS}/skeletons.json`, JSON.stringify({ prefix: RIGS, skeletons }));
	};
	const tag = (key: string) => bucket.get(key)?.etag;
	const stored = <T = Doc>(key: string): T => JSON.parse(text(key) ?? '{}') as T;
	/** The stored sidecar without its pair mark. */
	const kept = (): Ctrl => {
		const { irig: _mark, ...rest } = stored<Ctrl>(CTRL);
		return rest as Ctrl;
	};
	const markOk = () => stored<Ctrl>(CTRL).irig === pairMark(text(IRIG) ?? '');
	const save = (skeleton: unknown, extra: object = {}, caller = 'solo') =>
		call(
			irigSave.POST,
			{ dir: b64('C'), stem: 'C', skeleton, projectKey: 'p1', baseEtag: tag(IRIG), ...extra },
			'p1',
			caller,
		);
	const saveCtrl = (skeleton: unknown, controls: unknown, extra: object = {}, caller = 'solo') =>
		save(skeleton, { controls, controlsBaseEtag: tag(CTRL) ?? null, ...extra }, caller);
	const pairWrites = () => writes.filter((w) => w === `put ${CTRL}` || w === `put ${IRIG}`);
	const history = async () =>
		(await get(backupsRoute.GET, { dir: b64('C'), stem: 'C' })).body.backups as {
			id: string;
			rig3d: boolean;
			controls: boolean;
		}[];
	const restore = (id: string, extra: object = {}, caller = 'solo') =>
		call(
			backupsRoute.POST,
			{ dir: b64('C'), stem: 'C', id, projectKey: 'p1', baseEtag: tag(IRIG), ...extra },
			'p1',
			caller,
		);
	const controls = ctrlFx.controlsOf('C');

	// A client that edits controls (C2) saves the whole sidecar with the rig.
	seedC();
	const made = await saveCtrl(ctrlFx.controlsIrig(), { ...controls, rig: 'someone-else', irig: 'x' });
	check(
		'controls: a controls save writes the sidecar, then the .irig, in one request',
		[made.status, pairWrites(), made.body.etag, made.body.controlsEtag, made.body.rig3dEtag],
		[200, [`put ${CTRL}`, `put ${IRIG}`], tag(IRIG), tag(CTRL), null],
	);
	check(
		"controls: it is bound to its rig and marked with the .irig it was written with (the client's mark ignored)",
		[kept(), markOk()],
		[controls, true],
	);
	const got = await get(irigSave.GET, { dir: b64('C'), stem: 'C' });
	const gotCtrl = got.body.controls as { etag: string; doc: Ctrl; dropped?: string[] };
	check(
		'controls: the precondition GET answers the sidecar and its etag with the .irig etag',
		[got.body.etag, gotCtrl.etag, gotCtrl.doc.rig, gotCtrl.dropped, got.body.rig3d],
		[tag(IRIG), tag(CTRL), 'C', undefined, null],
	);

	// Today's Rigger (it sends no `controls`) keeps them.
	writes.length = 0;
	const ctrlTag = tag(CTRL);
	const plain = await save(stored(IRIG));
	check(
		"controls: today's Rigger saving the rig unchanged leaves the sidecar alone",
		[plain.status, pairWrites(), tag(CTRL), plain.body.controlsEtag, plain.body.controlsDropped],
		[200, [`put ${IRIG}`], ctrlTag, ctrlTag, []],
	);
	const backupId = (await history())[0].id;
	check(
		"controls: the .irig's backup keeps a copy of its controls, and the history says so",
		[(await history())[0].controls, text(`${BACKUPS}${backupId}.controls.json`) === text(CTRL)],
		[true, true],
	);
	// Stored with its fields in another order (a writer that is not this launcher): same content.
	const { ik, fk, ...limbRest } = controls.limbs!.arm_l;
	const reordered = {
		...stored<Ctrl>(CTRL),
		limbs: { arm_l: { ...limbRest, fk, ik } },
	};
	const ctrlBeforeReorder = text(CTRL) ?? '';
	seedStore(CTRL, JSON.stringify(reordered));
	const reorderedBytes = text(CTRL);
	writes.length = 0;
	await save(stored(IRIG));
	check(
		'controls: a save that changes nothing of the controls does not rewrite them for the order of their fields',
		[pairWrites(), text(CTRL) === reorderedBytes],
		[[`put ${IRIG}`], true],
	);
	// The .irig changes between the backup's check and its copy: no copy of the controls is left.
	const keptBefore = [...bucket.keys()].filter((k) => k.endsWith('.controls.json')).length;
	const irigBeforeMid = text(IRIG) ?? '';
	afterPut = async (key, caller) => {
		if (caller !== 'A' || !key.startsWith(BACKUPS) || !key.endsWith('.controls.json')) return;
		afterPut = null;
		await put(IRIG, enc.encode(JSON.stringify({ ...stored(IRIG), skeleton: { hash: 'mid' } })));
	};
	const midCopy = await save({ ...stored(IRIG), skeleton: { hash: 'mine' } }, {}, 'A');
	check(
		'controls: when the .irig copy of a backup fails, the controls copy taken for it goes, and the save loses',
		[midCopy.status, [...bucket.keys()].filter((k) => k.endsWith('.controls.json')).length],
		[409, keptBefore],
	);
	seedStore(IRIG, irigBeforeMid);
	seedStore(CTRL, ctrlBeforeReorder);
	const keyed = stored<Doc & { animations: Record<string, Doc> }>(IRIG);
	keyed.animations.wave = { bones: { chest: { rotate: [{ time: 0, value: 9 }] } } };
	writes.length = 0;
	await save(keyed);
	check(
		'controls: a 2D save that changes the .irig re-marks the sidecar, first, its content kept',
		[pairWrites(), markOk(), kept()],
		[[`put ${CTRL}`, `put ${IRIG}`], true, controls],
	);

	// The .irig a save writes is the same, byte for byte, with or without controls — the runtime's.
	const D = `${RIGS}/D`;
	seedStore(`${D}/D.irig`, JSON.stringify(ctrlFx.controlsIrig()));
	seedStore(`${D}/D.atlas`, 'D.png\nsize: 1,1\n');
	seedStore(`${D}/D.png`, 'png');
	const twin = await call(irigSave.POST, {
		dir: b64('D'),
		stem: 'D',
		skeleton: keyed,
		projectKey: 'p1',
		baseEtag: tag(`${D}/D.irig`),
	});
	const viaClient = await saveCtrl(keyed, controls);
	check(
		'controls: the .irig written beside controls.json (kept or sent) is byte for byte the one written without',
		[twin.status, viaClient.status, text(IRIG) === text(`${D}/D.irig`)],
		[200, 200, true],
	);

	// Rename and delete in the Rigger rewrite it, as they rewrite constraints.
	const renamed = ctrlFx.renamedBone(stored(IRIG), 'hand_ik_l', 'hand_ctrl_l');
	writes.length = 0;
	const rn = await save(renamed);
	const afterRename = kept();
	check(
		'controls: a bone renamed in the Rigger is renamed in the sidecar: its control, set, limb, mirror pair and picker button',
		[
			rn.status,
			pairWrites(),
			afterRename.bones?.hand_ctrl_l,
			afterRename.sets?.hands,
			afterRename.limbs?.arm_l?.control,
			afterRename.mirror?.pairs,
			afterRename.picker?.items?.[0].bone,
			JSON.stringify(afterRename).includes('hand_ik_l'),
			rn.body.controlsDropped,
		],
		[
			200,
			[`put ${CTRL}`, `put ${IRIG}`],
			controls.bones?.hand_ik_l,
			['hand_ctrl_l', 'hand_l'],
			'hand_ctrl_l',
			{ hand_ctrl_l: 'hand_ctrl_l' },
			'hand_ctrl_l',
			false,
			[],
		],
	);
	const ikRenamed = ctrlFx.renamedConstraint(stored(IRIG), 'ik', 'arm_ik_l', 'arm_l_ik');
	await save(ikRenamed);
	check(
		'controls: a constraint renamed in the Rigger is renamed in its limb and its preset',
		[kept().limbs?.arm_l?.ik, kept().presets?.arm_l_ik, 'arm_ik_l' in (kept().presets ?? {})],
		['arm_l_ik', 'twoBoneIk', false],
	);
	const poleless = ctrlFx.deletedBone(stored(IRIG), 'elbow_pole_l');
	const del1 = await save(poleless);
	check(
		'controls: a bone deleted in the Rigger drops its control and the limb its pole (named in controlsDropped), keeping the limb',
		[
			del1.status,
			'elbow_pole_l' in (kept().bones ?? {}),
			kept().limbs?.arm_l?.pole,
			kept().limbs?.arm_l?.control,
			(del1.body.controlsDropped as string[]).map((d) => d.replace(/ names .*/, '')),
		],
		[200, false, undefined, 'hand_ctrl_l', ['bones.elbow_pole_l', 'limbs.arm_l.pole']],
	);
	const ikless = stored<Doc & { ik: Doc[]; animations: Record<string, Doc> }>(IRIG);
	ikless.ik = ikless.ik.filter((c) => c.name !== 'arm_l_ik');
	// One constraint per solve order (K0): the aim takes the order the IK left.
	ikless.ik[0].order = 2;
	delete ikless.animations.reach.ik;
	await save(ikless);
	check(
		"controls: a constraint deleted in the Rigger takes the limb that switches it, and the limb's picker button",
		[
			'arm_l' in (kept().limbs ?? {}),
			(kept().picker?.items ?? []).map((i) => i.bone ?? i.set ?? i.limb),
		],
		[false, ['hand_ctrl_l', 'hands']],
	);

	// Strict on write.
	seedC();
	await saveCtrl(ctrlFx.controlsIrig(), controls);
	writes.length = 0;
	const malformed = await saveCtrl(stored(IRIG), { ...controls, bones: { look: { shape: 'star' } } });
	check(
		'controls: a malformed sidecar is refused (controls-invalid), naming the problem, writing nothing',
		[
			malformed.status,
			malformed.body.error,
			(malformed.body.problems as string[])[0],
			/Not saved — the rig's controls are malformed/.test(String(malformed.body.message)),
			writes,
		],
		[422, 'controls-invalid', "controls.json.bones.look.shape must be 'circle' or 'ring' or 'square' or 'diamond' or 'arrow' or 'cross' or 'box' or 'polyline'", true, []],
	);
	const misfit = await saveCtrl(stored(IRIG), {
		...controls,
		sets: { ...controls.sets, tail: ['tail_1'] },
	});
	check(
		'controls: a sidecar naming a bone the rig lacks is refused, writing nothing',
		[misfit.status, misfit.body.error, misfit.body.problems, writes],
		[422, 'controls-invalid', ['sets.tail[0] names bone "tail_1", which is not in the rig'], []],
	);
	const newer = await saveCtrl(stored(IRIG), { ...controls, controls: 2 });
	check(
		'controls: …and one of a newer version',
		[newer.status, /newer than this launcher reads/.test(String(newer.body.message))],
		[422, true],
	);

	// Preconditions.
	const staleCtrl = await save(stored(IRIG), { controls, controlsBaseEtag: '"stale"' });
	check(
		'controls: a controls save on a stale sidecar etag is a 409 conflict carrying the current one, writing nothing',
		[staleCtrl.status, staleCtrl.body.error, staleCtrl.body.controlsEtag, writes],
		[409, 'conflict', tag(CTRL), []],
	);
	const noBase = await save(stored(IRIG), { controls });
	check('controls: a controls save with no controlsBaseEtag is a 400', noBase.status, 400);
	const forced = await call(irigSave.POST, {
		dir: b64('C'),
		stem: 'C',
		skeleton: stored(IRIG),
		projectKey: 'p1',
		force: true,
		controls: { ...controls, mirror: { line: 'chest' } },
	});
	check(
		"controls: …unless forced (the author's \"overwrite theirs\")",
		[forced.status, kept().mirror],
		[200, { line: 'chest' }],
	);
	writes.length = 0;
	const staleIrig = await saveCtrl(stored(IRIG), controls, { baseEtag: '"stale"' });
	check(
		'controls: a controls save on a stale .irig etag is a 409 that writes nothing',
		[staleIrig.status, staleIrig.body.error, writes],
		[409, 'conflict', []],
	);

	// Races: someone writes the sidecar after this save's checks.
	const racing = JSON.stringify({ ...stored(CTRL), sets: { theirs: [] } });
	beforePut = async (key, caller) => {
		if (caller !== 'A' || key !== CTRL) return;
		beforePut = null;
		await put(CTRL, enc.encode(racing));
	};
	writes.length = 0;
	const irigUntouched = text(IRIG);
	const overtaken = await saveCtrl(stored(IRIG), controls, {}, 'A');
	check(
		'controls: a sidecar written by someone else since this save read it is a 409, and the .irig is not written',
		[overtaken.status, overtaken.body.error, text(CTRL) === racing, text(IRIG) === irigUntouched],
		[409, 'conflict', true, true],
	);
	await saveCtrl(stored(IRIG), controls);
	const ctrlBytes = text(CTRL);
	const ctrlEtag = tag(CTRL);
	const theirs = JSON.stringify({ ...stored(IRIG), skeleton: { hash: 'theirs' } });
	afterPut = async (key, caller) => {
		if (caller === 'A' && key === CTRL) await put(IRIG, enc.encode(theirs));
	};
	const lost = await saveCtrl(stored(IRIG), { ...controls, mirror: { line: 'chest' } }, {}, 'A');
	afterPut = null;
	check(
		'controls: when the .irig loses its race after the sidecar was written, the sidecar is put back and nothing of the save stays',
		[lost.status, lost.body.error, text(CTRL) === ctrlBytes, tag(CTRL), text(IRIG) === theirs],
		[409, 'conflict', true, ctrlEtag, true],
	);

	// Torn: a sidecar written for another .irig is refused like rig3d.json's.
	seedC();
	await saveCtrl(ctrlFx.controlsIrig(), controls);
	await save(stored(IRIG));
	seedStore(IRIG, JSON.stringify({ ...stored(IRIG), skeleton: { hash: 'cut-off' } }));
	writes.length = 0;
	const tornSave = await save(stored(IRIG));
	const tornGet = await get(irigSave.GET, { dir: b64('C'), stem: 'C' });
	const tornClient = await saveCtrl(stored(IRIG), controls);
	check(
		'controls: a torn pair refuses every save (controls-torn), writing nothing, and the GET says so',
		[
			tornSave.status,
			tornSave.body.error,
			tornClient.body.error,
			writes,
			(tornGet.body.controls as { torn?: boolean }).torn,
		],
		[409, 'controls-torn', 'controls-torn', [], true],
	);
	const healed = await restore((await history())[0].id);
	check(
		'controls: …and restoring a version from the history mends it',
		[healed.status, markOk(), (await save(stored(IRIG))).status],
		[200, true, 200],
	);

	// Lenient on read: a sidecar naming what the rig lost (edited outside the Rigger) is opened.
	const outside = ctrlFx.deletedBone(stored(IRIG), 'elbow_pole_l');
	seedStore(IRIG, JSON.stringify(outside));
	seedStore(CTRL, JSON.stringify({ ...stored(CTRL), irig: pairMark(text(IRIG) ?? '') }));
	const before = text(CTRL);
	const lenient = await get(irigSave.GET, { dir: b64('C'), stem: 'C' });
	const view = lenient.body.controls as { doc: Ctrl; dropped: string[] };
	check(
		'controls: the GET leaves out what names a bone the rig lost, listing it, and changes nothing stored',
		['elbow_pole_l' in (view.doc.bones ?? {}), view.dropped, text(CTRL) === before],
		[
			false,
			[
				'bones.elbow_pole_l names bone "elbow_pole_l", which is not in the rig',
				'limbs.arm_l.pole names bone "elbow_pole_l", which is not in the rig',
			],
			true,
		],
	);
	const dropped = await save(stored(IRIG));
	check(
		'controls: …and the next save drops it from storage, saying so',
		[dropped.status, 'elbow_pole_l' in (kept().bones ?? {}), dropped.body.controlsDropped],
		[200, false, view.dropped],
	);

	// One this launcher cannot read is kept, not refused: it changes no playback.
	for (const [what, bad] of [
		['a newer version', JSON.stringify({ ...stored(CTRL), controls: 2, extra: { from: 'C9' } })],
		['malformed JSON', '{"controls": 1, "rig": "C", '],
	] as const) {
		seedStore(CTRL, bad);
		const res = await save(stored(IRIG));
		const now = text(CTRL) ?? '';
		check(
			`controls: a 2D save beside an unreadable sidecar (${what}) saves, keeping it${what === 'malformed JSON' ? ' byte for byte' : ' (re-marked)'}, and the GET names why`,
			[
				res.status,
				what === 'malformed JSON' ? now === bad : JSON.parse(now).extra?.from === 'C9',
				((await get(irigSave.GET, { dir: b64('C'), stem: 'C' })).body.controls as {
					problems?: string[];
				}).problems?.length,
			],
			[200, true, 1],
		);
	}

	// Another rig's sidecar, and one left behind by a deleted .irig.
	seedC();
	seedStore(CTRL, JSON.stringify({ ...controls, rig: 'G' }));
	const otherBytes = text(CTRL);
	const besideOther = await save(stored(IRIG));
	const claim = await saveCtrl(stored(IRIG), controls);
	check(
		"controls: another rig's sidecar is left alone by a 2D save (not kept in this rig's backup), and a controls save of this rig is refused (controls-other-rig)",
		[
			besideOther.status,
			text(CTRL) === otherBytes,
			[...bucket.keys()].some((k) => k.startsWith(BACKUPS) && k.endsWith('.controls.json')),
			claim.status,
			claim.body.error,
			(await get(irigSave.GET, { dir: b64('C'), stem: 'C' })).body.controls,
		],
		[200, true, false, 409, 'controls-other-rig', null],
	);
	seedC();
	bucket.delete(IRIG);
	seedStore(CTRL, JSON.stringify(controls));
	const recreated = await call(irigSave.POST, {
		dir: b64('C'),
		stem: 'C',
		skeleton: ctrlFx.controlsIrig(),
		projectKey: 'p1',
		baseEtag: null,
	});
	check(
		'controls: a sidecar left behind by a deleted .irig goes with the next create of that name',
		[recreated.status, bucket.has(CTRL), bucket.has(IRIG)],
		[200, false, true],
	);

	// History: a restore puts back the rig as it was then, controls included (or not).
	seedC();
	// Each save changes the .irig: two backups of the same bytes in one millisecond share an id.
	const v2 = stored<Doc & { skeleton: Doc }>(IRIG);
	const first = await saveCtrl({ ...v2, skeleton: { ...v2.skeleton, hash: 'v2' } }, controls);
	const second = await save({ ...v2, skeleton: { ...v2.skeleton, hash: 'v3' } });
	const hist = await history();
	const listed = (id: unknown) => hist.find((b) => b.id === id)?.controls;
	check(
		'controls: the history lists which versions had controls',
		[hist.length, listed(first.body.backupId), listed(second.body.backupId)],
		[2, false, true],
	);
	const pairBefore = [text(IRIG), text(CTRL)];
	const toBare = await restore(String(first.body.backupId));
	check(
		'controls: restoring a version from before the rig had controls removes its sidecar',
		[toBare.status, bucket.has(CTRL), toBare.body.controlsEtag],
		[200, false, null],
	);
	const undo = (await history()).find((b) => b.id === toBare.body.backupId)!;
	const back = await restore(undo.id);
	check(
		'controls: …and restoring the version that restore replaced puts the pair back, byte for byte',
		[undo.controls, back.status, [text(IRIG), text(CTRL)]],
		[true, 200, pairBefore],
	);
	seedStore(CTRL, JSON.stringify({ ...controls, rig: 'G' }));
	const intoOther = await restore(undo.id);
	check(
		"controls: a restore never puts its controls over another rig's",
		[intoOther.status, intoOther.body.error, JSON.parse(text(CTRL) ?? '{}').rig],
		[409, 'controls-other-rig', 'G'],
	);
	seedStore(CTRL, pairBefore[1] ?? '');
	const oldIds = Array.from(
		{ length: 22 },
		(_, i) => `irig-20260101T0000000${String(i).padStart(2, '0')}Z-0000000${i % 10}`,
	);
	for (const id of oldIds) {
		seedStore(`${BACKUPS}${id}.json`, JSON.stringify(ctrlFx.controlsIrig()));
		seedStore(`${BACKUPS}${id}.controls.json`, text(CTRL) ?? '');
	}
	await save(stored(IRIG));
	const left = [...bucket.keys()].filter((k) => k.startsWith(BACKUPS));
	const copies = left.filter((k) => k.endsWith('.controls.json'));
	check(
		'controls: retention keeps 20 backups and drops the oldest with their controls copies',
		[
			left.length - copies.length,
			copies.every((k) => left.includes(k.replace(/\.controls\.json$/, '.json'))),
			left.some((k) => k.startsWith(`${BACKUPS}${oldIds[0]}`)),
		],
		[20, true, false],
	);

	// Both sidecars: one save writes the 3D data, the controls and the .irig — never one without the others.
	const H = `${RIGS}/H`;
	const HIRIG = `${H}/H.irig`;
	const SIDE = `${H}/rig3d.json`;
	const HCTRL = `${H}/controls.json`;
	const hControls: Ctrl = {
		controls: 1,
		rig: 'H',
		bones: { hand: { shape: 'circle', size: 12 }, chest: { role: 'deform', shape: 'box', axes: 1 } },
		sets: { arm: ['upper_arm', 'forearm', 'hand'] },
	};
	const seedH = () => {
		reset();
		seedStore(HIRIG, JSON.stringify(rig3dFx.irigOf()));
		seedStore(`${H}/H.atlas`, 'H.png\nsize: 1,1\n');
		seedStore(`${H}/H.png`, 'png');
		seedStore(`${RIGS}/skeletons.json`, JSON.stringify({ prefix: RIGS, skeletons: [{ ...entry('H'), id: 0 }] }));
	};
	const saveH = (extra: object, caller = 'solo') =>
		call(
			irigSave.POST,
			{
				dir: b64('H'),
				stem: 'H',
				// What a tab holds after opening the stored rig (the bake included).
				skeleton: rig3dFx.asRiggerLoads(JSON.parse(text(HIRIG) ?? '{}')),
				projectKey: 'p1',
				baseEtag: tag(HIRIG),
				rig3d: rig3dFx.sidecarOf('H'),
				rig3dBaseEtag: tag(SIDE) ?? null,
				controls: hControls,
				controlsBaseEtag: tag(HCTRL) ?? null,
				...extra,
			},
			'p1',
			caller,
		);
	const tripleWrites = () => writes.filter((w) => [SIDE, HCTRL, HIRIG].some((k) => w === `put ${k}`));
	seedH();
	const all3 = await saveH({});
	check(
		'controls: a 3D rig saves its 3D data, its controls and its .irig in one request, in that order, both marked',
		[
			all3.status,
			tripleWrites(),
			all3.body.rig3dEtag === tag(SIDE),
			all3.body.controlsEtag === tag(HCTRL),
			JSON.parse(text(SIDE) ?? '{}').irig === pairMark(text(HIRIG) ?? ''),
			JSON.parse(text(HCTRL) ?? '{}').irig === pairMark(text(HIRIG) ?? ''),
		],
		[200, [`put ${SIDE}`, `put ${HCTRL}`, `put ${HIRIG}`], true, true, true, true],
	);
	const pair3 = [text(SIDE), text(HCTRL), text(HIRIG)];
	const etags3 = [tag(SIDE), tag(HCTRL)];
	// The controls write loses its race after the 3D data landed: the 3D data is put back.
	beforePut = async (key, caller) => {
		if (caller !== 'A' || key !== HCTRL) return;
		beforePut = null;
		await put(HCTRL, enc.encode(JSON.stringify({ ...hControls, sets: { theirs: [] } })));
	};
	const ctrlLost = await saveH(
		{
			rig3d: { ...rig3dFx.sidecarOf('H'), hysteresis: 9 },
			controls: { ...hControls, sets: {} },
		},
		'A',
	);
	check(
		'controls: a controls write that loses its race puts back the 3D data written before it, and the .irig is not written',
		[
			ctrlLost.status,
			ctrlLost.body.error,
			/Someone else saved the controls of "H"/.test(String(ctrlLost.body.message)),
			text(SIDE) === pair3[0],
			tag(SIDE),
			text(HIRIG) === pair3[2],
		],
		[409, 'conflict', true, true, etags3[0], true],
	);
	seedStore(HCTRL, pair3[1] ?? '');
	const theirH = JSON.stringify({ ...JSON.parse(pair3[2] ?? '{}'), skeleton: { hash: 'theirs' } });
	afterPut = async (key, caller) => {
		if (caller === 'A' && key === HCTRL) await put(HIRIG, enc.encode(theirH));
	};
	const bothLost = await saveH(
		{
			rig3d: { ...rig3dFx.sidecarOf('H'), hysteresis: 8 },
			controls: { ...hControls, sets: {} },
		},
		'A',
	);
	afterPut = null;
	check(
		'controls: when the .irig loses its race after both sidecars landed, both are put back',
		[bothLost.status, text(SIDE) === pair3[0], text(HCTRL) === pair3[1], text(HIRIG) === theirH],
		[409, true, true, true],
	);
	seedStore(HIRIG, pair3[2] ?? '');
	await saveH({ controlsBaseEtag: tag(HCTRL) });
	const h3 = (await get(backupsRoute.GET, { dir: b64('H'), stem: 'H' })).body.backups as {
		id: string;
		rig3d: boolean;
		controls: boolean;
	}[];
	check(
		'controls: a backup of a 3D rig with controls keeps both sidecars',
		[h3[0].rig3d, h3[0].controls],
		[true, true],
	);

	// Delete: the .irig's controls go with it (first); another rig's delete leaves them.
	seedC();
	await saveCtrl(ctrlFx.controlsIrig(), controls);
	seedStore(`${C}/G.irig`, skel('G'));
	const delG = await call(del.POST, { dir: b64('C'), skeleton_file: 'G.irig' });
	check(
		'controls: deleting another rig in the folder keeps the sidecar',
		[delG.status, bucket.has(CTRL)],
		[200, true],
	);
	writes.length = 0;
	const delC = await call(del.POST, { dir: b64('C'), skeleton_file: 'C.irig' });
	check(
		'controls: deleting the .irig deletes its controls first, then purges the emptied folder',
		[delC.status, writes.slice(0, 2), [...bucket.keys()].some((k) => k.startsWith(`${C}/`))],
		[200, [`delete ${CTRL}`, `delete ${IRIG}`], false],
	);

	// The skeleton index never lists it, even one whose head reads like a skeleton.
	seedC();
	seedStore(CTRL, JSON.stringify({ controls: 1, rig: 'C', bones: { skeleton: { shape: 'ring' } } }));
	await call(reindex.POST, { projectKey: 'p1' });
	check(
		'controls: the reindex lists the .irig and ignores controls.json',
		(
			JSON.parse(text(`${RIGS}/skeletons.json`) ?? '{}').skeletons as {
				folder: string;
				skeleton_file: string;
			}[]
		)
			.filter((s) => s.folder === 'C')
			.map((s) => s.skeleton_file),
		['C.irig'],
	);

	// The rig library carries it.
	reset();
	const libSave = (extra: object) =>
		call(rigSave.POST, { name: 'Arm', skeleton: ctrlFx.controlsIrig(), baseEtag: null, ...extra });
	const lib = await libSave({ controls: { ...controls, irig: 'x' } });
	const libGot = await get(rigGet.GET, { id: 'arm' });
	check(
		'controls: the rig library stores the rig with its controls (bound to the entry, no pair mark), and returns them',
		[lib.status, (libGot.body as { controls?: Ctrl }).controls],
		[200, { ...controls, rig: 'arm' }],
	);
	reset();
	const libBad = await libSave({
		controls: { ...controls, sets: { ...controls.sets, tail: ['tail_1'] } },
	});
	const libBare = await libSave({});
	check(
		'controls: …refuses controls that do not fit the rig, writing nothing, and stores a rig without any as before',
		[
			libBad.status,
			/tail_1/.test(String(libBad.body.message)),
			libBare.status,
			'controls' in JSON.parse(text('_shared/rigs/arm.json') ?? '{}'),
		],
		[422, true, 200, false],
	);
}

console.log();
if (failures) {
	console.error(`${failures} of ${checks} rigger-write checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} rigger-write checks pass`);
