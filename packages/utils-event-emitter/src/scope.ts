/**
 * Scoped signals (`docs/design/hold-and-win.md` §8, Phase 12a). An event may name WHICH instance of
 * a repeated feature part it concerns: the pot (`red`), the jackpot tier (`grand`), the letter's reel
 * (`2`). It carries that as a `scope` field — one key, or several when one beat concerns many (a
 * consume that drains two pots). A listener that has a scope of its own (a component instance placed
 * on the red pot, an effect inside it) hears only the events for its scope; one without a scope hears
 * them all, and an event without a scope reaches every listener — which is how every event behaved
 * before scopes existed.
 *
 * One rule, read by the component signal bus (`engine-layout`) and the effect layers (`pixi-svelte`).
 */

/** What a scoped event names: one key, or several. */
export type EventScope = string | readonly string[];

/**
 * The key a value scopes by, lower-cased (the operator platform names its tiers `Grand`, a tile's
 * source says `grand`). A number (a reel index) is its decimal string; a dotted value-source key
 * scopes by its last part, so a jackpot tile bound to `jackpot.grand` (or `platformJackpot.grand`)
 * hears the `grand` tier's events. Blank or anything else ⇒ no scope.
 */
export const scopeKey = (value: unknown): string | undefined => {
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
	if (typeof value !== 'string') return undefined;
	const trimmed = value.trim().toLowerCase();
	if (!trimmed) return undefined;
	const dot = trimmed.lastIndexOf('.');
	return dot >= 0 && dot < trimmed.length - 1 ? trimmed.slice(dot + 1) : trimmed;
};

/** The scope an event carries in its `scope` field, or `undefined` when it carries none. */
export const eventScope = (event: object): EventScope | undefined => {
	const raw = (event as { scope?: unknown }).scope;
	if (Array.isArray(raw)) {
		const keys = raw.map(scopeKey).filter((key): key is string => key !== undefined);
		return keys.length ? keys : undefined;
	}
	return scopeKey(raw);
};

/** Does a listener scoped to `listener` hear an event scoped to `scope`? */
export const scopeMatches = (
	listener: string | undefined,
	scope: EventScope | undefined,
): boolean => {
	if (listener === undefined || scope === undefined) return true;
	return typeof scope === 'string' ? scope === listener : scope.includes(listener);
};
