// Shared TexturePacker → atlas-tool region mapping. ONE source of truth for the
// frame→region conversion used by the seed script and the manifest deriver, so
// the snake_case region shape the Atlas Maker / game pipeline consumes can never
// drift between scripts.
//
// A TexturePacker (json-hash) frame is `{ frame:{x,y,w,h}, rotated,
// spriteSourceSize:{x,y,w,h}, sourceSize:{w,h} }`. It maps to the atlas-tool
// SNAKE_CASE region `{name,x,y,w,h,rotated,off_x,off_y,orig_w,orig_h}`:
//   - frame      → on-page rect (x,y,w,h); w/h are the UNROTATED trimmed size
//   - rotated    → whether the frame is stored rotated 90° on the page
//   - spriteSourceSize.x/y → trim offset (off_x/off_y) within the original frame
//   - sourceSize → original untrimmed size (orig_w/orig_h)
//
// The launcher's `editorRegions.ts::texturePackerToInvisible` produces the SAME
// geometry in camelCase for the editor; this is the snake_case sibling for the
// deploy/manifest pipeline (matching `ui_server.py::_deployatlas`'s `_pick`).

/**
 * Convert a single TexturePacker frame to an atlas-tool snake_case region.
 * @param {string} name frame key, e.g. `h1.png`
 * @param {Record<string, unknown>} f the TexturePacker frame object
 * @returns {{ name: string, x: number, y: number, w: number, h: number, rotated: boolean, off_x: number, off_y: number, orig_w: number, orig_h: number }}
 */
export function tpFrameToRegion(name, f) {
	const fr = (f && f.frame) ?? {};
	const sss = (f && f.spriteSourceSize) ?? { x: 0, y: 0, w: fr.w, h: fr.h };
	const src = (f && f.sourceSize) ?? { w: fr.w, h: fr.h };
	const w = fr.w ?? 0;
	const h = fr.h ?? 0;
	return {
		name,
		x: fr.x ?? 0,
		y: fr.y ?? 0,
		w,
		h,
		rotated: Boolean(f && f.rotated),
		off_x: sss.x ?? 0,
		off_y: sss.y ?? 0,
		orig_w: src.w ?? w,
		orig_h: src.h ?? h,
	};
}

/**
 * Convert a single TexturePacker frame to the editor's camelCase region shape
 * (`editorRegions.ts::EditorRegion`). Kept beside the snake_case converter so the
 * seed script and the editor stay byte-identical to one mapping.
 * @param {string} name frame key
 * @param {Record<string, unknown>} f the TexturePacker frame object
 * @returns {{ name: string, x: number, y: number, w: number, h: number, rotated: boolean, offX: number, offY: number, origW: number, origH: number }}
 */
export function tpFrameToEditorRegion(name, f) {
	const r = tpFrameToRegion(name, f);
	return {
		name: r.name,
		x: r.x,
		y: r.y,
		w: r.w,
		h: r.h,
		rotated: r.rotated,
		offX: r.off_x,
		offY: r.off_y,
		origW: r.orig_w,
		origH: r.orig_h,
	};
}

/**
 * Normalize a TexturePacker `frames` block (json-hash object OR json-array) into
 * `[name, frame]` entries. Array frames carry their key in `filename`.
 * @param {unknown} frames the `frames` value from a TexturePacker manifest
 * @returns {[string, Record<string, unknown>][]}
 */
export function tpFrameEntries(frames) {
	if (Array.isArray(frames)) {
		return frames
			.filter((f) => f && typeof f === 'object')
			.map((f) => [String(f.filename ?? ''), f])
			.filter(([name]) => name.length > 0);
	}
	if (frames && typeof frames === 'object') {
		return Object.entries(frames);
	}
	return [];
}

/**
 * Split a list of snake_case regions into the two buckets the atlas-tool manifest
 * uses: `regions` (rotated=false) and `rotated_regions` (rotated=true). Mirrors
 * the `for bucket in ("regions", "rotated_regions")` walk in `ui_server.py`.
 * @param {{ rotated?: boolean }[]} regions
 * @returns {{ regions: typeof regions, rotated_regions: typeof regions }}
 */
export function splitByRotation(regions) {
	const upright = [];
	const rotated = [];
	for (const r of regions) {
		if (r.rotated) rotated.push(r);
		else upright.push(r);
	}
	return { regions: upright, rotated_regions: rotated };
}

/**
 * Build the snake_case region buckets directly from a TexturePacker manifest's
 * `frames` block.
 * @param {unknown} frames the `frames` value from a TexturePacker manifest
 * @returns {{ regions: ReturnType<typeof tpFrameToRegion>[], rotated_regions: ReturnType<typeof tpFrameToRegion>[] }}
 */
export function framesToRegionBuckets(frames) {
	const regions = tpFrameEntries(frames).map(([name, f]) => tpFrameToRegion(name, f));
	return splitByRotation(regions);
}
