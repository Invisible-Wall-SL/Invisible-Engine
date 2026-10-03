<script lang="ts">
	import { Container, Rectangle, Text } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import type { SymbolPlaceholder } from '../game/symbolPlaceholder';

	type Props = {
		x?: number;
		y?: number;
		look: SymbolPlaceholder;
		/** The state being drawn: a new one completes again, as a new sprite state does. */
		state: string;
		/** False while a value label draws over the disc, so the two do not overlap. */
		showText?: boolean;
		oncomplete?: () => void;
	};

	const props: Props = $props();
	const context = getContext();

	/**
	 * A coded disc for a pot token or a Hold and Win coin with no art bound (`symbolPlaceholder.ts`),
	 * sized to the live cell like a sprite symbol. It has no animation, so it completes at once, as
	 * a sprite does — a beat waiting on it (a token's `coinLand`) does not sit out its cap.
	 */
	const geometry = $derived(context.stateGameDerived.boardGeometry());
	const size = $derived(Math.min(geometry.cellWidthLocal, geometry.cellHeightLocal) * 0.78);
	const fontSize = $derived(
		Math.min(size * 0.3, (size * 1.5) / Math.max(1, props.look.text.length)),
	);

	$effect(() => {
		void props.state;
		void props.look;
		props.oncomplete?.();
	});
</script>

<Container x={props.x ?? 0} y={props.y ?? 0}>
	<Rectangle
		anchor={0.5}
		width={size}
		height={size}
		borderRadius={size / 2}
		backgroundColor={props.look.fill}
		borderColor={0xffffff}
		borderWidth={Math.max(2, size * 0.04)}
	/>
	{#if props.look.text && props.showText !== false}
		<Text
			anchor={0.5}
			text={props.look.text}
			style={{
				fontFamily: 'Arial',
				fontWeight: 'bold',
				fontSize,
				fill: 0xffffff,
				stroke: { color: 0x000000, width: Math.max(2, fontSize * 0.12) },
			}}
		/>
	{/if}
</Container>
