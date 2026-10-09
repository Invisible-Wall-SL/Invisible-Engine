import { getSupportedTextureFormats } from 'pixi.js';

/**
 * Make a `.ktx2` page transcode to ASTC, never BC7, on a device that supports both.
 *
 * Pixi's KTX2 worker picks the FIRST of `bc7 → astc-4x4 → etc2 → bc3 → rgba8` that the device
 * reports. Recent Apple GPUs expose BC7 (`EXT_texture_compression_bptc`) to Safari as well as their
 * native ASTC, so the newest iPhones take a path no older iPhone takes: an older one reports no BC7
 * and transcodes to ASTC. Owner-reported on `test6` (2026-10-09): flipbook symbols and FX drew as
 * solid black rectangles on the latest iPhones only. Desktop never sees it because it loads the
 * uncompressed pages (`preferCompressedTextures` in `apps/lines/src/editor-scenes.ts`).
 *
 * BC7 is a desktop format; ASTC 4×4 is the same 8 bits per pixel and is what the tile GPUs in
 * these phones are built around. So a device with ASTC transcodes to ASTC. A desktop GPU has no
 * ASTC and keeps BC7, unchanged.
 *
 * Pixi caches the format list as one array and hands the KTX2 worker that array at the worker's
 * first load, so this edits the cached array in place. It must run BEFORE the first `.ktx2` loads.
 */
export async function preferAstcForKtx2(): Promise<void> {
	if (!glHasAstc()) return;
	const formats = await getSupportedTextureFormats();
	if (!formats.includes('astc-4x4-unorm')) return;
	for (let i = formats.length - 1; i >= 0; i--) {
		if (formats[i].startsWith('bc')) formats.splice(i, 1);
	}
}

/** Cheap probe so a device without ASTC (every desktop) skips Pixi's WebGPU adapter request. */
function glHasAstc(): boolean {
	if (typeof document === 'undefined') return false;
	const gl = document.createElement('canvas').getContext('webgl');
	if (!gl) return false;
	const has = gl.getExtension('WEBGL_compressed_texture_astc') !== null;
	gl.getExtension('WEBGL_lose_context')?.loseContext();
	return has;
}
