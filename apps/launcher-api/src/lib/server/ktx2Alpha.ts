/**
 * How a KTX2 twin stores alpha: PREMULTIPLIED, and named so the game knows it.
 *
 * Pixi marks a compressed texture straight-alpha and blends it with its `-npm` modes, which apply a
 * node's alpha twice — every translucent layer drew dimmer on the compressed tier. So every twin is
 * encoded premultiplied and carries {@link PREMULTIPLIED_KTX2_EXT} in its name, and the game
 * (`pixi-svelte` `ktx2AlphaMode.ts`) marks a texture with that name premultiplied. The NAME is the
 * contract because it travels through every reference to a page and because an older straight
 * twin keeps its plain `.ktx2` name. Full story: `docs/design/gpu-compressed-textures.md` § "Alpha".
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
 * property lines under it belong to that page. Case-sensitive, as `engine-rig`'s atlas reader is,
 * so the compressed and uncompressed tiers agree on which pages are premultiplied.
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
			if (page && /^\s*pma\s*:\s*true\s*$/.test(line)) out.add(page);
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
