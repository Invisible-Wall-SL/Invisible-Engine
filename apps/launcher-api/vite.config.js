import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Maps only for Sentry: written without a reference, uploaded and deleted by the build's
	// `sentry-sourcemaps.mjs launcher` step. No token, no maps — nothing to strip or leak.
	build: { sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false },
});
