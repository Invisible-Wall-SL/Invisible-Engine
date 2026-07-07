<script lang="ts">
	import {
		edgeSemantics,
		flowAccessorText,
		parseFlowAccessor,
		type FlowAccessor,
		type FlowComparator,
		type FlowGuard,
		type FlowPredicate,
		type FlowTransition,
		type FlowTransitionEffect,
		type FlowTrigger,
	} from 'engine-flow';
	import { DEFAULT_FADE_TRANSITION, type TransitionEdit } from './flowModel.client';

	// The transition inspector (design doc §6): edit a transition edge's trigger
	// (bookEvent / complete / signal / condition), an optional bounded guard (a closed
	// comparison set — NOT an expression language, §11.4), an optional delay, and the order.
	// `signal` is the tap-to-continue trigger — a named runtime signal a tap-enabled component
	// emits (`emitSignal(name)`), letting a user CLICK drive the macro flow.
	// Every change emits a {@link TransitionEdit} the page applies through a command.
	let {
		edge,
		screens,
		onedit,
		ondelete,
		oneditResponse,
	}: {
		edge: FlowTransition;
		screens: { id: string; label: string }[];
		onedit: (edit: TransitionEdit) => void;
		ondelete: () => void;
		// Open the book-event RESPONSE choreography for this edge's event (design doc §14): the
		// node-authored `Sequence[…]` the interpreter runs + awaits when the event arrives.
		oneditResponse: (event: string) => void;
	} = $props();

	const labelFor = (id: string): string => screens.find((s) => s.id === id)?.label ?? id;

	// The active-SET semantic of the current trigger — the core authoring lever. A `complete`
	// edge HANDS OFF (the source screen hides); every other trigger LAYERS the target over the
	// still-active source. Shown live under the trigger selector so the author sees the effect.
	const semantic = $derived(edgeSemantics(edge));

	const COMPARATORS: FlowComparator[] = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in'];

	function setKind(kind: FlowTrigger['kind']): void {
		const trigger: FlowTrigger =
			kind === 'bookEvent'
				? { kind: 'bookEvent', event: edge.trigger.kind === 'bookEvent' ? edge.trigger.event : '' }
				: kind === 'complete'
					? { kind: 'complete' }
					: kind === 'signal'
						? { kind: 'signal', signal: edge.trigger.kind === 'signal' ? edge.trigger.signal : '' }
						: { kind: 'condition' };
		onedit({ trigger });
	}

	function setEvent(event: string): void {
		onedit({ trigger: { kind: 'bookEvent', event } });
	}

	// The book-event type of a bookEvent edge (empty otherwise) — drives the response-choreography
	// opener + its disabled state without re-narrowing inside a closure.
	const bookEvent = $derived(edge.trigger.kind === 'bookEvent' ? edge.trigger.event : '');

	function setSignal(signal: string): void {
		onedit({ trigger: { kind: 'signal', signal } });
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

	function buildGuard(left: FlowAccessor, op: FlowComparator, right: FlowAccessor): FlowGuard {
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

	// --- Entrance transition (the droppable "Transition (fade)" node, design doc §6) ----
	// When present, the edge's TARGET screen mounts HIDDEN and fades in over `ms` (scaled by
	// turbo) with the chosen easing; absent ⇒ a HARD CUT (instant mount, parity §7).
	const EASINGS: NonNullable<FlowTransitionEffect['easing']>[] = ['linear', 'easeOut', 'easeInOut'];
	const fade = $derived<FlowTransitionEffect | undefined>(edge.transition);

	function attachFade(): void {
		onedit({ transition: { ...DEFAULT_FADE_TRANSITION } });
	}
	function removeFade(): void {
		onedit({ transition: null });
	}
	function setFadeMs(value: string): void {
		if (!fade) return;
		const ms = Number(value);
		if (Number.isNaN(ms)) return;
		onedit({ transition: { ...fade, ms: Math.max(0, ms) } });
	}
	function setFadeEasing(easing: string): void {
		if (!fade) return;
		onedit({ transition: { ...fade, easing: easing as FlowTransitionEffect['easing'] } });
	}
</script>

<div class="edge-inspector">
	<h3>{edge.trigger.kind === 'value' ? 'Value binding' : 'Transition'}</h3>
	<p class="route">{labelFor(edge.from)} → {labelFor(edge.to)}</p>

	{#if edge.trigger.kind === 'value'}
		<!-- A value binding edge (design doc §11) is NOT an active-set transition — it's a reactive
		     subscription override, read-only in the inspector (its producer/sink live on the pins it
		     connects; re-point it by re-drawing the wire, remove it with Delete). -->
		<p class="semantic value">
			<span class="mark">≈ Value binding</span> — a reactive subscription: display "{edge.trigger
				.sink.instanceId}" ({edge.trigger.sink.source}) reads the
			<strong>{edge.trigger.producer}</strong> feed instead of its own default source. It moves NO screen
			state. Delete to revert the display to auto-binding by its own source name.
		</p>
	{:else}
		<label class="field">
			<span>Trigger</span>
			<select
				value={edge.trigger.kind}
				onchange={(e) => setKind(e.currentTarget.value as FlowTrigger['kind'])}
			>
				<option value="bookEvent">Book event</option>
				<option value="complete">Screen complete</option>
				<option value="signal">Tap signal</option>
				<option value="condition">Engine condition</option>
			</select>
		</label>

		<p class="semantic" class:handoff={semantic === 'handoff'} class:layer={semantic === 'layer'}>
			{#if semantic === 'handoff'}
				<span class="mark">⇥ Handoff</span> — "{labelFor(edge.from)}" hides and "{labelFor(
					edge.to,
				)}" becomes active. Use to move BETWEEN screens (e.g. loading → base game).
			{:else}
				<span class="mark">⧉ Layer</span> — "{labelFor(edge.to)}" activates OVER "{labelFor(
					edge.from,
				)}", which stays active underneath. Use for a celebration/overlay above a persistent screen.
				Add a Complete edge back from "{labelFor(edge.to)}" so it can dismiss itself.
			{/if}
		</p>
	{/if}

	{#if edge.trigger.kind === 'bookEvent'}
		<label class="field">
			<span>Event type</span>
			<input
				value={edge.trigger.event}
				placeholder="e.g. freeSpinTrigger"
				oninput={(e) => setEvent(e.currentTarget.value)}
			/>
		</label>
		<!-- FS-2 (design doc §14): the event can be authored by wiring a screen's book-event trigger
		     INPUT pin (draw into e.g. its `freeSpinTrigger` pin) instead of typing here. Typing stays
		     a valid fallback — both produce the same `trigger.event` the interpreter matches on. -->
		<p class="hint">
			Tip: draw an edge INTO a screen's book-event trigger pin (e.g. <code>freeSpinTrigger</code>)
			to set this from the graph — or type it here.
		</p>
		<!-- Author the node-level RESPONSE for this event (design doc §14) — the effect + broadcast
		     timeline the interpreter runs + awaits when the event arrives (e.g. `setExpandingSymbol`
		     → record the symbol then play the reveal). -->
		<button
			class="choreo"
			disabled={bookEvent.trim() === ''}
			onclick={() => oneditResponse(bookEvent)}
		>
			Edit response choreography…
		</button>
	{:else if edge.trigger.kind === 'signal'}
		<label class="field">
			<span>Signal name</span>
			<input
				value={edge.trigger.signal}
				placeholder="e.g. tapContinue"
				oninput={(e) => setSignal(e.currentTarget.value)}
			/>
		</label>
	{/if}

	<!-- Delay / order / guard / entrance-fade are active-set concepts — hidden for a value binding
	     edge (design doc §11.5), which carries none of them. -->
	{#if edge.trigger.kind !== 'value'}
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

		<div class="fade">
			<span class="fade-title">Entrance transition</span>
			<p class="fade-explain">
				{#if fade}
					<span class="mark">◐ Fade</span> — "{labelFor(edge.to)}" mounts hidden and fades in over
					{fade.ms}ms (scaled by turbo). Remove for an instant cut.
				{:else}
					A hard CUT — "{labelFor(edge.to)}" appears instantly when it activates. Add a fade to ease
					it in.
				{/if}
			</p>
			{#if fade}
				<div class="fade-row">
					<label class="field">
						<span>Kind</span>
						<select value="fade" disabled>
							<option value="fade">Fade</option>
						</select>
					</label>
					<label class="field">
						<span>Duration (ms)</span>
						<input
							type="number"
							min="0"
							value={fade.ms}
							oninput={(e) => setFadeMs(e.currentTarget.value)}
						/>
					</label>
					<label class="field">
						<span>Easing</span>
						<select
							value={fade.easing ?? 'linear'}
							onchange={(e) => setFadeEasing(e.currentTarget.value)}
						>
							{#each EASINGS as ease (ease)}
								<option value={ease}>{ease}</option>
							{/each}
						</select>
					</label>
				</div>
				<button class="link" onclick={removeFade}>Remove transition</button>
			{:else}
				<button class="fade-add" onclick={attachFade}>Add fade transition</button>
			{/if}
		</div>
	{/if}

	<button class="danger" onclick={ondelete}
		>{edge.trigger.kind === 'value' ? 'Delete binding' : 'Delete transition'}</button
	>
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
	/* The live handoff/layer explainer — colour-matched to the canvas edge classes (slate for
	   handoff, amber for layer) so the inspector reads the same as the wire. */
	.semantic {
		margin: 0 0 12px;
		padding: 7px 9px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #11161d;
		font-size: 11px;
		line-height: 1.45;
		color: #94a3b8;
	}
	.semantic.handoff {
		border-color: #3a4655;
	}
	.semantic.layer {
		border-color: #4a3a1c;
	}
	/* Value binding explainer (design doc §11) — sky-blue, matching the producer/value edge hue. */
	.semantic.value {
		border-color: #164a5f;
	}
	.semantic .mark {
		font-weight: 600;
	}
	.semantic.handoff .mark {
		color: #cbd5e1;
	}
	.semantic.layer .mark {
		color: #fdba74;
	}
	.semantic.value .mark {
		color: #7dd3fc;
	}
	.hint {
		margin: -4px 0 10px;
		font-size: 10px;
		line-height: 1.4;
		color: #7c8697;
	}
	.hint code {
		color: #a5b4fc;
		background: #12141f;
		border-radius: 3px;
		padding: 0 3px;
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
	/* Entrance transition (the droppable fade) — amber to match the palette chip + LAYER edges. */
	.fade {
		border-top: 1px solid #1f2937;
		padding-top: 10px;
		margin: 6px 0 12px;
	}
	.fade-title {
		color: #94a3b8;
		display: block;
		margin-bottom: 6px;
	}
	.fade-explain {
		margin: 0 0 8px;
		padding: 7px 9px;
		border-radius: 6px;
		border: 1px solid #4a3a1c;
		background: #11161d;
		font-size: 11px;
		line-height: 1.45;
		color: #94a3b8;
	}
	.fade-explain .mark {
		font-weight: 600;
		color: #fdba74;
	}
	.fade-row {
		display: grid;
		grid-template-columns: 1fr 1fr 1fr;
		gap: 4px;
		margin-bottom: 6px;
	}
	.fade-add {
		background: #1c1608;
		border: 1px dashed #f59e0b;
		border-radius: 5px;
		color: #fdba74;
		padding: 4px 10px;
		cursor: pointer;
		font-size: 12px;
	}
	.link {
		border: none;
		background: none;
		color: #94a3b8;
		text-decoration: underline;
		padding: 0;
		cursor: pointer;
		font-size: 12px;
	}
	/* "Edit response choreography" — matches the screen inspector's `.choreo` opener. */
	.choreo {
		width: 100%;
		margin: 2px 0 12px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #2563eb;
		background: #14181f;
		color: #bfdbfe;
		cursor: pointer;
		font-size: 12px;
	}
	.choreo:disabled {
		opacity: 0.5;
		cursor: default;
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
