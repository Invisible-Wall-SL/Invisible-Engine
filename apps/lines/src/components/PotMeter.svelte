<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { getComponentParams } from 'engine-layout/svelte';

	import HoldAndWinPot from './HoldAndWinPot.svelte';
	import { configuredMeters } from '../game/holdAndWinMeters.svelte';

	/**
	 * The `potMeter` component's coded part: the pot of the meter its `meter` param names, drawn by the
	 * same `HoldAndWinPot` as the coded pots — the same level (`meter.<id>.level`, a beat's pinned
	 * value while a special flies), size steps, pulse and `meter:<id>` flight anchor — at the instance's
	 * position. While one is mounted the coded pots step aside (`HoldAndWinPots`). A meter the Game
	 * Config does not declare draws nothing.
	 */
	// The instance's params, else the bind's own props (a bare scene `bind` sets them there).
	const props: Record<string, unknown> = $props();
	const instanceParams = getComponentParams();
	const param = (key: string): unknown => instanceParams[key] ?? props[key];
	const meterId = $derived.by(() => {
		const value = param('meter');
		return typeof value === 'string' ? value : '';
	});
	const scale = $derived.by(() => {
		const value = param('scale');
		return typeof value === 'number' && Number.isFinite(value) ? value : 1;
	});
	const meters = $derived(configuredMeters());
	const index = $derived(meters.findIndex((meter) => meter.id === meterId));
</script>

{#if index >= 0}
	<Container {scale}>
		<HoldAndWinPot meter={meters[index]} {index} x={0} y={0} />
	</Container>
{/if}
