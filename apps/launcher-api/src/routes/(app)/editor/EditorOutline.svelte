<script lang="ts">
	import type { LayoutNode, Scene } from 'engine-layout';

	interface Props {
		scene: Scene | undefined;
		selectedId: string | null;
		onSelect: (id: string) => void;
	}
	let { scene, selectedId, onSelect }: Props = $props();

	function kindGlyph(kind: LayoutNode['kind']): string {
		switch (kind) {
			case 'sprite':
				return '■';
			case 'spine':
				return '◆';
			case 'text':
				return 'T';
			case 'container':
				return '▦';
		}
	}
</script>

{#snippet row(node: LayoutNode, depth: number)}
	<li>
		<button
			type="button"
			class="row"
			class:selected={selectedId === node.id}
			style:padding-left="{8 + depth * 14}px"
			onclick={() => onSelect(node.id)}
		>
			<span class="glyph">{kindGlyph(node.kind)}</span>
			<span class="label">{node.label ?? node.id}</span>
			{#if node.locked}<span class="lock" title="Locked">🔒</span>{/if}
			<span class="kind">{node.kind}</span>
		</button>
		{#if node.kind === 'container' && node.children.length > 0}
			<ul class="children">
				{#each node.children as child (child.id)}
					{@render row(child, depth + 1)}
				{/each}
			</ul>
		{/if}
	</li>
{/snippet}

{#if !scene || scene.nodes.length === 0}
	<p class="muted">No nodes yet. Drag assets from the Library into the canvas.</p>
{:else}
	<p class="hint">
		Order mirrors the canvas paint order — top row is rendered first (lowest layer).
	</p>
	<ul class="tree">
		{#each scene.nodes as node (node.id)}
			{@render row(node, 0)}
		{/each}
	</ul>
{/if}

<style>
	.tree,
	.children {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		color: #c8c8d0;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
	}
	.row:hover {
		background: #16161c;
		border-color: #1f1f28;
	}
	.row.selected {
		background: #1a1a22;
		border-color: #5db0ff;
		color: #e8e8ee;
	}
	.glyph {
		color: #c8a3ff;
		font-size: 11px;
		width: 12px;
		text-align: center;
	}
	.label {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.lock {
		font-size: 10px;
		line-height: 1;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.hint {
		color: #666;
		font-size: 11px;
		margin: 0 0 10px;
	}
</style>
