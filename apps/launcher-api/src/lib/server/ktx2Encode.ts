/**
 * Encode a packed atlas PAGE to a GPU-compressed KTX2 (Basis Universal, UASTC) twin.
 *
 * Why: shipped WebP/PNG pages decode to full RGBA in VRAM (a 2048×4096 page = 32 MB),
 * and a handful of background/UI pages blow past iOS Safari's per-tab memory cap →
 * the WebContent process is jettisoned ("A problem repeatedly occurred"). A KTX2/Basis
 * page stays compressed into VRAM (the loader transcodes it to the device-native
 * ASTC/ETC2/BC), cutting texture memory 4–8× at the SAME resolution. See
 * `docs/design/gpu-compressed-textures.md` and the runtime loader in
 * `pixi-svelte/InitialiseApplication.svelte`.
 *
 * Encoder: `ktx2-encoder` (bundles the Binomial `basis_encoder.wasm`; runs in Node with
 * no browser globals). UASTC q1 + Zstd supercompression + mipmaps is the validated sweet
 * spot: ~9 s and ~3.5 MB for a 2048×4096 page, ~345 MB peak RSS. ETC1S is smaller on disk
 * but visibly lossy AND peaks ~940 MB (a launcher OOM risk — `gotcha_bake_export_502_launcher_oom`),
 * so UASTC only.
 *
 * Auto-downscale: a page whose longest side exceeds {@link DEFAULT_MAX_DIMENSION} (or whose
 * area exceeds the encoder's ~12 Mpix cap) is DOWNSCALED (uniform, aspect-preserving) before
 * encoding — the pipeline resizes it so the caller never has to. The result reports the new
 * dimensions so the caller can rescale the matching atlas/sheet coordinates (same UVs ⇒ no
 * misalignment). The 4096 cap also keeps every page within iPhone GPUs' max-texture-size.
 *
 * IMPORTANT constraints (validated empirically):
 *  - The encoder has a ~12 Mpix HARD CAP and throws above it — we downscale to fit, not skip.
 *  - Tiny pages aren't worth the encode/download cost, so pages below
 *    {@link MIN_ENCODE_PIXELS} are skipped (returns null → the caller ships the WebP/PNG).
 *  - `encode()` is a SYNCHRONOUS wasm call that blocks the event loop for its full run.
 *    Callers MUST encode sequentially (never concurrently — heaps stack) and gate the
 *    whole step behind an opt-in (`ENV.KTX2_ENCODE`) so a normal bake is unaffected.
 *  - The wasm prints progress to stdout unconditionally; we silence stdout for the call.
 *
 * Any failure (decode error, encoder throw) returns null — a missing KTX2 twin degrades to
 * the existing WebP/PNG, never a broken build.
 */
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

/** Below this source area, the encode/download cost isn't worth it — ship the WebP/PNG. */
export const MIN_ENCODE_PIXELS = 1_000_000;
/** Stay safely under the bundled Basis v2.5 encoder's ~12 Mpix hard cap (a page over it is
 *  downscaled to fit, not skipped). */
export const MAX_ENCODE_PIXELS = 11_000_000;
/** Cap the longest side of the COMPRESSED variant. 4096 clears both the encoder's Mpix cap
 *  and every iPhone GPU's `MAX_TEXTURE_SIZE` (4096 even on older A-series). Pages at or under
 *  this ship at full resolution; only larger ones (e.g. a 4096×8096 cinematic) downscale. */
export const DEFAULT_MAX_DIMENSION = 4096;

/** The dimensions a page will be encoded at: the source size, uniformly downscaled so the
 *  longest side ≤ `maxDimension` AND the area ≤ {@link MAX_ENCODE_PIXELS}. */
function targetSize(
	width: number,
	height: number,
	maxDimension: number,
): { width: number; height: number; scale: number } {
	const byDim = Math.min(1, maxDimension / Math.max(width, height));
	const byArea = Math.min(1, Math.sqrt(MAX_ENCODE_PIXELS / (width * height)));
	const scale = Math.min(byDim, byArea);
	if (scale >= 1) return { width, height, scale: 1 };
	// Round to even so ASTC 4×4 blocks (and any half-pixel atlas coords) stay clean.
	const w = Math.max(2, Math.round((width * scale) / 2) * 2);
	const h = Math.max(2, Math.round((height * scale) / 2) * 2);
	return { width: w, height: h, scale };
}

/** `sharp` decoder the encoder calls to turn compressed page bytes into raw RGBA (the encoder
 *  requires this in Node for LDR inputs), resizing to `target` when the page is being
 *  downscaled. Mirrors the raw-buffer decode in `spine.ts`. */
function makeDecoder(target: { width: number; height: number } | null) {
	return async (buffer: Uint8Array): Promise<{ width: number; height: number; data: Uint8Array }> => {
		let pipeline = sharp(Buffer.from(buffer)).ensureAlpha();
		if (target) pipeline = pipeline.resize(target.width, target.height, { fit: 'fill' });
		const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
		return { width: info.width, height: info.height, data };
	};
}

/** Run `fn` with stdout writes swallowed — the Basis wasm prints per-slice progress to
 *  stdout on every encode regardless of any debug flag, which would flood Railway logs. */
async function withSilencedStdout<T>(fn: () => Promise<T>): Promise<T> {
	const originalWrite = process.stdout.write.bind(process.stdout);
	// Swallow everything the encoder prints; keep the return contract of write() intact.
	process.stdout.write = (() => true) as typeof process.stdout.write;
	try {
		return await fn();
	} finally {
		process.stdout.write = originalWrite;
	}
}

/** The encoded KTX2 twin + the dimensions it was encoded at (≤ source, if it was downscaled).
 *  Callers rescale the matching atlas/sheet coords by `width/srcWidth`, `height/srcHeight`. */
export interface EncodedKtx2 {
	bytes: Uint8Array;
	width: number;
	height: number;
}

/**
 * Encode a page to a KTX2 twin, auto-downscaling it (uniform) so the longest side ≤
 * `maxDimension` and the area ≤ the encoder cap. Returns the bytes + the encoded dimensions
 * (so the caller can rescale the atlas/sheet coords), or null when the page is too small to
 * bother or anything throws (→ the caller ships the WebP/PNG, parity).
 */
export async function encodePageToKtx2(
	pageBytes: Uint8Array,
	opts: { mipmaps?: boolean; maxDimension?: number } = {},
): Promise<EncodedKtx2 | null> {
	try {
		// Cheap dimension read first, so a sub-threshold page never pays the encode cost and
		// we know how much (if at all) to downscale.
		const meta = await sharp(Buffer.from(pageBytes)).metadata();
		const width = meta.width ?? 0;
		const height = meta.height ?? 0;
		if (width * height < MIN_ENCODE_PIXELS) return null;

		const target = targetSize(width, height, opts.maxDimension ?? DEFAULT_MAX_DIMENSION);
		const resize = target.scale < 1 ? { width: target.width, height: target.height } : null;

		const ktx2 = await withSilencedStdout(() =>
			encodeToKTX2(pageBytes, {
				isUASTC: true, // UASTC LDR — near-lossless, transcodes to ASTC/BC7
				uastcLDRQualityLevel: 1, // validated sweet spot (0–3)
				needSupercompression: true, // UASTC + Zstd — ~3× smaller download, no quality cost
				isKTX2File: true, // .ktx2 container (not .basis)
				isPerceptual: true, // sRGB albedo/photo content
				isSetKTX2SRGBTransferFunc: true,
				// Mipmaps OFF by default: a 2D slot game draws art near 1:1, so the mip chain
				// mostly adds ~33% VRAM + transcode cost for little gain — exactly what the
				// low-memory (iOS) tier wants to avoid.
				generateMipmap: opts.mipmaps ?? false,
				imageDecoder: makeDecoder(resize),
			}),
		);
		return ktx2.byteLength > 0 ? { bytes: ktx2, width: target.width, height: target.height } : null;
	} catch {
		// Decode/encoder failure ⇒ no twin ⇒ the WebP/PNG ships (parity).
		return null;
	}
}
