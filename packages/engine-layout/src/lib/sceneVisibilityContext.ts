import { getContext, setContext } from 'svelte';

/**
 * Carries a SCREEN's live gate-visibility (a `LayoutScene`'s `visibleSource`)
 * down to the components rendered inside it, so a `ComponentInstance` can fire its
 * `enter` cue when the SCREEN appears — not just when the instance itself mounts.
 *
 * Why this exists: a `LayoutScene` with a `visibleSource` hides its subtree with a
 * `<Container visible>` (the nodes stay MOUNTED, only undrawn). An instance's own
 * `enter`-firing edge is its OWN visibility, which — for a scene-gated screen — is
 * always `true`, so `enter` fired once at boot (while the screen was hidden) and
 * never on the real appearance. Threading the scene's `liveVisible` through context
 * lets the instance AND its descendants combine it into the edge they fire on.
 *
 * The value is a getter (not a snapshot) so the read stays reactive across the
 * component boundary: `setSceneVisibleContext(() => liveVisible)`. Absent ⇒ treat as
 * visible (an ungated screen / a component mounted outside any scene) — parity.
 */
const SCENE_VISIBLE_KEY = Symbol('engine-layout:sceneVisible');

export function setSceneVisibleContext(getter: () => boolean): void {
	setContext(SCENE_VISIBLE_KEY, getter);
}

export function getSceneVisibleContext(): (() => boolean) | undefined {
	return getContext<(() => boolean) | undefined>(SCENE_VISIBLE_KEY);
}
