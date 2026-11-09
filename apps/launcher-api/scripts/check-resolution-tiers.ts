/**
 * Contract check: resolution tiers (`docs/design/arcade-4k-builds.md` Phase 3).
 *   pnpm --filter launcher-api check:resolution-tiers
 *
 * A 4K game asks for its art at half size too (`LayoutDoc.resolutionTiers: ['half']`), so desktops
 * and phones need not download the cabinet's pages. Runs the REAL `PageStore` and `exportRigBundle`,
 * with the real sharp resize and Basis encode, over an in-memory R2. Proves:
 *   1. a store that asked for no tiers writes exactly what it did: no tier page, no `tiers` field;
 *   2. a store that asked for `half` writes the page at half size, near-lossless WebP like every
 *      shared page, its KTX2 twin, and a sidecar recording the source's size;
 *   3. the next assemble reuses all of it: no download, no resize, no encode, no write;
 *   4. a rig exported through that store gets a half atlas naming the half page, with its `size:`
 *      and every region coord halved, and a half KTX2 atlas naming the half page's twin;
 *   5. a rig exported through a store with no tiers carries no `tiers` and writes no tier atlas.
 * The doc reader keeping `resolutionTiers` is `check:doc-readers-unknown-fields` (section 4).
 * The sheet and image halves (`tierSheets`, `imageTiers`) are pure: `sheetOnPage.fixture.ts`.
 */
import { createHash } from 'node:crypto';
import { mock } from 'node:test';
import { isDeepStrictEqual } from 'node:util';
import sharp from 'sharp';

process.env.KTX2_ENCODE = '1';

interface Stored {
	body: Uint8Array;
	etag: string;
}
const bucket = new Map<string, Stored>();
const enc = new TextEncoder();
const dec = new TextDecoder();
let writes = 0;
let reads = 0;

function put(key: string, body: Uint8Array): string {
	writes += 1;
	const etag = `"${createHash('md5').update(body).digest('hex')}"`;
	bucket.set(key, { body, etag });
	return etag;
}

const server = (path: string): string => new URL(`../src/lib/server/${path}`, import.meta.url).href;
mock.module(server('r2.ts'), {
	namedExports: {
		putObjectText: async (key: string, text: string) => put(key, enc.encode(text)),
		putObjectBytes: async (key: string, body: Uint8Array) => put(key, body),
		getObjectBytes: async (key: string) => {
			reads += 1;
			const o = bucket.get(key);
			return o ? { body: o.body, contentType: 'image/webp', etag: o.etag } : null;
		},
		getObjectText: async (key: string) => {
			const o = bucket.get(key);
			return o ? dec.decode(o.body) : null;
		},
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: o.etag, size: o.body.length, lastModified: 0 } : null;
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
		// Imported by modules on this path, never called by it.
		listObjects: async () => [],
	},
});

const { exportRigBundle } = await import('../src/lib/server/rig.ts');
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

const CLIENT = 'acme';
const PROJECT = 'p1';
const ROOT = `${CLIENT}/${PROJECT}`;
const DEPLOY = `${ROOT}/deploy/`;
// Big enough that the full page AND its half both clear the encoder's 1 Mpix floor.
const W = 2400;
const H = 2000;
const pageBytes = new Uint8Array(
	await sharp({ create: { width: W, height: H, channels: 4, background: '#3a7bd5' } })
		.composite([
			{
				input: await sharp({
					create: { width: 600, height: 400, channels: 4, background: '#f5a623' },
				})
					.png()
					.toBuffer(),
				left: 200,
				top: 100,
			},
		])
		.webp({ quality: 90 })
		.toBuffer(),
);

const RIG = 'R_Upload';
const bundle = `${ROOT}/spines/${RIG}`;
put(`${bundle}/${RIG}.json`, enc.encode('{}'));
put(`${bundle}/page.webp`, pageBytes);
put(
	`${bundle}/${RIG}.atlas`,
	enc.encode(
		`page.webp\nsize:${W},${H}\nfilter:Linear,Linear\nbox\nbounds:200,100,600,400\noffsets:0,0,640,420\n`,
	),
);
const SOURCE = `${bundle}/page.webp`;

const exportRig = (pageStore: InstanceType<typeof PageStore>) =>
	exportRigBundle({
		clientKey: CLIENT,
		projectKey: PROJECT,
		assetKey: `${bundle}/`,
		deployPrefix: DEPLOY,
		subtree: 'editor-art',
		stem: RIG,
		skeletonIndex: [
			{
				name: RIG,
				folder: RIG,
				skeleton_file: `${RIG}.json`,
				atlas_file: `${RIG}.atlas`,
				format: 'json' as const,
				runtime: '4.2',
				dir_b64: '',
			},
		],
		pageStore,
	});
const deployed = (rel: string): string | undefined => {
	const o = bucket.get(`${DEPLOY}${rel}`);
	return o ? dec.decode(o.body) : undefined;
};
const tierKeys = () => [...bucket.keys()].filter((k) => k.includes('@half'));

console.log('1. no tiers asked: nothing extra');
const plain = await new PageStore(DEPLOY).ensure(SOURCE, 'webp');
ok('the page is stored', plain !== null);
ok('it carries no tiers', plain!.tiers === undefined);
ok('no tier file was written', tierKeys().length === 0, tierKeys().join(', '));
const plainRig = await exportRig(new PageStore(DEPLOY));
ok('a rig exported without tiers carries none', plainRig !== null && !plainRig.entry.tiers);
ok('and writes no tier atlas', tierKeys().length === 0, tierKeys().join(', '));

console.log('2. half asked: the page at half size, its twin, a sidecar');
const tiered = await new PageStore(DEPLOY, ['half']).ensure(SOURCE, 'webp');
const half = tiered?.tiers?.half;
ok('the page carries a half tier', !!half);
ok(
	'at half the size',
	half!.width === W / 2 && half!.height === H / 2,
	`${half!.width}×${half!.height}`,
);
ok('with the source size recorded', half!.sourceWidth === W && half!.sourceHeight === H);
const halfPage = bucket.get(`${DEPLOY}_pages/${half!.file}`);
ok('the half page is written as WebP', !!halfPage && half!.file.endsWith('@half.webp'), half!.file);
const meta = await sharp(Buffer.from(halfPage!.body)).metadata();
ok(
	'and decodes at half size',
	meta.format === 'webp' && meta.width === W / 2 && meta.height === H / 2,
	`${meta.format} ${meta.width}×${meta.height}`,
);
ok('its KTX2 twin is written', !!half!.ktx2File && bucket.has(`${DEPLOY}_pages/${half!.ktx2File}`));
ok(
	'the twin is block-aligned at half size',
	half!.ktx2Width === W / 2 && half!.ktx2Height === H / 2,
	`${half!.ktx2Width}×${half!.ktx2Height}`,
);
ok(
	'a sidecar records it',
	tierKeys().some((k) => k.endsWith('@half.meta.json')),
	tierKeys().join(', '),
);

console.log('3. the next assemble reuses it');
const before = { writes, reads };
const again = await new PageStore(DEPLOY, ['half']).ensure(SOURCE, 'webp');
ok(
	'the same half tier comes back',
	isDeepStrictEqual(again?.tiers, tiered?.tiers),
	`${JSON.stringify(again?.tiers)} vs ${JSON.stringify(tiered?.tiers)}`,
);
ok('nothing was downloaded', reads === before.reads, `${reads - before.reads} downloads`);
ok('nothing was written', writes === before.writes, `${writes - before.writes} writes`);

console.log('4. a rig exported through a half store gets half atlases');
const rig = await exportRig(new PageStore(DEPLOY, ['half']));
const tiers = rig?.entry.tiers?.half;
ok('the entry names a half atlas and a half KTX2 atlas', !!tiers?.atlas && !!tiers.ktx2Atlas);
const halfAtlas = deployed(tiers!.atlas)!;
ok(
	'the half atlas names the half page',
	halfAtlas.split('\n')[0] === `${PAGE_REF_PREFIX}${half!.file}`,
	halfAtlas.split('\n')[0],
);
ok('its size is halved', halfAtlas.includes(`size:${W / 2},${H / 2}`), halfAtlas);
ok(
	'its region coords are halved',
	/bounds:\s*100,\s*50,\s*300,\s*200/.test(halfAtlas) &&
		/offsets:\s*0,\s*0,\s*320,\s*210/.test(halfAtlas),
	halfAtlas,
);
const halfKtx2Atlas = deployed(tiers!.ktx2Atlas!)!;
ok(
	'the half KTX2 atlas names the half twin',
	halfKtx2Atlas.split('\n')[0] === `${PAGE_REF_PREFIX}${half!.ktx2File}`,
	halfKtx2Atlas.split('\n')[0],
);
ok(
	'the full atlas is unchanged by the tier',
	deployed(rig!.entry.atlas)!.includes(`size:${W},${H}`) &&
		deployed(rig!.entry.atlas)!.includes('bounds:200,100,600,400'),
);

console.log(`\nPASS: ${checks} checks.`);
