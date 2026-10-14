import type { HoldAndWinLineRun, HoldAndWinTally, HoldAndWinTallyCell } from './holdAndWin';
import type { Position } from './types';

/**
 * HOW A COIN BOARD'S END TALLY PLAYS, per pay rule (`docs/design/hold-and-win-coin-board.md` §1.2) —
 * pure, so `fixtures/coinBoardTally.fixture.ts` pins it and the presentation only executes it.
 *
 * - `coinsOnLines` (and every tally without a rule — a classic board): one step, every coin.
 * - `perLine`: one step, every coin, each marked with how many lines it paid on (its ×N).
 * - `lineFill`: one step per run, in the server's order, flying the run's coins that no earlier run
 *   flew (a coin on two runs pays both in its one amount, so it flies once, with the first). A coin
 *   in no run pays nothing: it is dimmed and does not fly.
 */
export type CoinBoardTallyStep = { run?: HoldAndWinLineRun; cells: HoldAndWinTallyCell[] };

export type CoinBoardTallyPlan = {
	steps: CoinBoardTallyStep[];
	/** The cells that pay nothing under the rule. */
	dimmed: Position[];
	/** The ×N each coin shows during a `perLine` tally. */
	marks: (Position & { times: number })[];
};

const byReelThenRow = (a: Position, b: Position) => a.reel - b.reel || a.row - b.row;
const keyOf = ({ reel, row }: Position) => `${reel}:${row}`;

export const coinBoardTallyPlan = (tally: HoldAndWinTally): CoinBoardTallyPlan => {
	const cells = [...tally.cells].sort(byReelThenRow);
	if (tally.payRule === 'perLine') {
		return {
			steps: [{ cells }],
			dimmed: [],
			marks: cells.map(({ reel, row, lines }) => ({ reel, row, times: lines ?? 1 })),
		};
	}
	if (tally.payRule !== 'lineFill') return { steps: [{ cells }], dimmed: [], marks: [] };
	const pays = cells.filter((cell) => cell.amount > 0);
	const byKey = new Map(pays.map((cell) => [keyOf(cell), cell]));
	const flown = new Set<string>();
	const steps: CoinBoardTallyStep[] = [];
	for (const run of tally.runs ?? []) {
		const own = run.cells.map(keyOf).filter((key) => byKey.has(key) && !flown.has(key));
		own.forEach((key) => flown.add(key));
		steps.push({ run, cells: own.map((key) => byKey.get(key)!).sort(byReelThenRow) });
	}
	const strays = pays.filter((cell) => !flown.has(keyOf(cell)));
	if (strays.length) steps.push({ cells: strays });
	return {
		steps,
		dimmed: cells.filter((cell) => cell.amount <= 0).map(({ reel, row }) => ({ reel, row })),
		marks: [],
	};
};
