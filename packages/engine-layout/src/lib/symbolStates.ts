/**
 * The fixed symbol-state set — the ONE home for the list that the Invisible Symbols
 * State Machine authors, the Scene Editor's `symbolState` param dropdown offers, and
 * each game's `<Symbol>` state machine renders.
 *
 * It lives in `engine-layout` because both sides depend on this package: the launcher
 * (editor + symbols tool) and the games (`apps/lines`). Previously the same literal was
 * re-declared in three places (`apps/lines/src/game/types.ts`,
 * `apps/launcher-api/src/lib/server/symbolsStorage.ts`, and the symbols tool's
 * browser-side `symbols.client.ts`), which is what let the editor ship a free-text box
 * for a value the tool next door already renders as fixed grid columns.
 *
 * A game whose state machine extends this set (e.g. `apps/lines` unions in
 * `SpinningReelSymbolState`) widens its own type — it must not fork this list.
 */
export const SYMBOL_STATES = [
	'static',
	'spin',
	'intro',
	'land',
	'win',
	'postWinStatic',
	'explosion',
	'tumbleExplosion',
	'bookIntro',
	'bookIdle',
	'stacked',
] as const;

export type SymbolStateName = (typeof SYMBOL_STATES)[number];

/**
 * The CASCADE-only state — the explosion a symbol plays when the tumble overlay REMOVES it, as
 * opposed to the `explosion` an on-reel symbol plays when something morphs it in place (the
 * Book-of column expand). Upstream bound one skeleton to both beats because each of its games
 * shipped a single `symbols3/explosion`; they are different moments — a cascade pop reads under a
 * falling board, a morph pop reads on a resting reel — and the engine's own Spine set carries a
 * separate explosion for each, so they are separate bindings here.
 *
 * Unauthored it INHERITS `explosion` (`apps/lines/src/game/symbolCell.ts`), which is what keeps a
 * project that never binds it byte-identical to before this state existed. Valid in the doc for
 * every game (the schema accepts it so bindings round-trip), but the Symbols grid only shows its
 * column for a game that actually cascades — same gating idea as {@link BOOK_SYMBOL_STATES}.
 */
export const CASCADE_SYMBOL_STATES = ['tumbleExplosion'] as const;

/** The book-only states. Valid in the doc for EVERY game (the schema accepts them so a
 *  book game's bindings always round-trip), but the Symbols grid only shows their columns
 *  for a book game. */
export const BOOK_SYMBOL_STATES = ['bookIntro', 'bookIdle'] as const;

/** The LINES-only state — the stacked-picture reel mode's tall art (docs/design/stacked-picture-mode.md).
 *  A Book-of never stacks pictures, so the Symbols grid should only show its column for a lines game
 *  (same gating idea as {@link BOOK_SYMBOL_STATES}); the doc schema still accepts it for every game so
 *  bindings round-trip. */
export const LINES_SYMBOL_STATES = ['stacked'] as const;

/**
 * The SWAP-only state — the animation a symbol plays when it APPEARS on its seat, under
 * `/config` → Reel behaviour → swap style `emerge` (docs/design/perspective-board-mode.md
 * §"The mode switch").
 *
 * It exists because `land` could not be reused for it. `land` is the beat AFTER a movement — the
 * reels fire it at the end of a roll and the cascade fires it at the end of a fall — so a game that
 * authored "rise out of the water" there would also play the rise every time a reel stopped and
 * every time a cascade refilled. An emerge is the OPPOSITE moment: nothing travelled, so what plays
 * is the whole arrival rather than its punctuation.
 *
 * Unauthored it INHERITS `land` (`apps/lines/src/game/symbolCell.ts`), which is what keeps a project
 * that never binds it looking exactly as it does today the moment it switches the style on — an
 * emerge with no authored intro is a board that appears and plays its ordinary landing.
 *
 * Valid in the doc for every game (the schema accepts it so bindings round-trip), but the Symbols
 * grid only shows its column for a project that actually emerges — same gating idea as
 * {@link BOOK_SYMBOL_STATES} and {@link CASCADE_SYMBOL_STATES}.
 */
export const SWAP_SYMBOL_STATES = ['intro'] as const;

/** Human labels — the Symbols grid column headers, reused by the editor's dropdown so a
 *  state reads the same in both tools. */
export const SYMBOL_STATE_LABELS: Record<SymbolStateName, string> = {
	static: 'Static',
	spin: 'Spin',
	intro: 'Intro',
	land: 'Land',
	win: 'Win',
	postWinStatic: 'Post-win',
	explosion: 'Explosion',
	tumbleExplosion: 'Tumble explosion',
	bookIntro: 'Book reveal',
	bookIdle: 'Book idle',
	stacked: 'Stacked picture',
};
