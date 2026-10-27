/**
 * Types for the match-3 board (`board.js`, `docs/design/game-families.md` §4.1). The module is
 * plain JS — see the package's `index.ts` for why — so its contract is declared here. The behaviour
 * is pinned by `scripts/check-board-mechanic.mjs`.
 *
 * `Gem` and `Cell` mirror engine-game's `RawSymbol` and `Position` structurally, so a board's
 * columns and a step's event drop straight into the cascade presentation; this package stays
 * dependency-free.
 */

/** A gem on the board: engine-game's `RawSymbol`. Extra fields ride along untouched. */
export type Gem = { name: string; [field: string]: unknown };

/** A cell: engine-game's `Position`. Row 0 is the top. */
export type Cell = { reel: number; row: number };

/** A random draw in [0, 1). */
export type Rng = () => number;

/** One column's refill strip: names, or a config's `{ name }` strip cells. */
export type Strip = readonly (string | { name: string })[];

/** How a group of matched gems is shaped. `line5` is five or more; `line2` only when `minRun` is 2;
 *  `T` also covers a plus and any larger merged shape. */
export type MatchShape = 'line2' | 'line3' | 'line4' | 'line5' | 'L' | 'T';

export type MatchGroup = { symbol: string; cells: Cell[]; shape: MatchShape };

export type Board = {
	readonly cols: number;
	readonly rows: number;
	readonly minRun: number;
	/** Column-major `cells[reel][row]`; `null` is a hole between `clear` and `refill`. */
	readonly cells: (Gem | null)[][];
	/** The pool as names, one strip per column; `null` when the board was given no pool. */
	readonly strips: string[][] | null;
	/** `null` on an RGS-decided board: every local draw throws. */
	readonly rng: Rng | null;
};

export type CreateBoardOptions = {
	cols: number;
	rows: number;
	/** One refill strip per column (a config's `paddingReels` set). Needed to deal or to refill from
	 *  the pool. */
	pool?: readonly Strip[] | null;
	/** The board's seeded draw. `null` (the default) for an RGS-decided board. */
	rng?: Rng | null;
	/** The board to start from, column-major. Absent ⇒ dealt from `pool` with `rng`. */
	cells?: readonly (readonly (Gem | null)[])[];
	/** Fewest gems in a row or column that match. Default {@link DEFAULT_MIN_RUN}. */
	minRun?: number;
};

/** A book's `newSymbols`: one array per column, top first. */
export type BookRefill = readonly (readonly Gem[])[];

export type RefillSource = 'pool' | BookRefill;

/** A gem that fell from row `from` to row `to` of its reel. */
export type Fall = { reel: number; from: number; to: number };

/** A `tumbleBoard` book event, without the `index` the caller numbers it with. */
export type TumbleBoardStep = {
	type: 'tumbleBoard';
	explodingSymbols: Cell[];
	newSymbols: Gem[][];
};

export type CascadeStep = { event: TumbleBoardStep; groups: MatchGroup[]; falls: Fall[] };

export type Move = { from: Cell; to: Cell };

export const DEFAULT_MIN_RUN: 3;

/** mulberry32; a string seed is hashed (FNV-1a) first. */
export function createRng(seed: number | string): Rng;

/** The 32-bit state `createRng(seed)` starts from. */
export function rngSeed(seed: number | string): number;

/** One step of `createRng`'s generator as a pure function: the draw in [0, 1) and the next state. */
export function rngNext(state: number): { value: number; state: number };

/** From `cells`, or dealt from `pool` at seeded stops with no match and at least one move. Throws
 *  on a malformed board or pool, and when the strips cannot deal a playable board. */
export function createBoard(options: CreateBoardOptions): Board;

export function canSwap(board: Board, a: Cell, b: Cell): boolean;

/** Trades two cells without checking the swap is legal. Throws outside the board. */
export function swap(board: Board, a: Cell, b: Cell): Board;

/** Throws on a `minRun` below 2. */
export function findMatches(board: Board, options?: { minRun?: number }): MatchGroup[];

export function clear(board: Board, groups: readonly MatchGroup[]): Board;

export function gravity(board: Board): { board: Board; moves: Fall[] };

/** Throws when a hole sits below a gem, when a book refill does not fit the holes, and on a pool
 *  refill of a board with no pool or no rng. */
export function refill(board: Board, source: RefillSource): { board: Board; newSymbols: Gem[][] };

/** The cascade loop. `source` is `'pool'` or the book's refills, one per step; a book with more or
 *  fewer refills than the chain has steps throws. */
export function resolve(
	board: Board,
	options?: { source?: 'pool' | readonly BookRefill[]; minRun?: number; maxSteps?: number },
): { board: Board; steps: CascadeStep[] };

export function findMoves(board: Board, options?: { minRun?: number; limit?: number }): Move[];

export function hasMoves(board: Board, options?: { minRun?: number }): boolean;

/** Throws on an RGS board (`rng: null`) even when an `rng` is passed, and when no arrangement of
 *  the gems is playable. */
export function shuffle(board: Board, rng?: Rng | null): Board;
