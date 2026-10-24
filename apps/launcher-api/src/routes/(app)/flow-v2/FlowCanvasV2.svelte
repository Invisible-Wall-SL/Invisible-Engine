<script lang="ts">
	// Invisible Flow v2's canvas: the shared `$lib/graph/GraphCanvas` with the Flow's drop payload
	// (`dnd.ts`) and its own looks — dashed data wires, click-through comment boxes. All graph
	// editing stays in the page via the handler props.
	import type { Connection, Edge, Node, NodeTypes, OnConnectStartParams } from '@xyflow/svelte';
	import type { NodeKind } from 'engine-flow-v2';
	import GraphCanvas from '$lib/graph/GraphCanvas.svelte';
	import { readDrag } from '$lib/graph/dnd';
	import { DROP_MIME, type DropPayload } from './dnd';

	let {
		nodes = $bindable(),
		edges = $bindable(),
		nodeTypes,
		fitSignal = 0,
		isValidConnection,
		onConnect,
		onConnectStart,
		onConnectEnd,
		onGraphDelete,
		onNodeDragStop,
		onNodeClick,
		onPaneClick,
		ondropnode,
	}: {
		nodes: Node[];
		edges: Edge[];
		nodeTypes: NodeTypes;
		// Bumping it re-fits the view (the editing TARGET switched between the main flow and a
		// function body).
		fitSignal?: number;
		isValidConnection: (edge: Edge | Connection) => boolean;
		onConnect: (c: Connection) => void;
		// Drag-off-pin (§9.1): the page records the dragged pin at drag-start; at drag-end it learns
		// whether the wire landed on a real handle and where, so an empty-canvas drop opens the
		// contextual node-spawner menu.
		onConnectStart: (params: OnConnectStartParams) => void;
		onConnectEnd: (
			droppedOnHandle: boolean,
			flowPos: { x: number; y: number },
			screenX: number,
			screenY: number,
		) => void;
		onGraphDelete: (detail: { nodes: Node[]; edges: Edge[] }) => void;
		onNodeDragStop: (detail: { targetNode: Node | null }) => void;
		onNodeClick: (detail: { node: Node }) => void;
		onPaneClick: () => void;
		ondropnode: (kind: NodeKind, ref: string | undefined, pos: { x: number; y: number }) => void;
	} = $props();

	const isDropPayload = (value: unknown): value is DropPayload =>
		!!value && typeof (value as { kind?: unknown }).kind === 'string';

	function ondrop(raw: string, pos: { x: number; y: number }): void {
		const payload = readDrag(raw, isDropPayload);
		if (payload) ondropnode(payload.kind, payload.ref, pos);
	}
</script>

<div class="flow-canvas">
	<GraphCanvas
		bind:nodes
		bind:edges
		{nodeTypes}
		{fitSignal}
		dropMime={DROP_MIME}
		{isValidConnection}
		{onConnect}
		{onConnectStart}
		{onConnectEnd}
		{onGraphDelete}
		{onNodeDragStop}
		{onNodeClick}
		{onPaneClick}
		{ondrop}
	/>
</div>

<style>
	/* The page lays the canvas out as a flex child; this wrapper only scopes the Flow's looks. */
	.flow-canvas {
		display: contents;
	}
	/* Exec wires read as solid white control lines; data wires as thin dashed typed lines. */
	.flow-canvas :global(.svelte-flow__edge.v2-data .svelte-flow__edge-path) {
		stroke-dasharray: 3 3;
	}
	/* A comment box visually WRAPS a region of the graph, but the node layer sits above the edge
	   layer — so the box's rectangle would swallow every click meant for the edges (and nodes) routed
	   under it (you couldn't select those wires). Make the whole comment node click-through; its
	   header (the drag/select handle, re-enabled in CommentNode) and its resize controls opt back in,
	   so the box stays selectable, draggable-by-header, and resizable while its body lets clicks pass. */
	.flow-canvas :global(.svelte-flow__node-comment) {
		pointer-events: none;
	}
	.flow-canvas :global(.svelte-flow__node-comment .svelte-flow__resize-control) {
		pointer-events: auto;
	}
</style>
