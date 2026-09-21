import type { GameConfigDoc } from './types';
import type { ResolvedGrid } from './grid';

/**
 * The board an RGS says it is dealing, as the boot `config` event declares it.
 *
 * `rows` is the BOUNDING BOX — the tallest column — which is what it has always meant and what a
 * rectangular board makes indistinguishable from "every column". `rowsPerReel` is present only when
 * the columns differ, so a server that never heard of stepped grids sends exactly the shape it
 * always sent. Mirrors `rgs-translator-eagaming`'s `Play4FunConfigContext['window']`, which the
 * facade publishes verbatim to `__IE_SERVER_CONFIG__`.
 */
export type ServerWindow = { reels: number; rows: number; rowsPerReel?: number[] };

/**
 * Accept a declared window only when it describes a board completely — the guard that decides
 * whether the client has anything to follow at all.
 *
 * A `rowsPerReel` is taken only when it is one positive height per declared reel, none taller than
 * the box. A partial or malformed list decides NOTHING and leaves the window rectangular, which is
 * the shape every server that never heard of stepped grids sends anyway.
 */
export const acceptServerWindow = (raw: unknown): ServerWindow | undefined => {
	const win = raw as Partial<ServerWindow> | undefined;
	const reels = Math.round(Number(win?.reels));
	const rows = Math.round(Number(win?.rows));
	if (!Number.isFinite(reels) || !Number.isFinite(rows) || reels < 1 || rows < 1) return undefined;
	const declared = Array.isArray(win?.rowsPerReel) ? win.rowsPerReel.map((r) => Math.round(Number(r))) : undefined; // prettier-ignore
	const rowsPerReel =
		declared && declared.length === reels && declared.every((r) => Number.isFinite(r) && r >= 1 && r <= rows) // prettier-ignore
			? declared
			: undefined;
	return rowsPerReel ? { reels, rows, rowsPerReel } : { reels, rows };
};

/**
 * THE RGS OWNS THE BOARD; THE PROJECT OWNS ONLY WHAT THE RGS DOES NOT STATE.
 *
 * The server is authoritative for what it deals, and against a real RGS it always will be: the
 * partner's `config` declares its window and will never follow our Invisible Game Config. Sizing the
 * board off the authored doc alone is what let a client draw one board while the math scored
 * another — a failure the client could previously only shout about.
 *
 * Two cases, and the second is the one that is easy to get wrong:
 *
 *  - the server DECLARES a step (`rowsPerReel`) ⇒ it is used verbatim. Not a tie-break against the
 *    authored shape — strictly better information, since it is exactly what each dealt column is
 *    clamped to (`rgs-translator-eagaming`'s `clampBoardToGrid`).
 *  - the server declares NO step ⇒ it is dealing `rows` to EVERY column, so the authored step is
 *    dropped ALWAYS, not merely when the bounding box disagrees. A board drawing a column shorter
 *    than the server dealt hides a cell that was SCORED, and a matching box is precisely where that
 *    is easiest to miss: it looks like agreement.
 *
 * Returns the doc's grid fields REPLACED, never merged, so the result is a function of the window
 * alone. With no window at all the caller skips this entirely and resolves the doc unchanged, which
 * is what keeps every offline game byte-identical.
 */
export const reconcileGridDoc = (
	doc: Pick<GameConfigDoc, 'numReels' | 'numRows' | 'gridAlign'>,
	win: ServerWindow,
): Pick<GameConfigDoc, 'numReels' | 'numRows' | 'gridAlign'> => ({
	numReels: win.reels,
	// `[win.rows]` rather than a filled array: `resolveGrid` falls back to the first usable authored
	// height for every reel past the end of the list, so a single entry IS the uniform rectangle —
	// and it takes the same path a rectangular doc always took.
	numRows: win.rowsPerReel ?? [win.rows],
	gridAlign: doc.gridAlign,
});

/**
 * Do two resolved grids describe DIFFERENT boards? The question a caller answers before deciding
 * whether to rebuild reels that were built from the authored grid — a board that resized must not
 * keep a column count its mask, seats and cull no longer agree with.
 *
 * Shape, not just the bounding box: a declared `rowsPerReel` can replace an authored step while the
 * box agrees, and that is still a different board.
 *
 * Takes the two RESOLVED grids rather than resolving them here, so this module needs no value
 * import. That keeps it loadable by `node` directly (`scripts/verify-server-grid.mjs`) — Node's
 * type-stripping erases type-only imports but cannot resolve an extensionless value one.
 */
export const gridShapeDiffers = (before: ResolvedGrid, after: ResolvedGrid): boolean =>
	before.reels !== after.reels ||
	before.rows.length !== after.rows.length ||
	before.rows.some((r, i) => r !== after.rows[i]);
