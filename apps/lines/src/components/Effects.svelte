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
	import { bakedEffects, bakedRigFx, placedEffectIds, rigFxEffectIds } from '../editor-scenes';

	const context = getContext();

	const effects = bakedEffects();
	// Effects PLACED as `effect` nodes in the layout mount at their position via `LayoutNodeView`,
	// so we skip them here to avoid a double-mount. Bone effects (not scene-placeable in v1) + any
	// unplaced free effect still auto-mount below.
	const placed = placedEffectIds();
	// Effects bound to a rig's timeline are mounted by `<RiggedEffect>` on their HOST rig (a layout
	// spine via `LayoutNodeView`, or a SYMBOL spine via `SymbolSpineMain`), firing on the rig's own
	// event at the bone. Skip them here too — otherwise a rig-bound effect whose doc layers are `free`
	// would ALSO auto-mount as a scene-level ambient emitter at the stage origin (0,0), a phantom
	// burst in the top-left corner (surfaced once the runtime bundle began shipping `rigFx`).
	const rigBound = rigFxEffectIds();

	/** Whether any of the effect's layers is pinned to a bone (⇒ needs a host `<SpineProvider>`). */
	const placesOnBone = (doc: EffectDoc): boolean =>
		doc.layers.some((layer) => layer.placement.space === 'bone' && !!layer.placement.bone);

	const freeEffects = effects.filter(
		(doc) => !placesOnBone(doc) && !placed.has(doc.id) && !rigBound.has(doc.id),
	);
	const boneEffects = effects.filter((doc) => placesOnBone(doc) && !rigBound.has(doc.id));

	// Diagnostic: `?fxdebug=1` in the game URL dumps how EVERY baked effect is routed, so a stray
	// burst can be traced to its exact mount + reason. `ambient-free@origin` is the (0,0) bucket —
	// an effect that is neither placed as a scene node NOR bound to a rig, so it emits at the scene
	// origin. Inert without the flag (no console noise on a normal boot); safe in the shipped bundle.
	if (typeof location !== 'undefined' && new URLSearchParams(location.search).has('fxdebug')) {
		const rigFx = bakedRigFx();
		const bucketOf = (doc: EffectDoc): string =>
			placed.has(doc.id)
				? 'placed-node (LayoutNodeView @ node pos)'
				: rigBound.has(doc.id)
					? 'rig-bound (RiggedEffect @ host rig/bone)'
					: placesOnBone(doc)
						? 'ambient-bone (foreground host rig)'
						: 'ambient-free@origin (0,0) ⚠';
		console.log(
			'[fxdebug] baked effects:',
			effects.map((d) => ({ id: d.id, layers: d.layers.length, mount: bucketOf(d) })),
		);
		console.log('[fxdebug] rigFx manifest (rigKey → bound effectIds):',
			Object.fromEntries(Object.entries(rigFx).map(([k, b]) => [k, b.map((x) => x.effectId)])),
		);
		console.log('[fxdebug] placedEffectIds:', [...placed], '| rigFxEffectIds:', [...rigBound]);
		console.log(
			'[fxdebug] mounting at ORIGIN (0,0):',
			freeEffects.map((d) => d.id),
			'— if a stray burst is here, this id is neither placed nor rig-bound.',
		);
	}

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
	<SpineProvider key="foregroundAnimation" {...hostRigProps} rebroadcastEvents>
		{#each boneEffects as doc (doc.id)}
			<EffectPlayer {doc} />
		{/each}
	</SpineProvider>
{/if}
