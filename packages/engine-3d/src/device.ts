import type { Gpu3d } from './pure/tier';

/**
 * The GPU signals the tier chooser reads (`pure/tier.ts`), from a throwaway WebGL2 context made and
 * lost at once, before the world's renderer exists (MSAA, which the tier decides, is a context
 * attribute). Never `navigator.deviceMemory`: browsers hide or alter it (runtime eval §5.1 point 4).
 */
export function readGpu3d(): Gpu3d {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = 1;
	const gl = canvas.getContext('webgl2', { antialias: false, depth: false });
	if (!gl) return { astc: false, bc7: false, s3tc: false, etc2: false, maxTextureSize: 0 };
	const has = (name: string) => gl.getExtension(name) !== null;
	const debug = gl.getExtension('WEBGL_debug_renderer_info');
	const renderer: unknown = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
	const gpu: Gpu3d = {
		astc: has('WEBGL_compressed_texture_astc'),
		bc7: has('EXT_texture_compression_bptc'),
		s3tc: has('WEBGL_compressed_texture_s3tc'),
		etc2: has('WEBGL_compressed_texture_etc'),
		maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)) || 0,
		...(typeof renderer === 'string' && renderer ? { renderer } : {}),
	};
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return gpu;
}

/** Where the player's Graphics setting is kept (per browser). */
export const GRAPHICS_SETTING_KEY = 'ie.graphics3d';

/** Keep the player's Graphics setting (`auto` clears it); false when storage is unavailable. */
export function writeGraphicsSetting(value: string): boolean {
	try {
		if (value === 'auto') localStorage.removeItem(GRAPHICS_SETTING_KEY);
		else localStorage.setItem(GRAPHICS_SETTING_KEY, value);
		return true;
	} catch {
		return false;
	}
}

/** The player's Graphics setting, or `null` (none, or storage unavailable). */
export function readGraphicsSetting(): string | null {
	try {
		return localStorage.getItem(GRAPHICS_SETTING_KEY);
	} catch {
		return null;
	}
}
