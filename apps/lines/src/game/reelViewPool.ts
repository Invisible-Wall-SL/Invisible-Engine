/**
 * A reel's cells drawn through views that outlive them (`BoardBase`, `ReelPaddingPool`): which view
 * draws which cell, and what a view does when it is handed its next one.
 *
 * BOARD CELLS ({@link createBoardViews}). A board cell keeps one view from the frame it joins the
 * strip until it leaves it — through the roll, the landing, every win and a cascade — exactly the
 * life its own component had, so the board's cell continuity is untouched
 * (`docs/design/board-cell-continuity.md`). A view that loses its cell is vacant until a cell joins
 * and takes it, so the next spin's board is drawn by the views the last one left. A board view
 * mounts its symbol only while its cell is in the window, as the cell's own component did: a cell
 * that lands outside it (the padding rows) comes back in through a fresh mount, whose `oncomplete`
 * is what settles its `land`.
 *
 * FILLER. Strip neighbours are one pitch apart, so a filler cell's place in the strip modulo
 * `slots` picks its view ({@link placeCells}). There are `rows + 2` views, so cells of one view are
 * `rows + 2` pitches apart and no two of them are ever in the window together. A view takes its
 * next cell on the frame that cell enters the window ({@link shownCells}) — the frame its own
 * `ReelSymbol` would have drawn it — and keeps it until then ({@link createPoolViews}).
 *
 * WHAT A VIEW DOES WITH ITS NEXT CELL. Each band of its `Symbol` either starts again as a new mount
 * would (`remount`), is kept and given the new cell's props (`rebind`), or is left alone because it
 * draws nothing (`none`). `Symbol.svelte` keys each band's `{#key}` on {@link bandKey}; a symbol
 * that is not drawn by a view (no `instanceKey`) keys nothing, exactly as before views.
 *
 * Only a SPRITE is rebound. It has no clock, draws no random number and registers nothing on a
 * ticker, and Pixi sizes it from the texture it holds when `width`/`height` are set and again when
 * the texture is swapped (`Sprite.set texture` re-applies the stored size), so a kept sprite handed
 * a new texture and box ends on the transform a new one would have. Everything else starts again,
 * because what it does at mount is observable: a rig registers its update on the shared ticker and
 * fires its t=0 events (a rider token's sparkle draws `Math.random` from there), a flipbook's clip
 * starts on its first frame, a state's Element FX draw their seed when made, and layers may be any
 * of those. Started again in the view, they start on the frame and at the place in the flush a new
 * mount's would (`reelViewPool.fixture.ts`).
 */

/** One number per cell: the key a view's bands restart on (`Symbol.svelte`). */
const instanceIds = new WeakMap<object, number>();
let nextInstanceId = 1;
export const instanceIdOf = (cell: object): number => {
	let id = instanceIds.get(cell);
	if (id === undefined) {
		id = nextInstanceId++;
		instanceIds.set(cell, id);
	}
	return id;
};

/** A board cell's view: the `{#each}` key, the cell it draws (or last drew, `vacant`), its row. */
export type BoardView<C> = { id: number; cell: C; row: number; vacant: boolean };

/**
 * One reel's board cells (its strip less the filler) through views: call it with the strip each
 * time the strip changes. A cell already drawn keeps its view; a new one takes the lowest-numbered
 * free view, or a new one. Listed in strip order with the vacant views last: a keyed `{#each}`
 * keeps its items' effects in list order, so the views run, and start their cells' art, in the
 * order the per-cell components did. An item is handed out again unchanged while its cell, row and
 * vacancy are, so the `{#each}` sees no change.
 */
export const createBoardViews = <C extends { padding: boolean }>() => {
	const owners = new Map<C, number>();
	const last: C[] = [];
	const items: BoardView<C>[] = [];
	const item = (id: number, cell: C, row: number, vacant: boolean): BoardView<C> => {
		const kept = items[id];
		if (kept && kept.cell === cell && kept.row === row && kept.vacant === vacant) return kept;
		return (items[id] = { id, cell, row, vacant });
	};
	return (column: readonly C[]): BoardView<C>[] => {
		const board: { cell: C; row: number }[] = [];
		column.forEach((cell, row) => {
			if (!cell.padding) board.push({ cell, row });
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
		return listed;
	};
};

export type PlacedCell<C> = { cell: C; row: number; slot: number };

/**
 * Each cell of the strip with its row and its view. The reel engine renumbers the strip each lap
 * (the cells stay where they are on screen), so a cell's place is an ordinal fixed in `ordinals`
 * the first time it is seen, carried across renumbering by the first known cell of the column.
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
 * Each view's cell now: of the cells it serves that have entered the window (`y` past `enterAt` —
 * the strip moves down), the most recent one. A board cell in that place means the view has nothing
 * to draw: that cell is drawn as board cells are. Holds the cells themselves, so a view's item
 * changes only when its cell does, however often this is recomputed.
 */
export const shownCells = <C extends { padding: boolean }>(
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
 * The filler views, from each frame's {@link shownCells}: a view is built the first time it is
 * handed a cell and then lives on, VACANT while its entry is empty. Each view's item is handed out
 * again unchanged until its cell or its vacancy changes, so a keyed `{#each}` over them changes an
 * item only then, though `shownCells` is recomputed every frame the reel moves (anything reading a
 * view's props would otherwise be re-checked every frame).
 */
export const createPoolViews = <C>() => {
	const items: PoolView<C>[] = [];
	return (shown: readonly (C | undefined)[]): PoolView<C>[] => {
		items.length = shown.length;
		return shown.map((now, slot) => {
			const kept = items[slot];
			const cell = now ?? kept?.cell;
			const vacant = now === undefined;
			if (kept && kept.cell === cell && kept.vacant === vacant) return kept;
			return (items[slot] = { cell, vacant });
		});
	};
};

export type BandRestart = 'none' | 'rebind' | 'remount';

/** The key a rebound band keeps from cell to cell. A cell's own key is a number, so never equal. */
export const REBOUND = 'rebound';

/**
 * The `{#key}` value of one band. Unpooled ⇒ `undefined` for ever (the band never restarts).
 * Pooled ⇒ the cell's own key where the band starts again per cell, {@link REBOUND} where it is
 * kept, and `undefined` where it draws nothing, so an empty band is not rebuilt for every cell.
 */
export const bandKey = (
	instanceKey: number | undefined,
	restart: BandRestart,
): number | typeof REBOUND | undefined => {
	if (instanceKey === undefined || restart === 'none') return undefined;
	return restart === 'rebind' ? REBOUND : instanceKey;
};

/**
 * Does the base art stay while the symbol is `vacant`? Only a sprite, and only where the caller
 * hides the vacant symbol (`keepSprite`: a vacant view is hidden whole), until the next cell
 * rebinds it; any other art is let go on the frame the symbol goes vacant, as a destroyed view's
 * was. A symbol that is not vacant keeps whatever it draws.
 */
export const artKept = (
	restart: BandRestart,
	vacant: boolean | undefined,
	keepSprite: boolean | undefined,
): boolean => !vacant || (!!keepSprite && restart === 'rebind');

/** The base art's restart: a bound sprite is rebound, any other art starts again, none is none. */
export const artRestart = (art: {
	hasArt: boolean;
	type: string | undefined;
	placeholder: boolean;
}): BandRestart => {
	if (!art.hasArt) return art.placeholder ? 'remount' : 'none';
	return art.type === 'sprite' ? 'rebind' : 'remount';
};
