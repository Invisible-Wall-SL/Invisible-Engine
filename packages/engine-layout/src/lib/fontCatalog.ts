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

/**
 * Find a catalog entry by the reference a text node stores in `style.fontFamily`.
 * The reference is the font's unique `id` (so two fonts that share a family `name`
 * — e.g. gradient variants of one typeface — stay independently selectable). The
 * `name` is matched as a FALLBACK for docs authored before id-keying, and for the
 * built-in fonts whose `id` and `name` are the same string. `id` wins on a tie.
 */
export function findFont(
	catalog: FontCatalog | null | undefined,
	ref: string | null | undefined,
): FontEntry | undefined {
	if (!catalog || !ref) return undefined;
	return catalog.fonts.find((f) => f.id === ref) ?? catalog.fonts.find((f) => f.name === ref);
}

/** True when the referenced font exists in the catalog and is a bitmap font. */
export function isBitmapFont(
	catalog: FontCatalog | null | undefined,
	ref: string | null | undefined,
): boolean {
	return findFont(catalog, ref)?.kind === 'bitmap';
}

/**
 * The family string to hand PIXI for a stored font reference — the sibling of
 * {@link findFont} that resolves a doc's `style.fontFamily` to the key the runtime
 * actually registered the face under:
 *   - BITMAP → the entry's unique `id`. Both the editor preview and the game install
 *     the `BitmapFont` under `` `${id}-bitmap` `` (the editor builds it explicitly; the
 *     game passes `family: id` to the pixi font asset), so `<BitmapText fontFamily={id}>`
 *     resolves the RIGHT variant even when several share a `<info face>`.
 *   - WEB → the entry's `name` (the CSS `@font-face` family the browser knows).
 *   - No catalog entry (built-in/system family, or an un-synced project) → the raw
 *     `ref` unchanged, so the common `proxima-nova`/system-font case is untouched.
 */
export function fontFamilyForRef(
	catalog: FontCatalog | null | undefined,
	ref: string | null | undefined,
): string | undefined {
	const entry = findFont(catalog, ref);
	if (!entry) return ref ?? undefined;
	return entry.kind === 'bitmap' ? entry.id : entry.name;
}
