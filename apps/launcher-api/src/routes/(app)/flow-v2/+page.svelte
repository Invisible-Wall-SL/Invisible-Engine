<script lang="ts">
	import { SvelteFlow, Background, Controls, type Edge, type Node } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { onMount } from 'svelte';
	import {
		derivePins,
		validateFlowDoc,
		type FlowDoc,
		type Node as V2Node,
		type Pin,
		type PinContext,
	} from 'engine-flow-v2';
	import { BOOK_OF_VOCAB, LIBRARY, SAMPLE_DOC } from './sample';
	import { typeColor } from './palette';
	import FlowV2Node from './FlowV2Node.svelte';
	import ValidationPanelV2 from './ValidationPanelV2.svelte';

	// The FlowDoc is the single source of truth. Phase 2a is render + validate only — no
	// write-back yet (that's 2b), so the doc is held in `$state` but not mutated here; the
	// wiring already routes through `$derived` so live revalidation lands for free in 2b.
	let doc = $state<FlowDoc>(JSON.parse(JSON.stringify(SAMPLE_DOC)) as FlowDoc);

	const ctx: PinContext = { vocab: BOOK_OF_VOCAB, library: LIBRARY };

	let selectedNodeId = $state<string | null>(null);

	// The node types the canvas knows — one generic v2 node that derives its own pins.
	const nodeTypes = { v2: FlowV2Node };

	// A human title for a node (its ref, else its kind) shown in the node header.
	const nodeTitle = (n: V2Node): string => {
		switch (n.kind) {
			case 'event':
			case 'action':
			case 'fireCue':
				return n.ref;
			case 'functionCall': {
				const fn = LIBRARY.functions.find((f) => f.id === n.ref);
				return fn?.name ?? n.ref;
			}
			case 'showContainer':
			case 'hideContainer':
				return n.ref;
			default:
				return n.kind;
		}
	};

	// Validation runs reactively over the live doc — 2b editing revalidates for free.
	const issues = $derived(validateFlowDoc(doc, BOOK_OF_VOCAB, LIBRARY));

	// The derived pins per node, indexed once — used to type-color data edges by the SOURCE
	// pin's `TypeRef` (the wire reads the same color as the dot it leaves).
	const pinsByNode = $derived(
		new Map<string, Pin[]>(doc.graph.nodes.map((n) => [n.id, derivePins(n, ctx)])),
	);

	// xyflow owns these arrays for live drag/selection; we rebuild them from the doc on
	// structural changes (selection, doc replace). Reading the `$derived` at top-level init
	// would throw `state_unsafe_local_read` (Svelte 5), so seed on mount (mirrors /flow).
	let nodes = $state<Node[]>([]);
	let edges = $state<Edge[]>([]);

	function buildNodes(): Node[] {
		return doc.graph.nodes.map((n) => ({
			id: n.id,
			type: 'v2',
			position: n.pos,
			selected: n.id === selectedNodeId,
			deletable: false,
			data: { node: n, ctx, title: nodeTitle(n) },
		}));
	}

	// Exec wires: white, thicker control edges with an arrowhead. Data wires: thin, colored
	// by the SOURCE data pin's `TypeRef` (mirroring the spike's type palette).
	const EXEC_COLOR = '#e2e8f0';

	function dataEdgeColor(fromNode: string, fromPin: string): string {
		const pin = pinsByNode.get(fromNode)?.find((p) => p.id === fromPin && p.dir === 'out');
		return pin?.dataType ? typeColor(pin.dataType) : '#94a3b8';
	}

	function buildEdges(): Edge[] {
		const exec: Edge[] = doc.graph.exec.map((e, i) => ({
			id: `exec-${i}`,
			source: e.from.node,
			target: e.to.node,
			sourceHandle: e.from.pin,
			targetHandle: e.to.pin,
			style: `stroke:${EXEC_COLOR}; stroke-width:2.25`,
			class: 'v2-exec',
			markerEnd: { type: 'arrowclosed', color: EXEC_COLOR },
		}));
		const data: Edge[] = doc.graph.data.map((e, i) => {
			const color = dataEdgeColor(e.from.node, e.from.pin);
			return {
				id: `data-${i}`,
				source: e.from.node,
				target: e.to.node,
				sourceHandle: e.from.pin,
				targetHandle: e.to.pin,
				style: `stroke:${color}; stroke-width:1.25`,
				class: 'v2-data',
			};
		});
		return [...exec, ...data];
	}

	function syncCanvas(): void {
		nodes = buildNodes();
		edges = buildEdges();
	}

	onMount(syncCanvas);

	function onNodeClick({ node }: { node: Node }): void {
		selectedNodeId = node.id;
		nodes = buildNodes();
	}
	function onPaneClick(): void {
		selectedNodeId = null;
		nodes = buildNodes();
	}

	// Issue click → select + re-seed so the node highlights (best-effort focus).
	function focusNode(nodeId: string): void {
		selectedNodeId = nodeId;
		nodes = buildNodes();
	}
</script>

<svelte:head><title>Invisible Flow v2 · dev</title></svelte:head>

<div class="page">
	<div class="subbar">
		<strong>Invisible Flow v2</strong>
		<span class="tag">dev</span>
		<span class="legend">
			<span class="key exec">▷ exec</span>
			<span class="key data">● data</span>
		</span>
		<span class="spacer"></span>
		<span class="count">
			{doc.graph.nodes.length} nodes · {doc.graph.exec.length} exec · {doc.graph.data.length} data
		</span>
		{#if issues.length > 0}
			<span class="warn" title="See the Validation panel"
				>⚠ {issues.length} issue{issues.length === 1 ? '' : 's'}</span
			>
		{:else}
			<span class="valid">✓ valid</span>
		{/if}
	</div>

	<div class="body">
		<aside class="side">
			<h3>Flow v2 · dev</h3>
			<p class="hint">
				Render + validate only (Phase 2a). Template <code>{doc.templateId}</code>. Pins are
				<strong>derived</strong> from the vocabulary — nothing hand-stored.
			</p>
			<ValidationPanelV2 {issues} onfocus={focusNode} />
		</aside>

		<div class="canvas">
			<SvelteFlow
				bind:nodes
				bind:edges
				{nodeTypes}
				colorMode="dark"
				fitView
				onnodeclick={onNodeClick}
				onpaneclick={onPaneClick}
			>
				<Background />
				<Controls showLock={false} />
			</SvelteFlow>
		</div>
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0e13;
	}
	.subbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		border-bottom: 1px solid #1f2937;
		color: #cbd5e1;
		font-size: 13px;
	}
	.subbar strong {
		color: #e2e8f0;
	}
	.tag {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		background: #1f2937;
		color: #93c5fd;
	}
	.legend {
		display: inline-flex;
		gap: 6px;
	}
	.legend .key {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 4px;
		border: 1px solid #2a323d;
	}
	.legend .key.exec {
		color: #e2e8f0;
		border-color: #3a4655;
	}
	.legend .key.data {
		color: #38bdf8;
		border-color: #1e4a5f;
	}
	.spacer {
		flex: 1;
	}
	.count {
		color: #94a3b8;
	}
	.warn {
		color: #fdba74;
	}
	.valid {
		color: #86efac;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.side {
		width: 260px;
		flex: none;
		border-right: 1px solid #1f2937;
		padding: 12px;
		overflow-y: auto;
		color: #cbd5e1;
		font-size: 13px;
	}
	.side h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.hint {
		color: #64748b;
		font-size: 12px;
		line-height: 1.5;
	}
	.hint code {
		color: #93c5fd;
		background: #11161d;
		padding: 1px 4px;
		border-radius: 4px;
	}
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
</style>
