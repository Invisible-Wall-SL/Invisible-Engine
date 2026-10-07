<script lang="ts">
	import { Rectangle, RigProvider, RigTrack } from 'pixi-svelte';
	import { FadeContainer } from 'components-pixi';
	import { SECOND } from 'constants-shared/time';

	import { getContext } from '../game/context';

	const context = getContext();
	const backgroundProps = $derived(
		context.stateLayoutDerived.normalBackgroundLayout({ scale: 0.5 }),
	);
	const showBaseBackground = $derived(context.stateGame.gameType === 'basegame');
	const showFeatureBackground = $derived(context.stateGame.gameType === 'freegame');
</script>

<Rectangle {...context.stateLayoutDerived.canvasSizes()} backgroundColor={0x000000} zIndex={-3} />

<FadeContainer show={showBaseBackground} duration={SECOND} zIndex={-2}>
	<RigProvider key="foregroundAnimation" {...backgroundProps}>
		<RigTrack trackIndex={0} animationName="idle" loop />
	</RigProvider>
	<RigProvider key="foregroundAnimation" {...backgroundProps}>
		<RigTrack trackIndex={0} animationName="dust" loop />
	</RigProvider>
</FadeContainer>

<FadeContainer show={showFeatureBackground} duration={SECOND} zIndex={-1}>
	<RigProvider key="foregroundFeatureAnimation" {...backgroundProps}>
		<RigTrack trackIndex={0} animationName="idle" loop />
	</RigProvider>
	<RigProvider key="foregroundFeatureAnimation" {...backgroundProps}>
		<RigTrack trackIndex={0} animationName="dust" loop />
	</RigProvider>
</FadeContainer>
