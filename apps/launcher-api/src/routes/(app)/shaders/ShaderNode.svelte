<script lang="ts">
	import { Handle, Position, type NodeProps } from '@xyflow/svelte';
	import MotionCurve from './MotionCurve.svelte';
	import { PORT_COLORS, categoryColor, costText, type ShaderNodeView } from './shaderEditor';
	import { useShaderThumbs } from './shaderThumbs.svelte';

	// One graph node: its family colour on the header, an input handle per port on the left and an
	// output handle per port on the right, each coloured by the type it resolved to (the analysis'
	// types, else the port's declared one). What the compiler says about the node shows on it, and
	// its cost and a thumbnail of its output (the page's one renderer draws into the canvas); a
	// motion node shows its value over the play as a curve instead.
	let { id, data, selected }: NodeProps = $props();
	const d = $derived(data as ShaderNodeView);
	const thumbs = useShaderThumbs();
	const drawInto = (canvas: HTMLCanvasElement, node: string) => ({
		destroy: thumbs?.mount(node, canvas),
	});

	const typeOf = (side: 'in' | 'out', id: string, declared: string): string =>
		(side === 'in' ? d.inTypes : d.outTypes)[id] ?? declared;
	const colorOf = (type: string): string =>
		PORT_COLORS[type as keyof typeof PORT_COLORS] ?? PORT_COLORS.any;

	/** An unwired input's value as the compiler will read it (a Motion Output's channel: what it
	 *  plays instead). */
	function unwired(id: string, fallback: string): string {
		const instead = d.undriven?.[id];
		if (instead !== undefined) return instead;
		const value = d.node.values?.[id];
		const shown = (v: number): string => String(Number(v.toFixed(3)));
		if (Array.isArray(value)) return value.map(shown).join(', ');
		if (typeof value === 'number') return shown(value);
		const port = d.def?.inputs.find((p) => p.id === id);
		if (port?.default !== undefined)
			return Array.isArray(port.default)
				? port.default.map(shown).join(', ')
				: shown(port.default as number);
		return port?.defaultExpr ?? fallback;
	}
</script>

<div
	class="sg-node"
	class:selected
	class:error={d.errors.length > 0}
	class:muted={!d.errors.length && d.warnings.length > 0}
	style="--family:{d.def ? categoryColor(d.def.category) : '#f87171'}"
	title={[...d.errors, ...d.warnings].join('\n') || d.def?.description}
>
	<header>
		<span class="title">{d.def?.label ?? `Unknown node "${d.node.type}"`}</span>
		{#if d.summary}<span class="summary">{d.summary}</span>{/if}
		{#if d.cost}
			<span class="cost {d.cost.weight}" title={costText(d.cost)}
				>{d.cost.cost}{#if d.cost.samples}<span class="reads">· {d.cost.samples}r</span>{/if}</span
			>
		{/if}
	</header>
	<div class="ports">
		<ul class="col">
			{#each d.def?.inputs ?? [] as port (port.id)}
				{@const type = typeOf('in', port.id, port.type)}
				<li>
					<Handle
						type="target"
						position={Position.Left}
						id={port.id}
						class="sg-h"
						style="background:{colorOf(type)}"
					/>
					<span class="plabel">{port.label}</span>
					{#if !d.wired.includes(port.id)}
						<span class="value">{unwired(port.id, '0')}</span>
					{/if}
				</li>
			{/each}
		</ul>
		{#if thumbs?.enabled && d.thumb}
			<div class="thumb {thumbs.background}" title="Its output on the element, at the preview’s t">
				<canvas use:drawInto={id}></canvas>
			</div>
		{/if}
		<ul class="col out">
			{#each d.def?.outputs ?? [] as port (port.id)}
				{@const type = typeOf('out', port.id, port.type)}
				<li>
					<span class="ptype" style="color:{colorOf(type)}">{type}</span>
					<span class="plabel">{port.label}</span>
					<Handle
						type="source"
						position={Position.Right}
						id={port.id}
						class="sg-h"
						style="background:{colorOf(type)}"
					/>
				</li>
			{/each}
		</ul>
	</div>
	{#if thumbs?.enabled && d.curve}
		<MotionCurve {id} />
	{/if}
	{#if d.errors.length}
		<ul class="issues">
			{#each d.errors as message, i (i)}
				<li>{message}</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.sg-node {
		min-width: 170px;
		max-width: 260px;
		background: #141a22;
		border: 1px solid #2a323d;
		border-top: 3px solid var(--family);
		border-radius: 8px;
		font-size: 11px;
		color: #cbd5e1;
	}
	.sg-node.selected {
		border-color: #60a5fa;
		border-top-color: var(--family);
		box-shadow: 0 0 0 1px #60a5fa66;
	}
	.sg-node.error {
		border-color: #f87171;
		box-shadow: 0 0 0 1px #f8717155;
	}
	.sg-node.muted {
		opacity: 0.6;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding: 6px 10px;
		border-bottom: 1px solid #1f2937;
	}
	.title {
		flex: 1;
		font-weight: 600;
		color: #e2e8f0;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.summary {
		font-size: 10px;
		color: #94a3b8;
		white-space: nowrap;
	}
	.cost {
		flex: none;
		padding: 0 5px;
		border-radius: 8px;
		font-size: 9px;
		line-height: 15px;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		color: #94a3b8;
		background: #1f2937;
	}
	.cost.medium {
		color: #fcd34d;
		background: #3a2f12;
	}
	.cost.heavy {
		color: #fca5a5;
		background: #3b1d1d;
	}
	.reads {
		margin-left: 3px;
		opacity: 0.85;
	}
	.thumb {
		flex: none;
		align-self: center;
		width: 72px;
		height: 72px;
		border-radius: 4px;
		overflow: hidden;
		box-shadow: 0 0 0 1px #2a323d;
	}
	.thumb.dark {
		background: #0b0b10;
	}
	.thumb.light {
		background: #e8e8ee;
	}
	.thumb.checker {
		background: repeating-conic-gradient(#3a3a44 0% 25%, #22222a 0% 50%) 50% / 12px 12px;
	}
	.thumb canvas {
		display: block;
		width: 100%;
		height: 100%;
	}
	/* `data-thumb` is the scheduler's to set (`thumbScheduler.client.ts`), never the template's. */
	.thumb :global(canvas[data-thumb='wait']) {
		background: #10151c;
	}
	.thumb :global(canvas[data-thumb='none']) {
		background: repeating-linear-gradient(-45deg, #222a35 0 5px, #141a22 5px 10px);
	}
	.thumb :global(canvas[data-thumb='still']) {
		opacity: 0.55;
	}
	.ports {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding: 6px 0;
	}
	.col {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.col li {
		position: relative;
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 2px 11px;
	}
	.col.out li {
		justify-content: flex-end;
	}
	.plabel {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		max-width: 110px;
	}
	.value {
		font-size: 10px;
		color: #64748b;
		white-space: nowrap;
	}
	.ptype {
		font-size: 9px;
	}
	.issues {
		margin: 0;
		padding: 5px 10px 7px 22px;
		border-top: 1px solid #3b1d1d;
		color: #fca5a5;
		font-size: 10px;
	}
	.sg-node :global(.svelte-flow__handle.sg-h) {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		border: 1px solid #0b0e13;
	}
</style>
