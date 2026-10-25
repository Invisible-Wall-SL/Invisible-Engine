<script lang="ts">
	import MenuButton, { type MenuGroup } from '$lib/MenuButton.svelte';
	import { writeDrag } from '$lib/graph/dnd';
	import { MOTION_OUTPUT, SUBGRAPH_CALL, SUBGRAPH_IN } from 'engine-shadergraph';
	import {
		SHADER_DROP_MIME,
		categoryColor,
		libraryGroups,
		twinGroups,
		type SubgraphRow,
	} from './shaderEditor';

	// The left pane: the project's graphs (its own and the studio's shared ones it does not
	// override), then the node library: the open effect's subgraphs, then the nodes by family. A
	// node is dragged onto the canvas, or clicked to add it beside the selected node. While the
	// canvas shows the motion graph, the library is the motion nodes (floats alone), no subgraph.
	// Custom GLSL is listed under Advanced for a holder of `shaderCustomGlsl` alone.
	interface GraphRow {
		id: string;
		name: string;
		description: string;
		shared: boolean;
		/** The project's own effect, and the studio library has one of its id. */
		inLibrary?: boolean;
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
		/** The open effect's subgraphs, each called by a node dropped from here. */
		subgraphs?: SubgraphRow[];
		/** A body's Input or Output the opened subgraph lacks (`subgraphIn` / `subgraphOut`), or the
		 *  Motion Output the motion graph lacks. */
		boundary?: string[];
		/** The canvas shows the motion graph. */
		motion?: boolean;
		/** The user may add Custom GLSL (holds `shaderCustomGlsl`). */
		customGlsl?: boolean;
		onAddCall?: (id: string) => void;
		onOpenSubgraph?: (id: string) => void;
		onDeleteSubgraph?: (id: string) => void;
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
		subgraphs = [],
		boundary = [],
		motion = false,
		customGlsl = false,
		onAddCall,
		onOpenSubgraph,
		onDeleteSubgraph,
	}: Props = $props();

	const PIXEL_GROUPS = $derived(libraryGroups(false, customGlsl));
	const MOTION_GROUPS = libraryGroups(true);
	const TWINS = twinGroups();
	const BOUNDARY_TEXT: Record<string, { label: string; title: string }> = {
		[SUBGRAPH_IN]: { label: 'Input', title: "Put back the subgraph's Input node" },
		[MOTION_OUTPUT]: {
			label: 'Motion Output',
			title: 'Put back the Motion Output: what the motion graph moves',
		},
	};
	const boundaryText = (type: string) =>
		BOUNDARY_TEXT[type] ?? { label: 'Output', title: "Put back the subgraph's Output node" };
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
		(motion ? MOTION_GROUPS : PIXEL_GROUPS)
			.map((g) => ({
				...g,
				nodes: g.nodes.filter((n) => matches(n.label, n.description)),
			}))
			.filter((g) => g.nodes.length),
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
							>{:else if row.inLibrary}<span
								class="tag lib"
								title="The studio library has an effect of this id: this project plays its own"
								>in library</span
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
		<p class="muted small">
			{motion
				? 'Motion nodes: numbers worked out each frame. Drag onto the canvas, or click to add.'
				: 'Drag onto the canvas, or click to add.'}
		</p>
		{#if openId && boundary.length}
			<h4 style="--family:{categoryColor(motion ? 'output' : 'subgraph')}">
				{motion ? 'Output' : 'Subgraphs'}
			</h4>
			<ul class="palette">
				{#each boundary as type (type)}
					<li>
						<button
							type="button"
							draggable={!readOnly}
							disabled={readOnly}
							title={boundaryText(type).title}
							ondragstart={(e) => writeDrag(e, SHADER_DROP_MIME, { type })}
							onclick={() => onAdd(type)}
						>
							{boundaryText(type).label}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if openId && !motion}
			{#if !boundary.length}
				<h4 style="--family:{categoryColor('subgraph')}">Subgraphs</h4>
			{/if}
			{#if !subgraphs.length}
				<p class="muted small">Select nodes and Group them (Ctrl+G) to make one.</p>
			{/if}
			<ul class="subgraphs">
				{#each subgraphs.filter((s) => matches(s.name, '')) as row (row.id)}
					<li>
						<button
							type="button"
							class="call"
							draggable={!readOnly && !row.blocked}
							disabled={readOnly || !!row.blocked}
							title={row.blocked || `Add a call of ${row.name}: drag onto the canvas, or click`}
							ondragstart={(e) =>
								writeDrag(e, SHADER_DROP_MIME, { type: SUBGRAPH_CALL, subgraph: row.id })}
							onclick={() => onAddCall?.(row.id)}
						>
							{row.name}
						</button>
						<span class="muted calls" title="Calls of it">{row.calls}×</span>
						<button
							type="button"
							class="x"
							title="Open {row.name} to edit its nodes"
							onclick={() => onOpenSubgraph?.(row.id)}>✎</button
						>
						<button
							type="button"
							class="x"
							disabled={readOnly}
							title="Delete {row.name}"
							onclick={() => onDeleteSubgraph?.(row.id)}>✕</button
						>
					</li>
				{/each}
			</ul>
		{/if}
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
	.tag.lib {
		color: #7dd3fc;
	}
	.subgraphs li {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-bottom: 3px;
	}
	.subgraphs .call {
		flex: 1;
		min-width: 0;
		text-align: left;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		background: #141a22;
		border-color: #115e59;
		cursor: grab;
	}
	.subgraphs .call:disabled {
		cursor: default;
		opacity: 0.5;
	}
	.calls {
		font-size: 10px;
		margin: 0;
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
