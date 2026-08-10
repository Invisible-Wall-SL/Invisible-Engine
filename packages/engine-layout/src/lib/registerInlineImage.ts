/**
 * Inline-image resolver registry — the render-time hook that decides whether an inline-image TOKEN
 * (carried in a message string by {@link wrapInlineImage}) can be drawn as an inline symbol, and
 * with what id.
 *
 * Sibling of {@link registerTextResolver}: the game registers ONE resolver at boot (a symbol id →
 * the id itself when that symbol exists, `undefined` otherwise), and {@link InlineImageText} calls
 * it for each image segment. When it returns an id, the segment is drawn by the game's registered
 * {@link INLINE_IMAGE_BOUND_COMPONENT} — which renders the real symbol (sprite / spine / flipbook)
 * at text size. When it returns `undefined`, the renderer shows the sentinel's plain-text
 * `fallback` (the symbol NAME) instead. No resolver registered ⇒ every token falls back to text
 * (parity: a game that never wired symbols renders the name, exactly as before this feature).
 *
 * The render is DELEGATED to a game component rather than done here because `engine-layout` can't
 * reach the game's `<Symbol>` renderer, and — the reason this whole file changed — the high-paying
 * symbols are SPINE animations, which a plain `<Sprite>` can't draw. A texture-key resolver only
 * ever worked for sprite symbols.
 *
 * Module-scoped + Svelte-free (each game bundles its own copy of this package), so it lives on the
 * bare `engine-layout` entry.
 */

/**
 * The bound-component name (`registerBoundComponents`) {@link InlineImageText} mounts to draw a
 * resolved inline image. The game registers a component under this key that renders a symbol at a
 * target `size`. No component registered under this key ⇒ `InlineImageText` falls back to the
 * sentinel's plain-text fallback, so the message still reads.
 */
export const INLINE_IMAGE_BOUND_COMPONENT = 'messageSymbol';

export type InlineImageResolver = (token: string) => string | undefined;

let resolver: InlineImageResolver | undefined;

export function registerInlineImageResolver(fn: InlineImageResolver): void {
	resolver = fn;
}

/** The render id for `token` when the registered resolver knows it; `undefined` otherwise (or when
 *  no resolver is registered) ⇒ the caller renders the fallback text. */
export function resolveInlineImage(token: string): string | undefined {
	return resolver?.(token);
}

export function clearInlineImageResolver(): void {
	resolver = undefined;
}
