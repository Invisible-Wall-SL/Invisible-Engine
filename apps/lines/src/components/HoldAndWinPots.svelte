<script lang="ts">
	import { Container } from 'pixi-svelte';
	import { BoardContainer, SYMBOL_SIZE } from 'engine-game';

	import HoldAndWinPot from './HoldAndWinPot.svelte';
	import { boardDimensions } from '../game/gameConfig';
	import { configuredMeters } from '../game/holdAndWinMeters.svelte';
	import { cellWindow, getSymbolX } from '../game/stateGame.svelte';

	/**
	 * THE CODED POTS (design §1.3 "Persistent meters") — one level bar per meter the Game Config
	 * declares, in a row above the board, spread across its columns. The default for a project that
	 * authored none: Phase 6's `pots` component binds the same state through the `meter.<id>.level` /
	 * `meter.<id>.max` value sources, and anchors its own pots under the same `meter:<id>` names.
	 *
	 * A game whose config declares no meters mounts nothing here. The container takes a zIndex seat
	 * above the respin board it shares a parent with, so its paint order never depends on which of
	 * the two mounted first.
	 */
	const meters = $derived(configuredMeters());
	const columns = $derived(boardDimensions().x);
	const y = $derived(cellWindow(0, 0).top - SYMBOL_SIZE * 0.75);
	const xFor = (index: number, count: number) => {
		const first = getSymbolX(0);
		const last = getSymbolX(columns - 1);
		return count > 1 ? first + ((last - first) * index) / (count - 1) : (first + last) / 2;
	};
</script>

{#if meters.length > 0}
	<Container zIndex={1}>
		<BoardContainer>
			{#each meters as meter, index (meter.id)}
				<HoldAndWinPot {meter} {index} x={xFor(index, meters.length)} {y} />
			{/each}
		</BoardContainer>
	</Container>
{/if}
