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
	'clearReel',
	'bookIntro',
	'bookIdle',
	'stacked',
] as const;

export type SymbolStateName = (typeof SYMBOL_STATES)[number];

/**
 * The CLEAR-only state — what a symbol plays when it is TAKEN OFF the board: the cascade removing a
 * winning symbol, and the swap-in-place CLEAR step (`clearOutgoingSymbols`) emptying the board
 * before the new symbols arrive. Both reach `TumbleBoard.svelte`'s explode handler, which is why one
 * state covers them.
 *
 * It is distinct from `explosion`, which is a symbol popping WHERE IT STANDS while the reel keeps
 * it — the Book-of column morph. Upstream bound one skeleton to both beats because each of its games
 * shipped a single `symbols3/explosion`; they are different moments — a symbol being swept off reads
 * under a moving board, a morph pop reads on a resting reel — and the engine's own Spine set carries
 * a separate explosion for each, so they are separate bindings here.
 *
 * Unauthored it INHERITS `explosion` (`apps/lines/src/game/symbolCell.ts`), which is what keeps a
 * project that never binds it byte-identical to before this state existed. Valid in the doc for
 * every game (the schema accepts it so bindings round-trip), but the Symbols grid only shows its
 * column for a project that cascades OR clears — same gating idea as {@link BOOK_SYMBOL_STATES}.
 *
 * NAMING: this was `tumbleExplosion` until 2026-09-10. Saved docs still hold the old key and are
 * folded into `clearReel` at the load boundary — see `symbolsStorage.ts#migrateLegacySymbolStates`.
 */
export const CASCADE_SYMBOL_STATES = ['clearReel'] as const;

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

/**
 * The TERMINAL states — the ones a presentation plays and then MOVES PAST, so their animation
 * defaults to ONE-SHOT where every other state defaults to a loop.
 *
 * The default everywhere else is LOOP (`symbolCellSchema.loop`: "ABSENT MEANS LOOP"), which is right
 * for a state that describes how a symbol IS — resting, spinning, celebrating — and wrong for one
 * that describes a symbol LEAVING. A looping explosion has no end to wait on: the engine's beat
 * (`awaitSymbolBeat`) then runs to its runaway cap, and the symbol spends that whole cap being blown
 * apart and cleared on repeat. Measured on `apps/lines` with "Winning symbols explode" on: a 0.53s
 * explosion looped ~7.5 times over a 4000ms `WIN_BEAT_CAP_MS` before the cell reverted to
 * `postWinStatic` — read from a live board as "the symbols vanish where the win was".
 *
 * So this is not a preference, it is what the state MEANS. An author who genuinely wants a repeating
 * pop still says so — an explicit `loop: true` on the cell wins over this default, exactly as an
 * explicit `loop: false` always won over the loop default.
 *
 * `clearReel` is here for the same reason and not merely by association: it is the other half of the
 * same beat (the board TAKING a symbol off), it is awaited the same way by `TumbleBoard`, and
 * unauthored it renders the `explosion` binding itself — so leaving it out would give one project's
 * pop an end and its neighbour's an endless loop depending only on which of the two cells got bound.
 *
 * Deliberately NOT extended to `win`/`land`. Both are also awaited, but both are states a game may
 * legitimately want to repeat while the board rests, and changing their default would re-time every
 * shipped game's win presentation.
 */
export const TERMINAL_SYMBOL_STATES = ['explosion', 'clearReel'] as const;

/**
 * Does this state's animation repeat when the authored cell says nothing? The one home for the
 * answer, so the renderer and any tool that previews a state agree by construction.
 *
 * Takes a plain `string` rather than {@link SymbolStateName} because a game's state machine may
 * widen the set with its own states (`apps/lines` unions in `SpinningReelSymbolState`), and anything
 * outside the terminal set gets the historical loop default.
 */
export const symbolStateLoopsByDefault = (state: string): boolean =>
	!(TERMINAL_SYMBOL_STATES as readonly string[]).includes(state);

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
	clearReel: 'Clear reel',
	bookIntro: 'Book reveal',
	bookIdle: 'Book idle',
	stacked: 'Stacked picture',
};
