<script lang="ts">
	import { getComponentParams } from 'engine-layout/svelte';

	import HoldAndWinWheelArt from './HoldAndWinWheelArt.svelte';

	/**
	 * The `wheel` component's coded part — the pre-feature wheel (Super Hotfire Diamonds) drawn at the
	 * instance's position and `radius`: the same art and spin as the coded wheel, which steps aside
	 * while this is mounted. Draws nothing until the wheel beat puts a wheel up.
	 */
	// The instance's params, else the bind's own props (a bare scene `bind` sets them there).
	const props: Record<string, unknown> = $props();
	const instanceParams = getComponentParams();
	const radius = $derived.by(() => {
		const value = instanceParams.radius ?? props.radius;
		return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 220;
	});
</script>

<HoldAndWinWheelArt {radius} />
