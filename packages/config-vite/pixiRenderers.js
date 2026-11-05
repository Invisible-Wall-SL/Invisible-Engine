// Keep Pixi's WebGPU renderer out of a game build. Dependency-free, like `families.js`, so
// `pixiRenderers.fixture.mjs` can drive it without starting sveltekit()/lingui().
//
// `InitialiseApplication` asks for `preference: 'webgl'`, but `autoDetectRenderer` still reaches
// WebGPU when WebGL is unavailable, so its dynamic `import('./gpu/WebGPURenderer.mjs')` puts the
// whole WebGPU renderer in the bundle. The two imports below, taken only from that one file, are
// swapped: WebGPU detection answers `false`, so a device without WebGL falls through to the canvas
// renderer, and the WebGPU import is a module that is never loaded.

/** `pixi.js/lib/rendering/renderers/autoDetectRenderer.mjs`, wherever the package is installed. */
export const AUTO_DETECT_RENDERER =
	/[\\/]pixi\.js[\\/]lib[\\/]rendering[\\/]renderers[\\/]autoDetectRenderer\.mjs$/;

/** Each import `autoDetectRenderer.mjs` makes that is stubbed, and the stub's source. */
export const STUBBED_IMPORTS = Object.freeze({
	'../../utils/browser/isWebGPUSupported.mjs':
		'export const isWebGPUSupported = async () => false;',
	'./gpu/WebGPURenderer.mjs':
		"export class WebGPURenderer { constructor() { throw new Error('The WebGPU renderer is not in this build.'); } }",
});

const PREFIX = '\0ie-pixi-stub:';

export const noWebGpuRenderer = () => {
	const stubbed = new Set();
	let sawAutoDetect = false;
	return {
		name: 'ie-pixi-no-webgpu',
		apply: 'build',
		enforce: 'pre',
		buildStart() {
			stubbed.clear();
			sawAutoDetect = false;
		},
		resolveId(source, importer) {
			if (!importer || !AUTO_DETECT_RENDERER.test(importer.split('?')[0])) return null;
			sawAutoDetect = true;
			if (!Object.hasOwn(STUBBED_IMPORTS, source)) return null;
			stubbed.add(source);
			return PREFIX + source;
		},
		load(id) {
			return id.startsWith(PREFIX) ? STUBBED_IMPORTS[id.slice(PREFIX.length)] : null;
		},
		buildEnd(error) {
			if (error || !sawAutoDetect) return;
			const missed = Object.keys(STUBBED_IMPORTS).filter((s) => !stubbed.has(s));
			if (missed.length) {
				this.error(
					`pixi.js's autoDetectRenderer no longer imports ${missed.join(', ')}: ` +
						`update STUBBED_IMPORTS in packages/config-vite/pixiRenderers.js for this Pixi version.`,
				);
			}
		},
	};
};

/** `pixi.js/lib/environment-browser/browserExt.mjs`, wherever the package is installed. */
export const BROWSER_EXT = /[\\/]pixi\.js[\\/]lib[\\/]environment-browser[\\/]browserExt\.mjs$/;

/**
 * The dynamic imports Pixi makes on EVERY browser boot, by the file that makes them: the WebGL
 * renderer (`InitialiseApplication` asks for WebGL) and the browser environment (`browserAll`:
 * events, accessibility, DOM), which `autoDetectRenderer` loads before any renderer.
 */
export const EAGER_IMPORTS = Object.freeze([
	{ file: AUTO_DETECT_RENDERER, spec: './gl/WebGLRenderer.mjs' },
	{ file: BROWSER_EXT, spec: './browserAll.mjs' },
]);

/**
 * Keep those two in the bundle. A game build splits its dynamic imports into lazy chunks
 * (`lazyChunks.js`), so left alone each would be a chunk fetched only once Pixi starts: one round
 * trip after the bundle on every first visit, and a boot that waits on the network part-way through.
 * Under the current-games harness's stepped clock that wait cost every game 60–170 frames, which
 * shifted every time-based animation and changed screens. A static import is what the one-file build
 * did (it evaluated both with the bundle), so this keeps that exactly; the canvas fallback and the
 * WebGPU stub stay lazy.
 */
export const eagerPixiBoot = () => {
	let ssr = false;
	return {
		name: 'ie-pixi-eager-boot',
		apply: 'build',
		enforce: 'pre',
		configResolved(config) {
			ssr = Boolean(config.build.ssr);
		},
		transform(code, id) {
			if (ssr) return null;
			const file = id.split('?')[0];
			const wanted = EAGER_IMPORTS.filter((e) => e.file.test(file));
			if (!wanted.length) return null;
			let out = code;
			const statics = [];
			wanted.forEach(({ spec }, i) => {
				const call = `import('${spec}')`;
				if (!out.includes(call)) {
					this.error(
						`pixi.js's ${file} no longer makes ${call}: update EAGER_IMPORTS in ` +
							'packages/config-vite/pixiRenderers.js for this Pixi version.',
					);
				}
				const name = `__ieEager${i}`;
				out = out.replaceAll(call, `Promise.resolve(${name})`);
				statics.push(`import * as ${name} from '${spec}';`);
			});
			// At the end, where no existing line moves: an import is hoisted wherever it is written.
			return { code: `${out}\n${statics.join('\n')}\n`, map: null };
		},
	};
};
