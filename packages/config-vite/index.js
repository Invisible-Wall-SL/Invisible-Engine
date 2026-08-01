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
			// Inline EVERY build-time asset into the bundle (single-file game deploy). This includes
			// the KTX2/libktx transcoder (`pixi-svelte` imports it via `?url`): a standalone game's
			// deploy remaps/omits `_app/immutable/assets/`, so an emitted transcoder file 404s there.
			// Inlined, the transcoder travels IN the bundle regardless of deploy layout;
			// `InitialiseApplication.svelte` converts its `data:` URI to a `blob:` URL at runtime
			// (a Worker's `importScripts()` rejects `data:` but accepts `blob:`).
		build: {
			assetsInlineLimit: Infinity,
			sourcemap: dev ? true : false,
			output: {
				sourcemap: dev ? true : false,
			},
		},
	});
