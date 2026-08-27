<script lang="ts">
	import { RiggedEffect, SpineProvider, SpineTrack, type SpineTrackProps } from 'pixi-svelte';
	import { resolveEffect, resolveRigFx } from 'engine-layout';
	import { stateBetDerived } from 'state-shared';

	import { getContext } from '../game/context';
	import { getSymbolInfo } from '../game/utils';
	import { SYMBOL_SPINE_FILL } from 'engine-game';

	type Props = {
		symbolInfo: ReturnType<typeof getSymbolInfo>;
		x?: number;
		y?: number;
		listener: SpineTrackProps['listener'];
		loop?: boolean;
	};

	const props: Props = $props();
	const context = getContext();

	// Contain-fit the rig into the reel's LIVE cell (the SAME source of truth as the
	// mask + sprite art), then apply SYMBOL_SPINE_FILL as the spine-only shrink knob —
	// so a spine symbol tracks the authored cell yet still reads smaller than sprites.
	// No override (and a uniform-scaled board) collapses the cell to SYMBOL_SIZE ⇒ the
	// box is exactly `SYMBOL_SIZE × SYMBOL_SPINE_FILL`, byte-identical to before.
	const geometry = $derived(context.stateGameDerived.boardGeometry());
</script>

<!--
	Spine symbols read visually bigger than sprite icons (a character + badge fills its bounds),
	so we contain-fit the rig's bounds to `cell × SYMBOL_SPINE_FILL` (< 1) to bring them down to
	match the sprites. Spine-only knob — sprites are full contain. Tune SYMBOL_SPINE_FILL.
-->
<SpineProvider
	x={props.x}
	y={props.y}
	key={props.symbolInfo.assetKey}
	width={geometry.cellWidthLocal * SYMBOL_SPINE_FILL}
	height={geometry.cellHeightLocal * SYMBOL_SPINE_FILL}
	fit="contain"
	rebroadcastEvents
>
	<SpineTrack
		loop={props.loop}
		trackIndex={0}
		animationName={props.symbolInfo.animationName}
		timeScale={stateBetDerived.timeScale()}
		listener={props.listener}
	/>
	<!--
		Rig-timeline direct FX binding on the SYMBOL path (mirrors the layout spine branch in
		`engine-layout`'s LayoutNodeView): effects the Rigger bound DIRECTLY on this rig's animation
		event keys (`event.fx`, baked into the `rigFx` manifest). `resolveRigFx` is folder-tolerant, so
		the symbol's `assetKey` resolves whether it ships as the bare folder or the full R2 bundle
		prefix. Empty for a symbol with no bindings (parity — nothing mounts, no bus effect).
	-->
	{@const rigBinds = resolveRigFx(props.symbolInfo.assetKey)}
	{#each rigBinds as b (b.event + ':' + b.effectId + ':' + (b.bone ?? '') + ':' + (b.slot ?? ''))}
		{@const d = resolveEffect(b.effectId)}
		{#if d}
			<RiggedEffect
				doc={d}
				event={b.event}
				bone={b.bone}
				drawSlot={b.slot}
				alpha={b.alpha}
				scale={b.scale}
				delay={b.delay}
				duration={b.duration}
				speed={b.speed}
				continuous={b.continuous}
			/>
		{/if}
	{/each}
</SpineProvider>
