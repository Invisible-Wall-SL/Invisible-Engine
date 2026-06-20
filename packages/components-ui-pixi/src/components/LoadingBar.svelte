<script lang="ts">
	import { Container, Sprite, Rectangle, Text, anchorToPivot, getContextApp } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	/**
	 * Progress-bar slice of the split `loadingIntro` component (the loading/intro
	 * analogue of the HUD's `HudValue` / the button's `ButtonFrame`): the one part of
	 * the splash that CAN'T be expressed as a static editor node, because the fill is a
	 * live mask whose width tracks the boot asset-load. Reproduces the coded
	 * `components-pixi/LoadingProgress` masked render — a full-width progress sprite
	 * cropped by a `<Rectangle isMask width={W * loadingProgress/100}>` — so the bar
	 * fills exactly as the original splash did, while the logo around it stays an
	 * editor-native node the author can move + restyle.
	 *
	 * The PERCENTAGE readout lives HERE too (not as a separate editor node): it reads
	 * the SAME live `loadingProgress` the mask does and renders inside the same
	 * `{#if !loaded}`, so the number and the bar appear + vanish as one unit — no
	 * separate node to drift out of sync or linger at "100%". It's optional
	 * (`showPercent`) and styled by params (`percentFill`/`percentFontSize`/
	 * `percentFontFamily`/`percentOffsetY`), so the author shows/hides + restyles it
	 * from the component, exactly like the bar art. A game-bundled bitmap font isn't
	 * resolved here (plain `<Text>` only) — webfonts/system fonts render as authored.
	 *
	 * Reads the engine param context the `<ComponentInstance>` provides (the def's
	 * `imageBackground`/`imageProgress`/`imageFrame` atlas-frame params + the
	 * `barWidth`/`barHeight` size + the `percent*` params), so swapping the bar art,
	 * size, or percentage style is an editor edit — no code change. The progress value
	 * + done flag come straight off `stateApp` (`loadingProgress` 0–100, `loaded`), the
	 * same source the coded splash read; the whole bar (and percentage) hides the moment
	 * loading completes (the coded `{#if !loaded}`), so the finished splash shows only
	 * the logo + a "press to continue".
	 *
	 * Defaults mirror `apps/lines` `LoadingScreen.svelte` (`1967*0.2 × 346*0.2`, the
	 * `progressBar*.png` frames) so a game shipping those assets renders byte-identical
	 * to the coded bar; a game with different frame keys overrides the params.
	 */

	/** `1967 * 0.2` — the coded splash's progress-bar width. */
	const DEFAULT_BAR_WIDTH = 393.4;
	/** `346 * 0.2` — the coded splash's progress-bar height. */
	const DEFAULT_BAR_HEIGHT = 69.2;
	/** Percentage readout defaults — readable at splash scale, white, on the HUD font. */
	const DEFAULT_PERCENT_FONT_SIZE = 40;
	const DEFAULT_PERCENT_FONT_FAMILY = 'proxima-nova';
	const DEFAULT_PERCENT_FILL = 0xffffff;

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
	const boolParam = (key: string, fallback: boolean): boolean => {
		const value = params[key];
		return typeof value === 'boolean' ? value : fallback;
	};

	const width = $derived(numberParam('barWidth', DEFAULT_BAR_WIDTH));
	const height = $derived(numberParam('barHeight', DEFAULT_BAR_HEIGHT));
	const imageBackground = $derived(stringParam('imageBackground', 'progressBarBackground.png'));
	const imageProgress = $derived(stringParam('imageProgress', 'progressBar.png'));
	const imageFrame = $derived(stringParam('imageFrame', 'progressBarFrame.png'));

	// Percentage readout (optional, styled by params; defaults on so the bar shows its
	// own number with no extra setup).
	const showPercent = $derived(boolParam('showPercent', true));
	const percentFill = $derived(numberParam('percentFill', DEFAULT_PERCENT_FILL));
	const percentFontSize = $derived(numberParam('percentFontSize', DEFAULT_PERCENT_FONT_SIZE));
	const percentFontFamily = $derived(
		stringParam('percentFontFamily', DEFAULT_PERCENT_FONT_FAMILY),
	);
	/** Nudge the number off the bar's vertical centre (e.g. to sit below the fill). */
	const percentOffsetY = $derived(numberParam('percentOffsetY', 0));

	const sizes = $derived({ width, height });
	// Asset-load progress 0–100 (the coded `LoadingProgress` reads the same field).
	const progress = $derived(appContext.stateApp.loadingProgress);
	const loaded = $derived(appContext.stateApp.loaded);
	const percentText = $derived(`${Math.round(progress)}%`);
	const percentStyle = $derived({
		fontFamily: percentFontFamily,
		fontSize: percentFontSize,
		fill: percentFill,
	});
</script>

{#if !loaded}
	<Container pivot={anchorToPivot({ anchor: { x: 0.5, y: 0 }, sizes })}>
		<Sprite key={imageBackground} {...sizes} />
		<Container>
			<Sprite key={imageProgress} {...sizes} />
			<Rectangle isMask {height} width={width * (progress / 100)} />
		</Container>
		<Sprite key={imageFrame} {...sizes} />
		{#if showPercent}
			<Text
				text={percentText}
				x={width * 0.5}
				y={height * 0.5 + percentOffsetY}
				anchor={{ x: 0.5, y: 0.5 }}
				style={percentStyle}
			/>
		{/if}
	</Container>
{/if}
