/**
 * A TexturePacker sheet moved onto another copy of its page: the KTX2 twin (which the encoder may
 * have downscaled, `ktx2Dimensions.ts` `targetSize`) or a resolution tier's smaller page
 * (`PageStore` tiers, `docs/design/arcade-4k-builds.md` Phase 3).
 *
 * Every pixel coordinate is rescaled onto the page, and `meta.scale` says by how much, so PIXI
 * divides the coordinates back out (`Spritesheet` reads `meta.scale` as the page's resolution) and
 * every frame keeps its full-resolution LOGICAL size — the copy draws the art at the same size, just
 * from fewer pixels. Borders are logical too (PIXI's nine-slice reads them against `orig`), so they
 * stay as authored. This is the one place such a sheet is derived, so the editor-art and symbol
 * exports cannot disagree about it.
 */
import type { ResolutionTierId } from 'engine-layout';

import type { SharedPage, TierPage } from './pageStore';

export type SheetRect = { x: number; y: number; w: number; h: number };

export interface SheetFrame {
	frame: SheetRect;
	rotated: boolean;
	trimmed: boolean;
	spriteSourceSize: SheetRect;
	sourceSize: { w: number; h: number };
	/** 9-slice insets — PIXI reads them into `Texture.defaultBorders`. */
	borders?: { left: number; top: number; right: number; bottom: number };
}

export interface SheetJson {
	frames: Record<string, SheetFrame>;
	meta: {
		app: string;
		format: string;
		image: string;
		scale: string;
		size: { w: number; h: number };
	};
}

/** PIXI takes one resolution per page; an encode only ever floors a side to a whole 4×4 block on
 *  top of a uniform scale, so the two axes differ by at most a few pixels and their mean is exact
 *  to well under a pixel. 1 ⇒ `'1'`, so a page encoded at its own size writes what it always did. */
export function twinScale(sx: number, sy: number): string {
	const scale = (sx + sy) / 2;
	return scale === 1 ? '1' : String(Number(scale.toFixed(6)));
}

export function sheetOnPage(
	sheet: SheetJson,
	image: string,
	width: number,
	height: number,
): SheetJson {
	const sx = sheet.meta.size.w ? width / sheet.meta.size.w : 1;
	const sy = sheet.meta.size.h ? height / sheet.meta.size.h : 1;
	const rx = (n: number) => Math.round(n * sx);
	const ry = (n: number) => Math.round(n * sy);
	const rect = (r: SheetRect): SheetRect => ({ x: rx(r.x), y: ry(r.y), w: rx(r.w), h: ry(r.h) });
	// One output entry per input entry, so frames a sheet lists under two keys stay one object.
	const twins = new Map<SheetFrame, SheetFrame>();
	const frames: Record<string, SheetFrame> = {};
	for (const [name, f] of Object.entries(sheet.frames)) {
		let twin = twins.get(f);
		if (!twin) {
			twin = {
				...f,
				frame: rect(f.frame),
				spriteSourceSize: rect(f.spriteSourceSize),
				sourceSize: { w: rx(f.sourceSize.w), h: ry(f.sourceSize.h) },
			};
			twins.set(f, twin);
		}
		frames[name] = twin;
	}
	return {
		frames,
		meta: { ...sheet.meta, image, scale: twinScale(sx, sy), size: { w: width, h: height } },
	};
}

/** Where a sheet's copy for one resolution tier ships: on the tier's WebP page, and on its KTX2
 *  twin when the tier page was big enough to encode. Paths are relative to `deploy/`. */
export interface SheetTierRefs {
	json: string;
	ktx2Json?: string;
}

/**
 * Every resolution-tier copy of a sheet the page store made for its page: the files to write
 * (`path` relative to `deploy/`) and the index entry naming them. `jsonFor(suffix)` names a file
 * beside the full sheet (`@half.json`, `@half.ktx2.json`); `pageRef(file)` turns a shared page's
 * filename into the reference a sheet in that folder uses. `refs` is absent when the page has no
 * tiers, so a project that asked for none indexes exactly what it did.
 */
export function tierSheets(
	sheet: SheetJson,
	tiers: SharedPage['tiers'],
	pageRef: (file: string) => string,
	jsonFor: (suffix: string) => string,
): {
	files: { path: string; sheet: SheetJson }[];
	refs?: Partial<Record<ResolutionTierId, SheetTierRefs>>;
} {
	const files: { path: string; sheet: SheetJson }[] = [];
	const refs: Partial<Record<ResolutionTierId, SheetTierRefs>> = {};
	for (const [id, page] of Object.entries(tiers ?? {}) as [ResolutionTierId, TierPage][]) {
		const json = jsonFor(`@${id}.json`);
		files.push({
			path: json,
			sheet: sheetOnPage(sheet, pageRef(page.file), page.width, page.height),
		});
		const entry: SheetTierRefs = { json };
		if (page.ktx2File) {
			entry.ktx2Json = jsonFor(`@${id}.ktx2.json`);
			files.push({
				path: entry.ktx2Json,
				sheet: sheetOnPage(sheet, pageRef(page.ktx2File), page.ktx2Width, page.ktx2Height),
			});
		}
		refs[id] = entry;
	}
	return files.length > 0 ? { files, refs } : { files };
}

/** Where a standalone image's copy for one resolution tier ships, and the texture resolution each
 *  file must load at so it lays out at the full image's size. */
export interface ImageTierRefs {
	file: string;
	resolution: number;
	ktx2?: string;
	ktx2Resolution?: number;
}

const ratio = (part: number, whole: number) => Number((part / whole).toFixed(6));

/** A standalone image's tier copies (paths under `_pages/`), or `undefined` when it has none. */
export function imageTiers(
	tiers: SharedPage['tiers'],
): Partial<Record<ResolutionTierId, ImageTierRefs>> | undefined {
	const out: Partial<Record<ResolutionTierId, ImageTierRefs>> = {};
	for (const [id, page] of Object.entries(tiers ?? {}) as [ResolutionTierId, TierPage][]) {
		out[id] = {
			file: `_pages/${page.file}`,
			resolution: ratio(page.width, page.sourceWidth),
			...(page.ktx2File && {
				ktx2: `_pages/${page.ktx2File}`,
				ktx2Resolution: ratio(page.ktx2Width, page.sourceWidth),
			}),
		};
	}
	return Object.keys(out).length > 0 ? out : undefined;
}

/** The texture resolution a standalone image's FULL KTX2 twin must load at, when the encoder
 *  downscaled it: knowable only once a tier recorded the source's width. `undefined` when the twin
 *  is full size or the source size is unknown (the twin then loads as it always has). */
export function fullKtx2Resolution(shared: SharedPage): number | undefined {
	const source = Object.values(shared.tiers ?? {})[0]?.sourceWidth;
	if (!shared.ktx2File || !source || shared.ktx2Width >= source) return undefined;
	return ratio(shared.ktx2Width, source);
}
