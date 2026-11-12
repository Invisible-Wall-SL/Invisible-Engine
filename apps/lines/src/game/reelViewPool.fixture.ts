/**
 * Offline fixture for the reel views (`reelViewPool.ts`, drawn by `BoardBase.svelte`,
 * `ReelPaddingPool.svelte`, `SymbolWrap.svelte`, `RespinCell.svelte` and `Symbol.svelte`):
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs apps/lines/src/game/reelViewPool.fixture.ts
 *
 * Board cells, through `createBoardViews` over spins and a cascade step: a cell keeps one view for
 * as long as it is in the strip; a new cell takes the lowest-numbered free view, so after the first
 * spins no view is ever built again; views are listed in strip order (the order the per-cell
 * components ran in), vacant ones last; an unchanged view is handed out unchanged, and the list
 * itself while every view in it is (so a keyed `{#each}` over it does not run), for board cells,
 * filler and Hold and Win cells alike.
 *
 * Entries (`createEntries`): one number while one cell is drawn, a new one when the view starts
 * drawing or is handed another cell while drawing, none while it draws nothing; views sharing a
 * counter number theirs in one sequence.
 *
 * The base art (`artDraw`): a symbol not drawn by a view draws all of it in its keyed band; a view
 * draws a bound sprite in the one sprite it keeps, any other art in the keyed band, never both, and
 * nothing while vacant. The Element FX container's key (`createFxKey`) moves when a symbol turns
 * between one with Element FX and one without within one entry (always, for a symbol that is not a
 * view), never at a view's entry.
 *
 * Whole rolls (pre-spin laps that renumber the strip, the handover to the result, the landing, the
 * next spins), board cells and filler, run through the views as the components run them and, beside
 * them, as the components were before views (a component per cell, its art started when it was
 * drawn and stopped when it was not):
 * - every art kind that starts at mount (a rig, a flipbook, a placeholder) starts on exactly the
 *   frames, and in the order, it started per cell, and stops on the frames it stopped; a bound sprite
 *   is rebound instead, and each view mounts its sprite once, whatever it draws between;
 * - each filler cell is handed to its view on the frame its row first touches the window, no view is
 *   owed two cells at once, the flat (index) and perspective (y) entry tests agree, a built view is
 *   never dropped, and its item changes only with its cell or its vacancy;
 * - a symbol that is not drawn by a view never restarts a band.
 *
 * Hold and Win respins (`createShownViews`), a one-cell strip rolling through a one-row window, its
 * blanks drawing nothing, through the views and beside them a component per shown symbol: art
 * starts and stops on the same frames and in the same order, the views paint in the order the
 * components were appended, each view mounts its sprite once, and no view is built after the first
 * respins.
 *
 * Plus source pins: every band of `Symbol.svelte` is keyed through this module inside an
 * unconditional Element FX container, a vacant symbol reports nothing, a view's sprite reports each
 * entry and is hidden while it does not draw, and `RespinCell` draws through its views in their
 * paint order.
 */

import {
	artDraw,
	artRestart,
	bandKey,
	createBoardViews,
	createEntries,
	createFxKey,
	createPoolViews,
	createShownViews,
	placeCells,
	shownCellsByIndex,
	shownCellsByY,
	type BandRestart,
} from './reelViewPool.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Each list after the first is the one before exactly when it holds the same items in order. */
const keptExactlyWhenUnchanged = (lists: readonly (readonly unknown[])[]) =>
	lists.every((list, i) => {
		if (i === 0) return true;
		const before = lists[i - 1];
		const unchanged = list.length === before.length && list.every((item, j) => item === before[j]);
		return (list === before) === unchanged;
	});

console.log('band keys');
check(
	'a symbol not drawn by a view keys nothing, whatever the band',
	[true, false].every(
		(draws) =>
			bandKey(false, 3, draws) === undefined && bandKey(false, undefined, draws) === undefined,
	),
);
check('a view band that draws nothing keys nothing', bandKey(true, 7, false) === undefined);
check('a view band that draws keys on the entry', bandKey(true, 7, true) === 7);
check(
	'only a bound sprite is rebound',
	artRestart({ hasArt: true, type: 'sprite', placeholder: false }) === 'rebind' &&
		artRestart({ hasArt: true, type: 'spine', placeholder: false }) === 'remount' &&
		artRestart({ hasArt: true, type: 'flipbook', placeholder: false }) === 'remount' &&
		artRestart({ hasArt: false, type: 'sprite', placeholder: true }) === 'remount' &&
		artRestart({ hasArt: false, type: 'sprite', placeholder: false }) === 'none',
);
const draws = (restart: BandRestart, vacant: boolean | undefined) => {
	const { keyed, sprite } = artDraw(restart, vacant);
	return `${keyed ? 'keyed' : ''}${sprite ? 'sprite' : ''}` || 'nothing';
};
check(
	'not a view: all art in the keyed band, as before views',
	draws('rebind', undefined) === 'keyed' &&
		draws('remount', undefined) === 'keyed' &&
		draws('none', undefined) === 'nothing',
);
check(
	"a view: a sprite in the view's own sprite, other art in the keyed band",
	draws('rebind', false) === 'sprite' &&
		draws('remount', false) === 'keyed' &&
		draws('none', false) === 'nothing',
);
check(
	'a vacant view draws nothing',
	(['none', 'rebind', 'remount'] as BandRestart[]).every((r) => draws(r, true) === 'nothing'),
);

console.log('the Element FX container');
{
	const fx = createFxKey();
	const seq = [
		fx(undefined, false),
		fx(undefined, true),
		fx(undefined, true),
		fx(undefined, false),
	];
	check(
		'not a view: every turn between Element FX and none moves the key',
		same(seq, [0, 1, 1, 2]),
		JSON.stringify(seq),
	);
	const view = createFxKey();
	const viewSeq = [
		view(1, false),
		view(2, true),
		view(2, true),
		view(2, false),
		view(undefined, true),
		view(3, false),
		view(3, true),
	];
	check(
		'a view: kept across an entry or a vacancy, moved by a turn within one entry',
		same(viewSeq, [0, 0, 0, 1, 1, 1, 2]),
		JSON.stringify(viewSeq),
	);
}

console.log('entries');
{
	const entries = createEntries();
	const a = {};
	const b = {};
	const seq = [
		entries(false, a),
		entries(true, a),
		entries(true, a),
		entries(true, b),
		entries(false, b),
		entries(false, a),
		entries(true, a),
	];
	check(
		'none while not drawn; one number per drawn cell; a new one per entry',
		same(seq, [undefined, 1, 1, 2, undefined, undefined, 3]),
		JSON.stringify(seq),
	);
	const counter = { count: 0 };
	const one = createEntries(counter);
	const two = createEntries(counter);
	const shared = [one(true, a), two(true, b), one(true, b), two(true, b)];
	check(
		'views sharing a counter number their entries in one sequence',
		same(shared, [1, 2, 3, 2]),
		JSON.stringify(shared),
	);
}

console.log('board cells');
{
	type B = { name: string; padding: boolean };
	const cells = (prefix: string, n: number, padding = false): B[] =>
		Array.from({ length: n }, (_, i) => ({ name: `${prefix}${i}`, padding }));
	const views = createBoardViews<B>();
	const ids = (list: ReturnType<typeof views>) =>
		list.map((v) => `${v.id}:${v.cell.name}${v.vacant ? '*' : ''}@${v.row}`).join(' ');

	const b0 = cells('a', 5);
	const rest = views(b0);
	check(
		'a first board builds one view per cell, in strip order',
		ids(rest) === '0:a0@0 1:a1@1 2:a2@2 3:a3@3 4:a4@4',
		ids(rest),
	);
	check(
		'the same strip hands out the same items',
		views(b0).every((v, i) => v === rest[i]),
	);
	check('…in the same list', views(b0) === rest && views([...b0]) === rest);
	const moved = views([cells('n', 1, true)[0], ...b0]);
	check('a cell that moves row: a new list', moved !== rest && moved[0] !== rest[0]);
	check('…kept from then on', views([cells('n', 1, true)[0], ...b0]) === moved);
	const pool = createPoolViews<B>();
	const fewer = cells('s', 3, true);
	const wide = pool([fewer[0], undefined, fewer[2]]);
	check(
		'filler: the same places shown, the same list',
		pool([fewer[0], undefined, fewer[2]]) === wide,
	);
	const narrow = pool([fewer[0], undefined]);
	check(
		'filler: fewer places (a grid with fewer rows), a list of them alone',
		narrow !== wide && narrow.length === 2 && narrow[0] === wide[0],
	);
	const lap1 = cells('f', 5, true);
	const rolled = views([...lap1, ...b0]);
	check(
		'filler takes no view; board cells keep theirs at their new rows',
		ids(rolled) === '0:a0@5 1:a1@6 2:a2@7 3:a3@8 4:a4@9',
		ids(rolled),
	);
	const lap2 = cells('g', 5, true);
	const gone = views([...lap2, ...lap1]);
	check(
		'a board that left the strip leaves its views vacant, in id order',
		ids(gone) === '0:a0*@5 1:a1*@6 2:a2*@7 3:a3*@8 4:a4*@9',
		ids(gone),
	);
	const t = cells('t', 5);
	const handover = views([...t, ...cells('p', 9, true), ...lap2]);
	check(
		'the next board takes the views the last one left, none built',
		ids(handover) === '0:t0@0 1:t1@1 2:t2@2 3:t3@3 4:t4@4',
		ids(handover),
	);
	check('landing keeps every view', ids(views(t)) === ids(handover));
	const u = cells('u', 5);
	const fast = views([...u, ...cells('q', 4, true), ...t]);
	check(
		'two boards in one strip: each cell its own view, the new one on new views',
		ids(fast) === '5:u0@0 6:u1@1 7:u2@2 8:u3@3 9:u4@4 0:t0@9 1:t1@10 2:t2@11 3:t3@12 4:t4@13',
		ids(fast),
	);
	const settled = views(u);
	check(
		'the old board leaves vacant views after the new one',
		ids(settled) ===
			'5:u0@0 6:u1@1 7:u2@2 8:u3@3 9:u4@4 0:t0*@9 1:t1*@10 2:t2*@11 3:t3*@12 4:t4*@13',
		ids(settled),
	);
	// A cascade step: two winners cleared, two refills spliced above the survivors.
	const step = views([...cells('r', 2), u[0], u[2], u[4]]);
	check(
		'a cascade: survivors keep their views, refills take the lowest free ones, cleared ones free',
		ids(step) === '0:r0@0 1:r1@1 5:u0@2 7:u2@3 9:u4@4 2:t2*@11 3:t3*@12 4:t4*@13 6:u1*@1 8:u3*@3',
		ids(step),
	);
}

// ---- the roll model -------------------------------------------------------------------------
// A strip cell at row `r` sits at `reelY + (r + lead) * pitch`; the window is [0, rows × pitch]. A
// board cell is drawn while it is in the window (`SymbolWrap`: rolling, any part of its row on the
// masked layer; at rest, its centre); a filler cell is handed to its view once its row touches the
// top edge (`ReelPaddingPool`) and drawn until the view is handed the next one.
type Kind = 'sprite' | 'spine' | 'flipbook' | 'placeholder' | 'nothing';
type Cell = { id: number; padding: boolean; kind: Kind; symbolIndex: number };
const ROWS = 3;
const PITCH = 100;
const LEAD = 0.5;
const SLOTS = ROWS + 2;
const TOP = 0;
const BOTTOM = ROWS * PITCH;
const MIXED: Kind[] = ['sprite', 'sprite', 'spine', 'sprite', 'flipbook', 'placeholder', 'nothing'];
let KINDS = MIXED;

let nextId = 1;
let seed = 7;
const random = () => {
	seed = (seed * 16807) % 2147483647;
	return seed / 2147483647;
};
const make = (count: number, padding: boolean): Cell[] =>
	Array.from({ length: count }, () => ({
		id: nextId++,
		padding,
		kind: KINDS[Math.floor(random() * KINDS.length)],
		symbolIndex: 0,
	}));
const artOf = (cell: Cell): BandRestart =>
	artRestart({
		hasArt: cell.kind !== 'placeholder' && cell.kind !== 'nothing',
		type: cell.kind,
		placeholder: cell.kind === 'placeholder',
	});
const yAt = (frame: Frame, row: number) => frame.reelY + (row + LEAD) * PITCH;
const inWindow = (y: number, rolling: boolean) =>
	rolling ? y + PITCH / 2 > TOP && y - PITCH / 2 < BOTTOM : y >= TOP && y <= BOTTOM;
const enterAt = () => TOP - PITCH / 2;
/** `measureStrip`'s `enteredFrom`: the first strip index whose row has touched the top edge. */
const enteredFrom = (frame: Frame) => {
	let i = 0;
	while (i < frame.column.length && !(yAt(frame, i) > enterAt())) i++;
	return i;
};

type Frame = { column: Cell[]; reelY: number; rolling: boolean };
/** A spin's frames: laps of fresh filler, the result laid above `padding` cells, the slide home. */
const spin = (board: Cell[], laps: number, padding: number, step: number) => {
	const frames: Frame[] = [];
	const home = -PITCH;
	let column = board;
	let reelY = home;
	const push = (rolling = true) => {
		column.forEach((cell, i) => (cell.symbolIndex = i));
		frames.push({ column, reelY, rolling });
	};
	const slide = () => {
		while (reelY < home) {
			reelY = Math.min(home, reelY + step);
			push();
		}
	};
	for (let lap = 0; lap < laps; lap++) {
		const fill = make(board.length, true);
		column = [...fill, ...column.slice(0, board.length)];
		reelY -= fill.length * PITCH;
		push();
		slide();
	}
	const result = make(board.length, false);
	column = [...result, ...make(padding, true), ...column.slice(0, board.length)];
	reelY -= (result.length + padding) * PITCH;
	push();
	slide();
	column = result;
	reelY = home;
	push(false);
	return { frames, result };
};

/** A view's base art: its keyed band's key and the cell it holds it for, whether the view's own
 *  sprite draws, and whether that sprite has been built. */
type Band = { key: unknown; label: string; sprite: boolean; built: boolean };
const NO_BAND: Band = { key: undefined, label: '', sprite: false, built: false };
const labelOf = (cell: Cell) => `#${cell.id} ${cell.kind}`;
const bandOf = (entry: number | undefined, cell: Cell | undefined, drawn: boolean): Band => {
	const art = artDraw(cell ? artOf(cell) : 'none', !drawn);
	return {
		key: bandKey(true, entry, art.keyed),
		label: cell ? labelOf(cell) : '',
		sprite: art.sprite,
		built: false,
	};
};

/** Starts and stops of art that starts at mount, in the order the effects run; sprites built; and
 *  frames where a view drew its sprite and its keyed art at once. */
type Log = { starts: string[]; stops: string[]; spriteMounts: number; both: number };
const newLog = (): Log => ({ starts: [], stops: [], spriteMounts: 0, both: 0 });

/** A view's art moving from `band` to `next`: what starts, stops and is built. */
const move = (log: Log, band: Band, next: Band): Band => {
	if (next.key !== band.key) {
		if (typeof band.key === 'number') log.stops.push(band.label);
		if (typeof next.key === 'number') log.starts.push(next.label);
	}
	if (next.sprite && typeof next.key === 'number') log.both++;
	const built = band.built || next.sprite;
	if (built && !band.built) log.spriteMounts++;
	return { ...next, built };
};

/**
 * Plays frames through the views as the components do and, beside them, per cell as before views.
 * The effects run board cells first, in list order, then each filler view in slot order.
 */
const play = (frames: Frame[]) => {
	const boardViews = createBoardViews<Cell>();
	const boardEntries = new Map<number, ReturnType<typeof createEntries>>();
	const boardBands = new Map<number, Band>();
	const poolViews = createPoolViews<Cell>();
	const poolEntries = Array.from({ length: SLOTS }, () => createEntries());
	const poolBands: Band[] = Array.from({ length: SLOTS }, () => NO_BAND);
	const ordinals = new WeakMap<object, number>();
	const drawnBefore = new Set<Cell>();
	let shownBefore: (Cell | undefined)[] = [];
	const viewsLog: Log[] = [];
	const cellsLog: Log[] = [];
	const items: ReturnType<typeof poolViews>[] = [];
	const shownLog: (Cell | undefined)[][] = [];
	let indexAgrees = true;
	let twoAtOnce = false;
	const boardBuilt: number[] = [];
	const boardLists: ReturnType<typeof boardViews>[] = [];

	for (const frame of frames) {
		frame.column.forEach((cell, i) => (cell.symbolIndex = i));
		const vLog = newLog();
		const cLog = newLog();
		// Board cells, through views.
		const listed = boardViews(frame.column);
		boardLists.push(listed);
		boardBuilt.push(Math.max(-1, ...listed.map((v) => v.id)));
		for (const view of listed) {
			const drawn = !view.vacant && inWindow(yAt(frame, view.row), frame.rolling);
			let entries = boardEntries.get(view.id);
			if (!entries) boardEntries.set(view.id, (entries = createEntries()));
			const entry = entries(drawn, view.cell);
			const next = bandOf(entry, view.cell, drawn);
			boardBands.set(view.id, move(vLog, boardBands.get(view.id) ?? NO_BAND, next));
		}
		// Board cells, a component each: drawn in the window, destroyed when not.
		const board = frame.column.filter((c) => !c.padding);
		for (const cell of drawnBefore)
			if (!board.includes(cell) && artOf(cell) === 'remount') cLog.stops.push(labelOf(cell));
		for (const cell of board) {
			const drawn = inWindow(yAt(frame, cell.symbolIndex), frame.rolling);
			const was = drawnBefore.has(cell);
			if (drawn && !was) {
				if (artOf(cell) === 'remount') cLog.starts.push(labelOf(cell));
				if (artOf(cell) === 'rebind') cLog.spriteMounts++;
			}
			if (!drawn && was && artOf(cell) === 'remount') cLog.stops.push(labelOf(cell));
		}
		for (const cell of [...drawnBefore]) if (!board.includes(cell)) drawnBefore.delete(cell);
		for (const cell of board) {
			if (inWindow(yAt(frame, cell.symbolIndex), frame.rolling)) drawnBefore.add(cell);
			else drawnBefore.delete(cell);
		}
		// Filler, through views; the flat and the perspective entry test must agree.
		const placed = placeCells(frame.column, SLOTS, ordinals);
		const shown = shownCellsByY(placed, SLOTS, (_, row) => yAt(frame, row), enterAt);
		if (
			!same(
				shownCellsByIndex(placed, SLOTS, enteredFrom(frame)).map((c) => c?.id),
				shown.map((c) => c?.id),
			)
		)
			indexAgrees = false;
		const inSlots = placed
			.filter(
				({ cell, row }) =>
					cell.padding && yAt(frame, row) > enterAt() && yAt(frame, row) - PITCH / 2 < BOTTOM,
			)
			.map(({ slot }) => slot);
		if (new Set(inSlots).size !== inSlots.length) twoAtOnce = true;
		const pool = poolViews(shown);
		pool.forEach((view, slot) => {
			const drawn = !view.vacant;
			const entry = poolEntries[slot](drawn, view.cell);
			poolBands[slot] = move(vLog, poolBands[slot], bandOf(entry, view.cell, drawn));
		});
		// Filler, a component per handed cell, destroyed when its place shows nothing.
		for (let slot = 0; slot < SLOTS; slot++) {
			const was = shownBefore[slot];
			const now = shown[slot];
			if (now === was) continue;
			if (was && artOf(was) === 'remount') cLog.stops.push(labelOf(was));
			if (now && artOf(now) === 'remount') cLog.starts.push(labelOf(now));
			if (now && artOf(now) === 'rebind') cLog.spriteMounts++;
		}
		shownBefore = shown;
		viewsLog.push(vLog);
		cellsLog.push(cLog);
		items.push(pool);
		shownLog.push(shown);
	}
	return { viewsLog, cellsLog, items, shownLog, indexAgrees, twoAtOnce, boardBuilt, boardLists };
};

console.log('rolls through the views');
for (const step of [7, 33, 100, 170, 260]) {
	nextId = 1;
	seed = 7 + step;
	let board = make(SLOTS, false);
	const frames: Frame[] = [];
	const spinEnds: number[] = [];
	for (const [laps, padding] of [
		[3, 9],
		[2, 14],
		[1, 4],
		[4, 11],
		[2, 6],
	]) {
		const played = spin(board, laps, padding, step);
		frames.push(...played.frames);
		spinEnds.push(frames.length);
		board = played.result;
	}
	const { viewsLog, cellsLog, items, shownLog, indexAgrees, twoAtOnce, boardBuilt, boardLists } =
		play(frames);
	const listsKept = (lists: readonly unknown[]) => new Set(lists).size < lists.length;
	check(
		`step ${step}: a board list is handed back exactly while every view in it is unchanged`,
		keptExactlyWhenUnchanged(boardLists) &&
			listsKept(boardLists) &&
			new Set(boardLists).size > spinEnds.length,
		`${new Set(boardLists).size} lists over ${boardLists.length} frames`,
	);
	check(
		`step ${step}: …and a filler list`,
		keptExactlyWhenUnchanged(items) && listsKept(items) && new Set(items).size > spinEnds.length,
		`${new Set(items).size} lists over ${items.length} frames`,
	);

	const startsDiffer = viewsLog
		.map((v, i) =>
			same(v.starts, cellsLog[i].starts) ? '' : `frame ${i}: ${v.starts} vs ${cellsLog[i].starts}`,
		)
		.filter(Boolean);
	check(
		`step ${step}: art that starts at mount starts on the same frames, in the same order`,
		startsDiffer.length === 0,
		startsDiffer.slice(0, 3).join(' | '),
	);
	const stopsDiffer = viewsLog
		.map((v, i) =>
			same([...v.stops].sort(), [...cellsLog[i].stops].sort())
				? ''
				: `frame ${i}: ${v.stops} vs ${cellsLog[i].stops}`,
		)
		.filter(Boolean);
	check(
		`step ${step}: …and stops on the same frames`,
		stopsDiffer.length === 0,
		stopsDiffer.slice(0, 3).join(' | '),
	);
	check(`step ${step}: the flat entry test is the perspective one`, indexAgrees);
	const viewCount = Math.max(...boardBuilt) + 1 + SLOTS;
	const spritesBuilt = viewsLog.reduce((n, l) => n + l.spriteMounts, 0);
	check(
		`step ${step}: each view builds its sprite at most once, whatever it draws between`,
		spritesBuilt <= viewCount && spritesBuilt > 0,
		`${spritesBuilt} sprites for ${viewCount} views`,
	);
	check(
		`step ${step}: a view never draws its sprite and other art at once`,
		viewsLog.every((l) => l.both === 0),
	);
	const firstSpin = boardBuilt[spinEnds[1] - 1];
	check(
		`step ${step}: no board view is built after the second spin`,
		boardBuilt.slice(spinEnds[1]).every((id) => id <= firstSpin),
		`${firstSpin} then ${Math.max(...boardBuilt.slice(spinEnds[1]))}`,
	);

	// Filler: handed to its view on the frame it enters, never to two views; a view never dropped.
	const handedAt = new Map<number, number>();
	const firstEntered = new Map<number, number>();
	frames.forEach((frame, f) => {
		frame.column.forEach((cell, row) => {
			if (cell.padding && yAt(frame, row) > enterAt() && !firstEntered.has(cell.id))
				firstEntered.set(cell.id, f);
		});
		shownLog[f].forEach((cell) => {
			if (cell && !handedAt.has(cell.id)) handedAt.set(cell.id, f);
		});
	});
	const missed = [...firstEntered].filter(([id, f]) => handedAt.get(id) !== f);
	check(
		`step ${step}: each filler cell is handed to its view on the frame it enters`,
		missed.length === 0 && firstEntered.size > 0,
		missed
			.slice(0, 3)
			.map(([id, f]) => `#${id} entered ${f}, handed ${handedAt.get(id)}`)
			.join(', '),
	);
	check(`step ${step}: no filler view is owed two cells at once`, !twoAtOnce);
	const dropped = items.some((list, f) =>
		list.some((view, slot) => f > 0 && items[f - 1][slot]?.cell && !view.cell),
	);
	check(`step ${step}: a built filler view is never dropped`, !dropped);
	const churned = items.some((list, f) =>
		list.some((item, slot) => {
			const before = items[f - 1]?.[slot];
			return (
				before !== undefined &&
				item !== before &&
				item.cell === before.cell &&
				item.vacant === before.vacant
			);
		}),
	);
	check(`step ${step}: a filler view's item changes only with its cell or its vacancy`, !churned);
	check(
		`step ${step}: a filler view is vacant exactly when its place shows nothing`,
		items.every((list, f) =>
			list.every((item, slot) => item.vacant === (shownLog[f][slot] === undefined)),
		),
	);
	const starts = viewsLog.flatMap((l) => l.starts).length;
	const stops = viewsLog.flatMap((l) => l.stops).length;
	const rest = frames.at(-1)!;
	const drawnAtRest = rest.column.filter(
		(cell, row) => artOf(cell) === 'remount' && inWindow(yAt(rest, row), false),
	).length;
	check(
		`step ${step}: at rest every filler view is vacant and only the drawn board's art runs`,
		shownLog.at(-1)!.every((cell) => cell === undefined) && starts - stops === drawnAtRest,
		`${starts} starts, ${stops} stops, ${drawnAtRest} drawn`,
	);
}

console.log('a sprite is rebound, never mounted again');
{
	KINDS = ['sprite'];
	nextId = 1;
	let board = make(SLOTS, false);
	const frames: Frame[] = [];
	for (const [laps, padding] of [
		[3, 9],
		[2, 14],
		[4, 11],
	]) {
		const played = spin(board, laps, padding, 45);
		frames.push(...played.frames);
		board = played.result;
	}
	const { viewsLog, cellsLog } = play(frames);
	const viewSprites = viewsLog.reduce((n, l) => n + l.spriteMounts, 0);
	const cellSprites = cellsLog.reduce((n, l) => n + l.spriteMounts, 0);
	check(
		`each view mounts its sprite once (${viewSprites} sprite mounts through views, ${cellSprites} per cell)`,
		viewSprites <= 4 * SLOTS && viewSprites < cellSprites / 3,
	);
	KINDS = MIXED;
}

// ---- Hold and Win respins ---------------------------------------------------------------------
// A respin cell's one-cell strip (`RespinCell`): index `i` is drawn at `reelY + i * PITCH`, the window
// centred on 0, at rest `reelY = -PITCH` (index 1 in the window). Rolling, a symbol is shown within a
// pitch of the centre; at rest only index 1; a blank never.
type RespinFrame = { strip: Cell[]; reelY: number; rolling: boolean };
const BOUNCE = 0.2 * PITCH;
/** One respin: the targets and `padding` filler laid above the strip on screen, the slide down past
 *  home, the strip cut to the targets, the bounce back, rest. */
const respin = (strip: Cell[], padding: number, step: number) => {
	const targets = make(3, false);
	const rolled = [...targets, ...make(padding, true), ...strip];
	const frames: RespinFrame[] = [];
	let reelY = -PITCH - (rolled.length - strip.length) * PITCH;
	frames.push({ strip: rolled, reelY, rolling: true });
	while (reelY < -PITCH + BOUNCE) {
		reelY = Math.min(-PITCH + BOUNCE, reelY + step);
		frames.push({ strip: rolled, reelY, rolling: true });
	}
	for (; reelY > -PITCH; reelY -= Math.max(step / 4, 5))
		frames.push({ strip: targets, reelY, rolling: true });
	frames.push({ strip: targets, reelY: -PITCH, rolling: false });
	return { frames, strip: targets };
};
const shownOf = ({ strip, reelY, rolling }: RespinFrame) =>
	strip.filter(
		(cell, i) =>
			(rolling ? Math.abs(reelY + i * PITCH) < PITCH : i === 1) && cell.kind !== 'nothing',
	);

console.log('Hold and Win respins through the views');
KINDS = ['nothing', 'nothing', 'nothing', 'sprite', 'sprite', 'spine', 'flipbook', 'placeholder'];
let twoStartTogether = 0;
for (const step of [9, 40, 100, 160, 250]) {
	nextId = 1;
	seed = 11 + step;
	let strip = make(3, false);
	const frames: RespinFrame[] = [{ strip, reelY: -PITCH, rolling: false }];
	for (const padding of [6, 12, 3, 20, 9, 15]) {
		const played = respin(strip, padding, step);
		frames.push(...played.frames);
		strip = played.strip;
	}

	const views = createShownViews<Cell>();
	const bands = new Map<number, Band>();
	const viewsLog: Log[] = [];
	const cellsLog: Log[] = [];
	const paintDiffers: string[] = [];
	const built: number[] = [];
	let churned = false;
	let before: Cell[] = [];
	let itemsBefore: ReturnType<typeof views> = [];
	const shownLists: ReturnType<typeof views>[] = [];
	const painted: Cell[] = [];
	frames.forEach((frame, f) => {
		const shown = shownOf(frame);
		const vLog = newLog();
		const cLog = newLog();
		// Through the views.
		const items = views(shown);
		shownLists.push(items);
		for (const item of items) {
			const next = bandOf(item.entry, item.cell, item.entry !== undefined);
			bands.set(item.id, move(vLog, bands.get(item.id) ?? NO_BAND, next));
			const was = itemsBefore.find((old) => old.id === item.id);
			if (was && was !== item && was.cell === item.cell && was.entry === item.entry) churned = true;
		}
		itemsBefore = items;
		built.push(Math.max(-1, ...items.map((item) => item.id)));
		const paint = items
			.filter((item) => item.entry !== undefined)
			.sort((a, b) => a.entry! - b.entry!)
			.map((item) => item.cell.id);
		// A component per shown symbol: new ones mount in list order, appended over the others.
		for (const cell of shown)
			if (!before.includes(cell)) {
				if (artOf(cell) === 'remount') cLog.starts.push(labelOf(cell));
				if (artOf(cell) === 'rebind') cLog.spriteMounts++;
				painted.push(cell);
			}
		for (const cell of before)
			if (!shown.includes(cell)) {
				if (artOf(cell) === 'remount') cLog.stops.push(labelOf(cell));
				painted.splice(painted.indexOf(cell), 1);
			}
		before = shown;
		if (
			!same(
				paint,
				painted.map((cell) => cell.id),
			)
		)
			paintDiffers.push(`frame ${f}: ${paint} vs ${painted.map((cell) => cell.id)}`);
		viewsLog.push(vLog);
		cellsLog.push(cLog);
	});

	const startsDiffer = viewsLog
		.map((v, i) =>
			same(v.starts, cellsLog[i].starts) ? '' : `frame ${i}: ${v.starts} vs ${cellsLog[i].starts}`,
		)
		.filter(Boolean);
	check(
		`step ${step}: art starts on the frames, and in the order, a component per symbol started it`,
		startsDiffer.length === 0 && cellsLog.some((l) => l.starts.length > 0),
		startsDiffer.slice(0, 3).join(' | '),
	);
	const stopsDiffer = viewsLog
		.map((v, i) =>
			same([...v.stops].sort(), [...cellsLog[i].stops].sort())
				? ''
				: `frame ${i}: ${v.stops} vs ${cellsLog[i].stops}`,
		)
		.filter(Boolean);
	check(`step ${step}: …and stops on the same frames`, stopsDiffer.length === 0, stopsDiffer[0]);
	check(
		`step ${step}: the views paint in the order the components were appended`,
		paintDiffers.length === 0,
		paintDiffers.slice(0, 2).join(' | '),
	);
	check(
		`step ${step}: a cell's list is handed back exactly while every view in it is unchanged`,
		keptExactlyWhenUnchanged(shownLists) && new Set(shownLists).size < shownLists.length,
		`${new Set(shownLists).size} lists over ${shownLists.length} frames`,
	);
	const viewSprites = viewsLog.reduce((n, l) => n + l.spriteMounts, 0);
	const cellSprites = cellsLog.reduce((n, l) => n + l.spriteMounts, 0);
	check(
		`step ${step}: each view builds its sprite once (${viewSprites} through views, ${cellSprites} per symbol)`,
		viewSprites <= Math.max(...built) + 1 && viewSprites < cellSprites,
	);
	check(
		`step ${step}: a view never draws its sprite and other art at once`,
		viewsLog.every((l) => l.both === 0),
	);
	const most = Math.max(...frames.map((frame) => shownOf(frame).length));
	check(
		`step ${step}: no more views than symbols shown at once (${most}; two in a one-row window)`,
		Math.max(...built) + 1 === most && most <= 2,
		`${Math.max(...built) + 1} views`,
	);
	check(`step ${step}: an item changes only with its symbol or its entry`, !churned);
	twoStartTogether += cellsLog.filter((l) => l.starts.length + l.spriteMounts > 1).length;
}
check(
	`the order is exercised: ${twoStartTogether} frames where two symbols started together`,
	twoStartTogether > 0,
);
KINDS = MIXED;

type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
// Imported by name at run time: this package's tsconfig carries no Node types.
void import('node:' + 'fs').then((fs: Fs) => {
	const read = (name: string) =>
		fs.readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8');
	console.log('the components follow the view rules');
	const symbol = read('Symbol.svelte');
	const markup = symbol.slice(symbol.indexOf('</script>'));
	const keys = [...markup.matchAll(/\{#key ([^}]+)\}/g)].map((m) => m[1].trim());
	const bands = keys.filter((k) => k !== 'props.state' && k !== 'fxKey');
	check(
		'six bands, each keyed by `restartWhen` or `artKey`',
		bands.length === 6 && bands.every((k) => k === 'artKey' || k.startsWith('restartWhen(')),
		keys.join(' | '),
	);
	check(
		'no band is keyed straight on the instance key',
		!markup.includes('{#key props.instanceKey}'),
	);
	check(
		'the Element FX container is unconditional, keyed by `createFxKey`, and holds every band',
		/\{#key fxKey\}\s*<Container>\s*\{@render bands\(\)\}/.test(markup) &&
			!/\{#if symbolFx\}/.test(markup) &&
			/const fxKey = \$derived\(fxKeys\(props\.instanceKey, symbolFx !== undefined\)\);/.test(
				symbol,
			),
	);
	check(
		'a vacant symbol reports nothing',
		/const artComplete = \$derived\(\s*props\.vacant \? undefined :/.test(symbol),
	);
	const sprite = read('SymbolSprite.svelte');
	check(
		"a view's sprite is kept outside the keyed art, reports each entry, and only while it draws",
		/\{#if spriteInfo\}\s*<SymbolSprite\s+symbolInfo=\{spriteInfo\}/.test(markup) &&
			/visible=\{art\.sprite\}\s+restart=\{props\.instanceKey\}\s+oncomplete=\{art\.sprite \? artComplete : undefined\}/.test(
				markup,
			) &&
			/const spriteInfo = \$derived\(art\.sprite \? \(keptSprite = symbolInfo\) : keptSprite\);/.test(
				symbol,
			) &&
			/\{#if !art\.keyed\}/.test(markup) &&
			/void props\.restart;\s*props\.oncomplete\?\.\(\);/.test(sprite) &&
			sprite.includes('visible={props.visible}'),
	);
	const wrap = read('SymbolWrap.svelte');
	check(
		'a view hands its children the entry it draws',
		wrap.includes('entries(drawn, props.cell)') && wrap.includes('props.children(held, entry)'),
	);
	const cell = read('RespinCell.svelte');
	check(
		'a Hold and Win cell draws its shown symbols through views, in their paint order',
		cell.includes('const views = $derived(shownViews(shown));') &&
			/\{#each views as view \(view\.id\)\}/.test(cell) &&
			/zIndex=\{view\.entry\}\s+visible=\{view\.entry !== undefined\}/.test(cell) &&
			/instanceKey=\{view\.entry\}\s+vacant=\{view\.entry === undefined\}/.test(cell) &&
			!/\{#each shown\b/.test(cell),
	);

	if (failures) throw new Error(`reelViewPool.fixture: ${failures} FAILED`);
	console.log('\nreelViewPool.fixture: all ok');
});
