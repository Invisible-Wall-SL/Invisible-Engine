/**
 * Inline-image resolver registry — the render-time hook that turns an inline-image TOKEN (carried
 * in a message string by {@link wrapInlineImage}) into a loaded texture KEY the renderer can draw
 * as a `<Sprite>`.
 *
 * Sibling of {@link registerTextResolver}: the game registers ONE resolver at boot (mapping a
 * symbol id → that symbol's static sprite `assetKey`), and {@link InlineImageText} calls it for
 * each image segment. The resolver returns the texture key when it knows the token, `undefined`
 * otherwise — the renderer then shows the sentinel's plain-text `fallback` instead. No resolver
 * registered ⇒ every token falls back to text (parity: a game that never wired symbols renders the
 * name, exactly as before this feature).
 *
 * Module-scoped + Svelte-free (each game bundles its own copy of this package), so it lives on the
 * bare `engine-layout` entry.
 */

export type InlineImageResolver = (token: string) => string | undefined;

let resolver: InlineImageResolver | undefined;

export function registerInlineImageResolver(fn: InlineImageResolver): void {
	resolver = fn;
}

/** The texture key for `token` when the registered resolver knows it; `undefined` otherwise (or
 *  when no resolver is registered) ⇒ the caller renders the fallback text. */
export function resolveInlineImage(token: string): string | undefined {
	return resolver?.(token);
}

export function clearInlineImageResolver(): void {
	resolver = undefined;
}
