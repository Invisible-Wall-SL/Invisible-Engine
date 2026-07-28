// Offline contract test for the Rigger save-hardening (never silently un-ship a rig).
//
//   node tools/rigger-spike/reindex-preserve.mjs
//
// Bundles the REAL pure helpers from apps/launcher-api/src/lib/server/spineIndex.ts with
// esbuild (stubbing the SvelteKit `$env/dynamic/private` virtual module + externalising the
// AWS SDK, neither of which the pure helpers touch) and drives `reindexSkeletonsPreserving`
// + `mergePreservingDroppedFolders` through fake, R2-free deps. Proves:
//   (a) skeleton + atlas               -> entry kept, byte-parity (no preserve, identity index).
//   (b) skeleton, no atlas, source.json -> atlas re-derived, entry kept.
//   (c) skeleton, no atlas, no source   -> the SAVED rig is reported atlas-missing (endpoint
//       fails loudly), and a DIFFERENT such folder's prior entry is PRESERVED, never dropped.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const ESBUILD = new URL(
	'node_modules/.pnpm/esbuild@0.25.5/node_modules/esbuild/lib/main.js',
	ROOT,
).href;
const SERVER_DIR = fileURLToPath(new URL('apps/launcher-api/src/lib/server/', ROOT));

const esbuild = await import(ESBUILD);

// Stub spineIndex's `./r2` import so esbuild never pulls in the AWS SDK / SvelteKit `$env`
// (the pure helpers under test call none of it). The stub throws if ever invoked, which
// would catch a helper accidentally reaching for R2.
const stubR2Plugin = {
	name: 'stub-r2',
	setup(build) {
		build.onResolve({ filter: /^\.\/r2$/ }, () => ({ path: 'stub-r2', namespace: 'stub-r2' }));
		build.onLoad({ filter: /.*/, namespace: 'stub-r2' }, () => ({
			contents:
				'const nope = () => { throw new Error("pure helper unexpectedly called R2"); };' +
				'export const getObjectBytes = nope, getObjectText = nope, listAllKeys = nope;',
			loader: 'js',
		}));
	},
};

const outdir = mkdtempSync(join(tmpdir(), 'rigger-reindex-'));
const outfile = join(outdir, 'spineIndex.mjs');
await esbuild.build({
	stdin: {
		contents:
			"export { reindexSkeletonsPreserving, mergePreservingDroppedFolders } from './spineIndex.ts';",
		resolveDir: SERVER_DIR,
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile,
	plugins: [stubR2Plugin],
	logLevel: 'silent',
});
const { reindexSkeletonsPreserving, mergePreservingDroppedFolders } = await import(
	pathToFileURL(outfile).href
);

let pass = true;
const log = (ok, msg) => {
	console.log((ok ? '  ✅ ' : '  ✗ ') + msg);
	if (!ok) pass = false;
};

const PREFIX = 'client/project/spines';
// A minimal but shape-complete index entry (id gets reassigned by the merge).
const entry = (folder, over = {}) => ({
	name: `${folder}/${folder}`,
	folder,
	skeleton_file: `${folder}.irig`,
	atlas_file: `${folder}.atlas`,
	format: 'json',
	version: '4.2.0',
	runtime: '4.2',
	pma: false,
	dir_b64: Buffer.from(folder, 'utf8').toString('base64url'),
	id: 0,
	...over,
});
const idx = (folders) => ({ prefix: PREFIX, skeletons: folders.map((f) => entry(f)) });

// Mirror the save endpoint's loud-fail decision so the test asserts the same contract.
const savedRigWouldFail = (outcome, savedFolder) =>
	outcome.atlasMissingFolders.includes(savedFolder);

console.log('\n=== Rigger save hardening: reindex never silently drops a rig ===');

// ---------------------------------------------------------------------------------------
// (a) Healthy project: every skeleton folder has an atlas. Parity — index returned as-is,
//     nothing re-derived, nothing preserved, and it is the IDENTICAL object (identity).
// ---------------------------------------------------------------------------------------
{
	const healthy = idx(['R_Alpha', 'R_Beta']);
	let scans = 0;
	let rederiveCalls = 0;
	const outcome = await reindexSkeletonsPreserving({
		scan: async () => {
			scans++;
			return { index: healthy, atlasMissingFolders: [] };
		},
		readPriorIndex: async () => {
			throw new Error('prior index must NOT be read on the healthy fast path');
		},
		rederiveAtlas: async () => {
			rederiveCalls++;
			return false;
		},
	});
	log(outcome.index === healthy, '(a) healthy: index returned unchanged (identity, byte-parity)');
	log(scans === 1, '(a) healthy: scanned once, no wasteful rescan');
	log(rederiveCalls === 0, '(a) healthy: no re-derive attempted');
	log(
		outcome.preservedFolders.length === 0 && outcome.atlasMissingFolders.length === 0,
		'(a) healthy: nothing preserved, nothing atlas-missing',
	);
	log(!savedRigWouldFail(outcome, 'R_Alpha'), '(a) healthy: saving R_Alpha does NOT fail');
}

// ---------------------------------------------------------------------------------------
// (b) Saved rig R_Cinematic1 has a skeleton, no atlas, but a source.json. Layer 1 re-derives
//     its atlas; the rescan then finds it and keeps the entry. Nothing preserved-from-prior.
// ---------------------------------------------------------------------------------------
{
	const withCinematic = idx(['R_Alpha', 'R_Cinematic1']);
	let scans = 0;
	const rederived = [];
	const outcome = await reindexSkeletonsPreserving({
		scan: async () => {
			scans++;
			// First scan: R_Cinematic1 atlas-less. After a re-derive, it resolves.
			if (scans === 1) return { index: idx(['R_Alpha']), atlasMissingFolders: ['R_Cinematic1'] };
			return { index: withCinematic, atlasMissingFolders: [] };
		},
		readPriorIndex: async () => idx(['R_Alpha', 'R_Cinematic1']),
		rederiveAtlas: async (folder, atlasFile) => {
			rederived.push([folder, atlasFile]);
			return true; // source.json present -> ensureBundleAtlasFresh succeeds
		},
	});
	log(
		rederived.length === 1 && rederived[0][0] === 'R_Cinematic1',
		'(b) source present: re-derive attempted for R_Cinematic1',
	);
	log(
		rederived[0][1] === 'R_Cinematic1.atlas',
		'(b) re-derive used the prior entry’s atlas_file (R_Cinematic1.atlas)',
	);
	log(
		outcome.index.skeletons.some((s) => s.folder === 'R_Cinematic1'),
		'(b) R_Cinematic1 kept in the rebuilt index',
	);
	log(outcome.rederivedFolders.includes('R_Cinematic1'), '(b) reported as re-derived');
	log(outcome.atlasMissingFolders.length === 0, '(b) nothing still atlas-missing');
	log(!savedRigWouldFail(outcome, 'R_Cinematic1'), '(b) saving R_Cinematic1 does NOT fail');
}

// ---------------------------------------------------------------------------------------
// (c) Save rig R_Cinematic1 which has a skeleton, no atlas, NO source; a DIFFERENT rig
//     R_OtherBroken is also atlas-less + sourceless and WAS in the prior index. The saved
//     rig must be reported atlas-missing (endpoint 400s); R_OtherBroken must be preserved,
//     never dropped. Also assert saving R_Cinematic1 does not un-ship R_OtherBroken.
// ---------------------------------------------------------------------------------------
{
	const priorFull = idx(['R_Alpha', 'R_Cinematic1', 'R_OtherBroken']);
	const rederiveTried = [];
	const outcome = await reindexSkeletonsPreserving({
		// Both broken folders are excluded from the fresh scan (no atlas); only R_Alpha builds.
		scan: async () => ({
			index: idx(['R_Alpha']),
			atlasMissingFolders: ['R_Cinematic1', 'R_OtherBroken'],
		}),
		readPriorIndex: async () => priorFull,
		rederiveAtlas: async (folder) => {
			rederiveTried.push(folder);
			return false; // no source.json -> cannot rebuild
		},
	});
	log(
		rederiveTried.length === 2,
		'(c) re-derive attempted for both atlas-less folders before giving up',
	);
	const folders = outcome.index.skeletons.map((s) => s.folder);
	log(folders.includes('R_Alpha'), '(c) healthy R_Alpha still listed');
	log(
		folders.includes('R_OtherBroken'),
		'(c) DIFFERENT broken rig R_OtherBroken PRESERVED (not silently dropped)',
	);
	log(
		outcome.preservedFolders.includes('R_OtherBroken'),
		'(c) R_OtherBroken reported as preserved',
	);
	log(
		outcome.atlasMissingFolders.includes('R_Cinematic1'),
		'(c) saved rig R_Cinematic1 reported atlas-missing',
	);
	log(savedRigWouldFail(outcome, 'R_Cinematic1'), '(c) endpoint would FAIL the save LOUDLY');
	// ids are contiguous 0..n-1 and follow the case-insensitive name sort.
	const ids = outcome.index.skeletons.map((s) => s.id);
	log(
		ids.join(',') === outcome.index.skeletons.map((_, i) => i).join(','),
		'(c) preserved entries get contiguous ids (index indistinguishable from a full scan)',
	);
	const names = outcome.index.skeletons.map((s) => s.name);
	const sorted = [...names].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
	log(names.join('|') === sorted.join('|'), '(c) merged index stays name-sorted');
}

// ---------------------------------------------------------------------------------------
// (d) Pure merge unit: identity when nothing to preserve; no prior index -> nothing invented.
// ---------------------------------------------------------------------------------------
{
	const fresh = idx(['R_Alpha']);
	const same = mergePreservingDroppedFolders(fresh, idx(['R_Alpha']), []);
	log(same.index === fresh, '(d) merge with no missing folders is identity (byte-parity)');
	const noPrior = mergePreservingDroppedFolders(fresh, null, ['R_Ghost']);
	log(
		noPrior.index === fresh && noPrior.preservedFolders.length === 0,
		'(d) merge with no prior index invents nothing',
	);
	// A missing folder absent from the prior index cannot be preserved (nothing to keep).
	const absent = mergePreservingDroppedFolders(fresh, idx(['R_Alpha']), ['R_Unknown']);
	log(
		absent.index === fresh && absent.preservedFolders.length === 0,
		'(d) a missing folder with no prior entry is not resurrected',
	);
}

console.log(
	pass
		? '\n✅ PASS — a save/reindex re-derives or preserves; it never silently drops a rig.'
		: '\n✗ FAIL',
);
process.exit(pass ? 0 : 1);
