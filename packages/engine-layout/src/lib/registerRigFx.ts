/**
 * Invisible FX rig-timeline binding registry — the render-time lookup that resolves the effects a
 * placed rig plays directly off its OWN animation events (`event.fx = { effectId, bone? }` authored
 * in the Rigger). Mirrors {@link registerEffects}: the game supplies the baked bindings ONCE at boot
 * (from `bakedRigFx()`), and `LayoutNodeView` resolves a rig's `assetKey` → its bindings here to
 * mount a `<RiggedEffect>` per binding INSIDE the rig's `<SpineProvider>`.
 *
 * Why a manifest (not read from the event stream): spine-pixi discards the custom `event.fx` field
 * at parse time, so the binding cannot travel through the rebroadcast bus — it is baked from the rig
 * `.irig`/`.json` directly (see `invisible-fx.md` "rig-timeline direct FX binding").
 *
 * The map is keyed by the SAME string `LayoutNodeView` passes as `<SpineProvider key={node.assetKey}>`
 * for a placed rig — i.e. the plain bundle NAME (`bundleFromAssetKey` = the `skeletons.json` `folder`),
 * since `resolveSpineKeysForGame` rewrites an editor-placed spine node's `assetKey` down to that name.
 *
 * Module-scoped, exactly like `registerEffects` — in a pnpm workspace each game bundles its own copy
 * of this package, so the top-level `Map` never leaks across games.
 */

/** One rig→effect binding: on a spine event named `event`, (re)play `effectId` from t=0, hosted on
 * `bone` (or the rig origin when absent). */
export type RigFxBinding = {
	event: string;
	effectId: string;
	bone?: string;
};

const registry = new Map<string, RigFxBinding[]>();

/** Register the project's baked rig→FX bindings (rig assetKey → bindings). Later calls override a
 * key (parity with `registerEffects`' latest-wins). Call once at boot with `bakedRigFx()`. */
export function registerRigFx(map: Record<string, RigFxBinding[]>): void {
	if (!map || typeof map !== 'object') return;
	for (const [rigKey, binds] of Object.entries(map)) {
		if (rigKey && Array.isArray(binds)) registry.set(rigKey, binds);
	}
}

/** Resolve a placed rig's `assetKey` → its bindings, or `[]` when none are registered (an un-baked
 * project, or a rig with no bound events — the render branch then mounts nothing). Never throws. */
export function resolveRigFx(rigKey: string): RigFxBinding[] {
	return registry.get(rigKey) ?? [];
}

export function clearRigFx(): void {
	registry.clear();
}
