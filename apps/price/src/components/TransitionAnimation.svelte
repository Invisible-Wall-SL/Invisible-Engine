<script lang="ts">
	import { RigProvider, RigTrack } from 'pixi-svelte';
	import { getContext } from '../game/context';

	type Props = {
		oncomplete: () => void;
	};

	const props: Props = $props();
	const context = getContext();
</script>

<RigProvider
	key="transition"
	x={context.stateLayoutDerived.canvasSizes().width * 0.5}
	y={context.stateLayoutDerived.canvasSizes().height * 0.5}
	height={context.stateLayoutDerived.canvasSizes().height * 1.7}
>
	<RigTrack
		trackIndex={0}
		animationName="animation"
		listener={{
			complete: props.oncomplete,
		}}
	/>
</RigProvider>
