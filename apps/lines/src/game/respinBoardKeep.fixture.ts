/**
 * Offline fixture for the Hold and Win respin board kept between features (`respinBoardKeep.ts`,
 * drawn by `RespinBoard.svelte`, `RespinCell.svelte` and `RespinHeldSymbol.svelte`):
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs apps/lines/src/game/respinBoardKeep.fixture.ts
 *
 * The cells' paint order (`createVisitOrder`), over random runs of features (each shown with some
 * rows open, rows unlocking and closing while shown, the board put away, another respin mode's
 * board): the kept cells, sorted by the place they are given, are in exactly the order a board
 * mounted for the feature holds its cells (those open at the show in list order, then each one as it
 * opened), and nothing moves while the board is away.
 *
 * The held seats (`createSeatViews`), over random runs of held layers (coins sticking and leaving in
 * any order, a coin's symbol changing in place, the board put away and shown again): a seat draws
 * exactly while it is held; its entry changes exactly when a component keyed by the seat would have
 * mounted again, never when its cell changes in place; the views run in the held order with the
 * empty seats last; a seat builds its view once; an item and the list are handed out again unchanged
 * exactly when nothing in them changed.
 *
 * Plus source pins: the board is mounted from the first feature on and hidden, not destroyed,
 * between features; its cells are drawn while away as vacant, in their visit order; its held layer
 * draws through the seat views, nothing while away; the tiles, locked cells, counter and dials are
 * mounted per feature; a held coin is a view of its seat, drawing nothing while empty and starting
 * its label pops at each entry.
 */

import { createSeatViews, createVisitOrder, type SeatView } from './respinBoardKeep.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** A seeded generator, so a failure names a run that can be replayed. */
const random = (seed: number) => () => {
	seed = (seed * 1103515245 + 12345) & 0x7fffffff;
	return seed / 0x7fffffff;
};

console.log('the cells keep the order a board mounted for the feature appends them in');
{
	const order = createVisitOrder<string>();
	const first = order(true, ['a', 'b', 'c']);
	check(
		'a first show places the cells in list order',
		same(
			[...first],
			[
				['a', 1],
				['b', 2],
				['c', 3],
			],
		),
	);
	check('the same cells shown again keep the same answer', order(true, ['a', 'b', 'c']) === first);
	const joined = order(true, ['a', 'b', 'c', 'd']);
	check('a cell joining while shown goes after every cell before it', joined.get('d') === 4);
	const away = order(false, ['a', 'b', 'c', 'd']);
	check('put away, the answer is the last one shown', away === joined);
	const again = order(true, ['d', 'a']);
	check(
		'a new feature places its cells in list order again, whatever they held before',
		same(
			[...again],
			[
				['d', 1],
				['a', 2],
			],
		),
	);
	const left = order(true, ['a']);
	check('a cell leaving gives its place up', same([...left], [['a', 2]]));
	check('a cell joining after one left still goes last', order(true, ['a', 'b']).get('b') === 3);
}
{
	type Cell = { board: number; reel: number; row: number };
	const reels = 5;
	const runs = 400;
	let steps = 0;
	let mismatch = '';
	let moved = '';
	let kept = 0;
	for (let run = 0; run < runs && !mismatch && !moved; run++) {
		const rnd = random(run + 1);
		const boards: Cell[][] = [];
		const boardOf = (index: number, rows: number) => {
			boards[index] ??= Array.from({ length: reels * rows }, (_, i) => ({
				board: index,
				reel: Math.floor(i / rows),
				row: i % rows,
			}));
			return boards[index];
		};
		const order = createVisitOrder<Cell>();
		// The component: its kept list while away, its children in the order they were added.
		let keptCells: Cell[] = [];
		let children: Cell[] = [];
		// A board mounted for the feature: its children in mount order, none while away.
		let fresh: Cell[] = [];
		let shown = false;
		let board = 0;
		let maxRows = 5;
		let open = 3;
		const cellsOf = () => boardOf(board, maxRows).filter((cell) => cell.row < open);
		for (let step = 0; step < 60; step++) {
			steps++;
			const roll = rnd();
			const wasShown = shown;
			if (!shown) {
				if (roll < 0.15) {
					board++;
					maxRows = 3 + Math.floor(rnd() * 3);
				}
				shown = true;
				open = 1 + Math.floor(rnd() * maxRows);
			} else if (roll < 0.25) shown = false;
			else if (roll < 0.6) open = Math.min(maxRows, open + 1);
			else if (roll < 0.7) open = Math.max(1, open - 1);
			const listed = shown ? cellsOf() : keptCells;
			if (shown) keptCells = listed;
			// The keyed `{#each}`: a cell leaving is destroyed, a new one appended in list order.
			const present = new Set(listed);
			children = children.filter((cell) => present.has(cell));
			for (const cell of listed) if (!children.includes(cell)) children.push(cell);
			const placed = order(shown, listed);
			if (shown && !wasShown) fresh = [...listed];
			else if (shown) {
				fresh = fresh.filter((cell) => present.has(cell));
				for (const cell of listed) if (!fresh.includes(cell)) fresh.push(cell);
			} else fresh = [];
			if (!shown) continue;
			if (!wasShown) kept += children.length;
			const drawn = [...children].sort((x, y) => (placed.get(x) ?? 0) - (placed.get(y) ?? 0));
			if (drawn.some((cell) => placed.get(cell) === undefined))
				mismatch = `run ${run} step ${step}: a drawn cell has no place`;
			else if (!same(drawn, fresh))
				mismatch = `run ${run} step ${step}: drawn ${JSON.stringify(drawn.map((c) => [c.reel, c.row]))} vs mounted ${JSON.stringify(fresh.map((c) => [c.reel, c.row]))}`;
		}
		// Away: nothing a hidden board draws changes place.
		const before = order(true, cellsOf());
		const awayAnswer = order(false, cellsOf());
		if (awayAnswer !== before) moved = `run ${run}: the answer changed while away`;
	}
	check(
		`over ${runs} runs (${steps} steps, ${kept} cells shown again), the kept cells paint in a freshly mounted board's order`,
		!mismatch && kept > 10000,
		mismatch,
	);
	check('nothing changes place while the board is away', !moved, moved);
}

console.log('the held coins draw through one view per seat');
{
	type Held = { reel: number; row: number; symbol: string };
	const seat = (cell: Held) => `${cell.reel},${cell.row}`;
	const runs = 400;
	let steps = 0;
	let entries = 0;
	let changes = 0;
	const fails: string[] = [];
	const fail = (text: string) => {
		if (fails.length < 5) fails.push(text);
	};
	let identityFails = 0;
	let built = 0;
	let seatsUsed = 0;
	for (let run = 0; run < runs; run++) {
		const rnd = random(run + 1000);
		const views = createSeatViews<Held>(seat);
		const ids = new Set<string>();
		let held: Held[] = [];
		let before: SeatView<Held>[] | undefined;
		let mountedBefore = new Set<string>();
		const entryOf = new Map<string, number | undefined>();
		const lists: SeatView<Held>[][] = [];
		for (let step = 0; step < 50; step++) {
			steps++;
			const roll = rnd();
			if (roll < 0.1) held = [];
			else if (roll < 0.45) {
				const reel = Math.floor(rnd() * 5);
				const row = Math.floor(rnd() * 4);
				if (!held.some((cell) => cell.reel === reel && cell.row === row))
					held = [...held, { reel, row, symbol: `C${Math.floor(rnd() * 9)}` }];
			} else if (roll < 0.6 && held.length)
				held = held.filter((_, i) => i !== Math.floor(rnd() * held.length));
			else if (roll < 0.75 && held.length) {
				// A coin's symbol changes in place: a new object for the same seat (an upgrade).
				const i = Math.floor(rnd() * held.length);
				held = held.map((cell, j) => (j === i ? { ...cell, symbol: `${cell.symbol}+` } : cell));
				changes++;
			} else if (roll < 0.85 && held.length > 1) {
				// The server's snapshot replaces the picture: every cell a new object, the order shuffled.
				held = [...held].reverse().map((cell) => ({ ...cell }));
			}
			const list = views(held);
			lists.push(list);
			const mounted = new Set(held.map(seat));
			for (const view of list) {
				if (!ids.has(view.id)) {
					ids.add(view.id);
					built++;
				}
			}
			// A seat draws exactly while held, and runs in the held order, the empty seats last.
			const drawing = list.filter((view) => view.entry !== undefined).map((view) => view.id);
			if (!same(drawing, held.map(seat)))
				fail(`run ${run} step ${step}: drawing ${drawing} vs held ${held.map(seat)}`);
			if (list.slice(drawing.length).some((view) => view.entry !== undefined))
				fail(`run ${run} step ${step}: an empty seat listed before a held one`);
			for (const cell of held) {
				const view = list.find((v) => v.id === seat(cell));
				if (view?.cell !== cell)
					fail(`run ${run} step ${step}: seat ${seat(cell)} draws another cell`);
			}
			// Its entry moves exactly where a component keyed by the seat would have mounted.
			for (const view of list) {
				const remounted = mounted.has(view.id) && !mountedBefore.has(view.id);
				const previous = entryOf.get(view.id);
				const moved = view.entry !== previous;
				if (mounted.has(view.id) && remounted !== moved)
					fail(
						`run ${run} step ${step}: seat ${view.id} entry ${previous} → ${view.entry}, remounted ${remounted}`,
					);
				if (remounted) entries++;
				entryOf.set(view.id, view.entry);
			}
			// An item is handed out again exactly while its cell and entry are.
			if (before) {
				for (const view of list) {
					const old = before.find((v) => v.id === view.id);
					if (!old) continue;
					const unchanged = old.cell === view.cell && old.entry === view.entry;
					if ((old === view) !== unchanged) identityFails++;
				}
			}
			before = list;
			mountedBefore = mounted;
		}
		seatsUsed += ids.size;
		const unchangedListKept = lists.every((list, i) => {
			if (i === 0) return true;
			const prev = lists[i - 1];
			const unchanged = list.length === prev.length && list.every((item, j) => item === prev[j]);
			return (list === prev) === unchanged;
		});
		if (!unchangedListKept)
			fail(`run ${run}: a list handed out anew though unchanged, or kept though changed`);
	}
	check(
		`over ${runs} runs (${steps} steps, ${entries} coins held, ${changes} changed in place), each seat draws while held, enters where its component mounted, and runs in the held order`,
		fails.length === 0 && entries > 2000 && changes > 1000,
		fails.join('\n       '),
	);
	check('an item is handed out again exactly while its cell and entry are', identityFails === 0);
	check('a seat builds its view once', built === seatsUsed);
}

type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
// Imported by name at run time: this package's tsconfig carries no Node types.
void import('node:' + 'fs').then((fs: Fs) => {
	const read = (path: string) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');
	console.log('the components keep the board');
	const board = read('../components/RespinBoard.svelte');
	const markup = board.slice(board.lastIndexOf('</script>'));
	check(
		'mounted from the first feature on, hidden while the base game plays',
		/const kept = \$derived\.by\(\(\) => \{\s*if \(board\) keptBoard = board;\s*return keptBoard;\s*\}\);/.test(
			board,
		) &&
			/\{#if kept\}\s*<BoardContainer visible=\{board !== null\}>/.test(markup) &&
			!/\{#if board\}\s*<BoardContainer/.test(markup),
	);
	check(
		'the cells are kept, away and in their visit order while the board is put away',
		/const cells = \$derived\.by\(\(\) => \{\s*if \(board\) keptCells = openCells;\s*return keptCells;\s*\}\);/.test(
			board,
		) &&
			/const cellOrder = \$derived\(cellOrders\(board !== null, cells\)\);/.test(board) &&
			/\{#each cells as cell \(cell\)\}\s*<RespinCell\s+\{cell\}\s+held=\{[^}]+\}\s+away=\{!board\}\s+order=\{cellOrder\.get\(cell\)\}/.test(
				markup,
			),
	);
	check(
		'the held layer draws through the seat views, nothing while the board is put away',
		/const heldViews = \$derived\(seatViews\(board \? stateRespinBoard\.held : \[\]\)\);/.test(
			board,
		) &&
			/\{#each heldViews as view \(view\.id\)\}\s*<RespinHeldSymbol cell=\{view\.cell\} entry=\{view\.entry\} \/>/.test(
				markup,
			),
	);
	check(
		'the tiles, locked cells, counter and dials are mounted per feature',
		/\{#if board && \(tileComponent \|\| tileArt\)\}\s*\{#each openCells as cell \(cell\)\}/.test(
			markup,
		) &&
			/const lockedCells = \$derived\(\s*board \?/.test(board) &&
			/\{#if board\}\s*<RespinCounter \/>\s*<EnhancementDials \/>\s*\{\/if\}\s*<\/BoardContainer>/.test(
				markup,
			),
	);
	const cell = read('../components/RespinCell.svelte');
	check(
		'a cell put away shows nothing, and paints in its visit order',
		/const shown = \$derived\(\s*props\.away\s*\?\s*\[\]/.test(cell) &&
			cell.includes('<Container visible={!props.held} zIndex={props.order}>'),
	);
	const held = read('../components/RespinHeldSymbol.svelte');
	check(
		"a held coin is its seat's view: drawn only while held, its art started at each entry",
		/const vacant = \$derived\(props\.entry === undefined\);/.test(held) &&
			/visible=\{!vacant\}>\s*<Symbol/.test(held) &&
			/instanceKey=\{props\.entry\}\s+\{vacant\}/.test(held) &&
			held.includes('{#if mark && !vacant}'),
	);
	const effects = [...held.matchAll(/\$effect\(\(\) => \{\s*void props\.entry;/g)].length;
	check(
		"a held coin's label pops run again at each entry, as at its component's mount, and never while empty",
		effects === 3 &&
			/if \(!vacant && pops\.land && cellState === 'coinStick'\)/.test(held) &&
			/if \(vacant\) \{\s*counting = false;\s*return;\s*\}/.test(held) &&
			/if \(!vacant && pops\.hit && labelText !== undefined\)/.test(held),
	);
	const container = read('../../../../packages/engine-game/src/components/BoardContainer.svelte');
	check(
		'BoardContainer hands its visibility on, and leaves it alone when not given',
		container.includes('visible={props.visible}') && /visible\?: boolean;/.test(container),
	);

	if (failures) throw new Error(`respinBoardKeep.fixture: ${failures} FAILED`);
	console.log('\nrespinBoardKeep.fixture: all ok');
});
