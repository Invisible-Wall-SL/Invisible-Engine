/**
 * Skeleton LOAD scales the deploy pipeline bakes into a spine's deploy-index `scale`. The
 * running game applies it on load via `parser.scale` (pixi-svelte `assetLoad.ts`), which
 * scales the skeleton GEOMETRY — but NOT `skeleton.data.width/height` (the Spine readers
 * copy those through un-scaled). So the load scale is NOT normalised away by a width-fit:
 * a width-fitted spine renders at `scale × width`, and a natural-sized one at `scale ×
 * naturalSize`. The editor preview (`editorSpine.client.ts`) applies the matching scale so
 * it's WYSIWYG with the game.
 *
 * Two scales, because two spine classes have genuinely different needs:
 */

/**
 * COMPONENT / placed editor-art spines (a spin button, a free-spin frame, …). **1** = render
 * at authored, atlas-true size; display size is governed only by the node `width`/`height`
 * and placement `scale`. Was `2` until 2026-06-29 — a copied "symbols convention" that, for
 * a natural-sized spine (no width/height, e.g. a button whose atlas region == skeleton
 * width), was a pure 2× over-scale with nothing to cancel it.
 */
export const EDITOR_SPINE_LOAD_SCALE = 1;

/**
 * SYMBOL spines (the reel character rigs). Kept at **2** because the runtime sizes a symbol
 * spine by `SYMBOL_SIZE × SYMBOL_SPINE_FILL` (a WIDTH fit, `SYMBOL_SPINE_FILL = 0.5` in the
 * game's `constants.ts`) — and since the load scale multiplies that (`2 × 0.5 = 1` cell),
 * the two are a tuned PAIR. Dropping this to 1 without also raising `SYMBOL_SPINE_FILL` to 1
 * halves every symbol. A future cleanup could make it `1` + `SYMBOL_SPINE_FILL = 1`, but
 * that's a coordinated engine-runtime + per-game-republish change, so it stays 2 here.
 */
export const SYMBOL_SPINE_LOAD_SCALE = 2;
