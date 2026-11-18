import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Maps only for Sentry: written without a reference, uploaded and deleted by the build's
	// `sentry-sourcemaps.mjs launcher` step. No token, no maps — nothing to strip or leak.
	build: { sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false },
	// `engine-fx` and `error-tracking` ship TypeScript with extensionless imports, which Node cannot
	// load. In dev, Vite externalizes them (unlike the other `engine-*` packages), so every page that
	// reaches one — `error-tracking` is in `hooks.server.ts`, so every page — 500s under `vite dev`.
	// The production build bundles them either way.
	ssr: { noExternal: ['engine-fx', 'error-tracking'] },
});
