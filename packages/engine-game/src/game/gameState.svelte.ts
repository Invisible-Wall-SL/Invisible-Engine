import _ from 'lodash';
import type { Tween } from 'svelte/motion';

import { stateBet } from 'state-shared';
import { createEnhanceBoard, createReelForSpinning } from 'utils-slots';
import { createGetWinLevelDataByWinLevelAlias } from 'utils-shared/winLevel';
import {
	resolveReelGridFromNode,
	resolveReelGridPerspective,
	resolveReelGridTileArt,
	resolveReelSpinProfile,
	type ReelGridNode,
} from 'engine-layout';

import type { RawSymbol, SymbolState, SymbolName } from './types';
import { winLevelMap } from './winLevelMap';
import type { ResolvedGrid, ResolvedReelBehaviour, ResolvedSounds } from 'game-config';
import {
	SYMBOL_SIZE,
	REEL_PADDING,
	SPIN_OPTIONS_DEFAULT,
	SPIN_OPTIONS_FAST,
	INITIAL_SYMBOL_STATE,
} from './constants';

/**
 * Everything the board/reel state needs that belongs to a PARTICULAR game rather than to the
 * engine. Phase A4 of `docs/design/game-type-templates.md`.
 *
 * The state machinery itself — the board lattice, reel spin profiles, anticipation flags, the
 * stacked-picture runs, the win-dim set — is the same for any reel game, and is what a `ways` or
 * `cluster` build would otherwise fork. What is NOT the same is where the grid comes from (the
 * app's authored config), what a landing symbol sounds like (this game's scatter and wild), and
 * which layout it measures against. Those arrive here as `deps`.
 */
export interface GameStateDeps<TGameType extends string> {
	/** The game type the board starts in (`'basegame'`). Kept generic so the app's own union
	 *  survives — widening it to `string` would erase real checking at every comparison site. */
	initialGameType: TGameType;
	/** Board grid from the active Invisible Game Config (`gameConfig.ts` in the app). */
	initialBoard: () => RawSymbol[][];
	boardDimensions: () => { x: number; y: number };
	/** The per-column grid (`activeGrid()` in the app). `stepped` is false for every board authored
	 *  before stepped grids existed, and every consumer below early-returns its rectangular path on
	 *  that answer — see `docs/design/stepped-grid.md`. */
	activeGrid: () => ResolvedGrid;
	boardSizes: () => { width: number; height: number };
	/** `stateLayoutDerived` — the app owns it because it carries that game's ratios/main sizes. */
	layout: {
		layoutType: () => string;
		mainLayout: () => { width: number; height: number };
	};
	eventEmitter: { broadcast: (event: never) => void };
	/** Authored stacked-picture config (`bakedStackedConfig()`), or a falsy value to use the
	 *  fallback below. */
	stackedConfig: () => {
		symbols?: { name: string; height?: number; art?: StackedArt; winArt?: StackedArt }[];
		fullHeightOnly?: boolean;
		edgeCutoffs?: boolean;
		winHoldMs?: number;
	} | null;
	/** The coded fallback when nothing is authored (`STACKED_PICTURE` in the app). */
	stackedFallback: { symbols: string[]; heights: Record<string, number> };
	/** GAME CONTENT: what this game plays when a symbol lands (its scatter counter + wild cue).
	 *  Supplied by the app, re-exposed on `stateGameDerived` so existing callers are unchanged. */
	onSymbolLand: (args: { rawSymbol: RawSymbol }) => void;
	/**
	 * How the board PRESENTS a round — `activeReelBehaviour()` from the app's game config, defaults
	 * already applied (roll vs swap in place, the swap style, the per-column stagger, the clear step).
	 *
	 * A dep rather than a direct read, for the same reason the grid is one: this module is the shared
	 * board machinery and the config resolver is the app's (`createGameConfig` is constructed there,
	 * against that game's own compiled template). Passing the ACCESSOR rather than the value keeps it
	 * LIVE — the live runtime bundle resolves after module evaluation, so a value read here would
	 * freeze every board to the compiled sample config.
	 */
	reelBehaviour: () => ResolvedReelBehaviour;
	/**
	 * WHAT THIS GAME PLAYS at each named presentation moment — `activeSounds()` from the app's game
	 * config, catalogue defaults already applied (`game-config/sounds`).
	 *
	 * An ACCESSOR, and a dep rather than a direct read, for the same two reasons `reelBehaviour` is
	 * one: the config resolver belongs to the app, and the live runtime bundle resolves after this
	 * module evaluates — a value read here would freeze every game to the compiled sample bindings.
	 */
	sounds: () => ResolvedSounds;
}

/** The tall picture art for a stacked symbol (from the authored config). Mirrors a `SymbolCellInfo`
 *  binding; absent (coded fallback) ⇒ `StackedPicture` falls back to the symbol's `stacked` state. */
export type StackedArt = {
	type: 'sprite' | 'spine' | 'flipbook';
	assetKey: string;
	animationName?: string;
	clipId?: string;
};

/**
 * The authored perspective, resolved into the numbers the seat algebra actually consumes
 * (`docs/design/perspective-board-mode.md` §"The model"). Never constructed for a flat board — its
 * absence IS "flat", which is what lets the seat function early-return today's expressions instead
 * of multiplying them by a 1. See `boardPerspective` for what each field means.
 */
type BoardPerspective = {
	farScale: number;
	perRow: number;
	frontRow: number;
	vanishX: number;
};

/**
 * "No spill" — the answer `boardOverflow` gives for every board that authored none and for every
 * board that is not settled. One shared frozen object rather than a fresh literal per call, so the
 * overwhelmingly common answer costs no allocation and reads as an unchanged reference to the
 * `$derived` that consumes it.
 */
const NO_BOARD_OVERFLOW = Object.freeze({ x: 0, y: 0 });

export function createGameState<TGameType extends string>(deps: GameStateDeps<TGameType>) {
	/**
	 * Editor doc's `reelGrid` node (LAYOUT ONLY) bridged in by `Game.svelte` once the
	 * doc loads. `null` → the board keeps its coded constants (byte-identical parity).
	 * Stored raw so `boardLayout()`/`boardGeometry()` re-resolve per-layoutType reactively.
	 * Defined above `board` because the reel pitch reads `boardGeometry()` lazily.
	 */
	const boardOverride = $state<{ node: ReelGridNode | null }>({ node: null });

	const setBoardOverride = (node: ReelGridNode | null) => {
		boardOverride.node = node;
	};

	/**
	 * Board LATTICE derived from the override, in board-LOCAL space (before the
	 * container `scale`). `columnExtraLocal` = extra x added per reel index for
	 * non-square cell width + horizontal gap; `rowPitchLocal` = the reel's symbol
	 * pitch (drives `createReelForSpinning`'s reactive `symbolHeight`).
	 * `cellWidthLocal`/`cellHeightLocal` = the contain-fit box a symbol's ART draws
	 * into (the mask window's per-cell size in board-local space) — the ONE source of
	 * truth shared by the reel mask and the symbol sprites/spines, so art can never
	 * overflow the mask when a non-square/small cell is authored; plus the reel/row
	 * LEAD, per-cell SEAT ALIGNMENT and board NUDGE consumed by
	 * `getSymbolX`/`getSymbolLead`/`boardLayout`. No node ⇒
	 * `{0, SYMBOL_SIZE, SYMBOL_SIZE, SYMBOL_SIZE}`, coded lead (0.53 X / 0.5 Y),
	 * centred seats, no nudge = today's flush square lattice (byte-identical parity).
	 * The container `scale` is `cellSize / SYMBOL_SIZE` (see `boardLayout`), so dividing
	 * each authored cell edge by that scale yields the local box that renders AT the
	 * authored on-screen cell size; a UNIFORM cell (`cellWidth == cellHeight == cellSize`,
	 * no gap) collapses both edges to exactly `SYMBOL_SIZE`, so uniform-scaled boards
	 * draw art at 120px unchanged.
	 */
	const boardGeometry = () => {
		const override = resolveReelGridFromNode(
			boardOverride.node ?? undefined,
			deps.layout.layoutType(),
		);
		if (!override)
			return {
				columnExtraLocal: 0,
				rowPitchLocal: SYMBOL_SIZE,
				cellWidthLocal: SYMBOL_SIZE,
				cellHeightLocal: SYMBOL_SIZE,
				// No doc ⇒ the coded lead (0.53 X / 0.5 Y), centred seats, no nudge ⇒
				// getSymbolX / symbolY / boardLayout are byte-identical to before.
				reelLead: REEL_PADDING,
				rowLead: 0.5,
				symbolAlignX: 0.5,
				symbolAlignY: 0.5,
				boardNudgeX: 0,
				boardNudgeY: 0,
				overflowXLocal: 0,
				overflowYLocal: 0,
			};
		const scale = override.cellSize / SYMBOL_SIZE;
		const columnExtraLocal = (override.cellWidth - override.cellSize + override.gapX) / scale;
		const rowPitchLocal = (override.cellHeight + override.gapY) / scale;
		const cellWidthLocal = override.cellWidth / scale;
		const cellHeightLocal = override.cellHeight / scale;
		return {
			columnExtraLocal,
			rowPitchLocal,
			cellWidthLocal,
			cellHeightLocal,
			reelLead: override.reelPadding,
			rowLead: override.rowPadding,
			symbolAlignX: override.symbolAlignX,
			symbolAlignY: override.symbolAlignY,
			boardNudgeX: override.boardNudgeX,
			boardNudgeY: override.boardNudgeY,
			// Authored in the same on-screen px as the cell edges, so it converts to board-local the
			// same way they do — divided by the container scale. `boardOverflow` is what decides WHEN
			// this is spent; here it is only put in the space the mask is drawn in.
			overflowXLocal: override.overflowX / scale,
			overflowYLocal: override.overflowY / scale,
		};
	};

	/**
	 * Reactive symbol-centre X in board-local space. Three independent contributions:
	 * the reel LEAD (`reelLead` — seats the whole cluster), the non-square width + gap
	 * pitch (`columnExtraLocal`), and the per-cell art SEAT ALIGNMENT (`symbolAlignX` —
	 * offsets the art inside its own cell). Defaults (0.53 lead / 0.5 align) reproduce
	 * the coded `SYMBOL_SIZE * (reelIndex + REEL_PADDING)`.
	 */
	const getSymbolX = (reelIndex: number) => {
		const geometry = boardGeometry();
		return (
			SYMBOL_SIZE * (reelIndex + geometry.reelLead) +
			reelIndex * geometry.columnExtraLocal +
			(geometry.symbolAlignX - 0.5) * geometry.cellWidthLocal
		);
	};

	/**
	 * Reactive symbol resting SEAT Y in board-local space — the Y analogue of {@link getSymbolX}, and
	 * the seat a symbol occupies when the reel is at rest.
	 *
	 * It is `rowPitchLocal * (rowIndex + getSymbolLead())`, which is exactly the resting position
	 * `createReelForSpinning` computes for a spinning reel (it is handed the same two getters), so a
	 * symbol placed through here lands on the identical seat as one that arrived by spinning. That
	 * matters for any overlay that positions symbols itself — a tumble/cascade board, which slides
	 * symbols DOWN into the seats a settled reel would have used. Reading the geometry rather than
	 * assuming `SYMBOL_SIZE` is what makes it correct on a stepped or resized grid.
	 *
	 * `rowIndex` may be negative or past the visible rows: the padding row above the board is -1, and
	 * symbols queued to fall in sit further above still.
	 */
	const getSymbolY = (rowIndex: number) =>
		boardGeometry().rowPitchLocal * (rowIndex + getSymbolLead());

	/**
	 * Reactive symbol resting SEAT (pitch fractions) fed to `createReelForSpinning`.
	 * Folds the row LEAD (`rowLead` — seats the cluster) with the per-cell art SEAT
	 * ALIGNMENT (`symbolAlignY`, expressed as a fraction of the pitch). Defaults
	 * (0.5 lead / 0.5 align) collapse to `0.5` = today's centred seat (byte-parity).
	 */
	const getSymbolLead = () => {
		const geometry = boardGeometry();
		// Both contributions are converted to the util's pitch-fraction seat so they read
		// in the SAME units the X axis + editor use: the row LEAD in cell-SIZE units
		// (`SYMBOL_SIZE` is one cell in board-local space), the SEAT ALIGNMENT in
		// cell-HEIGHT units. Defaults (0.5 / 0.5) collapse to 0.5 = today's centred seat.
		return (
			0.5 +
			((geometry.rowLead - 0.5) * SYMBOL_SIZE) / geometry.rowPitchLocal +
			((geometry.symbolAlignY - 0.5) * geometry.cellHeightLocal) / geometry.rowPitchLocal
		);
	};

	/**
	 * The authored PERSPECTIVE model, resolved into the three numbers the seat algebra needs — or
	 * `undefined`, which means FLAT and is what every board that exists today resolves to
	 * (docs/design/perspective-board-mode.md §"The model").
	 *
	 * `undefined` is the load-bearing part. `farScale = 1` collapses the algebra mathematically, but
	 * NOT in floating point: `vanishX + (getSymbolX(reel) - vanishX) * 1` subtracts and adds back,
	 * which rounds. So "flat" has to be a MISSING model that the callers below early-return on, not a
	 * scale of 1 they multiply through — see {@link getSymbolSeat}.
	 *
	 * - `farScale` — the back row's scale. Absent / non-finite / `<= 0` / exactly `1` ⇒ flat.
	 * - `perRow`  — the depth SLOPE: `scale(row) = farScale + perRow * clamp(row)`, so that the back
	 *   row (0) draws at `farScale` and the front row draws at exactly 1.
	 * - `frontRow` — the last visible row, i.e. where the depth ramp ends.
	 * - `vanishX` — the authored vanishing point, defaulting to the lattice CENTRE: the midpoint of
	 *   the first and last COLUMN SEATS. Taken from `getSymbolX` itself rather than from a board-size
	 *   constant so it is the true centre of the columns that actually exist — `getSymbolX` is affine
	 *   in the reel index, so the midpoint of its extremes IS the mean of every column, which is what
	 *   makes a symmetric board contract symmetrically (column `i` and column `n-1-i` move by equal
	 *   and opposite amounts). A board-size constant would miss by the lead + seat-alignment terms.
	 */
	const boardPerspective = () => {
		const authored = resolveReelGridPerspective(boardOverride.node ?? undefined);
		const farScale = authored?.farScale;
		if (
			typeof farScale !== 'number' ||
			!Number.isFinite(farScale) ||
			farScale <= 0 ||
			farScale === 1
		) {
			return undefined;
		}
		const rows = deps.boardDimensions().y;
		const frontRow = Number.isFinite(rows) && rows > 1 ? rows - 1 : 0;
		// A one-row (or degenerate) board has no depth to ramp across, so every row sits at
		// `farScale` — a uniformly smaller board rather than a division by zero.
		const perRow = frontRow > 0 ? (1 - farScale) / frontRow : 0;
		const reels = deps.boardDimensions().x;
		const lastReel = Number.isFinite(reels) && reels > 1 ? Math.floor(reels) - 1 : 0;
		const authoredVanishX = authored?.vanishX;
		const vanishX =
			typeof authoredVanishX === 'number' && Number.isFinite(authoredVanishX)
				? authoredVanishX
				: (getSymbolX(0) + getSymbolX(lastReel)) / 2;
		return { farScale, perRow, frontRow, vanishX };
	};

	/**
	 * THE BOARD'S MODE: does a round replace symbols IN PLACE (drop-in or column cascade) instead of
	 * rolling the reels? (docs/design/perspective-board-mode.md §"The mode switch".)
	 *
	 * Read from the GAME CONFIG's `reelBehaviour` block, not from the `reelGrid` node beside the
	 * geometry above. It lived on the node while the mode was first built, and that was the wrong
	 * home: a `reelGrid` node is authored PER layoutType, so the schema allowed a board that rolled
	 * in portrait and swapped in landscape. Whether a round rolls is one fact about the game, so it
	 * is authored once, in `/config` → Reel behaviour.
	 *
	 * Still DELIBERATELY INDEPENDENT of {@link boardPerspective}, which is why the three behaviour
	 * accessors stay declared here beside the geometry they are NOT derived from. `boardPerspective()`
	 * is `undefined` whenever the board is geometrically FLAT — no `farScale`, a non-finite one,
	 * `<= 0`, or exactly `1` — which is the right answer for the seat algebra and the WRONG one for
	 * the mode: "a stylised game may want a converging grid that still rolls, or a flat board that
	 * swaps". A flat board that swaps is a legal, intended configuration, and gating this on the
	 * geometry would make it silently do nothing with no error to find.
	 */
	const boardSwapsInPlace = () => deps.reelBehaviour().swapInPlace;

	/**
	 * HOW a swap-in-place board presents a new board — `'dropIn'` (the shipped behaviour: the whole
	 * board falls in at once), `'columnCascade'` (the resting board drains column by column, left to
	 * right, each column refilling as it empties), or `'emerge'` (nothing travels: each symbol
	 * appears on its own seat and plays its authored `intro` state there).
	 *
	 * Absent ⇒ `'dropIn'` (resolved in the config schema), and the caller EARLY-RETURNS the shipped
	 * drop-in on that answer rather than routing it through a generalised per-column path that
	 * happens to reproduce it. Same discipline as {@link getSymbolSeat}'s flat branch and for the
	 * same reason: `apps/lines` is the shared `_runtime/lines` bundle every online game runs, so
	 * "equivalent" is not good enough.
	 *
	 * Not gated on {@link boardSwapsInPlace} even though it only MEANS anything there: a style on a
	 * rolling board is already inert (the reveal reaches no swap presentation at all), and gating
	 * would put the same condition in two places for no behaviour.
	 */
	const boardSwapStyle = () => deps.reelBehaviour().swapStyle;

	/**
	 * The authored per-column stagger for the styles whose columns arrive on their own beat
	 * (`'columnCascade'` and `'emerge'` — the schema names the set), in ms — or `undefined` for "the
	 * presentation's own default". Deliberately NOT defaulted to a number anywhere upstream: the
	 * number is a TIMING, and every other cascade timing (the beat cap, the slide duration) lives
	 * with the presentation that spends it.
	 *
	 * The config resolver has already dropped a non-finite or negative value, so anything that
	 * arrives here is a usable delay — including `0`, which is a legal authoring choice (drain and
	 * refill — or surface — every column at once, no sweep) and must therefore survive the `??` at
	 * the call site.
	 */
	const boardColumnStaggerMs = () => deps.reelBehaviour().columnStaggerMs;

	/**
	 * Do the OUTGOING symbols clear — play their authored `explosion` state and leave — instead of
	 * simply being replaced?
	 *
	 * Named for the symbols rather than for the board because WHAT clears depends on the style: the
	 * whole board at once under `'dropIn'`, one column per beat under `'columnCascade'`, where it
	 * takes the place of that column's drain. It is not a `'dropIn'`-only knob (an earlier cut of it
	 * was, on the grounds that a cascade's drain already empties the column — but a drain and a clear
	 * are two different pictures of the same beat, and choosing between them is the point).
	 *
	 * Only ever true on a swap-in-place board; the config resolver owns that precondition, so the
	 * dependency is stated once, in the schema this and the authoring tool both read.
	 */
	const boardClearsOutgoing = () => deps.reelBehaviour().clearBoard;

	/**
	 * The board's authored GROUND TILE art, resolved to the texture keys a `<Sprite>` looks up — or
	 * `undefined`, which is every board that exists today and means NO tile layer mounts at all
	 * (`docs/design/perspective-board-mode.md` §"The tiles").
	 *
	 * Deliberately NOT gated on {@link boardPerspective}, for the same reason {@link boardSwapsInPlace}
	 * is not gated on it either: a tiled ground plane is an independent decision from a converging
	 * one, and a flat board is allowed to want tiles. Gating it would make an authored tile silently render nothing with no
	 * error to find.
	 *
	 * The resolution lives in `engine-layout` beside the ref format itself, so the game, the export
	 * chain and (later) the editor preview all read the same value the same way.
	 */
	const boardTileArt = () => resolveReelGridTileArt(boardOverride.node ?? undefined);

	/**
	 * The scale ONE row draws at: `farScale` at the back, exactly `1` at the front, linear between.
	 *
	 * The depth is CLAMPED to the visible rows rather than extrapolated, and that is a deliberate
	 * choice: `rowIndex` is a lattice POSITION, and the positions the board actually uses run well
	 * outside `0..frontRow` — the padding row is -1 and a cascade stacks its replacements at
	 * `symbolIndex - 1 - addingReel.length`, which on a 5-row board reaches -6. Extrapolated, the
	 * scale there would cross zero and go NEGATIVE (mirrored art), and the summed y would turn back
	 * on itself so a symbol queued above the board would be seated BELOW it and "fall" upwards.
	 * Clamping instead continues the ground plane above the board at the BACK row's size and pitch:
	 * a replacement waits at the depth of the row behind the board and grows as it lands.
	 *
	 * {@link perspectiveRowSum} clamps identically, because the two MUST agree: y is the running sum
	 * of these scales, so if the off-board scale and the off-board pitch disagreed, a falling symbol
	 * would not land on the seat it was aimed at.
	 */
	const perspectiveRowScale = (model: BoardPerspective, rowIndex: number) =>
		model.farScale + model.perRow * Math.min(Math.max(rowIndex, 0), model.frontRow);

	/**
	 * `Σ_{k<row} scale(k)` in units of `rowPitchLocal` — how many base pitches deep row `row` sits,
	 * once each row above it has contributed only its OWN (compressed) pitch.
	 *
	 * Written closed-form, not as a loop, because the domain is not `0..rows-1`: the sum has to
	 * answer for negative and fractional rows too (see {@link perspectiveRowScale}). Since `scale` is
	 * affine in `k`, the sum has an exact closed form that extends there naturally —
	 * `Σ_{k=0}^{row-1} (a + b·k) = a·row + b·row·(row-1)/2` — which is the middle branch below. The
	 * two outer branches are the CLAMPED regions, where the scale is constant (`farScale` behind the
	 * board, `1` in front of it) so the sum is plainly linear; all three branches meet exactly at the
	 * joins (`row = 0` and `row = frontRow`), so y is continuous and increases with the row.
	 *
	 * At integer rows in `0..frontRow` this is literally the design's Σ — `scripts/verify-symbol-seat.mjs`
	 * asserts it against a loop-sum rather than trusting the algebra. Between two integer rows it is
	 * the analytic continuation of that sum, which is all a fractional row can ask for; no call site
	 * seats a fractional row anyway (mid-flight y comes from the reel/tween, never from the seat).
	 */
	const perspectiveRowSum = (model: BoardPerspective, rowIndex: number) => {
		const ramp = (row: number) => model.farScale * row + (model.perRow * row * (row - 1)) / 2;
		if (rowIndex <= 0) return model.farScale * rowIndex;
		if (rowIndex <= model.frontRow) return ramp(rowIndex);
		return ramp(model.frontRow) + (rowIndex - model.frontRow);
	};

	/**
	 * THE INVERSE of {@link perspectiveRowSum}: which row sits `sum` base pitches deep?
	 *
	 * It exists because the SYMBOL OVERFLOW is authored as a DISTANCE (px past the window) while the
	 * board's edge geometry is parameterised by the ROW — x contracts with the row, not with y. A
	 * corner widened by adding the distance straight onto y therefore keeps the x of its own row and
	 * steps OFF the boundary curve sideways; `boardMaskColumns` asks this for the row whose depth is
	 * the spilt-past one instead, so the widened corner stays on the curve. That is what lets two
	 * neighbouring columns still describe the same shared edge when their windows start at different
	 * rows — see the tiling argument there.
	 *
	 * Closed form, branch for branch against the forward function, so the two are inverses at the
	 * joins as well as inside the ramp. The clamped regions are linear and invert by division. The
	 * ramp is the quadratic `(perRow/2)·row² + (farScale − perRow/2)·row`, and the root wanted is the
	 * one in `0..frontRow`: `perspectiveRowScale` runs `farScale` → 1 across that span with both ends
	 * positive, so the sum strictly increases there and exactly one root can lie inside it. The
	 * second root is returned only when the first falls outside — the `farScale > 1` authoring (a
	 * back row drawn LARGER than the front), where `perRow` is negative and the parabola opens down.
	 */
	const perspectiveRowAtSum = (model: BoardPerspective, sum: number) => {
		if (sum <= 0) return sum / model.farScale;
		const ramp = (row: number) => model.farScale * row + (model.perRow * row * (row - 1)) / 2;
		const atFront = ramp(model.frontRow);
		if (sum >= atFront) return model.frontRow + (sum - atFront);
		const quadratic = model.perRow / 2;
		const linear = model.farScale - model.perRow / 2;
		if (quadratic === 0) return sum / linear;
		const root = Math.sqrt(linear * linear + 4 * quadratic * sum);
		const first = (-linear + root) / (2 * quadratic);
		return first >= 0 && first <= model.frontRow ? first : (-linear - root) / (2 * quadratic);
	};

	/**
	 * The board WINDOW's height in board-local space — ONE definition of "how tall is the visible
	 * board", shared by the mask that clips it (`BoardMask`) and the in-frame test that culls symbols
	 * outside it (`SymbolWrap`). Those two components each computed this expression themselves; they
	 * have to agree exactly or a symbol is culled at a different height than the mask clips, so under
	 * perspective — where the answer stops being a multiplication — it is defined once, here.
	 */
	/**
	 * ONE COLUMN's visible window in board-local pixels — `{ top, height }` — the per-reel analogue
	 * of {@link boardWindowHeight}, and what a stepped board's per-column mask and cull clip at.
	 *
	 * A uniform board answers `{ top: 0, height: boardWindowHeight() }` for every column, by CALLING
	 * `boardWindowHeight()` rather than recomputing it: the two must not drift, for the same reason
	 * the mask and the cull share one definition — a symbol culled at a height the mask clips
	 * differently pops instead of sliding under the edge.
	 */
	const boardWindowForReel = (reelIndex: number) => {
		const height = boardWindowHeight();
		const grid = deps.activeGrid();
		if (!grid.stepped) return { top: 0, height };
		const model = boardPerspective();
		const { rowPitchLocal } = boardGeometry();
		const offsetRows = grid.rowOffsetForReel(reelIndex);
		const rows = grid.rowsForReel(reelIndex);
		// FLAT: the rows share a pitch, so both edges are a plain multiplication.
		if (!model) {
			return { top: offsetRows * rowPitchLocal, height: rows * rowPitchLocal };
		}
		// PERSPECTIVE: the rows do not share a pitch, so each edge is the running depth SUM at that
		// row — the same quantity `boardWindowHeight` takes for the whole board, sampled twice.
		const top = rowPitchLocal * perspectiveRowSum(model, offsetRows);
		const bottom = rowPitchLocal * perspectiveRowSum(model, offsetRows + rows);
		return { top, height: bottom - top };
	};

	/**
	 * THE BOARD'S CLIP SHAPE, as one polygon per column — or `undefined`, which is every uniform
	 * board and means "one rectangle", the mask `BoardMask` has always drawn.
	 *
	 * WHY A COMPOUND MASK RATHER THAN A CONTAINER PER COLUMN. A stepped board has to clip each column
	 * to its own window, and the obvious way is to wrap each column in its own container carrying its
	 * own mask. That works, but it forces the scene graph to be COLUMN-MAJOR — and perspective needs
	 * it ROW-major, because a front-row character has to paint over the row behind it and a
	 * `pixi-svelte` child's paint order is its mount order. Grouping by column made the two modes
	 * mutually exclusive.
	 *
	 * A single mask whose geometry is the UNION of the per-column windows needs no grouping at all.
	 * The child list stays exactly as flat as it is today, so paint order is untouched and both
	 * `BoardBase` branches — flat and perspective — work unchanged. One mask, on the same container
	 * that has always carried one.
	 *
	 * THE COLUMNS TILE, they do not overlap. Each column's polygon runs from the midpoint between it
	 * and its left neighbour to the midpoint on its right, with `BoardMask`'s existing `SYMBOL_SIZE`
	 * of slack added only at the two OUTER edges. Overlapping them — giving every column the full
	 * board width, the way a per-column container safely can — would let a tall neighbour's rectangle
	 * cover the notch beside a short column, and a symbol scrolling through that notch would be drawn
	 * in a place the board does not exist. Exact tiling is what makes the union mean "the visible
	 * board", which is the whole point of the shape.
	 *
	 * The horizontal cost is that a symbol overhanging past the midpoint into a neighbour's column is
	 * clipped WHERE THAT NEIGHBOUR HAS NO WINDOW — i.e. only in the notches, which is where the board
	 * genuinely ends. Everywhere the two columns' windows overlap vertically, the neighbour's own
	 * polygon covers the overhang and it draws exactly as it does today.
	 *
	 * UNDER PERSPECTIVE each column is a TRAPEZOID, not a rectangle: its edges contract toward the
	 * vanishing point with depth, by the same `perspectiveRowScale` its symbols do. That is what keeps
	 * the tiling exact at every depth — axis-aligned rectangles sized off the front row would be too
	 * wide at the back, and the notches would leak again.
	 *
	 * SYMBOL OVERFLOW (`boardOverflow`) grows each column's ring outward — vertically at the two row
	 * boundaries that are this column's own top and bottom edge, horizontally only at the board's two
	 * OUTER sides. It is passed IN rather than read here because the caller owns the one thing this
	 * geometry must not decide: whether the board is settled. Defaulted to nothing, so the cascade
	 * overlay's mask (which never spends it) draws the same ring it always has.
	 *
	 * Note what is deliberately NOT grown: the boundaries BETWEEN columns. Those are the tiling that
	 * makes the union mean "the visible board" — widening them would let two neighbours' rings overlap
	 * and cover the notch beside a short column, which is the leak the exact tiling exists to close.
	 * A tall symbol may therefore still be clipped where it overhangs into a notch, and that is the
	 * correct answer: the board genuinely ends there.
	 */
	const boardMaskColumns = (overflowX = 0, overflowY = 0) => {
		const grid = deps.activeGrid();
		if (!grid.stepped) return undefined;
		const model = boardPerspective();
		const reels = grid.reels;
		const { rowPitchLocal } = boardGeometry();
		// Column CENTRES, and the pitch between them. `getSymbolX` is affine in the reel index, so the
		// difference of any adjacent pair is the pitch; a one-column board has no pair, and falls back
		// to the flush cell width the board is measured in.
		const centre = (reel: number) => getSymbolX(reel);
		const pitch = reels > 1 ? centre(1) - centre(0) : SYMBOL_SIZE;
		/** The left edge of column `reel` — and, at `reel === reels`, the board's right edge. */
		const boundary = (reel: number) => {
			if (reel <= 0) return centre(0) - pitch / 2 - SYMBOL_SIZE - overflowX;
			if (reel >= reels) return centre(reels - 1) + pitch / 2 + SYMBOL_SIZE + overflowX;
			return (centre(reel - 1) + centre(reel)) / 2;
		};
		const contract = (x: number, scale: number) =>
			model ? model.vanishX + (x - model.vanishX) * scale : x;
		/**
		 * Move a row boundary OUTWARD by an authored overflow distance, and answer it as a ROW.
		 *
		 * The overflow is authored as px past the window, but a perspective edge is parameterised by
		 * the row — x contracts with the row, not with y. Adding the distance straight onto y keeps
		 * the corner's x at its own row while moving it to the depth of a different one, so the corner
		 * steps OFF the boundary curve sideways. Asking which row actually sits that far past
		 * ({@link perspectiveRowAtSum}) keeps it on the curve, and the spill is still exactly the
		 * authored distance because the two functions are inverses.
		 */
		const spilledRow = (row: number, distance: number) =>
			distance === 0 || !model
				? row
				: perspectiveRowAtSum(model, perspectiveRowSum(model, row) + distance / rowPitchLocal);
		/**
		 * ONE column's own edge knots, in rows, with the two OUTER ones already spilt outward. The
		 * knots BETWEEN them are untouched: the overflow grows the ring, it does not reshape it.
		 */
		const ownKnots = (reel: number) => {
			const lo = grid.rowOffsetForReel(reel);
			const rowsThere = grid.rowsForReel(reel);
			return Array.from({ length: rowsThere + 1 }, (_u, step) =>
				step === 0
					? spilledRow(lo, -overflowY)
					: step === rowsThere
						? spilledRow(lo + rowsThere, overflowY)
						: lo + step,
			);
		};
		/**
		 * The rows at which ONE edge is sampled: this column's own knots, PLUS any of the
		 * neighbour-across-that-edge's that fall strictly inside this column's span.
		 *
		 * The neighbour's rows are what makes the tiling exact, and exact tiling is the whole premise
		 * of the compound mask. Under perspective a boundary is a CURVE — x contracts linearly in the
		 * row while y is the quadratic running sum of compressed pitches — and a polyline reproduces a
		 * curve only at the knots it is sampled at. Two columns that inscribed the SAME boundary at
		 * DIFFERENT knots therefore described two different edges, and the union stopped covering a
		 * lens-shaped sliver between them: a HOLE in the mask, at one column boundary, over the rows
		 * where the two disagreed — the background painting through, on top of the symbols.
		 *
		 * Two independent things put neighbours out of phase, and both are ordinary authoring:
		 * `rowOffsetForReel` returns `slack / 2`, so any column whose slack is ODD starts half a row
		 * off its neighbour; and the overflow above spills each column from ITS OWN outer row, which
		 * is a different row for a short column than for a tall one.
		 *
		 * Sampling both sides at the UNION makes the two knot sets identical wherever the columns
		 * overlap, which is the only place the question is asked. It changes nothing when they are
		 * already in phase — `top`/`bottom` alignment with no overflow puts the neighbour's rows
		 * exactly on this column's own, the dedupe below drops them, and the ring is the one it has
		 * always been.
		 *
		 * Deduped by scanning the SORTED list rather than through a `Set`, which keeps the whole
		 * function a plain numeric computation: a `Set` here would be a mutable built-in inside a
		 * runes file, which `svelte/prefer-svelte-reactivity` flags and which would otherwise need a
		 * suppression saying it is never read reactively. Equal knots are bit-identical when they
		 * collide (both sides reach an in-phase row as `offset + step` from equal offsets), so an
		 * exact comparison is the right test — a tolerance would merge two genuinely distinct rows on
		 * a densely stepped board.
		 */
		const rowKnots = (reel: number, neighbour: number) => {
			const own = ownKnots(reel);
			if (neighbour < 0 || neighbour >= reels) return own;
			const lo = own[0];
			const hi = own[own.length - 1];
			const shared = ownKnots(neighbour).filter((row) => row > lo && row < hi);
			return own
				.concat(shared)
				.sort((a, b) => a - b)
				.filter((row, index, sorted) => index === 0 || row !== sorted[index - 1]);
		};

		return Array.from({ length: reels }, (_unused, reel) => {
			const left = boundary(reel);
			const right = boundary(reel + 1);
			const offsetRows = grid.rowOffsetForReel(reel);
			const rowsHere = grid.rowsForReel(reel);
			/**
			 * One vertex on one edge, at one of this column's ROW BOUNDARIES.
			 *
			 * Sampled per row boundary rather than as a four-corner trapezoid, and that is worth
			 * recording because the trapezoid looks obviously right: it interpolates its edges linearly
			 * in Y, while the perspective contraction is linear in the ROW and y is a quadratic sum of
			 * compressed row pitches. The two disagree in the middle of a column by enough that a
			 * cell's centre can land inside its NEIGHBOUR's polygon — so a symbol would be clipped by
			 * the wrong column's window. One segment per row bounds that error by a single row's
			 * contraction, which no cell can cross.
			 *
			 * FLAT boards keep a SEPARATE branch below, and it is the one that has always run: their
			 * boundary is a vertical straight line, so where its knots sit cannot move the edge, the
			 * extra vertices are collinear and the ring IS the rectangle. That is also why the
			 * knot-union repair is perspective-only — a flat board cannot open the hole it closes, and
			 * this is the shared `_runtime/lines` bundle, so it must not be handed a different shape
			 * for a bug it does not have.
			 */
			/**
			 * How far this vertex's row boundary moves for the SYMBOL OVERFLOW — outward at the
			 * column's own top and bottom edge, and nothing at the boundaries in between, so the ring
			 * grows without changing shape.
			 *
			 * FLAT BOARDS ONLY. Displacing y is exactly right for a straight vertical edge. Under
			 * perspective the spill is spent ALONG the curve instead, up in `ownKnots`, so the rows
			 * arriving here are already the spilt ones and must not be moved a second time.
			 */
			const padY = (row: number) => {
				if (overflowY === 0) return 0;
				if (row <= offsetRows) return -overflowY;
				if (row >= offsetRows + rowsHere) return overflowY;
				return 0;
			};
			const edgeAt = (row: number, x: number) => {
				if (!model) return { x, y: row * rowPitchLocal + padY(row) };
				return {
					x: contract(x, perspectiveRowScale(model, row)),
					y: rowPitchLocal * perspectiveRowSum(model, row),
				};
			};
			const plainRows = Array.from({ length: rowsHere + 1 }, (_u, step) => offsetRows + step);
			// Down the left edge, then back up the right. No local annotation: this block is SLICED and
			// type-stripped by `verify-symbol-seat.mjs`, where only parameter annotations survive.
			return [
				...(model ? rowKnots(reel, reel - 1) : plainRows).map((row) => edgeAt(row, left)),
				...(model ? rowKnots(reel, reel + 1) : plainRows)
					.map((row) => edgeAt(row, right))
					.reverse(),
			];
		});
	};

	const boardWindowHeight = () => {
		const model = boardPerspective();
		// FLAT: literally the expression both components used, in the same order (rows × the reel's
		// ACTUAL row pitch), so the window cannot move by a float bit.
		if (!model) return deps.boardDimensions().y * boardGeometry().rowPitchLocal;
		// PERSPECTIVE: the rows no longer share a pitch, so the window is the SUM of the per-row
		// pitches — which is exactly the depth of the row one past the front row, i.e. the bottom edge
		// of the front row's cell.
		return boardGeometry().rowPitchLocal * perspectiveRowSum(model, deps.boardDimensions().y);
	};

	/**
	 * Reactive SEAT of ONE CELL — the single answer to "where does (reel, row) sit, and how big is
	 * it". {@link getSymbolX}/{@link getSymbolY} stay exactly as they are and are what this composes,
	 * because plenty of callers legitimately want a whole COLUMN's x rather than a cell's: the win
	 * line groups its per-reel bars by that exact value, and the anticipation camera centres a whole
	 * column on it.
	 *
	 * It exists because the lattice is separable — `x = f(reel)`, `y = g(row)`, one board scale —
	 * only while the board is FLAT. Perspective (docs/design/perspective-board-mode.md) breaks all
	 * three at once: converging columns make `x` depend on the ROW too, the row pitch compresses with
	 * depth, and each row draws at its OWN scale. A call site that composes `getSymbolX(reel)` with a
	 * live y can express none of that, so every per-cell seat has to come through one function before
	 * the model can exist — which is all this phase does.
	 *
	 * WITHOUT AN AUTHORED PERSPECTIVE IT IS FLAT, and that is an EARLY RETURN of literally the two
	 * getters plus `scale: 1` — the same CALLS, not an equivalent re-derivation. The perspective
	 * algebra does collapse to them when `farScale` is 1, but only on paper:
	 * `vanishX + (getSymbolX(reel) - vanishX) * 1` subtracts and adds back, and that rounds. Since
	 * nothing authors a perspective yet, a single moved bit here is a board that silently shifted on
	 * every online game with no authored change to blame. `scripts/verify-symbol-seat.mjs` asserts
	 * the parity offline, as exact equality.
	 *
	 * `rowIndex` shares {@link getSymbolY}'s domain: it is a POSITION on the lattice, not an index
	 * into the visible rows. It may be negative (the padding row above the board is -1) and may sit
	 * far above it (a cascade stacks its replacements at `symbolIndex - 1 - addingReel.length`).
	 * {@link perspectiveRowScale} explains what depth means out there.
	 */
	/**
	 * This column's vertical PLACEMENT inside the bounding box, in rows — `0` for every column of a
	 * uniform board, and a literal pass-through of `rowIndex` there, so the flat seat below stays the
	 * same CALL rather than an equivalent one (`scripts/verify-symbol-seat.mjs` asserts that as exact
	 * equality). On a stepped grid a short column is pushed down by its share of the slack, which is
	 * what makes 3/4/5/4/3 read as a diamond.
	 *
	 * It is folded into the ROW INDEX rather than added to the resulting y because that is the same
	 * axis `createReelForSpinning` is offset on (`buildBoard` adds it to that reel's `symbolLead`).
	 * The live rolling y and the resting seat must agree cell-for-cell — `ReelSymbol` picks between
	 * them per frame — so they have to be offset in the same units, once.
	 */
	const rowSeatIndex = (reelIndex: number, rowIndex: number) => {
		const grid = deps.activeGrid();
		if (!grid.stepped) return rowIndex;
		return rowIndex + grid.rowOffsetForReel(reelIndex);
	};

	const getSymbolSeat = (reelIndex: number, rowIndex: number) => {
		const model = boardPerspective();
		const seatRow = rowSeatIndex(reelIndex, rowIndex);
		if (!model) return { x: getSymbolX(reelIndex), y: getSymbolY(seatRow), scale: 1 };
		const scale = perspectiveRowScale(model, seatRow);
		const { rowPitchLocal } = boardGeometry();
		return {
			// The column is CONTRACTED toward the vanishing point by its row's scale — `getSymbolX` is
			// reused verbatim, so lead, gaps, non-square cells and seat alignment all still mean what
			// they mean today, and they shrink with their row, which is what perspective requires.
			x: model.vanishX + (getSymbolX(reelIndex) - model.vanishX) * scale,
			// Depth (the running sum of the compressed pitches) plus this row's OWN lead, itself scaled
			// so the seat sits the same FRACTION into a shallower row as it does into a deep one.
			y:
				rowPitchLocal * perspectiveRowSum(model, seatRow) + rowPitchLocal * scale * getSymbolLead(),
			scale,
		};
	};

	/**
	 * Build one spinning reel per column, sized + seeded from the ACTIVE game config (Invisible Game
	 * Config). A FACTORY, not a module-scope const, so it can be re-run after the live runtime bundle
	 * lands — see {@link rebuildBoard}: the online config resolves asynchronously AFTER this module
	 * evaluates, so a board built once at import would freeze to the compiled template's grid.
	 */
	const buildBoard = () => {
		const init = deps.initialBoard();
		return _.range(deps.boardDimensions().x).map((reelIndex) => {
			const reel = createReelForSpinning({
				reelIndex,
				symbolHeight: () => boardGeometry().rowPitchLocal,
				// The reel places every symbol at `reelY + (symbolIndex + lead) * pitch`, so this reel's
				// share of the bounding-box slack rides in as part of the LEAD — one term, applied to
				// the whole column, and it therefore travels with the symbols while they roll instead of
				// only describing where they come to rest. `rowSeatIndex` folds the identical term into
				// the resting seat, which is what keeps `ReelSymbol`'s two y sources agreeing. Uniform
				// grids add a literal 0 term-free (the `stepped` guard), so the lead is the same call.
				symbolLead: () => getSymbolLead() + rowSeatIndex(reelIndex, 0),
				initialSymbols: init[reelIndex],
				initialSymbolState: INITIAL_SYMBOL_STATE,
				onReelStopping: () => {
					// The reel-stop LADDER, indexed by this reel's own position, so the left-to-right stop
					// rises in pitch. Every reel used to play `sfx_reel_stop_1` — the audiosprite has
					// shipped rungs 2–5 since the fork and nothing ever reached them. The pick clamps, so
					// a board wider than the ladder holds on the last rung instead of falling silent.
					const cue = deps.sounds().pick('reelStop', reelIndex);
					if (!cue) return;
					deps.eventEmitter.broadcast({
						type: 'soundOnce',
						name: cue.name,
						volume: cue.volume,
						forcePlay: !stateBet.isTurbo,
					});
				},
				onSymbolLand: deps.onSymbolLand,
			});

			reel.reelState.spinOptions = () => {
				const isFast = reel.reelState.spinType === 'fast';
				const base = isFast ? SPIN_OPTIONS_FAST : SPIN_OPTIONS_DEFAULT;
				// Editor spin-FEEL override (reactive): merge the authored profile over the
				// coded options. No node / no spin ⇒ undefined ⇒ coded constants (parity).
				const override = resolveReelSpinProfile(
					boardOverride.node ?? undefined,
					isFast ? 'fast' : 'normal',
				);
				const merged = override ? { ...base, ...override } : base;
				// Flow-authored PER-REEL sequential-stop knobs (from the `enableSequentialReelStop` effect
				// payload) win for this reel's two sequential fields. The getter closes over `reelIndex`, so
				// each reel reads its own array entry; a missing/undefined entry ⇒ fall back to the coded
				// constant, so an un-authored spin is byte-identical to the constants.
				const gapForReel = stateGame.sequentialGapOverrides?.[reelIndex];
				const speedForReel = stateGame.sequentialSpeedOverrides?.[reelIndex];
				if (gapForReel == null && speedForReel == null) return merged;
				return {
					...merged,
					...(gapForReel != null && { reelPaddingMultiplierSequential: gapForReel }),
					...(speedForReel != null && { reelSpinSpeedSequential: speedForReel }),
				};
			};

			return reel;
		});
	};

	type MultiplierSymbol = {
		initX: number;
		initY: number;
		symbolX: Tween<number>;
		symbolY: Tween<number>;
		rawSymbol: RawSymbol;
		symbolState: SymbolState;
		oncomplete: () => void;
	};

	const stateGame = $state({
		board: buildBoard(),
		gameType: deps.initialGameType,
		multiplierBoard: [] as (MultiplierSymbol | undefined)[][],
		scatterCounter: 0,
		specialSymbol: null as SymbolName | null,
		// The symbol that actually EXPANDED on the CURRENT spin (`expandBookColumns`), or null. Distinct
		// from `specialSymbol`, which is the round's chosen symbol and stays set for the whole feature:
		// most free spins never reach 3+ and pay ordinary line wins, so only the spins where the columns
		// really morphed may say "on N reels" (Invisible Win Text's `toast.expanded`). Set by the
		// expansion, cleared by the next `reveal` and at feature end — both the coded handlers and the
		// flow-v2 effects, since either may be driving.
		expandedSymbol: null as SymbolName | null,
		sequentialReelStop: false,
		// Optional Flow-authored PER-REEL overrides for the sequential-stop knobs, indexed by reelIndex
		// (null, or a missing/short entry ⇒ that reel uses the coded SPIN_OPTIONS constant). Set from
		// `enableSequentialReelStop`'s `gaps`/`speeds` payload, cleared on disable.
		sequentialGapOverrides: null as number[] | null,
		sequentialSpeedOverrides: null as number[] | null,
		// Client-computed reel ANTICIPATION mode (docs/design/reel-anticipation.md). OFF by default ⇒ the
		// spin is byte-identical (no reel HOLDS, nothing armed) until a Flow effect turns it on (Phase 4).
		// `anticipationConfidence` picks the reachable-win bound: `possible` (max — suspenseful, teases
		// near-misses) vs `guaranteed` (min — honest, only once the big win is locked in). `minAnticipateReel`
		// suppresses the trivial early arming (a run/count below 3 can't reach a big win or feature trigger).
		anticipationMode: false,
		anticipationConfidence: 'possible' as 'possible' | 'guaranteed',
		minAnticipateReel: 2,
		// Presentation toggles for the anticipation mode (both default ON ⇒ Phase 3 behaviour unchanged),
		// set from the `enableAnticipationMode` Flow effect payload. `anticipationGreyOut` gates the dim of
		// the non-anticipating reels (`Anticipations.svelte`); `anticipationZoom` gates the board zoom-in
		// camera (`Game.svelte` wraps the reel stack in `AnticipationCamera` only when it is on).
		anticipationGreyOut: true,
		anticipationZoom: true,
		// The REUSABLE win colour: the authored colour (`#rrggbb`, Invisible Game Config) of the payline
		// whose win is CURRENTLY on screen, published by `WinLine.svelte` on `winLineShow` and cleared on
		// `winLineHide`. `null` when no coloured win is showing (an un-coloured line, or no win). Any asset
		// component can read it reactively to tint itself to the winning line — the "colour-correct assets
		// to the payline win" hook. A plain reactive field, not an event, so a late-mounting component
		// still sees the colour of a win already in progress.
		winLineColor: null as string | null,
		// Win-celebration DIM (Invisible Symbols State Machine → `winCycle.dimNonWinning`). When the switch
		// is on, every symbol that is NOT part of a paying line is drawn darkened from the win celebration
		// until the next spin, so the winning line stands out. `active` gates it; `cells` marks the paying
		// cells by `reel:row` key. Both are driven from `winSymbolCycle.recordWinCycleWins` (a `winInfo`
		// refreshes the lit set, a `reveal` — the next spin — clears it) and read by `ReelSymbol` to tint
		// the losing symbols. Reassigned wholesale (see {@link setWinDim}) so the $state proxy re-renders.
		// Off ⇒ `active` never becomes true ⇒ every symbol stays full-bright (byte-parity).
		winDim: { active: false, cells: {} as Record<string, boolean> },
		// Stacked-picture reel mode (docs/design/stacked-picture-mode.md). OFF by default ⇒ the board is
		// byte-identical (empty coverage, no overlay) until the `enableStackedPictures` Flow effect turns it
		// on. The MODE is the only runtime toggle now — WHICH symbols stack, how tall each picture is, and
		// the picture art all come from the authored config (`deps.stackedConfig()`), with `deps.stackedFallback`
		// as the coded fallback. A stacked symbol ALWAYS shows its picture (even a lone one → top 1/height).
		stackedPictureMode: false,
	});

	/**
	 * THE REEL-SHAPED BEHAVIOURS, and whether they are live.
	 *
	 * Three of the flags declared just above describe things a ROLLING reel does — it holds for a
	 * tease, it stops one column at a time, it scrolls a strip of tall pictures past a window. A board
	 * that swaps in place has no roll for any of them to describe, so when {@link boardSwapsInPlace} is
	 * on they STAND DOWN (docs/design/perspective-board-mode.md §"The mode switch"). Nothing is
	 * deleted: `apps/lines` is the shared `_runtime/lines` bundle every online game runs, and `lines`
	 * and `bookOf` still roll — standing down means each behaviour reads the OFF value it already has
	 * an established path for (`buildAnticipationArming` → `undefined`, `forceSequentialStop` →
	 * falsy, the stacked readers → the strip unchanged / an empty run list), not a new branch.
	 *
	 * They live HERE, next to the flags, because each flag has several readers and gating a flag at its
	 * readers is how the readers drift. One definition each, at the source.
	 */
	const anticipationActive = () => stateGame.anticipationMode && !boardSwapsInPlace();
	const sequentialStopActive = () => stateGame.sequentialReelStop && !boardSwapsInPlace();
	const stackedPicturesActive = () => stateGame.stackedPictureMode && !boardSwapsInPlace();

	/** Key a board cell for the win-dim membership set (`reel:row`). Shared by the writer
	 *  (`winSymbolCycle`) and the reader (`ReelSymbol`) so the two can never drift on the format. */
	const winDimCellKey = (reel: number, row: number): string => `${reel}:${row}`;

	/** Publish the win-celebration dim state (see `stateGame.winDim`). Reassigns the whole object so
	 *  every reading symbol re-renders — a mutated-in-place `cells` map would not. */
	const setWinDim = (active: boolean, cells: Record<string, boolean>): void => {
		stateGame.winDim = { active, cells };
	};

	/**
	 * One tall picture to draw for the stacked-picture mode (docs/design/stacked-picture-mode.md): a
	 * contiguous run of the same eligible symbol on a settled reel. `visibleCells` (N) is the run length;
	 * `naturalCells` (M) the symbol's authored picture height (the crop denominator, ≥ N). The picture is
	 * top-anchored at `topEdgeY` in board-LOCAL space and cropped to the top N/M. All geometry is derived
	 * from the reel cell metrics, so it scales to any grid.
	 */
	/** The tall picture art for a stacked symbol (from the authored config). Mirrors a `SymbolCellInfo`
	 *  binding; absent (coded fallback) ⇒ `StackedPicture` falls back to the symbol's `stacked` state. */
	type StackedArt = {
		type: 'sprite' | 'spine' | 'flipbook';
		assetKey: string;
		animationName?: string;
		clipId?: string;
	};

	type StackedPictureRun = {
		reel: number;
		name: string;
		topRow: number;
		visibleCells: number;
		naturalCells: number;
		x: number;
		topEdgeY: number;
		/** Picture cells hidden ABOVE the visible run — the vertical crop offset. `0` ⇒ top-aligned (reveal
		 *  the top N/M), used by every full stack, a bottom-edge partial, and an interior partial. A partial
		 *  run pinned to the board's TOP edge sets this to `naturalCells - visibleCells` so the picture's
		 *  BOTTOM N/M fills the run and its top continues off-screen above — the tall symbol reads as clipped
		 *  by the reel window, not as a shorter picture. See docs/design/stacked-picture-mode.md. */
		hiddenAbove: number;
		/** The authored tall art (undefined ⇒ fall back to the `stacked` state binding). */
		art?: StackedArt;
		/** The authored WINNING tall art — what the picture becomes while this stack is part of a paying
		 *  line. Undefined ⇒ nothing to swap to, so the run draws `art` throughout (byte-parity). */
		winArt?: StackedArt;
	};

	/**
	 * The RESOLVED stacked config: which symbols stack + per-symbol height + tall art. Prefers the authored
	 * `deps.stackedConfig()` (Invisible Symbols State Machine); falls back to the coded `deps.stackedFallback`
	 * (dev / un-authored) — the coded fallback has no baked art, so `artOf` returns undefined there and the
	 * picture renders via the symbol's `stacked` state binding.
	 */
	type ResolvedStacked = {
		symbols: Set<string>;
		heightOf: (name: string) => number | undefined;
		artOf: (name: string) => StackedArt | undefined;
		/** The picture the stack swaps to while it PAYS, when one is authored. Undefined ⇒ the stack
		 *  keeps showing `artOf` through the win (how this behaved before the slot existed). */
		winArtOf: (name: string) => StackedArt | undefined;
		/** When true, a landed run shorter than the symbol's height shows the normal icons, not a cropped
		 *  tall picture (authored global toggle). Default false ⇒ partial runs crop the picture. */
		fullHeightOnly: boolean;
		/** When true, a partial run pinned to the board's TOP or BOTTOM edge renders as a CUT-OFF tall
		 *  picture (the visible slice of a symbol scrolled partly off-screen) REGARDLESS of `fullHeightOnly`
		 *  — any run length, even 1. Independent authored toggle. Default false ⇒ edge partials follow
		 *  `fullHeightOnly` like any other partial (byte-parity). See {@link docs/design/stacked-picture-mode.md}. */
		edgeCutoffs: boolean;
	};
	const resolvedStacked = (): ResolvedStacked => {
		const baked = deps.stackedConfig();
		if (baked?.symbols?.length) {
			// Plain Map/Set on purpose: rebuilt from scratch on every call and never mutated
			// afterwards, so there is nothing for SvelteMap/SvelteSet to track — they would add a
			// reactive proxy for no reader. The rule fires because this file carries runes.
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			const byName = new Map(baked.symbols.map((s) => [s.name, s]));
			return {
				// eslint-disable-next-line svelte/prefer-svelte-reactivity
				symbols: new Set(byName.keys()),
				heightOf: (name) => byName.get(name)?.height,
				artOf: (name) => byName.get(name)?.art,
				winArtOf: (name) => byName.get(name)?.winArt,
				fullHeightOnly: baked.fullHeightOnly === true,
				edgeCutoffs: baked.edgeCutoffs === true,
			};
		}
		return {
			// eslint-disable-next-line svelte/prefer-svelte-reactivity
			symbols: new Set(deps.stackedFallback.symbols),
			heightOf: (name) => deps.stackedFallback.heights[name],
			artOf: () => undefined,
			winArtOf: () => undefined,
			fullHeightOnly: false,
			edgeCutoffs: false,
		};
	};

	/**
	 * When the stacked-picture mode is on, seed a reel's SCROLL strip with natural-height BLOCKS of the
	 * stacked symbols, so tall pictures ROLL through the reel during the whole spin (not only on landing).
	 * Each stacked-symbol occurrence becomes `height` copies; everything else is untouched. OFF — or a
	 * board that swaps in place, which has no scroll for a picture to roll through ⇒ the strip is
	 * returned unchanged (byte-parity). Purely cosmetic — this is only the scroll filler (`paddingBoard`);
	 * the RESULT board (`revealEvent.board`) is separate, so a partial result still crops on landing.
	 */
	const stackedScrollStrip = (strips: RawSymbol[][]): RawSymbol[][] => {
		if (!stackedPicturesActive()) return strips;
		const { symbols, heightOf } = resolvedStacked();
		return strips.map((strip) =>
			strip.flatMap((symbol) => {
				const name = symbol.name;
				const height = heightOf(name);
				if (!symbols.has(name) || !height || height < 2) return [symbol];
				return Array.from({ length: height }, () => ({ ...symbol }));
			}),
		);
	};

	/** Scan every SETTLED reel for contiguous runs of an eligible symbol (length ≥ minRun) and turn each
	 *  into a `StackedPictureRun`. Empty when the mode is off — or stood down (see
	 *  {@link stackedPicturesActive}) — so `stackedCoverage` empties with it (byte-parity). Reads live
	 *  $state, so callers read it reactively. */
	const computeStackedRuns = (): StackedPictureRun[] => {
		if (!stackedPicturesActive()) return [];
		const rows = deps.boardDimensions().y;
		const {
			symbols: stackedSet,
			heightOf,
			artOf,
			winArtOf,
			fullHeightOnly,
			edgeCutoffs,
		} = resolvedStacked();
		const { rowPitchLocal } = boardGeometry();
		const runs: StackedPictureRun[] = [];
		stateGame.board.forEach((reel, reelIndex) => {
			const symbols = reel.reelState.symbols;
			// Two scan windows, both positioned off the LIVE `symbolY()` so the pictures move with the reel:
			//  • ROLLING (a long scrolling array: target+padding+prev) — scan the WHOLE strip so every
			//    contiguous block of a high symbol renders as a tall picture that SCROLLS through the reel
			//    (the board-window mask clips it). The scroll strip is seeded with natural-height blocks
			//    (`stackedScrollStrip`), so the tall symbols are there to roll.
			//  • SETTLED (the compact result set, length rows+2) — scan only the visible window (symbolIndex
			//    1..rows) so a partial stack CROPS to the top N/M (a padding row must not extend the run).
			const scrolling = symbols.length > rows + 2;
			const first = scrolling ? 0 : 1;
			const last = scrolling ? symbols.length - 1 : rows;
			const cap = scrolling ? symbols.length - 1 : rows;
			// The scrolling array is `[target(rows+2), filler…, prev(rows+2)]` — the RESULT chunks (target +
			// previous result) carry their own top/bottom PADDING rows. Those pads must never join a run, so a
			// result groups the SAME while rolling as when settled (window 1..rows). Otherwise a padding row
			// that happens to match the landed stack's symbol gets grouped in while rolling but not once
			// settled, and the picture SNAPS a tile at the roll↔settle boundary. The filler blocks have no
			// pads; the settled scan already excludes them via `first`/`last`, so this only guards scrolling.
			const reelLen = rows + 2;
			const isPad = (i: number): boolean =>
				scrolling &&
				(i === 0 || i === rows + 1 || i === symbols.length - reelLen || i === symbols.length - 1);
			// A run STARTING inside a RESULT chunk — the leading target block `[0, reelLen)` or the trailing
			// previous-result block `[len-reelLen, len)` — is the actual landed board, not scroll filler. Group
			// it with the SETTLED rules (honour `fullHeightOnly` + edge detection) even while the array is scrolling,
			// so the verdict for the visible result cells is identical on both sides of the settle↔roll
			// boundary. Otherwise, the instant `preSpinPadding` doubles the array (settled result parked
			// in-window, `scrolling` now true), the rolling rules re-judge that still-stationary result — a
			// partial stack flips icons↔picture (`fullHeightOnly`), a run longer than `height` splits — and the
			// grid SNAPS with no reel motion. The pad guards keep a run from crossing a chunk edge, so the
			// start index alone classifies the whole run. When not scrolling the whole compact array IS result.
			const inResultChunk = (i: number): boolean =>
				!scrolling || i < reelLen || i >= symbols.length - reelLen;
			let idx = first;
			while (idx <= last) {
				if (isPad(idx)) {
					idx += 1;
					continue;
				}
				const name = symbols[idx]?.rawSymbol.name;
				if (name == null || !stackedSet.has(name)) {
					idx += 1;
					continue;
				}
				// Cap EVERY run at the symbol's authored height, so a picture is never taller than the height the
				// Symbols tool set. A FILLER block renders as one M-tall picture (adjacent/duplicate blocks don't
				// merge into a giant one); a RESULT run LONGER than M splits into consecutive M-tall pictures —
				// any remainder shorter than M becomes a partial (cropped to top k/M, or suppressed by
				// `fullHeightOnly`) via the same path below. Capping never affects a genuine partial (run already
				// < M). Before this cap a landed run of 3+ stretched into ONE oversized picture, so the same
				// symbol rendered at different sizes depending on how many landed — the authored height was
				// ignored for over-height runs.
				const height = heightOf(name);
				const settledRun = inResultChunk(idx);
				const maxRun = height ?? Infinity;
				let end = idx;
				while (
					end + 1 <= cap &&
					!isPad(end + 1) &&
					symbols[end + 1]?.rawSymbol.name === name &&
					end - idx + 1 < maxRun
				)
					end += 1;
				const visibleCells = end - idx + 1;
				const isPartial = height !== undefined && visibleCells < height;
				// Chunk-relative EDGE detection: each RESULT chunk's visible window is `[chunkStart+1,
				// chunkStart+rows]`, so the verdict is identical while the result is parked mid-scroll and once
				// settled (no roll↔settle snap). Filler blocks (not a result chunk) never count as edge-clipped.
				const chunkStart = !scrolling ? 0 : idx < reelLen ? 0 : symbols.length - reelLen;
				const touchesTop = settledRun && idx === chunkStart + 1;
				const touchesBottom = settledRun && end === chunkStart + rows;
				// `edgeCutoffs` (authored, independent of `fullHeightOnly`): a partial run pinned to a board
				// edge reads as a tall symbol the reel window clipped — the visible slice of a picture that
				// continues off-screen — so it renders a CUT-OFF picture (any run length, even N=1) and
				// BYPASSES `fullHeightOnly`. Only meaningful for a settled result partial at an edge.
				const edgeCutoff = edgeCutoffs && isPartial && (touchesTop || touchesBottom);
				// `fullHeightOnly` (authored): a RESULT run shorter than the picture's height renders no tall
				// picture — skip it so those cells fall out of `stackedCoverage` and show their normal single
				// icons. An `edgeCutoff` is the authored exception (it shows the cut-off picture instead).
				// Applies to result chunks only — filler blocks are always full-height (seeded), so they keep
				// rolling. Default (both flags off) ⇒ every run draws cropped to top N/M, byte-identical.
				if (fullHeightOnly && settledRun && isPartial && !edgeCutoff) {
					idx = end + 1;
					continue;
				}
				// A stacked symbol ALWAYS shows its picture — even a lone one (N=1) shows the top 1/height, and
				// never its single icon. So every run of a stacked symbol draws (min run = 1).
				const naturalCells = Math.max(visibleCells, height ?? visibleCells);
				// Bottom-align a TOP-edge cut-off so the picture's BOTTOM N/M fills the run (the top M−N cells
				// run off-screen above, "as if the reel spun a few more cells"); a BOTTOM-edge cut-off keeps the
				// top N/M (its bottom runs off-screen below). Only when `edgeCutoffs` is on — otherwise every
				// run top-aligns (`hiddenAbove = 0`), byte-identical to before the toggle existed.
				let hiddenAbove = 0;
				if (edgeCutoff && touchesTop && !touchesBottom) hiddenAbove = naturalCells - visibleCells;
				runs.push({
					reel: reelIndex,
					name,
					topRow: idx,
					visibleCells,
					naturalCells,
					hiddenAbove,
					x: getSymbolX(reelIndex),
					topEdgeY: symbols[idx].symbolY() - rowPitchLocal / 2,
					art: artOf(name),
					winArt: winArtOf(name),
				});
				idx = end + 1;
			}
		});
		return runs;
	};

	const stackedRuns = $derived.by(computeStackedRuns);

	/** The stacked pictures to draw this frame (see {@link StackedPictureRun}). */
	const stackedPictureRuns = (): StackedPictureRun[] => stackedRuns;

	const stackedCoverageSet = $derived.by(() => {
		// Local accumulator returned AS the derived value — not mutated after the fact.
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const covered = new Set<string>();
		for (const run of stackedRuns)
			for (let row = run.topRow; row < run.topRow + run.visibleCells; row += 1)
				covered.add(winDimCellKey(run.reel, row));
		return covered;
	});

	/** `reel:row` keys hidden because a stacked picture covers them — read by `ReelSymbol` to skip the
	 *  single-cell art under a run (no doubling). Empty when the mode is off (byte-parity). */
	const stackedCoverage = (): Set<string> => stackedCoverageSet;

	/** The AUTHORED win-beat hold (ms) for a stacked cell, or `undefined` for the game's coded default.
	 *  A covered cell has no `<Symbol>` to report an `oncomplete`, so its win beat is a fixed wait; this
	 *  is the knob that sizes that wait to an authored `winArt` animation. */
	const stackedWinHoldMs = (): number | undefined => deps.stackedConfig()?.winHoldMs;

	/**
	 * Rebuild the board from the CURRENT active config, replacing `stateGame.board`. Called once from
	 * `Game.svelte` right after the live runtime bundle is applied (beside `resetGameConfigCache()`),
	 * so an online project whose config resolved asynchronously gets its authored grid — without this
	 * the board stays the compiled template's size, the same freeze `resetGameConfigCache` fixes for
	 * the symbol map. A no-op in effect for baked/dev (the board was already built with the right
	 * config at import), preserving parity. Safe to call at boot: no spin has run, so no reel holds
	 * in-flight animation state.
	 */
	function rebuildBoard(): void {
		// Rebuild the reels IN PLACE, preserving the array's identity — do NOT reassign `stateGame.board`
		// to a fresh array. `enhancedBoard` (createEnhanceBoard, below) closes over THIS exact array at
		// module init and drives every preSpin/spin/settle/stop by iterating it — it never re-reads
		// `stateGame.board`. A reassignment would leave the rendered board (which reads `stateGame.board`
		// live) resized to the new array while the reels that actually roll stay the old, orphaned ones —
		// so an online project's board would settle its result yet never spin. Splicing the contents keeps
		// both the render and `enhancedBoard` on the same reels.
		stateGame.board.splice(0, stateGame.board.length, ...buildBoard());
	}

	const boardLayout = () => {
		const centreX = deps.layout.mainLayout().width * 0.5;
		const centreY = deps.layout.mainLayout().height * 0.5;
		const sizes = deps.boardSizes();
		const dims = deps.boardDimensions();
		const override = resolveReelGridFromNode(
			boardOverride.node ?? undefined,
			deps.layout.layoutType(),
		);

		if (!override) {
			return {
				x: centreX,
				y: centreY,
				scale: 1,
				anchor: { x: 0.5, y: 0.5 },
				pivot: { x: sizes.width / 2, y: sizes.height / 2 },
				...sizes,
			};
		}

		const scale = override.cellSize / SYMBOL_SIZE;
		// Board POSITION = the node position + the explicit board NUDGE (fine px offset,
		// in layout units). The reel/row LEAD no longer moves the board here — it seats
		// the symbol cluster inside a fixed pivot (via getSymbolX / getSymbolLead), so
		// padding and board position are fully decoupled. Nudge default 0 ⇒ no shift.

		// The flush pivot (BOARD_SIZES/2) is the gap-LESS board centre. `getSymbolX`
		// grows the gap cumulatively rightward and the reel pitch grows it downward,
		// so without this the symbol cluster drifts off the container origin (lopsided,
		// disagreeing with the editor's symmetric footprint). Recentre the pivot on the
		// gap-extended cluster: the X cluster-centre shift is the mean reel-index extra
		// `(reels-1)/2 · columnExtraLocal`; the Y shift is the mean visible-row pitch
		// excess `(rows/2) · (rowPitchLocal − SYMBOL_SIZE)` — note the Y factor is rows/2,
		// not (rows−1)/2, because the visible rows are symbolIndex 1..rows with a −0.5
		// pitch lead, so their mean centre lands at (rows/2)·pitch (see boardGeometry()
		// + createReelForSpinning's `symbolY`). No override ⇒ both extras are 0 ⇒ pivot
		// is byte-identical to the flush case.
		const { columnExtraLocal, rowPitchLocal } = boardGeometry();
		const pivotX = sizes.width / 2 + ((dims.x - 1) / 2) * columnExtraLocal;
		const pivotY = sizes.height / 2 + (dims.y / 2) * (rowPitchLocal - SYMBOL_SIZE);

		return {
			x: override.x + override.boardNudgeX,
			y: override.y + override.boardNudgeY,
			scale,
			anchor: { x: 0.5, y: 0.5 },
			pivot: { x: pivotX, y: pivotY },
			...sizes,
		};
	};

	/**
	 * SYMBOL OVERFLOW, in board-local px — how far past the reel window the mask may reach RIGHT NOW.
	 * `{ x: 0, y: 0 }` unless a `reelGrid` node authored one AND the board is settled, which is the
	 * whole feature: the authored value says how much art may spill, this says when.
	 *
	 * WHY IT IS GATED ON MOTION rather than simply widening the mask. The board window is what hides
	 * a rolling strip, and `SymbolWrap` culls a symbol the moment its CENTRE leaves that window — so
	 * a cell entering from above is drawn only once it is already half inside, and the mask is what
	 * clips away the half that is still outside. Widen the mask while a reel rolls and that clipped
	 * half becomes visible: half a symbol blinks into existence above the board on every cell that
	 * enters, at every reel, for the length of the spin. Landed art has no such boundary to cross,
	 * so the spill is exactly as safe at rest as it is wrong in motion.
	 *
	 * SETTLED MEANS EVERY REEL, not each reel for itself, because the uniform board is masked by ONE
	 * rectangle spanning all of them: growing it while reel 4 still rolls would uncover reel 4's
	 * strip to buy reel 0 its overhang. So a staggered or anticipated stop spends the overflow when
	 * the last reel lands — which is also the first moment the board is showing a result at all.
	 *
	 * SETTLED IS `!rolling`, NOT `motion === 'stopped'` — that distinction is the whole correctness of
	 * the gate and it is not obvious. `preSpinSlideDownLoop` assigns `motion = 'spinning'` only AFTER
	 * awaiting its first slide (it shares that statement with the flip to `spin` art, which must not
	 * move), so the opening ~300 ms of every spin streams a full reel-length through the window while
	 * `motion` still reads `'stopped'`. Gated on motion the mask was therefore WIDE OPEN for exactly
	 * the most-watched moment of the spin. `rolling` is set before the pre-spin strip is even built
	 * and cleared beside `motion = 'stopped'`, so it covers the whole roll.
	 *
	 * The cascade overlay cannot use this at all, and that is not an oversight: `reelState.motion`
	 * (and `rolling`) are written ONLY by the reel's own spin loop, so on a swap-in-place board — which
	 * never spins — every reel reads settled for the entire life of the overlay, mid-fall included.
	 * The overlay answers the same question about itself instead (`TumbleBoard`'s transit counter) and
	 * passes its own allowance in.
	 */
	const boardOverflow = () => {
		const { overflowXLocal, overflowYLocal } = boardGeometry();
		if (overflowXLocal === 0 && overflowYLocal === 0) return NO_BOARD_OVERFLOW;
		const settled = stateGame.board.every((reel) => !reel.reelState.rolling);
		if (!settled) return NO_BOARD_OVERFLOW;
		return { x: overflowXLocal, y: overflowYLocal };
	};

	/**
	 * The authored spill with NO "is it safe yet" gate — for a board that owns its own answer to that
	 * question. The cascade overlay is the only such board: its symbols are not carried by a reel, so
	 * the reel-motion gate above is blind to them, and it tracks its own transiting columns instead.
	 *
	 * Split out rather than parameterising `boardOverflow` because the two callers are asking genuinely
	 * different questions, and a boolean argument would let a future caller pass the wrong one and
	 * silently uncover a rolling strip.
	 */
	const boardOverflowAuthored = () => {
		const { overflowXLocal, overflowYLocal } = boardGeometry();
		if (overflowXLocal === 0 && overflowYLocal === 0) return NO_BOARD_OVERFLOW;
		return { x: overflowXLocal, y: overflowYLocal };
	};

	const boardRaw = () =>
		stateGame.board.map((reel) => reel.reelState.symbols.map((reelSymbol) => reelSymbol.rawSymbol));

	const scatterLandIndex = () => {
		if (stateGame.scatterCounter > 5) return 5;
		if (stateGame.scatterCounter < 1) return 1;
		return stateGame.scatterCounter as 1 | 2 | 3 | 4 | 5;
	};

	const { enhanceBoard } = createEnhanceBoard();
	const enhancedBoard = enhanceBoard({ board: stateGame.board });

	const { getWinLevelDataByWinLevelAlias } = createGetWinLevelDataByWinLevelAlias({
		winLevelMap,
	});

	const stateGameDerived = {
		onSymbolLand: deps.onSymbolLand,
		boardLayout,
		boardGeometry,
		boardPerspective,
		boardSwapsInPlace,
		boardSwapStyle,
		boardColumnStaggerMs,
		boardClearsOutgoing,
		boardTileArt,
		anticipationActive,
		sequentialStopActive,
		boardWindowHeight,
		boardWindowForReel,
		boardMaskColumns,
		boardOverflow,
		boardOverflowAuthored,
		boardRaw,
		scatterLandIndex,
		enhancedBoard,
		getWinLevelDataByWinLevelAlias,
	};

	return {
		getSymbolX,
		getSymbolY,
		getSymbolSeat,
		getWinLevelDataByWinLevelAlias,
		rebuildBoard,
		setBoardOverride,
		setWinDim,
		stackedCoverage,
		stackedPictureRuns,
		stackedScrollStrip,
		stackedWinHoldMs,
		stateGame,
		stateGameDerived,
		winDimCellKey,
	};
}

/** The whole board/reel API one game instance exposes. */
export type GameStateApi = ReturnType<typeof createGameState>;

/** A single reel. Derived from the factory's own board rather than re-declared, so the type can
 *  never drift from what `buildBoard` actually produces. */
export type Reel = GameStateApi['stateGame']['board'][number];
export type ReelSymbol = Reel['reelState']['symbols'][number];
export type MultiplierSymbol = NonNullable<
	GameStateApi['stateGame']['multiplierBoard'][number][number]
>;
export type StackedPictureRun = ReturnType<GameStateApi['stackedPictureRuns']>[number];
