import type { Scene } from './types';

/**
 * Generic doc-driven scene mounting (§20.1, retiring the hard-coded-id mount limitation).
 *
 * A game's `Game.svelte` mounts a fixed set of scenes by HARD-CODED id (`basegame`,
 * `hudBar`, `freeSpinIntro`, …) in a fixed order. So an author who adds a brand-new screen
 * in the Scene Editor (a scene with a custom id, e.g. `hud_xxk3a9`) sees it in the editor
 * preview but NOT in the shipped game — nothing mounts it. This selector returns every
 * author scene the game does NOT already handle, so the game can mount them generically as
 * an overlay layer, in doc order, with no FlowDoc required.
 *
 * Selection mirrors `backgroundScenes` (selection by a contract, not by id): return the
 * scenes — in the doc's order — whose `id` is NOT in `reservedIds` (the ids the game already
 * mounts/handles, incl. any FlowDoc-authored screen ids) AND whose `space` is NOT
 * `'background'` (those are already handled by `backgroundScenes`, mounted as a persistent
 * layer behind everything). Each returned scene renders through `<LayoutScene>`, which
 * self-wraps by `scene.space` and honours `scene.visibleSource` — so no scaling/gating code
 * is needed here.
 *
 * PARITY: a game that ships no extra scenes and reserves all its current ids ⇒ this returns
 * `[]` ⇒ the game's `{#each}` renders nothing ⇒ byte-identical to before (the same discipline
 * as `backgroundScenes`/§25). `apps/lines`' fallback layout has exactly this property.
 */
export const extraMountScenes = (
	scenes: Scene[],
	reservedIds: ReadonlySet<string> | Iterable<string>,
): Scene[] => {
	const reserved = reservedIds instanceof Set ? reservedIds : new Set(reservedIds);
	return scenes.filter((scene) => !reserved.has(scene.id) && scene.space !== 'background');
};
