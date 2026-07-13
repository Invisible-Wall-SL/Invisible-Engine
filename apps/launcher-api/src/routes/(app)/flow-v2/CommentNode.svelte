<script lang="ts">
	// Invisible Flow v2 — a COMMENT / group box (Unreal-Blueprint style). An editor-only annotation
	// (a `FlowComment`, ignored by the runtime): a labelled, resizable, coloured rectangle drawn
	// BEHIND the graph nodes so an author can visually group + comment a region of the flow. All
	// edits (label, colour, size) route back to the page through `data.onchange`; dragging the box
	// moves it (and, on the page side, the nodes sitting inside it).
	import { NodeResizer, type NodeProps } from '@xyflow/svelte';
	import type { FlowComment } from 'engine-flow-v2';

	type Data = {
		comment: FlowComment;
		onchange: (patch: Partial<FlowComment>) => void;
	};
	let { data, selected }: NodeProps & { data: Data } = $props();

	const comment = $derived(data.comment);
	const color = $derived(comment.color ?? PALETTE[0]);

	// A small preset accent palette — click the swatch to cycle, so different regions read apart.
	const PALETTE = ['#f59e0b', '#60a5fa', '#34d399', '#f472b6', '#a78bfa', '#f87171', '#94a3b8'];
	function cycleColor(): void {
		const i = PALETTE.indexOf(color);
		data.onchange({ color: PALETTE[(i + 1) % PALETTE.length] });
	}
</script>

<NodeResizer
	isVisible={selected}
	minWidth={160}
	minHeight={90}
	onResizeEnd={(_e, p) =>
		data.onchange({
			x: Math.round(p.x),
			y: Math.round(p.y),
			width: Math.round(p.width),
			height: Math.round(p.height),
		})}
/>

<div class="comment" class:selected style="--accent:{color}">
	<header class="head">
		<button
			class="swatch nodrag"
			type="button"
			title="Change colour"
			onclick={cycleColor}
			aria-label="Change colour"
		></button>
		<input
			class="label nodrag"
			value={comment.label}
			placeholder="Comment…"
			oninput={(e) => data.onchange({ label: e.currentTarget.value })}
		/>
	</header>
</div>

<style>
	.comment {
		width: 100%;
		height: 100%;
		box-sizing: border-box;
		border: 1.5px solid color-mix(in srgb, var(--accent) 55%, transparent);
		border-radius: 10px;
		/* Translucent so the nodes drawn on top stay fully readable. */
		background: color-mix(in srgb, var(--accent) 9%, transparent);
	}
	.comment.selected {
		border-color: var(--accent);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 4px 6px;
		border-radius: 8px 8px 0 0;
		background: color-mix(in srgb, var(--accent) 22%, transparent);
		/* The comment node is made click-through (FlowCanvasV2) so it doesn't block the edges it
		   wraps; the header opts back in so it stays the box's drag/select handle. */
		pointer-events: auto;
	}
	.swatch {
		width: 13px;
		height: 13px;
		flex: 0 0 auto;
		border-radius: 3px;
		border: 1px solid rgba(0, 0, 0, 0.35);
		background: var(--accent);
		cursor: pointer;
		padding: 0;
	}
	.label {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		color: #f1f5f9;
		font-size: 12px;
		font-weight: 600;
		letter-spacing: 0.01em;
		outline: none;
	}
	.label::placeholder {
		color: color-mix(in srgb, #f1f5f9 45%, transparent);
	}
</style>
