<script lang="ts">
	import type { ComponentCategory, ComponentDef } from 'engine-layout';

	interface Props {
		/** Components the project can use (shared + project; project shadows shared). */
		components: ComponentDef[];
		/** True while editing a component's sub-tree (component mode) — drives the
		 * panel's create/open vs back affordances. */
		inComponentMode: boolean;
		/** The component currently open in component mode (for the "editing" header). */
		editingId?: string | null;
		/** Create a fresh component (category + name) and enter component mode on it. */
		onCreate: (name: string, category: ComponentCategory) => void;
		/** Open an existing component for editing (enter component mode on its root). */
		onOpen: (def: ComponentDef) => void;
		/** Drop a `componentInstance` of this component into the active scene. */
		onPlace: (def: ComponentDef) => void;
		/** Leave component mode back to the scene that was active. */
		onBack: () => void;
	}
	let { components, inComponentMode, editingId, onCreate, onOpen, onPlace, onBack }: Props =
		$props();

	const CATEGORIES: { id: ComponentCategory; label: string }[] = [
		{ id: 'ui', label: 'UI' },
		{ id: 'overlay', label: 'Overlay' },
		{ id: 'scenery', label: 'Scenery' },
	];

	let newName = $state('');
	let newCategory = $state<ComponentCategory>('overlay');

	function create(): void {
		const name = newName.trim();
		if (!name) return;
		onCreate(name, newCategory);
		newName = '';
	}

	/** Components grouped by category, in CATEGORIES order, skipping empty groups. */
	const grouped = $derived(
		CATEGORIES.map((c) => ({
			...c,
			items: components.filter((d) => d.category === c.id),
		})).filter((g) => g.items.length > 0),
	);
</script>

<section class="cmp">
	{#if inComponentMode}
		<div class="editing">
			<span class="editing-label">Editing component</span>
			<strong>{components.find((c) => c.id === editingId)?.name ?? editingId}</strong>
			<button type="button" class="back" onclick={onBack}>← Back to scene</button>
		</div>
		<p class="hint">
			Place nodes from the <strong>Library</strong> into the canvas to build this component. Declare
			its engine params + signals in <strong>Properties</strong>. Save from the header.
		</p>
	{:else}
		<div class="create">
			<h3>New component</h3>
			<div class="create-row">
				<input
					type="text"
					placeholder="Component name…"
					bind:value={newName}
					onkeydown={(e) => {
						if (e.key === 'Enter') create();
					}}
				/>
				<select bind:value={newCategory} aria-label="Component category">
					{#each CATEGORIES as c (c.id)}
						<option value={c.id}>{c.label}</option>
					{/each}
				</select>
				<button type="button" class="create-btn" disabled={!newName.trim()} onclick={create}>
					Create
				</button>
			</div>
		</div>

		<h3 class="list-h">Components <span class="count">{components.length}</span></h3>
		{#if components.length === 0}
			<p class="muted">No components yet. Create one above, or use "Edit as component" on a container in Properties.</p>
		{:else}
			{#each grouped as group (group.id)}
				<div class="group">
					<h4>{group.label} <span class="count">{group.items.length}</span></h4>
					<ul>
						{#each group.items as def (def.id)}
							<li>
								<button type="button" class="cmp-row" onclick={() => onOpen(def)}>
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
	{/if}
</section>

<style>
	.cmp {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.editing {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid #2a2433;
		border-radius: 8px;
		background: #16131c;
	}
	.editing-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
	}
	.editing strong {
		color: #c8a3ff;
		font-size: 13px;
	}
	.back {
		margin-left: auto;
		background: transparent;
		border: 1px solid #2a2a33;
		color: #7ee0c0;
		padding: 4px 10px;
		font-size: 11px;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
	}
	.back:hover {
		border-color: #7ee0c0;
	}
	.hint {
		color: #777;
		font-size: 11px;
		margin: 0;
		line-height: 1.4;
	}
	.create {
		padding: 10px;
		border: 1px solid #1f1f28;
		border-radius: 8px;
		background: #0d0d12;
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
	.create-row {
		display: flex;
		gap: 6px;
	}
	.create-row input {
		flex: 1;
		min-width: 0;
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
	}
	.create-row select {
		background: #16131c;
		border: 1px solid #2a2433;
		border-radius: 6px;
		color: #c8a3ff;
		padding: 6px 8px;
		font-size: 12px;
		font-family: inherit;
	}
	.create-btn {
		background: #1a1622;
		border: 1px solid #6b5bff;
		color: #c8a3ff;
		padding: 6px 12px;
		font-size: 12px;
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
	}
	.create-btn:hover:not(:disabled) {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.create-btn:disabled {
		opacity: 0.4;
		cursor: default;
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
