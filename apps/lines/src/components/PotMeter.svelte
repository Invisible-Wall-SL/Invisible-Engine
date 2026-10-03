<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { Anchor, Container } from 'pixi-svelte';
	import { readPotSkin } from 'engine-layout';
	import { getComponentParams, trackComponentMount } from 'engine-layout/svelte';

	import HoldAndWinPot from './HoldAndWinPot.svelte';
	import { configuredMeters, meterAnchor, potMeterMountKey } from '../game/holdAndWinMeters.svelte';

	/**
	 * The `potMeter` component's coded part: the pot of the meter its `meter` param names, drawn by the
	 * same `HoldAndWinPot` as the coded pots — the same level (`meter.<id>.level`, a beat's pinned
	 * value while a special flies), size steps, pulse and `meter:<id>` flight anchor — at the instance's
	 * position. While one is mounted the coded pots step aside (`HoldAndWinPots`). A meter the Game
	 * Config does not declare draws nothing.
	 *
	 * Skinnable (Phase 12c): the instance's art params dress the pot, and the nodes the author put
	 * inside this part arrive as `skin` and draw in the pot's place — the anchor, level, stages,
	 * pulse and the count-in below stay with the part, so a skinned pot is still THE pot.
	 *
	 * A STAND-IN (`standIn`, mounted by `<ComponentInstance>` when the author deleted this part from a
	 * def that `standsFor` it) draws no pot: the author's own nodes are the pot. It still counts in
	 * and registers the `meter:<id>` anchor on the instance, so the coded pot steps aside and the
	 * specials fly to the centre of the author's art.
	 */
	// The instance's params, else the bind's own props (a bare scene `bind` sets them there).
	const {
		skin,
		standIn = false,
		...props
	}: Record<string, unknown> & { skin?: Snippet; standIn?: boolean } = $props();
	const instanceParams = getComponentParams();
	const param = (key: string): unknown => instanceParams[key] ?? props[key];
	const look = $derived(readPotSkin(param));
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
	// Count this meter's pot in only while it draws one, so the coded pots step aside per meter —
	// untracked: counting in reads the count it writes, which would re-run this effect forever.
	$effect(() => {
		if (index < 0) return;
		const key = potMeterMountKey(meterId);
		return untrack(() => trackComponentMount(key));
	});
</script>

{#if index >= 0}
	{#if standIn}
		<Anchor name={meterAnchor(meterId)} />
	{:else}
		<Container {scale}>
			<HoldAndWinPot meter={meters[index]} {index} x={0} y={0} {look} {skin} />
		</Container>
	{/if}
{/if}
