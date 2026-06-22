<script lang="ts">
	/**
	 * Shared "Elements" palette rows for the Scene Editor and Component Editor.
	 * Single source of truth for the draggable Text / Container / Rect rows so a
	 * new palette element is a one-place change. The optional Reel row is
	 * scene-only (a reel grid doesn't belong in a reusable component): it renders
	 * only when a `reel` prop is supplied.
	 *
	 * Carries its own `<style>` (canonical = the Scene Editor's palette CSS) so the
	 * rows look identical in both pages — Svelte scoped styles do not cross the
	 * component boundary, so the parent pages' `.name`/`.tag`/`li` rules wouldn't
	 * otherwise apply here.
	 */
	type DragPayload = { kind: string; key: string; name: string };

	const {
		onElementDragStart,
		reel,
	}: {
		onElementDragStart: (e: DragEvent, payload: DragPayload) => void;
		reel?: { active: boolean; onAdd: () => void };
	} = $props();
</script>

<li
	draggable="true"
	ondragstart={(e) => onElementDragStart(e, { kind: 'text', key: '', name: 'Text' })}
>
	<span class="name">Text</span>
	<span class="tag">text</span>
</li>
<li
	draggable="true"
	ondragstart={(e) => onElementDragStart(e, { kind: 'container', key: '', name: 'Group' })}
>
	<span class="name">Container</span>
	<span class="tag">group</span>
</li>
<li
	draggable="true"
	ondragstart={(e) => onElementDragStart(e, { kind: 'rect', key: '', name: 'Rect' })}
>
	<span class="name">Rect</span>
	<span class="tag">fill</span>
</li>
{#if reel}
	<li
		class="click"
		class:active={reel.active}
		title={reel.active
			? 'This layout already has a reel grid (one per game) — click to select it.'
			: 'Insert the reel/board placeholder. Drives the in-game board position + cell size.'}
	>
		<!-- Real <button> (not a clickable <li>) so keyboard activation +
			 a11y are native; `display: contents` keeps the palette look identical. -->
		<button type="button" class="li-btn" onclick={reel.onAdd}>
			<span class="name">Reel</span>
			<span class="tag">grid</span>
		</button>
	</li>
{/if}

<style>
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		font-size: 12px;
		border-radius: 6px;
		background: #16161c;
		border: 1px solid #1f1f28;
	}
	li[draggable='true'] {
		cursor: grab;
	}
	li[draggable='true']:hover {
		border-color: #2f3a48;
		background: #1a1a22;
	}
	li[draggable='true']:active {
		cursor: grabbing;
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		font-size: 10px;
		color: #777;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	li.click {
		cursor: pointer;
	}
	.li-btn {
		display: contents;
		font: inherit;
		color: inherit;
		text-align: inherit;
		cursor: pointer;
	}
	li.click:hover {
		border-color: #2f3a48;
		background: #1a1a22;
	}
	li.click.active {
		border-color: #2f4660;
		color: #9cc4ff;
	}
</style>
