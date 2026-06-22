<script lang="ts">
	import type { ComponentDef } from 'engine-layout';
	import type { Snippet } from 'svelte';

	import { groupComponents } from './componentList.client';

	interface Props {
		/** Components to list (shared + project; project shadows shared). */
		components: ComponentDef[];
		/** Clicking a row's main button — the open path each tool wires up. */
		onRowClick: (def: ComponentDef) => void;
		/** Title for each row's main button (hover hint). */
		rowTitle?: (def: ComponentDef) => string;
		/** Trailing controls for a row (e.g. ＋place or ✕delete). */
		actions: Snippet<[ComponentDef]>;
	}
	let { components, onRowClick, rowTitle, actions }: Props = $props();

	const grouped = $derived(groupComponents(components));
</script>

{#each grouped as group (group.id)}
	<div class="group">
		<h4>{group.label} <span class="count">{group.items.length}</span></h4>
		<ul>
			{#each group.items as def (def.id)}
				<li>
					<button
						type="button"
						class="cmp-row"
						title={rowTitle?.(def)}
						onclick={() => onRowClick(def)}
					>
						<span class="glyph">◇</span>
						<span class="name">{def.name}</span>
						<span class="scope" class:project={def.scope === 'project'}>{def.scope}</span>
						<span class="ver">v{def.version}</span>
					</button>
					{@render actions(def)}
				</li>
			{/each}
		</ul>
	</div>
{/each}

<style>
	h4 {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 4px;
	}
	.count {
		color: #666;
		font-size: 11px;
	}
	.group {
		margin: 0 0 8px;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 4px;
	}
	.cmp-row {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 6px 8px;
		color: #c8c8d0;
		font-size: 12px;
		cursor: pointer;
		font-family: inherit;
	}
	.cmp-row:hover {
		background: #16161c;
		border-color: #1f1f28;
	}
	.glyph {
		color: #c8a3ff;
		font-size: 12px;
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scope {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.scope.project {
		color: #7ee0c0;
	}
	.ver {
		font-size: 10px;
		color: #666;
	}
</style>
