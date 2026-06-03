<script lang="ts">
	import type { GameTemplate, LayoutNode, Scene } from 'engine-layout';

	interface Props {
		/** The loaded template (R2 override or built-in fallback), or undefined. */
		template: GameTemplate | undefined;
		/** Current editor scenes — used to mark which slots are filled + which
		 * template scenes already exist in the document. */
		scenes: Scene[];
		/** id of the editor's active scene (highlights the matching template scene). */
		activeSceneId?: string;
		/** Switch the editor to a template scene, creating it in the doc if missing. */
		onPickScene?: (sceneId: string, sceneName: string) => void;
		/** Fill a slot by dropping a Library asset onto its row (drag-to-slot). */
		onFillSlot?: (sceneId: string, sceneName: string, slotId: string, payload: unknown) => void;
	}
	let { template, scenes, activeSceneId, onPickScene, onFillSlot }: Props = $props();

	function collectFilled(nodes: LayoutNode[], into: Set<string>): Set<string> {
		for (const n of nodes) {
			if (n.slotId) into.add(n.slotId);
			if (n.kind === 'container') collectFilled(n.children, into);
		}
		return into;
	}

	function filledFor(sceneId: string): Set<string> {
		const sc = scenes.find((s) => s.id === sceneId);
		return sc ? collectFilled(sc.nodes, new Set()) : new Set<string>();
	}

	function sceneInDoc(sceneId: string): boolean {
		return scenes.some((s) => s.id === sceneId);
	}

	/** `${sceneId}:${slotId}` of the slot row a Library asset is hovering over. */
	let dragSlotKey = $state<string | null>(null);

	/** `mount` slots are engine-owned anchors, not asset targets — not droppable. */
	function isDroppable(kind: string): boolean {
		return kind !== 'mount';
	}

	function onSlotDragOver(e: DragEvent, key: string, kind: string): void {
		if (!e.dataTransfer || !isDroppable(kind)) return;
		if (!Array.from(e.dataTransfer.types).includes('application/x-iw-asset')) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = 'copy';
		dragSlotKey = key;
	}

	function onSlotDrop(
		e: DragEvent,
		scene: { id: string; name: string },
		slot: { slotId: string; kind: string },
	): void {
		dragSlotKey = null;
		if (!e.dataTransfer || !isDroppable(slot.kind)) return;
		const raw = e.dataTransfer.getData('application/x-iw-asset');
		if (!raw) return;
		e.preventDefault();
		let payload: unknown;
		try {
			payload = JSON.parse(raw);
		} catch {
			return;
		}
		onFillSlot?.(scene.id, scene.name, slot.slotId, payload);
	}
</script>

{#if !template}
	<p class="muted">
		No template for this game type yet. Tag nodes with a <strong>slotId</strong> in Properties, then
		click <strong>Save template</strong> to create it.
	</p>
{:else}
	<section class="tpl">
		<h3>{template.gameType} <span class="count">template</span></h3>
		<p class="hint">
			To fill a slot: open the <strong>Library</strong> tab and <strong>drag an asset onto a
			slot below</strong>. It's placed on the canvas, tagged to that slot. (Or drop it on the
			canvas and pick the slot in <strong>Properties</strong>.) <span class="mount-note">Mount
			slots are engine-owned anchors — no asset needed.</span>
		</p>
		{#each template.scenes as scene (scene.id)}
			{@const filled = filledFor(scene.id)}
			<div class="scene">
				<button
					type="button"
					class="scene-head"
					class:active={scene.id === activeSceneId}
					onclick={() => onPickScene?.(scene.id, scene.name)}
				>
					<span class="scene-name">{scene.name}</span>
					<span class="count">{scene.slots.length}</span>
					{#if !sceneInDoc(scene.id)}<span class="add">+ add</span>{/if}
				</button>
				<ul class="slot-list">
					{#each scene.slots as slot (slot.slotId)}
						{@const isFilled = filled.has(slot.slotId)}
						{@const slotKey = `${scene.id}:${slot.slotId}`}
						<li>
							<button
								type="button"
								class="slot"
								class:missing={!isFilled && slot.required}
								class:dropping={dragSlotKey === slotKey}
								class:droppable={isDroppable(slot.kind)}
								title={isDroppable(slot.kind)
									? `Drag a Library asset here to fill ${slot.name}`
									: `${slot.name} is a mount slot (engine-owned anchor)`}
								onclick={() => onPickScene?.(scene.id, scene.name)}
								ondragover={(e) => onSlotDragOver(e, slotKey, slot.kind)}
								ondragleave={() => (dragSlotKey = null)}
								ondrop={(e) => onSlotDrop(e, scene, slot)}
							>
								<span class="dot" class:filled={isFilled}></span>
								<span class="label">{slot.name}</span>
								<span class="kind">{slot.kind}</span>
								{#if slot.required}<span class="req">required</span>{/if}
								<span class="status" class:missing={!isFilled && slot.required}>
									{isFilled ? 'filled' : 'empty'}
								</span>
							</button>
						</li>
					{:else}
						<li class="muted">No slots in this scene.</li>
					{/each}
				</ul>
			</div>
		{/each}
	</section>
{/if}

<style>
	.muted {
		color: #777;
		font-size: 12px;
		padding: 8px;
		line-height: 1.5;
	}
	h3 {
		font-size: 13px;
		margin: 0 0 4px;
		color: #c8a3ff;
		text-transform: capitalize;
	}
	.hint {
		color: #777;
		font-size: 11px;
		margin: 0 0 12px;
		line-height: 1.4;
	}
	.count {
		color: #666;
		font-size: 11px;
	}
	.scene {
		margin: 0 0 14px;
	}
	.scene-head {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 5px 8px;
		margin: 0 0 4px;
		cursor: pointer;
		color: #aaa;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.scene-head:hover {
		background: #16131c;
	}
	.scene-head.active {
		border-color: #6b5bff;
		color: #c8a3ff;
		background: #1a1622;
	}
	.scene-name {
		font-weight: 600;
	}
	.add {
		margin-left: auto;
		color: #7ee0c0;
		font-size: 10px;
		text-transform: none;
		letter-spacing: 0;
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
		cursor: pointer;
	}
	.slot:hover {
		background: #16131c;
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
	.mount-note {
		color: #666;
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
	.kind {
		color: #888;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.req {
		color: #c8a3ff;
		font-size: 10px;
		text-transform: uppercase;
	}
	.status {
		margin-left: auto;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.status.missing {
		color: #ff9a9a;
	}
</style>
