/**
 * A reel's cells drawn through views that outlive them (`BoardBase`, `ReelPaddingPool`): which view
 * draws which cell, when a view starts drawing one, and what it does with its art then.
 *
 * A spin used to build and destroy a `ReelSymbol` (with its `SymbolWrap`, `Symbol`, bands and art)
 * for nearly every cell that scrolled through the window, in both board layers, in the Svelte flush
 * the frame clock's step triggers before the Pixi tick (`pixi-svelte/frameClock`). A view is built
 * once and handed one cell after another instead.
 *
 * BOARD CELLS ({@link createBoardViews}). A board cell keeps one view from the frame it joins the
 * strip until it leaves it: through the roll, the landing, every win and a cascade, the life its own
 * component had, so the board's cell continuity is untouched (`docs/design/board-cell-continuity.md`).
 * A view that loses its cell is vacant until a cell joins and takes it, so the next board is drawn by
 * the views the last one left.
 *
 * FILLER. Strip neighbours are one pitch apart, so a filler cell's place in the strip modulo `slots`
 * picks its view ({@link placeCells}). There are `rows + 2` views, so cells of one view are
 * `rows + 2` pitches apart and no two of them are ever in the window together. A view takes its next
 * cell on the frame that cell enters the window ({@link shownCellsByIndex}, {@link shownCellsByY})
 * and keeps it until then ({@link createPoolViews}).
 *
 * DRAWING. A view's art runs while it draws a cell, as the cell's own component did: a board view
 * while its cell is in the window, a filler view from the frame its cell enters until it is handed
 * the next one (`SymbolWrap`). Each time a view starts drawing a cell is an ENTRY
 * ({@link createEntries}); its `Symbol` keys each band on the entry ({@link bandKey}), so a band that
 * draws starts again as a new mount would, and one that draws nothing is left alone. The `Symbol`'s
 * containers are kept: its bands, and the Element FX container, which is there whether the symbol
 * has Element FX or not ({@link createFxKey}). A symbol that is not drawn by a view keys nothing,
 * exactly as before views.
 *
 * Only a SPRITE is not started again: a view keeps one bound sprite of its own from the first sprite
 * it draws, hidden while it draws other art or nothing, and hands it each sprite cell after
 * ({@link artDraw}). It has no clock, draws no random number and registers nothing on a ticker, and
 * Pixi sizes it from the texture it holds when `width`/`height` are set and again when the texture is
 * swapped (`Sprite.set texture` re-applies the stored size), so a kept sprite handed a new texture
 * and box ends on the transform a new one would have (`pixi-svelte` `spriteRebind.fixture`); hidden,
 * it is neither drawn nor measured. Everything else starts again, because what it does at mount is
 * observable: a rig registers its update on the shared ticker and fires its t=0 events (a rider
 * token's sparkle draws `Math.random` from there), a flipbook's clip starts on its first frame, a
 * state's Element FX draw their seed when made, and layers may be any of those. Started again in the
 * view, they start on the frame and at the place in the flush a new mount's would
 * (`reelViewPool.fixture.ts`).
 *
 * HOLD AND WIN CELLS ({@link createShownViews}). A respin cell's window shows one or two symbols of
 * its one-cell strip at a time; each takes a view for as long as it is shown, so a cell builds at
 * most two views and hands them one symbol after another.
 */

/**
 * `list`, unless it holds the same items in the same order as `previous`, which is then handed back:
 * the views' lists are new arrays on every call, and a keyed `{#each}` handed a new array runs again
 * (it reconciles every item, though none changed). Handed the same array, it does not run.
 */
export const keepList = <T>(previous: T[] | undefined, list: T[]): T[] =>
	previous !== undefined &&
	previous.length === list.length &&
	list.every((item, i) => item === previous[i])
		? previous
		: list;

/** A board cell's view: the `{#each}` key, the cell it draws (or last drew, `vacant`), its row. */
export type BoardView<C> = { id: number; cell: C; row: number; vacant: boolean };

/**
 * One reel's board cells (its strip less the filler: the cells `ownsView` answers for) through views:
 * call it with the strip each time the strip changes. A cell already drawn keeps its view; a new one
 * takes the lowest-numbered free view, or a new one. Listed in strip order with the vacant views
 * last: a keyed `{#each}` keeps its items' effects in list order, so the views run, and start their
 * cells' art, in the order the per-cell components did. An item is handed out again unchanged while
 * its cell, row and vacancy are, so the `{#each}` sees no change, and the list while every item is
 * ({@link keepList}): a strip change on one reel does not run the other reels' `{#each}`.
 */
export const createBoardViews = <C extends { padding: boolean }>(
	ownsView: (cell: C) => boolean = (cell) => !cell.padding,
) => {
	const owners = new Map<C, number>();
	const last: C[] = [];
	const items: BoardView<C>[] = [];
	let listedBefore: BoardView<C>[] | undefined;
	const item = (id: number, cell: C, row: number, vacant: boolean): BoardView<C> => {
		const kept = items[id];
		if (kept && kept.cell === cell && kept.row === row && kept.vacant === vacant) return kept;
		return (items[id] = { id, cell, row, vacant });
	};
	return (column: readonly C[]): BoardView<C>[] => {
		const board: { cell: C; row: number }[] = [];
		column.forEach((cell, row) => {
			if (ownsView(cell)) board.push({ cell, row });
		});
		const present = new Set(board.map(({ cell }) => cell));
		for (const [cell] of owners) if (!present.has(cell)) owners.delete(cell);
		const taken = new Set(owners.values());
		let free = 0;
		const listed = board.map(({ cell, row }) => {
			let id = owners.get(cell);
			if (id === undefined) {
				while (taken.has(free)) free++;
				id = free;
				taken.add(id);
				owners.set(cell, id);
			}
			last[id] = cell;
			return item(id, cell, row, false);
		});
		for (let id = 0; id < last.length; id++)
			if (!taken.has(id)) listed.push(item(id, last[id], items[id]?.row ?? 0, true));
		return (listedBefore = keepList(listedBefore, listed));
	};
};

export type PlacedCell<C> = { cell: C; row: number; slot: number };

/**
 * Each cell of the strip with its row and its view. The reel engine renumbers the strip each lap (the
 * cells stay where they are on screen), so a cell's place is an ordinal fixed in `ordinals` the first
 * time it is seen, carried across renumbering by the first known cell of the column.
 */
export const placeCells = <C extends object>(
	column: readonly C[],
	slots: number,
	ordinals: WeakMap<object, number>,
): PlacedCell<C>[] => {
	let base = 0;
	for (let row = 0; row < column.length; row++) {
		const known = ordinals.get(column[row]);
		if (known !== undefined) {
			base = known - row;
			break;
		}
	}
	return column.map((cell, row) => {
		let ordinal = ordinals.get(cell);
		if (ordinal === undefined) {
			ordinal = row + base;
			ordinals.set(cell, ordinal);
		}
		return { cell, row, slot: ((ordinal % slots) + slots) % slots };
	});
};

/**
 * Each view's cell now: of the cells it serves that have entered the window, the most recent one
 * (the strip moves down, so the highest). A board cell in that place means the view has nothing to
 * draw: that cell is drawn as board cells are. Flat: from strip index `enteredFrom` on, a cell's row
 * has touched the top edge (`ReelStripView`), and the lowest such index is the highest cell, so
 * nothing here reads the moving position.
 */
export const shownCellsByIndex = <C extends { padding: boolean; symbolIndex: number }>(
	placed: readonly PlacedCell<C>[],
	slots: number,
	enteredFrom: number,
): (C | undefined)[] => {
	const best: (C | undefined)[] = Array(slots);
	const bestIndex: number[] = Array(slots);
	for (const { cell, slot } of placed) {
		const index = cell.symbolIndex;
		if (index < enteredFrom) continue;
		if (!best[slot] || index < bestIndex[slot]) {
			best[slot] = cell;
			bestIndex[slot] = index;
		}
	}
	return Array.from(best, (cell) => (cell?.padding ? cell : undefined));
};

/** {@link shownCellsByIndex} from each cell's `y` (perspective): entered once past `enterAt`. */
export const shownCellsByY = <C extends { padding: boolean }>(
	placed: readonly PlacedCell<C>[],
	slots: number,
	yOf: (cell: C, row: number) => number,
	enterAt: (row: number) => number,
): (C | undefined)[] => {
	const best: (C | undefined)[] = Array(slots);
	const bestY: number[] = Array(slots);
	for (const { cell, row, slot } of placed) {
		const y = yOf(cell, row);
		if (y <= enterAt(row)) continue;
		if (!best[slot] || y < bestY[slot]) {
			best[slot] = cell;
			bestY[slot] = y;
		}
	}
	return Array.from(best, (cell) => (cell?.padding ? cell : undefined));
};

/** A filler view: the cell it draws, or last drew while `vacant`. */
export type PoolView<C> = { cell: C | undefined; vacant: boolean };

/**
 * The filler views, from each crossing's shown cells: a view is built the first time it is handed a
 * cell and then lives on, VACANT while its entry is empty. Handed a `seed`, a view not built yet is
 * built at once, vacant on that cell (a vacant view draws nothing and follows nothing about its
 * cell), so the reel's first roll builds no view: a board mounted ahead of its first show
 * (`ReelPaddingPool`) builds them then. Each view's item is handed out again unchanged until its
 * cell or its vacancy changes, so a keyed `{#each}` over them changes an item only then (anything
 * reading a view's props would otherwise be re-checked on every crossing), and the list runs the
 * `{#each}` only then ({@link keepList}): a crossing that hands no view a new cell changes nothing.
 */
export const createPoolViews = <C>() => {
	const items: PoolView<C>[] = [];
	let listedBefore: PoolView<C>[] | undefined;
	return (shown: readonly (C | undefined)[], seed?: C): PoolView<C>[] => {
		items.length = shown.length;
		const listed = shown.map((now, slot) => {
			const kept = items[slot];
			const cell = now ?? kept?.cell ?? seed;
			const vacant = now === undefined;
			if (kept && kept.cell === cell && kept.vacant === vacant) return kept;
			return (items[slot] = { cell, vacant });
		});
		return (listedBefore = keepList(listedBefore, listed));
	};
};

/**
 * A view's entries (`SymbolWrap`, {@link createShownViews}): called with whether the view draws now
 * and the cell it draws. Answers a number for as long as one cell is drawn, a new one each time the
 * view starts drawing or is handed another cell while drawing, and `undefined` while it draws
 * nothing. Views handed one `counter` number their entries in one sequence, in the order they ask.
 */
export const createEntries = (counter = { count: 0 }) => {
	let current: number | undefined;
	let drawnCell: unknown;
	return (drawn: boolean, cell: unknown): number | undefined => {
		if (!drawn) return (current = undefined);
		if (current === undefined || cell !== drawnCell) {
			current = ++counter.count;
			drawnCell = cell;
		}
		return current;
	};
};

/** A Hold and Win cell's view: the `{#each}` key, the symbol it draws (or last drew), the entry it
 *  draws (`undefined` while vacant). */
export type ShownView<C> = { id: number; cell: C; entry: number | undefined };

/**
 * A Hold and Win cell's strip through views (`RespinCell`): call it with the symbols its window shows
 * now, in strip order, each of which is drawn. A symbol keeps one view for as long as it is shown; a
 * new one takes the lowest-numbered free view ({@link createBoardViews}, every symbol taking one).
 *
 * Each time a view starts drawing a symbol is an entry, numbered across the cell's views in list
 * order, which is the order the per-symbol components mounted in. A component mounted later was
 * appended over the ones before it, so the entry is also the view's PAINT ORDER (its `zIndex`): where
 * two symbols overlap in the window the newer one draws over the older, as before views. An item is
 * handed out again unchanged while its view's symbol and entry are, and the list while every item
 * is ({@link keepList}).
 */
export const createShownViews = <C extends { padding: boolean }>() => {
	const views = createBoardViews<C>(() => true);
	const counter = { count: 0 };
	const entries: ReturnType<typeof createEntries>[] = [];
	const items: ShownView<C>[] = [];
	let listedBefore: ShownView<C>[] | undefined;
	return (shown: readonly C[]): ShownView<C>[] => {
		const listed = views(shown).map(({ id, cell, vacant }) => {
			const entry = (entries[id] ??= createEntries(counter))(!vacant, cell);
			const kept = items[id];
			if (kept && kept.cell === cell && kept.entry === entry) return kept;
			return (items[id] = { id, cell, entry });
		});
		return (listedBefore = keepList(listedBefore, listed));
	};
};

/**
 * The `{#key}` value of one band of a `Symbol`. Not drawn by a view ⇒ `undefined` for ever (the band
 * never restarts). A view ⇒ the entry where the band draws, and `undefined` where it draws nothing, so
 * an empty band is not rebuilt for every cell.
 */
export const bandKey = (view: boolean, entry: number | undefined, draws: boolean) =>
	view && draws ? entry : undefined;

/** What the base art does at an entry: a bound sprite is rebound, any other art starts again, no
 *  art is none. */
export type BandRestart = 'none' | 'rebind' | 'remount';

export const artRestart = (art: {
	hasArt: boolean;
	type: string | undefined;
	placeholder: boolean;
}): BandRestart => {
	if (!art.hasArt) return art.placeholder ? 'remount' : 'none';
	return art.type === 'sprite' ? 'rebind' : 'remount';
};

/** Where a `Symbol` draws its base art: in its keyed art band, or in the sprite a view keeps. */
export type ArtDraw = { keyed: boolean; sprite: boolean };

/**
 * Where the base art is drawn. Not a view (`vacant` undefined): all of it in the keyed band, as
 * before views. A view: a bound sprite in the one sprite the view keeps, shown while the view draws
 * and hidden otherwise, so a view moving between sprites and other art mounts its sprite once; any
 * other art in the keyed band, which starts it again per entry; nothing while the view is vacant, as
 * the cell's own component drew nothing once it was gone.
 */
export const artDraw = (restart: BandRestart, vacant: boolean | undefined): ArtDraw => {
	if (vacant === undefined) return { keyed: restart !== 'none', sprite: false };
	if (restart === 'rebind') return { keyed: false, sprite: !vacant };
	return { keyed: !vacant && restart === 'remount', sprite: false };
};

/** A `Symbol`'s win frame now: drawn by the frame it keeps (`kept`), and that frame's play. */
export type WinFrameDraw = { kept: boolean; play: number | undefined };

/**
 * Where a `Symbol` draws its win frame: in the frame a view keeps between wins, or mounted in its
 * band as before views. A VISIT is what a mount of the frame was: from when the cell shows it, or the
 * view starts a new entry while it does, to when it stops. A view's visit is drawn by the kept frame
 * (`<RigProvider parked restart>`), started again in place at each visit and put away between them,
 * unless the symbol stamps a multiplier when it starts: the frame and the stamp share a band, and a
 * frame mounted while the stamp is there is appended over it, where a kept frame would stay under.
 * Decided once per visit, so a stamp coming or going mid-visit leaves the frame playing, as it did.
 */
export const createWinFrames = () => {
	const visits = createEntries();
	let visit: number | undefined;
	let kept = false;
	return (
		view: boolean,
		shown: boolean,
		entry: number | undefined,
		multiplier: number | undefined,
	): WinFrameDraw => {
		const now = visits(view && shown, entry);
		if (now !== visit) kept = now !== undefined && !multiplier;
		visit = now;
		return { kept, play: kept ? now : undefined };
	};
};

/**
 * The `{#key}` of a `Symbol`'s Element FX container, from its `instanceKey` and whether it has
 * Element FX. The container used to be there only for a symbol with Element FX, so a symbol turning
 * between one with them and one without started every band again. A symbol whose own cell turns in
 * place (a wild rewrite, a special expanding, `frozen` turning) still does: the key moves. A view
 * handed a cell of the other kind does not: its entry starts every band that draws again by itself
 * ({@link bandKey}), so the container and the bands' containers are kept.
 */
export const createFxKey = () => {
	let entry: number | undefined;
	let had: boolean | undefined;
	let key = 0;
	return (instanceKey: number | undefined, hasFx: boolean): number => {
		if (had !== undefined && hasFx !== had && instanceKey === entry) key++;
		entry = instanceKey;
		had = hasFx;
		return key;
	};
};
