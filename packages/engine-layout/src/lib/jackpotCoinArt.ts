/**
 * PER-TIER JACKPOT COIN ART — a Hold and Win coin carrying a jackpot tier can draw art of its own
 * tier instead of the coin's (Invisible Symbols State Machine → "Jackpot coins have their own art").
 *
 * The tier's art is not a new kind of binding: it is one more ROW of the symbols doc's own map, keyed
 * `<coin>:<TIER>` (`COIN:MINI`) — the same text the Hold and Win wire writes for a jackpot cell. So
 * the tool edits it with the grid every symbol uses, and it ships through the same export → deploy →
 * bake → pull → register chain as every symbol cell (rule 8) with no channel of its own. A symbol
 * name never holds a `:` (the wire splits a cell's text on it), so a tier row cannot collide with a
 * real symbol.
 *
 * The switch (`jackpotCoinArt.enabled`) is sparse and default OFF: off, the export drops every tier
 * row ({@link withoutJackpotArtRows}) and the game resolves every coin to its own art, so an
 * untouched project — or one that turned the switch back off — ships and draws exactly as before.
 */

export const JACKPOT_ART_SEPARATOR = ':';

/** The symbols-map key of `coin`'s art for jackpot `tier`. */
export const jackpotArtKey = (coin: string, tier: string): string =>
	`${coin}${JACKPOT_ART_SEPARATOR}${tier}`;

/** The coin and tier a tier row's key names, or undefined for an ordinary symbol. */
export const jackpotArtKeyParts = (key: string): { coin: string; tier: string } | undefined => {
	const at = key.indexOf(JACKPOT_ART_SEPARATOR);
	if (at <= 0 || at === key.length - 1) return undefined;
	return { coin: key.slice(0, at), tier: key.slice(at + 1) };
};

export const isJackpotArtKey = (key: string): boolean => jackpotArtKeyParts(key) !== undefined;

/** `symbols` without its tier rows — the SAME object when it has none, so the common path is free. */
export function withoutJackpotArtRows<T>(symbols: Record<string, T>): Record<string, T> {
	const keys = Object.keys(symbols);
	if (!keys.some(isJackpotArtKey)) return symbols;
	const out: Record<string, T> = {};
	for (const key of keys) if (!isJackpotArtKey(key)) out[key] = symbols[key];
	return out;
}
