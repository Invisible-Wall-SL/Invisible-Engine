<script lang="ts">
	/**
	 * A node's LISTENERS (Rive plan Phase 6b, §5): "On [down/up/enter/leave/click, and — game-families
	 * P10.4 — pointer move / drag start / drag / drag end / swipe] → [fire trigger | set input |
	 * toggle bool | raise event | align target]", one compact row each, the pickers fed by the open
	 * component's inputs, events and nodes. A swipe row has its direction and threshold; an align
	 * row its target, offset and axis. The rows live on the draft node (`node.on`) and save with the
	 * component; the game's runtime and the Animate preview run them (`ComponentEventDispatcher`).
	 * New rows get minted ids no id of the draft or of the last-saved component uses
	 * (`listenerEdit.ts`). Read-only while Inspecting a version.
	 */
	import {
		componentEvents,
		componentInputs,
		DEFAULT_SWIPE_THRESHOLD,
		NODE_LISTENER_EVENTS,
		SWIPE_DIRECTIONS,
		validateComponentEvents,
		type ComponentDef,
		type LayoutNode,
		type ListenerActionKind,
		type NodeListener,
		type NodeListenerEvent,
		type SwipeDirection,
	} from 'engine-layout';
	import {
		ACTION_CHOICES,
		addListener,
		alignTargetsFor,
		EVENT_LABELS,
		inputsFor,
		removeListener,
		setActionTarget,
		setAlignOptions,
		setListenerEvent,
		setListenerKind,
		setSwipeFilter,
	} from '$lib/timeline/listenerEdit';
	import EditorRaisePayload from './EditorRaisePayload.svelte';

	interface Props {
		node: LayoutNode;
		/** The open component's draft — the node is one of its nodes. */
		def: ComponentDef;
		/** Ids of the last-saved component: a new row never takes one. */
		reserved: Iterable<string>;
		readOnly?: boolean;
		onChanged: () => void;
	}
	let { node, def, reserved, readOnly = false, onChanged }: Props = $props();

	/** Bumped on every edit, so the rows re-read the draft. */
	let version = $state(0);
	const listeners = $derived.by(() => {
		void version;
		return node.on ?? [];
	});
	const inputs = $derived.by(() => {
		void version;
		return componentInputs(def);
	});
	const events = $derived.by(() => {
		void version;
		return componentEvents(def);
	});
	const issues = $derived.by(() => {
		void version;
		const mine = (node.on ?? []).map((l) => l.id);
		return validateComponentEvents(def).filter((i) => !!i.listener && mine.includes(i.listener));
	});
	const nothingToDo = $derived.by(() => {
		void version;
		return !inputs.length && !events.length && !alignTargetsFor(def).length;
	});

	function edit(fn: () => void): void {
		if (readOnly) return;
		fn();
		version += 1;
		onChanged();
	}
	const targets = (l: NodeListener): { id: string; label: string }[] =>
		l.action.kind === 'raise'
			? events.map((e) => ({ id: e.id, label: e.id }))
			: l.action.kind === 'align'
				? alignTargetsFor(def).map((n) => ({ id: n.id, label: `node ${n.label || n.id}` }))
				: inputsFor(def, l.action.kind).map((i) => ({ id: i.id, label: `${i.id} (${i.kind})` }));
	const target = (l: NodeListener): string =>
		l.action.kind === 'raise'
			? l.action.event
			: l.action.kind === 'align'
				? l.action.target
				: l.action.input;
</script>

<div class="listeners">
	<div class="head">
		<h4>Listeners</h4>
		<button
			type="button"
			class="ghost-sm"
			disabled={readOnly || nothingToDo}
			title={nothingToDo
				? 'Declare an input or an event first (Component variables), or add a node to align'
				: 'Add a listener: a pointer event on this node acts on the component'}
			onclick={() => edit(() => addListener(node, def, reserved))}>+ Listener</button
		>
	</div>
	{#if !listeners.length}
		<p class="muted small">
			{nothingToDo
				? 'Declare an input or an event under Component variables, then make this node react to the pointer.'
				: 'None — a pointer event on this node does nothing.'}
		</p>
	{:else}
		<ul class="rows">
			{#each listeners as l (l.id)}
				<li>
					<div class="line">
						<span class="on">On</span>
						<select
							disabled={readOnly}
							value={l.event}
							onchange={(e) =>
								edit(() => setListenerEvent(l, e.currentTarget.value as NodeListenerEvent))}
						>
							{#each NODE_LISTENER_EVENTS as ev (ev)}<option value={ev}>{EVENT_LABELS[ev]}</option
								>{/each}
						</select>
						<span class="arrow">→</span>
						<select
							disabled={readOnly}
							value={l.action.kind}
							onchange={(e) =>
								edit(() =>
									setListenerKind(def, l, e.currentTarget.value as ListenerActionKind, node.id),
								)}
						>
							{#each ACTION_CHOICES as c (c.kind)}<option value={c.kind}>{c.label}</option>{/each}
						</select>
						<button
							type="button"
							class="x"
							title="Remove listener"
							disabled={readOnly}
							onclick={() => edit(() => removeListener(node, l.id))}>×</button
						>
					</div>
					<div class="line sub">
						<select
							disabled={readOnly}
							value={target(l)}
							onchange={(e) => edit(() => setActionTarget(def, l.action, e.currentTarget.value))}
						>
							{#if !targets(l).some((t) => t.id === target(l))}
								<option value={target(l)}>{target(l) || '— pick —'} (unknown)</option>
							{/if}
							{#each targets(l) as t (t.id)}<option value={t.id}>{t.label}</option>{/each}
						</select>
						{#if l.action.kind === 'set'}
							{@const a = l.action}
							{#if typeof a.value === 'number'}
								<input
									type="number"
									step="any"
									disabled={readOnly}
									value={a.value}
									onchange={(e) => edit(() => (a.value = Number(e.currentTarget.value) || 0))}
								/>
							{:else}
								<select
									disabled={readOnly}
									value={String(a.value)}
									onchange={(e) => edit(() => (a.value = e.currentTarget.value === 'true'))}
								>
									<option value="true">true</option>
									<option value="false">false</option>
								</select>
							{/if}
						{/if}
					</div>
					{#if l.event === 'swipe'}
						<div class="line sub">
							<select
								disabled={readOnly}
								title="The way the swipe must go (its longer axis)"
								value={l.swipe?.direction ?? ''}
								onchange={(e) =>
									edit(() =>
										setSwipeFilter(l, {
											direction: (e.currentTarget.value || undefined) as SwipeDirection | undefined,
										}),
									)}
							>
								<option value="">any direction</option>
								{#each SWIPE_DIRECTIONS as d (d)}<option value={d}>{d}</option>{/each}
							</select>
							<input
								type="number"
								min="0"
								step="1"
								disabled={readOnly}
								title="How far (px, in the component) the press must travel to be a swipe"
								placeholder={String(DEFAULT_SWIPE_THRESHOLD)}
								value={l.swipe?.threshold ?? ''}
								onchange={(e) =>
									edit(() =>
										setSwipeFilter(l, {
											threshold:
												e.currentTarget.value === '' ? undefined : Number(e.currentTarget.value),
										}),
									)}
							/>
							<span class="unit">px</span>
						</div>
					{/if}
					{#if l.action.kind === 'align'}
						{@const a = l.action}
						<div class="line sub">
							<label
								class="check"
								title="Keep the distance the node had from the pointer when the press began"
							>
								<input
									type="checkbox"
									disabled={readOnly}
									checked={!!a.preserveOffset}
									onchange={(e) =>
										edit(() => setAlignOptions(a, { preserveOffset: e.currentTarget.checked }))}
								/>
								keep offset
							</label>
							<select
								disabled={readOnly}
								value={a.axis ?? ''}
								onchange={(e) =>
									edit(() =>
										setAlignOptions(a, {
											axis: (e.currentTarget.value || undefined) as 'x' | 'y' | undefined,
										}),
									)}
							>
								<option value="">x and y</option>
								<option value="x">x only</option>
								<option value="y">y only</option>
							</select>
						</div>
					{/if}
					{#if l.action.kind === 'raise'}
						{@const a = l.action}
						<EditorRaisePayload
							action={a}
							event={events.find((e) => e.id === a.event)}
							{inputs}
							{readOnly}
							pointer
							onChanged={() => edit(() => {})}
						/>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#if issues.length}
		<ul class="issues">
			{#each issues as i, n (n)}<li class={i.level}>⚠ {i.message}</li>{/each}
		</ul>
	{/if}
</div>

<style>
	.listeners {
		margin: 10px 0 6px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 4px;
	}
	h4 {
		margin: 0;
	}
	.ghost-sm {
		background: transparent;
		border: 1px solid #2a2a33;
		color: #ccc;
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 11px;
		cursor: pointer;
	}
	.ghost-sm:hover:not(:disabled) {
		border-color: #6b5bff;
	}
	.ghost-sm:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.small {
		font-size: 11px;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rows > li {
		border: 1px solid #2a2433;
		border-radius: 6px;
		padding: 5px 7px;
		background: #18141f;
	}
	.line {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
	}
	.line.sub {
		margin-top: 4px;
		padding-left: 14px;
	}
	.line select,
	.line input {
		min-width: 0;
		flex: 1;
		font-size: 11px;
	}
	.line input[type='number'] {
		width: 64px;
		flex: none;
	}
	.on,
	.arrow,
	.unit {
		color: #8a7aa8;
	}
	.check {
		display: flex;
		align-items: center;
		gap: 4px;
		flex: none;
		color: #b8b8c4;
	}
	.x {
		width: 18px;
		height: 18px;
		line-height: 1;
		padding: 0;
		border: 1px solid #444;
		border-radius: 4px;
		background: transparent;
		color: #b06a6a;
		cursor: pointer;
		flex: none;
	}
	.issues {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
		font-size: 11px;
	}
	.issues .error {
		color: #ff9a9a;
	}
	.issues .warning {
		color: #d98a3a;
	}
</style>
