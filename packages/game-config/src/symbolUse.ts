import { symbolsInPlay } from './inPlay';
import { resolveMeters } from './potsOverlay';
import type { GameConfigDoc } from './types';

/**
 * What a symbol is FOR on the board — the one answer to "is this symbol unused?". Invisible Game
 * Config badges each dictionary symbol with it and Invisible Symbols lists exactly the symbols it does
 * not call `unused`, so the two tools cannot disagree about a symbol (`check:symbols-follow-config`).
 *
 * - `inPlay` — a reel strip deals it: THE GATE, {@link symbolsInPlay}.
 * - `token` — a pots overlay drops it OVER a cell. It is never on a strip, yet the board draws it, so
 *   it needs art like any dealt symbol. On a strip as well, it is `inPlay` (the validator's error).
 * - `unused` — neither: a dictionary entry that never reaches the board.
 */
export type SymbolUse = 'inPlay' | 'token' | 'unused';

/** A pots overlay's tokens in pot order, each once. */
const overlayTokens = (doc: GameConfigDoc): string[] => [
	...new Set(
		resolveMeters(doc)
			.filter((meter) => meter.source === 'overlay' && meter.symbol)
			.map((meter) => meter.symbol),
	),
];

/**
 * Every symbol the config names, with its use: each dictionary entry, plus any name a strip deals or
 * a pot drops without one (a validator error, but still drawn).
 */
export function symbolUses(doc: GameConfigDoc): Record<string, SymbolUse> {
	const uses: Record<string, SymbolUse> = {};
	for (const name of Object.keys(doc.symbols)) uses[name] = 'unused';
	for (const name of overlayTokens(doc)) uses[name] = 'token';
	for (const name of symbolsInPlay(doc)) uses[name] = 'inPlay';
	return uses;
}

/** Every symbol the board can show: the strips' (sorted), then the overlay's tokens in pot order. */
export function symbolsUsed(doc: GameConfigDoc): string[] {
	const inPlay = symbolsInPlay(doc);
	const dealt = new Set(inPlay);
	return [...inPlay, ...overlayTokens(doc).filter((name) => !dealt.has(name))];
}
