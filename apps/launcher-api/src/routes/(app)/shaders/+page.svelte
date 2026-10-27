<script lang="ts">
	import { replaceState } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteFlowProvider, type Connection, type Edge, type Node } from '@xyflow/svelte';
	import { onMount, untrack } from 'svelte';
	import DocHistoryModal from '$lib/DocHistoryModal.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import SaveStatusBadge from '$lib/SaveStatusBadge.svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { askConfirm, askText } from '$lib/dialogs.svelte';
	import GraphCanvas from '$lib/graph/GraphCanvas.svelte';
	import { readDrag } from '$lib/graph/dnd';
	import { LeaseState } from '$lib/leaseState.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { guardUnsavedWork } from '$lib/unsavedGuard';
	import { CUSTOM_ELEMENT_FX_MOTION_OP_LIMIT, elementFxSpec } from 'constants-shared/elementFx';
	import {
		BREAK_OUTPUT,
		CUSTOM_GLSL,
		MOTION_OUTPUT,
		analyzeShaderGraph,
		analyzeShaderMotion,
		builtinTwin,
		compileShaderEffect,
		SUBGRAPH_CALL,
		SUBGRAPH_IN,
		SUBGRAPH_OUT,
		calledSubgraph,
		hasCustomGlsl,
		normalizeShaderGraphDoc,
		subgraphName,
		subgraphOf,
		type ShaderGraphDoc,
	} from 'engine-shadergraph';
	import BreakProperties from './BreakProperties.svelte';
	import CustomGlslProperties from './CustomGlslProperties.svelte';
	import GraphSettings from './GraphSettings.svelte';
	import NodeProperties from './NodeProperties.svelte';
	import ShaderLibrary from './ShaderLibrary.svelte';
	import ShaderNode from './ShaderNode.svelte';
	import ShaderPreview from './ShaderPreview.svelte';
	import SubgraphBar from './SubgraphBar.svelte';
	import SubgraphProperties from './SubgraphProperties.svelte';
	import { provideGlslCheck } from './glslCheck.svelte';
	import { provideShaderThumbs } from './shaderThumbs.svelte';
	import {
		DRIVER_CHIP_MARKS,
		MOTION_SCOPE,
		SHADER_DROP_MIME,
		SUBGRAPHS_PIXEL_ONLY,
		addCall,
		addNodeIn,
		analyzeScope,
		breakPaletteEntry,
		breakPlacement,
		canConnect,
		canPlace,
		canvasGraph,
		checkerIssues,
		connect,
		costMeter,
		customGlslRefusal,
		defaultPreviewElement,
		deleteMotionGraph,
		deleteSubgraph,
		docFromTwin,
		docIssues,
		driverCodeIssues,
		driverGraphIssues,
		driverIssues,
		driverSummary,
		drivenChannels,
		editCustomGlslPorts,
		freshSubgraphName,
		groupNodes,
		groupRefusal,
		groupable,
		inScope,
		isMotionScope,
		missingBoundary,
		motionAnalysis,
		moveNode,
		newShaderDoc,
		nodeDefIn,
		remove,
		setCustomGlslCode,
		setNodeValue,
		slugOf,
		subgraphCalls,
		subgraphRows,
		undrivenChannels,
		ungroupCall,
		ungroupRefusal,
		viewOf,
		type CanvasMode,
		type GraphScope,
		type ShaderNodeView,
	} from './shaderEditor';
	import type { PageData } from './$types';

	/**
	 * Invisible Shader Graph — `/shaders` (`docs/design/invisible-shader-graph.md` §8 step 5). The
	 * project's graphs on the left with the node library, the open graph on the canvas, and on the
	 * right the live preview, the selected node and the effect's settings. Every edit re-checks and
	 * re-compiles the graph in the page (`engine-shadergraph`), so errors land on their nodes as you
	 * wire and the preview plays what the game will. It autosaves under the graph's edit lease, and
	 * every save keeps the version it replaced (History). The canvas shows the pixel graph (and the
	 * subgraphs opened from it) or, switched to Motion, the motion graph (step 8a).
	 */
	let { data }: { data: PageData } = $props();

	type GraphRow = PageData['shaders'][number];

	const projectKey = untrack(() => data.projectKey);
	const hasProject = projectKey.length > 0;

	let graphs = $state<GraphRow[]>(untrack(() => data.shaders));
	let doc = $state<ShaderGraphDoc | null>(untrack(() => data.opened?.doc ?? null));
	let openShared = $state(untrack(() => data.opened?.shared ?? false));
	let selectedId = $state<string | null>(null);
	let notice = $state(
		untrack(() =>
			data.missing
				? `This project has no effect "${data.missing}": it was deleted, or the link is old.`
				: '',
		),
	);

	const analysis = $derived(doc ? analyzeShaderGraph(doc) : undefined);
	const motionCheck = $derived(doc ? analyzeShaderMotion(doc) : undefined);
	const compiled = $derived(doc ? compileShaderEffect(doc) : undefined);
	const compiledEffect = $derived(compiled?.ok ? compiled.effect : undefined);
	const motionErrors = $derived(motionCheck?.issues.filter((i) => i.level === 'error').length ?? 0);
	/** The work and reads against the doc's budget: a particle material's when made for one. */
	const meter = $derived(doc && analysis ? costMeter(doc, analysis) : undefined);

	// ── Custom GLSL (step 8c): a holder of `shaderCustomGlsl` adds it and changes its code or ports ──
	const canCustomGlsl = untrack(() => data.canCustomGlsl ?? false);
	/** The open graph as stored (opened, restored or saved here): a save refuses a non-holder's
	 *  graph holding Custom GLSL this one does not, so the page refuses such an edit first. */
	let storedDoc = $state.raw<ShaderGraphDoc | null>(untrack(() => data.opened?.doc ?? null));
	const holdsGlsl = $derived(doc ? hasCustomGlsl(doc) : false);
	// While it holds Custom GLSL, the effect's shader is test-compiled on WebGL1 and WebGL2.
	const glslCheck = provideGlslCheck();
	$effect(() => {
		const shader = holdsGlsl && compiled?.ok ? compiled.effect.shader : undefined;
		const of = doc;
		untrack(() => glslCheck.update(shader, of));
	});
	const driverFound = $derived(
		glslCheck.doc ? driverIssues(glslCheck.doc, glslCheck.verdicts) : [],
	);
	const drivers = $derived(driverSummary(glslCheck.verdicts, glslCheck.pending, !!compiled?.ok));
	/** The drivers' errors, once each on the effect's own graph. */
	const driverErrors = $derived(doc ? driverGraphIssues(doc, null, driverFound).length : 0);
	/** For someone without `shaderCustomGlsl`: why `next` cannot be taken (it adds Custom GLSL). */
	const lockedGlsl = (next: ShaderGraphDoc): string | undefined =>
		!canCustomGlsl && storedDoc ? customGlslRefusal(storedDoc, next) : undefined;

	/** The whole effect's: the pixel graph's errors, the motion graph's and the drivers'. */
	const errorCount = $derived(
		(analysis?.issues.filter((i) => i.level === 'error').length ?? 0) + motionErrors + driverErrors,
	);

	// ── Subgraphs: the canvas shows the effect's graph, or a subgraph's body opened from it ──
	/** The subgraphs opened, outermost first; what the doc no longer has (undone, deleted) closes. */
	let scopePath = $state<string[]>([]);
	const openPath = $derived.by(() => {
		const gone = doc ? scopePath.findIndex((id) => !subgraphOf(doc as ShaderGraphDoc, id)) : 0;
		return gone < 0 ? scopePath : scopePath.slice(0, gone);
	});
	/** Pixel (the effect's graph, or the subgraphs opened from it) or Motion (the motion graph). */
	let mode = $state<CanvasMode>('pixel');
	const scope = $derived(mode === 'motion' ? MOTION_SCOPE : (openPath.at(-1) ?? null));
	const motionShown = $derived(isMotionScope(scope));
	/** The doc as the canvas edits it: the shown graph's nodes and wires. */
	const view = $derived(doc ? viewOf(doc, scope) : null);
	const viewAnalysis = $derived(
		!doc || !scope
			? analysis
			: isMotionScope(scope)
				? motionAnalysis(doc, motionCheck)
				: analyzeScope(doc, scope),
	);
	const selected = $derived(view?.nodes.find((n) => n.id === selectedId));
	const driven = $derived(doc ? drivenChannels(doc) : []);
	/** The graph shown's analysis with the drivers' errors on its nodes, as the canvas shows them. */
	const shownAnalysis = $derived.by(() => {
		if (!doc || !viewAnalysis || !driverFound.length) return viewAnalysis;
		const found = driverGraphIssues(doc, scope, driverFound);
		return found.length
			? { ...viewAnalysis, issues: [...viewAnalysis.issues, ...found] }
			: viewAnalysis;
	});
	/** A key per graph shown: a symbol (the motion graph's scope) cannot be put in a string. */
	const scopeKey = $derived(isMotionScope(scope) ? 'motion' : (scope ?? ''));

	// ── The canvas ──
	const nodeTypes = { shader: ShaderNode };
	let nodes = $state.raw<Node[]>([]);
	let edges = $state.raw<Edge[]>([]);
	let fitSignal = $state(0);
	$effect(() => {
		// The selection is the canvas's own (Shift / Ctrl / ⌘-click, a box): a rebuild keeps it.
		const kept = untrack(() => nodes)
			.filter((n) => n.selected)
			.map((n) => n.id);
		const picked = new Set(selectedId ? [...kept, selectedId] : kept);
		const graph = doc
			? canvasGraph(doc, shownAnalysis, picked, lease.readOnly, scope)
			: { nodes: [], edges: [] };
		// A node rebuilt without its size is hidden until measured again: a click landing in that
		// frame (the driver test-compile answers a moment after an edit) would hit the pane. It keeps
		// its size while its ports are the same (with other ports, its dots are measured afresh).
		const ports = (n: Node): string => {
			const def = (n.data as ShaderNodeView).def;
			return JSON.stringify([def?.inputs.map((p) => p.id), def?.outputs.map((p) => p.id)]);
		};
		const was = new Map(untrack(() => nodes).map((n) => [n.id, n]));
		nodes = graph.nodes.map((n) => {
			const before = was.get(n.id);
			return before?.measured && ports(before) === ports(n as Node)
				? { ...n, measured: before.measured }
				: n;
		}) as Node[];
		edges = graph.edges as Edge[];
	});
	// Node thumbnails: one renderer for every node, fed the graph as edited (`shaderThumbs.svelte.ts`).
	const thumbs = provideShaderThumbs();
	$effect(() => {
		const [graph, checked, picked] = [doc, viewAnalysis, selectedId];
		const shown = scope;
		untrack(() => thumbs.update(graph, checked, picked ? [picked] : [], shown));
	});

	// ── Undo ──
	let past = $state.raw<ShaderGraphDoc[]>([]);
	let future = $state.raw<ShaderGraphDoc[]>([]);
	const UNDO_DEPTH = 100;

	/** Every edit: remember the doc it replaces, show the new one, autosave. A gesture that changed
	 *  nothing (it gives back the doc it was given) is no step. */
	function edit(next: ShaderGraphDoc): void {
		if (!doc || lease.readOnly || next === doc) return;
		const refused = lockedGlsl(next);
		if (refused) {
			notice = refused;
			return;
		}
		past = [...past.slice(-(UNDO_DEPTH - 1)), doc];
		future = [];
		doc = next;
		saveState.markDirty();
	}
	/** Undo or redo would bring back Custom GLSL a save since took out, which only a holder adds. */
	const lockedStep = (to: ShaderGraphDoc): boolean => {
		const refused = lockedGlsl(to);
		if (refused) notice = `${refused} This step would bring back custom GLSL deleted since.`;
		return !!refused;
	};
	function undo(): void {
		const prev = past.at(-1);
		if (!prev || !doc || lease.readOnly || lockedStep(prev)) return;
		past = past.slice(0, -1);
		future = [doc, ...future];
		doc = prev;
		saveState.markDirty();
	}
	function redo(): void {
		const next = future[0];
		if (!next || !doc || lease.readOnly || lockedStep(next)) return;
		future = future.slice(1);
		past = [...past.slice(-(UNDO_DEPTH - 1)), doc];
		doc = next;
		saveState.markDirty();
	}

	// ── Lease + save ──
	const lease = new LeaseState({
		toolId: 'shaders',
		clientKey: untrack(() => data.clientKey),
		projectKey,
		docKey: '',
		enabled: hasProject,
	});
	/** The lease follows the open graph; a shared one is not this project's to lease until saved. */
	let leasedId: string | null = null;
	/** Set on unmount: a save landing after the page is gone takes no lease. */
	let destroyed = false;
	function leaseGraph(id: string | null): void {
		if (id === leasedId || destroyed) return;
		leasedId = id;
		void lease.switchDoc(id);
	}

	/** Bumped when another graph opens: a save of the one before then leaves the page alone. */
	let shownGraph = 0;

	const saveState = new SaveState({
		initialEtag: untrack(() => data.opened?.etag ?? null),
		autosaveMs: 1000,
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			const current = doc;
			const shown = shownGraph;
			if (!current) return { ok: true, etag: baseEtag };
			try {
				const { res, out } = await postSave(current, force ? { force: true } : { baseEtag });
				if (res.status === 409) {
					return {
						ok: false,
						reason: out.error === 'scope-mismatch' ? 'scope-mismatch' : 'conflict',
						message: out.message ?? 'Someone else saved this effect.',
					};
				}
				if (!res.ok || !out.id) {
					return {
						ok: false,
						reason: 'error',
						message: out.message ?? `Save failed (HTTP ${res.status}).`,
					};
				}
				if (shown !== shownGraph) return { ok: true, etag: out.etag ?? null };
				storedDoc = current;
				upsertRow({
					id: out.id,
					name: out.name ?? out.id,
					description: current.description ?? '',
					shared: false,
				});
				if (openShared) {
					// A shared graph saved here is now the project's own copy.
					openShared = false;
					syncUrl(current, false);
				}
				leaseGraph(out.id);
				return { ok: true, etag: out.etag ?? null };
			} catch {
				return { ok: false, reason: 'error', message: 'Save failed (network error).' };
			}
		},
	});

	interface SaveAnswer {
		id?: string;
		name?: string;
		etag?: string | null;
		error?: string;
		message?: string;
	}
	async function postSave(
		graph: ShaderGraphDoc,
		guard: { baseEtag: string | null } | { force: true },
	): Promise<{ res: Response; out: SaveAnswer }> {
		const res = await fetch('/api/shaders/save', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ doc: $state.snapshot(graph), projectKey, ...guard }),
		});
		return { res, out: (await res.json().catch(() => ({}))) as SaveAnswer };
	}

	async function refreshList(): Promise<void> {
		const list = await fetch(`/api/shaders/list?projectKey=${encodeURIComponent(projectKey)}`);
		if (list.ok) graphs = ((await list.json()) as { shaders: GraphRow[] }).shaders;
	}

	function upsertRow(row: GraphRow): void {
		// The project's own graph of an id the studio library has: still in the library.
		const inLibrary = graphs.some((g) => g.id === row.id && (g.shared || g.inLibrary));
		const rest = graphs.filter((g) => g.id !== row.id);
		graphs = [...rest, inLibrary ? { ...row, inLibrary } : row].sort(
			(a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
		);
	}

	/** Save what is pending before the open graph changes; false when it could not be. */
	async function settle(): Promise<boolean> {
		// An autosave in flight decides what is left to save: let it land first (a save asked for
		// meanwhile only joins it, and answers false).
		for (let waited = 0; saveState.busy && waited < 10_000; waited += 50) {
			await new Promise((resolve) => setTimeout(resolve, 50));
		}
		saveState.cancelAutosave();
		if (!saveState.dirty) return true;
		if (await saveState.save()) return true;
		return askConfirm({
			title: 'This effect has unsaved changes',
			message: `${saveState.message || 'It could not be saved.'}\n\nLeave it anyway? Your changes are lost.`,
			confirmLabel: 'Leave anyway',
			danger: true,
		});
	}

	/** The URL names the open graph: `?graph=`, and `&shared=1` while it is the shared library's. */
	function syncUrl(open: ShaderGraphDoc | null, shared: boolean): void {
		const keep = [...page.url.searchParams].filter(([k]) => k !== 'graph' && k !== 'shared');
		if (open) keep.push(['graph', open.id]);
		if (open && shared) keep.push(['shared', '1']);
		const query = new URLSearchParams(keep).toString();
		// A query on this same route: `resolve()` cannot carry one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`/shaders${query ? `?${query}` : ''}`, {});
	}

	function showGraph(next: ShaderGraphDoc | null, etag: string | null, shared: boolean): void {
		shownGraph += 1;
		doc = next;
		storedDoc = next;
		openShared = shared;
		selectedId = null;
		scopePath = [];
		mode = 'pixel';
		past = [];
		future = [];
		// It shows as stored: nothing of the graph before is left to save onto it (a shared one
		// saved unedited would become the project's copy).
		saveState.cancelAutosave();
		saveState.adoptEtag(etag);
		saveState.setDirty(false);
		leaseGraph(next && !shared ? next.id : null);
		fitSignal += 1;
		syncUrl(next, shared);
	}

	/** Bumped by each open: a slower answer to an earlier click is dropped. */
	let opening = 0;
	async function open(row: GraphRow): Promise<void> {
		if (doc && row.id === doc.id && row.shared === openShared) return;
		const ticket = ++opening;
		if (!(await settle()) || ticket !== opening) return;
		const params = new URLSearchParams({
			id: row.id,
			projectKey,
			...(row.shared ? { shared: '1' } : {}),
		});
		const res = await fetch(`/api/shaders/doc?${params}`);
		const out = (await res.json().catch(() => ({}))) as {
			doc?: unknown;
			etag?: string | null;
			exists?: boolean;
			message?: string;
		};
		if (ticket !== opening) return;
		if (!res.ok || !out.doc) {
			notice = out.message ?? `Could not open "${row.name}" (HTTP ${res.status}).`;
			return;
		}
		if (out.exists === false) {
			notice = `"${row.name}" is gone: someone deleted it.`;
			await refreshList();
			return;
		}
		notice = '';
		showGraph(normalizeShaderGraphDoc(out.doc, row.id), out.etag ?? null, row.shared);
	}

	/** A new effect: the Output alone, or built-in `kind`'s graph twin to change. */
	async function create(kind?: string): Promise<void> {
		if (!(await settle())) return;
		const twin = kind ? builtinTwin(kind) : undefined;
		const from = twin ? elementFxSpec(twin.kind).label : '';
		const name = (
			await askText({
				title: twin ? `New effect from ${from}` : 'New shader effect',
				message: twin
					? `It starts as ${from}'s graph, with its params, passes and motion: change anything.`
					: undefined,
				label: 'Name',
				value: twin ? `${from} copy` : '',
				confirmLabel: 'Create',
			})
		)?.trim();
		if (!name) return;
		const id = slugOf(name);
		if (graphs.some((g) => g.id === id && !g.shared)) {
			notice = `This project already has an effect "${id}". Pick another name.`;
			return;
		}
		if (
			graphs.some((g) => g.id === id && g.shared) &&
			!(await askConfirm({
				title: `The shared library has "${id}"`,
				message: `A new effect of that id replaces the studio's in this project: every entry naming custom:${id} plays yours.`,
				confirmLabel: 'Create anyway',
			}))
		)
			return;
		const fresh = twin ? docFromTwin(twin, id, name) : newShaderDoc(id, name);
		const { res, out } = await postSave(fresh, { baseEtag: null });
		if (!res.ok || !out.id) {
			notice =
				res.status === 409 && out.error !== 'scope-mismatch'
					? `Someone just made an effect "${id}" in this project. Pick another name.`
					: (out.message ?? `Could not create "${name}" (HTTP ${res.status}).`);
			await refreshList();
			return;
		}
		notice = '';
		upsertRow({ id: out.id, name: out.name ?? name, description: '', shared: false });
		showGraph(fresh, out.etag ?? null, false);
	}

	async function del(row: GraphRow): Promise<void> {
		const ok = await askConfirm({
			title: `Delete "${row.name}"?`,
			message:
				'An Element FX entry naming it keeps its place. It plays the studio’s shared effect of that id if there is one, else nothing until an effect of that id exists again. Its saved versions stay in History.',
			confirmLabel: 'Delete',
			danger: true,
		});
		if (!ok) return;
		const res = await fetch('/api/shaders/delete', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id: row.id, projectKey }),
		});
		if (!res.ok) {
			const out = (await res.json().catch(() => ({}))) as { message?: string };
			notice = out.message ?? `Delete failed (HTTP ${res.status}).`;
			return;
		}
		if (doc?.id === row.id && !openShared) showGraph(null, null, false);
		await refreshList();
	}

	// ── The studio library ──
	const canPublishShared = untrack(() => data.canPublishShared);
	const PUBLISH_GLSL_LOCKED =
		'Only an admin can publish an effect holding custom GLSL to the studio library.';
	const openRow = $derived(
		doc ? graphs.find((g) => g.id === doc?.id && g.shared === openShared) : undefined,
	);
	async function postLibrary(
		action: 'publish' | 'unpublish',
		id: string,
		replace = false,
	): Promise<{ res: Response; out: { error?: string; message?: string; errors?: string[] } }> {
		const res = await fetch(`/api/shaders/${action}`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, projectKey, ...(replace ? { replace: true } : {}) }),
		});
		return { res, out: await res.json().catch(() => ({})) };
	}
	/** Copy the open effect, as saved, to the studio library, which every project takes in. */
	async function publishToLibrary(): Promise<void> {
		if (!doc || openShared) return;
		if (!(await settle())) return;
		if (holdsGlsl && !canCustomGlsl) {
			notice = PUBLISH_GLSL_LOCKED;
			return;
		}
		glslCheck.checkNow();
		if (driverErrors) {
			notice = `${drivers.text} Only an effect WebGL1 and WebGL2 both compile can go to the studio library.`;
			return;
		}
		if (errorCount) {
			notice = 'Fix its errors first: only an effect that compiles can go to the studio library.';
			return;
		}
		const { id, name } = doc;
		const replacing = !!openRow?.inLibrary;
		const ok = await askConfirm({
			title: replacing
				? `Replace the studio library's "${id}"?`
				: `Publish "${name}" to the studio library?`,
			message: replacing
				? `Every project that plays the library's custom:${id} plays yours from its next Publish. The library keeps the version you replace.`
				: `Every project can then place it as custom:${id}. A project with its own effect of this id keeps its own.`,
			confirmLabel: replacing ? 'Replace' : 'Publish',
		});
		if (!ok) return;
		let { res, out } = await postLibrary('publish', id, replacing);
		if (res.status === 409 && out.error === 'exists') {
			const replace = await askConfirm({
				title: `The studio library already has "${id}"`,
				message: `Someone published an effect of this id meanwhile. Replace it with yours? The library keeps theirs.`,
				confirmLabel: 'Replace',
			});
			if (!replace) return;
			({ res, out } = await postLibrary('publish', id, true));
		}
		if (!res.ok) {
			notice =
				out.error === 'does-not-compile'
					? `${out.message} ${(out.errors ?? []).join('; ')}`
					: (out.message ?? `Publish failed (HTTP ${res.status}).`);
			return;
		}
		notice = `"${name}" is in the studio library: every project can place custom:${id}.`;
		await refreshList();
	}
	/** Remove the open library effect from the studio library. */
	async function removeFromLibrary(): Promise<void> {
		if (!doc || !openShared) return;
		const { id, name } = doc;
		const ok = await askConfirm({
			title: `Remove "${name}" from the studio library?`,
			message: `Projects that place custom:${id} and have no effect of their own of this id play nothing for it from their next Publish, which names those entries. The library keeps the removed version.`,
			confirmLabel: 'Remove',
			danger: true,
		});
		if (!ok) return;
		const { res, out } = await postLibrary('unpublish', id);
		if (!res.ok) {
			notice = out.message ?? `Remove failed (HTTP ${res.status}).`;
			return;
		}
		showGraph(null, null, false);
		await refreshList();
	}

	// ── Canvas gestures ──
	const wireOf = (c: Connection | Edge) => ({
		from: { node: c.source, port: c.sourceHandle ?? '' },
		to: { node: c.target, port: c.targetHandle ?? '' },
	});
	const isValidConnection = (c: Edge | Connection): boolean => {
		if (!doc || lease.readOnly) return false;
		const { from, to } = wireOf(c);
		return canConnect(doc, viewAnalysis, from, to, scope);
	};
	function onConnect(c: Connection): void {
		if (!doc || !isValidConnection(c)) return;
		const { from, to } = wireOf(c);
		edit(inScope(doc, scope, (d) => connect(d, from, to)));
	}
	function onGraphDelete({ nodes: gone, edges: cut }: { nodes: Node[]; edges: Edge[] }): void {
		if (!doc) return;
		edit(
			inScope(doc, scope, (d) =>
				remove(
					d,
					gone.map((n) => n.id),
					cut.map((e) => e.id),
					scope,
				),
			),
		);
		if (selectedId && gone.some((n) => n.id === selectedId)) selectedId = null;
	}
	function onNodeDragStop(): void {
		if (!doc || !view) return;
		let next = view;
		for (const n of nodes) {
			const stored = next.nodes.find((d) => d.id === n.id);
			if (
				stored &&
				(stored.x !== Math.round(n.position.x) || stored.y !== Math.round(n.position.y))
			)
				next = moveNode(next, n.id, n.position.x, n.position.y);
		}
		if (next !== view) edit(inScope(doc, scope, () => next));
	}
	/** The new node alone is selected. */
	function selectOnly(id: string): void {
		nodes = nodes.map((n) => (n.selected ? { ...n, selected: false } : n));
		selectedId = id;
	}
	function placeNode(type: string, pos: { x: number; y: number }): void {
		if (!doc) return;
		const refused = type === BREAK_OUTPUT ? breakPlacement(doc, scope) : '';
		if (refused) notice = refused;
		if (refused || !canPlace(doc, scope, type, canCustomGlsl)) return;
		// The motion graph's first node brings its Output: show both.
		const first = motionShown && !view?.nodes.length;
		const added = addNodeIn(doc, scope, type, pos);
		edit(added.doc);
		selectOnly(added.id);
		if (first) fitSignal += 1;
	}
	/** A call of subgraph `id`, unless it would call itself from the graph shown. */
	function placeCall(id: string, pos: { x: number; y: number }): void {
		if (!doc) return;
		const row = subgraphRows(doc, scope).find((r) => r.id === id);
		if (!row || row.blocked) {
			notice = row?.blocked ?? `This effect has no subgraph "${id}".`;
			return;
		}
		const added = addCall(doc, scope, id, pos);
		edit(added.doc);
		selectOnly(added.id);
	}
	function onDrop(raw: string, pos: { x: number; y: number }): void {
		const payload = readDrag(
			raw,
			(v): v is { type: string; subgraph?: string } =>
				!!v && typeof (v as { type?: unknown }).type === 'string',
		);
		if (payload?.type === SUBGRAPH_CALL && typeof payload.subgraph === 'string')
			placeCall(payload.subgraph, pos);
		else if (payload) placeNode(payload.type, pos);
	}
	/** Where a clicked library node lands: left of the selected node, else left of the leftmost. */
	function besideSelection(): { x: number; y: number } {
		const anchor =
			selected ??
			(view?.nodes ?? []).reduce<ShaderGraphDoc['nodes'][number] | undefined>(
				(min, n) => (!min || n.x < min.x ? n : min),
				undefined,
			);
		return { x: (anchor?.x ?? 0) - 240, y: (anchor?.y ?? 0) + 30 };
	}
	/** Where a clicked Break Output lands: under the Output, an output beside the other. */
	function belowOutput(): { x: number; y: number } {
		const out = view?.nodes.find((n) => n.type === 'output');
		return out ? { x: out.x, y: out.y + 220 } : besideSelection();
	}
	function addFromLibrary(type: string): void {
		if (doc) placeNode(type, type === BREAK_OUTPUT ? belowOutput() : besideSelection());
	}

	/** The doc takes `code` for Custom GLSL node `id` of graph `at`, unless another effect opened
	 *  since (a draft still waiting when the panel closes lands where it was typed, or nowhere). */
	function codeInto(at: GraphScope, id: string): (code: string) => void {
		const graph = shownGraph;
		return (code) => {
			if (doc && graph === shownGraph) edit(setCustomGlslCode(doc, at, id, code));
		};
	}

	// ── Subgraph gestures ──
	/** The canvas's selection (Shift / Ctrl / ⌘-click, a box) and the clicked node. */
	const pickedIds = $derived([
		...new Set([
			...nodes.filter((n) => n.selected).map((n) => n.id),
			...(selectedId ? [selectedId] : []),
		]),
	]);
	const groupCount = $derived(doc ? groupable(doc, scope, pickedIds).length : 0);
	const selectedCall = $derived(
		selected?.type === SUBGRAPH_CALL && doc ? subgraphOf(doc, calledSubgraph(selected)) : undefined,
	);
	/** Show another graph: the effect (`[]`) or the subgraphs opened down to one. */
	function showScope(path: string[]): void {
		scopePath = path;
		selectedId = null;
		nodes = [];
		fitSignal += 1;
	}
	/** Show the pixel graph (where it was left) or the motion graph. Viewing changes nothing. */
	function showMode(next: CanvasMode): void {
		if (next === mode) return;
		mode = next;
		selectedId = null;
		nodes = [];
		fitSignal += 1;
	}
	function openSubgraph(id: string): void {
		if (motionShown) {
			notice = SUBGRAPHS_PIXEL_ONLY;
			return;
		}
		if (doc && subgraphOf(doc, id)) showScope([...openPath, id]);
	}
	/** Delete the whole motion graph, asking first. */
	async function removeMotionGraph(): Promise<void> {
		if (!doc?.motionGraph || lease.readOnly) return;
		const count = doc.motionGraph.nodes.length;
		const ok = await askConfirm({
			title: 'Delete the motion graph?',
			message: `Its ${count} node${count === 1 ? '' : 's'} go, and the curves in the effect settings move the element again. Undo brings it back.`,
			confirmLabel: 'Delete',
			danger: true,
		});
		if (ok && doc?.motionGraph) {
			edit(deleteMotionGraph(doc));
			selectedId = null;
		}
	}
	function groupSelection(): void {
		if (!doc || lease.readOnly) return;
		const refused = groupRefusal(doc, scope, pickedIds);
		if (refused) {
			notice = refused;
			return;
		}
		const grouped = groupNodes(doc, scope, pickedIds, freshSubgraphName(doc), viewAnalysis);
		if (!grouped) return;
		edit(grouped.doc);
		selectOnly(grouped.call);
	}
	function ungroup(callId: string): void {
		if (!doc || lease.readOnly) return;
		const refused = ungroupRefusal(doc, scope, callId);
		if (refused) {
			notice = refused;
			return;
		}
		const done = ungroupCall(doc, scope, callId);
		if (!done) return;
		edit(done.doc);
		selectedId = null;
	}
	async function removeSubgraph(id: string): Promise<void> {
		if (!doc || lease.readOnly) return;
		const sub = subgraphOf(doc, id);
		const calls = subgraphCalls(doc, id).length;
		if (!sub) return;
		if (
			calls &&
			!(await askConfirm({
				title: `Delete "${subgraphName(sub)}"?`,
				message: `${calls} node${calls === 1 ? ' calls' : 's call'} it. Deleting it deletes ${calls === 1 ? 'that call' : 'those calls'} too, with their wires (Undo brings them back).`,
				confirmLabel: 'Delete',
				danger: true,
			}))
		)
			return;
		const next = doc && deleteSubgraph(doc, id, true);
		if (next) edit(next);
	}

	// ── History ──
	let historyOpen = $state(false);
	const historyUrl = $derived(
		doc && !openShared
			? `/api/shaders/backups?graph=${encodeURIComponent(doc.id)}&projectKey=${encodeURIComponent(projectKey)}`
			: '',
	);
	async function restoreBackup(id: string): Promise<string | null> {
		if (!doc) return 'No effect is open.';
		if (lease.readOnly)
			return 'Another author is editing this effect — take over before restoring.';
		if (saveState.busy) return 'A save is in progress — try again in a moment.';
		saveState.cancelAutosave();
		const res = await fetch(historyUrl, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ id, baseEtag: saveState.etag }),
		});
		const out = (await res.json().catch(() => ({}))) as {
			doc?: unknown;
			etag?: string | null;
			message?: string;
			error?: string;
		};
		if (!res.ok || !out.doc) {
			if (saveState.dirty) saveState.rearmAutosave();
			return out.message ?? out.error ?? `Restore failed (${res.status}).`;
		}
		showGraph(normalizeShaderGraphDoc(out.doc, doc.id), out.etag ?? null, false);
		historyOpen = false;
		return null;
	}

	// Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, Ctrl/Cmd+S save now; a text field keeps its own.
	function onKey(e: KeyboardEvent): void {
		if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
		if (document.querySelector('dialog[open]')) return;
		const target = e.target as HTMLElement | null;
		const typing =
			!!target &&
			(target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
		const k = e.key.toLowerCase();
		if (k === 's') {
			e.preventDefault();
			// Nothing to save writes nothing (a shared graph saved unedited would become the project's
			// copy); the armed autosave would only write the same doc again.
			if (!saveState.dirty) return;
			saveState.cancelAutosave();
			void saveState.save();
		} else if (!typing && k === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if (!typing && ((k === 'z' && e.shiftKey) || k === 'y')) {
			e.preventDefault();
			redo();
		} else if (!typing && k === 'g') {
			e.preventDefault();
			if (!e.shiftKey) groupSelection();
			else if (selectedCall && selected) ungroup(selected.id);
		}
	}

	onMount(() => {
		if (doc && !openShared) leaseGraph(doc.id);
		if (data.missing) syncUrl(null, false);
		const onUnload = () => lease.release();
		window.addEventListener('pagehide', onUnload);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			saveState.cancelAutosave();
			destroyed = true;
			lease.release();
		};
	});

	guardUnsavedWork(() =>
		saveState.dirty
			? {
					title: 'This effect has unsaved changes',
					message: 'Leaving this page discards them.',
					confirmLabel: 'Leave anyway',
					danger: true,
				}
			: null,
	);
</script>

<svelte:window onkeydown={onKey} />

<div class="page">
	<ToolTopBar
		current="shaders"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			{#if doc && hasProject}
				{#if lease.readOnly}
					<PresenceBanner {lease} />
				{:else}
					<SaveStatusBadge
						state={saveState}
						okAccent
						overwritable
						onReloadTheirs={() => location.reload()}
						onOverwrite={() => void saveState.save({ force: true })}
						onRetry={() => void saveState.save()}
					/>
				{/if}
				{#if holdsGlsl && driverErrors}
					<span
						class="pill-mark"
						title="{drivers.text} It still saves (a graph being built always does), but a game on that driver would draw nothing for it, and it cannot go to the studio library until it compiles."
						>{saveState.dirty ? 'Unsaved' : 'Saved'}: GLSL rejected</span
					>
				{/if}
				<button
					type="button"
					class="chrome"
					disabled={!historyUrl}
					onclick={() => (historyOpen = true)}
				>
					History
				</button>
				{#if canPublishShared}
					{#if openShared}
						<button type="button" class="chrome" onclick={() => void removeFromLibrary()}>
							Remove from library
						</button>
					{:else}
						<button
							type="button"
							class="chrome"
							disabled={lease.readOnly || (holdsGlsl && (!canCustomGlsl || driverErrors > 0))}
							title={holdsGlsl && !canCustomGlsl
								? PUBLISH_GLSL_LOCKED
								: holdsGlsl && driverErrors
									? `${drivers.text} Fix it first.`
									: 'Copy this effect, as saved, to the studio library every project takes in'}
							onclick={() => void publishToLibrary()}
						>
							{openRow?.inLibrary ? 'Update library copy' : 'Publish to library'}
						</button>
					{/if}
				{/if}
			{/if}
		{/snippet}
	</ToolTopBar>

	{#if !hasProject}
		<p class="empty">Pick a project in the launcher first: shader effects belong to a project.</p>
	{:else}
		<div class="body">
			<ShaderLibrary
				motion={motionShown}
				{graphs}
				openId={doc?.id ?? null}
				{openShared}
				readOnly={lease.readOnly}
				onOpen={(row) => void open(row)}
				onNew={() => void create()}
				onNewFrom={(kind) => void create(kind)}
				onDelete={(row) => void del(row)}
				onAdd={addFromLibrary}
				customGlsl={canCustomGlsl}
				subgraphs={doc ? subgraphRows(doc, scope) : []}
				boundary={doc ? missingBoundary(doc, scope) : []}
				breakEntry={doc ? breakPaletteEntry(doc, scope) : undefined}
				onAddCall={(id) => placeCall(id, besideSelection())}
				onOpenSubgraph={openSubgraph}
				onDeleteSubgraph={(id) => void removeSubgraph(id)}
			/>

			<main class="center">
				{#if notice}
					<p class="notice" role="alert">
						{notice} <button type="button" onclick={() => (notice = '')}>✕</button>
					</p>
				{/if}
				{#if doc}
					<div class="status">
						<strong>{doc.name}</strong>
						<span class="muted">custom:{doc.id}</span>
						{#if openShared}<span class="tag">shared — saving keeps a copy in this project</span
							>{/if}
						<span class="grow"></span>
						{#if errorCount}
							<span class="bad"
								>{errorCount} error{errorCount === 1 ? '' : 's'} — not playable until fixed</span
							>
						{:else}
							<span class="good">Compiles</span>
						{/if}
						{#if holdsGlsl}
							<span class="drivers" title={drivers.text}>
								{#each drivers.chips as chip (chip.gl)}
									<span class="chip {chip.state}"
										>WebGL{chip.gl} {DRIVER_CHIP_MARKS[chip.state]}</span
									>
								{/each}
							</span>
						{/if}
						{#if meter}
							<span
								class:over={meter.over}
								class="meter"
								title="Work per pixel against what {meter.budget
									.affords}. The bars: the work (top) and the reads of the element (bottom), as shares of the budget; each node's chip is its part."
							>
								<span class="bars" aria-hidden="true">
									{#each meter.shares as share, i (i)}
										<span
											class:warm={share >= 0.75}
											class:full={share > 1}
											style="width:{Math.min(100, share * 100)}%"
										></span>
									{/each}
								</span>
								{meter.text}
							</span>
						{/if}
						{#if motionShown && motionCheck}
							<span
								class:over={motionCheck.ops > CUSTOM_ELEMENT_FX_MOTION_OP_LIMIT}
								class="meter"
								title="The motion graph’s steps each frame, against the most an effect may take."
								>ops {motionCheck.ops}/{CUSTOM_ELEMENT_FX_MOTION_OP_LIMIT}</span
							>
						{/if}
						<label
							class="thumbs-toggle"
							title={thumbs.failure ||
								'A picture of each node’s output (in the motion graph, its value over the play)'}
						>
							<input type="checkbox" bind:checked={thumbs.enabled} />
							Thumbnails
						</label>
					</div>
					<SubgraphBar
						{mode}
						onMode={showMode}
						{motionErrors}
						subgraphsOff={motionShown ? SUBGRAPHS_PIXEL_ONLY : ''}
						{driven}
						hasMotion={!!doc.motionGraph}
						onDeleteMotion={() => void removeMotionGraph()}
						crumbs={[
							'Effect',
							...openPath.map((id) => {
								const sub = subgraphOf(doc as ShaderGraphDoc, id);
								return sub ? subgraphName(sub) : id;
							}),
						]}
						onCrumb={(i) => showScope(openPath.slice(0, i))}
						groupable={groupCount}
						call={selectedCall ? subgraphName(selectedCall) : ''}
						errors={scope ? docIssues(doc, shownAnalysis, scope) : []}
						readOnly={lease.readOnly}
						onGroup={groupSelection}
						onOpen={() => selectedCall && openSubgraph(selectedCall.id)}
						onUngroup={() => selected && ungroup(selected.id)}
					/>
					<SvelteFlowProvider>
						<GraphCanvas
							bind:nodes
							bind:edges
							{nodeTypes}
							{fitSignal}
							dropMime={SHADER_DROP_MIME}
							{isValidConnection}
							{onConnect}
							{onGraphDelete}
							{onNodeDragStop}
							onNodeClick={({ node }) => (selectedId = node.id)}
							onNodeDoubleClick={({ node }) => {
								const call = view?.nodes.find((n) => n.id === node.id);
								const id = call?.type === SUBGRAPH_CALL ? calledSubgraph(call) : undefined;
								if (id) openSubgraph(id);
							}}
							onPaneClick={() => (selectedId = null)}
							ondrop={onDrop}
						/>
					</SvelteFlowProvider>
				{:else}
					<div class="empty">
						<p>Open an effect on the left, or make a new one.</p>
						<button type="button" onclick={() => void create()}>+ New effect</button>
					</div>
				{/if}
			</main>

			<aside class="props">
				{#if doc}
					<ShaderPreview
						effect={compiledEffect}
						atlases={data.atlases}
						defaultElement={defaultPreviewElement(doc)}
					/>
					{#if selected && view && selected.type === BREAK_OUTPUT && !scope}
						<BreakProperties
							{doc}
							node={selected}
							errors={viewAnalysis?.issues
								.filter((i) => i.node === selected.id && i.level === 'error')
								.map((i) => i.message) ?? []}
							disabled={lease.readOnly}
							onChange={edit}
							onNotice={(text) => (notice = text)}
						/>
					{:else if selected && view}
						<NodeProperties
							{doc}
							node={selected}
							def={nodeDefIn(doc, selected, scope)}
							inTypes={viewAnalysis?.inputs[selected.id] ?? {}}
							wired={view.wires.filter((w) => w.to.node === selected.id).map((w) => w.to.port)}
							errors={shownAnalysis?.issues
								.filter(
									(i) =>
										i.node === selected.id &&
										i.level === 'error' &&
										!(selected.type === CUSTOM_GLSL && i.code === 'glsl'),
								)
								.map((i) => i.message) ?? []}
							paramKinds={motionShown ? ['number', 'bool', 'choice'] : undefined}
							undriven={motionShown && selected.type === MOTION_OUTPUT
								? undrivenChannels(doc)
								: undefined}
							disabled={lease.readOnly}
							onValue={(key, value) =>
								doc && edit(inScope(doc, scope, (d) => setNodeValue(d, selected.id, key, value)))}
						/>
						{#if !motionShown && selected.type === CUSTOM_GLSL}
							{#key `${scopeKey}/${selected.id}`}
								<CustomGlslProperties
									node={selected}
									holder={canCustomGlsl}
									editable={canCustomGlsl && !lease.readOnly}
									issues={[
										...checkerIssues(viewAnalysis?.issues ?? [], selected.id),
										...driverCodeIssues(doc, scope, selected.id, driverFound),
									]}
									driverStatus={drivers.text}
									onCode={codeInto(scope, selected.id)}
									onPorts={(gesture) =>
										doc && edit(editCustomGlslPorts(doc, scope, selected.id, gesture))}
								/>
							{/key}
						{/if}
						{#if !motionShown && (selected.type === SUBGRAPH_CALL || (scope && (selected.type === SUBGRAPH_IN || selected.type === SUBGRAPH_OUT)))}
							<SubgraphProperties
								{doc}
								{scope}
								node={selected}
								disabled={lease.readOnly}
								onChange={edit}
								onOpen={openSubgraph}
								onUngroup={ungroup}
							/>
						{/if}
					{/if}
					<GraphSettings
						{doc}
						errors={[
							...docIssues(doc, analysis),
							...docIssues(doc, motionAnalysis(doc, motionCheck), MOTION_SCOPE).map(
								(m) => `Motion graph: ${m}`,
							),
						]}
						{driven}
						disabled={lease.readOnly}
						onChange={edit}
					/>
				{/if}
			</aside>
		</div>
	{/if}
</div>

<DocHistoryModal
	open={historyOpen}
	listUrl={historyUrl}
	docLabel="effect"
	readOnly={lease.readOnly}
	dirty={saveState.dirty}
	onRestore={restoreBackup}
	onclose={() => (historyOpen = false)}
/>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0e13;
		color: #e2e8f0;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.center {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 6px 12px;
		border-bottom: 1px solid #1f2937;
		font-size: 12px;
	}
	.grow {
		flex: 1;
	}
	.props {
		width: 360px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 14px;
		padding: 10px;
		border-left: 1px solid #1f2937;
		overflow-y: auto;
	}
	.empty {
		margin: auto;
		text-align: center;
		color: #94a3b8;
		font-size: 13px;
	}
	.notice {
		margin: 0;
		padding: 6px 12px;
		background: #3b1d1d;
		color: #fecaca;
		font-size: 12px;
	}
	.tag {
		font-size: 10px;
		color: #fbbf24;
	}
	.muted {
		color: #64748b;
	}
	.bad {
		color: #fca5a5;
	}
	.good {
		color: #86efac;
	}
	.meter {
		display: flex;
		align-items: center;
		gap: 6px;
		color: #94a3b8;
	}
	.meter.over {
		color: #fbbf24;
	}
	.bars {
		display: flex;
		flex-direction: column;
		gap: 2px;
		width: 56px;
		padding: 2px;
		border-radius: 3px;
		background: #1f2937;
	}
	.bars span {
		height: 3px;
		border-radius: 2px;
		background: #60a5fa;
	}
	.bars span.warm {
		background: #fbbf24;
	}
	.bars span.full {
		background: #f87171;
	}
	.drivers {
		display: flex;
		gap: 4px;
	}
	.chip {
		padding: 0 6px;
		border-radius: 8px;
		font-size: 10px;
		line-height: 16px;
		color: #94a3b8;
		background: #1f2937;
	}
	.chip.ok {
		color: #86efac;
		background: #12301f;
	}
	.chip.bad {
		color: #fca5a5;
		background: #3b1d1d;
	}
	.pill-mark {
		font-size: 11px;
		padding: 1px 8px;
		border-radius: 9px;
		color: #fecaca;
		background: #7f1d1d;
	}
	.thumbs-toggle {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #94a3b8;
		cursor: pointer;
	}
	button {
		font-size: 12px;
		background: #1f2937;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 3px 10px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.chrome {
		font-size: 11px;
	}
</style>
