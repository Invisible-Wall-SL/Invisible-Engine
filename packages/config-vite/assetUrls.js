import { posix } from 'node:path';

/**
 * Resolve an EMITTED asset's url from the chunk that imports it, in a build whose bundle is a
 * classic (`iife`) script — the default `bundleStrategy: 'inline'` game build.
 *
 * WHY. SvelteKit asks Vite for chunk-relative asset urls (`renderBuiltUrl` → `{ relative: true }`),
 * and for an `iife` chunk Vite's runtime for that is
 * `new URL('<path from the chunk>', document.currentScript.src || document.baseURI)`. Inlined, the
 * script has no `src`, so the path written relative to `_app/immutable/` is resolved against the
 * PAGE's folder: `libktx.<hash>.wasm` became `<page>/assets/…` instead of
 * `<page>/_app/immutable/assets/…` and 404'd. SvelteKit's own `import.meta.url` for the same chunk
 * already falls back correctly (`new URL('_app/immutable/bundle.<hash>.js', document.baseURI)`),
 * so this anchors asset urls exactly the way it does: the script's `src` when it has one, else the
 * chunk's own file under the page's folder. The `single` (embed) build is an ES module, keeps
 * Vite's `import.meta.url` runtime, and is left alone.
 *
 * Every other asset in a game build is inlined (`assetsInlineLimit`), so today this only reaches
 * the KTX2 transcoder — but it is right for any file the bundle stops inlining.
 *
 * `enforce: 'post'` so SvelteKit's config (which sets the output format and its own
 * `renderBuiltUrl`) is already merged in. Only an answer of SvelteKit's that is `{ relative: true }`
 * is re-anchored; anything else (CSS-hosted assets, `paths.relative: false`, SSR) is its answer,
 * unchanged.
 */
export const chunkAnchoredAssetUrls = () => ({
	name: 'ie:chunk-anchored-asset-urls',
	enforce: 'post',
	config(config) {
		const output = config.build?.rollupOptions?.output;
		if (config.build?.ssr || Array.isArray(output) || output?.format !== 'iife') return;
		const kit = config.experimental?.renderBuiltUrl;
		return {
			experimental: {
				renderBuiltUrl(filename, context) {
					const own = kit?.(filename, context);
					if (context.hostType !== 'js' || context.ssr || own?.relative !== true) return own;
					const fromChunk = JSON.stringify(posix.relative(posix.dirname(context.hostId), filename));
					const chunk = JSON.stringify(context.hostId);
					const script =
						'document.currentScript&&' +
						'document.currentScript.tagName.toUpperCase()==="SCRIPT"&&' +
						'document.currentScript.src';
					return {
						runtime: `new URL(${fromChunk},${script}||new URL(${chunk},document.baseURI).href).href`,
					};
				},
			},
		};
	},
});
