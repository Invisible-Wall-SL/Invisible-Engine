/**
 * Editor-art texture namespacing (docs/design/live-assets.md).
 *
 * The engine loads every spritesheet into ONE flat `loadedAssets` map keyed by
 * bare frame name, and a sprite resolves its texture by that bare name. Two
 * editor-art sheets that reuse a region name (e.g. a "3D" remake of a sheet that
 * keeps `T_Background`) therefore collide — the sheet loaded last silently wins,
 * so a node bound to the new sheet renders the OLD sheet's frame.
 *
 * The fix scopes each editor-art sheet's frames by the MANIFEST the node is bound
 * to (`SpriteNode.assetKey`). The game registers an editor-art sheet's textures
 * under `<assetKey>::<frame>` (the `sprites` loader's `namespace`), and a sprite
 * node resolves `<assetKey>::<region>`. Registration and lookup MUST go through
 * these helpers so the two keys always agree.
 *
 * A bare frame key is still registered alongside the scoped one, and the lookup
 * falls back to it, so a game whose editor-art registration predates this (no
 * `namespace`) keeps rendering exactly as before — collisions and all.
 */

/** A node `assetKey` that names an R2 atlas/sheet manifest (editor-art), vs a
 * game-bundled key like `symbolsStatic`. Mirrors `editorArtExport.isManifestAssetKey`. */
export function isManifestAssetKey(assetKey: unknown): assetKey is string {
	return typeof assetKey === 'string' && assetKey.includes('/') && assetKey.endsWith('.json');
}

/** An atlas ref that names its manifest by BARE BASENAME — ends in `.json` but carries no path
 * segment (`atlas_manifest_S_Gem.json`). Fails {@link isManifestAssetKey}, so the scoped lookup
 * skips it. */
export function isBareManifestBasename(ref: unknown): ref is string {
	return typeof ref === 'string' && !ref.includes('/') && ref.toLowerCase().endsWith('.json');
}

/**
 * Whether an atlas ref must be REPAIRED to a full manifest key before the runtime can scope frames
 * by it. True for the two forms an authoring tool can store that {@link isManifestAssetKey}
 * rejects: a bare manifest basename, and a Sheet-Maker OUTPUT PREFIX
 * (`<client>/<project>/sheets/S_Gem/` — a path with no `.json`).
 *
 * Both make the scoped lookup fall through to the flat bare-name texture cache, where two clips or
 * symbols reusing a frame name (`frame_0000`) on DISTINCT atlases collide and one silently renders
 * the other's art. Lives HERE, beside `isManifestAssetKey`, so the pipeline's repair pass and the
 * runtime's lookup can never disagree about what "scopeable" means — the disagreement IS the bug.
 *
 * A game-bundled key like `symbolsStatic` matches neither form and needs no repair.
 */
export function needsAtlasRefRepair(ref: unknown): ref is string {
	if (typeof ref !== 'string' || ref === '') return false;
	// Read both tests BEFORE the guards decide: `isManifestAssetKey` / `isBareManifestBasename` are
	// declared `ref is string`, so once `ref` is already a string TS narrows it to `never` in their
	// NEGATIVE branches — and `ref.includes(…)` after one of those is a type error (it compiled only
	// because nothing in this repo type-checks `packages/`).
	const looksLikePath = ref.includes('/');
	const bareBasename = isBareManifestBasename(ref);
	return !isManifestAssetKey(ref) && (bareBasename || looksLikePath);
}

/** The per-sheet key PREFIX (separator included) the editor-art `sprites` loader
 * prepends to every frame name. Pass as the asset's `namespace`. */
export function editorArtNamespace(assetKey: string): string {
	return `${assetKey}::`;
}

/** The scoped `loadedAssets` key a sprite node bound to `assetKey` uses for `region`. */
export function editorArtTextureKey(assetKey: string, region: string): string {
	return `${editorArtNamespace(assetKey)}${region}`;
}

/**
 * Atlas-scoped FRAME REFERENCE — the value an `image`-kind component param stores so
 * a picked frame carries the atlas it came from. A bare region name is atlas-blind
 * (a name packed by two atlases is ambiguous — the picker highlights both, the
 * runtime's flat texture map lets the last-loaded sheet win, and the exporter guesses
 * the first project atlas that packs it). Encoding the manifest with the name pins
 * all three. The format is identical to `editorArtTextureKey` (`<assetKey>::<region>`).
 */
export function scopedFrameRef(assetKey: string, region: string): string {
	return editorArtTextureKey(assetKey, region);
}

/**
 * Split a stored frame ref into its atlas + region. A value WITHOUT a manifest prefix returns just
 * the region with no `assetKey`, so old bindings resolve exactly as before — but WHICH region
 * depends on what the prefix is:
 *
 * - a legacy BARE NAME, or a name that merely happens to contain `::` ⇒ the whole value (parity);
 * - an atlas ref the runtime cannot scope by (bare manifest basename / Sheet-Maker output prefix)
 *   ⇒ the region AFTER it, so an unrepaired ref still resolves against the bare frame key.
 */
export function parseScopedFrameRef(value: string | undefined): {
	assetKey?: string;
	region: string;
} {
	if (typeof value !== 'string' || value === '') return { region: value ?? '' };
	const i = value.indexOf('::');
	if (i <= 0) return { region: value };
	const assetKey = value.slice(0, i);
	const region = value.slice(i + 2);
	if (!region) return { region: value };
	if (isManifestAssetKey(assetKey)) return { assetKey, region };
	// The prefix NAMES an atlas, but in a form the runtime cannot scope by — a bare manifest
	// basename, or a Sheet-Maker output prefix (see {@link needsAtlasRefRepair}). Turning those into
	// full manifest keys is the SHIP PATH's job, and a ref that arrives here unrepaired must still
	// render: drop the un-scopeable prefix and read the BARE region, which the `sprites` loader
	// registers alongside every scoped frame. Keeping the WHOLE string as a region name is the one
	// outcome that cannot work — no frame is named `<prefix>::<region>`, so the sprite draws nothing
	// AND the editor-art export reports the ref as a dangling region instead of shipping the sheet
	// that packs it. This loses the atlas pin, so it is a DEGRADATION, not the fix — the repair is.
	if (needsAtlasRefRepair(assetKey)) return { region };
	// Not an atlas ref at all — a region name that merely CONTAINS `::`. Unchanged (parity).
	return { region: value };
}
