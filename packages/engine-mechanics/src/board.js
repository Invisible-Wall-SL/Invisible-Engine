// Invisible Engine — the match-3 BOARD (docs/design/game-families.md §4.1, P10.2).
//
// The whole match-3 rule set as plain functions over a board value: deal, swap, find matches,
// clear, gravity, refill, the cascade loop, "is there a move left", shuffle. No drawing and no
// imports, so the client (a rules game, and the consistency check of an RGS one) and the match-3
// mock RGS run the same code. Types and the contract live in `board.d.ts`; the behaviour is pinned
// by `scripts/check-board-mechanic.mjs`.
//
// THE GRID IS THE SLOT BOARD'S SHAPE: column-major `cells[reel][row]`, row 0 at the top, cells
// shaped as `RawSymbol` (`{ name }`). So a resolved step IS a `tumbleBoard` book event and needs no
// adapter: `explodingSymbols` are the cleared cells, and `newSymbols[reel]` are the gems that drop
// into that column, top first — exactly what `scripts/mock-rgs-server.mjs`'s cascade sends.
//
// NOTHING MUTATES ITS INPUT. Every function returns a new board. The one piece of state is the
// board's `rng`, which each draw advances: a board created with the same seed and fed the same
// swaps replays every deal, refill and shuffle exactly.
//
// WHO MAY DRAW. An RGS-decided game builds its board with `rng: null` and the server's cells, so a
// local refill, deal or shuffle THROWS instead of inventing a gem (§2.2, guarantee 1). It refills
// only from the book's `newSymbols`.

export const DEFAULT_MIN_RUN = 3;

/** How many deals (or shuffles) may be tried for a board with no match and a move to make. */
const MAX_DEAL_TRIES = 200;

/** A cascade longer than this is a statement about the strips, not a chain. */
const DEFAULT_MAX_STEPS = 100;

/**
 * A seeded generator in [0, 1): mulberry32 over a 32-bit seed. A string seed is hashed (FNV-1a)
 * first, so a project can seed from a readable id.
 */
export function createRng(seed) {
	let state = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function hashString(text) {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
	return h >>> 0;
}

/**
 * A board. Either from given `cells` (the server's `boardInit`, a saved game, a fixture) or dealt
 * from `pool`, one refill strip per column (a config's `paddingReels` set), at seeded stops. A
 * dealt board has no match on it and at least one move.
 */
export function createBoard({
	cols,
	rows,
	pool = null,
	rng = null,
	cells,
	minRun = DEFAULT_MIN_RUN,
}) {
	if (!isCount(cols) || !isCount(rows)) {
		throw new Error(`board: cols and rows must be whole numbers above 0 (got ${cols} × ${rows})`);
	}
	checkMinRun(minRun);
	const strips = pool === null ? null : readPool(pool, cols);
	const base = { cols, rows, minRun, cells: [], strips, rng };
	if (cells !== undefined) return { ...base, cells: readCells(cells, cols, rows) };
	if (!strips) throw new Error('board: give it the cells, or a pool to deal them from');
	const draw = needRng(base, 'deal');
	for (let tries = 0; tries < MAX_DEAL_TRIES; tries++) {
		const dealt = {
			...base,
			cells: strips.map((strip) => readStrip(strip, stop(strip, draw), rows)),
		};
		if (isPlayable(dealt)) return dealt;
	}
	throw new Error(
		`board: the strips dealt no board without a match and with a move in ${MAX_DEAL_TRIES} tries`,
	);
}

/** Two cells side by side or one above the other, both gems, different gems, and the swap makes a
 *  match that takes in at least one of them. */
export function canSwap(board, a, b) {
	if (!inBounds(board, a) || !inBounds(board, b)) return false;
	if (Math.abs(a.reel - b.reel) + Math.abs(a.row - b.row) !== 1) return false;
	const first = cellAt(board, a);
	const second = cellAt(board, b);
	if (!first || !second || first.name === second.name) return false;
	const key = (p) => `${p.reel}:${p.row}`;
	const touched = new Set([key(a), key(b)]);
	return findMatches(swap(board, a, b)).some((group) =>
		group.cells.some((cell) => touched.has(key(cell))),
	);
}

/** The board with the two cells traded. It does not check the swap is legal: that is `canSwap`. */
export function swap(board, a, b) {
	if (!inBounds(board, a) || !inBounds(board, b)) {
		throw new Error(`board: swap outside the board (${at(a)} ↔ ${at(b)})`);
	}
	const cells = board.cells.map((column) => [...column]);
	cells[a.reel][a.row] = board.cells[b.reel][b.row];
	cells[b.reel][b.row] = board.cells[a.reel][a.row];
	return { ...board, cells };
}

/**
 * Every run of `minRun` or more of one gem, along a row or down a column. Runs of the same gem that
 * share a cell are one group: an `L` when they meet at an end of both, else a `T` (which also
 * covers a plus and any larger merged shape). A lone run is `line<n>`, with `line5` meaning five
 * or more. Groups and their cells are in reel-then-row order.
 */
export function findMatches(board, { minRun = board.minRun } = {}) {
	checkMinRun(minRun);
	const runs = [];
	const scan = (length, cellOf, posOf) => {
		let start = 0;
		for (let i = 1; i <= length; i++) {
			const head = cellOf(start);
			if (i < length && head && cellOf(i)?.name === head.name) continue;
			if (head && i - start >= minRun) {
				runs.push({ symbol: head.name, cells: range(start, i).map(posOf) });
			}
			start = i;
		}
	};
	for (let row = 0; row < board.rows; row++) {
		scan(
			board.cols,
			(reel) => board.cells[reel][row],
			(reel) => ({ reel, row }),
		);
	}
	for (let reel = 0; reel < board.cols; reel++) {
		scan(
			board.rows,
			(row) => board.cells[reel][row],
			(row) => ({ reel, row }),
		);
	}
	return mergeRuns(runs);
}

function mergeRuns(runs) {
	const owner = new Map();
	const parent = runs.map((_, i) => i);
	const root = (i) => (parent[i] === i ? i : (parent[i] = root(parent[i])));
	runs.forEach((run, i) => {
		for (const cell of run.cells) {
			const key = `${cell.reel}:${cell.row}`;
			if (owner.has(key)) parent[root(i)] = root(owner.get(key));
			else owner.set(key, i);
		}
	});
	const members = new Map();
	runs.forEach((run, i) => {
		const r = root(i);
		if (!members.has(r)) members.set(r, []);
		members.get(r).push(run);
	});
	return [...members.values()]
		.map((group) => {
			const seen = new Map();
			for (const run of group)
				for (const cell of run.cells) seen.set(`${cell.reel}:${cell.row}`, cell);
			return {
				symbol: group[0].symbol,
				cells: [...seen.values()].sort(byPosition),
				shape: shapeOf(group),
			};
		})
		.sort((a, b) => byPosition(a.cells[0], b.cells[0]));
}

function shapeOf(group) {
	if (group.length === 1) return `line${Math.min(group[0].cells.length, 5)}`;
	if (group.length > 2) return 'T';
	const [first, second] = group;
	const isEnd = (run, cell) =>
		[run.cells[0], run.cells[run.cells.length - 1]].some(
			(end) => end.reel === cell.reel && end.row === cell.row,
		);
	const shared = first.cells.find((cell) =>
		second.cells.some((other) => other.reel === cell.reel && other.row === cell.row),
	);
	return isEnd(first, shared) && isEnd(second, shared) ? 'L' : 'T';
}

/** The board with every cell of `groups` emptied (`null`). */
export function clear(board, groups) {
	const cells = board.cells.map((column) => [...column]);
	for (const group of groups) {
		for (const cell of group.cells) {
			if (!inBounds(board, cell)) throw new Error(`board: clear outside the board (${at(cell)})`);
			cells[cell.reel][cell.row] = null;
		}
	}
	return { ...board, cells };
}

/** The gems drop down their column, in order, so every hole ends up at the top. `moves` lists each
 *  gem that fell, reel-then-row. */
export function gravity(board) {
	const moves = [];
	const cells = board.cells.map((column, reel) => {
		const gems = column.map((cell, row) => ({ cell, row })).filter(({ cell }) => cell);
		const holes = column.length - gems.length;
		gems.forEach(({ row }, i) => {
			if (row !== holes + i) moves.push({ reel, from: row, to: holes + i });
		});
		return [...Array(holes).fill(null), ...gems.map(({ cell }) => cell)];
	});
	return { board: { ...board, cells }, moves };
}

/**
 * Fill each column's holes, which `gravity` has gathered at the top. `source` is `'pool'` — read the
 * column's strip from a seeded stop, as a reel strip is read — or a book's `newSymbols`, one array
 * per column, top first, exactly as many as that column has holes. An RGS board (`rng: null`) can
 * only take the book's.
 */
export function refill(board, source) {
	const holes = board.cells.map((column, reel) => {
		const count = column.filter((cell) => !cell).length;
		if (column.slice(0, count).some((cell) => cell)) {
			throw new Error(`board: reel ${reel} has a hole below a gem — run gravity before refill`);
		}
		return count;
	});
	let newSymbols;
	if (source === 'pool') {
		if (!board.strips) throw new Error('board: refill from the pool, but this board has no pool');
		const draw = needRng(board, 'refill');
		newSymbols = holes.map((count, reel) =>
			count ? readStrip(board.strips[reel], stop(board.strips[reel], draw), count) : [],
		);
	} else {
		if (!Array.isArray(source) || source.length !== board.cols) {
			throw new Error(`board: a book refill needs one array per column (${board.cols})`);
		}
		newSymbols = source.map((column, reel) => {
			if (!Array.isArray(column) || column.length !== holes[reel]) {
				throw new Error(
					`board: the book refills reel ${reel} with ${column?.length ?? 0} gems, but it has ${holes[reel]} holes`,
				);
			}
			return column.map((cell) => readCell(cell, `newSymbols[${reel}]`));
		});
	}
	const cells = board.cells.map((column, reel) => [
		...newSymbols[reel],
		...column.slice(holes[reel]),
	]);
	return { board: { ...board, cells }, newSymbols };
}

/**
 * The cascade: match, clear, fall, refill, until nothing matches. Each step's `event` is a
 * `tumbleBoard` book event without its `index`, beside the groups that made it and the falls.
 * `source` is `'pool'`, or the book's `newSymbols` for each step in order (an RGS board mirrors
 * the server's chain this way); a book with more or fewer refills than the chain has steps throws,
 * which is the client/server mismatch §2.2 #4 logs.
 */
export function resolve(
	board,
	{ source = 'pool', minRun = board.minRun, maxSteps = DEFAULT_MAX_STEPS } = {},
) {
	if (source !== 'pool' && !Array.isArray(source)) {
		throw new Error(`board: resolve's source is 'pool' or the book's refills (got ${source})`);
	}
	const steps = [];
	let current = board;
	for (;;) {
		const groups = findMatches(current, { minRun });
		if (!groups.length) {
			if (source !== 'pool' && source.length > steps.length) {
				throw new Error(
					`board: the board settled after ${steps.length} steps, but the book refills ${source.length}`,
				);
			}
			return { board: current, steps };
		}
		if (steps.length >= maxSteps) {
			throw new Error(
				`board: the cascade is still matching after ${maxSteps} steps — check the strips`,
			);
		}
		let refillFrom = source;
		if (source !== 'pool') {
			if (steps.length >= source.length) {
				throw new Error(`board: the book ran out of refills at step ${steps.length + 1}`);
			}
			refillFrom = source[steps.length];
		}
		const explodingSymbols = groups.flatMap((group) => group.cells).sort(byPosition);
		const fallen = gravity(clear(current, groups));
		const filled = refill(fallen.board, refillFrom);
		steps.push({
			event: { type: 'tumbleBoard', explodingSymbols, newSymbols: filled.newSymbols },
			groups,
			falls: fallen.moves,
		});
		current = filled.board;
	}
}

/** Every legal swap, each pair once (`from` is left of or above `to`), reel-then-row. */
export function findMoves(board, { minRun = board.minRun, limit = Infinity } = {}) {
	const sized = minRun === board.minRun ? board : { ...board, minRun };
	const moves = [];
	for (let reel = 0; reel < board.cols; reel++) {
		for (let row = 0; row < board.rows; row++) {
			const from = { reel, row };
			for (const to of [
				{ reel: reel + 1, row },
				{ reel, row: row + 1 },
			]) {
				if (canSwap(sized, from, to)) moves.push({ from, to });
				if (moves.length >= limit) return moves;
			}
		}
	}
	return moves;
}

/** Whether any swap on the board makes a match. */
export function hasMoves(board, options) {
	return findMoves(board, { ...options, limit: 1 }).length > 0;
}

/** The same gems in new places, with no match on the board and a move to make. Holes stay put. */
export function shuffle(board, rng = board.rng) {
	if (!board.rng || !rng) {
		throw new Error('board: shuffle needs an rng — an RGS board is shuffled by the server');
	}
	const places = [];
	board.cells.forEach((column, reel) =>
		column.forEach((cell, row) => {
			if (cell) places.push({ reel, row });
		}),
	);
	const gems = places.map((p) => board.cells[p.reel][p.row]);
	for (let tries = 0; tries < MAX_DEAL_TRIES; tries++) {
		for (let i = gems.length - 1; i > 0; i--) {
			const j = Math.floor(rng() * (i + 1));
			[gems[i], gems[j]] = [gems[j], gems[i]];
		}
		const cells = board.cells.map((column) => [...column]);
		places.forEach((p, i) => {
			cells[p.reel][p.row] = gems[i];
		});
		const shuffled = { ...board, cells };
		if (isPlayable(shuffled)) return shuffled;
	}
	throw new Error(
		`board: no shuffle of these gems has a move without a match (${MAX_DEAL_TRIES} tries)`,
	);
}

function checkMinRun(minRun) {
	if (!Number.isInteger(minRun) || minRun < 2) {
		throw new Error(`board: minRun must be a whole number of at least 2 (got ${minRun})`);
	}
}

const isPlayable = (board) => findMatches(board).length === 0 && hasMoves(board);

function needRng(board, what) {
	if (typeof board.rng !== 'function') {
		throw new Error(`board: ${what} needs an rng — an RGS board takes its gems from the book`);
	}
	return board.rng;
}

const stop = (strip, draw) => Math.floor(draw() * strip.length);

const readStrip = (strip, from, count) =>
	Array.from({ length: count }, (_, i) => ({ name: strip[(from + i) % strip.length] }));

function readPool(pool, cols) {
	if (!Array.isArray(pool) || pool.length !== cols) {
		throw new Error(`board: the pool needs one strip per column (${cols})`);
	}
	return pool.map((strip, reel) => {
		if (!Array.isArray(strip) || !strip.length)
			throw new Error(`board: reel ${reel}'s strip is empty`);
		return strip.map((cell) => {
			const name = typeof cell === 'string' ? cell : cell?.name;
			if (typeof name !== 'string' || !name)
				throw new Error(`board: reel ${reel}'s strip has a cell with no name`);
			return name;
		});
	});
}

function readCells(cells, cols, rows) {
	if (!Array.isArray(cells) || cells.length !== cols) {
		throw new Error(`board: the cells need one column per reel (${cols})`);
	}
	return cells.map((column, reel) => {
		if (!Array.isArray(column) || column.length !== rows) {
			throw new Error(`board: reel ${reel} needs ${rows} cells`);
		}
		return column.map((cell) => (cell === null ? null : readCell(cell, `reel ${reel}`)));
	});
}

function readCell(cell, where) {
	if (typeof cell?.name !== 'string' || !cell.name)
		throw new Error(`board: ${where} has a cell with no name`);
	return { ...cell };
}

const isCount = (n) => Number.isInteger(n) && n > 0;
const inBounds = (board, p) =>
	Number.isInteger(p?.reel) &&
	Number.isInteger(p?.row) &&
	p.reel >= 0 &&
	p.reel < board.cols &&
	p.row >= 0 &&
	p.row < board.rows;
const cellAt = (board, p) => board.cells[p.reel][p.row];
const byPosition = (a, b) => a.reel - b.reel || a.row - b.row;
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i);
const at = (p) => `${p?.reel},${p?.row}`;
