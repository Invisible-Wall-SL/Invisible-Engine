import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Maps only for Sentry: written without a reference, uploaded and deleted by the build's
	// `sentry-sourcemaps.mjs launcher` step. No token, no maps — nothing to strip or leak.
	build: { sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false },
	// `engine-fx` ships TypeScript with extensionless imports, which Node cannot load. In dev, Vite
	// externalizes it (unlike the other `engine-*` packages), so `/fx`, `/admin` and every other
	// page that reaches it 500 under `vite dev`. The production build bundles it either way.
	ssr: { noExternal: ['engine-fx'] },
});
