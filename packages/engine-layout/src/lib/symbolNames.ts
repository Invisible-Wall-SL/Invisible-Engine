/**
 * Symbol DISPLAY NAMES — the human word a game says for a symbol id.
 *
 * A board's symbols are ids (`H1`, `L3`, `S`), which is exactly what the player must never read.
 * Before this existed the only thing win text could say about WHICH symbol paid was the match
 * count ("3 of a kind"), because the id was unspeakable. A name closes that gap: `H1` → "Banana",
 * so a win can say "You win $4 with 4 Bananas".
 *
 * Authored in the Invisible Symbols State Machine (`/symbols`, `SymbolsDoc.names`) — the tool that
 * already owns what a symbol IS — and travels the existing symbols export→bake→register chain. It
 * lives HERE, on the bare (Svelte-free) entry, because three sides resolve it and must agree: the
 * game (`flowEffects` → win text), the `/symbols` tool that authors it, and the `/win-text` tool
 * that previews what a template will render.
 *
 * ## Singular + plural, never auto-pluralized
 *
 * "{count} {symbolName}" is read with a count in front of it, so the name has to inflect. English
 * `+s` guessing is wrong often enough to be embarrassing ("Cherrys", "Wildes") and is meaningless
 * in the languages Invisible Localization targets, so BOTH forms are authored. `plural` unset
 * falls back to `singular` — right for the many names that don't inflect ("Wild", "Bonus", "7").
 */

import { resolveLocalizedText } from './registerTextResolver';

/** The two authored forms for one symbol. Both optional: a half-authored entry still resolves
 *  (an unset `plural` falls back to `singular`; an unset `singular` falls back to the id). */
export type SymbolNameEntry = {
	singular?: string;
	plural?: string;
};

/** Symbol id → its authored name. SPARSE — an unnamed symbol simply isn't a key. */
export type SymbolNameMap = Record<string, SymbolNameEntry>;

/**
 * The word to print for `symbol` at `count`, localized.
 *
 * `count` picks the form: exactly 1 (or unknown) ⇒ `singular`, anything else ⇒ `plural` falling
 * back to `singular`. An unnamed symbol resolves to its own ID — visible and obviously
 * placeholder-ish, which is the honest failure for a name the author simply hasn't filled in yet
 * (and it is what the id-only text said before names existed).
 *
 * LOCALIZED here, not by the caller, because the name is a whole word the player reads and
 * `formatWinText` interpolates its vars AFTER localizing the template — so a name substituted in
 * raw would be the one part of the sentence that never translates. Looked up by its source text,
 * the same contract as every other authored string.
 */
export function resolveSymbolName(
	names: SymbolNameMap | undefined,
	symbol: string,
	count?: number,
): string {
	const entry = names?.[symbol];
	const plural = count !== undefined && count !== 1;
	const raw = (plural ? (entry?.plural ?? entry?.singular) : entry?.singular)?.trim();
	if (!raw) return symbol;
	return resolveLocalizedText(raw);
}

/** Whether any symbol carries an authored name — drives "you haven't named these yet" hints in
 *  the tools, which must not nag a project that never opened the names editor. */
export function hasSymbolNames(names: SymbolNameMap | undefined): boolean {
	return !!names && Object.keys(names).length > 0;
}
