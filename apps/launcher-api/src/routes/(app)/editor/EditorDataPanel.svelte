<script lang="ts">
	/**
	 * The left column's read-only **Data** tab on the Components side (Rive plan Phase 9d): the open
	 * component's interface in one place — inputs (and the signals that fire as triggers), events,
	 * params, and every value a node is bound to (`componentData`). Nothing is edited here; a bound
	 * row selects its node, whose Properties hold the binding.
	 */
	import type { ComponentDef } from 'engine-layout';
	import { componentData, type DataRow } from '$lib/editor/componentData';

	interface Props {
		def: ComponentDef | null;
		/** Select a node on the canvas (a bound value's row). */
		onSelect?: (nodeId: string) => void;
	}
	let { def, onSelect }: Props = $props();

	const data = $derived(def ? componentData(def) : null);
</script>

{#snippet section(title: string, rows: DataRow[], empty: string)}
	<section class="data-section">
		<h4>{title} <small>{rows.length}</small></h4>
		{#each rows as row (row.name + row.kind)}
			<div class="data-row">
				{#if row.nodeId && onSelect}
					<button
						type="button"
						class="data-name link"
						title="Select this node"
						onclick={() => onSelect?.(row.nodeId!)}>{row.name}</button
					>
				{:else}
					<span class="data-name">{row.name}</span>
				{/if}
				<span class="data-kind">{row.kind}</span>
				{#if row.detail}<span class="data-detail">{row.detail}</span>{/if}
			</div>
		{:else}
			<p class="data-empty">{empty}</p>
		{/each}
	</section>
{/snippet}

<div class="data-panel">
	{#if !data}
		<p class="data-empty">Open a component to see its data.</p>
	{:else}
		<p class="data-note">
			Read-only: what Flow and the game see of this component. Edit inputs, events and params in
			Properties; a node's bindings in its own Properties.
		</p>
		{@render section('Inputs', data.inputs, 'No inputs or signals.')}
		{@render section('Events', data.events, 'No events.')}
		{@render section('Params', data.params, 'No params.')}
		{@render section('Bound values', data.bound, 'No node is bound to a value.')}
	{/if}
</div>

<style>
	.data-panel {
		display: flex;
		flex-direction: column;
		gap: 10px;
		font-size: 12px;
	}
	.data-note,
	.data-empty {
		margin: 0;
		color: #777;
		font-size: 11px;
		line-height: 1.4;
	}
	.data-section h4 {
		margin: 0 0 4px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #aab;
	}
	.data-section h4 small {
		color: #666;
	}
	.data-row {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 2px 8px;
		padding: 4px 8px;
		border-radius: 6px;
		background: #16161c;
		border: 1px solid #1f1f28;
		margin-bottom: 2px;
	}
	.data-name {
		color: #e8e8ee;
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}
	.data-name.link {
		background: none;
		border: none;
		padding: 0;
		cursor: pointer;
		text-decoration: underline dotted;
	}
	.data-kind {
		font-size: 10px;
		color: #7ee0c0;
		text-transform: uppercase;
	}
	.data-detail {
		flex-basis: 100%;
		color: #888;
		font-size: 11px;
	}
</style>
