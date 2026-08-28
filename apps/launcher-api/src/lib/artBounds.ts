/**
 * ART BOUNDS — the pure half: the shape of a region's declared box, its key, and the canonicalizer.
 *
 * Dependency-free on purpose (no R2, no SvelteKit), for the `pickSheets.ts` reason: this app's
 * `build` is a bare `vite build` that strips types without checking them, so a green build proves
 * nothing about a data contract. Kept importable by an offline fixture instead
 * ([[feedback_validate_data_contracts_offline]]).
 *
 * The box itself is the sprite twin of a rig's `skeleton.{x,y,width,height}` and of an Invisible
 * Flipbook clip's `bounds`: ART PIXELS, top-left relative to the region's origin (its centre). Same
 * space, same convention, one editor — see `$lib/BoundsBox.svelte`.
 */

export interface ArtBounds {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface ArtBoundsDoc {
	version: 1;
	/** `<assetKey>::<region>` → its declared box. Absent ⇒ the region's own packed rect. */
	bounds: Record<string, ArtBounds>;
	updatedAt?: string;
}

export const ART_BOUNDS_DOC_VERSION = 1;

/**
 * The scoped key a box is stored under — the SAME `<assetKey>::<region>` ref the Scene Editor's
 * image params, a clip's cross-sheet frames and the editor-art texture registry all use.
 *
 * Scoped rather than bare for the reason `pickSheets.ts` exists: a region name is only unique
 * within its sheet, and a bare key would silently apply one sheet's box to another sheet's
 * same-named frame.
 */
export function artBoundsRef(assetKey: string, region: string): string {
	return `${assetKey}::${region}`;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/**
 * Canonicalize an arbitrary value into a valid doc.
 *
 * A degenerate box (zero/negative/non-finite in any field) is DROPPED rather than stored: every
 * consumer divides by `w`/`h` to fit it, so shipping one turns an authoring slip into a division by
 * zero in the game. Copied field by field, so a stray key can never ride into the doc. Idempotent.
 */
export function normalizeArtBoundsDoc(raw: unknown): ArtBoundsDoc {
	const obj = isRecord(raw) ? raw : {};
	const src = isRecord(obj.bounds) ? obj.bounds : {};
	const bounds: Record<string, ArtBounds> = {};
	for (const [ref, value] of Object.entries(src)) {
		if (!ref || !isRecord(value)) continue;
		const x = num(value.x);
		const y = num(value.y);
		const w = num(value.w);
		const h = num(value.h);
		if (x === undefined || y === undefined || w === undefined || h === undefined) continue;
		if (!(w > 0) || !(h > 0)) continue;
		bounds[ref] = { x, y, w, h };
	}
	return { version: ART_BOUNDS_DOC_VERSION, bounds };
}

export function emptyArtBoundsDoc(): ArtBoundsDoc {
	return { version: ART_BOUNDS_DOC_VERSION, bounds: {} };
}
