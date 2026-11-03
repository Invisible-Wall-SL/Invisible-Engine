/**
 * Let a game build's dynamic imports become their own chunks (dependency-free, so a fixture can
 * drive it without starting sveltekit()).
 *
 * `config-svelte` builds every game with SvelteKit's `bundleStrategy: 'single'`: one ES-module
 * entry, `_app/immutable/bundle.<hash>.js`, that the `index.html` shell imports. SvelteKit sets
 * `inlineDynamicImports: true` for it, so an `import()` still lands in the one file. This turns
 * that off for the client build, so code a boot may never reach is fetched only when it is: the
 * error-reporting SDK (`error-tracking`'s `await import('./sdk')`, reached only with a DSN), Pixi's
 * canvas fallback renderer, a family's online code. (The two Pixi imports every boot makes stay in
 * the bundle: `pixiRenderers.js` `eagerPixiBoot`.) Each chunk is content-hashed under
 * `_app/immutable/chunks/` and resolves against the importing module's `import.meta.url`, so it is
 * found from any folder the build is served from.
 *
 * An EMBED build (`PUBLIC_DELIVERY_EMBED=1`) keeps one file: its contract with the partner is one
 * `game.js` loading one bundle (`docs/design/delivery-builds.md`).
 *
 * SvelteKit's own route nodes are the exception: its generated `app.js` loads every layout and page
 * with `() => import('./nodes/N')`, which would put the whole game in a chunk fetched only after
 * the bundle has run, one round trip later. `eagerRouteNodes` makes those imports (and kit's
 * fallback error page) static, so the bundle holds what it held when everything was inlined, and
 * only the imports the game's own code (and Pixi) make dynamically are left to load on demand.
 *
 * `enforce: 'post'` so SvelteKit's config (format, `inlineDynamicImports`) is already merged in;
 * only the shape it gives a 'single' client build is changed.
 */
const KIT_APP = /[\\/]generated[\\/]client-optimized[\\/]app\.js$/;
const NODE_IMPORT = /\(\) => import\('(\.\/nodes\/\d+)'\)/g;
const ERROR_TEMPLATE = "import('../shared/error-template.js')";

/**
 * Kit's `app.js` with each route node, and its fallback error page, imported statically. The error
 * page (~0.6 KB gz) is what kit renders when the app itself fails to load; fetched lazily, it would
 * need the network at exactly the moment something has gone wrong. Throws on a shape it does not
 * know.
 */
export const eagerRouteNodes = (code) => {
	const nodes = [...code.matchAll(NODE_IMPORT)].map((m) => m[1]);
	if (!nodes.length || !code.includes(ERROR_TEMPLATE)) {
		throw new Error(
			"SvelteKit's generated app.js no longer loads its nodes with `() => import('./nodes/N')` " +
				`and its error page with \`${ERROR_TEMPLATE}\`: update eagerRouteNodes in ` +
				'packages/config-vite/lazyChunks.js for this SvelteKit version.',
		);
	}
	const name = (path) => `__ie_node_${path.slice('./nodes/'.length)}`;
	const imports = [
		...nodes.map((path) => `import * as ${name(path)} from '${path}';`),
		"import * as __ie_error_template from '../shared/error-template.js';",
	].join('\n');
	const body = code
		.replace(NODE_IMPORT, (_, path) => `() => Promise.resolve(${name(path)})`)
		.replace(ERROR_TEMPLATE, 'Promise.resolve(__ie_error_template)');
	// At the end, where no existing line moves: an import is hoisted wherever it is written.
	return `${body}\n${imports}\n`;
};

export const lazyChunks = ({ embed = process.env.PUBLIC_DELIVERY_EMBED === '1' } = {}) => {
	let active = false;
	return {
		name: 'ie:lazy-chunks',
		apply: 'build',
		enforce: 'post',
		config(config) {
			const output = config.build?.rollupOptions?.output;
			active =
				!embed &&
				!config.build?.ssr &&
				!Array.isArray(output) &&
				output?.format === 'esm' &&
				output.inlineDynamicImports === true;
			if (!active) return;
			return {
				build: {
					rollupOptions: {
						// SvelteKit's 'strict' would keep the bundle to its own two exports and move all of
						// its code into a chunk the lazy ones can import from, leaving `bundle.<hash>.js` a
						// one-line facade and every boot one request longer.
						preserveEntrySignatures: 'allow-extension',
						output: { inlineDynamicImports: false },
					},
				},
			};
		},
		transform: {
			// Before Vite wraps each `import()` in its preload helper.
			order: 'pre',
			handler(code, id) {
				if (!active || !KIT_APP.test(id.split('?')[0])) return null;
				try {
					return { code: eagerRouteNodes(code), map: null };
				} catch (error) {
					this.error(error.message);
				}
			},
		},
	};
};
