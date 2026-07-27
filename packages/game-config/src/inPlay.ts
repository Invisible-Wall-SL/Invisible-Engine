/**
 * THE GATE. `config.symbols` is a DICTIONARY — art, properties, payouts — and it legitimately
 * describes symbols a given game never deals. `config.paddingReels` is the IN-PLAY SET: what can
 * actually reach the board. Every consumer asking "does this game have symbol X?" asks here.
 *
 * This is not a style preference, it is the fix for a shipped bug. `W` sat in the upstream sample
 * dictionary while no RGS the engine talks to ever emitted one, so it flashed past during the roll,
 * advertised an unwinnable payout in the paytable, and occupied a row in `/symbols` — three
 * surfaces, one cause. `959b85a` / `9b00e87` applied the gate to `paytable.ts` and
 * `publish-symbol-defaults.mjs`; this is the same rule with ONE implementation behind it.
 *
 * If a later phase introduces a first-class `symbolsInPlay` field on the doc, it replaces the
 * strips as the source HERE, in this one file, and every consumer follows. Do not add a second
 * answer anywhere else — see `docs/design/invisible-game-config.md`.
 */

import type { GameConfigDoc, PaddingReels } from './types';

/** Just the strips, so callers holding a raw config (the compiled template, a paste-in preview)
 *  can ask the same question as callers holding a normalized doc. */
export const symbolsInPlayFromStrips = (paddingReels: PaddingReels): string[] => {
	const names = new Set<string>();
	for (const strips of Object.values(paddingReels)) {
		for (const strip of strips) {
			for (const cell of strip) names.add(cell.name);
		}
	}
	return [...names].sort();
};

/**
 * Every symbol this game can actually deal, across ALL game types, sorted. The board, the
 * paytable, the symbol picker and the published symbol defaults all derive from this.
 */
export const symbolsInPlay = (doc: GameConfigDoc): string[] =>
	symbolsInPlayFromStrips(doc.paddingReels);

/**
 * The in-play set for ONE game type (`basegame`, `freegame`, …). A symbol dealt only in free spins
 * is in play for the game but absent from the base game, which is what a per-mode paytable or a
 * per-mode strip readout needs. An unknown game type yields an empty list rather than throwing —
 * asking about a mode a config does not declare is a legitimate question with the answer "none".
 */
export const symbolsInPlayForGameType = (doc: GameConfigDoc, gameType: string): string[] => {
	const strips = doc.paddingReels[gameType];
	return strips ? symbolsInPlayFromStrips({ [gameType]: strips }) : [];
};

/** Does this game deal `name` at all? The gate, in predicate form. */
export const isSymbolInPlay = (doc: GameConfigDoc, name: string): boolean =>
	symbolsInPlay(doc).includes(name);

/**
 * How often each symbol appears per game type, per reel — `[gameType][reelIndex][symbol]`.
 *
 * Feeds the tool's strip editor readout. Note what it is NOT: these are the COSMETIC blur strips,
 * so a frequency here says how often a symbol flickers past during the roll, never a hit rate or
 * an RTP contribution. The math team owns the real weighted strips and they never reach the client.
 */
export const symbolFrequencies = (
	doc: GameConfigDoc,
): Record<string, Array<Record<string, number>>> => {
	const out: Record<string, Array<Record<string, number>>> = {};
	for (const [gameType, strips] of Object.entries(doc.paddingReels)) {
		out[gameType] = strips.map((strip) => {
			const counts: Record<string, number> = {};
			for (const cell of strip) counts[cell.name] = (counts[cell.name] ?? 0) + 1;
			return counts;
		});
	}
	return out;
};
