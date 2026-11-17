import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Library build for the Rigger's motion import (rig templates T5 / T7b) — a standalone IIFE the
 * raw-WebGL `view.html` loads via a `<script>` tag (like `rigger-text.js`), exposing
 * `window.RiggerMotion`. Bundles MediaPipe's tasks-vision JS and `$lib/rigMotion`; the WASM runtime
 * and the `.task` models are fetched at run time from `/rigger/vendor/mediapipe/`.
 *
 * Output is committed at `static/rigger/vendor/rigger-motion.js`; `emptyOutDir` is false so it
 * never wipes its siblings. Build via `pnpm --filter launcher-api build:rigger-motion`.
 */
export default defineConfig({
	build: {
		lib: {
			entry: resolve(import.meta.dirname, 'src/rigger-motion/main.ts'),
			name: 'RiggerMotion',
			formats: ['iife'],
			fileName: () => 'rigger-motion.js',
		},
		outDir: 'static/rigger/vendor',
		emptyOutDir: false,
		rollupOptions: {
			external: [],
		},
	},
});
