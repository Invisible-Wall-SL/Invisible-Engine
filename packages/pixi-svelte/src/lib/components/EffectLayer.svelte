<script lang="ts" module>
	import type { EmitterLayer } from 'engine-fx';

	export type Props = {
		/** The layer to mount (one emitter of the parent effect). */
		layer: EmitterLayer;
		/** Emit-speed forwarded to the layer's `<ParticleEmitter>`. */
		emitSpeed?: number;
	};
</script>

<script lang="ts">
	/**
	 * Invisible FX — one mounted emitter layer (`invisible-fx.md` §4.4). Splitting the per-layer
	 * mount out of `<EffectPlayer>` gives each layer its OWN reactive `emit` flag + trigger
	 * lifecycle, so an `event`-driven layer can subscribe the event bus and pulse on independently.
	 *
	 * The pure `planLayer` (`engine-fx`) decides the mount shape (free vs bone-wrapped, offset,
	 * spine-particle skip) AND the trigger mode (ambient `always` vs event-bus `event`). This
	 * component maps that plan onto `<Container>` / `<SpineBoneAttach>` / `<ParticleEmitter>` and
	 * — for an `event` layer — subscribes `trigger.eventType` on `utils-event-emitter`'s bus
	 * (the SAME bus a Flow Broadcast fires, §1/§4.4), pulsing `emit` true on each matching event
	 * and back to false after `trigger.duration` ms (or, when no duration is set, leaving the
	 * config's own `emitterLifetime` to govern the burst — we re-arm emit on every event).
	 */
	import { onDestroy } from 'svelte';
	import * as SPINE_PIXI from '@esotericsoftware/spine-pixi-v8';
	import type { Texture } from 'pixi.js';
	import { planLayer } from 'engine-fx';
	import { getContextEventEmitter, type EmitterEventBase } from 'utils-event-emitter';

	import Container from './Container.svelte';
	import ParticleEmitter from './ParticleEmitter.svelte';
	import SpineBoneAttach from './SpineBoneAttach.svelte';
	import { getContextApp } from '../context.svelte';
	import { createPixiSpineBackingFactory } from '../spineBacking';
	import type { SpineParticleBehaviorConfig } from '../spineParticleBehavior';

	const props: Props = $props();
	const context = getContextApp();
	const plan = $derived(planLayer(props.layer));

	// Tier C: resolve the `spineParticle.skeletonKey` to a loaded `SkeletonData` (a `LoadedSpine`
	// in `loadedAssets`, the SAME lookup `SpineProvider` does — the skeleton must have travelled
	// the pipeline like an atlas does, §8) and build the pooled-`Spine` factory the behavior pools.
	// A `spine` layer whose skeleton isn't loaded yields no config ⇒ `<ParticleEmitter>` falls back
	// to the (textureless) sprite path and renders nothing, never crashing.
	//
	// `/fx` authors `skeletonKey` as the CANONICAL bundle FOLDER — exactly the key an editor-art
	// spine registers under (`editorArt.spines[].key` = `bundleFromAssetKey()` = the folder). A spine
	// that ships ONLY via a symbol cell instead registers under its FULL R2 bundle prefix
	// (`<…>/spines/<folder>/`), so as a fallback we match any loaded key whose bundle folder equals
	// the authored key — making an authored spine effect resolve no matter which path shipped the
	// skeleton, without re-keying the symbol/runtime registration.
	const bundleFolderOf = (key: string): string => {
		const trimmed = key.endsWith('/') ? key.slice(0, -1) : key;
		const m = trimmed.match(/(?:^|\/)spines\/(.+)$/);
		return m ? m[1] : trimmed;
	};
	const spineParticle = $derived.by(
		(): Omit<SpineParticleBehaviorConfig, 'layerHost'> | undefined => {
			if (plan.particleKind !== 'spine' || !plan.spineParticle) return undefined;
			const { skeletonKey, animation, loop } = plan.spineParticle;
			const loaded = context.stateApp.loadedAssets ?? {};
			let spineData = loaded[skeletonKey] as SPINE_PIXI.SkeletonData | undefined;
			if (!spineData) {
				const hit = Object.keys(loaded).find((k) => bundleFolderOf(k) === skeletonKey);
				if (hit) spineData = loaded[hit] as SPINE_PIXI.SkeletonData | undefined;
			}
			if (!spineData) return undefined;
			return {
				animation,
				loop: loop ?? false,
				prewarm: props.layer.config.maxParticles ?? 0,
				createBacking: createPixiSpineBackingFactory(spineData),
			};
		},
	);

	// Resolve a SPRITE layer's authored `art.frames` → the loaded per-frame `Texture`s, honoring the
	// editor-art scoped→bare key precedence (mirrors `LayoutNodeView` / `engine-layout`'s
	// `editorArtTextureKey`; the `<assetKey>::<frame>` scheme is inlined here to avoid a
	// `pixi-svelte → engine-layout` dependency). An FX atlas ships via the editor-art export, so its
	// frames register under `<assetKey>::<frame>` (a manifest `.json` assetKey) with a bare-name
	// fallback. Empty frames ⇒ undefined, so `<ParticleEmitter>` falls back to binding the whole
	// `loadedAssets[key]` sheet (game-bundled spritesheet parity).
	const isManifestAssetKey = (k: string): boolean => k.includes('/') && k.endsWith('.json');
	const spriteTextures = $derived.by((): Texture[] | undefined => {
		if (plan.particleKind === 'spine') return undefined;
		const frames = props.layer.art.frames;
		if (!frames || frames.length === 0) return undefined;
		const loaded = context.stateApp.loadedAssets ?? {};
		const assetKey = props.layer.art.assetKey;
		const scoped = isManifestAssetKey(assetKey);
		const out: Texture[] = [];
		for (const frame of frames) {
			const tex = (scoped ? loaded[`${assetKey}::${frame}`] : undefined) ?? loaded[frame];
			if (tex) out.push(tex as Texture);
		}
		return out.length ? out : undefined;
	});
	// Weights only when EVERY frame resolved — a missing frame would misalign the parallel weights,
	// so fall back to a uniform pick (mirrors the /fx preview stage's guard).
	const spriteWeights = $derived(
		spriteTextures && spriteTextures.length === (props.layer.art.frames?.length ?? 0)
			? props.layer.art.weights
			: undefined,
	);

	// Live emit flag: ambient layers start emitting; event layers start dormant and the
	// subscription below flips this on when their `eventType` fires.
	let emitting = $state(plan.trigger.emit);

	let stopTimer: ReturnType<typeof setTimeout> | undefined;
	const clearStop = (): void => {
		if (stopTimer !== undefined) {
			clearTimeout(stopTimer);
			stopTimer = undefined;
		}
	};

	// Subscribe an `event`-mode layer to its bus `type`. The bus is reached through the shared
	// event-emitter context (so this engine component never imports a specific game's union); a
	// game that mounts an `<EffectPlayer>` always has a `setContextEventEmitter` in scope. An
	// `event` layer with no `eventType` (or no bus in context) never fires — it stays dormant,
	// the fail-safe analogue of a bone layer with no bone.
	$effect(() => {
		const trigger = plan.trigger;
		if (trigger.mode !== 'event' || !trigger.eventType) {
			emitting = trigger.emit;
			return;
		}

		const ctx = getContextEventEmitter<EmitterEventBase>();
		const eventEmitter = ctx?.eventEmitter;
		if (!eventEmitter) return;

		const eventType = trigger.eventType;
		const duration = trigger.duration;
		const stopEventType = trigger.stopEventType;
		const handlers: Record<string, () => void> = {
			[eventType]: () => {
				emitting = true;
				clearStop();
				if (typeof duration === 'number' && duration >= 0) {
					stopTimer = setTimeout(() => {
						emitting = false;
						stopTimer = undefined;
					}, duration);
				}
			},
		};
		// Optional SECOND cue that STOPS emission (a continuous effect Flow switches off). Cancels any
		// pending duration-timer. Ignored when equal to the fire cue (`layerTrigger` already drops that).
		if (stopEventType && stopEventType !== eventType) {
			handlers[stopEventType] = () => {
				clearStop();
				emitting = false;
			};
		}
		const unsubscribe = eventEmitter.subscribe(handlers);

		return () => {
			unsubscribe();
			clearStop();
			emitting = false;
		};
	});

	onDestroy(clearStop);
</script>

{#if plan.render}
	{#if plan.mount === 'bone' && plan.bone}
		<SpineBoneAttach boneName={plan.bone} offset={plan.offset}>
			<ParticleEmitter
				key={props.layer.art.assetKey}
				config={props.layer.config}
				animated={props.layer.art.animated ?? false}
				textures={spriteTextures}
				weights={spriteWeights}
				{spineParticle}
				emit={emitting}
				emitSpeed={props.emitSpeed}
			/>
		</SpineBoneAttach>
	{:else}
		<Container x={plan.offset.x} y={plan.offset.y}>
			<ParticleEmitter
				key={props.layer.art.assetKey}
				config={props.layer.config}
				animated={props.layer.art.animated ?? false}
				textures={spriteTextures}
				weights={spriteWeights}
				{spineParticle}
				emit={emitting}
				emitSpeed={props.emitSpeed}
			/>
		</Container>
	{/if}
{/if}
