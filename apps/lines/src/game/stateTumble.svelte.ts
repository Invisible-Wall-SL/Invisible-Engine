import { Tween } from 'svelte/motion';

import type { RawSymbol, SymbolState } from 'engine-game';

/**
 * Cascade (tumble) board state — the symbols a tumbling board owns while the cascade plays.
 *
 * Separate from the reel `stateGame.board` on purpose. A settled reel is a SPINNING strip whose
 * symbols are addressed by a scroll offset; a cascade is the opposite motion — winning symbols
 * explode out, survivors fall into the gaps, and new symbols drop in from above — so its symbols are
 * positioned individually rather than carried by a reel. Reusing the reel model would mean teaching
 * it to delete cells mid-flight, which is exactly the coupling that would put the cascade's risk
 * onto every game that never tumbles.
 *
 * Lives in `apps/lines` rather than `engine-game` because `apps/lines` IS the shared runtime bundle
 * (`_runtime/lines`), and because the mechanic components it feeds depend on the game's own symbol
 * renderer (`Symbol`/`SymbolWrap`), which is one of the Phase A slices still to be extracted. The
 * Book-of mechanic sits here for the same reason — see `SpecialBook.svelte`.
 */

/**
 * One symbol on the tumbling board. `symbolY` is a Tween because a cascade ANIMATES the fall: the
 * symbol is placed above its seat and eased down, where a reel symbol simply rides its strip.
 */
export type TumbleSymbol = {
	symbolY: Tween<number>;
	rawSymbol: RawSymbol;
	symbolState: SymbolState;
	oncomplete: () => void;
};

/**
 * Two layers, because a cascade always has both:
 *  - `base` — what is already on the board, minus whatever has exploded this step.
 *  - `adding` — the replacements queued ABOVE the board, waiting to fall in.
 *
 * They are kept apart rather than merged so `tumbleBoardRemoveExploded` can filter the base without
 * touching symbols that have not landed yet, and so a symbol's index within its column is stable
 * while it falls.
 */
export const stateTumble = $state({
	base: [] as TumbleSymbol[][],
	adding: [] as TumbleSymbol[][],
});

/**
 * The two layers as one column-major board, `adding` FIRST because those symbols sit above the
 * survivors and land on top of them. The combined index is what each symbol's target seat is derived
 * from during the slide, and what is broadcast as the settled board once the cascade finishes.
 */
export const tumbleBoardCombined = (): TumbleSymbol[][] =>
	stateTumble.base.map((reel, reelIndex) => [...(stateTumble.adding[reelIndex] ?? []), ...reel]);

/** Drop both layers — the cascade is over and the ordinary reel board takes the screen back. */
export const resetTumbleBoard = () => {
	stateTumble.base = [];
	stateTumble.adding = [];
};
