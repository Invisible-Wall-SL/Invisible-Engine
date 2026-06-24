<script lang="ts">
	import {
		flowAccessorText,
		parseFlowAccessor,
		type FlowAccessor,
		type FlowComparator,
		type FlowGuard,
		type FlowPredicate,
		type FlowTransition,
		type FlowTrigger,
	} from 'engine-flow';
	import type { TransitionEdit } from './flowModel.client';

	// The transition inspector (design doc §6): edit a transition edge's trigger
	// (bookEvent / complete / condition), an optional bounded guard (a closed comparison
	// set — NOT an expression language, §11.4), an optional delay, and the author order.
	// Every change emits a {@link TransitionEdit} the page applies through a command.
	let {
		edge,
		screens,
		onedit,
		ondelete,
	}: {
		edge: FlowTransition;
		screens: { id: string; label: string }[];
		onedit: (edit: TransitionEdit) => void;
		ondelete: () => void;
	} = $props();

	const labelFor = (id: string): string => screens.find((s) => s.id === id)?.label ?? id;

	const COMPARATORS: FlowComparator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'];

	function setKind(kind: FlowTrigger['kind']): void {
		const trigger: FlowTrigger =
			kind === 'bookEvent'
				? { kind: 'bookEvent', event: edge.trigger.kind === 'bookEvent' ? edge.trigger.event : '' }
				: kind === 'complete'
					? { kind: 'complete' }
					: { kind: 'condition' };
		onedit({ trigger });
	}

	function setEvent(event: string): void {
		onedit({ trigger: { kind: 'bookEvent', event } });
	}

	function setDelay(value: string): void {
		const ms = value.trim() === '' ? null : Number(value);
		onedit({ delayMs: ms === null || Number.isNaN(ms) ? null : ms });
	}

	function setOrder(value: string): void {
		const n = Number(value);
		if (!Number.isNaN(n)) onedit({ order: n });
	}

	// --- Minimal single-predicate guard authoring (the `all[0]` slot) -------------
	const firstPredicate = $derived<FlowPredicate | undefined>(edge.guard?.all[0]);

	function buildGuard(
		left: FlowAccessor,
		op: FlowComparator,
		right: FlowAccessor,
	): FlowGuard {
		return { all: [{ left, op, right }] };
	}

	let guardLeft = $state('');
	let guardOp = $state<FlowComparator>('eq');
	let guardRight = $state('');

	$effect(() => {
		// Re-seed the guard form when a different edge is selected.
		guardLeft = flowAccessorText(firstPredicate?.left) || '$engine.';
		guardOp = firstPredicate?.op ?? 'eq';
		guardRight = flowAccessorText(firstPredicate?.right);
	});

	function applyGuard(): void {
		onedit({
			guard: buildGuard(parseFlowAccessor(guardLeft), guardOp, parseFlowAccessor(guardRight)),
		});
	}

	function clearGuard(): void {
		onedit({ guard: null });
	}
</script>

<div class="edge-inspector">
	<h3>Transition</h3>
	<p class="route">{labelFor(edge.from)} → {labelFor(edge.to)}</p>

	<label class="field">
		<span>Trigger</span>
		<select value={edge.trigger.kind} onchange={(e) => setKind(e.currentTarget.value as FlowTrigger['kind'])}>
			<option value="bookEvent">Book event</option>
			<option value="complete">Screen complete</option>
			<option value="condition">Engine condition</option>
		</select>
	</label>

	{#if edge.trigger.kind === 'bookEvent'}
		<label class="field">
			<span>Event type</span>
			<input
				value={edge.trigger.event}
				placeholder="e.g. freeSpinTrigger"
				oninput={(e) => setEvent(e.currentTarget.value)}
			/>
		</label>
	{/if}

	<label class="field">
		<span>Delay (ms)</span>
		<input
			type="number"
			min="0"
			value={edge.delayMs ?? ''}
			placeholder="none"
			oninput={(e) => setDelay(e.currentTarget.value)}
		/>
	</label>

	<label class="field">
		<span>Order</span>
		<input
			type="number"
			value={edge.order ?? 0}
			oninput={(e) => setOrder(e.currentTarget.value)}
		/>
	</label>

	<div class="guard">
		<span class="guard-title">Guard (optional)</span>
		<div class="guard-row">
			<input bind:value={guardLeft} placeholder="$engine.win" />
			<select bind:value={guardOp}>
				{#each COMPARATORS as c (c)}
					<option value={c}>{c}</option>
				{/each}
			</select>
			<input bind:value={guardRight} placeholder="value" />
		</div>
		<div class="guard-actions">
			<button onclick={applyGuard}>Set guard</button>
			{#if edge.guard}<button class="link" onclick={clearGuard}>clear</button>{/if}
		</div>
	</div>

	<button class="danger" onclick={ondelete}>Delete transition</button>
</div>

<style>
	.edge-inspector {
		border-top: 1px solid #1f2937;
		padding-top: 12px;
		margin-top: 12px;
		color: #cbd5e1;
		font-size: 12px;
	}
	h3 {
		margin: 0 0 6px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.route {
		margin: 0 0 10px;
		color: #93c5fd;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 3px;
		margin-bottom: 9px;
	}
	.field span {
		color: #94a3b8;
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
	.guard {
		border-top: 1px solid #1f2937;
		padding-top: 10px;
		margin: 6px 0 12px;
	}
	.guard-title {
		color: #94a3b8;
		display: block;
		margin-bottom: 6px;
	}
	.guard-row {
		display: grid;
		grid-template-columns: 1fr 56px 1fr;
		gap: 4px;
		margin-bottom: 6px;
	}
	.guard-actions {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.guard-actions button {
		background: #161b22;
		border: 1px solid #2a323d;
		border-radius: 5px;
		color: #cbd5e1;
		padding: 4px 10px;
		cursor: pointer;
		font-size: 12px;
	}
	.guard-actions .link {
		border: none;
		background: none;
		color: #94a3b8;
		text-decoration: underline;
		padding: 0;
	}
	.danger {
		width: 100%;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #5b2a2a;
		background: #1d1416;
		color: #fca5a5;
		cursor: pointer;
		font-size: 12px;
	}
</style>
