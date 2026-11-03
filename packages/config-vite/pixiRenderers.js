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
