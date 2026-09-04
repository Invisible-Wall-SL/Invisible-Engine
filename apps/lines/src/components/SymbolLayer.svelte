<script lang="ts">
	/**
	 * ONE authored symbol-doc LAYER drawn at a board seat — the render half shared by the free-spin
	 * book VFX (`BookVfx.svelte`: looping, two per matching cell) and the explosion → intro
	 * transition (`TumbleBoard.svelte`: played once at every exploding seat). Each kind renders
	 * through the SAME component the game already uses for that asset class — `Sprite`,
	 * `SpineProvider`+`SpineTrack`, `Flipbook`, `EffectPlayer` — so a layer can never look different
	 * here than the symbol path draws it, and the four-kind switch lives in exactly one place.
	 *
	 * The box is the LIVE cell (`boardGeometry`) × the layer's optional `sizeRatios`, offset by
	 * `offset` × cell — the fit hints a book-VFX layer carries; the transition carries none and gets
	 * the plain cell. An FX layer has no intrinsic size to fit (its emitters are authored in absolute
	 * pixels), so for it `sizeRatios` is a SCALE on the authored effect instead (default 1 = as
	 * authored), via a wrapping `<Container>` — the same rule `LayoutNodeView`'s placed effects use.
	 *
	 * `once` is the transition's contract: play through ONE time and report `oncomplete`, so the
	 * caller can unmount. A spine reports its own non-loop `complete`; a flipbook and an FX cannot,
	 * so they are timed off the art — one cycle of the clip's walked frames (the same count
	 * `SymbolFlipbook` reverts a state on) and the effect's longest emit plus its longest particle
	 * lifetime (an unbounded effect gets one transit beat of emission). A binding that resolves to
	 * nothing completes at once rather than sitting on the caller's list until its cap.
	 *
	 * Parity: without `once`, every prop that changes behaviour is passed as `undefined`, which
	 * `pixi-svelte` skips, so the book VFX render exactly as they did before this was factored out.
	 */
	import {
		Container,
		EffectPlayer,
		Flipbook,
		Sprite,
		SpineProvider,
		SpineTrack,
	} from 'pixi-svelte';
	import { flipbookPlaybackFrameCount, resolveFlipbook } from 'engine-layout';
	import { emitterSecondsToWallMs } from 'engine-fx';

	import { getContext } from '../game/context';
	import { TRANSIT_BEAT_CAP_MS } from '../game/symbolBeat';
	import { bakedEffects } from '../editor-scenes';
	import type { BookVfxLayer } from '../editor-scenes';

	type Props = {
		layer: BookVfxLayer;
		/** Board-local seat centre. */
		x: number;
		y: number;
		/** Non-zero flips PixiJS's parent sort on, so the layer interleaves with the symbol containers
		 *  (default z 0) — below them negative, above them positive. */
		zIndex?: number;
		/** The seat's row scale under perspective (`getSymbolSeat`). `1`/absent ⇒ NO scale prop at
		 *  all: `1` is not a no-op in Pixi v8 (it swaps the shared default point for an owned one and
		 *  dirties the transform), and `pixi-svelte` skips an undefined prop — `SymbolWrap`'s rule. */
		scale?: number;
		/** Play once and report `oncomplete` (see above). Absent ⇒ loop, the book-VFX behaviour. */
		once?: boolean;
		oncomplete?: () => void;
	};

	const props: Props = $props();
	const context = getContext();

	const geometry = $derived(context.stateGameDerived.boardGeometry());
	const width = $derived(geometry.cellWidthLocal * (props.layer.sizeRatios?.width ?? 1));
	const height = $derived(geometry.cellHeightLocal * (props.layer.sizeRatios?.height ?? 1));
	const offsetX = $derived((props.layer.offset?.x ?? 0) * geometry.cellWidthLocal);
	const offsetY = $derived((props.layer.offset?.y ?? 0) * geometry.cellHeightLocal);
	const scale = $derived(props.scale === undefined || props.scale === 1 ? undefined : props.scale);

	const clip = $derived(
		props.layer.kind === 'flipbook' && props.layer.clipId
			? resolveFlipbook(props.layer.clipId)
			: undefined,
	);
	const effectDoc = $derived(
		props.layer.kind === 'fx' && props.layer.effectId
			? bakedEffects().find((doc) => doc.id === props.layer.effectId)
			: undefined,
	);

	/** Absent `fps` ⇒ 24, the clip default `SymbolFlipbook` and `<Flipbook>` both assume — and an
	 *  authored `0` too, which would divide the cycle to `Infinity` and unmount it on frame 0. */
	const DEFAULT_FPS = 24;
	/** One cycle of the clip as WALKED — `pingpong` comes back through its interior frames, so
	 *  timing off the authored count would cut the bounce at the turnaround. */
	const clipCycleMs = $derived(
		clip
			? Math.max(
					1,
					Math.round(
						(flipbookPlaybackFrameCount(clip.frames.length, clip.direction) /
							(clip.fps && clip.fps > 0 ? clip.fps : DEFAULT_FPS)) *
							1000,
					),
				)
			: 0,
	);

	/**
	 * How long a one-shot effect EMITS: the longest of its layers' own bounds (an authored
	 * `trigger.duration`, else the config's `emitterLifetime`, both set in the FX tool), and one
	 * transit beat for a layer that has neither — a continuous effect forced from mount would
	 * otherwise emit for the life of the mount, the hole `RiggedEffect`'s `duration` closes.
	 *
	 * `emitterLifetime` and a particle `lifetime` are EMITTER seconds, not wall seconds (one is
	 * ~427 wall-ms at the default emit speed), so both go through `emitterSecondsToWallMs` — the
	 * same conversion `flowV2Runtime` applies to the same field. Under `forceEmit` every layer gets
	 * this ONE `emitFor`, the effect's longest bound; a shorter layer is still stopped early by its
	 * own `emitterLifetime`.
	 */
	const fxEmitMs = $derived.by(() => {
		if (!effectDoc) return 0;
		let ms = 0;
		for (const layer of effectDoc.layers) {
			const lifetime = layer.config.emitterLifetime;
			const own =
				layer.trigger?.duration ??
				(typeof lifetime === 'number' && lifetime > 0
					? emitterSecondsToWallMs(lifetime)
					: undefined);
			ms = Math.max(ms, own ?? TRANSIT_BEAT_CAP_MS);
		}
		return ms;
	});
	/** …plus the longest particle lifetime, so the last particle spawned lives out before unmount. */
	const fxSettleMs = $derived.by(() => {
		if (!effectDoc) return 0;
		let ms = 0;
		for (const layer of effectDoc.layers)
			ms = Math.max(ms, emitterSecondsToWallMs(layer.config.lifetime?.max ?? 0));
		return ms;
	});

	// The timed completions. A spine reports its own `complete` through `SpineTrack`; every other
	// arm — and a binding that resolved to nothing — is timed here. Re-armed when the binding changes.
	$effect(() => {
		if (!props.once) return;
		const { kind, assetKey } = props.layer;
		let ms: number | undefined;
		if (kind === 'flipbook') ms = clipCycleMs;
		else if (kind === 'fx') ms = effectDoc ? fxEmitMs + fxSettleMs : 0;
		else if (kind === 'spine') ms = assetKey ? undefined : 0;
		else ms = 0;
		if (ms === undefined) return;
		const id = setTimeout(() => props.oncomplete?.(), ms);
		return () => clearTimeout(id);
	});
</script>

<Container x={props.x + offsetX} y={props.y + offsetY} zIndex={props.zIndex} {scale}>
	{#if props.layer.kind === 'sprite' && props.layer.assetKey}
		<Sprite anchor={0.5} key={props.layer.assetKey} {width} {height} contain />
	{:else if props.layer.kind === 'spine' && props.layer.assetKey}
		<SpineProvider key={props.layer.assetKey} anchor={0.5} {width} {height}>
			<SpineTrack
				trackIndex={0}
				animationName={props.layer.animationName ?? ''}
				loop={!props.once}
				oncomplete={props.once ? props.oncomplete : undefined}
			/>
		</SpineProvider>
	{:else if clip}
		<Flipbook {clip} anchor={0.5} {width} {height} loop={props.once ? false : undefined} />
	{:else if effectDoc}
		<Container
			scale={{ x: props.layer.sizeRatios?.width ?? 1, y: props.layer.sizeRatios?.height ?? 1 }}
		>
			<EffectPlayer
				doc={effectDoc}
				forceEmit={props.once ? true : undefined}
				emitFor={props.once ? fxEmitMs : undefined}
			/>
		</Container>
	{/if}
</Container>
