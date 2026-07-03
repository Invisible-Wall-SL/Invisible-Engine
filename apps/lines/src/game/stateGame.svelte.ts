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
	BOARD_SIZES,
	REEL_PADDING,
	INITIAL_BOARD,
	BOARD_DIMENSIONS,
	SPIN_OPTIONS_DEFAULT,
	SPIN_OPTIONS_FAST,
	INITIAL_SYMBOL_STATE,
	SCATTER_LAND_SOUND_MAP,
} from './constants';

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
 * pitch (drives `createReelForSpinning`'s reactive `symbolHeight`); `cellWidthLocal`/
 * `cellHeightLocal` = the per-cell contain box; plus the reel/row LEAD, per-cell SEAT
 * ALIGNMENT and board NUDGE consumed by `getSymbolX`/`getSymbolLead`/`boardLayout`. No
 * node ⇒ coded lead (0.53/0.5), centred seats, no nudge = byte-identical parity.
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

const board = _.range(BOARD_DIMENSIONS.x).map((reelIndex) => {
	const reel = createReelForSpinning({
		reelIndex,
		symbolHeight: () => boardGeometry().rowPitchLocal,
		symbolLead: () => getSymbolLead(),
		initialSymbols: INITIAL_BOARD[reelIndex],
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
		return override ? { ...base, ...override } : base;
	};

	return reel;
});

export type Reel = (typeof board)[number];
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
	board,
	gameType: 'basegame' as GameType,
	multiplierBoard: [] as (MultiplierSymbol | undefined)[][],
	scatterCounter: 0,
	specialSymbol: null as SymbolName | null,
});

const boardLayout = () => {
	const centreX = stateLayoutDerived.mainLayout().width * 0.5;
	const centreY = stateLayoutDerived.mainLayout().height * 0.5;
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
			pivot: { x: BOARD_SIZES.width / 2, y: BOARD_SIZES.height / 2 },
			...BOARD_SIZES,
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
	const pivotX = BOARD_SIZES.width / 2 + ((BOARD_DIMENSIONS.x - 1) / 2) * columnExtraLocal;
	const pivotY = BOARD_SIZES.height / 2 + (BOARD_DIMENSIONS.y / 2) * (rowPitchLocal - SYMBOL_SIZE);

	return {
		x: override.x + override.boardNudgeX,
		y: override.y + override.boardNudgeY,
		scale,
		anchor: { x: 0.5, y: 0.5 },
		pivot: { x: pivotX, y: pivotY },
		...BOARD_SIZES,
	};
};

const boardRaw = () =>
	board.map((reel) => reel.reelState.symbols.map((reelSymbol) => reelSymbol.rawSymbol));

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
