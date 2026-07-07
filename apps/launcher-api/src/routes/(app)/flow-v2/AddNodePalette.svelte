<script lang="ts">
	// Invisible Flow v2 — the vocabulary-driven add-node palette (Phase 2b.1). Every entry adds
	// a MEANINGFUL node: sections are projected from the loaded vocabulary + function library +
	// the doc's own containers, plus a fixed Control section. DRAGGING an entry onto the canvas
	// drops the node at the cursor (the primary path); the payload it writes is read by the
	// canvas `drop` handler. CLICKING still works as a fallback (centroid placement). Both carry
	// the node KIND and (where relevant) the REFERENCE it should carry. Ref/field editing is 2b.2.
	import type { FlowDoc, FunctionLibraryDoc, NodeKind, TemplateVocabulary } from 'engine-flow-v2';
	import { DROP_MIME, type DropPayload } from './dnd';

	let {
		vocab,
		library,
		doc,
		onadd,
		onopen,
		ondelete,
		deleteError = null,
	}: {
		vocab: TemplateVocabulary;
		library: FunctionLibraryDoc;
		doc: FlowDoc;
		onadd: (kind: NodeKind, ref?: string) => void;
		// Open a function's body for editing (2c.3). Optional — absent when the palette is shown
		// inside a function body (no nested-open there).
		onopen?: (functionId: string) => void;
		// Delete a function from the library (guarded by the caller against in-use call sites).
		ondelete?: (functionId: string) => void;
		// A non-blocking message when a delete was blocked ("in use by N calls").
		deleteError?: string | null;
	} = $props();

	// Control nodes carry no `ref` — their fields get defaults now (2b.1) and are edited in 2b.2.
	const CONTROL: { kind: NodeKind; label: string }[] = [
		{ kind: 'delay', label: 'Delay' },
		{ kind: 'branch', label: 'Branch' },
		{ kind: 'forEach', label: 'ForEach' },
		{ kind: 'sequence', label: 'Sequence' },
		{ kind: 'parallel', label: 'Parallel' },
		{ kind: 'compute', label: 'Compute' },
	];

	let query = $state('');
	const matches = (label: string): boolean =>
		!query.trim() || label.toLowerCase().includes(query.trim().toLowerCase());

	// Write the add-node payload onto the drag so the canvas can drop it at the cursor.
	function onDragStart(event: DragEvent, kind: NodeKind, ref?: string): void {
		if (!event.dataTransfer) return;
		const payload: DropPayload = ref === undefined ? { kind } : { kind, ref };
		event.dataTransfer.setData(DROP_MIME, JSON.stringify(payload));
		event.dataTransfer.effectAllowed = 'move';
	}
</script>

<div class="palette">
	<h3>Add node</h3>
	<p class="dnd-hint">Drag onto the canvas to drop at the cursor · click to add</p>
	<input class="search" type="text" placeholder="Filter…" bind:value={query} />

	<section>
		<h4>Events</h4>
		{#each vocab.events.filter((e) => matches(e.name)) as e (e.name)}
			<button
				class="entry event"
				draggable={true}
				ondragstart={(ev) => onDragStart(ev, 'event', e.name)}
				onclick={() => onadd('event', e.name)}
				title="event · {e.name}"
			>
				{e.name}
			</button>
		{/each}
	</section>

	<section>
		<h4>Actions</h4>
		{#each vocab.actions.filter((a) => matches(a.name)) as a (a.name)}
			<button
				class="entry action"
				draggable={true}
				ondragstart={(ev) => onDragStart(ev, 'action', a.name)}
				onclick={() => onadd('action', a.name)}
				title="action · {a.category}"
			>
				{a.name}<span class="cat">{a.category}</span>
			</button>
		{/each}
	</section>

	<section>
		<h4>Cues</h4>
		{#each vocab.cues.filter((c) => matches(c.name)) as c (c.name)}
			<button
				class="entry cue"
				draggable={true}
				ondragstart={(ev) => onDragStart(ev, 'fireCue', c.name)}
				onclick={() => onadd('fireCue', c.name)}
				title="fireCue · {c.name}"
			>
				{c.name}
			</button>
		{/each}
	</section>

	<section>
		<h4>Functions</h4>
		{#if deleteError}
			<p class="fn-error">Can't delete — {deleteError}.</p>
		{/if}
		{#each library.functions.filter((f) => matches(f.name)) as f (f.id)}
			<div class="fn-row">
				<button
					class="entry fn"
					draggable={true}
					ondragstart={(ev) => onDragStart(ev, 'functionCall', f.id)}
					onclick={() => onadd('functionCall', f.id)}
					title="functionCall · {f.id} — drag/click to add a call; use ✎ to edit its body"
				>
					{f.name}
				</button>
				{#if onopen}
					<button
						class="fn-op"
						type="button"
						onclick={() => onopen?.(f.id)}
						title="Edit this function's body">✎</button
					>
				{/if}
				{#if ondelete}
					<button
						class="fn-op rm"
						type="button"
						onclick={() => ondelete?.(f.id)}
						title="Delete this function (blocked if in use)">✕</button
					>
				{/if}
			</div>
		{/each}
	</section>

	<section>
		<h4>Containers</h4>
		{#each doc.containers.filter((c) => matches(c.id)) as c (c.id)}
			<div class="pair">
				<button
					class="entry container"
					draggable={true}
					ondragstart={(ev) => onDragStart(ev, 'showContainer', c.id)}
					onclick={() => onadd('showContainer', c.id)}
					title="showContainer · {c.id}"
				>
					show {c.id}
				</button>
				<button
					class="entry container"
					draggable={true}
					ondragstart={(ev) => onDragStart(ev, 'hideContainer', c.id)}
					onclick={() => onadd('hideContainer', c.id)}
					title="hideContainer · {c.id}"
				>
					hide {c.id}
				</button>
			</div>
		{/each}
	</section>

	<section>
		<h4>Control</h4>
		{#each CONTROL.filter((c) => matches(c.label)) as c (c.kind)}
			<button
				class="entry control"
				draggable={true}
				ondragstart={(ev) => onDragStart(ev, c.kind)}
				onclick={() => onadd(c.kind)}
				title={c.kind}
			>
				{c.label}
			</button>
		{/each}
	</section>
</div>

<style>
	.palette {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	h3 {
		margin: 0;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.dnd-hint {
		margin: 0;
		font-size: 11px;
		line-height: 1.4;
		color: #64748b;
	}
	.search {
		width: 100%;
		box-sizing: border-box;
		background: #11161d;
		border: 1px solid #2a323d;
		border-radius: 6px;
		color: #e2e8f0;
		font-size: 12px;
		padding: 5px 8px;
	}
	.search:focus {
		outline: none;
		border-color: #2563eb;
	}
	section {
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	h4 {
		margin: 4px 0 2px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #64748b;
	}
	.entry {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
		width: 100%;
		text-align: left;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #cbd5e1;
		font-size: 12px;
		/* Drag onto the canvas to drop at the cursor (click still adds at the centroid). */
		cursor: grab;
	}
	.entry:hover {
		border-color: #3a4655;
		background: #1a1f28;
	}
	.entry:active {
		cursor: grabbing;
	}
	.pair {
		display: flex;
		gap: 4px;
	}
	.pair .entry {
		flex: 1;
	}
	.fn-row {
		display: flex;
		gap: 4px;
		align-items: stretch;
	}
	.fn-row .entry {
		flex: 1;
	}
	.fn-op {
		flex: none;
		width: 28px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #94a3b8;
		font-size: 12px;
		cursor: pointer;
	}
	.fn-op:hover {
		border-color: #3a4655;
		color: #e2e8f0;
	}
	.fn-op.rm:hover {
		border-color: #4a2a30;
		color: #fca5a5;
	}
	.fn-error {
		margin: 0 0 2px;
		font-size: 11px;
		color: #fca5a5;
	}
	.cat {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #64748b;
	}
	/* Left accent per section, mirroring the node header hues. */
	.entry.event {
		border-left: 3px solid #22c55e;
	}
	.entry.action {
		border-left: 3px solid #f59e0b;
	}
	.entry.cue {
		border-left: 3px solid #a855f7;
	}
	.entry.fn {
		border-left: 3px solid #eab308;
	}
	.entry.container {
		border-left: 3px solid #6366f1;
	}
	.entry.control {
		border-left: 3px solid #64748b;
	}
</style>
