import { createApp } from 'pixi-svelte';

import { bakedEditorArtAssets, bakedFontAssets } from '../editor-scenes';
import assets from './assets';

// Editor-art sheets (atlases the baked layout doc references) + baked project
// bitmap fonts (Font Maker output), both pulled into static/assets/ by the deploy
// mirror, register alongside the game's own assets — so editor-placed sprites and
// editor-authored fonts resolve without manual assets.ts entries.
export const { stateApp } = createApp({
	assets: { ...assets, ...bakedEditorArtAssets(), ...bakedFontAssets() },
});
