/**
 * Skeleton LOAD scales the deploy pipeline bakes into a rig's deploy-index `scale`. The
 * running game applies it on load via `parser.scale` (pixi-svelte `assetLoad.ts`), which
 * scales the skeleton GEOMETRY — but NOT `skeleton.data.width/height` (the rig readers
 * copy those through un-scaled). So the load scale is NOT normalised away by a width-fit:
 * a width-fitted rig renders at `scale × width`, and a natural-sized one at `scale ×
 * naturalSize`. The editor preview (`editorRig.client.ts`) applies the matching scale so
 * it's WYSIWYG with the game, and a runtime component that must match the editor's NATURAL
 * size passes {@link EDITOR_RIG_LOAD_SCALE} to `<RigProvider loadScaleBase>` — which
 * divides out whatever scale that bundle actually loaded with.
 *
 * They live here, in the package BOTH surfaces already depend on, because the editor preview
 * and the game runtime have to agree on the number or "natural size" means two different
 * things (the win-overlay WYSIWYG bug). `apps/launcher-api/src/lib/rigScale.ts` re-exports
 * them for its server exporters.
 *
 * Two scales, because two rig classes have genuinely different needs:
 */

/**
 * COMPONENT / placed editor-art rigs (a spin button, a free-spin frame, the big-win rig…).
 * **1** = render at authored, atlas-true size; display size is governed only by the node
 * `width`/`height` and placement `scale`. Was `2` until 2026-06-29 — a copied "symbols
 * convention" that, for a natural-sized rig (no width/height, e.g. a button whose atlas
 * region == skeleton width), was a pure 2× over-scale with nothing to cancel it.
 */
export const EDITOR_RIG_LOAD_SCALE = 1;

/**
 * SYMBOL rigs (the reel character rigs). Kept at **2** because the runtime sizes a symbol
 * rig by `SYMBOL_SIZE × SYMBOL_RIG_FILL` (a WIDTH fit, `SYMBOL_RIG_FILL = 0.5` in the
 * game's `constants.ts`) — and since the load scale multiplies that (`2 × 0.5 = 1` cell),
 * the two are a tuned PAIR. Dropping this to 1 without also raising `SYMBOL_RIG_FILL` to 1
 * halves every symbol. A future cleanup could make it `1` + `SYMBOL_RIG_FILL = 1`, but
 * that's a coordinated engine-runtime + per-game-republish change, so it stays 2 here.
 */
export const SYMBOL_RIG_LOAD_SCALE = 2;
