import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Dedicated library build for the Rigger's rig-TEXT rasteriser — a standalone IIFE bundle the
 * raw-WebGL Rigger `view.html` loads via a `<script>` tag (like `rigger-fx.js` and the vendored
 * `spine-webgl-*.js`), exposing `window.RiggerText`. Bundles ALL deps (pixi.js + the shared
 * `$lib/fontLoad.client.ts` / `$lib/shelfPack.ts` / `$lib/text/rigTextRaster.client.ts`) — NO
 * externals — so it runs as a plain script with no import map.
 *
 * Output is committed as a vendored artifact at `static/rigger/vendor/rigger-text.js`;
 * `emptyOutDir` is false so it never wipes the sibling `rigger-fx.js` / `view.html`. Build via
 * `pnpm --filter launcher-api build:rigger-text`.
 */
export default defineConfig({
	resolve: {
		// The shared client modules import through SvelteKit's `$lib` alias, which only exists
		// inside the SvelteKit plugin — this is a bare vite lib build, so map it here.
		alias: { $lib: resolve(import.meta.dirname, 'src/lib') },
	},
	build: {
		lib: {
			entry: resolve(import.meta.dirname, 'src/rigger-text/main.ts'),
			name: 'RiggerText',
			formats: ['iife'],
			fileName: () => 'rigger-text.js',
		},
		outDir: 'static/rigger/vendor',
		emptyOutDir: false,
		// Bundle everything — the Rigger has no module system, so nothing may stay external.
		rollupOptions: {
			external: [],
		},
	},
});
