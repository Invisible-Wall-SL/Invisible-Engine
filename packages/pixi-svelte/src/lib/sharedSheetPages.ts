import { copySearchParams, path, spritesheetAsset, type Loader, type Texture } from 'pixi.js';

/**
 * Load a sprite sheet's page under its NORMALIZED url, so a page several sheets and rigs share is
 * one texture.
 *
 * Pixi's spritesheet parser loads `dirname(json) + meta.image` as written, and its loader caches by
 * that string. A launcher sheet names its page in the shared store relatively —
 * `../../_pages/<hash>.webp` (`apps/launcher-api` `pageStore.ts`) — so every sheet folder spelt the
 * same page differently, and a rig's atlas loader (which joins and so normalizes) spelt it a third
 * way. Each spelling was its own fetch, decode and GPU texture. Measured on `overlay-buffaloduel`
 * (2026-11-03): the symbol export's copy of `S_StaticElements` beside the editor-art one, and four
 * pages a sheet shares with a rig, loaded twice — 43 MB of duplicate textures on desktop.
 *
 * Joining here gives the url the rig loader already uses. A page loaded both ways keeps the alpha
 * handling it always had: a sheet and a straight rig page both premultiply on upload. A sheet
 * handed a `texture` is parsed as before.
 */
let installed = false;

type SheetData = { texture?: unknown; imageFilename?: string; textureOptions?: unknown };
type SheetParse = (
	asset: { meta?: { image?: string } },
	options: { src: string; data?: SheetData },
	loader: Loader,
) => Promise<unknown>;

export function shareSheetPages(): void {
	if (installed) return;
	installed = true;
	const parser = spritesheetAsset.loader as unknown as { parse: SheetParse };
	const parse = parser.parse.bind(parser);
	parser.parse = async (asset, options, loader) => {
		const data = options?.data ?? {};
		const image = data.imageFilename ?? asset?.meta?.image;
		if (data.texture || !image || !options?.src || !loader) return parse(asset, options, loader);
		const src = copySearchParams(path.join(path.dirname(options.src), image), options.src);
		const texture = await loader.load<Texture>({ src, data: data.textureOptions as object });
		return parse(asset, { ...options, data: { ...data, texture } }, loader);
	};
}
