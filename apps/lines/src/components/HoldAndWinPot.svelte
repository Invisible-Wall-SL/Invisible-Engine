<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import type { ResolvedMeter } from 'game-config';
	import { Anchor, Container, getContextApp, Rectangle, Sprite } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';
	import {
		fillMaskRect,
		parseScopedFrameRef,
		potBodyImage,
		potFillShare,
		potHasArt,
		readPotSkin,
		type PotSkin,
	} from 'engine-layout';
	import { CatalogText } from 'engine-layout/svelte';

	import { potActivatesText, potLabelText } from '../game/holdAndWinText';
	import {
		meterAnchor,
		meterLevelShown,
		meterMax,
		meterStage,
		stateMeterDisplay,
	} from '../game/holdAndWinMeters.svelte';

	type Props = {
		meter: ResolvedMeter;
		index: number;
		x: number;
		y: number;
		/** An authored pot's art, label and motion params; absent ⇒ the coded pot. */
		look?: PotSkin;
		/** The author's own nodes inside the part: they replace the bar and both labels. */
		skin?: Snippet;
	};

	const props: Props = $props();

	/**
	 * ONE CODED POT: a level bar with "<ID> level/max" over it and what a full pot activates under it.
	 * It grows a step at each of the meter's size stages and pulses when it fills or is consumed. The
	 * level it draws is {@link meterLevelShown} — the server's, or a beat's pinned value while a
	 * special is in flight — and the flights aim at its `meter:<id>` anchor, the pot's centre.
	 *
	 * An authored pot (Phase 12c) swaps the bar for its art — the pot body per size stage, a fill
	 * image revealed by the level, a frame over it — and its own nodes replace the bar and the labels.
	 * The level, stages, pulse and anchor stay here either way, so the skin grows, pulses and catches
	 * the flights exactly as the coded pot does.
	 */
	const WIDTH = SYMBOL_SIZE * 0.8;
	const HEIGHT = SYMBOL_SIZE * 0.16;
	const LABEL_GAP = HEIGHT * 0.15;
	const CENTRE = { x: 0.5, y: 0.5 };
	const CODED_LOOK = readPotSkin(() => undefined);
	const PALETTE = [0xe0b030, 0x30b0e0, 0xb060e0, 0x60c070];
	const NAMED: Record<string, number> = {
		red: 0xe0452f,
		blue: 0x2f7be0,
		green: 0x3fbf5a,
		gold: 0xe0b030,
		purple: 0x9a4fe0,
	};

	const look = $derived(props.look ?? CODED_LOOK);
	const colour = $derived(NAMED[props.meter.id] ?? PALETTE[props.index % PALETTE.length]);
	const max = $derived(meterMax(props.meter.id) || props.meter.maxLevel);
	const level = $derived(Math.max(0, Math.min(max, meterLevelShown(props.meter.id))));
	const stage = $derived(meterStage(props.meter, level));

	const hasArt = $derived(potHasArt(look));
	const body = $derived(potBodyImage(look, stage));
	const fillShare = $derived(potFillShare(level, max));

	// A picked frame is `<assetKey>::<region>`: the scoped key first, then the bare region — the
	// same lookup `LayoutNodeView` and the HUD readout's background make.
	const app = getContextApp();
	const fallbackKey = (key: string) => parseScopedFrameRef(key).region || undefined;
	const imageSize = (key: string | undefined) => {
		if (!key) return undefined;
		const assets = app.stateApp.loadedAssets;
		const fallback = fallbackKey(key);
		const texture = (assets?.[key] ?? (fallback ? assets?.[fallback] : undefined)) as
			{ width?: number; height?: number } | undefined;
		return texture?.width && texture.height
			? { width: texture.width, height: texture.height }
			: undefined;
	};
	/** The box an art layer draws in: the authored size, else the image's own. */
	const layerBox = (key: string | undefined) => {
		const own = imageSize(key);
		const width = look.width ?? own?.width;
		const height = look.height ?? own?.height;
		return width && height ? { width, height } : undefined;
	};
	const fillBox = $derived(layerBox(look.fill));
	const fillRect = $derived(
		fillBox && fillShare > 0
			? fillMaskRect(fillBox.width, fillBox.height, CENTRE, fillShare, look.fillDirection)
			: undefined,
	);
	// The labels clear the art's box as they clear the coded bar.
	const boxHeight = $derived(
		hasArt
			? (layerBox(body)?.height ?? fillBox?.height ?? layerBox(look.frame)?.height ?? HEIGHT)
			: HEIGHT,
	);

	const pulse = new Tween(1);
	let seenPulses = stateMeterDisplay.pulses[props.meter.id] ?? 0;
	$effect(() => {
		const pulses = stateMeterDisplay.pulses[props.meter.id] ?? 0;
		if (pulses === seenPulses) return;
		seenPulses = pulses;
		pulse
			.set(look.pulseScale, { duration: 0 })
			.then(() => pulse.set(1, { duration: 500, easing: backOut }));
	});

	const textStyle = (size: number) => ({
		fontFamily: look.labelFontFamily ?? 'Arial',
		fontWeight: 'bold' as const,
		fontSize: size * look.labelScale,
		fill: look.labelFill ?? 0xffffff,
		stroke: { color: 0x000000, width: 4 },
	});
</script>

{#snippet art()}
	<!-- One always-mounted container per layer: pixi-svelte appends a child when it MOUNTS, so a layer
	     that appears later (the fill at the first level, a stage body) must not land above the frame,
	     the author's nodes or the labels. -->
	<Container>
		{#if body}
			<Sprite
				key={body}
				fallbackKey={fallbackKey(body)}
				anchor={0.5}
				width={look.width}
				height={look.height}
			/>
		{/if}
	</Container>
	<Container>
		{#if look.fill && fillRect}
			<Container>
				<Sprite
					key={look.fill}
					fallbackKey={fallbackKey(look.fill)}
					anchor={0.5}
					width={look.width}
					height={look.height}
				/>
				<Rectangle isMask {...fillRect} />
			</Container>
		{/if}
	</Container>
	<Container>
		{#if look.frame}
			<Sprite
				key={look.frame}
				fallbackKey={fallbackKey(look.frame)}
				anchor={0.5}
				width={look.width}
				height={look.height}
			/>
		{/if}
	</Container>
{/snippet}

<Container x={props.x} y={props.y} scale={(1 + stage * look.stageGrowth) * pulse.current}>
	<Anchor name={meterAnchor(props.meter.id)} />
	{#if hasArt}
		{@render art()}
	{:else if !props.skin}
		<Rectangle
			anchor={0.5}
			width={WIDTH}
			height={HEIGHT}
			borderRadius={HEIGHT / 2}
			backgroundColor={0x000000}
			backgroundAlpha={0.6}
			borderColor={colour}
			borderWidth={3}
		/>
		{#if level > 0 && max > 0}
			<Rectangle
				x={-WIDTH / 2}
				anchor={{ x: 0, y: 0.5 }}
				width={(WIDTH * level) / max}
				height={HEIGHT}
				borderRadius={HEIGHT / 2}
				backgroundColor={colour}
			/>
		{/if}
	{/if}
	{#if props.skin}
		{@render props.skin()}
	{:else}
		{#if look.showLevel}
			<CatalogText
				anchor={{ x: 0.5, y: 1 }}
				y={-(boxHeight / 2 + LABEL_GAP)}
				text={potLabelText(props.meter.id, Math.round(level), max)}
				style={textStyle(SYMBOL_SIZE * 0.14)}
			/>
		{/if}
		{#if look.showActivates}
			<CatalogText
				anchor={{ x: 0.5, y: 0 }}
				y={boxHeight / 2 + LABEL_GAP}
				text={props.meter.bonus.activates ? potActivatesText(props.meter.bonus.activates) : ''}
				style={textStyle(SYMBOL_SIZE * 0.1)}
			/>
		{/if}
	{/if}
</Container>
