// The match-3 board module's rule set (packages/engine-mechanics/src/board.js;
// docs/design/game-families.md §4.1, P10.2): match finding (runs, L/T), gravity, refill from a book
// vs the seeded pool, the cascade chain, `hasMoves`, and that a seed replays identically — against
// the committed trace in packages/engine-mechanics/fixtures/board-replay.json.
//
// Run: pnpm check:board-mechanic            (--update rewrites the replay fixture)

import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	canSwap,
	clear,
	createBoard,
	createRng,
	findMatches,
	findMoves,
	gravity,
	hasMoves,
	refill,
	resolve,
	shuffle,
	swap,
} from '../packages/engine-mechanics/src/board.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPLAY_FIXTURE = join(ROOT, 'packages/engine-mechanics/fixtures/board-replay.json');

/** A seed whose first draw stops a four-cell strip on its last cell. */
const WRAPPING_SEED = (() => {
	for (let seed = 0; ; seed++) if (Math.floor(createRng(seed)() * 4) === 3) return seed;
})();

let passed = 0;
const failures = [];
function check(name, fn) {
	try {
		fn();
		passed++;
	} catch (error) {
		failures.push(`✗ ${name}\n    ${error.message.split('\n').join('\n    ')}`);
	}
}

/** A board from rows drawn top-down, one letter per gem and `.` for a hole. */
function grid(lines, options = {}) {
	const rows = lines.length;
	const cols = lines[0].length;
	const cells = Array.from({ length: cols }, (_, reel) =>
		lines.map((line) => (line[reel] === '.' ? null : { name: line[reel] })),
	);
	return createBoard({ cols, rows, cells, ...options });
}

/** A board back as rows of letters, so an expectation reads like the grid it describes. */
const draw = (board) =>
	Array.from({ length: board.rows }, (_, row) =>
		board.cells.map((column) => column[row]?.name ?? '.').join(''),
	);

const cells = (list) => list.map(([reel, row]) => ({ reel, row }));
const gems = (text) => [...text].map((name) => ({ name }));
const summary = (groups) => groups.map((g) => `${g.symbol}:${g.shape}:${g.cells.length}`);

// ---- match finding ------------------------------------------------------------------------

check('a row run of three is one line3', () => {
	const groups = findMatches(grid(['AAAB', 'BCDC', 'CDBD']));
	assert.deepEqual(summary(groups), ['A:line3:3']);
	assert.deepEqual(
		groups[0].cells,
		cells([
			[0, 0],
			[1, 0],
			[2, 0],
		]),
	);
});

check('a column run of four is a line4, read down the reel', () => {
	const groups = findMatches(grid(['AB', 'AC', 'AB', 'AC', 'BD']));
	assert.deepEqual(summary(groups), ['A:line4:4']);
	assert.deepEqual(
		groups[0].cells,
		cells([
			[0, 0],
			[0, 1],
			[0, 2],
			[0, 3],
		]),
	);
});

check('five or more is a line5', () => {
	assert.deepEqual(summary(findMatches(grid(['AAAAA', 'BCDBC']))), ['A:line5:5']);
	assert.deepEqual(summary(findMatches(grid(['AAAAAA', 'BCDBCD']))), ['A:line5:6']);
});

check('runs meeting at an end of both are one L', () => {
	const groups = findMatches(grid(['ABC', 'ACB', 'AAA']));
	assert.deepEqual(summary(groups), ['A:L:5']);
});

check('a run meeting another in its middle is a T', () => {
	assert.deepEqual(summary(findMatches(grid(['AAA', 'BAC', 'CAB']))), ['A:T:5']);
	assert.deepEqual(summary(findMatches(grid(['BAC', 'AAA', 'CAB']))), ['A:T:5']);
});

check('three runs of one gem sharing cells are one T', () => {
	assert.deepEqual(summary(findMatches(grid(['ABA', 'AAA', 'ACA']))), ['A:T:7']);
});

check('separate groups come back in reel-then-row order', () => {
	const groups = findMatches(grid(['BCAAA', 'BDCDC', 'BCDCD']));
	assert.deepEqual(summary(groups), ['B:line3:3', 'A:line3:3']);
});

check('two touching runs of different gems stay two groups', () => {
	assert.deepEqual(summary(findMatches(grid(['AAAC', 'BBBD', 'CDCE']))), [
		'A:line3:3',
		'B:line3:3',
	]);
});

check('minRun decides what is a run', () => {
	const board = grid(['AAAB', 'CCCC', 'BDBD']);
	assert.deepEqual(summary(findMatches(board)), ['A:line3:3', 'C:line4:4']);
	assert.deepEqual(summary(findMatches(board, { minRun: 4 })), ['C:line4:4']);
	assert.deepEqual(summary(findMatches(grid(['AAB', 'CDC'], { minRun: 2 }))), ['A:line2:2']);
});

check('holes never match', () => {
	assert.deepEqual(findMatches(grid(['...', 'ABC'])), []);
});

check('extra gem fields ride along', () => {
	const board = createBoard({
		cols: 1,
		rows: 1,
		cells: [[{ name: 'A', multiplier: 2 }]],
	});
	assert.deepEqual(board.cells[0][0], { name: 'A', multiplier: 2 });
});

// ---- swapping -----------------------------------------------------------------------------

check('a swap that makes a run is legal, either way round', () => {
	const board = grid(['ABAA', 'CDCD']);
	const a = { reel: 0, row: 0 };
	const b = { reel: 1, row: 0 };
	assert.equal(canSwap(board, a, b), true);
	assert.equal(canSwap(board, b, a), true);
});

check('illegal swaps: no match, not adjacent, diagonal, same gem, a hole, off the board', () => {
	const board = grid(['ABCA', 'CDCD', 'AB.D']);
	assert.equal(canSwap(board, { reel: 0, row: 0 }, { reel: 0, row: 1 }), false, 'no match');
	assert.equal(canSwap(board, { reel: 0, row: 0 }, { reel: 2, row: 0 }), false, 'not adjacent');
	assert.equal(canSwap(board, { reel: 0, row: 0 }, { reel: 1, row: 1 }), false, 'diagonal');
	assert.equal(canSwap(board, { reel: 0, row: 1 }, { reel: 0, row: 1 }), false, 'itself');
	assert.equal(canSwap(board, { reel: 2, row: 1 }, { reel: 2, row: 2 }), false, 'a hole');
	assert.equal(canSwap(board, { reel: 3, row: 0 }, { reel: 4, row: 0 }), false, 'off the board');
	// Two As side by side inside a run: without the same-gem rule, the run would make it a move.
	const same = grid(['AAAB', 'CDCD']);
	assert.equal(canSwap(same, { reel: 0, row: 0 }, { reel: 1, row: 0 }), false, 'same gem');
});

check('a swap must take part in the match it makes', () => {
	// The board already holds a run on row 2; swapping row 0's B and C makes nothing new.
	const board = grid(['BCD', 'DBC', 'AAA']);
	assert.equal(canSwap(board, { reel: 0, row: 0 }, { reel: 1, row: 0 }), false);
});

check('swap trades two cells and leaves the board it was given alone', () => {
	const board = grid(['AB', 'CD']);
	const after = swap(board, { reel: 0, row: 0 }, { reel: 1, row: 1 });
	assert.deepEqual(draw(after), ['DB', 'CA']);
	assert.deepEqual(draw(board), ['AB', 'CD']);
	assert.throws(() => swap(board, { reel: 0, row: 0 }, { reel: 2, row: 0 }), /outside the board/);
});

// ---- clear, gravity, refill ---------------------------------------------------------------

check('clear empties the matched cells; gravity drops the survivors and lists each fall', () => {
	const board = grid(['BCD', 'AAA', 'CDB']);
	const cleared = clear(board, findMatches(board));
	assert.deepEqual(draw(cleared), ['BCD', '...', 'CDB']);
	const { board: fallen, moves } = gravity(cleared);
	assert.deepEqual(draw(fallen), ['...', 'BCD', 'CDB']);
	assert.deepEqual(moves, [
		{ reel: 0, from: 0, to: 1 },
		{ reel: 1, from: 0, to: 1 },
		{ reel: 2, from: 0, to: 1 },
	]);
});

check('gravity keeps a column in order across several holes', () => {
	const { board, moves } = gravity(grid(['A', '.', 'B', '.', 'C']));
	assert.deepEqual(draw(board), ['.', '.', 'A', 'B', 'C']);
	assert.deepEqual(moves, [
		{ reel: 0, from: 0, to: 2 },
		{ reel: 0, from: 2, to: 3 },
	]);
});

check('a book refill drops its gems into the holes, top first', () => {
	const { board, newSymbols } = refill(grid(['.B', '.C', 'AD']), [gems('XY'), []]);
	assert.deepEqual(draw(board), ['XB', 'YC', 'AD']);
	assert.deepEqual(newSymbols, [gems('XY'), []]);
});

check('a book refill must fit the holes exactly, and only after gravity', () => {
	const holed = grid(['.B', '.C', 'AD']);
	assert.throws(() => refill(holed, [gems('X'), []]), /refills reel 0 with 1 gems, but it has 2/);
	assert.throws(() => refill(holed, [gems('XY')]), /one array per column/);
	assert.throws(() => refill(grid(['A', '.', 'B']), [gems('X')]), /run gravity before refill/);
});

check('a pool refill reads the column strip from a seeded stop, wrapping', () => {
	const pool = [['P', 'Q', 'R', 'S'], ['T']];
	const seed = WRAPPING_SEED;
	assert.equal(
		Math.floor(createRng(seed)() * 4),
		3,
		"the seed should stop on the strip's last cell",
	);
	const holed = grid(['..', '.U', 'VW'], { pool, rng: createRng(seed) });
	const { board, newSymbols } = refill(holed, 'pool');
	assert.deepEqual(newSymbols[0], gems('SP'));
	assert.deepEqual(newSymbols[1], gems('T'));
	assert.equal(draw(board)[2], 'VW');
	const replayed = refill(grid(['..', '.U', 'VW'], { pool, rng: createRng(seed) }), 'pool');
	assert.deepEqual(replayed.board.cells, board.cells);
	assert.deepEqual(replayed.newSymbols, newSymbols);
});

check('an RGS board (rng: null) refuses every local draw', () => {
	const pool = [['A', 'B', 'C']];
	const rgs = grid(['.', 'A', 'B'], { pool, rng: null });
	assert.throws(() => refill(rgs, 'pool'), /needs an rng/);
	assert.throws(() => resolve(grid(['C', 'A', 'A', 'A'], { pool })), /needs an rng/);
	assert.throws(() => shuffle(grid(['A', 'B'])), /shuffle needs an rng/);
	assert.throws(() => shuffle(grid(['AB', 'CD']), createRng(1)), /shuffle needs an rng/);
	assert.throws(() => createBoard({ cols: 1, rows: 3, pool }), /deal needs an rng/);
	assert.deepEqual(draw(refill(rgs, [gems('Z')]).board), ['Z', 'A', 'B']);
});

// ---- the cascade --------------------------------------------------------------------------

check('a book-fed cascade chains until nothing matches, each step a tumbleBoard event', () => {
	const board = grid(['CDEC', 'DECD', 'AAAE']);
	const { board: settled, steps } = resolve(board, {
		source: [
			[gems('B'), gems('B'), gems('B'), []],
			[gems('X'), gems('Y'), gems('Z'), []],
		],
	});
	assert.equal(steps.length, 2);
	assert.deepEqual(steps[0].event, {
		type: 'tumbleBoard',
		explodingSymbols: cells([
			[0, 2],
			[1, 2],
			[2, 2],
		]),
		newSymbols: [gems('B'), gems('B'), gems('B'), []],
	});
	assert.deepEqual(summary(steps[0].groups), ['A:line3:3']);
	assert.deepEqual(summary(steps[1].groups), ['B:line3:3']);
	assert.deepEqual(
		steps[1].event.explodingSymbols,
		cells([
			[0, 0],
			[1, 0],
			[2, 0],
		]),
	);
	assert.deepEqual(draw(settled), ['XYZC', 'CDED', 'DECE']);
	assert.deepEqual(findMatches(settled), []);
});

check('a chain can come from the falls alone', () => {
	// Clearing row 3's AAA drops reels 0–2 one row: row 1's CC falls to row 2, beside reel 3's C.
	const board = grid(['EDBD', 'DCCE', 'BEDC', 'AAAE']);
	const { board: settled, steps } = resolve(board, {
		source: [
			[gems('X'), gems('Y'), gems('Z'), []],
			[[], gems('P'), gems('Q'), gems('R')],
		],
	});
	assert.deepEqual(
		steps.map((s) => summary(s.groups)),
		[['A:line3:3'], ['C:line3:3']],
	);
	assert.deepEqual(steps[0].falls.slice(0, 3), [
		{ reel: 0, from: 0, to: 1 },
		{ reel: 0, from: 1, to: 2 },
		{ reel: 0, from: 2, to: 3 },
	]);
	assert.deepEqual(draw(settled), ['XPQR', 'EYZD', 'DDBE', 'BEDE']);
});

check('a book that runs out mid-chain is refused', () => {
	assert.throws(
		() =>
			resolve(grid(['CDEC', 'DECD', 'AAAE']), { source: [[gems('B'), gems('B'), gems('B'), []]] }),
		/ran out of refills at step 2/,
	);
});

check('a book with refills left over, or a source that is neither, is refused', () => {
	const board = grid(['CDEC', 'DECD', 'AAAE']);
	const book = [
		[gems('B'), gems('B'), gems('B'), []],
		[gems('X'), gems('Y'), gems('Z'), []],
	];
	assert.throws(
		() => resolve(board, { source: [...book, [[], [], [], []]] }),
		/settled after 2 steps, but the book refills 3/,
	);
	assert.throws(() => resolve(board, { source: 'Pool' }), /'pool' or the book's refills/);
});

check('a runaway cascade stops at maxSteps and names the strips', () => {
	const board = grid(['A', 'A', 'A'], { pool: [['A']], rng: createRng(1) });
	assert.throws(() => resolve(board, { maxSteps: 5 }), /after 5 steps — check the strips/);
});

check('the RGS mirror: a book of the pool chain replays it on a board with no rng', () => {
	const pool = [gems('ABCDA'), gems('BCDAB'), gems('CDABC'), gems('DABCD'), gems('ABDCA')];
	let found = null;
	for (let seed = 1; seed < 500 && !found; seed++) {
		const dealt = createBoard({ cols: 5, rows: 5, pool, rng: createRng(seed) });
		for (const move of findMoves(dealt)) {
			const swapped = swap(dealt, move.from, move.to);
			const local = resolve(swapped);
			if (local.steps.length >= 2) {
				found = { swapped, local };
				break;
			}
		}
	}
	assert.ok(found, 'no seed under 500 gave a two-step chain');
	const mirror = createBoard({ cols: 5, rows: 5, cells: found.swapped.cells, rng: null });
	const remote = resolve(mirror, { source: found.local.steps.map((s) => s.event.newSymbols) });
	assert.deepEqual(remote.steps, found.local.steps);
	assert.deepEqual(remote.board.cells, found.local.board.cells);
});

// ---- moves, shuffle, the deal -------------------------------------------------------------

check('hasMoves and findMoves', () => {
	assert.equal(hasMoves(grid(['ABC', 'DEF', 'GHI'])), false);
	const board = grid(['AABA', 'DEFG']);
	assert.equal(hasMoves(board), true);
	assert.deepEqual(findMoves(board), [{ from: { reel: 2, row: 0 }, to: { reel: 3, row: 0 } }]);
	assert.equal(hasMoves(grid(['AABA', 'CDEF']), { minRun: 4 }), false);
});

check('shuffle keeps the gems, leaves no match and a move, and replays from a seed', () => {
	const board = grid(['ABCD', 'BCDA', 'CDAB', 'DABC'], { rng: createRng('board') });
	const first = shuffle(board, createRng('s'));
	const again = shuffle(board, createRng('s'));
	assert.deepEqual(first.cells, again.cells);
	assert.deepEqual(draw(first).join('').split('').sort(), draw(board).join('').split('').sort());
	assert.deepEqual(findMatches(first), []);
	assert.equal(hasMoves(first), true);
	assert.deepEqual(draw(board), ['ABCD', 'BCDA', 'CDAB', 'DABC']);
	assert.throws(
		() => shuffle(grid(['AB', 'CD'], { rng: createRng(1) })),
		/no shuffle of these gems/,
	);
});

check('a dealt board has no match and a move, and the same seed deals it again', () => {
	const pool = [
		gems('ABCDE'),
		gems('BCDEA'),
		gems('CDEAB'),
		gems('DEABC'),
		gems('EABCD'),
		gems('ACEBD'),
	];
	for (let seed = 0; seed < 50; seed++) {
		const options = { cols: 6, rows: 5, pool, rng: createRng(seed) };
		const board = createBoard(options);
		assert.deepEqual(findMatches(board), [], `seed ${seed} dealt a match`);
		assert.equal(hasMoves(board), true, `seed ${seed} dealt no move`);
		assert.deepEqual(createBoard({ ...options, rng: createRng(seed) }).cells, board.cells);
	}
	assert.throws(
		() => createBoard({ cols: 3, rows: 3, pool: [['A'], ['A'], ['A']], rng: createRng(1) }),
		/dealt no board without a match/,
	);
});

check('malformed boards and pools are refused', () => {
	assert.throws(() => findMatches(grid(['AB']), { minRun: 1 }), /minRun/);
	assert.throws(() => createBoard({ cols: 0, rows: 3, cells: [] }), /whole numbers above 0/);
	assert.throws(
		() => createBoard({ cols: 1, rows: 1, minRun: 1, cells: [[{ name: 'A' }]] }),
		/minRun/,
	);
	assert.throws(
		() => createBoard({ cols: 2, rows: 1, cells: [[{ name: 'A' }]] }),
		/one column per reel/,
	);
	assert.throws(() => createBoard({ cols: 1, rows: 2, cells: [[{ name: 'A' }]] }), /needs 2 cells/);
	assert.throws(() => createBoard({ cols: 1, rows: 1, cells: [[{}]] }), /no name/);
	assert.throws(
		() => createBoard({ cols: 2, rows: 1, pool: [['A']], rng: Math.random }),
		/one strip per column/,
	);
	assert.throws(
		() => createBoard({ cols: 1, rows: 1, pool: [[]], rng: Math.random }),
		/strip is empty/,
	);
	assert.throws(() => createBoard({ cols: 1, rows: 1 }), /give it the cells, or a pool/);
});

// ---- a seed replays identically -----------------------------------------------------------

/** A scripted session: deal, then each turn pick a legal swap with the board's own rng, cascade
 *  from the pool, and shuffle on a dead end. The trace is everything a player would see. */
function playSession({ seed, turns, rows, pool }) {
	const rng = createRng(seed);
	let board = createBoard({ cols: pool.length, rows, pool, rng });
	const trace = { seed, deal: draw(board), turns: [] };
	for (let turn = 0; turn < turns; turn++) {
		const moves = findMoves(board);
		const move = moves[Math.floor(rng() * moves.length)];
		const { board: settled, steps } = resolve(swap(board, move.from, move.to));
		board = settled;
		const entry = {
			move: [move.from.reel, move.from.row, move.to.reel, move.to.row],
			steps: steps.map((s) => ({
				groups: summary(s.groups),
				newSymbols: s.event.newSymbols.map((column) => column.map((g) => g.name).join('')),
			})),
			board: draw(board),
		};
		if (!hasMoves(board)) {
			board = shuffle(board);
			entry.shuffled = draw(board);
		}
		trace.turns.push(entry);
	}
	return trace;
}

const FIVE_GEMS = [
	'RGBYPRGBYP',
	'GBYPRGRBYP',
	'BYPRGBGYPR',
	'YPRGBYPRBG',
	'PRGBYRGBPY',
	'RBGPYBRGYP',
	'GYRBPGYRPB',
];
/** Six gems on a 5 × 5 board run out of moves often, so this one reaches `shuffle`. */
const SIX_GEMS = ['ABCDEF', 'BCDEFA', 'CDEFAB', 'DEFABC', 'EFABCD'];
const SESSIONS = [
	{ seed: 'p10.2', turns: 25, rows: 6, pool: FIVE_GEMS.map(gems) },
	{ seed: 20261023, turns: 25, rows: 6, pool: FIVE_GEMS.map(gems) },
	{ seed: 'dead-end', turns: 30, rows: 5, pool: SIX_GEMS.map(gems) },
];

check('a seed replays identically, and matches the committed trace', () => {
	const traces = SESSIONS.map(playSession);
	assert.deepEqual(SESSIONS.map(playSession), traces, 'the same seed played twice differed');
	assert.ok(
		traces.every((t) => t.turns.some((turn) => turn.steps.length >= 2)),
		'every session should include a chain of two or more steps',
	);
	assert.ok(
		traces.some((t) => t.turns.some((turn) => turn.shuffled)),
		'a session should reach a dead end and shuffle',
	);
	if (process.argv.includes('--update')) {
		writeFileSync(REPLAY_FIXTURE, `${JSON.stringify(traces, null, '\t')}\n`);
		return;
	}
	assert.deepEqual(
		traces,
		JSON.parse(readFileSync(REPLAY_FIXTURE, 'utf8')),
		'the replay drifted from board-replay.json (run with --update only if the change to the rules is meant)',
	);
});

if (failures.length) {
	console.error(failures.join('\n'));
	console.error(`\ncheck:board-mechanic — ${failures.length} failed, ${passed} passed`);
	process.exit(1);
}
console.log(`check:board-mechanic — ${passed} checks passed`);
