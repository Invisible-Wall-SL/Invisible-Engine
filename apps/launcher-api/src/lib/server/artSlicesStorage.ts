import { emptyArtSlicesDoc, normalizeArtSlicesDoc, type ArtSlicesDoc } from '$lib/artSlices';
import { artSlicesDocKey } from './projectPaths';
import { ConflictError, getObjectTextWithEtag, precondition, putObjectText } from './r2';

/**
 * ART SLICES — the per-region 9-slice insets, read and written whole under an ETag like the art
 * bounds (`artBoundsStorage.ts`, whose conflict and corrupt-doc reasoning applies unchanged).
 *
 * Never a shipped file: `editorArtExport` writes each region's insets into the TexturePacker JSON
 * as the frame's `borders`, which PIXI reads into `Texture.defaultBorders`. The shape and the
 * canonicalizer live in `$lib/artSlices.ts`.
 */
export { artSliceRef, type ArtSlice, type ArtSlicesDoc } from '$lib/artSlices';

export async function loadArtSlicesDocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: ArtSlicesDoc; etag: string | null; existed: boolean }> {
	const obj = await getObjectTextWithEtag(artSlicesDocKey(clientKey, projectKey));
	if (!obj) return { doc: emptyArtSlicesDoc(), etag: null, existed: false };
	try {
		return { doc: normalizeArtSlicesDoc(JSON.parse(obj.text)), etag: obj.etag, existed: true };
	} catch {
		return { doc: emptyArtSlicesDoc(), etag: obj.etag, existed: true };
	}
}

export async function loadArtSlicesDoc(
	clientKey: string,
	projectKey: string,
): Promise<ArtSlicesDoc> {
	return (await loadArtSlicesDocWithEtag(clientKey, projectKey)).doc;
}

/** Persist the doc. `baseEtag` as `saveArtBoundsDoc`; throws {@link ConflictError} on a lost race. */
export async function saveArtSlicesDoc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
	baseEtag?: string | null,
): Promise<{ doc: ArtSlicesDoc; etag: string | null }> {
	const next = normalizeArtSlicesDoc(doc);
	const stamped: ArtSlicesDoc = { ...next, updatedAt: new Date().toISOString() };
	const etag = await putObjectText(
		artSlicesDocKey(clientKey, projectKey),
		JSON.stringify(stamped, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc: stamped, etag };
}

export { ConflictError };
