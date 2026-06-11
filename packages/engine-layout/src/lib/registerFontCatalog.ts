import type { FontCatalog } from './fontCatalog';

/**
 * Font-catalog registry — the runtime sibling of the editor's `/api/editor/fonts`
 * catalog. The game registers its font catalog once at boot so the engine layout
 * text path can choose `<BitmapText>` vs `<Text>` by family name: a text node whose
 * `style.fontFamily` names a bitmap-kind entry renders through pixi's BitmapFont
 * blitter, everything else stays a system-font `<Text>` (parity).
 *
 * Module-scoped — i.e. private to whichever copy of this package the importing game
 * pulls in. In a pnpm workspace each game gets its own bundled copy, so there is no
 * cross-game leakage even though we use a top-level value. Games should call
 * `registerFontCatalog` once at boot, exactly as `registerComponents` supplies
 * component defs.
 */
let catalog: FontCatalog | undefined;

export function registerFontCatalog(value: FontCatalog): void {
	catalog = value;
}

export function getFontCatalog(): FontCatalog | undefined {
	return catalog;
}

export function clearFontCatalog(): void {
	catalog = undefined;
}
