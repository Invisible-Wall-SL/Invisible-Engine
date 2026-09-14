<script lang="ts" module>
	import type { CoverFit } from 'engine-layout';

	/** Doc-driven background cover intent (§10), passed by the game from the editor
	 * doc. `scale` = uniform cover zoom (1 = exact edge-to-edge), `fit` = how the art is
	 * fitted (cover / contain / pinned to the width or height axis), `stretch` = free
	 * per-axis stretch on top, `anchor` = where the fitted art sits in the window
	 * (0.5 = centred). Absent = full-bleed centred cover. */
	export type BackgroundCover = {
		scale?: number;
		fit?: CoverFit;
		stretch?: { x: number; y: number };
		anchor?: { x: number; y: number };
	};
</script>

<script lang="ts">
	import { Rectangle, SpineProvider, SpineTrack, getContextApp } from 'pixi-svelte';
	import { coverAnchorOffset } from 'engine-layout';
	import { FadeContainer } from 'components-pixi';
	import { SECOND } from 'constants-shared/time';
	import { stateUi } from 'state-shared';

	import { getGameContext } from '../game/context';

	const { cover }: { cover?: BackgroundCover } = $props();

	const context = getGameContext();

	// The drifting `dust` smoke is ambient atmosphere. While a full-screen tap-to-continue overlay is
	// up (`continuePressCount > 0` — a retrigger celebration, the intro/outro gates), it sits behind
	// that overlay's dim and reads as murky haze over the celebration. Fade it out for the duration of
	// the gate so the dimmed board stays clean; the static `idle` background is untouched. No gate
	// active ⇒ `showDust` is true ⇒ byte-identical to before (the dust always played).
	const showDust = $derived(stateUi.continuePressCount === 0);

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
	const coverAnchor = $derived(cover?.anchor ?? { x: 0.5, y: 0.5 });
	const appContext = getContextApp();
	/**
	 * Cover props for ONE background rig. The anchor ALIGNS the fitted art in the window
	 * (0.5 = centred = every existing doc ⇒ a zero offset ⇒ byte-identical); `SpineProvider`
	 * sizes the rig from `skeleton.data`, so the shift is computed from those same dims via the
	 * shared `coverAnchorOffset` — the one formula the sprite/component covers use, so the
	 * coded background cannot align differently from an authored one. Dims unknown (bundle not
	 * loaded yet) ⇒ no shift, so the rig never jumps on load.
	 */
	const backgroundPropsFor = (key: string) => {
		const canvas = context.stateLayoutDerived.canvasSizes();
		const data = appContext.stateApp.loadedAssets?.[key] as
			| { width?: number; height?: number }
			| undefined;
		const artWidth = data?.width ?? 0;
		const artHeight = data?.height ?? 0;
		const offset =
			artWidth > 0 && artHeight > 0
				? coverAnchorOffset({
						artWidth,
						artHeight,
						targetWidth: canvas.width,
						targetHeight: canvas.height,
						coverScale,
						stretchX: coverStretch.x,
						stretchY: coverStretch.y,
						fit: coverFit,
						anchorX: coverAnchor.x,
						anchorY: coverAnchor.y,
					})
				: { dx: 0, dy: 0 };
		return {
			x: canvas.width / 2 + offset.dx,
			y: canvas.height / 2 + offset.dy,
			width: canvas.width * coverScale,
			height: canvas.height * coverScale,
			fit: coverFit,
			scale: coverStretch,
		};
	};
	const baseBackgroundProps = $derived(backgroundPropsFor('foregroundAnimation'));
	const featureBackgroundProps = $derived(backgroundPropsFor('foregroundFeatureAnimation'));
	const showBaseBackground = $derived(context.stateGame.gameType === 'basegame');
	const showFeatureBackground = $derived(context.stateGame.gameType === 'freegame');
</script>

<Rectangle {...context.stateLayoutDerived.canvasSizes()} backgroundColor={0x000000} zIndex={-3} />

<FadeContainer show={showBaseBackground} duration={SECOND} zIndex={-2}>
	<SpineProvider key="foregroundAnimation" {...baseBackgroundProps}>
		<SpineTrack trackIndex={0} animationName="idle" loop />
	</SpineProvider>
</FadeContainer>
<FadeContainer show={showBaseBackground && showDust} duration={SECOND} zIndex={-2}>
	<SpineProvider key="foregroundAnimation" {...baseBackgroundProps}>
		<SpineTrack trackIndex={0} animationName="dust" loop />
	</SpineProvider>
</FadeContainer>

<FadeContainer show={showFeatureBackground} duration={SECOND} zIndex={-1}>
	<SpineProvider key="foregroundFeatureAnimation" {...featureBackgroundProps}>
		<SpineTrack trackIndex={0} animationName="idle" loop />
	</SpineProvider>
</FadeContainer>
<FadeContainer show={showFeatureBackground && showDust} duration={SECOND} zIndex={-1}>
	<SpineProvider key="foregroundFeatureAnimation" {...featureBackgroundProps}>
		<SpineTrack trackIndex={0} animationName="dust" loop />
	</SpineProvider>
</FadeContainer>
