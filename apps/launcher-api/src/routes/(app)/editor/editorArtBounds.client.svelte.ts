/**
 * Client-side ART BOUNDS for the editor family — the per-region declared box
 * (`<assetKey>::<region>` → `{x,y,w,h}`), the sprite twin of a rig's size frame and of an
 * Invisible Flipbook clip's `bounds`.
 *
 * ONE module-scoped store, like `editorFlipbooks.client.ts`: the canvas draws with it, the
 * Properties panel edits it, and the Asset Library will want it — three surfaces that must never
 * disagree about a region's box, and would if each ran its own fetch.
 *
 * A `.svelte.ts` module (NOT a plain `.ts`) because the version counter below is a rune — runes in
 * a plain `.ts` ship uncompiled and crash at runtime with "$state is not defined".
 *
 * The map is authored data that never reaches the game as a file: `editorArtExport` folds each box
 * into the shipped TexturePacker JSON's `sourceSize`/`spriteSourceSize`, which is where PIXI reads
 * a texture's declared box from anyway.
 */

import { applyClipBounds } from 'engine-flipbook';

export interface ArtBoundsBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** The loaded map. Written only through the helpers below so `version` can't fall out of step. */
let map: Record<string, ArtBoundsBox> = {};
let etag: string | null = null;
let loaded = false;
let pending: Promise<void> | null = null;

/**
 * Bumped on every change. The 2D canvas is repainted by explicit triggers rather than by tracking
 * this module (the `clipsById` precedent — a reactive map read inside `draw()` re-runs every redraw
 * effect 60 times a second), so a surface that wants to repaint on a box edit reads THIS in its
 * draw effect: one cheap dependency, changing only when a box actually does.
 */
let version = $state(0);

export function artBoundsVersion(): number {
	return version;
}

/** The scoped key a box is stored under — mirrors the server's `artBoundsRef`. */
export function artBoundsRef(assetKey: string, region: string): string {
	return `${assetKey}::${region}`;
}

/** A region's box, or `undefined` — the region then draws on its own packed rect, as always. */
export function artBoundsOf(assetKey: string, region: string): ArtBoundsBox | undefined {
	return map[artBoundsRef(assetKey, region)];
}

/**
 * Fetch the project's boxes once per page load. A failed / forbidden request resolves to an EMPTY
 * map rather than throwing: a box is an enhancement, and an editor that can't read them must still
 * draw every region (the `fetchClips` degradation).
 */
export function loadArtBounds(): Promise<void> {
	if (pending) return pending;
	pending = (async () => {
		try {
			const res = await fetch('/api/editor/art-bounds');
			if (!res.ok) return;
			const body = (await res.json()) as { bounds?: Record<string, ArtBoundsBox>; etag?: string };
			map = body.bounds ?? {};
			etag = body.etag ?? null;
			version++;
		} catch {
			/* offline / forbidden ⇒ no boxes, every region draws as it always has */
		} finally {
			loaded = true;
		}
	})();
	return pending;
}

export function artBoundsLoaded(): boolean {
	return loaded;
}

/** Drop the cache so the next `loadArtBounds` re-reads — paired with the editor's "Reload art",
 * since a box authored in another tab is exactly as stale as a re-packed atlas. */
export function clearArtBoundsCache(): void {
	pending = null;
	loaded = false;
}

/**
 * Set (or, with `undefined`, clear) one region's box and persist the WHOLE map.
 *
 * The map is small and flat, so it is read and written whole — which is exactly why the write is
 * guarded by the ETag the load returned. A 409 means another author changed the project's boxes
 * meanwhile; the local edit is kept and the caller is told, rather than the other author's map
 * being silently erased.
 *
 * Returns an error message, or `null` on success. The optimistic local update is applied first so
 * the canvas reflects the drag immediately; a failed save re-reads rather than leaving the two out
 * of step.
 */
export async function saveArtBounds(
	assetKey: string,
	region: string,
	box: ArtBoundsBox | undefined,
): Promise<string | null> {
	const ref = artBoundsRef(assetKey, region);
	const next = { ...map };
	if (box) next[ref] = box;
	else delete next[ref];
	map = next;
	version++;
	try {
		const res = await fetch('/api/editor/art-bounds', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ bounds: next, baseEtag: etag }),
		});
		const body = (await res.json().catch(() => ({}))) as {
			ok?: boolean;
			etag?: string;
			message?: string;
			bounds?: Record<string, ArtBoundsBox>;
		};
		if (res.status === 409) {
			clearArtBoundsCache();
			await loadArtBounds();
			return body.message ?? 'Someone else changed this project’s art bounds — reloaded theirs.';
		}
		if (!res.ok || body.ok === false) return body.message ?? 'Could not save the art bounds.';
		etag = body.etag ?? null;
		if (body.bounds) {
			map = body.bounds;
			version++;
		}
		return null;
	} catch {
		return 'Could not reach the server to save the art bounds.';
	}
}

/**
 * A region's geometry once its authored box is applied — `null` when it has none, in which case
 * the region draws on its own packed rect exactly as it always has.
 *
 * Runs through `engine-flipbook`'s `applyClipBounds`: a clip's box and a region's box are the same
 * concept in the same space, so they get the same arithmetic — the one the export writes into the
 * shipped sheet and the one the runtime re-states its textures with. Three surfaces, one formula,
 * so the editor cannot drift from the game about where a boxed frame lands.
 */
export function artBoxGeometry(
	assetKey: string,
	region: string,
	r: { w: number; h: number; origW?: number; origH?: number; offX?: number; offY?: number },
): { origW: number; origH: number; offX: number; offY: number } | null {
	const bounds = artBoundsOf(assetKey, region);
	if (!bounds) return null;
	const box = applyClipBounds(
		{
			origW: r.origW ?? r.w,
			origH: r.origH ?? r.h,
			offX: r.offX ?? 0,
			offY: r.offY ?? 0,
			artW: r.w,
			artH: r.h,
		},
		bounds,
	);
	return { origW: box.origW, origH: box.origH, offX: box.offX, offY: box.offY };
}
