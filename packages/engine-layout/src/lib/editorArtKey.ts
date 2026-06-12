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

/** The per-sheet key PREFIX (separator included) the editor-art `sprites` loader
 * prepends to every frame name. Pass as the asset's `namespace`. */
export function editorArtNamespace(assetKey: string): string {
	return `${assetKey}::`;
}

/** The scoped `loadedAssets` key a sprite node bound to `assetKey` uses for `region`. */
export function editorArtTextureKey(assetKey: string, region: string): string {
	return `${editorArtNamespace(assetKey)}${region}`;
}
