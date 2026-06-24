<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import type { ChoreographyNode } from 'engine-flow';

	// A micro-choreography node on the sub-editor canvas. It renders one executor node kind
	// (sequence/parallel/broadcast/delay/branch/forEach) with a summary + a target handle
	// (its parent links in) and, for containers, a source handle (children link out). The
	// node is selected/edited via the page; this is presentational.
	type Data = {
		summary: string;
		node: ChoreographyNode;
		slotLabel?: string;
		isRoot: boolean;
		selected: boolean;
	};
	let { data }: NodeProps = $props();
	const d = data as Data;

	const kindColor: Record<string, string> = {
		sequence: '#64748b',
		parallel: '#0ea5e9',
		broadcast: '#f59e0b',
		delay: '#a855f7',
		forEach: '#10b981',
		branch: '#ec4899',
	};
	const isContainer = $derived(
		d.node.kind === 'sequence' ||
			d.node.kind === 'parallel' ||
			d.node.kind === 'forEach' ||
			d.node.kind === 'branch',
	);
</script>

<div class="choreo-node" class:selected={d.selected} style="border-color:{kindColor[d.node.kind]}">
	{#if !d.isRoot}
		<Handle type="target" position={Position.Left} style="background:{kindColor[d.node.kind]}" />
	{/if}
	{#if d.slotLabel}<span class="slot">{d.slotLabel}</span>{/if}
	<span class="kind" style="color:{kindColor[d.node.kind]}">{d.node.kind}</span>
	<span class="summary">{d.summary}</span>
	{#if isContainer}
		<Handle type="source" position={Position.Right} style="background:{kindColor[d.node.kind]}" />
	{/if}
</div>

<style>
	.choreo-node {
		min-width: 160px;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 7px;
		padding: 7px 10px;
		color: #e2e8f0;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.choreo-node.selected {
		box-shadow: 0 0 0 2px #3b82f6;
	}
	.slot {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #64748b;
	}
	.kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		font-weight: 600;
	}
	.summary {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 220px;
	}
</style>
