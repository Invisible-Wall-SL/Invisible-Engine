/**
 * RULER GUIDES — the editor-only lines an author drags off the Scene / Component Editor's rulers
 * to lay out a play field or a board precisely (game-families §5.2 "Rulers and guides", P10.9).
 *
 * Saved with the screen (`Scene.guides`) or the component (`ComponentDef.guides`), so they come
 * back with it and undo with it, and kept per DEVICE LAYOUT: a guide is a position in the canvas's
 * world (window-frame) pixels, and a desktop frame and a portrait one put the same pixel in
 * different places. Nothing in the engine reads them; every path that hands a doc or a def to a
 * game strips them (`withoutEditorGuides`), so they never reach a bundle.
 */
import type { LayoutType } from './types';

/** One layout's guides: `x` are vertical lines (at an x), `y` horizontal ones (at a y). */
export interface EditorGuides {
	x?: number[];
	y?: number[];
}

/** Guides per device layout. */
export type EditorGuideSet = Partial<Record<LayoutType, EditorGuides>>;

/** At most this many guides on one axis of one layout. */
export const MAX_GUIDES_PER_AXIS = 64;

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

/** Finite positions, rounded to a hundredth, de-duplicated, sorted, capped. */
function normalizeAxis(raw: unknown): number[] | undefined {
	if (!Array.isArray(raw)) return undefined;
	const out = new Set<number>();
	for (const v of raw) {
		if (typeof v !== 'number' || !Number.isFinite(v)) continue;
		out.add(Math.round(v * 100) / 100);
		if (out.size >= MAX_GUIDES_PER_AXIS) break;
	}
	return out.size ? [...out].sort((a, b) => a - b) : undefined;
}

/**
 * Canonicalize a stored guide set, or `undefined` when it holds no guide (so an untouched screen
 * or component saves exactly as before). Idempotent.
 */
export function normalizeEditorGuides(raw: unknown): EditorGuideSet | undefined {
	if (!isRecord(raw)) return undefined;
	const out: EditorGuideSet = {};
	for (const [layout, value] of Object.entries(raw)) {
		if (!layout || !isRecord(value)) continue;
		const x = normalizeAxis(value.x);
		const y = normalizeAxis(value.y);
		if (!x && !y) continue;
		out[layout] = { ...(x ? { x } : {}), ...(y ? { y } : {}) };
	}
	return Object.keys(out).length ? out : undefined;
}

/** A shallow copy without `guides` — what a game is handed. Without guides, the same object. */
export function withoutEditorGuides<T extends { guides?: EditorGuideSet }>(item: T): T {
	if (!('guides' in item)) return item;
	const copy = { ...item };
	delete copy.guides;
	return copy;
}
