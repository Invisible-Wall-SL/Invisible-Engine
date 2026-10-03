<script lang="ts">
	import { untrack } from 'svelte';
	import { Circle, Container, Text } from 'pixi-svelte';

	import { getContext } from '../game/context';
	import type { SymbolPlaceholder } from '../game/symbolPlaceholder';

	type Props = {
		x?: number;
		y?: number;
		look: SymbolPlaceholder;
		/** The state being drawn: a new one is a fresh beat to complete. */
		state: string;
		/** False while a value label draws over the disc, so the two do not overlap. */
		showText?: boolean;
		oncomplete?: () => void;
	};

	const props: Props = $props();
	const context = getContext();

	/**
	 * A coded disc for a pot token or a Hold and Win coin with no art bound (`symbolPlaceholder.ts`),
	 * sized to the live cell like a sprite symbol. It has no animation, so a beat completes after
	 * {@link PLACEHOLDER_HOLD_MS} rather than in the same flush: a token's `coinLand` would otherwise
	 * end at once and its flight leave the next frame, so the disc was never seen on its cell (the
	 * reason `SymbolFlipbook` holds a missing clip too).
	 */
	const PLACEHOLDER_HOLD_MS = 400;
	const geometry = $derived(context.stateGameDerived.boardGeometry());
	const size = $derived(Math.min(geometry.cellWidthLocal, geometry.cellHeightLocal) * 0.78);
	const fontSize = $derived(
		Math.min(size * 0.3, (size * 1.5) / Math.max(1, props.look.text.length)),
	);

	$effect(() => {
		void props.state;
		void props.look;
		const id = setTimeout(() => untrack(() => props.oncomplete?.()), PLACEHOLDER_HOLD_MS);
		return () => clearTimeout(id);
	});
</script>

<Container x={props.x ?? 0} y={props.y ?? 0}>
	<Circle
		anchor={0.5}
		diameter={size}
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
