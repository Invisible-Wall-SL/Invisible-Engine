<script lang="ts">
	import { SpineProvider, SpineTrack } from 'pixi-svelte';
	import { getGameContext } from '../game/context';

	type Props = {
		oncomplete: () => void;
		/** Spine position. Defaults to canvas-centre (the coded overlay's hardcode); the
		 * editor-owned `componentInstance` path passes `0,0` so the instance node's
		 * transform places the wipe (see `boundToInstance`). Height stays viewport-relative
		 * either way, so sizing is unchanged. */
		x?: number;
		y?: number;
	};

	const props: Props = $props();
	const context = getGameContext();

	const x = $derived(props.x ?? context.stateLayoutDerived.canvasSizes().width * 0.5);
	const y = $derived(props.y ?? context.stateLayoutDerived.canvasSizes().height * 0.5);
</script>

<SpineProvider
	key="transition"
	{x}
	{y}
	height={context.stateLayoutDerived.canvasSizes().height * 1.7}
>
	<SpineTrack
		trackIndex={0}
		animationName="animation"
		listener={{
			complete: props.oncomplete,
		}}
	/>
</SpineProvider>
