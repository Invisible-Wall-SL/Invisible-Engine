/**
 * The skeleton LOAD scale for every editor-rendered spine — the SINGLE source of truth for
 * both the deploy pipeline (`exportSpineBundle` writes it as each spine's `scale` in the
 * deploy index) and the editor preview (`editorSpine.client.ts` sets `reader.scale`). The
 * running game applies the index value on load via `parser.scale` (pixi-svelte
 * `assetLoad.ts`), which scales the skeleton GEOMETRY (and `skeleton.data.width/height`).
 *
 * Keep this at **1** = render spines at their authored, atlas-true size. A spine's display
 * size is then governed ONLY by explicit, visible inputs: its node `width`/`height` + the
 * placement's `scale` (and, for symbols, the deliberate `SYMBOL_SPINE_FILL` contain ratio).
 *
 * History: this defaulted to `2` (a copied "symbols convention"). But symbol spines are
 * width-FITTED, so any load scale normalises away for them — the 2× did nothing there and
 * silently DOUBLED every natural-sized spine (e.g. a placed button: atlas region 223px ==
 * skeleton width 223px, so 2× was a pure, slightly-blurry over-scale). Set to 1 2026-06-29.
 * NOTE: a game published BEFORE this change keeps the old `scale` baked into ITS deploy
 * index until it is republished, so it still loads at the old factor until then.
 */
export const EDITOR_SPINE_LOAD_SCALE = 1;
