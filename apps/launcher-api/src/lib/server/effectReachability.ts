/**
 * Prune UNREACHABLE Invisible FX effects from a game's embedded runtime bundle.
 *
 * The editor reads effects from R2 directly and must keep seeing ALL of them (so authors can
 * manage / delete orphan/scratch effects in the FX tool). The BUNDLE, though, should only ship
 * effects that can actually render — otherwise a scratch effect left in the project still travels
 * to the running game even though nothing mounts it. `components/Effects.svelte` already refuses to
 * auto-mount such an orphan at render time (its `isEventReachable` guardrail); this trims the same
 * dead ids out of the shipped list so they don't reach the game at all.
 *
 * REACHABILITY CONTRACT — an effect is REACHABLE (and MUST still ship) iff ANY of:
 *   1. PLACED — its id is a `kind:'effect'` node's `effectId` anywhere in the doc's scenes,
 *      including nested inside `container` children AND `componentInstance` expansions.
 *   2. RIG-BOUND — its id is referenced by any `rigFx` binding (a rig timeline event → effect).
 *   3. EVENT-TRIGGERED — it has a layer with `trigger.on === 'event'` and an `eventType` (the Flow
 *      Broadcast pattern). IDENTICAL to `isEventReachable` in `apps/lines/src/components/Effects.svelte`.
 *   4. EXTERNALLY-REACHED — its id is in the caller-supplied `extraReachable` set: a reference from a
 *      surface this module doesn't walk (currently the symbols doc: a Book-symbol VFX `kind:'fx'`
 *      layer, keyed by `bookVfx.{background,foreground}.effectId`, and the explosion → intro
 *      transition, `transition.effectId`). The caller owns that walk; keep in sync with the bake
 *      path's inline keep-set in `scripts/bake-editor-doc.mjs`.
 *
 * CONSERVATIVE RULE: when uncertain, KEEP. We only drop ids that are DEFINITELY none of the above —
 * never risk pruning a used effect. Both bundle-assembly paths (`buildRuntimeBundle` for `?runtime=1`
 * games + the offline `scripts/bake-editor-doc.mjs` for own-bundle games) must apply the SAME filter;
 * this is the shared TS implementation the runtime path imports. The `.mjs` bake mirrors the tiny
 * predicate inline (it can't import TS) with a "keep in sync" comment.
 */
import type { EffectDoc } from 'engine-fx';
import type { ComponentDef, LayoutNode, RigFxBinding, Scene } from 'engine-layout';

/**
 * Collect every `kind:'effect'` `effectId` reachable by walking `nodes` and their `container`
 * children. `componentInstance` nodes are NOT expanded here — each referenced ComponentDef is walked
 * independently by the caller (the def set is already the transitively-referenced closure), which
 * covers component-nested placed effects without needing per-instance expansion or a cycle guard.
 */
function collectEffectNodeIds(nodes: LayoutNode[] | undefined, ids: Set<string>): void {
	if (!Array.isArray(nodes)) return;
	for (const node of nodes) {
		if (node.kind === 'effect' && typeof node.effectId === 'string' && node.effectId) {
			ids.add(node.effectId);
		} else if (node.kind === 'container') {
			collectEffectNodeIds(node.children, ids);
		}
	}
}

/**
 * The PLACED effect ids across a doc's scenes + every referenced ComponentDef. `componentDefs` is
 * the transitively-referenced def closure (`resolveReferencedDefs` in `runtimeBundle.ts` / the
 * `components=1` doc endpoint), so walking each def's `root` covers a component-nested placed effect —
 * the MORE complete walk (containers + component instances) the editor overlay uses, so a
 * component-nested placed effect is never pruned. Mirrors `editor-scenes.ts#placedEffectIds` (scenes
 * + containers) extended to component defs.
 */
function placedEffectIds(scenes: Scene[], componentDefs: ComponentDef[]): Set<string> {
	const ids = new Set<string>();
	for (const scene of scenes) collectEffectNodeIds(scene.nodes, ids);
	for (const def of componentDefs) collectEffectNodeIds(def.root.children, ids);
	return ids;
}

/**
 * Event-reachable: at least one layer is `trigger.on === 'event'` with an `eventType` (the Flow
 * Broadcast pattern — dormant until that game event fires). IDENTICAL to `isEventReachable` in
 * `apps/lines/src/components/Effects.svelte`; keep the two in sync.
 */
function isEventReachable(doc: EffectDoc): boolean {
	return doc.layers.some((layer) => layer.trigger?.on === 'event' && !!layer.trigger?.eventType);
}

export interface EffectPruneResult {
	/** The reachable subset of `effects` — the list to embed in the bundle. */
	effects: EffectDoc[];
	/** Ids dropped as unreachable (orphan/scratch effects), for a loud non-silent log. */
	prunedIds: string[];
}

/**
 * Filter an effect list down to the REACHABLE subset (see the contract at the top of this file).
 * Both bundle-assembly paths call this before embedding `effects` so an orphan/scratch effect never
 * ships. Never mutates its inputs.
 *
 * @param scenes        the doc's scenes (placed-effect walk root).
 * @param componentDefs the transitively-referenced ComponentDef closure (for component-nested placed
 *                      effects). Pass latest defs + any pinned versions — extra defs only widen the
 *                      KEEP set (conservative).
 * @param rigFx         the rig→FX binding manifest (rig-bound reachability).
 * @param extraReachable additional effect ids the caller already knows are reachable from a surface
 *                       this module doesn't walk (Book-symbol VFX fx layers, the explosion
 *                       transition). Conservative — only widens the KEEP set. Optional; omitting it
 *                       is the previous behaviour.
 */
export function pruneUnreachableEffects(
	effects: EffectDoc[],
	scenes: Scene[],
	componentDefs: ComponentDef[],
	rigFx: Record<string, RigFxBinding[]>,
	extraReachable?: Iterable<string>,
): EffectPruneResult {
	const placed = placedEffectIds(scenes, componentDefs);
	const rigBound = new Set<string>();
	for (const binds of Object.values(rigFx)) {
		for (const b of binds) if (b.effectId) rigBound.add(b.effectId);
	}
	const external = new Set<string>(extraReachable ?? []);
	const kept: EffectDoc[] = [];
	const prunedIds: string[] = [];
	for (const doc of effects) {
		if (placed.has(doc.id) || rigBound.has(doc.id) || external.has(doc.id) || isEventReachable(doc))
			kept.push(doc);
		else prunedIds.push(doc.id);
	}
	return { effects: kept, prunedIds };
}
