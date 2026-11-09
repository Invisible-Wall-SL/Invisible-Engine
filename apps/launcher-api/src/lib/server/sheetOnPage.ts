/**
 * The KTX2 twin of a TexturePacker sheet: the same frames over a page the encoder may have
 * downscaled (`ktx2Dimensions.ts` `targetSize`).
 *
 * Every pixel coordinate is rescaled onto the smaller page, and `meta.scale` says by how much, so
 * PIXI divides the coordinates back out (`Spritesheet` reads `meta.scale` as the page's resolution)
 * and every frame keeps its full-resolution LOGICAL size — the twin draws the art at the same size,
 * just from fewer pixels. Borders are logical too (PIXI's nine-slice reads them against `orig`), so
 * they stay as authored. This is the one place a twin is derived, so the editor-art and symbol
 * exports cannot disagree about it, and it is the mechanism a lower-resolution build tier reuses.
 */

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

export function ktx2SheetTwin(
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
