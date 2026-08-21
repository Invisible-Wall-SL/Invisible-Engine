import type { ListedObject } from './r2';

/**
 * Deploy subtrees that hold pages we DERIVED from another page, and which must never be
 * read back as a source page. `editor-<kind>` is the editor's per-component/per-symbol
 * bakes; `_boot` is the boot-splash mirror (already Spine-reoriented); `_pages` is the
 * shared content-addressed page store.
 */
const DERIVED_SUBTREE_RE = /^(?:editor-[^/]+|_boot|_pages)\//;

/** Two objects written within this window count as one deploy batch. */
const SAME_BATCH_MS = 10_000;

/**
 * Pick the DEPLOYED page image (a listing of `deploy/…`) whose basename stem is
 * in `stems`. `deploy/` is the live-asset source of truth, so a match means the
 * editor shows exactly what the game loads. Shared by the region-sprite resolver
 * (`editorRegions.ts`) and the spine page resolver (`spine.ts`).
 *
 * - EVERY DERIVED BAKE SUBTREE is EXCLUDED — `deploy/editor-<kind>/` (`editor-art`,
 *   `editor-symbols`, …), `deploy/_boot/` and `deploy/_pages/`. These are outputs we
 *   generated FROM an asset, not the atlas's packed page, so reading one back as a
 *   display source is circular. Two distinct ways it bites:
 *
 *     1. WRONG PIXELS AT THE RECT — a per-symbol export merely SHARES the atlas stem
 *        while being packed to different dimensions (or fully transparent outside that
 *        symbol's frame), so it shadows the real page and makes unrelated regions
 *        resolve EMPTY. (The bug where a freshly-packed region rendered blank: 7
 *        `editor-symbols` byproducts named `S_Game_Reel.webp`, newer than the real
 *        `deploy/sprites/S_Game_Reel` page, out-sorted it and were empty at the rect.)
 *
 *     2. DOUBLE-REORIENTED ROTATED REGIONS — `deploy/_boot/<tier>/` holds a COPY of a
 *        spine bundle's page, under the SAME filename, already reoriented 180° for
 *        Spine (`reorientRotatedRegionsForSpine`). It is rewritten on every deploy
 *        export, so it is always the NEWEST match and wins the ranking. `⟳ Re-sync
 *        atlas` then re-derives the bundle from it and reorients AGAIN, leaving every
 *        rotated region 180° out — a rig that rendered correctly comes back upside
 *        down. Shipped 2026-08-20 with the boot splash and caught the same day.
 *
 *   The rule is structural, not a list of special cases: a page we WROTE from another
 *   page can never be the source of truth for that other page.
 * - The latest deploy wins (a re-pack changes geometry, so only the newest page
 *   matches the manifest's rects). A deploy batch writes .webp + .png within
 *   seconds of each other — within the newest batch, prefer .webp (the deploy's
 *   preferred page format), then the largest file (so a stray same-stem icon
 *   never beats the real page).
 *
 * Returns null when nothing deployed matches → the caller falls back to the
 * asset's own source page.
 */
export function pickDeployedPage(
	objs: ListedObject[],
	stems: Set<string>,
	deployPrefix: string,
): string | null {
	if (stems.size === 0) return null;
	const matches = objs.filter((o) => {
		// Skip every derived-bake subtree (see doc comment) — reading our own output back
		// as the source page is circular, and for `_boot/` it silently double-reorients.
		const rel = o.key.startsWith(deployPrefix) ? o.key.slice(deployPrefix.length) : o.key;
		if (DERIVED_SUBTREE_RE.test(rel)) return false;
		const b = o.key.split('/').pop() ?? o.key;
		const dot = b.lastIndexOf('.');
		if (dot === -1) return false;
		const ext = b.slice(dot + 1).toLowerCase();
		return (ext === 'png' || ext === 'webp') && stems.has(b.slice(0, dot).toLowerCase());
	});
	if (matches.length === 0) return null;
	matches.sort((a, b) => b.lastModified - a.lastModified);
	const newestBatch = matches.filter(
		(m) => matches[0].lastModified - m.lastModified <= SAME_BATCH_MS,
	);
	newestBatch.sort((a, b) => {
		const aw = a.key.toLowerCase().endsWith('.webp') ? 0 : 1;
		const bw = b.key.toLowerCase().endsWith('.webp') ? 0 : 1;
		return aw !== bw ? aw - bw : b.size - a.size;
	});
	return newestBatch[0].key;
}
