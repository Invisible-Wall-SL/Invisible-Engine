<script lang="ts">
	import { RigProvider, RigTrack, type RigTrackProps } from 'pixi-svelte';
	import { stateBetDerived } from 'state-shared';

	import { SYMBOL_SIZE } from '../game/constants';

	type Props = {
		loop: RigTrackProps['loop'];
		listener?: RigTrackProps['listener'];
		animationName: RigTrackProps['animationName'];
	};

	const props: Props = $props();
</script>

<RigProvider key="symbols" width={SYMBOL_SIZE * 1.2} height={SYMBOL_SIZE * 1.3}>
	<RigTrack
		trackIndex={0}
		timeScale={stateBetDerived.timeScale()}
		loop={props.loop}
		listener={props.listener}
		animationName={props.animationName}
	/>
</RigProvider>
