/**
 * Offline fixture for the reel views (`reelViewPool.ts`, drawn by `BoardBase.svelte` and
 * `ReelPaddingPool.svelte`):
 *
 *   node --experimental-strip-types apps/lines/src/game/reelViewPool.fixture.ts
 *
 * Board cells, through `createBoardViews` over spins and a cascade step: a cell keeps one view for
 * as long as it is in the strip; a new cell takes the lowest-numbered free view, so after the first
 * spin no view is ever built again; views are listed in strip order (the order the per-cell
 * components ran in), vacant ones last; an unchanged view is handed out unchanged.
 *
 * Filler, over simulated rolls (pre-spin laps that renumber the strip, the handover to the result,
 * the landing, the next spin) run through the pool's own `placeCells`, `shownCells` and
 * `createPoolViews`:
 * - each filler cell is handed to one view, on the frame its row first touches the window (the
 *   frame a component of its own would have mounted it), and no two cells of one view are ever in
 *   the widened window together;
 * - a view, once built, is never dropped: it is vacant exactly when its place holds a board cell or
 *   nothing, and its item changes only when its cell or its vacancy does (not every frame);
 * - every art kind that starts at mount (a rig, a flipbook, a placeholder, layers, Element FX,
 *   labels) starts again on exactly the frames, and in the order, in which it started when every
 *   view was rebuilt per cell, and stops on the frame the old view was destroyed; a bound sprite is
 *   rebound instead (that Pixi lands a rebound sprite where a new one would is
 *   `packages/pixi-svelte/fixtures/spriteRebind.fixture.ts`);
 * - a symbol that is not pooled never restarts a band.
 * Plus one source pin: every band of `Symbol.svelte` is keyed through this module.
 */

import {
	REBOUND,
	artKept,
	artRestart,
	bandKey,
	createBoardViews,
	createPoolViews,
	placeCells,
	shownCells,
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
	'an unpooled symbol keys nothing, whatever the band',
	(['none', 'rebind', 'remount'] as BandRestart[]).every(
		(r) => bandKey(undefined, r) === undefined,
	),
);
check('a pooled band that draws nothing keys nothing', bandKey(7, 'none') === undefined);
check('a pooled band that restarts keys on the cell', bandKey(7, 'remount') === 7);
check('a rebound band keeps one key from cell to cell', bandKey(7, 'rebind') === REBOUND);
check(
	'the kept key is never a cell key',
	bandKey(1, 'rebind') !== bandKey(1, 'remount') && typeof REBOUND === 'string',
);
check(
	'only a bound sprite is rebound',
	artRestart({ hasArt: true, type: 'sprite', placeholder: false }) === 'rebind' &&
		artRestart({ hasArt: true, type: 'spine', placeholder: false }) === 'remount' &&
		artRestart({ hasArt: true, type: 'flipbook', placeholder: false }) === 'remount' &&
		artRestart({ hasArt: false, type: 'sprite', placeholder: true }) === 'remount' &&
		artRestart({ hasArt: false, type: 'sprite', placeholder: false }) === 'none',
);

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

	// Pre-spin: a lap of filler above the board, then the next lap pushes the board out.
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

	// The handover: the result above padding above the lap on screen; the views the last board left.
	const t = cells('t', 5);
	const handover = views([...t, ...cells('p', 9, true), ...lap2]);
	check(
		'the next board takes the views the last one left, none built',
		ids(handover) === '0:t0@0 1:t1@1 2:t2@2 3:t3@3 4:t4@4',
		ids(handover),
	);
	const landed = views(t);
	check('landing keeps every view', ids(landed) === ids(handover));

	// A fast result: the old board still on screen when the new one is laid above it.
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
	const refills = cells('r', 2);
	const step = views([...refills, u[0], u[2], u[4]]);
	check(
		'a cascade: survivors keep their views, refills take the lowest free ones, cleared ones free',
		ids(step) === '0:r0@0 1:r1@1 5:u0@2 7:u2@3 9:u4@4 2:t2*@11 3:t3*@12 4:t4*@13 6:u1*@1 8:u3*@3',
		ids(step),
	);
}

// ---- the roll model -------------------------------------------------------------------------
// A strip cell at row `r` sits at `reelY + (r + lead) * pitch`; the window is [0, rows × pitch]
// and a rolling cell enters when its centre is half a row above the top (`SymbolWrap`'s margin).
type Kind = 'sprite' | 'spine' | 'flipbook' | 'placeholder' | 'nothing';
type Cell = { id: number; padding: boolean; kind: Kind };
const ROWS = 3;
const PITCH = 100;
const LEAD = 0.5;
const SLOTS = ROWS + 2;
const KINDS: Kind[] = ['sprite', 'sprite', 'spine', 'sprite', 'flipbook', 'placeholder', 'nothing'];

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
	}));
const enterAt = () => -PITCH / 2;
const artOf = (cell: Cell): BandRestart =>
	artRestart({
		hasArt: cell.kind !== 'placeholder' && cell.kind !== 'nothing',
		type: cell.kind,
		placeholder: cell.kind === 'placeholder',
	});

type Frame = { column: Cell[]; reelY: number };
/** A spin's frames: laps of fresh filler, the result laid above `padding` cells, the slide home. */
const spin = (board: Cell[], laps: number, padding: number, step: number) => {
	const frames: Frame[] = [];
	const home = -PITCH;
	let column = board;
	let reelY = home;
	const slide = () => {
		while (reelY < home) {
			reelY = Math.min(home, reelY + step);
			frames.push({ column, reelY });
		}
	};
	for (let lap = 0; lap < laps; lap++) {
		// `preSpinPadding`: a lap of fresh filler above the cells on screen, which stay put.
		const fill = make(board.length, true);
		const onScreen = column.slice(0, board.length);
		column = [...fill, ...onScreen];
		reelY -= fill.length * PITCH;
		frames.push({ column, reelY });
		slide();
	}
	// The handover: the result above `padding` filler above the lap on screen.
	const result = make(board.length, false);
	const pad = make(padding, true);
	column = [...result, ...pad, ...column.slice(0, board.length)];
	reelY -= (result.length + pad.length) * PITCH;
	frames.push({ column, reelY });
	slide();
	// `removePaddingAndBounceBack`: the strip is the result.
	column = result;
	reelY = home;
	frames.push({ column, reelY });
	return { frames, result };
};

/**
 * Plays frames through the pool and, beside it, the pool as it was before views were kept and
 * sprites rebound: a view built when its place was handed a cell, destroyed when it held none,
 * every band started again per cell. Returns each frame's art starts and stops in the order the
 * views run.
 */
const play = (
	frames: Frame[],
	state = {
		ordinals: new WeakMap<object, number>(),
		views: createPoolViews<Cell>(),
		keys: [] as unknown[],
	},
) => {
	const log = {
		pooled: [] as string[][],
		perCell: [] as string[][],
		held: [] as (Cell | undefined)[][],
		shown: [] as (Cell | undefined)[][],
		items: [] as ReturnType<typeof state.views>[],
	};
	let previous: (Cell | undefined)[] = [];
	for (const { column, reelY } of frames) {
		const placed = placeCells(column, SLOTS, state.ordinals);
		const shown = shownCells(placed, SLOTS, (_, row) => reelY + (row + LEAD) * PITCH, enterAt);
		const views = state.views(shown);
		const held = views.map((view) => view.cell);
		const pooled: string[] = [];
		const perCell: string[] = [];
		for (let slot = 0; slot < SLOTS; slot++) {
			const cell = held[slot];
			const vacant = views[slot].vacant;
			// `Symbol.svelte`'s art band: `artKey`; `keepsArt` drops all but a sprite when vacant.
			const restart = cell ? artOf(cell) : 'none';
			const keeps = cell !== undefined && artKept(restart, vacant, true);
			const key = cell ? bandKey(cell.id, keeps ? restart : 'none') : undefined;
			if (key !== state.keys[slot]) {
				if (state.keys[slot] !== undefined && state.keys[slot] !== REBOUND)
					pooled.push(`stop ${slot}`);
				if (key !== undefined && key !== REBOUND)
					pooled.push(`start ${slot} ${cell!.kind} #${cell!.id}`);
				state.keys[slot] = key;
			}
			// Before: a view per handed cell, its whole art started at build and dropped at destroy.
			const was = previous[slot];
			const now = shown[slot];
			if (now !== was) {
				if (was && artOf(was) === 'remount') perCell.push(`stop ${slot}`);
				if (now && artOf(now) === 'remount') perCell.push(`start ${slot} ${now.kind} #${now.id}`);
			}
		}
		previous = shown;
		log.pooled.push(pooled);
		log.perCell.push(perCell);
		log.held.push(held);
		log.shown.push(shown);
		log.items.push(views);
	}
	return { log, state };
};

console.log('rolls through the pool');
for (const step of [7, 33, 100, 170, 260]) {
	nextId = 1;
	const board = make(SLOTS, false);
	const first = spin(board, 3, 9, step);
	const second = spin(first.result, 2, 14, step);
	const frames = [...first.frames, ...second.frames];
	const { log } = play(frames);

	check(
		`step ${step}: art that starts at mount starts and stops on the same frames, in the same order`,
		same(log.pooled, log.perCell),
		log.pooled
			.map((p, i) => (same(p, log.perCell[i]) ? '' : `frame ${i}: ${p} vs ${log.perCell[i]}`))
			.filter(Boolean)
			.slice(0, 3)
			.join(' | '),
	);

	// Each filler cell: handed to its view on the frame it enters, never to two views.
	const handedAt = new Map<number, number>();
	const firstEntered = new Map<number, number>();
	let twoAtOnce = false;
	frames.forEach(({ column, reelY }, f) => {
		column.forEach((cell, row) => {
			const y = reelY + (row + LEAD) * PITCH;
			if (cell.padding && y > enterAt() && !firstEntered.has(cell.id)) firstEntered.set(cell.id, f);
		});
		log.shown[f].forEach((cell) => {
			if (cell && !handedAt.has(cell.id)) handedAt.set(cell.id, f);
		});
		const inWindow = column
			.map((cell, row) => ({ cell, y: reelY + (row + LEAD) * PITCH }))
			.filter(({ cell, y }) => cell.padding && y > enterAt() && y - PITCH / 2 < ROWS * PITCH);
		const slots = inWindow.map(
			({ cell }) => placeCells(column, SLOTS, new WeakMap()).find((p) => p.cell === cell)!.slot,
		);
		if (new Set(slots).size !== slots.length) twoAtOnce = true;
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
	check(`step ${step}: no view is owed two cells at once`, !twoAtOnce);

	// A built view is never dropped; it is vacant exactly when its place shows nothing.
	let dropped = false;
	let builtLate = false;
	log.held.forEach((held, f) =>
		held.forEach((cell, slot) => {
			if (f > 0 && log.held[f - 1][slot] && !cell) dropped = true;
			if (cell && !log.shown[f][slot] && log.shown.slice(0, f + 1).every((s) => s[slot] !== cell))
				builtLate = true;
		}),
	);
	check(`step ${step}: a built view is never dropped`, !dropped);
	const churned = log.items.some((items, f) =>
		items.some((item, slot) => {
			const before = log.items[f - 1]?.[slot];
			return (
				before !== undefined &&
				item !== before &&
				item.cell === before.cell &&
				item.vacant === before.vacant
			);
		}),
	);
	check(`step ${step}: a view's item changes only with its cell or its vacancy`, !churned);
	const vacancyIsShown = log.items.every((items, f) =>
		items.every((item, slot) => item.vacant === (log.shown[f][slot] === undefined)),
	);
	check(`step ${step}: a view is vacant exactly when its place shows nothing`, vacancyIsShown);
	check(`step ${step}: a view only ever holds a cell it was handed`, !builtLate);
	check(
		`step ${step}: at rest every view is vacant and holds no running art`,
		log.shown.at(-1)!.every((cell) => cell === undefined) &&
			log.pooled.flat().filter((e) => e.startsWith('start')).length ===
				log.pooled.flat().filter((e) => e.startsWith('stop')).length,
	);
}

console.log('a sprite is rebound, never restarted');
{
	nextId = 1;
	seed = 11;
	const board = make(SLOTS, false);
	const { frames } = spin(board, 4, 12, 45);
	const { log } = play(frames);
	const spriteStarts = log.pooled.flat().filter((e) => e.includes(' sprite '));
	check(
		'no sprite art is started by a pooled view',
		spriteStarts.length === 0,
		spriteStarts.join(', '),
	);
}

type Fs = { readFileSync(path: URL, encoding: 'utf8'): string };
// Imported by name at run time: this package's tsconfig carries no Node types.
void import('node:' + 'fs').then((fs: Fs) => {
	console.log('Symbol.svelte keys every band through the pool rules');
	const source = fs.readFileSync(new URL('../components/Symbol.svelte', import.meta.url), 'utf8');
	const markup = source.slice(source.indexOf('</script>'));
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

	if (failures) throw new Error(`reelViewPool.fixture: ${failures} FAILED`);
	console.log('\nreelViewPool.fixture: all ok');
});
