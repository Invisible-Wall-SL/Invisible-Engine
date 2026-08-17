import { createHash } from 'node:crypto';
import { loadRegionSet, type EditorRegionSet } from '$lib/server/editorRegions';
import {
	deleteObject,
	getObjectBytes,
	getObjectText,
	headObject,
	putObjectBytes,
	putObjectText,
} from '$lib/server/r2';
import {
	normalizeRigTextDoc,
	rigTextDocKey,
	rigTextRevision,
	textAtlasBlock,
	type RigTextDoc,
} from '$lib/server/riggerText';
import {
	regionsToSpineAtlas,
	reorientRotatedRegionsForSpine,
	type SynthRegion,
} from '$lib/server/spine';

/**
 * A rig bundle (`spines/<name>/`) carries its OWN `.atlas` + page image — a COPY of the
 * source sheet's geometry, snapshotted at rig creation and never auto-updated. When the
 * source sheet is regenerated/re-packed the live manifest gets new rects, but the bundle
 * stays frozen, so every consumer that reads the bundle (Symbols, Scene Editor spine
 * preview, the baked game) shows STALE geometry until the rig is manually `⟳ Re-sync`ed.
 *
 * This module is the single freshness gate. A bundle's `source.json` records the source
 * `manifestKey` PLUS a `geometryRevision` — a stable content hash of the regions that were
 * synthesised into its `.atlas`. Before any consumer reads the bundle, `ensureBundleAtlasFresh`
 * re-derives the live revision and, when it drifted (or `force`), re-synthesises the bundle
 * `.atlas` + page from the live manifest. Same deterministic bytes on every call, so racing
 * reads that both detect drift converge safely.
 *
 * The `.irig` skeleton (bones + mesh UVs) is deliberately never touched — matching the
 * `⟳ Re-sync atlas` contract. A pure re-pack (art unchanged, rects moved) is fully healed;
 * if the ART inside a region changed shape the mesh was authored against the old pixels and
 * needs re-rigging regardless — no atlas refresh can fix that.
 */

const basename = (k: string): string => {
	const i = k.lastIndexOf('/');
	return i === -1 ? k : k.slice(i + 1);
};

const firstNonEmptyLine = (text: string): string =>
	text
		.split(/\r?\n/)
		.map((l) => l.trim())
		.find((l) => l !== '') ?? '';

/** The page image a bundle `.atlas` names (its first line) — so a reader can check the page
 *  actually exists before handing the atlas to a runtime that fails opaquely if it doesn't. */
export const firstAtlasPageName = (text: string): string => firstNonEmptyLine(text);

/**
 * Stable content hash of a bundle's on-page geometry — the signal that says "the source
 * sheet's rects changed". Independent of the page FILENAME (which can change on a re-pack
 * without the layout changing) and of art PIXELS (a recolour that keeps the same rects must
 * NOT force a geometry resync — the page-image copy is refreshed on its own mtime). Rounded
 * to match `regionsToSpineAtlas`, so the hash and the emitted `.atlas` never disagree.
 */
export function geometryRevision(
	regions: SynthRegion[],
	pageWidth: number,
	pageHeight: number,
): string {
	const lines = regions
		.map((r) => {
			const w = Math.round(r.w);
			const h = Math.round(r.h);
			const ow = Math.round(r.origW ?? r.w);
			const oh = Math.round(r.origH ?? r.h);
			const ox = Math.round(r.offX ?? 0);
			const oy = Math.round(r.offY ?? 0);
			return `${r.name}:${Math.round(r.x)},${Math.round(r.y)},${w},${h},${r.rotated ? 1 : 0},${ox},${oy},${ow},${oh}`;
		})
		// Sort so region ORDER in the manifest never changes the hash — only geometry does.
		.sort();
	lines.push(`page:${Math.round(pageWidth)}x${Math.round(pageHeight)}`);
	return createHash('sha1').update(lines.join('\n')).digest('hex').slice(0, 16);
}

/**
 * The full freshness signal a bundle records in `source.json` — the geometry revision PLUS
 * the source page's content fingerprint. The geometry hash catches a re-PACK (rects moved);
 * the page ETag catches a RECOLOUR (same rects, new pixels) so an Atlas-Maker art change also
 * self-heals into the bundle page — which the baked game copies verbatim. Falls back to the
 * page's `size:mtime` when the store gives no ETag (multi-part uploads). One cheap HEAD.
 */
export async function bundleRevision(rs: EditorRegionSet): Promise<string> {
	const geo = geometryRevision(rs.regions, rs.pageWidth, rs.pageHeight);
	let pageSig = '';
	if (rs.pageKey) {
		const head = await headObject(rs.pageKey);
		pageSig = head ? (head.etag ?? `${head.size}:${head.lastModified}`) : 'none';
	}
	return `${geo}:${createHash('sha1').update(pageSig).digest('hex').slice(0, 12)}`;
}

/**
 * Read a bundle's rig-text document (`text.json`) — the localized-art elements whose regions
 * are composed onto a SECOND atlas page. Absent/corrupt ⇒ an empty doc, so a rig with no text
 * (every rig today) composes an atlas byte-identical to before.
 */
export async function loadBundleTextDoc(bundlePrefix: string): Promise<RigTextDoc> {
	const text = await getObjectText(rigTextDocKey(bundlePrefix));
	if (!text) return normalizeRigTextDoc(null);
	try {
		return normalizeRigTextDoc(JSON.parse(text));
	} catch {
		return normalizeRigTextDoc(null);
	}
}

export interface BundleSyncResult {
	/** Whether the bundle `.atlas` + page were (re)written this call. */
	changed: boolean;
	/** The geometry revision now recorded in the bundle's `source.json`. */
	revision: string;
	/** Region count in the live source manifest. */
	regions: number;
}

/**
 * Bring a rig bundle's `.atlas` + page into line with its source manifest, IF they drifted
 * (or `force`). Returns `null` when the bundle has no known source (no `source.json`, an
 * atlas-less rig, or a source manifest that no longer resolves to regions/a page) — callers
 * treat that as "leave the frozen bundle as-is", never as an error.
 *
 * @param bundlePrefix full R2 prefix of the bundle, e.g. `<client>/<project>/spines/<name>`
 * @param atlasFile    the `.atlas` filename inside the bundle (from the skeleton index)
 */
export async function ensureBundleAtlasFresh(
	clientKey: string,
	projectKey: string,
	bundlePrefix: string,
	atlasFile: string,
	opts: { force?: boolean; manifestKey?: string } = {},
): Promise<BundleSyncResult | null> {
	// The source manifest comes from the caller's override (the Rigger's re-pick picker) or,
	// failing that, the bundle's remembered `source.json`. We NEVER pre-write the sidecar:
	// it is (re)written only on a successful sync below, so a bail (missing page, no regions)
	// can't leave a revision-less sidecar that would make every future read re-attempt the heal.
	const sidecarText = await getObjectText(`${bundlePrefix}/source.json`);
	let sidecarManifestKey = '';
	let recordedRevision = '';
	if (sidecarText) {
		try {
			const parsed = JSON.parse(sidecarText) as {
				manifestKey?: unknown;
				geometryRevision?: unknown;
			};
			if (typeof parsed.manifestKey === 'string') sidecarManifestKey = parsed.manifestKey;
			if (typeof parsed.geometryRevision === 'string') recordedRevision = parsed.geometryRevision;
		} catch {
			/* corrupt sidecar → treat as no baseline; a successful sync overwrites it */
		}
	}
	const manifestKey = opts.manifestKey || sidecarManifestKey;
	if (!manifestKey) return null;
	// A caller pointing at a DIFFERENT source than the one recorded invalidates the baseline —
	// the recorded revision was hashed against the old manifest, so force a re-synth.
	const baseline =
		opts.manifestKey && opts.manifestKey !== sidecarManifestKey ? '' : recordedRevision;

	const rs = await loadRegionSet(manifestKey, clientKey, projectKey);
	if (!rs.regions.length || !rs.pageKey || !rs.pageWidth || !rs.pageHeight) return null;

	// Rig TEXT (design §12.4a) is localized art packed onto a SECOND page of this bundle's
	// atlas. It is DERIVED here rather than appended to the file, because this function rewrites
	// the `.atlas` wholesale — an appended block would be silently dropped on the next sync. Its
	// hash joins the revision so a text-only edit still reads as drift (same sheet, same page
	// ETag would otherwise short-circuit and keep serving the pre-text atlas). A rig with no text
	// contributes an EMPTY suffix, so its revision is byte-identical to before this existed.
	const textDoc = await loadBundleTextDoc(bundlePrefix);
	const textBlock = textAtlasBlock(textDoc);
	const textRev = rigTextRevision(textDoc);
	const sheetRev = await bundleRevision(rs);
	const revision = textRev ? `${sheetRev}:t${textRev}` : sheetRev;
	if (!opts.force && revision === baseline) {
		return { changed: false, revision, regions: rs.regions.length };
	}

	// Drifted (or forced) → re-synthesise the bundle `.atlas` + page from the live manifest.
	const page = await getObjectBytes(rs.pageKey);
	if (!page) return null; // page vanished — can't refresh; leave the bundle untouched
	const pageName = basename(rs.pageKey);
	const atlasText =
		regionsToSpineAtlas(pageName, rs.pageWidth, rs.pageHeight, rs.regions) + textBlock;
	// Re-orient CW-packed rotated regions to Spine's CCW `rotate:90` convention (no-op when
	// nothing is rotated) so the bundle stays self-consistent — its own page + its own atlas.
	const pageBody = await reorientRotatedRegionsForSpine(page.body, rs.regions);

	// Remember the OLD page name so a rename (page filename changed) can drop the orphan
	// AFTER the new page is written — a failure can never leave the rig with no page at all.
	const oldAtlas = await getObjectText(`${bundlePrefix}/${atlasFile}`);
	const oldPageName = oldAtlas ? firstNonEmptyLine(oldAtlas) : '';

	await putObjectBytes(`${bundlePrefix}/${pageName}`, pageBody, page.contentType);
	await putObjectText(`${bundlePrefix}/${atlasFile}`, atlasText, 'text/plain; charset=utf-8');
	await putObjectText(
		`${bundlePrefix}/source.json`,
		JSON.stringify({ manifestKey, pageName, geometryRevision: revision }),
		'application/json',
	);
	if (oldPageName && oldPageName !== pageName) {
		await deleteObject(`${bundlePrefix}/${oldPageName}`);
	}

	return { changed: true, revision, regions: rs.regions.length };
}
