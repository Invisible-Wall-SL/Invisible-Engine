import type { ListedObject } from './r2';

/** Two objects written within this window count as one deploy batch. */
const SAME_BATCH_MS = 10_000;

/**
 * Pick the DEPLOYED page image (a listing of `deploy/…`) whose basename stem is
 * in `stems`. `deploy/` is the live-asset source of truth, so a match means the
 * editor shows exactly what the game loads. Shared by the region-sprite resolver
 * (`editorRegions.ts`) and the spine page resolver (`spine.ts`).
 *
 * - The `deploy/editor-<kind>/` family is EXCLUDED (`editor-art`, `editor-symbols`,
 *   …): those are the editor's OWN per-component / per-symbol bake outputs, NOT
 *   the atlas's packed page. Reading one back as a display source is circular AND
 *   wrong — a per-symbol export merely SHARES the atlas stem while being packed to
 *   different dimensions (or fully transparent outside that symbol's frame), so it
 *   shadows the real page and makes unrelated regions resolve EMPTY. (This is the
 *   bug where a freshly-packed region rendered blank: 7 `editor-symbols` byproducts
 *   named `S_Game_Reel.webp`, newer than the real `deploy/sprites/S_Game_Reel` page,
 *   out-sorted it and were empty at the region's rect.)
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
		// Skip the whole `deploy/editor-*/` derived-bake family (see doc comment).
		const rel = o.key.startsWith(deployPrefix) ? o.key.slice(deployPrefix.length) : o.key;
		if (/^editor-[^/]+\//.test(rel)) return false;
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
