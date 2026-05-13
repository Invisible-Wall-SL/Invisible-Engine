/**
 * Per-game mapping tables.
 *
 * The Play4Fun protocol is universal across operators, but the symbol
 * vocabulary and amount conventions can differ from what a Stake Engine
 * game expects. These maps live HERE (in the facade) so the mock and any
 * real Play4Fun backend can stay protocol-faithful while we adapt at
 * translation time.
 *
 * Add a new entry to PER_GAME when targeting another Stake Engine game,
 * and select it via the Vite alias / facade options.
 */

export interface GameMapping {
	/** Map a Play4Fun symbol name to the target game's symbol name. Unmapped
	 *  symbols pass through unchanged so unknown additions surface as warnings
	 *  rather than silent omissions. */
	symbols: Record<string, string>;
	/** What Stake calls "wild" / "scatter". Some games key special properties
	 *  by exact symbol name; this lets the adapter know where to slot them. */
	scatter?: string;
	wild?: string;
}

/** Default mapping suitable for apps/lines / apps/hotfruits (and most
 *  lines-style slots that follow Stake's H1-H4 / L1-L5 / S / W naming).
 *
 *  Aligned by **paytable rank** — PIC1 is Play4Fun's TOP payer, so it maps to
 *  H1 (Stake's top payer); descending from there. Verified against a captured
 *  Hot Fruits spinWin (PIC4 × 3, pay 40, betPerLine 2 → matches paytable
 *  PIC4 = 20 × 2 = 40), per scripts/mock + Riassunto_Stato_Lavoro.pdf.
 *
 *    Play4Fun (Hot Fruits) → Stake lines
 *    PIC1 (top pay,    5-of-a-kind = 5000) → H1
 *    PIC2                                   → H2
 *    PIC3                                   → H3
 *    PIC4                                   → H4
 *    PIC5                                   → L1
 *    PIC6                                   → L2
 *    PIC7 (lowest, also pays 2-of-a-kind=5) → L5
 *    SCAT                                   → S
 *
 *  L3 and L4 are intentionally left unmapped — Stake `lines` has 9 line symbols
 *  vs Hot Fruits' 7, so two L slots stay unused until apps/hotfruits trims its
 *  static config in Fase 1. */
export const linesMapping: GameMapping = {
	symbols: {
		PIC1: 'H1', PIC2: 'H2', PIC3: 'H3', PIC4: 'H4',
		PIC5: 'L1', PIC6: 'L2', PIC7: 'L5',
		SCAT: 'S',
	},
	scatter: 'S',
};

/** Identity mapping — symbols pass through unchanged. Useful for testing or
 *  when targeting a game that natively understands Play4Fun's vocabulary. */
export const identityMapping: GameMapping = { symbols: {}, scatter: 'SCAT' };

/** Resolve a symbol name through the mapping. Unmapped names pass through. */
export const mapSymbol = (mapping: GameMapping, name: string): string =>
	mapping.symbols[name] ?? name;

// ---------- amount conversion ----------

/** Stake's API_AMOUNT_MULTIPLIER (constants-shared/bet.ts). Any amount the
 *  engine sends or receives is in millionths-of-a-dollar (1,000,000 = $1.00).
 *  We don't import constants-shared to keep this package free of internal
 *  engine deps; if Stake ever changes the constant, override via env. */
export const STAKE_AMOUNT_MULTIPLIER = 1_000_000;

/** Play4Fun uses integer cents (100 = $1.00). Conversion factor between the
 *  two: STAKE_AMOUNT_MULTIPLIER / PLAY4FUN_AMOUNT_MULTIPLIER = 10,000. */
export const PLAY4FUN_AMOUNT_MULTIPLIER = 100;

export const AMOUNT_SCALE = STAKE_AMOUNT_MULTIPLIER / PLAY4FUN_AMOUNT_MULTIPLIER; // 10_000

/** Convert a Stake API amount (millions) to Play4Fun cents. Used when sending
 *  bet contexts to a Play4Fun backend. Rounds to integer cents. */
export const stakeToPlay4Fun = (stakeAmount: number): number =>
	Math.round(stakeAmount / AMOUNT_SCALE);

/** Convert a Play4Fun cents amount to Stake API millions. Used when adapting
 *  responses (balance, win, etc.) for engine consumption. */
export const play4FunToStake = (play4FunAmount: number): number =>
	Math.round(play4FunAmount * AMOUNT_SCALE);
