<script lang="ts">
	/**
	 * The actions grid of a character drawn as a RIG: one cell per action and facing, each the
	 * game's own answer (`characterSheetRigGrid.ts` `rigGrid`, over the rigs the page has read).
	 * The same table as Flipbook's clips grid (`$lib/flipbook/FacingGrid.svelte`, which owns the
	 * markup and the styles); what a cell shows is `characterSheetRigCard.ts`'s. An empty cell
	 * shows what it resolves to by name. It edits nothing: the host is told which cell was pressed.
	 */
	import FacingGrid from '$lib/flipbook/FacingGrid.svelte';
	import { cellKey } from '$lib/flipbook/characterSet';
	import { RIG_CELL_MARKS, rigCellLook, rigCellTitle } from './characterSheetRigCard';
	import type { RigGrid, RigGridCell } from './characterSheetRigGrid';

	interface Props {
		grid: RigGrid;
		/** A rig the sheet names is still being read: a cell that draws nothing says so. */
		reading?: boolean;
		onCell?: (cell: RigGridCell) => void;
		/** The `cellKey` of the cell the host has selected. */
		selected?: string;
	}
	let { grid, reading = false, onCell, selected }: Props = $props();
</script>

{#snippet body(cell: RigGridCell)}
	{@const look = rigCellLook(cell)}
	<span class="mark">{look === 'none' && reading ? '…' : RIG_CELL_MARKS[look]}</span>
	{#if cell.animation}
		<span class="fr" data-rig-cell-draws>{cell.animation}{cell.skin ? ` · ${cell.skin}` : ''}</span>
	{:else if cell.unread}
		<span class="fr" data-rig-cell-unread>not read</span>
	{/if}
{/snippet}

<FacingGrid
	drawn={grid.drawn}
	mirrored={grid.mirrored}
	rows={grid.rows}
	look={rigCellLook}
	named={(cell) => cell.how === 'cell'}
	idOf={cellKey}
	keyOf={cellKey}
	titleOf={(cell) => rigCellTitle(cell, reading)}
	{body}
	onPress={onCell}
	selectable={!!onCell}
	{selected}
/>
