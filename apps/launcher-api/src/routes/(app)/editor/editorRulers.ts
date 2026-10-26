import { normalizeEditorGuides, type EditorGuides } from 'engine-layout';

/** The rulers' thickness, in CSS pixels. */
export const RULER_PX = 18;
/** How close (screen px) the pointer must be to a guide to grab it. */
export const GUIDE_GRAB_PX = 4;
/** The fewest screen pixels between two labelled ruler ticks. */
const MIN_LABEL_GAP_PX = 60;

export type GuideAxis = 'x' | 'y';

/** The labelled tick spacing, in world pixels: the smallest 1 / 2 / 5 × 10ⁿ at least
 * {@link MIN_LABEL_GAP_PX} apart at `zoom`. */
export function rulerStep(zoom: number): number {
	const want = MIN_LABEL_GAP_PX / (zoom > 0 ? zoom : 1);
	let base = 10 ** Math.floor(Math.log10(want));
	for (;;) {
		for (const m of [1, 2, 5]) if (base * m >= want) return base * m;
		base *= 10;
	}
}

/** The world positions of the labelled ticks between `from` and `to`. */
export function rulerTicks(from: number, to: number, step: number): number[] {
	const out: number[] = [];
	if (!(step > 0) || !(to > from)) return out;
	for (let v = Math.ceil(from / step) * step; v <= to; v += step)
		out.push(Math.round(v * 1e6) / 1e6);
	return out;
}

/** The guide within {@link GUIDE_GRAB_PX} of a screen position, nearest first. */
export function hitGuide(
	guides: EditorGuides | undefined,
	world: { x: number; y: number },
	zoom: number,
): { axis: GuideAxis; index: number } | null {
	const tol = GUIDE_GRAB_PX / (zoom > 0 ? zoom : 1);
	let hit: { axis: GuideAxis; index: number } | null = null;
	let bestD = tol;
	for (const axis of ['x', 'y'] as const) {
		const list = guides?.[axis] ?? [];
		for (let index = 0; index < list.length; index++) {
			const d = Math.abs(list[index] - world[axis]);
			if (d <= bestD && (!hit || d < bestD)) {
				hit = { axis, index };
				bestD = d;
			}
		}
	}
	return hit;
}

/**
 * The guides after a drag: a new guide (`index` null) is added, a moved one replaced, and one
 * released over its ruler (`remove`) dropped. Canonicalized, so the result sorts and de-dupes.
 */
export function applyGuideDrag(
	guides: EditorGuides | undefined,
	drag: { axis: GuideAxis; index: number | null; value: number; remove: boolean },
): EditorGuides {
	const list = [...(guides?.[drag.axis] ?? [])];
	if (drag.index === null) {
		if (!drag.remove) list.push(drag.value);
	} else if (drag.remove) list.splice(drag.index, 1);
	else list[drag.index] = drag.value;
	const next = { ...guides, [drag.axis]: list };
	return normalizeEditorGuides({ layout: next })?.layout ?? {};
}
