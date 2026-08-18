/**
 * Protected-term masking for machine translation.
 *
 * The localization doc carries a list of terms that must survive translation verbatim —
 * brand names and mechanic names ("Free Spins", "Megaways", the game's own title). Asking the
 * prompt to keep them is not enough: a model translating the sentence around a term will
 * localize it anyway. So the terms never reach the model. Each occurrence is swapped for a
 * `{{DNTn}}` token, the model translates the sentence around the tokens, and the ORIGINAL
 * matched text is put back where the model placed them:
 *
 *   "Free Spins over, you won:"  ->  "{{DNT0}} over, you won:"
 *                               ->  "{{DNT0}} terminé, vous avez gagné :"
 *                               ->  "Free Spins terminé, vous avez gagné :"
 *
 * Dependency-free on purpose (no env, no SDK) so the behaviour can be exercised offline.
 */

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * One alternation matching any protected term, longest first so "Free Spins" wins over a
 * separately listed "Free". Case-insensitive (the source may shout "FREE SPINS"), and bounded
 * by non-alphanumerics so "Wild" doesn't fire inside "Wilderness". `null` when nothing is
 * protected — the caller then skips masking entirely.
 */
export function termsPattern(terms: string[]): RegExp | null {
	const cleaned = [...new Set(terms.map((t) => t.trim()).filter(Boolean))].sort(
		(a, b) => b.length - a.length,
	);
	if (cleaned.length === 0) return null;
	const body = cleaned.map(escapeRegExp).join('|');
	return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, 'giu');
}

/**
 * Tolerant of the ways a model re-emits a token it was told to copy: stray spaces inside the
 * braces, or the braces dropped altogether.
 */
const MASK_TOKEN = /\{\{\s*DNT\s*(\d+)\s*\}\}|(?<![\p{L}\p{N}])DNT(\d+)(?![\p{L}\p{N}])/gu;

/**
 * Swap every protected term in `source` for a `{{DNTn}}` token, returning the slot→original
 * table. Identical matches share a slot (a repeated "Free Spins" doesn't burn two), and the
 * ORIGINAL matched text is what comes back — the term is restored with the casing the source
 * used, not the casing the list happened to be typed in.
 */
export function maskTerms(source: string, pattern: RegExp): { text: string; originals: string[] } {
	const originals: string[] = [];
	const slots = new Map<string, number>();
	const text = source.replace(pattern, (match) => {
		let slot = slots.get(match);
		if (slot === undefined) {
			slot = originals.length;
			originals.push(match);
			slots.set(match, slot);
		}
		return `{{DNT${slot}}}`;
	});
	return { text, originals };
}

/** Put the protected terms back. An unknown slot is left as-is rather than blanked. */
export function unmaskTerms(text: string, originals: string[]): string {
	return text.replace(MASK_TOKEN, (token, braced?: string, bare?: string) => {
		const slot = Number(braced ?? bare);
		return originals[slot] ?? token;
	});
}

/**
 * Coerce a protected-term list into trimmed, de-duplicated, non-empty terms. Commas and
 * newlines split a raw string, so the field's own comma-separated text and a stored array
 * normalize the same way. A longer term keeps its own entry — {@link termsPattern} orders by
 * length, so a listed "Free Spins" still wins over a listed "Free".
 */
export function normalizeProtectedTerms(input: unknown): string[] {
	const raw = typeof input === 'string' ? input.split(/[,\n]/) : Array.isArray(input) ? input : [];
	const seen = new Set<string>();
	const out: string[] = [];
	for (const value of raw) {
		if (typeof value !== 'string') continue;
		const term = value.trim();
		if (!term) continue;
		const dedupeKey = term.toLowerCase();
		if (seen.has(dedupeKey)) continue;
		seen.add(dedupeKey);
		out.push(term);
	}
	return out;
}
