/**
 * How a KTX2 twin stores alpha: PREMULTIPLIED, and named so the game knows it.
 *
 * Pixi's KTX2 loader marks every compressed texture as STRAIGHT alpha (compressed blocks cannot be
 * premultiplied on upload the way a PNG is), and Pixi answers a straight texture by switching its
 * blend to the `-npm` variants (`add` → `SRC_ALPHA, ONE`). Its batch shader has ALREADY multiplied
 * the colour by the node's alpha, so that blend applies the alpha a second time: a glow at 50%
 * opacity, or a fading particle, drew at 25% on the compressed tier only. Owner-reported 2026-10-15:
 * a pink backdrop glow missing on a Pixel and present wherever the PNGs loaded (`?quality=high`).
 *
 * So every twin is encoded premultiplied, and carries {@link PREMULTIPLIED_KTX2_EXT} in its name.
 * The game's KTX2 loader (`pixi-svelte` `ktx2TranscodeTarget.ts`) marks a texture with that name as
 * premultiplied, so it takes exactly the blend path a PNG takes. The NAME is the contract, not a
 * flag beside it, because it travels through every way a page is referenced — a spritesheet's
 * `meta.image`, a rig atlas page line, a standalone image's `src` — and because a twin encoded
 * before this keeps its plain `.ktx2` name and its old (straight) treatment, so a game never reads
 * one convention with the other's bytes.
 *
 * Pure (no `sharp`, no R2) so `scripts/check-ktx2-premultiplied.mjs` can drive it directly.
 */

/** The twin suffix that means "these bytes are premultiplied". `pixi-svelte`'s
 *  `isPremultipliedKtx2` matches the same string; the guard asserts the two agree. */
export const PREMULTIPLIED_KTX2_EXT = '.pm.ktx2';

/** Multiply each pixel's RGB by its alpha, in place — the same 8-bit premultiply the browser
 *  applies to a PNG on upload, so a twin and its PNG reach the blend as the same numbers. */
export function premultiplyRgba(data: Uint8Array): void {
	for (let i = 0; i < data.length; i += 4) {
		const a = data[i + 3];
		if (a === 255) continue;
		data[i] = Math.round((data[i] * a) / 255);
		data[i + 1] = Math.round((data[i + 1] * a) / 255);
		data[i + 2] = Math.round((data[i + 2] * a) / 255);
	}
}

/**
 * The pages of a rig atlas that declare `pma: true` — their bytes are ALREADY premultiplied (a
 * Spine export with "Premultiply alpha" on), so their twin is encoded as-is rather than
 * premultiplied twice. Same structural model as `rig.ts` `atlasPageNames`: a page block starts at
 * the file start or after a blank line, its first non-property line is the page image, and the
 * property lines under it belong to that page.
 */
export function atlasPremultipliedPages(atlasText: string): Set<string> {
	const out = new Set<string>();
	let expectPage = true;
	let page: string | null = null;
	for (const line of atlasText.split(/\r?\n/)) {
		if (line.trim() === '') {
			expectPage = true;
			page = null;
			continue;
		}
		if (/^\s/.test(line) || line.includes(':')) {
			expectPage = false;
			if (page && /^\s*pma\s*:\s*true\s*$/i.test(line)) out.add(page);
			continue;
		}
		if (expectPage) {
			expectPage = false;
			page = line.trim();
			continue;
		}
		page = null; // a region name — the page's own property lines are over
	}
	return out;
}
