/**
 * Contract check: a rig made from a sheet ships the SHEET's page, not its private 180° copy.
 *   pnpm --filter launcher-api check:rig-sheet-page
 *
 * A bundle made from a sheet keeps a copy of the sheet page with each rotated region turned 180°,
 * saved lossless (`reorientRotatedRegionsForRig`), because the rig runtime used to read a quarter
 * turn on a region only as counter-clockwise. On the Book of Borut remake those copies were 36.9 MB
 * of 48.4 MB of pages — 3–4× the lossy sheet pages they came from — and each was downloaded as a
 * second texture beside its sheet. The runtime reads `rotate:270` (clockwise) now, so the export
 * points the rig at the sheet page and reads its rotations clockwise.
 *
 * Runs the REAL `exportRigBundle`, `PageStore`, `ensureBundleAtlasFresh` and the sharp flip, over an
 * in-memory R2 and a stand-in `loadRegionSet`. Proves:
 *   1. a fresh bundle's atlas names the SAME shared `_pages/` file as the sheet's own export, its
 *      rotated region reads `rotate:270`, and nothing else is written to `_pages/`;
 *   2. the shipped page is the sheet page byte for byte;
 *   3. a bundle that drifted and could not re-sync ships its own page with `rotate:90`, as before;
 *   4. a rig with no source (an upload) ships its own page, unchanged;
 *   5. without a page store nothing changes: a per-bundle copy and `rotate:90`.
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import sharp from 'sharp';

interface Stored {
	body: Uint8Array;
	etag: string;
	modified: number;
}
const bucket = new Map<string, Stored>();
const enc = new TextEncoder();
const dec = new TextDecoder();
/** Keys whose writes fail — how a re-sync is made to fail without touching the code under test. */
const failingPrefixes = new Set<string>();

function put(key: string, body: Uint8Array): string {
	if ([...failingPrefixes].some((p) => key.startsWith(p))) throw new Error(`write refused: ${key}`);
	const etag = `"${createHash('md5').update(body).digest('hex')}"`;
	bucket.set(key, { body, etag, modified: Date.now() });
	return etag;
}

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		putObjectText: async (key: string, text: string) => put(key, enc.encode(text)),
		putObjectBytes: async (key: string, body: Uint8Array) => put(key, body),
		getObjectBytes: async (key: string) => {
			const o = bucket.get(key);
			return o ? { body: o.body, contentType: 'image/webp', etag: o.etag } : null;
		},
		getObjectText: async (key: string) => {
			const o = bucket.get(key);
			return o ? dec.decode(o.body) : null;
		},
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.body.length, lastModified: o.modified } : null;
		},
		objectExists: async (key: string) => bucket.has(key),
		copyObject: async (src: string, dest: string) => {
			const o = bucket.get(src);
			if (!o) return false;
			put(dest, o.body);
			return true;
		},
		listAllObjects: async (prefix: string) =>
			[...bucket.keys()]
				.filter((k) => k.startsWith(prefix))
				.map((key) => ({ key, size: bucket.get(key)!.body.length, lastModified: 0, etag: '' })),
		deleteObject: async (key: string) => void bucket.delete(key),
	},
});

const CLIENT = 'acme';
const PROJECT = 'p1';
const ROOT = `${CLIENT}/${PROJECT}`;
const MANIFEST = `${ROOT}/manifests/atlas_manifest_S_Sheet.json`;
const SHEET_PAGE = `${ROOT}/atlas/S_Sheet/S_Sheet.webp`;
const PAGE_W = 64;
const PAGE_H = 48;
// `w`/`h` are the UNROTATED size, as the manifest records them; `turned`'s footprint is 12×24.
const REGIONS = [
	{ name: 'flat', x: 0, y: 0, w: 16, h: 16, rotated: false },
	{ name: 'turned', x: 20, y: 0, w: 24, h: 12, rotated: true },
];
mock.module(server('editorRegions.ts'), {
	namedExports: {
		loadRegionSet: async (key: string) =>
			key === MANIFEST && bucket.has(SHEET_PAGE)
				? {
						assetKey: key,
						pageKey: SHEET_PAGE,
						pageWidth: PAGE_W,
						pageHeight: PAGE_H,
						regions: REGIONS,
					}
				: { assetKey: key, pageKey: '', pageWidth: 0, pageHeight: 0, regions: [] },
	},
});

const { exportRigBundle } = await import('../src/lib/server/rig.ts');
const { ensureBundleAtlasFresh } = await import('../src/lib/server/rigBundleSync.ts');
const { PageStore, PAGE_REF_PREFIX } = await import('../src/lib/server/pageStore.ts');

let checks = 0;
const ok = (label: string, condition: boolean, detail = ''): void => {
	if (!condition) {
		console.error(`\n  FAIL  ${label}${detail ? `\n        ${detail}` : ''}\n`);
		process.exit(1);
	}
	checks += 1;
	console.log(`  [ok] ${label}`);
};

/** A lossy page with a different colour in every 4×4 cell, so a flip is visible in the bytes. */
const sheetBytes = new Uint8Array(
	await sharp(
		Buffer.from(
			Array.from({ length: PAGE_W * PAGE_H }, (_, i) => {
				const cell = ((i % PAGE_W) >> 2) + ((Math.floor(i / PAGE_W) >> 2) << 4);
				return [(cell * 37) & 255, (cell * 91) & 255, (cell * 13) & 255, 255];
			}).flat(),
		),
		{ raw: { width: PAGE_W, height: PAGE_H, channels: 4 } },
	)
		.webp({ quality: 90 })
		.toBuffer(),
);

const DEPLOY = `${ROOT}/deploy/`;
const skeletonIndex = (folder: string) => [
	{
		name: folder,
		folder,
		skeleton_file: `${folder}.json`,
		atlas_file: `${folder}.atlas`,
		format: 'json' as const,
		runtime: '4.2',
		dir_b64: '',
	},
];

/** A bundle as `api/rigger/new` leaves it: skeleton + `source.json`, then synthesised by a sync. */
async function sheetRig(folder: string): Promise<string> {
	const prefix = `${ROOT}/spines/${folder}`;
	put(`${prefix}/${folder}.json`, enc.encode('{}'));
	put(
		`${prefix}/source.json`,
		enc.encode(
			JSON.stringify({ manifestKey: MANIFEST, pageName: 'S_Sheet.webp', geometryRevision: '' }),
		),
	);
	const synced = await ensureBundleAtlasFresh(CLIENT, PROJECT, prefix, `${folder}.atlas`);
	ok(`${folder}: the sync synthesised the bundle`, synced?.changed === true);
	return prefix;
}

const exportRig = (folder: string, pageStore?: InstanceType<typeof PageStore>) =>
	exportRigBundle({
		clientKey: CLIENT,
		projectKey: PROJECT,
		assetKey: `${ROOT}/spines/${folder}/`,
		deployPrefix: DEPLOY,
		subtree: 'editor-art',
		stem: folder,
		skeletonIndex: skeletonIndex(folder),
		pageStore,
	});

const deployedAtlas = (folder: string): string =>
	dec.decode(bucket.get(`${DEPLOY}editor-art/${folder}/${folder}.atlas`)!.body);

put(SHEET_PAGE, sheetBytes);

console.log('1. a fresh bundle ships the sheet page, read clockwise');
const bundle = await sheetRig('R_Fresh');
const bundlePage = bucket.get(`${bundle}/S_Sheet.webp`)!.body;
ok(
	'(precondition) the bundle holds its own turned copy of the page',
	Buffer.compare(Buffer.from(bundlePage), Buffer.from(sheetBytes)) !== 0,
);
const store = new PageStore(DEPLOY);
const sheetShared = await store.ensure(SHEET_PAGE, 'webp'); // what the sheet's own export does
ok('(precondition) the sheet page is in the store', sheetShared !== null);
const fresh = await exportRig('R_Fresh', store);
ok('the rig exports', fresh !== null);
const atlas = deployedAtlas('R_Fresh');
ok(
	'its atlas names the sheet’s shared page',
	atlas.split('\n')[0] === `${PAGE_REF_PREFIX}${sheetShared!.file}`,
	atlas.split('\n')[0],
);
ok('the rotated region reads rotate:270', /^turned\n[^]*?rotate:270$/m.test(atlas), atlas);
ok('no region still reads rotate:90', !/rotate:90/.test(atlas), atlas);
ok('the flat region gains no rotation', !/^flat\n[^\n]*\nrotate/m.test(atlas), atlas);
const pages = [...store.written].filter((k) => !k.endsWith('.meta.json'));
ok('nothing but the sheet page was written to _pages/', pages.length === 1, pages.join(', '));

console.log('2. the shipped page is the sheet page, byte for byte');
const shipped = bucket.get(`${DEPLOY}_pages/${sheetShared!.file}`)!.body;
ok('identical bytes', Buffer.compare(Buffer.from(shipped), Buffer.from(sheetBytes)) === 0);

console.log('3. a bundle that drifted and could not re-sync keeps its own page and rotate:90');
const stale = await sheetRig('R_Stale');
put(SHEET_PAGE, new Uint8Array(await sharp(sheetBytes).webp({ quality: 50 }).toBuffer()));
failingPrefixes.add(`${stale}/`);
const staleStore = new PageStore(DEPLOY);
ok('the rig exports', (await exportRig('R_Stale', staleStore)) !== null);
const staleAtlas = deployedAtlas('R_Stale');
ok(
	'its rotated region still reads rotate:90',
	/rotate:90/.test(staleAtlas) && !/rotate:270/.test(staleAtlas),
);
const staleShared = await staleStore.ensure(`${stale}/S_Sheet.webp`, 'webp');
ok(
	'its atlas names the bundle’s own page',
	staleAtlas.split('\n')[0] === `${PAGE_REF_PREFIX}${staleShared!.file}`,
	staleAtlas.split('\n')[0],
);
failingPrefixes.clear();
put(SHEET_PAGE, sheetBytes);

console.log('4. a rig with no source (an upload) ships its own page');
const upload = `${ROOT}/spines/R_Upload`;
put(`${upload}/R_Upload.json`, enc.encode('{}'));
put(`${upload}/up.webp`, sheetBytes);
put(
	`${upload}/R_Upload.atlas`,
	enc.encode('up.webp\nsize:64,48\nfilter:Linear,Linear\nturned\nbounds:20,0,24,12\nrotate:90\n'),
);
ok('the rig exports', (await exportRig('R_Upload', new PageStore(DEPLOY))) !== null);
ok('its atlas keeps rotate:90', /rotate:90/.test(deployedAtlas('R_Upload')));

console.log('5. without a page store nothing changes');
const plain = await sheetRig('R_Plain');
ok('the rig exports', (await exportRig('R_Plain')) !== null);
const plainAtlas = deployedAtlas('R_Plain');
ok('its atlas names its own page', plainAtlas.split('\n')[0] === 'S_Sheet.webp', plainAtlas);
ok('…and keeps rotate:90', /rotate:90/.test(plainAtlas) && !/rotate:270/.test(plainAtlas));
ok(
	'…and the copy beside it is the bundle’s turned page',
	Buffer.compare(
		Buffer.from(bucket.get(`${DEPLOY}editor-art/R_Plain/S_Sheet.webp`)!.body),
		Buffer.from(bucket.get(`${plain}/S_Sheet.webp`)!.body),
	) === 0,
);

console.log(`\nrig sheet page: ${checks} checks passed`);
