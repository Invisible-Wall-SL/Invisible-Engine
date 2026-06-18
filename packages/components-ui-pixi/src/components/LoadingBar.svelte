<script lang="ts">
	import { Container, Sprite, Rectangle, anchorToPivot, getContextApp } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	/**
	 * Progress-bar slice of the split `loadingIntro` component (the loading/intro
	 * analogue of the HUD's `HudValue` / the button's `ButtonFrame`): the one part of
	 * the splash that CAN'T be expressed as a static editor node, because the fill is a
	 * live mask whose width tracks the boot asset-load. Reproduces the coded
	 * `components-pixi/LoadingProgress` masked render — a full-width progress sprite
	 * cropped by a `<Rectangle isMask width={W * loadingProgress/100}>` — so the bar
	 * fills exactly as the original splash did, while the logo / caption / percentage
	 * around it stay editor-native nodes the author can move + restyle.
	 *
	 * Reads the engine param context the `<ComponentInstance>` provides (the def's
	 * `imageBackground`/`imageProgress`/`imageFrame` atlas-frame params + the
	 * `barWidth`/`barHeight` size), so swapping the bar art or size is an editor edit —
	 * no code change. The progress value + done flag come straight off `stateApp`
	 * (`loadingProgress` 0–100, `loaded`), the same source the coded splash read; the
	 * whole bar hides the moment loading completes (the coded `{#if !loaded}`), so the
	 * finished splash shows only the logo + a "press to continue".
	 *
	 * Defaults mirror `apps/lines` `LoadingScreen.svelte` (`1967*0.2 × 346*0.2`, the
	 * `progressBar*.png` frames) so a game shipping those assets renders byte-identical
	 * to the coded bar; a game with different frame keys overrides the params.
	 */

	/** `1967 * 0.2` — the coded splash's progress-bar width. */
	const DEFAULT_BAR_WIDTH = 393.4;
	/** `346 * 0.2` — the coded splash's progress-bar height. */
	const DEFAULT_BAR_HEIGHT = 69.2;

	const params = $derived(getComponentParams());
	const appContext = getContextApp();

	const stringParam = (key: string, fallback: string): string => {
		const value = params[key];
		return typeof value === 'string' && value !== '' ? value : fallback;
	};
	const numberParam = (key: string, fallback: number): number => {
		const value = params[key];
		return typeof value === 'number' ? value : fallback;
	};

	const width = $derived(numberParam('barWidth', DEFAULT_BAR_WIDTH));
	const height = $derived(numberParam('barHeight', DEFAULT_BAR_HEIGHT));
	const imageBackground = $derived(stringParam('imageBackground', 'progressBarBackground.png'));
	const imageProgress = $derived(stringParam('imageProgress', 'progressBar.png'));
	const imageFrame = $derived(stringParam('imageFrame', 'progressBarFrame.png'));

	const sizes = $derived({ width, height });
	// Asset-load progress 0–100 (the coded `LoadingProgress` reads the same field).
	const progress = $derived(appContext.stateApp.loadingProgress);
	const loaded = $derived(appContext.stateApp.loaded);
</script>

{#if !loaded}
	<Container pivot={anchorToPivot({ anchor: { x: 0.5, y: 0 }, sizes })}>
		<Sprite key={imageBackground} {...sizes} />
		<Container>
			<Sprite key={imageProgress} {...sizes} />
			<Rectangle isMask {height} width={width * (progress / 100)} />
		</Container>
		<Sprite key={imageFrame} {...sizes} />
	</Container>
{/if}
