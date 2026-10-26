<script lang="ts">
	/**
	 * A character's BRAIN on the state-machine canvas the Component Editor draws its state machines
	 * with (`docs/design/game-families.md` §5.1): the shared node-graph shell (`GraphCanvas`) with the
	 * Component Editor's own card (`SmGraphNode`) — Entry, Any and one card per behaviour state.
	 * Drag from a card's right handle to another to add a transition, from Entry to pick the initial
	 * state, from Any for a transition that fires from every state; drop a behaviour from the
	 * palette to add a state. Every edit is the page's (`$lib/characters/characterEdit.ts`).
	 */
	import { MarkerType, SvelteFlowProvider, type Edge, type Node } from '@xyflow/svelte';
	import type { ArcadeBehaviourKind, ArcadeBrain } from 'game-config';
	import GraphCanvas from '$lib/graph/GraphCanvas.svelte';
	import { readDrag } from '$lib/graph/dnd';
	import {
		ANY_NODE,
		ENTRY_NODE,
		INITIAL_EDGE,
		brainConnection,
		brainGraph,
		type BrainConnection,
		type BrainSelection,
	} from '$lib/characters/brainGraph';
	import { isBehaviour } from '$lib/characters/characterEdit';
	import SmGraphNode from '../editor/SmGraphNode.svelte';

	let {
		brain,
		version,
		selected,
		activeState,
		broken,
		readOnly,
		dropMime,
		onconnect,
		ondelete,
		onmove,
		onselect,
		ondropbehaviour,
	}: {
		brain: ArcadeBrain | undefined;
		/** Bumped by the page on every brain edit: the graph is rebuilt from `brain`. */
		version: number;
		selected: BrainSelection;
		/** The sandbox's current state, lit. */
		activeState?: string;
		/** State and transition ids the validator flags. */
		broken: Set<string>;
		readOnly: boolean;
		dropMime: string;
		onconnect: (c: NonNullable<BrainConnection>) => void;
		ondelete: (states: string[], transitions: string[]) => void;
		onmove: (state: string, pos: { x: number; y: number }) => void;
		onselect: (selection: BrainSelection) => void;
		ondropbehaviour: (behaviour: ArcadeBehaviourKind, pos: { x: number; y: number }) => void;
	} = $props();

	const nodeTypes = { sm: SmGraphNode };
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);

	$effect(() => {
		void version;
		const graph = brainGraph(brain);
		const sel = selected;
		nodes = graph.nodes.map((n) => ({
			id: n.id,
			type: 'sm',
			position: { ...n.pos },
			selected: sel?.kind === 'state' && sel.id === n.id,
			deletable: !readOnly && n.kind === 'state',
			draggable: !readOnly,
			data: {
				kind: n.kind,
				label: n.label,
				sub: n.state?.behaviour,
				isEntry: n.kind === 'state' && brain?.initial === n.id,
				active: n.kind === 'state' && activeState === n.id,
				broken: n.kind === 'state' && broken.has(n.id),
				hint: 'Click to edit its behaviour; drag its right handle to another state',
			},
		}));
		edges = graph.edges.map((e) => ({
			id: e.id,
			source: e.from,
			target: e.to,
			label: e.label || undefined,
			selected: sel?.kind === 'transition' && sel.id === e.id,
			deletable: !readOnly && e.id !== INITIAL_EDGE,
			class: [e.id === INITIAL_EDGE ? 'brain-initial' : 'brain-t', broken.has(e.id) ? 'broken' : '']
				.join(' ')
				.trim(),
			markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
		}));
	});

	const isPseudo = (id: string) => id === ENTRY_NODE || id === ANY_NODE;
</script>

<div class="brain-canvas" class:read-only={readOnly}>
	<SvelteFlowProvider>
		<GraphCanvas
			bind:nodes
			bind:edges
			{nodeTypes}
			fitSignal={0}
			{dropMime}
			isValidConnection={(c) =>
				!readOnly && !!c.source && !!c.target && !!brainConnection(c.source, c.target)}
			onConnect={(c) => {
				const connection = brainConnection(c.source ?? '', c.target ?? '');
				if (connection && !readOnly) onconnect(connection);
			}}
			onGraphDelete={({ nodes: gone, edges: cut }) => {
				if (readOnly) return;
				ondelete(
					gone.map((n) => n.id).filter((id) => !isPseudo(id)),
					cut.map((e) => e.id).filter((id) => id !== INITIAL_EDGE),
				);
			}}
			onNodeDragStop={({ targetNode }) => {
				if (targetNode && !isPseudo(targetNode.id) && !readOnly) {
					onmove(targetNode.id, targetNode.position);
				}
			}}
			onNodeClick={({ node }) =>
				onselect(isPseudo(node.id) ? null : { kind: 'state', id: node.id })}
			onEdgeClick={({ edge }) =>
				onselect(edge.id === INITIAL_EDGE ? null : { kind: 'transition', id: edge.id })}
			onPaneClick={() => onselect(null)}
			ondrop={(raw, pos) => {
				const behaviour = readDrag(raw, isBehaviour);
				if (behaviour && !readOnly) ondropbehaviour(behaviour, pos);
			}}
		/>
	</SvelteFlowProvider>
</div>

<style>
	.brain-canvas {
		display: flex;
		height: 340px;
		border: 1px solid #2a2f38;
		border-radius: 8px;
		overflow: hidden;
	}
	.brain-canvas :global(.sm-h) {
		width: 10px;
		height: 10px;
		background: #5db0ff;
		border: 2px solid #1b1d22;
	}
	.brain-canvas.read-only :global(.sm-h) {
		display: none;
	}
	.brain-canvas :global(.svelte-flow__edge.brain-initial .svelte-flow__edge-path) {
		stroke: #7ee0c0;
		stroke-dasharray: 5 4;
	}
	.brain-canvas :global(.svelte-flow__edge.brain-t .svelte-flow__edge-path) {
		stroke: #8b93a1;
		stroke-width: 1.6;
	}
	.brain-canvas :global(.svelte-flow__edge.broken .svelte-flow__edge-path) {
		stroke: #f0a050;
	}
	.brain-canvas :global(.svelte-flow__edge-label) {
		background: #1b1d22;
		color: #c9d1dc;
		font-size: 11px;
		padding: 1px 5px;
		border-radius: 4px;
	}
</style>
