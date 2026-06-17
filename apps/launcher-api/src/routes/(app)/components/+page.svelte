<script lang="ts">
	import Emblem from '$lib/Emblem.svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import {
		ENGINE_ACTION_CATALOG,
		fontParamKeysOf,
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
	import EditorCanvas from '../editor/EditorCanvas.svelte';
	import EditorOutline from '../editor/EditorOutline.svelte';
	import EditorProperties from '../editor/EditorProperties.svelte';
	import RegionThumb from '../editor/RegionThumb.svelte';
	import PanelResizers from '../editor/PanelResizers.svelte';
	import PanelSection from '../editor/PanelSection.svelte';
	import {
		fetchRegions,
		type RegionDragPayload,
		type RegionSet,
	} from '../editor/editorRegions.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const CATEGORIES: { id: ComponentCategory; label: string }[] = [
		{ id: 'ui', label: 'UI' },
		{ id: 'overlay', label: 'Overlay' },
		{ id: 'scenery', label: 'Scenery' },
	];

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
	/** The component currently open for editing, or null (sidebar-only home state). */
	let componentDraft = $state<ComponentDef | null>(null);
	/** Save state for the component POST (header pill). */
	let saveBusy = $state(false);
	let saveStatus = $state<{ kind: 'ok' | 'error'; message: string } | null>(null);

	/** Hoisted active selection — bound from the canvas, read by Properties.
	 * `selectedIds` is the source of truth (shift-click multi-select); `selectedId` is
	 * the primary (last-picked) id the Properties panel reads. */
	let selectedIds = $state<string[]>([]);
	const selectedId = $derived(selectedIds.at(-1) ?? null);
	/** Per-`assetKey` animation + skin lists for every loaded spine bundle, reported by
	 * the canvas's WebGL sublayers — lets the Properties panel offer dropdowns. */
	let spineMeta = $state<Map<string, { animations: string[]; skins: string[] }>>(new Map());
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

	function genComponentId(): string {
		return 'c_' + Math.random().toString(36).slice(2, 10);
	}

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
			? { id: 's_component', name: componentDraft.name, nodes: componentDraft.root.children }
			: undefined,
	);

	/** The component authors in a neutral, fixed design box (no project doc here).
	 * The standard box is a self-contained frame around just the component. */
	const frameSize = $derived(STANDARD_MAIN_SIZES_MAP[currentLayoutType]);

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

	function findById(nodes: LayoutNode[], id: string): LayoutNode | null {
		for (const n of nodes) {
			if (n.id === id) return n;
			if (n.kind === 'container') {
				const found = findById(n.children, id);
				if (found) return found;
			}
		}
		return null;
	}
	const selectedNode = $derived(
		selectedId && componentScene ? findById(componentScene.nodes, selectedId) : null,
	);

	/** Open `def` for editing. `$state.snapshot` (NOT `structuredClone`): `def` may be
	 * a reactive proxy (a `components` list entry), which `structuredClone` rejects
	 * with DataCloneError — snapshot returns a plain, detached deep copy. */
	function openComponent(def: ComponentDef): void {
		componentDraft = $state.snapshot(def) as ComponentDef;
		// Baseline for the unsaved-changes guard. A NEWLY CREATED component is
		// deliberately dirty from the start (`null` baseline): it exists ONLY as this
		// draft until "Save component", so leaving without saving must warn.
		savedSnapshot = components.some((c) => c.id === def.id)
			? JSON.stringify($state.snapshot(componentDraft))
			: null;
		selectedIds = [];
		saveStatus = null;
		leftTab = 'outline';
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
	let newType = $state<'blank' | 'button'>('blank');

	/** Create a component (blank root; a Button additionally declares `action`) + open it. */
	function createComponent(): void {
		const name = newName.trim();
		if (!name) return;
		const root: ContainerNode = {
			id: genComponentId() + '_root',
			kind: 'container',
			x: 0,
			y: 0,
			children: [],
		};
		const def: ComponentDef = {
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
	 * scene exposes). The component has its own save — no autosave here. */
	function onSpawn(node: LayoutNode): void {
		if (!componentDraft) return;
		componentDraft.root.children = [...componentDraft.root.children, node];
	}

	function removeNode(nodes: LayoutNode[], id: string): boolean {
		const i = nodes.findIndex((n) => n.id === id);
		if (i !== -1) {
			nodes.splice(i, 1);
			return true;
		}
		for (const n of nodes) {
			if (n.kind === 'container' && removeNode(n.children, id)) return true;
		}
		return false;
	}

	function onDeleteNode(id: string): void {
		if (!componentDraft) return;
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

	/** Save the open draft via POST (§8.3); refresh the local list on success. */
	async function saveComponent(): Promise<void> {
		if (!componentDraft || saveBusy) return;
		saveBusy = true;
		saveStatus = null;
		try {
			const body =
				componentDraft.scope === 'project'
					? { ...componentDraft, project: data.projectKey }
					: componentDraft;
			const res = await fetch('/api/editor/component', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			if (res.ok) {
				saveStatus = { kind: 'ok', message: 'Component saved' };
				// Snapshot (not structuredClone): componentDraft is a reactive proxy.
				const saved = $state.snapshot(componentDraft) as ComponentDef;
				savedSnapshot = JSON.stringify(saved);
				const i = components.findIndex((c) => c.id === saved.id);
				if (i === -1) components = [...components, saved];
				else components = components.map((c) => (c.id === saved.id ? saved : c));
			} else {
				let message = 'Component save failed';
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
				message: e instanceof Error ? e.message : 'Component save failed',
			};
		} finally {
			saveBusy = false;
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

	/** Declare a custom (author-defined) PARAM on the draft — bindable per instance.
	 * No `engineProvided` flag, so it shows in the Defaults panel + every instance's
	 * override panel. Deduped by key. */
	function addCustomParam(key: string, kind: ComponentParam['kind']): void {
		if (!componentDraft) return;
		const k = key.trim();
		if (!k) return;
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

	/** Toggle the component SIGNAL identified by a catalog entry on the draft. */
	function toggleComponentSignal(key: string): void {
		if (!componentDraft) return;
		const signals = componentDraft.signals ?? [];
		const has = signals.some((s) => s.key === key);
		componentDraft.signals = has ? signals.filter((s) => s.key !== key) : [...signals, { key }];
		if (componentDraft.signals.length === 0) delete componentDraft.signals;
	}

	// ---------- asset library (drag sprites/spine into the component) ----------

	function onAssetDragStart(
		e: DragEvent,
		asset: { kind: string; key: string; name: string },
	): void {
		if (!e.dataTransfer) return;
		const payload = { kind: asset.kind, key: asset.key, name: asset.name };
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	/** Which sheet/atlas keys are currently expanded in the Library. */
	let expanded = $state<Record<string, boolean>>({});
	/** Per-key region set (loaded lazily on first expand; `null` while loading). */
	let regionSets = $state<Record<string, RegionSet | null>>({});

	async function toggleExpand(key: string): Promise<void> {
		const open = !expanded[key];
		expanded = { ...expanded, [key]: open };
		if (open && regionSets[key] === undefined) {
			regionSets = { ...regionSets, [key]: null };
			const set = await fetchRegions(key);
			regionSets = { ...regionSets, [key]: set };
		}
	}

	function onRegionDragStart(
		e: DragEvent,
		set: RegionSet,
		region: RegionSet['regions'][number],
	): void {
		if (!e.dataTransfer) return;
		const payload: RegionDragPayload = {
			kind: 'region',
			key: set.assetKey,
			name: region.name,
			region: region.name,
			pageKey: set.pageKey,
			rect: { x: region.x, y: region.y, w: region.w, h: region.h },
			rotated: region.rotated,
			offX: region.offX,
			offY: region.offY,
			origW: region.origW,
			origH: region.origH,
		};
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	const atlasCount = $derived(data.assets.atlases.length);
	const spineCount = $derived(data.assets.spines.length);
	const sheetCount = $derived(data.assets.sheets.length);

	/** Components grouped by category, in CATEGORIES order, skipping empty groups. */
	const grouped = $derived(
		CATEGORIES.map((c) => ({
			...c,
			items: components.filter((d) => d.category === c.id),
		})).filter((g) => g.items.length > 0),
	);

	// Deep-link: `/components?id=<id>` opens that component once the list is loaded.
	onMount(() => {
		if (!data.openId) return;
		const def = components.find((c) => c.id === data.openId);
		if (def) openComponent(def);
	});
</script>

{#snippet expandable(key: string, name: string, tag: 'sheet' | 'manifest')}
	{@const set = regionSets[key]}
	<li class="expandable">
		<div class="expandable-head">
			<button
				type="button"
				class="expand-toggle"
				aria-expanded={Boolean(expanded[key])}
				onclick={() => void toggleExpand(key)}
			>
				<span class="caret" class:open={expanded[key]}>▸</span>
				<span class="name">{name}</span>
				<span class="tag">{tag}</span>
			</button>
		</div>
		{#if expanded[key]}
			{#if set === null}
				<p class="muted small">Loading regions…</p>
			{:else if set && set.regions.length > 0}
				<div class="regions">
					{#each set.regions as region (region.name)}
						<div
							class="region"
							draggable="true"
							role="button"
							tabindex="0"
							aria-label={`Drag region ${region.name}`}
							title={region.name}
							ondragstart={(e) => onRegionDragStart(e, set, region)}
						>
							<RegionThumb {set} {region} size={48} />
							<span class="region-name">{region.name}</span>
						</div>
					{/each}
				</div>
			{:else}
				<p class="muted small">No regions.</p>
			{/if}
		{/if}
	</li>
{/snippet}

<div class="shell">
	<header class="topbar">
		<div class="brandwrap">
			<ToolTopBar
				current="componentEditor"
				tools={data.tools}
				clientKey={data.clientKey}
				projectKey={data.projectKey}
			/>
			<span class="subtitle">Project: <strong>{data.clientKey}/{data.projectKey}</strong></span>
		</div>

		<div class="meta">
			{#if componentDraft}
				<span class="save-pill" title="The component currently open for editing">
					◇ {componentDraft.name}
				</span>
				{#if saveBusy}
					<span class="save-pill busy">Saving…</span>
				{:else if saveStatus?.kind === 'error'}
					<span class="save-pill error" title={saveStatus.message}>Save failed</span>
				{:else if saveStatus?.kind === 'ok'}
					<span class="save-pill ok">{saveStatus.message}</span>
				{/if}
				<button class="save-btn primary" type="button" onclick={() => void saveComponent()}>
					Save component
				</button>
				<button class="save-btn" type="button" onclick={closeComponent}>← All components</button>
			{:else}
				<span class="counter">
					{components.length}
					{components.length === 1 ? 'component' : 'components'}
				</span>
			{/if}
		</div>
	</header>

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
							{/if}
						</div>
					</PanelSection>

					<PanelSection id="cmp-library" title="Library" count={components.length}>
						{#if components.length === 0}
							<p class="muted">No components yet. Create one above to start authoring.</p>
						{:else}
							{#each grouped as group (group.id)}
								<div class="group">
									<h4>{group.label} <span class="count">{group.items.length}</span></h4>
									<ul class="cmp-list">
										{#each group.items as def (def.id)}
											<li class="cmp-row-wrap">
												<button type="button" class="cmp-row" onclick={() => openComponent(def)}>
													<span class="glyph">◇</span>
													<span class="name">{def.name}</span>
													<span class="scope" class:project={def.scope === 'project'}>
														{def.scope}
													</span>
													<span class="ver">v{def.version}</span>
												</button>
												<button
													type="button"
													class="cmp-del"
													title={`Delete component "${def.name}"`}
													aria-label={`Delete component "${def.name}"`}
													onclick={(e) => void deleteComponentDef(e, def)}
												>
													✕
												</button>
											</li>
										{/each}
									</ul>
								</div>
							{/each}
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
								<li
									draggable="true"
									ondragstart={(e) => onAssetDragStart(e, { kind: 'text', key: '', name: 'Text' })}
								>
									<span class="name">Text</span>
									<span class="tag">text</span>
								</li>
								<li
									draggable="true"
									ondragstart={(e) =>
										onAssetDragStart(e, { kind: 'container', key: '', name: 'Group' })}
								>
									<span class="name">Container</span>
									<span class="tag">group</span>
								</li>
							</ul>
						</PanelSection>

						<PanelSection id="cmp-lib-atlases" title="Atlases" count={atlasCount}>
							<ul>
								{#each data.assets.atlases as a (a.key)}
									{#if a.kind === 'atlas-manifest'}
										{@render expandable(a.key, a.name, 'manifest')}
									{:else}
										<li
											draggable="true"
											data-asset-kind={a.kind}
											data-asset-key={a.key}
											data-asset-name={a.name}
											ondragstart={(e) => onAssetDragStart(e, a)}
										>
											<span class="name">{a.name}</span>
											<span class="tag">page</span>
										</li>
									{/if}
								{:else}
									<li class="muted">No atlases yet.</li>
								{/each}
							</ul>
						</PanelSection>

						<PanelSection id="cmp-lib-spines" title="Spines" count={spineCount}>
							<ul>
								{#each data.assets.spines as s (s.key)}
									<li
										draggable="true"
										data-asset-kind={s.kind}
										data-asset-key={s.key}
										data-asset-name={s.name}
										ondragstart={(e) => onAssetDragStart(e, s)}
									>
										<span class="name">{s.name}</span>
										<span class="tag">spine</span>
										{#if s.shared}<span class="badge">shared</span>{/if}
									</li>
								{:else}
									<li class="muted">No spines yet.</li>
								{/each}
							</ul>
						</PanelSection>

						<PanelSection id="cmp-lib-sheets" title="Sheets" count={sheetCount}>
							<ul>
								{#each data.assets.sheets as sh (sh.key)}
									{@render expandable(sh.key, sh.name, 'sheet')}
								{:else}
									<li class="muted">No sheets yet.</li>
								{/each}
							</ul>
						</PanelSection>
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
					mainSizesMap={STANDARD_MAIN_SIZES_MAP}
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
						{spineMeta}
						{pickSheets}
						componentParams={componentDraft.params ?? []}
						componentSignals={componentDraft.signals ?? []}
						instanceComponent={selectedNode?.kind === 'componentInstance'
							? (componentMap.get(selectedNode.componentId) ?? null)
							: null}
						onToggleParam={toggleComponentParam}
						onAddParam={addCustomParam}
						onRemoveParam={removeComponentParam}
						onSetParamDefault={setParamDefault}
						{fontParamKeys}
						onExposeTextParams={exposeTextParams}
						onUnexposeTextParams={unexposeTextParams}
						onToggleSignal={toggleComponentSignal}
						onSetInstanceParam={(key, value) => {
							if (!selectedNode || selectedNode.kind !== 'componentInstance') return;
							const params = { ...(selectedNode.params ?? {}) };
							if (value === undefined) delete params[key];
							else params[key] = value;
							selectedNode.params = Object.keys(params).length ? params : undefined;
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
	.topbar {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 8px 16px;
		border-bottom: 1px solid #1c1c24;
		background: #0d0d12;
	}
	.brandwrap {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
		flex: 1 1 auto;
	}
	.subtitle {
		font-size: 11px;
		color: #888;
	}
	.subtitle strong {
		color: #b8b8c4;
		font-weight: 600;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-left: auto;
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

	h4 {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 4px;
	}
	.count {
		color: #666;
		font-size: 11px;
	}
	.group {
		margin: 0 0 10px;
	}
	.cmp-list {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.cmp-row {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		padding: 6px 8px;
		color: #c8c8d0;
		font-size: 12px;
		cursor: pointer;
		font-family: inherit;
	}
	.cmp-row:hover {
		background: #16161c;
		border-color: #1f1f28;
	}
	.cmp-row-wrap {
		display: flex;
		align-items: center;
		gap: 2px;
		padding: 0;
		border: none;
	}
	.cmp-row-wrap .cmp-row {
		flex: 1;
		min-width: 0;
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
	.glyph {
		color: #c8a3ff;
		font-size: 12px;
	}
	.cmp-row .name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.scope {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.scope.project {
		color: #7ee0c0;
	}
	.ver {
		font-size: 10px;
		color: #666;
	}

	section {
		margin: 0 0 14px;
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
		gap: 8px;
		font-size: 12px;
		color: #c8c8d0;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid transparent;
	}
	li[draggable='true'] {
		cursor: grab;
	}
	li[draggable='true']:hover {
		background: #16161c;
		border-color: #1f1f28;
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #666;
	}
	.badge {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #7ee0c0;
		border: 1px solid #234038;
		border-radius: 999px;
		padding: 1px 6px;
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

	.expandable {
		flex-direction: column;
		align-items: stretch;
		padding: 0;
		gap: 0;
	}
	.expandable-head {
		display: flex;
	}
	.expand-toggle {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		background: transparent;
		border: none;
		color: #c8c8d0;
		font-size: 12px;
		padding: 5px 8px;
		cursor: pointer;
		font-family: inherit;
	}
	.expand-toggle:hover {
		background: #16161c;
	}
	.caret {
		display: inline-block;
		transition: transform 0.12s;
		color: #888;
		font-size: 10px;
	}
	.caret.open {
		transform: rotate(90deg);
	}
	.regions {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
		gap: 6px;
		padding: 6px 4px 8px;
	}
	.region {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 2px;
		cursor: grab;
		padding: 4px;
		border-radius: 6px;
		border: 1px solid #1f1f28;
		background: #0b0b10;
	}
	.region:hover {
		border-color: #3a3a48;
	}
	.region-name {
		font-size: 9px;
		color: #888;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
