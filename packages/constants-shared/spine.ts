/**
 * The natural size assumed for a spine that has no measurable one: no `skeleton.width/height` in the
 * export AND nothing for `getBounds` to see in any pose.
 *
 * That is not a hypothetical — it is exactly a CARRIER rig, whose only content is timeline-event FX
 * and Flipbook bindings. Those are events, not attachments, and the slots hosting them are empty, so
 * every measurement path returns 0 and the rig ships with no size at all.
 *
 * ONE number, because the two surfaces that hit this fallback used to disagree: the editor's
 * `measureSpineBounds` fitted a 100×100 box while the runtime's `spineSizeScale` gave up and left
 * the requested width/height unapplied at scale 1. The same rig then rendered at two different sizes
 * in /symbols and in the game, which read as a sizing bug in one of them rather than as the missing
 * bounds it actually was.
 *
 * Deliberately arbitrary and a LAST resort — the real fix is for the rig to carry bounds (the Rigger
 * writes them on save, and lets the author draw a frame when nothing is measurable). This only
 * guarantees that a rig which slips through unsized is wrong the SAME way everywhere, so the
 * disagreement can never hide the cause again.
 */
export const SPINE_FALLBACK_NATURAL_SIZE = 100;

/**
 * The `skeleton` header fields the Spine readers copy through UNSCALED. `x`/`y` come back
 * `undefined` — not `0` — when an export omits them: `SkeletonJson` assigns `skeletonMap.x` verbatim.
 */
export interface SpineBoxHeader {
	x?: number;
	y?: number;
	width: number;
	height: number;
}

export interface SpineBox {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * A skeleton's authored sizing box in skeleton (y-UP) coords, `x`/`y` its bottom-left corner.
 *
 * This is the rect every contain/cover fit measures against, and it is NOT always centred on the
 * origin: the Spine editor writes the setup-pose extent, and the Rigger writes either that or the
 * frame the author dragged (its Bounds box). Every consumer used to read only `width`/`height` and
 * ASSUME the box sat at `(-w/2, -h/2)` — true of every Spine-editor rig we ship, false for a Rigger
 * rig whose root sits at its feet. Such a rig had the right SIZE in the game and the wrong PLACE:
 * the game put the skeleton origin at the cell centre while the Rigger showed the box centre there,
 * so the frame the author drew could never be matched against what the board drew.
 *
 * `null` when the header has no positive size. A header with a size but no `x`/`y` keeps the
 * origin-centred reading, which is what such an export was authored against.
 */
export function authoredSpineBox(data: SpineBoxHeader): SpineBox | null {
	const { width, height } = data;
	if (!(width > 0) || !(height > 0)) return null;
	const x = typeof data.x === 'number' && Number.isFinite(data.x) ? data.x : -width / 2;
	const y = typeof data.y === 'number' && Number.isFinite(data.y) ? data.y : -height / 2;
	return { x, y, width, height };
}
