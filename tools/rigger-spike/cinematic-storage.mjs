// Offline contract test for the cinematic R2 storage module's PURE parts.
//
//   node tools/rigger-spike/cinematic-storage.mjs
//
// Bundles the REAL `apps/launcher-api/src/lib/server/cinematicStorage.ts` with esbuild, stubbing
// its `./r2` import (the AWS SDK + SvelteKit's `$env` virtual module) so the pure helpers can run
// without cloud credentials — the same technique as `reindex-preserve.mjs`. The stub THROWS if
// touched, so a helper that quietly reached for R2 would fail loudly rather than pass.
//
// What matters here is the pair that guards the stored document:
//   - `cinematicKey` must path-guard the id (an id is user-supplied text that becomes an R2 key)
//   - `isCinematicDoc` must reject junk without rejecting documents a NEWER client wrote
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const ESBUILD = new URL('node_modules/.pnpm/esbuild@0.25.5/node_modules/esbuild/lib/main.js', ROOT).href;
const SERVER_DIR = fileURLToPath(new URL('apps/launcher-api/src/lib/server/', ROOT));
const esbuild = await import(ESBUILD);

const stubR2Plugin = {
	name: 'stub-r2',
	setup(build) {
		build.onResolve({ filter: /^\.\/r2$/ }, () => ({ path: 'stub-r2', namespace: 'stub' }));
		build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
			contents: `
				const nope = (n) => () => { throw new Error('pure helper unexpectedly called R2: ' + n); };
				export const deleteObject = nope('deleteObject');
				export const getObjectTextWithEtag = nope('getObjectTextWithEtag');
				export const listAllObjects = nope('listAllObjects');
				export const precondition = nope('precondition');
				export const putObjectText = nope('putObjectText');
			`,
			loader: 'js',
		}));
	},
};

const out = join(mkdtempSync(join(tmpdir(), 'cine-store-')), 'bundle.mjs');
await esbuild.build({
	entryPoints: [join(SERVER_DIR, 'cinematicStorage.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: out,
	plugins: [stubR2Plugin],
	logLevel: 'silent',
});
const { cinematicKey, isCinematicDoc } = await import(pathToFileURL(out).href);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) { pass++; console.log(`  ✓ ${name}`); }
	else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); }
};

console.log('\n1. cinematicKey — path safety');
{
	ok('lands under the project prefix', cinematicKey('acme', 'borut', 'intro') === 'acme/borut/cinematics/intro.json');
	ok('slugs the client/project the same way every other tool does', cinematicKey('My Client', 'Book-Of-Borut', 'x') === 'my_client/book_of_borut/cinematics/x.json');

	// The id is user-supplied text that becomes part of an R2 key.
	const traversal = cinematicKey('c', 'p', '../../../etc/passwd');
	ok('a traversal id cannot escape the prefix', traversal.startsWith('c/p/cinematics/') && !traversal.includes('..'), traversal);
	const slashes = cinematicKey('c', 'p', 'a/b/c');
	ok('an id with slashes cannot create sub-paths', slashes === 'c/p/cinematics/a_b_c.json', slashes);
	ok('an empty id still yields a usable key', cinematicKey('c', 'p', '') === 'c/p/cinematics/default.json', cinematicKey('c', 'p', ''));
	ok('a very long id is bounded', cinematicKey('c', 'p', 'x'.repeat(500)).length < 140);
}

console.log('\n2. isCinematicDoc — guards the stored doc without over-rejecting');
{
	const good = {
		schemaVersion: 1, id: 'a', name: 'A', duration: 6, fps: 30,
		stage: { sceneId: null, cast: [] }, tracks: [], markers: [],
	};
	ok('accepts a well-formed doc', isCinematicDoc(good));
	ok('accepts a doc with unknown EXTRA fields (a newer client wrote it)', isCinematicDoc({ ...good, futureThing: { a: 1 }, markers: [{ kind: 'wait' }] }));
	ok('accepts unknown TRACK kinds (forward compatible)', isCinematicDoc({ ...good, tracks: [{ kind: 'somethingNew', channels: {} }] }));

	ok('rejects null / non-objects', !isCinematicDoc(null) && !isCinematicDoc('x') && !isCinematicDoc(42) && !isCinematicDoc([]));
	ok('rejects a missing stage', !isCinematicDoc({ ...good, stage: undefined }));
	ok('rejects a stage whose cast is not an array', !isCinematicDoc({ ...good, stage: { cast: {} } }));
	ok('rejects missing tracks', !isCinematicDoc({ ...good, tracks: undefined }));
	ok('rejects a non-numeric duration', !isCinematicDoc({ ...good, duration: '6' }));
	ok('rejects a NaN/Infinity duration (would poison every time calculation)',
		!isCinematicDoc({ ...good, duration: NaN }) && !isCinematicDoc({ ...good, duration: Infinity }));
	ok('rejects a missing id or name', !isCinematicDoc({ ...good, id: undefined }) && !isCinematicDoc({ ...good, name: 5 }));
}

// =========================================================================
// The EXPORT half (rule 8): deploy/ mirroring + the rig-name seed that makes a
// cinematic's rigs actually ship. Bundled against a WORKING in-memory R2 so the real
// storage module runs underneath it — this is an end-to-end test of the export, not of a mock.
// =========================================================================

const fakeR2 = { objects: new Map(), deleted: [] };
const workingR2Plugin = {
	name: 'working-r2',
	setup(build) {
		build.onResolve({ filter: /^\.\/r2$/ }, () => ({ path: 'work-r2', namespace: 'work' }));
		build.onLoad({ filter: /.*/, namespace: 'work' }, () => ({
			// Backed by a GLOBAL so the test can inspect it: esbuild bundles this stub into the
			// module graph, and its own exports are not re-exported through the entry point.
			contents: `
				const S = (globalThis.__FAKE_R2__ ||= { objects: new Map(), deleted: [] });
				export async function getObjectTextWithEtag(key) {
					const v = S.objects.get(key);
					return v === undefined ? null : { text: v, etag: 'etag-' + key };
				}
				export async function putObjectText(key, text) { S.objects.set(key, text); return 'etag-' + key; }
				export async function listAllObjects(prefix) {
					return [...S.objects.keys()].filter((k) => k.startsWith(prefix))
						.map((key, i) => ({ key, size: 1, lastModified: 1000 + i }));
				}
				export async function deleteObject(key) { S.objects.delete(key); S.deleted.push(key); }
				export async function deleteObjects(keys) { for (const k of keys) { S.objects.delete(k); S.deleted.push(k); } }
				export const precondition = () => undefined;
			`,
			loader: 'js',
		}));
	},
};

const exportOut = join(mkdtempSync(join(tmpdir(), 'cine-export-')), 'bundle.mjs');
await esbuild.build({
	entryPoints: [join(SERVER_DIR, 'cinematicExport.ts')],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: exportOut,
	plugins: [workingR2Plugin],
	logLevel: 'silent',
});
const EX = await import(pathToFileURL(exportOut).href);

const mkDoc = (id, cast) => ({
	schemaVersion: 1, id, name: id, duration: 4, fps: 30,
	stage: { sceneId: null, cast }, tracks: [], markers: [],
});
const actor = (folder) => ({ actorId: 'a_' + folder, rigFolder: folder, rigId: 7, place: {} });

console.log('\n3. cinematicRigNames — the seed that makes a cinematic\'s rigs ship');
{
	const names = EX.cinematicRigNames([
		mkDoc('a', [actor('hero'), actor('villain')]),
		mkDoc('b', [actor('hero')]),
	]);
	ok('collects every cast rig folder, de-duplicated', [...names].sort().join(',') === 'hero,villain', [...names].join(','));
	ok('ignores the positional rigId entirely', ![...names].includes('7') && ![...names].includes(7));
	ok('a doc with no cast contributes nothing', EX.cinematicRigNames([mkDoc('c', [])]).size === 0);
	ok('a cast member with no rigFolder is skipped, not crashed on',
		EX.cinematicRigNames([mkDoc('d', [{ actorId: 'x', place: {} }])]).size === 0);
}

console.log('\n4. exportCinematics — deploy mirroring + pruning');
{
	const store = globalThis.__FAKE_R2__.objects;
	store.clear();

	const authored = [mkDoc('intro', [actor('hero')]), mkDoc('outro', [actor('villain')])];
	const idx = await EX.exportCinematics('acme', 'borut', authored);
	const keys = [...store.keys()];
	ok('writes one deploy object per cinematic',
		keys.includes('acme/borut/deploy/cinematics/intro.json') && keys.includes('acme/borut/deploy/cinematics/outro.json'),
		keys.join(' | '));
	ok('returns the docs for the bundle to embed', idx.cinematics && idx.cinematics.length === 2, JSON.stringify(idx.cinematics?.length));
	ok('the deployed object is the document itself', JSON.parse(store.get('acme/borut/deploy/cinematics/intro.json')).id === 'intro');

	// Re-export with one removed → the stale deploy object must be pruned, not left behind.
	const idx2 = await EX.exportCinematics('acme', 'borut', [authored[0]]);
	const keys2 = [...store.keys()];
	ok('a cinematic removed since the last export is PRUNED from deploy/',
		!keys2.includes('acme/borut/deploy/cinematics/outro.json') && keys2.includes('acme/borut/deploy/cinematics/intro.json'),
		keys2.join(' | '));
	ok('...and the returned set shrinks with it', idx2.cinematics.length === 1);

	// An un-authored (cast-less) cinematic must not ship — and must clear the deploy tree.
	const idx3 = await EX.exportCinematics('acme', 'borut', []);
	ok('no authored cinematics ⇒ nothing embedded (parity)', idx3.cinematics === undefined, JSON.stringify(idx3));
	ok('...and deploy/ is emptied', [...store.keys()].filter((k) => k.includes('/deploy/cinematics/')).length === 0);

	// Project isolation: exporting one project must never touch another's deploy tree.
	store.set('other/proj/deploy/cinematics/keep.json', '{}');
	await EX.exportCinematics('acme', 'borut', [mkDoc('intro', [actor('hero')])]);
	ok('another project\'s deploy tree is untouched', store.has('other/proj/deploy/cinematics/keep.json'));
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
