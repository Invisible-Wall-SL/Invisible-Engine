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
	paylines: Paylines;
	/** The symbol DICTIONARY — art/properties/payouts. Not the in-play set. */
	symbols: Record<string, GameConfigSymbol>;
	paddingReels: PaddingReels;
	updatedAt?: string;
};

/**
 * The compiled `apps/lines/src/game/config.ts` default export, before normalization. Structurally
 * a `GameConfigDoc` minus the fields this tool adds (`version`, `updatedAt`), which is exactly what
 * makes a template config a valid seed — see Phase 2.
 */
export type RawGameConfig = Omit<GameConfigDoc, 'version' | 'updatedAt'>;
