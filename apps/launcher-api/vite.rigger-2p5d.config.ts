import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * Library build for the Rigger's 2.5D rigs (docs/design/rig-2p5d.md) — a standalone IIFE the
 * raw-WebGL `view.html` loads via a `<script>` tag (like `rigger-motion.js`), exposing
 * `window.Rigger2p5d`: the bake, the sidecar's helpers and the 3D motion import, all pure.
 *
 * Output is committed at `static/rigger/vendor/rigger-2p5d.js`; `emptyOutDir` is false so it never
 * wipes its siblings. Build via `pnpm --filter launcher-api build:rigger-2p5d`.
 */
export default defineConfig({
	build: {
		lib: {
			entry: resolve(import.meta.dirname, 'src/rigger-2p5d/main.ts'),
			name: 'Rigger2p5d',
			formats: ['iife'],
			fileName: () => 'rigger-2p5d.js',
		},
		outDir: 'static/rigger/vendor',
		emptyOutDir: false,
		rollupOptions: { external: [] },
	},
});
