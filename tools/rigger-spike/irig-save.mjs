// Offline contract test for the Rigger's guarded `.irig` save (conditional write, structural
// check, rolling backups).
//
//   node tools/rigger-spike/irig-save.mjs
//
// Bundles the REAL `riggerIrig.ts` + `riggerIrigWrite.ts` with esbuild and runs them against an
// in-memory R2 that implements the precondition semantics (`If-Match` / `If-None-Match: *` →
// ConflictError). The skeleton index + atlas sync are stubbed: they are covered by
// `reindex-preserve.mjs`. The structural check is held against the OFFICIAL spine-core loader —
// every doc it accepts must load, every reference break it names must make the loader throw.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const ESBUILD = new URL('node_modules/.pnpm/esbuild@0.25.5/node_modules/esbuild/lib/main.js', ROOT).href;
const SPINE_CORE = new URL(
	'node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	ROOT,
).href;
const APP = fileURLToPath(new URL('apps/launcher-api/', ROOT));
const SERVER_DIR = join(APP, 'src/lib/server');
const esbuild = await import(ESBUILD);
const { SkeletonJson, AtlasAttachmentLoader, TextureAtlas } = await import(SPINE_CORE);

// ── in-memory R2 ────────────────────────────────────────────────────────────────────────────
const fakeR2 = `
	export class ConflictError extends Error { constructor(k) { super('conflict ' + k); this.name = 'ConflictError'; } }
	const store = globalThis.__r2 = globalThis.__r2 || { objects: new Map(), n: 0, log: [] };
	const put = (key, text) => { const etag = '"' + (++store.n).toString(16).padStart(8, 'a') + 'ffff"'; store.objects.set(key, { text, etag }); return etag; };
	export function precondition(b) { if (b === undefined) return undefined; return b === null ? { ifNoneMatch: '*' } : { ifMatch: b }; }
	export async function putObjectText(key, text, _ct, cond) {
		const cur = store.objects.get(key);
		if (cond?.ifNoneMatch && cur) throw new ConflictError(key);
		if (cond?.ifMatch && (!cur || cur.etag !== cond.ifMatch)) throw new ConflictError(key);
		store.log.push('put ' + key);
		return put(key, text);
	}
	export async function headObject(key) { const o = store.objects.get(key); return o ? { etag: o.etag, size: o.text.length, lastModified: 0 } : null; }
	export async function copyObject(src, dest) { const o = store.objects.get(src); if (!o) return false; store.log.push('copy ' + src); put(dest, o.text); return true; }
	export async function getObjectText(key) { return store.objects.get(key)?.text ?? null; }
	export async function getObjectTextWithEtag(key) { const o = store.objects.get(key); return o ? { text: o.text, etag: o.etag } : null; }
	export async function listAllObjects(prefix) { return [...store.objects.entries()].filter(([k]) => k.startsWith(prefix)).map(([key, o]) => ({ key, size: o.text.length, lastModified: 0 })); }
	export async function deleteObjects(keys) { for (const k of keys) store.objects.delete(k); }
`;
const stubs = {
	name: 'stubs',
	setup(build) {
		build.onResolve({ filter: /^\.\/r2$/ }, () => ({ path: 'r2', namespace: 'stub' }));
		build.onResolve({ filter: /^\.\/spineBundleSync$/ }, () => ({ path: 'sync', namespace: 'stub' }));
		build.onResolve({ filter: /^\.\/spineIndex$/ }, () => ({ path: 'index', namespace: 'stub' }));
		build.onResolve({ filter: /^\$lib\// }, (a) => ({ path: join(APP, 'src/lib', a.path.slice(5) + '.ts') }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({
			contents:
				a.path === 'r2'
					? fakeR2
					: a.path === 'sync'
						? 'export async function ensureBundleAtlasFresh() { return null; }'
						: `export const scanSkeletonsIndex = async () => ({});
						   export async function reindexSkeletonsPreserving() {
						     return { index: { skeletons: [{}] }, atlasMissingFolders: globalThis.__atlasMissing || [], rederivedFolders: [], preservedFolders: [] };
						   }`,
			loader: 'js',
		}));
	},
};
const out = join(mkdtempSync(join(tmpdir(), 'irig-save-')), 'bundle.mjs');
await esbuild.build({
	stdin: {
		contents: "export * from './riggerIrig.ts'; export * from './riggerIrigWrite.ts';",
		resolveDir: SERVER_DIR,
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	plugins: [stubs],
	nodePaths: [join(APP, 'node_modules')],
	logLevel: 'error',
});
const M = await import(pathToFileURL(out).href);
const r2 = globalThis.__r2;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

// ── fixtures ────────────────────────────────────────────────────────────────────────────────
const ATLAS = 'page.png\nsize: 64,64\nfilter: Linear,Linear\nhead\nbounds: 0,0,32,32\n';
const good = () => ({
	skeleton: { spine: '4.2.40', width: 32, height: 32 },
	bones: [{ name: 'root' }, { name: 'body', parent: 'root' }, { name: 'arm', parent: 'body' }],
	slots: [{ name: 'head', bone: 'body', attachment: 'head' }],
	ik: [{ name: 'reach', bones: ['arm'], target: 'root' }],
	skins: [{ name: 'default', attachments: { head: { head: { width: 32, height: 32 } } } }],
	animations: { idle: { bones: { arm: { rotate: [{ value: 10 }] } }, slots: { head: { rgba: [{ color: 'ffffffff' }] } } } },
});
const atlas = new TextureAtlas(ATLAS);
for (const p of atlas.pages) p.setTexture({ setFilters() {}, setWraps() {}, dispose() {} });
const loads = (doc) => {
	try { new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(JSON.parse(JSON.stringify(doc))); return null; }
	catch (e) { return String(e.message || e); }
};

console.log('\n1. irigDocProblem agrees with the official loader');
{
	ok('the good fixture loads', loads(good()) === null, loads(good()));
	ok('…and passes the check', M.irigDocProblem(good()) === null, M.irigDocProblem(good()));
	const breaks = {
		'slot on a missing bone': (d) => { d.slots[0].bone = 'nope'; },
		'ik bone missing': (d) => { d.ik[0].bones = ['nope']; },
		'ik target missing': (d) => { d.ik[0].target = 'nope'; },
		'skin names a missing slot': (d) => { d.skins[0].attachments.ghost = {}; },
		'animation keys a missing bone': (d) => { d.animations.idle.bones.ghost = { rotate: [{ value: 1 }] }; },
		'animation keys a missing slot': (d) => { d.animations.idle.slots.ghost = { rgba: [{ color: 'ffffffff' }] }; },
		'ik has no bones list': (d) => { delete d.ik[0].bones; },
	};
	for (const [label, mutate] of Object.entries(breaks)) {
		const d = good();
		mutate(d);
		const loaderErr = loads(d);
		const ours = M.irigDocProblem(d);
		ok(`${label}: the loader throws AND the check refuses`, loaderErr !== null && ours !== null, `loader=${loaderErr} check=${ours}`);
	}
	// A missing/late parent does not throw in spine-core — it silently makes the bone a ROOT, i.e.
	// a corrupted hierarchy. The check refuses it; the Rigger itself always topo-sorts.
	const orphan = good();
	orphan.bones[2].parent = 'ghost';
	ok('an undefined parent is refused (spine-core would silently re-root it)', /ghost/.test(M.irigDocProblem(orphan) ?? ''));
	ok('no bones is refused', M.irigDocProblem({ bones: [] }) !== null);
	ok('a non-object is refused', M.irigDocProblem('x') !== null && M.irigDocProblem(null) !== null);
	const dup = good();
	dup.bones.push({ name: 'arm', parent: 'root' });
	ok('duplicate bone names are refused', /two bones/.test(M.irigDocProblem(dup) ?? ''));
	const extra = good();
	extra.someFutureField = { x: 1 };
	extra.bones[1].newProp = 3;
	ok('unknown fields from a newer Rigger are NOT refused', M.irigDocProblem(extra) === null);
}

console.log('\n2. backup ids + prefix are path-safe and chronological');
{
	const id = M.irigBackupId(new Date('2026-09-28T10:11:12.345Z'), '"0123abcdEF99"');
	ok('id shape', id === 'irig-20260928T101112345Z-0123abcd', id);
	ok('id round-trips to the instant', M.irigBackupSavedAt(id) === '2026-09-28T10:11:12.345Z');
	ok('the restore id regex rejects traversal', !M.IRIG_BACKUP_ID_RE.test('../x') && !M.IRIG_BACKUP_ID_RE.test(id + '/..'));
	const p = M.irigBackupsPrefix('Acme', 'Borut', 'chars/hero', 'hero');
	ok('backups live OUTSIDE spines/ (the skeleton scan would list them as rigs)', p.startsWith('acme/borut/rigger-backups/') && !p.includes('/spines/'), p);
	ok('the dir is one opaque segment', p.split('/').length === 6, p);
	ok('root bundle gets its own segment', M.irigBackupsPrefix('a', 'b', '', 's') === 'a/b/rigger-backups/_root/s/');
}

console.log('\n3. irigTarget path guards');
{
	const t = M.irigTarget('a', 'b', Buffer.from('hero').toString('base64url'), 'hero');
	ok('key under the bundle', t.key === 'a/b/spines/hero/hero.irig', t.key);
	const threw = (fn) => { try { fn(); return false; } catch { return true; } };
	ok('.. in dir refused', threw(() => M.irigTarget('a', 'b', Buffer.from('../x').toString('base64url'), 's')));
	ok('/ in stem refused', threw(() => M.irigTarget('a', 'b', '', 'x/y')));
	ok('missing stem refused', threw(() => M.irigTarget('a', 'b', '', '')));
}

console.log('\n4. writeIrig — conditional write + backup ordering');
{
	const t = M.irigTarget('a', 'b', '', 'hero');
	const body = (n) => JSON.stringify({ ...good(), v: n });

	let r = await M.writeIrig('a', 'b', t, body(1), null);
	ok('create (baseEtag null) succeeds', r.ok && typeof r.etag === 'string');
	ok('a create takes no backup', r.ok && r.backupId === null);
	const e1 = r.etag;

	r = await M.writeIrig('a', 'b', t, body(2), null);
	ok('a second create of the same .irig is a 409, not an overwrite', !r.ok && r.response.status === 409);
	ok('…and the stored rig is unchanged', JSON.parse(r2.objects.get(t.key).text).v === 1);

	r2.log.length = 0;
	r = await M.writeIrig('a', 'b', t, body(2), e1);
	ok('an update on the current etag succeeds', r.ok);
	ok('the previous bytes were copied aside BEFORE the put', r2.log[0] === 'copy ' + t.key && r2.log[1] === 'put ' + t.key, r2.log.join(' | '));
	const e2 = r.etag;

	r = await M.writeIrig('a', 'b', t, body(3), e1);
	const conflictBody = r.ok ? null : await r.response.json();
	ok('a stale etag is a 409 conflict', !r.ok && r.response.status === 409 && conflictBody.error === 'conflict');
	ok('…carrying the CURRENT etag, so "overwrite" can retry conditionally', conflictBody?.etag === e2);
	ok('…and nothing was overwritten', JSON.parse(r2.objects.get(t.key).text).v === 2);
	const before = (await M.listIrigBackups(t.backupsPrefix)).length;
	for (let i = 0; i < 5; i++) await M.writeIrig('a', 'b', t, body(3), e1);
	await M.writeIrig('a', 'b', t, body(3), null);
	ok('refused writes add NO backups (they would push real history out of retention)', (await M.listIrigBackups(t.backupsPrefix)).length === before);

	r = await M.writeIrig('a', 'b', t, body(3), conflictBody.etag);
	ok('the conditional retry on the returned etag succeeds', r.ok && JSON.parse(r2.objects.get(t.key).text).v === 3);

	r = await M.writeIrig('a', 'b', t, body(4), undefined);
	ok('force (undefined) overwrites', r.ok && JSON.parse(r2.objects.get(t.key).text).v === 4);

	const backups = await M.listIrigBackups(t.backupsPrefix);
	const versions = await Promise.all(backups.map(async (b) => JSON.parse(await M.readIrigBackup(t.backupsPrefix, b.id)).v));
	ok('history holds every overwritten version, once each', versions.join(',') === '3,2,1', versions.join(','));
	ok('readIrigBackup refuses a malformed id', (await M.readIrigBackup(t.backupsPrefix, '../../x')) === null);

	for (let i = 0; i < M.IRIG_BACKUP_KEEP + 5; i++) {
		const cur = r2.objects.get(t.key).etag;
		await new Promise((res) => setTimeout(res, 2)); // distinct ms stamps
		await M.writeIrig('a', 'b', t, body(10 + i), cur);
	}
	const kept = await M.listIrigBackups(t.backupsPrefix);
	ok(`retention keeps the newest ${M.IRIG_BACKUP_KEEP}`, kept.length === M.IRIG_BACKUP_KEEP, String(kept.length));
	ok('newest first', kept[0].id > kept[kept.length - 1].id);

	globalThis.__atlasMissing = [''];
	const cur = r2.objects.get(t.key).etag;
	r = await M.writeIrig('a', 'b', t, body(99), cur);
	const amBody = r.ok ? null : await r.response.json();
	ok('atlas-missing reports the write DID land, with its new etag', !r.ok && amBody.saved === true && amBody.etag === r2.objects.get(t.key).etag);
	globalThis.__atlasMissing = [];
}

console.log('\n5. scope mismatch + create claim');
{
	const mm = M.scopeMismatch('x', 'b');
	ok('the scope-mismatch answer is a 409 naming both projects', mm.status === 409 && /"x".*"b"/.test((await mm.json()).message));
	ok('claimNewIrig creates when absent', await M.claimNewIrig('a/b/spines/n/n.irig', '{}'));
	ok('claimNewIrig refuses when present', !(await M.claimNewIrig('a/b/spines/n/n.irig', '{}')));
}

console.log('\n6. no false refusals on the real skeletons checked into the repo');
{
	const appsDir = fileURLToPath(new URL('apps/', ROOT));
	let checked = 0;
	const refused = [];
	const files = readdirSync(appsDir).flatMap((app) => {
		try {
			return readdirSync(join(appsDir, app, 'static'), { recursive: true }).map(
				(f) => `${app}/static/${String(f).replaceAll('\\', '/')}`,
			);
		} catch {
			return [];
		}
	});
	for (const file of files) {
		if (!file.endsWith('.json') || !file.includes('/spines/')) continue;
		let doc;
		try { doc = JSON.parse(readFileSync(join(appsDir, file), 'utf8')); } catch { continue; }
		if (!doc || !Array.isArray(doc.bones)) continue;
		checked++;
		const p = M.irigDocProblem(doc);
		if (p) refused.push(`${file}: ${p}`);
	}
	ok(`every checked-in skeleton passes (${checked} checked)`, checked > 0 && refused.length === 0, refused.slice(0, 3).join(' | '));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
