import type { HoldAndWinCell } from './holdAndWin';
import type { Position, RawSymbol } from './types';

/**
 * THE RESPIN BOARD'S RULES, without a renderer — design §4.2 of `docs/design/hold-and-win.md`.
 * Which cells spin on a respin and what each lands on, which cells a new picture let go of, and
 * what every cell shows when the board mounts. Pure, so `fixtures/respinBoard.fixture.ts` pins them
 * and the one-cell reels (`respinBoard.svelte.ts`) only execute the answer.
 *
 * Every position here is the VISIBLE 0-based `{reel, row}` of the Hold and Win contract.
 */

export const respinCellKey = (reel: number, row: number): string => `${reel}:${row}`;

const keysOf = (cells: Position[]) =>
	new Set(cells.map(({ reel, row }) => respinCellKey(reel, row)));

/** One cell a respin spins and the symbol it lands on. `order` is its column: columns stop in turn. */
export type RespinSpin = Position & { symbol: RawSymbol; order: number };

/**
 * The cells a respin SPINS and what each lands on: every cell of the board that is not held,
 * column by column.
 *
 * `respinReveal` names every cell of the board as it lands, held ones included, so it is read only
 * for the cells that move. A held cell never spins whatever the reveal says about it — the held
 * layer draws it, and the server restates it on the snapshot that follows. A cell the reveal does
 * not mention lands on the blank: an empty cell is the one thing a respin can always show.
 */
export const respinSpins = ({
	reels,
	rows,
	held,
	reveal,
	blank,
}: {
	reels: number;
	rows: number;
	held: Position[];
	reveal: HoldAndWinCell[];
	blank: string;
}): RespinSpin[] => {
	const heldKeys = keysOf(held);
	const landing = new Map(reveal.map((cell) => [respinCellKey(cell.reel, cell.row), cell.symbol]));
	const spins: RespinSpin[] = [];
	for (let reel = 0; reel < reels; reel += 1) {
		for (let row = 0; row < rows; row += 1) {
			const key = respinCellKey(reel, row);
			if (heldKeys.has(key)) continue;
			spins.push({ reel, row, symbol: landing.get(key) ?? { name: blank }, order: reel });
		}
	}
	return spins;
};

/**
 * The cells that WERE held and no longer are — a streak clearing its coins, a column sweep, or a
 * server snapshot correcting the client. Their one-cell reels still show whatever they last landed
 * on, so each is settled back to the blank before it is drawn again.
 */
export const releasedCells = (before: Position[], after: Position[]): Position[] => {
	const stillHeld = keysOf(after);
	return before
		.filter(({ reel, row }) => !stillHeld.has(respinCellKey(reel, row)))
		.map(({ reel, row }) => ({ reel, row }));
};

/**
 * What every one-cell reel shows when the board mounts: the blank. A held cell's reel is covered by
 * the held layer and must show the blank if it is ever let go; every other cell is empty, so the
 * board visibly becomes the respin board — coins on empty cells — in the frame the counter appears,
 * not when the first respin spins the trigger's symbols away.
 */
export const respinSeedBoard = ({
	reels,
	rows,
	blank,
}: {
	reels: number;
	rows: number;
	blank: string;
}): RawSymbol[][] =>
	Array.from({ length: reels }, () => Array.from({ length: rows }, () => ({ name: blank })));
