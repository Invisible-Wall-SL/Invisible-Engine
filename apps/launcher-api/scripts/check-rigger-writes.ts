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
let beforeList: ((caller: string | undefined) => Promise<void>) | null = null;
let afterDelete: ((key: string, caller: string | undefined) => void) | null = null;
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
		putObjectText: (key: string, text: string, _type?: string, cond?: Cond) =>
			put(key, enc.encode(text), cond),
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
		copyObject: async (src: string, dest: string) => {
			const o = bucket.get(src);
			if (!o) return false;
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

const text = (key: string): string | null => {
	const o = bucket.get(key);
	return o ? dec.decode(o.body) : null;
};
const reset = (): void => {
	bucket.clear();
	writes.length = 0;
	catalog.length = 0;
	afterPut = null;
	beforeList = null;
	afterDelete = null;
	beforeHead = null;
	afterHead = null;
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
		['a 3.8 export', { skeleton: { ...export42, skeleton: { spine: '3.8.99' } } }, 422],
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

console.log();
if (failures) {
	console.error(`${failures} of ${checks} rigger-write checks FAILED`);
	process.exit(1);
}
console.log(`all ${checks} rigger-write checks pass`);
