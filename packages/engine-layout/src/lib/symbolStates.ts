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
	'coinIdle',
	'coinLand',
	'coinStick',
	'coinCollect',
	'coinBoost',
	'respinsAdd',
	'coinUpgrade',
	'rowUnlock',
	'jackpotReveal',
	'mysteryReveal',
	'flyToMeter',
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
 * under a moving board, a morph pop reads on a resting reel — and the engine's own rig set carries
 * a separate explosion for each, so they are separate bindings here.
 *
 * Unauthored it INHERITS `explosion` (`packages/engine-game/src/game/symbolCell.ts`), which is what keeps a
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
 * Unauthored it INHERITS `land` (`packages/engine-game/src/game/symbolCell.ts`), which is what keeps a project
 * that never binds it looking exactly as it does today the moment it switches the style on — an
 * emerge with no authored intro is a board that appears and plays its ordinary landing.
 *
 * Valid in the doc for every game (the schema accepts it so bindings round-trip), but the Symbols
 * grid only shows its column for a project that actually emerges — same gating idea as
 * {@link BOOK_SYMBOL_STATES} and {@link CASCADE_SYMBOL_STATES}.
 */
export const SWAP_SYMBOL_STATES = ['intro'] as const;

/**
 * The HOLD AND WIN states — the respin feature's beats (docs/design/hold-and-win.md §4.4), each a
 * moment the coded presentation already plays through a borrowed state:
 *
 * - `coinIdle` — a held coin at rest on the respin board;
 * - `coinLand` — a respin CELL whose one-cell reel stops (empty or not — the stick comes after);
 * - `coinStick` — a landed coin STICKING into the held layer (also a mystery or a multiplier landing
 *   as what it became);
 * - `coinCollect` — a coin pulsing as a collector takes it;
 * - `coinBoost` — a special raising other coins (a payer paying, a multiplier boosting);
 * - `respinsAdd` — an add-respins special applying (its respins fly to the counter);
 * - `coinUpgrade` — an upgrade special applying (its beams raise coins or a jackpot tier);
 * - `rowUnlock` — an unlock symbol opening a row of an expanding board;
 * - `jackpotReveal` — a jackpot coin, or a full board, lit for its jackpot;
 * - `mysteryReveal` — a mystery opening before it becomes what it revealed;
 * - `flyToMeter` — a base-board special lit while it flies into its pot.
 *
 * Unauthored each INHERITS exactly what the coded presentation played before it existed
 * (`packages/engine-game/src/game/symbolCell.ts`), so a project that binds none renders
 * byte-identically. Valid in the doc for every game (the schema accepts them so bindings
 * round-trip), but the Symbols grid only shows their columns for a Hold and Win project — same gating
 * idea as {@link BOOK_SYMBOL_STATES}.
 */
export const HOLD_AND_WIN_SYMBOL_STATES = [
	'coinIdle',
	'coinLand',
	'coinStick',
	'coinCollect',
	'coinBoost',
	'respinsAdd',
	'coinUpgrade',
	'rowUnlock',
	'jackpotReveal',
	'mysteryReveal',
	'flyToMeter',
] as const;

/**
 * The Hold and Win states a POTS OVERLAY token plays (`docs/design/pots-overlay.md` §3.4): it lands
 * over its cell, rests there, then lights as it flies into its pot. A host with the overlay but no
 * respin feature offers only these; one with the feature offers every {@link HOLD_AND_WIN_SYMBOL_STATES}.
 */
export const POTS_TOKEN_SYMBOL_STATES = [
	'coinLand',
	'coinIdle',
	'flyToMeter',
] as const satisfies readonly (typeof HOLD_AND_WIN_SYMBOL_STATES)[number][];

/**
 * What the board knows about ONE symbol that decides which states it can ever play — read off the
 * Game Config (`symbolsPageConfig` in the launcher). Structural on purpose: `engine-layout` does not
 * depend on `game-config`.
 */
export interface SymbolPlayFacts {
	/** A reel strip deals it — the base game's, a spins mode's or the respin board's. */
	dealt: boolean;
	/** The base game's or a spins mode's strip deals it, so it lands on the reels, not only on the
	 *  respin board. */
	onReels: boolean;
	/** A pots overlay draws it over a cell: a pot's token. */
	token: boolean;
	/** Its Hold and Win roles (`special_properties`) on a project with the respin feature, else
	 *  none. */
	holdAndWinRoles: readonly string[];
	/** It fills a Hold and Win meter: lit on the base board while it flies into its pot. */
	fillsMeter: boolean;
}

/** The Hold and Win states every symbol the respin board HOLDS plays: it stops on its cell, sticks,
 *  rests, is collected (by a collector, a full column, an instant collect) and lights on a full
 *  board's jackpot. */
const HELD_SYMBOL_STATES: readonly SymbolStateName[] = [
	'coinIdle',
	'coinLand',
	'coinStick',
	'coinCollect',
	'jackpotReveal',
];

/** The roles the respin board never holds: the empty cell, which only stops, and a pot's filling
 *  special, which only flies. */
const UNHELD_ROLES: ReadonlySet<string> = new Set(['blank', 'meterSpecial']);

/** The Hold and Win beats only one role's symbol plays, on top of {@link HELD_SYMBOL_STATES}. */
const ROLE_SYMBOL_STATES: Readonly<Record<string, readonly SymbolStateName[]>> = {
	payer: ['coinBoost'],
	coinMultiplier: ['coinBoost'],
	addRespins: ['respinsAdd'],
	upgrade: ['coinUpgrade'],
	unlock: ['rowUnlock'],
	mystery: ['mysteryReveal'],
};

/**
 * The states the game plays for ONE symbol — the Symbols grid's cells for its row — out of the
 * project's `columns`, in their order.
 *
 * - A dealt symbol with no Hold and Win role plays every column but the Hold and Win ones, and
 *   `clearReel` only on a board that cascades or clears (`clearsBoard`).
 * - A dealt Hold and Win symbol rests and spins (on the reels, or rolling past a respin cell). It
 *   never plays `win` or `postWinStatic`: it pays by its value, never on a line, so no win beat lights
 *   it, and it is never the book special. On the reels it lands, appears under `emerge`, is taken off
 *   by a cascade or a board clear, and explodes in a book game, whose column morph pops every cell it
 *   turns. Held on the respin board it plays {@link HELD_SYMBOL_STATES} plus its role's own beat, and
 *   lands and leaves there too (`coinStick` borrows `land`; a finished streak, an applied special or
 *   a completed column takes its cells off with `clearReel`); the blank only stops (`coinLand`). A
 *   meter's filling symbol plays `flyToMeter` as it flies off the reels.
 * - A pots overlay token plays `static` (riding a rolling reel, and the art its other states fall
 *   back to) and {@link POTS_TOKEN_SYMBOL_STATES}.
 *
 * A state left out may still be DRAWN through another's inheritance (`coinCollect` borrows `win`),
 * which the grid shows on the cell that borrows it.
 */
export function symbolStatesPlayed(
	columns: readonly SymbolStateName[],
	facts: SymbolPlayFacts,
	{ bookReveal, clearsBoard }: { bookReveal: boolean; clearsBoard: boolean },
): SymbolStateName[] {
	const holdAndWin: ReadonlySet<string> = new Set(HOLD_AND_WIN_SYMBOL_STATES);
	const plays = new Set<SymbolStateName>();
	const roles = facts.holdAndWinRoles;
	if (facts.dealt && roles.length === 0) {
		for (const state of columns) {
			if (!holdAndWin.has(state) && (state !== 'clearReel' || clearsBoard)) plays.add(state);
		}
	}
	if (facts.dealt && roles.length > 0) {
		const held = roles.some((role) => !UNHELD_ROLES.has(role));
		plays.add('static');
		plays.add('spin');
		if (facts.onReels || held) plays.add('land');
		if (held || (facts.onReels && clearsBoard)) plays.add('clearReel');
		if (facts.onReels) {
			plays.add('intro');
			if (bookReveal) plays.add('explosion');
		}
		if (held) for (const state of HELD_SYMBOL_STATES) plays.add(state);
		if (roles.includes('blank')) plays.add('coinLand');
		for (const role of roles) for (const state of ROLE_SYMBOL_STATES[role] ?? []) plays.add(state);
	}
	if (facts.onReels && facts.fillsMeter) plays.add('flyToMeter');
	if (facts.token) {
		plays.add('static');
		for (const state of POTS_TOKEN_SYMBOL_STATES) plays.add(state);
	}
	return columns.filter((state) => plays.has(state));
}

/**
 * The states that are a WIN HIGHLIGHT — `win` and the Hold and Win beats that played `win` before
 * they had names of their own. The authored win frame (`highlight`) draws over all of them, as it did
 * when each of these beats requested `win`.
 */
export const WIN_HIGHLIGHT_SYMBOL_STATES = [
	'win',
	'coinCollect',
	'coinBoost',
	'respinsAdd',
	'coinUpgrade',
	'rowUnlock',
	'jackpotReveal',
	'flyToMeter',
] as const;

/**
 * The TERMINAL states — the ones a presentation plays and then MOVES PAST, so their animation
 * defaults to ONE-SHOT where every other state defaults to a loop.
 *
 * The default everywhere else is LOOP (`symbolCellSchema.loop`: "ABSENT MEANS LOOP"), which is right
 * for a state that describes how a symbol IS — resting, spinning, celebrating — and wrong for one
 * that describes a symbol LEAVING. A looping explosion has no end to wait on, so the beat that awaits
 * it can only ever be settled by its cap.
 *
 * That cap is not free on either caller. The end-of-win pop (`boardExplodeWinSymbols`) is ONE
 * concurrent beat for the whole spin, so a looping explosion makes every paying spin sit out the
 * entire win-beat budget — `WIN_BEAT_CAP_MS` by default, or whatever ceiling the project authored —
 * with a board of symbols being blown apart and re-formed on repeat, before it clears. The cascade's
 * removal beat (`TumbleBoard`) pays `TRANSIT_BEAT_CAP_MS` on every step for the same reason.
 * Measured on the reference symbol set: a 0.53s explosion restarting ~7.5 times across a 4000ms
 * budget.
 *
 * So this is not a preference, it is what the state MEANS. An author who genuinely wants a repeating
 * pop still says so — an explicit `loop: true` on the cell wins over this default, exactly as an
 * explicit `loop: false` always won over the loop default.
 *
 * `clearReel` is here for the same reason and not merely by association: it is the other half of the
 * same beat (the board TAKING a symbol off), it is awaited the same way, and unauthored it renders
 * the `explosion` binding itself — so leaving it out would give one project's pop an end and its
 * neighbour's an endless loop depending only on which of the two cells got bound.
 *
 * `mysteryReveal` is the same beat on the respin board — a mystery opening on its way to becoming
 * something else — and unauthored it renders the `explosion` binding.
 *
 * Deliberately NOT extended to `win`/`land`. Both are also awaited, but both are states a game may
 * legitimately want to repeat while the board rests, and changing their default would re-time every
 * shipped game's win presentation — which is what `winBeat.maxMs` exists to let a project do
 * deliberately.
 */
export const TERMINAL_SYMBOL_STATES = ['explosion', 'clearReel', 'mysteryReveal'] as const;

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
	coinIdle: 'Coin idle',
	coinLand: 'Coin land',
	coinStick: 'Coin stick',
	coinCollect: 'Coin collect',
	coinBoost: 'Coin boost',
	respinsAdd: 'Respins add',
	coinUpgrade: 'Coin upgrade',
	rowUnlock: 'Row unlock',
	jackpotReveal: 'Jackpot reveal',
	mysteryReveal: 'Mystery reveal',
	flyToMeter: 'Fly to meter',
};
