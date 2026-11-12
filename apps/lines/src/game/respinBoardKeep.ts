/**
 * The Hold and Win respin board KEPT between features (`RespinBoard.svelte`). It used to be mounted
 * whole each time a feature showed it and destroyed whole as the feature ended: every cell's reel
 * with its views, every held coin with its rig and label. From the first feature on, the board stays
 * mounted, hidden while the base game plays, and its two heavy layers keep their components: the
 * one-cell reels and the held coins. What is drawn at each feature must be what a board mounted for
 * it would draw, frame for frame, so each kept part is handed what such a mount would have started:
 *
 * - **The cells** keep their component and its views (`RespinCell`, `createShownViews`). Hidden, a
 *   cell shows nothing, so each view is vacant (its art put away, off the ticker); shown again, the
 *   symbols its window shows start as a new mount's would, through entries. Their paint order is the
 *   order a board mounted for this feature would have appended them in ({@link createVisitOrder}).
 * - **The held coins** are drawn through one view per seat ({@link createSeatViews}), kept from the
 *   first coin held there. A coin coming to a seat is an entry, as the coin's own component mounting
 *   was, and a seat left empty is vacant; a coin whose symbol changes in place keeps its entry, as
 *   it kept its component.
 *
 * Everything else (the tiles, the locked cells, the counter and the dials) is still mounted per
 * feature, as before: each sits in a layer of its own, so it is appended exactly where a fresh board
 * would append it.
 */

import { createEntries, keepList } from './reelViewPool';

/**
 * The paint order of the cells of a board kept between features: the order a board mounted for the
 * current feature would hold them in. Such a board appended each cell as it mounted: those open when
 * the feature showed it in list order, then each cell that opened later (an unlocked row) after
 * every cell before it. A kept cell is already a child of its layer, wherever an earlier feature
 * put it, so it is given that place as its `zIndex`.
 *
 * Call it with whether the board is shown and the cells it draws, each time either changes. A
 * feature starts on the first call shown after a call hidden: every cell then takes a place in list
 * order. A cell joining while shown takes the next one; a cell leaving gives its place up. Hidden,
 * nothing moves: the answer is the last one shown.
 */
export const createVisitOrder = <C>() => {
	let order = new Map<C, number>();
	let next = 0;
	let wasShown = false;
	return (shown: boolean, cells: readonly C[]): ReadonlyMap<C, number> => {
		if (!shown) {
			wasShown = false;
			return order;
		}
		const now = new Map<C, number>();
		if (!wasShown) next = 0;
		for (const cell of cells) {
			const place = wasShown ? order.get(cell) : undefined;
			now.set(cell, place ?? ++next);
		}
		wasShown = true;
		const same = now.size === order.size && [...now].every(([cell, at]) => order.get(cell) === at);
		if (!same) order = now;
		return order;
	};
};

/** A held seat's view: the `{#each}` key, the cell it draws (or last drew), its entry (`undefined`
 *  while the seat is empty). */
export type SeatView<C> = { id: string; cell: C; entry: number | undefined };

/**
 * The held layer through one view per seat: call it with the held cells, in the held layer's order,
 * each time they change. A seat's view is built the first time a cell is held there and kept after.
 * Each time a seat comes to be held is an entry, numbered across the seats in list order (the order
 * the coins' own components mounted in); a seat whose cell changes while held (an upgrade, a mystery
 * revealing) keeps it. Listed in the held order with the empty seats last, so a keyed `{#each}` runs
 * the views, and starts their coins, in the order the components ran. An item is handed out again
 * unchanged while its cell and entry are, and the list while every item is.
 */
export const createSeatViews = <C>(seatOf: (cell: C) => string) => {
	const counter = { count: 0 };
	const entries = new Map<string, ReturnType<typeof createEntries>>();
	const items = new Map<string, SeatView<C>>();
	const seats: string[] = [];
	let listedBefore: SeatView<C>[] | undefined;
	const item = (id: string, cell: C, entry: number | undefined): SeatView<C> => {
		const kept = items.get(id);
		if (kept && kept.cell === cell && kept.entry === entry) return kept;
		const next = { id, cell, entry };
		items.set(id, next);
		return next;
	};
	return (held: readonly C[]): SeatView<C>[] => {
		const present = new Set<string>();
		const listed: SeatView<C>[] = [];
		for (const cell of held) {
			const id = seatOf(cell);
			if (present.has(id)) continue;
			present.add(id);
			if (!entries.has(id)) {
				entries.set(id, createEntries(counter));
				seats.push(id);
			}
			listed.push(item(id, cell, entries.get(id)?.(true, id)));
		}
		for (const id of seats) {
			if (present.has(id)) continue;
			const kept = items.get(id) as SeatView<C>;
			listed.push(item(id, kept.cell, entries.get(id)?.(false, id)));
		}
		return (listedBefore = keepList(listedBefore, listed));
	};
};
