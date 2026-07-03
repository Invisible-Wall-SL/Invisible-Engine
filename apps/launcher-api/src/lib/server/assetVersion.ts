/**
 * Content-versioning for exported sheet assets — the cache-busting half of the
 * live-asset pipeline (docs/design/live-assets.md → "Asset cache-busting").
 *
 * A game loads each exported sheet from a STABLE deploy URL
 * (`editor-art/<stem>/<stem>.json` + page). When an atlas is re-authored the
 * export overwrites the SAME URL with new bytes, so any browser/CDN cache holding
 * the old copy keeps serving it until it expires — the "I updated the atlas but
 * the game shows the old frame" class. Stamping a short content hash INTO the
 * filename (`<stem>.<v>.json` / `<stem>.<v>.<ext>`) makes the URL change whenever
 * the content changes, so a fresh boot always fetches a URL the cache has never
 * seen. The exporters prune the previous version, keeping the tree converged.
 *
 * The token is derived from the region set (names + rects + page dims — catches a
 * re-pack that changes geometry) PLUS the source page's R2 ETag (a content hash —
 * catches a pixel-only re-export that keeps the same geometry). ETag falls back to
 * size+mtime when the store omits it.
 */
import { createHash } from 'node:crypto';
import type { EditorRegionSet } from './editorRegions';
import { headObject } from './r2';

/**
 * Short content-version token for a packed sheet, or `null` when the source page
 * is missing (the caller then drops the sheet, exactly as the pre-version copy
 * did on a 404). One HEAD per sheet — no page bytes stream through this process,
 * so the memory-flat server-side `copyObject` path is preserved.
 */
export async function sheetVersion(set: EditorRegionSet): Promise<string | null> {
	if (!set.pageKey) return null;
	const head = await headObject(set.pageKey);
	if (!head) return null;
	const pageFingerprint = head.etag ?? `${head.size}:${head.lastModified}`;
	const basis = JSON.stringify({
		w: set.pageWidth,
		h: set.pageHeight,
		page: pageFingerprint,
		regions: set.regions,
	});
	return createHash('sha1').update(basis).digest('hex').slice(0, 10);
}
