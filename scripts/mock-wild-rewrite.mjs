/**
 * EXPANDING and GROWING WILDS for the lines mock (`docs/design/expanding-and-growing-wilds.md` §2–§3)
 * — the board rewrite that runs after the landing and before the count:
 *
 *   land → expand each expanding wild over its reel → grow each growing wild → count
 *
 * The wire is the reference game's (Slotmotion's Fairy's Charm): `expandedWild {wild, reel, row}`
 * then one `symbolSetInMatrix {reel, row, symbol, oldSymbol}` per cell of the reel (the origin
 * included), and `growingWild {wild, reel, row}` then one `symbolSetInMatrix` per NEW cell. Rows are
 * visible-grid rows. `playedSpin` stays the LANDED board; the wins are those of the final board.
 *
 * Names are SERVER names: `WILD` for the project's `W` (the facade maps it), any other wild by its
 * own project name (unmapped, so it passes through the facade unchanged).
 *
 * Without either block `createWildRewrite` returns null and the mock draws nothing extra, so every
 * other game deals byte-identically (`check:lines-parity`).
 */

/** Chance that a reel an expanding wild may land on deals it, per reel per spin. Three eligible
 *  reels land one on about 9% of spins, the reference game's rate (109 in 1,178). */
const EXPAND_RATE = 0.03;
/** Chance that a spin deals the growing wild (the reference game: 140 in 1,178 base spins). */
const GROW_RATE = 0.12;

/** `[dReel, dRow]` per pattern, in morph order — game-config's `growCells` (`growingWild.ts`). */
const OFFSETS = {
	plus: [
		[0, -1],
		[0, 1],
		[-1, 0],
		[1, 0],
	],
	vertical: [
		[0, -1],
		[0, 1],
	],
	horizontal: [
		[-1, 0],
		[1, 0],
	],
	all8: [
		[0, -1],
		[0, 1],
		[-1, 0],
		[1, 0],
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1],
	],
};

/** The cells a growing wild at `origin` copies onto, clipped at the board edge (`rows[reel]` is
 *  each reel's height). Mirrors game-config's `growCells`; `check:growing-wilds` holds them equal. */
export const growCells = (origin, pattern, rows) =>
	(OFFSETS[pattern] ?? OFFSETS.plus)
		.map(([dReel, dRow]) => ({ reel: origin.reel + dReel, row: origin.row + dRow }))
		.filter(({ reel, row }) => reel >= 0 && reel < rows.length && row >= 0 && row < rows[reel]);

const reelList = (raw, reelCount) =>
	Array.isArray(raw) ? raw.filter((r) => Number.isInteger(r) && r >= 0 && r < reelCount) : [];

/**
 * The rewrite for one mock instance, or null when the project has neither block.
 *
 * @param {{
 *   expandingWilds?: { symbols: { symbol: string, reels: number[] }[], onlyOnWin?: boolean },
 *   growingWild?: { symbol: string, reels: number[], freeSpinReels?: number[], pattern?: string },
 *   rowHeights: number[], rand: () => number, pick: () => string,
 *   protect: (cell: string) => boolean, force?: boolean,
 * }} o — `protect` names the cells nothing lands on or overwrites (the scatter, the trigger
 *   symbol); `pick` refills a cell a feature wild was dealt on outside its reels; `force` lands every
 *   feature wild on every spin (`FORCE_WILDS=1`, for playtests).
 */
export function createWildRewrite(o) {
	const reelCount = o.rowHeights.length;
	const expanding = (o.expandingWilds?.symbols ?? [])
		.filter((w) => typeof w?.symbol === 'string' && w.symbol)
		.map((w) => ({ symbol: w.symbol, reels: reelList(w.reels, reelCount) }))
		.filter((w) => w.reels.length);
	const growSymbol = typeof o.growingWild?.symbol === 'string' ? o.growingWild.symbol : '';
	const growing =
		growSymbol && !expanding.some((w) => w.symbol === growSymbol)
			? (() => {
					const reels = reelList(o.growingWild.reels, reelCount);
					const free = reelList(o.growingWild.freeSpinReels, reelCount);
					return {
						symbol: growSymbol,
						reels,
						freeSpinReels: free.length ? free : reels,
						pattern: OFFSETS[o.growingWild.pattern] ? o.growingWild.pattern : 'plus',
					};
				})()
			: null;
	if (!expanding.length && !growing?.reels.length) return null;
	const onlyOnWin = o.expandingWilds?.onlyOnWin === true;
	const names = [
		...new Set([...expanding.map((w) => w.symbol), ...(growing ? [growing.symbol] : [])]),
	];
	const { rand, pick, protect, force = false } = o;

	/** Land `symbol` on a random row of `reel` that holds neither a protected cell nor another
	 *  feature wild; false when no row is free. */
	const landOn = (board, reel, symbol) => {
		const free = (cell) => !protect(cell) && !names.includes(cell);
		const rows = board[reel].map((_cell, row) => row).filter((row) => free(board[reel][row]));
		if (!rows.length) return false;
		board[reel][rows[Math.floor(rand() * rows.length)]] = symbol;
		return true;
	};

	/**
	 * Deal the feature wilds onto a dealt board, in place: every one the draw put there is refilled
	 * (the draw knows nothing of their reels), then each lands at its own rate, on its own reels.
	 */
	const land = (board, freeSpins) => {
		for (const column of board)
			column.forEach((cell, row) => {
				if (names.includes(cell)) column[row] = pick();
			});
		for (const wild of expanding) {
			let landed = false;
			for (const reel of wild.reels) {
				if (rand() < EXPAND_RATE) landed = landOn(board, reel, wild.symbol) || landed;
			}
			if (force && !landed)
				landOn(board, wild.reels[Math.floor(rand() * wild.reels.length)], wild.symbol);
		}
		const reels = growing ? (freeSpins ? growing.freeSpinReels : growing.reels) : [];
		if (reels.length && (force || rand() < GROW_RATE)) {
			landOn(board, reels[Math.floor(rand() * reels.length)], growing.symbol);
		}
	};

	/**
	 * Land, expand and grow on `dealt` (left untouched). Returns the LANDED board (for `playedSpin`),
	 * the FINAL board (for the count) and the wire events, which go before the spin's wins.
	 * `paidCells(board)` is the `reel:row` set of the landed board's winning cells, read only when
	 * the expanding wilds expand on a win alone.
	 */
	const rewrite = (dealt, { freeSpins = false, paidCells } = {}) => {
		const landed = dealt.map((column) => [...column]);
		land(landed, freeSpins);
		const board = landed.map((column) => [...column]);
		const events = [];
		const set = (reel, row, symbol) => {
			events.push({
				event: 'symbolSetInMatrix',
				context: { reel, row, symbol, oldSymbol: board[reel][row] },
			});
			board[reel][row] = symbol;
		};
		const paid = onlyOnWin && expanding.length ? paidCells(landed) : null;
		board.forEach((column, reel) => {
			const row = column.findIndex(
				(cell, r) =>
					expanding.some((w) => w.symbol === cell && w.reels.includes(reel)) &&
					(!paid || paid.has(`${reel}:${r}`)),
			);
			if (row < 0) return;
			const wild = column[row];
			events.push({ event: 'expandedWild', context: { wild, reel, row } });
			// A growing wild on the reel keeps its cell: it grows next, over the fairy.
			column.forEach((cell, r) => {
				if (!protect(cell) && cell !== growing?.symbol) set(reel, r, wild);
			});
		});
		if (growing) {
			const origins = board.flatMap((column, reel) =>
				column.flatMap((cell, row) => (cell === growing.symbol ? [{ reel, row }] : [])),
			);
			const isOrigin = (c) => origins.some((p) => p.reel === c.reel && p.row === c.row);
			for (const origin of origins) {
				events.push({ event: 'growingWild', context: { wild: growing.symbol, ...origin } });
				for (const cell of growCells(origin, growing.pattern, o.rowHeights)) {
					const now = board[cell.reel][cell.row];
					if (!protect(now) && now !== growing.symbol && !isOrigin(cell))
						set(cell.reel, cell.row, growing.symbol);
				}
			}
		}
		return { landed, board, events };
	};

	return { names, rewrite };
}
