<script lang="ts">
	/**
	 * Invisible FX runtime mount (`invisible-fx.md` §4.4 / §8). Plays this project's baked
	 * effects in the running game. For each {@link bakedEffects} `EffectDoc` we mount one
	 * `<EffectPlayer>`:
	 *
	 * - An effect whose layers are all `free` mounts at the scene level — the emitter sits in
	 *   the scene, optionally offset, and emits ambiently (`trigger.on: 'always'`) or on a Flow
	 *   Broadcast / game event (`trigger.on: 'event'` → `trigger.eventType` on the event bus,
	 *   the binding `<EffectLayer>` wires).
	 * - An effect that places ANY layer on a `bone` mounts INSIDE a `<SpineProvider>` so
	 *   `<SpineBoneAttach>` resolves the bone on the HOST game's playing rig (the Phase-2
	 *   carry-forward). We host bone effects on the always-present foreground rig; a bone name
	 *   that the rig doesn't carry falls back to origin+offset (never silently vanishes).
	 *
	 * Parity: zero baked effects ⇒ nothing mounts ⇒ byte-identical to a game with no FX. This
	 * is `apps/lines`-local wiring; the engine pieces (`<EffectPlayer>`/`<SpineBoneAttach>`,
	 * the event-bus trigger) live in `pixi-svelte`/`engine-fx`.
	 */
	import { EffectPlayer, SpineProvider } from 'pixi-svelte';
	import type { EffectDoc } from 'engine-fx';

	import { getContext } from '../game/context';
	import { bakedEffects, placedEffectIds } from '../editor-scenes';

	const context = getContext();

	const effects = bakedEffects();
	// Effects PLACED as `effect` nodes in the layout mount at their position via `LayoutNodeView`,
	// so we skip them here to avoid a double-mount. Bone effects (not scene-placeable in v1) + any
	// unplaced free effect still auto-mount below.
	const placed = placedEffectIds();

	/** Whether any of the effect's layers is pinned to a bone (⇒ needs a host `<SpineProvider>`). */
	const placesOnBone = (doc: EffectDoc): boolean =>
		doc.layers.some((layer) => layer.placement.space === 'bone' && !!layer.placement.bone);

	const freeEffects = effects.filter((doc) => !placesOnBone(doc) && !placed.has(doc.id));
	const boneEffects = effects.filter((doc) => placesOnBone(doc));

	// The host rig for bone-placed effects — the always-present foreground spine. Sized to the
	// canvas like `Background` so the bone transforms land in the same frame the game draws.
	const hostRigProps = $derived.by(() => {
		const canvas = context.stateLayoutDerived.canvasSizes();
		return {
			x: canvas.width / 2,
			y: canvas.height / 2,
			width: canvas.width,
			height: canvas.height,
			fit: 'cover' as const,
		};
	});
</script>

{#each freeEffects as doc (doc.id)}
	<EffectPlayer {doc} />
{/each}

{#if boneEffects.length}
	<SpineProvider key="foregroundAnimation" {...hostRigProps}>
		{#each boneEffects as doc (doc.id)}
			<EffectPlayer {doc} />
		{/each}
	</SpineProvider>
{/if}
