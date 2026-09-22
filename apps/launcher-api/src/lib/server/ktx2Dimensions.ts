/**
 * What size a page gets encoded at, as pure arithmetic.
 *
 * Split out of `ktx2Encode.ts` so it can be driven by a guard (`scripts/check-ktx2-alignment.mjs`)
 * without importing `sharp` and the Basis wasm encoder — the rule below is the part that can be
 * wrong, and it needs to be checkable in milliseconds rather than behind a real encode.
 */

/** Below this source area, the encode/download cost isn't worth it — ship the WebP/PNG. */
export const MIN_ENCODE_PIXELS = 1_000_000;
/** Stay safely under the bundled Basis v2.5 encoder's ~12 Mpix hard cap (a page over it is
 *  downscaled to fit, not skipped). */
export const MAX_ENCODE_PIXELS = 11_000_000;
/** Cap the longest side of the COMPRESSED variant. 4096 clears both the encoder's Mpix cap
 *  and every iPhone GPU's `MAX_TEXTURE_SIZE` (4096 even on older A-series). Pages at or under
 *  this ship at full resolution; only larger ones (e.g. a 4096×8096 cinematic) downscale. */
export const DEFAULT_MAX_DIMENSION = 4096;

/**
 * The block size every transcode target uses. BC7, ASTC 4×4 and ETC2 all store pixels in 4×4
 * blocks, so a texture dimension that is not a multiple of 4 has no valid encoding.
 *
 * THIS IS NOT COSMETIC. A page encoded at a non-multiple-of-4 size uploads without error and
 * samples as FULLY BLACK — no exception, no console warning, nothing in the network tab. Measured
 * on the Book of Borut build: at the compressed tier the three pages whose dimensions were not
 * 4-aligned (`1851×2800` = R_Board, and `3250×2048` shared by the UI sheet and every UI button
 * rig) rendered black, while every 4-aligned page on the same board rendered correctly. That is
 * the reel interior, the panel frames and the entire bottom button bar, gone on exactly the tier
 * phones get — and indistinguishable from "the art failed to load" from the outside.
 */
export const BLOCK = 4;

/**
 * Bump this whenever a change here would produce DIFFERENT bytes for the same source page.
 *
 * `PageStore` content-addresses a page by its source ETag+size, so an already-encoded twin is
 * reused without re-encoding — which is what keeps the per-boot runtime assemble fast. That cache
 * is keyed on the SOURCE, though, and knows nothing about the encoder, so fixing a bug in here
 * would otherwise leave every previously-encoded project serving the broken twin forever. Exactly
 * that applied to the 4-alignment fix: the art had not changed, so nothing would have re-encoded.
 *
 * 1 → 2: dimensions are floored to whole 4×4 blocks on BOTH the downscale and the pass-through
 *        path (was: multiple of 2, downscale path only), so unaligned pages stop decoding black.
 */
export const KTX2_ENCODER_REVISION = 2;

/** Round DOWN to a whole block. Down rather than up because every referencing atlas/sheet rescales
 *  its coordinates to the dimensions we REPORT (`toTexturePackerJson(sx, sy)` /
 *  `rewriteAtlasForKtx2`), so losing ≤3 px off an edge is absorbed exactly, whereas padding would
 *  invent pixels inside the UV range and smear the last row/column of every edge region. */
export const alignDown = (n: number) => Math.max(BLOCK, Math.floor(n / BLOCK) * BLOCK);

/**
 * The dimensions a page will be encoded at: the source size, uniformly downscaled so the longest
 * side ≤ `maxDimension` AND the area ≤ {@link MAX_ENCODE_PIXELS}, then floored to whole 4×4 blocks.
 *
 * The alignment applies on BOTH paths, which is the bug this replaced: it used to run only when the
 * page was being downscaled, and it rounded to a multiple of 2 rather than 4. So a page small
 * enough to need no downscale kept its raw dimensions — and `3250` is even, which the old rule
 * accepted, but `3250 / 4 = 812.5`, which the GPU does not.
 */
export function targetSize(
	width: number,
	height: number,
	maxDimension: number = DEFAULT_MAX_DIMENSION,
): { width: number; height: number; scale: number } {
	const byDim = Math.min(1, maxDimension / Math.max(width, height));
	const byArea = Math.min(1, Math.sqrt(MAX_ENCODE_PIXELS / (width * height)));
	const scale = Math.min(byDim, byArea);
	const w = alignDown(scale >= 1 ? width : width * scale);
	const h = alignDown(scale >= 1 ? height : height * scale);
	return { width: w, height: h, scale };
}
