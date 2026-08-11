<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import CanvasModeBar from '$lib/CanvasModeBar.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import {
		buttonBindToInstance,
		engineOwnedOnly,
		findUnfilledRequiredSlots,
		getFullSceneSet,
		hudScenes,
		isHudScene,
		listFullSceneSets,
		listImportableKinds,
		mountAnchor,
		resolveAnchorPreviewArt,
		STANDARD_MAIN_SIZES_MAP,
		DEFAULT_WIN_TIERS,
		winTierPresentationParams,
	} from 'engine-layout';
	// The ONE generated sound-name list (from `apps/lines/src/game/sound.ts`), reused so the win
	// component's per-tier SFX / BGM dropdowns offer the game's real sounds — not a hand-copied list.
	import { MUSIC_NAMES, SOUND_EFFECT_NAMES } from 'engine-flow-v2';
	import type {
		ComponentDef,
		ComponentInstanceNode,
		ContainerNode,
		GameJurisdiction,
		GameSettings,
		GameTemplate,
		LayoutDoc,
		LayoutNode,
		LayoutType,
		Scene,
		SlotKind,
		SpineRestOverride,
		TemplateSlot,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import EditorAssetLibrary from './EditorAssetLibrary.svelte';
	import EditorCanvas from './EditorCanvas.svelte';
	import EditorComponentPanel from './EditorComponentPanel.svelte';
	import EditorElementsPalette from './EditorElementsPalette.svelte';
	import EditorOutline from './EditorOutline.svelte';
	import EditorProperties from './EditorProperties.svelte';
	import EditorTemplatePanel from './EditorTemplatePanel.svelte';
	import PanelResizers from './PanelResizers.svelte';
	import PanelSection from './PanelSection.svelte';
	import type { SpineMeta } from './spineRuntime.client';
	import { findById, flattenSceneIds, genComponentId, removeNode } from './layoutTree.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Scenes the canvas renders. Lazily seeded with a `'main'` scene when the
	 * doc has none — persistence is handled by the debounced autosave below. */
	let scenes: Scene[] = $state(
		data.doc.scenes.length > 0
			? structuredClone(data.doc.scenes)
			: [{ id: 's_main', name: 'main', nodes: [] }],
	);
	let activeSceneIdx = $state(0);
	/** Editor-only: scene ids hidden from the composite canvas (the eye toggles in
	 * the Screens list). Persisted per-project (see the UI-layout block below) so the
	 * authoring view restores on reopen. The active scene always renders; others render
	 * dimmed unless hidden here. */
	let hiddenScenes = $state(new Set<string>());
	function toggleSceneVisible(id: string): void {
		const next = new Set(hiddenScenes);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		hiddenScenes = next; // reassign so the canvas $effect re-runs
	}
	/** Canvas frame sizes per layoutType — `$state` (not `data.doc`) so loading a
	 * game scene that ships its own `mainSizesMap` resizes the canvas. */
	let mainSizesMap = $state(structuredClone(data.doc.mainSizesMap));
	/** Which built-in game layout to load — bound to the scene-bar picker. */
	let loadChoice = $state('');
	/** Kinds the "Import composed reference" group offers (lines + bookOf) — those
	 * shipping a FILLED, art-bearing reference layout. The import fetch
	 * (`GET /api/editor/import`) returns the filled doc with its bare board-frame
	 * names rewritten to THIS project's atlas region, so the frame renders (§19.6). */
	const importableKinds = listImportableKinds();
	/** Kinds the "New game from kind" group offers. Broader than `importableKinds`:
	 * the engine-owned scaffold drops the frame art, so the art-less engine-skeleton
	 * kinds (ways/cluster/scatter) are scaffoldable here too (§19.5). */
	const fullSceneSets = listFullSceneSets();
	/** Author-created custom game KINDS (§21) — engine-skeleton `LayoutDoc`s saved to
	 * R2 — joining the built-in `fullSceneSets` in the "New game from kind" picker.
	 * Local `$state` (seeded from the load) so "Save as new game kind…" can refresh
	 * the list in place without a full page reload. */
	let customKinds = $state<{ id: string; name: string }[]>(data.customKinds);
	/** Hoisted selection. `selectedIds` is the source of truth (multi-select via
	 * shift-click in the canvas + outliner); `<EditorCanvas>` binds it. `selectedId`
	 * is the PRIMARY (last-picked) id — what the properties panel + outline highlight
	 * read. Assigning `selectedId` is sugar for replacing the whole selection. */
	let selectedIds = $state<string[]>([]);
	const selectedId = $derived(selectedIds.at(-1) ?? null);
	/** Anchor for outliner range (Shift) selection — the last single-clicked row. */
	let selectionAnchorId = $state<string | null>(null);
	// Keep the range anchor in sync when the selection collapses to a single node —
	// crucially this also catches CANVAS clicks (which mutate `selectedIds` via the
	// binding but can't touch `selectionAnchorId`), so a following Shift-click in the
	// outliner ranges from what's actually selected, not a stale row.
	$effect(() => {
		if (selectedIds.length === 1) selectionAnchorId = selectedIds[0];
		else if (selectedIds.length === 0) selectionAnchorId = null;
	});
	/** Select exactly one node (or clear, with `null`) — the common single-pick path. */
	function selectOnly(id: string | null): void {
		selectedIds = id ? [id] : [];
		selectionAnchorId = id;
	}
	/** Clear the whole selection. */
	function clearSelection(): void {
		selectedIds = [];
		selectionAnchorId = null;
	}
	/** Outliner row click with modifiers: Shift = contiguous range from the anchor,
	 * Ctrl/Cmd = toggle this row, plain = select only this row. */
	function selectFromOutline(id: string, e?: MouseEvent): void {
		if (e?.shiftKey && selectionAnchorId && editScene) {
			const order = flattenSceneIds(editScene.nodes);
			const a = order.indexOf(selectionAnchorId);
			const b = order.indexOf(id);
			if (a !== -1 && b !== -1) {
				const [lo, hi] = a < b ? [a, b] : [b, a];
				const rangeIds = order.slice(lo, hi + 1);
				selectedIds = [...rangeIds.filter((x) => x !== id), id]; // id stays primary
				return;
			}
		}
		if (e?.metaKey || e?.ctrlKey) {
			selectedIds = selectedIds.includes(id)
				? selectedIds.filter((x) => x !== id)
				: [...selectedIds, id];
			selectionAnchorId = id;
			return;
		}
		selectOnly(id);
	}

	// ---------- clipboard: copy / cut / paste / duplicate ----------
	// In-memory clipboard of plain node clones. Paste/duplicate mint fresh ids and a
	// small offset, then drop the copies into the ACTIVE scene (so paste also moves a
	// node between screens). Each op is ONE markDirty -> one undo step.
	const PASTE_OFFSET = 24;
	let clipboard = $state<LayoutNode[]>([]);
	function freshNodeId(): string {
		return 'n_' + Math.random().toString(36).slice(2, 10);
	}
	/** Recursively give a (plain) node + its descendants new ids, and drop `slotId`
	 * (a clone can't fill the same template slot). Mutates in place. */
	function reassignNodeIds(node: LayoutNode): void {
		node.id = freshNodeId();
		delete node.slotId;
		if (node.kind === 'container') for (const c of node.children) reassignNodeIds(c);
	}
	/** A fresh-id deep clone of a node, optionally nudged by PASTE_OFFSET. */
	function cloneNodeFresh(node: LayoutNode, offset: boolean): LayoutNode {
		const copy = $state.snapshot(node) as LayoutNode;
		reassignNodeIds(copy);
		if (offset) {
			copy.x = (copy.x ?? 0) + PASTE_OFFSET;
			copy.y = (copy.y ?? 0) + PASTE_OFFSET;
		}
		return copy;
	}
	/** The selected nodes minus any nested UNDER another selected node (so a selected
	 * container + its child copies once, not twice), in tree order. */
	function topLevelSelectedNodes(): LayoutNode[] {
		const sc = scenes[activeSceneIdx];
		if (!sc) return [];
		const sel = new Set(selectedIds);
		const out: LayoutNode[] = [];
		const walk = (nodes: LayoutNode[], underSelected: boolean): void => {
			for (const n of nodes) {
				const isSel = sel.has(n.id);
				if (isSel && !underSelected) out.push(n);
				if (n.kind === 'container') walk(n.children, underSelected || isSel);
			}
		};
		walk(sc.nodes, false);
		return out;
	}
	/** Append fresh clones to the active scene + select them. Shared by paste/duplicate. */
	function addClonesToActive(sources: LayoutNode[]): boolean {
		const sc = scenes[activeSceneIdx];
		if (!sc || sources.length === 0) return false;
		const fresh = sources.map((n) => cloneNodeFresh(n, true));
		const next = scenes.slice();
		next[activeSceneIdx] = { ...sc, nodes: [...sc.nodes, ...fresh] };
		scenes = next;
		selectedIds = fresh.map((n) => n.id);
		selectionAnchorId = selectedIds.at(-1) ?? null;
		markDirty();
		return true;
	}
	function copySelection(): boolean {
		const nodes = topLevelSelectedNodes();
		if (nodes.length === 0) return false;
		clipboard = nodes.map((n) => $state.snapshot(n) as LayoutNode);
		return true;
	}
	function cutSelection(): boolean {
		const nodes = topLevelSelectedNodes();
		if (nodes.length === 0) return false;
		clipboard = nodes.map((n) => $state.snapshot(n) as LayoutNode);
		onDeleteNodes(nodes.map((n) => n.id));
		return true;
	}
	function pasteClipboard(): boolean {
		return addClonesToActive(clipboard);
	}
	function duplicateSelection(): boolean {
		return addClonesToActive(topLevelSelectedNodes());
	}

	/** Duplicate a whole screen (fresh scene + node ids), inserted right after it. */
	function duplicateScene(idx: number): void {
		const sc = scenes[idx];
		if (!sc) return;
		const copy = $state.snapshot(sc) as Scene;
		copy.id = (isHudScene(sc) ? 'hud_' : 's_') + Math.random().toString(36).slice(2, 10);
		copy.name = `${sc.name || sc.id} copy`;
		for (const n of copy.nodes) reassignNodeIds(n);
		const next = scenes.slice();
		next.splice(idx + 1, 0, copy);
		scenes = next;
		activeSceneIdx = idx + 1;
		clearSelection();
		markDirty();
	}
	/** Hoisted active layoutType. `'desktop'` is the base; anything else routes edits
	 * into `node.overrides[layoutType]` (override mode). */
	let currentLayoutType = $state<LayoutType>('desktop');
	/** Per-`assetKey` animation + skin lists for every loaded spine bundle, reported by
	 * the canvas's WebGL sublayers — lets the Properties panel offer dropdowns. */
	let spineMeta = $state<Map<string, SpineMeta>>(new Map());
	/** Right sidebar tab: which panel the properties column shows. The left column is
	 * now purely the Screens list (each active screen expands to its outline tree), so
	 * the Library, Components and (mode-gated) Template panels live here on the right.
	 * `template` is only reachable in Template-editor mode. */
	let rightTab = $state<'properties' | 'library' | 'template'>('properties');

	// ---------- persisted editor UI layout (tab + layer visibility) ----------
	// Per-project workspace state in localStorage ONLY — pure view state, never written to
	// the doc. Restores the active right tab and which screens are hidden when you reopen
	// the same project. Panel WIDTHS are owned by the shared <PanelResizers> (its own
	// key), so the resizable-sidebar behaviour is inherited by every editor-family tool.
	const uiKey = `iw-editor-ui:${data.projectKey}`;
	let leftWidth = $state(280);
	let rightWidth = $state(320);
	let resizing = $state<'left' | 'right' | null>(null);
	let uiLoaded = false;
	function loadUiState(): void {
		if (typeof localStorage === 'undefined') return;
		try {
			const raw = localStorage.getItem(uiKey);
			if (!raw) return;
			const s = JSON.parse(raw) as {
				rightTab?: string;
				hiddenScenes?: string[];
				libExpanded?: string[];
			};
			// Only the always-available right tabs — `template` is mode-gated.
			if (s.rightTab === 'properties' || s.rightTab === 'library') rightTab = s.rightTab;
			if (Array.isArray(s.hiddenScenes)) {
				hiddenScenes = new Set(s.hiddenScenes.filter((x): x is string => typeof x === 'string'));
			}
			// Restore the expanded Library atlases — <EditorAssetLibrary> hydrates each
			// open key's regions on mount.
			if (Array.isArray(s.libExpanded)) {
				const exp: Record<string, boolean> = {};
				for (const k of s.libExpanded) if (typeof k === 'string') exp[k] = true;
				expanded = exp;
			}
		} catch {
			/* corrupt prefs — ignore */
		}
	}
	$effect(() => {
		// Re-serialise whenever any tracked piece changes (after the initial load).
		const snapshot = JSON.stringify({
			rightTab,
			hiddenScenes: [...hiddenScenes],
			libExpanded: Object.keys(expanded).filter((k) => expanded[k]),
		});
		if (!uiLoaded || typeof localStorage === 'undefined') return;
		try {
			localStorage.setItem(uiKey, snapshot);
		} catch {
			/* quota / disabled — ignore */
		}
	});
	/** Whether the asset-warning detail list is expanded (from the header pill). */
	let showContentWarnings = $state(false);
	/** The template currently being viewed/edited — starts as the project's
	 * resolved template and is swapped by the game-type selector so you can load
	 * and see any game type's template (e.g. `bookOf`). Drives the slot panel. */
	let activeTemplate = $state<GameTemplate | undefined>(data.template);
	/** Required slots of {@link activeTemplate} left unfilled by the current
	 * scenes (§7.1) — derived live so it tracks both edits and template switches. */
	const warnings = $derived(
		activeTemplate ? findUnfilledRequiredSlots({ ...data.doc, scenes }, activeTemplate) : [],
	);

	/** Known asset keys + bundle prefixes from the project's asset list — used by
	 * the live content-warning check below. This is the single home for the check:
	 * it must run client-side so warnings track edits before any save, and
	 * `$lib/server` can't be imported into the browser bundle. */
	const knownAssets = $derived.by(() => {
		const keys = new Set<string>();
		const prefixes: string[] = [];
		for (const a of data.assets.atlases) keys.add(a.key);
		for (const s of data.assets.spines) {
			keys.add(s.key);
			prefixes.push(s.key.endsWith('/') ? s.key : `${s.key}/`);
		}
		for (const sh of data.assets.sheets) {
			keys.add(sh.key);
			prefixes.push(sh.key.endsWith('/') ? sh.key : `${sh.key}/`);
		}
		return { keys, prefixes };
	});

	function isKnownAsset(assetKey: string): boolean {
		if (knownAssets.keys.has(assetKey)) return true;
		return knownAssets.prefixes.some((p) => assetKey.startsWith(p));
	}

	/** Live, non-blocking content warnings (missing/unassigned asset references),
	 * surfaced next to the slot warnings. Recomputed as the author edits. */
	const contentWarnings = $derived.by(() => {
		const out: { sceneId: string; nodeId: string; message: string }[] = [];
		const walk = (nodes: LayoutNode[], sceneId: string): void => {
			for (const n of nodes) {
				if (!n.bind && (n.kind === 'sprite' || n.kind === 'spine')) {
					const key = n.assetKey?.trim();
					if (!key) {
						out.push({
							sceneId,
							nodeId: n.id,
							message: `${n.kind} "${n.label ?? n.id}" has no asset`,
						});
					} else if (!isKnownAsset(key)) {
						out.push({
							sceneId,
							nodeId: n.id,
							message: `${n.kind} "${n.label ?? n.id}" → missing asset "${key}"`,
						});
					}
				}
				if (n.kind === 'container') walk(n.children, sceneId);
			}
		};
		for (const s of scenes) walk(s.nodes, s.id);
		return out;
	});
	/** Template-authoring mode (§7.5): tag nodes as slots + export a `GameTemplate`
	 * instead of just filling one. Normal mode is unchanged when this is off. */
	let templateMode = $state(false);

	// ---------- components (§8.4) ----------
	// Authoring components moved OUT of the editor into the standalone Invisible
	// Component Editor (`/components`). The editor keeps a lean PICKER: list the
	// project's components, PLACE a `componentInstance` into the active scene, and
	// deep-link into the Component Editor (new tab) to author/create them.

	/** The two editor modes. (Component authoring is its own tool now.) */
	let mode = $state<'scene' | 'template'>('scene');
	/** The game's real sounds for the win component's per-tier SFX / BGM dropdowns — the ONE generated
	 * enum (`engine-flow-v2`). BGM = the `bgm_*` beds; SFX = the non-bgm cues (`sfx_*` / `jng_*`). This
	 * is the SHIPPED (`apps/lines`) sound set — a game with its own `sounds.json` isn't reflected yet. */
	const WIN_SOUND_OPTIONS = { bgm: MUSIC_NAMES, sfx: SOUND_EFFECT_NAMES };

	/**
	 * Rebuild the `win` component's per-tier PRESENTATION groups from the ACTIVE game config's big
	 * tiers (`data.winTiers`, else the built-in {@link DEFAULT_WIN_TIERS}), so its spine/animation/
	 * duration/sound groups mirror the config panel's authored tiers (keyed by alias) AND its SFX / BGM
	 * fields render as dropdowns of the game's real sounds. The base/shared params (before the first
	 * per-tier group) are kept verbatim; only the generated tail is replaced. Options are an editor-only
	 * hint (never saved to a placement / the runtime def), so this is byte-identical at runtime. Any
	 * other component passes through untouched.
	 */
	function withConfigWinTiers(defs: ComponentDef[]): ComponentDef[] {
		const tiers = data.winTiers ?? DEFAULT_WIN_TIERS;
		return defs.map((def) => {
			if (def.id !== 'win' || !def.params) return def;
			// Base/shared params carry no group or the shared "Animations (all tiers)" group; every
			// per-tier param lives under its tier's own group — so keep the former, regenerate the latter.
			const base = def.params.filter((p) => !p.group || p.group === 'Animations (all tiers)');
			return {
				...def,
				params: [...base, ...winTierPresentationParams(tiers, WIN_SOUND_OPTIONS)],
			};
		});
	}

	/** Components the project can use (shared + project shadow) — drives the picker +
	 * the canvas's `componentInstance` resolution. */
	let components = $state<ComponentDef[]>(withConfigWinTiers(structuredClone(data.components)));
	/** Status pill for the "Edit as component" materialize→open-tool flow. */
	let componentBusy = $state(false);
	let componentStatus = $state<{ kind: 'ok' | 'error'; message: string } | null>(null);

	/** id → def map, so the canvas resolves a `componentInstance` without the engine
	 * registry (the editor canvas is its own renderer). */
	const componentMap = $derived.by(() => {
		const m = new Map<string, ComponentDef>();
		for (const c of components) m.set(c.id, c);
		return m;
	});

	/** The project's component ids + names — feeds the `repeater` node's `componentId`
	 * picker in Properties (reusing the SAME list the picker/canvas already resolve, not a
	 * re-fetch). */
	const componentDefs = $derived(components.map((c) => ({ id: c.id, name: c.name })));

	/** Atlas/sheet manifests an `image`-kind param can pick frames from (the region
	 * picker source). Atlas pages aren't manifests, so only `atlas-manifest`s + sheets. */
	const pickSheets = $derived([
		...data.assets.atlases
			.filter((a) => a.kind === 'atlas-manifest')
			.map((a) => ({ key: a.key, name: a.name })),
		...data.assets.sheets.map((s) => ({ key: s.key, name: s.name })),
	]);

	/**
	 * Normalise a container into a component `root`: identity placement, keeping only
	 * its children + box (id/kind/children/width/height/label). A component is authored
	 * in LOCAL space — the `componentInstance` node positions it — so the root must carry
	 * NO transform of its own. This keeps the engine path (which applies `root`'s
	 * transform via `LayoutNodeView`) and the editor canvas (which skips it) in agreement
	 * and stops a dropped instance from being offset by a baked-in scene transform.
	 * Enforced authoritatively on save by `componentStorage.normalizeComponent`.
	 */
	function toComponentRoot(container: ContainerNode): ContainerNode {
		// `$state.snapshot` (not `structuredClone`): `container` is the selected node,
		// a reactive proxy `structuredClone` can't clone (DataCloneError).
		const clone = $state.snapshot(container) as ContainerNode;
		const root: ContainerNode = {
			id: clone.id,
			kind: 'container',
			x: 0,
			y: 0,
			children: clone.children,
		};
		if (clone.width !== undefined) root.width = clone.width;
		if (clone.height !== undefined) root.height = clone.height;
		if (clone.label !== undefined) root.label = clone.label;
		return root;
	}

	/**
	 * Convert a top-level SCENE container into a `componentInstance` referencing
	 * `def`, IN PLACE by id so the selection + z-order survive (same discipline as
	 * `onConvertToReelGrid` / `onConvertToParametricButton`). The component root is
	 * authored in LOCAL space (no transform of its own — see `toComponentRoot` /
	 * `identityComponentRoot`), so the instance must carry the container's transform
	 * to sit exactly where the container did: the def children keep their local
	 * coordinates and are positioned by the instance. Returns `true` when the node
	 * was found + replaced.
	 */
	function linkContainerToComponentInstance(container: ContainerNode, def: ComponentDef): boolean {
		const next = scenes.slice();
		const sc = next[activeSceneIdx];
		const nodes = sc.nodes.slice();
		const idx = nodes.findIndex((n) => n.id === container.id);
		if (idx === -1 || nodes[idx].kind !== 'container') return false;
		const old = nodes[idx];
		const instance: ComponentInstanceNode = {
			id: old.id,
			kind: 'componentInstance',
			componentId: def.id,
			componentVersion: def.version,
			x: old.x,
			y: old.y,
		};
		// Carry the container's transform/placement so the instance lands in the same
		// spot. The def root is identity-placed, so these belong on the instance node.
		if (old.label !== undefined) instance.label = old.label;
		if (old.anchor !== undefined) instance.anchor = old.anchor;
		if (old.scale !== undefined) instance.scale = old.scale;
		if (old.rotation !== undefined) instance.rotation = old.rotation;
		if (old.alpha !== undefined) instance.alpha = old.alpha;
		if (old.zIndex !== undefined) instance.zIndex = old.zIndex;
		if (old.coverScale !== undefined) instance.coverScale = old.coverScale;
		if (old.fit !== undefined) instance.fit = old.fit;
		if (old.overrides !== undefined) instance.overrides = old.overrides;
		if (old.visibleFor !== undefined) instance.visibleFor = old.visibleFor;
		if (old.screenAnchor !== undefined) instance.screenAnchor = old.screenAnchor;
		if (old.slotId !== undefined) instance.slotId = old.slotId;
		if (old.locked !== undefined) instance.locked = old.locked;
		nodes[idx] = instance;
		next[activeSceneIdx] = { ...sc, nodes };
		scenes = next;
		return true;
	}

	/**
	 * "Edit as component" from Properties: turn the selected SCENE container into a
	 * reusable component and a `componentInstance` that REFERENCES it, then open the
	 * def in the standalone Component Editor in THIS window.
	 *
	 * Two cases, both non-destructive to an already-authored def:
	 *  - **First extraction** (no same-name project component yet): MATERIALISE the
	 *    container's sub-tree into a new project `ComponentDef` (identity root) and
	 *    POST it once. This is the ONLY path that writes a def from the container's
	 *    children.
	 *  - **Existing same-name def**: LINK the container to that def WITHOUT
	 *    re-POSTing — never overwrite a def the author already edited in the
	 *    Component Editor (the old "idempotent re-POST" clobbered the saved children
	 *    with the scene container's stale, sprite-less sub-tree).
	 *
	 * Either way the scene container becomes a `componentInstance`, so subsequent
	 * component edits flow back into the scene and the destructive re-extraction can
	 * no longer happen (the button is gated to plain `container` nodes; an instance
	 * uses "Edit in Component Editor", which only navigates). The conversion is
	 * persisted via `markDirty()` + an explicit save before navigation.
	 */
	async function editContainerAsComponent(container: ContainerNode): Promise<void> {
		if (componentBusy) return;
		componentBusy = true;
		componentStatus = null;
		// Bail BEFORE creating the def if the scene can't be persisted (e.g. another
		// author saved first): pressing on would create a component in R2, fail to
		// persist the scene's link to it, then navigate away — orphaning the def and
		// losing the conversion. The save pill explains why nothing happened.
		if (saveState.dirty && !crossTypeLoaded && !(await save())) {
			componentStatus = { kind: 'error', message: 'Save the scene first — see the save status.' };
			componentBusy = false;
			return;
		}
		const name = container.label || 'Component';
		const existing = components.find((c) => c.scope === 'project' && c.name === name);
		try {
			let def: ComponentDef;
			if (existing) {
				// Reuse the already-authored def as-is — DO NOT overwrite it with the
				// scene container's (possibly stale) children. Just link + open it.
				def = existing;
			} else {
				def = {
					id: genComponentId(),
					name,
					version: 1,
					scope: 'project',
					category: 'overlay',
					root: toComponentRoot(container),
				};
				const res = await fetch('/api/editor/component', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					// A freshly-generated id ⇒ a create: `baseEtag: null` asserts it (`ifNoneMatch:'*'`)
					// so this never silently overwrites an existing def, and satisfies the required
					// precondition (Phase 1 of `docs/design/multi-user-concurrency.md`).
					body: JSON.stringify({ ...def, project: data.projectKey, baseEtag: null }),
				});
				if (!res.ok) {
					let message = 'Component save failed';
					try {
						const b = (await res.json()) as { message?: string };
						if (b?.message) message = b.message;
					} catch {
						/* non-JSON error body */
					}
					componentStatus = { kind: 'error', message };
					return;
				}
				// Reflect the new def locally so the picker + canvas resolve it immediately.
				components = [...components, def];
			}
			// Link the scene container to the def (container → componentInstance), so
			// component edits reflect into the scene, and persist the conversion before
			// navigating away.
			const linked = linkContainerToComponentInstance(container, def);
			if (linked) {
				markDirty();
				// Refuse to navigate if the link didn't persist — the def now exists, so
				// leaving here would strand it unreferenced and drop the conversion.
				if (!crossTypeLoaded && !(await save())) {
					componentStatus = {
						kind: 'error',
						message:
							'Component created, but the scene link could not be saved — see the save status.',
					};
					return;
				}
			}
			componentStatus = {
				kind: 'ok',
				message: existing ? 'Linked to component' : 'Component created',
			};
			const href = `/components?id=${encodeURIComponent(def.id)}&project=${encodeURIComponent(
				data.projectKey,
			)}`;
			window.location.href = href;
		} catch (e) {
			componentStatus = {
				kind: 'error',
				message: e instanceof Error ? e.message : 'Component save failed',
			};
		} finally {
			componentBusy = false;
		}
	}

	/** Drop a `componentInstance` of `def` into the active SCENE at frame centre. */
	function placeComponentInstance(def: ComponentDef): void {
		const main = mainSizesMap[currentLayoutType];
		const node: ComponentInstanceNode = {
			id: 'n_' + Math.random().toString(36).slice(2, 10),
			kind: 'componentInstance',
			label: def.name,
			componentId: def.id,
			componentVersion: def.version,
			x: Math.round(main.width / 2),
			y: Math.round(main.height / 2),
			anchor: { x: 0.5, y: 0.5 },
		};
		// Seed any def-declared default instance params onto the placement (e.g. the
		// `loadingBar` def carries `completeOnLoaded: true`, so dropping it is a
		// flow-driven loading screen out of the box). Absent ⇒ a bare instance (parity).
		if (def.defaultInstanceParams) node.params = { ...def.defaultInstanceParams };
		onSpawn(node);
		selectOnly(node.id);
	}

	/**
	 * Explicit, per-instance "update to latest" (§8.9). Re-pins ONLY the selected
	 * `componentInstance`'s `componentVersion` to the resolved def's current version and
	 * reconciles its author param overrides: keep every override whose param key still
	 * exists on the new def, drop overrides for params the new version removed (the new
	 * def's defaults then fill any gap via `resolveComponentParams`). Never bulk/auto —
	 * one node at a time — and persists through the normal save path via `markDirty()`.
	 */
	function updateInstanceToLatest(): void {
		const sel = selectedNode;
		if (!sel || sel.kind !== 'componentInstance') return;
		const def = componentMap.get(sel.componentId);
		if (!def) return;
		if (sel.params) {
			const valid = new Set((def.params ?? []).map((p) => p.key));
			const next: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(sel.params)) {
				if (valid.has(key)) next[key] = value;
			}
			sel.params = Object.keys(next).length ? next : undefined;
		}
		sel.componentVersion = def.version;
		markDirty();
	}

	/**
	 * The doc's single `reelGrid` node, if any (scene index + node), scanning every
	 * scene's top-level nodes — matching the engine's `findReelGridNode`, which reads
	 * the FIRST one across all scenes to drive the live board. The editor enforces ONE
	 * reel grid: a second would be silently ignored in-game, so the "Reel" element is
	 * disabled while one exists and instead selects the existing one. */
	const existingReelGrid = $derived.by(() => {
		for (let s = 0; s < scenes.length; s++) {
			const idx = scenes[s].nodes.findIndex((n) => n.kind === 'reelGrid');
			if (idx !== -1) return { sceneIdx: s, node: scenes[s].nodes[idx] };
		}
		return null;
	});

	/**
	 * Insert a from-scratch `reelGrid` (the parametric board placeholder) into the
	 * active scene, centred, seeded from the game's real board shape (template `board`,
	 * default 5×3 @ 120) so a brand-new layout gets a board the engine can read via
	 * `findReelGridNode` + `setBoardOverride`. Mirrors `placeComponentInstance` (spawn
	 * at main centre → select). Single-reel guard: if one already exists, jump to it
	 * instead of creating a second (which the engine would ignore). */
	function insertReelGrid(): void {
		if (existingReelGrid) {
			activeSceneIdx = existingReelGrid.sceneIdx;
			selectOnly(existingReelGrid.node.id);
			return;
		}
		const main = mainSizesMap[currentLayoutType];
		const board = data.template?.board ?? { reels: 5, rows: 3, cellSize: 120 };
		const node: LayoutNode = {
			id: 'n_' + Math.random().toString(36).slice(2, 10),
			kind: 'reelGrid',
			label: 'Reel grid',
			x: Math.round(main.width / 2),
			y: Math.round(main.height / 2),
			anchor: { x: 0.5, y: 0.5 },
			reels: board.reels,
			rows: board.rows,
			cellSize: board.cellSize ?? 120,
			reelPadding: 0.5,
			rowPadding: 0.5,
			gapX: 0,
			gapY: 0,
		};
		onSpawn(node);
		selectOnly(node.id);
	}

	/**
	 * Insert a `repeater` node (the data-driven buy/select-feature primitive) into the active
	 * scene, centred, with sane defaults: the built-in `featureCard` component stamped once per
	 * `featureCards` source item, laid out in a row with a 24px gap. Unlike `reelGrid` there's no
	 * single-instance guard — a layout may carry several repeaters. Mirrors `placeComponentInstance`
	 * (spawn at main centre → select). The author retargets `source`/`componentId`/`layout` in the
	 * Properties panel; the editor draws a labelled placeholder (the live source can't run here).
	 */
	function insertRepeater(): void {
		const main = mainSizesMap[currentLayoutType];
		const node: LayoutNode = {
			id: 'n_' + Math.random().toString(36).slice(2, 10),
			kind: 'repeater',
			label: 'Repeater',
			x: Math.round(main.width / 2),
			y: Math.round(main.height / 2),
			anchor: { x: 0.5, y: 0.5 },
			source: 'featureCards',
			componentId: 'featureCard',
			layout: { direction: 'row', gap: 24 },
		};
		onSpawn(node);
		selectOnly(node.id);
	}

	/** Open the standalone Component Editor in THIS window (optionally on `id`).
	 * Flushes the layout to the doc first so scene edits aren't lost on navigation —
	 * except a cross-type preview, which must never autosave (the user Saves/Discards
	 * it deliberately). Uses a FULL-PAGE navigation (not SPA `goto`): the editor and
	 * component editor are heavy WebGL tools that expect a clean document load — an
	 * in-app remount between them leaves the canvas broken (the "← Editor" link
	 * stopped working). Same window/tab, fresh document. */
	async function openComponentEditor(id?: string): Promise<void> {
		// Never navigate away from a doc that failed to flush — this is a full page
		// load, so unsaved work would be gone with no way back.
		if (saveState.dirty && !crossTypeLoaded && !(await save())) return;
		const params = new URLSearchParams();
		if (id) params.set('id', id);
		params.set('project', data.projectKey);
		window.location.href = `/components?${params.toString()}`;
	}

	/** Per-slot authoring metadata not carried on `LayoutNode` (which has no
	 * `required` field). Keyed by `slotId`; only read when exporting the template.
	 * Seeded from the resolved template so existing `required` flags round-trip
	 * (re-saving the template preserves them instead of dropping them). */
	let slotMeta = $state<Record<string, { required: boolean }>>(seedSlotMeta(data.template));

	function seedSlotMeta(template: GameTemplate | undefined): Record<string, { required: boolean }> {
		const out: Record<string, { required: boolean }> = {};
		if (!template) return out;
		for (const scene of template.scenes) {
			for (const slot of scene.slots) out[slot.slotId] = { required: Boolean(slot.required) };
		}
		return out;
	}

	const activeScene = $derived(scenes[activeSceneIdx] ?? scenes[0]);
	/** The scene the canvas/outline/properties edit (the active doc scene). */
	const editScene = $derived(activeScene);
	/** All scenes the canvas may composite. */
	const editScenes = $derived<Scene[]>(scenes);
	/** Template slots of the active scene — offered as the Properties slot dropdown. */
	const activeSceneSlots = $derived(
		activeTemplate?.scenes.find((s) => s.id === activeScene?.id)?.slots ?? [],
	);
	/** The active scene's placed top-level SPINE nodes — the `effect` node's "attach to rig" targets
	 * (per-rig bone hosting; `LayoutScene` pairs top-level scene nodes, so only these are valid). */
	const activeSceneSpineNodes = $derived(
		(activeScene?.nodes ?? [])
			.filter((n): n is Extract<LayoutNode, { kind: 'spine' }> => n.kind === 'spine')
			.map((n) => ({ id: n.id, label: n.label || n.assetKey || n.id })),
	);
	/** The fixed window-reference the composite renders EVERY scene against (§10.2):
	 * one viewport per `layoutType` (the `STANDARD_MAIN_SIZES_MAP` box — its aspect
	 * matches the per-layoutType viewport that drives `layoutType` selection, and it
	 * comfortably contains the project's `mainSizesMap` box at `mainScale`). Using it
	 * for ALL scenes means switching the active screen no longer rescales the composite
	 * — `frameWidth`/`frameHeight` now mean the WINDOW, and each coordinate space maps
	 * into it the way the engine does at runtime against the live canvas. */
	const frameSize = $derived(STANDARD_MAIN_SIZES_MAP[currentLayoutType]);
	const selectedNode = $derived(
		selectedId && editScene ? findById(editScene.nodes, selectedId) : null,
	);

	/**
	 * EDITOR-PREVIEW ONLY: while the author focuses a spine / spineAnimation param on the selected
	 * componentInstance (e.g. a Win Overlay tier's spine or intro/idle/outro), the canvas previews
	 * that bundle + animation on the instance's spine — WYSIWYG for the pick. Set by
	 * `EditorProperties.onPreviewSpine`, forwarded to `EditorCanvas` → `EditorSpineLayer`. Never
	 * written to the doc. Cleared when the selection changes so a new node starts from its default.
	 */
	let spinePreview = $state<{ bundle?: string; animation?: string } | null>(null);
	const spinePreviewNodeId = $derived(
		selectedNode?.kind === 'componentInstance' ? selectedNode.id : undefined,
	);
	$effect(() => {
		// Reset the preview when the selected node changes (tracks the id only, so focusing a param on
		// the SAME instance doesn't clear it).
		selectedId;
		spinePreview = null;
	});

	/** Is the selected node a full-bleed background COVER node (§10.3 step 4)? Mirrors
	 * `EditorCanvas.isBackgroundCover`: a `background`-space sprite/spine node, OR a
	 * `bind` anchor whose resolved preview art is a `cover` placement (the full-bleed
	 * Background). Drives the Properties "Background" cover section (scale + fit). */
	const isBackgroundCoverSelected = $derived.by(() => {
		const node = selectedNode;
		if (!node) return false;
		// A `bind` preview-art anchor whose default placement is `cover` (the full-bleed
		// Background). Also keep the section open once the author has switched its fit to
		// `contain` — that flips the resolved placement away from `cover`, so detect the
		// stored `preview.art.fit` too (else the control would vanish + trap the choice).
		const art = resolveAnchorPreviewArt(node, data.assets);
		if (art && art.placement === 'cover') return true;
		if (node.preview?.art?.fit) return true;
		// A `canvas`-space `coverFit` sprite/spine covers the window with the SAME cover
		// math — so it needs the SAME cover controls (scale + fit + Transform stretch).
		if (
			activeScene?.space === 'canvas' &&
			node.coverFit &&
			(node.kind === 'sprite' || node.kind === 'spine')
		) {
			return true;
		}
		return (
			activeScene?.space === 'background' &&
			(node.kind === 'sprite' || node.kind === 'spine' || node.kind === 'componentInstance')
		);
	});

	const sceneCount = $derived(scenes.length);
	// The Screens list groups the HUD screens (bottom bar + corners) into their own
	// section, apart from the game screens — they're the always-on-top UI layer.
	// Each entry keeps its ORIGINAL index into `scenes` (so `selectScene(i)` + the
	// active highlight stay correct).
	const gameSceneEntries = $derived(
		scenes.map((s, i) => ({ s, i })).filter(({ s }) => !isHudScene(s)),
	);
	const hudSceneEntries = $derived(
		scenes.map((s, i) => ({ s, i })).filter(({ s }) => isHudScene(s)),
	);
	const atlasCount = $derived(data.assets.atlases.length);
	const spineCount = $derived(data.assets.spines.length);
	const sheetCount = $derived(data.assets.sheets.length);

	const layoutTypes: LayoutType[] = ['desktop', 'tablet', 'landscape', 'portrait'];
	// Options for the floating canvas device bar. Non-`desktop` is a layout OVERRIDE,
	// flagged so the bar tints it (mirrors the old `.pill.active.override` accent).
	const layoutOptions = layoutTypes.map((lt) => ({
		value: lt,
		label: lt,
		flagged: lt !== 'desktop',
	}));

	// ---------- expandable sheet/atlas region lists ----------
	// The Library sections + their drag/expand machinery live in <EditorAssetLibrary>;
	// this page only keeps the expanded set, persisted as workspace UI state below.

	/** Which sheet/atlas keys are currently expanded in the Library — bound into
	 * <EditorAssetLibrary>, restored + serialised by the UI-state block above. */
	let expanded = $state<Record<string, boolean>>({});

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

	function onSpawn(node: LayoutNode): void {
		const next = scenes.slice();
		const sc = next[activeSceneIdx];
		next[activeSceneIdx] = { ...sc, nodes: [...sc.nodes, node] };
		scenes = next;
		markDirty();
	}

	/** Switch the editor to a template scene so its slots can be filled — creating
	 * the scene in the doc on first visit (the document may predate the template,
	 * e.g. a generic `main` scene). */
	function goToTemplateScene(sceneId: string, sceneName: string): void {
		let idx = scenes.findIndex((s) => s.id === sceneId);
		if (idx === -1) {
			scenes = [...scenes, { id: sceneId, name: sceneName, nodes: [] }];
			idx = scenes.length - 1;
			markDirty();
		}
		activeSceneIdx = idx;
		clearSelection();
	}

	/** Bumped each drag-onto-a-slot so the canvas spawns the asset exactly once. */
	let fillRequest = $state<{ payload: unknown; slotId: string; seq: number } | null>(null);
	let fillSeq = 0;

	/** Drag-to-slot: switch to the slot's scene, then ask the canvas to spawn the
	 * dropped Library asset at frame centre, tagged with `slotId` (so it fills the
	 * slot). The canvas owns spawning so region-preview seeding still happens. */
	function onFillSlot(sceneId: string, sceneName: string, slotId: string, payload: unknown): void {
		goToTemplateScene(sceneId, sceneName);
		fillSeq += 1;
		fillRequest = { payload, slotId, seq: fillSeq };
	}

	/** Add an engine `mount` anchor for an empty mount slot so it shows as a
	 * visible, draggable box on the canvas (mount slots take no asset). Sizes +
	 * positions it over the board frame when the scene has one (slot `boardFrame`),
	 * else centres a default box in the frame. Game-agnostic — driven by the active
	 * template's slot, so it works for any game type. */
	function onAddMountAnchor(sceneId: string, sceneName: string, slotId: string): void {
		goToTemplateScene(sceneId, sceneName);
		const sc = scenes[activeSceneIdx];
		if (!sc) return;
		const slot = activeTemplate?.scenes
			.find((s) => s.id === sceneId)
			?.slots.find((s) => s.slotId === slotId && s.kind === 'mount');
		if (!slot) return;
		if (sc.nodes.some((n) => n.slotId === slotId)) return; // already anchored
		// Default box: the board frame's rect if the scene has one, else a centred
		// box in the main frame — so the anchor always lands somewhere visible.
		const board = sc.nodes.find((n) => n.slotId === 'boardFrame' && n.kind === 'sprite');
		const main = mainSizesMap[currentLayoutType];
		const init =
			board && board.kind === 'sprite' && board.width && board.height
				? { x: board.x, y: board.y, width: board.width, height: board.height }
				: {
						x: main.width / 2,
						y: main.height / 2,
						width: Math.round(main.width * 0.6),
						height: Math.round(main.height * 0.6),
					};
		const node = mountAnchor(sc.id, slot, init);
		onSpawn(node);
		selectOnly(node.id);
	}

	/** Switch the canvas to a screen (scene) by index — the screen list picker. */
	function selectScene(idx: number): void {
		if (idx < 0 || idx >= scenes.length) return;
		activeSceneIdx = idx;
		clearSelection();
	}

	/** Set the active scene's coordinate space. `'game'` is the default → omit it
	 * (keeps the doc clean); switching away from `'standard'` drops its `align`. */
	function setSceneSpace(value: string): void {
		const sc = scenes[activeSceneIdx];
		if (!sc) return;
		if (value === 'game') delete sc.space;
		else sc.space = value as NonNullable<Scene['space']>;
		if (sc.space !== 'standard') delete sc.align;
		// Only `game`-space screens ride the anticipation camera; leaving `game` space would strand an
		// unreachable `zoomWithAnticipation: true` (its checkbox is gated to game space), so clear it.
		if (sc.space) delete sc.zoomWithAnticipation;
		scenes = [...scenes];
		markDirty();
	}

	/** Tag the active scene's engine ROLE — the id-independent identity the game boot resolves
	 * the loading splash / persistent base scene by (engine `Scene.role`), so scene ids stay
	 * free-form / renameable. `''` clears it. Expect ONE scene per role (the game resolves the
	 * first match). Sparse — an untouched scene carries no `role`, so it serializes as today. */
	function setSceneRole(value: string): void {
		const sc = scenes[activeSceneIdx];
		if (!sc) return;
		if (
			value === 'loading' ||
			value === 'basegame' ||
			value === 'buyFeature' ||
			value === 'buyConfirm'
		)
			sc.role = value;
		else delete sc.role;
		scenes = [...scenes];
		markDirty();
	}

	/** Pin the active screen ABOVE every doc-ordered layer, or hand it back to the screen-list
	 * order (engine `Scene.alwaysOnTop`). Ticked ⇒ the screen mounts at the fixed top band, so
	 * dragging it in the Screens list no longer moves it — for a transient overlay that must
	 * never be buried (splash / big-win). Sparse: cleared rather than stored false. */
	function setSceneAlwaysOnTop(value: boolean): void {
		const sc = scenes[activeSceneIdx];
		if (!sc) return;
		if (value) {
			sc.alwaysOnTop = true;
			delete sc.behindReels; // contradictory — a screen can't be both pinned on top and under the reels.
		} else delete sc.alwaysOnTop;
		scenes = [...scenes];
		markDirty();
	}

	/** Mount the active screen BEHIND the reel board (engine `Scene.behindReels`). The list band
	 * sits entirely above the board, so list position alone can never express this. Mutually
	 * exclusive with `alwaysOnTop`. Sparse: cleared rather than stored false. */
	function setSceneBehindReels(value: boolean): void {
		const sc = scenes[activeSceneIdx];
		if (!sc) return;
		if (value) {
			sc.behindReels = true;
			delete sc.alwaysOnTop;
		} else delete sc.behindReels;
		scenes = [...scenes];
		markDirty();
	}

	/** Make the active screen ZOOM + PAN in lockstep with the reel-anticipation camera (engine
	 * `Scene.zoomWithAnticipation`). For a `game`-space "base game top / bottom" screen that should
	 * ride the anticipation zoom toward the reel centre. No-op in-game unless anticipation is on +
	 * the screen is `game` space. Sparse: cleared rather than stored false. */
	function setSceneZoomWithAnticipation(value: boolean): void {
		const sc = scenes[activeSceneIdx];
		if (!sc) return;
		if (value) sc.zoomWithAnticipation = true;
		else delete sc.zoomWithAnticipation;
		scenes = [...scenes];
		markDirty();
	}

	/** Set an alignment axis on a `'standard'` scene; `''` clears that axis (and
	 * the whole `align` object once both axes are unset). */
	function setSceneAlign(axis: 'vertical' | 'horizontal', value: string): void {
		const sc = scenes[activeSceneIdx];
		if (!sc || sc.space !== 'standard') return;
		const align = { ...(sc.align ?? {}) };
		if (value) align[axis] = value as never;
		else delete align[axis];
		if (align.vertical || align.horizontal) sc.align = align;
		else delete sc.align;
		scenes = [...scenes];
		markDirty();
	}

	/** Adopt a loaded `LayoutDoc`'s scenes (+ its game type and frame sizes) as the
	 * project's layout, after confirming if it would discard placed nodes. */
	function adoptScenes(
		doc: { scenes: Scene[]; gameType?: string; mainSizesMap?: typeof mainSizesMap },
		gameType: string,
	): void {
		if (doc.scenes.length === 0) return;
		const crossType = Boolean(projectGameType) && gameType !== projectGameType;
		const hasContent = scenes.some((s) => s.nodes.length > 0);
		// A cross-type load (e.g. `lines` into a `bookOf` project) is the clobber
		// case: confirm loudly AND suppress autosave afterwards so an edit can't
		// silently overwrite the project's real, different-type saved doc.
		const warn = crossType
			? `⚠ This project is "${projectGameType}". Loading the "${gameType}" layout REPLACES it on screen, and saving would overwrite your "${projectGameType}" layout.\n\nIt will NOT autosave — you must click "Save" deliberately (or "Discard"). Continue?`
			: hasContent
				? `Load the ${gameType} scenes? This replaces the current layout on screen.\n\nNothing is saved until you make an edit, so your project's saved layout is safe — but if you then edit, the load is what gets saved.`
				: `Load the ${gameType} scenes onto the canvas?\n\nNothing is saved until you make an edit.`;
		if (!confirm(warn)) return;
		scenes = structuredClone(doc.scenes);
		if (doc.mainSizesMap) mainSizesMap = structuredClone(doc.mainSizesMap);
		authoringGameType = gameType;
		activeSceneIdx = 0;
		clearSelection();
		void loadTemplateFor(gameType);
		// A same-type load stays a non-destructive preview (the first edit commits it
		// via autosave). A cross-type load is held back from autosave entirely — only
		// an explicit Save persists it — so it can't clobber the project's saved doc.
		crossTypeLoaded = crossType;
		crossTypeFrom = crossType ? gameType : '';
		loadedPreview = !crossType;
		resetHistory(); // a deliberate layout swap is a clean new baseline
	}

	/** Load the game scene chosen in the scene-bar picker (§19.5 / §21). All
	 * branches derive from one slot-tagged source per kind:
	 * - `scaffold:<type>` — built-in "New game from kind": the engine-owned
	 *   projection (`engineOwnedOnly`) — correct screens + engine pieces, no art.
	 * - `kind:<id>` — author-created custom kind (§21): fetch its stored `doc` from
	 *   R2, then run the SAME `engineOwnedOnly` scaffold + `adoptScenes` clobber path.
	 * - `ref:<type>` — "Import composed reference": the FILLED layout (art kept),
	 *   fetched from `/api/editor/import` so the server rewrites its bare board-frame
	 *   names to THIS project's atlas region (§19.6) — NO `engineOwnedOnly`. */
	async function loadChosen(): Promise<void> {
		const choice = loadChoice;
		if (!choice) return;
		const sep = choice.indexOf(':');
		const kind = choice.slice(0, sep);
		const gameType = choice.slice(sep + 1);
		// Scaffold reads the full scene set (covers bookOf); import fetches the
		// project-aware FILLED reference layout (lines + bookOf, §19.6).
		if (kind === 'scaffold') {
			const full = getFullSceneSet(gameType);
			if (full) adoptScenes(engineOwnedOnly(full), gameType);
		} else if (kind === 'kind') {
			try {
				const res = await fetch(`/api/editor/kind?id=${encodeURIComponent(gameType)}`);
				if (res.ok) {
					const { doc } = (await res.json()) as { doc: LayoutDoc };
					adoptScenes(engineOwnedOnly(doc), gameType);
				} else {
					lastError = `Couldn't load that game kind (${res.status}).`;
				}
			} catch (e) {
				lastError = e instanceof Error ? e.message : "Couldn't load that game kind.";
			}
		} else if (kind === 'ref') {
			try {
				const res = await fetch(`/api/editor/import?gameType=${encodeURIComponent(gameType)}`);
				if (res.ok) {
					const doc = (await res.json()) as LayoutDoc;
					adoptScenes(doc, gameType);
				} else {
					lastError = `Couldn't import that reference layout (${res.status}).`;
				}
			} catch (e) {
				lastError = e instanceof Error ? e.message : "Couldn't import that reference layout.";
			}
		}
		loadChoice = '';
	}

	/** Discard a cross-type loaded layout and reload the project's saved doc. */
	function discardCrossType(): void {
		if (!confirm("Discard the loaded layout and restore your project's saved layout?")) return;
		location.reload();
	}

	/** Derive a kind-id slug from a human name (matches the server slug rule). */
	function slugifyKind(name: string): string {
		return name
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, '-')
			.replace(/^-+|-+$/g, '')
			.slice(0, 64);
	}

	/** Save the current canvas (scenes + mainSizesMap) as a NEW shared game kind
	 * (§21.4). The server stores the doc and `engineOwnedOnly` scaffolds it on use,
	 * exactly like a built-in kind, so it appears in "New game from kind" with no
	 * code change. Prompts for a name, derives a slug, POSTs, then refreshes the
	 * picker list in place. The server re-validates (slug + non-collision); its 400
	 * message is surfaced. */
	function postKind(body: Record<string, unknown>): Promise<Response> {
		return fetch('/api/editor/kind', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
	}

	async function saveAsNewKind(): Promise<void> {
		const name = prompt('Name this new game kind (e.g. "Crash"):')?.trim();
		if (!name) return;
		const id = slugifyKind(name);
		if (!id) {
			alert('That name has no usable slug characters — try a different name.');
			return;
		}
		const doc: LayoutDoc = {
			version: data.doc.version,
			projectKey: data.projectKey,
			gameType: id,
			mainSizesMap: JSON.parse(JSON.stringify(mainSizesMap)),
			scenes: JSON.parse(JSON.stringify(scenes)) as Scene[],
			updatedAt: '',
		};
		try {
			let res = await postKind({ id, name, doc });
			if (res.status === 409) {
				// The id is taken — kinds are GLOBAL and the id comes from the name, so this
				// is very likely someone ELSE's kind. Confirm before replacing it; the old
				// code would have overwritten it silently.
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				const msg = body.message ?? `A game kind "${id}" already exists.`;
				if (!confirm(`${msg}\n\nOverwrite it?`)) return;
				res = await postKind({ id, name, doc, overwrite: true });
			}
			if (!res.ok) {
				let msg = `Save failed (${res.status}).`;
				try {
					const body = (await res.json()) as { message?: string };
					if (body.message) msg = body.message;
				} catch {
					/* keep the status fallback */
				}
				alert(msg);
				return;
			}
			// Refresh the picker list so the new kind appears immediately.
			try {
				const list = await fetch('/api/editor/kinds');
				if (list.ok) customKinds = (await list.json()) as { id: string; name: string }[];
			} catch {
				/* non-fatal: the kind saved; the list just won't refresh until reload */
			}
			lastError = '';
			alert(`Saved "${name}" as a new game kind. It now appears in "New game from kind".`);
		} catch (e) {
			alert(e instanceof Error ? e.message : 'Save failed.');
		}
	}

	/** Whether the HUD scenes (logo/name corners + bottom bar) are present. */
	const hasHud = $derived(scenes.some((s) => s.id === 'hudBar' || s.id === 'hudCorners'));

	/** Add the game HUD as editor scenes (non-destructive — keeps other scenes), or
	 * refresh existing HUD scenes to the latest engine version (e.g. to pick up the
	 * preview chips / positions). Lets a project opt its `<UI>` HUD into editor
	 * control without the clobber-prone "load a game scene" path.
	 *
	 * `{ readouts: true, buttons: true }` (§ default-HUD Phase 2b): emits the FULL
	 * parametric HUD — balance/win/bet as `componentInstance(hudReadout)` AND the button
	 * cluster as `componentInstance(button)` — matching the engine reference default. This
	 * is the flow-v2-safe HUD: the coded `UiLabel*`/`UiButton*` `bind` nodes render only
	 * through the coded `<UI>` chrome, which a flow-v2-driven game suppresses, so a "reset"
	 * that emitted them would go blank on such a game. The shared runtime (built from
	 * `apps/lines`, `HUD_BUTTON_INSTANCES` on) registers `hudReadout`/`button` + the value/
	 * action sources, so a published game renders these. */
	function addHudLayer(): void {
		const fresh = hudScenes({ readouts: true, buttons: true });
		if (hasHud) {
			if (
				!confirm(
					'Reset the HUD to the default layout? This replaces the balance/win/bet readouts and the button cluster with the engine default (flow-safe) HUD — any position edits you made to the HUD elements will be reset.',
				)
			) {
				return;
			}
			scenes = [...scenes.filter((s) => s.id !== 'hudBar' && s.id !== 'hudCorners'), ...fresh];
		} else {
			scenes = [...scenes, ...fresh];
		}
		activeSceneIdx = scenes.length - fresh.length; // focus the first HUD screen
		clearSelection();
		markDirty();
	}

	/** Screens in the game's canonical full set (per game type) that this doc is
	 * missing, matched by scene id OR engine role — e.g. a `loading`/logo scene added
	 * after the project was first seeded. A ref counts as present when a scene shares its
	 * id, OR (when the ref carries a `role`) when a scene fills that same role — so a
	 * role-tagged, custom-id loading/base scene is NOT falsely flagged as missing. */
	const missingScreens = $derived.by(() => {
		const full = getFullSceneSet(projectGameType);
		if (!full) return [] as Scene[];
		return full.scenes.filter(
			(ref) =>
				!scenes.some((cur) => cur.id === ref.id) &&
				!(ref.role && scenes.some((cur) => cur.role === ref.role)),
		);
	});

	/** Append every screen the game has that this doc lacks (e.g. the logo/loading
	 * scene) — non-destructive: existing scenes + their edits are left untouched, so
	 * the author tops up the screen list without re-running the console seed. */
	function addMissingScreens(): void {
		const toAdd = missingScreens;
		if (toAdd.length === 0) return;
		scenes = [...scenes, ...structuredClone(toAdd)];
		activeSceneIdx = scenes.length - toAdd.length; // focus the first added screen
		clearSelection();
		markDirty();
	}

	/** Create a fresh full-bleed background screen — a `background`-space scene whose
	 * sprites/spines are cover-fit to the window (§10.2). Empty to start: drag any atlas
	 * region onto it and it fills edge-to-edge (`coverScale 1`). Switches to the new
	 * screen so the author can drop art straight away. */
	function addBackgroundScreen(): void {
		const id = 's_' + Math.random().toString(36).slice(2, 10);
		const n = scenes.filter((s) => s.space === 'background').length;
		const name = n === 0 ? 'Background' : `Background ${n + 1}`;
		scenes = [...scenes, { id, name, space: 'background', nodes: [] }];
		activeSceneIdx = scenes.length - 1;
		clearSelection();
		markDirty();
	}

	/** Next free `"<prefix> NNN"` name (zero-padded), scanning existing scene names so
	 * it survives deletes — used for the auto-named "New screen" / "New HUD screen". */
	function nextScreenName(prefix: string): string {
		const re = new RegExp(`^${prefix} (\\d+)$`);
		let max = 0;
		for (const s of scenes) {
			const m = re.exec(s.name ?? '');
			if (m) max = Math.max(max, Number.parseInt(m[1], 10));
		}
		return `${prefix} ${String(max + 1).padStart(3, '0')}`;
	}

	/** Add a blank game-space screen (auto-named "Screen 001", …) and focus it — the
	 * generic counterpart to "New background screen". A fresh custom-id screen DOES ship:
	 * the game mounts it generically (`extraMountScenes`, PR #67) as an always-on overlay
	 * gated by its `visibleSource`, or as an exclusive Flow takeover when a FlowDoc authors
	 * it — no per-id code wiring needed (see docs/design/flow-driven-game.md §4). */
	function addEmptyScreen(): void {
		const id = 's_' + Math.random().toString(36).slice(2, 10);
		scenes = [...scenes, { id, name: nextScreenName('Screen'), nodes: [] }];
		activeSceneIdx = scenes.length - 1;
		clearSelection();
		markDirty();
	}

	/** Add a blank HUD-layer screen — a `standard`-space scene minted with a `hud_` id
	 * so `isHudScene()` groups it under the always-on-top HUD section. Drop atlas
	 * regions onto it to build a custom top-layer overlay. Minted `align.vertical:'bottom'`
	 * so `<LayoutScene>` bottom-frames it in-game exactly like the coded bottom bar (§16
	 * HUD generalization — without this the wooden bar renders top-anchored). Ships via the
	 * `authoredHudScenes` HUD-layer mount (full-replace: any `hud_*` content suppresses the
	 * coded `<UI>` chrome). */
	function addHudScreen(): void {
		const id = 'hud_' + Math.random().toString(36).slice(2, 10);
		scenes = [
			...scenes,
			{
				id,
				name: nextScreenName('HUD'),
				space: 'standard',
				align: { vertical: 'bottom' },
				nodes: [],
			},
		];
		activeSceneIdx = scenes.length - 1;
		clearSelection();
		markDirty();
	}

	/** Delete a screen (with its nodes) after confirmation, then re-resolve the active
	 * screen so the canvas keeps a valid selection. */
	function deleteScene(idx: number): void {
		const sc = scenes[idx];
		if (!sc) return;
		const label = sc.name || sc.id;
		const msg =
			sc.nodes.length > 0
				? `Delete the "${label}" screen and its ${sc.nodes.length} item${sc.nodes.length === 1 ? '' : 's'}? This can't be undone.`
				: `Delete the "${label}" screen?`;
		if (!confirm(msg)) return;
		const activeId = activeScene?.id;
		const next = scenes.filter((_, i) => i !== idx);
		scenes = next;
		if (next.length === 0) {
			activeSceneIdx = 0;
		} else if (activeId === sc.id) {
			activeSceneIdx = Math.min(idx, next.length - 1);
		} else {
			const ni = next.findIndex((s) => s.id === activeId);
			activeSceneIdx = ni === -1 ? Math.min(activeSceneIdx, next.length - 1) : ni;
		}
		clearSelection();
		markDirty();
	}

	// ---------- inline screen rename ----------
	let renamingSceneIdx = $state<number | null>(null);
	let renameDraft = $state('');
	function startRenameScene(idx: number): void {
		if (!scenes[idx]) return;
		renamingSceneIdx = idx;
		renameDraft = scenes[idx].name ?? '';
	}
	function commitRenameScene(): void {
		if (renamingSceneIdx === null) return;
		const sc = scenes[renamingSceneIdx];
		const name = renameDraft.trim();
		if (sc && name && name !== sc.name) {
			sc.name = name;
			scenes = scenes.slice();
			markDirty();
		}
		renamingSceneIdx = null;
	}
	function cancelRenameScene(): void {
		renamingSceneIdx = null;
	}
	/** Focus + select an input on mount (the rename field). */
	function selectOnMount(node: HTMLInputElement): void {
		node.focus();
		node.select();
	}

	// ---------- drag-to-reorder screens ----------
	// The editor composites GAME scenes in doc-array order (EditorCanvas), so moving a
	// row changes its layer (top row = back, bottom = front). HUD scenes always draw on
	// the top-most layer, so reordering is constrained WITHIN a group (game ↔ game, HUD
	// ↔ HUD) — a cross-group drop is rejected (it wouldn't change rendering anyway).
	let dragSceneIdx = $state<number | null>(null);
	let dropInfo = $state<{ idx: number; after: boolean } | null>(null);
	function sameGroup(a: number, b: number): boolean {
		return (
			Boolean(scenes[a]) && Boolean(scenes[b]) && isHudScene(scenes[a]) === isHudScene(scenes[b])
		);
	}
	function onSceneDragStart(e: DragEvent, idx: number): void {
		dragSceneIdx = idx;
		if (e.dataTransfer) {
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(idx)); // Firefox needs a payload
		}
	}
	function dropAfter(e: DragEvent): boolean {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		return e.clientY > rect.top + rect.height / 2;
	}
	function onSceneDragOver(e: DragEvent, idx: number): void {
		if (dragSceneIdx === null || !sameGroup(dragSceneIdx, idx)) return;
		e.preventDefault(); // allow the drop
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const after = dropAfter(e);
		if (!dropInfo || dropInfo.idx !== idx || dropInfo.after !== after) dropInfo = { idx, after };
	}
	function onSceneDrop(e: DragEvent, idx: number): void {
		e.preventDefault();
		if (dragSceneIdx !== null && sameGroup(dragSceneIdx, idx)) {
			moveScene(dragSceneIdx, idx, dropAfter(e));
		}
		resetSceneDrag();
	}
	function resetSceneDrag(): void {
		dragSceneIdx = null;
		dropInfo = null;
	}
	/** Move scene `from` to sit before/after `targetIdx`, keeping the active screen
	 * focused. `ref` is the insert-before index in the original array; it drops by one
	 * once `from` is spliced out from earlier in the array. */
	function moveScene(from: number, targetIdx: number, after: boolean): void {
		if (from < 0 || from >= scenes.length) return;
		let ref = after ? targetIdx + 1 : targetIdx;
		if (from < ref) ref -= 1;
		if (ref === from) return; // no-op
		const activeId = activeScene?.id;
		const next = scenes.slice();
		const [moved] = next.splice(from, 1);
		next.splice(ref, 0, moved);
		scenes = next;
		if (activeId) {
			const ni = next.findIndex((s) => s.id === activeId);
			if (ni !== -1) activeSceneIdx = ni;
		}
		markDirty();
	}

	function onDeleteNode(id: string): void {
		const next = scenes.slice();
		const sc = next[activeSceneIdx];
		const nodes = sc.nodes.slice();
		if (!removeNode(nodes, id)) return;
		next[activeSceneIdx] = { ...sc, nodes };
		scenes = next;
		if (selectedIds.includes(id)) selectedIds = selectedIds.filter((x) => x !== id);
		markDirty();
	}

	/** Delete several nodes (a multi-selection) in ONE transaction → a single undo
	 * step. Walks the active scene removing each id, then clears them from selection. */
	function onDeleteNodes(ids: string[]): void {
		const sc = scenes[activeSceneIdx];
		if (!sc) return;
		const nodes = sc.nodes.slice();
		let removed = false;
		for (const id of ids) if (removeNode(nodes, id)) removed = true;
		if (!removed) return;
		const next = scenes.slice();
		next[activeSceneIdx] = { ...sc, nodes };
		scenes = next;
		const set = new Set(ids);
		selectedIds = selectedIds.filter((x) => !set.has(x));
		markDirty();
	}

	/** Set a node's outline `label` (or clear it to fall back to the node id), walking
	 * the active scene's tree. Reassigns `scenes` so the change reacts + marks dirty. */
	function onRenameNode(id: string, label: string): void {
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
		if (!walk(scenes[activeSceneIdx].nodes)) return;
		scenes = scenes.slice();
		markDirty();
	}

	/**
	 * Replace the selected board mount-anchor (a `container` filling the `reelGrid`
	 * slot) with a parametric `reelGrid` node, dropping the container's `bind`/
	 * `width`/`height`/`children`/`locked` so the engine + editor treat it as the
	 * new kind. Seeded with the game's real board shape + cell size (template
	 * `board`, default 5×3 @ 120) at the board's NATURAL centre per layoutType — NOT
	 * the old anchor's possibly-offset rect — so the live board (which Phase 2 now
	 * reads) stays exactly where it is (centre, scale 1, zero offset = parity). The
	 * author then drags / tunes from there. In-place by id so selection survives.
	 */
	function onConvertToReelGrid(id: string): void {
		const next = scenes.slice();
		const sc = next[activeSceneIdx];
		const nodes = sc.nodes.slice();
		const idx = nodes.findIndex((n) => n.id === id);
		if (idx === -1 || nodes[idx].kind !== 'container') return;
		const old = nodes[idx];
		const board = data.template?.board ?? { reels: 5, rows: 3, cellSize: 120 };
		const centreOf = (lt: LayoutType) => ({
			x: mainSizesMap[lt].width * 0.5,
			y: mainSizesMap[lt].height * 0.5,
		});
		const grid: LayoutNode = {
			id: old.id,
			kind: 'reelGrid',
			label: old.label ?? 'Reel grid',
			...centreOf('desktop'),
			anchor: { x: 0.5, y: 0.5 },
			reels: board.reels,
			rows: board.rows,
			cellSize: board.cellSize ?? 120,
			reelPadding: 0.53,
			overrides: {
				tablet: centreOf('tablet'),
				landscape: centreOf('landscape'),
				portrait: centreOf('portrait'),
			},
		};
		if (old.slotId) grid.slotId = old.slotId;
		if (old.zIndex !== undefined) grid.zIndex = old.zIndex;
		nodes[idx] = grid;
		next[activeSceneIdx] = { ...sc, nodes };
		scenes = next;
		markDirty();
	}

	/**
	 * "Convert to parametric button" (B6): flip a coded HUD button `bind` container
	 * into the parametric `componentInstance(button)` node, in-place by id so the
	 * selection survives. `buttonBindToInstance` (engine-layout, the single source)
	 * carries the transform byte-for-byte (id / label / x / y / anchor / scale /
	 * overrides / zIndex / slotId / preview) + maps the bound `UiButton*` to its
	 * `{ action, icon? }`, so the button lands in the same spot it sat — parity. The
	 * author then edits action / icon / style on the resulting instance.
	 */
	function onConvertToParametricButton(id: string): void {
		const next = scenes.slice();
		const sc = next[activeSceneIdx];
		const nodes = sc.nodes.slice();
		const idx = nodes.findIndex((n) => n.id === id);
		if (idx === -1) return;
		const old = nodes[idx];
		if (old.kind !== 'container') return;
		const instance = buttonBindToInstance(old);
		if (!instance) return;
		nodes[idx] = instance;
		next[activeSceneIdx] = { ...sc, nodes };
		scenes = next;
		markDirty();
	}

	// ---------- persistence ----------

	const AUTOSAVE_MS = 1200;
	const RELATIVE_TICK_MS = 15_000;

	/** True after loading a reference layout, until the first edit — signals the
	 * on-screen layout is an unsaved preview (autosave hasn't touched the doc). */
	let loadedPreview = $state(false);
	/** The project's OWN game type (from its saved doc / resolved template). Used to
	 * flag a cross-type reference load that would overwrite a different game's doc. */
	const projectGameType = data.doc.gameType ?? data.template?.gameType ?? '';
	/** True after loading a reference/blank layout whose game type ≠ this project's.
	 * While set, AUTOSAVE is suppressed so an edit can't silently overwrite the
	 * project's real (different-type) saved doc — the user must Save or Discard.
	 * This is the guard against the "Lines layout clobbered my bookOf project" bug. */
	let crossTypeLoaded = $state(false);
	/** The mismatched game type currently previewed (for the warning copy). */
	let crossTypeFrom = $state('');
	/** General error string for the tool bar — set by the save path AND by kind/import loads. */
	let lastError = $state('');
	let lastSavedAt = $state(data.doc.updatedAt || '');

	/**
	 * Doc save-state machine (multi-user-concurrency Phase 2a). LEADING 1200 ms debounce
	 * (`resetDebounceOnEveryEdit:false`): the timer arms only on the clean→dirty edge and later
	 * edits do NOT reset it — reproducing the old `$effect`-on-`dirty` idiom; undo/redo re-arms
	 * imperatively via `rearmAutosave()`. `canAutosave` suppresses autosave while a cross-type
	 * preview is loaded (Save/Discard only). Create encoding stays caller-side (form `''`). The
	 * pill stays BESPOKE (relative-time saved, span+Retry error, interleaved crossType/preview),
	 * driven off this machine's `status`/`dirty`/`busy`/`etag`/`message`.
	 */
	/**
	 * Soft edit lease (multi-user-concurrency Phase 2c) over this project's editor doc
	 * (`docKey:'editor'`). When another author holds it, `lease.readOnly` is true → the doc
	 * `saveState` refuses to autosave OR save (its `blockWhen`), the Save button disables, and
	 * `<PresenceBanner>` names the holder with a Take over. The TEMPLATE saveState below is left
	 * UNLEASED — its key is a GLOBAL `_shared/editor-templates/*` doc, not this project's, so a
	 * per-project lease can't cover it; its `If-Match` CAS is its floor.
	 */
	const lease = new LeaseState({
		toolId: 'editor',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: 'editor',
		enabled: data.projectKey.length > 0,
	});

	const saveState = new SaveState({
		autosaveMs: AUTOSAVE_MS,
		resetDebounceOnEveryEdit: false,
		initialEtag: data.docEtag,
		conflictMessage: 'Someone else saved this project while you were editing.',
		canAutosave: () => !crossTypeLoaded,
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			const fields: Record<string, string> = { doc: JSON.stringify(buildDocPayload()) };
			// '' encodes "no doc existed when I loaded" (FormData has no null); omitted when forcing.
			if (force) fields.force = '1';
			else fields.baseEtag = baseEtag ?? '';
			const out = (await postAction('save', fields)) as {
				saved?: boolean;
				updatedAt?: string;
				etag?: string | null;
				error?: string;
				conflict?: boolean;
			};
			if (out.conflict) return { ok: false, reason: 'conflict', message: out.error };
			if (out.error) return { ok: false, reason: 'error', message: out.error };
			lastSavedAt = out.updatedAt ?? new Date().toISOString();
			loadedPreview = false;
			crossTypeLoaded = false;
			crossTypeFrom = '';
			return { ok: true, etag: out.etag ?? null };
		},
	});

	/** Bumped every `RELATIVE_TICK_MS` so the "Saved Ns ago" label refreshes. */
	let nowTick = $state(Date.now());

	// ---------- undo / redo history ----------
	// Snapshot-based: every edit funnels through `markDirty()`, so we record the doc
	// (scenes + mainSizesMap) there. Rapid edits within HISTORY_COALESCE_MS — one drag,
	// a burst of typing in a property field — collapse into ONE undo step. Canvas drags
	// already commit `onDirty` once on mouse-up, so they're naturally a single step.
	type DocSnapshot = { scenes: Scene[]; mainSizesMap: typeof mainSizesMap };
	const HISTORY_MAX = 80;
	const HISTORY_COALESCE_MS = 350;
	/** A plain (non-proxied) deep clone of the current doc — safe to push on a stack. */
	function snapshotDoc(): DocSnapshot {
		return {
			scenes: $state.snapshot(scenes) as Scene[],
			mainSizesMap: $state.snapshot(mainSizesMap) as typeof mainSizesMap,
		};
	}
	let undoStack = $state<DocSnapshot[]>([]);
	let redoStack = $state<DocSnapshot[]>([]);
	/** Bumped on undo/redo to force the canvas to repaint (a position-only restore
	 * reassigns `scenes` but changes no node count, so the composite can stay stale). */
	let canvasRedrawNonce = $state(0);
	/** The last committed snapshot — the baseline a new burst is recorded against. */
	let historyBaseline: DocSnapshot = snapshotDoc();
	let burstActive = false;
	let burstTimer: ReturnType<typeof setTimeout> | null = null;
	const canUndo = $derived(undoStack.length > 0);
	const canRedo = $derived(redoStack.length > 0);

	/** Record one edit into history (called from `markDirty`). The first edit of a
	 * burst pushes the pre-burst baseline; the burst settles (committing the new
	 * baseline) once edits stop for HISTORY_COALESCE_MS. */
	function recordEdit(): void {
		if (!burstActive) {
			undoStack = [...undoStack, historyBaseline].slice(-HISTORY_MAX);
			redoStack = [];
			burstActive = true;
		}
		if (burstTimer) clearTimeout(burstTimer);
		burstTimer = setTimeout(settleBurst, HISTORY_COALESCE_MS);
	}
	/** Close the current burst: the live doc becomes the new baseline. */
	function settleBurst(): void {
		if (burstTimer) {
			clearTimeout(burstTimer);
			burstTimer = null;
		}
		if (!burstActive) return;
		historyBaseline = snapshotDoc();
		burstActive = false;
	}
	/** Reset history to a clean baseline (after a wholesale load that replaces the doc,
	 * so you can't "undo" past a deliberate layout swap). */
	function resetHistory(): void {
		settleBurst();
		undoStack = [];
		redoStack = [];
		historyBaseline = snapshotDoc();
	}
	function applySnapshot(snap: DocSnapshot): void {
		// A fresh detached copy so future in-place edits can't mutate the stack entry.
		// `structuredClone` throws `DataCloneError` on `$state`-derived values here; the
		// doc is pure JSON, so round-trip through JSON is the safe clone (see the /flow
		// undo/redo fix for the same trap).
		scenes = JSON.parse(JSON.stringify(snap.scenes)) as Scene[];
		mainSizesMap = JSON.parse(JSON.stringify(snap.mainSizesMap)) as typeof mainSizesMap;
		pruneSelection();
		activeSceneIdx = Math.min(activeSceneIdx, Math.max(0, scenes.length - 1));
		// The apply itself is not a new edit (don't recordEdit) — but it must persist.
		// A `true→true` dirty write arms nothing on its own (leading debounce), so re-arm the
		// autosave timer imperatively — the old `restartAutosave()`.
		saveState.setDirty(true);
		loadedPreview = false;
		lastError = '';
		saveState.rearmAutosave();
		canvasRedrawNonce += 1; // force the canvas to repaint the restored positions
	}
	function undo(): void {
		settleBurst();
		if (undoStack.length === 0) return;
		const prev = undoStack[undoStack.length - 1];
		undoStack = undoStack.slice(0, -1);
		redoStack = [...redoStack, snapshotDoc()];
		applySnapshot(prev);
		historyBaseline = snapshotDoc();
	}
	function redo(): void {
		settleBurst();
		if (redoStack.length === 0) return;
		const nextSnap = redoStack[redoStack.length - 1];
		redoStack = redoStack.slice(0, -1);
		undoStack = [...undoStack, snapshotDoc()].slice(-HISTORY_MAX);
		applySnapshot(nextSnap);
		historyBaseline = snapshotDoc();
	}
	/** Drop any selected ids that no longer exist (e.g. after an undo removed them). */
	function pruneSelection(): void {
		if (selectedIds.length === 0) return;
		const kept = selectedIds.filter((id) => scenes.some((sc) => findById(sc.nodes, id) !== null));
		if (kept.length !== selectedIds.length) selectedIds = kept;
	}

	function markDirty(): void {
		recordEdit();
		saveState.markDirty();
		loadedPreview = false; // a real edit commits the (possibly loaded) layout
		// Editing clears a stale save error — but NOT a conflict, whose message is the
		// banner's only explanation and whose state must survive until the author
		// resolves it. Blanking it here would leave "⚠ Someone else saved this" with an
		// empty tooltip on the very next keystroke.
		if (saveState.status !== 'conflict') lastError = '';
		// Force the canvas to repaint after ANY property-panel edit. The canvas redraw
		// effects track a field whitelist (node COUNT, scene space/align, author param
		// defaults) + this nonce — they do NOT deep-track per-node `params`/`bind.props`/
		// `transform`, so an instance-param / HUD-text / colour edit would otherwise never
		// repaint. Bumping here (every edit routes through `markDirty`) makes every change
		// visible live, matching drag/undo which already bump the nonce.
		canvasRedrawNonce += 1;
	}

	// ---------- canvas size (MAIN box per layoutType) ----------
	// The doc's `mainSizesMap[layoutType]` IS the game's MAIN box the runtime scales to
	// the window (via `<MainContainer>`). Editing it here routes through `markDirty()` so
	// it coalesces into ONE undo step + autosaves; the canvas already reacts to the
	// `mainSizesMap` `$state`. A fresh project SEEDS this from the game-type reference
	// (server); the runtime ADOPTS whatever the doc ships (`setAuthoredMainSizesMap`), so a
	// drifted box no longer means "editor ≠ game" — it only moves the coded parts that are
	// laid out relative to the box (the reel board). See the mismatch warning below.
	function setCanvasDimension(dim: 'width' | 'height', value: number): void {
		if (!Number.isFinite(value) || value <= 0) return;
		const next = Math.round(value);
		if (mainSizesMap[currentLayoutType][dim] === next) return;
		mainSizesMap[currentLayoutType][dim] = next;
		markDirty();
	}

	/** The game-type reference's canonical canvas box (plain JSON from the server), or
	 * `null` for a game type without a reference layout. */
	const referenceMainSizes = data.referenceMainSizes;
	/** The layoutTypes whose current box differs from the game-type reference — drives the
	 * non-blocking mismatch warning. Empty when there's no reference or the doc matches. */
	const canvasMismatches = $derived.by(() => {
		if (!referenceMainSizes) return [] as LayoutType[];
		return layoutTypes.filter((lt) => {
			const ref = referenceMainSizes[lt];
			const cur = mainSizesMap[lt];
			return !ref || !cur || ref.width !== cur.width || ref.height !== cur.height;
		});
	});
	/** Snap the WHOLE `mainSizesMap` to the game-type reference (the one-click fix for an
	 * already-drifted doc). Clones from the plain server JSON — never a `$state` proxy
	 * (`structuredClone` on a proxy throws here). */
	function matchGameBox(): void {
		if (!referenceMainSizes) return;
		mainSizesMap = structuredClone(referenceMainSizes);
		markDirty();
	}

	function buildDocPayload() {
		const settings = buildGameSettings();
		const payload: {
			version: number;
			projectKey: string;
			gameType: string;
			mainSizesMap: typeof mainSizesMap;
			scenes: Scene[];
			settings?: GameSettings;
			updatedAt: string;
		} = {
			version: data.doc.version,
			projectKey: data.projectKey,
			gameType: authoringGameType,
			mainSizesMap,
			scenes,
			updatedAt: lastSavedAt,
		};
		if (settings) payload.settings = settings;
		return payload;
	}

	async function postAction(action: string, body: Record<string, string>): Promise<unknown> {
		const fd = new FormData();
		for (const [k, v] of Object.entries(body)) fd.set(k, v);
		// Preserve the page's explicit `?project=` (project-explicit scoping) so the
		// save action targets the SAME project the page was loaded for. A bare
		// `?/save` would resolve to `/editor?/save` and DROP the query, making the
		// save fall back to the session scope — the exact wrong-project footgun.
		// SvelteKit's action selector must stay the literal `/<action>` key, so the
		// existing query is appended as extra params (not re-encoded). No
		// `?project=` ⇒ this is just `?/save`, byte-identical to before.
		const existing = location.search.replace(/^\?/, '');
		const target = existing ? `?/${action}&${existing}` : `?/${action}`;
		const res = await fetch(target, { method: 'POST', body: fd });
		const json = (await res.json()) as { type: string; data?: string };
		if (!json.data) return {};
		const parsed = JSON.parse(json.data) as unknown[];
		const root = parsed[0] as Record<string, number>;
		const out: Record<string, unknown> = {};
		for (const [key, idx] of Object.entries(root)) out[key] = parsed[idx];
		return out;
	}

	/**
	 * Persist the doc, guarded by the ETag this tab loaded. Resolves TRUE only when the
	 * doc actually reached R2 — callers that navigate away on a flush (the component
	 * editor hops) MUST check it, or a refused save silently discards the author's work.
	 *
	 * `force` drops the guard — an explicit, informed "overwrite their version with
	 * mine", only ever reachable from the conflict banner. Delegates the machine (ETag CAS,
	 * conflict stickiness, coalescing, autosave) to {@link saveState}; this wrapper only mirrors
	 * the outcome into the general `lastError` string the bespoke pill reads.
	 */
	async function save(force = false): Promise<boolean> {
		const saved = await saveState.save({ force });
		if (saved) {
			lastError = '';
		} else if (saveState.status === 'conflict') {
			// Keep the local doc and stay dirty — never discard the author's work here.
			lastError = saveState.message || 'Someone else saved this project while you were editing.';
		} else if (saveState.status === 'error') {
			lastError = saveState.message;
		}
		return saved;
	}

	// ---------- template authoring (§7.5) ----------

	/** Known game types (mirrors game-spec's GameTypeSchema) — what a saved
	 * template is keyed by in R2. Lets you author e.g. a `bookOf` template even
	 * though a project's resolved game type defaults to `lines` for now. */
	const GAME_TYPES = ['lines', 'ways', 'cluster', 'scatter', 'bookOf'] as const;
	/** The game type the authored template is saved under (§7.5). */
	let authoringGameType = $state<string>(data.template?.gameType ?? 'lines');

	// ---------- game settings (jurisdiction + player-led speed features) ----------
	// Doc-level UI settings the engine reads at boot via `setUiFeatures`. Absent in the
	// doc ⇒ engine defaults (all speed features on), so the editor initialises to all-on
	// and `jurisdiction: 'default'`. `jurisdiction: 'UK'` forces every feature off (UKGC
	// ban) regardless of the individual toggles — the runtime applies that override, but
	// the panel also greys the toggles so the author sees the consequence.
	let jurisdiction = $state<GameJurisdiction>(data.doc.settings?.jurisdiction ?? 'default');
	let featureTurbo = $state<boolean>(data.doc.settings?.features?.turbo ?? true);
	let featureAutoplay = $state<boolean>(data.doc.settings?.features?.autoplay ?? true);
	let featureSpaceHold = $state<boolean>(data.doc.settings?.features?.spaceHold ?? true);
	const ukLocked = $derived(jurisdiction === 'UK');

	/** Build the doc's `settings` object from the panel state (omitted entirely when
	 * it matches the engine default — `default` jurisdiction + every feature on — so a
	 * pristine doc stays `settings`-free, additive/parity with older docs). */
	function buildGameSettings(): GameSettings | undefined {
		const allOn = featureTurbo && featureAutoplay && featureSpaceHold;
		if (jurisdiction === 'default' && allOn) return undefined;
		const settings: GameSettings = {};
		if (jurisdiction !== 'default') settings.jurisdiction = jurisdiction;
		if (!allOn) {
			settings.features = {
				turbo: featureTurbo,
				autoplay: featureAutoplay,
				spaceHold: featureSpaceHold,
			};
		}
		return settings;
	}

	function onGameSettingChange(): void {
		markDirty();
	}

	/** Load (and display) the chosen game type's template — R2 override or
	 * built-in fallback, via the GET endpoint. 404 = no template for that type,
	 * so we clear the slot panel. Reseeds slotMeta so `required` flags show. */
	async function loadTemplateFor(gameType: string): Promise<void> {
		try {
			const res = await fetch(`/api/editor/template?gameType=${encodeURIComponent(gameType)}`);
			if (res.ok) {
				const out = (await res.json()) as { template: GameTemplate; etag: string | null };
				activeTemplate = out.template;
				// Adopt the new game type's etag — a save must CAS against the object it is
				// actually about to write, not the one the page happened to load with.
				templateState.adoptEtag(out.etag);
			} else {
				activeTemplate = undefined;
				templateState.adoptEtag(null);
			}
		} catch {
			activeTemplate = undefined;
			templateState.adoptEtag(null);
		}
		slotMeta = seedSlotMeta(activeTemplate);
	}

	/** Pick the project's game type: load that template's slots AND persist the
	 * choice into the doc (autosave writes `gameType`), so it sticks across reloads
	 * instead of resetting to the resolved default each session. */
	async function onGameTypeChange(): Promise<void> {
		await loadTemplateFor(authoringGameType);
		markDirty();
	}

	/** Last template save outcome shown via the save-pill styling near the action. */
	let templateStatus = $state<{ kind: 'ok' | 'error'; message: string } | null>(null);

	/**
	 * Template save-state machine — a SEPARATE instance for the GLOBAL
	 * `_shared/editor-templates/<gameType>.json`. Manual save; conflict is surfaced by
	 * `saveTemplate`'s `confirm()` (no scope-mismatch — a project can't wrong-target a global
	 * key). Re-adopts the etag on every template load (`loadTemplateFor`) since switching game
	 * type switches the object.
	 */
	const templateState = new SaveState({
		initialEtag: data.templateEtag,
		conflictMessage: 'Someone else changed this template.',
		save: async ({ baseEtag, force }) => {
			const res = await postTemplate(force ? { force: true } : { baseEtag });
			if (res.status === 409) {
				const body = (await res.json().catch(() => ({}))) as { message?: string };
				return { ok: false, reason: 'conflict', message: body.message };
			}
			if (!res.ok) {
				let message = 'Template save failed';
				try {
					const body = (await res.json()) as { message?: string };
					if (body?.message) message = body.message;
				} catch {
					/* non-JSON error body */
				}
				return { ok: false, reason: 'error', message };
			}
			const body = (await res.json().catch(() => ({}))) as { etag?: string | null };
			return { ok: true, etag: body.etag ?? null };
		},
	});

	/** Map every node carrying a `slotId` (recursing containers) to a `TemplateSlot`. */
	function collectSlots(nodes: LayoutNode[], into: TemplateSlot[]): TemplateSlot[] {
		for (const n of nodes) {
			const slotId = n.slotId?.trim();
			if (slotId) {
				const kind: SlotKind = n.bind || n.kind === 'container' ? 'mount' : (n.kind as SlotKind);
				const slot: TemplateSlot = { slotId, name: n.label || slotId, kind };
				if (n.bind?.component) slot.mountComponent = n.bind.component;
				if (slotMeta[slotId]?.required) slot.required = true;
				into.push(slot);
			}
			if (n.kind === 'container') collectSlots(n.children, into);
		}
		return into;
	}

	function buildTemplate(): GameTemplate {
		return {
			gameType: authoringGameType,
			version: 1,
			scenes: scenes.map((s) => ({
				id: s.id,
				name: s.name,
				slots: collectSlots(s.nodes, []),
			})),
		};
	}

	function postTemplate(extra: Record<string, unknown>): Promise<Response> {
		return fetch('/api/editor/template', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...buildTemplate(), ...extra }),
		});
	}

	async function saveTemplate(): Promise<void> {
		if (templateState.busy) return;
		templateStatus = null;
		// The template key is GLOBAL (one per game type, every project shares it), so the other
		// author may be on a different project entirely. Confirm before discarding their slot
		// edits — silently replacing them is what Phase 1 exists to stop.
		let ok = await templateState.save();
		if (!ok && templateState.status === 'conflict') {
			const msg = templateState.message;
			if (!confirm(`${msg}\n\nOverwrite their version with yours?`)) {
				templateStatus = { kind: 'error', message: msg };
				return;
			}
			ok = await templateState.save({ force: true });
		}
		templateStatus = ok
			? { kind: 'ok', message: 'Template saved' }
			: { kind: 'error', message: templateState.message || 'Template save failed' };
	}

	// ---------- spine upload (sync a folder of Spine assets to R2) ----------

	/** Allowed spine asset extensions — mirrors the server's SPINE_ASSET_EXT. */
	const SPINE_EXT = ['.atlas', '.json', '.skel', '.png', '.webp', '.jpg', '.jpeg'];

	let spineFileInput = $state<HTMLInputElement | null>(null);
	let spineUploadBusy = $state(false);
	let spineUploadStatus = $state<{ kind: 'ok' | 'error' | 'busy'; message: string } | null>(null);

	function hasSpineExt(name: string): boolean {
		const lower = name.toLowerCase();
		return SPINE_EXT.some((ext) => lower.endsWith(ext));
	}

	/** Map a picked file to its `spines/<bundle>/<file>` relpath. If a `spines`
	 * folder is anywhere in the picked tree, take everything after it; otherwise
	 * keep the full relative path — so picking the `spines` folder, a parent of it,
	 * OR a single bundle folder all nest correctly (instead of flattening files to
	 * the spines root, where the bundle-folder listing can't see them). */
	function relpathFor(file: File): string {
		const raw = (file.webkitRelativePath || file.name).replace(/\\/g, '/');
		const afterSpines = raw.match(/(?:^|\/)spines\/(.+)$/i);
		return afterSpines ? afterSpines[1] : raw;
	}

	async function onSpinesPicked(e: Event): Promise<void> {
		const input = e.currentTarget as HTMLInputElement;
		const picked = input.files ? Array.from(input.files) : [];
		input.value = '';
		if (spineUploadBusy) return;

		const files = picked
			.map((f) => ({ file: f, relpath: relpathFor(f) }))
			.filter((f) => f.relpath && hasSpineExt(f.relpath));
		if (files.length === 0) {
			spineUploadStatus = { kind: 'error', message: 'No spine asset files in that folder.' };
			return;
		}

		spineUploadBusy = true;
		spineUploadStatus = { kind: 'busy', message: `Uploading 0/${files.length}…` };
		try {
			const presignRes = await fetch('/api/editor/spines/upload', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ files: files.map((f) => f.relpath) }),
			});
			if (!presignRes.ok)
				throw new Error(await readApiError(presignRes, 'Could not prepare upload'));
			const { uploads } = (await presignRes.json()) as {
				uploads: { relpath: string; url: string; contentType: string }[];
			};
			const byRelpath = new Map(uploads.map((u) => [u.relpath, u]));

			let done = 0;
			for (const { file, relpath } of files) {
				const target = byRelpath.get(relpath);
				if (!target) throw new Error(`Server did not sign ${relpath}`);
				const put = await fetch(target.url, {
					method: 'PUT',
					headers: { 'content-type': target.contentType },
					body: file,
				});
				if (!put.ok) throw new Error(`Upload failed for ${relpath} (${put.status})`);
				done += 1;
				spineUploadStatus = { kind: 'busy', message: `Uploading ${done}/${files.length}…` };
			}

			spineUploadStatus = { kind: 'busy', message: 'Building skeletons.json…' };
			const reindexRes = await fetch('/api/editor/spines/reindex', { method: 'POST' });
			if (!reindexRes.ok) throw new Error(await readApiError(reindexRes, 'Reindex failed'));
			const reindex = (await reindexRes.json()) as { count: number };

			spineUploadStatus = {
				kind: 'ok',
				message: `Uploaded ${files.length} files · ${reindex.count} skeletons`,
			};
			await refreshAssets();
		} catch (err) {
			spineUploadStatus = {
				kind: 'error',
				message: err instanceof Error ? err.message : 'Spine upload failed.',
			};
		} finally {
			spineUploadBusy = false;
		}
	}

	/** API routes return `{ message }` for thrown `error(...)`; fall back to a label. */
	async function readApiError(res: Response, fallback: string): Promise<string> {
		try {
			const body = (await res.json()) as { message?: string };
			if (body?.message) return body.message;
		} catch {
			/* non-JSON error body */
		}
		return `${fallback} (${res.status})`;
	}

	/** Re-pull the editor route data so the freshly synced spines appear in the list. */
	async function refreshAssets(): Promise<void> {
		await invalidateAll();
	}

	function onBeforeUnload(e: BeforeUnloadEvent): void {
		if (!saveState.dirty) return;
		e.preventDefault();
		e.returnValue = '';
	}

	/** Guards overlapping component refetches (see {@link onVisibilityChange}). */
	let refreshingComponents = false;

	/** When this tab regains focus, re-pull the project's components — a component
	 * created/saved in the Component Editor (separate tab OR window) shows up without a
	 * full reload. Bound to BOTH `visibilitychange` and window `focus`: the Component
	 * Editor opens in a new tab via `window.open`, but if the user pops it into its own
	 * WINDOW both tabs stay `visibilityState: 'visible'`, so `visibilitychange` never
	 * fires on return — `focus` covers that case. */
	async function onVisibilityChange(): Promise<void> {
		if (document.visibilityState !== 'visible' || refreshingComponents) return;
		refreshingComponents = true;
		try {
			const res = await fetch(
				`/api/editor/components?project=${encodeURIComponent(data.projectKey)}`,
			);
			if (res.ok) components = (await res.json()) as ComponentDef[];
		} catch {
			/* transient fetch failure — keep the current list */
		} finally {
			refreshingComponents = false;
		}
	}

	/** True when a keystroke is destined for a text field — so editor shortcuts
	 * (undo, copy/paste, duplicate) don't hijack typing in the panels. */
	function isTypingTarget(t: EventTarget | null): boolean {
		const el = t as HTMLElement | null;
		return (
			!!el &&
			(el.tagName === 'INPUT' ||
				el.tagName === 'TEXTAREA' ||
				el.tagName === 'SELECT' ||
				el.isContentEditable)
		);
	}

	/** Page-level editor shortcuts (the canvas owns Delete/Escape on its own listener).
	 * Undo/redo here; copy/cut/paste/duplicate are added in the clipboard block. */
	function onEditorKeyDown(e: KeyboardEvent): void {
		if (isTypingTarget(e.target)) return;
		const mod = e.ctrlKey || e.metaKey;
		if (!mod) return;
		const k = e.key.toLowerCase();
		if (k === 'z' && !e.shiftKey) {
			e.preventDefault();
			undo();
		} else if ((k === 'z' && e.shiftKey) || k === 'y') {
			e.preventDefault();
			redo();
		} else if (k === 'c') {
			if (copySelection()) e.preventDefault();
		} else if (k === 'x') {
			if (cutSelection()) e.preventDefault();
		} else if (k === 'v') {
			if (pasteClipboard()) e.preventDefault();
		} else if (k === 'd') {
			if (duplicateSelection()) e.preventDefault();
		}
	}

	/** Release the lease on tab close (best-effort; expiry is the real backstop). */
	function onUnloadReleaseLease(): void {
		lease.release();
	}

	onMount(() => {
		loadUiState();
		uiLoaded = true;
		void lease.start();
		window.addEventListener('beforeunload', onBeforeUnload);
		window.addEventListener('pagehide', onUnloadReleaseLease);
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('focus', onVisibilityChange);
		window.addEventListener('keydown', onEditorKeyDown);
		const id = window.setInterval(() => (nowTick = Date.now()), RELATIVE_TICK_MS);
		return () => {
			window.removeEventListener('beforeunload', onBeforeUnload);
			window.removeEventListener('pagehide', onUnloadReleaseLease);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('focus', onVisibilityChange);
			window.removeEventListener('keydown', onEditorKeyDown);
			window.clearInterval(id);
			saveState.cancelAutosave();
			lease.release();
		};
	});

	function relativeTime(iso: string, now: number): string {
		if (!iso) return 'never';
		const t = Date.parse(iso);
		if (Number.isNaN(t)) return 'just now';
		const diff = Math.max(0, Math.floor((now - t) / 1000));
		if (diff < 5) return 'just now';
		if (diff < 60) return `${diff}s ago`;
		const m = Math.floor(diff / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		if (h < 24) return `${h}h ago`;
		const d = Math.floor(h / 24);
		return `${d}d ago`;
	}
	const savedAgo = $derived(relativeTime(lastSavedAt, nowTick));
</script>

<svelte:head><title>Invisible Scene Editor — Invisible Wall</title></svelte:head>

<div class="shell">
	<ToolTopBar
		current="editor"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			<span class="counter">{sceneCount} {sceneCount === 1 ? 'scene' : 'scenes'}</span>
			<span class="dot-sep">·</span>
			<span class="counter">
				{atlasCount} atlases · {spineCount} spines · {sheetCount} sheets
			</span>
		{/snippet}
	</ToolTopBar>

	<!-- Dedicated editor action row. Kept OFF the ToolTopBar chrome (mirrors the Component
	     Editor) so the top row gives the brand + project scope + tool switcher their full
	     width, and the save/warnings/mode controls get their own space — wrapping to a
	     second line before anything clips on a narrow window. -->
	<div class="editor-bar">
		<div class="eb-group">
			{#if lease.readOnly}
				<PresenceBanner {lease} />
			{:else if saveState.busy}
				<span class="save-pill busy">Saving…</span>
			{:else if saveState.status === 'conflict'}
				<span class="save-pill error" title={lastError}>⚠ Someone else saved this</span>
				<button
					class="save-btn"
					type="button"
					title="Discard YOUR changes and load their version."
					onclick={() => location.reload()}
				>
					Reload theirs
				</button>
				<button
					class="save-btn"
					type="button"
					title="Overwrite THEIR version with yours. Their changes since you loaded will be lost."
					onclick={() => void save(true)}
				>
					Overwrite with mine
				</button>
			{:else if lastError}
				<span class="save-pill error" title={lastError}>Save failed</span>
				<button class="save-btn" type="button" onclick={() => void save()}>Retry</button>
			{:else if crossTypeLoaded}
				<span
					class="save-pill error"
					title={`A "${crossTypeFrom}" layout is loaded over your "${projectGameType}" project. It will NOT autosave — Save converts the project, Discard restores it.`}
				>
					⚠ {crossTypeFrom} ≠ {projectGameType} — won't autosave
				</span>
				<button class="save-btn" type="button" onclick={() => void save()}>
					Save as {crossTypeFrom}
				</button>
				<button class="save-btn" type="button" onclick={discardCrossType}>Discard</button>
			{:else if saveState.dirty}
				<span class="save-pill dirty">Unsaved changes</span>
				<button class="save-btn" type="button" onclick={() => void save()}>Save</button>
			{:else if loadedPreview}
				<span
					class="save-pill dirty"
					title="A loaded reference layout is on screen but not saved — edit anything, or click Save, to keep it."
				>
					Preview — not saved
				</span>
				<button class="save-btn" type="button" onclick={() => void save()}>Save</button>
			{:else}
				<span class="save-pill ok" title={lastSavedAt || ''}>Saved {savedAgo}</span>
			{/if}
			{#if warnings.length > 0}
				<span class="save-pill error" title="Required template slots with no node filling them">
					{warnings.length}
					{warnings.length === 1 ? 'slot' : 'slots'} empty
				</span>
			{/if}
			{#if contentWarnings.length > 0}
				<span
					class="save-pill warn"
					title={contentWarnings.map((w) => w.message).join('\n')}
					role="button"
					tabindex="0"
					onclick={() => (showContentWarnings = !showContentWarnings)}
					onkeydown={(e) => {
						if (e.key === 'Enter' || e.key === ' ') showContentWarnings = !showContentWarnings;
					}}
				>
					{contentWarnings.length}
					asset {contentWarnings.length === 1 ? 'issue' : 'issues'}
				</span>
			{/if}
		</div>

		<div class="eb-group">
			{#if componentBusy}
				<span class="save-pill busy">Creating component…</span>
			{:else if componentStatus?.kind === 'error'}
				<span class="save-pill error" title={componentStatus.message}>Component failed</span>
			{:else if componentStatus?.kind === 'ok'}
				<span class="save-pill ok" title="Opened in the Component Editor (new tab)">
					{componentStatus.message}
				</span>
			{/if}
			{#if templateMode}
				<label class="gametype" title="Game type the template is saved under">
					<span>type</span>
					<select bind:value={authoringGameType} onchange={() => void onGameTypeChange()}>
						{#each GAME_TYPES as gt (gt)}
							<option value={gt}>{gt}</option>
						{/each}
					</select>
				</label>
				{#if templateState.busy}
					<span class="save-pill busy">Saving template…</span>
				{:else if templateStatus?.kind === 'error'}
					<span class="save-pill error" title={templateStatus.message}>Template failed</span>
				{:else if templateStatus?.kind === 'ok'}
					<span class="save-pill ok">{templateStatus.message}</span>
				{/if}
				<button class="save-btn" type="button" onclick={() => void saveTemplate()}>
					Save template
				</button>
			{/if}
			<button
				type="button"
				class="save-btn"
				class:active-mode={templateMode}
				aria-pressed={templateMode}
				title="Template editor — a separate, advanced mode for defining a game type's slot schema. Not needed to lay out scenes."
				onclick={() => {
					templateMode = !templateMode;
					rightTab = templateMode ? 'template' : 'properties';
				}}
			>
				{templateMode ? '✕ Close template editor' : 'Template editor'}
			</button>
		</div>
	</div>

	{#if showContentWarnings && contentWarnings.length > 0}
		<div class="warn-panel" role="dialog" aria-label="Asset issues">
			<div class="warn-head">
				<strong>Asset issues</strong>
				<button class="warn-close" type="button" onclick={() => (showContentWarnings = false)}>
					✕
				</button>
			</div>
			<ul class="warn-list">
				{#each contentWarnings as w (w.nodeId)}
					<li>
						<button
							type="button"
							onclick={() => {
								const idx = scenes.findIndex((s) => s.id === w.sceneId);
								if (idx !== -1) activeSceneIdx = idx;
								selectOnly(w.nodeId);
							}}
						>
							{w.message}
						</button>
					</li>
				{/each}
			</ul>
			<p class="warn-foot">
				These nodes reference assets the game can't load — they render blank. Re-assign or remove
				them.
			</p>
		</div>
	{/if}

	<div
		class="layout"
		class:resizing={resizing !== null}
		style="grid-template-columns: {leftWidth}px 1fr {rightWidth}px"
	>
		<aside class="left">
			<div class="scene-bar">
				<div class="load-row">
					<select class="load-select" bind:value={loadChoice} aria-label="Load scenes">
						<option value="">＋ Load scenes…</option>
						{#if fullSceneSets.length > 0 || customKinds.length > 0}
							<optgroup label="New game from kind">
								{#each fullSceneSets as r (r.gameType)}
									<option value={`scaffold:${r.gameType}`}>New {r.name} (engine pieces)</option>
								{/each}
								{#each customKinds as k (k.id)}
									<option value={`kind:${k.id}`}>New {k.name} (engine pieces)</option>
								{/each}
							</optgroup>
						{/if}
						{#if importableKinds.length > 0}
							<optgroup label="Import composed reference">
								{#each importableKinds as r (r.id)}
									<option value={`ref:${r.id}`}>{r.name}</option>
								{/each}
							</optgroup>
						{/if}
					</select>
					<button
						class="load-btn"
						type="button"
						disabled={!loadChoice}
						onclick={() => void loadChosen()}
					>
						Load
					</button>
				</div>
			</div>

			<div class="left-body">
				{#snippet sceneRow(s: (typeof scenes)[number], i: number)}
					{@const hidden = hiddenScenes.has(s.id)}
					<li
						class="screen-li"
						class:dragging={dragSceneIdx === i}
						class:drop-before={dropInfo?.idx === i && !dropInfo.after}
						class:drop-after={dropInfo?.idx === i && dropInfo.after}
						draggable={renamingSceneIdx !== i}
						ondragstart={(e) => onSceneDragStart(e, i)}
						ondragover={(e) => onSceneDragOver(e, i)}
						ondrop={(e) => onSceneDrop(e, i)}
						ondragend={resetSceneDrag}
					>
						<span class="grip" title="Drag to reorder (changes layer order)" aria-hidden="true"
							>⠿</span
						>
						{#if renamingSceneIdx === i}
							<!-- svelte-ignore a11y_autofocus -->
							<input
								class="screen-rename"
								type="text"
								bind:value={renameDraft}
								use:selectOnMount
								onblur={commitRenameScene}
								onkeydown={(e) => {
									if (e.key === 'Enter') commitRenameScene();
									else if (e.key === 'Escape') cancelRenameScene();
								}}
							/>
						{:else}
							<button
								type="button"
								class="screen"
								class:active={i === activeSceneIdx}
								class:dimmed={hidden}
								title="Click to edit · double-click to rename"
								onclick={() => selectScene(i)}
								ondblclick={() => startRenameScene(i)}
							>
								<span class="screen-name">{s.name || s.id}</span>
								{#if s.alwaysOnTop}
									<span
										class="screen-ontop"
										title="Always on top — this screen is pinned above every other screen, so its position in this list is ignored. Untick it in Properties to layer it here."
										aria-label="Always on top">TOP</span
									>
								{:else if s.behindReels}
									<span
										class="screen-behind"
										title="Behind the reels — this screen mounts under the reel board, in front of the background. It still orders against other behind-the-reels screens by its position here."
										aria-label="Behind the reels">UNDER</span
									>
								{/if}
								<span class="screen-count" title="nodes in this screen">{s.nodes.length}</span>
							</button>
						{/if}
						<button
							type="button"
							class="eye"
							class:off={hidden}
							aria-pressed={!hidden}
							title={hidden ? 'Show this screen in the canvas' : 'Hide this screen from the canvas'}
							onclick={() => toggleSceneVisible(s.id)}
						>
							{#if hidden}
								<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
									<path
										d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A9.5 9.5 0 0112 5c5 0 9 4 10 7a12 12 0 01-3 4M6.1 6.1A12 12 0 002 12c1 3 5 7 10 7a9.5 9.5 0 003.3-.6"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
										stroke-linecap="round"
									/>
								</svg>
							{:else}
								<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
									<path
										d="M2 12c1-3 5-7 10-7s9 4 10 7c-1 3-5 7-10 7s-9-4-10-7z"
										fill="none"
										stroke="currentColor"
										stroke-width="2"
									/>
									<circle cx="12" cy="12" r="3" fill="currentColor" />
								</svg>
							{/if}
						</button>
						<button
							type="button"
							class="dup"
							title="Duplicate this screen"
							aria-label="Duplicate this screen"
							onclick={() => duplicateScene(i)}
						>
							<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
								<rect
									x="8"
									y="8"
									width="11"
									height="11"
									rx="2"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
								/>
								<path
									d="M5 15V6a1 1 0 011-1h9"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						</button>
						<button
							type="button"
							class="del"
							title="Delete this screen"
							aria-label="Delete this screen"
							onclick={() => deleteScene(i)}
						>
							<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
								<path
									d="M5 5l14 14M19 5L5 19"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
								/>
							</svg>
						</button>
					</li>
					{#if i === activeSceneIdx}
						<!-- The active screen expands to reveal its outline (node tree + template
						     slots) inline, tree-view style — replacing the old separate Outline tab. -->
						<li class="screen-outline">
							<EditorOutline
								scene={s}
								template={activeTemplate}
								{selectedId}
								{selectedIds}
								onSelect={selectFromOutline}
								{onFillSlot}
								onAddAnchor={onAddMountAnchor}
								onRename={onRenameNode}
							/>
						</li>
					{/if}
				{/snippet}
				<PanelSection id="screens" title="Screens" count={sceneCount}>
					<ul class="screens">
						{#if sceneCount === 0}
							<li class="muted">No scenes yet — load a game scene above.</li>
						{:else}
							{#each gameSceneEntries as { s, i } (s.id)}
								{@render sceneRow(s, i)}
							{/each}
							{#if hudSceneEntries.length > 0}
								<li class="screens-subhead">
									<span>HUD</span>
									<span
										class="sub-note"
										title="The HUD is the top-most UI layer — it always renders above the game screens"
										>top layer</span
									>
								</li>
								{#each hudSceneEntries as { s, i } (s.id)}
									{@render sceneRow(s, i)}
								{/each}
							{/if}
						{/if}
					</ul>

					<button
						class="add-hud-btn"
						type="button"
						title="Create a new blank screen (auto-named). Drag atlas regions onto it to build a layer. Reorder it in the list to set its layer order."
						onclick={addEmptyScreen}
					>
						＋ New empty screen
					</button>

					<button
						class="add-hud-btn"
						type="button"
						title="Create a new full-bleed background screen (cover-fit). Then drag any atlas region onto it — it fills the window edge-to-edge."
						onclick={addBackgroundScreen}
					>
						＋ New background screen
					</button>

					<button
						class="add-hud-btn"
						type="button"
						title={hasHud
							? 'Refresh the HUD scenes to the latest version (resets HUD positions)'
							: 'Add the game HUD (logo/name + bottom bar) as editable scenes, without replacing anything'}
						onclick={addHudLayer}
					>
						{hasHud ? '↻ Reset HUD to default' : '＋ Add HUD layer'}
					</button>

					<button
						class="add-hud-btn"
						type="button"
						title="Create a new blank HUD-layer screen (always on top). Drag atlas regions onto it to build a custom overlay."
						onclick={addHudScreen}
					>
						＋ New HUD screen
					</button>

					{#if missingScreens.length > 0}
						<button
							class="add-hud-btn"
							type="button"
							title={`Add ${missingScreens.length} screen(s) this game has but the layout is missing (e.g. the logo/loading screen) — non-destructive, keeps your edits: ${missingScreens
								.map((s) => s.name || s.id)
								.join(', ')}`}
							onclick={addMissingScreens}
						>
							＋ Add missing screens ({missingScreens.length})
						</button>
					{/if}

					<button
						class="add-hud-btn"
						type="button"
						title="Save the current screens + engine pieces on this canvas as a NEW reusable game kind. It joins the built-ins in 'New game from kind' (the scaffold drops your artist art — engine pieces only)."
						onclick={() => void saveAsNewKind()}
					>
						⧉ Save as new game kind…
					</button>
				</PanelSection>
			</div>
		</aside>

		<main class="canvas-area">
			{#if editScene}
				<EditorCanvas
					scene={editScene}
					scenes={editScenes}
					{mainSizesMap}
					frameWidth={frameSize.width}
					frameHeight={frameSize.height}
					layoutType={currentLayoutType}
					assets={data.assets}
					symbolDefaults={data.symbolDefaults}
					symbolsDoc={data.symbolsDoc}
					gridDimensions={data.gridDimensions}
					repeaterSources={data.repeaterSources}
					{componentMap}
					{spinePreview}
					{spinePreviewNodeId}
					{onSpawn}
					bind:selectedIds
					onDirty={markDirty}
					onDelete={onDeleteNode}
					onDeleteMany={onDeleteNodes}
					redrawNonce={canvasRedrawNonce}
					{fillRequest}
					hiddenSceneIds={hiddenScenes}
					projectGameName={data.gameName}
					onSpineMeta={(meta) => (spineMeta = meta)}
					{canUndo}
					{canRedo}
					onUndo={undo}
					onRedo={redo}
				>
					{#snippet modeBar()}
						<CanvasModeBar
							options={layoutOptions}
							bind:value={currentLayoutType}
							ariaLabel="Authoring layout"
							inline
						/>
					{/snippet}
				</EditorCanvas>
			{/if}
		</main>

		<aside class="properties">
			<div class="tabs" role="tablist" aria-label="Right panel">
				<button
					role="tab"
					aria-selected={rightTab === 'properties'}
					class="tab"
					class:active={rightTab === 'properties'}
					onclick={() => (rightTab = 'properties')}
				>
					Properties
				</button>
				<button
					role="tab"
					aria-selected={rightTab === 'library'}
					class="tab"
					class:active={rightTab === 'library'}
					onclick={() => (rightTab = 'library')}
				>
					Library
				</button>
				{#if templateMode}
					<button
						role="tab"
						aria-selected={rightTab === 'template'}
						class="tab"
						class:active={rightTab === 'template'}
						onclick={() => (rightTab = 'template')}
					>
						Template
					</button>
				{/if}
			</div>

			<div class="tab-body">
				{#if rightTab === 'library'}
					<PanelSection id="lib-elements" title="Elements">
						<ul>
							<EditorElementsPalette
								{onElementDragStart}
								reel={{ active: !!existingReelGrid, onAdd: insertReelGrid }}
								repeater={{ onAdd: insertRepeater }}
							/>
						</ul>
					</PanelSection>

					<input
						bind:this={spineFileInput}
						type="file"
						multiple
						webkitdirectory
						class="hidden-input"
						onchange={(e) => void onSpinesPicked(e)}
					/>
					{#if spineUploadStatus}
						<p class="upload-status" class:error={spineUploadStatus.kind === 'error'}>
							{spineUploadStatus.message}
						</p>
					{/if}
					<EditorAssetLibrary assets={data.assets} bind:expanded>
						{#snippet spineActions()}
							<button
								type="button"
								class="upload-btn"
								disabled={spineUploadBusy}
								title="Pick a folder of Spine bundles to sync to this project (R2)"
								onclick={(e) => {
									e.stopPropagation();
									spineFileInput?.click();
								}}
							>
								{spineUploadBusy ? 'Uploading…' : 'Upload spines'}
							</button>
						{/snippet}
					</EditorAssetLibrary>

					<PanelSection id="lib-components" title="Components" count={components.length}>
						<EditorComponentPanel
							{components}
							onPlace={placeComponentInstance}
							onOpenTool={openComponentEditor}
						/>
					</PanelSection>
				{:else if rightTab === 'template'}
					<EditorTemplatePanel
						template={activeTemplate}
						{scenes}
						activeSceneId={activeScene?.id}
						onPickScene={goToTemplateScene}
						{onFillSlot}
					/>
				{:else}
					<h2>
						Properties
						{#if selectedIds.length > 1}
							<span class="multi-pill">{selectedIds.length} selected</span>
						{/if}
					</h2>
					{#if activeScene}
						<div class="scene-space">
							<h3>Screen</h3>
							<label class="space-field">
								<span>space</span>
								<select
									value={activeScene.space ?? 'game'}
									onchange={(e) => setSceneSpace(e.currentTarget.value)}
									title="Coordinate space this screen authors into (matches the engine's <LayoutScene>)"
								>
									<option value="game">game (main box)</option>
									<option value="standard">standard (HUD box)</option>
									<option value="canvas">canvas (window edges)</option>
									<option value="background">background (cover-fit)</option>
								</select>
							</label>
							<label class="space-field">
								<span>role</span>
								<select
									value={activeScene.role ?? ''}
									onchange={(e) => setSceneRole(e.currentTarget.value)}
									title="Engine role this screen fills — the game finds the loading splash and the base game by ROLE, not by a fixed id, so you can rename screens freely. Tag exactly one scene per role."
								>
									<option value="">— none —</option>
									<option value="loading">loading (splash)</option>
									<option value="basegame">base game</option>
									<option value="buyFeature">buy feature</option>
									<option value="buyConfirm">buy confirm</option>
								</select>
							</label>
							<label
								class="ontop-field"
								title="Layering: normally a screen stacks by its position in the Screens list above — drag it there to re-layer it in-game. Tick this to pin it ABOVE every other screen instead (for a splash or a big-win celebration that must never be buried); its list position is then ignored. Round-blocking engine gates still draw above it."
							>
								<input
									type="checkbox"
									checked={activeScene.alwaysOnTop === true}
									onchange={(e) => setSceneAlwaysOnTop(e.currentTarget.checked)}
								/>
								<span>Always on top</span>
								<span class="ontop-note">
									{activeScene.alwaysOnTop
										? 'pinned above all screens — list order ignored'
										: `layer ${activeSceneIdx + 1} of ${sceneCount} — set by the Screens list`}
								</span>
							</label>
							<label
								class="ontop-field"
								title="Mount this screen BEHIND the reels — in front of the background, under the reel board. The Screens list only orders screens ABOVE the reels (the board is engine-owned), so dragging a screen above the base game row cannot express this on its own. Screens behind the reels still order among themselves by list position."
							>
								<input
									type="checkbox"
									checked={activeScene.behindReels === true}
									onchange={(e) => setSceneBehindReels(e.currentTarget.checked)}
								/>
								<span>Behind the reels</span>
								<span class="ontop-note">
									{activeScene.behindReels
										? 'under the reel board, in front of the background'
										: 'above the reels — tick to move it under the board'}
								</span>
							</label>
							{#if !activeScene.space || activeScene.space === 'game'}
								<label
									class="ontop-field"
									title="Zoom this screen together with the reels during an anticipation. When reel-anticipation fires, the screen scales + pans toward the SAME reel centre as the board, in lockstep — for a 'base game top / bottom' layer that should ride the zoom. Off by default and identity when nothing is anticipating, so the screen renders unchanged until a tease fires. Only applies to game-space screens."
								>
									<input
										type="checkbox"
										checked={activeScene.zoomWithAnticipation === true}
										onchange={(e) => setSceneZoomWithAnticipation(e.currentTarget.checked)}
									/>
									<span>Zoom with anticipation</span>
									<span class="ontop-note">
										{activeScene.zoomWithAnticipation
											? 'zooms toward the reel centre with the board'
											: 'static — tick to ride the anticipation zoom'}
									</span>
								</label>
							{/if}
							{#if activeScene.space === 'standard'}
								<div class="space-aligns">
									<label class="space-field">
										<span>v-align</span>
										<select
											value={activeScene.align?.vertical ?? ''}
											onchange={(e) => setSceneAlign('vertical', e.currentTarget.value)}
										>
											<option value="">centre</option>
											<option value="bottom">bottom</option>
										</select>
									</label>
									<label class="space-field">
										<span>h-align</span>
										<select
											value={activeScene.align?.horizontal ?? ''}
											onchange={(e) => setSceneAlign('horizontal', e.currentTarget.value)}
										>
											<option value="">centre</option>
											<option value="left">left</option>
											<option value="right">right</option>
										</select>
									</label>
								</div>
							{/if}
						</div>
					{/if}
					<EditorProperties
						node={selectedNode}
						layoutType={currentLayoutType}
						onDirty={markDirty}
						sceneSpace={activeScene?.space}
						{templateMode}
						{slotMeta}
						sceneSlots={activeSceneSlots}
						sceneSpineNodes={activeSceneSpineNodes}
						projectGameName={data.gameName}
						isBackgroundCover={isBackgroundCoverSelected}
						{spineMeta}
						spines={data.assets.spines}
						{componentDefs}
						instanceComponent={selectedNode?.kind === 'componentInstance'
							? (componentMap.get(selectedNode.componentId) ?? null)
							: null}
						{pickSheets}
						onEditAsComponent={(c) => void editContainerAsComponent(c)}
						{onConvertToReelGrid}
						{onConvertToParametricButton}
						onSetInstanceParam={(key, value) => {
							if (!selectedNode || selectedNode.kind !== 'componentInstance') return;
							// Override mode (a non-desktop device layout): the edit writes a per-ratio
							// param override at `overrides[currentLayoutType].params[key]`, mirroring how a
							// transform edit routes to `overrides[currentLayoutType]`. Clearing (undefined)
							// removes just that key from the override, then prunes an emptied override —
							// so the ratio reverts to the base param, not the whole node. Base (desktop)
							// edits `node.params` as before (parity).
							if (currentLayoutType !== 'desktop') {
								const overrides = { ...(selectedNode.overrides ?? {}) };
								const o = { ...(overrides[currentLayoutType] ?? {}) };
								const params = { ...(o.params ?? {}) };
								if (value === undefined) delete params[key];
								else params[key] = value;
								if (Object.keys(params).length) o.params = params;
								else delete o.params;
								if (Object.keys(o).length) overrides[currentLayoutType] = o;
								else delete overrides[currentLayoutType];
								selectedNode.overrides = Object.keys(overrides).length ? overrides : undefined;
								markDirty();
								return;
							}
							const params = { ...(selectedNode.params ?? {}) };
							if (value === undefined) delete params[key];
							else params[key] = value;
							selectedNode.params = Object.keys(params).length ? params : undefined;
							markDirty();
						}}
						onPreviewSpine={(preview) => (spinePreview = preview)}
						onSetInstanceStateAnim={(nodeId, state, animation) => {
							if (!selectedNode || selectedNode.kind !== 'componentInstance') return;
							const all = { ...(selectedNode.stateAnimationOverrides ?? {}) };
							const map = { ...(all[nodeId] ?? {}) };
							const trimmed = animation.trim();
							if (trimmed) map[state] = { animation: trimmed, loop: map[state]?.loop };
							else delete map[state];
							if (Object.keys(map).length) all[nodeId] = map;
							else delete all[nodeId];
							selectedNode.stateAnimationOverrides = Object.keys(all).length ? all : undefined;
							markDirty();
						}}
						onSetInstanceStateAnimLoop={(nodeId, state, loop) => {
							if (!selectedNode || selectedNode.kind !== 'componentInstance') return;
							const cur = selectedNode.stateAnimationOverrides?.[nodeId]?.[state];
							if (!cur) return;
							const all = { ...(selectedNode.stateAnimationOverrides ?? {}) };
							all[nodeId] = { ...all[nodeId], [state]: { ...cur, loop: loop || undefined } };
							selectedNode.stateAnimationOverrides = all;
							markDirty();
						}}
						onSetInstanceSpineRest={(nodeId, patch) => {
							if (!selectedNode || selectedNode.kind !== 'componentInstance') return;
							const all = { ...(selectedNode.spineRestOverrides ?? {}) };
							const cur: SpineRestOverride = { ...(all[nodeId] ?? {}) };
							if ('defaultAnimation' in patch) {
								if (patch.defaultAnimation) cur.defaultAnimation = patch.defaultAnimation;
								else delete cur.defaultAnimation;
							}
							if ('loop' in patch) {
								if (patch.loop === undefined) delete cur.loop;
								else cur.loop = patch.loop;
							}
							if ('skin' in patch) {
								if (patch.skin) cur.skin = patch.skin;
								else delete cur.skin;
							}
							if (Object.keys(cur).length) all[nodeId] = cur;
							else delete all[nodeId];
							selectedNode.spineRestOverrides = Object.keys(all).length ? all : undefined;
							markDirty();
						}}
						onSetInstanceCueSignal={(nodeId, origSignal, signal) => {
							if (!selectedNode || selectedNode.kind !== 'componentInstance') return;
							const all = { ...(selectedNode.cueSignalOverrides ?? {}) };
							const map = { ...(all[nodeId] ?? {}) };
							const trimmed = signal.trim();
							if (trimmed) map[origSignal] = trimmed;
							else delete map[origSignal];
							if (Object.keys(map).length) all[nodeId] = map;
							else delete all[nodeId];
							selectedNode.cueSignalOverrides = Object.keys(all).length ? all : undefined;
							markDirty();
						}}
						onOpenComponentEditor={openComponentEditor}
						onUpdateInstanceToLatest={updateInstanceToLatest}
					/>

					<div class="game-settings">
						<PanelSection id="canvas-size" title="Canvas Size">
							<div class="gs-body">
								<p class="gs-note">
									The game's MAIN box for <strong>{currentLayoutType}</strong> — the runtime scales it
									to fill the window. Author your nodes against this box.
								</p>
								<label class="gs-field">
									<span class="gs-label">Width</span>
									<input
										class="cs-input"
										type="number"
										min="1"
										step="1"
										value={mainSizesMap[currentLayoutType].width}
										onchange={(e) => setCanvasDimension('width', e.currentTarget.valueAsNumber)}
									/>
								</label>
								<label class="gs-field">
									<span class="gs-label">Height</span>
									<input
										class="cs-input"
										type="number"
										min="1"
										step="1"
										value={mainSizesMap[currentLayoutType].height}
										onchange={(e) => setCanvasDimension('height', e.currentTarget.valueAsNumber)}
									/>
								</label>
								{#if referenceMainSizes && canvasMismatches.length > 0}
									<div class="cs-warn">
										<p class="cs-warn-text">
											Canvas
											<strong
												>{mainSizesMap[currentLayoutType].width}×{mainSizesMap[currentLayoutType]
													.height}</strong
											>
											doesn't match the {authoringGameType} reference box
											<strong
												>{referenceMainSizes[currentLayoutType]?.width}×{referenceMainSizes[
													currentLayoutType
												]?.height}</strong
											> — the game renders YOUR box, so coded parts (the reel board) sit where this box
											puts them, not the reference's.
										</p>
										<button type="button" class="cs-warn-fix" onclick={matchGameBox}>
											Match game box
										</button>
									</div>
								{/if}
							</div>
						</PanelSection>
					</div>

					<div class="game-settings">
						<PanelSection id="game-settings" title="Game Settings">
							<div class="gs-body">
								<label class="gs-field">
									<span class="gs-label">Jurisdiction</span>
									<select
										class="gs-select"
										bind:value={jurisdiction}
										onchange={onGameSettingChange}
									>
										<option value="default">Default</option>
										<option value="UK">UK (UKGC)</option>
									</select>
								</label>
								<p class="gs-note">
									Player-led <strong>speed</strong> features. UK forces all off (UKGC bans autoplay,
									turbo and hold-to-spin).
								</p>
								<label class="gs-toggle" class:disabled={ukLocked}>
									<input
										type="checkbox"
										checked={ukLocked ? false : featureTurbo}
										disabled={ukLocked}
										onchange={(e) => {
											featureTurbo = e.currentTarget.checked;
											onGameSettingChange();
										}}
									/>
									<span>Turbo</span>
								</label>
								<label class="gs-toggle" class:disabled={ukLocked}>
									<input
										type="checkbox"
										checked={ukLocked ? false : featureAutoplay}
										disabled={ukLocked}
										onchange={(e) => {
											featureAutoplay = e.currentTarget.checked;
											onGameSettingChange();
										}}
									/>
									<span>Autoplay</span>
								</label>
								<label class="gs-toggle" class:disabled={ukLocked}>
									<input
										type="checkbox"
										checked={ukLocked ? false : featureSpaceHold}
										disabled={ukLocked}
										onchange={(e) => {
											featureSpaceHold = e.currentTarget.checked;
											onGameSettingChange();
										}}
									/>
									<span>Hold-to-spin (Space)</span>
								</label>
								{#if ukLocked}
									<p class="gs-locked">UK overrides — all speed features are off in-game.</p>
								{/if}
							</div>
						</PanelSection>
					</div>

					<p class="muted hint">
						Active scene: <strong>{activeScene?.name ?? '—'}</strong> ·
						{activeScene?.nodes.length ?? 0} nodes
					</p>
				{/if}
			</div>
		</aside>

		<PanelResizers
			storageKey={`iw-editor-panels:${data.projectKey}`}
			bind:leftWidth
			bind:rightWidth
			bind:resizing
		/>
	</div>

	<footer class="help-strip">
		<span class="muted">
			Doc updatedAt: <code>{lastSavedAt || '—'}</code>
		</span>
		<span class="muted">version {data.doc.version}</span>
	</footer>
</div>

<style>
	.shell {
		position: relative;
		display: grid;
		grid-template-rows: auto 1fr auto;
		height: 100vh;
		color: #e8e8ee;
		background: #0b0b10;
	}
	.dot-sep {
		color: #444;
	}
	/* Dedicated editor action row, below the shared ToolTopBar chrome (mirrors the
	   Component Editor). Two groups (save/warnings · mode/component) pushed apart;
	   wraps to a second line before anything clips on a narrow window. */
	.editor-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px 12px;
		flex: none;
		padding: 8px 24px;
		border-bottom: 1px solid #1c1c24;
		background: #0d0d12;
	}
	.eb-group {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 10px;
	}
	.counter {
		font-size: 11px;
		color: #888;
	}
	.save-pill {
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid #1f1f28;
		background: #16161c;
		color: #888;
		letter-spacing: 0.02em;
	}
	.save-pill.busy {
		color: #7ee0c0;
		border-color: #234038;
	}
	.save-pill.dirty {
		color: #f0c878;
		border-color: #3a3020;
	}
	.save-pill.error {
		color: #ff9a9a;
		border-color: #4a2a30;
	}
	.save-pill.ok {
		color: #888;
	}
	.save-pill.warn {
		color: #f0c878;
		border-color: #3a3020;
		cursor: pointer;
	}
	.save-pill.warn:hover {
		border-color: #f0c878;
	}
	.warn-panel {
		position: absolute;
		top: 56px;
		right: 24px;
		z-index: 30;
		width: 360px;
		max-height: 50vh;
		overflow-y: auto;
		background: #14141c;
		border: 1px solid #3a3020;
		border-radius: 10px;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.5);
		padding: 12px 14px;
	}
	.warn-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 8px;
	}
	.warn-head strong {
		color: #f0c878;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.warn-close {
		background: transparent;
		border: none;
		color: #888;
		cursor: pointer;
		font-size: 13px;
	}
	.warn-close:hover {
		color: #fff;
	}
	.warn-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.warn-list li {
		background: transparent;
		border: none;
		padding: 0;
	}
	.warn-list button {
		width: 100%;
		text-align: left;
		background: #1a1620;
		border: 1px solid #2a2433;
		color: #e8c89a;
		padding: 6px 9px;
		border-radius: 6px;
		font-size: 11px;
		cursor: pointer;
		font-family: inherit;
	}
	.warn-list button:hover {
		border-color: #f0c878;
	}
	.warn-foot {
		margin: 8px 0 0;
		font-size: 10px;
		color: #777;
		line-height: 1.4;
	}
	.save-btn {
		background: transparent;
		border: 1px solid #2a2a33;
		color: #c8a3ff;
		padding: 3px 10px;
		font-size: 11px;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
	}
	.save-btn:hover {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.save-btn:disabled {
		opacity: 0.4;
		cursor: default;
		border-color: #2a2a33;
		color: #555;
	}
	.save-btn.active-mode {
		background: #1a1622;
		border-color: #6b5bff;
		color: #c8a3ff;
	}
	.scene-bar {
		padding: 12px 16px;
		border-bottom: 1px solid #1c1c24;
		background: #0d0d12;
	}
	.load-row {
		display: flex;
		gap: 6px;
		margin-bottom: 12px;
	}
	.load-select {
		flex: 1;
		min-width: 0;
		background: #16131c;
		color: #c8a3ff;
		border: 1px solid #2a2433;
		border-radius: 6px;
		padding: 6px 8px;
		font-size: 12px;
		font-family: inherit;
	}
	.load-btn {
		background: #1a1622;
		border: 1px solid #6b5bff;
		color: #c8a3ff;
		padding: 6px 14px;
		font-size: 12px;
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
	}
	.load-btn:hover:not(:disabled) {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.load-btn:disabled {
		opacity: 0.4;
		cursor: default;
		border-color: #2a2a33;
		color: #555;
	}
	.add-hud-btn {
		width: 100%;
		margin-top: 8px;
		background: #14201c;
		border: 1px dashed #2f5d57;
		color: #7ee0c0;
		padding: 6px 10px;
		font-size: 11px;
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
	}
	.add-hud-btn:hover {
		border-color: #7ee0c0;
		background: #16241f;
	}
	.scene-space {
		margin-bottom: 14px;
		padding-bottom: 14px;
		border-bottom: 1px solid #1c1c24;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.scene-space h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 2px;
	}
	.space-aligns {
		display: flex;
		gap: 6px;
	}
	.space-field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.space-field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
	}
	.space-field select,
	.space-field input[type='number'] {
		background: #16131c;
		color: #c8a3ff;
		border: 1px solid #2a2433;
		border-radius: 6px;
		padding: 5px 7px;
		font-size: 12px;
		font-family: inherit;
	}
	.screens {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.screen-li {
		display: flex;
		align-items: center;
		gap: 4px;
		position: relative;
	}
	/* The active screen's inline outline tree — a tree-view child under its row.
	   Resets the generic <li> chrome and adds a left rail + indent so it reads as
	   nested content rather than another screen row. */
	.screen-outline {
		display: block;
		background: transparent;
		border: none;
		border-left: 1px solid #23232c;
		border-radius: 0;
		padding: 8px 0 10px 10px;
		margin: 2px 0 6px 6px;
	}
	.screen-li.dragging {
		opacity: 0.4;
	}
	/* Drop indicator: a bright line at the top/bottom edge of the hovered row. */
	.screen-li.drop-before::before,
	.screen-li.drop-after::after {
		content: '';
		position: absolute;
		left: 18px;
		right: 0;
		height: 2px;
		background: #5db0ff;
		border-radius: 2px;
		pointer-events: none;
	}
	.screen-li.drop-before::before {
		top: -2px;
	}
	.screen-li.drop-after::after {
		bottom: -2px;
	}
	.grip {
		flex: none;
		width: 12px;
		text-align: center;
		color: #4a4a56;
		cursor: grab;
		font-size: 12px;
		line-height: 1;
		user-select: none;
	}
	.screen-li:hover .grip {
		color: #7a7a8a;
	}
	.screen-rename {
		flex: 1;
		min-width: 0;
		padding: 7px 9px;
		font-size: 12px;
		font-family: inherit;
		border-radius: 6px;
		border: 1px solid #5db0ff;
		background: #0d1620;
		color: #e8e8ee;
		outline: none;
	}
	.del {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: 6px;
		border: 1px solid #1f1f28;
		background: #16161c;
		color: #8a6a70;
		cursor: pointer;
		padding: 0;
	}
	.del:hover {
		border-color: #b3434f;
		background: #241417;
		color: #ff8a96;
	}
	.dup {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: 6px;
		border: 1px solid #1f1f28;
		background: #16161c;
		color: #8aa0b4;
		cursor: pointer;
		padding: 0;
	}
	.dup:hover {
		border-color: #2f5d7a;
		background: #14202c;
		color: #cfe0ee;
	}
	.multi-pill {
		font-size: 10px;
		font-weight: 600;
		color: #cfe0ee;
		background: #14202c;
		border: 1px solid #2f5d7a;
		border-radius: 999px;
		padding: 1px 8px;
		margin-left: 8px;
		vertical-align: middle;
	}
	.screens-subhead {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin: 8px 0 2px;
		padding: 2px 6px 4px;
		border-top: 1px solid #1c1c24;
		font-size: 10px;
		font-weight: 600;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #7a7a8a;
	}
	.screens-subhead .sub-note {
		font-weight: 500;
		letter-spacing: 0;
		text-transform: none;
		color: #565666;
	}
	.screen {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		text-align: left;
		padding: 7px 9px;
		font-size: 12px;
		border-radius: 6px;
		border: 1px solid #1f1f28;
		background: #16161c;
		color: #c8c8d0;
		cursor: pointer;
		font-family: inherit;
	}
	.screen.dimmed .screen-name {
		opacity: 0.5;
	}
	.eye {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		flex: none;
		border-radius: 6px;
		border: 1px solid #1f1f28;
		background: #16161c;
		color: #8aa0b4;
		cursor: pointer;
		padding: 0;
	}
	.eye:hover {
		border-color: #2f3a48;
		color: #cfe0ee;
	}
	.eye.off {
		color: #5a5a66;
	}
	.screen:hover {
		border-color: #2f3a48;
		background: #1a1a22;
	}
	.screen.active {
		border-color: #5db0ff;
		background: #14202c;
		color: #e8e8ee;
	}
	.screen-name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.screen-count {
		font-size: 10px;
		color: #666;
		background: #0d0d12;
		border-radius: 999px;
		padding: 1px 7px;
	}
	/* "Always on top" marker — this screen opted OUT of the list's layer order. */
	.screen-ontop {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #c8a45c;
		background: #2a2113;
		border: 1px solid #4a3a1c;
		border-radius: 3px;
		padding: 0 4px;
		flex: none;
	}
	.ontop-field {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
		margin-top: 8px;
		font-size: 11px;
		color: #999;
		cursor: pointer;
	}
	/* "Behind the reels" marker — this screen mounts under the board. */
	.screen-behind {
		font-size: 9px;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #6ea8c8;
		background: #13212a;
		border: 1px solid #1c3a4a;
		border-radius: 3px;
		padding: 0 4px;
		flex: none;
	}
	.ontop-field input {
		accent-color: #c8a45c;
		margin: 0;
	}
	.ontop-note {
		width: 100%;
		font-size: 10px;
		color: #565666;
	}
	.gametype {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #999;
	}
	.gametype select {
		background: #16131c;
		color: #c8a3ff;
		border: 1px solid #2a2433;
		border-radius: 6px;
		padding: 3px 6px;
		font-size: 12px;
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
		background: #0f0f14;
		border-right: 1px solid #1c1c24;
		display: flex;
		flex-direction: column;
		min-height: 0;
	}
	.properties {
		border-right: none;
		border-left: 1px solid #1c1c24;
	}
	/* Scrollable body of the LEFT column — the Screens list (each active screen
	   expands to its outline tree). The load-row above it stays a fixed header. */
	.left-body {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 12px 16px 16px;
	}
	.tabs {
		display: flex;
		gap: 4px;
		padding: 12px 12px 0;
	}
	.tab {
		flex: 1;
		background: transparent;
		border: 1px solid #1f1f28;
		color: #888;
		padding: 6px 10px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-radius: 6px;
		cursor: pointer;
		font-family: inherit;
	}
	.tab:hover {
		color: #ccc;
	}
	.tab.active {
		background: #1a1a22;
		color: #7ee0c0;
		border-color: #2a2a33;
	}
	.tab-body {
		padding: 12px 16px 16px;
		overflow-y: auto;
		flex: 1;
	}
	h2 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #888;
		margin: 0 0 14px;
	}
	.upload-btn {
		margin-left: auto;
		background: transparent;
		border: 1px solid #2a2a33;
		color: #c8a3ff;
		padding: 2px 9px;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
	}
	.upload-btn:hover:not(:disabled) {
		border-color: #7ee0c0;
		color: #7ee0c0;
	}
	.upload-btn:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.hidden-input {
		display: none;
	}
	.upload-status {
		margin: 4px 0 2px;
		font-size: 10px;
		color: #7ee0c0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.upload-status.error {
		color: #ff9a9a;
	}
	/* Spacing for the SHARED collapsible sections (PanelSection) in this panel. */
	.tab-body :global(.iw-panel-sec) {
		margin-top: 14px;
	}
	.tab-body :global(.iw-panel-sec:first-of-type) {
		margin-top: 0;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	li {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		font-size: 12px;
		border-radius: 6px;
		background: #16161c;
		border: 1px solid #1f1f28;
	}
	li.muted {
		background: transparent;
		border: 1px dashed #1f1f28;
		color: #666;
		justify-content: center;
		padding: 10px;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.muted.hint {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid #1c1c24;
	}
	.muted.hint strong {
		color: #c8a3ff;
		font-weight: 600;
	}
	.game-settings {
		margin-top: 14px;
		padding-top: 12px;
		border-top: 1px solid #1c1c24;
	}
	.gs-body {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.gs-field {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.gs-label {
		font-size: 12px;
		color: #c8c8d0;
	}
	.gs-select {
		background: #16161c;
		border: 1px solid #1f1f28;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 5px 8px;
		font-size: 12px;
		font-family: inherit;
	}
	.gs-note {
		margin: 0;
		font-size: 11px;
		line-height: 1.4;
		color: #777;
	}
	.cs-input {
		width: 84px;
		background: #16161c;
		border: 1px solid #1f1f28;
		border-radius: 6px;
		color: #e8e8ee;
		padding: 5px 8px;
		font-size: 12px;
		font-family: inherit;
		text-align: right;
	}
	.cs-warn {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 10px;
		border: 1px solid #3a3020;
		border-radius: 8px;
		background: #1c1810;
	}
	.cs-warn-text {
		margin: 0;
		font-size: 11px;
		line-height: 1.4;
		color: #f0c878;
	}
	.cs-warn-text strong {
		color: #ffe0a0;
		font-weight: 600;
	}
	.cs-warn-fix {
		align-self: flex-start;
		padding: 5px 12px;
		border: 1px solid #4a3a20;
		border-radius: 6px;
		background: #2a2114;
		color: #f0c878;
		font-size: 12px;
		font-family: inherit;
		cursor: pointer;
	}
	.cs-warn-fix:hover {
		background: #352a18;
		border-color: #5a4a28;
	}
	.gs-note strong {
		color: #c8a3ff;
		font-weight: 600;
	}
	.gs-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #c8c8d0;
		cursor: pointer;
	}
	.gs-toggle.disabled {
		color: #5a5a64;
		cursor: not-allowed;
	}
	.gs-toggle input {
		accent-color: #7ee0c0;
		cursor: inherit;
	}
	.gs-locked {
		margin: 0;
		font-size: 11px;
		color: #f0c878;
	}
	.canvas-area {
		position: relative;
		min-width: 0;
		min-height: 0;
		background: #0b0b10;
	}
	.help-strip {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 24px;
		border-top: 1px solid #1c1c24;
		background: #0f0f14;
		font-size: 11px;
	}
	.help-strip code {
		color: #888;
		font-family: ui-monospace, monospace;
	}
</style>
