// Don't convert this to a ts file, because of this https://github.com/vitejs/vite/issues/5370
import { sveltekit } from '@sveltejs/kit/vite';
import { lingui } from '@lingui/vite-plugin';
import { defineConfig } from 'vite';

const NODE_ENV = process.env.NODE_ENV;
let dev = NODE_ENV === 'development';

export default () =>
	defineConfig({
		plugins: [sveltekit(), lingui()],
		logLevel: 'info',
		build: {
			// Inline every build-time asset into the bundle (single-file game deploy) — EXCEPT the
			// KTX2/libktx transcoder (`pixi-svelte` imports it via `?url`). It must stay a real,
			// separately-fetchable file: a Web Worker's `importScripts()` rejects the `data:` URI an
			// inlined asset becomes, and it's ~930 KB that should load lazily only when a `.ktx2` is
			// used, not bloat every game's core bundle. `true` = inline (the old `Infinity` for all
			// other assets); `false` = emit as a file.
			assetsInlineLimit: (filePath) => (/libktx.*\.(js|wasm)$/i.test(filePath) ? false : true),
			sourcemap: dev ? true : false,
			output: {
				sourcemap: dev ? true : false,
			},
		},
	});
