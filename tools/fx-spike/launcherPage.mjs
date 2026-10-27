/**
 * A launcher page (or one of its components) built to play headless outside SvelteKit: the entry
 * bundled with Vite and the launcher's Svelte plugin into one classic script, `$lib` resolved as the
 * launcher's and `$app/*` stubbed (`fxPage/app*.ts`), opened from a file:// URL. Used by `fxPage.mjs`
 * (the `/fx` page) and `fxPreviews.mjs` (the Scene Editor's FX overlay).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const LAUNCHER = join(REPO, 'apps/launcher-api');

/** Import `name` (an ES module package) as the launcher resolves it: its `exports` import entry. */
export const loadLauncherPackage = (name) => {
	const root = join(LAUNCHER, 'node_modules', name);
	const entry = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).exports['.'].import;
	return import(pathToFileURL(join(root, typeof entry === 'string' ? entry : entry.default)).href);
};

/** Build `entry` (a path under this directory) into `<outDir>/<name>.js` and `<name>.html`. */
export async function buildLauncherPage({ entry, name, outDir, title = name }) {
	const { build: viteBuild } = await loadLauncherPackage('vite');
	const { svelte, vitePreprocess } = await loadLauncherPackage('@sveltejs/vite-plugin-svelte');
	await viteBuild({
		configFile: false,
		// Bare imports the entry makes (`svelte`, its runtime) resolve as the launcher's do.
		root: LAUNCHER,
		logLevel: 'error',
		base: './',
		plugins: [svelte({ configFile: false, preprocess: vitePreprocess() })],
		resolve: {
			alias: [
				{ find: /^\$lib\//, replacement: `${join(LAUNCHER, 'src/lib')}/` },
				{ find: '$app/navigation', replacement: join(HERE, 'fxPage/appNavigation.ts') },
				{ find: '$app/environment', replacement: join(HERE, 'fxPage/appEnvironment.ts') },
				{ find: '$app/state', replacement: join(HERE, 'fxPage/appState.ts') },
				{ find: '$app/paths', replacement: join(HERE, 'fxPage/appPaths.ts') },
				{ find: /^@fxroot\//, replacement: `${REPO}/` },
			],
			conditions: ['svelte', 'browser', 'import', 'default'],
			dedupe: ['svelte'],
		},
		build: {
			outDir,
			emptyOutDir: true,
			minify: false,
			// One classic script: the page opens from a file:// URL.
			rollupOptions: {
				input: join(HERE, entry),
				output: { format: 'iife', entryFileNames: `${name}.js`, inlineDynamicImports: true },
			},
		},
	});
	const html = join(outDir, `${name}.html`);
	writeFileSync(
		html,
		`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title></head>` +
			`<body style="margin:0;background:#0b0e13"><script src="${name}.js"></script></body></html>`,
	);
	return html;
}
