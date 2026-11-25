<script lang="ts" generics="T">
	import IconButton from '$lib/ui/IconButton.svelte';
	import PagedRows from './PagedRows.svelte';

	/**
	 * A generated game's STORED SNAPSHOT: rows its config holds from one level, which no room plays
	 * (each room's generator makes its own). Said in one line; the rows themselves are read-only,
	 * behind a fold, and nothing of them renders until it is opened.
	 */
	let {
		items,
		noun,
		columns,
		cells,
	}: {
		items: readonly T[];
		/** What a row is, plural ("zones"). */
		noun: string;
		columns: string[];
		/** A row's cells, as text. */
		cells: (item: T) => string[];
	} = $props();

	let open = $state(false);
</script>

<div class="line">
	<IconButton
		icon="chevron"
		expanded={open}
		label={open ? 'Hide the snapshot' : 'Show the snapshot'}
		onclick={() => (open = !open)}
	/>
	<span class="readonly"
		>The config also stores {items.length.toLocaleString('en')}
		{noun} from one level: a snapshot no room plays.</span
	>
</div>
{#if open}
	<PagedRows {items} {noun} text={(item) => cells(item).join(' ')}>
		{#snippet rows(page)}
			<table class="tbl">
				<thead>
					<tr>
						{#each columns as column (column)}<th>{column}</th>{/each}
					</tr>
				</thead>
				<tbody>
					{#each page as { item, index } (index)}
						<tr>
							{#each cells(item) as cell, c (c)}<td>{cell}</td>{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		{/snippet}
	</PagedRows>
{/if}

<style>
	.line {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		margin: 6px 0;
	}
	.readonly {
		font-size: 12px;
		color: #8b8b98;
	}
	.tbl {
		border-collapse: collapse;
		margin-bottom: 6px;
	}
	.tbl th {
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: #8b8b98;
		padding: 4px 8px;
		text-align: left;
		border-bottom: 1px solid #1c1c24;
	}
	.tbl td {
		padding: 4px 8px;
		border-bottom: 1px solid #16161d;
		font-size: 12px;
		color: #b9b9c4;
	}
</style>
