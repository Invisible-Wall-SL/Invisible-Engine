// Offline contract test for RIG TEXT — localized art in a rig (design
// `docs/design/invisible-cinematic.md` §12.4a).
//
//   node tools/rigger-spike/rigtext.mjs
//
// It drives the REAL modules — `apps/launcher-api/src/lib/server/riggerText.ts`,
// `shelfPack.ts` and `spineBundleSync.ts` (esbuild-bundled against an in-memory R2 and a
// fake region set, the `cinematic-storage.mjs` technique) — and validates the composed
// `.atlas` with the OFFICIAL `@esotericsoftware/spine-core` loader, not with our own parser.
//
// WHAT IT CAN AND CANNOT SEE. It proves DATA contracts: that the atlas composes, that spine
// resolves the text regions, that a skeleton referencing them loads as region/mesh/weighted
// attachments, and that the page travels the ship chain's page enumeration. It CANNOT see
// anything about rendering: it never rasterises a string (no browser), never uploads, and
// never draws a pixel. The "does the text look right / is it upside down / does the browser
// bundle work" half is a LIVE check, and the vendored spine runtime in `/rigger` is minified
// (so `constructor.name` checks that pass here can fail there — see the memory note).
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('../../', import.meta.url);
const ESBUILD = new URL(
	'node_modules/.pnpm/esbuild@0.25.5/node_modules/esbuild/lib/main.js',
	ROOT,
).href;
const SPINE_CORE = new URL(
	'node_modules/.pnpm/@esotericsoftware+spine-core@4.2.74/node_modules/@esotericsoftware/spine-core/dist/index.js',
	ROOT,
).href;
const LIB = fileURLToPath(new URL('apps/launcher-api/src/lib/', ROOT));

const esbuild = await import(ESBUILD);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson } = await import(SPINE_CORE);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
	if (cond) {
		pass++;
		console.log(`  ✓ ${name}`);
	} else {
		fail++;
		console.log(`  ✗ ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
	}
};

// ---------------------------------------------------------------- build the modules ----

const outdir = mkdtempSync(join(tmpdir(), 'rigtext-'));

// Pure modules: no deps beyond node:crypto.
const pureOut = join(outdir, 'pure.mjs');
await esbuild.build({
	stdin: {
		contents: `export * from './server/riggerText.ts'; export { shelfPack } from './shelfPack.ts';`,
		resolveDir: LIB,
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: pureOut,
	logLevel: 'silent',
});
const RT = await import(pathToFileURL(pureOut).href);

// `spineBundleSync` against an in-memory R2 + a fixed region set. `editorRegions` is faked
// (region LOADING is proved elsewhere and would drag in manifest fixtures); `spine.ts` is the
// REAL one, so the sheet half of the atlas is composed by production code — only `sharp` is
// stubbed (it is never called: the fixture has no rotated region, which is the early return).
const fakeStore = new Map();
globalThis.__R2__ = {
	store: fakeStore,
	regions: null,
};
const syncOut = join(outdir, 'sync.mjs');
await esbuild.build({
	stdin: {
		contents: `export { ensureBundleAtlasFresh, loadBundleTextDoc } from './server/spineBundleSync.ts';`,
		resolveDir: LIB,
		loader: 'ts',
	},
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: syncOut,
	logLevel: 'silent',
	plugins: [
		{
			name: 'fakes',
			setup(build) {
				// ONE resolver so the specific fakes win over the generic `$lib/` rewrite (letting
				// `$lib/server/r2` through pulls the whole AWS SDK into the bundle).
				build.onResolve({ filter: /.*/ }, (a) => {
					if (/(^|\/)r2$/.test(a.path)) return { path: 'r2', namespace: 'stub' };
					if (/editorRegions$/.test(a.path)) return { path: 'regions', namespace: 'stub' };
					if (a.path === 'sharp') return { path: 'sharp', namespace: 'stub' };
					if (a.path === '$env/dynamic/private') return { path: 'env', namespace: 'stub' };
					if (a.path.startsWith('$lib/')) return { path: join(LIB, a.path.slice(5) + '.ts') };
					return null;
				});
				build.onLoad({ filter: /^sharp$/, namespace: 'stub' }, () => ({
					contents: `export default () => { throw new Error('sharp called — the fixture has no rotated region'); };`,
					loader: 'js',
				}));
				build.onLoad({ filter: /^env$/, namespace: 'stub' }, () => ({
					contents: `export const env = {};`,
					loader: 'js',
				}));
				build.onLoad({ filter: /^regions$/, namespace: 'stub' }, () => ({
					contents: `export const loadRegionSet = async () => globalThis.__R2__.regions;`,
					loader: 'js',
				}));
				// An in-memory R2 with the ONE semantic this test depends on: an ETag that changes
				// with the bytes, so "did the atlas get rewritten?" is observable.
				build.onLoad({ filter: /^r2$/, namespace: 'stub' }, () => ({
					contents: `
						const S = globalThis.__R2__.store;
						const enc = (v) => typeof v === 'string' ? new TextEncoder().encode(v) : v;
						export const getObjectText = async (k) => S.has(k) ? S.get(k).text : null;
						export const getObjectBytes = async (k) => S.has(k) ? { body: enc(S.get(k).text), contentType: 'image/png' } : null;
						export const headObject = async (k) => S.has(k) ? { etag: String(S.get(k).text).length + ':' + k, size: 1, lastModified: 'x' } : null;
						export const putObjectText = async (k, text) => { S.set(k, { text }); return 'e' + text.length; };
						export const putObjectBytes = async (k, body) => { S.set(k, { text: String(body) }); return 'e'; };
						export const deleteObject = async (k) => { S.delete(k); };
						export const objectExists = async (k) => S.has(k);
						export const copyObject = async () => { throw new Error('copyObject is not part of this test'); };
						export const listAllObjects = async () => [];
						export const listAllKeys = async () => [...S.keys()];
					`,
					loader: 'js',
				}));
			},
		},
	],
});
const SYNC = await import(pathToFileURL(syncOut).href);

// ---------------------------------------------------------------- fixtures ----

const SHEET_REGIONS = [
	{ name: 'body', x: 0, y: 0, w: 100, h: 100 },
	{ name: 'head', x: 102, y: 0, w: 64, h: 64 },
];
const regionSet = {
	regions: SHEET_REGIONS,
	pageKey: 'c/p/sheets/sheet.png',
	pageWidth: 512,
	pageHeight: 512,
};

const textDoc = (overrides = {}) =>
	RT.normalizeRigTextDoc({
		version: 1,
		page: { file: 'rigtext-deadbeefcafe1234.png', width: 256, height: 128 },
		elements: [
			{
				id: 'title',
				key: 'RIG_TITLE',
				fontId: 'gold',
				fontName: 'gold',
				fontSize: 64,
				sourceLocale: 'en',
				slot: 'text_title',
				style: { color: '#ffffff' },
				variants: [
					{ locale: 'en', text: 'FREE SPINS', x: 2, y: 2, w: 220, h: 60 },
					{ locale: 'de', text: 'FREISPIELE', x: 2, y: 64, w: 240, h: 60 },
				],
			},
		],
		...overrides,
	});

/** A spine `TextureAtlas` over composed text, with page textures stubbed. */
function parseAtlas(atlasText) {
	const atlas = new TextureAtlas(atlasText);
	const stub = { getImage: () => ({ width: 1, height: 1 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) {
		try {
			p.setTexture(stub);
		} catch {
			p.texture = stub;
		}
	}
	return atlas;
}

/** Replica of `spine.ts atlasPageNames` — the enumeration `exportSpineBundle` ships pages by. */
function atlasPageNames(t) {
	const out = [];
	let expectPage = true;
	for (const line of t.split(/\r?\n/)) {
		if (line.trim() === '') {
			expectPage = true;
			continue;
		}
		if (/^\s/.test(line) || line.includes(':')) {
			expectPage = false;
			continue;
		}
		if (expectPage) {
			expectPage = false;
			out.push(line.trim());
			continue;
		}
	}
	return out;
}

// ---------------------------------------------------------------- 1. the document model ----

console.log('\n1. normalizeRigTextDoc — guards a document that becomes an R2 key + an atlas');
{
	const empty = RT.normalizeRigTextDoc(null);
	ok('absent ⇒ an empty doc, never a throw', empty.elements.length === 0 && empty.page === null);
	ok('garbage ⇒ an empty doc', RT.normalizeRigTextDoc({ elements: 'nope' }).elements.length === 0);

	// The page filename is written into the `.atlas` and fetched as a bundle-relative object.
	const escape = RT.normalizeRigTextDoc({ page: { file: '../../secret.png', width: 8, height: 8 }, elements: [] });
	ok('a traversal page filename is refused', escape.page === null, JSON.stringify(escape.page));
	const nonPage = RT.normalizeRigTextDoc({ page: { file: 'sheet.png', width: 8, height: 8 }, elements: [] });
	ok('a NON rig-text page filename is refused (cannot point at the sheet)', nonPage.page === null);

	const badId = RT.normalizeRigTextDoc({
		page: { file: 'rigtext-aabbccdd.png', width: 8, height: 8 },
		elements: [{ id: 'a/b', key: 'K', variants: [{ locale: 'en', text: 'x', x: 0, y: 0, w: 1, h: 1 }] }],
	});
	ok('an element id with a path separator is dropped', badId.elements.length === 0);

	const badLocale = RT.normalizeRigTextDoc({
		page: { file: 'rigtext-aabbccdd.png', width: 8, height: 8 },
		elements: [{ id: 'a', key: 'K', variants: [{ locale: 'ENGLISH!', text: 'x', x: 0, y: 0, w: 1, h: 1 }] }],
	});
	ok('a malformed locale drops the variant (and so the element)', badLocale.elements.length === 0);

	const d = textDoc();
	ok('a well-formed doc survives with both variants', d.elements[0].variants.length === 2);
	ok('sourceLocale is kept when it names a real variant', d.elements[0].sourceLocale === 'en');
	const orphanSource = RT.normalizeRigTextDoc({
		page: { file: 'rigtext-aabbccdd.png', width: 8, height: 8 },
		elements: [{ id: 'a', key: 'K', sourceLocale: 'fr', variants: [{ locale: 'en', text: 'x', x: 0, y: 0, w: 4, h: 4 }] }],
	});
	ok('a sourceLocale with no variant falls back to a real one', orphanSource.elements[0].sourceLocale === 'en');
}

// ---------------------------------------------------------------- 2. the locale contract ----

console.log('\n2. localeAttachmentSuffix — the ONLY thing the game needs for the swap');
{
	ok('title@en → en', RT.localeAttachmentSuffix('title@en')?.locale === 'en');
	ok('title@pt-BR → pt-BR', RT.localeAttachmentSuffix('title@pt-BR')?.locale === 'pt-BR');
	ok('the base name comes back intact', RT.localeAttachmentSuffix('big_title@de')?.base === 'big_title');
	// The predicate runs over EVERY attachment in a shipped rig, so a false positive would
	// silently hide ordinary art the moment a game switched locale.
	ok('sparkle@2x is NOT localized', RT.localeAttachmentSuffix('sparkle@2x') === null);
	// This one FAILED first: a 2–3 letter language subtag matched `big`, which would have made
	// an ordinary attachment eligible for locale swapping in a shipped rig.
	ok('logo@big is NOT localized', RT.localeAttachmentSuffix('logo@big') === null);
	ok('title@zh-Hans is localized', RT.localeAttachmentSuffix('title@zh-Hans')?.locale === 'zh-Hans');
	ok('a bare name is NOT localized', RT.localeAttachmentSuffix('body') === null);
	ok('an empty base is refused', RT.localeAttachmentSuffix('@en') === null);
}

// ---------------------------------------------------------------- 3. atlas composition ----

console.log('\n3. textAtlasBlock — a second page the official parser reads');
{
	ok('a text-less rig contributes NOTHING (byte parity for every rig today)', RT.textAtlasBlock(RT.normalizeRigTextDoc(null)) === '');

	const sheet =
		'sheet.png\nsize:512,512\nfilter:Linear,Linear\nbody\nbounds:0,0,100,100\nhead\nbounds:102,0,64,64\n';
	const composed = sheet + RT.textAtlasBlock(textDoc());

	const pages = atlasPageNames(composed);
	ok('the ship chain enumerates BOTH pages (rule 8 — the text page travels)', pages.length === 2 && pages[1] === 'rigtext-deadbeefcafe1234.png', pages.join());

	const atlas = parseAtlas(composed);
	ok('spine-core parses it (2 pages)', atlas.pages.length === 2, atlas.pages.length);
	const en = atlas.findRegion('text/title/en');
	const de = atlas.findRegion('text/title/de');
	ok('the en region resolves', !!en);
	ok('the de region resolves', !!de);
	ok('the en rect is what we packed', en && en.x === 2 && en.y === 2 && en.width === 220 && en.height === 60, en && `${en.x},${en.y},${en.width},${en.height}`);
	ok('text regions are never rotated (they are packed upright by us)', en && !en.degrees);
	ok('the SHEET regions still resolve alongside', !!atlas.findRegion('body') && !!atlas.findRegion('head'));
	ok('the text page carries its own size', atlas.pages[1].width === 256 && atlas.pages[1].height === 128, `${atlas.pages[1].width}x${atlas.pages[1].height}`);
}

// ---------------------------------------------------------------- 4. it IS just a region ----

console.log('\n4. a text variant is an ORDINARY attachment — region, mesh, and weighted mesh');
{
	const sheet = 'sheet.png\nsize:512,512\nfilter:Linear,Linear\nbody\nbounds:0,0,100,100\n';
	const composed = sheet + RT.textAtlasBlock(textDoc());
	const load = (doc) =>
		new SkeletonJson(new AtlasAttachmentLoader(parseAtlas(composed))).readSkeletonData(
			JSON.parse(JSON.stringify(doc)),
		);

	const en = RT.rigTextAttachmentName('title', 'en');
	const de = RT.rigTextAttachmentName('title', 'de');
	const base = {
		skeleton: { spine: '4.2' },
		bones: [{ name: 'root' }, { name: 'title_bone', parent: 'root' }],
		slots: [{ name: 'text_title', bone: 'title_bone', attachment: en }],
		animations: {},
	};

	// (a) region attachments, one per locale, in ONE slot.
	const regionDoc = {
		...base,
		skins: [
			{
				name: 'default',
				attachments: {
					text_title: {
						[en]: { path: RT.rigTextRegionName('title', 'en'), width: 220, height: 60 },
						[de]: { path: RT.rigTextRegionName('title', 'de'), width: 240, height: 60 },
					},
				},
			},
		],
	};
	let data = null;
	try {
		data = load(regionDoc);
	} catch (e) {
		ok('the per-locale region rig loads', false, e.message);
	}
	if (data) {
		const skin = data.findSkin('default');
		const slotIndex = data.slots.findIndex((s) => s.name === 'text_title');
		const a = skin.getAttachment(slotIndex, en);
		const b = skin.getAttachment(slotIndex, de);
		ok('the per-locale region rig loads', true);
		ok('both locales live in ONE slot', !!a && !!b);
		ok('each resolves its OWN region', a?.region?.width === 220 && b?.region?.width === 240, `${a?.region?.width}/${b?.region?.width}`);
		ok('the setup attachment is the source locale', data.slots[slotIndex].attachmentName === en);
		// This is the swap the game performs — verified against the runtime's own lookup.
		ok('setAttachment-by-name finds the de variant', skin.getAttachment(slotIndex, RT.rigTextAttachmentName('title', 'de')) === b);
	}

	// (b) the source locale converted to a MESH (what region→mesh convert writes), with the
	// other locale a LINKED mesh — Spine's own primitive for "same geometry, different image",
	// so a deform authored once follows every locale instead of only the one it was drawn on.
	const meshDoc = {
		...base,
		skins: [
			{
				name: 'default',
				attachments: {
					text_title: {
						[en]: {
							type: 'mesh',
							path: RT.rigTextRegionName('title', 'en'),
							uvs: [0, 0, 1, 0, 1, 1, 0, 1],
							triangles: [0, 1, 2, 0, 2, 3],
							vertices: [0, 0, 220, 0, 220, -60, 0, -60],
							hull: 4,
						},
						[de]: {
							type: 'linkedmesh',
							path: RT.rigTextRegionName('title', 'de'),
							skin: 'default',
							parent: en,
							deform: true,
						},
					},
				},
			},
		],
	};
	let meshData = null;
	try {
		meshData = load(meshDoc);
	} catch (e) {
		ok('mesh + linked-mesh loads', false, e.message);
	}
	if (meshData) {
		const skin = meshData.findSkin('default');
		const slotIndex = meshData.slots.findIndex((s) => s.name === 'text_title');
		const m = skin.getAttachment(slotIndex, en);
		const l = skin.getAttachment(slotIndex, de);
		ok('mesh + linked-mesh loads', true);
		ok('the source locale is a mesh with the authored triangles', m?.triangles?.length === 6);
		ok('the linked locale inherits the parent geometry', l?.triangles?.length === 6 && l?.worldVerticesLength === m?.worldVerticesLength);
		ok('the linked locale samples its OWN region', l?.region?.width === 240, l?.region?.width);
		ok('deform follows the parent (one deform drives every locale)', l?.timelineAttachment === m);
	}

	// (c) weighted (bound to bones) — the claim "weights work on it" at the data level.
	const weightedDoc = {
		...base,
		skins: [
			{
				name: 'default',
				attachments: {
					text_title: {
						[en]: {
							type: 'mesh',
							path: RT.rigTextRegionName('title', 'en'),
							uvs: [0, 0, 1, 0, 1, 1, 0, 1],
							triangles: [0, 1, 2, 0, 2, 3],
							// boneCount, (bone, x, y, weight)… per vertex — two bones on the far corners.
							vertices: [
								1, 0, 0, 0, 1,
								2, 0, 220, 0, 0.5, 1, 0, 0, 0.5,
								1, 1, 220, -60, 1,
								1, 0, 0, -60, 1,
							],
							hull: 4,
						},
					},
				},
			},
		],
	};
	let wData = null;
	try {
		wData = load(weightedDoc);
	} catch (e) {
		ok('a WEIGHTED text mesh loads', false, e.message);
	}
	if (wData) {
		const skin = wData.findSkin('default');
		const slotIndex = wData.slots.findIndex((s) => s.name === 'text_title');
		const m = skin.getAttachment(slotIndex, en);
		ok('a WEIGHTED text mesh loads', true);
		ok('it carries bone influences', Array.isArray(m?.bones) && m.bones.length > 0);
		ok('it still samples the text region', m?.region?.width === 220);
	}
}

// ---------------------------------------------------------------- 5. the freshness gate ----

console.log('\n5. ensureBundleAtlasFresh — the text page is DERIVED on every synthesis');
{
	const PREFIX = 'c/p/spines/rig';
	const reset = () => {
		fakeStore.clear();
		globalThis.__R2__.regions = regionSet;
		fakeStore.set('c/p/sheets/sheet.png', { text: 'PNGBYTES' });
		fakeStore.set(`${PREFIX}/source.json`, {
			text: JSON.stringify({ manifestKey: 'c/p/manifests/sheet.json' }),
		});
	};

	// (a) A rig with NO text composes exactly what it did before this feature existed.
	reset();
	const r1 = await SYNC.ensureBundleAtlasFresh('c', 'p', PREFIX, 'rig.atlas', {});
	const atlasNoText = fakeStore.get(`${PREFIX}/rig.atlas`).text;
	ok('a text-less rig syncs', !!r1?.changed);
	ok('…and its atlas has exactly ONE page', atlasPageNames(atlasNoText).length === 1);
	const revNoText = JSON.parse(fakeStore.get(`${PREFIX}/source.json`).text).geometryRevision;
	ok('…and its revision has no text suffix', !revNoText.includes(':t'), revNoText);

	// (b) An unchanged bundle short-circuits — the gate still works.
	const r2 = await SYNC.ensureBundleAtlasFresh('c', 'p', PREFIX, 'rig.atlas', {});
	ok('an unchanged bundle does NOT rewrite', r2 && r2.changed === false);

	// (c) Add text → the SAME sheet + the SAME page must still read as drift, or every
	//     consumer would keep serving the pre-text atlas. This is the load-bearing assertion.
	fakeStore.set(`${PREFIX}/text.json`, { text: JSON.stringify(textDoc()) });
	const r3 = await SYNC.ensureBundleAtlasFresh('c', 'p', PREFIX, 'rig.atlas', {});
	ok('adding text is detected as drift with no sheet change', !!r3?.changed);
	const withText = fakeStore.get(`${PREFIX}/rig.atlas`).text;
	ok('…the atlas now has two pages', atlasPageNames(withText).length === 2, atlasPageNames(withText).join());
	ok('…and spine resolves the text region from it', !!parseAtlas(withText).findRegion('text/title/de'));

	// (d) A second sync must not append a THIRD page — the block is derived, not accumulated.
	await SYNC.ensureBundleAtlasFresh('c', 'p', PREFIX, 'rig.atlas', { force: true });
	ok('a forced re-sync does not duplicate the text page', atlasPageNames(fakeStore.get(`${PREFIX}/rig.atlas`).text).length === 2);

	// (e) Editing only the STRING re-composes (a changed rect must reach the atlas).
	const moved = textDoc();
	moved.elements[0].variants[1].x = 300;
	fakeStore.set(`${PREFIX}/text.json`, { text: JSON.stringify(moved) });
	const r5 = await SYNC.ensureBundleAtlasFresh('c', 'p', PREFIX, 'rig.atlas', {});
	ok('a text-only edit re-composes', !!r5?.changed);
	ok('…with the new rect', parseAtlas(fakeStore.get(`${PREFIX}/rig.atlas`).text).findRegion('text/title/de').x === 300);

	// (f) Removing the text returns the atlas to byte-parity with the text-less one.
	fakeStore.delete(`${PREFIX}/text.json`);
	await SYNC.ensureBundleAtlasFresh('c', 'p', PREFIX, 'rig.atlas', {});
	ok('removing the text restores the original atlas BYTE-for-byte', fakeStore.get(`${PREFIX}/rig.atlas`).text === atlasNoText);

	// (g) A corrupt sidecar degrades to "no text", never a broken read path.
	fakeStore.set(`${PREFIX}/text.json`, { text: '{ not json' });
	const doc = await SYNC.loadBundleTextDoc(PREFIX);
	ok('a corrupt text.json reads as an empty doc', doc.elements.length === 0);
}

// ---------------------------------------------------------------- 6. the shared packer ----

console.log('\n6. shelfPack — the ONE packer, shared with the Font Maker');
{
	const items = [
		{ width: 100, height: 20 },
		{ width: 100, height: 20 },
		{ width: 100, height: 30 },
	];
	const p = RT.shelfPack(items, { maxWidth: 220, maxHeight: 512, gap: 2 });
	ok('wraps to a new shelf at maxWidth', p.placements[2].y > p.placements[0].y, JSON.stringify(p.placements));
	ok('everything lands on one page', p.pageCount === 1);
	ok('no two items overlap', !overlaps(items, p.placements));
	ok('the page is at least as wide as the content', p.width >= 100 + 2);

	const zero = RT.shelfPack([{ width: 0, height: 0 }, { width: 10, height: 10 }], { maxWidth: 64, maxHeight: 64 });
	ok('a zero-area item keeps its index (the BMFont space glyph case)', zero.placements.length === 2);

	let threw = '';
	try {
		RT.shelfPack([{ width: 10, height: 999 }], { maxWidth: 64, maxHeight: 64, tooTallMessage: 'TOO TALL' });
	} catch (e) {
		threw = e.message;
	}
	ok('an item taller than the page fails clearly', threw === 'TOO TALL', threw);

	let pagedOut = '';
	try {
		RT.shelfPack(
			Array.from({ length: 40 }, () => ({ width: 60, height: 60 })),
			{ maxWidth: 64, maxHeight: 64, maxPages: 1, tooManyPagesMessage: () => 'ONE PAGE ONLY' },
		);
	} catch (e) {
		pagedOut = e.message;
	}
	ok('a single-page budget is enforced (the rig text page)', pagedOut === 'ONE PAGE ONLY', pagedOut);
}

function overlaps(items, placements) {
	for (let i = 0; i < items.length; i++) {
		for (let j = i + 1; j < items.length; j++) {
			const a = { ...placements[i], ...items[i] };
			const b = { ...placements[j], ...items[j] };
			if (a.page !== b.page) continue;
			if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height)
				return true;
		}
	}
	return false;
}

console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
