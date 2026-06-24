<script lang="ts">
	import { SvelteFlow, Background, Controls, type Edge, type Node } from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { FlowDoc } from 'engine-flow';
	import FlowScreenNode from './FlowScreenNode.svelte';
	import { buildFlowModel, createFlowHistory } from './flowModel.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Build the read-only model from the loaded LayoutDoc + project components.
	const model = $derived(buildFlowModel(data.doc, data.components));

	// Stand up the typed command stack now (design doc §12) — editing lands in Phase 2,
	// so it is wired but unused here beyond proving the model round-trips through it.
	const history = createFlowHistory<FlowDoc>(model.doc);
	void history;

	const nodeTypes = { screen: FlowScreenNode };

	const nodes = $derived<Node[]>(
		model.screens.map((view) => ({
			id: view.screen.id,
			type: 'screen',
			position: view.screen.position ?? { x: 0, y: 0 },
			data: {
				label: view.screen.label ?? view.scene.name,
				pins: view.pins,
				orphanCount: view.orphanedPins.length,
				initial: view.screen.initial ?? false,
			},
			draggable: false,
			selectable: false,
		})),
	);

	const edges = $derived<Edge[]>(
		model.doc.transitions.map((t) => ({
			id: t.id,
			source: t.from,
			target: t.to,
			label: edgeLabel(t.trigger),
			animated: t.trigger.kind === 'bookEvent',
		})),
	);

	function edgeLabel(trigger: FlowDoc['transitions'][number]['trigger']): string {
		switch (trigger.kind) {
			case 'bookEvent':
				return `event: ${trigger.event}`;
			case 'complete':
				return 'on complete';
			case 'condition':
				return 'condition';
		}
	}

	const orphanTotal = $derived(model.screens.reduce((n, s) => n + s.orphanedPins.length, 0));
</script>

<svelte:head><title>Invisible Flow (preview)</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="editor"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	/>

	<div class="subbar">
		<strong>Invisible Flow</strong>
		<span class="tag">read-only preview</span>
		<span class="spacer"></span>
		<span class="count"
			>{model.screens.length} screens · {model.doc.transitions.length} transitions</span
		>
		{#if orphanTotal > 0}
			<span class="warn">⚠ {orphanTotal} orphaned pin{orphanTotal === 1 ? '' : 's'}</span>
		{/if}
	</div>

	<div class="canvas">
		{#if model.screens.length === 0}
			<div class="empty">This project's layout has no screens yet.</div>
		{:else}
			<SvelteFlow
				{nodes}
				{edges}
				{nodeTypes}
				fitView
				nodesDraggable={false}
				elementsSelectable={false}
			>
				<Background />
				<Controls showLock={false} />
			</SvelteFlow>
		{/if}
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
	.spacer {
		flex: 1;
	}
	.count {
		color: #94a3b8;
	}
	.warn {
		color: #fdba74;
	}
	.canvas {
		flex: 1;
		min-height: 0;
	}
	.canvas :global(.svelte-flow) {
		background: #0b0e13;
	}
	.empty {
		display: grid;
		place-items: center;
		height: 100%;
		color: #64748b;
	}
</style>
