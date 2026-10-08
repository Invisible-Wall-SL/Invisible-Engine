/**
 * The box a picked frame draws at, given the author's optional size overrides and the frame's
 * natural size. Both set ⇒ that box (the author asked for it, stretch and all). One set ⇒ the
 * other follows the frame's own ratio, so typing a width alone resizes the art without
 * distorting it. Neither ⇒ the frame's natural size. Unknown natural size (the texture is still
 * loading) ⇒ only what the author set, so the caller's own fallback applies.
 */
export function aspectBox(
	natural: { w: number; h: number } | null | undefined,
	width: number | undefined,
	height: number | undefined,
): { width: number | undefined; height: number | undefined } {
	const set = (v: number | undefined) => (v !== undefined && v > 0 ? v : undefined);
	const w = set(width);
	const h = set(height);
	if (w !== undefined && h !== undefined) return { width: w, height: h };
	if (!natural || !(natural.w > 0) || !(natural.h > 0)) return { width: w, height: h };
	if (w !== undefined) return { width: w, height: (w * natural.h) / natural.w };
	if (h !== undefined) return { width: (h * natural.w) / natural.h, height: h };
	return { width: natural.w, height: natural.h };
}
