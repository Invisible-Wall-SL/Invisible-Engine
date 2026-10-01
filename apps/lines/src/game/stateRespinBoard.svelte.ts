import { Tween } from 'svelte/motion';
import {
	createRespinBoard,
	releasedCells,
	respinCellKey,
	respinSeedBoard,
	respinSpins,
	type HoldAndWinCell,
	type Position,
	type RawSymbol,
	type RespinBoard,
	type SymbolState,
} from 'engine-game';
import { TERMINAL_SYMBOL_STATES } from 'engine-layout';
import { symbolsWithRole } from 'game-config';
import { stateBet } from 'state-shared';

import { eventEmitter } from './eventEmitter';
import { activeGrid, boardDimensions, getActiveGameConfig, getPaddingReels } from './gameConfig';
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
/** A count-up in flight on a held cell's label: which field it stands in for, and its tween. */
export type HeldDisplay = { field: 'value' | 'factor'; tween: Tween<number> };

export const stateRespinBoard = $state({
	/** Is the respin board up in place of the reel board? */
	shown: false,
	/**
	 * What the held layer draws. A COPY of `stateHoldAndWin.cells`, taken at the beats that move a
	 * cell in or out ({@link syncHeldCells}) rather than read live, because the feature's END clears
	 * the picture while the board is still on screen showing what it paid.
	 */
	held: [] as HoldAndWinCell[],
	/**
	 * A held cell's presentation state, by `respinCellKey` — a beat's state while it plays
	 * (`coinStick` as it sticks, `coinBoost` as a special applies, `coinCollect` as a coin is
	 * collected, `jackpotReveal` as a jackpot lights, `mysteryReveal` as a mystery opens, `clearReel`
	 * as a streak clears), else {@link HELD_REST}.
	 */
	heldState: {} as Record<string, SymbolState>,
	/**
	 * What a held cell's LABEL reads while a count-up runs, by `respinCellKey` — the value (or a
	 * jackpot's factor) on its way from what the cell showed to what the server says it is now.
	 * Presentation only: the recorded picture already holds the final value the moment the event is
	 * played, and the label falls back to it when the count ends ({@link releaseHeldDisplay}).
	 */
	heldDisplay: {} as Record<string, HeldDisplay>,
	counter: { show: false, left: 0, start: 0, resets: 0 },
});

let board = $state.raw<RespinBoard | null>(null);

/** The respin board's reels, or `null` before the first feature built them. */
export const currentRespinBoard = (): RespinBoard | null => board;

/** The empty cell: the symbol the Game Config tags `blank`, else the wire's literal `BLANK`. */
export const respinBlank = (): string =>
	symbolsWithRole(getActiveGameConfig(), 'blank')[0] ?? 'BLANK';

/**
 * The strip a cell of column `reel` rolls through — the config's AUTHORED `respin` strips (every
 * Hold and Win preset authors them: coins, specials and blanks), else the base game's, so a config
 * without them still visibly spins. Read from the config even when the RGS is authoritative: the
 * generated in-play strip (`getPaddingReels`) is every symbol once, so the cells rolled the base
 * game's pictures — art a respin can never land, sliced at every cell edge by the one-row window.
 */
const respinStrip = (reel: number): RawSymbol[] => {
	const respin = getActiveGameConfig().paddingReels.respin ?? [];
	const strips = respin.length > 0 ? respin : getPaddingReels('basegame');
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
		initial: respinSeedBoard({ reels, rows, blank: respinBlank() }),
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
		delete stateRespinBoard.heldDisplay[respinCellKey(reel, row)];
	}
	stateRespinBoard.held = next;
};

/**
 * Swap the reel board out and the respin board in, held cells and all: the coins stay exactly where
 * they landed and every other cell is blank, so the swap shows in the same frame as the counter.
 * Idempotent: on a board that is already up it only re-syncs the held layer.
 */
export const showRespinBoard = () => {
	if (stateRespinBoard.shown) {
		syncHeldCells();
		return;
	}
	const respinBoard = ensureBoard();
	stateRespinBoard.held = $state.snapshot(stateHoldAndWin.cells);
	stateRespinBoard.heldState = {};
	stateRespinBoard.heldDisplay = {};
	respinBoard.settle(
		respinSeedBoard({ reels: respinBoard.reels, rows: respinBoard.rows, blank: respinBlank() }),
	);
	stateRespinBoard.shown = true;
};

/**
 * Put the reel board, still hidden under the respin board, at rest on the feature's FINAL board: each
 * held coin on its seat, every other cell blank. Without it the reels come back on the trigger spin's
 * board (or the boot board after a resume), so the big win that follows plays over a board the
 * feature had long replaced. The reels' strips are padded — one row above and below the window.
 */
export const settleReelsOnHeldCells = () => {
	const grid = activeGrid();
	const held = Object.fromEntries(
		$state
			.snapshot(stateRespinBoard.held)
			.map((cell) => [respinCellKey(cell.reel, cell.row), cell.symbol]),
	);
	const blank = (): RawSymbol => ({ name: respinBlank() });
	const board = Array.from({ length: grid.reels }, (_r, reel) => [
		blank(),
		...Array.from(
			{ length: grid.rowsForReel(reel) },
			(_c, row) => held[respinCellKey(reel, row)] ?? blank(),
		),
		blank(),
	]);
	eventEmitter.broadcast({ type: 'boardSettle', board });
};

/** Swap back to the reel board. The held layer empties with it. Announced here rather than by the
 *  end beat, so the safety net in `presentReveal` (a feature whose end never arrived) is heard too. */
export const hideRespinBoard = () => {
	if (!stateRespinBoard.shown) return;
	stateRespinBoard.shown = false;
	stateRespinBoard.held = [];
	stateRespinBoard.heldState = {};
	stateRespinBoard.heldDisplay = {};
	stateRespinBoard.counter.show = false;
	eventEmitter.broadcast({ type: 'respinBoardHide' });
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

/** What a held cell plays between beats. Unauthored it inherits `static`. */
export const HELD_REST: SymbolState = 'coinIdle';

/** Pending beats of held cells, resolved by the cell's `oncomplete`. Never read reactively. */
const heldBeats: Record<string, () => void> = {};

/**
 * Put the held cells at these positions on `state` and return their keys, for the caller to arm and
 * await. A position the held layer does not draw is skipped — nothing there could ever report.
 */
export const startHeldBeat = (cells: Position[], state: SymbolState): string[] => {
	const held = stateRespinBoard.held.map((cell) => respinCellKey(cell.reel, cell.row));
	return cells
		.map((cell) => respinCellKey(cell.reel, cell.row))
		.filter((key, i, keys) => held.includes(key) && keys.indexOf(key) === i)
		.map((key) => {
			stateRespinBoard.heldState[key] = state;
			return key;
		});
};

/** Arm a held cell's beat: the next completion it reports resolves `resolve`. */
export const armHeldBeat = (key: string, resolve: () => void) => {
	heldBeats[key] = resolve;
};

/**
 * The states a held cell plays on its way OUT — a mystery opening before it becomes something else,
 * a streak's coin leaving. They are not settled back to {@link HELD_REST} (that would show the old
 * symbol again for a frame); the sync that follows replaces or removes the cell.
 */
const TERMINAL_STATES: ReadonlySet<string> = new Set(TERMINAL_SYMBOL_STATES);

const settles = (state: SymbolState | undefined, terminal: boolean) =>
	state !== undefined && state !== HELD_REST && (terminal || !TERMINAL_STATES.has(state));

/** A held cell reported its animation complete: its beat state settles to {@link HELD_REST} (a
 *  terminal one holds), its beat resolves. */
export const completeHeldBeat = (key: string) => {
	if (settles(stateRespinBoard.heldState[key], false)) stateRespinBoard.heldState[key] = HELD_REST;
	const resolve = heldBeats[key];
	delete heldBeats[key];
	resolve?.();
};

/**
 * Settle these held cells back to {@link HELD_REST} — a beat whose cap or a slam won must not leave a
 * cell mid-state. A terminal state holds unless `terminal` (a cell that played its way out and was not,
 * after all, replaced or removed).
 */
export const settleHeldBeats = (keys: string[], { terminal = false } = {}) => {
	for (const key of keys) {
		if (settles(stateRespinBoard.heldState[key], terminal)) {
			stateRespinBoard.heldState[key] = HELD_REST;
		}
		delete heldBeats[key];
	}
};

/**
 * Start a count-up on a held cell's label at `from` and return its tween; the caller moves it
 * (`tween.set`) and ends it with {@link releaseHeldDisplay}. A count already running on that cell is
 * replaced — the newest beat owns the label.
 */
export const holdHeldDisplay = (key: string, field: HeldDisplay['field'], from: number) => {
	const tween = new Tween(from);
	stateRespinBoard.heldDisplay[key] = { field, tween };
	return tween;
};

/** End a count-up: the label reads the cell's recorded value again. A no-op if a later count (or a
 *  board that came down) already replaced this one. */
export const releaseHeldDisplay = (key: string, tween: Tween<number>) => {
	if (stateRespinBoard.heldDisplay[key]?.tween === tween) delete stateRespinBoard.heldDisplay[key];
};
