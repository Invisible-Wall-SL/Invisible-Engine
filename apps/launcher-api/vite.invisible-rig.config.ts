import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Library build of the Invisible rig runtime's WebGL side (`engine-rig/webgl`) as a standalone IIFE
 * exposing `window.invisibleRig` — the global the static tools (Rigger `view.html`, Rig Viewer, cinematic
 * harness) are written against. Bundles everything; no externals.
 *
 * Unminified so attachment class names read as written (the Rigger shows them in its outline).
 * Output is committed as a vendored artifact at `static/rig-viewer/vendor/invisible-rig.js`; rebuild with
 * `pnpm --filter launcher-api build:invisible-rig` after changing `packages/engine-rig`.
 */
export default defineConfig({
	build: {
		lib: {
			entry: resolve(import.meta.dirname, '../../packages/engine-rig/webgl.ts'),
			name: 'invisibleRig',
			formats: ['iife'],
			fileName: () => 'invisible-rig.js',
		},
		outDir: 'static/rig-viewer/vendor',
		emptyOutDir: false,
		minify: false,
		rollupOptions: { external: [] },
	},
});
