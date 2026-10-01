import {
	createRespinBoard,
	releasedCells,
	respinCellKey,
	respinSeedBoard,
	respinSpins,
	type HoldAndWinCell,
	type RawSymbol,
	type RespinBoard,
	type SymbolState,
} from 'engine-game';
import { symbolsWithRole } from 'game-config';
import { stateBet } from 'state-shared';

import { eventEmitter } from './eventEmitter';
import { boardDimensions, getActiveGameConfig, getPaddingReels } from './gameConfig';
import { playReelStopSound } from './soundBindings';
import { cellSymbolLead, stateGameDerived } from './stateGame.svelte';
import { stateHoldAndWin } from './stateHoldAndWin.svelte';

/**
 * THE RESPIN BOARD, as this game wires it — the one-cell reels from `engine-game`
 * (`createRespinBoard`) on this game's seats, strips and sounds, plus the HELD layer and the respin
 * counter (design §4.2 of `docs/design/hold-and-win.md`). What a beat does to it lives in
 * `holdAndWinPresentation.ts`; `RespinBoard.svelte` only draws it.
 *
 * NOTHING EXISTS UNTIL A FEATURE DOES. The reels are built the first time the board is shown, so a
 * game that never receives a Hold and Win event never constructs one; until then this module is a
 * few empty fields.
 */
export const stateRespinBoard = $state({
	/** Is the respin board up in place of the reel board? */
	shown: false,
	/**
	 * What the held layer draws. A COPY of `stateHoldAndWin.cells`, taken at the beats that move a
	 * cell in or out ({@link syncHeldCells}) rather than read live, because the feature's END clears
	 * the picture while the board is still on screen showing what it paid.
	 */
	held: [] as HoldAndWinCell[],
	/** A held cell's presentation state, by `respinCellKey` — `land` while it sticks, else `static`. */
	heldState: {} as Record<string, SymbolState>,
	counter: { show: false, left: 0, start: 0, resets: 0 },
});

let board = $state.raw<RespinBoard | null>(null);

/** The respin board's reels, or `null` before the first feature built them. */
export const currentRespinBoard = (): RespinBoard | null => board;

/** The empty cell: the symbol the Game Config tags `blank`, else the wire's literal `BLANK`. */
export const respinBlank = (): string =>
	symbolsWithRole(getActiveGameConfig(), 'blank')[0] ?? 'BLANK';

/** The strip a cell of column `reel` rolls through — the config's `respin` strips. */
const respinStrip = (reel: number): RawSymbol[] => {
	const strips = getPaddingReels('respin');
	return (strips[reel] ?? strips[0] ?? []) as RawSymbol[];
};

/** Columns that have already sounded their stop on the current respin — one stop cue per column. */
let soundedColumns: number[] = [];

const onCellStopping = (reel: number) => {
	if (soundedColumns.includes(reel)) return;
	soundedColumns = [...soundedColumns, reel];
	playReelStopSound(reel, stateBet.isTurbo);
};

/** The reels, built (or rebuilt for a board whose size changed) on first use. */
const ensureBoard = (): RespinBoard => {
	const { x: reels, y: rows } = boardDimensions();
	if (board && board.reels === reels && board.rows === rows) return board;
	board = createRespinBoard({
		reels,
		rows,
		symbolHeight: () => stateGameDerived.boardGeometry().rowPitchLocal,
		symbolLead: cellSymbolLead,
		initial: respinSeedBoard({ reels, rows, held: [], blank: respinBlank() }),
		blank: respinBlank,
		onCellStopping: (reel) => onCellStopping(reel),
	});
	return board;
};

/**
 * Bring the held layer in line with the client's picture of the feature. A cell that left it (a
 * streak's collect, a column sweep, a server snapshot correcting us) has its reel settled back to
 * the blank — its reel still shows whatever it last landed on, and that is what would reappear.
 */
export const syncHeldCells = () => {
	const next = $state.snapshot(stateHoldAndWin.cells);
	for (const { reel, row } of releasedCells(stateRespinBoard.held, next)) {
		board?.settleCell(reel, row, { name: respinBlank() });
		delete stateRespinBoard.heldState[respinCellKey(reel, row)];
	}
	stateRespinBoard.held = next;
};

/**
 * Swap the reel board out and the respin board in, held cells and all. `seedFromBaseBoard`: every
 * free cell starts on the symbol the base board shows there, so the swap is invisible and the
 * triggering coins stay exactly where they landed. Without it (a resume) every free cell is blank.
 * Idempotent: on a board that is already up it only re-syncs the held layer.
 */
export const showRespinBoard = ({ seedFromBaseBoard }: { seedFromBaseBoard: boolean }) => {
	if (stateRespinBoard.shown) {
		syncHeldCells();
		return;
	}
	const respinBoard = ensureBoard();
	stateRespinBoard.held = $state.snapshot(stateHoldAndWin.cells);
	stateRespinBoard.heldState = {};
	const baseBoard = seedFromBaseBoard ? stateGameDerived.boardRaw() : undefined;
	respinBoard.settle(
		respinSeedBoard({
			reels: respinBoard.reels,
			rows: respinBoard.rows,
			held: stateRespinBoard.held,
			blank: respinBlank(),
			// `boardRaw` is the PADDED strip: visible row 0 is index 1.
			seed: baseBoard ? (reel, row) => baseBoard[reel]?.[row + 1] : undefined,
		}),
	);
	stateRespinBoard.shown = true;
	eventEmitter.broadcast({ type: 'boardHide' });
};

/** Swap back to the reel board. The held layer empties with it. */
export const hideRespinBoard = () => {
	if (!stateRespinBoard.shown) return;
	stateRespinBoard.shown = false;
	stateRespinBoard.held = [];
	stateRespinBoard.heldState = {};
	stateRespinBoard.counter.show = false;
	eventEmitter.broadcast({ type: 'boardShow' });
};

/** Spin every free cell onto what `cells` names for it; resolves when the last one has landed. */
export const spinRespinCells = async (cells: HoldAndWinCell[]) => {
	if (!board || !stateRespinBoard.shown) return;
	soundedColumns = [];
	await board.spin({
		spins: respinSpins({
			reels: board.reels,
			rows: board.rows,
			held: stateRespinBoard.held,
			reveal: cells,
			blank: respinBlank(),
		}),
		padding: respinStrip,
	});
};

/** Pending beats of held cells, resolved by the cell's `oncomplete`. Never read reactively. */
const heldBeats: Record<string, () => void> = {};

/** Put these held cells on `land` and return their keys, for the caller to arm and await. */
export const startHeldLand = (cells: HoldAndWinCell[]): string[] =>
	cells.map((cell) => {
		const key = respinCellKey(cell.reel, cell.row);
		stateRespinBoard.heldState[key] = 'land';
		return key;
	});

/** Arm a held cell's beat: the next completion it reports resolves `resolve`. */
export const armHeldBeat = (key: string, resolve: () => void) => {
	heldBeats[key] = resolve;
};

/** A held cell reported its animation complete: a `land` settles to `static`, its beat resolves. */
export const completeHeldBeat = (key: string) => {
	if (stateRespinBoard.heldState[key] === 'land') stateRespinBoard.heldState[key] = 'static';
	const resolve = heldBeats[key];
	delete heldBeats[key];
	resolve?.();
};

/** Settle every held cell still on `land` — a beat whose cap won must not leave a cell mid-state. */
export const settleHeldLand = () => {
	for (const key of Object.keys(stateRespinBoard.heldState)) {
		if (stateRespinBoard.heldState[key] === 'land') stateRespinBoard.heldState[key] = 'static';
		delete heldBeats[key];
	}
};
