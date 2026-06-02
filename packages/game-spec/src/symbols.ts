import { z } from 'zod';

import { SymbolKindSchema } from './schema';

type SymbolKind = z.infer<typeof SymbolKindSchema>;

/**
 * Symbol naming convention — the NAME encodes the pay-class (see
 * `docs/conventions/symbol-naming.md`). A symbol's `id` prefix fixes, or
 * constrains, the `kind` it is allowed to carry, so engine and editor agree on
 * what `H1` / `S` mean without a side mapping.
 *
 * Note `S` is intentionally *not* 1:1 — the special symbol is a plain `scatter`
 * or a Book-style `wildScatter` (the Book is both wild and scatter). So the
 * convention is checked for *compatibility*, not equality. Prefixes with no
 * convention yet (`multiplier`, `bonus`, custom) are unconstrained.
 */
const PREFIX_KINDS: { prefix: RegExp; kinds: SymbolKind[] }[] = [
	{ prefix: /^H\d+$/, kinds: ['high'] },
	{ prefix: /^L\d+$/, kinds: ['low'] },
	{ prefix: /^W$/, kinds: ['wild'] },
	{ prefix: /^S$/, kinds: ['scatter', 'wildScatter'] },
];

/**
 * The kind(s) a symbol `id` is allowed to carry by convention, or `null` if its
 * prefix has no convention yet (multiplier/bonus/custom — anything goes).
 */
export function allowedKindsForId(id: string): SymbolKind[] | null {
	return PREFIX_KINDS.find((entry) => entry.prefix.test(id))?.kinds ?? null;
}

/**
 * The canonical kind a symbol `id` implies when unambiguous (`H`→high,
 * `L`→low, `W`→wild). Ambiguous (`S`) or unconventional prefixes return
 * `undefined` — use {@link isKindConsistentWithId} to validate those.
 */
export function classifySymbol(id: string): SymbolKind | undefined {
	const kinds = allowedKindsForId(id);
	return kinds && kinds.length === 1 ? kinds[0] : undefined;
}

/**
 * Whether a symbol's declared `kind` is compatible with its `id` by convention.
 * Ids with no convention (multiplier/bonus/custom) are always allowed. This is
 * the check the editor / spec validation uses to keep the name authoritative
 * (e.g. reject `{ id: 'H1', kind: 'low' }`) without breaking a legitimate
 * `{ id: 'S', kind: 'wildScatter' }`.
 */
export function isKindConsistentWithId(id: string, kind: SymbolKind): boolean {
	const kinds = allowedKindsForId(id);
	return kinds === null || kinds.includes(kind);
}
