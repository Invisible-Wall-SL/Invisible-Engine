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
	 *
	 * Phase 9c (`docs/design/rive-reference.md` §3.6): the INPUTS list docks beside the graph (each
	 * with its preview control; add / rename / remove go through the host's handlers, the same ones
	 * Properties uses); a timeline dragged from the Animations list drops in as a state; transitions
	 * gain Interpolation, *Pause source when exiting*, *Allow exit during transition* and *Disable*;
	 * states gain *On exit*; layers duplicate, reorder and disable; and the CONSOLE strip under the
	 * graph logs entered states, taken transitions and raised events beside a PROBLEMS list that
	 * gathers every ⚠ and jumps to its layer, state, transition or input.
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
		ComponentEventDispatcher,
		ComponentStateMachineRunner,
		type ComponentTimelinePlayer,
		SM_ANY_STATE,
		SM_EXIT_STATE,
		componentEvents,
		componentInputs,
		hasNodeListeners,
		validateComponentEvents,
		validateStateMachine,
		type RaisedComponentEvent,
		type CinematicDoc,
		type ComponentDef,
		type ComponentInput,
		type Scene,
		type SmCondition,
		type SmLayer,
		type SmPoint,
		type SmState,
		type SmTransition,
	} from 'engine-layout';
	import { askConfirm, askText } from '$lib/dialogs.svelte';
	import { openFlowStageChannel } from '$lib/flowStageBridge';
	import { componentTimelinesOf } from '$lib/timeline/screenTimeline';
	import {
		ANY_NODE,
		ENTRY_EDGE,
		ENTRY_NODE,
		EXIT_NODE,
		addBlendPoint,
		addCondition,
		addLayer,
		addState,
		blendInputRanges,
		blendSummary,
		clearBlendState,
		connect,
		duplicateLayer,
		layerGraph,
		makeBlendState,
		moveLayer,
		newCondition,
		problemTarget,
		removeBlendPoint,
		removeCondition,
		removeLayer,
		removeState,
		removeTransition,
		setBlend,
		setBlendEase,
		setBlendFlag,
		setBlendPoint,
		setLayerDisabled,
		setNodePos,
		setTransitionDisabled,
		stateLabel,
		stateMachineIds,
	} from '$lib/timeline/stateMachineEdit';
	import {
		placeLayers,
		playerDrives,
		previewPlayer,
		startLayers,
	} from '$lib/timeline/stateMachinePreview';
	import {
		addEnterAction,
		addExitAction,
		removeEnterAction,
		removeExitAction,
		rowIds,
	} from '$lib/timeline/listenerEdit';
	import { StagePointer, listeningChain } from '$lib/timeline/listenerPreview';
	import EaseCurveEditor from './EaseCurveEditor.svelte';
	import EditorRaisePayload from './EditorRaisePayload.svelte';
	import SmFlowProjection from './SmFlowProjection.svelte';
	import SmGraphNode from './SmGraphNode.svelte';
	import { TIMELINE_DRAG_TYPE } from './animationsList.client.svelte';
	import { setTimelinePreview } from './valuePreview.client.svelte';

	interface Props {
		/** The open component's draft — edited in place. */
		def: ComponentDef | null;
		/** The component as last loaded or saved: a new item never reuses an id it had. */
		savedDef?: ComponentDef | null;
		/** The component's nodes as a scene, for the stage preview. */
		scene: Scene | undefined;
		projectKey: string;
		/** The panel is shown (Animate, State Machine tab). Hidden, it previews nothing. */
		active: boolean;
		/** An edit happened — the page repaints and the draft reads as dirty. */
		onChanged: () => void;
		/** Open a timeline in the Timeline panel (a state card was double-clicked). */
		onOpenTimeline: (id: string) => void;
		/** Bumped by every edit of the draft elsewhere (Properties: listeners, events): the preview's
		 *  event dispatcher is rebuilt from the def as it now is. */
		editVersion?: number;
		/** The component's resolved preview params — where a blend rests a placed effect's
		 *  parameter that it takes from the component. */
		componentParams?: Record<string, unknown>;
		/** The docked Inputs list's edits: the host's own (Properties uses the same ones). Absent ⇒
		 *  the list only previews (a historical snapshot). */
		onAddInput?: (id: string, kind: ComponentInput['kind']) => void;
		onRenameInput?: (id: string) => void;
		onRemoveInput?: (id: string) => void;
	}
	let {
		def,
		savedDef = null,
		scene,
		projectKey,
		active,
		onChanged,
		onOpenTimeline,
		editVersion = 0,
		componentParams = {},
		onAddInput,
		onRenameInput,
		onRemoveInput,
	}: Props = $props();

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
		error = '';
	}
	/** Ids the saved component used: never handed to a new layer, state or transition. */
	const reserved = $derived(stateMachineIds(savedDef));
	/** Ids of the saved component's listeners and on-enter rows: never handed to a new row. */
	const reservedRows = $derived(rowIds(savedDef));
	const events = $derived.by(() => {
		void graphVersion;
		void editVersion;
		return def ? componentEvents(def) : [];
	});
	const eventIssues = $derived.by(() => {
		void graphVersion;
		void editVersion;
		// A cue is checked only on a def that declares events: on one that declares none, an
		// `event:` cue keeps its old meaning (a broadcast) and is no error.
		return def ? validateComponentEvents(def, events.length ? [...docs.values()] : []) : [];
	});
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
		const added = addLayer(def, name, reserved);
		activeLayerId = added.id;
		selected = null;
		changed();
	}
	async function renameLayer(): Promise<void> {
		if (!def || !layer) return;
		const name = await askText({ title: 'Rename layer', label: 'Name', value: layer.name ?? '' });
		if (name === null) return;
		if (name.trim()) layer.name = name.trim();
		else delete layer.name;
		changed();
	}
	function duplicateActiveLayer(): void {
		if (!def || !layer) return;
		const copy = duplicateLayer(def, layer.id, reserved, reservedRows);
		if (!copy) return;
		activeLayerId = copy.id;
		selected = null;
		changed();
	}
	function moveActiveLayer(delta: -1 | 1): void {
		if (def && layer && moveLayer(def, layer.id, delta)) changed();
	}
	function toggleLayerDisabled(): void {
		if (!layer) return;
		setLayerDisabled(layer, !layer.disabled);
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

	function newState(timelineId: string, pos?: SmPoint): void {
		if (!def) return;
		const row = timelines.find((t) => t.id === timelineId);
		if (!row) return;
		const target = layer ?? addLayer(def, 'Main', reserved);
		activeLayerId = target.id;
		const state = addState(
			target,
			{ id: row.id, name: row.name || row.id },
			{ reserved, ...(pos ? { pos: { x: Math.round(pos.x), y: Math.round(pos.y) } } : {}) },
		);
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
		if (!c.param) delete c.param;
		changed();
	}
	const opsFor = (input: ComponentInput | undefined): SmCondition['op'][] =>
		input?.kind === 'trigger'
			? ['fired']
			: input?.kind === 'bool'
				? ['==', '!=']
				: ['==', '!=', '<', '>', '<=', '>='];
	/** The number params a number condition can compare against — a per-placement threshold. */
	const numberParams = $derived((def?.params ?? []).filter((p) => p.kind === 'number'));
	/** The inputs a blend state can blend by. */
	const numberInputs = $derived(inputs.filter((i) => i.kind === 'number'));
	/** Each input a blend state reads → its points' range: the preview's slider. */
	const blendRanges = $derived.by(() => {
		void graphVersion;
		return def ? blendInputRanges(def) : new Map<string, { min: number; max: number }>();
	});
	/** A timeline for a new blend point: one the blend does not play yet, else the last point's. */
	function nextBlendTimeline(state: SmState): string {
		const used = new Set([state.timeline, ...(state.blend?.points ?? []).map((p) => p.timeline)]);
		const points = state.blend?.points ?? [];
		return (
			timelines.find((t) => !used.has(t.id))?.id ??
			points[points.length - 1]?.timeline ??
			state.timeline
		);
	}

	// ---- preview state (read by the graph: the active state and the lit transition) --------------

	let runner: ComponentStateMachineRunner | null = null;
	/** The game's per-instance player, on the component's nodes — the stage shows its samples. */
	let player: ComponentTimelinePlayer | null = null;
	/** The author pressed ▶ Run (⏹ Stop clears it) — what the bar shows. */
	let running = $state(false);
	/** The rAF loop is armed. It sleeps while nothing needs a tick and the next input re-arms it,
	 *  without touching `running`. */
	let scheduled = false;
	/** `enter` fired for this run — once, when it starts, as the game does on first appearance. */
	let entered = false;
	/** Bumped by every `run`/`stop`: a run that resumes after its fetch checks it is still wanted. */
	let runToken = 0;
	let destroyed = false;
	/** Layer id → current state, from the preview runner. */
	let runnerStates = $state<Record<string, string>>({});
	/** Bool / number inputs as the preview holds them. */
	let previewValues = $state<Record<string, number | boolean>>({});
	/** The component's timelines — the states' for the preview, all for the `event:` cue checks —
	 *  re-fetched each time the tab is shown so a timeline saved in the Timeline tab previews as
	 *  saved. A `SvelteMap`: `eventIssues` reads it, so the cue ⚠ appear once the fetch lands. */
	const docs = new SvelteMap<string, CinematicDoc>();
	let raf = 0;
	let last = 0;

	/** The game's event dispatcher for the previewed instance (Phase 6): the stage's pointer reaches
	 *  the listeners through it, and what it raises lands in the Events log. */
	let dispatcher: ComponentEventDispatcher | null = null;
	/** One line of the Console: a state entered, a transition taken or an event raised. */
	interface LogRow {
		n: number;
		t: number;
		kind: 'state' | 'transition' | 'event';
		/** The layer's name (state / transition rows). */
		layer?: string;
		text: string;
		/** An event's origin (listener / state / cue). */
		origin?: RaisedComponentEvent['origin'];
		payload?: string;
	}
	let consoleLog = $state<LogRow[]>([]);
	let logN = 0;
	let logStart = 0;
	const LOG_MAX = 80;
	function log(row: Omit<LogRow, 'n' | 't'>): void {
		const full: LogRow = { ...row, n: ++logN, t: (performance.now() - logStart) / 1000 };
		consoleLog = [full, ...consoleLog].slice(0, LOG_MAX);
	}
	function logRaise(raised: RaisedComponentEvent): void {
		const payload = Object.entries(raised.payload)
			.map(([k, v]) => `${k}=${typeof v === 'string' ? JSON.stringify(v) : String(v)}`)
			.join(' ');
		log({ kind: 'event', text: raised.event, origin: raised.origin, payload });
	}
	const layerName = (id: string): string => {
		const l = layers.find((x) => x.id === id);
		return l ? l.name || l.id : id;
	};
	/** The run started (or was reset while running): each running layer entered its entry state. */
	function logEntries(): void {
		if (!runner) return;
		for (const play of runner.plays()) {
			const l = layers.find((x) => x.id === play.layer);
			if (!l || l.disabled) continue;
			log({ kind: 'state', layer: layerName(play.layer), text: endpointLabelFor(l, play.state) });
		}
	}
	/** One advance's transitions: each taken, then the state it entered. */
	function logFired(
		fired: readonly { layer: string; transition: string; from: string; to: string }[],
	): void {
		for (const f of fired) {
			const l = layers.find((x) => x.id === f.layer);
			const from = l ? endpointLabelFor(l, f.from) : f.from;
			const to = l ? endpointLabelFor(l, f.to) : f.to;
			log({ kind: 'transition', layer: layerName(f.layer), text: `${from} → ${to}` });
			log({ kind: 'state', layer: layerName(f.layer), text: to });
		}
	}
	/** The previewed instance's dispatcher, on the def as it is now. */
	function buildDispatcher(): void {
		dispatcher?.destroy();
		dispatcher =
			def && (hasNodeListeners(def) || def.events?.length)
				? new ComponentEventDispatcher(def, {
						instanceId: 'preview',
						fireTrigger: (id) => fire(id),
						input: (id) => runner?.input(id) ?? previewValues[id],
						setInput: (id, value) => setPreviewInput(id, value),
						raise: logRaise,
						schedule: (drain) => queueMicrotask(drain),
					})
				: null;
	}
	/** The stage's pointer, routed as the game's wrappers route it. */
	let pointer = new StagePointer((node, event) => dispatcher?.pointer(node, event));
	/**
	 * The canvas's pointer over the component's own drawing (`nodeId`: the node under it, or null):
	 * while this panel is shown, the listening nodes under it hear `enter` / `leave` / `down` / `up`
	 * / `click`, deepest first, through the game's dispatcher. Hidden, it hears nothing.
	 */
	export function stagePointer(
		kind: 'move' | 'down' | 'up' | 'leave',
		nodeId: string | null,
	): void {
		if (!active || !def) return;
		if (!dispatcher) buildDispatcher();
		if (!dispatcher) return;
		if (kind === 'leave') {
			pointer.leave();
			return;
		}
		const chain = listeningChain(def.root, nodeId);
		if (kind === 'move') pointer.move(chain);
		else if (kind === 'down') pointer.down(chain);
		else pointer.up(chain);
	}
	function clearLog(): void {
		consoleLog = [];
		logStart = performance.now();
	}

	// ---- the console's Problems ------------------------------------------------------------------

	let consoleTab = $state<'console' | 'problems'>('console');
	/** The input a Problems row jumped to, lit in the Inputs list. */
	let focusedInput = $state<string | null>(null);
	interface Problem {
		level: 'error' | 'warning';
		message: string;
		layer?: string;
		state?: string;
		transition?: string;
		input?: string;
		node?: string;
	}
	/** Every ⚠ of the machine and of the component's events, listeners and cues. */
	const problems = $derived<Problem[]>([...issues, ...eventIssues]);
	const problemErrors = $derived(problems.filter((p) => p.level === 'error').length);
	function jumpTo(problem: Problem): void {
		if (!def) return;
		const target = problemTarget(def, problem);
		if (target.layer) {
			activeLayerId = target.layer;
			selected = target.transition
				? { kind: 'transition', id: target.transition }
				: target.state
					? { kind: 'state', id: target.state }
					: null;
		}
		focusedInput = target.input ?? null;
	}

	// ---- a timeline dropped from the Animations list ----------------------------------------------

	/** The graph's page-pixel → graph mapping, handed over from inside `<SvelteFlow>`. */
	let toFlow: ((point: { x: number; y: number }) => SmPoint) | null = null;
	const draggingTimeline = (e: DragEvent): boolean =>
		!!e.dataTransfer?.types.includes(TIMELINE_DRAG_TYPE);
	function onGraphDragOver(e: DragEvent): void {
		if (!def || !draggingTimeline(e)) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
	}
	function onGraphDrop(e: DragEvent): void {
		const id = e.dataTransfer?.getData(TIMELINE_DRAG_TYPE);
		if (!def || !id) return;
		e.preventDefault();
		if (!timelines.some((t) => t.id === id)) {
			error = 'That timeline is not one of this component’s.';
			return;
		}
		newState(id, layer && toFlow ? toFlow({ x: e.clientX, y: e.clientY }) : undefined);
	}

	// ---- the docked Inputs list -------------------------------------------------------------------

	let newInputId = $state('');
	/** Bool or number: a trigger is a declared signal, added with Properties' **+ Add trigger**. */
	let newInputKind = $state<'bool' | 'number'>('bool');
	function addDockInput(): void {
		const id = newInputId.trim();
		if (!id || !onAddInput) return;
		onAddInput(id, newInputKind);
		newInputId = '';
	}

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
		const broken = new Set(
			issues.filter((i) => i.state && i.level === 'error').map((i) => `${i.layer}/${i.state}`),
		);
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
				blend: n.state ? blendSummary(n.state, timelineNames) : undefined,
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
			class: [
				e.id === ENTRY_EDGE ? 'sm-entry' : 'sm-t',
				lit === e.id ? 'lit' : '',
				e.transition?.disabled ? 'off' : '',
			]
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
		const t = connect(layer, c.source, c.target, reserved);
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
		// Every timeline of the component — the states' play; all are checked for `event:` cues.
		const wanted = [
			...(def.stateMachine?.layers ?? []).flatMap((l) =>
				l.states.flatMap((st) => [st.timeline, ...(st.blend?.points ?? []).map((p) => p.timeline)]),
			),
			...timelines.map((t) => t.id),
		];
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
		if (!def?.stateMachine?.layers.length || !scene) {
			runner = null;
			player = null;
			runnerStates = {};
			setTimelinePreview(null, previewOwner);
			return;
		}
		const params = def.params ?? [];
		runner = new ComponentStateMachineRunner(
			def.stateMachine,
			inputs,
			durations(),
			(key) => params.find((p) => p.key === key)?.default,
		);
		player = previewPlayer(docs.values(), scene.nodes, () => componentParams);
		entered = false;
		for (const [id, value] of Object.entries(previewValues)) runner.setInput(id, value);
		apply();
	}
	/** Place the layers on the player and show it — the instance's `applyStateMachine`; `start`:
	 *  the run's first frame (`startLayers`, the game's `startStateMachine`). */
	function apply(start = false): void {
		if (!runner || !player) {
			runnerStates = {};
			setTimelinePreview(null, previewOwner);
			return;
		}
		(start ? startLayers : placeLayers)(
			runner,
			player,
			running && dispatcher ? { dispatcher, declaresEvents: events.length > 0 } : undefined,
		);
		const next: Record<string, string> = {};
		for (const p of runner.plays()) next[p.layer] = p.state;
		// Reassigned only on a change: the graph rebuilds off it, and a rebuild every frame would
		// fight xyflow (a card dragged while running would snap back).
		const changed =
			Object.keys(next).length !== Object.keys(runnerStates).length ||
			Object.entries(next).some(([k, v]) => runnerStates[k] !== v);
		if (changed) runnerStates = next;
		setTimelinePreview(active ? playerDrives(player) : null, previewOwner);
	}
	function tick(now: number): void {
		if (!running || !runner) {
			scheduled = false;
			return;
		}
		const dt = Math.min((now - last) / 1000, 0.1);
		last = now;
		if (!runner.needsTick()) {
			// At rest: the loop sleeps; the next input or trigger arms it again.
			scheduled = false;
			return;
		}
		const step = runner.advance(dt);
		if (step.fired.length) light(step.fired[step.fired.length - 1].transition);
		logFired(step.fired);
		apply();
		dispatcher?.transitions(step.fired);
		raf = requestAnimationFrame(tick);
	}
	function arm(): void {
		if (scheduled || !running) return;
		scheduled = true;
		last = performance.now();
		cancelAnimationFrame(raf);
		raf = requestAnimationFrame(tick);
	}
	function light(transitionId: string): void {
		litTransition = transitionId;
		clearTimeout(litTimer);
		litTimer = window.setTimeout(() => (litTransition = null), 600);
	}
	/** ▶ Run: the machine's first visible frame, as in game — `enter` fires once, when the run
	 *  starts; an input while running only arms the sleeping loop. */
	async function run(): Promise<void> {
		const token = ++runToken;
		await loadDocs();
		if (destroyed || !active || token !== runToken) return;
		if (!runner) buildRunner();
		if (!runner) return;
		running = true;
		if (!entered) {
			entered = true;
			logStart = performance.now();
			// The entry pose was placed while stopped, its cues at 0 routed nowhere: a fresh player
			// crosses 0 again, now with the dispatcher, then the machine starts — as in game.
			if (scene) player = previewPlayer(docs.values(), scene.nodes, () => componentParams);
			logEntries();
			apply(true);
			runner.fire('enter');
		}
		arm();
	}
	function stop(): void {
		runToken += 1;
		running = false;
		scheduled = false;
		cancelAnimationFrame(raf);
	}
	/** ↺ Reset: back to the entry states — a fresh start, so the next run fires `enter` again. */
	function reset(): void {
		runner?.reset();
		entered = false;
		clearLog();
		if (running && runner) {
			entered = true;
			logEntries();
			apply(true);
			runner.fire('enter');
			arm();
		} else apply();
	}
	function fire(id: string): void {
		if (!runner) buildRunner();
		if (!runner) return;
		runner.fire(id);
		if (running) arm();
		else void run();
	}
	function setPreviewInput(id: string, value: number | boolean): void {
		previewValues[id] = value;
		if (!runner) buildRunner();
		if (!runner) return;
		runner.setInput(id, value);
		if (running) arm();
		else void run();
	}
	// Another component (or another version of it) opened: nothing of the old one's panel state
	// carries over — selection, layer tab, preview inputs, the lit arrow, the fetched timelines.
	$effect.pre(() => {
		void def;
		untrack(() => {
			stop();
			selected = null;
			activeLayerId = null;
			previewValues = {};
			litTransition = null;
			focusedInput = null;
			clearTimeout(litTimer);
			docs.clear();
			clearLog();
			pointer = new StagePointer((node, event) => dispatcher?.pointer(node, event));
		});
	});
	// Another component opened, or a listener, an event or an input edited: the dispatcher reads
	// the def as it now is.
	$effect(() => {
		void def;
		void editVersion;
		void graphVersion;
		untrack(buildDispatcher);
	});
	// An edit, or the timeline list arriving (the durations), rebuilds the runner from the new
	// machine — and the entry pose shows at once.
	$effect(() => {
		void graphVersion;
		void inputs;
		void timelines;
		untrack(() => {
			const wasRunning = running;
			stop();
			void loadDocs().then(() => {
				buildRunner();
				if (wasRunning && !destroyed && active) void run();
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
				// Hidden, the stage's pointer reaches nothing: forget what it was over, without
				// raising a `leave` from a panel nobody sees.
				pointer = new StagePointer((node, event) => dispatcher?.pointer(node, event));
				// Hidden, the graph must hold no selection: xyflow's Delete handler listens on the
				// window and would delete a selected card from another tab or mode.
				selected = null;
				setTimelinePreview(null, previewOwner);
				return;
			}
			docs.clear();
			void loadDocs().then(() => buildRunner());
		});
	});
	onDestroy(() => {
		destroyed = true;
		dispatcher?.destroy();
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

	// Flow Preview → this stage (Rive plan §6.2 step 5): a `/flow-v2` preview run on this project
	// posts each trigger it fires and input it sets on the project's bridge; while this panel is
	// on that component, each goes through the same `fire` / `setPreviewInput` its own Preview
	// inputs use — one runner, one dispatcher. A message for another component is ignored.
	$effect(() => {
		const id = def?.id;
		if (!id || !active) return;
		const channel = openFlowStageChannel(projectKey);
		if (!channel) return;
		const unsubscribe = channel.subscribe((m) => {
			if (m.componentId !== id) return;
			if (m.op === 'fire') fire(m.name);
			else if (typeof m.value === 'number' || typeof m.value === 'boolean')
				setPreviewInput(m.name, m.value);
		});
		return () => {
			unsubscribe();
			channel.close();
		};
	});
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
					class:off={l.disabled}
					aria-selected={layer?.id === l.id}
					title={l.disabled ? 'Disabled: this layer does not run' : undefined}
					onclick={() => {
						activeLayerId = l.id;
						selected = null;
					}}
				>
					{l.name ?? l.id}
					{#if l.disabled}<span class="tab-state">· off</span>{:else if runnerStates[l.id]}<span
							class="tab-state">· {endpointLabelFor(l, runnerStates[l.id])}</span
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
				class="ghost"
				title="Duplicate this layer (its states, transitions and positions)"
				onclick={duplicateActiveLayer}>⧉</button
			>
			<button
				type="button"
				class="ghost"
				title="Move this layer earlier (layers run in order; a later layer wins a property both key)"
				disabled={layers[0]?.id === layer.id}
				onclick={() => moveActiveLayer(-1)}>◀</button
			>
			<button
				type="button"
				class="ghost"
				title="Move this layer later (a later layer wins a property both key)"
				disabled={layers.at(-1)?.id === layer.id}
				onclick={() => moveActiveLayer(1)}>▶</button
			>
			<button
				type="button"
				class="ghost"
				class:on={layer.disabled}
				title={layer.disabled
					? 'Enable this layer: it runs again'
					: 'Disable this layer: it does not run (in game too) until enabled'}
				onclick={toggleLayerDisabled}>{layer.disabled ? '⏻ Enable' : '⏻ Disable'}</button
			>
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
		{#if problems.length}
			<button
				type="button"
				class="ghost issues"
				title={`${problems.map((i) => i.message).join('\n')}\n\nClick: the Problems list`}
				onclick={() => (consoleTab = 'problems')}
			>
				⚠ {problemErrors} / {problems.length}
			</button>
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
		<aside class="sm-inputs" aria-label="Inputs">
			<h4>Inputs</h4>
			{#each inputs as input (input.id)}
				<div class="in-row" class:focus={focusedInput === input.id}>
					<span class="kind" title={input.kind}
						>{input.kind === 'trigger'
							? '▸'
							: input.kind === 'bool'
								? '◐'
								: input.kind === 'number'
									? '#'
									: 'T'}</span
					>
					{#if input.kind === 'trigger'}
						<button
							type="button"
							class="trig"
							title="Fire this trigger on the preview"
							onclick={() => fire(input.id)}>{input.id}</button
						>
					{:else if input.kind === 'bool'}
						<label class="val">
							<input
								type="checkbox"
								checked={(previewValues[input.id] ?? input.default) === true}
								onchange={(e) => setPreviewInput(input.id, e.currentTarget.checked)}
							/>
							<span>{input.id}</span>
						</label>
					{:else if input.kind === 'number'}
						<label class="val">
							<span>{input.id}</span>
							<input
								type="number"
								step="any"
								value={previewValues[input.id] ?? input.default ?? 0}
								oninput={(e) => setPreviewInput(input.id, Number(e.currentTarget.value) || 0)}
							/>
						</label>
						{#if (blendRanges.get(input.id)?.max ?? 0) > (blendRanges.get(input.id)?.min ?? 0)}
							{@const range = blendRanges.get(input.id)!}
							<input
								class="blend-range"
								type="range"
								min={range.min}
								max={range.max}
								step={(range.max - range.min) / 100}
								value={previewValues[input.id] ?? input.default ?? 0}
								title="Drag to blend the states that blend by {input.id}"
								aria-label="{input.id} (blend)"
								oninput={(e) => setPreviewInput(input.id, Number(e.currentTarget.value) || 0)}
							/>
						{/if}
					{:else}
						<span
							class="val dim"
							title="A text input carries a localization key; the machine never reads it"
							>{input.id}</span
						>
					{/if}
					{#if onRenameInput}<button
							type="button"
							class="x"
							title="Rename (everything that reads it follows)"
							onclick={() => onRenameInput(input.id)}>✎</button
						>{/if}
					{#if onRemoveInput}<button
							type="button"
							class="x"
							title="Remove"
							onclick={() => onRemoveInput(input.id)}>×</button
						>{/if}
				</div>
			{:else}
				<p class="dim">No inputs yet.</p>
			{/each}
			{#if onAddInput}
				<form
					class="in-add"
					onsubmit={(e) => {
						e.preventDefault();
						addDockInput();
					}}
				>
					<input
						type="text"
						placeholder="new input"
						bind:value={newInputId}
						aria-label="Input name"
					/>
					<select bind:value={newInputKind} aria-label="Input kind">
						<option value="bool">bool</option>
						<option value="number">number</option>
					</select>
					<button type="submit" disabled={!newInputId.trim()} title="Add the input">＋</button>
				</form>
			{/if}
		</aside>
		<div
			class="sm-graph"
			role="region"
			aria-label="State graph"
			ondragover={onGraphDragOver}
			ondrop={onGraphDrop}
		>
			{#if layer}
				{#key `${def?.id ?? ''}:${layer.id}`}
					<SvelteFlow
						bind:nodes
						bind:edges
						{nodeTypes}
						colorMode="dark"
						fitView
						minZoom={0.3}
						deleteKey={active ? ['Delete', 'Backspace'] : []}
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
						<SmFlowProjection onReady={(f) => (toFlow = f)} />
					</SvelteFlow>
				{/key}
			{:else}
				<div class="sm-empty">
					<p>
						No state machine yet. Pick a timeline under <b>＋ State</b>, or drag one here from the
						Animations list, to add the first state — it becomes the layer's entry. Drag from a
						state's right handle to another to add a transition; from <b>Entry</b> to pick the entry
						state; from <b>Any</b> for a transition that fires from every state; onto <b>Exit</b> to end
						the layer.
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
							<select
								title="Compare with a fixed value, or with each placed instance's own number param (Component variables → + Add variable → Custom input, kind number)"
								value={c.param ?? ''}
								onchange={(e) => setCondition(t, i, { param: e.currentTarget.value || undefined })}
							>
								<option value="">value</option>
								{#if c.param && !numberParams.some((p) => p.key === c.param)}
									<option value={c.param}>{`{${c.param}}`} (unknown)</option>
								{/if}
								{#each numberParams as p (p.key)}<option value={p.key}>{`{${p.key}}`}</option
									>{/each}
								{#if !numberParams.length}
									<option value="" disabled
										>{'{param}'} — add a number param under Component variables first</option
									>
								{/if}
							</select>
							{#if !c.param}
								<input
									type="number"
									step="any"
									value={typeof c.value === 'number' ? c.value : 0}
									onchange={(e) =>
										setCondition(t, i, { value: Number(e.currentTarget.value) || 0 })}
								/>
							{/if}
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
							setBlend(t, Number(e.currentTarget.value));
							changed();
						}}
					/>
				</label>
				{#if t.blend && t.to !== SM_EXIT_STATE}
					<h5>Interpolation <span class="dim">(of the blend)</span></h5>
					<EaseCurveEditor
						value={t.ease}
						onChange={(v, live) => {
							if (live) return;
							setBlendEase(t, v);
							changed();
						}}
					/>
					<label class="row check">
						<input
							type="checkbox"
							checked={t.pauseSource !== false}
							onchange={(e) => {
								setBlendFlag(t, 'pauseSource', e.currentTarget.checked);
								changed();
							}}
						/>
						<span
							title="On: the state being left freezes where it was (as before). Off: it keeps playing under the blend."
							>Pause source when exiting</span
						>
					</label>
					<label class="row check">
						<input
							type="checkbox"
							checked={t.allowExit !== false}
							onchange={(e) => {
								setBlendFlag(t, 'allowExit', e.currentTarget.checked);
								changed();
							}}
						/>
						<span
							title="On: another transition may leave the target state while this blend runs (as before). Off: none may until the blend ends."
							>Allow exit during transition</span
						>
					</label>
				{/if}
				<label class="row check">
					<input
						type="checkbox"
						checked={!!t.disabled}
						onchange={(e) => {
							setTransitionDisabled(t, e.currentTarget.checked);
							changed();
						}}
					/>
					<span
						title="A disabled transition never fires, in the preview or in game; it stays on the graph, greyed"
						>Disable</span
					>
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
				{#if s.blend}
					{@const b = s.blend}
					<h5
						title="A 1D blend state: the two points either side of the input's value play mixed by where it falls between them; below the first or above the last, that point plays alone. Cues fire from the lower point; the exit time reads the first point's timeline."
					>
						Blend (1D)
					</h5>
					<label class="row">
						<span>By input</span>
						<select
							value={b.input}
							onchange={(e) => {
								b.input = e.currentTarget.value;
								changed();
							}}
						>
							{#if !numberInputs.some((i) => i.id === b.input)}<option value={b.input}
									>{b.input || '— pick —'} (not a number input)</option
								>{/if}
							{#each numberInputs as i (i.id)}<option value={i.id}>{i.id}</option>{/each}
						</select>
					</label>
					{#each b.points as p, n (n)}
						<div class="cond">
							<select
								value={p.timeline}
								aria-label="Point timeline"
								onchange={(e) => {
									setBlendPoint(s, n, { timeline: e.currentTarget.value });
									changed();
								}}
							>
								{#if !timelineNames.has(p.timeline)}<option value={p.timeline}
										>{p.timeline} (missing)</option
									>{/if}
								{#each timelines as tl (tl.id)}<option value={tl.id}>{tl.name || tl.id}</option
									>{/each}
							</select>
							<input
								class="blend-at"
								type="number"
								step="any"
								value={p.at}
								aria-label="Point value"
								title="The input value at which this timeline plays alone"
								onchange={(e) => {
									setBlendPoint(s, n, { at: Number(e.currentTarget.value) });
									changed();
								}}
							/>
							<button
								type="button"
								class="x"
								title="Remove the point"
								disabled={b.points.length <= 1}
								onclick={() => {
									removeBlendPoint(s, n);
									changed();
								}}>×</button
							>
						</div>
					{/each}
					{#each issues.filter((i) => i.layer === layer.id && i.state === s.id && i.code.startsWith('blend-')) as i, n (n)}
						<p class="issue {i.level}">⚠ {i.message}</p>
					{/each}
					<div class="btns">
						<button
							type="button"
							class="ghost"
							disabled={!timelines.length}
							onclick={() => {
								addBlendPoint(s, nextBlendTimeline(s));
								changed();
							}}>＋ point</button
						>
						<button
							type="button"
							class="ghost"
							title="Back to a plain state playing the first point's timeline"
							onclick={() => {
								clearBlendState(s);
								changed();
							}}>Make plain state</button
						>
					</div>
				{:else}
					<label class="row">
						<span>Timeline</span>
						<select
							value={s.timeline}
							onchange={(e) => setStateField(s, 'timeline', e.currentTarget.value)}
						>
							{#if !timelineNames.has(s.timeline)}<option value={s.timeline}
									>{s.timeline} (missing)</option
								>{/if}
							{#each timelines as tl (tl.id)}<option value={tl.id}>{tl.name || tl.id}</option
								>{/each}
						</select>
					</label>
					<button
						type="button"
						class="ghost"
						disabled={!numberInputs.length}
						title={numberInputs.length
							? 'Blend this state’s timeline with others by a number input (an idle → run by speed)'
							: 'Add a number input first (the Inputs list)'}
						onclick={() => {
							makeBlendState(s, numberInputs[0].id, nextBlendTimeline(s));
							changed();
						}}>Make blend state</button
					>
				{/if}
				<label class="row">
					<span>Speed</span>
					<input
						type="number"
						min="0.05"
						step="0.1"
						value={s.speed ?? 1}
						onchange={(e) => {
							const v = Number(e.currentTarget.value);
							setStateField(s, 'speed', v > 0 && v !== 1 ? v : undefined);
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
				<label class="row">
					<span
						title="Start this many seconds into the timeline, read from each placed instance's own number param — so placements that enter together play out of step."
						>Start offset</span
					>
					<select
						value={s.offsetParam ?? ''}
						onchange={(e) => setStateField(s, 'offsetParam', e.currentTarget.value || undefined)}
					>
						<option value="">none</option>
						{#if s.offsetParam && !numberParams.some((p) => p.key === s.offsetParam)}
							<option value={s.offsetParam}>{`{${s.offsetParam}}`} (unknown)</option>
						{/if}
						{#each numberParams as p (p.key)}<option value={p.key}>{`{${p.key}}`} seconds</option
							>{/each}
					</select>
				</label>
				<label class="row check">
					<input
						type="checkbox"
						checked={!!s.randomStart}
						onchange={(e) => setStateField(s, 'randomStart', e.currentTarget.checked || undefined)}
					/>
					<span title="Start at a random point of the timeline each time the state is entered"
						>Random start</span
					>
				</label>
				<h5>On enter</h5>
				{#each s.onEnter ?? [] as a (a.id)}
					<div class="enter-row">
						<span class="dim">raise</span>
						<select
							value={a.event}
							onchange={(e) => {
								a.event = e.currentTarget.value;
								delete a.payload;
								changed();
							}}
						>
							{#if !events.some((ev) => ev.id === a.event)}<option value={a.event}
									>{a.event || '— pick —'} (unknown)</option
								>{/if}
							{#each events as ev (ev.id)}<option value={ev.id}>{ev.id}</option>{/each}
						</select>
						<button
							type="button"
							class="x"
							title="Remove"
							onclick={() => (removeEnterAction(s, a.id), changed())}>×</button
						>
					</div>
					<EditorRaisePayload
						action={a}
						event={events.find((ev) => ev.id === a.event)}
						{inputs}
						onChanged={changed}
					/>
				{/each}
				<button
					type="button"
					class="ghost"
					disabled={!events.length}
					title={events.length
						? 'Raise one of the component’s events each time this state is entered'
						: 'Declare an event first (Properties → Component variables → Events)'}
					onclick={() => {
						if (def) addEnterAction(s, def, reservedRows);
						changed();
					}}>＋ raise event</button
				>
				<h5>On exit</h5>
				{#each s.onExit ?? [] as a (a.id)}
					<div class="enter-row">
						<span class="dim">raise</span>
						<select
							value={a.event}
							onchange={(e) => {
								a.event = e.currentTarget.value;
								delete a.payload;
								changed();
							}}
						>
							{#if !events.some((ev) => ev.id === a.event)}<option value={a.event}
									>{a.event || '— pick —'} (unknown)</option
								>{/if}
							{#each events as ev (ev.id)}<option value={ev.id}>{ev.id}</option>{/each}
						</select>
						<button
							type="button"
							class="x"
							title="Remove"
							onclick={() => (removeExitAction(s, a.id), changed())}>×</button
						>
					</div>
					<EditorRaisePayload
						action={a}
						event={events.find((ev) => ev.id === a.event)}
						{inputs}
						onChanged={changed}
					/>
				{/each}
				<button
					type="button"
					class="ghost"
					disabled={!events.length}
					title={events.length
						? 'Raise one of the component’s events each time a transition leaves this state (before the next state’s On enter)'
						: 'Declare an event first (Properties → Component variables → Events)'}
					onclick={() => {
						if (def) addExitAction(s, def, reservedRows);
						changed();
					}}>＋ raise event</button
				>
				{#each eventIssues.filter((i) => i.state === (s.name || s.id) && i.layer === (layer.name || layer.id)) as i, n (n)}
					<p class="issue {i.level}">⚠ {i.message}</p>
				{/each}
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
				{#if layer?.disabled}
					<p class="dim">
						Disabled: this layer does not run, in the preview or in game. ⏻ Enable turns it back on.
					</p>
				{/if}
				{#if problems.length}
					<p class="dim">
						{problems.length} problem{problems.length === 1 ? '' : 's'} — see
						<button type="button" class="link" onclick={() => (consoleTab = 'problems')}
							>Problems</button
						> below.
					</p>
				{/if}
			{/if}
		</aside>
	</div>

	<div class="sm-console" aria-label="Console">
		<div class="con-bar" role="tablist" aria-label="Console">
			<button
				type="button"
				role="tab"
				class:on={consoleTab === 'console'}
				aria-selected={consoleTab === 'console'}
				onclick={() => {
					consoleTab = 'console';
					focusedInput = null;
				}}>Console</button
			>
			<button
				type="button"
				role="tab"
				class:on={consoleTab === 'problems'}
				aria-selected={consoleTab === 'problems'}
				onclick={() => (consoleTab = 'problems')}
				>Problems{#if problems.length}<span class="count" class:err={problemErrors > 0}
						>{problems.length}</span
					>{/if}</button
			>
			{#if consoleTab === 'console'}
				{#if layers.length}
					<span class="states">
						{#each layers as l (l.id)}
							<span
								>{l.name ?? l.id}:
								<b
									>{l.disabled
										? 'off'
										: runnerStates[l.id]
											? endpointLabelFor(l, runnerStates[l.id])
											: '—'}</b
								></span
							>
						{/each}
					</span>
				{/if}
				<span class="grow"></span>
				{#if consoleLog.length}<button type="button" class="ghost" onclick={clearLog}>Clear</button
					>{/if}
			{/if}
		</div>
		{#if consoleTab === 'console'}
			{#if !consoleLog.length}
				<p class="dim con-empty">
					Entered states, taken transitions and raised events show here — ▶ Run, fire an input, or
					click or hover a listening node on the stage.
				</p>
			{:else}
				<ol class="con-log">
					{#each consoleLog as row (row.n)}
						<li class={row.kind}>
							<span class="t">{row.t.toFixed(2)}s</span>
							<span class="k">{row.kind}</span>
							{#if row.layer}<span class="origin">{row.layer}</span>{/if}
							<b>{row.text}</b>
							{#if row.origin}<span class="origin">{row.origin}</span>{/if}
							{#if row.payload}<span class="payload">{row.payload}</span>{/if}
						</li>
					{/each}
				</ol>
			{/if}
		{:else if !problems.length}
			<p class="dim con-empty">No problems.</p>
		{:else}
			<ol class="con-log problems">
				{#each problems as problem, n (n)}
					<li class={problem.level}>
						<button type="button" title="Show where it is" onclick={() => jumpTo(problem)}>
							<span class="k">{problem.level === 'error' ? '⚠' : '•'}</span>
							{problem.message}
						</button>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</section>

<style>
	.enter-row {
		display: flex;
		align-items: center;
		gap: 6px;
		margin-top: 4px;
	}
	.enter-row select {
		flex: 1;
		min-width: 0;
	}
	.issue {
		margin: 4px 0 0;
		font-size: 11px;
	}
	.issue.error {
		color: #ff9a9a;
	}
	.issue.warning {
		color: #d98a3a;
	}
	.sm-console {
		flex: none;
		height: 128px;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--line);
		min-height: 0;
	}
	.con-bar {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-bottom: 1px solid var(--line);
	}
	.con-bar button {
		background: transparent;
		color: var(--dim);
		border: 1px solid transparent;
		border-radius: 5px;
		padding: 2px 8px;
		font: inherit;
	}
	.con-bar button.on {
		color: var(--accent);
		background: var(--panel2);
	}
	.con-bar .count {
		margin-left: 4px;
		padding: 0 5px;
		border-radius: 8px;
		background: var(--panel2);
		color: var(--dim);
	}
	.con-bar .count.err {
		color: #f0a050;
	}
	.con-bar .states {
		display: flex;
		gap: 10px;
		margin-left: 8px;
		color: var(--dim);
	}
	.con-empty {
		padding: 6px 10px;
	}
	.con-log {
		list-style: none;
		margin: 0;
		padding: 0 8px;
		overflow: auto;
		flex: 1;
		font-size: 11px;
		font-family: ui-monospace, monospace;
	}
	.con-log li {
		display: flex;
		gap: 6px;
		align-items: baseline;
		padding: 1px 0;
		border-bottom: 1px solid var(--line);
	}
	.con-log .t {
		color: var(--dim);
		width: 46px;
		flex: none;
	}
	.con-log .k {
		width: 70px;
		flex: none;
		color: var(--dim);
	}
	.con-log li.state b {
		color: var(--accent2);
	}
	.con-log li.transition b {
		color: var(--accent);
	}
	.con-log .origin {
		color: var(--dim);
		font-size: 10px;
	}
	.con-log .payload {
		color: var(--accent2);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.problems button {
		background: none;
		border: 0;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
		padding: 1px 0;
		display: flex;
		gap: 6px;
	}
	.problems button:hover {
		color: var(--accent);
	}
	.problems li.error {
		color: #f0a050;
	}
	.problems li.warning {
		color: var(--dim);
	}
	.problems .k {
		width: auto;
	}
	.link {
		background: none;
		border: 0;
		padding: 0;
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
		font: inherit;
	}
	.sm-inputs {
		width: 190px;
		flex: none;
		overflow: auto;
		border-right: 1px solid var(--line);
		padding: 8px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.sm-inputs h4 {
		margin: 2px 0;
		font-size: 11px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: var(--accent);
	}
	.in-row {
		display: flex;
		align-items: center;
		gap: 4px;
		border-radius: 4px;
		padding: 1px 2px;
	}
	.in-row.focus {
		outline: 1px solid #f0a050;
	}
	.in-row .kind {
		width: 14px;
		text-align: center;
		color: var(--dim);
	}
	.in-row .val {
		flex: 1;
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		overflow: hidden;
	}
	.in-row .val input[type='number'] {
		width: 56px;
		min-width: 0;
	}
	.in-row .trig {
		flex: 1;
		min-width: 0;
		text-align: left;
	}
	.sm-inputs button,
	.sm-inputs input,
	.sm-inputs select {
		background: var(--panel2);
		color: var(--txt);
		border: 1px solid var(--line);
		border-radius: 5px;
		padding: 2px 5px;
		font: inherit;
	}
	.sm-inputs .x {
		flex: none;
		padding: 1px 5px;
		background: transparent;
		border-color: transparent;
		color: var(--dim);
	}
	.sm-inputs .x:hover {
		color: var(--txt);
	}
	.in-add {
		display: flex;
		gap: 3px;
		margin-top: 4px;
	}
	.in-add input {
		flex: 1;
		min-width: 0;
	}
	.sm-tabs button.off {
		opacity: 0.55;
		text-decoration: line-through;
	}
	.sm-bar .ghost.on {
		color: #f0a050;
	}
	.sm-graph :global(.svelte-flow__edge.off .svelte-flow__edge-path) {
		stroke-dasharray: 5 4;
		opacity: 0.5;
	}
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
	.sm-bar .issues {
		color: #f0a050;
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
	.cond .blend-at {
		flex: none;
		width: 56px;
	}
	.blend-range {
		width: 100%;
		margin: 0 0 2px;
	}
	.cond .x,
	.enter-row .x {
		flex: none;
		padding: 2px 6px;
	}
	.btns {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-top: 4px;
	}
	.trig {
		text-align: left;
		color: var(--accent2);
	}
</style>
