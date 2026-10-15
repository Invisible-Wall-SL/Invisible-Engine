import { loadKTX2, type Texture } from 'pixi.js';
import { isPremultipliedKtx2 } from './ktx2Premultiplied';

/**
 * Make a premultiplied `.ktx2` page blend exactly as its PNG does.
 *
 * Pixi's KTX2 loader marks every texture `no-premultiply-alpha`, and Pixi answers that with its
 * `-npm` blends, which apply a node's alpha on top of the batch shader's — a layer at opacity α drew
 * at α² on the compressed tier. The launcher now encodes twins premultiplied and names them
 * `.pm.ktx2`; this marks such a texture `premultiplied-alpha`. A page its rig atlas declares
 * `pma: true` (the loader's `data.alphaMode`) gets the same whatever its name, since its bytes
 * always were premultiplied. A plain straight `.ktx2` is left as Pixi made it. See
 * `docs/design/gpu-compressed-textures.md` § "Alpha".
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
