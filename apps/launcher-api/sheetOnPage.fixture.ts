/**
 * Offline fixture for a sprite sheet moved onto another copy of its page (a KTX2 twin, a resolution
 * tier) — run with `node` (types stripped):
 *   node apps/launcher-api/sheetOnPage.fixture.ts
 *
 * Pins, through PIXI's own `Spritesheet` parser (the code the game runs): a twin over a page the
 * encoder downscaled lays every frame out at the SAME logical size, trim, UVs and 9-slice borders
 * as the full-resolution sheet, and a page encoded at its own size writes `meta.scale: '1'`
 * (byte-parity). The pages come from the encoder's real `targetSize`. A twin written the old way
 * (rects rescaled, `meta.scale: '1'`) must fail the same comparison, or the check proves nothing.
 *
 * Then the resolution tiers (`docs/design/arcade-4k-builds.md` Phase 3): `tierSheets` writes a
 * sheet per tier page and per tier twin, each laying out like the full sheet; `imageTiers` gives a
 * standalone image's copies the resolution that keeps them at full size; `fullKtx2Resolution` is
 * known only once a tier recorded the source size; a page with no tiers adds nothing. The page store
 * half (the resize, the encode, the cache) is `scripts/check-resolution-tiers.ts`.
 */

import { Spritesheet, TextureSource, type Texture } from 'pixi.js';
import { targetSize } from './src/lib/server/ktx2Dimensions.ts';
import type { SharedPage } from './src/lib/server/pageStore.ts';
import {
	fullKtx2Resolution,
	imageTiers,
	sheetOnPage,
	tierSheets,
	type SheetJson,
} from './src/lib/server/sheetOnPage.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = '') => {
	if (!ok) {
		failures += 1;
		console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
	} else console.log(`  ok    ${label}`);
};

function sheetFor(w: number, h: number): SheetJson {
	const panel = {
		frame: { x: 10, y: 20, w: 1200, h: 600 },
		rotated: false,
		trimmed: true,
		spriteSourceSize: { x: 30, y: 12, w: 1200, h: 600 },
		sourceSize: { w: 1260, h: 640 },
		borders: { left: 48, top: 40, right: 48, bottom: 40 },
	};
	const rotated = {
		frame: { x: 2000, y: 100, w: 900, h: 1700 },
		rotated: true,
		trimmed: false,
		spriteSourceSize: { x: 0, y: 0, w: 1700, h: 900 },
		sourceSize: { w: 1700, h: 900 },
	};
	return {
		frames: { panel, 'sheet::panel': panel, symbol: rotated },
		meta: { app: 'fixture', format: 'RGBA8888', image: 'page.webp', scale: '1', size: { w, h } },
	};
}

async function parse(sheet: SheetJson, pixelW: number, pixelH: number) {
	const source = new TextureSource({ width: pixelW, height: pixelH, resolution: 1 });
	const parsed = new Spritesheet({ texture: source, data: sheet as never });
	return (await parsed.parse()) as Record<string, Texture>;
}

type Logical = Record<string, number>;
function logical(t: Texture): Logical {
	return {
		origW: t.orig.width,
		origH: t.orig.height,
		trimX: t.trim?.x ?? 0,
		trimY: t.trim?.y ?? 0,
		frameW: t.frame.width,
		frameH: t.frame.height,
		u: t.frame.x / t.source.width,
		v: t.frame.y / t.source.height,
		left: t.defaultBorders?.left ?? 0,
		top: t.defaultBorders?.top ?? 0,
	};
}

/** The largest difference between two frames' logical geometry, in logical px (UVs × page size). */
function drift(a: Logical, b: Logical, pageW: number, pageH: number): number {
	let worst = 0;
	for (const key of Object.keys(a)) {
		const scale = key === 'u' ? pageW : key === 'v' ? pageH : 1;
		worst = Math.max(worst, Math.abs(a[key] - b[key]) * scale);
	}
	return worst;
}

async function compare(label: string, pageW: number, pageH: number, legacy = false) {
	const full = sheetFor(pageW, pageH);
	const enc = targetSize(pageW, pageH);
	let twin = sheetOnPage(full, 'page.pm.ktx2', enc.width, enc.height);
	if (legacy) twin = { ...twin, meta: { ...twin.meta, scale: '1' } };
	const a = await parse(full, pageW, pageH);
	const b = await parse(twin, enc.width, enc.height);
	// A rounded rect on the smaller page is off by at most half a page pixel per edge.
	const tolerance = 1 / Math.min(enc.width / pageW, enc.height / pageH);
	let worst = 0;
	for (const name of Object.keys(full.frames)) {
		worst = Math.max(worst, drift(logical(a[name]), logical(b[name]), pageW, pageH));
	}
	return { worst, tolerance, enc, twin };
}

console.log('ktx2 sheet twin — downscaled page');
{
	const { worst, tolerance, enc, twin } = await compare('downscaled', 6000, 3000);
	check('the encoder really downscaled the page', enc.width < 6000, `${enc.width}×${enc.height}`);
	check(
		'every frame keeps its logical size, trim, UVs and borders',
		worst <= tolerance,
		`worst ${worst.toFixed(3)} px > ${tolerance.toFixed(3)}`,
	);
	check('meta.scale names the downscale', Number(twin.meta.scale) < 1, twin.meta.scale);
	check(
		'a frame listed under two keys stays one entry',
		twin.frames.panel === twin.frames['sheet::panel'],
	);
}

console.log('ktx2 sheet twin — page aligned down to 4×4 blocks only');
{
	const { worst, tolerance } = await compare('aligned', 3250, 2048);
	check('logical geometry kept', worst <= tolerance, `worst ${worst.toFixed(3)} px`);
}

console.log('ktx2 sheet twin — page encoded at its own size');
{
	const full = sheetFor(2048, 2048);
	const twin = sheetOnPage(full, 'page.pm.ktx2', 2048, 2048);
	check('meta.scale stays 1', twin.meta.scale === '1', twin.meta.scale);
	check(
		'frames are byte-identical to the full sheet',
		JSON.stringify(twin.frames) === JSON.stringify(full.frames),
	);
}

console.log('ktx2 sheet twin — the old twin (meta.scale 1) is caught');
{
	const { worst, tolerance } = await compare('legacy', 6000, 3000, true);
	check(
		'the comparison fails a twin without its scale',
		worst > tolerance,
		`worst ${worst.toFixed(3)} px`,
	);
}

console.log('resolution tiers — sheets');
{
	const full = sheetFor(4000, 2000);
	const shared: SharedPage = {
		file: 'h.webp',
		ktx2File: 'h.pm.ktx2',
		ktx2Width: 4000,
		ktx2Height: 2000,
		tiers: {
			half: {
				file: 'h@half.webp',
				width: 2000,
				height: 1000,
				sourceWidth: 4000,
				sourceHeight: 2000,
				ktx2File: 'h@half.pm.ktx2',
				ktx2Width: 2000,
				ktx2Height: 1000,
			},
		},
	};
	const { files, refs } = tierSheets(
		full,
		shared.tiers,
		(file) => `../../_pages/${file}`,
		(suffix) => `editor-art/s/s.v1${suffix}`,
	);
	check(
		'one sheet on the tier page and one on its twin',
		JSON.stringify(refs) ===
			JSON.stringify({
				half: { json: 'editor-art/s/s.v1@half.json', ktx2Json: 'editor-art/s/s.v1@half.ktx2.json' },
			}),
		JSON.stringify(refs),
	);
	check(
		'each names its page and says it is half size',
		files.map((f) => `${f.sheet.meta.image} ${f.sheet.meta.scale}`).join(' | ') ===
			'../../_pages/h@half.webp 0.5 | ../../_pages/h@half.pm.ktx2 0.5',
		files.map((f) => `${f.sheet.meta.image} ${f.sheet.meta.scale}`).join(' | '),
	);
	const a = await parse(full, 4000, 2000);
	const b = await parse(files[0].sheet, 2000, 1000);
	let worst = 0;
	for (const name of Object.keys(full.frames))
		worst = Math.max(worst, drift(logical(a[name]), logical(b[name]), 4000, 2000));
	check('the half sheet lays out like the full one', worst <= 2, `worst ${worst.toFixed(3)} px`);
	check(
		'a page with no tiers adds nothing',
		tierSheets(full, undefined, String, String).files.length === 0 &&
			tierSheets(full, undefined, String, String).refs === undefined,
	);

	console.log('resolution tiers — images');
	check(
		'an image tier loads at the resolution that keeps its size',
		JSON.stringify(imageTiers(shared.tiers)) ===
			JSON.stringify({
				half: {
					file: '_pages/h@half.webp',
					resolution: 0.5,
					ktx2: '_pages/h@half.pm.ktx2',
					ktx2Resolution: 0.5,
				},
			}),
		JSON.stringify(imageTiers(shared.tiers)),
	);
	check('no tiers, no image tiers', imageTiers(undefined) === undefined);
	check('a full-size twin needs no resolution', fullKtx2Resolution(shared) === undefined);
	check(
		'a downscaled twin does, once a tier knows the source',
		fullKtx2Resolution({ ...shared, ktx2Width: 3200, ktx2Height: 1600 }) === 0.8,
		String(fullKtx2Resolution({ ...shared, ktx2Width: 3200, ktx2Height: 1600 })),
	);
	check(
		'and is unknown without one',
		fullKtx2Resolution({ ...shared, ktx2Width: 3200, tiers: undefined }) === undefined,
	);
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nktx2 sheet twin: all checks passed');
