<script lang="ts" module>
	/** Doc-driven background cover intent (§10), passed by the game from the editor
	 * doc. `scale` = uniform cover zoom (1 = exact edge-to-edge), `fit` = cover/contain,
	 * `stretch` = free per-axis stretch on top. Absent = full-bleed cover. */
	export type BackgroundCover = {
		scale?: number;
		fit?: 'cover' | 'contain';
		stretch?: { x: number; y: number };
	};
</script>

<script lang="ts">
	import { Rectangle, SpineProvider, SpineTrack } from 'pixi-svelte';
	import { FadeContainer } from 'components-pixi';
	import { SECOND } from 'constants-shared/time';

	import { getContext } from '../game/context';

	const { cover }: { cover?: BackgroundCover } = $props();

	const context = getContext();

	// True full-bleed cover (§10): size each background spine to the WHOLE canvas via
	// pixi-svelte's `fit` (uniform cover/contain from the skeleton's authored dims),
	// instead of the old half-size, ratio-driven `normalBackgroundLayout({ scale: 0.5 })`.
	// Defaults to exact edge-to-edge cover (scale 1, fit 'cover', stretch {1,1}); the
	// editor's doc-driven cover scale/fit/stretch override it when provided. The free
	// per-axis stretch rides on the `scale` prop, which `SpineProvider` multiplies onto
	// the `fit` scale — default stretch {1,1} is identical to plain cover.
	const coverScale = $derived(cover?.scale ?? 1);
	const coverFit = $derived(cover?.fit ?? 'cover');
	const coverStretch = $derived(cover?.stretch ?? { x: 1, y: 1 });
	const backgroundProps = $derived.by(() => {
		const canvas = context.stateLayoutDerived.canvasSizes();
		return {
			x: canvas.width / 2,
			y: canvas.height / 2,
			width: canvas.width * coverScale,
			height: canvas.height * coverScale,
			fit: coverFit,
			scale: coverStretch,
		};
	});
	const showBaseBackground = $derived(context.stateGame.gameType === 'basegame');
	const showFeatureBackground = $derived(context.stateGame.gameType === 'freegame');
</script>

<Rectangle {...context.stateLayoutDerived.canvasSizes()} backgroundColor={0x000000} zIndex={-3} />

<FadeContainer show={showBaseBackground} duration={SECOND} zIndex={-2}>
	<SpineProvider key="foregroundAnimation" {...backgroundProps}>
		<SpineTrack trackIndex={0} animationName={'idle'} loop />
	</SpineProvider>
	<SpineProvider key="foregroundAnimation" {...backgroundProps}>
		<SpineTrack trackIndex={0} animationName={'dust'} loop />
	</SpineProvider>
</FadeContainer>

<FadeContainer show={showFeatureBackground} duration={SECOND} zIndex={-1}>
	<SpineProvider key="foregroundFeatureAnimation" {...backgroundProps}>
		<SpineTrack trackIndex={0} animationName={'idle'} loop />
	</SpineProvider>
	<SpineProvider key="foregroundFeatureAnimation" {...backgroundProps}>
		<SpineTrack trackIndex={0} animationName={'dust'} loop />
	</SpineProvider>
</FadeContainer>
