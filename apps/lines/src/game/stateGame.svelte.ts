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
});

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
	stateGame.board.map((reel) =>
		reel.reelState.symbols.map((reelSymbol) => reelSymbol.rawSymbol),
	);

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
