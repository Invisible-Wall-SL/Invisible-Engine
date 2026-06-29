/**
 * The skeleton LOAD scale the deploy pipeline bakes into every editor-rendered spine.
 *
 * `exportSpineBundle` writes this as each spine's `scale` in the deploy index, and the
 * running game applies it on load via `parser.scale` (pixi-svelte `assetLoad.ts`), which
 * scales the skeleton GEOMETRY (and `skeleton.data.width/height`) by this factor. The
 * editor's own spine loader (`editorSpine.client.ts`) MUST apply the identical scale, or a
 * natural-sized spine (one with no authored width/height, e.g. a placed button) renders at
 * 1/N the in-game size in the editor preview. Width-fitted and cover/placement spines
 * normalise the load scale away (the fit divides by the scaled natural size), so this only
 * shifts natural-sized previews — but for those it's the difference between WYSIWYG and a
 * 2× mismatch. Single source of truth for both the export and the editor preview.
 */
export const EDITOR_SPINE_LOAD_SCALE = 2;
