/**
 * WHICH CELL a symbol renders for a given state — the pure rule, kept free of every import so it
 * can be exercised offline (`symbolCell.fixture.ts`) without dragging in the baked editor bundle.
 *
 * It exists because "the symbol has no art" and "the symbol has no art FOR THIS STATE" are different
 * failures with the same consequence, and only the first was ever handled. A state cell that is
 * missing used to spread as nothing, leaving `type` undefined — and `Symbol.svelte`'s final arm is
 * the SPINE renderer, so an unauthored state fell through to it and handed `SpineProvider` an
 * undefined key, which does `key.match(...)`. That is a crash mid-render, which unmounts the board.
 *
 * `explosion` is where this bites, because the cascade is the only thing that asks for it and almost
 * nobody authors it. A symbol present in the CODED map survives (the merge inherits the coded cell);
 * a symbol that exists only as an override — a project's own multiplier, say — has nothing to
 * inherit and takes the board down the first time it explodes.
 */

/** The subset of a symbol's binding this rule needs: a cell is usable when it names an asset. */
export type CellLike = { type?: string; assetKey?: string } | undefined;
export type StateMapLike = Record<string, CellLike> | undefined;

/** A cell only renders if it names the asset to render. A `spine` cell with no `assetKey` is the
 *  exact shape that crashes, so "present but unusable" counts as missing. */
export const isUsableCell = (cell: CellLike): boolean => Boolean(cell && cell.assetKey);

/**
 * The state a symbol actually draws, given what its map holds.
 *
 * - the Special-Book states inherit `win` — the reveal/idle should mirror the live win art;
 * - `tumbleExplosion` inherits `explosion`, so a project that binds only ONE explosion keeps the
 *   cascade it already had: the second binding EXISTS to let a game use a different skeleton when
 *   the tumble removes a symbol than when something morphs it on the reel, and a game with nothing
 *   to say about that difference must not be punished for it;
 * - `stacked` inherits `static`, so the mode renders the icon before a tall picture is bound;
 * - `intro` inherits `land`, so switching the swap style to `emerge` before a single intro is bound
 *   gives a board that appears and plays its ordinary landing, rather than one that appears already
 *   at rest. `land` rather than `static` because both are ARRIVALS — the fallback should be the
 *   nearest thing the symbol already says about arriving, and `static` is what it says about not
 *   arriving at all;
 * - ANY unauthored state now inherits `static` as a last resort, because a symbol sitting in its
 *   resting art is a better answer than a symbol that is not drawn at all — and a far better one
 *   than a crash.
 *
 * Returns `null` when even `static` is unusable: the caller renders nothing and warns.
 */
export const resolveSymbolState = (states: StateMapLike, state: string): string | null => {
	if (!states) return null;
	if (isUsableCell(states[state])) return state;
	if (state === 'bookIntro' || state === 'bookIdle') {
		if (isUsableCell(states.win)) return 'win';
	}
	if (state === 'tumbleExplosion' && isUsableCell(states.explosion)) return 'explosion';
	if (state === 'intro' && isUsableCell(states.land)) return 'land';
	return isUsableCell(states.static) ? 'static' : null;
};
