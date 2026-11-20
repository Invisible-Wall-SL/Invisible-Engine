import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Library build for the Rigger's control layer (docs/design/rig-controls.md §5.7) — a standalone IIFE
 * the raw-WebGL `view.html` loads via a `<script>` tag, exposing `window.RiggerControls`. The page
 * follows a bone or constraint rename into `controls.json` and drops what a delete removed with the
 * same code the save runs (`$lib/rigControls` is pure, so the bundle is that module and nothing else).
 *
 * Output is committed at `static/rigger/vendor/rigger-controls.js`; `emptyOutDir` is false so it
 * never wipes its siblings. Build via `pnpm --filter launcher-api build:rigger-controls`.
 */
export default defineConfig({
	build: {
		lib: {
			entry: resolve(import.meta.dirname, 'src/lib/rigControls.ts'),
			name: 'RiggerControls',
			formats: ['iife'],
			fileName: () => 'rigger-controls.js',
		},
		outDir: 'static/rigger/vendor',
		emptyOutDir: false,
		rollupOptions: { external: [] },
	},
});
