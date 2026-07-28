import { bakedFontAssets } from 'engine-layout';
import { createApp } from 'pixi-svelte';

import {
	bakedBookVfxAssets,
	bakedEditorArtAssets,
	bakedFontCatalog,
	bakedSymbolAssets,
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
		...bakedFontAssets(bakedFontCatalog()),
		...bakedSymbolAssets(),
		...bakedBookVfxAssets(),
	},
});
