/**
 * ART SLICES — the pure half: a region's 9-slice insets, its key, and the canonicalizer.
 *
 * The slice twin of `artBounds.ts`, and dependency-free for the same reason (an offline fixture is
 * this app's only data-contract gate). Insets are UPRIGHT PACKED-ART PIXELS from each edge: the
 * corners a panel frame keeps at their art size while the node stretches or tiles the rest
 * (`engine-layout`'s `nineSlice.ts`, game-families §5.2 "N-slice").
 *
 * The insets belong to the art, so they are stored per `<assetKey>::<region>` like a region's
 * bounds; a sprite node only opts in (`SpriteNode.slice`). They ship as the TexturePacker frame's
 * `borders`, which PIXI reads into `Texture.defaultBorders` — no new asset class (rule 8).
 */

export interface ArtSlice {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface ArtSlicesDoc {
	version: 1;
	/** `<assetKey>::<region>` → its insets. Absent ⇒ no slice (a sliced node stretches it whole). */
	slices: Record<string, ArtSlice>;
	updatedAt?: string;
}

export const ART_SLICES_DOC_VERSION = 1;

/** The scoped key — the same `<assetKey>::<region>` ref Art bounds use. */
export function artSliceRef(assetKey: string, region: string): string {
	return `${assetKey}::${region}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** A whole, non-negative pixel count; anything else is not an inset. */
const inset = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : undefined;

/**
 * Canonicalize an arbitrary value into a valid doc. A slice with a missing / negative / non-finite
 * inset is dropped, and so is an all-zero one (it slices nothing). Copied field by field.
 * Idempotent.
 */
export function normalizeArtSlicesDoc(raw: unknown): ArtSlicesDoc {
	const obj = isRecord(raw) ? raw : {};
	const src = isRecord(obj.slices) ? obj.slices : {};
	const slices: Record<string, ArtSlice> = {};
	for (const [ref, value] of Object.entries(src)) {
		if (!ref || !isRecord(value)) continue;
		const left = inset(value.left);
		const top = inset(value.top);
		const right = inset(value.right);
		const bottom = inset(value.bottom);
		if (left === undefined || top === undefined || right === undefined || bottom === undefined)
			continue;
		if (left + top + right + bottom === 0) continue;
		slices[ref] = { left, top, right, bottom };
	}
	return { version: ART_SLICES_DOC_VERSION, slices };
}

export function emptyArtSlicesDoc(): ArtSlicesDoc {
	return { version: ART_SLICES_DOC_VERSION, slices: {} };
}

/**
 * The TexturePacker frame `borders` for a slice, in the sheet's pixel space (`sx`/`sy` rescale it
 * for a downscaled KTX2 page, exactly as the frame rect is rescaled).
 */
export function sliceBorders(
	slice: ArtSlice,
	sx = 1,
	sy = 1,
): { left: number; top: number; right: number; bottom: number } {
	return {
		left: Math.round(slice.left * sx),
		top: Math.round(slice.top * sy),
		right: Math.round(slice.right * sx),
		bottom: Math.round(slice.bottom * sy),
	};
}
