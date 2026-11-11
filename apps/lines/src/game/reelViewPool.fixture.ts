/**
 * Offline fixture for the reel views (`reelViewPool.ts`, drawn by `BoardBase.svelte`,
 * `ReelPaddingPool.svelte`, `SymbolWrap.svelte` and `Symbol.svelte`):
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs apps/lines/src/game/reelViewPool.fixture.ts
 *
 * Board cells, through `createBoardViews` over spins and a cascade step: a cell keeps one view for
 * as long as it is in the strip; a new cell takes the lowest-numbered free view, so after the first
 * spins no view is ever built again; views are listed in strip order (the order the per-cell
 * components ran in), vacant ones last; an unchanged view is handed out unchanged.
 *
 * Entries (`createEntries`): one number while one cell is drawn, a new one when the view starts
 * drawing or is handed another cell while drawing, none while it draws nothing.
 *
 * Whole rolls (pre-spin laps that renumber the strip, the handover to the result, the landing, the
 * next spins), board cells and filler, run through the views as the components run them and, beside
 * them, as the components were before views (a component per cell, its art started when it was
 * drawn and stopped when it was not):
 * - every art kind that starts at mount (a rig, a flipbook, a placeholder) starts on exactly the
 *   frames, and in the order, it started per cell, and stops on the frames it stopped; a bound sprite
 *   is rebound instead, and is mounted again only after another kind in the same view;
 * - each filler cell is handed to its view on the frame its row first touches the window, no view is
 *   owed two cells at once, the flat (index) and perspective (y) entry tests agree, a built view is
 *   never dropped, and its item changes only with its cell or its vacancy;
 * - a symbol that is not drawn by a view never restarts a band.
 * Plus source pins: every band of `Symbol.svelte` is keyed through this module, a vacant symbol
 * reports nothing, and a kept sprite reports each entry.
 */

import {
	REBOUND,
	artKept,
	artRestart,
	bandKey,
	createBoardViews,
	createEntries,
	createPoolViews,
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

console.log('band keys');
check(
	'a symbol not drawn by a view keys nothing, whatever the band',
	(['none', 'rebind', 'remount'] as BandRestart[]).every(
		(r) => bandKey(false, 3, r) === undefined && bandKey(false, undefined, r) === undefined,
	),
);
check('a view band that draws nothing keys nothing', bandKey(true, 7, 'none') === undefined);
check('a view band that restarts keys on the entry', bandKey(true, 7, 'remount') === 7);
check(
	'a rebound band keeps one key from entry to entry, and while vacant',
	bandKey(true, 7, 'rebind') === REBOUND && bandKey(true, undefined, 'rebind') === REBOUND,
);
check('the kept key is never an entry key', typeof REBOUND === 'string');
check(
	'only a bound sprite is rebound',
	artRestart({ hasArt: true, type: 'sprite', placeholder: false }) === 'rebind' &&
		artRestart({ hasArt: true, type: 'spine', placeholder: false }) === 'remount' &&
		artRestart({ hasArt: true, type: 'flipbook', placeholder: false }) === 'remount' &&
		artRestart({ hasArt: false, type: 'sprite', placeholder: true }) === 'remount' &&
		artRestart({ hasArt: false, type: 'sprite', placeholder: false }) === 'none',
);
check(
	'vacant, only a sprite the caller hides is kept',
	artKept('rebind', true, true) &&
		!artKept('rebind', true, false) &&
		!artKept('remount', true, true) &&
		artKept('remount', false, false) &&
		artKept('remount', undefined, undefined),
);

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

/** One art band: the key it holds, and the cell it holds it for. */
type Band = { key: unknown; label: string };
const NO_BAND: Band = { key: undefined, label: '' };
const labelOf = (cell: Cell) => `#${cell.id} ${cell.kind}`;
const bandOf = (entry: number | undefined, cell: Cell | undefined, drawn: boolean): Band => {
	const restart = cell ? artOf(cell) : 'none';
	const keeps = artKept(restart, !drawn, true);
	return { key: bandKey(true, entry, keeps ? restart : 'none'), label: cell ? labelOf(cell) : '' };
};

/** Starts and stops of art that starts at mount, in the order the effects run. */
type Log = { starts: string[]; stops: string[]; spriteMounts: number };

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

	const move = (log: Log, band: Band, next: Band) => {
		if (next.key === band.key) return;
		if (typeof band.key === 'number') log.stops.push(band.label);
		if (typeof next.key === 'number') log.starts.push(next.label);
		if (next.key === REBOUND && band.key !== REBOUND) log.spriteMounts++;
	};

	for (const frame of frames) {
		frame.column.forEach((cell, i) => (cell.symbolIndex = i));
		const vLog: Log = { starts: [], stops: [], spriteMounts: 0 };
		const cLog: Log = { starts: [], stops: [], spriteMounts: 0 };
		// Board cells, through views.
		const listed = boardViews(frame.column);
		boardBuilt.push(Math.max(-1, ...listed.map((v) => v.id)));
		for (const view of listed) {
			const drawn = !view.vacant && inWindow(yAt(frame, view.row), frame.rolling);
			let entries = boardEntries.get(view.id);
			if (!entries) boardEntries.set(view.id, (entries = createEntries()));
			const entry = entries(drawn, view.cell);
			const next = bandOf(entry, view.cell, drawn);
			move(vLog, boardBands.get(view.id) ?? NO_BAND, next);
			boardBands.set(view.id, next);
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
			const next = bandOf(entry, view.cell, drawn);
			move(vLog, poolBands[slot], next);
			poolBands[slot] = next;
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
	return { viewsLog, cellsLog, items, shownLog, indexAgrees, twoAtOnce, boardBuilt };
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
	const { viewsLog, cellsLog, items, shownLog, indexAgrees, twoAtOnce, boardBuilt } = play(frames);

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

type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
// Imported by name at run time: this package's tsconfig carries no Node types.
void import('node:' + 'fs').then((fs: Fs) => {
	const read = (name: string) =>
		fs.readFileSync(new URL(`../components/${name}`, import.meta.url), 'utf8');
	console.log('the components follow the view rules');
	const symbol = read('Symbol.svelte');
	const markup = symbol.slice(symbol.indexOf('</script>'));
	const keys = [...markup.matchAll(/\{#key ([^}]+)\}/g)].map((m) => m[1].trim());
	const bands = keys.filter((k) => k !== 'props.state');
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
		'a vacant symbol reports nothing',
		/const artComplete = \$derived\(\s*props\.vacant \? undefined :/.test(symbol),
	);
	check(
		'a kept sprite reports each entry',
		/restart=\{props\.instanceKey\}/.test(markup) &&
			/void props\.restart;\s*props\.oncomplete\?\.\(\);/.test(read('SymbolSprite.svelte')),
	);
	const wrap = read('SymbolWrap.svelte');
	check(
		'a view hands its children the entry it draws',
		wrap.includes('entries(drawn, props.cell)') && wrap.includes('props.children(held, entry)'),
	);

	if (failures) throw new Error(`reelViewPool.fixture: ${failures} FAILED`);
	console.log('\nreelViewPool.fixture: all ok');
});
