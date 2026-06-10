/**
 * Engine text-localization registry — the render-time hook that lets EVERY text
 * field in a layout doc be a localization KEY (the aspiration documented on
 * {@link TextNode.text}: "may be a localization key — engine layer resolves
 * before render"). Sibling to `registerComponentValues`: the game registers ONE
 * resolver at boot (backed by its Lingui catalog + the baked Localization-tool
 * strings), and `LayoutNodeView` runs every text node's final string through it.
 *
 * Contract: the resolver returns the localized string when `key` is a known
 * catalog key, and `undefined` when it isn't — the engine then renders the
 * literal text unchanged. No resolver registered ⇒ identity (parity: every
 * existing doc renders byte-identical).
 *
 * Module-scoped + Svelte-free (each game bundles its own copy of this package),
 * so it lives on the bare `engine-layout` entry.
 */

export type TextResolver = (key: string) => string | undefined;

let resolver: TextResolver | undefined;

export function registerTextResolver(fn: TextResolver): void {
	resolver = fn;
}

/** The localized string for `text` when the registered resolver knows it as a
 * key; the literal `text` otherwise (or when no resolver is registered). */
export function resolveLocalizedText(text: string): string {
	if (!resolver) return text;
	return resolver(text) ?? text;
}

export function clearTextResolver(): void {
	resolver = undefined;
}
