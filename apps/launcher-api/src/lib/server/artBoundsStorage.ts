import { emptyArtBoundsDoc, normalizeArtBoundsDoc, type ArtBoundsDoc } from '$lib/artBounds';
import { artBoundsDocKey } from './projectPaths';
import { ConflictError, getObjectTextWithEtag, precondition, putObjectText } from './r2';

/**
 * ART BOUNDS — the per-region declared box.
 *
 * The Rigger lets an author draw the box a rig is sized and anchored by (`skeleton.{x,y,width,
 * height}`), and an Invisible Flipbook clip now carries the same thing (`FlipbookClip.bounds`).
 * A plain sprite region had no equivalent: it was sized by whatever rect the packer produced, so
 * art with a wide invisible flourish drew small next to its neighbours and the only fix was to
 * re-crop and re-export the PNG.
 *
 * A box here declares the space one region occupies, in ART PIXELS, top-left relative to the
 * region's origin (its centre) — the same space and the same convention as a clip's box, so the
 * two are one concept with one editor (`$lib/BoundsBox.svelte`).
 *
 * **It ships as trim, not as a new asset class.** `editorArtExport` folds each box into the
 * `sourceSize` / `spriteSourceSize` of the TexturePacker JSON it already writes for the game, and
 * PIXI builds `orig`/`trim` from exactly those two fields. So the game needs no new code, no new
 * fetch and no registry — and nothing is left stranded at an R2 prefix (rule 8). The doc is read
 * server-side by the export and client-side by the editors' previews; it never reaches a bundle.
 *
 * Keyed by `<assetKey>::<region>` — the SAME scoped ref the Scene Editor's image params, a clip's
 * cross-sheet frames and the editor-art texture registry all use, so a region that exists on two
 * sheets can be boxed differently on each and a bare region name can never collide across sheets.
 *
 * The SHAPE and the canonicalizer live in `$lib/artBounds.ts` (dependency-free, offline-fixtured);
 * only the R2 read/write lives here.
 */
export { artBoundsRef, type ArtBounds, type ArtBoundsDoc } from '$lib/artBounds';

/**
 * Load a project's art-bounds doc WITH its ETag — the read half of the conditional write.
 *
 * `existed` is reported separately from the doc for the reason `loadWinTextDocWithEtag` spells
 * out: a MISSING object and a corrupt one both degrade to an empty doc but need OPPOSITE
 * preconditions, and collapsing them leaves a corrupt doc permanently unsaveable.
 */
export async function loadArtBoundsDocWithEtag(
	clientKey: string,
	projectKey: string,
): Promise<{ doc: ArtBoundsDoc; etag: string | null; existed: boolean }> {
	const obj = await getObjectTextWithEtag(artBoundsDocKey(clientKey, projectKey));
	if (!obj) return { doc: emptyArtBoundsDoc(), etag: null, existed: false };
	try {
		return { doc: normalizeArtBoundsDoc(JSON.parse(obj.text)), etag: obj.etag, existed: true };
	} catch {
		return { doc: emptyArtBoundsDoc(), etag: obj.etag, existed: true };
	}
}

/** The doc alone — for readers with nothing to write back (the art export, the editor list). */
export async function loadArtBoundsDoc(
	clientKey: string,
	projectKey: string,
): Promise<ArtBoundsDoc> {
	return (await loadArtBoundsDocWithEtag(clientKey, projectKey)).doc;
}

/**
 * Persist the doc (validates + stamps `updatedAt`).
 *
 * `baseEtag`: a string ⇒ `If-Match`, `null` ⇒ `If-None-Match: *`, `undefined` ⇒ unconditional.
 * Throws {@link ConflictError} when the precondition loses — the endpoint MUST answer 409 via
 * `json()`, never `error()`. Two authors boxing regions in the same project would otherwise
 * silently erase each other's whole map, since the page reads and writes the doc whole.
 */
export async function saveArtBoundsDoc(
	clientKey: string,
	projectKey: string,
	doc: unknown,
	baseEtag?: string | null,
): Promise<{ doc: ArtBoundsDoc; etag: string | null }> {
	const next = normalizeArtBoundsDoc(doc);
	const stamped: ArtBoundsDoc = { ...next, updatedAt: new Date().toISOString() };
	const etag = await putObjectText(
		artBoundsDocKey(clientKey, projectKey),
		JSON.stringify(stamped, null, 2),
		'application/json',
		precondition(baseEtag),
	);
	return { doc: stamped, etag };
}

export { ConflictError };
