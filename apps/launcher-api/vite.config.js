import { readFileSync } from 'node:fs';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const workspacePackages = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
	.filter(([, version]) => String(version).startsWith('workspace:'))
	.map(([name]) => name);

export default defineConfig({
	plugins: [sveltekit()],
	// Maps only for Sentry: written without a reference, uploaded and deleted by the build's
	// `sentry-sourcemaps.mjs launcher` step. No token, no maps — nothing to strip or leak.
	build: { sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false },
	// The workspace packages ship TypeScript with extensionless imports, which Node cannot load. In
	// dev, Vite externalizes some of them, and a page that reaches one 500s under `vite dev` —
	// `error-tracking` is in `hooks.server.ts` (every page); `constants-shared` → `engine-flow-v2` →
	// `game-config` → `engine-flipbook` in `projects.ts` (every project tool). So all of them are
	// bundled, as the production build bundles them either way.
	ssr: { noExternal: workspacePackages },
});
