/**
 * The stock asset table on a device's texture tier.
 *
 * On the compressed tier (`preferCompressedTextures`, `apps/lines/src/editor-scenes.ts`) a stock
 * rig, sheet or font whose pages have KTX2 twins loads its twin descriptor (`x.ktx2.atlas`,
 * `x.ktx2.json`, `x.ktx2.xml`, written by `scripts/check-stock-ktx2.mjs --write`), with the original
 * as the entry's `fallback`, which `AssetsLoader` loads if the twin fails. Every other entry, and
 * every entry on the uncompressed tier, is the table's own, so desktops load exactly what they did.
 *
 * `__IE_STOCK_TWINS__` (`config-vite` `stockTwins.js`) maps each descriptor the BUILD ships a twin
 * for, relative to the `assets/` root, to that twin: a game repo whose stock page is not the
 * engine's (its own art over the seed's file) ships no twin of it, and a build made outside
 * `config-vite` ships none.
 */

type StockEntry = { type: string; src: unknown; fallback?: unknown };

/** The descriptor an entry loads: a rig's atlas, else its `src`. */
const descriptorHref = (src: unknown): string | undefined =>
	typeof src === 'string'
		? src
		: typeof src === 'object' && src !== null && 'atlas' in src
			? String(src.atlas)
			: undefined;

/**
 * `table` with each entry whose descriptor has a twin in `twins` (descriptor → twin, both relative to
 * `base`) pointed at the twin and falling back to itself, on the compressed tier; `table` itself
 * otherwise.
 */
export function stockAssetsOnTier<T extends Record<string, StockEntry>>(
	table: T,
	twins: Readonly<Record<string, string>>,
	base: string,
	compressed: boolean,
): T {
	if (!compressed) return table;
	const out: Record<string, StockEntry> = { ...table };
	for (const [key, entry] of Object.entries(table)) {
		const href = descriptorHref(entry.src);
		if (!href?.startsWith(base)) continue;
		const twin = twins[decodeURIComponent(href.slice(base.length))];
		if (!twin) continue;
		const src =
			typeof entry.src === 'string'
				? `${base}${twin}`
				: { ...(entry.src as object), atlas: `${base}${twin}` };
		out[key] = { ...entry, src, fallback: entry.src };
	}
	return out as T;
}

/** The stock twins this build ships (`__IE_STOCK_TWINS__`); none in a build made without it. */
export const shippedStockTwins = (): Readonly<Record<string, string>> =>
	typeof __IE_STOCK_TWINS__ === 'object' && __IE_STOCK_TWINS__ ? __IE_STOCK_TWINS__ : {};
