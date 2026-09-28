// Offline fixture for the runtime bundle's SOURCE FINGERPRINT (game-maker open item 6).
//
//   node scripts/verify-runtime-source-fingerprint.mjs
//
// WHY THIS EXISTS. `runtimeBundleCache` warns at length against fingerprinting the sources to cache
// longer, and the warning is correct: a digest that misses one input tree yields a false cache HIT
// — the author saves, the game serves an old bundle, and it looks perfectly healthy. Every property
// that keeps it honest fails SILENTLY, so none of them is left to inspection:
//
//   1. `deploy/` IS EXCLUDED. The assemble writes its exports there, so a digest that included it
//      would change on every run and never hit. This is the difference between the feature working
//      and being dead weight — and it fails "slow", which is easy not to notice.
//   2. AN IN-PLACE OVERWRITE IS NOTICED. The ordinary save rewrites a doc under the SAME key. A
//      names-only digest would miss nearly every real edit; this is the false-HIT case itself.
//   3. LISTING ORDER CANNOT CHANGE IT. R2 pages results back in no guaranteed order, so an
//      unchanged project must still digest identically — otherwise it never hits.
//   4. A LISTING FAILURE RETURNS null, never a digest. `null` is the caller's "cannot cache".
//   5. THE TREE LIST IS DISCOVERED. A folder nobody hardcoded still gets fingerprinted, which is
//      what stops a newly invented path from silently going unwatched.
//
// HOW IT RUNS THE REAL SOURCE. `runtimeSourceFingerprint` is IMPORTED from the shipped module (Node
// >= 22 strips the types) and driven against a synthetic bucket through its `io` seam. Nothing below
// re-implements the digest.

import assert from 'node:assert/strict';
import { runtimeSourceFingerprint } from '../apps/launcher-api/src/lib/server/runtimeSourceFingerprint.ts';

let failures = 0;
// ⚠️ AWAITS `fn`. It used to call it bare, which silently passed every assertion written inside
// an `async () =>` body: the rejection landed after `ok` had already printed, as an unhandled
// rejection nobody reads. A green check that cannot fail is worse than no check.
const check = async (name, fn) => {
	try {
		await fn();
		console.log(`  ok   ${name}`);
	} catch (e) {
		failures++;
		console.error(`  FAIL ${name}\n       ${e.message}`);
	}
};

/** A synthetic bucket: a flat map of key -> {size, lastModified}. */
const makeIo = (objects, { failOn } = {}) => ({
	rootPrefix: (c, p) => c + '/' + p + '/',
	listFolder: async (prefix) => {
		if (failOn === 'folder') throw new Error('listing exploded');
		const folders = new Set();
		const files = [];
		for (const [key, meta] of Object.entries(objects)) {
			if (!key.startsWith(prefix)) continue;
			const rest = key.slice(prefix.length);
			const slash = rest.indexOf('/');
			if (slash === -1) files.push({ key, size: meta.size, lastModified: meta.lastModified });
			else folders.add(prefix + rest.slice(0, slash + 1));
		}
		return { files, folders: [...folders] };
	},
	listAllObjects: async (prefix) => {
		if (failOn === 'objects') throw new Error('listing exploded');
		return Object.entries(objects)
			.filter(([key]) => key.startsWith(prefix))
			.map(([key, meta]) => ({ key, size: meta.size, lastModified: meta.lastModified }));
	},
});

const BASE = {
	'acme/game1/editor/scenes.json': { size: 100, lastModified: 1000 },
	'acme/game1/symbols/symbols.json': { size: 50, lastModified: 1000 },
	'acme/game1/clips/a.clip.json': { size: 20, lastModified: 1000 },
	'acme/game1/manifests/atlas_x.json': { size: 30, lastModified: 1000 },
	'acme/game1/project.json': { size: 10, lastModified: 1000 }, // a root-level file
	'editor/game1/components/c1.json': { size: 15, lastModified: 1000 },
	'_shared/editor-components/shared1.json': { size: 15, lastModified: 1000 },
};
const fp = (objects, opts) => runtimeSourceFingerprint('acme', 'game1', makeIo(objects, opts));

console.log('1. deploy/ is EXCLUDED — the assemble writes there every run');
{
	const base = await fp(BASE);
	// Exactly what an assemble does: write a pile of exports under deploy/.
	const afterAssemble = await fp({
		...BASE,
		'acme/game1/deploy/editor-art/index.json': { size: 900, lastModified: 2000 },
		'acme/game1/deploy/clips/a.json': { size: 400, lastModified: 2000 },
		'acme/game1/deploy/_pages/abc.webp': { size: 99999, lastModified: 2000 },
	});
	await check('an assemble writing deploy/ does NOT change the digest', () =>
		assert.equal(afterAssemble, base),
	);
}

console.log('2. an IN-PLACE overwrite is noticed (the ordinary save)');
{
	const base = await fp(BASE);
	const touched = { ...BASE };
	touched['acme/game1/editor/scenes.json'] = { size: 100, lastModified: 2000 }; // same key + size
	await check('same key, same size, newer mtime => different digest', async () =>
		assert.notEqual(await fp(touched), base),
	);
	const resized = { ...BASE };
	resized['acme/game1/editor/scenes.json'] = { size: 101, lastModified: 1000 }; // same key + mtime
	await check('same key, same mtime, new size => different digest', async () =>
		assert.notEqual(await fp(resized), base),
	);
}

console.log('3. adds / removes are noticed, anywhere');
{
	const base = await fp(BASE);
	for (const key of [
		'acme/game1/clips/b.clip.json', // a project subfolder
		'editor/game1/components/c2.json', // the project component tree
		'_shared/editor-components/shared2.json', // a SHARED tree
		'acme/game1/newtool/thing.json', // a folder no constant mentions
	]) {
		await check(`adding ${key.split('/').slice(-2).join('/')} changes the digest`, async () =>
			assert.notEqual(await fp({ ...BASE, [key]: { size: 1, lastModified: 3000 } }), base),
		);
	}
	const { 'acme/game1/clips/a.clip.json': _gone, ...without } = BASE;
	await check('removing a file changes the digest', async () =>
		assert.notEqual(await fp(without), base),
	);
}

console.log('4. listing ORDER cannot change it');
{
	const base = await fp(BASE);
	const shuffled = Object.fromEntries(Object.entries(BASE).reverse());
	await check('a reversed listing digests identically', async () =>
		assert.equal(await fp(shuffled), base),
	);
	await check('the same bucket twice digests identically', async () =>
		assert.equal(await fp(BASE), base),
	);
}

console.log('5. any listing failure returns null — never a digest');
{
	await check('a listFolder failure returns null', async () =>
		assert.equal(await fp(BASE, { failOn: 'folder' }), null),
	);
	await check('a listAllObjects failure returns null', async () =>
		assert.equal(await fp(BASE, { failOn: 'objects' }), null),
	);
}

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
