<script lang="ts" generics="T extends { facing: string }">
	/**
	 * A grid of cells, one per row and facing: rows down (a character's states, a sheet's actions),
	 * facings across in two groups, the ones drawn and the ones the game mirrors (the second group
	 * absent when nothing is mirrored). The shell of Flipbook's clips grid
	 * (`CharacterClipsGrid.svelte`) and of Invisible Characters' rig grid
	 * (`$lib/characters/RigActionsGrid.svelte`): it owns the table, the cell's box in its four looks
	 * (`made`, `mirrored`, `standIn`, `none`), the double border of a cell the sheet names and the
	 * selected outline. The host says what a cell is and renders what is inside it (`body`: a
	 * `.mark` glyph, `.fr` small text, a `.dot`).
	 */
	import type { Snippet } from 'svelte';

	interface Row {
		state: string;
		name?: string;
		loop: boolean;
		once: boolean;
		/** What starts it, in words, for the row's tooltip. */
		plays: string[];
		cells: T[];
	}
	interface Props {
		drawn: readonly string[];
		mirrored: readonly string[];
		rows: readonly Row[];
		/** A cell's look: one of `made`, `mirrored`, `standIn`, `none`. */
		look: (cell: T) => string;
		/** The sheet names what this cell draws. */
		named: (cell: T) => boolean;
		/** The cell's `data-cell`. */
		idOf: (cell: T) => string;
		/** The key `selected` is compared with. */
		keyOf: (cell: T) => string;
		titleOf: (cell: T) => string;
		body: Snippet<[T]>;
		/** With it every cell is a button. */
		onPress?: (cell: T) => void;
		/** A cell that cannot be pressed is a disabled button. */
		pressable?: (cell: T) => boolean;
		/** Cells are selectable: the one whose key is `selected` is outlined and pressed. */
		selectable?: boolean;
		selected?: string;
	}
	let {
		drawn,
		mirrored,
		rows,
		look,
		named,
		idOf,
		keyOf,
		titleOf,
		body,
		onPress,
		pressable,
		selectable = false,
		selected,
	}: Props = $props();

	function rowTitle(row: Row): string {
		return row.plays.length
			? `Played on: ${row.plays.join(', ')}`
			: 'Nothing starts it: it only stands in for another action.';
	}
</script>

{#snippet cellView(cell: T)}
	{#if onPress && selectable}
		<button
			class="cell {look(cell)}"
			class:named={named(cell)}
			class:selected={selected === keyOf(cell)}
			aria-pressed={selected === keyOf(cell)}
			title={titleOf(cell)}
			data-cell={idOf(cell)}
			onclick={() => onPress(cell)}
		>
			{@render body(cell)}
		</button>
	{:else if onPress}
		<button
			class="cell {look(cell)}"
			class:named={named(cell)}
			title={titleOf(cell)}
			disabled={pressable ? !pressable(cell) : false}
			data-cell={idOf(cell)}
			onclick={() => onPress(cell)}
		>
			{@render body(cell)}
		</button>
	{:else}
		<div
			class="cell {look(cell)}"
			class:named={named(cell)}
			title={titleOf(cell)}
			data-cell={idOf(cell)}
		>
			{@render body(cell)}
		</div>
	{/if}
{/snippet}

<div class="scroll">
	<table class="grid">
		<thead>
			<tr>
				<th></th>
				<th class="group" colspan={drawn.length}>You draw</th>
				{#if mirrored.length}
					<th class="gap"></th>
					<th class="group mirror" colspan={mirrored.length}>The game mirrors</th>
				{/if}
			</tr>
			<tr>
				<th></th>
				{#each drawn as facing (facing)}<th class="facing">{facing}</th>{/each}
				{#if mirrored.length}<th class="gap"></th>{/if}
				{#each mirrored as facing (facing)}<th class="facing">{facing}</th>{/each}
			</tr>
		</thead>
		<tbody>
			{#each rows as row (row.state)}
				<tr>
					<th scope="row" title={rowTitle(row)} data-row={row.state}>
						<b>{row.state}</b>
						{#if row.name}<span class="named-as">{row.name}</span>{/if}
						<span class="role">{row.loop ? 'loop' : row.once ? 'once' : 'stands in'}</span>
					</th>
					{#each row.cells as cell, i (cell.facing)}
						{#if i === drawn.length}<td class="gap"></td>{/if}
						<td>{@render cellView(cell)}</td>
					{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}
	.grid {
		border-collapse: separate;
		border-spacing: 4px;
		font-size: 12px;
	}
	.grid th {
		font-weight: 400;
		color: #94a3b8;
		text-align: left;
		white-space: nowrap;
	}
	.grid th.group {
		padding: 2px 6px;
		border-bottom: 2px solid #2f6b5b;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #7ee0c0;
		text-align: center;
	}
	.grid th.group.mirror {
		border-bottom-color: #2f5273;
		color: #93c5fd;
	}
	.grid .facing {
		text-align: center;
		text-transform: uppercase;
		font-size: 11px;
		color: #cbd5e1;
	}
	.grid .gap {
		width: 14px;
	}
	.grid th[scope='row'] b {
		color: #e2e8f0;
		font-family: ui-monospace, monospace;
	}
	.named-as {
		margin-left: 6px;
		color: #cbd5e1;
	}
	.role {
		margin-left: 6px;
		font-size: 10px;
		color: #64748b;
	}
	.cell {
		position: relative;
		box-sizing: border-box;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		width: 100%;
		min-width: 62px;
		height: 30px;
		padding: 0 6px;
		border-radius: 6px;
		border: 1px solid #1f2937;
		background: #10161e;
		color: #cbd5e1;
		font-size: 12px;
		white-space: nowrap;
	}
	button.cell {
		cursor: pointer;
	}
	button.cell:disabled {
		cursor: default;
	}
	.cell.made {
		border-color: #2f6b5b;
		color: #7ee0c0;
	}
	.cell.mirrored {
		border-color: #2f5273;
		border-style: dashed;
		color: #93c5fd;
	}
	.cell.standIn {
		border-color: #7a5a1e;
		border-style: dashed;
		color: #fbbf24;
	}
	.cell.none {
		color: #475569;
	}
	.cell.named {
		border-style: double;
		border-width: 3px;
	}
	.cell.selected {
		outline: 2px solid #2563eb;
		outline-offset: 1px;
	}
	.cell :global(.fr) {
		font-size: 10px;
		font-family: ui-monospace, monospace;
		opacity: 0.85;
	}
	.cell :global(.dot) {
		position: absolute;
		top: 3px;
		right: 3px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #f87171;
	}
</style>
