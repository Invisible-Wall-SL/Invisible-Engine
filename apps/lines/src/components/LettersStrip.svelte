<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	import HoldAndWinLetter from './HoldAndWinLetter.svelte';
	import { configuredLetters } from '../game/holdAndWinLetters.svelte';

	/**
	 * The `lettersStrip` component's coded part — Grand's column letters (design §1.3, board end
	 * `columnLetters`), each drawn by the same `HoldAndWinLetter` as the coded row (dim until its
	 * column completes, then lit with a pulse) at `spacing` px, centred on the instance. With the
	 * default spacing (the cell pitch) and the instance centred on the board each letter sits over its
	 * reel. While one is mounted the coded row steps aside (`HoldAndWinLetters`). A project whose board
	 * end is not column letters draws nothing.
	 */
	// The instance's params, else the bind's own props (a bare scene `bind` sets them there).
	const props: Record<string, unknown> = $props();
	const instanceParams = getComponentParams();
	const spacing = $derived.by(() => {
		const value = instanceParams.spacing ?? props.spacing;
		return typeof value === 'number' && Number.isFinite(value) ? value : 120;
	});
	const letters = $derived(configuredLetters());
</script>

<Container>
	{#each letters as letter, reel (reel)}
		<HoldAndWinLetter {reel} {letter} x={(reel - (letters.length - 1) / 2) * spacing} y={0} />
	{/each}
</Container>
