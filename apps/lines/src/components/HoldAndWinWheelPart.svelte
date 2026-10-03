<script lang="ts">
	import { untrack, type Snippet } from 'svelte';
	import { readWheelSkin, WHEEL_MOUNT } from 'engine-layout';
	import { getComponentParams, trackComponentMount } from 'engine-layout/svelte';

	import HoldAndWinWheelArt from './HoldAndWinWheelArt.svelte';

	/**
	 * The `wheel` component's coded part — the pre-feature wheel (Super Hotfire Diamonds) drawn at the
	 * instance's position and `radius`: the same spin as the coded wheel, and the same art unless the
	 * instance's art params (`WHEEL_SKIN_PARAMS`) swap it. The author's own nodes inside the part
	 * arrive as `skin` and turn with the face. It counts itself in as the wheel, so the coded one
	 * steps aside for any copy, whatever its id. Draws nothing until the wheel beat puts a wheel up.
	 *
	 * A STAND-IN (`standIn`, mounted by `<ComponentInstance>` for a wheel whose def no longer binds
	 * this part) draws nothing: the def's own nodes are the wheel. It still counts in.
	 */
	// The instance's params, else the bind's own props (a bare scene `bind` sets them there).
	const {
		skin,
		standIn = false,
		...props
	}: Record<string, unknown> & { skin?: Snippet; standIn?: boolean } = $props();
	const instanceParams = getComponentParams();
	const param = (key: string): unknown => instanceParams[key] ?? props[key];
	const radius = $derived.by(() => {
		const value = param('radius');
		return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 220;
	});
	const look = $derived(readWheelSkin(param));

	// Untracked: counting in reads the count it writes, which would re-run this effect forever.
	$effect(() => untrack(() => trackComponentMount(WHEEL_MOUNT)));
</script>

{#if !standIn}
	<HoldAndWinWheelArt {radius} {look} {skin} />
{/if}
