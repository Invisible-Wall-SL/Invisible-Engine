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
 * IMPORTANT constraints (validated empirically):
 *  - The encoder has a ~12 Mpix HARD CAP and throws above it. We do NOT downscale (that
 *    would desync the atlas frame rects), so a page above {@link MAX_ENCODE_PIXELS} is
 *    SKIPPED (returns null → the caller ships the WebP/PNG unchanged).
 *  - Tiny pages aren't worth the encode/download cost, so pages below
 *    {@link MIN_ENCODE_PIXELS} are skipped too.
 *  - `encode()` is a SYNCHRONOUS wasm call that blocks the event loop for its full run.
 *    Callers MUST encode sequentially (never concurrently — heaps stack) and gate the
 *    whole step behind an opt-in (`ENV.KTX2_ENCODE`) so a normal bake is unaffected.
 *  - The wasm prints progress to stdout unconditionally; we silence stdout for the call.
 *
 * Any failure (oversized, decode error, encoder throw) returns null — a missing KTX2 twin
 * degrades to the existing WebP/PNG, never a broken build.
 */
import sharp from 'sharp';
import { encodeToKTX2 } from 'ktx2-encoder';

/** Below this source area, the encode/download cost isn't worth it — ship the WebP/PNG. */
export const MIN_ENCODE_PIXELS = 1_000_000;
/** The bundled Basis v2.5 encoder rejects sources above ~12 Mpix; stay safely under it.
 *  A page this large is the real problem (re-author the atlas smaller) — we skip it here. */
export const MAX_ENCODE_PIXELS = 12_000_000;

/** `sharp` decoder the encoder calls to turn compressed page bytes into raw RGBA (the
 *  encoder requires this in Node for LDR inputs). Mirrors the raw-buffer decode in
 *  `spine.ts` (`sharp(input).ensureAlpha().raw()`). */
async function decodeToRgba(
	buffer: Uint8Array,
): Promise<{ width: number; height: number; data: Uint8Array }> {
	const { data, info } = await sharp(Buffer.from(buffer))
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	return { width: info.width, height: info.height, data };
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

/**
 * Encode a page to KTX2 bytes, or return null when it should be skipped (too small, too
 * large, or anything throws). The caller writes the returned bytes beside the WebP/PNG and
 * records the variant in the art index; a null return means "no KTX2 twin — parity".
 */
export async function encodePageToKtx2(pageBytes: Uint8Array): Promise<Uint8Array | null> {
	try {
		// Cheap dimension read first, so an oversized page never reaches the encoder's cap
		// and a sub-threshold page never pays the encode cost.
		const meta = await sharp(Buffer.from(pageBytes)).metadata();
		const width = meta.width ?? 0;
		const height = meta.height ?? 0;
		const pixels = width * height;
		if (pixels < MIN_ENCODE_PIXELS || pixels > MAX_ENCODE_PIXELS) return null;

		const ktx2 = await withSilencedStdout(() =>
			encodeToKTX2(pageBytes, {
				isUASTC: true, // UASTC LDR — near-lossless, transcodes to ASTC/BC7
				uastcLDRQualityLevel: 1, // validated sweet spot (0–3)
				needSupercompression: true, // UASTC + Zstd — ~3× smaller download, no quality cost
				isKTX2File: true, // .ktx2 container (not .basis)
				isPerceptual: true, // sRGB albedo/photo content
				isSetKTX2SRGBTransferFunc: true,
				generateMipmap: true,
				imageDecoder: decodeToRgba,
			}),
		);
		return ktx2.byteLength > 0 ? ktx2 : null;
	} catch {
		// Oversized/unsupported/encoder failure ⇒ no twin ⇒ the WebP/PNG ships (parity).
		return null;
	}
}
