import { createApp } from 'pixi-svelte';

import { bakedEditorArtAssets } from '../editor-scenes';
import assets from './assets';

// Editor-art sheets (atlases the baked layout doc references, pulled into
// static/assets/editor-art/) register alongside the game's own assets so
// editor-placed sprites resolve without manual assets.ts entries.
export const { stateApp } = createApp({ assets: { ...assets, ...bakedEditorArtAssets() } });
