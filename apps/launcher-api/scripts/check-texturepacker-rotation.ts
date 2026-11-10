/**
 * A rotated region round-trips identically: the shared TexturePacker writer → the launcher's
 * region reader → a PixiJS frame.
 *
 * `services/_shared/fixtures/texturepacker-rotated.json` is the Sheet Maker writer's output
 * (`test_iw_texturepacker.py` pins it): one upright cell and two rotated ones. Here it goes through
 * the REAL `loadRegionSet` over an in-memory R2 and a real PixiJS `Spritesheet`:
 *
 *   1. Read directly, every region keeps the writer's upright `w/h` and rotation.
 *   2. Backfilling a Sheet Maker manifest from it leaves correct geometry alone, repairs a stale
 *      rect, and adds a region listed without one — all upright. (Before 2026-11-10 this path
 *      swapped every rotated frame, so an upright file — a `.plist` import, an Atlas Maker sheet —
 *      had its correct manifest geometry overwritten with the transpose.)
 *   3. The same with a `.plist`-import manifest (trim backfill on), the shape that was broken.
 *   4. A LEGACY Sheet Maker export — rotated `frame.w/h` swapped to the page footprint, still in R2
 *      for every rotated `bookofborutremake` sheet — reads to exactly the same regions.
 *   5. `scripts/lib/tpRegions.mjs` (the seed / manifest-derive scripts' reader) reads both files to
 *      the same upright regions.
 *   6. Frames the legacy rule must leave alone stay as written: a real TexturePacker trimmed rotated
 *      frame (`spriteSourceSize` == `frame`, a larger `sourceSize`) and a rotated frame with no
 *      `spriteSourceSize`.
 *   7. PixiJS's `Spritesheet` cuts each frame from the page rect the region names: `(w×h)`, or
 *      `(h×w)` for a rotated region, with `rotate: 2` and the upright size as its `orig`.
 *
 * Run:  pnpm --filter launcher-api check:texturepacker-rotation
 */

import { readFileSync } from 'node:fs';
import { mock } from 'node:test';

interface Stored {
	text: string;
	modified: number;
}
const bucket = new Map<string, Stored>();
const under = (prefix: string) =>
	[...bucket.entries()]
		.filter(([key]) => key.startsWith(prefix))
		.map(([key, o]) => ({ key, size: o.text.length, lastModified: o.modified }));
const r2Url = new URL('../src/lib/server/r2.ts', import.meta.url).href;
mock.module(r2Url, {
	namedExports: {
		...(await import(r2Url)),
		getObjectText: async (key: string) => bucket.get(key)?.text ?? null,
		headObject: async (key: string) => {
			const o = bucket.get(key);
			return o ? { etag: null, size: o.text.length, lastModified: o.modified } : null;
		},
		objectExists: async (key: string) => bucket.has(key),
		listAllKeys: async (prefix: string) => under(prefix).map((o) => o.key),
		listAllObjects: async (prefix: string) => under(prefix),
		listObjects: async (prefix: string) => ({
			keys: under(prefix).map((o) => o.key),
			prefixes: [],
		}),
	},
});

const { loadRegionSet } = await import('../src/lib/server/editorRegions.ts');
type EditorRegion = Awaited<ReturnType<typeof loadRegionSet>>['regions'][number];
const { Spritesheet, Texture, TextureSource } = await import('pixi.js');
const { tpFrameToRegion } = await import('./lib/tpRegions.mjs');

let failures = 0;
const check = (label: string, ok: boolean, detail?: unknown) => {
	console.log(
		`${ok ? '  ok ' : 'FAIL '} ${label}${ok || detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`,
	);
	if (!ok) failures += 1;
};

interface TpFrame {
	frame: { x: number; y: number; w: number; h: number };
	rotated: boolean;
	spriteSourceSize: { x: number; y: number; w: number; h: number };
	sourceSize: { w: number; h: number };
}
interface TpDoc {
	frames: Record<string, TpFrame>;
	meta: { image: string; size: { w: number; h: number } };
}

const fixtureUrl = new URL(
	'../../../services/_shared/fixtures/texturepacker-rotated.json',
	import.meta.url,
);
const tp = JSON.parse(readFileSync(fixtureUrl, 'utf8')) as TpDoc;

/** What the Sheet Maker wrote before 2026-11-10: a rotated frame's `frame.w/h` swapped. */
const legacy: TpDoc = structuredClone(tp);
for (const f of Object.values(legacy.frames)) {
	if (f.rotated) f.frame = { ...f.frame, w: f.frame.h, h: f.frame.w };
}

const stem = (n: string) => n.replace(/\.[^.]+$/, '');
/** The writer's regions, upright, as a Sheet Maker manifest carries them. */
const expected = Object.entries(tp.frames).map(([name, f]) => ({
	name: stem(name),
	x: f.frame.x,
	y: f.frame.y,
	w: f.spriteSourceSize.w,
	h: f.spriteSourceSize.h,
	rotated: f.rotated,
}));
const geometry = (r: EditorRegion) => ({
	name: stem(r.name),
	x: r.x,
	y: r.y,
	w: r.w,
	h: r.h,
	rotated: r.rotated === true,
});
const sameGeometry = (got: EditorRegion[]) =>
	JSON.stringify(got.map(geometry).sort((a, b) => a.name.localeCompare(b.name))) ===
	JSON.stringify([...expected].sort((a, b) => a.name.localeCompare(b.name)));

check(
	'the fixture has rotated frames, wide and tall',
	expected.some((r) => r.rotated && r.w > r.h) && expected.some((r) => r.rotated && r.w < r.h),
);

const HOME = 'invisible_wall/tp_rotation';
const TP_KEY = `${HOME}/sheets/S_Rot/S_Rot.json`;
const MANIFEST_KEY = `${HOME}/manifests/atlas_manifest_S_Rot.json`;

function seed(doc: TpDoc, manifest?: Record<string, unknown>) {
	bucket.clear();
	bucket.set(TP_KEY, { text: JSON.stringify(doc), modified: 1 });
	if (manifest) bucket.set(MANIFEST_KEY, { text: JSON.stringify(manifest), modified: 2 });
}
const manifestWith = (regions: unknown[], extra: Record<string, unknown> = {}) => ({
	atlas: {
		source_image: tp.meta.image,
		width: tp.meta.size.w,
		height: tp.meta.size.h,
		texturepacker_json: TP_KEY,
	},
	regions,
	...extra,
});
const wide = expected.find((r) => r.name === 'wide')!;
const tall = expected.find((r) => r.name === 'tall')!;
/** Correct geometry for every region but `wide` (a stale rect) and `tall` (none at all). */
const drifted = [
	...expected.filter((r) => r !== wide && r !== tall),
	{ ...wide, x: 40, y: 40, w: wide.h, h: wide.w, rotated: false },
	{ name: tall.name },
];

for (const [dialect, doc] of [
	['current', tp],
	['legacy footprint', legacy],
] as const) {
	seed(doc);
	const direct = await loadRegionSet(TP_KEY);
	check(
		`${dialect}: a TexturePacker JSON read directly is the writer's upright regions`,
		sameGeometry(direct.regions),
		direct.regions.map(geometry),
	);

	seed(doc, manifestWith(expected));
	const intact = await loadRegionSet(MANIFEST_KEY);
	check(
		`${dialect}: a manifest that already agrees is left as it is`,
		sameGeometry(intact.regions),
		intact.regions.map(geometry),
	);

	seed(doc, manifestWith(drifted));
	const repaired = await loadRegionSet(MANIFEST_KEY);
	check(
		`${dialect}: a stale rect is repaired and a missing one added, upright`,
		sameGeometry(repaired.regions),
		repaired.regions.map(geometry),
	);

	seed(doc, manifestWith(expected, { import: { kind: 'plist', verbatim: true } }));
	const plist = await loadRegionSet(MANIFEST_KEY);
	check(
		`${dialect}: a .plist-import manifest keeps its upright rotated rects`,
		sameGeometry(plist.regions),
		plist.regions.map(geometry),
	);
}

for (const [dialect, doc] of [
	['current', tp],
	['legacy footprint', legacy],
] as const) {
	const got = Object.entries(doc.frames).map(([name, f]) => {
		const r = tpFrameToRegion(name, f);
		return { name: stem(r.name), x: r.x, y: r.y, w: r.w, h: r.h, rotated: r.rotated };
	});
	check(
		`${dialect}: tpRegions.mjs reads the writer's upright regions`,
		JSON.stringify(got) === JSON.stringify(expected),
		got,
	);
}

/** Frames whose `frame.w/h` is already upright and must not be mistaken for the legacy form. */
const untouched: Record<string, Partial<TpFrame> & { frame: TpFrame['frame']; rotated: boolean }> =
	{
		'trimmed.png': {
			frame: { x: 0, y: 0, w: 30, h: 12 },
			rotated: true,
			spriteSourceSize: { x: 2, y: 3, w: 30, h: 12 },
			sourceSize: { w: 40, h: 18 },
		},
		'bare.png': { frame: { x: 0, y: 20, w: 30, h: 12 }, rotated: true },
	};
seed({ frames: untouched, meta: { image: 'page.png', size: { w: 64, h: 64 } } } as TpDoc);
const edgeEditor = (await loadRegionSet(TP_KEY)).regions;
for (const [name, f] of Object.entries(untouched)) {
	const e = edgeEditor.find((r) => r.name === name);
	const t = tpFrameToRegion(name, f);
	check(
		`${name}: a rotated frame already upright is read as written (editor + tpRegions)`,
		e?.w === f.frame.w && e?.h === f.frame.h && t.w === f.frame.w && t.h === f.frame.h,
		{ editor: e && [e.w, e.h], tpRegions: [t.w, t.h] },
	);
}

// PixiJS reads the writer's file the way the launcher's regions describe the page.
const page = new Texture({
	source: new TextureSource({ width: tp.meta.size.w, height: tp.meta.size.h }),
});
const sheet = new Spritesheet(page, tp as unknown as ConstructorParameters<typeof Spritesheet>[1]);
await sheet.parse();
seed(tp);
for (const r of (await loadRegionSet(TP_KEY)).regions) {
	const tex = sheet.textures[r.name];
	if (!tex) {
		check(`pixi: ${r.name} is a frame`, false);
		continue;
	}
	const rot = r.rotated === true;
	const footprint = { x: r.x, y: r.y, w: rot ? r.h : r.w, h: rot ? r.w : r.h };
	const cut = { x: tex.frame.x, y: tex.frame.y, w: tex.frame.width, h: tex.frame.height };
	check(
		`pixi: ${r.name} is cut from the page rect the region names${rot ? ' (h×w, rotated)' : ''}`,
		JSON.stringify(cut) === JSON.stringify(footprint),
		{ pixi: cut, region: footprint },
	);
	check(`pixi: ${r.name} rotate = ${rot ? 2 : 0}`, tex.rotate === (rot ? 2 : 0), tex.rotate);
	check(
		`pixi: ${r.name} displays at the region's upright ${r.w}×${r.h}`,
		tex.orig.width === r.w && tex.orig.height === r.h,
		{ w: tex.orig.width, h: tex.orig.height },
	);
}

if (failures) {
	console.error(`\ncheck-texturepacker-rotation: ${failures} FAILED`);
	process.exit(1);
}
console.log('\ncheck-texturepacker-rotation: all checks passed');
