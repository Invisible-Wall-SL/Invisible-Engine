<script lang="ts">
	// The node-graph canvas the launcher's graph editors share (the Flow, Invisible Shader Graph):
	// an `@xyflow/svelte` render plus the plumbing every one of them needs. It must live INSIDE the
	// editor's `SvelteFlowProvider` to call `useSvelteFlow()` (the page, being the flow's PARENT,
	// can't), which is what maps a drop or a wire released on empty canvas into graph coordinates.
	// All graph editing stays in the page, through the handler props.
	import {
		SvelteFlow,
		Background,
		Controls,
		SelectionMode,
		useSvelteFlow,
		type Connection,
		type Edge,
		type Node,
		type NodeTypes,
		type OnConnectEnd,
		type OnConnectStartParams,
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';

	let {
		nodes = $bindable(),
		edges = $bindable(),
		nodeTypes,
		fitSignal = 0,
		dropMime,
		isValidConnection,
		onConnect,
		onConnectStart,
		onConnectEnd,
		onGraphDelete,
		onNodeDragStop,
		onNodeClick,
		onNodeDoubleClick,
		onEdgeClick,
		onPaneClick,
		ondrop,
	}: {
		nodes: Node[];
		edges: Edge[];
		nodeTypes: NodeTypes;
		/** Bumping it re-fits the view to the graph (the editor switched what it shows). */
		fitSignal?: number;
		/** The dataTransfer type this editor's palette writes (`writeDrag`). */
		dropMime: string;
		isValidConnection: (edge: Edge | Connection) => boolean;
		onConnect: (c: Connection) => void;
		/** A wire dragged off a pin: the page records which. */
		onConnectStart?: (params: OnConnectStartParams) => void;
		/** …and released: on a handle (`onConnect` already ran) or on empty canvas, where a page can
		 *  open a menu of what the pin connects to. Graph and screen coordinates both. */
		onConnectEnd?: (
			droppedOnHandle: boolean,
			flowPos: { x: number; y: number },
			screenX: number,
			screenY: number,
		) => void;
		onGraphDelete: (detail: { nodes: Node[]; edges: Edge[] }) => void;
		onNodeDragStop: (detail: { targetNode: Node | null }) => void;
		onNodeClick: (detail: { node: Node }) => void;
		/** A node double-clicked (xyflow has no event for it: the node's wrapper names it). The
		 *  canvas does not zoom on it then. */
		onNodeDoubleClick?: (detail: { node: Node }) => void;
		/** An edge clicked (a page that inspects a wire selects it here). */
		onEdgeClick?: (detail: { edge: Edge }) => void;
		onPaneClick: () => void;
		/** A palette drag dropped at `pos` (graph coordinates): its raw payload, for the page to read
		 *  with `readDrag`. */
		ondrop: (raw: string, pos: { x: number; y: number }) => void;
	} = $props();

	const { screenToFlowPosition, fitView } = useSvelteFlow();

	// The client xy of a connect-end pointer event; a touch carries it on `changedTouches`.
	function pointerXY(event: MouseEvent | TouchEvent): { x: number; y: number } {
		if ('clientX' in event) return { x: event.clientX, y: event.clientY };
		const t = event.changedTouches[0];
		return t ? { x: t.clientX, y: t.clientY } : { x: 0, y: 0 };
	}

	// `connectionState.toHandle` is non-null only when the wire landed on a real handle.
	const handleConnectEnd: OnConnectEnd = (event, connectionState) => {
		if (!onConnectEnd) return;
		const screen = pointerXY(event);
		onConnectEnd(
			connectionState.toHandle != null,
			screenToFlowPosition(screen),
			screen.x,
			screen.y,
		);
	};

	// Skip the initial 0 (the `fitView` prop fits on first render); a rAF lets new nodes lay out.
	let lastFit = 0;
	$effect(() => {
		if (fitSignal === lastFit) return;
		lastFit = fitSignal;
		if (fitSignal === 0) return;
		requestAnimationFrame(() => void fitView());
	});

	function onDragOver(event: DragEvent): void {
		if (!event.dataTransfer?.types.includes(dropMime)) return;
		event.preventDefault();
		event.dataTransfer.dropEffect = 'move';
	}

	// Caught on the way down: on a node that cannot be dragged (a read-only canvas) the pane's zoom
	// takes a double-click and stops it before it would bubble back up here.
	function onDoubleClick(event: MouseEvent): void {
		if (!onNodeDoubleClick || !(event.target instanceof Element)) return;
		const id = event.target.closest('.svelte-flow__node')?.getAttribute('data-id');
		const node = id ? nodes.find((n) => n.id === id) : undefined;
		if (!node) return;
		event.stopPropagation();
		onNodeDoubleClick({ node });
	}

	function onDrop(event: DragEvent): void {
		const raw = event.dataTransfer?.getData(dropMime);
		if (!raw) return;
		event.preventDefault();
		ondrop(raw, screenToFlowPosition({ x: event.clientX, y: event.clientY }));
	}
</script>

<div
	class="canvas"
	ondragover={onDragOver}
	ondrop={onDrop}
	ondblclickcapture={onDoubleClick}
	role="application"
>
	<SvelteFlow
		bind:nodes
		bind:edges
		{nodeTypes}
		colorMode="dark"
		fitView
		deleteKey={['Delete', 'Backspace']}
		selectionOnDrag
		selectionMode={SelectionMode.Partial}
		panOnDrag={[1, 2]}
		multiSelectionKey={['Shift', 'Meta', 'Control']}
		{isValidConnection}
		onconnect={onConnect}
		onconnectstart={(_event, params) => onConnectStart?.(params)}
		onconnectend={handleConnectEnd}
		ondelete={onGraphDelete}
		onnodedragstop={onNodeDragStop}
		onnodeclick={onNodeClick}
		onedgeclick={onEdgeClick ? ({ edge }) => onEdgeClick({ edge }) : undefined}
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
	/* Selected edge — click an edge (its ~20px hit area), then Delete/Backspace to remove it.
	   `!important` overrides the per-edge inline stroke so the pick reads at a glance. */
	.canvas :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
		stroke: #60a5fa !important;
		stroke-width: 3.25 !important;
		filter: drop-shadow(0 0 3px #60a5fabb);
	}
</style>
