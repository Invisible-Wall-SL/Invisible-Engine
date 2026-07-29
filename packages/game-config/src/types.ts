/**
 * Invisible Game Config — the per-project GAME MATH CONTRACT (design doc
 * `invisible-game-config.md`).
 *
 * This is the frontend's view of the math, NOT the math itself: the RGS remains the authority on
 * outcomes; this doc tells the client what to draw and what to expect. It exists because every
 * online project currently shares the ONE `apps/lines/src/game/config.ts` compiled into the shared
 * `_runtime/lines` bundle — same symbol dictionary, same 20 paylines, same strips for everyone.
 *
 * The shape mirrors the Stake-Engine config the math team already produces, **byte-compatible on
 * purpose**: `special_properties` and `max_win` are snake_case because that is how a real config
 * arrives, and paste-in from the math team is a first-class flow. Do not "tidy" the wire names.
 *
 * Dependency-free (no Zod, no Svelte, no Pixi) so it is Node-resolvable and the contract is
 * fixture-verifiable offline — same rule as `engine-flipbook`. The Zod validator lives in the
 * launcher (`gameConfigStorage.ts`); the TYPE lives here because the game and the tool must agree.
 */

export const GAME_CONFIG_DOC_VERSION = 1;

/**
 * One paytable row: occurrence-count → payout multiplier, e.g. `{ '5': 20 }`.
 *
 * A LIST of single-entry objects rather than one `{ '5': 20, '4': 10 }` map, because that is the
 * Stake export shape. Multi-key objects are tolerated on read (see `normalizeSymbol`) so a
 * hand-written or tool-emitted config is not rejected for being tidier than the export.
 */
export type PaytableRow = Record<string, number>;

/**
 * A symbol's entry in the DICTIONARY. Both fields are optional: a scatter has properties and no
 * paytable, and a purely decorative symbol may have neither.
 *
 * Dictionary membership does NOT mean the game deals the symbol — that is what the strips say.
 * See {@link symbolsInPlay}.
 */
export type GameConfigSymbol = {
	paytable?: PaytableRow[];
	special_properties?: string[];
};

/** One cell of a cosmetic reel strip. An object (not a bare string) to match the Stake shape. */
export type ReelStripCell = { name: string };

/** One reel's strip, top to bottom. */
export type ReelStrip = ReelStripCell[];

/**
 * Cosmetic strips keyed by GAME TYPE (`basegame` / `freegame` / whatever a game declares), each
 * holding one strip per reel. These are the blur filler the spinning reel cycles through — not the
 * real weighted strips, which the math team owns and which never reach the client.
 *
 * They are nevertheless the only client-side statement of the **in-play symbol set**, which is why
 * they are the gate every "does this game have symbol X?" question must ask.
 */
export type PaddingReels = Record<string, ReelStrip[]>;

/** One entry of the bet selector / buy-bonus menu. `max_win` is snake_case per the Stake export. */
export type BetMode = {
	cost: number;
	feature: boolean;
	buyBonus: boolean;
	rtp: number;
	max_win: number;
};

/**
 * How a bet mode presents in the menu:
 * - `base` — the default stake; no card, it's just the game.
 * - `ante` — a persistent boost the player toggles on and leaves on (Stake calls it "activate").
 * - `buy` — a one-shot purchase of the feature.
 *
 * `ante` is EXPLICIT-only: the two math booleans (`feature`/`buyBonus`) cannot express it (the base
 * mode itself is `feature: true`), so an ante mode has to be marked here. `base`/`buy` are derived
 * from `buyBonus` when unset — see `resolveBetModes`.
 */
export type BetModeKind = 'base' | 'ante' | 'buy';

/**
 * The player-facing copy for a bet mode. Every field is a **source string in the base language** —
 * the runtime renders it through the i18n resolver, whose key IS the source text, so these strings
 * localize exactly like scene text does. Sparse: an unauthored field falls back to a derived default
 * (see `resolveBetModes`), so a config need only override what it wants to change.
 */
export type BetModeText = {
	title?: string;
	description?: string;
	button?: string;
	dialog?: string;
	/** The label the bet readout shows while this mode is the active stake (an ante's persistent
	 *  badge, e.g. "DOUBLE CHANCE"). Unset ⇒ the HUD falls back to the generic "BET". */
	betAmountLabel?: string;
};

/**
 * The PRESENTATION of a bet mode — kind, menu order, and copy. An INVISIBLE-ENGINE extension, NOT
 * part of the Stake export (which owns only the math half, {@link BetMode}); a paste-in config
 * simply omits it, exactly like {@link GameConfigDoc.paylineColors}. Kept OUT of `betModes` so those
 * entries round-trip a math export byte-for-byte.
 */
export type BetModePresentation = {
	kind?: BetModeKind;
	/** Menu order, ascending. Ties (and unset) fall back to the order the mode appears in `betModes`. */
	order?: number;
	text?: BetModeText;
	art?: BetModeArt;
};

/**
 * A bet mode's ART, by editor-art asset KEY (Invisible Game Config Phase 7 — bet-mode assets).
 * Each field holds an EXISTING editor-art key (the same key space the Scene Editor / component art
 * uses), NOT a literal URL: the runtime resolves it to the already-baked texture, so the art rides
 * the live-asset chain (export → deploy → bake → pull → register) for free. Absent ⇒ no art (the
 * menu falls back to text). Kept separate from `text` so a copy-only edit never touches art.
 */
export type BetModeArt = {
	/** The mode's menu/selector icon. */
	icon?: string;
	/** The buy/confirm dialog's hero image. */
	dialogImage?: string;
	/** The volatility indicator art. */
	volatility?: string;
};

/** Presentation overrides keyed by the SAME mode key as {@link GameConfigDoc.betModes}. */
export type BetModePresentationMap = Record<string, BetModePresentation>;

/**
 * A bet mode folded into what the menu needs: the math from {@link BetMode} + the presentation from
 * {@link BetModePresentation}, with every default already resolved. The ONE shape the runtime maps
 * into its `BetModeMeta` — see `resolveBetModes`. Text fields are still SOURCE strings (the runtime
 * translates them at render).
 */
export type ResolvedBetMode = {
	mode: string;
	kind: BetModeKind;
	/** What the bet selector multiplies the base bet by — the config's `cost`. */
	costMultiplier: number;
	maxWin: number;
	rtp: number;
	order: number;
	title: string;
	description: string;
	button: string;
	dialog: string;
	/** The HUD bet-readout label. Empty when unauthored, so the HUD keeps its generic "BET". */
	betAmountLabel: string;
	/** Editor-art asset keys for the mode's art, RESOLVED — empty strings when unauthored, so a
	 *  consumer renders nothing rather than a broken texture. The runtime maps these into
	 *  `BetModeData.assets` and resolves each key to its baked texture. */
	art: { icon: string; dialogImage: string; volatility: string };
};

/**
 * A payline as ROW INDICES, one per reel: `[0, 1, 2, 1, 0]` on a 5-reel game. Keyed by line id
 * (a stringified number in every config seen so far, but treated as an opaque string here).
 */
export type Paylines = Record<string, number[]>;

/**
 * The whole authored config. **DENSE, not sparse** — unlike Win Text or the Symbols SM, a project
 * either has a complete config or has none at all and falls through to the compiled template. A
 * half-merged config is a config with a missing symbol dictionary, so there is no partial doc type.
 */
export type GameConfigDoc = {
	version: typeof GAME_CONFIG_DOC_VERSION;
	providerName: string;
	gameName: string;
	gameID: string;
	rtp: number;
	numReels: number;
	/** Visible rows per reel — one entry per reel, so a stepped grid is expressible. */
	numRows: number[];
	betModes: Record<string, BetMode>;
	/**
	 * OPTIONAL per-mode presentation (kind / order / copy) for the bet-selector + buy-bonus menu, keyed
	 * by the SAME mode id as {@link betModes}. An INVISIBLE-ENGINE extension, not part of the Stake
	 * export — a paste-in config omits it and the runtime derives sane defaults (see `resolveBetModes`).
	 * Sparse: only modes with an override appear.
	 */
	betModePresentation?: BetModePresentationMap;
	paylines: Paylines;
	/** The symbol DICTIONARY — art/properties/payouts. Not the in-play set. */
	symbols: Record<string, GameConfigSymbol>;
	paddingReels: PaddingReels;
	/**
	 * OPTIONAL per-payline colour, keyed by the SAME payline id as {@link paylines}, as a `#rrggbb`
	 * hex string. An INVISIBLE-ENGINE extension, not part of the Stake export — a paste-in config
	 * simply omits it. When set for a line, the win line draws in this colour instead of the single
	 * Symbols-tool default, and the colour is broadcast so assets shown on that win can pick it up
	 * (the reusable win-colour hook). A line with no entry falls back to the default, so leaving it
	 * empty is byte-identical to before.
	 */
	paylineColors?: Record<string, string>;
	updatedAt?: string;
};

/**
 * The compiled `apps/lines/src/game/config.ts` default export, before normalization. Structurally
 * a `GameConfigDoc` minus the fields this tool adds (`version`, `updatedAt`), which is exactly what
 * makes a template config a valid seed — see Phase 2.
 */
export type RawGameConfig = Omit<GameConfigDoc, 'version' | 'updatedAt'>;
