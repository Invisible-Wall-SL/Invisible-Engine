<script lang="ts" generics="T">
	import { untrack, type Snippet } from 'svelte';
	import { PAGE_SIZE, pageRows, type PagedRow } from './zones';

	/**
	 * A long table's rows, a page at a time: past {@link PAGE_SIZE} rows a filter box above and
	 * "Show more" / "Show all" below, so a list of a thousand zones renders fifty. The host renders
	 * the table itself (`rows`), so its own styles and controls apply; each row keeps its index in
	 * `items`, which is what a setter takes. A row added at the end is shown wherever it falls, and
	 * the filter is cleared for it; a list that shrinks to a page drops its filter with its box.
	 */
	let {
		items,
		text,
		noun,
		rows,
	}: {
		items: readonly T[];
		/** What the filter searches in a row. */
		text: (item: T) => string;
		/** What a row is, plural ("zones"). */
		noun: string;
		rows: Snippet<[PagedRow<T>[]]>;
	} = $props();

	let filter = $state('');
	let limit = $state(PAGE_SIZE);
	/** The row last added, shown past the limit. */
	let reveal = $state(-1);
	/** The rows there were at the last look; -1 before the first. */
	let seen = -1;
	$effect.pre(() => {
		const count = items.length;
		untrack(() => {
			if (seen >= 0 && count > seen) {
				filter = '';
				reveal = count - 1;
			}
			if (count <= PAGE_SIZE) filter = '';
			seen = count;
		});
	});
	const paged = $derived(items.length > PAGE_SIZE);
	const page = $derived(
		pageRows(items, paged ? filter : '', text, paged ? limit : items.length, reveal),
	);
</script>

{#if paged}
	<div class="pager">
		<input
			type="search"
			placeholder="Filter {noun}"
			aria-label="Filter {noun}"
			bind:value={filter}
			oninput={() => (limit = PAGE_SIZE)}
		/>
		<span class="count"
			>{page.rows.length} of {page.matched}{filter.trim()
				? ` matching, ${page.total} in all`
				: ''}</span
		>
	</div>
{/if}
{#if page.rows.length}
	{@render rows(page.rows)}
{:else if filter.trim()}
	<p class="count">No {noun} match "{filter.trim()}".</p>
{/if}
{#if page.rows.length < page.matched}
	<div class="pager">
		<button class="small" onclick={() => (limit += PAGE_SIZE)}
			>Show {Math.min(PAGE_SIZE, page.matched - page.rows.length)} more</button
		>
		<button class="small" onclick={() => (limit = page.matched)}>Show all {page.matched}</button>
	</div>
{/if}

<style>
	.pager {
		display: flex;
		flex-wrap: wrap;
		gap: 8px 12px;
		align-items: center;
		margin: 0 0 6px;
	}
	input {
		background: #101017;
		border: 1px solid #26262f;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 6px 8px;
		font-size: 13px;
		font-family: inherit;
		box-sizing: border-box;
		width: 200px;
	}
	input:focus {
		outline: none;
		border-color: #7ee0c0;
	}
	.count {
		margin: 0 0 6px;
		font-size: 12px;
		color: #8b8b98;
	}
	.pager .count {
		margin: 0;
	}
	button.small {
		background: #1b2a24;
		border: 1px solid #2f4a3f;
		color: #7ee0c0;
		border-radius: 6px;
		padding: 4px 10px;
		font-size: 11px;
		cursor: pointer;
	}
</style>
