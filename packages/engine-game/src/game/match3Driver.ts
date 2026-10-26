import type { Board, Cell } from 'engine-mechanics';

import type { Match3MoveResult, Match3Session, Match3Step } from './match3Session';

/**
 * A rules-decided match-3 game's MOVES (`docs/design/game-families.md` §2.3, §3.4): what a tap, a
 * swap or a flow action does to the session, in what order the board's Flow signals are raised, and
 * when input is taken. Plain logic: the runtime (`apps/lines` `match3.svelte.ts`) supplies the
 * presentation — the flight layer, the cascade overlay — and the headless `check:match3-rules`
 * gate supplies none, so both run this very code.
 *
 * The signals, per move: `swap` once the swap has played (accepted or not); for each cascade step
 * `match` (before the explosion, with its points) and `cascadeStep` (after the refill landed);
 * then `settled`, and `noMoves` when no swap is left. A deal raises `boardReady`.
 */

/** The cell states a match-3 board draws besides `static` (`engine-layout` `MATCH3_SYMBOL_STATES`). */
export type Match3Mark = 'select' | 'hint' | 'static';

/** How the runtime shows what the driver did. Every method may be a no-op (the headless gate). */
export type Match3Presenter = {
	/** Put `board` on screen as it is (a deal, a shuffle, an accepted swap). */
	seat(board: Board): void;
	/** The two gems trade places; with `back` they return (a refused swap). */
	swap(from: Cell, to: Cell, back: boolean): Promise<void>;
	/** One cascade step: explode, fall, refill. */
	step(step: Match3Step): Promise<void>;
	/** Draw `cells` in a state. */
	mark(cells: readonly Cell[], state: Match3Mark): void;
	/** Play the book events an RGS move ends with ({@link Match3MoveResult.tail}). */
	tail?(events: readonly object[]): Promise<void>;
};

/**
 * The board the driver plays: a rules session (`createMatch3Session`), or an RGS-decided one
 * (`createMatch3RgsSession`), whose swap is a request to the server and whose deal, refill and
 * shuffle throw — the server owns those.
 */
export type Match3Board = Pick<
	Match3Session,
	'board' | 'ready' | 'deal' | 'canSwap' | 'resolveNow' | 'shuffle' | 'hint'
> & {
	trySwap(a: Cell, b: Cell): Match3MoveResult | Promise<Match3MoveResult>;
};

/** What the driver keeps; the runtime passes a reactive object to draw from. */
export type Match3DriverState = {
	/** A move, a deal or a shuffle is playing; input waits for it. */
	busy: boolean;
	/** The flow's `boardSetInput`. */
	inputEnabled: boolean;
	selected: Cell | undefined;
	/** Swaps tried this session. */
	moves: number;
};

export type Match3Driver = ReturnType<typeof createMatch3Driver>;

const isCell = (value: unknown): value is Cell =>
	typeof value === 'object' &&
	value !== null &&
	Number.isInteger((value as Cell).reel) &&
	Number.isInteger((value as Cell).row);
const adjacent = (a: Cell, b: Cell) => Math.abs(a.reel - b.reel) + Math.abs(a.row - b.row) === 1;
const same = (a: Cell, b: Cell) => a.reel === b.reel && a.row === b.row;

export function createMatch3Driver({
	session,
	state,
	signal,
	present,
	onError = (error) => console.error('[match3] board work failed:', error),
}: {
	session: Match3Board;
	state: Match3DriverState;
	/** Raise a board signal and resolve when its flow chain has run. */
	signal: (name: string, payload: Record<string, unknown>) => Promise<void>;
	present: Match3Presenter;
	onError?: (error: unknown) => void;
}) {
	let marked: Cell[] = [];
	const mark = (cells: Cell[], how: Match3Mark) => {
		present.mark(cells, how);
		marked = how === 'static' ? [] : [...marked, ...cells];
	};
	const clearMarks = () => {
		if (marked.length) mark(marked, 'static');
		state.selected = undefined;
	};

	/**
	 * Board work runs one piece at a time, in order. The player's input never queues — it is ignored
	 * while {@link Match3DriverState.busy} — but a flow action does: the `settled` chain that ends a
	 * round deals the next board, and the `noMoves` chain shuffles, from INSIDE the move still
	 * playing. Run then, they would play over it; dropped, the round would never restart. Queued,
	 * each starts the moment the move ends.
	 */
	let queue: Promise<void> = Promise.resolve();
	/** Work queued and not yet finished — busy from the moment a move is taken, not a tick later. */
	let pending = 0;
	const exclusive = (run: () => Promise<void>): Promise<void> => {
		pending++;
		state.busy = true;
		const next = queue.then(async () => {
			try {
				await run();
			} catch (error) {
				onError(error);
			} finally {
				state.busy = --pending > 0;
			}
		});
		queue = next;
		return next;
	};

	/** A new deal is queued (the flow's Refill board, from a round-over chain): the board on screen
	 *  is about to be replaced, so its having no move is no longer news. */
	let redealing = false;

	const inside = (cell: Cell) =>
		cell.reel >= 0 &&
		cell.row >= 0 &&
		cell.reel < session.board.cols &&
		cell.row < session.board.rows;

	const playSteps = async (steps: Match3Step[]) => {
		for (const step of steps) {
			await signal('match', { groups: step.groups, points: step.points, step: step.step });
			await present.step(step);
			await signal('cascadeStep', { step: step.step, groups: step.groups });
		}
	};

	const deal = async (fresh: boolean) => {
		redealing = false;
		if (fresh) session.deal();
		clearMarks();
		present.seat(session.board);
		await signal('boardReady', session.ready());
	};

	/** Swap `from` with `to`: a refused swap plays there and back, an accepted one cascades. */
	const swapCells = (from: Cell, to: Cell): Promise<void> =>
		exclusive(async () => {
			if (!inside(from) || !inside(to) || !adjacent(from, to)) return;
			clearMarks();
			const move = await session.trySwap(from, to);
			await present.swap(from, to, !move.accepted);
			if (move.accepted) present.seat(move.swapped);
			state.moves += 1;
			await signal('swap', { from, to, accepted: move.accepted });
			if (!move.accepted) return;
			await playSteps(move.steps);
			await signal('settled', { steps: move.steps.length, points: move.points });
			if (move.tail?.length) await present.tail?.(move.tail);
			if (move.noMoves && !redealing) await signal('noMoves', {});
		});

	/** Pick `cell`: the first pick is selected; a neighbour picked next swaps with it; the same cell
	 *  again drops the selection. */
	const selectCell = (cell: Cell): Promise<void> | undefined => {
		if (!inside(cell)) return undefined;
		const picked = state.selected;
		if (picked && adjacent(picked, cell)) return swapCells(picked, cell);
		clearMarks();
		if (picked && same(picked, cell)) return undefined;
		state.selected = cell;
		mark([cell], 'select');
		return undefined;
	};

	/** Light one legal swap. */
	const showHint = () => {
		const move = session.hint();
		if (!move) return;
		clearMarks();
		mark([move.from, move.to], 'hint');
	};

	const setInput = (enabled: boolean) => {
		state.inputEnabled = enabled;
		if (!enabled) clearMarks();
	};

	/** Resolve whatever matches on the board now (nothing, on a board the session dealt). */
	const resolveBoard = () =>
		exclusive(async () => {
			const resolved = session.resolveNow();
			if (!resolved.steps.length) return;
			await playSteps(resolved.steps);
			await signal('settled', {
				steps: resolved.steps.length,
				points: resolved.steps.reduce((sum, step) => sum + step.points, 0),
			});
			if (resolved.noMoves && !redealing) await signal('noMoves', {});
		});

	/** Shuffle the gems into a board with a move and no match. When no arrangement of these gems
	 *  has one (a tiny board, few gem kinds), the board is dealt afresh instead; the round goes on. */
	const shuffleBoard = () =>
		exclusive(async () => {
			clearMarks();
			let board: Board;
			try {
				board = session.shuffle();
			} catch (error) {
				console.warn('[match3] no shuffle is playable, dealing afresh:', error);
				board = session.deal();
			}
			present.seat(board);
		});

	const refillBoard = () => {
		redealing = true;
		return exclusive(() => deal(true));
	};

	/** A flow action that touches the board waits its turn too, so it lands on the board the move
	 *  that raised it left, never on one still playing. */
	const queued = (run: () => void) => void exclusive(async () => run());

	return {
		/** Seat the dealt board and raise the first `boardReady`. */
		start: () => exclusive(() => deal(false)),
		/** Seat the board the session has again (the board view remounted), with no signal. */
		reseat: () =>
			void exclusive(async () => {
				clearMarks();
				present.seat(session.board);
			}),
		swapCells,
		selectCell,
		showHint,
		setInput,
		resolveBoard,
		/** Deal a whole new board (a new round). */
		refillBoard,
		shuffleBoard,
		/** The player may act: nothing is playing and the flow allows input. */
		takesInput: () => !state.busy && state.inputEnabled,
		/** Resolves once every piece of board work queued so far has played. */
		idle: () => queue,
		/**
		 * The flow's board actions (`MATCH3_VOCAB`). They queue behind the move playing and are NOT
		 * awaited by the chain that called them: that chain is often the move's own (`settled`,
		 * `noMoves`), so holding it on work queued after the move would hold the move on itself.
		 * A payload that names no cell does nothing.
		 */
		effects: {
			boardSelect: (payload: Record<string, unknown>) => {
				const { cell } = payload;
				if (isCell(cell)) queued(() => void selectCell(cell));
			},
			boardHint: () => queued(showHint),
			boardSwap: (payload: Record<string, unknown>) => {
				const { from, to } = payload;
				if (isCell(from) && isCell(to)) void swapCells(from, to);
			},
			// A flag, not board work: it applies at once (a round-over chain locks the board while
			// its screen holds, inside the move that is still playing); `busy` covers the move.
			boardSetInput: (payload: Record<string, unknown>) => setInput(payload.enabled === true),
			boardResolve: () => void resolveBoard(),
			boardRefill: () => void refillBoard(),
			boardShuffle: () => void shuffleBoard(),
		} satisfies Record<string, (payload: Record<string, unknown>) => void>,
	};
}
