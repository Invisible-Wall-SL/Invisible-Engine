/**
 * Per-game mapping tables.
 *
 * The Play4Fun protocol is universal across operators, but the symbol
 * vocabulary and amount conventions can differ from what an Invisible Engine
 * game expects. These maps live HERE (in the facade) so the mock and any
 * real Play4Fun backend can stay protocol-faithful while we adapt at
 * translation time.
 *
 * Add a new entry to PER_GAME when targeting another Invisible Engine game,
 * and select it via the Vite alias / facade options.
 */

export interface GameMapping {
	/** Map a Play4Fun symbol name to the target game's symbol name. Unmapped
	 *  symbols pass through unchanged so unknown additions surface as warnings
	 *  rather than silent omissions. */
	symbols: Record<string, string>;
	/** What the engine calls "wild" / "scatter". Some games key special properties
	 *  by exact symbol name; this lets the adapter know where to slot them. */
	scatter?: string;
	wild?: string;
}

/** Default mapping suitable for apps/lines / apps/hotfruits (and most
 *  lines-style slots that follow the engine's H1-H4 / L1-L5 / S / W naming).
 *
 *  Aligned by **paytable rank** — PIC1 is Play4Fun's TOP payer, so it maps to
 *  H1 (the engine's top payer); descending from there. Verified against a captured
 *  Hot Fruits spinWin (PIC4 × 3, pay 40, betPerLine 2 → matches paytable
 *  PIC4 = 20 × 2 = 40), per scripts/mock + Riassunto_Stato_Lavoro.pdf.
 *
 *    Play4Fun (Hot Fruits) → engine lines
 *    PIC1 (top pay,    5-of-a-kind = 5000) → H1
 *    PIC2                                   → H2
 *    PIC3                                   → H3
 *    PIC4                                   → H4
 *    PIC5                                   → L1
 *    PIC6                                   → L2
 *    PIC7 (lowest, also pays 2-of-a-kind=5) → L5
 *    SCAT                                   → S
 *
 *  PIC8/PIC9/PIC10 are NOT Play4Fun names — see below. */
export const linesMapping: GameMapping = {
	symbols: {
		PIC1: 'H1',
		PIC2: 'H2',
		PIC3: 'H3',
		PIC4: 'H4',
		PIC5: 'L1',
		PIC6: 'L2',
		PIC7: 'L5',
		// PIC8/PIC9/PIC10 → H5/L3/L4. These three complete the engine's line dictionary, which the
		// captured Hot Fruits vocabulary cannot: Play4Fun has seven line symbols to the engine's ten,
		// so `H5`, `L3` and `L4` had no server name at all. That was harmless while it only meant "two
		// L slots stay unused", and stopped being harmless once a project could AUTHOR its own symbol
		// set: the launcher's in-play pool (`projectLineSymbols`) filters this table down and can never
		// add, so a config that put `H5` or `L3` on its strips was silently never dealt them. The live
		// `test6` authored nine line symbols and was dealt six.
		//
		// They are OURS, not a capture — the Invisible Test Server's mock is the only thing that emits
		// them (`EXTENDED_LINE_SYMBOLS` in `scripts/mock-rgs-server.mjs`, reachable only through an
		// explicit project pool). A real Play4Fun server never sends them, so these entries are inert
		// on the live path and PIC1-PIC7 keep their verified meaning: Hot Fruits and Book of Borut
		// translate exactly as before. The rank ordering above therefore stops at PIC7 by design —
		// appending rather than renumbering is what keeps the captured half untouched.
		PIC8: 'H5',
		PIC9: 'L3',
		PIC10: 'L4',
		// WILD → W: only the stacked-picture test deal (mock `STACKED=1`) emits WILD, so the engine's
		// stacked-picture mode has a full-height Wild to render. Harmless otherwise (never dealt).
		WILD: 'W',
		// MULT → M: the multiplier-collect fixture (a scatter game whose project declares a
		// multiplier symbol) deals `MULT:<value>` cells during a cascade. `M` is the name the
		// reference scatter game and the committed `scatter.json` template both use, so a project
		// seeded from that template already has art for it. Never dealt for any other game.
		MULT: 'M',
		SCAT: 'S',
	},
	scatter: 'S',
};

/** Book-of-… mapping (Book of Borut / Book of Thermopylae). Verified against
 *  the live Book of Thermopylae `config` event:
 *
 *    Play4Fun → engine lines
 *    PIC1 (top, 2-of-a-kind = 5000) → H1
 *    PIC2                            → H2
 *    PIC3                            → H3
 *    PIC4                            → H4
 *    ACE   (royals, 3-of-a-kind)    → L1
 *    KING                           → L2
 *    QUEEN                          → L3
 *    JACK                           → L4
 *    TEN                            → L5
 *    SCAT  (the Book)               → S
 *
 *  SCAT is BOTH scatter and wild (`wildSymbols:['SCAT']`) — the defining Book
 *  trait — so it is registered as both scatter and wild here. */
export const bookMapping: GameMapping = {
	symbols: {
		PIC1: 'H1',
		PIC2: 'H2',
		PIC3: 'H3',
		PIC4: 'H4',
		ACE: 'L1',
		KING: 'L2',
		QUEEN: 'L3',
		JACK: 'L4',
		TEN: 'L5',
		SCAT: 'S',
	},
	scatter: 'S',
	wild: 'S',
};

/** Identity mapping — symbols pass through unchanged. Useful for testing or
 *  when targeting a game that natively understands Play4Fun's vocabulary. */
export const identityMapping: GameMapping = { symbols: {}, scatter: 'SCAT' };

/** Registry of named mappings + a resolver. The active mapping is selected by
 *  the consuming game via `PUBLIC_RGS_GAME` (Vite env) — e.g. `book` for a
 *  Book-of game. Defaults to `lines` so existing games (Hot Fruits) are
 *  unaffected. Add new games here as they are onboarded. */
export const MAPPINGS: Record<string, GameMapping> = {
	lines: linesMapping,
	book: bookMapping,
	identity: identityMapping,
};

/** Resolve the active game mapping from env, defaulting to `lines`. Reads
 *  `import.meta.env.PUBLIC_RGS_GAME` (browser/Vite) and `process.env` (Node),
 *  guarded so neither absence throws. */
export const resolveActiveMapping = (): GameMapping => {
	let key: string | undefined;
	try {
		key = (import.meta as { env?: Record<string, string | undefined> }).env?.PUBLIC_RGS_GAME;
	} catch {
		/* import.meta unavailable */
	}
	if (!key) {
		try {
			key = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env
				?.PUBLIC_RGS_GAME;
		} catch {
			/* process unavailable */
		}
	}
	return (key && MAPPINGS[key]) || linesMapping;
};

/** Resolve a symbol name through the mapping. Unmapped names pass through. */
export const mapSymbol = (mapping: GameMapping, name: string): string =>
	mapping.symbols[name] ?? name;

// ---------- amount conversion ----------

/** The engine's API_AMOUNT_MULTIPLIER (constants-shared/bet.ts). Any amount the
 *  engine sends or receives is in millionths-of-a-dollar (1,000,000 = $1.00).
 *  We don't import constants-shared to keep this package free of internal
 *  engine deps; if that constant ever changes, override via env. */
export const ENGINE_AMOUNT_MULTIPLIER = 1_000_000;

/** Play4Fun uses integer cents (100 = $1.00). Conversion factor between the
 *  two: ENGINE_AMOUNT_MULTIPLIER / PLAY4FUN_AMOUNT_MULTIPLIER = 10,000. */
export const PLAY4FUN_AMOUNT_MULTIPLIER = 100;

export const AMOUNT_SCALE = ENGINE_AMOUNT_MULTIPLIER / PLAY4FUN_AMOUNT_MULTIPLIER; // 10_000

/** Convert an engine API amount (millions) to Play4Fun cents. Used when sending
 *  bet contexts to a Play4Fun backend. Rounds to integer cents. */
export const engineToPlay4Fun = (engineAmount: number): number =>
	Math.round(engineAmount / AMOUNT_SCALE);

/** Convert a Play4Fun cents amount to engine API millions. Used when adapting
 *  responses (balance, win, etc.) for engine consumption. */
export const play4FunToEngine = (play4FunAmount: number): number =>
	Math.round(play4FunAmount * AMOUNT_SCALE);
