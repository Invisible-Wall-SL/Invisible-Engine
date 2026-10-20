/**
 * THE GAME'S BOARD BOX (Rive plan Phase 8b): the size of the reel board as the game lays it out,
 * registered by the game so an authored node can size itself to it (`RigNode.boardFit`, the
 * `game`-space twin of `coverFit`). The game registers a READER, not a value: it reads the game's
 * reactive layout each time, so a node that calls it inside a derived follows layout changes.
 * Nothing registered ⇒ `undefined` ⇒ no node fits to the board (parity).
 */

export interface BoardBox {
	width: number;
	height: number;
	/** The board's position in the main box (`boardLayout()`), read by a `boardAnchored` instance. */
	x?: number;
	y?: number;
}

let read: (() => BoardBox | undefined) | undefined;

/** Register the game's board reader; returns the unregister. */
export function registerBoardBox(reader: () => BoardBox | undefined): () => void {
	read = reader;
	return () => {
		if (read === reader) read = undefined;
	};
}

/** The board box right now, or `undefined` when no game registered one. */
export function boardBox(): BoardBox | undefined {
	return read?.();
}
