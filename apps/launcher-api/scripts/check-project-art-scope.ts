/**
 * The Scene Editor's art scope (`$lib/server/projectArtScope.ts`): a project may read the ATLASES its
 * doc and its placed component defs reference — a SHARED def's atlas authored in another project of
 * the same client (`hudReadout` → `test6`'s `S_UI`) — and nothing beyond them.
 *
 *   1. `candidateAtlases` keeps only this client's keys SHAPED like an atlas manifest: another
 *      client's key, a traversal, an arbitrary `.json` (a doc, a config), an image, a folder are
 *      dropped.
 *      An atlas PAGE (built from the manifest's own, writable fields) is trusted only inside the
 *      manifest's project and only as an image (`pageAllowed`).
 *   2. `borrowsClientArt` refuses the shared `unassigned` pseudo-client and the default project.
 *   3. `artScopeAllows` allows exactly the scope's keys — no prefix matching, no traversal.
 *   4. Both editor art gates (regions + asset) go through `assertProjectArt`, so a referenced atlas
 *      AND its page stream — without it the editor drew every such frame as a grey placeholder.
 *   5. The REAL `loadRegionSet` over an in-memory R2 that records every key it touches: a manifest's
 *      own (author-writable) fields drive R2 reads ONLY inside the manifest's own project — no
 *      existence probe, HEAD or TexturePacker read of another project's key — and a manifest
 *      BORROWED from a sibling project resolves its page in THAT project, not the caller's.
 *   6. Art an author picks ONLY in a per-ratio instance override (`overrides.portrait.params`)
 *      is in the scope AND ships: the REAL `exportEditorArt` writes its sheet and its rig
 *      bundle to `deploy/editor-art/`. The editor reads R2 directly, so without this the game
 *      looks the portrait frame up in an atlas that was never exported.
 *
 * Run:  pnpm --filter launcher-api check:art-scope
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { mock } from 'node:test';
import { fileURLToPath } from 'node:url';

interface Stored {
	text: string;
	modified: number;
}
const bucket = new Map<string, Stored>();
/** Every key / prefix an R2 call was given since the last `load`. */
const touched: string[] = [];
const under = (prefix: string) =>
	[...bucket.entries()]
		.filter(([key]) => key.startsWith(prefix))
		.map(([key, o]) => ({ key, size: o.text.length, lastModified: o.modified }));
// The whole r2 surface the scope and the art export touch is in memory; the reads record.
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
mock.module(r2Url, {
	namedExports: {
		...(await import(r2Url)),
		getObjectText: async (key: string) => {
			touched.push(key);
			return bucket.get(key)?.text ?? null;
		},
		getObjectTextWithEtag: async (key: string) => {
			touched.push(key);
			const o = bucket.get(key);
			return o ? { text: o.text, etag: null } : null;
		},
		getObjectBytes: async (key: string) => {
			touched.push(key);
			const o = bucket.get(key);
			return o
				? { body: new TextEncoder().encode(o.text), contentType: 'application/json', etag: null }
				: null;
		},
		putObjectText: async (key: string, text: string) => {
			bucket.set(key, { text, modified: Date.now() });
		},
		copyObject: async (from: string, to: string) => {
			const o = bucket.get(from);
			if (o) bucket.set(to, { ...o });
			return !!o;
		},
		deleteObjects: async (keys: string[]) => {
			for (const key of keys) bucket.delete(key);
		},
		listAllKeys: async (prefix: string) => {
			touched.push(prefix);
			return under(prefix).map((o) => o.key);
		},
		headObject: async (key: string) => {
			touched.push(key);
			const o = bucket.get(key);
			return o ? { etag: null, size: o.text.length, lastModified: o.modified } : null;
		},
		objectExists: async (key: string) => {
			touched.push(key);
			return bucket.has(key);
		},
		listAllObjects: async (prefix: string) => {
			touched.push(prefix);
			return under(prefix);
		},
		listObjects: async (prefix: string) => {
			touched.push(prefix);
			return { keys: under(prefix).map((o) => o.key), prefixes: [] };
		},
	},
});

const { artScopeAllows, borrowsClientArt, candidateAtlases, isProjectArtAllowed, pageAllowed } =
	await import('../src/lib/server/projectArtScope.ts');
const { loadRegionSet } = await import('../src/lib/server/editorRegions.ts');
const { exportEditorArt } = await import('../src/lib/server/editorArtExport.ts');
const { editorDocKey, projectComponentKey, projectComponentVersionKey, SUB } =
	await import('../src/lib/server/projectPaths.ts');

const here = dirname(fileURLToPath(import.meta.url));
let failures = 0;
const check = (label: string, ok: boolean) => {
	console.log(`${ok ? '  ok ' : 'FAIL '} ${label}`);
	if (!ok) failures += 1;
};

const SHARED_DEF_ATLAS = 'invisible_wall/test6/manifests/atlas_manifest_S_UI.json';
const PAGE = 'invisible_wall/test6/sheets/S_UI/S_UI.png';

console.log('1. only this client’s atlas manifests');
const kept = candidateAtlases(
	[
		SHARED_DEF_ATLAS,
		'other_client/game/manifests/atlas_manifest_S_UI.json',
		'invisible_wall/../other_client/manifests/atlas_manifest_S_UI.json',
		'invisible_wall/test6/editor/scenes.json',
		'invisible_wall/test6/config/config.json',
		'invisible_wall/test6/sheets/S_UI/S_UI.png',
		'invisible_wall/',
		'invisible_wall/test6/spines/star/',
		'invisible_wall/test6/deep/manifests/atlas_manifest_S_UI.json',
	],
	'Invisible_Wall',
);
check('a sibling project’s atlas manifest is kept', kept.includes(SHARED_DEF_ATLAS));
check('everything else is dropped', kept.length === 1);
check(
	'NOT the shared library, for a client whose name slugs to `_shared`',
	candidateAtlases(['_shared/sheets/manifests/atlas_manifest_S_Sym.json'], '_Shared').length === 0,
);

console.log('1b. an atlas page is trusted only in its manifest’s project, and only as an image');
check('the atlas’s own page', pageAllowed(SHARED_DEF_ATLAS, PAGE));
check(
	'NOT a page a planted manifest points at another project’s editor doc',
	!pageAllowed(
		'invisible_wall/attacker/manifests/atlas_manifest_x.json',
		'invisible_wall/victim/editor/scenes.json',
	),
);
check(
	'NOT an image page in another project',
	!pageAllowed('invisible_wall/attacker/manifests/atlas_manifest_x.json', PAGE),
);
check(
	'NOT a non-image file in the same project',
	!pageAllowed(SHARED_DEF_ATLAS, 'invisible_wall/test6/config/config.json'),
);
check('NOT a traversal', !pageAllowed(SHARED_DEF_ATLAS, 'invisible_wall/test6/../victim/a.png'));

console.log('2. who may borrow client art');
check('a named client’s project may', borrowsClientArt('Invisible_Wall', 'hw-3pots-sample'));
check('NOT the unassigned pseudo-client', !borrowsClientArt('unassigned', 'some-game'));
check('NOT the default project', !borrowsClientArt('Invisible_Wall', 'cloud'));

console.log('3. what the scope allows');
const scope = { keys: new Set([SHARED_DEF_ATLAS, PAGE]) };
check('the referenced atlas', artScopeAllows(scope, SHARED_DEF_ATLAS));
check('its page', artScopeAllows(scope, PAGE));
check(
	'NOT a file next to the page',
	!artScopeAllows(scope, 'invisible_wall/test6/sheets/S_UI/x.png'),
);
check(
	'NOT a traversal dressed as a scope key',
	!artScopeAllows(scope, 'invisible_wall/test6/sheets/S_UI/../../editor/scenes.json'),
);

console.log('4. both editor art gates use the project art scope');
for (const route of ['regions', 'asset']) {
	const src = readFileSync(join(here, `../src/routes/api/editor/${route}/+server.ts`), 'utf8');
	check(
		`/api/editor/${route} gates through assertProjectArt`,
		/await assertProjectArt\(/.test(src),
	);
	check(
		`/api/editor/${route} no longer gates on the bare prefixes`,
		!/\bassertAllowed\(/.test(src),
	);
}

console.log('5. a manifest’s own fields read R2 only inside the manifest’s project');
const T0 = 1_700_000_000_000;
const put = (key: string, body: unknown, modified = T0) =>
	bucket.set(key, { text: typeof body === 'string' ? body : JSON.stringify(body), modified });
const REGIONS = [{ name: 'a', x: 0, y: 0, w: 8, h: 8 }];
const load = (manifestKey: string) => {
	touched.length = 0;
	return loadRegionSet(manifestKey);
};
const stayedIn = (home: string) => touched.every((key) => key.startsWith(home));

put('invisible_wall/victim/secret.png', 'x');
put('invisible_wall/victim/tp.json', {
	frames: { a: { frame: { x: 99, y: 99, w: 8, h: 8 } } },
	meta: { size: { w: 128, h: 128 } },
});
put('invisible_wall/victim/deploy/sprites/planted.webp', 'x');

const PLANTED = 'invisible_wall/attacker/manifests/atlas_manifest_planted.json';
put('invisible_wall/attacker/deploy/sprites/planted.webp', 'x');
put(
	PLANTED,
	{
		atlas: {
			source_image_path: 'invisible_wall/victim/secret.png',
			source_image: 'secret.png',
			texturepacker_json: 'invisible_wall/victim/tp.json',
		},
		export_prefix: 'invisible_wall/victim',
		regions: REGIONS,
	},
	T0 + 60_000,
);
let set = await load(PLANTED);
check(
	'L1 a planted `source_image_path` / `export_prefix` probes nothing outside its project',
	stayedIn('invisible_wall/attacker/'),
);
check(
	'L1 … not even the stale-deploy HEAD of its `source_image_path`',
	!touched.includes('invisible_wall/victim/secret.png'),
);
check(
	'L1 … so its page is its OWN deploy, whatever the foreign key holds',
	set.pageKey === 'invisible_wall/attacker/deploy/sprites/planted.webp',
);
check(
	'L2 a foreign `texturepacker_json` is never read',
	!touched.includes('invisible_wall/victim/tp.json'),
);
check('L2 … and its rects never land', set.regions[0]?.x === 0);
bucket.delete('invisible_wall/attacker/deploy/sprites/planted.webp');
set = await load(PLANTED);
check('L1 with no deploy of its own it resolves no page at all', set.pageKey === '');
check('L1 … still without leaving its project', stayedIn('invisible_wall/attacker/'));

const OWN = 'invisible_wall/test6/manifests/atlas_manifest_S_Own.json';
put('invisible_wall/test6/sheets/S_Own/S_Own.png', 'x');
put('invisible_wall/test6/sheets/S_Own/tp.json', {
	frames: { a: { frame: { x: 4, y: 4, w: 8, h: 8 } } },
	meta: { size: { w: 64, h: 64 } },
});
put(OWN, {
	atlas: {
		source_image_path: 'invisible_wall/test6/sheets/S_Own/S_Own.png',
		texturepacker_json: 'invisible_wall/test6/sheets/S_Own/tp.json',
	},
	regions: REGIONS,
});
set = await load(OWN);
check(
	'an own-project `source_image_path` still resolves',
	set.pageKey === 'invisible_wall/test6/sheets/S_Own/S_Own.png',
);
check('an own-project `texturepacker_json` still reconciles the rects', set.regions[0]?.x === 4);

const BORROWED = 'invisible_wall/test6/manifests/atlas_manifest_S_UI.json';
put(BORROWED, { atlas: { source_image: 'C:\\art\\S_UI.png' }, regions: REGIONS });
put('invisible_wall/test6/deploy/sprites/S_UI.webp', 'x');
put('invisible_wall/game/deploy/sprites/S_UI.webp', 'x', T0 + 120_000);
set = await load(BORROWED);
check(
	'L3 a borrowed legacy manifest shows ITS project’s deployed page, not the caller’s',
	set.pageKey === 'invisible_wall/test6/deploy/sprites/S_UI.webp',
);
bucket.delete('invisible_wall/test6/deploy/sprites/S_UI.webp');
put('invisible_wall/test6/atlas/S_UI.png', 'x');
set = await load(BORROWED);
check(
	'L3 … and, undeployed, its project’s atlas output',
	set.pageKey === 'invisible_wall/test6/atlas/S_UI.png',
);
check('L3 … never looking in the caller’s project', stayedIn('invisible_wall/test6/'));

const SHARED = '_shared/sheets/S_Sym/atlas_manifest_S_Sym.json';
put(SHARED, { atlas: { source_image: 'S_Sym.webp' }, regions: REGIONS });
put('_shared/sheets/S_Sym/S_Sym.webp', 'x');
set = await load(SHARED);
check(
	'a shared-library sheet resolves its page beside its manifest',
	set.pageKey === '_shared/sheets/S_Sym/S_Sym.webp',
);
check('… without listing any project’s deploy/', stayedIn('_shared/sheets/'));

console.log('6. art picked only in a per-ratio instance override is in the scope and ships');
const CLIENT = 'invisible_wall';
const PROJECT = 'ratio_art';
const sheet = (stem: string, frame: string) => {
	const manifest = `${SUB.manifests(CLIENT, PROJECT)}/atlas_manifest_${stem}.json`;
	const page = `${SUB.sheets(CLIENT, PROJECT)}/${stem}/${stem}.webp`;
	put(page, 'x');
	put(manifest, {
		atlas: { source_image_path: page },
		regions: [{ name: frame, x: 0, y: 0, w: 8, h: 8 }],
	});
	return manifest;
};
const LANDSCAPE_SHEET = sheet('S_Land', 'faceLand');
const PORTRAIT_SHEET = sheet('S_Port', 'facePort');
const LEGACY_SHEET = sheet('S_Legacy', 'faceLegacy');
const PINNED_SHEET = sheet('S_Pinned', 'facePinned');
const RIG = 'portraitRig';
const rigFolder = `${SUB.spines(CLIENT, PROJECT)}/${RIG}`;
put(`${SUB.spines(CLIENT, PROJECT)}/skeletons.json`, {
	skeletons: [{ folder: RIG, name: RIG, atlas_file: `${RIG}.atlas`, skeleton_file: `${RIG}.json` }],
});
put(`${rigFolder}/${RIG}.atlas`, `${RIG}.webp\nsize: 8,8\nbone\n  bounds: 0,0,8,8\n`);
put(`${rigFolder}/${RIG}.json`, { skeleton: { spine: '4.2' } });
put(`${rigFolder}/${RIG}.webp`, 'x');
const def = (id: string, version: number, params: { key: string; kind: string }[]) => ({
	id,
	name: id,
	version,
	scope: 'project',
	category: 'ui',
	params,
	root: { id: 'root', kind: 'container', x: 0, y: 0, children: [] },
});
put(
	projectComponentKey(PROJECT, 'ratioFace'),
	def('ratioFace', 1, [
		{ key: 'faceImage', kind: 'image' },
		{ key: 'introSpine', kind: 'spine' },
	]),
);
// The instance below is pinned to v1, whose image param v2 renamed: it renders v1, so v1's kinds
// decide what its params reference.
put(
	projectComponentVersionKey(PROJECT, 'pinnedFace', 1),
	def('pinnedFace', 1, [{ key: 'faceImage', kind: 'image' }]),
);
put(
	projectComponentKey(PROJECT, 'pinnedFace'),
	def('pinnedFace', 2, [{ key: 'face', kind: 'image' }]),
);
put(editorDocKey(CLIENT, PROJECT), {
	scenes: [
		{
			id: 'base',
			name: 'Base',
			nodes: [
				{
					id: 'face',
					kind: 'componentInstance',
					componentId: 'ratioFace',
					x: 0,
					y: 0,
					params: { faceImage: `${LANDSCAPE_SHEET}::faceLand` },
					overrides: {
						portrait: {
							params: { faceImage: `${PORTRAIT_SHEET}::facePort`, introSpine: RIG },
						},
						// A patch with no params, and one holding a legacy bare-basename ref that only
						// the ship path's repair can pin (and a non-string, which names nothing).
						landscape: { x: 5 },
						desktop: { params: { faceImage: 'atlas_manifest_S_Legacy.json::faceLegacy' } },
						tablet: { params: { introSpine: 0 } },
					},
				},
				{
					id: 'pinned',
					kind: 'componentInstance',
					componentId: 'pinnedFace',
					componentVersion: 1,
					x: 0,
					y: 0,
					overrides: { portrait: { params: { faceImage: `${PINNED_SHEET}::facePinned` } } },
				},
			],
		},
	],
});

const inScope = (key: string) => isProjectArtAllowed(key, [], CLIENT, PROJECT);
check('the base-params sheet is in the art scope', await inScope(LANDSCAPE_SHEET));
check('the sheet picked only in the portrait override is too', await inScope(PORTRAIT_SHEET));
check('… a legacy ref in an override is repaired and pins its sheet', await inScope(LEGACY_SHEET));
check('… a pinned instance’s override is read by its pinned def', await inScope(PINNED_SHEET));

const index = await exportEditorArt(CLIENT, PROJECT);
const deployPrefix = `${SUB.deploy(CLIENT, PROJECT)}/`;
const artPrefix = `${deployPrefix}editor-art/`;
const ships = (key: string) => index.sheets.find((s) => s.key === key);
check('the base-params sheet ships', !!ships(LANDSCAPE_SHEET));
const shippedSheet = ships(PORTRAIT_SHEET);
check('the portrait-only sheet is in the shipped index', !!shippedSheet);
check(
	'… and its spritesheet is written under deploy/editor-art/',
	!!shippedSheet && bucket.has(`${deployPrefix}${shippedSheet.json}`),
);
check(
	'… and its scoped frame counts as covered, not dangling',
	!index.missing.includes('facePort'),
);
check('the pinned instance’s portrait-only sheet ships', !!ships(PINNED_SHEET));
check(
	'the rig bundle picked only in the portrait override ships under its name',
	index.spines.some((s) => s.key === RIG),
);
check(
	'… its skeleton copied under deploy/editor-art/',
	under(artPrefix).some((o) => o.key.endsWith(`/${RIG}.json`)),
);

console.log(failures === 0 ? '\nart scope: OK' : `\nart scope: ${failures} FAILED`);
if (failures > 0) process.exit(1);
