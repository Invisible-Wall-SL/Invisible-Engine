<script lang="ts">
	import { Rectangle, Text } from 'pixi-svelte';

	// One payline drawn as a mini grid with the line's cells highlighted.
	type Props = {
		line: number[]; // row index per reel
		rows: number; // rows per reel
		x: number;
		y: number;
		cell: number; // cell pitch in px
		label: string;
		accentColor: number;
		fontFamily: string;
	};

	const props: Props = $props();
</script>

<Text
	x={props.x - props.cell * 0.55}
	y={props.y + (props.rows * props.cell) / 2}
	anchor={{ x: 1, y: 0.5 }}
	text={props.label}
	style={{ fontFamily: props.fontFamily, fontSize: props.cell * 0.7, fontWeight: '700', fill: props.accentColor }}
/>

{#each props.line as row, reel}
	{#each Array(props.rows) as _, r}
		{@const on = r === row}
		<Rectangle
			eventMode="none"
			x={props.x + reel * props.cell}
			y={props.y + r * props.cell}
			width={props.cell * 0.88}
			height={props.cell * 0.88}
			borderRadius={props.cell * 0.14}
			backgroundColor={on ? props.accentColor : 0x3a3a3a}
			backgroundAlpha={on ? 1 : 0.55}
		/>
	{/each}
{/each}
