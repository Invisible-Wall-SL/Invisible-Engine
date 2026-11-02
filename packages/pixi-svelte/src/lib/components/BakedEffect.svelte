<script lang="ts" module>
	import type { EffectBakeResult } from 'engine-fx';
	import type { Texture } from 'pixi.js';

	export type Props = {
		/** The bake to play (`EffectDoc.bake.result`). */
		result: EffectBakeResult;
		/** Its frames, already resolved from `loadedAssets`, in order. */
		textures: Texture[];
		/** The effect's id — part of the desync key. */
		effectId: string;
		/** Tells two mounts of one effect apart beyond their position (a node id). */
		instanceKey?: string;
	};
</script>

<script lang="ts">
	/**
	 * A BAKED effect (`invisible-fx.md` §"Baked effects"): the loop `/fx` rendered to a sheet, played
	 * as one sprite where the live effect ran its emitters. The frame box sits where the capture found
	 * it in the effect's own space, so the sprite lands exactly over what the emitters would have drawn.
	 *
	 * Time is the particle clock's (turbo speeds the loop as it speeds particles). The start frame is
	 * picked on the first tick, from the effect, the instance key and where the sprite then sits on
	 * screen — deterministic, so copies of one effect are out of step with each other but a seeded
	 * render is the same every run.
	 */
	import { Sprite } from 'pixi.js';
	import { onDestroy } from 'svelte';
	import { effectBakeFrameAt, effectBakeInstanceKey, effectBakeStartFrame } from 'engine-fx';

	import { getContextApp, getContextParent } from '../context.svelte';
	import { particleTimeScale } from '../particleClock';

	const props: Props = $props();
	const context = getContextApp();
	const parentContext = getContextParent();

	// svelte-ignore state_referenced_locally
	const sprite = new Sprite(props.textures[0]);

	$effect(() => {
		const { bounds, blendMode } = props.result;
		sprite.position.set(bounds.x, bounds.y);
		sprite.width = bounds.w;
		sprite.height = bounds.h;
		sprite.blendMode = blendMode;
	});

	let start: number | undefined;
	let seconds = 0;
	let shown = -1;

	const tick = (): void => {
		const ticker = context.stateApp.pixiApplication?.ticker;
		if (!ticker) return;
		const textures = props.textures;
		const count = textures.length;
		if (!count) return;
		if (start === undefined) {
			const at = sprite.getGlobalPosition();
			start = effectBakeStartFrame(
				effectBakeInstanceKey(props.effectId, props.instanceKey, at.x, at.y),
				count,
			);
		} else seconds += (ticker.deltaMS / 1000) * particleTimeScale();
		const frame = effectBakeFrameAt(start, seconds, props.result.fps, count);
		if (frame === shown) return;
		shown = frame;
		sprite.texture = textures[frame];
		sprite.width = props.result.bounds.w;
		sprite.height = props.result.bounds.h;
	};

	const ticker = context.stateApp.pixiApplication?.ticker;
	ticker?.add(tick);
	onDestroy(() => ticker?.remove(tick));

	parentContext.addToParent(sprite);
</script>
