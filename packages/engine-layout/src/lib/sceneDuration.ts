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
	/**
	 * A flipbook clip's wall-clock ms (`walked frames / fps`) — called for every placed `flipbook`
	 * node. `loopOverride` is that PLACEMENT's `loop` (absent ⇒ the clip's authored value applies),
	 * and the resolver must return `undefined` for an effectively LOOPING clip: a loop has no end, so
	 * counting one cycle as "the screen's animation" would hold a `showContainer` for an ambient
	 * background that was never meant to gate anything. `undefined` too for an unregistered /
	 * un-baked id.
	 *
	 * `directionOverride` is the placement's `direction`, and it changes the ANSWER, not just the
	 * look: a ping-pong cycle walks back through the interior frames, so it runs nearly twice as
	 * long as the authored list. A duration measured off `frames.length` would end the beat mid-way.
	 */
	flipbookMs?(
		clipId: string,
		loopOverride?: boolean,
		directionOverride?: 'forward' | 'reverse' | 'pingpong',
	): number | undefined;
	/** Resolve a `componentInstance`'s def id → its root subtree, so the walk descends into prefab
	 *  content. `undefined` for an unknown def (skipped). */
	resolveComponent(defId: string): { root: LayoutNode } | undefined;
	/** A `bind`ed coded component's wall-clock ms — the animation the game's registered Svelte
	 *  component plays on mount (e.g. the `Transition` wipe's spine clip). The layout doc records only
	 *  the bind NAME; the coded knowledge of which clip it plays lives game-side (the declare≠implement
	 *  seam, mirroring the coded `bookEventHandlerMap`), so the game supplies it here. `undefined` for a
	 *  bind with no measurable animation (skipped). */
	boundComponentMs?(component: string): number | undefined;
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
		// A `bind` (escape hatch to a coded Svelte component) can ride on ANY node kind — its animation
		// is coded, invisible to this layout walk, so the game resolves it by bind name. Checked before
		// the kind switch so a bound container (or an expanded prefab whose root is a bind) is measured.
		if (node.bind?.component) consider(resolvers.boundComponentMs?.(node.bind.component));
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
			case 'flipbook':
				// The placement's `loop` override is threaded through because a LOOPING clip has no end
				// and must not define the screen's length — a `showContainer` wired to `durationMs` would
				// otherwise hold for one cycle of an ambient loop that was never meant to gate anything.
				// The resolver owns that call (it holds the clip, so it knows the authored `loop`); the
				// override wins there exactly as it does in `<LayoutNodeView>`.
				consider(resolvers.flipbookMs?.(node.clipId, node.loop, node.direction));
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
