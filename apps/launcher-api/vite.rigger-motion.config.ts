import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Library build for the Rigger's motion import (rig templates T5 / T7b) — a standalone IIFE the
 * raw-WebGL `view.html` loads via a `<script>` tag (like `rigger-text.js`), exposing
 * `window.RiggerMotion`. Bundles MediaPipe's tasks-vision JS and `$lib/rigMotion`; the WASM runtime
 * and the `.task` models are fetched at run time from `/rigger/vendor/mediapipe/`.
 *
 * Output is committed at `static/rigger/vendor/rigger-motion.js`; `emptyOutDir` is false so it
 * never wipes its siblings. Build via `pnpm --filter launcher-api build:rigger-motion`.
 */

/**
 * tasks-vision 1.2.0 builds a usage logger into every task (`createFromOptions`) that POSTs stats
 * to `odml.pa.googleapis.com` every 60 s, with no option to turn it off. This swaps the logger class
 * for one that starts in its own failed state, so its callers queue nothing and it never sends. The
 * match is on the pinned 1.2.0 source; a version where it no longer matches fails the build rather
 * than ship the logger.
 */
const LOGGER = /Ch=class\{constructor\(t\)\{this\.i=\[\],this\.o=new Ah[\s\S]*?\};(?=class Nh)/g;
const INERT_LOGGER =
	'Ch=class{constructor(){this.i=[],this.error=Error("usage logging removed")}close(){}flush(t,e){e?.("net-send-failed")}};';

function withoutUsageLogging(): Plugin {
	return {
		name: 'rigger-motion:no-mediapipe-usage-logging',
		transform(code, id) {
			if (!id.replaceAll('\\', '/').endsWith('@mediapipe/tasks-vision/vision_bundle.mjs')) return;
			const found = code.match(LOGGER) ?? [];
			if (found.length !== 1 || !found[0].includes('odml.pa.googleapis.com'))
				throw new Error(
					`rigger-motion: tasks-vision's usage logger not found where 1.2.0 has it (${found.length} matches); re-check it before upgrading`,
				);
			return { code: code.replace(LOGGER, INERT_LOGGER), map: null };
		},
	};
}

export default defineConfig({
	plugins: [withoutUsageLogging()],
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
			output: {
				banner:
					'/*! rigger-motion.js bundles @mediapipe/tasks-vision 1.2.0, Copyright The MediaPipe Authors, Apache-2.0 (/rigger/vendor/mediapipe/LICENSE). Modified by Invisible Wall SL: its usage logger is removed (/rigger/vendor/mediapipe/NOTICE). */',
			},
		},
	},
});
