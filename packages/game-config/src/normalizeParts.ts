/**
 * The field normalizers more than one block of the doc needs: the top level and a spins bonus mode
 * (`./spinsGame`) both read a paytable, paylines and per-reel rows the same way.
 */

import type { PaytableRow, Paylines } from './types';

export const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === 'object' && v !== null && !Array.isArray(v);

export const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** A `#rgb` / `#rrggbb` hex colour, expanded to the canonical 6-digit lower-case form. Anything
 *  else is dropped — a malformed colour must not reach the renderer, where it would throw. */
export const hexColor = (v: unknown): string | undefined => {
	const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
	if (!s) return undefined;
	if (/^#[0-9a-f]{6}$/.test(s)) return s;
	if (/^#[0-9a-f]{3}$/.test(s)) return `#${[...s.slice(1)].map((c) => c + c).join('')}`;
	return undefined;
};

/** A count/index: a finite non-negative integer. */
export const count = (v: unknown): number | undefined => {
	const n = num(v);
	return n !== undefined && Number.isInteger(n) && n >= 0 ? n : undefined;
};

/**
 * One paytable row. A multi-key object (`{ '5': 20, '4': 10 }`) is SPLIT into one row per key
 * rather than rejected: the math export writes single-entry rows, but a hand-written or
 * tool-emitted config reasonably writes one object, and both mean the same thing.
 */
export const normalizePaytable = (raw: unknown): PaytableRow[] | undefined => {
	if (!Array.isArray(raw)) return undefined;
	const rows: PaytableRow[] = [];
	for (const entry of raw) {
		if (!isObject(entry)) continue;
		for (const [key, payout] of Object.entries(entry)) {
			const occurrences = count(Number(key));
			const pays = num(payout);
			// A zero-occurrence row pays for nothing and a non-numeric payout cannot be rendered.
			if (!occurrences || pays === undefined) continue;
			rows.push({ [String(occurrences)]: pays });
		}
	}
	// Ascending by occurrence count so the paytable renders in a stable order regardless of the
	// key order the math export happened to emit.
	rows.sort((a, b) => Number(Object.keys(a)[0]) - Number(Object.keys(b)[0]));
	return rows.length ? rows : undefined;
};

export const normalizePaylines = (raw: unknown): Paylines => {
	if (!isObject(raw)) return {};
	const lines: Paylines = {};
	for (const [id, rows] of Object.entries(raw)) {
		if (!id || !Array.isArray(rows)) continue;
		const parsed = rows.map(count);
		// A hole in the middle of a line has no drawable meaning, so the whole line goes rather
		// than a partial line that would render as a broken path.
		if (!parsed.length || parsed.some((r) => r === undefined)) continue;
		lines[id] = parsed as number[];
	}
	return lines;
};

/**
 * Rows per reel. Accepts a scalar (`3` ⇒ every reel 3 rows) as well as the per-reel list, and
 * pads/truncates to `numReels` so the grid is always fully described — a short `numRows` would
 * otherwise leave the last reels with `undefined` height at the consumer.
 */
export const normalizeNumRows = (raw: unknown, numReels: number): number[] => {
	const scalar = count(raw);
	if (scalar !== undefined) return Array.from({ length: numReels }, () => scalar);
	const list = Array.isArray(raw) ? raw.map(count) : [];
	const fallback = list.find((r): r is number => r !== undefined && r > 0) ?? 3;
	return Array.from({ length: numReels }, (_unused, i) => list[i] ?? fallback);
};
