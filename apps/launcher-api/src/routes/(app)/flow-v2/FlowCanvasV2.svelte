<script lang="ts">
	// Invisible Flow v2 — the canvas, extracted so it can live INSIDE the SvelteFlowProvider
	// context and call `useSvelteFlow()` (the page, being the flow's PARENT, can't). This is
	// what makes drop-at-cursor possible: `screenToFlowPosition` maps a page-pixel drop point
	// into doc-space coordinates. All graph editing stays in the page via the handler props;
	// this component only OWNS the drag-over/drop plumbing + the flow render.
	import {
		SvelteFlow,
		Background,
		Controls,
		SelectionMode,
		useSvelteFlow,
		type Connection,
		type Edge,
		type Node,
		type OnConnectEnd,
		type OnConnectStartParams,
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import type { NodeKind } from 'engine-flow-v2';
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
		nodeTypes: Record<string, unknown>;
		// A monotonically-incremented counter: bumping it re-fits the view to the current graph
		// (used when the editing TARGET switches between the main flow and a function body).
		fitSignal?: number;
		isValidConnection: (edge: Edge | Connection) => boolean;
		onConnect: (c: Connection) => void;
		// Drag-off-pin (§9.1): the page records the dragged pin at drag-start; at drag-end we tell it
		// whether the wire landed on a real handle and where (flow-space + screen-space), so it can
		// open the contextual node-spawner menu on an empty-canvas drop.
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

	// Only reachable from a child of <SvelteFlowProvider> — the reason this component exists.
	const { screenToFlowPosition, fitView } = useSvelteFlow();

	// The client (screen) xy of a connect-end pointer event — the same coord `screenToFlowPosition`
	// consumes, and where the popup anchors. Touch events carry it on `changedTouches`.
	function pointerXY(event: MouseEvent | TouchEvent): { x: number; y: number } {
		if ('clientX' in event) return { x: event.clientX, y: event.clientY };
		const t = event.changedTouches[0];
		return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
	}

	// xyflow fires this when a dragged wire is released. `connectionState.toHandle` is non-null only
	// when it landed on a real handle (normal `onConnect` already ran); a null `toHandle` is the
	// empty-canvas drop that should open the node-spawner menu. Map the drop point to flow-space and
	// hand both coord systems up to the page.
	const handleConnectEnd: OnConnectEnd = (event, connectionState) => {
		const droppedOnHandle = connectionState.toHandle != null;
		const screen = pointerXY(event);
		const flowPos = screenToFlowPosition(screen);
		onConnectEnd(droppedOnHandle, flowPos, screen.x, screen.y);
	};

	// Re-fit when the parent bumps `fitSignal` (view switch). Skip the initial 0 (the SvelteFlow
	// `fitView` prop already fits on first render); a rAF lets the new nodes lay out first.
	let lastFit = 0;
	$effect(() => {
		if (fitSignal === lastFit) return;
		lastFit = fitSignal;
		if (fitSignal === 0) return;
		requestAnimationFrame(() => void fitView());
	});

	// A drag carrying our payload is a valid drop target; suppress the default (which would
	// reject the drop) and show the move cursor.
	function onDragOver(event: DragEvent): void {
		if (!event.dataTransfer) return;
		if (!event.dataTransfer.types.includes(DROP_MIME)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
	}

	// Read the palette payload, map the drop point into doc-space, and hand it to the page.
	function onDrop(event: DragEvent): void {
		const raw = event.dataTransfer?.getData(DROP_MIME);
		if (!raw) return; // Not one of our drags — ignore.
		event.preventDefault();
		let payload: DropPayload;
		try {
			payload = JSON.parse(raw) as DropPayload;
		} catch {
			return;
		}
		if (!payload || typeof payload.kind !== 'string') return;
		const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY });
		ondropnode(payload.kind, payload.ref, pos);
	}
</script>

<div class="canvas" ondragover={onDragOver} ondrop={onDrop} role="application">
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		colorMode="dark"
		fitView
		deleteKeyCode={['Delete', 'Backspace']}
		selectionOnDrag
		selectionMode={SelectionMode.Partial}
		panOnDrag={[1, 2]}
		multiSelectionKeyCode={['Shift', 'Meta', 'Control']}
		{isValidConnection}
		onconnect={onConnect}
		onconnectstart={(_event, params) => onConnectStart(params)}
		onconnectend={handleConnectEnd}
		ondelete={onGraphDelete}
		onnodedragstop={onNodeDragStop}
		onnodeclick={onNodeClick}
		onpaneclick={onPaneClick}
	>
		<Background />
		<Controls showLock={false} />
	</SvelteFlow>
</div>

<style>
	.canvas {
		flex: 1;
		min-width: 0;
	}
	.canvas :global(.svelte-flow) {
		background: #0b0e13;
	}
	/* Exec wires read as solid white control lines; data wires as thin dashed typed lines. */
	.canvas :global(.svelte-flow__edge.v2-data .svelte-flow__edge-path) {
		stroke-dasharray: 3 3;
	}
	/* Selected edge — click an edge (its ~20px hit area), then Delete/Backspace to remove it.
	   `!important` overrides the per-edge inline stroke so the pick reads at a glance. */
	.canvas :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
		stroke: #60a5fa !important;
		stroke-width: 3.25 !important;
		filter: drop-shadow(0 0 3px #60a5fabb);
	}
	/* A comment box visually WRAPS a region of the graph, but the node layer sits above the edge
	   layer — so the box's rectangle would swallow every click meant for the edges (and nodes) routed
	   under it (you couldn't select those wires). Make the whole comment node click-through; its
	   header (the drag/select handle, re-enabled in CommentNode) and its resize controls opt back in,
	   so the box stays selectable, draggable-by-header, and resizable while its body lets clicks pass. */
	.canvas :global(.svelte-flow__node-comment) {
		pointer-events: none;
	}
	.canvas :global(.svelte-flow__node-comment .svelte-flow__resize-control) {
		pointer-events: auto;
	}
</style>
