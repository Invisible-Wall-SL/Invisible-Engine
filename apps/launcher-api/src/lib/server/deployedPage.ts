import type { ListedObject } from './r2';

/** Two objects written within this window count as one deploy batch. */
const SAME_BATCH_MS = 10_000;

/**
 * Pick the DEPLOYED page image (a listing of `deploy/…`) whose basename stem is
 * in `stems`. `deploy/` is the live-asset source of truth, so a match means the
 * editor shows exactly what the game loads. Shared by the region-sprite resolver
 * (`editorRegions.ts`) and the spine page resolver (`spine.ts`).
 *
 * - Keys under `deploy/editor-art/` are EXCLUDED: that's the editor's OWN bake
 *   output (editorArtExport.ts) — reading it back as a display source is
 *   circular and can serve a stale page.
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
	const editorArtPrefix = `${deployPrefix}editor-art/`;
	const matches = objs.filter((o) => {
		if (o.key.startsWith(editorArtPrefix)) return false;
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
