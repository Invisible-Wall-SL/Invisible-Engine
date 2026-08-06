import _ from 'lodash';
import type { Tween } from 'svelte/motion';

import { stateBet } from 'state-shared';
import { createEnhanceBoard, createReelForSpinning } from 'utils-slots';
import { createGetWinLevelDataByWinLevelAlias } from 'utils-shared/winLevel';
import { resolveReelGridFromNode, resolveReelSpinProfile, type ReelGridNode } from 'engine-layout';

import type { GameType, RawSymbol, SymbolState, SymbolName } from './types';
import { stateLayoutDerived } from './stateLayout';
import { winLevelMap } from './winLevelMap';
import { eventEmitter } from './eventEmitter';
import {
	SYMBOL_SIZE,
	REEL_PADDING,
	SPIN_OPTIONS_DEFAULT,
	SPIN_OPTIONS_FAST,
	INITIAL_SYMBOL_STATE,
	SCATTER_LAND_SOUND_MAP,
	STACKED_PICTURE,
} from './constants';
import { boardDimensions, boardSizes, initialBoard } from './gameConfig';

const onSymbolLand = ({ rawSymbol }: { rawSymbol: RawSymbol }) => {
	if (rawSymbol.name === 'S') {
		eventEmitter.broadcast({ type: 'soundScatterCounterIncrease' });
		eventEmitter.broadcast({
			type: 'soundOnce',
			name: SCATTER_LAND_SOUND_MAP[scatterLandIndex()],
		});
	}

	if (rawSymbol.name === 'W') {
		eventEmitter.broadcast({
			type: 'soundOnce',
			name: 'sfx_multiplier_landing',
		});
	}
};

/**
 * Editor doc's `reelGrid` node (LAYOUT ONLY) bridged in by `Game.svelte` once the
 * doc loads. `null` → the board keeps its coded constants (byte-identical parity).
 * Stored raw so `boardLayout()`/`boardGeometry()` re-resolve per-layoutType reactively.
 * Defined above `board` because the reel pitch reads `boardGeometry()` lazily.
 */
const boardOverride = $state<{ node: ReelGridNode | null }>({ node: null });

export const setBoardOverride = (node: ReelGridNode | null) => {
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
		stateLayoutDerived.layoutType(),
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
	};
};

/**
 * Reactive symbol-centre X in board-local space. Three independent contributions:
 * the reel LEAD (`reelLead` — seats the whole cluster), the non-square width + gap
 * pitch (`columnExtraLocal`), and the per-cell art SEAT ALIGNMENT (`symbolAlignX` —
 * offsets the art inside its own cell). Defaults (0.53 lead / 0.5 align) reproduce
 * the coded `SYMBOL_SIZE * (reelIndex + REEL_PADDING)`.
 */
export const getSymbolX = (reelIndex: number) => {
	const geometry = boardGeometry();
	return (
		SYMBOL_SIZE * (reelIndex + geometry.reelLead) +
		reelIndex * geometry.columnExtraLocal +
		(geometry.symbolAlignX - 0.5) * geometry.cellWidthLocal
	);
};

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
 * Build one spinning reel per column, sized + seeded from the ACTIVE game config (Invisible Game
 * Config). A FACTORY, not a module-scope const, so it can be re-run after the live runtime bundle
 * lands — see {@link rebuildBoard}: the online config resolves asynchronously AFTER this module
 * evaluates, so a board built once at import would freeze to the compiled template's grid.
 */
const buildBoard = () => {
	const init = initialBoard();
	return _.range(boardDimensions().x).map((reelIndex) => {
		const reel = createReelForSpinning({
			reelIndex,
			symbolHeight: () => boardGeometry().rowPitchLocal,
			symbolLead: () => getSymbolLead(),
			initialSymbols: init[reelIndex],
			initialSymbolState: INITIAL_SYMBOL_STATE,
			onReelStopping: () => {
				eventEmitter.broadcast({
					type: 'soundOnce',
					name: 'sfx_reel_stop_1',
					forcePlay: !stateBet.isTurbo,
				});
			},
			onSymbolLand,
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

export type Reel = ReturnType<typeof buildBoard>[number];
export type ReelSymbol = Reel['reelState']['symbols'][number];

export type MultiplierSymbol = {
	initX: number;
	initY: number;
	symbolX: Tween<number>;
	symbolY: Tween<number>;
	rawSymbol: RawSymbol;
	symbolState: SymbolState;
	oncomplete: () => void;
};

export const stateGame = $state({
	board: buildBoard(),
	gameType: 'basegame' as GameType,
	multiplierBoard: [] as (MultiplierSymbol | undefined)[][],
	scatterCounter: 0,
	specialSymbol: null as SymbolName | null,
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
	// byte-identical (empty coverage, no overlay) until the `enableStackedPictures` Flow effect turns
	// it on. `stackedPictureSymbols` overrides the config eligible set (null ⇒ config default);
	// `stackedPictureHighPayOnly` picks the default set (high pays + Wild) when there is no explicit
	// override; `stackedPictureMinRun` is the shortest run that draws a picture.
	stackedPictureMode: false,
	stackedPictureSymbols: null as string[] | null,
	stackedPictureHighPayOnly: true,
	stackedPictureMinRun: STACKED_PICTURE.minRun,
});

/** Key a board cell for the win-dim membership set (`reel:row`). Shared by the writer
 *  (`winSymbolCycle`) and the reader (`ReelSymbol`) so the two can never drift on the format. */
export const winDimCellKey = (reel: number, row: number): string => `${reel}:${row}`;

/** Publish the win-celebration dim state (see `stateGame.winDim`). Reassigns the whole object so
 *  every reading symbol re-renders — a mutated-in-place `cells` map would not. */
export const setWinDim = (active: boolean, cells: Record<string, boolean>): void => {
	stateGame.winDim = { active, cells };
};

/**
 * One tall picture to draw for the stacked-picture mode (docs/design/stacked-picture-mode.md): a
 * contiguous run of the same eligible symbol on a settled reel. `visibleCells` (N) is the run length;
 * `naturalCells` (M) the symbol's authored picture height (the crop denominator, ≥ N). The picture is
 * top-anchored at `topEdgeY` in board-LOCAL space and cropped to the top N/M. All geometry is derived
 * from the reel cell metrics, so it scales to any grid.
 */
export type StackedPictureRun = {
	reel: number;
	name: string;
	topRow: number;
	visibleCells: number;
	naturalCells: number;
	x: number;
	topEdgeY: number;
};

/** Eligible symbols for the stacked-picture mode: an explicit Flow override, else the config default
 *  set when `highPayOnly` is on, else `null` = every symbol may stack. */
const stackedEligibleSymbols = (): Set<string> | null => {
	if (stateGame.stackedPictureSymbols) return new Set(stateGame.stackedPictureSymbols);
	if (stateGame.stackedPictureHighPayOnly) return new Set(STACKED_PICTURE.symbols);
	return null;
};

/**
 * When the stacked-picture mode is on, seed a reel's SCROLL strip with natural-height BLOCKS of the
 * eligible symbols, so tall pictures ROLL through the reel during the whole spin (not only on landing).
 * Each eligible symbol occurrence becomes M copies (its natural height, `STACKED_PICTURE.heights`);
 * everything else is untouched. OFF ⇒ the strip is returned unchanged (byte-parity). Purely cosmetic —
 * this is only the scroll filler (`paddingBoard`); the RESULT board (`revealEvent.board`) is separate,
 * so a partial result still crops normally on landing.
 */
export const stackedScrollStrip = (strips: RawSymbol[][]): RawSymbol[][] => {
	if (!stateGame.stackedPictureMode) return strips;
	const eligible = stackedEligibleSymbols();
	return strips.map((strip) =>
		strip.flatMap((symbol) => {
			const name = symbol.name;
			const isEligible = name != null && (eligible === null || eligible.has(name));
			const height = STACKED_PICTURE.heights[name];
			if (!isEligible || !height || height < 2) return [symbol];
			return Array.from({ length: height }, () => ({ ...symbol }));
		}),
	);
};

/** Scan every SETTLED reel for contiguous runs of an eligible symbol (length ≥ minRun) and turn each
 *  into a `StackedPictureRun`. Empty when the mode is off (byte-parity). Reads live $state, so callers
 *  read it reactively. */
const computeStackedRuns = (): StackedPictureRun[] => {
	if (!stateGame.stackedPictureMode) return [];
	const rows = boardDimensions().y;
	const minRun = Math.max(2, Math.floor(stateGame.stackedPictureMinRun));
	const eligible = stackedEligibleSymbols();
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
		let idx = first;
		while (idx <= last) {
			if (isPad(idx)) {
				idx += 1;
				continue;
			}
			const name = symbols[idx]?.rawSymbol.name;
			const isEligible = name != null && (eligible === null || eligible.has(name));
			if (!isEligible) {
				idx += 1;
				continue;
			}
			// While scrolling, cap a run at the symbol's natural height so each strip BLOCK renders as one
			// M-tall picture (adjacent/duplicate blocks don't merge into a giant one). Settled runs are
			// never capped — a partial result crops to top N/M below.
			const maxRun = scrolling ? (STACKED_PICTURE.heights[name] ?? Infinity) : Infinity;
			let end = idx;
			while (
				end + 1 <= cap &&
				!isPad(end + 1) &&
				symbols[end + 1]?.rawSymbol.name === name &&
				end - idx + 1 < maxRun
			)
				end += 1;
			const visibleCells = end - idx + 1;
			if (visibleCells >= minRun) {
				const natural = STACKED_PICTURE.heights[name];
				const naturalCells = Math.max(visibleCells, natural ?? visibleCells);
				runs.push({
					reel: reelIndex,
					name,
					topRow: idx,
					visibleCells,
					naturalCells,
					x: getSymbolX(reelIndex),
					topEdgeY: symbols[idx].symbolY() - rowPitchLocal / 2,
				});
			}
			idx = end + 1;
		}
	});
	return runs;
};

const stackedRuns = $derived.by(computeStackedRuns);

/** The stacked pictures to draw this frame (see {@link StackedPictureRun}). */
export const stackedPictureRuns = (): StackedPictureRun[] => stackedRuns;

const stackedCoverageSet = $derived.by(() => {
	const covered = new Set<string>();
	for (const run of stackedRuns)
		for (let row = run.topRow; row < run.topRow + run.visibleCells; row += 1)
			covered.add(winDimCellKey(run.reel, row));
	return covered;
});

/** `reel:row` keys hidden because a stacked picture covers them — read by `ReelSymbol` to skip the
 *  single-cell art under a run (no doubling). Empty when the mode is off (byte-parity). */
export const stackedCoverage = (): Set<string> => stackedCoverageSet;

/**
 * Rebuild the board from the CURRENT active config, replacing `stateGame.board`. Called once from
 * `Game.svelte` right after the live runtime bundle is applied (beside `resetGameConfigCache()`),
 * so an online project whose config resolved asynchronously gets its authored grid — without this
 * the board stays the compiled template's size, the same freeze `resetGameConfigCache` fixes for
 * the symbol map. A no-op in effect for baked/dev (the board was already built with the right
 * config at import), preserving parity. Safe to call at boot: no spin has run, so no reel holds
 * in-flight animation state.
 */
export function rebuildBoard(): void {
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
	const centreX = stateLayoutDerived.mainLayout().width * 0.5;
	const centreY = stateLayoutDerived.mainLayout().height * 0.5;
	const sizes = boardSizes();
	const dims = boardDimensions();
	const override = resolveReelGridFromNode(
		boardOverride.node ?? undefined,
		stateLayoutDerived.layoutType(),
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

const boardRaw = () =>
	stateGame.board.map((reel) => reel.reelState.symbols.map((reelSymbol) => reelSymbol.rawSymbol));

const scatterLandIndex = () => {
	if (stateGame.scatterCounter > 5) return 5;
	if (stateGame.scatterCounter < 1) return 1;
	return stateGame.scatterCounter as 1 | 2 | 3 | 4 | 5;
};

const { enhanceBoard } = createEnhanceBoard();
const enhancedBoard = enhanceBoard({ board: stateGame.board });

export const { getWinLevelDataByWinLevelAlias } = createGetWinLevelDataByWinLevelAlias({
	winLevelMap,
});

export const stateGameDerived = {
	onSymbolLand,
	boardLayout,
	boardGeometry,
	boardRaw,
	scatterLandIndex,
	enhancedBoard,
	getWinLevelDataByWinLevelAlias,
};
