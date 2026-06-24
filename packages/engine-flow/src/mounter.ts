/**
 * Invisible Flow — the generic scene mounter (design doc §8, §11.3; retires §20.1).
 *
 * Today `Game.svelte` mounts scenes by HARD-CODED id (the deferred §20.1 limitation); the
 * interpreter mounts WHATEVER screen the active presentation state points at. The actual
 * PixiJS mount is the engine's existing `<LayoutScene>` Svelte component — it ALREADY
 * honours MainContainer scaling (a `game`-space scene self-wraps in `<MainContainer>`, a
 * `standard` scene in `<MainContainer standard>`, a `canvas`/`background` scene mounts raw)
 * AND the `Scene.visibleSource` gate. So the "generic mounter" is NOT a new Pixi mount
 * path: it is the DECISION layer that resolves which LayoutDoc scene the active screen
 * points at, leaving the (Svelte) render to `<LayoutScene>`. This file — pure TS, no
 * Svelte — owns that decision so it is testable headlessly; a thin game-side component
 * renders the resolved scene.
 *
 * The §7 fall-through invariant lives here: `resolve(screenId)` returns `authored` ONLY
 * when the FlowDoc actually carries a screen for that id (so the game mounts it via the
 * interpreter), and `'fallThrough'` otherwise (so the game keeps its coded mounting for
 * that screen — byte-identical to current `main`). One authored screen migrates at a time.
 */

import type { FlowDoc } from './types';

/** A scene as the mounter needs it — the LayoutDoc `Scene` shape (id + space-aware).
 *  Kept structural so engine-flow needn't depend on the full `engine-layout` Scene type
 *  at this boundary; the game passes its real `Scene` objects through unchanged. */
export type MountableScene = {
	id: string;
	space?: string;
	visibleSource?: string;
	[key: string]: unknown;
};

/** What the game must do for a given screen id (the fall-through boundary, §7). */
export type MountDecision =
	/** The FlowDoc owns this screen — mount `scene` via `<LayoutScene>` (interpreter path). */
	| { kind: 'authored'; screenId: string; scene: MountableScene }
	/** The FlowDoc does NOT own this screen — keep the coded mounting (parity, §7). */
	| { kind: 'fallThrough'; screenId: string };

/**
 * The generic scene mounter (design doc §8). Decides, per screen id, whether the
 * interpreter mounts it (the FlowDoc carries it AND a backing LayoutDoc scene exists) or
 * the game falls through to its coded mounting. It does NOT render — the game renders the
 * returned `scene` through `<LayoutScene>`, which owns MainContainer scaling + overlays.
 */
export type SceneMounter = {
	/** Resolve the mount decision for a screen id (the §7 dispatch boundary). */
	resolve: (screenId: string | undefined) => MountDecision | undefined;
	/** Whether a screen id is authored in the FlowDoc AND has a backing LayoutDoc scene. */
	has: (screenId: string) => boolean;
};

/**
 * Build the generic mounter from the FlowDoc + a resolver from screen id → LayoutDoc
 * scene. A screen is interpreter-mounted ONLY when the FlowDoc lists it AND the resolver
 * finds its backing scene; any other id falls through to the coded path (§7). The
 * resolver is injected so engine-flow stays free of the launcher/game LayoutDoc loading.
 */
export const createSceneMounter = (params: {
	flowDoc: FlowDoc | undefined;
	resolveScene: (screenId: string) => MountableScene | undefined;
}): SceneMounter => {
	const { flowDoc, resolveScene } = params;
	const authoredScreenIds = new Set((flowDoc?.screens ?? []).map((s) => s.id));

	const resolve = (screenId: string | undefined): MountDecision | undefined => {
		if (screenId === undefined) return undefined;
		if (authoredScreenIds.has(screenId)) {
			const scene = resolveScene(screenId);
			if (scene) return { kind: 'authored', screenId, scene };
		}
		return { kind: 'fallThrough', screenId };
	};

	const has = (screenId: string): boolean =>
		authoredScreenIds.has(screenId) && resolveScene(screenId) !== undefined;

	return { resolve, has };
};
