<script lang="ts" module>
	import type { EffectBakeBeatFades, EffectBakeResult } from 'engine-fx';
	import type { Texture } from 'pixi.js';

	export type Props = {
		/** The bake to play (`EffectDoc.bake.result`). */
		result: EffectBakeResult;
		/** Each blend group's frames, already resolved from `loadedAssets`, in order. */
		textures: Texture[][];
		/** The effect's id — part of the desync key. */
		effectId: string;
		/** Tells two mounts of one effect apart beyond their position (a node id). */
		instanceKey?: string;
		/**
		 * Played on a rig beat (`<RiggedEffect>`): fade in from the beat, and out once emission ends.
		 * Absent ⇒ an ambient loop, drawn at full opacity for the life of the mount.
		 */
		beat?: EffectBakeBeatFades;
		/** On a beat, emission ends this many ms after it is set (`<EffectLayer>`'s `emitFor`). */
		emitFor?: number;
		/** On a beat, its emit speed: the loop plays at that rate (`effectBakeBeatRate`). */
		emitSpeed?: number;
	};
</script>

<script lang="ts">
	/**
	 * A BAKED effect (`invisible-fx.md` §"Baked effects"): the loop `/fx` rendered to a sheet, played
	 * as one sprite per BLEND GROUP where the live effect ran its emitters — drawn in draw order, each
	 * with its group's blend, all on the same frame, so an additive run adds light over what is below
	 * it exactly as its live layers do. The frame box sits where the capture found it in the effect's
	 * own space, so the sprites land exactly over what the emitters would have drawn.
	 *
	 * Time is the particle clock's (turbo speeds the loop as it speeds particles). The start frame is
	 * picked on the first tick, from the effect, the instance key and where the sprites then sit on
	 * screen — deterministic, so copies of one effect are out of step with each other but a seeded
	 * render is the same every run.
	 *
	 * On a rig BEAT the mount is re-keyed every beat, so the loop starts from the beat (at that
	 * deterministic frame), plays at the beat's emit speed, and fades: in over a moment, out over the
	 * longest particle life once `emitFor` runs out — the time the live particles would take to die.
	 * Then the sprites stop drawing and leave the ticker.
	 */
	import { Sprite } from 'pixi.js';
	import { onDestroy, untrack } from 'svelte';
	import {
		effectBakeBeatAlpha,
		effectBakeBeatRate,
		effectBakeFrameAt,
		effectBakeInstanceKey,
		effectBakeStartFrame,
	} from 'engine-fx';

	import { getContextApp, getContextParent } from '../context.svelte';
	import { particleTimeScale } from '../particleClock';
	import { particlesOff } from '../particleBudget';
	import { perfProbe } from '../perfProbe';

	const props: Props = $props();
	const context = getContextApp();
	const parentContext = getContextParent();

	// One sprite per group, fixed for the mount: `<EffectPlayer>` re-mounts on a new bake. None under
	// `?particles=off` (a test switch): a bake is its effect's particles, drawn.
	// svelte-ignore state_referenced_locally
	const sprites = particlesOff() ? [] : props.textures.map((frames) => new Sprite(frames[0]));

	$effect(() => {
		const { bounds, groups } = props.result;
		sprites.forEach((sprite, i) => {
			sprite.position.set(bounds.x, bounds.y);
			sprite.width = bounds.w;
			sprite.height = bounds.h;
			sprite.blendMode = groups[i]?.blendMode ?? 'normal';
		});
	});

	let start: number | undefined;
	let seconds = 0;
	let shown = -1;

	// A beat's emission end, in the same particle-clock seconds as `seconds`. Like the live layer's
	// stop timer, it is (re)set from the moment `emitFor` is set: `released` turns it to 0 mid-beat.
	const onBeat = $derived(!!props.beat);
	let endAt: number | undefined;
	$effect(() => {
		if (!onBeat) return;
		const emitFor = props.emitFor;
		untrack(() => {
			endAt =
				typeof emitFor === 'number' && Number.isFinite(emitFor) && emitFor >= 0
					? seconds + emitFor / 1000
					: undefined;
		});
	});
	// svelte-ignore state_referenced_locally
	if (props.beat && props.beat.fadeIn > 0) for (const sprite of sprites) sprite.alpha = 0;

	const tick = (): void => {
		const ticker = context.stateApp.pixiApplication?.ticker;
		if (!ticker || !sprites.length) return;
		const groups = props.textures;
		const count = Math.min(...groups.map((frames) => frames.length));
		if (!count) return;
		if (perfProbe.on) perfProbe.counts.baked++;
		if (start === undefined) {
			const at = sprites[0].getGlobalPosition();
			start = effectBakeStartFrame(
				effectBakeInstanceKey(props.effectId, props.instanceKey, at.x, at.y),
				count,
			);
		} else seconds += (ticker.deltaMS / 1000) * particleTimeScale();
		const beat = props.beat;
		if (beat) {
			const alpha = effectBakeBeatAlpha(seconds, endAt, beat);
			for (const sprite of sprites) sprite.alpha = alpha;
			if (alpha <= 0 && endAt !== undefined && seconds >= endAt) {
				for (const sprite of sprites) sprite.visible = false;
				ticker.remove(tick);
				return;
			}
		}
		const played = beat ? seconds * effectBakeBeatRate(props.emitSpeed) : seconds;
		const frame = effectBakeFrameAt(start, played, props.result.fps, count);
		if (frame === shown) return;
		shown = frame;
		const { w, h } = props.result.bounds;
		sprites.forEach((sprite, i) => {
			sprite.texture = groups[i][frame];
			sprite.width = w;
			sprite.height = h;
		});
	};

	const ticker = context.stateApp.pixiApplication?.ticker;
	if (sprites.length) ticker?.add(tick);
	onDestroy(() => ticker?.remove(tick));

	for (const sprite of sprites) parentContext.addToParent(sprite);
</script>
