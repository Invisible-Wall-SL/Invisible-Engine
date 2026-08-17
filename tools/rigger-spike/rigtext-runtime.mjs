// Contract test for the GAME-side half of rig text: the locale attachment swap
// (design `docs/design/invisible-cinematic.md` §12.4a).
//
//   node tools/rigger-spike/rigtext-runtime.mjs
//
// Drives the REAL `packages/pixi-svelte/src/lib/spineLocale.ts` against REAL skeletons built by
// `@esotericsoftware/spine-core` from an atlas composed by the REAL launcher module
// (`riggerText.ts`). What it pins is the pair of properties that decide whether this is safe to
// run over every attachment of every rig in a shipped game:
//
//   - it swaps the slot to the running locale's art, and
//   - it CANNOT touch anything else — no sibling, no swap.
//
// It does not render. Whether the swapped art looks right is a live check.
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

const esbuild = await import(ESBUILD);
const { TextureAtlas, AtlasAttachmentLoader, SkeletonJson, Skeleton } = await import(SPINE_CORE);

const outdir = mkdtempSync(join(tmpdir(), 'rigtext-runtime-'));

const localeOut = join(outdir, 'spineLocale.mjs');
await esbuild.build({
	entryPoints: [fileURLToPath(new URL('packages/pixi-svelte/src/lib/spineLocale.ts', ROOT))],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: localeOut,
	logLevel: 'silent',
});
const { applyLocaleAttachments, localeAttachmentSuffix } = await import(pathToFileURL(localeOut).href);

const textOut = join(outdir, 'riggerText.mjs');
await esbuild.build({
	entryPoints: [fileURLToPath(new URL('apps/launcher-api/src/lib/server/riggerText.ts', ROOT))],
	bundle: true,
	format: 'esm',
	platform: 'node',
	outfile: textOut,
	logLevel: 'silent',
});
const RT = await import(pathToFileURL(textOut).href);

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

/** Compose a bundle atlas exactly like `ensureBundleAtlasFresh`: sheet block + text block. */
function composeAtlas(doc) {
	const sheet =
		'sheet.png\nsize:512,512\nfilter:Linear,Linear\nbody\nbounds:0,0,100,100\n' +
		'sparkle\nbounds:110,0,32,32\n';
	return sheet + RT.textAtlasBlock(doc);
}

function makeSkeleton(doc, skeletonDoc) {
	const atlas = new TextureAtlas(composeAtlas(doc));
	const stub = { getImage: () => ({ width: 1, height: 1 }), setFilters() {}, setWraps() {}, dispose() {} };
	for (const p of atlas.pages) {
		try {
			p.setTexture(stub);
		} catch {
			p.texture = stub;
		}
	}
	const data = new SkeletonJson(new AtlasAttachmentLoader(atlas)).readSkeletonData(
		JSON.parse(JSON.stringify(skeletonDoc)),
	);
	const skeleton = new Skeleton(data);
	skeleton.setToSetupPose();
	return skeleton;
}

const textDoc = (locales) =>
	RT.normalizeRigTextDoc({
		page: { file: 'rigtext-aabbccddeeff0011.png', width: 512, height: 256 },
		elements: [
			{
				id: 'title',
				key: 'K',
				sourceLocale: 'en',
				slot: 'text_title',
				variants: locales.map((l, i) => ({
					locale: l.locale,
					text: l.text,
					x: 2,
					y: 2 + i * 64,
					w: l.w,
					h: 60,
				})),
			},
		],
	});

const skeletonDoc = (attachments, setup) => ({
	skeleton: { spine: '4.2' },
	bones: [{ name: 'root' }, { name: 'text_title', parent: 'root' }],
	slots: [
		{ name: 'sparkle', bone: 'root', attachment: 'sparkle@2x' },
		{ name: 'text_title', bone: 'text_title', attachment: setup },
	],
	skins: [
		{
			name: 'default',
			attachments: {
				// A decoy: an ordinary attachment whose name merely contains an `@`.
				sparkle: { 'sparkle@2x': { path: 'sparkle', width: 32, height: 32 } },
				text_title: attachments,
			},
		},
	],
	animations: {},
});

const activeAttachment = (skeleton, slotName) => {
	const slot = skeleton.slots.find((s) => s.data.name === slotName);
	return slot?.getAttachment()?.name ?? null;
};

// ------------------------------------------------------------------------ 1 ----

console.log('\n1. the predicate matches the Rigger’s, exactly');
{
	// The two sides must agree or a rig authored by one is invisible to the other.
	for (const name of ['title@en', 'title@pt-BR', 'title@zh-Hans', 'sparkle@2x', 'logo@big', 'body', '@en']) {
		const a = RT.localeAttachmentSuffix(name);
		const b = localeAttachmentSuffix(name);
		ok(`"${name}" is classified identically on both sides`, JSON.stringify(a) === JSON.stringify(b), `${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
	}
}

// ------------------------------------------------------------------------ 2 ----

console.log('\n2. the swap');
{
	const doc = textDoc([
		{ locale: 'en', text: 'FREE SPINS', w: 220 },
		{ locale: 'de', text: 'FREISPIELE', w: 260 },
		{ locale: 'pt', text: 'GIROS', w: 120 },
	]);
	const atts = {
		'title@en': { path: 'text/title/en', width: 220, height: 60 },
		'title@de': { path: 'text/title/de', width: 260, height: 60 },
		'title@pt': { path: 'text/title/pt', width: 120, height: 60 },
	};

	let sk = makeSkeleton(doc, skeletonDoc(atts, 'title@en'));
	ok('the setup pose starts on the source locale', activeAttachment(sk, 'text_title') === 'title@en');

	ok('an empty locale changes nothing (no catalog activated yet)', applyLocaleAttachments(sk, '') === 0);
	ok('…and the slot still shows the source locale', activeAttachment(sk, 'text_title') === 'title@en');

	sk = makeSkeleton(doc, skeletonDoc(atts, 'title@en'));
	ok('a baked locale swaps exactly one slot', applyLocaleAttachments(sk, 'de') === 1);
	ok('…to that locale’s attachment', activeAttachment(sk, 'text_title') === 'title@de');
	ok('…whose region is its OWN art', sk.slots.find((s) => s.data.name === 'text_title').getAttachment().region.width === 260);
	// The decoy must be untouched: it has no `@de` sibling, so there is nothing to swap to.
	ok('an attachment that merely contains an @ is left alone', activeAttachment(sk, 'sparkle') === 'sparkle@2x');

	sk = makeSkeleton(doc, skeletonDoc(atts, 'title@en'));
	ok('the source locale itself is a no-op', applyLocaleAttachments(sk, 'en') === 0);

	sk = makeSkeleton(doc, skeletonDoc(atts, 'title@en'));
	ok('an UNBAKED locale swaps nothing', applyLocaleAttachments(sk, 'fr') === 0);
	ok('…and falls back to the source locale rather than blanking the slot', activeAttachment(sk, 'text_title') === 'title@en');

	// The player switches de → fr (unbaked): the rig must REVERT to the source art, not keep
	// showing German. This is the case the first implementation got wrong.
	sk = makeSkeleton(doc, skeletonDoc(atts, 'title@en'));
	applyLocaleAttachments(sk, 'de');
	ok('switching to an unbaked language reverts to the source art', applyLocaleAttachments(sk, 'fr') === 1 && activeAttachment(sk, 'text_title') === 'title@en', activeAttachment(sk, 'text_title'));

	sk = makeSkeleton(doc, skeletonDoc(atts, 'title@en'));
	ok('a region tag falls back to its language (pt-BR → pt)', applyLocaleAttachments(sk, 'pt-BR') === 1);
	ok('…landing on the pt art', activeAttachment(sk, 'text_title') === 'title@pt');

	// Idempotence: mounting, then a language change back and forth, must be stable.
	sk = makeSkeleton(doc, skeletonDoc(atts, 'title@en'));
	applyLocaleAttachments(sk, 'de');
	ok('applying the same locale twice is stable', applyLocaleAttachments(sk, 'de') === 0 && activeAttachment(sk, 'text_title') === 'title@de');
	applyLocaleAttachments(sk, 'pt');
	ok('switching language again re-swaps', activeAttachment(sk, 'text_title') === 'title@pt');
	applyLocaleAttachments(sk, 'en');
	ok('…and back to the source locale', activeAttachment(sk, 'text_title') === 'title@en');
}

// ------------------------------------------------------------------------ 3 ----

console.log('\n3. it cannot disturb a rig that has no localized text');
{
	const plain = {
		skeleton: { spine: '4.2' },
		bones: [{ name: 'root' }],
		slots: [
			{ name: 'body', bone: 'root', attachment: 'body' },
			{ name: 'sparkle', bone: 'root', attachment: 'sparkle@2x' },
		],
		skins: [
			{
				name: 'default',
				attachments: {
					body: { body: { width: 100, height: 100 } },
					sparkle: { 'sparkle@2x': { path: 'sparkle', width: 32, height: 32 } },
				},
			},
		],
		animations: {},
	};
	const sk = makeSkeleton(RT.normalizeRigTextDoc(null), plain);
	const before = sk.slots.map((s) => s.getAttachment()?.name ?? null).join('|');
	const swapped = applyLocaleAttachments(sk, 'de');
	const after = sk.slots.map((s) => s.getAttachment()?.name ?? null).join('|');
	ok('nothing is swapped', swapped === 0);
	ok('every slot is byte-identical afterwards', before === after, `${before} → ${after}`);
	ok('an undefined skeleton is tolerated (a rig still loading)', applyLocaleAttachments(undefined, 'de') === 0);
}

// ------------------------------------------------------------------------ 4 ----

console.log('\n4. a MESH text element swaps too (the linked-mesh shape the Rigger writes)');
{
	const doc = textDoc([
		{ locale: 'en', text: 'FREE SPINS', w: 220 },
		{ locale: 'de', text: 'FREISPIELE', w: 260 },
	]);
	const atts = {
		'title@en': {
			type: 'mesh',
			path: 'text/title/en',
			uvs: [0, 0, 1, 0, 1, 1, 0, 1],
			triangles: [0, 1, 2, 0, 2, 3],
			vertices: [0, 0, 220, 0, 220, -60, 0, -60],
			hull: 4,
		},
		'title@de': { type: 'linkedmesh', path: 'text/title/de', skin: 'default', parent: 'title@en', deform: true },
	};
	const sk = makeSkeleton(doc, skeletonDoc(atts, 'title@en'));
	ok('the swap works on a mesh element', applyLocaleAttachments(sk, 'de') === 1);
	const att = sk.slots.find((s) => s.data.name === 'text_title').getAttachment();
	ok('…the linked mesh is active', att.name === 'title@de');
	ok('…sharing the source geometry', att.triangles.length === 6);
	ok('…while sampling its own art', att.region.width === 260, att.region.width);
}

console.log(`\n${fail === 0 ? '✅ PASS' : '✗ FAIL'} — ${pass}/${pass + fail}`);
process.exit(fail === 0 ? 0 : 1);
