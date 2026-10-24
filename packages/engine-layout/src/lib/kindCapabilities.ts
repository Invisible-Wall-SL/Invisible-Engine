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
 *
 * ADD-ONS are additive (design `docs/design/pots-overlay.md` §4): a config block lights up only the
 * add-on's own parts, and everything else stays on the kind — a `bookOf` project with a Hold and
 * Win bonus keeps its free spins and book reveal. Without a block every answer is the kind's alone.
 *
 * FAMILIES (`docs/design/game-families.md` §6.1): a match-3 or arcade project is offered none of a
 * slot's sections, and its outcome decides whether it has a wallet. The family is the config's when
 * given, else the kind's. The kind half mirrors `familyOfKind` (`constants-shared/gameKinds`),
 * named here because the built-in defs that read this module must load with no install
 * (`scripts/current-games/lib/builtins.mjs`); `check:game-config-family` pins the two together. A slot answers every family flag `true`, so no slot
 * tool changes. The game itself never reads these flags; it reads its config.
 */

import {
	HOLD_AND_WIN_SYMBOL_STATES,
	MATCH3_SYMBOL_STATES,
	POTS_TOKEN_SYMBOL_STATES,
	SYMBOL_STATES,
	type SymbolStateName,
} from './symbolStates';

/** The facts about a project's config that a capability depends on — RESOLVED values, not the raw
 *  sparse doc, so the answer matches the one the game acts on. Structural on purpose:
 *  `engine-layout` does not depend on `game-config`. */
export interface KindCapabilityConfig {
	/** `resolveCascade(doc)` — does this project tumble? */
	cascade?: boolean;
	/** `resolveWinModel(doc).type`. */
	winModel?: string;
	/** The project declares a respin mode with rules — `board: 'respinBoard'` and a Hold and Win game
	 *  (game-config's `bonusCapabilityInputs().respinMode`, `docs/design/bonus-games.md` §2.4): a
	 *  Hold and Win bonus on any kind. */
	holdAndWin?: boolean;
	/** The coin overlay drops tokens (`bonusCapabilityInputs().potsOverlay`): the pots overlay
	 *  add-on. */
	potsOverlay?: boolean;
	/** `resolveExpandingSymbol(doc) !== undefined` — the Book-of expanding special is on
	 *  (`docs/design/book-feature.md` §3.3). */
	expandingSymbol?: boolean;
	/** `resolveFamily(doc)` — `slot`, `match3` or `arcade`. Absent ⇒ the kind's family. */
	family?: string;
	/** `resolveOutcome(doc)` — `rgs` or `rules`. Absent ⇒ `rgs`. */
	outcome?: string;
}

export interface KindCapabilities {
	/** Free-spin scenes, counter and states. Off for the Hold and Win kind, whose feature is the
	 *  respins; another kind keeps them with a `holdAndWin` block. */
	freeSpins: boolean;
	/** The Book-of special symbol: its reveal/expand beats and the `bookIntro`/`bookIdle` states.
	 *  The config's expanding symbol, or (until the `bookOf` kind is retired) the kind. */
	bookReveal: boolean;
	/** Tall stacked-picture symbols. */
	stackedPictures: boolean;
	/** The tumble board: the config's resolved answer when given, else the kind's default. */
	cascade: boolean;
	/** The scatter kind's multiplier-collect beat. */
	multiplierCollect: boolean;
	/** The Hold and Win respin feature: the kind's own, or a declared respin mode's. */
	holdAndWin: boolean;
	/** Coin symbols carrying a cash value or a jackpot label. Follows {@link holdAndWin}. */
	coinSymbols: boolean;
	/** The pot parts a Hold and Win feature and the pots overlay share: the Pot Meter, the pot
	 *  signals, the `toMeter:<id>` flights. */
	pots: boolean;
	/** The pots overlay add-on's own parts — on only while the config carries its block. */
	potsOverlay: boolean;
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
	/** The game takes a stake and pays wins: the balance and win readouts. Off for a free-play game
	 *  whose own rules decide (`outcome: 'rules'`). */
	wallet: boolean;
	/** The bet selector and the bet modes' menu. Follows {@link wallet}. */
	betControls: boolean;
	/** A board of symbols: a slot's reels or a match-3 grid. Off for arcade. */
	board: boolean;
	/** The player moves the board's gems (a match-3 grid): its `select` / `hint` symbol states. Off
	 *  for every slot. */
	boardInput: boolean;
}

const CASCADE_KINDS: ReadonlySet<string> = new Set(['cluster', 'scatter']);
const FAMILY_KINDS: ReadonlySet<string> = new Set(['match3', 'arcade']);
const NON_LINE_KINDS: ReadonlySet<string> = new Set(['ways', 'cluster', 'scatter']);

export function kindCapabilities(
	gameType: string | undefined,
	config: KindCapabilityConfig = {},
): KindCapabilities {
	const kind = gameType ?? '';
	const family = config.family ?? (FAMILY_KINDS.has(kind) ? kind : 'slot');
	if (family === 'match3' || family === 'arcade') return familyCapabilities(family, config);
	const holdAndWinKind = kind === 'holdAndWin';
	const holdAndWin = holdAndWinKind || !!config.holdAndWin;
	const potsOverlay = !!config.potsOverlay;
	return {
		freeSpins: !holdAndWinKind,
		// The kind half is the transition shim of `docs/design/book-feature.md`; Phase 7 removes it.
		bookReveal: kind === 'bookOf' || !!config.expandingSymbol,
		stackedPictures: !holdAndWinKind,
		cascade: config.cascade ?? CASCADE_KINDS.has(kind),
		multiplierCollect: kind === 'scatter',
		holdAndWin,
		coinSymbols: holdAndWin,
		pots: holdAndWin || potsOverlay,
		potsOverlay,
		winLines: config.winModel ? config.winModel === 'lines' : !NON_LINE_KINDS.has(kind),
		bookSymbolVfx: !holdAndWinKind,
		tumblePattern: !holdAndWinKind,
		symbolTransition: !holdAndWinKind,
		wallet: true,
		betControls: true,
		board: true,
		boardInput: false,
	};
}

/** A match-3 board pops its matches and tumbles like a cascade slot; an arcade game has no board.
 *  Neither has any of a slot's features. */
function familyCapabilities(
	family: 'match3' | 'arcade',
	config: KindCapabilityConfig,
): KindCapabilities {
	const match3 = family === 'match3';
	const wallet = config.outcome !== 'rules';
	return {
		freeSpins: false,
		bookReveal: false,
		stackedPictures: false,
		cascade: match3,
		multiplierCollect: false,
		holdAndWin: false,
		coinSymbols: false,
		pots: false,
		potsOverlay: false,
		winLines: false,
		bookSymbolVfx: false,
		tumblePattern: match3,
		symbolTransition: false,
		wallet,
		betControls: wallet,
		board: match3,
		boardInput: match3,
	};
}

/**
 * The symbol states a kind's authoring surfaces offer (the match-3 `select` / `hint` only to a
 * project with a match-3 board): every state for a project with the respin feature (`holdAndWin`);
 * for a pots overlay host without it (`pots` alone), every state but the Hold and Win ones, plus
 * the token's {@link POTS_TOKEN_SYMBOL_STATES}; otherwise every state minus the Hold and Win ones. The doc schema still accepts every state, so a binding never fails to
 * round-trip; this only decides what a picker lists.
 */
export function symbolStatesForKind(
	gameType: string | undefined,
	config?: KindCapabilityConfig,
): readonly SymbolStateName[] {
	const capabilities = kindCapabilities(gameType, config);
	const match3: ReadonlySet<string> = new Set(capabilities.boardInput ? [] : MATCH3_SYMBOL_STATES);
	const states = SYMBOL_STATES.filter((state) => !match3.has(state));
	if (capabilities.holdAndWin) return states;
	const holdAndWin: ReadonlySet<string> = new Set(HOLD_AND_WIN_SYMBOL_STATES);
	const token: ReadonlySet<string> = new Set(capabilities.pots ? POTS_TOKEN_SYMBOL_STATES : []);
	return states.filter((state) => !holdAndWin.has(state) || token.has(state));
}
