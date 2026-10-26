<script lang="ts">
	/**
	 * One node of the State Machine graph (Rive plan Phase 5b): a state card named after its
	 * timeline (a blend state also shows its input and points), or one of the Entry / Any / Exit
	 * pseudo-nodes. Wires leave a node's right handle and land on another's left one; Entry and Any
	 * have no left handle (nothing enters them), Exit no right one (nothing leaves it).
	 * Double-clicking a state opens its timeline.
	 */
	import { Handle, Position, type Node, type NodeProps } from '@xyflow/svelte';

	type Data = {
		kind: 'entry' | 'any' | 'exit' | 'state';
		label: string;
		/** The timeline's name under the card's title, when the title is a custom name. */
		sub?: string;
		loop?: boolean;
		speed?: number;
		/** A 1D blend state's input and points (`speed: idle 0 · run 200`). */
		blend?: string;
		/** Entry state of its layer (a dot on the card). */
		isEntry?: boolean;
		/** The layer is in this state in the preview. */
		active?: boolean;
		/** The state's timeline is missing / the card has a validation error. */
		broken?: boolean;
		onopen?: () => void;
		/** The card's tooltip; absent ⇒ the Component Editor's "open its timeline". */
		hint?: string;
	};
	let { data: d, selected }: NodeProps<Node<Data>> = $props();
</script>

{#if d.kind === 'state'}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="card"
		class:selected
		class:active={d.active}
		class:broken={d.broken}
		ondblclick={() => d.onopen?.()}
		title={d.broken
			? 'This state has a problem — see the ⚠ list'
			: (d.hint ?? 'Double-click to open its timeline')}
	>
		<Handle type="target" position={Position.Left} class="sm-h" />
		<div class="title">
			{#if d.isEntry}<span class="entry-dot" title="Entry state">●</span>{/if}
			<span class="name">{d.label}</span>
		</div>
		{#if d.sub}<div class="sub">◇ {d.sub}</div>{/if}
		{#if d.blend}<div class="sub blend" title="1D blend state">⇋ {d.blend}</div>{/if}
		<div class="badges">
			{#if d.loop}<span class="badge" title="Loops">⟳</span>{/if}
			{#if d.speed !== undefined && d.speed !== 1}<span class="badge" title="Speed">×{d.speed}</span
				>{/if}
		</div>
		<Handle type="source" position={Position.Right} class="sm-h" />
	</div>
{:else}
	<div class="pseudo {d.kind}" class:selected class:active={d.active}>
		{#if d.kind === 'exit'}<Handle type="target" position={Position.Left} class="sm-h" />{/if}
		<span>{d.label}</span>
		{#if d.kind !== 'exit'}<Handle type="source" position={Position.Right} class="sm-h" />{/if}
	</div>
{/if}

<style>
	.card {
		min-width: 150px;
		background: #2b2f38;
		border: 1px solid #363b45;
		border-radius: 8px;
		padding: 8px 12px;
		color: #d7dbe2;
		font-size: 12px;
		box-shadow: 0 2px 8px #0006;
	}
	.card.selected {
		border-color: #5db0ff;
		box-shadow: 0 0 0 1px #5db0ff66;
	}
	.card.active,
	.pseudo.active {
		border-color: #7ee0c0;
		box-shadow: 0 0 0 2px #7ee0c066;
	}
	.card.broken {
		border-color: #f0a050;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-weight: 600;
	}
	.entry-dot {
		color: #7ee0c0;
		font-size: 9px;
	}
	.sub {
		color: #8b93a1;
		font-size: 11px;
		margin-top: 2px;
	}
	.sub.blend {
		color: #c9a7ff;
		max-width: 220px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.badges {
		display: flex;
		gap: 4px;
		margin-top: 4px;
		min-height: 14px;
	}
	.badge {
		font-size: 10px;
		color: #8b93a1;
		border: 1px solid #363b45;
		border-radius: 4px;
		padding: 0 4px;
	}
	.pseudo {
		border-radius: 999px;
		padding: 6px 16px;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		border: 1px solid #363b45;
		color: #1b1d22;
		font-weight: 700;
	}
	.pseudo.entry {
		background: #7ee0c0;
	}
	.pseudo.any {
		background: #c9a7ff;
	}
	.pseudo.exit {
		background: #f08080;
	}
	.pseudo.selected {
		box-shadow: 0 0 0 2px #5db0ff;
	}
	:global(.svelte-flow__handle.sm-h) {
		width: 10px;
		height: 10px;
		background: #5db0ff;
		border: 1px solid #1b1d22;
	}
</style>
