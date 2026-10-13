<script lang="ts">
	/**
	 * Animate mode's STATE MACHINE panel for a component (Rive plan Phase 5b,
	 * `docs/design/rive-style-editor.md` §4–§5): a layers tab strip, the layer's graph (Entry / Any /
	 * Exit, states as cards named after their timeline, transitions as arrows) drawn with
	 * `@xyflow/svelte` as `/flow-v2` is, an inspector for the selected state or transition, and a
	 * stage preview whose input toggles drive the SAME interpreter the game runs
	 * (`ComponentStateMachineRunner`), its layers' poses pushed into the canvas through the Timeline
	 * panel's preview seam (`setTimelinePreview`, under this panel's own owner).
	 *
	 * The machine lives on the draft `ComponentDef` (`def.stateMachine`, `def.inputs`), so it saves
	 * with the component through the existing save path — nothing here writes. Edits go through
	 * `$lib/timeline/stateMachineEdit.ts` (pure, gated); every edit bumps `graphVersion`, which
	 * rebuilds the graph and the preview's runner.
	 */
	import {
		SvelteFlow,
		Background,
		Controls,
		MarkerType,
		type Connection,
		type Edge,
		type Node,
	} from '@xyflow/svelte';
	import '@xyflow/svelte/dist/style.css';
	import { onDestroy, untrack } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import {
		ComponentStateMachineRunner,
		SM_ANY_STATE,
		SM_EXIT_STATE,
		componentInputs,
		validateStateMachine,
		type CinematicDoc,
		type ComponentDef,
		type ComponentInput,
		type Scene,
		type SmCondition,
		type SmLayer,
		type SmState,
		type SmTransition,
	} from 'engine-layout';
	import { askConfirm, askText } from '$lib/dialogs.svelte';
	import { componentTimelinesOf } from '$lib/timeline/screenTimeline';
	import {
		ANY_NODE,
		ENTRY_EDGE,
		ENTRY_NODE,
		EXIT_NODE,
		addCondition,
		addLayer,
		addState,
		connect,
		layerGraph,
		newCondition,
		removeCondition,
		removeLayer,
		removeState,
		removeTransition,
		setNodePos,
		stateLabel,
	} from '$lib/timeline/stateMachineEdit';
	import { stateMachineDrives } from '$lib/timeline/stateMachinePreview';
	import SmGraphNode from './SmGraphNode.svelte';
	import { setTimelinePreview } from './valuePreview.client.svelte';

	interface Props {
		/** The open component's draft — edited in place. */
		def: ComponentDef | null;
		/** The component's nodes as a scene, for the stage preview. */
		scene: Scene | undefined;
		projectKey: string;
		/** The panel is shown (Animate, State Machine tab). Hidden, it previews nothing. */
		active: boolean;
		/** An edit happened — the page repaints and the draft reads as dirty. */
		onChanged: () => void;
		/** Open a timeline in the Timeline panel (a state card was double-clicked). */
		onOpenTimeline: (id: string) => void;
	}
	let { def, scene, projectKey, active, onChanged, onOpenTimeline }: Props = $props();

	const previewOwner = Symbol('state-machine-panel');
	const nodeTypes = { sm: SmGraphNode };

	interface Row {
		id: string;
		name: string;
		duration: number;
		host?: CinematicDoc['host'];
	}
	let rows = $state<Row[]>([]);
	let error = $state('');
	/** Bumped on every edit of the machine: rebuilds the graph and the preview runner. */
	let graphVersion = $state(0);
	let activeLayerId = $state<string | null>(null);
	let selected = $state<{ kind: 'state'; id: string } | { kind: 'transition'; id: string } | null>(
		null,
	);

	const timelines = $derived(componentTimelinesOf(rows, def?.id));
	const timelineNames = $derived(new Map(timelines.map((t) => [t.id, t.name || t.id])));
	const layers = $derived.by(() => {
		void graphVersion;
		return def?.stateMachine?.layers ?? [];
	});
	const layer = $derived(
		layers.find((l) => l.id === activeLayerId) ?? layers[0] ?? (undefined as SmLayer | undefined),
	);
	const inputs = $derived.by(() => {
		void graphVersion;
		return def ? componentInputs(def) : [];
	});
	const issues = $derived.by(() => {
		void graphVersion;
		return def
			? validateStateMachine(
					def,
					timelines.map((t) => t.id),
				)
			: [];
	});
	const selectedState = $derived.by(() => {
		const sel = selected;
		return sel?.kind === 'state' ? layer?.states.find((s) => s.id === sel.id) : undefined;
	});
	const selectedTransition = $derived.by(() => {
		const sel = selected;
		return sel?.kind === 'transition' ? layer?.transitions.find((t) => t.id === sel.id) : undefined;
	});

	async function refresh(): Promise<void> {
		const res = await fetch(`/api/cinematics/list?projectKey=${encodeURIComponent(projectKey)}`);
		if (!res.ok) {
			error = `Could not list timelines (${res.status}).`;
			return;
		}
		rows = ((await res.json()) as { cinematics: Row[] }).cinematics;
	}
	// The list follows the component: a timeline saved in the Timeline tab shows up here.
	$effect(() => {
		void def?.id;
		void active;
		if (active) void untrack(refresh);
	});

	function changed(): void {
		graphVersion += 1;
		onChanged();
	}

	// ---- layers ---------------------------------------------------------------------------------

	async function newLayer(): Promise<void> {
		if (!def) return;
		const name = await askText({
			title: 'New layer',
			label: 'Name',
			value: `Layer ${(def.stateMachine?.layers.length ?? 0) + 1}`,
		});
		if (name === null) return;
		const added = addLayer(def, name);
		activeLayerId = added.id;
		selected = null;
		changed();
	}
	async function renameLayer(): Promise<void> {
		if (!def || !layer) return;
		const name = await askText({ title: 'Rename layer', label: 'Name', value: layer.name ?? '' });
		if (name === null) return;
		layer.name = name.trim() || undefined;
		changed();
	}
	async function deleteLayer(): Promise<void> {
		if (!def || !layer) return;
		const ok = await askConfirm({
			title: 'Delete layer?',
			message: `"${layer.name ?? layer.id}" and its ${layer.states.length} state(s) will be removed.`,
			confirmLabel: 'Delete',
			danger: true,
		});
		if (!ok) return;
		removeLayer(def, layer.id);
		activeLayerId = def.stateMachine?.layers[0]?.id ?? null;
		selected = null;
		changed();
	}

	// ---- states + transitions -------------------------------------------------------------------

	function newState(timelineId: string): void {
		if (!def) return;
		const row = timelines.find((t) => t.id === timelineId);
		if (!row) return;
		const target = layer ?? addLayer(def, 'Main');
		activeLayerId = target.id;
		const state = addState(target, { id: row.id, name: row.name || row.id });
		selected = { kind: 'state', id: state.id };
		changed();
	}
	function deleteSelected(): void {
		if (!layer || !selected) return;
		if (selected.kind === 'state') removeState(layer, selected.id);
		else removeTransition(layer, selected.id);
		selected = null;
		changed();
	}
	function setEntry(stateId: string): void {
		if (!layer) return;
		layer.entry = stateId;
		changed();
	}
	function setStateField<K extends keyof SmState>(state: SmState, key: K, value: SmState[K]): void {
		if (value === undefined || value === '' || value === false) delete state[key];
		else state[key] = value;
		changed();
	}
	function setTransitionField<K extends keyof SmTransition>(
		t: SmTransition,
		key: K,
		value: SmTransition[K] | undefined,
	): void {
		if (value === undefined) delete t[key];
		else t[key] = value;
		changed();
	}
	function setCondition(t: SmTransition, index: number, patch: Partial<SmCondition>): void {
		const c = t.conditions?.[index];
		if (!c) return;
		if (patch.input !== undefined && patch.input !== c.input) {
			// A new input takes the first op of its kind and a default value.
			const input = inputs.find((i) => i.id === patch.input);
			if (!input) return;
			t.conditions![index] = newCondition(input);
			changed();
			return;
		}
		Object.assign(c, patch);
		if (c.op === 'fired') delete c.value;
		changed();
	}
	const opsFor = (input: ComponentInput | undefined): SmCondition['op'][] =>
		input?.kind === 'trigger'
			? ['fired']
			: input?.kind === 'bool'
				? ['==', '!=']
				: ['==', '!=', '<', '>'];

	// ---- preview state (read by the graph: the active state and the lit transition) --------------

	let runner: ComponentStateMachineRunner | null = null;
	let running = $state(false);
	/** Layer id → current state, from the preview runner. */
	let runnerStates = $state<Record<string, string>>({});
	/** Bool / number inputs as the preview holds them. */
	let previewValues = $state<Record<string, number | boolean>>({});
	/** The states' timelines for the preview, re-fetched each time the tab is shown so a timeline
	 *  saved in the Timeline tab previews as saved. (A `SvelteMap` only for the reactivity lint;
	 *  nothing reads it reactively.) */
	const docs = new SvelteMap<string, CinematicDoc>();
	let raf = 0;
	let last = 0;

	// ---- the graph --------------------------------------------------------------------------------

	// Raw: xyflow replaces the arrays itself, and proxying every node (its closures, `measured`)
	// buys nothing.
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	/** The transition the preview took most recently, lit for a moment. */
	let litTransition = $state<string | null>(null);
	let litTimer = 0;

	$effect(() => {
		void graphVersion;
		const current = layer;
		const sel = selected;
		const lit = litTransition;
		const states = runnerStates;
		const broken = new Set(issues.filter((i) => i.state).map((i) => `${i.layer}/${i.state}`));
		if (!current) {
			nodes = [];
			edges = [];
			return;
		}
		const graph = layerGraph(current, timelineNames);
		const activeState = states[current.id];
		nodes = graph.nodes.map((n) => ({
			id: n.id,
			type: 'sm',
			position: { ...n.pos },
			selected: sel?.kind === 'state' && sel.id === n.id,
			deletable: n.kind === 'state',
			data: {
				kind: n.kind,
				label: n.label,
				sub:
					n.state?.name && timelineNames.get(n.state.timeline) !== n.label
						? timelineNames.get(n.state.timeline)
						: undefined,
				loop: n.state?.loop,
				speed: n.state?.speed,
				isEntry: n.kind === 'state' && current.entry === n.id,
				active:
					n.kind === 'state'
						? activeState === n.id
						: n.kind === 'exit'
							? activeState === SM_EXIT_STATE
							: false,
				broken: n.kind === 'state' && broken.has(`${current.id}/${n.id}`),
				onopen: n.state ? () => onOpenTimeline(n.state!.timeline) : undefined,
			},
		}));
		edges = graph.edges.map((e) => ({
			id: e.id,
			source: e.from,
			target: e.to,
			label: e.label || undefined,
			selected: sel?.kind === 'transition' && sel.id === e.id,
			deletable: e.id !== ENTRY_EDGE,
			animated: lit === e.id,
			class: [e.id === ENTRY_EDGE ? 'sm-entry' : 'sm-t', lit === e.id ? 'lit' : '']
				.join(' ')
				.trim(),
			markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18 },
		}));
	});

	function isValidConnection(c: Edge | Connection): boolean {
		if (!c.source || !c.target) return false;
		if (c.source === EXIT_NODE || c.target === ANY_NODE || c.target === ENTRY_NODE) return false;
		if (c.source === ENTRY_NODE) return c.target !== EXIT_NODE;
		return true;
	}
	function onConnect(c: Connection): void {
		if (!layer || !c.source || !c.target) return;
		const t = connect(layer, c.source, c.target);
		if (t) selected = { kind: 'transition', id: t.id };
		changed();
	}
	function onGraphDelete(detail: { nodes: Node[]; edges: Edge[] }): void {
		if (!layer) return;
		let any = false;
		for (const n of detail.nodes) {
			if (n.id === ENTRY_NODE || n.id === ANY_NODE || n.id === EXIT_NODE) continue;
			removeState(layer, n.id);
			any = true;
		}
		for (const e of detail.edges) {
			if (e.id === ENTRY_EDGE) continue;
			removeTransition(layer, e.id);
			any = true;
		}
		if (!any) return;
		selected = null;
		changed();
	}
	function onNodeDragStop(detail: { targetNode: Node | null; nodes: Node[] }): void {
		if (!layer) return;
		for (const n of detail.nodes) setNodePos(layer, n.id, n.position);
		// A move is a doc edit: the position saves with the def.
		onChanged();
	}

	// ---- preview ----------------------------------------------------------------------------------

	function durations(): Map<string, number> {
		return new Map(timelines.map((t) => [t.id, Math.max(t.duration || 0, 0)]));
	}
	async function loadDocs(): Promise<void> {
		if (!def) return;
		const wanted = (def.stateMachine?.layers ?? []).flatMap((l) =>
			l.states.map((st) => st.timeline),
		);
		await Promise.all(
			wanted
				.filter((id, i) => id && !docs.has(id) && wanted.indexOf(id) === i)
				.map(async (id) => {
					const res = await fetch(
						`/api/cinematics/get?id=${encodeURIComponent(id)}&projectKey=${encodeURIComponent(projectKey)}`,
					);
					if (!res.ok) return;
					const body = (await res.json()) as { doc: CinematicDoc | null };
					if (body.doc) docs.set(id, body.doc);
				}),
		);
	}
	function buildRunner(): void {
		if (!def?.stateMachine?.layers.length) {
			runner = null;
			runnerStates = {};
			return;
		}
		runner = new ComponentStateMachineRunner(def.stateMachine, inputs, durations());
		for (const [id, value] of Object.entries(previewValues)) runner.setInput(id, value);
		apply();
	}
	function apply(): void {
		if (!runner) {
			runnerStates = {};
			setTimelinePreview(null, previewOwner);
			return;
		}
		const plays = runner.plays();
		const next: Record<string, string> = {};
		for (const p of plays) next[p.layer] = p.state;
		// Reassigned only on a change: the graph rebuilds off it, and a rebuild every frame would
		// fight xyflow (a card dragged while running would snap back).
		const changed =
			Object.keys(next).length !== Object.keys(runnerStates).length ||
			Object.entries(next).some(([k, v]) => runnerStates[k] !== v);
		if (changed) runnerStates = next;
		setTimelinePreview(active ? stateMachineDrives(plays, docs, scene) : null, previewOwner);
	}
	function tick(now: number): void {
		if (!running || !runner) return;
		const dt = Math.min((now - last) / 1000, 0.1);
		last = now;
		if (runner.needsTick()) {
			const step = runner.advance(dt);
			if (step.fired.length) light(step.fired[step.fired.length - 1].transition);
			apply();
		}
		raf = requestAnimationFrame(tick);
	}
	function light(transitionId: string): void {
		litTransition = transitionId;
		clearTimeout(litTimer);
		litTimer = window.setTimeout(() => (litTransition = null), 600);
	}
	async function run(): Promise<void> {
		await loadDocs();
		if (!runner) buildRunner();
		running = true;
		last = performance.now();
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(tick);
	}
	function stop(): void {
		running = false;
		cancelAnimationFrame(raf);
	}
	function reset(): void {
		runner?.reset();
		apply();
	}
	function fire(id: string): void {
		if (!runner) buildRunner();
		runner?.fire(id);
		if (!running) void run();
	}
	function setPreviewInput(id: string, value: number | boolean): void {
		previewValues[id] = value;
		if (!runner) buildRunner();
		runner?.setInput(id, value);
		if (!running) void run();
	}
	// An edit, or the timeline list arriving (the durations), rebuilds the runner from the new
	// machine — and the entry pose shows at once.
	$effect(() => {
		void graphVersion;
		void inputs;
		void timelines;
		untrack(() => {
			stop();
			void loadDocs().then(() => {
				buildRunner();
			});
		});
	});
	// Hidden: no preview, no clock. Shown again: the timelines as last saved, the entry pose until
	// Run.
	$effect(() => {
		const on = active;
		untrack(() => {
			if (!on) {
				stop();
				setTimelinePreview(null, previewOwner);
				return;
			}
			docs.clear();
			void loadDocs().then(apply);
		});
	});
	onDestroy(() => {
		stop();
		clearTimeout(litTimer);
		setTimelinePreview(null, previewOwner);
	});

	const hostLabel = $derived(def ? `◇ ${def.name}` : 'no component');
	const stateOptions = $derived(
		layer ? layer.states.map((s) => ({ id: s.id, label: stateLabel(s, timelineNames) })) : [],
	);
	const endpointLabel = (id: string): string =>
		id === SM_ANY_STATE
			? 'Any'
			: id === SM_EXIT_STATE
				? 'Exit'
				: (stateOptions.find((s) => s.id === id)?.label ?? id);
	/** A state's display name in `l`, or the pseudo-state's. */
	function endpointLabelFor(l: SmLayer, id: string): string {
		if (id === SM_EXIT_STATE) return 'Exit';
		const state = l.states.find((s) => s.id === id);
		return state ? stateLabel(state, timelineNames) : id;
	}
</script>

<section class="sm-panel" aria-label="State machine">
	<div class="sm-bar">
		<b class="sm-title">State machine</b>
		<span class="sm-host">{hostLabel}</span>
		<div class="sm-tabs" role="tablist" aria-label="Layers">
			{#each layers as l (l.id)}
				<button
					type="button"
					role="tab"
					class:on={layer?.id === l.id}
					aria-selected={layer?.id === l.id}
					onclick={() => {
						activeLayerId = l.id;
						selected = null;
					}}
				>
					{l.name ?? l.id}
					{#if runnerStates[l.id]}<span class="tab-state"
							>· {endpointLabelFor(l, runnerStates[l.id])}</span
						>{/if}
				</button>
			{/each}
			<button type="button" class="ghost" title="Add a layer" onclick={() => void newLayer()}
				>＋ Layer</button
			>
		</div>
		{#if layer}
			<button type="button" class="ghost" onclick={() => void renameLayer()}>Rename</button>
			<button
				type="button"
				class="ghost danger"
				title="Delete this layer"
				onclick={() => void deleteLayer()}>🗑</button
			>
		{/if}
		<span class="sep"></span>
		<label class="sm-add" title="Add a state that plays one of this component's timelines">
			＋ State
			<select
				value=""
				disabled={!def || !timelines.length}
				onchange={(e) => {
					newState(e.currentTarget.value);
					e.currentTarget.value = '';
				}}
			>
				<option value="" disabled
					>{timelines.length ? 'pick a timeline…' : 'no timelines yet'}</option
				>
				{#each timelines as t (t.id)}
					<option value={t.id}>{t.name || t.id}</option>
				{/each}
			</select>
		</label>
		{#if issues.length}
			<span class="issues" title={issues.map((i) => i.message).join('\n')}>
				⚠ {issues.filter((i) => i.level === 'error').length} / {issues.length}
			</span>
		{/if}
		<span class="grow"></span>
		{#if running}
			<button type="button" title="Stop the preview" onclick={stop}>⏹ Stop</button>
		{:else}
			<button
				type="button"
				title="Run the state machine on the stage"
				disabled={!layers.length}
				onclick={() => void run()}>▶ Run</button
			>
		{/if}
		<button
			type="button"
			title="Back to every layer's entry state"
			disabled={!layers.length}
			onclick={reset}>↺ Reset</button
		>
	</div>
	{#if error}<p class="sm-error">{error}</p>{/if}

	<div class="sm-body">
		<div class="sm-graph">
			{#if layer}
				{#key layer.id}
					<SvelteFlow
						bind:nodes
						bind:edges
						{nodeTypes}
						colorMode="dark"
						fitView
						minZoom={0.3}
						deleteKey={['Delete', 'Backspace']}
						{isValidConnection}
						onconnect={onConnect}
						ondelete={onGraphDelete}
						onnodedragstop={onNodeDragStop}
						onnodeclick={({ node }) => {
							selected =
								node.id === ENTRY_NODE || node.id === ANY_NODE || node.id === EXIT_NODE
									? null
									: { kind: 'state', id: node.id };
						}}
						onedgeclick={({ edge }) => {
							selected = edge.id === ENTRY_EDGE ? null : { kind: 'transition', id: edge.id };
						}}
						onpaneclick={() => (selected = null)}
					>
						<Background />
						<Controls showLock={false} />
					</SvelteFlow>
				{/key}
			{:else}
				<div class="sm-empty">
					<p>
						No state machine yet. Pick a timeline under <b>＋ State</b> to add the first state — it
						becomes the layer's entry. Drag from a state's right handle to another to add a
						transition; from <b>Entry</b> to pick the entry state; from <b>Any</b> for a transition
						that fires from every state; onto <b>Exit</b> to end the layer.
					</p>
				</div>
			{/if}
		</div>

		<aside class="sm-insp">
			{#if selectedTransition && layer}
				{@const t = selectedTransition}
				<h4>Transition</h4>
				<p class="dim">{endpointLabel(t.from)} → {endpointLabel(t.to)}</p>
				<h5>Conditions <span class="dim">(all must hold)</span></h5>
				{#each t.conditions ?? [] as c, i (i)}
					{@const input = inputs.find((x) => x.id === c.input)}
					<div class="cond">
						<select
							value={c.input}
							onchange={(e) => setCondition(t, i, { input: e.currentTarget.value })}
						>
							{#if !input}<option value={c.input}>{c.input} (unknown)</option>{/if}
							{#each inputs as x (x.id)}<option value={x.id}>{x.id}</option>{/each}
						</select>
						<select
							value={c.op}
							onchange={(e) =>
								setCondition(t, i, { op: e.currentTarget.value as SmCondition['op'] })}
						>
							{#each opsFor(input) as op (op)}<option value={op}
									>{op === 'fired' ? '▸ fired' : op}</option
								>{/each}
						</select>
						{#if input?.kind === 'bool'}
							<select
								value={c.value === false ? 'false' : 'true'}
								onchange={(e) => setCondition(t, i, { value: e.currentTarget.value === 'true' })}
							>
								<option value="true">true</option>
								<option value="false">false</option>
							</select>
						{:else if input?.kind === 'number'}
							<input
								type="number"
								step="any"
								value={typeof c.value === 'number' ? c.value : 0}
								onchange={(e) => setCondition(t, i, { value: Number(e.currentTarget.value) || 0 })}
							/>
						{/if}
						<button
							type="button"
							class="x"
							title="Remove condition"
							onclick={() => (removeCondition(t, i), changed())}>×</button
						>
					</div>
				{/each}
				{#if inputs.length}
					<select
						value=""
						onchange={(e) => {
							const input = inputs.find((x) => x.id === e.currentTarget.value);
							if (input) {
								addCondition(t, input);
								changed();
							}
							e.currentTarget.value = '';
						}}
					>
						<option value="" disabled>＋ condition on…</option>
						{#each inputs as x (x.id)}<option value={x.id}>{x.id} ({x.kind})</option>{/each}
					</select>
				{:else}
					<p class="dim">No inputs yet — add one under Component variables → Inputs.</p>
				{/if}
				<label class="row">
					<span
						title="How far through the leaving state's timeline the playhead must be (0–1). Empty: no wait."
						>Exit time</span
					>
					<input
						type="number"
						min="0"
						max="1"
						step="0.05"
						value={t.exitTime ?? ''}
						placeholder="none"
						onchange={(e) => {
							const v = e.currentTarget.value;
							setTransitionField(
								t,
								'exitTime',
								v === '' ? undefined : Math.min(Math.max(Number(v) || 0, 0), 1),
							);
						}}
					/>
				</label>
				<label class="row" class:hidden={t.to === SM_EXIT_STATE}>
					<span title="Milliseconds the new timeline is mixed in from the pose being left"
						>Blend (ms)</span
					>
					<input
						type="number"
						min="0"
						step="10"
						value={t.blend ?? ''}
						placeholder="0"
						onchange={(e) => {
							const v = Number(e.currentTarget.value);
							setTransitionField(t, 'blend', v > 0 ? v : undefined);
						}}
					/>
				</label>
				<button type="button" class="danger" onclick={deleteSelected}>Delete transition</button>
			{:else if selectedState && layer}
				{@const s = selectedState}
				<h4>State</h4>
				<label class="row">
					<span>Name</span>
					<input
						type="text"
						value={s.name ?? ''}
						placeholder={timelineNames.get(s.timeline) ?? s.timeline}
						onchange={(e) => setStateField(s, 'name', e.currentTarget.value.trim() || undefined)}
					/>
				</label>
				<label class="row">
					<span>Timeline</span>
					<select
						value={s.timeline}
						onchange={(e) => setStateField(s, 'timeline', e.currentTarget.value)}
					>
						{#if !timelineNames.has(s.timeline)}<option value={s.timeline}
								>{s.timeline} (missing)</option
							>{/if}
						{#each timelines as tl (tl.id)}<option value={tl.id}>{tl.name || tl.id}</option>{/each}
					</select>
				</label>
				<label class="row">
					<span>Speed</span>
					<input
						type="number"
						step="0.1"
						value={s.speed ?? 1}
						onchange={(e) => {
							const v = Number(e.currentTarget.value);
							setStateField(s, 'speed', Number.isFinite(v) && v !== 1 ? v : undefined);
						}}
					/>
				</label>
				<label class="row check">
					<input
						type="checkbox"
						checked={!!s.loop}
						onchange={(e) => setStateField(s, 'loop', e.currentTarget.checked || undefined)}
					/>
					<span>Loop</span>
				</label>
				<div class="btns">
					<button type="button" onclick={() => onOpenTimeline(s.timeline)}>Open timeline</button>
					<button type="button" disabled={layer.entry === s.id} onclick={() => setEntry(s.id)}
						>Set as entry</button
					>
					<button type="button" class="danger" onclick={deleteSelected}>Delete state</button>
				</div>
			{:else}
				<h4>Layer</h4>
				{#if layer}
					<p class="dim">
						{layer.states.length} state(s), {layer.transitions.length} transition(s). Entry:
						{layer.entry ? endpointLabel(layer.entry) : '— none —'}.
					</p>
				{:else}
					<p class="dim">Add a state to create the first layer.</p>
				{/if}
				{#if issues.length}
					<ul class="issue-list">
						{#each issues as i, n (n)}<li class={i.level}>{i.message}</li>{/each}
					</ul>
				{/if}
			{/if}

			<h4 class="preview-h">Preview inputs</h4>
			{#if !inputs.length}
				<p class="dim">No inputs declared.</p>
			{:else}
				<div class="inputs">
					{#each inputs as input (input.id)}
						{#if input.kind === 'trigger'}
							<button
								type="button"
								class="trig"
								title="Fire this trigger"
								onclick={() => fire(input.id)}>▸ {input.id}</button
							>
						{:else if input.kind === 'bool'}
							<label class="row check">
								<input
									type="checkbox"
									checked={(previewValues[input.id] ?? input.default) === true}
									onchange={(e) => setPreviewInput(input.id, e.currentTarget.checked)}
								/>
								<span>{input.id}</span>
							</label>
						{:else}
							<label class="row">
								<span>{input.id}</span>
								<input
									type="number"
									step="any"
									value={previewValues[input.id] ?? input.default ?? 0}
									oninput={(e) => setPreviewInput(input.id, Number(e.currentTarget.value) || 0)}
								/>
							</label>
						{/if}
					{/each}
				</div>
			{/if}
			{#if layers.length}
				<p class="dim states">
					{#each layers as l (l.id)}
						<span
							>{l.name ?? l.id}:
							<b>{runnerStates[l.id] ? endpointLabelFor(l, runnerStates[l.id]) : '—'}</b></span
						>
					{/each}
				</p>
			{/if}
		</aside>
	</div>
</section>

<style>
	.sm-panel {
		--panel: #23262d;
		--panel2: #2b2f38;
		--line: #363b45;
		--txt: #d7dbe2;
		--dim: #8b93a1;
		--accent: #5db0ff;
		--accent2: #7ee0c0;
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;
		background: var(--panel);
		color: var(--txt);
		border-top: 1px solid var(--line);
		font-size: 12px;
	}
	.sm-bar {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 10px;
		border-bottom: 1px solid var(--line);
		flex-wrap: wrap;
	}
	.sm-title {
		color: var(--accent2);
		letter-spacing: 0.08em;
	}
	.sm-host {
		color: var(--dim);
	}
	.sm-tabs {
		display: inline-flex;
		border: 1px solid var(--line);
		border-radius: 6px;
		overflow: hidden;
	}
	.sm-tabs button {
		border: none;
		border-radius: 0;
		background: transparent;
	}
	.sm-tabs button.on {
		background: var(--panel2);
		color: var(--accent);
	}
	.tab-state {
		color: var(--accent2);
	}
	.sm-bar select,
	.sm-bar input,
	.sm-bar button,
	.sm-insp select,
	.sm-insp input,
	.sm-insp button {
		background: var(--panel2);
		color: var(--txt);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 3px 6px;
		font: inherit;
	}
	.sm-bar button:disabled,
	.sm-insp button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.sm-bar .ghost {
		border-color: transparent;
	}
	.sm-bar .danger:hover,
	.sm-insp .danger:hover {
		border-color: #f08080;
		color: #f08080;
	}
	.sm-add {
		display: inline-flex;
		align-items: center;
		gap: 4px;
	}
	.sep {
		width: 1px;
		height: 18px;
		background: var(--line);
	}
	.grow {
		flex: 1;
	}
	.issues {
		color: #f0a050;
		cursor: help;
	}
	.sm-error {
		margin: 0;
		padding: 4px 10px;
		color: #f08080;
	}
	.sm-body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.sm-graph {
		flex: 1;
		min-width: 0;
		position: relative;
	}
	.sm-graph :global(.svelte-flow) {
		background: #1b1d22;
	}
	.sm-graph :global(.svelte-flow__edge-path) {
		stroke: #8b93a1;
		stroke-width: 1.5;
	}
	.sm-graph :global(.svelte-flow__edge.sm-entry .svelte-flow__edge-path) {
		stroke: var(--accent2);
	}
	.sm-graph :global(.svelte-flow__edge.selected .svelte-flow__edge-path) {
		stroke: var(--accent) !important;
		stroke-width: 2.5 !important;
	}
	.sm-graph :global(.svelte-flow__edge.lit .svelte-flow__edge-path) {
		stroke: var(--accent2) !important;
		stroke-width: 3 !important;
		filter: drop-shadow(0 0 3px #7ee0c0aa);
	}
	.sm-graph :global(.svelte-flow__edge-textbg) {
		fill: #2b2f38;
	}
	.sm-graph :global(.svelte-flow__edge-text) {
		fill: var(--txt);
		font-size: 10px;
	}
	.sm-empty {
		position: absolute;
		inset: 0;
		display: grid;
		place-items: center;
		padding: 20px;
		color: var(--dim);
		text-align: center;
	}
	.sm-empty p {
		max-width: 520px;
	}
	.sm-insp {
		width: 290px;
		flex: none;
		overflow: auto;
		border-left: 1px solid var(--line);
		padding: 8px 10px;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.sm-insp h4 {
		margin: 2px 0;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.sm-insp h5 {
		margin: 6px 0 0;
		font-size: 11px;
	}
	.preview-h {
		margin-top: 10px !important;
		padding-top: 8px;
		border-top: 1px solid var(--line);
	}
	.dim {
		color: var(--dim);
		margin: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.row > span {
		min-width: 70px;
		color: var(--dim);
	}
	.row.hidden {
		display: none;
	}
	.row input[type='number'],
	.row input[type='text'],
	.row select {
		flex: 1;
		min-width: 0;
	}
	.row.check > span {
		min-width: 0;
	}
	.cond {
		display: flex;
		gap: 4px;
		align-items: center;
	}
	.cond select,
	.cond input {
		min-width: 0;
		flex: 1;
	}
	.cond .x {
		flex: none;
		padding: 2px 6px;
	}
	.btns {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.inputs {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.trig {
		text-align: left;
		color: var(--accent2);
	}
	.states {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
	}
	.issue-list {
		margin: 4px 0 0;
		padding-left: 16px;
	}
	.issue-list .error {
		color: #f0a050;
	}
	.issue-list .warning {
		color: var(--dim);
	}
</style>
