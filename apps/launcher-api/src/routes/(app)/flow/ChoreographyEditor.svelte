<script lang="ts">
	import { SvelteFlow, Background, Controls, type Edge, type Node } from '@xyflow/svelte';
	import type { ChoreographyNode, EmitterVocabulary, FlowDoc } from 'engine-flow';
	import ChoreoNode from './ChoreoNode.svelte';
	import ChoreoNodeInspector from './ChoreoNodeInspector.svelte';
	import ChoreoPreview from './ChoreoPreview.svelte';
	import {
		appendChoreoChild,
		choreoNodeSummary,
		editChoreoNode,
		ensureChoreoRoot,
		flattenChoreography,
		getChoreoRoot,
		getNodeAt,
		makeChoreoNode,
		removeChoreoNode,
		setChoreoRoot,
		setChoreoSlot,
		type ChoreoFlatNode,
		type ChoreoKind,
		type ChoreoNodeEdit,
		type ChoreoPath,
		type ChoreoTarget,
	} from './choreographyModel.client';

	// The micro choreography sub-editor (design doc §5/§9.A). Opened by double-clicking a
	// macro screen node, it authors that screen's enter/while/exit timeline as a node graph
	// over the SAME @xyflow/svelte lib (design doc §12). It mutates the FlowDoc purely via
	// the choreography command helpers and reports each new doc up through `oncommit`, so the
	// page records it on the SAME undo/redo stack as the macro graph. The Speed dial +
	// deterministic preview live here too.
	let {
		doc,
		target: initialTarget,
		label,
		vocab,
		oncommit,
		onclose,
	}: {
		doc: FlowDoc;
		target: ChoreoTarget;
		label: string;
		vocab: EmitterVocabulary;
		oncommit: (next: FlowDoc) => void;
		onclose: () => void;
	} = $props();

	// Target-agnostic (design doc §9.A + §14): a SCREEN target authors an enter/while/exit
	// timeline (phase tabs); an EVENT target (a book-event response, e.g. `setExpandingSymbol`)
	// is a SINGLE root choreography with no phases. Both resolve to one {@link ChoreographyNode}
	// root via the SAME command helpers — only the local `phase` (screen-only) and the header
	// branch on the target kind.
	type Phase = 'enter' | 'while' | 'exit';
	const isEvent = $derived(initialTarget.kind === 'event');
	let phase = $state<Phase>('enter');
	const target = $derived<ChoreoTarget>(
		initialTarget.kind === 'screen'
			? { kind: 'screen', screenId: initialTarget.screenId, phase }
			: initialTarget,
	);

	let selectedPath = $state<ChoreoPath | null>(null);

	const root = $derived<ChoreographyNode | undefined>(getChoreoRoot(doc, target));
	const flat = $derived(flattenChoreography(root));

	// Map the flattened tree onto xyflow nodes (auto-laid-out left→right by depth, stacked
	// vertically by a running per-depth cursor) + edges.
	const nodeTypes = { choreo: ChoreoNode };

	function selectedId(): string | null {
		if (!selectedPath) return null;
		return selectedPath.length === 0 ? 'root' : `n_${selectedPath.join('.')}`;
	}

	function buildNodes(): Node[] {
		const perDepth = new Map<number, number>();
		return flat.nodes.map((fn: ChoreoFlatNode) => {
			const y = perDepth.get(fn.depth) ?? 0;
			perDepth.set(fn.depth, y + 1);
			return {
				id: fn.id,
				type: 'choreo',
				position: { x: fn.depth * 240, y: y * 90 },
				data: {
					summary: choreoNodeSummary(fn.node),
					node: fn.node,
					slotLabel: fn.slotLabel,
					isRoot: fn.path.length === 0,
					selected: fn.id === selectedId(),
				},
			};
		});
	}

	function buildEdges(): Edge[] {
		return flat.edges.map((e) => ({
			id: e.id,
			source: e.source,
			target: e.target,
			label: e.label,
		}));
	}

	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);
	function syncCanvas(): void {
		nodes = buildNodes();
		edges = buildEdges();
	}
	$effect(() => {
		// Rebuild the canvas whenever the doc/phase/selection changes (structural only).
		void doc;
		void phase;
		void selectedPath;
		syncCanvas();
	});

	const selectedNode = $derived<ChoreographyNode | undefined>(
		root && selectedPath ? getNodeAt(root, selectedPath) : undefined,
	);

	function pathFromId(id: string): ChoreoPath {
		if (id === 'root') return [];
		const raw = id.slice(2); // strip "n_"
		return raw
			.split('.')
			.map((s) => (s === 'then' || s === 'otherwise' || s === 'body' ? s : Number(s)));
	}

	function onNodeClick({ node }: { node: Node }): void {
		selectedPath = pathFromId(node.id);
	}

	function commit(next: FlowDoc): void {
		if (next === doc) return;
		oncommit(next);
	}

	// Seed an empty root (Sequence) for this phase so there is a container to author into.
	function seedRoot(): void {
		commit(ensureChoreoRoot(doc, target));
		selectedPath = [];
	}

	// Author actions, all through the pure command helpers.
	function addChild(kind: ChoreoKind): void {
		if (!selectedPath) return;
		commit(appendChoreoChild(doc, target, selectedPath, kind));
	}
	function setSlot(slot: 'body' | 'then' | 'otherwise', kind: ChoreoKind): void {
		if (!selectedPath) return;
		commit(setChoreoSlot(doc, target, selectedPath, slot, kind));
	}
	function editNode(edit: ChoreoNodeEdit): void {
		if (!selectedPath) return;
		commit(editChoreoNode(doc, target, selectedPath, edit));
	}
	function removeNode(): void {
		if (!selectedPath) return;
		const wasRoot = selectedPath.length === 0;
		commit(removeChoreoNode(doc, target, selectedPath));
		selectedPath = wasRoot ? null : [];
	}

	// Replace the root with a fresh kind (when the author wants parallel at the top, etc.).
	function setRootKind(kind: 'sequence' | 'parallel'): void {
		commit(setChoreoRoot(doc, target, makeChoreoNode(kind)));
		selectedPath = [];
	}
</script>

<div class="overlay" role="dialog" aria-modal="true">
	<div class="modal">
		<header>
			<strong>
				{#if isEvent}Event response · {label}{:else}Choreography · {label}{/if}
			</strong>
			{#if !isEvent}
				<div class="phases">
					{#each ['enter', 'while', 'exit'] as p (p)}
						<button
							class:active={phase === p}
							onclick={() => {
								phase = p as Phase;
								selectedPath = null;
							}}
						>
							{p}
						</button>
					{/each}
				</div>
			{/if}
			<span class="spacer"></span>
			<button class="close" onclick={onclose}>Close</button>
		</header>

		<div class="body">
			<div class="canvas">
				{#if !root}
					<div class="empty">
						<p>{#if isEvent}No response choreography yet.{:else}No {phase} choreography yet.{/if}</p>
						<button onclick={seedRoot}>+ Start a Sequence</button>
					</div>
				{:else}
					<div class="root-controls">
						<span>Root:</span>
						<button class:active={root.kind === 'sequence'} onclick={() => setRootKind('sequence')}
							>Sequence</button
						>
						<button class:active={root.kind === 'parallel'} onclick={() => setRootKind('parallel')}
							>Parallel</button
						>
						<span class="hint"
							>Click a node to edit it; select a Sequence/Parallel to add children.</span
						>
					</div>
					<SvelteFlow bind:nodes bind:edges {nodeTypes} colorMode="dark" fitView onnodeclick={onNodeClick}>
						<Background />
						<Controls showLock={false} />
					</SvelteFlow>
				{/if}
			</div>

			<aside class="side">
				{#if selectedNode && selectedPath}
					<ChoreoNodeInspector
						node={selectedNode}
						path={selectedPath}
						{vocab}
						onedit={editNode}
						onaddChild={addChild}
						onsetSlot={setSlot}
						onremove={removeNode}
					/>
				{:else if root}
					<p class="hint">Select a node to edit its fields.</p>
				{/if}

				<div class="preview-block">
					<h3>Deterministic preview</h3>
					<ChoreoPreview {root} />
				</div>
			</aside>
		</div>
	</div>
</div>

<style>
	.overlay {
		position: fixed;
		inset: 0;
		background: rgba(3, 6, 12, 0.78);
		display: grid;
		place-items: center;
		z-index: 50;
	}
	.modal {
		width: min(1280px, 94vw);
		height: min(820px, 92vh);
		background: #0b0e13;
		border: 1px solid #2a323d;
		border-radius: 12px;
		display: flex;
		flex-direction: column;
		overflow: hidden;
	}
	header {
		display: flex;
		align-items: center;
		gap: 14px;
		padding: 10px 16px;
		border-bottom: 1px solid #1f2937;
		color: #e2e8f0;
		font-size: 13px;
	}
	.phases {
		display: flex;
		gap: 4px;
	}
	.phases button,
	.root-controls button {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		cursor: pointer;
	}
	.phases button.active,
	.root-controls button.active {
		border-color: #3b82f6;
		color: #bfdbfe;
	}
	.spacer {
		flex: 1;
	}
	.close {
		font-size: 12px;
		padding: 4px 12px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		cursor: pointer;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.canvas {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.root-controls {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-bottom: 1px solid #1f2937;
		color: #94a3b8;
		font-size: 12px;
	}
	.root-controls .hint {
		color: #64748b;
		margin-left: auto;
	}
	.canvas :global(.svelte-flow) {
		background: #0b0e13;
		flex: 1;
	}
	.empty {
		flex: 1;
		display: grid;
		place-items: center;
		align-content: center;
		gap: 10px;
		color: #64748b;
	}
	.empty button {
		font-size: 12px;
		padding: 6px 12px;
		border-radius: 6px;
		border: 1px solid #2563eb;
		background: #14181f;
		color: #bfdbfe;
		cursor: pointer;
	}
	.side {
		width: 320px;
		flex: none;
		border-left: 1px solid #1f2937;
		padding: 14px;
		overflow-y: auto;
	}
	.preview-block {
		border-top: 1px solid #1f2937;
		margin-top: 14px;
		padding-top: 12px;
	}
	.preview-block h3 {
		margin: 0 0 8px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.hint {
		color: #64748b;
		font-size: 12px;
	}
</style>
