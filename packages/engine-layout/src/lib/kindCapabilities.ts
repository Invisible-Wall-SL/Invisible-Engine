/**
 * What a game KIND offers — the one source every authoring tool reads to decide which options to
 * show (design `docs/design/hold-and-win.md` §5 "Cross-cutting first"). A tool asks
 * `kindCapabilities(gameType, config)` instead of testing `gameType === 'bookOf'` or a win model
 * itself, so adding a kind (or a kind gaining a mechanic) is an edit here, not a hunt through tools.
 *
 * For every kind that existed before `holdAndWin` the flags reproduce exactly what each tool showed
 * without it: a flag that nothing gated on is `true` for them, never a new restriction. An id that is
 * not a built-in kind (an author-created custom kind) gets the same answers as `lines`, which is what
 * every tool gave it before.
 */

import { HOLD_AND_WIN_SYMBOL_STATES, SYMBOL_STATES, type SymbolStateName } from './symbolStates';

/** The facts about a project's config that a capability depends on — RESOLVED values, not the raw
 *  sparse doc, so the answer matches the one the game acts on. Structural on purpose:
 *  `engine-layout` does not depend on `game-config`. */
export interface KindCapabilityConfig {
	/** `resolveCascade(doc)` — does this project tumble? */
	cascade?: boolean;
	/** `resolveWinModel(doc).type`. */
	winModel?: string;
}

export interface KindCapabilities {
	/** Free-spin scenes, counter and states. Off for Hold and Win, whose feature is the respins
	 *  (its Phase 1 placeholder scene set still carries the skeleton's free-spin scenes). */
	freeSpins: boolean;
	/** The Book-of special symbol: its reveal/expand beats and the `bookIntro`/`bookIdle` states. */
	bookReveal: boolean;
	/** Tall stacked-picture symbols. */
	stackedPictures: boolean;
	/** The tumble board: the config's resolved answer when given, else the kind's default. */
	cascade: boolean;
	/** The scatter kind's multiplier-collect beat. */
	multiplierCollect: boolean;
	/** The Hold and Win respin feature. */
	holdAndWin: boolean;
	/** Coin symbols carrying a cash value or a jackpot label. */
	coinSymbols: boolean;
	/** Paylines pay: the config's win model when given, else the kind's default. */
	winLines: boolean;
	/** The Symbols tool's "Book symbol VFX" section — the layers drawn behind/in front of the book
	 *  symbol during free spins. Offered to every kind that has free spins (it always was, book reveal
	 *  or not); off for Hold and Win, which has no free spins for it to dress. */
	bookSymbolVfx: boolean;
	/** The Symbols tool's "Explosion pattern" section — the order the winning seats pop in on a
	 *  cascade or a board clear. The section's own gate (does the board explode its seats?) still
	 *  applies; this only takes it off a kind whose board never pops winning seats. */
	tumblePattern: boolean;
	/** The Symbols tool's "Transition" section — the explosion → intro animation under the `emerge`
	 *  swap style. The emerge gate still applies; this only takes it off a kind that never swaps. */
	symbolTransition: boolean;
}

const CASCADE_KINDS: ReadonlySet<string> = new Set(['cluster', 'scatter']);
const NON_LINE_KINDS: ReadonlySet<string> = new Set(['ways', 'cluster', 'scatter']);

export function kindCapabilities(
	gameType: string | undefined,
	config: KindCapabilityConfig = {},
): KindCapabilities {
	const kind = gameType ?? '';
	const holdAndWin = kind === 'holdAndWin';
	return {
		freeSpins: !holdAndWin,
		bookReveal: kind === 'bookOf',
		stackedPictures: !holdAndWin,
		cascade: config.cascade ?? CASCADE_KINDS.has(kind),
		multiplierCollect: kind === 'scatter',
		holdAndWin,
		coinSymbols: holdAndWin,
		winLines: config.winModel ? config.winModel === 'lines' : !NON_LINE_KINDS.has(kind),
		bookSymbolVfx: !holdAndWin,
		tumblePattern: !holdAndWin,
		symbolTransition: !holdAndWin,
	};
}

/**
 * The symbol states a kind's authoring surfaces offer: every state, minus the Hold and Win ones for
 * a kind without the respin feature. The doc schema still accepts every state, so a binding never
 * fails to round-trip; this only decides what a picker lists.
 */
export function symbolStatesForKind(gameType: string | undefined): readonly SymbolStateName[] {
	if (kindCapabilities(gameType).holdAndWin) return SYMBOL_STATES;
	const holdAndWin: ReadonlySet<string> = new Set(HOLD_AND_WIN_SYMBOL_STATES);
	return SYMBOL_STATES.filter((state) => !holdAndWin.has(state));
}
