/**
 * Which cells of a reel strip a new strip is laid above when a spin takes over — the ones that can
 * be on screen — and where the first of them is drawn.
 *
 * A strip cell `i` sits at `reelY + i * pitch`; at rest the strip starts at `homeY`, its first cell
 * being the padding row above the window. The cells kept are those from the first one at or below
 * that resting top seat (a half pitch of slack), so at rest it is the whole strip at `homeY`, and at
 * the end of a pre-spin lap — the new lap laid wholly above the window — it is the lap on screen,
 * at `homeY`. Anything dropped was above the window.
 */
export const onScreenTail = <T>(
	strip: readonly T[],
	reelY: number,
	homeY: number,
	pitch: number,
) => {
	const first = Math.max(0, Math.ceil((homeY - pitch / 2 - reelY) / pitch));
	return { tail: strip.slice(first), tailY: reelY + first * pitch };
};

/** The reel Y that keeps a tail first drawn at `tailY` in place once `added` cells sit above it. */
export const reelYAbove = (tailY: number, added: number, pitch: number) => tailY - added * pitch;
