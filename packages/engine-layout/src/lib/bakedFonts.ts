/**
 * Shared baked-font runtime — the engine-owned half of the font publish pipeline
 * (docs/design/live-assets.md → "Font export"). A game's `bake-editor-doc.mjs`
 * embeds the project's font catalog in `baked-editor-bundle.json`; these helpers
 * turn that catalog into the things a game needs at boot. Defined ONCE here so
 * every game (current and future) gets the same behaviour by calling them —
 * fixes propagate through the engine submodule, not per-game copy-paste.
 *
 * A game's `editor-scenes.ts` extracts `bundle.fonts?.catalog` (it owns its own
 * bundle import + baked/un-baked gate) and passes it in; un-baked dev passes
 * `undefined` and every helper is an inert no-op.
 */
import type { FontCatalog, FontEntry } from './fontCatalog';

/** A pixi asset entry (structurally the game's `RawAsset` for a bitmap font). */
export interface BakedFontAsset {
	type: 'font';
	src: string;
	preload: boolean;
	/** The family key to register the loaded `BitmapFont` under — the font's unique
	 *  `id`, so variants sharing a `<info face>` don't collide (see `bakedFontAssets`). */
	family: string;
}

/**
 * Bitmap fonts from a baked catalog as pixi `{type:'font'}` asset entries, keyed
 * `bakedFont/<id>`. Spread into `createApp({assets})`: `AssetsLoader` preloads the
 * descriptor before first paint. pixi's font loader installs the `BitmapFont` under
 * its `<info face>`, but several fonts can share one face (gradient variants of a
 * typeface), so that key collides. The `family: f.id` here tells `AssetsLoader` to
 * ALSO register the loaded font under `` `${id}-bitmap` `` — the unique key
 * `<CatalogText>`/`fontFamilyForRef` resolves — so `<BitmapText>` picks the right
 * variant. The `src` is `<srcBase><prefix>/<folder>/<descriptor>`; `srcBase` defaults
 * to the page-relative `assets/` (the deploy mirror), and the live-runtime path
 * (Invisible Game Maker) passes the launcher's absolute `/api/deploy?…&rel=` base so a
 * cross-origin generic bundle resolves the same files. Web fonts load via
 * {@link registerBakedWebFonts}. Empty catalog (un-baked / no fonts) ⇒ `{}`.
 */
export function bakedFontAssets(
	catalog: FontCatalog | undefined,
	srcBase = 'assets/',
): Record<string, BakedFontAsset> {
	const out: Record<string, BakedFontAsset> = {};
	if (!catalog) return out;
	for (const f of catalog.fonts) {
		if (f.kind !== 'bitmap' || !f.descriptorFile) continue;
		out[`bakedFont/${f.id}`] = {
			type: 'font',
			src: `${srcBase}${catalog.prefix}/${f.folder}/${f.descriptorFile}`,
			preload: true,
			family: f.id,
		};
	}
	return out;
}

/**
 * Merge a baked project font catalog over the game's built-in font entries for
 * `registerFontCatalog`. Keyed by the unique `id`: a baked entry overrides a built-in
 * of the SAME id, and two fonts that share a family `name` (gradient variants) both
 * survive instead of one clobbering the other. Un-baked ⇒ just the built-ins (parity).
 * `prefix` is irrelevant to the engine's bitmap-vs-`<Text>` decision (it keys on
 * `id`/`kind`), so it is left empty here — the per-font `folder` in
 * {@link bakedFontAssets} drives loading.
 */
export function mergeBakedFontCatalog(
	builtins: FontEntry[],
	baked: FontCatalog | undefined,
): FontCatalog {
	const merged = new Map<string, FontEntry>(builtins.map((f) => [f.id, f]));
	for (const f of baked?.fonts ?? []) merged.set(f.id, f);
	return { prefix: '', fonts: [...merged.values()] };
}

/**
 * Load a baked catalog's WEB fonts via the FontFace API (bitmap fonts go through
 * the pixi asset loader in {@link bakedFontAssets} instead). Best-effort +
 * idempotent: each `@font-face` is loaded from `<srcBase><prefix>/<folder>/<file>`
 * (`srcBase` defaults to the page-relative `assets/`; the live-runtime path passes
 * the launcher's absolute `/api/deploy?…&rel=` base) and added to `document.fonts`
 * so a `<Text fontFamily={name}>` renders the real face. No-op server-side /
 * un-baked / when the project has no web fonts.
 */
export async function registerBakedWebFonts(
	catalog: FontCatalog | undefined,
	srcBase = 'assets/',
): Promise<void> {
	if (typeof document === 'undefined' || !catalog) return;
	for (const f of catalog.fonts) {
		if (f.kind !== 'web') continue;
		for (const wf of f.files ?? []) {
			try {
				const face = new FontFace(f.name, `url(${srcBase}${catalog.prefix}/${f.folder}/${wf.file})`, {
					weight: wf.weight ?? 'normal',
					style: wf.style ?? 'normal',
				});
				await face.load();
				document.fonts.add(face);
			} catch (err) {
				console.warn(`[fonts] web font "${f.name}" (${wf.file}) failed to load:`, err);
			}
		}
	}
}
