<script lang="ts">
	import MenuButton, { type MenuGroup } from '$lib/MenuButton.svelte';
	import { writeDrag } from '$lib/graph/dnd';
	import { SHADER_DROP_MIME, libraryGroups, twinGroups } from './shaderEditor';

	// The left pane: the project's graphs (its own and the studio's shared ones it does not
	// override), then the node library by family. A node is dragged onto the canvas, or clicked to
	// add it beside the selected node.
	interface GraphRow {
		id: string;
		name: string;
		description: string;
		shared: boolean;
	}
	interface Props {
		graphs: GraphRow[];
		/** The open graph's id, and whether it is the shared library's copy. */
		openId: string | null;
		openShared: boolean;
		/** Another editor holds the open graph: nothing is added to it, and it is not deleted. */
		readOnly?: boolean;
		onOpen: (row: GraphRow) => void;
		onNew: () => void;
		/** A new effect started from built-in `kind`'s graph twin. */
		onNewFrom: (kind: string) => void;
		onDelete: (row: GraphRow) => void;
		onAdd: (type: string) => void;
	}
	let {
		graphs,
		openId,
		openShared,
		readOnly = false,
		onOpen,
		onNew,
		onNewFrom,
		onDelete,
		onAdd,
	}: Props = $props();

	const GROUPS = libraryGroups();
	const TWINS = twinGroups();
	const newMenu = $derived<MenuGroup[]>([
		{
			items: [
				{
					label: 'Empty effect',
					title: 'The Output alone: it draws the element as it is',
					onSelect: onNew,
				},
			],
		},
		{
			heading: 'Start from a built-in',
			items: TWINS.map((group) => ({
				label: group.label,
				hint: String(group.twins.length),
				items: group.twins.map((twin) => ({
					label: twin.label,
					title: twin.description,
					onSelect: () => onNewFrom(twin.kind),
				})),
			})),
		},
	]);
	let query = $state('');
	const matches = (label: string, description: string): boolean => {
		const q = query.trim().toLowerCase();
		return !q || label.toLowerCase().includes(q) || description.toLowerCase().includes(q);
	};
	const shown = $derived(
		GROUPS.map((g) => ({
			...g,
			nodes: g.nodes.filter((n) => matches(n.label, n.description)),
		})).filter((g) => g.nodes.length),
	);
</script>

<aside class="library">
	<section>
		<div class="head">
			<h3>Effects</h3>
			<MenuButton label="New effect" groups={newMenu}>+ New ▾</MenuButton>
		</div>
		{#if !graphs.length}
			<p class="muted">No shader effects in this project yet.</p>
		{/if}
		<ul class="graphs">
			{#each graphs as row (`${row.shared ? 'shared' : 'own'}:${row.id}`)}
				<li class:open={row.id === openId && row.shared === openShared}>
					<button
						type="button"
						class="name"
						title={row.description || row.id}
						onclick={() => onOpen(row)}
					>
						{row.name}
						{#if row.shared}<span
								class="tag"
								title="From the studio's shared library: saving keeps a copy in this project"
								>shared</span
							>{/if}
					</button>
					{#if !row.shared}
						<button
							type="button"
							class="x"
							title={row.id === openId && readOnly
								? 'Another author is editing this effect'
								: 'Delete this effect'}
							disabled={row.id === openId && readOnly}
							onclick={() => onDelete(row)}>✕</button
						>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<section class="nodes">
		<h3>Nodes</h3>
		<input type="search" placeholder="Search nodes" bind:value={query} aria-label="Search nodes" />
		<p class="muted small">Drag onto the canvas, or click to add.</p>
		{#each shown as group (group.id)}
			<h4 style="--family:{group.color}">{group.label}</h4>
			<ul class="palette">
				{#each group.nodes as node (node.type)}
					<li>
						<button
							type="button"
							draggable={!readOnly}
							title={node.description}
							disabled={readOnly}
							ondragstart={(e) => writeDrag(e, SHADER_DROP_MIME, { type: node.type })}
							onclick={() => onAdd(node.type)}
						>
							{node.label}
						</button>
					</li>
				{/each}
			</ul>
		{/each}
	</section>
</aside>

<style>
	.library {
		width: 230px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 10px;
		border-right: 1px solid #1f2937;
		overflow-y: auto;
		font-size: 12px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h3 {
		margin: 0;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	h4 {
		margin: 8px 0 3px;
		font-size: 11px;
		color: #cbd5e1;
		padding-left: 6px;
		border-left: 3px solid var(--family);
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.graphs li {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 4px;
	}
	.graphs li.open {
		background: #1e293b;
	}
	.graphs .name {
		flex: 1;
		text-align: left;
		background: none;
		border: 0;
		color: #e2e8f0;
		padding: 4px 6px;
		cursor: pointer;
		font-size: 12px;
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.tag {
		font-size: 9px;
		text-transform: uppercase;
		color: #fbbf24;
	}
	.palette {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.palette button {
		font-size: 11px;
		background: #141a22;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 3px 7px;
		cursor: grab;
	}
	.palette button:disabled {
		cursor: default;
		opacity: 0.5;
	}
	input[type='search'] {
		width: 100%;
		font-size: 12px;
		background: #0b0e13;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 3px 6px;
		margin-top: 6px;
	}
	button {
		font-size: 11px;
		background: #1f2937;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 8px;
		cursor: pointer;
	}
	.x {
		padding: 1px 6px;
	}
	.muted {
		color: #64748b;
		margin: 4px 0;
	}
	.small {
		font-size: 11px;
	}
</style>
