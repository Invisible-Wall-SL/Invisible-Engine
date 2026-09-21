/** Parse a `#rrggbb` hex string into a `0xRRGGBB` MULTIPLY tint number (a Pixi `ColorSource`).
 *  Returns undefined for an absent/blank/malformed value, letting a caller fall through to
 *  "no tint" — `#rrggbb` maps directly to the number, so `parseInt(base 16)` is exact. */
export const hexToTintNumber = (hex: string | undefined): number | undefined => {
	if (!hex) return undefined;
	const n = parseInt(hex.replace(/^#/, ''), 16);
	return Number.isNaN(n) ? undefined : n;
};
