/**
 * Cue animation duration — a PURE calculator that answers "how long does the animation this CUE
 * starts run, in wall-clock ms?" by finding every node whose `cues[]` names the signal and taking
 * the MAX of the clips they play.
 *
 * It is the value behind Invisible Flow v2's `fireCue.await` ("Wait for this cue to finish") for an
 * AUTHOR-NAMED cue. Those cues travel the open component-signal bus (`emitComponentSignal`), which
 * is a bare `subscribe(run)` event contract with no completion channel — a spine driven by one can
 * never report back that it finished, so awaiting the emitter broadcast alone returned instantly
 * and the tick was a silent no-op. Measuring the clip is the completion signal the bus cannot carry.
 *
 * Deliberately RESOLVER-INJECTED and asset-free, exactly like its sibling
 * {@link sceneAnimationDurationMs}: the layout doc records only NAMES (a spine `assetKey` + clip,
 * a flipbook `clipId`), never durations. An unresolved name contributes nothing rather than
 * throwing, so a cue fired before its skeleton finished loading simply doesn't wait.
 *
 * ONE CYCLE, LOOPING OR NOT — the one place this deliberately disagrees with
 * {@link sceneAnimationDurationMs}. There, a looping clip must contribute NOTHING: `durationMs` is
 * an implicit measurement of "the screen", and counting one cycle of an ambient background would
 * hold a `showContainer` on art that was never meant to gate anything. Here the author ticked a box
 * on THIS node asking to wait for THIS cue, and the idle-plus-a-held-mode rig the open bus exists to
 * drive (`characterSpin` looping until `characterIdle` replaces it) is precisely a looping cue. A
 * loop still has no end, so "one cycle" is the only finite answer available — and an explicit
 * per-node opt-in is the one context where inventing it is what the author asked for.
 *
 * WHAT THIS MODELS. The walk has to agree with the two seams that actually SUBSCRIBE a cue
 * (`<ComponentInstance>` for a prefab's content, `<LayoutNodeView>` for a node placed straight in a
 * screen) and with the renderer that decides whether the cued node draws at all — measuring a clip
 * that never plays buys a wait for nothing. So it mirrors, deliberately and case for case: the
 * half-authored-cue guard, `cueSignalOverrides` remapping, the component-version pin, the
 * {@link MAX_COMPONENT_DEPTH} nesting cap, and per-layout visibility. What it does NOT model is
 * `hiddenUntilSignal` (`BaseNode.hiddenUntilSignal`), whose gate is per-instance runtime state with
 * no static answer — a cue on a node still hidden by one is measured, and over-waits.
 *
 * It also knows nothing about WHICH BUS a name resolves to: a name the game registered
 * (`registerComponentSignals`) is driven by its own source and its emitter subscriber reports real
 * completion, so measuring it would stack a second wait on top. That is the CALLER's call to make,
 * because the registry is game state — see `flowV2Runtime`'s `cueAnimationMs`.
 */

import { MAX_COMPONENT_DEPTH } from './registerComponents';
import type { LayoutNode, LayoutType, Scene } from './types';

/**
 * The per-asset duration lookups the calculator needs. Each returns wall-clock ms, or `undefined`
 * when the asset is not measurable (name doesn't resolve, skeleton not loaded yet, un-registered
 * clip) — an undefined result is skipped, never treated as `0`.
 */
export interface CueDurationResolvers {
	/** A spine clip's wall-clock ms — `SkeletonData.findAnimation(animation)?.duration × 1000`.
	 *  `undefined` when the skeleton isn't loaded or the clip name is unknown. */
	spineClipMs(assetKey: string, animation: string | undefined): number | undefined;
	/**
	 * ONE CYCLE of a flipbook clip in wall-clock ms, IGNORING its loop flag — `flipbookCycleMs`
	 * refuses to measure a looping clip (see this module's header for why that is right there and
	 * wrong here), so the game passes it a `loopOverride` of `false`. `directionOverride` is the
	 * placement's own `direction` and changes the answer: a ping-pong walks back through its
	 * interior frames, so it runs nearly twice as long as the authored frame list.
	 */
	flipbookCycleMs?(
		clipId: string,
		directionOverride?: 'forward' | 'reverse' | 'pingpong',
	): number | undefined;
	/** Resolve a `componentInstance`'s def id (+ its pinned `version`, threaded so the walk measures
	 *  the same def the renderer draws) → its root subtree. `undefined` for an unknown def (skipped). */
	resolveComponent(defId: string, version?: number): { root: LayoutNode } | undefined;
	/**
	 * The layout the game is currently drawing. Supplied ⇒ a node hidden for it is skipped, because
	 * `<LayoutNodeView>` will not render it and its clip therefore never plays: a cued spine authored
	 * desktop-only would otherwise buy its full length as a wait while off-screen. Omitted ⇒ no
	 * visibility gating (a headless caller with no layout).
	 */
	layoutType?: LayoutType;
}

/**
 * The longest animation any cue named `cue` starts, in wall-clock ms, over the given scenes — `0`
 * when nothing measurable subscribes that name (no cued node, an un-loaded skeleton, a dangling
 * clip id), which is the overwhelmingly common case: the game fires EVERY flow cue name through
 * here and only a handful are named by a scene cue.
 *
 * Pass only the scenes currently MOUNTED. A cue fired while its screen is unmounted reaches nobody
 * (the open bus has no replay), so measuring an un-mounted scene would hold the exec chain for an
 * animation that never played — the one way this could hang a round.
 */
export const cueAnimationDurationMs = (
	scenes: Scene[],
	cue: string,
	resolvers: CueDurationResolvers,
): number => {
	if (!cue) return 0;
	let max = 0;
	const consider = (ms: number | undefined): void => {
		if (typeof ms === 'number' && Number.isFinite(ms) && ms > max) max = ms;
	};

	// Component defs on the CURRENT expansion stack — a def that (transitively) contains an instance
	// of itself would otherwise recurse forever. Popped on the way back up, so sibling instances of
	// the same def are still measured. The renderer's cycle guard, in tree-walk form.
	const expanding = new Set<string>();

	// Per-layout visibility, resolved exactly as `resolveTransform` does it (an explicit
	// `overrides[layoutType].visible` wins over the `visibleFor` gate) — but inlined, because the
	// full transform resolve computes a position this walk has no use for.
	const hiddenHere = (node: LayoutNode): boolean => {
		const layoutType = resolvers.layoutType;
		if (!layoutType) return false;
		const override = node.overrides?.[layoutType];
		if (override?.visible !== undefined) return !override.visible;
		return !!node.visibleFor && !node.visibleFor.includes(layoutType);
	};

	/**
	 * `rebinds` is the enclosing `componentInstance`'s `cueSignalOverrides` — nodeId → (authored
	 * signal → the signal THIS placement drives it from). Applied before matching, exactly as
	 * `<ComponentInstance>` applies it before subscribing: without it a rebound cue is measured
	 * under the def's name and the placement's real cue measures 0.
	 *
	 * `depth` counts enclosing instances, so the walk stops expanding where the renderer does.
	 */
	const walk = (
		node: LayoutNode,
		rebinds?: Record<string, Record<string, string>>,
		depth = 0,
	): void => {
		// A hidden node draws nothing — and hides its whole subtree, which is why this precedes the
		// kind switch rather than living in the two cued branches.
		if (hiddenHere(node)) return;
		switch (node.kind) {
			case 'spine': {
				const nodeRebinds = rebinds?.[node.id];
				for (const c of node.cues ?? []) {
					// A half-authored cue drives nothing (`addCue` seeds `animation: ''`), and is skipped
					// at both subscribe seams — so it must not contribute a duration either.
					if (!c.signal || !c.animation) continue;
					if ((nodeRebinds?.[c.signal] || c.signal) !== cue) continue;
					// `c.animation` is the wait in EVERY shape this cue can take, which is why the
					// one-shot/loop predicate (`handsOffToIdle`) is not consulted here: a cue that hands
					// off plays its clip once and then settles into the resting default (the wait is the
					// clip), a non-looping cue plays it once and stops (the same), and a looping cue holds
					// it (one cycle — see the module header). Only the clip that follows differs.
					consider(resolvers.spineClipMs(node.assetKey, c.animation));
				}
				break;
			}
			case 'flipbook': {
				const nodeRebinds = rebinds?.[node.id];
				for (const c of node.cues ?? []) {
					if (!c.signal || !c.clipId) continue;
					if ((nodeRebinds?.[c.signal] || c.signal) !== cue) continue;
					consider(resolvers.flipbookCycleMs?.(c.clipId, node.direction));
				}
				break;
			}
			case 'container':
				for (const child of node.children ?? []) walk(child, rebinds, depth);
				break;
			case 'componentInstance': {
				// Both of the renderer's refusals: a def already on the stack (a cycle), and one nested
				// deeper than it will expand — `<ComponentInstance>` renders nothing past
				// `MAX_COMPONENT_DEPTH`, so a cue named down there is never subscribed and must not be
				// measured.
				if (expanding.has(node.componentId) || depth >= MAX_COMPONENT_DEPTH) break;
				const def = resolvers.resolveComponent(node.componentId, node.componentVersion);
				if (!def) break;
				expanding.add(node.componentId);
				// The instance's OWN overrides take over inside its expansion — a nested instance's
				// rebinds are keyed by ITS def's node ids, so they never leak outward or inward.
				walk(def.root, node.cueSignalOverrides, depth + 1);
				expanding.delete(node.componentId);
				break;
			}
			default:
				break; // sprite / text / rect / reelGrid / effect carry no cues.
		}
	};

	for (const scene of scenes) for (const node of scene.nodes) walk(node);
	return max;
};
