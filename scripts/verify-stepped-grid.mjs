// Offline fixture for STEPPED GRIDS (docs/design/stepped-grid.md) — the server half.
//
//   node scripts/verify-stepped-grid.mjs
//
// WHAT IT PROVES. `numRows` is a per-reel array, and until now only the game's MATH read it that
// way while every dealer collapsed it to `Math.max(...)`. That is the failure this fixture exists to
// prevent coming back: a server dealing a rectangle at a board that draws a diamond means the client
// seats cells the server never scored — the client board silently diverging from the scored board.
//
// Six claims:
//
//   1. `resolveGrid` — the one resolver both halves read — places columns where the design says,
//      under each of the three alignments, and reports `stepped` honestly.
//   2. THE DEAL IS RAGGED. `createMockRgs` given a per-reel list deals each column to ITS OWN
//      height, end to end through a real bet, not merely in the helper.
//   3. PARITY, and this is the load-bearing one. A uniform board must be untouched — so the same
//      seed dealt with `rows: 3` and with `rows: [3,3,3,3,3]` must produce BYTE-IDENTICAL reveals.
//      If the array path perturbed the RNG stream by so much as one draw, every existing game's
//      deal would shift the day this shipped, with nothing to blame it on.
//   4. The payline helpers understand per-column heights: `standardPaylines` never names a row a
//      short column does not have, and `coversAllRows` judges coverage per column (a board-wide
//      test can never be satisfied by a stepped grid, so it would regenerate lines forever).
//   5. The CLIENT holds the server to its declaration — `clampBoardToGrid` cuts per column.
//   6. The per-column window actually reaches the symbols, the reveal reaches ANTICIPATION per
//      column too, and the clip is ONE compound mask
//      rather than a container per column — which is what lets a stepped board also be a
//      perspective board. Asserted against the source, because Svelte template wiring cannot
//      be executed from Node, and it is the half no data-level test can see.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileSlice, stripSliceTypes } from './lib/compile-slice.mjs';
import { lfReaderFrom, readLF } from './lib/read-lf.mjs';

import { createMockRgs, standardPaylines, coversAllRows, rowsPerReel } from './mock-rgs-server.mjs';
import { resolveGrid } from '../packages/game-config/src/grid.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
let checks = 0;

const fail = (label, extra = '') => {
	failures += 1;
	console.log(`FAIL  ${label}${extra ? '  ' + extra : ''}`);
};
const same = (label, got, want) => {
	checks += 1;
	if (!Object.is(got, want)) fail(label, `got=${got} want=${want}`);
};
const deepSame = (label, got, want) => {
	checks += 1;
	const a = JSON.stringify(got);
	const b = JSON.stringify(want);
	if (a !== b) fail(label, `\n    got  ${a}\n    want ${b}`);
};

// ---------------------------------------------------------------------------
// 1. the resolver
// ---------------------------------------------------------------------------
{
	const cases = [
		['uniform 5x3', { numReels: 5, numRows: [3, 3, 3, 3, 3] }, false, [0, 0, 0, 0, 0]],
		['diamond centre', { numReels: 5, numRows: [3, 4, 5, 4, 3] }, true, [1, 0.5, 0, 0.5, 1]],
		[
			'diamond top',
			{ numReels: 5, numRows: [3, 4, 5, 4, 3], gridAlign: 'top' },
			true,
			[0, 0, 0, 0, 0],
		],
		[
			'diamond bottom',
			{ numReels: 5, numRows: [3, 4, 5, 4, 3], gridAlign: 'bottom' },
			true,
			[2, 1, 0, 1, 2],
		],
		['ramp', { numReels: 5, numRows: [2, 3, 4, 5, 6] }, true, [2, 1.5, 1, 0.5, 0]],
		// A short/garbage `numRows` must still describe a board rather than throwing or dealing NaN.
		['short numRows pads', { numReels: 4, numRows: [4] }, false, [0, 0, 0, 0]],
		['garbage entries', { numReels: 3, numRows: [3, 'x', -2] }, false, [0, 0, 0]],
		// An unknown alignment falls back to centre rather than erroring, like every other block.
		[
			'bogus align ⇒ centre',
			{ numReels: 3, numRows: [1, 3, 1], gridAlign: 'sideways' },
			true,
			[1, 0, 1],
		],
	];
	for (const [label, doc, stepped, offsets] of cases) {
		const g = resolveGrid(doc);
		same(`resolveGrid :: ${label} :: stepped`, g.stepped, stepped);
		deepSame(
			`resolveGrid :: ${label} :: offsets`,
			g.rows.map((_r, i) => g.rowOffsetForReel(i)),
			offsets,
		);
		// Every column must sit fully inside the bounding box, always.
		g.rows.forEach((h, i) => {
			checks += 1;
			if (g.rowOffsetForReel(i) + h > g.maxRows + 1e-9)
				fail(`resolveGrid :: ${label} :: reel ${i} escapes the bounding box`);
		});
	}
}

// ---------------------------------------------------------------------------
// 2 + 3. the deal — ragged when stepped, byte-identical when not
// ---------------------------------------------------------------------------

/** Drive one real bet through a mock instance and return the reveal board it dealt. */
const dealOnce = async (opts) => {
	const mock = createMockRgs({ seed: 'stepped-fixture', startBalance: 100000, ...opts });
	const body = JSON.stringify([
		{ action: 'bet', context: [1, 10] },
		{ action: 'play', context: '' },
	]);
	const req = {
		method: 'POST',
		url: '/rgs/engine?sid=fixture&seq=0',
		headers: { 'content-type': 'application/json' },
		on(event, cb) {
			if (event === 'data') cb(Buffer.from(body));
			if (event === 'end') cb();
			return this;
		},
	};
	let payload = null;
	const res = {
		writeHead() {},
		setHeader() {},
		end(text) {
			try {
				payload = JSON.parse(text);
			} catch {
				payload = null;
			}
		},
	};
	await mock.handle(req, res, new URL('http://mock.local/rgs/engine?sid=fixture&seq=0'));
	const reveal = payload?.events?.find((e) => e.event === 'playedSpin' || e.event === 'reveal');
	const ctx = reveal?.context;
	const board = Array.isArray(ctx) ? ctx : (ctx?.board ?? ctx?.reels ?? null);
	const config = payload?.events?.find((e) => e.event === 'config');
	// The round ID is a fresh random string per round and says nothing about the DEAL, so the parity
	// comparison below drops it. Everything else — every event, every dealt cell, the balance — is
	// compared verbatim, which is the actual claim: the RNG stream is untouched.
	const dealt = JSON.parse(JSON.stringify(payload ?? null));
	if (dealt?.platform?.gameRound?.id) dealt.platform.gameRound.id = '<round-id>';
	return { board, config, payload: dealt };
};

{
	// --- ragged ---
	const heights = [3, 4, 5, 4, 3];
	const { board, config } = await dealOnce({ reels: 5, rows: heights });
	checks += 1;
	if (!board) {
		fail('stepped deal :: no reveal board in the response');
	} else {
		deepSame(
			'stepped deal :: each column dealt its OWN height',
			board.map((c) => c.length),
			heights,
		);
		checks += 1;
		if (board.flat().some((cell) => typeof cell !== 'string' || !cell))
			fail('stepped deal :: a dealt cell was not a symbol');
	}
	// The server must DECLARE the shape it dealt, or the client cannot hold it to it.
	deepSame(
		'stepped deal :: config declares rowsPerReel',
		config?.context?.window?.rowsPerReel,
		heights,
	);
	same('stepped deal :: config rows is still the bounding box', config?.context?.window?.rows, 5);

	// --- parity: number vs equivalent array, same seed ---
	const flat = await dealOnce({ reels: 5, rows: 3 });
	const asArray = await dealOnce({ reels: 5, rows: [3, 3, 3, 3, 3] });
	deepSame(
		'parity :: `rows: 3` and `rows: [3,3,3,3,3]` deal the IDENTICAL board',
		flat.board,
		asArray.board,
	);
	deepSame(
		'parity :: …and the IDENTICAL whole response (RNG stream untouched)',
		flat.payload,
		asArray.payload,
	);
	// A uniform board must not advertise a per-column shape at all — the config event a normal game
	// receives has to be the one it received before this existed.
	same(
		'parity :: uniform config carries NO rowsPerReel key',
		'rowsPerReel' in (flat.config?.context?.window ?? {}),
		false,
	);
}

// ---------------------------------------------------------------------------
// 4. the payline helpers
// ---------------------------------------------------------------------------
{
	// `rowsPerReel` accepts both shapes.
	deepSame('rowsPerReel :: number', rowsPerReel(3, 4, 3), [3, 3, 3, 3]);
	deepSame('rowsPerReel :: array', rowsPerReel([2, 5], 4, 3), [2, 5, 5, 5]);

	// A generated line may never name a row its column lacks.
	for (const heights of [
		[3, 4, 5, 4, 3],
		[2, 3, 4, 5, 6],
		[1, 5, 1],
	]) {
		const lines = standardPaylines(heights.length, heights);
		for (const line of lines) {
			same(`standardPaylines :: line is ${heights.length} wide`, line.length, heights.length);
			line.forEach((row, reel) => {
				checks += 1;
				if (row < 0 || row >= heights[reel])
					fail(
						`standardPaylines :: ${heights.join('/')} line ${line.join(',')} names row ${row} on a ${heights[reel]}-row reel`,
					);
			});
		}
		// …and the generated set must SATISFY the coverage gate, or the server regenerates forever.
		checks += 1;
		if (!coversAllRows(lines, heights))
			fail(`coversAllRows :: generated set for ${heights.join('/')} does not satisfy its own gate`);
	}

	// Uniform behaviour is unchanged: a number still means what it meant.
	deepSame(
		'standardPaylines :: number === equivalent array',
		standardPaylines(5, 3),
		standardPaylines(5, [3, 3, 3, 3, 3]),
	);
	same(
		'coversAllRows :: stock 5x3 set covers a 3-row board',
		coversAllRows(
			[
				[0, 0, 0, 0, 0],
				[1, 1, 1, 1, 1],
				[2, 2, 2, 2, 2],
			],
			3,
		),
		true,
	);
	same(
		'coversAllRows :: …but not a 5-row one',
		coversAllRows(
			[
				[0, 0, 0, 0, 0],
				[1, 1, 1, 1, 1],
				[2, 2, 2, 2, 2],
			],
			5,
		),
		false,
	);
}

// ---------------------------------------------------------------------------
// 5. THE CLIENT HOLDS THE SERVER TO ITS DECLARATION.
//
// Dealing ragged is only half of it. If the client clamps an incoming reveal to the BOUNDING BOX,
// a column dealt too tall survives into a short window and the client seats rows the server never
// scored — the client board diverging from the scored board, silently. `clampBoardToGrid` is sliced
// out of the real facade (it is module-private, so it cannot be imported) and run against a stubbed
// captured config, so this checks the shipped expression rather than a copy that can rot.
// ---------------------------------------------------------------------------
{
	const source = readLF(join(ROOT, 'packages/rgs-translator-eagaming/src/engineFacade.ts'));
	const start = source.indexOf('const clampBoardToGrid = (');
	if (start < 0) throw new Error('could not locate clampBoardToGrid in engineFacade.ts');
	const end = source.indexOf('\n};\n', start);
	if (end < 0) throw new Error('could not locate the end of clampBoardToGrid');
	// Node's own stripper, not annotation-shaped regexes: the slice's types are whatever the shipped
	// facade writes today, and a shape the regexes missed would land as a bare SyntaxError from
	// `<anonymous_script>`. See lib/compile-slice.mjs.
	const block = stripSliceTypes(
		'engineFacade.ts#clampBoardToGrid',
		source.slice(start, end + '\n};\n'.length),
	);

	const build = (window) =>
		compileSlice({
			what: 'verify-stepped-grid / engineFacade.ts#clampBoardToGrid',
			names: ['capturedConfig', 'warnedUnknownSymbols', 'console'],
			body: `${block}\nreturn clampBoardToGrid;`,
		})(new Map([['s', { window }]]), new Set(), { warn() {} });

	const tall = Array.from({ length: 5 }, (_u, reel) =>
		Array.from({ length: 5 }, (_v, row) => `r${reel}.${row}`),
	);

	// STEPPED: each column is cut to ITS OWN height, not to the tallest.
	const stepped = build({ reels: 5, rows: 5, rowsPerReel: [3, 4, 5, 4, 3] });
	deepSame(
		'clamp :: a full-height deal is cut per COLUMN',
		stepped(
			's',
			tall.map((c) => [...c]),
		).map((c) => c.length),
		[3, 4, 5, 4, 3],
	);
	// A column dealt SHORT is left alone — the clamp is an upper bound, never padding.
	deepSame(
		'clamp :: a short column is untouched',
		stepped('s', [['a'], ['b', 'b'], ['c'], ['d'], ['e']]).map((c) => c.length),
		[1, 2, 1, 1, 1],
	);
	// Every column keeps its TOP cells, in order — the clamp is a truncation, never a reshuffle.
	deepSame(
		'clamp :: every column keeps its top cells in order',
		stepped(
			's',
			tall.map((c) => [...c]),
		),
		[
			['r0.0', 'r0.1', 'r0.2'],
			['r1.0', 'r1.1', 'r1.2', 'r1.3'],
			['r2.0', 'r2.1', 'r2.2', 'r2.3', 'r2.4'],
			['r3.0', 'r3.1', 'r3.2', 'r3.3'],
			['r4.0', 'r4.1', 'r4.2'],
		],
	);

	// UNIFORM: no `rowsPerReel` ⇒ the board-wide clamp, exactly as before.
	const flatClamp = build({ reels: 5, rows: 3 });
	deepSame(
		'clamp :: without rowsPerReel it is the board-wide clamp (unchanged)',
		flatClamp(
			's',
			tall.map((c) => [...c]),
		).map((c) => c.length),
		[3, 3, 3, 3, 3],
	);
}

// ---------------------------------------------------------------------------
// 6. THE PER-COLUMN WINDOW ACTUALLY REACHES THE SYMBOLS.
//
// A stepped board's clip window is only worth having if the layers that draw a symbol are wired to
// it, and that wiring is Svelte TEMPLATE structure — it cannot be imported and executed from Node.
// So it is asserted against the SOURCE, the same way `verify-symbol-seat.mjs` asserts `ReelSymbol`'s
// two y sources. Cheap, and it catches the regression no other fixture here can see: someone
// dropping a `reelIndex` prop or the compound-mask branch while every data-level check stays green.
//
// The CLIP is one mask over the union of the column windows, NOT a container per column. That
// distinction is the whole reason a stepped board can also be a perspective board: grouping the
// children by column forces a column-major scene graph, and perspective needs a row-major one so a
// front-row character paints over the row behind it. A compound mask needs no grouping, so both
// `BoardBase` branches stay exactly as they were.
// ---------------------------------------------------------------------------
{
	const read = lfReaderFrom(ROOT);
	const has = (label, rel, re) => {
		checks += 1;
		if (!re.test(read(rel))) fail(`wiring :: ${label}`, `${rel} no longer matches ${re}`);
	};
	const hasNot = (label, rel, re) => {
		checks += 1;
		if (re.test(read(rel))) fail(`wiring :: ${label}`, `${rel} unexpectedly matches ${re}`);
	};

	// The cell renderer must hand `SymbolWrap` the column, or the unmasked animate layer culls
	// board-wide — and a short column's padding row is INSIDE the board-wide window, so it would draw.
	// ONE renderer answers for both now: the cascade drives the board's own cells rather than
	// drawing a second set of its own (docs/design/board-cell-continuity.md), so this is the claim
	// for a resting board and a cascading one alike.
	has(
		'ReelSymbol passes reelIndex to SymbolWrap',
		'apps/lines/src/components/ReelSymbol.svelte',
		/<SymbolWrap[\s\S]{0,200}?reelIndex=\{props\.reelIndex\}/,
	);
	// SymbolWrap must GATE the per-column window on `stepped`, or a uniform board starts allocating a
	// window object per symbol per render for the answer it already had.
	has(
		'SymbolWrap gates the per-column window on stepped',
		'apps/lines/src/components/SymbolWrap.svelte',
		/activeGrid\(\)\.stepped[\s\S]{0,120}?boardWindowForReel\(props\.reelIndex\)/,
	);
	// The mask is compound, and it is still ONE mask on the same container.
	has(
		'BoardMask draws the compound shape when stepped',
		'apps/lines/src/components/BoardMask.svelte',
		/\{#if maskColumns\}[\s\S]{0,400}?<Graphics[\s\S]{0,300}?isMask/,
	);
	// …and a uniform board still takes ONE rectangle. Its x now carries the settled board's symbol
	// overflow (`-SYMBOL_SIZE - overflow.x`), which is `-SYMBOL_SIZE` verbatim for every board that
	// authored none — the branch is what this pins, not the arithmetic. No distance bound between the
	// `{:else}` and the element: the comment above it documents the latch bug and is long, and a
	// character budget that fails when someone explains themselves is a bad guard.
	has(
		'BoardMask keeps the single Rectangle for a uniform board',
		'apps/lines/src/components/BoardMask.svelte',
		/\{:else\}[\s\S]*?<Rectangle\s+isMask\s+x=\{-SYMBOL_SIZE/,
	);
	// ANTICIPATION reads the reveal PER COLUMN. A reveal arrives padded one row top and bottom, and
	// slicing every column to the BOUNDING BOX leaves a short column carrying its bottom padding row
	// — four cells in a three-cell column. Nothing downstream can detect that: for `ways` the pay is
	// a product over the per-reel counts divided by the ways count, and both move, so the round
	// simply pays the wrong multiple; for `lines` an off-screen symbol can complete a run. The fix is
	// one slice, and this is the assertion that keeps it.
	has(
		'buildAnticipationArming slices the reveal per column',
		'apps/lines/src/game/anticipation.ts',
		/reel\.slice\(1, 1 \+ grid\.rowsForReel\(reelIndex\)\)/,
	);
	hasNot(
		'…and not to the bounding box',
		'apps/lines/src/game/anticipation.ts',
		/slice\(1, 1 \+ y\)/,
	);

	// THE PARITY CLAIM THAT MATTERS MOST: the board does not group its children per column, so the
	// scene graph — and therefore the paint order both modes depend on — is untouched.
	hasNot(
		'BoardBase does not group children per column',
		'apps/lines/src/components/BoardBase.svelte',
		/ReelColumn/,
	);
}

console.log(`\n${checks} assertions`);
if (failures) {
	console.log(`${failures} FAILED — stepped grids are broken.`);
	process.exit(1);
}
console.log(
	'PASS — a stepped grid deals ragged and declares it, a uniform one deals byte-identically to ' +
		'before, and no generated payline points off a short column.',
);
