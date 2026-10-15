<script lang="ts" module>
	import type { Snippet } from 'svelte';
	import type { EffectParam, EffectParamValues } from 'engine-fx';

	export type Props = {
		/** The effect's `params` (it has at least one `effect.*` drive, or this is not mounted). */
		params: readonly EffectParam[] | undefined;
		/** The live values, read on the ticker. Absent ⇒ the defaults. */
		values?: () => EffectParamValues | undefined;
		/** The layers, handed the time-scale getter each of them multiplies its emit speed by. */
		children: Snippet<[() => number]>;
	};
</script>

<script lang="ts">
	/**
	 * Invisible FX — the effect-level wrapper of an `<EffectPlayer>` (exposed parameters). One container
	 * around the layers whose alpha, scale and tint follow the `effect.*` drives; `effect.timeScale` is
	 * handed down to each layer's emitter. Those targets have no stored leaf, so the defaults are
	 * applied at mount even with no live values.
	 *
	 * A bone layer rides its bone through `<RigBoneAttach>`, which maps the bone into its parent's
	 * frame and divides the parent's scale out, so `effect.scale` sizes FREE layers only; alpha and
	 * tint reach every layer.
	 */
	import * as PIXI from 'pixi.js';
	import { onDestroy, untrack } from 'svelte';
	import { createEffectLevelApplier, type EffectLevelState } from 'engine-fx';
	import { createContextParent, getContextApp, getContextParent } from '../context.svelte';

	const props: Props = $props();
	const context = getContextApp();
	const parentContext = getContextParent();

	const container = new PIXI.Container();
	parentContext.addToParent(container);
	createContextParent(container);

	const applier = $derived(createEffectLevelApplier(props.params));
	const write = (state: Readonly<EffectLevelState>): void => {
		container.alpha = state.alpha;
		container.scale.set(state.scale);
		container.tint = state.tint;
	};
	$effect(() => {
		const current = applier;
		if (!current) return;
		untrack(() => current.apply(props.values?.()));
		write(current.state);
	});

	const timeScale = (): number => applier?.state.timeScale ?? 1;

	// Registered here, before the layers' emitters register theirs, so a value read this frame is the
	// one they advance by.
	const tick = (): void => {
		const current = applier;
		if (current?.apply(props.values?.())) write(current.state);
	};
	const ticker = context.stateApp.pixiApplication?.ticker;
	ticker?.add(tick);
	onDestroy(() => ticker?.remove(tick));
</script>

{@render props.children(timeScale)}
