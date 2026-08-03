/**
 * Scene animation duration — a PURE calculator that answers "how long does this screen's animation
 * run, in wall-clock ms?" by walking a {@link Scene}'s nodes and taking the MAX per-node duration.
 *
 * It is the value behind Invisible Flow v2's `showContainer.durationMs` OUTPUT pin (wire it into a
 * Delay's `ms` so a beat holds for exactly the screen's animation instead of a guessed literal).
 *
 * Deliberately RESOLVER-INJECTED and asset-free: the layout doc records only NAMES (a spine
 * `assetKey` + clip name, an `effectId`), never durations. Measuring a spine clip needs the loaded
 * SkeletonData; measuring an effect needs the baked `EffectDoc` (+ the `emitterSecondsToWallMs`
 * time-scale). Those live game-side, so this module takes them as callbacks and stays a pure
 * tree-walk — testable offline, and correct-once-loaded rather than throwing on an un-loaded asset
 * (an unresolved name contributes nothing). A scene with nothing measurable ⇒ `0`.
 */

import type { LayoutNode, Scene } from './types';

/**
 * The per-asset duration lookups the calculator needs. Each returns wall-clock ms, or `undefined`
 * when the asset is not measurable (name doesn't resolve, skeleton not loaded yet, un-baked effect)
 * — an undefined result is simply skipped, never treated as `0`.
 */
export interface SceneDurationResolvers {
	/** A spine clip's wall-clock ms — `SkeletonData.findAnimation(animation)?.duration × 1000`.
	 *  `undefined` when the skeleton isn't loaded or the clip name is unknown. */
	spineClipMs(assetKey: string, animation: string | undefined): number | undefined;
	/** An FX effect's wall-clock ms from its baked `EffectDoc` (converting emitter-seconds through the
	 *  runtime time-scale). `undefined` when the effect id doesn't resolve or has no finite duration. */
	effectMs(effectId: string): number | undefined;
	/** A flipbook clip's wall-clock ms (`frames / fps`). A forward-compat SEAM: no `LayoutNode` kind
	 *  carries a `clipId` today, so the walk never calls it — wired for when a flipbook node lands. */
	flipbookMs?(clipId: string): number | undefined;
	/** Resolve a `componentInstance`'s def id → its root subtree, so the walk descends into prefab
	 *  content. `undefined` for an unknown def (skipped). */
	resolveComponent(defId: string): { root: LayoutNode } | undefined;
}

/**
 * The longest animation in `scene`, in wall-clock ms — the MAX over every measurable animated node,
 * descending into `container` children and expanding `componentInstance` prefabs (guarding against a
 * def cycle). `0` when nothing is measurable.
 */
export const sceneAnimationDurationMs = (
	scene: Scene,
	resolvers: SceneDurationResolvers,
): number => {
	let max = 0;
	const consider = (ms: number | undefined): void => {
		if (typeof ms === 'number' && Number.isFinite(ms) && ms > max) max = ms;
	};

	// Component defs on the CURRENT expansion stack — a def that (transitively) contains an instance
	// of itself would otherwise recurse forever. Popped on the way back up, so sibling instances of
	// the same def are still measured.
	const expanding = new Set<string>();

	const walk = (node: LayoutNode): void => {
		switch (node.kind) {
			case 'spine': {
				// The clips this node can play: its resting `defaultAnimation` + every signal cue. Take the
				// longest — the screen isn't "done" until its longest clip finishes.
				consider(resolvers.spineClipMs(node.assetKey, node.defaultAnimation));
				for (const cue of node.cues ?? [])
					consider(resolvers.spineClipMs(node.assetKey, cue.animation));
				break;
			}
			case 'effect':
				consider(resolvers.effectMs(node.effectId));
				break;
			case 'container':
				for (const child of node.children) walk(child);
				break;
			case 'componentInstance': {
				if (expanding.has(node.componentId)) break; // cycle guard.
				const def = resolvers.resolveComponent(node.componentId);
				if (!def) break;
				expanding.add(node.componentId);
				walk(def.root);
				expanding.delete(node.componentId);
				break;
			}
			default:
				break; // sprite / text / rect / reelGrid carry no measurable animation.
		}
	};

	for (const node of scene.nodes) walk(node);
	return max;
};
