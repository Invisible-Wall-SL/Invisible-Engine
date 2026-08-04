<script lang="ts">
	import Emblem from '$lib/Emblem.svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import {
		BUTTON_STATE_PARAMS,
		ENGINE_ACTION_CATALOG,
		fontParamKeysOf,
		FREE_SPIN_COUNTER_DEF,
		HUD_READOUT_DEF,
		pruneOrphanParamBindings,
		resolveComponentParams,
		STANDARD_MAIN_SIZES_MAP,
	} from 'engine-layout';
	import type {
		ComponentCategory,
		ComponentDef,
		ComponentParam,
		ContainerNode,
		LayoutNode,
		LayoutType,
		Scene,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	// Reuse the editor's child components across routes (only `+page`/`+layout`/
	// `+server` are route-special in SvelteKit; these `.svelte`/`.ts` modules are
	// plain imports). `/editor` keeps owning them — this tool is the standalone
	// authoring slice that used to live as "component mode" inside the editor.
	import ComponentList from '../editor/ComponentList.svelte';
	import EditorAssetLibrary from '../editor/EditorAssetLibrary.svelte';
	import EditorCanvas from '../editor/EditorCanvas.svelte';
	import EditorElementsPalette from '../editor/EditorElementsPalette.svelte';
	import EditorOutline from '../editor/EditorOutline.svelte';
	import EditorProperties from '../editor/EditorProperties.svelte';
	import type { SpineMeta } from '../editor/spineRuntime.client';
	import PanelResizers from '../editor/PanelResizers.svelte';
	import PanelSection from '../editor/PanelSection.svelte';
	import { CATEGORIES } from '../editor/componentList.client';
	import { findById, genComponentId, removeNode } from '../editor/layoutTree.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Atlas/sheet manifests an `image`-kind param can pick frames from (region picker). */
	const pickSheets = $derived([
		...data.assets.atlases
			.filter((a) => a.kind === 'atlas-manifest')
			.map((a) => ({ key: a.key, name: a.name })),
		...data.assets.sheets.map((s) => ({ key: s.key, name: s.name })),
	]);

	/** Components the project can use (shared + project shadow). Mutable so a save
	 * reflects in the sidebar without a reload. */
	let components = $state<ComponentDef[]>(structuredClone(data.components));
	/** id → ETag its next save must match (`null` = built-in / never stored ⇒ create). Mutable
	 * so a save adopts the server's new etag without a reload (Phase 1 of
	 * `docs/design/multi-user-concurrency.md`). */
	let componentEtags = $state<Record<string, string | null>>({ ...data.componentEtags });
	/** The component currently open for editing, or null (sidebar-only home state). */
	let componentDraft = $state<ComponentDef | null>(null);
	/** Bumped on every properties-panel edit to force the shared `EditorCanvas` to
	 * repaint. The canvas redraw effects track a field whitelist + this nonce, never a
	 * deep node mutation — so without it a transform/anchor/param edit here would mutate
	 * the draft but never redraw (the Scene Editor bumps its own nonce the same way). */
	let editNonce = $state(0);
	/** Save state for the component POST (header pill). */
	let saveStatus = $state<{ kind: 'ok' | 'error'; message: string } | null>(null);
	/** Promote-to-shared spinner (a DIFFERENT global key than the draft's), unioned into `busy`. */
	let promoting = $state(false);

	/**
	 * Draft save-state machine (multi-user-concurrency Phase 2a). Manual save. `state.etag` is
	 * the open draft's precondition (the id→etag map `componentEtags` seeds it on open via
	 * `adoptEtag`; re-adopted from each save response). Conflict UX is DELIBERATELY bespoke — a
	 * versioned `confirm()` ("save as a NEW version on top of theirs") rather than a banner,
	 * since components are versioned and the other author's work survives as its own immutable
	 * snapshot; it's driven off `state.status`/`state.message`, not the shared badge. Create
	 * encoding stays caller-side (JSON `null`). Promote-to-shared is a separate operation (its
	 * own key + confirm), so it does NOT go through this instance — it would clobber the draft etag.
	 */
	const saveState = new SaveState({
		initialEtag: null,
		conflictMessage: 'Someone else saved this component while you were editing it.',
		save: async ({ baseEtag, force }) => {
			if (!componentDraft) return { ok: false, reason: 'error', message: 'No component open.' };
			const body = {
				...(componentDraft.scope === 'project'
					? { ...componentDraft, project: data.projectKey }
					: componentDraft),
				// A stored def CASes against `baseEtag`; a never-saved one sends `null` (create).
				...(force ? { force: true } : { baseEtag }),
			};
			const res = await fetch('/api/editor/component', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.status === 409) {
				const b = (await res.json().catch(() => ({}))) as { message?: string };
				return { ok: false, reason: 'conflict', message: b.message };
			}
			if (!res.ok) {
				let message = 'Component save failed';
				try {
					const b = (await res.json()) as { message?: string };
					if (b?.message) message = b.message;
				} catch {
					/* non-JSON error body */
				}
				return { ok: false, reason: 'error', message };
			}
			const out = (await res.json().catch(() => ({}))) as {
				version?: number;
				etag?: string | null;
			};
			// Adopt the SERVER's reconciled version — it may have bumped past the posted one.
			const saved = $state.snapshot(componentDraft) as ComponentDef;
			if (typeof out.version === 'number') {
				saved.version = out.version;
				componentDraft.version = out.version;
			}
			const newEtag = out.etag ?? null;
			componentEtags = { ...componentEtags, [saved.id]: newEtag };
			savedSnapshot = JSON.stringify(saved);
			const i = components.findIndex((c) => c.id === saved.id);
			if (i === -1) components = [...components, saved];
			else components = components.map((c) => (c.id === saved.id ? saved : c));
			// A save may bump the version + write a new snapshot — refresh the browser.
			void loadVersionList(saved);
			return { ok: true, etag: newEtag };
		},
	});
	/** Union of the draft-save and promote spinners — every shared `disabled`/pill uses it. */
	const busy = $derived(saveState.busy || promoting);

	/**
	 * Version browser (§8.9 v2). `versionList` = the retained `<id>.v<N>.json` snapshots
	 * + the latest version, fetched read-only when a component opens. `inspectingVersion`
	 * is the historical version currently loaded into the canvas for INSPECTION — when
	 * non-null the draft is the immutable snapshot of that version, Save/Promote/editing
	 * are blocked, and "Back to latest" reloads the editable latest. Browsing NEVER writes
	 * to R2: a historical version is read via `GET …&version=<N>`, shown, and discarded.
	 */
	let versionList = $state<{ versions: number[]; latest: number | undefined } | null>(null);
	let versionBusy = $state(false);
	let inspectingVersion = $state<number | null>(null);
	/** Open-version dropdown selection (the picker value); applied on "Inspect". */
	let pickVersion = $state<number | ''>('');

	/** True while a historical version is loaded read-only — gates editing + save. */
	const isInspecting = $derived(inspectingVersion !== null);

	/**
	 * The versions the browser dropdown offers, newest first: every retained snapshot
	 * plus the latest pointer's version (a pre-v2 def has no snapshots, so the latest is
	 * the only entry — shown so the author at least sees the current version). Deduped.
	 */
	const historyVersions = $derived.by<number[]>(() => {
		if (!versionList) return [];
		const set = new Set(versionList.versions);
		if (versionList.latest !== undefined) set.add(versionList.latest);
		return [...set].sort((a, b) => b - a);
	});

	/** Hoisted active selection — bound from the canvas, read by Properties.
	 * `selectedIds` is the source of truth (shift-click multi-select); `selectedId` is
	 * the primary (last-picked) id the Properties panel reads. */
	let selectedIds = $state<string[]>([]);
	const selectedId = $derived(selectedIds.at(-1) ?? null);
	/** Per-`assetKey` animation + skin lists for every loaded spine bundle, reported by
	 * the canvas's WebGL sublayers — lets the Properties panel offer dropdowns. */
	let spineMeta = $state<Map<string, SpineMeta>>(new Map());
	/** Components author in the fixed `desktop` design box — no per-layoutType
	 * override switcher here (a component is one design; the scene editor owns
	 * responsive overrides when the instance is placed). */
	const currentLayoutType: LayoutType = 'desktop';
	/** Left sidebar tab (when a component is open): the asset Library to drag from,
	 * or the Outline of the open component's tree. Properties always show on the
	 * right, so selecting a node never needs a tab switch. */
	let leftTab = $state<'library' | 'outline'>('outline');
	// Resizable sidebars — shared behaviour via <PanelResizers> (same as the
	// Scene Editor); widths persist under this tool's own key.
	let leftWidth = $state(280);
	let rightWidth = $state(320);
	let resizing = $state<'left' | 'right' | null>(null);

	/** id → def map, so the canvas resolves a nested `componentInstance` without the
	 * engine registry (the editor canvas is its own renderer). */
	const componentMap = $derived.by(() => {
		const m = new Map<string, ComponentDef>();
		for (const c of components) m.set(c.id, c);
		return m;
	});

	/** Synthetic scene wrapping the open draft's `root.children`, so the reused
	 * editor canvas/outline/properties machinery edits the sub-tree in place (the
	 * array IS `root.children`). The exact pattern from `/editor`'s component mode. */
	const componentScene = $derived.by<Scene | undefined>(() =>
		componentDraft
			? {
					id: 's_component',
					name: componentDraft.name,
					nodes: componentDraft.root.children,
					// Preview in the component's authoring space (default 'game' → mapped
					// through the project's MAIN box like the runtime; 'canvas' → full-window
					// overlay). This is what makes the Component Editor WYSIWYG with the game.
					space: componentDraft.space ?? 'game',
				}
			: undefined,
	);

	/** The preview FRAME is the standard window (its aspect comfortably contains the
	 * project's main box at `mainScale`) — same choice the Scene Editor makes. The
	 * game-space mapping below scales the project's real main box into this window. */
	const frameSize = $derived(STANDARD_MAIN_SIZES_MAP[currentLayoutType]);

	/** The project's real MAIN box (e.g. 1422×800 for Borut) — game-space component
	 * nodes are mapped through THIS box (exactly as `<MainContainer>` / the Scene
	 * Editor do), so placement matches the game instead of a neutral 1920×1080 box. */
	const projectMainSizes = $derived(data.mainSizesMap ?? STANDARD_MAIN_SIZES_MAP);

	/**
	 * Resolved params fed to the canvas preview (§13.4): just the def's own param
	 * defaults (`def.param.default`). No instance override here — the Component
	 * Editor edits the def itself; an instance's per-placement overrides are the
	 * scene editor's job. Reused, Svelte-free helper from `engine-layout`. Empty
	 * when no component is open.
	 */
	const resolvedParams = $derived<Record<string, unknown>>(
		componentDraft ? resolveComponentParams(componentDraft) : {},
	);

	/** Param keys of the draft that drive a FONT — so the Properties panel renders their
	 * default as a font dropdown (not free text). Covers bound `style.fontFamily` params
	 * and the engine's canonical `fontFamily` key. See `fontParamKeysOf`. */
	const fontParamKeys = $derived(fontParamKeysOf(componentDraft));

	const selectedNode = $derived(
		selectedId && componentScene ? findById(componentScene.nodes, selectedId) : null,
	);

	/** Open `def` for editing. `$state.snapshot` (NOT `structuredClone`): `def` may be
	 * a reactive proxy (a `components` list entry), which `structuredClone` rejects
	 * with DataCloneError — snapshot returns a plain, detached deep copy. */
	function openComponent(def: ComponentDef): void {
		componentDraft = $state.snapshot(def) as ComponentDef;
		// The save precondition for this def's scope key. An entry absent from the map (a
		// never-saved draft, or a built-in with no stored object) ⇒ `null` ⇒ the first save
		// creates. A stored def carries the etag it was listed at, so a save CASes against it.
		saveState.adoptEtag(componentEtags[def.id] ?? null);
		// Baseline for the unsaved-changes guard. A NEWLY CREATED component is
		// deliberately dirty from the start (`null` baseline): it exists ONLY as this
		// draft until "Save component", so leaving without saving must warn.
		savedSnapshot = components.some((c) => c.id === def.id)
			? JSON.stringify($state.snapshot(componentDraft))
			: null;
		selectedIds = [];
		saveStatus = null;
		leftTab = 'outline';
		// Reset + (re)load the version history for the newly opened component. A
		// never-saved draft (no stored def) has no history; skip the fetch.
		inspectingVersion = null;
		pickVersion = '';
		versionList = null;
		if (components.some((c) => c.id === def.id)) void loadVersionList(def);
	}

	/**
	 * Fetch the retained version history for `def` (read-only, §8.9 v2). Populates
	 * `versionList` so the top-bar browser can list every `<id>.v<N>.json` snapshot and
	 * mark the latest. Never mutates anything; a failure just leaves the browser empty.
	 */
	async function loadVersionList(def: ComponentDef): Promise<void> {
		versionBusy = true;
		try {
			const params = new URLSearchParams({ id: def.id, list: 'versions', scope: def.scope });
			if (def.scope === 'project') params.set('project', data.projectKey);
			const res = await fetch(`/api/editor/component?${params.toString()}`);
			if (!res.ok) {
				versionList = null;
				return;
			}
			versionList = (await res.json()) as { versions: number[]; latest: number | undefined };
		} catch {
			versionList = null;
		} finally {
			versionBusy = false;
		}
	}

	/**
	 * Load a historical version of the open component into the canvas for INSPECTION
	 * (§8.9 v2 version browser). Non-destructive: it GETs the immutable `<id>.v<N>.json`
	 * snapshot, swaps it into `componentDraft` read-only, and sets `inspectingVersion`
	 * so Save/Promote/editing are blocked and a banner shows. It does NOT overwrite the
	 * stored latest and does NOT become the next save — "Back to latest" restores the
	 * editable current def. A prior unsaved edit is confirmed away first (returning to
	 * latest after inspecting reloads the stored latest, so the edit would be lost).
	 */
	async function inspectVersion(version: number): Promise<void> {
		if (!componentDraft || versionBusy) return;
		// Only warn about losing edits when we're leaving an EDITABLE (latest) draft with
		// unsaved changes — inspecting one snapshot then another discards nothing of value.
		if (
			!isInspecting &&
			draftDirty &&
			!window.confirm(
				'Inspecting an older version replaces the canvas with that read-only snapshot — ' +
					'your unsaved edits to the current version will be lost. Continue?',
			)
		) {
			return;
		}
		versionBusy = true;
		saveStatus = null;
		try {
			const params = new URLSearchParams({ id: componentDraft.id, version: String(version) });
			if (componentDraft.scope === 'project') params.set('project', data.projectKey);
			const res = await fetch(`/api/editor/component?${params.toString()}`);
			if (!res.ok) {
				saveStatus = { kind: 'error', message: `Version ${version} not available` };
				return;
			}
			const def = (await res.json()) as ComponentDef;
			componentDraft = def;
			inspectingVersion = version;
			selectedIds = [];
			// Baseline = this snapshot, so the read-only draft never reads as "dirty".
			savedSnapshot = JSON.stringify(def);
		} catch (e) {
			saveStatus = {
				kind: 'error',
				message: e instanceof Error ? e.message : `Failed to load version ${version}`,
			};
		} finally {
			versionBusy = false;
		}
	}

	/**
	 * Leave inspection: reload the EDITABLE latest def from the local list (the source of
	 * truth the sidebar holds) back into the canvas. Purely a UI restore — nothing was
	 * written while inspecting, so there is nothing to undo.
	 */
	function backToLatest(): void {
		if (!componentDraft) return;
		const latest = components.find((c) => c.id === componentDraft?.id);
		if (!latest) {
			inspectingVersion = null;
			return;
		}
		componentDraft = $state.snapshot(latest) as ComponentDef;
		// Restore the editable latest's precondition — inspecting a snapshot never changed it.
		saveState.adoptEtag(componentEtags[latest.id] ?? null);
		savedSnapshot = JSON.stringify($state.snapshot(componentDraft));
		inspectingVersion = null;
		pickVersion = '';
		selectedIds = [];
		saveStatus = null;
	}

	/** JSON of the draft as last saved/opened — `null` = never persisted. */
	let savedSnapshot = $state<string | null>(null);
	/** True when the open draft has edits (or was never saved at all). */
	const draftDirty = $derived(
		componentDraft !== null && JSON.stringify($state.snapshot(componentDraft)) !== savedSnapshot,
	);
	// An unsaved draft is ONLY in memory — warn before a full-page navigation
	// ("← Editor" is a reload link) or a tab close discards it silently.
	$effect(() => {
		if (!draftDirty) return;
		const warn = (e: BeforeUnloadEvent) => {
			e.preventDefault();
		};
		window.addEventListener('beforeunload', warn);
		return () => window.removeEventListener('beforeunload', warn);
	});

	let newName = $state('');
	let newCategory = $state<ComponentCategory>('overlay');
	/** What the new component starts as: a blank shell, or a from-scratch BUTTON —
	 * same blank root (the author drops their own art), but pre-declared with the
	 * `action` param. That single param is the whole button contract: a placed
	 * instance picks its action from the registered-action dropdown, and the engine
	 * provides the hit surface for an action-bound def with no coded part (§18.4) —
	 * the authored art becomes clickable with zero extra wiring. */
	let newType = $state<'blank' | 'button' | 'readout' | 'counter'>('blank');

	/**
	 * Create a component + open it. `blank` = empty root; `button` = empty root pre-wired
	 * with the `action` param; `readout` = empty root pre-wired with the value-feed
	 * CONTRACT only — the `source` selector, the engine-fed `value`, and the `countUp`
	 * toggle. The engine feeds ANY component carrying a `source`+`value` pair (it keys on
	 * the source NAME, not the component id), so the author just drops their own art + text
	 * on the empty root and binds a text node's `text` to `value`. No coded parts to delete.
	 */
	function createComponent(): void {
		const name = newName.trim();
		if (!name) return;
		let def: ComponentDef;
		if (newType === 'readout') {
			// Reuse the built-in's exact `source` (with its options) + engine `value` +
			// `countUp` params; drop the coded-part style params (the author styles their
			// own text) and ship an empty root.
			const keep = new Set(['source', 'value', 'countUp']);
			const params = (structuredClone(HUD_READOUT_DEF).params ?? []).filter((p) => keep.has(p.key));
			const root: ContainerNode = {
				id: genComponentId() + '_root',
				kind: 'container',
				x: 0,
				y: 0,
				children: [],
			};
			def = {
				id: genComponentId(),
				name,
				version: 1,
				scope: 'project',
				category: 'ui',
				root,
				params,
			};
		} else if (newType === 'counter') {
			// Project-scoped clone of the built-in Free-Spin Counter: the full frame +
			// "FREE SPIN" caption + "X OF Y" value structure, pre-wired with `source`
			// (the engine value feed) + the engine-fed string `value` + `visibleSource` +
			// `label` + font/fill params, so the author only swaps the art + text. Fresh
			// node ids so two copies never collide.
			const clone = structuredClone(FREE_SPIN_COUNTER_DEF);
			const root = clone.root;
			const reid = (n: LayoutNode): void => {
				n.id = genComponentId();
				if (n.kind === 'container') n.children.forEach(reid);
			};
			root.children.forEach(reid);
			root.id = genComponentId() + '_root';
			def = {
				id: genComponentId(),
				name,
				version: 1,
				scope: 'project',
				category: 'ui',
				root,
				params: clone.params,
			};
		} else {
			const root: ContainerNode = {
				id: genComponentId() + '_root',
				kind: 'container',
				x: 0,
				y: 0,
				children: [],
			};
			def = {
				id: genComponentId(),
				name,
				version: 1,
				scope: 'project',
				category: newType === 'button' ? 'ui' : newCategory,
				root,
			};
			if (newType === 'button') {
				def.params = [{ key: 'action', kind: 'string', options: ENGINE_ACTION_CATALOG }];
			}
		}
		openComponent(def);
		newName = '';
	}

	/** Close the open component, back to the sidebar home. Confirms first when the
	 * draft has unsaved edits (a never-saved component would vanish entirely). */
	function closeComponent(): void {
		if (
			draftDirty &&
			!window.confirm(
				savedSnapshot === null
					? 'This component has never been saved — closing discards it entirely. Close anyway?'
					: 'Discard the unsaved changes to this component?',
			)
		) {
			return;
		}
		componentDraft = null;
		savedSnapshot = null;
		selectedIds = [];
		saveStatus = null;
		inspectingVersion = null;
		pickVersion = '';
		versionList = null;
	}

	/** Delete a component from R2 + the local list (with a confirm). Stops the row's
	 * open-on-click from also firing. Closes the draft if the deleted one was open. */
	async function deleteComponentDef(e: MouseEvent, def: ComponentDef): Promise<void> {
		e.stopPropagation();
		if (!window.confirm(`Delete component "${def.name}"? This cannot be undone.`)) return;
		const params = new URLSearchParams({ id: def.id, scope: def.scope });
		if (def.scope === 'project') params.set('project', data.projectKey);
		const res = await fetch(`/api/editor/component?${params.toString()}`, { method: 'DELETE' });
		if (!res.ok) return;
		components = components.filter((c) => c.id !== def.id);
		if (componentDraft?.id === def.id) closeComponent();
	}

	/** Spawn a node into the open draft's `root.children` (the array the synthetic
	 * scene exposes). The component has its own save — no autosave here. Blocked while
	 * inspecting a historical version (read-only). */
	function onSpawn(node: LayoutNode): void {
		if (!componentDraft || isInspecting) return;
		componentDraft.root.children = [...componentDraft.root.children, node];
	}

	function onDeleteNode(id: string): void {
		if (!componentDraft || isInspecting) return;
		const nodes = componentDraft.root.children.slice();
		if (!removeNode(nodes, id)) return;
		componentDraft.root.children = nodes;
		if (selectedIds.includes(id)) selectedIds = selectedIds.filter((x) => x !== id);
	}

	/** Set a node's outline `label` (or clear it to fall back to the node id). Walks
	 * the open draft's tree to find the node; mutates in place (reactive proxy). */
	function renameNode(id: string, label: string): void {
		if (!componentDraft) return;
		const walk = (nodes: LayoutNode[]): boolean => {
			for (const n of nodes) {
				if (n.id === id) {
					if (label) n.label = label;
					else delete n.label;
					return true;
				}
				if (n.kind === 'container' && walk(n.children)) return true;
			}
			return false;
		};
		walk(componentDraft.root.children);
	}

	/**
	 * Save the open draft via POST (§8.3); refresh the local list on success.
	 *
	 * `force` retries after a conflict. This is NOT destructive the way the other tools'
	 * "overwrite" is: components are VERSIONED, so re-saving on top of the other author's
	 * v(N+1) lands as v(N+2) and theirs survives as its own immutable snapshot. Be precise
	 * about what that buys, though — the LATEST pointer is what the canvas, the picker and
	 * `loadComponent` all resolve, so their work is RECOVERABLE (via the version browser,
	 * by a human who knows to look), not un-lost. Hence "stack on top", not "overwrite".
	 */
	async function saveComponent(force = false): Promise<void> {
		// Inspecting a historical version is read-only — a save here would re-pin/overwrite
		// the latest with an old snapshot, defeating the non-destructive guarantee.
		if (!componentDraft || busy || isInspecting) return;
		saveStatus = null;
		const ok = await saveState.save({ force });
		if (ok) {
			saveStatus = { kind: 'ok', message: 'Component saved' };
			return;
		}
		if (!force && saveState.status === 'conflict') {
			// Non-destructive: components are VERSIONED, so re-saving on top lands as v(N+2) and
			// theirs survives as its own immutable snapshot. Offer the stack-on-top choice.
			const msg = saveState.message;
			saveStatus = { kind: 'error', message: msg };
			if (confirm(`${msg}\n\nSave yours as a NEW version on top of theirs?`)) {
				await saveComponent(true);
			}
			return;
		}
		saveStatus = { kind: 'error', message: saveState.message || 'Component save failed' };
	}

	/**
	 * Promote the open draft to the SHARED library (`_shared/editor-components/<id>.json`,
	 * §8.3): POST with `scope:'shared'` and NO `project` key. Gated in the UI on
	 * `data.canPublishShared` (the `componentPublish` capability) — the API enforces the
	 * same capability server-side. The local draft stays `scope:'project'`: the saved
	 * shared copy is a SNAPSHOT, and a project component of the same id still shadows it
	 * everywhere it loads, so we keep editing/saving the project copy here (the confirm
	 * spells this out). Reuses the same status pill as a project save.
	 */
	async function promoteToShared(): Promise<void> {
		if (!componentDraft || busy || !data.canPublishShared || isInspecting) return;
		if (
			!window.confirm(
				`Promote "${componentDraft.name}" to the SHARED library?\n\n` +
					'This writes a repo-wide copy every project inherits. The project component ' +
					'of the same id still SHADOWS the shared one wherever it exists — promoting ' +
					'does not move or delete your project copy.',
			)
		) {
			return;
		}
		promoting = true;
		saveStatus = null;
		try {
			// A shared write carries no `project` and a `scope:'shared'` def, so the API
			// routes it to `_shared/editor-components/` behind the `componentPublish` gate.
			const body = { ...$state.snapshot(componentDraft), scope: 'shared' };
			// Resolve the SHARED key's current etag (this project draft never loaded it) so the
			// promote CASes against the global key rather than writing unconditionally. `id` with
			// no `project`/`version` returns `{ def, etag }` for the shared/built-in layer; a 404
			// (or built-in `etag: null`) ⇒ `null` ⇒ create (`ifNoneMatch: '*'`).
			let sharedBaseEtag: string | null = null;
			try {
				const g = await fetch(`/api/editor/component?id=${encodeURIComponent(componentDraft.id)}`);
				if (g.ok) {
					const gd = (await g.json()) as { etag?: string | null };
					sharedBaseEtag = gd.etag ?? null;
				}
			} catch {
				// Leave `null` (create); a genuine collision still surfaces as a 409 below.
			}
			const post = (extra: Record<string, unknown> = { baseEtag: sharedBaseEtag }) =>
				fetch('/api/editor/component', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...body, ...extra }),
				});
			let res = await post();
			if (res.status === 409) {
				// This is the GLOBAL `_shared/` key — no project lease could ever cover it, so
				// this refusal is the only thing standing between two authors. Offer the same
				// stack-on-top choice the normal save does, rather than dead-ending.
				const b = (await res.json().catch(() => ({}))) as { message?: string };
				const msg = b.message ?? 'Someone else changed this shared component.';
				saveStatus = { kind: 'error', message: msg };
				if (!confirm(`${msg}\n\nPromote yours as a NEW version on top of theirs?`)) return;
				res = await post({ force: true });
			}
			if (res.ok) {
				saveStatus = { kind: 'ok', message: 'Promoted to shared library' };
			} else {
				let message = 'Promote to shared failed';
				try {
					const b = (await res.json()) as { message?: string };
					if (b?.message) message = b.message;
				} catch {
					/* non-JSON error body */
				}
				saveStatus = { kind: 'error', message };
			}
		} catch (e) {
			saveStatus = {
				kind: 'error',
				message: e instanceof Error ? e.message : 'Promote to shared failed',
			};
		} finally {
			promoting = false;
		}
	}

	/** Toggle the component PARAM identified by a catalog entry on the draft. */
	function toggleComponentParam(key: string, kind: ComponentParam['kind']): void {
		if (!componentDraft) return;
		const params = componentDraft.params ?? [];
		const has = params.some((p) => p.key === key);
		componentDraft.params = has
			? params.filter((p) => p.key !== key)
			: [...params, { key, kind, engineProvided: true }];
		if (componentDraft.params.length === 0) delete componentDraft.params;
	}

	/** Toggle a button STATE-IMAGE param (the "Show button params" picker) — adds/removes
	 * the full `BUTTON_STATE_PARAMS` entry (kind/group/label/author) so the runtime state
	 * cascade and the region pickers wire up exactly like the built-in button. Removing
	 * prunes any node binding that pointed at it. */
	function toggleButtonStateParam(key: string): void {
		if (!componentDraft) return;
		const params = componentDraft.params ?? [];
		if (params.some((p) => p.key === key)) {
			componentDraft.params = params.filter((p) => p.key !== key);
			if (componentDraft.params.length === 0) delete componentDraft.params;
			pruneOrphanParamBindings(componentDraft);
			return;
		}
		const def = BUTTON_STATE_PARAMS.find((p) => p.key === key);
		if (!def) return;
		componentDraft.params = [...params, { ...def }];
	}

	/** Declare a custom (author-defined) PARAM on the draft — bindable per instance.
	 * No `engineProvided` flag, so it shows in the Defaults panel + every instance's
	 * override panel. Deduped by key. */
	function addCustomParam(key: string, kind: ComponentParam['kind']): void {
		if (!componentDraft) return;
		const k = key.trim();
		if (!k) return;
		// Reserve the button STATE-IMAGE keys — they're owned by the "Show button params"
		// picker, so a hand-typed `image`/`imageHover`/… can't shadow or be clobbered by it.
		if (BUTTON_STATE_PARAMS.some((p) => p.key === k)) return;
		const params = componentDraft.params ?? [];
		if (params.some((p) => p.key === k)) return;
		componentDraft.params = [...params, { key: k, kind, author: true }];
	}

	/** Remove a declared PARAM from the draft by key — and any node bindings that
	 * pointed at it, so we never leave an orphan binding behind (the bound field reverts
	 * to its own static value). */
	function removeComponentParam(key: string): void {
		if (!componentDraft?.params) return;
		componentDraft.params = componentDraft.params.filter((p) => p.key !== key);
		if (componentDraft.params.length === 0) delete componentDraft.params;
		pruneOrphanParamBindings(componentDraft);
	}

	/** Set (or clear) a param's DEFAULT — the value the preview + every placed instance
	 * use until overridden. Reassigns `params` so the preview's `resolveComponentParams`
	 * re-derives. */
	function setParamDefault(key: string, value: unknown): void {
		if (!componentDraft?.params) return;
		componentDraft.params = componentDraft.params.map((p) =>
			p.key === key ? (value === undefined ? omitDefault(p) : { ...p, default: value }) : p,
		);
	}
	/** A param with its `default` cleared. */
	function omitDefault(p: ComponentParam): ComponentParam {
		const next = { ...p };
		delete next.default;
		return next;
	}

	/** Set (or clear) a custom `string` param's closed enum — a placed instance then renders
	 * it as a dropdown of these options (the `paramField` options branch). An empty list
	 * drops the field so the param reverts to free text (kept sparse). */
	function setParamOptions(key: string, options: string[]): void {
		if (!componentDraft?.params) return;
		componentDraft.params = componentDraft.params.map((p) => {
			if (p.key !== key) return p;
			if (options.length === 0) {
				const next = { ...p };
				delete next.options;
				return next;
			}
			return { ...p, options };
		});
	}

	/** "Expose as params" for a text node: create grouped author params for its
	 * text / font / size / colour and bind the node's fields to them, so every placed
	 * instance can edit this text. Keys are namespaced (group slug + field) to stay
	 * globally unique; the editor shows them as plain fields under a collapsible group
	 * titled with the node's name. Idempotent — skips a field that's already bound. */
	/**
	 * Expose a text node's content/font/size/colour as per-instance params, GROUPED
	 * under the node's name. Re-runnable: if the node was already exposed (then
	 * renamed), clicking again re-groups its existing params under the current node
	 * name — so two distinct text nodes never share one "Text" group (which would
	 * merge them into a single section in the instance properties). Only the param
	 * `group`/`label` are re-synced, never the `key` — a key rename would orphan the
	 * per-instance overrides scenes store by key.
	 */
	/** Map each param key → the set of node ids that bind it anywhere in the tree, so
	 * expose can tell a node's OWN params (bound only by it) from ones it merely shares
	 * because the node was duplicated/copied off another (which carried the bindings). */
	function bindingOwners(root: LayoutNode): Map<string, Set<string>> {
		const map = new Map<string, Set<string>>();
		const walk = (n: LayoutNode): void => {
			if (n.paramBindings) {
				for (const key of Object.values(n.paramBindings)) {
					let set = map.get(key);
					if (!set) {
						set = new Set();
						map.set(key, set);
					}
					set.add(n.id);
				}
			}
			if (n.kind === 'container') for (const c of n.children) walk(c);
		};
		walk(root);
		return map;
	}

	function exposeTextParams(node: LayoutNode): void {
		if (!componentDraft || node.kind !== 'text') return;
		const params = componentDraft.params ?? [];
		// A param is THIS node's own only if it's bound solely by this node — a binding
		// shared with another node (a duplicated text node carries the original's
		// bindings) must NOT be re-grouped/stolen; this node gets its own fresh param.
		const owners = bindingOwners(componentDraft.root);
		const ownedByThis = (key: string): boolean => {
			const set = owners.get(key);
			return !!set && set.size === 1 && set.has(node.id);
		};
		// Each text node gets a DISTINCT group, even when two nodes share the label
		// ("Text"): if the base group is already used by params this node doesn't own,
		// suffix it ("Text 2") so the instance editor keeps them in separate sections.
		const baseGroup = node.label?.trim() || 'Text';
		const otherGroups = new Set(
			params.filter((p) => p.group && !ownedByThis(p.key)).map((p) => p.group),
		);
		let group = baseGroup;
		for (let i = 2; otherGroups.has(group); i++) group = `${baseGroup} ${i}`;
		const slug = group.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'text';
		const keys = new Set(params.map((p) => p.key));
		const uniqueKey = (base: string): string => {
			let k = base;
			let i = 2;
			while (keys.has(k)) k = `${base}${i++}`;
			keys.add(k);
			return k;
		};
		const bindings: Record<string, string> = { ...(node.paramBindings ?? {}) };
		const added: ComponentParam[] = [];
		let changed = false;
		const expose = (
			fieldPath: string,
			suffix: string,
			kind: ComponentParam['kind'],
			label: string,
			def: unknown,
		): void => {
			const existingKey = bindings[fieldPath];
			if (existingKey && ownedByThis(existingKey)) {
				// Genuinely this node's own param — re-group/re-label it under the current node
				// name (handles a node renamed after its first expose). Key stays put. Skip
				// engine-provided binds (e.g. a value node bound to `value`): those aren't
				// author params and don't belong in a node group.
				const existing = params.find((p) => p.key === existingKey);
				if (
					existing &&
					!existing.engineProvided &&
					(existing.group !== group || existing.label !== label)
				) {
					existing.group = group;
					existing.label = label;
					changed = true;
				}
				return;
			}
			// Unbound, OR bound to a param shared with another node (copied) — give THIS
			// node its own fresh param and rebind the field to it, so the two stay separate.
			const key = uniqueKey(slug + suffix);
			const p: ComponentParam = { key, kind, group, label, author: true };
			if (def !== undefined) p.default = def;
			added.push(p);
			bindings[fieldPath] = key;
			changed = true;
		};
		expose('text', 'Text', 'string', 'text', node.text);
		expose('style.fontFamily', 'Font', 'string', 'font', node.style?.fontFamily);
		expose('style.fontSize', 'Size', 'number', 'size', node.style?.fontSize);
		expose('style.fill', 'Colour', 'color', 'colour', node.style?.fill);
		if (!changed) return;
		node.paramBindings = bindings;
		componentDraft.params = [...params, ...added];
	}

	/**
	 * Un-expose a text node: drop its AUTHOR-param bindings + the params they created,
	 * restoring each field's static value from the removed param's default. Engine/other
	 * binds (e.g. a value node's `text` → `value`) are left untouched. The inverse of
	 * {@link exposeTextParams}.
	 */
	function unexposeTextParams(node: LayoutNode): void {
		if (!componentDraft || node.kind !== 'text' || !node.paramBindings) return;
		const params = componentDraft.params ?? [];
		const byKey = new Map(params.map((p) => [p.key, p]));
		const bindings: Record<string, string> = { ...node.paramBindings };
		const removed = new Set<string>();
		const unbind = (field: string): ComponentParam | undefined => {
			const key = bindings[field];
			if (!key) return undefined;
			const p = byKey.get(key);
			if (!p?.author) return undefined; // leave engine/other binds (e.g. text → value)
			delete bindings[field];
			removed.add(key);
			return p;
		};
		const textParam = unbind('text');
		const fontParam = unbind('style.fontFamily');
		const sizeParam = unbind('style.fontSize');
		const fillParam = unbind('style.fill');
		if (removed.size === 0) return;
		if (textParam && typeof textParam.default === 'string') node.text = textParam.default;
		const style = { ...(node.style ?? {}) };
		if (fontParam && typeof fontParam.default === 'string') style.fontFamily = fontParam.default;
		if (sizeParam && typeof sizeParam.default === 'number') style.fontSize = sizeParam.default;
		if (fillParam && typeof fillParam.default === 'number') style.fill = fillParam.default;
		node.style = style;
		node.paramBindings = Object.keys(bindings).length ? bindings : undefined;
		componentDraft.params = params.filter((p) => !removed.has(p.key));
		if (componentDraft.params.length === 0) delete componentDraft.params;
	}

	/**
	 * "Expose spine as param" for a spine node: create ONE `spine`-kind author param and
	 * bind the node's SOURCE bundle (`assetKey`) to it, so every placed instance can swap
	 * this spine's rig from a bundle picker — the spine analogue of {@link exposeTextParams}.
	 * The default is the spine's current bundle NAME (what the instance picker stores + the
	 * runtime resolves), so an un-overridden instance renders exactly what the def shows.
	 * Idempotent — a spine already exposing its own param is left alone.
	 */
	function exposeSpineParam(node: LayoutNode): void {
		if (!componentDraft || node.kind !== 'spine') return;
		const params = componentDraft.params ?? [];
		// A param is THIS node's own only if bound solely by it — a binding shared with
		// another node (a duplicated spine carries the original's bindings) must not be stolen.
		const owners = bindingOwners(componentDraft.root);
		const ownedByThis = (key: string): boolean => {
			const set = owners.get(key);
			return !!set && set.size === 1 && set.has(node.id);
		};
		const existingKey = node.paramBindings?.['assetKey'];
		if (
			existingKey &&
			ownedByThis(existingKey) &&
			params.some((p) => p.key === existingKey && p.author)
		) {
			return; // already exposed to its own param
		}
		const label = node.label?.trim() || 'spine';
		const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '') || 'spine';
		const keys = new Set(params.map((p) => p.key));
		let key = `${slug}Spine`;
		for (let i = 2; keys.has(key); i++) key = `${slug}Spine${i}`;
		// Default = the current bundle NAME, matched by the node's assetKey against the
		// project spine list (the same `name` the instance picker + runtime key off).
		const defaultName = data.assets.spines.find((s) => s.key === node.assetKey)?.name;
		const p: ComponentParam = { key, kind: 'spine', label, author: true };
		if (defaultName) p.default = defaultName;
		node.paramBindings = { ...(node.paramBindings ?? {}), assetKey: key };
		componentDraft.params = [...params, p];
	}

	/**
	 * Un-expose a spine node: drop its `assetKey` binding + the author param it created,
	 * restoring the static bundle from the removed param's default. Leaves engine/other
	 * binds untouched. The inverse of {@link exposeSpineParam}.
	 */
	function unexposeSpineParam(node: LayoutNode): void {
		if (!componentDraft || node.kind !== 'spine' || !node.paramBindings) return;
		const params = componentDraft.params ?? [];
		const key = node.paramBindings['assetKey'];
		const p = params.find((cp) => cp.key === key);
		if (!key || !p?.author) return; // not an author-exposed spine bind
		const bindings = { ...node.paramBindings };
		delete bindings['assetKey'];
		// Restore the static bundle from the param default, resolving the bundle NAME back
		// to its full key so the fixed spine renders exactly as before exposure.
		if (typeof p.default === 'string' && p.default) {
			const restored = data.assets.spines.find((s) => s.name === p.default)?.key;
			if (restored) node.assetKey = restored;
		}
		node.paramBindings = Object.keys(bindings).length ? bindings : undefined;
		componentDraft.params = params.filter((cp) => cp.key !== key);
		if (componentDraft.params.length === 0) delete componentDraft.params;
	}

	/** Toggle the component SIGNAL identified by a catalog entry on the draft. */
	function toggleComponentSignal(key: string): void {
		if (!componentDraft) return;
		const signals = componentDraft.signals ?? [];
		const has = signals.some((s) => s.key === key);
		componentDraft.signals = has ? signals.filter((s) => s.key !== key) : [...signals, { key }];
		if (componentDraft.signals.length === 0) delete componentDraft.signals;
	}

	/** Set the component's authoring/preview SPACE. 'game' is the default → store it
	 * as absent (cleaner doc); 'canvas' marks a full-window overlay. Changes the
	 * preview frame immediately and is persisted on the next Save. */
	function setComponentSpace(space: 'game' | 'canvas'): void {
		if (!componentDraft) return;
		if (space === 'canvas') componentDraft.space = 'canvas';
		else delete componentDraft.space;
	}

	/** Drag payload for a palette ELEMENT (Text/Container/Rect) — the canvas spawns
	 * the matching kind. Same wire format as a Library asset drag. */
	function onElementDragStart(
		e: DragEvent,
		payload: { kind: string; key: string; name: string },
	): void {
		if (!e.dataTransfer) return;
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	// Deep-link: `/components?id=<id>` opens that component once the list is loaded.
	onMount(() => {
		if (!data.openId) return;
		const def = components.find((c) => c.id === data.openId);
		if (def) openComponent(def);
	});
</script>

<div class="shell">
	<ToolTopBar
		current="componentEditor"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			<span class="subtitle">Project: <strong>{data.clientKey}/{data.projectKey}</strong></span>
			{#if componentDraft}
				<span class="save-pill" title="The component currently open for editing">
					◇ {componentDraft.name}
				</span>
				<label
					class="space-toggle"
					title="Game = positioned in the game's main box (board-relative; WYSIWYG against this project's layout). Canvas = a full-window overlay (free-spin intro dim, modal scrim) authored in raw window pixels. A Canvas component must be mounted in a Canvas-space screen for editor↔game parity."
				>
					Space
					<select
						value={componentDraft.space ?? 'game'}
						disabled={isInspecting}
						onchange={(e) =>
							setComponentSpace(e.currentTarget.value === 'canvas' ? 'canvas' : 'game')}
					>
						<option value="game">Game (main box)</option>
						<option value="canvas">Canvas (full-window overlay)</option>
					</select>
				</label>
				{#if isInspecting}
					<span
						class="save-pill inspecting"
						title="A read-only historical snapshot is loaded. It does NOT overwrite the saved latest and cannot be saved — return to latest to edit."
					>
						◷ Inspecting v{inspectingVersion} (read-only)
					</span>
					<button class="save-btn" type="button" onclick={backToLatest}>← Back to latest</button>
				{:else if versionList && (versionList.versions.length > 0 || versionList.latest !== undefined)}
					<label
						class="space-toggle"
						title="Browse this component's saved version history. Loading an older version shows it READ-ONLY on the canvas — it never overwrites the saved latest and never becomes the next save (§8.9)."
					>
						Version
						<select bind:value={pickVersion} disabled={versionBusy} aria-label="Version history">
							<option value="">history…</option>
							{#each historyVersions as v (v)}
								<option value={v}>
									v{v}{v === versionList.latest ? ' (latest)' : ''}
								</option>
							{/each}
						</select>
					</label>
					<button
						class="save-btn"
						type="button"
						disabled={versionBusy || pickVersion === '' || pickVersion === versionList.latest}
						title="Load the selected version read-only into the canvas to inspect it"
						onclick={() => {
							if (typeof pickVersion === 'number') void inspectVersion(pickVersion);
						}}
					>
						Inspect
					</button>
				{/if}
				{#if busy}
					<span class="save-pill busy">Saving…</span>
				{:else if saveStatus?.kind === 'error'}
					<span class="save-pill error" title={saveStatus.message}>Save failed</span>
				{:else if saveStatus?.kind === 'ok'}
					<span class="save-pill ok">{saveStatus.message}</span>
				{/if}
				<button
					class="save-btn primary"
					type="button"
					disabled={isInspecting}
					title={isInspecting
						? 'Read-only — return to latest to edit and save.'
						: 'Save this component'}
					onclick={() => void saveComponent()}
				>
					Save component
				</button>
				{#if data.canPublishShared}
					<button
						class="save-btn"
						type="button"
						disabled={busy || isInspecting}
						title="Save a repo-wide copy to the shared library (_shared/editor-components). A project component of the same id still shadows it."
						onclick={() => void promoteToShared()}
					>
						Promote to shared
					</button>
				{/if}
				<button class="save-btn" type="button" onclick={closeComponent}>← All components</button>
			{:else}
				<span class="counter">
					{components.length}
					{components.length === 1 ? 'component' : 'components'}
				</span>
			{/if}
		{/snippet}
	</ToolTopBar>

	<div
		class="layout"
		class:resizing={resizing !== null}
		style="grid-template-columns: {leftWidth}px 1fr {rightWidth}px"
	>
		<aside class="left">
			{#if !componentDraft}
				<div class="panel-head">
					<h2 class="panel-title">Components</h2>
				</div>

				<div class="tab-body">
					<PanelSection id="cmp-create" title="New component">
						<div class="create">
							<div class="create-row">
								<input
									type="text"
									placeholder="Component name…"
									bind:value={newName}
									onkeydown={(e) => {
										if (e.key === 'Enter') createComponent();
									}}
								/>
							</div>
							<div class="create-row">
								<select
									bind:value={newType}
									aria-label="Component type"
									title="Button = pre-wired clickable component: drop your art, then pick the Action on each placed instance"
								>
									<option value="blank">Blank</option>
									<option value="button">Button</option>
									<option value="readout">HUD readout</option>
									<option value="counter">Free-Spin Counter</option>
								</select>
								{#if newType === 'blank'}
									<select bind:value={newCategory} aria-label="Component category">
										{#each CATEGORIES as c (c.id)}
											<option value={c.id}>{c.label}</option>
										{/each}
									</select>
								{/if}
								<button
									type="button"
									class="create-btn"
									disabled={!newName.trim()}
									onclick={createComponent}
								>
									Create
								</button>
							</div>
							{#if newType === 'button'}
								<p class="muted small">
									Drop your art (atlas regions, text) on the canvas — the whole component becomes
									the click area. Pick the <strong>Action</strong> (spin, menu, turbo…) on each
									placed instance in the scene editor. Click <strong>Save component</strong> when
									done — it is listed under
									<strong>UI</strong>.
								</p>
							{:else if newType === 'readout'}
								<p class="muted small">
									Empty, but pre-wired as a value readout: declares <strong>source</strong> (balance
									/ win / bet…) + the engine-fed <strong>value</strong>. Drop your own background +
									text on the canvas, then on the text that shows the number set
									<strong>Bind to param → Text ← value</strong>. Pick the <strong>source</strong> on
									each placed instance. Listed under <strong>UI</strong>.
								</p>
							{:else if newType === 'counter'}
								<p class="muted small">
									A project copy of the built-in <strong>Free-Spin Counter</strong>: frame +
									<strong>FREE SPIN</strong> caption + <strong>X OF Y</strong> value, already wired
									to the engine (<strong>source</strong> feed → <strong>value</strong>,
									<strong>visibleSource</strong> show/hide). Swap the frame art, restyle the text,
									or edit the <strong>label</strong> — then <strong>Save component</strong>. Listed
									under
									<strong>UI</strong>.
								</p>
							{/if}
						</div>
					</PanelSection>

					<PanelSection id="cmp-library" title="Library" count={components.length}>
						{#if components.length === 0}
							<p class="muted">No components yet. Create one above to start authoring.</p>
						{:else}
							<ComponentList {components} onRowClick={openComponent}>
								{#snippet actions(def)}
									<button
										type="button"
										class="cmp-del"
										title={`Delete component "${def.name}"`}
										aria-label={`Delete component "${def.name}"`}
										onclick={(e) => void deleteComponentDef(e, def)}
									>
										✕
									</button>
								{/snippet}
							</ComponentList>
						{/if}
					</PanelSection>
				</div>
			{:else}
				<div class="tabs" role="tablist" aria-label="Left panel">
					<button
						role="tab"
						aria-selected={leftTab === 'library'}
						class="tab"
						class:active={leftTab === 'library'}
						onclick={() => (leftTab = 'library')}
					>
						Library
					</button>
					<button
						role="tab"
						aria-selected={leftTab === 'outline'}
						class="tab"
						class:active={leftTab === 'outline'}
						onclick={() => (leftTab = 'outline')}
					>
						Outline
					</button>
				</div>

				<div class="tab-body">
					{#if leftTab === 'library'}
						<PanelSection id="cmp-lib-elements" title="Elements">
							<ul>
								<EditorElementsPalette {onElementDragStart} />
							</ul>
						</PanelSection>

						<EditorAssetLibrary assets={data.assets} />
					{:else}
						<EditorOutline
							scene={componentScene}
							template={undefined}
							{selectedId}
							{selectedIds}
							onSelect={(id, e) =>
								e && (e.shiftKey || e.metaKey || e.ctrlKey)
									? (selectedIds = selectedIds.includes(id)
											? selectedIds.filter((x) => x !== id)
											: [...selectedIds, id])
									: (selectedIds = [id])}
							onRename={renameNode}
						/>
					{/if}
				</div>
			{/if}
		</aside>

		<main class="canvas-area">
			{#if componentDraft && componentScene}
				<EditorCanvas
					scene={componentScene}
					scenes={[componentScene]}
					mainSizesMap={projectMainSizes}
					frameWidth={frameSize.width}
					frameHeight={frameSize.height}
					layoutType={currentLayoutType}
					assets={data.assets}
					{componentMap}
					{onSpawn}
					bind:selectedIds
					onDelete={onDeleteNode}
					projectGameName={null}
					componentParams={resolvedParams}
					redrawNonce={editNonce}
					onSpineMeta={(meta) => (spineMeta = meta)}
				/>
			{:else}
				<div class="empty">
					<Emblem height={48} />
					<h2>Invisible Component Editor</h2>
					<p>
						Author reusable game components — overlays, UI groups and scenery you can drop across
						scenes in the Invisible Editor. Create one on the left, or open an existing component,
						then build its element tree on this canvas.
					</p>
				</div>
			{/if}
		</main>

		<aside class="properties">
			<div class="right-body">
				{#if !componentDraft}
					<p class="muted hint">Open a component to edit its elements.</p>
				{:else}
					<EditorProperties
						node={selectedNode}
						layoutType={currentLayoutType}
						componentMode={true}
						onDirty={() => (editNonce += 1)}
						{spineMeta}
						spines={data.assets.spines}
						{pickSheets}
						componentParams={componentDraft.params ?? []}
						componentSignals={componentDraft.signals ?? []}
						instanceComponent={selectedNode?.kind === 'componentInstance'
							? (componentMap.get(selectedNode.componentId) ?? null)
							: null}
						onToggleParam={toggleComponentParam}
						onToggleStateParam={toggleButtonStateParam}
						onAddParam={addCustomParam}
						onRemoveParam={removeComponentParam}
						onSetParamDefault={setParamDefault}
						onSetParamOptions={setParamOptions}
						{fontParamKeys}
						onExposeTextParams={exposeTextParams}
						onUnexposeTextParams={unexposeTextParams}
						onExposeSpineParam={exposeSpineParam}
						onUnexposeSpineParam={unexposeSpineParam}
						onToggleSignal={toggleComponentSignal}
						onSetInstanceParam={(key, value) => {
							if (!selectedNode || selectedNode.kind !== 'componentInstance') return;
							const params = { ...(selectedNode.params ?? {}) };
							if (value === undefined) delete params[key];
							else params[key] = value;
							selectedNode.params = Object.keys(params).length ? params : undefined;
							editNonce += 1;
						}}
					/>
				{/if}
			</div>

			{#if componentDraft}
				<p class="muted hint foot">
					Component: <strong>{componentDraft.name}</strong> ·
					{componentDraft.root.children.length} nodes
				</p>
			{/if}
		</aside>

		<PanelResizers storageKey="iw-components-panels" bind:leftWidth bind:rightWidth bind:resizing />
	</div>
</div>

<style>
	.shell {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr;
		height: 100vh;
		color: #e8e8ee;
		background: #0b0b10;
		font-family:
			ui-sans-serif,
			system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
	}
	.subtitle {
		font-size: 11px;
		color: #888;
	}
	.subtitle strong {
		color: #b8b8c4;
		font-weight: 600;
	}
	.counter {
		font-size: 11px;
		color: #888;
	}
	.save-pill {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid #2a2a33;
		color: #c8c8d0;
		white-space: nowrap;
	}
	.space-toggle {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 11px;
		color: #888;
		white-space: nowrap;
	}
	.space-toggle select {
		font-size: 11px;
		padding: 2px 6px;
		border-radius: 6px;
		border: 1px solid #2a2a33;
		background: #14141a;
		color: #c8c8d0;
	}
	.save-pill.busy {
		color: #d8c0ff;
		border-color: #3a2a4a;
	}
	.save-pill.ok {
		color: #7ee0c0;
		border-color: #234038;
	}
	.save-pill.error {
		color: #ff9a9a;
		border-color: #4a2a30;
	}
	.save-pill.inspecting {
		color: #f0c674;
		border-color: #4a3a1f;
		background: #1a1408;
	}
	.save-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.save-btn {
		background: #14141a;
		border: 1px solid #2a2a33;
		color: #c8c8d0;
		font-size: 11px;
		padding: 5px 12px;
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
	}
	.save-btn:hover {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.save-btn.primary {
		border-color: #6b5bff;
		color: #c8a3ff;
	}
	.save-btn.primary:hover {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}

	.layout {
		position: relative;
		display: grid;
		grid-template-columns: 280px 1fr 320px;
		min-height: 0;
	}
	.layout.resizing {
		cursor: col-resize;
		user-select: none;
	}
	/* While dragging, stop the canvas from swallowing the pointer so the drag tracks. */
	.layout.resizing .canvas-area {
		pointer-events: none;
	}
	.left,
	.properties {
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: #0d0d12;
		overflow: hidden;
	}
	.left {
		border-right: 1px solid #1c1c24;
	}
	.properties {
		border-left: 1px solid #1c1c24;
	}
	.panel-head {
		display: flex;
		align-items: center;
		padding: 10px 12px;
		border-bottom: 1px solid #1c1c24;
	}
	.panel-title {
		margin: 0;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #b8b8c4;
	}
	.tabs {
		display: flex;
		gap: 2px;
		padding: 8px 8px 0;
		border-bottom: 1px solid #1c1c24;
	}
	.tab {
		background: transparent;
		border: 1px solid transparent;
		border-bottom: none;
		color: #888;
		font-size: 12px;
		padding: 6px 12px;
		border-radius: 6px 6px 0 0;
		cursor: pointer;
		font-family: inherit;
	}
	.tab.active {
		background: #14141a;
		border-color: #1f1f28;
		color: #e8e8ee;
	}
	.tab:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.tab-body,
	.right-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px;
	}
	.canvas-area {
		min-height: 0;
		min-width: 0;
		background: #08080c;
		overflow: hidden;
		position: relative;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 14px;
		height: 100%;
		padding: 0 48px;
		text-align: center;
		color: #c8a3ff;
	}
	.empty h2 {
		font-size: 16px;
		margin: 0;
		color: #e8e8ee;
		letter-spacing: 0.02em;
	}
	.empty p {
		max-width: 460px;
		color: #888;
		font-size: 13px;
		line-height: 1.6;
		margin: 0;
	}

	.create {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px;
		border: 1px solid #1f1f28;
		border-radius: 8px;
		background: #0b0b10;
		margin-bottom: 12px;
	}
	.create-row {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.create-row input {
		flex: 1;
		min-width: 0;
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
	}
	.create-row select {
		flex: 1;
		min-width: 0;
		background: #16131c;
		border: 1px solid #2a2433;
		border-radius: 6px;
		color: #c8a3ff;
		padding: 6px 8px;
		font-size: 12px;
		font-family: inherit;
	}
	.create-btn {
		background: #1a1622;
		border: 1px solid #6b5bff;
		color: #c8a3ff;
		padding: 6px 12px;
		font-size: 12px;
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
	}
	.create-btn:hover:not(:disabled) {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.create-btn:disabled {
		opacity: 0.4;
		cursor: default;
	}

	.cmp-del {
		flex: 0 0 auto;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		color: #777;
		font-size: 12px;
		line-height: 1;
		padding: 5px 7px;
		cursor: pointer;
		font-family: inherit;
	}
	.cmp-del:hover {
		background: #2a161a;
		border-color: #4a2a30;
		color: #ff9a9a;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.muted {
		color: #777;
		font-size: 12px;
		line-height: 1.5;
	}
	.small {
		font-size: 11px;
	}
	.hint {
		margin: 0;
	}
	.foot {
		padding: 8px 12px;
		border-top: 1px solid #1c1c24;
	}
</style>
