import { loadKTX2, type Texture } from 'pixi.js';
import { isPremultipliedKtx2 } from './ktx2Premultiplied';

/**
 * Make a premultiplied `.ktx2` page blend exactly as its PNG does.
 *
 * Pixi's KTX2 loader marks every texture it makes `no-premultiply-alpha`, and Pixi answers that by
 * switching the node's blend to its `-npm` variant (`add` → `SRC_ALPHA, ONE`). The batch shader has
 * already multiplied the colour by the node's alpha, so the `-npm` blend applies it twice: a glow at
 * 50% opacity, or a fading particle, drew at 25% — on the compressed tier only, which is every phone.
 * Owner-reported 2026-10-15 as a pink backdrop glow missing on a Pixel and present with
 * `?quality=high`.
 *
 * The launcher now encodes every twin premultiplied and names it `.pm.ktx2`; this marks such a
 * texture `premultiplied-alpha`, which keeps the normal blends and skips any upload premultiply. A
 * page its atlas declares `pma: true` gets the same, whatever its name: its bytes always were
 * premultiplied, and the rig atlas loader passes that as `data.alphaMode`. A plain straight `.ktx2`
 * from an older export is left as Pixi made it.
 */
let installed = false;

export function honourPremultipliedKtx2(): void {
	if (installed) return;
	installed = true;
	const load = loadKTX2.load.bind(loadKTX2);
	loadKTX2.load = async (url, asset, loader) => {
		const result = await load(url, asset, loader);
		if (isPremultipliedKtx2(url) || asset?.data?.alphaMode === 'premultiplied-alpha') {
			for (const texture of ([] as Texture[]).concat(result)) {
				texture.source.alphaMode = 'premultiplied-alpha';
			}
		}
		return result;
	};
}
