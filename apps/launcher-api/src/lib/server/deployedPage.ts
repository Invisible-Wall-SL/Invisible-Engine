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

/**
 * Should the picked DEPLOYED page be REJECTED as older than the manifest's region rects?
 *
 * Preferring the deployed page swaps only the PAGE and keeps the manifest's rects, so it is
 * correct only while that page carries the manifest's current packing. A re-pack that was never
 * deployed leaves the deployed page a packing behind, and cropping fresh rects out of it yields
 * blank/wrong pixels — the guard exists for that case, and only that case.
 *
 * **The rule is NOT "the manifest is newer than the deploy".** That WAS the original guard
 * (2026-07-14) and it is wrong: a manifest's mtime is not evidence that any rect MOVED. A manifest
 * is re-saved for plenty of reasons that change no geometry at all — a metadata edit, an auto-seed,
 * the Atlas Maker's own `_refresh_manifest_from_r2` writeback — so any save landing minutes after a
 * deploy demoted a perfectly good deployed page. And the page it demoted to (the manifest's
 * `atlas.source_image_path`) was OLDER STILL, which made the guard strictly worse than no guard.
 *
 * Verified on live R2, `invisible_wall/test6`, 2026-09-16 — an atlas generated in Flipbook video
 * mode, re-packed in the Atlas Maker, deployed:
 *
 *   manifest  `manifests/atlas_manifest_S_New_Squid_Idle.json`  09:55:47Z  declares 2047x1173
 *   deploy    `deploy/sprites/S_New_Squid_Idle/….webp`          09:50:20Z  is       2047x1173
 *   source    `sheets/S_New_Squid_Idle/….png`                   08:37:51Z  is       1934x1612
 *
 * The manifest's own declared page size matched the DEPLOY exactly; the source page was the
 * Flipbook's untouched original, a different size, written 72 minutes earlier and never re-packed.
 * The old guard still rejected the deploy (09:50 < 09:55) and served the 1934x1612 page, so every
 * frame was sliced from the wrong coordinates in `/flipbook`, `/editor` and `/symbols`. A hard
 * browser reload could not help: the wrong page was chosen server-side, on every request.
 *
 * So: reject the deploy ONLY when the page we would fall back to is BETTER EVIDENCE — i.e. the
 * source page is itself NEWER than the deployed page (the un-shipped re-pack is what wrote it).
 * A source page that is older than the deploy, or missing from R2 (`sourceModified === 0` — a
 * legacy manifest carries a local Windows path in `source_image` and there is nothing to HEAD),
 * is not better evidence, so the deploy stands. `0` for any mtime means "unknown" ⇒ no guard.
 */
export function isDeployedPageStale(
	deployedModified: number,
	sourceModified: number,
	manifestModified: number,
): boolean {
	if (manifestModified <= 0 || deployedModified <= 0) return false;
	if (deployedModified >= manifestModified) return false;
	return sourceModified > deployedModified;
}
