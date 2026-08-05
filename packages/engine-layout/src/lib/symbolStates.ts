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
	'land',
	'win',
	'postWinStatic',
	'explosion',
	'bookIntro',
	'bookIdle',
	'stacked',
] as const;

export type SymbolStateName = (typeof SYMBOL_STATES)[number];

/** The book-only states. Valid in the doc for EVERY game (the schema accepts them so a
 *  book game's bindings always round-trip), but the Symbols grid only shows their columns
 *  for a book game. */
export const BOOK_SYMBOL_STATES = ['bookIntro', 'bookIdle'] as const;

/** The LINES-only state — the stacked-picture reel mode's tall art (docs/design/stacked-picture-mode.md).
 *  A Book-of never stacks pictures, so the Symbols grid should only show its column for a lines game
 *  (same gating idea as {@link BOOK_SYMBOL_STATES}); the doc schema still accepts it for every game so
 *  bindings round-trip. */
export const LINES_SYMBOL_STATES = ['stacked'] as const;

/** Human labels — the Symbols grid column headers, reused by the editor's dropdown so a
 *  state reads the same in both tools. */
export const SYMBOL_STATE_LABELS: Record<SymbolStateName, string> = {
	static: 'Static',
	spin: 'Spin',
	land: 'Land',
	win: 'Win',
	postWinStatic: 'Post-win',
	explosion: 'Explosion',
	bookIntro: 'Book reveal',
	bookIdle: 'Book idle',
	stacked: 'Stacked picture',
};
