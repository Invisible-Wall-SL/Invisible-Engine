import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

// VERIFICATION-ONLY config (never committed). Identical to apps/launcher-api/vite.config.js
// plus `ssr.noExternal` for the workspace packages whose `main` is a .ts file with
// extensionless relative imports — without it Node externalizes them in dev and every
// endpoint that imports one 500s with ERR_MODULE_NOT_FOUND (which is why /api/flipbook/save
// has never been runnable on the local dev server either).
export default defineConfig({
	plugins: [sveltekit()],
	ssr: {
		noExternal: [
			'constants-shared',
			'engine-flipbook',
			'engine-flow',
			'engine-flow-migrate',
			'engine-flow-v2',
			'engine-fx',
			'engine-layout',
			'game-config',
			'pixi-svelte',
			'rgs-translator-eagaming',
		],
	},
});
