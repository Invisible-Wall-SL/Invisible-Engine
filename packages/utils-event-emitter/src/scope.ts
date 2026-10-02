/**
 * Scoped signals (`docs/design/hold-and-win.md` §8, Phase 12a). An event may name WHICH instance of
 * a repeated feature part it concerns, as a `scope` field: a kind and a key — `meter:red`,
 * `tier:grand`, `reel:2`, the `<kind>:<id>` shape a pot's flight anchor already has — or several
 * when one beat concerns many (a consume that drains two pots).
 *
 * A listener is scoped the same way (a component placed on the red pot listens as `meter:red`) and
 * filters only the fires of ITS kind: the red pot ignores the blue pot's fill, yet still hears a
 * GRAND jackpot win, which concerns no pot. A key without a kind (`red`, a Flow cue's scope pin as
 * typed, an effect's authored filter) matches by key alone. A listener without a scope, or `*`,
 * hears everything, and an event without one reaches every listener — which is how every event
 * behaved before scopes existed.
 *
 * One rule, read by the component signal bus (`engine-layout`) and the effect layers (`pixi-svelte`).
 */

/** What a scoped event names: one scope, or several. */
export type EventScope = string | readonly string[];

/** The listener scope that hears every part. */
export const ANY_SCOPE = '*';

/**
 * The key a value scopes by, lower-cased (the operator platform names its tiers `Grand`, a tile's
 * source says `grand`). A number (a reel index) is its decimal string; a value-source key
 * `<feed>.<id>[.<field>]` scopes by its id, so a jackpot tile bound to `jackpot.grand` hears the
 * `grand` tier and a pot reading `meter.red.level` the `red` meter. Blank or anything else ⇒ none.
 */
export const scopeKey = (value: unknown): string | undefined => {
	if (typeof value === 'number') return Number.isFinite(value) ? String(value) : undefined;
	if (typeof value !== 'string') return undefined;
	const [feed, id] = value.trim().toLowerCase().split('.');
	return id || feed || undefined;
};

/** A scope of one kind — `scopeOf('meter', 'Red')` is `meter:red`; no kind ⇒ the bare key. */
export const scopeOf = (kind: string | undefined, value: unknown): string | undefined => {
	const key = scopeKey(value);
	const k = kind?.trim().toLowerCase();
	return key && k ? `${k}:${key}` : key;
};

/** One scope as carried, normalised: `Meter:Red` ⇒ `meter:red`, `tier:jackpot.grand` ⇒ `tier:grand`. */
const normalize = (raw: unknown): string | undefined => {
	if (typeof raw !== 'string') return scopeKey(raw);
	const colon = raw.indexOf(':');
	return colon > 0 ? scopeOf(raw.slice(0, colon), raw.slice(colon + 1)) : scopeKey(raw);
};

const split = (scope: string): { kind?: string; key: string } => {
	const colon = scope.indexOf(':');
	return colon > 0 ? { kind: scope.slice(0, colon), key: scope.slice(colon + 1) } : { key: scope };
};

/** The scope an event carries in its `scope` field, normalised, or `undefined` when none. */
export const eventScope = (event: object): EventScope | undefined => {
	const raw = (event as { scope?: unknown }).scope;
	if (Array.isArray(raw)) {
		const scopes = raw.map(normalize).filter((scope): scope is string => scope !== undefined);
		return scopes.length ? scopes : undefined;
	}
	return normalize(raw);
};

/** Does a listener scoped to `listener` hear an event scoped to `scope`? */
export const scopeMatches = (
	listener: string | undefined,
	scope: EventScope | undefined,
): boolean => {
	const own = normalize(listener);
	if (own === undefined || own === ANY_SCOPE || scope === undefined) return true;
	const mine = split(own);
	const fired = (typeof scope === 'string' ? [scope] : scope)
		.map(normalize)
		.filter((s): s is string => s !== undefined)
		.map(split)
		.filter((s) => !s.kind || !mine.kind || s.kind === mine.kind);
	return fired.length === 0 || fired.some((s) => s.key === mine.key);
};
