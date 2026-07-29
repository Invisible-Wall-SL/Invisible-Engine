import { getContext, setContext } from 'svelte';

import type { Snippet } from 'svelte';

/**
 * Canvas-frame PORTAL for a `tapToContinue` overlay's full-screen surface (dim +
 * hit area + prompt).
 *
 * Why this exists: an overlay instance's tap surface is conceptually CANVAS-space —
 * it must cover the real window, exactly like the engine-owned free-spin gate (which
 * Game.svelte mounts at the `<App>` root). But an authored overlay lives INSIDE a
 * `LayoutScene`, and a `game`/`standard`-space scene wraps its nodes in a
 * `MainContainer` that re-centres + scales them to the design box. Rendering the
 * "full-canvas" `CanvasSizeRectangle` inside that wrapper shrinks it to a centred
 * band over the logo with undimmed strips at the edges — the "dim doesn't fit the
 * screen / darkens the logo" bug. Hoisting one level out of the INSTANCE transform
 * (the old `bind:tap` sibling in `LayoutNodeView`) was not enough: the sibling still
 * sits inside the scene's `MainContainer`.
 *
 * So `LayoutScene` provides this portal (set at init) and renders every registered
 * surface at its OWN top level — OUTSIDE `MainContainer`, in the true canvas frame.
 * `ComponentInstance` registers here when a portal is present (the common case: any
 * instance under a scene), falling back to the legacy `LayoutNodeView` sibling hoist
 * only when no scene portal is in scope (parity).
 *
 * TWO parts per entry, so the AUTHORED layer order is honoured (a `game`/`standard`-space
 * dim is canvas-space and so can't interleave with the scaled `MainContainer` nodes — it
 * can only sit wholly behind or wholly in front of them):
 *  - `dim` — the visible full-canvas backdrop. `LayoutScene` draws it BEHIND the scene
 *    content when the tap node has any node painted after it (content the author placed
 *    ABOVE the tap in the outline), so a celebration screen shows over the dim. When the
 *    tap node is the topmost node the dim stays in front — byte-identical to before.
 *    Absent when the dim is fully transparent (nothing to draw).
 *  - `tap` — the invisible hit area + prompt. ALWAYS drawn on top so a tap anywhere
 *    dismisses the screen and the prompt stays visible, whatever the dim's placement.
 *
 * Keyed by the instance's `node.id` so an instance replaces (not duplicates) its own
 * entry across re-renders, and unregisters on unmount.
 */
const TAP_PORTAL_KEY = Symbol('engine-layout:tapPortal');

/** A registered tap surface, split into its backdrop `dim` and its interactive `tap`. */
export type TapPortalEntry = {
	/** Full-canvas dim backdrop; absent when fully transparent. Placed by layer order. */
	dim?: Snippet;
	/** Full-canvas hit area + prompt; always drawn on top. */
	tap: Snippet;
};

export type TapPortal = {
	/** Register (or replace) the tap surface for the overlay instance `id`. */
	register: (id: string, entry: TapPortalEntry) => void;
	/** Remove the overlay instance `id`'s tap surface (on unmount / when disabled). */
	unregister: (id: string) => void;
};

export function setTapPortal(portal: TapPortal): void {
	setContext(TAP_PORTAL_KEY, portal);
}

export function getTapPortal(): TapPortal | undefined {
	return getContext<TapPortal | undefined>(TAP_PORTAL_KEY);
}
