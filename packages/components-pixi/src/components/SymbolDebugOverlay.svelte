<script lang="ts" module>
	import type { Snippet } from 'svelte';

	export type Props = {
		/** Row labels — one row per symbol. */
		symbols: string[];
		/** Column labels — one column per symbol state. */
		states: string[];
		/** The game renders its own symbol for a cell here, keeping this component
		 * engine-agnostic (it never imports a game-specific SYMBOL_INFO_MAP). */
		cell: Snippet<[{ name: string; state: string }]>;
		/** Drives the magenta "not loaded" marker — false ⇒ asset key missing. */
		resolved: (name: string, state: string) => boolean;
		/** Small caption rendered under each cell. */
		label: (name: string, state: string) => string;
		title?: string;
	};
</script>

<script lang="ts">
	import { Container, Rectangle, Text, getContextApp, type TextProps } from 'pixi-svelte';

	const props: Props = $props();

	const app = getContextApp();
	const screen = $derived(app.stateApp.pixiApplication?.screen);
	const canvasWidth = $derived(screen?.width ?? 0);
	const canvasHeight = $derived(screen?.height ?? 0);

	// Cell geometry in grid-local space.
	const CELL = 130;
	const CAPTION_GAP = 18;
	const CELL_W = CELL;
	const CELL_H = CELL + CAPTION_GAP + 8;
	const PADDING = 24;
	const HEADER = 30;

	const columns = $derived(props.states.length);
	const rows = $derived(props.symbols.length);
	const gridWidth = $derived(columns * CELL_W + PADDING * 2);
	const gridHeight = $derived(HEADER + rows * CELL_H + PADDING * 2);

	// EXTENSIBILITY: the whole grid lives under ONE root Container whose transform
	// is driven by `$state`. A future feature (zoom in/out + paylines view) wires
	// its controls into `zoom`/`panX`/`panY` here — no structural change needed.
	let zoom = $state(1);
	let panX = $state(0);
	let panY = $state(0);

	const fitScale = $derived(
		gridWidth && gridHeight ? Math.min(canvasWidth / gridWidth, canvasHeight / gridHeight) : 1,
	);
	const rootScale = $derived(fitScale * zoom);
	const rootX = $derived((canvasWidth - gridWidth * rootScale) / 2 + panX);
	const rootY = $derived((canvasHeight - gridHeight * rootScale) / 2 + panY);

	const labelStyle = (color: number): TextProps['style'] => ({
		fontFamily: 'monospace',
		fontSize: 13,
		fill: color,
		align: 'center',
	});

	type GridCell = {
		name: string;
		state: string;
		resolved: boolean;
		cx: number;
		cy: number;
	};

	const cells = $derived(
		props.symbols.flatMap((name, rowIndex) =>
			props.states.map((state, colIndex) => {
				const cx = PADDING + colIndex * CELL_W + CELL_W / 2;
				const cy = HEADER + PADDING + rowIndex * CELL_H + CELL_H / 2;
				return {
					name,
					state,
					resolved: props.resolved(name, state),
					cx,
					cy,
				} satisfies GridCell;
			}),
		),
	);
</script>

<Container x={rootX} y={rootY} scale={rootScale} zIndex={10000}>
	<Rectangle
		width={gridWidth}
		height={gridHeight}
		backgroundColor={0x0a0a12}
		backgroundAlpha={0.85}
	/>

	<Text
		x={PADDING}
		y={PADDING / 2}
		text={props.title ?? 'SYMBOL DEBUG — magenta = NOT loaded (key missing)'}
		style={labelStyle(0xffffff)}
	/>

	{#each props.states as state, colIndex (state)}
		<Text
			x={PADDING + colIndex * CELL_W + CELL_W / 2}
			y={HEADER}
			anchor={{ x: 0.5, y: 0 }}
			text={state}
			style={labelStyle(0x9fd3ff)}
		/>
	{/each}

	<!-- EXTENSIBILITY: a zoom/pan + paylines toolbar can mount here, bound to the
	`zoom`/`panX`/`panY` state above. -->

	{#each cells as cell (cell.name + '·' + cell.state)}
		{@const top = cell.cy - CELL_H / 2}
		{#if !cell.resolved}
			<Rectangle
				x={cell.cx}
				y={cell.cy}
				anchor={0.5}
				width={CELL_W - 6}
				height={CELL_H - 6}
				backgroundColor={0xff00ff}
				backgroundAlpha={0.6}
			/>
		{/if}

		<Container x={cell.cx} y={top + CELL / 2}>
			{@render props.cell({ name: cell.name, state: cell.state })}
		</Container>

		<Text
			x={cell.cx}
			y={top + CELL}
			anchor={{ x: 0.5, y: 0 }}
			text={props.label(cell.name, cell.state)}
			style={labelStyle(cell.resolved ? 0xffffff : 0xff5555)}
		/>
	{/each}
</Container>
