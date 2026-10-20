/**
 * The cubic `ease` value helpers for Svelte ease editors (the state machine's transition blend,
 * Rive plan Phase 9c). They match the Timeline module's own (`timeline.js` `parseCubic` /
 * `cubicText` / `DEFAULT_CUBIC`), which stays import-free because `/rigger` loads it as a static
 * file; `check:component-state-machine-editor` pins their results.
 */

export type Cubic = [number, number, number, number];

/** Where the Cubic button starts: CSS `ease-in-out`. */
export const DEFAULT_CUBIC: Cubic = [0.42, 0, 0.58, 1];

/** A handle value as the editor rounds it. */
export const n3 = (n: number): number => +n.toFixed(3);

/** `x1, y1, x2, y2` as the typed field shows it, each to three decimals. */
export const cubicText = (c: readonly number[]): string => c.map(n3).join(', ');

/** `x1, y1, x2, y2` typed by an author, x clamped to [0, 1]; null when it is not four numbers. */
export function parseCubic(text: string): Cubic | null {
	const parts = String(text || '')
		.split(/[\s,]+/)
		.filter(Boolean)
		.map(Number);
	if (parts.length !== 4 || !parts.every(Number.isFinite)) return null;
	const clamp01 = (n: number): number => Math.min(Math.max(n, 0), 1);
	return [clamp01(parts[0]), parts[1], clamp01(parts[2]), parts[3]];
}
