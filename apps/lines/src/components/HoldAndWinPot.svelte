<script lang="ts">
	import { Tween } from 'svelte/motion';
	import { backOut } from 'svelte/easing';
	import type { HoldAndWinMeter } from 'game-config';
	import { Anchor, Container, Rectangle, Text } from 'pixi-svelte';
	import { SYMBOL_SIZE } from 'engine-game';

	import {
		meterAnchor,
		meterLevelShown,
		meterMax,
		stateMeterDisplay,
	} from '../game/holdAndWinMeters.svelte';

	type Props = { meter: HoldAndWinMeter; index: number; x: number; y: number };

	const props: Props = $props();

	/**
	 * ONE CODED POT: a level bar with "<ID> level/max" over it and what a full pot activates under it.
	 * It grows a step at each of the meter's size stages and pulses when it fills or is consumed. The
	 * level it draws is {@link meterLevelShown} — the server's, or a beat's pinned value while a
	 * special is in flight — and the flights aim at its `meter:<id>` anchor, the pot's centre.
	 */
	const WIDTH = SYMBOL_SIZE * 0.8;
	const HEIGHT = SYMBOL_SIZE * 0.16;
	const STAGE_GROWTH = 0.1;
	const PULSE_SCALE = 1.3;
	const PALETTE = [0xe0b030, 0x30b0e0, 0xb060e0, 0x60c070];
	const NAMED: Record<string, number> = {
		red: 0xe0452f,
		blue: 0x2f7be0,
		green: 0x3fbf5a,
		gold: 0xe0b030,
		purple: 0x9a4fe0,
	};

	const colour = $derived(NAMED[props.meter.id] ?? PALETTE[props.index % PALETTE.length]);
	const max = $derived(meterMax(props.meter.id) || props.meter.maxLevel);
	const level = $derived(Math.max(0, Math.min(max, meterLevelShown(props.meter.id))));
	const stage = $derived(props.meter.sizeStages.filter((s) => level >= s).length);

	const pulse = new Tween(1);
	let seenPulses = stateMeterDisplay.pulses[props.meter.id] ?? 0;
	$effect(() => {
		const pulses = stateMeterDisplay.pulses[props.meter.id] ?? 0;
		if (pulses === seenPulses) return;
		seenPulses = pulses;
		pulse
			.set(PULSE_SCALE, { duration: 0 })
			.then(() => pulse.set(1, { duration: 500, easing: backOut }));
	});

	const textStyle = (size: number) => ({
		fontFamily: 'Arial',
		fontWeight: 'bold' as const,
		fontSize: size,
		fill: 0xffffff,
		stroke: { color: 0x000000, width: 4 },
	});
</script>

<Container x={props.x} y={props.y} scale={(1 + stage * STAGE_GROWTH) * pulse.current}>
	<Anchor name={meterAnchor(props.meter.id)} />
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
	<Text
		anchor={{ x: 0.5, y: 1 }}
		y={-HEIGHT * 0.65}
		text={`${props.meter.id.toUpperCase()} ${Math.round(level)}/${max}`}
		style={textStyle(SYMBOL_SIZE * 0.14)}
	/>
	<Text
		anchor={{ x: 0.5, y: 0 }}
		y={HEIGHT * 0.65}
		text={props.meter.activates.toUpperCase()}
		style={textStyle(SYMBOL_SIZE * 0.1)}
	/>
</Container>
