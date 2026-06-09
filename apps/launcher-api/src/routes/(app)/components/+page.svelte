<script lang="ts">
	import Emblem from '$lib/Emblem.svelte';
	import { resolveComponentParams, STANDARD_MAIN_SIZES_MAP } from 'engine-layout';
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

	/** Components the project can use (shared + project shadow). Mutable so a save
	 * reflects in the sidebar without a reload. */
	let components = $state<ComponentDef[]>(structuredClone(data.components));
	/** The component currently open for editing, or null (sidebar-only home state). */
	let componentDraft = $state<ComponentDef | null>(null);
	/** Save state for the component POST (header pill). */
	let saveBusy = $state(false);
	let saveStatus = $state<{ kind: 'ok' | 'error'; message: string } | null>(null);

	/** Hoisted active selection — bound from the canvas, read by Properties. */
	let selectedId = $state<string | null>(null);
	/** Components author in the fixed `desktop` design box — no per-layoutType
	 * override switcher here (a component is one design; the scene editor owns
	 * responsive overrides when the instance is placed). */
	const currentLayoutType: LayoutType = 'desktop';
	/** Left sidebar tab (when a component is open): the asset Library to drag from,
	 * or the Outline of the open component's tree. Properties always show on the
	 * right, so selecting a node never needs a tab switch. */
	let leftTab = $state<'library' | 'outline'>('outline');

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

	/** The params whose baked default the author can set here — engine-provided ones
	 * are fed at runtime (a default makes no sense), so they're hidden. */
	const editableDefaultParams = $derived(
		(componentDraft?.params ?? []).filter((p) => !p.engineProvided),
	);

	/** Read one param's baked default — the value EVERY project inherits unless an
	 * instance overrides it (saved on the def). `undefined` = unset. */
	function getDefault(key: string): unknown {
		return componentDraft?.params?.find((p) => p.key === key)?.default;
	}

	/** Set/clear a param's baked default on the open draft. Travels on the def to
	 * every project; persisted by "Save component". `undefined` clears it. */
	function setDefault(key: string, value: unknown): void {
		if (!componentDraft?.params) return;
		componentDraft.params = componentDraft.params.map((p) => {
			if (p.key !== key) return p;
			if (value === undefined) {
				const { default: _drop, ...rest } = p;
				return rest;
			}
			return { ...p, default: value };
		});
	}

	/** Coerce a colour <input> hex (`#rrggbb`) to the param's numeric value. */
	function hexToNumber(hex: string): number {
		return parseInt(hex.replace(/^#/, ''), 16) || 0;
	}
	/** Render a numeric colour param as a `#rrggbb` value for the colour <input>. */
	function numberToHex(value: unknown): string {
		const n = typeof value === 'number' ? value : 0;
		return `#${(n >>> 0).toString(16).padStart(6, '0').slice(-6)}`;
	}
	/** A param key that looks like a font → render a text input (§13.4 hint). */
	function looksLikeFont(key: string): boolean {
		return /font/i.test(key);
	}

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
		selectedId = null;
		saveStatus = null;
		leftTab = 'outline';
	}

	let newName = $state('');
	let newCategory = $state<ComponentCategory>('overlay');

	/** Create a blank component (empty identity `root` container) + open it. */
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
		openComponent({
			id: genComponentId(),
			name,
			version: 1,
			scope: 'project',
			category: newCategory,
			root,
		});
		newName = '';
	}

	/** Close the open component, back to the sidebar home. */
	function closeComponent(): void {
		componentDraft = null;
		selectedId = null;
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
		if (selectedId === id) selectedId = null;
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
			<a class="save-btn" href="/editor">← Editor</a>
			<a class="brand" href="/"><Emblem height={18} /> INVISIBLE COMPONENT EDITOR</a>
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

	<div class="layout">
		<aside class="left">
			{#if !componentDraft}
				<div class="panel-head">
					<h2 class="panel-title">Components</h2>
				</div>

				<div class="tab-body">
					<div class="create">
						<h3>New component</h3>
						<div class="create-row">
							<input
								type="text"
								placeholder="Component name…"
								bind:value={newName}
								onkeydown={(e) => {
									if (e.key === 'Enter') createComponent();
								}}
							/>
							<select bind:value={newCategory} aria-label="Component category">
								{#each CATEGORIES as c (c.id)}
									<option value={c.id}>{c.label}</option>
								{/each}
							</select>
							<button
								type="button"
								class="create-btn"
								disabled={!newName.trim()}
								onclick={createComponent}
							>
								Create
							</button>
						</div>
					</div>

					<h3 class="list-h">Library <span class="count">{components.length}</span></h3>
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
						<section>
							<h3>Elements</h3>
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
						</section>

						<section>
							<h3>Atlases <span class="count">{atlasCount}</span></h3>
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
						</section>

						<section>
							<h3>Spines <span class="count">{spineCount}</span></h3>
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
						</section>

						<section>
							<h3>Sheets <span class="count">{sheetCount}</span></h3>
							<ul>
								{#each data.assets.sheets as sh (sh.key)}
									{@render expandable(sh.key, sh.name, 'sheet')}
								{:else}
									<li class="muted">No sheets yet.</li>
								{/each}
							</ul>
						</section>
					{:else}
						<EditorOutline
							scene={componentScene}
							template={undefined}
							{selectedId}
							onSelect={(id) => (selectedId = id)}
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
					bind:selectedId
					onDelete={onDeleteNode}
					projectGameName={null}
					componentParams={resolvedParams}
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
			{#if componentDraft}
				<section class="defaults">
					<div class="defaults-head">
						<h3>Defaults (all projects)</h3>
					</div>
					{#if editableDefaultParams.length === 0}
						<p class="muted hint">
							This component declares no author-settable params. Add params (Properties → component
							params); engine-provided values are fed at runtime and have no default.
						</p>
					{:else}
						<p class="muted hint">
							The component's own defaults — every project inherits these unless an instance
							overrides them. Saved with the component.
						</p>
						<div class="defaults-grid">
							{#each editableDefaultParams as param (param.key)}
								{@const current = getDefault(param.key)}
								<label class="def-row">
									<span class="def-key" title={param.key}>{param.key}</span>
									{#if param.options && param.options.length > 0}
										<select
											value={typeof current === 'string' ? current : ''}
											onchange={(e) => setDefault(param.key, e.currentTarget.value || undefined)}
										>
											<option value="">(none)</option>
											{#each param.options as opt (opt)}
												<option value={opt}>{opt}</option>
											{/each}
										</select>
									{:else if param.kind === 'boolean'}
										<input
											type="checkbox"
											checked={current === true}
											onchange={(e) => setDefault(param.key, e.currentTarget.checked)}
										/>
									{:else if param.kind === 'number'}
										<input
											type="number"
											value={typeof current === 'number' ? current : ''}
											placeholder="(unset)"
											oninput={(e) => {
												const v = e.currentTarget.value;
												setDefault(param.key, v === '' ? undefined : Number(v));
											}}
										/>
									{:else if param.kind === 'color'}
										<input
											type="color"
											value={numberToHex(current)}
											oninput={(e) => setDefault(param.key, hexToNumber(e.currentTarget.value))}
										/>
									{:else}
										<input
											type="text"
											value={typeof current === 'string' ? current : ''}
											placeholder={looksLikeFont(param.key) ? 'font family…' : '(unset)'}
											oninput={(e) => {
												const v = e.currentTarget.value;
												setDefault(param.key, v === '' ? undefined : v);
											}}
										/>
									{/if}
								</label>
							{/each}
						</div>
					{/if}
				</section>
			{/if}

			<div class="right-body">
				{#if !componentDraft}
					<p class="muted hint">Open a component to edit its elements.</p>
				{:else}
					<EditorProperties
						node={selectedNode}
						layoutType={currentLayoutType}
						componentMode={true}
						componentParams={componentDraft.params ?? []}
						componentSignals={componentDraft.signals ?? []}
						instanceComponent={selectedNode?.kind === 'componentInstance'
							? (componentMap.get(selectedNode.componentId) ?? null)
							: null}
						onToggleParam={toggleComponentParam}
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
	}
	.brandwrap .save-btn {
		text-decoration: none;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		letter-spacing: 0.08em;
		font-weight: 600;
		color: #c8a3ff;
		text-decoration: none;
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
		display: grid;
		grid-template-columns: 280px 1fr 320px;
		min-height: 0;
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
		padding: 10px;
		border: 1px solid #1f1f28;
		border-radius: 8px;
		background: #0b0b10;
		margin-bottom: 12px;
	}
	.create-row {
		display: flex;
		gap: 6px;
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

	h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #aaa;
		margin: 0 0 8px;
	}
	h4 {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 4px;
	}
	.list-h {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
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

	.defaults {
		border-bottom: 1px solid #1c1c24;
		padding: 12px;
		margin: 0;
		max-height: 40%;
		overflow-y: auto;
	}
	.defaults-head {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-bottom: 8px;
	}
	.defaults-head h3 {
		margin: 0;
		color: #c8a3ff;
	}
	.defaults-grid {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.def-row {
		display: grid;
		grid-template-columns: 1fr auto;
		align-items: center;
		gap: 8px;
	}
	.def-key {
		font-size: 11px;
		color: #c8c8d0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.def-row input[type='text'],
	.def-row input[type='number'],
	.def-row select {
		width: 130px;
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 4px 7px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
	}
	.def-row input[type='color'] {
		width: 36px;
		height: 26px;
		padding: 0;
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		cursor: pointer;
	}
	.def-row input[type='checkbox'] {
		width: 16px;
		height: 16px;
		accent-color: #6b5bff;
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
