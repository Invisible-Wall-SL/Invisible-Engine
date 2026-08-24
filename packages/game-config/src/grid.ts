import type { GameConfigDoc, GridAlign } from './types';

/**
 * THE GRID, resolved — the ONE answer to "how tall is reel N, and where does it sit?".
 *
 * `numRows` has been a per-reel array since the schema was written, but until now only the MATH
 * read it per reel (`activeWaysCount`, the payline bounds check); every renderer collapsed it to
 * `Math.max(...numRows)` and drew a rectangle. A non-uniform config therefore SAVED and VALIDATED
 * as a stepped board while the game drew a full rectangle against it — the class of silent
 * disagreement this package exists to remove. This resolver is the shared statement both sides now
 * read.
 *
 * Two numbers describe a column:
 *
 *  - `rowsForReel(reel)` — how many cells that column shows.
 *  - `rowOffsetForReel(reel)` — where its window STARTS, in rows from the top of the bounding box.
 *    Fractional on purpose: a 4-row column centred in a 5-row box sits at `0.5`, and that half-cell
 *    stagger is exactly what makes a 3/4/5/4/3 board read as a diamond rather than as two ragged
 *    edges. Snapping it to whole rows would be a different (worse-looking) board, not a tidier one.
 *
 * `stepped` is the PARITY GATE, and it is the load-bearing field. Every consumer branches on it and
 * early-returns its existing rectangular path when false, exactly as `boardPerspective()` returns
 * `undefined` for a flat board rather than multiplying through a scale of 1. `apps/lines` is the
 * shared `_runtime/lines` bundle every online game runs, so a uniform board must keep not just
 * equivalent geometry but the identical code path — see `docs/design/stepped-grid.md`.
 */
export type ResolvedGrid = {
	/** Columns. `numReels`, floored to a sane minimum. */
	reels: number;
	/** Visible rows per column, always exactly `reels` long. */
	rows: number[];
	/** The bounding box height — `max(rows)`. What `boardDimensions().y` reports. */
	maxRows: number;
	/** Resolved alignment; `center` when un-authored. */
	align: GridAlign;
	/** Do the columns differ in height? FALSE ⇒ every consumer takes its pre-existing path. */
	stepped: boolean;
	/** Visible rows on one column. Out-of-range reels answer `maxRows` (they do not exist). */
	rowsForReel: (reel: number) => number;
	/**
	 * Where a column's window starts, in ROWS from the top of the bounding box. `0` for every column
	 * of a uniform board, so the whole offset term drops out of the seat algebra unchanged.
	 */
	rowOffsetForReel: (reel: number) => number;
};

/** The alignments a short column can take inside the bounding box. `center` is the default. */
export const GRID_ALIGNS: readonly GridAlign[] = ['center', 'top', 'bottom'];

/** `center` unless the doc names one of the other two — anything else (typo, stale value) is the
 *  default rather than an error, matching how every other optional block resolves here. */
export const resolveGridAlign = (raw: unknown): GridAlign =>
	raw === 'top' || raw === 'bottom' ? raw : 'center';

/**
 * Resolve a doc's grid. Total — never throws, never returns undefined — because every board has a
 * grid, unlike the optional blocks (`winModel`, `reelBehaviour`) whose absence means "the coded
 * default". The parity story lives in `stepped`, not in a missing return value.
 */
export const resolveGrid = (
	doc: Pick<GameConfigDoc, 'numReels' | 'numRows' | 'gridAlign'>,
): ResolvedGrid => {
	const reels = Math.max(1, Math.floor(Number(doc.numReels) || 0) || 1);
	const declared = Array.isArray(doc.numRows) ? doc.numRows : [];
	// Fall back to the first USABLE authored height rather than to a constant 3, so a doc whose
	// `numRows` is short describes the board its author was building, not a 3-row one.
	const fallback = declared.find((r) => Number.isFinite(r) && Number(r) > 0) ?? 3;
	const rows = Array.from({ length: reels }, (_unused, i) => {
		const raw = Number(declared[i] ?? fallback);
		return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : Math.floor(Number(fallback)) || 3;
	});

	const maxRows = Math.max(...rows, 1);
	const align = resolveGridAlign(doc.gridAlign);
	const stepped = rows.some((r) => r !== rows[0]);

	const rowsForReel = (reel: number) => rows[reel] ?? maxRows;

	// A uniform board short-circuits to a literal 0 rather than computing `(maxRows - rows)/2` and
	// getting 0 — the same reason `boardPerspective()` refuses to treat `farScale === 1` as flat by
	// arithmetic. Here it is not float drift but code path: a caller that sees a constant 0 can skip
	// the whole per-column branch, which is what keeps the existing bundle byte-identical.
	const rowOffsetForReel = stepped
		? (reel: number) => {
				const slack = maxRows - rowsForReel(reel);
				if (slack <= 0) return 0;
				if (align === 'top') return 0;
				if (align === 'bottom') return slack;
				return slack / 2;
			}
		: () => 0;

	return { reels, rows, maxRows, align, stepped, rowsForReel, rowOffsetForReel };
};
