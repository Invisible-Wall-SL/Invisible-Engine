import {
	canSwap,
	createBoard,
	findMoves,
	resolve,
	swap,
	type Board,
	type BookRefill,
	type Cell,
	type Gem,
	type MatchGroup,
	type Move,
} from 'engine-mechanics';

import { MATCH3_PAD_ROWS, type Match3MoveResult, type Match3Step } from './match3Session';

/**
 * An RGS-decided match-3 game's board (`docs/design/game-families.md` §2.2): a MIRROR of the
 * server's. The server deals every board, picks every refill and prices every win; this session
 * only shows what it sent.
 *
 * - **No local RNG** (guarantee #1): the board is built with `rng: null`, so a local deal, pool
 *   refill or shuffle throws, and so do this session's `deal`, `resolveNow` and `shuffle`.
 * - **The pre-check is UX only:** a swap the server's own board cannot match is refused here without
 *   a request (it would be refused there too, and change nothing); every other swap is the server's
 *   to judge.
 * - **Consistency check, not authority** (guarantee #4): the move is replayed locally on the
 *   mirror with the server's own refills, and any difference from what the server exploded or
 *   settled on is reported as a wire bug. The server's board is kept either way.
 *
 * Book events arrive in the engine shapes the facade translates them to (`docs/reference/
 * match3-wire.md`, "Engine book events"); this module reads only the fields it needs, so it stays
 * free of the game's book-event union.
 */

type BookEvent = { type: string; [field: string]: unknown };

export type Match3RgsMoveRequest = (from: Cell, to: Cell) => Promise<readonly BookEvent[]>;

export type Match3RgsSession = ReturnType<typeof createMatch3RgsSession>;

const SERVER_OWNS_IT =
	'an RGS-decided match-3 board takes every gem from the server: nothing deals, refills or shuffles it locally';

const visibleCell = (cell: Cell): Cell => ({ reel: cell.reel, row: cell.row - MATCH3_PAD_ROWS });
const cellKey = (cell: Cell) => `${cell.reel}:${cell.row}`;
const sameCells = (a: readonly Cell[], b: readonly Cell[]) => {
	const keys = new Set(a.map(cellKey));
	return keys.size === new Set(b.map(cellKey)).size && b.every((cell) => keys.has(cellKey(cell)));
};
const boardNames = (cells: Board['cells']) => cells.map((reel) => reel.map((gem) => gem?.name));
const sameBoard = (a: Board['cells'], b: Board['cells']) =>
	JSON.stringify(boardNames(a)) === JSON.stringify(boardNames(b));

const mirror = (cells: readonly (readonly Gem[])[], minRun: number): Board =>
	createBoard({ cols: cells.length, rows: cells[0]?.length ?? 0, cells, minRun, rng: null });

export function createMatch3RgsSession({
	board: cells,
	movesLeft,
	minRun,
	requestMove,
	onMismatch = (message) => console.warn(`[match3] wire mismatch: ${message}`),
}: {
	/** The round's first board, from `boardInit` (visible rows, column-major). */
	board: readonly (readonly Gem[])[];
	movesLeft: number;
	minRun: number;
	requestMove: Match3RgsMoveRequest;
	onMismatch?: (message: string) => void;
}) {
	let board = mirror(cells, minRun);
	let moves = movesLeft;

	const refused = (from: Cell, to: Cell): Match3MoveResult => ({
		accepted: false,
		swapped: swap(board, from, to),
		steps: [],
		board,
		points: 0,
		noMoves: false,
	});

	/** The move replayed on the mirror with the server's refills: each step's groups and the board
	 *  it settles on, or `undefined` when the server's chain does not replay here (a mismatch,
	 *  already reported). */
	const replay = (
		swapped: Board,
		steps: { event: BookEvent }[],
	): { groups: MatchGroup[][]; board: Board } | undefined => {
		const refills = steps.map((step) => step.event.newSymbols as BookRefill);
		try {
			const local = resolve(swapped, { source: refills });
			steps.forEach((step, index) => {
				const sent = (step.event.explodingSymbols as Cell[]).map(visibleCell);
				if (!sameCells(sent, local.steps[index]?.event.explodingSymbols ?? []))
					onMismatch(`step ${index + 1} exploded other cells than the board's own rules match`);
			});
			return { groups: local.steps.map((step) => step.groups), board: local.board };
		} catch (error) {
			onMismatch(`the move does not replay on the board: ${(error as Error).message}`);
			return undefined;
		}
	};

	return {
		get board() {
			return board;
		},
		/** The moves the server says the round has left. */
		get movesLeft() {
			return moves;
		},
		/** What a round starts with: the server's moves; an RGS round has no score goal. */
		ready: () => ({ moves, target: 0 }),
		deal: (): Board => {
			throw new Error(SERVER_OWNS_IT);
		},
		resolveNow: (): never => {
			throw new Error(SERVER_OWNS_IT);
		},
		shuffle: (): Board => {
			throw new Error(SERVER_OWNS_IT);
		},
		canSwap: (a: Cell, b: Cell) => canSwap(board, a, b),
		hint: (): Move | undefined => findMoves(board, { limit: 1 })[0],
		/**
		 * Ask the server to swap `from` and `to`. A swap the board cannot match is refused here, with no
		 * request. Rejects when the request fails, leaving the board as it was.
		 */
		trySwap: async (from: Cell, to: Cell): Promise<Match3MoveResult> => {
			if (!canSwap(board, from, to)) return refused(from, to);
			const book = await requestMove(from, to);
			const swapEvent = book.find((event) => event.type === 'swap');
			if (!swapEvent?.accepted) return refused(from, to);

			const swapped = swap(board, from, to);
			const steps: { event: BookEvent; tail: BookEvent[] }[] = [];
			const tail: BookEvent[] = [];
			for (const event of book) {
				if (event === swapEvent) continue;
				if (event.type === 'tumbleBoard') steps.push({ event, tail: [] });
				else if (event.type === 'updateTumbleWin' && steps.length && !tail.length)
					steps[steps.length - 1].tail.push(event);
				else tail.push(event);
			}
			const local = replay(swapped, steps);

			const settled = tail.find((event) => event.type === 'movesLeft');
			if (settled) {
				moves = Number(settled.count) || 0;
				const next = mirror(settled.board as Gem[][], minRun);
				if (local && !sameBoard(local.board.cells, next.cells))
					onMismatch('the server settled on another board than its own refills make');
				board = next;
			} else if (local) {
				onMismatch('the move sent no settled board; the board its refills make is kept');
				board = local.board;
			}

			const played: Match3Step[] = steps.map((step, index) => ({
				step: index + 1,
				groups: local?.groups[index] ?? [],
				points: 0,
				event: {
					type: 'tumbleBoard',
					explodingSymbols: step.event.explodingSymbols as Cell[],
					newSymbols: step.event.newSymbols as Gem[][],
				},
				tail: step.tail,
			}));
			return { accepted: true, swapped, steps: played, board, points: 0, noMoves: false, tail };
		},
	};
}
