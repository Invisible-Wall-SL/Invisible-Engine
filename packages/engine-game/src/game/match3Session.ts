import {
	canSwap,
	createBoard,
	createRng,
	findMoves,
	hasMoves,
	resolve,
	shuffle,
	swap,
	type Board,
	type Cell,
	type Gem,
	type MatchGroup,
	type Move,
	type Strip,
} from 'engine-mechanics';
import { resolveMatch3, type GameConfigDoc } from 'game-config';

/**
 * A rules-decided match-3 game's board, rules and score (`docs/design/game-families.md` §2.3):
 * `engine-mechanics`' board module, seeded once, plus the config's moves, goal and score table.
 *
 * Plain logic with no drawing and no Svelte, so the runtime and the headless `check:match3-rules`
 * gate drive the very same session. What a move did comes back shaped for the presentation: each
 * cascade step carries the `tumbleBoard` book event the shared runtime's coded handler already plays,
 * in the runtime's PADDED rows (a reel is `[pad, …visible…, pad]`, book row = visible row + 1, as
 * the RGS facade sends it), beside the groups in the board's own visible rows.
 */

/** The rows a reel carries above its visible window — `tumbleBoardLayout.ts` `PAD_ROWS_ABOVE`. */
export const MATCH3_PAD_ROWS = 1;

/** Points per gem when the config has no score table. */
export const DEFAULT_POINTS_PER_GEM = 10;

export type Match3Step = {
	step: number;
	groups: MatchGroup[];
	points: number;
	event: { type: 'tumbleBoard'; explodingSymbols: Cell[]; newSymbols: Gem[][] };
	/** Book events the RGS sent with this step (its running win), played after its cascade. */
	tail?: readonly object[];
};

export type Match3MoveResult = {
	accepted: boolean;
	/** The board right after the two gems traded places (before the cascade). */
	swapped: Board;
	steps: Match3Step[];
	/** The settled board. */
	board: Board;
	points: number;
	/** No swap on the settled board can match. */
	noMoves: boolean;
	/** Book events the RGS sent after the move's cascade (the moves left, the round's end), played
	 *  once the move has settled. A rules session sends none. */
	tail?: readonly object[];
};

export type Match3Session = ReturnType<typeof createMatch3Session>;

/** One column's strip, from a config's `paddingReels` (its `basegame` set, else its first). */
const poolOf = (doc: GameConfigDoc): Strip[] => {
	const sets = doc.paddingReels ?? {};
	return (sets.basegame ?? Object.values(sets)[0] ?? []) as Strip[];
};

/** The score a step's groups are worth: each group by its gem count, from the score table (the
 *  longest run the table prices at or under the count), else {@link DEFAULT_POINTS_PER_GEM} a gem. */
export const scoreGroups = (
	groups: readonly MatchGroup[],
	scoreTable: Record<string, number> | undefined,
): number => {
	const rows = Object.entries(scoreTable ?? {})
		.map(([run, points]) => [Number(run), points] as const)
		.sort((a, b) => a[0] - b[0]);
	return groups.reduce((sum, group) => {
		const count = group.cells.length;
		if (!rows.length) return sum + count * DEFAULT_POINTS_PER_GEM;
		const priced = rows.filter(([run]) => run <= count).pop();
		return sum + (priced ? priced[1] : 0);
	}, 0);
};

/** A board column as the runtime's reel holds it: the edge gems repeated as its off-screen pads. */
export const paddedColumn = (column: readonly (Gem | null)[]): Gem[] => {
	const gems = column as Gem[];
	return [gems[0], ...gems, gems[gems.length - 1]];
};

export const paddedBoard = (board: Board): Gem[][] => board.cells.map(paddedColumn);

/** A cell in the runtime's padded rows. */
export const toBookCell = (cell: Cell): Cell => ({
	reel: cell.reel,
	row: cell.row + MATCH3_PAD_ROWS,
});

export function createMatch3Session(doc: GameConfigDoc, seed: number | string) {
	const rules = resolveMatch3(doc);
	const cols = doc.numReels;
	const rows = doc.numRows[0] ?? 0;
	const pool = poolOf(doc);
	const rng = createRng(seed);
	const minRun = rules.minRun;
	const scoreGoal = rules.goals?.find((goal) => goal.type === 'score');
	let board: Board = createBoard({ cols, rows, pool, rng, minRun });

	const steps = (resolved: ReturnType<typeof resolve>['steps']): Match3Step[] =>
		resolved.map((step, index) => ({
			step: index + 1,
			groups: step.groups,
			points: scoreGroups(step.groups, rules.scoreTable),
			event: {
				type: 'tumbleBoard',
				explodingSymbols: step.event.explodingSymbols.map(toBookCell),
				newSymbols: step.event.newSymbols,
			},
		}));

	return {
		/** The board on screen. */
		get board() {
			return board;
		},
		/** What a round starts with: the config's moves and its score goal (0 for none of either). */
		ready: () => ({ moves: rules.moves ?? 0, target: scoreGoal?.target ?? 0 }),
		/** Deal a fresh board from the pool, with no match and at least one move. */
		deal: (): Board => (board = createBoard({ cols, rows, pool, rng, minRun })),
		canSwap: (a: Cell, b: Cell) => canSwap(board, a, b),
		/** Swap `a` and `b`; a swap that makes no match is refused and leaves the board as it was. */
		trySwap: (a: Cell, b: Cell): Match3MoveResult => {
			const swapped = swap(board, a, b);
			if (!canSwap(board, a, b))
				return { accepted: false, swapped, steps: [], board, points: 0, noMoves: false };
			const resolved = resolve(swapped);
			board = resolved.board;
			const played = steps(resolved.steps);
			return {
				accepted: true,
				swapped,
				steps: played,
				board,
				points: played.reduce((sum, step) => sum + step.points, 0),
				noMoves: !hasMoves(board),
			};
		},
		/** Resolve whatever matches on the board now (nothing, on a board this session dealt). */
		resolveNow: () => {
			const resolved = resolve(board);
			board = resolved.board;
			const played = steps(resolved.steps);
			return { steps: played, board, noMoves: !hasMoves(board) };
		},
		shuffle: (): Board => (board = shuffle(board, rng)),
		hasMoves: () => hasMoves(board),
		hint: (): Move | undefined => findMoves(board, { limit: 1 })[0],
	};
}
