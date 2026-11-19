import { resolve } from 'node:path';
import { defineConfig } from 'vite';

/**
 * The model derive worker (`src/lib/server/modelDeriveWorker.ts`) as ONE Node ES module beside the
 * server build: `build/model-derive-worker.mjs`, which `scripts/start.mjs` points
 * `MODEL_DERIVE_WORKER` at. The SvelteKit server build emits no worker entry, hence this build.
 *
 * npm packages stay external (resolved from the launcher's `node_modules` at run time, as the server
 * build's are): `sharp` and `ktx2-encoder` ship native code and wasm that must not be bundled. The
 * workspace TypeScript (`constants-shared`, the launcher's own modules) is bundled in.
 *
 * Run by `pnpm --filter launcher-api build` after the SvelteKit build (which rewrites `build/`), or
 * alone with `pnpm --filter launcher-api build:model-worker`.
 */
const NPM_EXTERNAL = ['sharp', 'ktx2-encoder', 'meshoptimizer', /^@gltf-transform\//, /^node:/];

export default defineConfig({
	build: {
		ssr: resolve(import.meta.dirname, 'src/lib/server/modelDeriveWorker.ts'),
		outDir: 'build',
		emptyOutDir: false,
		target: 'node22',
		minify: false,
		rollupOptions: {
			external: NPM_EXTERNAL,
			output: { entryFileNames: 'model-derive-worker.mjs', format: 'es' },
		},
	},
	ssr: { noExternal: ['constants-shared'] },
});
