<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { BoardContainer, SYMBOL_SIZE } from 'engine-game';
	import { isComponentMounted } from 'engine-layout/svelte';

	import HoldAndWinPot from './HoldAndWinPot.svelte';
	import { boardDimensions } from '../game/gameConfig';
	import { configuredMeters, potMeterMountKey } from '../game/holdAndWinMeters.svelte';
	import { cellWindow, getSymbolX } from '../game/stateGame.svelte';

	/**
	 * THE CODED POTS (design §1.3 "Persistent meters") — one level bar per meter the Game Config
	 * declares, in a row above the board, spread across its columns. The default for a project that
	 * authored none: each steps aside while an authored `potMeter` draws ITS meter (`PotMeter` counts
	 * itself in per meter), the same pot under the same `meter:<id>` anchor wherever the author put
	 * it — so a pot the author did not place, or placed for an unknown meter id, still draws here.
	 *
	 * A game whose config declares no meters mounts nothing here. The container takes a zIndex seat
	 * above the respin board it shares a parent with, so its paint order never depends on which of
	 * the two mounted first.
	 */
	const meters = $derived(configuredMeters());
	const columns = $derived(boardDimensions().x);
	const y = $derived(cellWindow(0, 0).top - SYMBOL_SIZE * 0.75);
	/** With more pots than columns, pot centres never sit closer than this, so they spread past the
	 *  board's edges instead of overlapping (a pot is `SYMBOL_SIZE * 0.8` wide). Up to one pot per
	 *  column they span the board exactly as they always have. */
	const MIN_SPACING = SYMBOL_SIZE * 0.95;
	const xFor = (index: number, count: number) => {
		const first = getSymbolX(0);
		const last = getSymbolX(columns - 1);
		const centre = (first + last) / 2;
		if (count < 2) return centre;
		const span = count > columns ? Math.max(last - first, MIN_SPACING * (count - 1)) : last - first;
		return centre - span / 2 + (span * index) / (count - 1);
	};
</script>

{#if meters.length > 0}
	<Container zIndex={1}>
		<BoardContainer>
			{#each meters as meter, index (meter.id)}
				{#if !isComponentMounted(potMeterMountKey(meter.id))}
					<HoldAndWinPot {meter} {index} x={xFor(index, meters.length)} {y} />
				{/if}
			{/each}
		</BoardContainer>
	</Container>
{/if}
