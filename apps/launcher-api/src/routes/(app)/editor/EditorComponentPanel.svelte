<script lang="ts">
	import type { ComponentDef } from 'engine-layout';

	import ComponentList from './ComponentList.svelte';

	interface Props {
		/** Components the project can use (shared + project; project shadows shared). */
		components: ComponentDef[];
		/** Drop a `componentInstance` of this component into the active scene. */
		onPlace: (def: ComponentDef) => void;
		/** Open the standalone Invisible Component Editor (new tab); optionally on a
		 * specific component id. Authoring now lives in that tool, not the editor. */
		onOpenTool: (id?: string) => void;
	}
	let { components, onPlace, onOpenTool }: Props = $props();
</script>

<section class="cmp">
	<div class="tool-link">
		<p class="hint">
			Reusable prefabs (overlays, UI groups, scenery). <strong>Place</strong> one into the active scene,
			or author them in the Component Editor.
		</p>
		<button type="button" class="open-tool" onclick={() => onOpenTool()}>
			◇ Open Component Editor ↗
		</button>
	</div>

	<h3 class="list-h">Components <span class="count">{components.length}</span></h3>
	{#if components.length === 0}
		<p class="muted">
			No components yet. Open the Component Editor to create one, or use "Edit as component" on a
			container in Properties.
		</p>
	{:else}
		<ComponentList
			{components}
			onRowClick={(def) => onOpenTool(def.id)}
			rowTitle={(def) => `Open ${def.name} in the Component Editor`}
		>
			{#snippet actions(def)}
				<button
					type="button"
					class="place"
					title={`Drop a ${def.name} instance into the active scene`}
					onclick={() => onPlace(def)}
				>
					＋ place
				</button>
			{/snippet}
		</ComponentList>
	{/if}
</section>

<style>
	.cmp {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.tool-link {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		border: 1px solid #2a2433;
		border-radius: 8px;
		background: #16131c;
	}
	.open-tool {
		background: #1a1622;
		border: 1px solid #6b5bff;
		color: #c8a3ff;
		padding: 6px 12px;
		font-size: 12px;
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
		align-self: flex-start;
	}
	.open-tool:hover {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.hint {
		color: #888;
		font-size: 11px;
		margin: 0;
		line-height: 1.4;
	}
	h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #aaa;
		margin: 0 0 8px;
	}
	.list-h {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
	}
	.count {
		color: #666;
		font-size: 11px;
	}
	.place {
		background: transparent;
		border: 1px solid #2a2a33;
		color: #c8a3ff;
		padding: 4px 8px;
		font-size: 10px;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
		white-space: nowrap;
	}
	.place:hover {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.muted {
		color: #777;
		font-size: 12px;
		line-height: 1.5;
	}
</style>
