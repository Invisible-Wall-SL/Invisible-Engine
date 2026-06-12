/**
 * Font catalog — the single source of truth for the fonts a project's layout text
 * may use. Shared by: the editor's font dropdown, the editor's faithful renderer
 * (which render path — bitmap blitter vs system font), the engine layout text path
 * (`<Text>` vs `<BitmapText>`), the game's boot-time font registration, and editor
 * validation (warn when a text node references a font the project lacks — mirrors
 * the slot/asset warnings). See `docs/design/invisible-editor.md` §9.
 *
 * A project's catalog lives in R2 at `<client>/<project>/fonts/fonts.json`, with a
 * `_shared/fonts/fonts.json` library fallback — mirroring the spine
 * `skeletons.json` / `includeSharedSpines` posture. The sync writes it; the
 * `/api/editor/fonts` endpoint serves it (enriched with stream URLs).
 */

export type FontKind = 'bitmap' | 'web';

/** A bitmap font's descriptor format (the glyph/page table the editor parses). */
export type FontDescriptorFormat = 'xml' | 'fnt' | 'json';

/** Authoring-only sidecar refs (relative to `folder`) that let the Font Maker
 *  reopen + re-bake a generated bitmap font. NOT shipped to games. */
export interface FontRecipe {
	/** The bake-params JSON filename. */
	file: string;
	/** The original source TTF/OTF filename. */
	sourceFile: string;
}

/** One downloadable file of a web font (woff2/woff/ttf/otf). */
export interface FontFile {
	/** Filename relative to the font's `folder`. */
	file: string;
	/** CSS `@font-face` format token, e.g. `woff2`, `woff`, `truetype`, `opentype`. */
	format: string;
	weight?: string;
	style?: 'normal' | 'italic' | 'oblique';
}

/**
 * One entry in a project's `fonts.json`. Files are stored as names relative to
 * `folder` (exactly like spine `skeletons.json`), so the same catalog resolves
 * against either the per-project or the shared `_shared/fonts/` root.
 */
export interface FontEntry {
	/** Stable catalog id — the font's R2 folder (unique within the catalog). */
	id: string;
	/**
	 * The family name a text node references via `style.fontFamily`. For a BITMAP
	 * font this is the BMFont `<info face>` — the name pixi registers the
	 * `BitmapFont` under, so the game's `<BitmapText fontFamily={name}>` resolves
	 * it. For a WEB font it's the CSS family.
	 */
	name: string;
	kind: FontKind;
	/** R2 folder (relative to the fonts root) the font's files live under. */
	folder: string;
	/** Bitmap only: the BMFont descriptor filename (relative to `folder`). */
	descriptorFile?: string;
	/** Bitmap only: descriptor format, so parser + pixi loader pick the right path. */
	descriptorFormat?: FontDescriptorFormat;
	/** Bitmap only: page image filenames (relative to `folder`). */
	pageFiles?: string[];
	/** Web only: the downloadable font files. */
	files?: FontFile[];
	/**
	 * Bitmap only, AUTHORING-ONLY: sidecar refs (a bake-params JSON + the original
	 * source TTF/OTF) that let the Font Maker reopen + re-bake the font with tweaked
	 * params. Stripped on export — never shipped to a game.
	 */
	recipe?: FontRecipe;
}

/** The `fonts.json` manifest the sync writes + `/api/editor/fonts` serves. */
export interface FontCatalog {
	prefix: string;
	fonts: FontEntry[];
}

/** Find a catalog entry by the name a text node stores in `style.fontFamily`. */
export function findFont(
	catalog: FontCatalog | null | undefined,
	name: string | null | undefined,
): FontEntry | undefined {
	if (!catalog || !name) return undefined;
	return catalog.fonts.find((f) => f.name === name);
}

/** True when the named font exists in the catalog and is a bitmap font. */
export function isBitmapFont(
	catalog: FontCatalog | null | undefined,
	name: string | null | undefined,
): boolean {
	return findFont(catalog, name)?.kind === 'bitmap';
}
