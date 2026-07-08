import type { EffectPlayerProps } from 'pixi-svelte';

/**
 * Invisible FX effect registry — the render-time lookup that resolves an authored effect for a
 * placed `effect` node (`EffectNode.effectId`). Mirrors {@link registerComponents}: the game
 * supplies the baked effects ONCE at boot (from `bakedEffects()`), and `LayoutNodeView` resolves an
 * `effectId` → doc here to mount an `<EffectPlayer>`.
 *
 * The `EffectDoc` type is taken from `<EffectPlayer>`'s own props (`pixi-svelte`, already a dep) so
 * this package needs no direct `engine-fx` dependency just for a type.
 *
 * Module-scoped, exactly like `registerComponents` — in a pnpm workspace each game bundles its own
 * copy of this package, so the top-level `Map` never leaks across games.
 */

/** An authored particle effect doc — the shape `<EffectPlayer doc=…>` consumes. */
export type EffectDoc = EffectPlayerProps['doc'];

const registry = new Map<string, EffectDoc>();

/** Register the project's baked effects (id → doc). Later calls override an id (parity with
 * `registerComponents`' latest-wins). Call once at boot with `bakedEffects()`. */
export function registerEffects(docs: EffectDoc[]): void {
	for (const doc of docs) {
		if (doc && typeof doc.id === 'string' && doc.id) registry.set(doc.id, doc);
	}
}

/** Resolve a placed node's `effectId` → its `EffectDoc`, or `undefined` when not registered (an
 * un-baked project, or a dangling id — the render branch then mounts nothing, never crashing). */
export function resolveEffect(id: string): EffectDoc | undefined {
	return registry.get(id);
}

export function clearEffects(): void {
	registry.clear();
}
