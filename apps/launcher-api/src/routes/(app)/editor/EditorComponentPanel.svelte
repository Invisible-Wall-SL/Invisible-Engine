<script lang="ts">
	import type { ComponentCategory, ComponentDef } from 'engine-layout';

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

	const CATEGORIES: { id: ComponentCategory; label: string }[] = [
		{ id: 'ui', label: 'UI' },
		{ id: 'overlay', label: 'Overlay' },
		{ id: 'scenery', label: 'Scenery' },
	];

	/** Components grouped by category, in CATEGORIES order, skipping empty groups. */
	const grouped = $derived(
		CATEGORIES.map((c) => ({
			...c,
			items: components.filter((d) => d.category === c.id),
		})).filter((g) => g.items.length > 0),
	);
</script>

<section class="cmp">
	<div class="tool-link">
		<p class="hint">
			Reusable prefabs (overlays, UI groups, scenery). <strong>Place</strong> one into the active
			scene, or author them in the Component Editor.
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
		{#each grouped as group (group.id)}
			<div class="group">
				<h4>{group.label} <span class="count">{group.items.length}</span></h4>
				<ul>
					{#each group.items as def (def.id)}
						<li>
							<button
								type="button"
								class="cmp-row"
								title={`Open ${def.name} in the Component Editor`}
								onclick={() => onOpenTool(def.id)}
							>
								<span class="glyph">◇</span>
								<span class="name">{def.name}</span>
								<span class="scope" class:project={def.scope === 'project'}>{def.scope}</span>
								<span class="ver">v{def.version}</span>
							</button>
							<button
								type="button"
								class="place"
								title={`Drop a ${def.name} instance into the active scene`}
								onclick={() => onPlace(def)}
							>
								＋ place
							</button>
						</li>
					{/each}
				</ul>
			</div>
		{/each}
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
	h4 {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 4px;
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
