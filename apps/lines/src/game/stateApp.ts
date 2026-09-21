import { bakedFontAssets } from 'engine-layout';
import { createApp } from 'pixi-svelte';

import {
	bakedBookVfxAssets,
	bakedEditorArtAssets,
	bakedFontCatalog,
	bakedFontSrcBase,
	bakedSymbolAssets,
	bakedSymbolTransitionAssets,
} from '../editor-scenes';
import assets from './assets';

// Editor-art sheets (atlases the baked layout doc references) + baked project
// bitmap fonts (Font Maker output) + baked symbol bindings (Invisible Symbols State
// Machine output), all pulled into static/assets/ by the deploy mirror, register
// alongside the game's own assets — so editor-placed sprites, editor-authored fonts, and
// rebound symbol sprites/spines resolve without manual assets.ts entries. The font→asset
// mapping lives in the engine (`bakedFontAssets`) so every game shares it.
export const { stateApp } = createApp({
	assets: {
		...assets,
		...bakedEditorArtAssets(),
		// `bakedFontSrcBase()` is NOT optional here, though the parameter has a default.
		// That default is the page-relative `'assets/'`, which is only ever right while the
		// document and the bundle share a folder — true for everything we host, false for a
		// DELIVERY, where the page belongs to the operator. Measured 2026-09-21 on a real
		// delivery: the four bitmap-font descriptors were fetched from
		// `{operator page}/assets/editor-fonts/…` and 404'd, while every other baked asset
		// resolved correctly because `editor-scenes` builds those through `srcBase()`.
		// At module scope this reads `gameAssetsBase()` — an absolute URL off
		// `import.meta.url`, settled before anything loads — and live-runtime mode re-registers
		// with the launcher's base from `Game.svelte`, as it already did.
		...bakedFontAssets(bakedFontCatalog(), bakedFontSrcBase()),
		...bakedSymbolAssets(),
		...bakedBookVfxAssets(),
		...bakedSymbolTransitionAssets(),
	},
});
