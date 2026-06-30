/**
 * The skeleton LOAD scale baked into every spine's deploy-index `scale` — the SINGLE source
 * of truth for both the export pipeline (`exportSpineBundle`) and the editor preview
 * (`editorSpine.client.ts` sets `reader.scale`). The running game applies the index value on
 * load via `parser.scale` (pixi-svelte `assetLoad.ts`), which scales the skeleton GEOMETRY
 * (but NOT `skeleton.data.width/height` — the Spine readers copy those through un-scaled).
 *
 * **1** = render spines at their authored, atlas-true size. Display size is then governed
 * ONLY by explicit, visible inputs — a node's `width`/`height` + placement `scale`, and, for
 * reel symbols, the `SYMBOL_SPINE_FILL` contain ratio in the game runtime's `constants.ts`.
 *
 * History: this was `2` (a "symbols convention"). Because the load scale is NOT normalised
 * away by a width-fit (`data.width` doesn't carry it), a width-fitted spine rendered at
 * `scale × width` — so symbols were sized as the PAIR `2 × SYMBOL_SPINE_FILL(0.5) = full
 * cell`, while every natural-sized spine (a placed button) was silently doubled. Collapsed
 * to a single honest `1` on 2026-06-29; `SYMBOL_SPINE_FILL` was raised `0.5 → 1` in the same
 * change so symbols keep their size with no hidden multiplier.
 *
 * MIGRATION: symbol size = `index.scale × SYMBOL_SPINE_FILL`, and a game bakes `index.scale`
 * at publish. So a game with spine symbols must REPUBLISH (to rewrite its index to `1`) AND
 * run an engine build carrying `SYMBOL_SPINE_FILL = 1` for the two to stay paired. Online
 * games share `_runtime/lines` (republish the runtime bundle); a submodule game (Book of
 * Borut) keeps its OLD pair until its engine submodule is bumped AND its symbols republished
 * TOGETHER — do not bump it half-way.
 */
export const SPINE_LOAD_SCALE = 1;
