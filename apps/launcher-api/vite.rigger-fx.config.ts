import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Dedicated library build for the Rigger's LIVE FX overlay — a standalone IIFE bundle the raw-WebGL
 * Rigger `view.html` loads via a `<script>` tag (like the vendored `spine-webgl-*.js`), exposing
 * `window.RiggerFx`. Bundles ALL deps (pixi.js + `@barvynkoa/particle-emitter` + the reused
 * `engine-fx` / art-helper code) — NO externals — so it runs as a plain script with no import map.
 *
 * Output is committed as a vendored artifact at `static/rigger/vendor/rigger-fx.js`; `emptyOutDir`
 * is false so it never wipes the sibling `view.html` / other vendored files. Build via
 * `pnpm --filter launcher-api build:rigger-fx`.
 */
export default defineConfig({
	build: {
		lib: {
			entry: resolve(import.meta.dirname, 'src/rigger-fx/main.ts'),
			name: 'RiggerFx',
			formats: ['iife'],
			fileName: () => 'rigger-fx.js',
		},
		outDir: 'static/rigger/vendor',
		emptyOutDir: false,
		// Bundle everything — the Rigger has no module system, so nothing may stay external.
		rollupOptions: {
			external: [],
		},
	},
});
