<script lang="ts">
	/**
	 * The ANIMATIONS list (Rive plan Phase 9c, `docs/design/rive-reference.md` §3.2): every timeline
	 * of the screen or component the shown Timeline panel animates, and — on a component — the state
	 * machine as its own row. It replaces the Timeline panel's `<select>`: a row opens its timeline,
	 * ＋ creates one, and each row duplicates, renames and deletes. A timeline row drags onto the
	 * State machine graph to become a state there. Everything goes through the panel
	 * (`animationsPanel()`), which owns the store and the unsaved-edit guard.
	 */
	import { TIMELINE_DRAG_TYPE, animationsPanel } from './animationsList.client.svelte';

	interface Props {
		/** The component's state machine row; absent on a screen (screens have no state machine). */
		stateMachine?: { shown: boolean; layers: number; onOpen: () => void };
		/** A timeline row was picked: the host shows the Timeline (on a component, its tab). */
		onShowTimeline?: () => void;
	}
	let { stateMachine, onShowTimeline }: Props = $props();

	const panel = $derived(animationsPanel());

	function openRow(id: string): void {
		onShowTimeline?.();
		void panel?.open(id);
	}
	function onDragStart(e: DragEvent, id: string): void {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData(TIMELINE_DRAG_TYPE, id);
		e.dataTransfer.effectAllowed = 'copy';
	}
</script>

<div class="anim-list" aria-label="Animations">
	{#if !panel}
		<p class="muted">
			Open Animate to list this {stateMachine ? 'component' : 'screen'}'s timelines.
		</p>
	{:else}
		<div class="head">
			<span class="muted" title={panel.hostLabel}>{panel.hostLabel}</span>
			<button
				type="button"
				class="add"
				disabled={!panel.canCreate}
				title={`New timeline on this ${panel.where}`}
				onclick={() => {
					onShowTimeline?.();
					void panel.create();
				}}>＋</button
			>
		</div>
		<ul>
			{#each panel.rows as row (row.id)}
				{@const open = row.id === panel.openId && !stateMachine?.shown}
				<li class:open>
					<button
						type="button"
						class="row"
						draggable={!!stateMachine}
						ondragstart={(e) => onDragStart(e, row.id)}
						title={stateMachine
							? 'Open this timeline — or drag it onto the State machine graph to add a state'
							: 'Open this timeline'}
						onclick={() => openRow(row.id)}
					>
						<span class="icon" aria-hidden="true">⏱</span>
						<span class="name">{row.name}</span>
						{#if row.id === panel.openId && panel.dirty}<span class="dirty" title="Unsaved">●</span
							>{/if}
						<span class="dur">{row.duration.toFixed(1)}s</span>
					</button>
					<span class="acts">
						<button
							type="button"
							title="Duplicate"
							aria-label={`Duplicate ${row.name}`}
							onclick={() => void panel.duplicate(row.id)}>⧉</button
						>
						<button
							type="button"
							title="Rename"
							aria-label={`Rename ${row.name}`}
							onclick={() => void panel.rename(row.id)}>✎</button
						>
						<button
							type="button"
							class="danger"
							title="Delete"
							aria-label={`Delete ${row.name}`}
							onclick={() => void panel.remove(row.id)}>🗑</button
						>
					</span>
				</li>
			{:else}
				<li class="muted empty">No timelines on this {panel.where} yet — ＋ adds one.</li>
			{/each}
			{#if stateMachine}
				<li class="sm" class:open={stateMachine.shown}>
					<button
						type="button"
						class="row"
						title="Which timeline plays when: states, transitions and the inputs between them"
						onclick={stateMachine.onOpen}
					>
						<span class="icon" aria-hidden="true">◈</span>
						<span class="name">State machine</span>
						<span class="dur"
							>{stateMachine.layers} layer{stateMachine.layers === 1 ? '' : 's'}</span
						>
					</button>
				</li>
			{/if}
		</ul>
	{/if}
</div>

<style>
	.anim-list {
		padding: 4px 6px 8px;
		font-size: 12px;
	}
	.head {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-bottom: 4px;
	}
	.head .muted {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.muted {
		color: var(--muted, #8a93a6);
		margin: 4px 0;
	}
	ul {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	li {
		display: flex;
		align-items: center;
		border-radius: 4px;
	}
	li:hover,
	li.open {
		background: rgba(255, 255, 255, 0.06);
	}
	li.open .name {
		color: var(--accent, #6aa7ff);
	}
	li.sm {
		margin-top: 4px;
		border-top: 1px solid var(--line, #2a2f3a);
		padding-top: 2px;
	}
	.row {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 6px;
		background: none;
		border: 0;
		color: inherit;
		text-align: left;
		padding: 4px;
		cursor: pointer;
		font: inherit;
	}
	.row[draggable='true'] {
		cursor: grab;
	}
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.icon,
	.dur {
		color: var(--muted, #8a93a6);
	}
	.dur {
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.dirty {
		color: #e0b050;
		font-size: 9px;
	}
	.acts {
		display: none;
		gap: 2px;
		padding-right: 2px;
	}
	li:hover .acts,
	li:focus-within .acts {
		display: flex;
	}
	.acts button,
	.add {
		background: none;
		border: 0;
		color: inherit;
		cursor: pointer;
		padding: 2px 4px;
		font: inherit;
	}
	.acts button:hover,
	.add:hover:not(:disabled) {
		color: var(--accent, #6aa7ff);
	}
	.acts .danger:hover {
		color: #ff8a8a;
	}
	.add:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.empty {
		padding: 4px;
	}
</style>
