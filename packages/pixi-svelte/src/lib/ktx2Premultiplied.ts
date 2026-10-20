/**
 * The name the launcher gives a PREMULTIPLIED KTX2 twin — `apps/launcher-api` `ktx2Alpha.ts`
 * `PREMULTIPLIED_KTX2_EXT`, which writes it; `check:ktx2-premultiplied` asserts the two agree.
 *
 * Pure (no Pixi import) so that guard can read it in Node.
 */
const PREMULTIPLIED_KTX2 = /\.pm\.ktx2(?:[?#]|$)/i;

/** True for a twin whose bytes are premultiplied. A plain `.ktx2` predates the convention and is
 *  straight alpha. */
export function isPremultipliedKtx2(url: string): boolean {
	return PREMULTIPLIED_KTX2.test(url);
}
