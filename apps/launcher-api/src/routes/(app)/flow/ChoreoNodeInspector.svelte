<script lang="ts">
	import {
		findEmitterEffect,
		findEmitterEvent,
		groupEmitterVocabulary,
		type ChoreographyNode,
		type EmitterVocabulary,
		type FlowAccessor,
		type FlowComparator,
		type FlowGuard,
		type FlowPayload,
	} from 'engine-flow';
	import type { ChoreoKind, ChoreoNodeEdit, ChoreoPath } from './choreographyModel.client';

	// The micro-node inspector (design doc §5/§9). Edits the SELECTED choreography node's own
	// fields, and offers add-child / set-slot actions for containers. The Broadcast event
	// picker lists the game's REAL emitter vocabulary (passed in, design doc §3/§11) — it is
	// NOT a free-text invented name. Every change emits a typed callback the page applies
	// through the SAME command stack as the macro graph.
	let {
		node,
		path,
		vocab,
		onedit,
		onaddChild,
		onsetSlot,
		onremove,
	}: {
		node: ChoreographyNode;
		path: ChoreoPath;
		vocab: EmitterVocabulary;
		onedit: (edit: ChoreoNodeEdit) => void;
		onaddChild: (kind: ChoreoKind) => void;
		onsetSlot: (slot: 'body' | 'then' | 'otherwise', kind: ChoreoKind) => void;
		onremove: () => void;
	} = $props();

	const ADD_KINDS: ChoreoKind[] = [
		'broadcast',
		'delay',
		'sequence',
		'parallel',
		'branch',
		'forEach',
	];
	const grouped = $derived(groupEmitterVocabulary(vocab));
	const isRoot = $derived(path.length === 0);

	// --- Broadcast -------------------------------------------------------------
	const eventDef = $derived(
		node.kind === 'broadcast' ? findEmitterEvent(vocab, node.event) : undefined,
	);
	function setEvent(event: string): void {
		onedit({ event });
	}

	// --- Effect ----------------------------------------------------------------
	// The effect-name picker offers the game's REAL registered effects (passed in via the same
	// EmitterVocabulary as the Broadcast events, design doc §11.5). Authoring-fidelity only.
	const hasEffects = $derived((vocab.effects?.length ?? 0) > 0);
	const effectDef = $derived(
		node.kind === 'effect' ? findEmitterEffect(vocab, node.name) : undefined,
	);
	function setName(name: string): void {
		onedit({ name });
	}
	function setShape(shape: 'sync' | 'awaited' | 'fire'): void {
		if (shape === 'sync') onedit({ async: false, await: false });
		else if (shape === 'awaited') onedit({ async: true, await: true });
		else onedit({ async: true, await: false });
	}
	const shape = $derived(
		node.kind === 'broadcast' ? (node.async ? (node.await ? 'awaited' : 'fire') : 'sync') : 'sync',
	);

	// Payload fields: parse author strings into bounded accessors (same grammar as the edge
	// guard — `$trigger.x` / `$engine.x` / `$item.x` / literal).
	function parseAccessor(text: string): FlowAccessor {
		const t = text.trim();
		if (t.startsWith('$engine.')) return { kind: 'engine', key: t.slice('$engine.'.length) };
		if (t.startsWith('$trigger.')) return { kind: 'trigger', path: t.slice('$trigger.'.length) };
		if (t.startsWith('$item.')) return { kind: 'item', path: t.slice('$item.'.length) };
		const num = Number(t);
		return { kind: 'literal', value: t !== '' && !Number.isNaN(num) ? num : t };
	}
	function accessorText(a: FlowAccessor | undefined): string {
		if (!a) return '';
		switch (a.kind) {
			case 'engine':
				return `$engine.${a.key}`;
			case 'trigger':
				return `$trigger.${a.path}`;
			case 'item':
				return `$item.${a.path}`;
			case 'literal':
				return String(a.value);
		}
	}
	function setPayloadField(key: string, text: string): void {
		if (node.kind !== 'broadcast') return;
		const payload: FlowPayload = { ...(node.payload ?? {}) };
		if (text.trim() === '') delete payload[key];
		else payload[key] = parseAccessor(text);
		onedit({ payload: Object.keys(payload).length > 0 ? payload : null });
	}

	// --- Delay -----------------------------------------------------------------
	function setMs(value: string): void {
		const ms = Number(value);
		if (!Number.isNaN(ms)) onedit({ ms });
	}

	// --- ForEach ---------------------------------------------------------------
	function setList(text: string): void {
		onedit({ list: parseAccessor(text) });
	}
	function setMode(mode: 'sequence' | 'parallel'): void {
		onedit({ mode });
	}

	// --- Branch guard (single predicate, the all[0] slot — same as the edge inspector) ---
	const COMPARATORS: FlowComparator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'];
	let guardLeft = $state('');
	let guardOp = $state<FlowComparator>('eq');
	let guardRight = $state('');
	$effect(() => {
		const pred = node.kind === 'branch' ? node.guard.all[0] : undefined;
		guardLeft = accessorText(pred?.left) || '$engine.';
		guardOp = pred?.op ?? 'eq';
		guardRight = accessorText(pred?.right);
	});
	function applyGuard(): void {
		const guard: FlowGuard = {
			all: [{ left: parseAccessor(guardLeft), op: guardOp, right: parseAccessor(guardRight) }],
		};
		onedit({ guard });
	}
</script>

<div class="node-inspector">
	<h3>{node.kind}</h3>

	{#if node.kind === 'broadcast'}
		<label class="field">
			<span>Emitter event</span>
			<select value={node.event} onchange={(e) => setEvent(e.currentTarget.value)}>
				<option value="">— pick an event —</option>
				{#each grouped as g (g.group)}
					<optgroup label={g.group}>
						{#each g.events as ev (ev.type)}
							<option value={ev.type}>{ev.type}</option>
						{/each}
					</optgroup>
				{/each}
			</select>
		</label>

		<label class="field">
			<span>Dispatch shape</span>
			<select value={shape} onchange={(e) => setShape(e.currentTarget.value as 'sync')}>
				<option value="sync">broadcast (sync)</option>
				<option value="awaited">broadcastAsync — await</option>
				<option value="fire">broadcastAsync — fire-and-forget</option>
			</select>
		</label>

		{#if eventDef?.fields?.length}
			<div class="payload">
				<span class="sub">Payload</span>
				{#each eventDef.fields as f (f.key)}
					<label class="field small">
						<span>{f.key}{f.required ? ' *' : ''} <em>({f.kind})</em></span>
						<input
							value={accessorText(node.payload?.[f.key])}
							placeholder="$trigger.x / $engine.x / literal"
							oninput={(e) => setPayloadField(f.key, e.currentTarget.value)}
						/>
					</label>
				{/each}
			</div>
		{/if}
	{:else if node.kind === 'effect'}
		<label class="field">
			<span>Effect name</span>
			{#if hasEffects}
				<select value={node.name} onchange={(e) => setName(e.currentTarget.value)}>
					<option value="">— pick an effect —</option>
					{#each vocab.effects ?? [] as ef (ef.name)}
						<option value={ef.name}>{ef.name}</option>
					{/each}
				</select>
			{:else}
				<input value={node.name} oninput={(e) => setName(e.currentTarget.value)} />
			{/if}
		</label>
		{#if node.name && !effectDef && hasEffects}
			<p class="warn">Not a registered effect for this game.</p>
		{/if}
	{:else if node.kind === 'delay'}
		<label class="field">
			<span>Delay (ms, divided by speed)</span>
			<input type="number" min="0" value={node.ms} oninput={(e) => setMs(e.currentTarget.value)} />
		</label>
	{:else if node.kind === 'forEach'}
		<label class="field">
			<span>List accessor</span>
			<input
				value={accessorText(node.list)}
				placeholder="$trigger.wins"
				oninput={(e) => setList(e.currentTarget.value)}
			/>
		</label>
		<label class="field">
			<span>Mode</span>
			<select value={node.mode} onchange={(e) => setMode(e.currentTarget.value as 'sequence')}>
				<option value="sequence">sequence (serial)</option>
				<option value="parallel">parallel</option>
			</select>
		</label>
		<button class="slot-btn" onclick={() => onsetSlot('body', 'sequence')}
			>Reset body → Sequence</button
		>
	{:else if node.kind === 'branch'}
		<div class="guard">
			<span class="sub">Guard</span>
			<div class="guard-row">
				<input bind:value={guardLeft} placeholder="$engine.winLevel" />
				<select bind:value={guardOp}>
					{#each COMPARATORS as c (c)}
						<option value={c}>{c}</option>
					{/each}
				</select>
				<input bind:value={guardRight} placeholder="3" />
			</div>
			<button onclick={applyGuard}>Set guard</button>
		</div>
		<div class="slots">
			<button class="slot-btn" onclick={() => onsetSlot('then', 'sequence')}
				>Reset then → Sequence</button
			>
			<button class="slot-btn" onclick={() => onsetSlot('otherwise', 'sequence')}
				>Set else → Sequence</button
			>
		</div>
	{/if}

	{#if node.kind === 'sequence' || node.kind === 'parallel'}
		<div class="add">
			<span class="sub">Add child</span>
			<div class="add-grid">
				{#each ADD_KINDS as k (k)}
					<button onclick={() => onaddChild(k)}>+ {k}</button>
				{/each}
			</div>
		</div>
	{/if}

	{#if !isRoot}
		<button class="danger" onclick={onremove}>Remove node</button>
	{:else}
		<button class="danger" onclick={onremove}>Clear this phase</button>
	{/if}
</div>

<style>
	.node-inspector {
		color: #cbd5e1;
		font-size: 12px;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 9px;
	}
	.field.small {
		margin-bottom: 6px;
	}
	.field span {
		color: #94a3b8;
	}
	.field em {
		color: #64748b;
		font-style: normal;
	}
	input,
	select {
		background: #0e131a;
		border: 1px solid #2a323d;
		border-radius: 5px;
		color: #e2e8f0;
		padding: 4px 6px;
		font-size: 12px;
	}
	.sub {
		display: block;
		color: #94a3b8;
		margin-bottom: 5px;
	}
	.warn {
		margin: -4px 0 9px;
		color: #fbbf24;
		font-size: 11px;
	}
	.payload,
	.guard,
	.add,
	.slots {
		border-top: 1px solid #1f2937;
		padding-top: 9px;
		margin-bottom: 9px;
	}
	.guard-row {
		display: grid;
		grid-template-columns: 1fr 52px 1fr;
		gap: 4px;
		margin-bottom: 6px;
	}
	.add-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 4px;
	}
	.add-grid button,
	.guard button,
	.slot-btn {
		background: #161b22;
		border: 1px solid #2a323d;
		border-radius: 5px;
		color: #cbd5e1;
		padding: 4px 8px;
		cursor: pointer;
		font-size: 11px;
	}
	.slots {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.danger {
		width: 100%;
		margin-top: 6px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #5b2a2a;
		background: #1d1416;
		color: #fca5a5;
		cursor: pointer;
		font-size: 12px;
	}
</style>
