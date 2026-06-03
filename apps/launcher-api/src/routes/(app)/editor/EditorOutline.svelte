<script lang="ts">
	import type { GameTemplate, LayoutNode, Scene } from 'engine-layout';

	interface Props {
		scene: Scene | undefined;
		template: GameTemplate | undefined;
		selectedId: string | null;
		onSelect: (id: string) => void;
		/** Fill a slot by dropping a Library asset onto its row (drag-to-slot). */
		onFillSlot?: (sceneId: string, sceneName: string, slotId: string, payload: unknown) => void;
	}
	let { scene, template, selectedId, onSelect, onFillSlot }: Props = $props();

	/** `slotId` of the slot row a Library asset is hovering over. */
	let dragSlotId = $state<string | null>(null);

	/** `mount` slots are engine-owned anchors, not asset targets — not droppable. */
	function isDroppable(kind: string): boolean {
		return kind !== 'mount';
	}

	function onSlotDragOver(e: DragEvent, slotId: string, kind: string): void {
		if (!e.dataTransfer || !isDroppable(kind)) return;
		if (!Array.from(e.dataTransfer.types).includes('application/x-iw-asset')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		dragSlotId = slotId;
	}

	function onSlotDrop(e: DragEvent, slotId: string, kind: string): void {
		dragSlotId = null;
		if (!scene || !e.dataTransfer || !isDroppable(kind)) return;
		const raw = e.dataTransfer.getData('application/x-iw-asset');
		if (!raw) return;
		e.preventDefault();
		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch {
			return;
		}
		onFillSlot?.(scene.id, scene.name, slotId, payload);
	}

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

	/** `slotId`s any node in the active scene fills (recursing into containers). */
	function filledSlotIds(nodes: LayoutNode[], into: Set<string>): Set<string> {
		for (const node of nodes) {
			if (node.slotId) into.add(node.slotId);
			if (node.kind === 'container') filledSlotIds(node.children, into);
		}
		return into;
	}

	const slots = $derived(template?.scenes.find((s) => s.id === scene?.id)?.slots ?? []);
	const filled = $derived(scene ? filledSlotIds(scene.nodes, new Set()) : new Set<string>());
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

{#if slots.length > 0}
	<section class="slots">
		<h4>Slots</h4>
		<ul class="slot-list">
			{#each slots as slot (slot.slotId)}
				{@const isFilled = filled.has(slot.slotId)}
				{@const missing = !isFilled && slot.required}
				<li>
					<button
						type="button"
						class="slot"
						class:missing
						class:dropping={dragSlotId === slot.slotId}
						class:droppable={isDroppable(slot.kind)}
						title={isDroppable(slot.kind)
							? `Drag a Library asset here to fill ${slot.name}`
							: `${slot.name} is a mount slot (engine-owned anchor)`}
						ondragover={(e) => onSlotDragOver(e, slot.slotId, slot.kind)}
						ondragleave={() => (dragSlotId = null)}
						ondrop={(e) => onSlotDrop(e, slot.slotId, slot.kind)}
					>
						<span class="dot" class:filled={isFilled}></span>
						<span class="label">{slot.name}</span>
						<span class="kind">{slot.kind}</span>
						<span class="status" class:missing>{isFilled ? 'filled' : 'empty'}</span>
					</button>
				</li>
			{/each}
		</ul>
	</section>
{/if}

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
	.slots {
		margin: 0 0 14px;
		padding: 0 0 12px;
		border-bottom: 1px solid #1c1c24;
	}
	h4 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #aaa;
		margin: 0 0 6px;
	}
	.slot-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.slot {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		padding: 5px 8px;
		font-size: 12px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: #c8c8d0;
		font-family: inherit;
		cursor: default;
	}
	.slot.droppable {
		cursor: copy;
	}
	.slot.dropping {
		border-color: #7ee0c0;
		background: #14201c;
		color: #cffaec;
	}
	.slot.missing {
		border-color: #4a2a30;
		background: #1f1418;
		color: #ff9a9a;
	}
	.dot {
		width: 7px;
		height: 7px;
		border-radius: 999px;
		border: 1px solid #444;
		flex: none;
	}
	.dot.filled {
		background: #7ee0c0;
		border-color: #234038;
	}
	.status {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.status.missing {
		color: #ff9a9a;
	}
</style>
