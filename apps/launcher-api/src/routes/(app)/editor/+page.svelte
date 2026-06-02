<script lang="ts">
	import Emblem from '$lib/Emblem.svelte';
	import type { LayoutNode, LayoutType, Scene, UnfilledSlot } from 'engine-layout';
	import { onMount } from 'svelte';
	import EditorCanvas from './EditorCanvas.svelte';
	import EditorOutline from './EditorOutline.svelte';
	import EditorProperties from './EditorProperties.svelte';
	import RegionThumb from './RegionThumb.svelte';
	import {
		fetchRegions,
		regionNaturalSize,
		type RegionDragPayload,
		type RegionSet,
	} from './editorRegions.client';
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
	/** Hoisted so the properties panel can read the active selection.
	 * `<EditorCanvas>` binds this via `bind:selectedId`. */
	let selectedId = $state<string | null>(null);
	/** Hoisted active layoutType. `'desktop'` is the base; anything else routes edits
	 * into `node.overrides[layoutType]` (override mode). */
	let currentLayoutType = $state<LayoutType>('desktop');
	/** Left sidebar tab: which panel is shown. */
	let leftTab = $state<'library' | 'outline'>('library');
	/** Required template slots left unfilled — seeded from the loader, refreshed
	 * by each `save` response (§7.1). Read-only status this pass. */
	let warnings = $state<UnfilledSlot[]>(data.warnings);

	const activeScene = $derived(scenes[activeSceneIdx] ?? scenes[0]);
	const frameSize = $derived(data.doc.mainSizesMap[currentLayoutType]);
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
		selectedId && activeScene ? findById(activeScene.nodes, selectedId) : null,
	);

	const sceneCount = $derived(scenes.length);
	const atlasCount = $derived(data.assets.atlases.length);
	const spineCount = $derived(data.assets.spines.length);
	const sheetCount = $derived(data.assets.sheets.length);

	const layoutTypes: LayoutType[] = ['desktop', 'tablet', 'landscape', 'portrait'];

	function onAssetDragStart(
		e: DragEvent,
		asset: { kind: string; key: string; name: string },
	): void {
		if (!e.dataTransfer) return;
		const payload = { kind: asset.kind, key: asset.key, name: asset.name };
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	// ---------- expandable sheet/atlas region lists ----------

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

	function onSpawn(node: LayoutNode): void {
		const next = scenes.slice();
		const sc = next[activeSceneIdx];
		next[activeSceneIdx] = { ...sc, nodes: [...sc.nodes, node] };
		scenes = next;
		markDirty();
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
		const next = scenes.slice();
		const sc = next[activeSceneIdx];
		const nodes = sc.nodes.slice();
		if (!removeNode(nodes, id)) return;
		next[activeSceneIdx] = { ...sc, nodes };
		scenes = next;
		if (selectedId === id) selectedId = null;
		markDirty();
	}

	// ---------- persistence ----------

	const AUTOSAVE_MS = 1200;
	const RELATIVE_TICK_MS = 15_000;

	let dirty = $state(false);
	let busy = $state(false);
	let lastError = $state('');
	let lastSavedAt = $state(data.doc.updatedAt || '');
	/** Bumped every `RELATIVE_TICK_MS` so the "Saved Ns ago" label refreshes. */
	let nowTick = $state(Date.now());

	function markDirty(): void {
		dirty = true;
		lastError = '';
	}

	function buildDocPayload() {
		return {
			version: data.doc.version,
			projectKey: data.projectKey,
			mainSizesMap: data.doc.mainSizesMap,
			scenes,
			updatedAt: lastSavedAt,
		};
	}

	async function postAction(action: string, body: Record<string, string>): Promise<unknown> {
		const fd = new FormData();
		for (const [k, v] of Object.entries(body)) fd.set(k, v);
		const res = await fetch(`?/${action}`, { method: 'POST', body: fd });
		const json = (await res.json()) as { type: string; data?: string };
		if (!json.data) return {};
		const parsed = JSON.parse(json.data) as unknown[];
		const root = parsed[0] as Record<string, number>;
		const out: Record<string, unknown> = {};
		for (const [key, idx] of Object.entries(root)) out[key] = parsed[idx];
		return out;
	}

	let pendingSave = false;
	async function save(): Promise<void> {
		if (busy) {
			// Coalesce: the in-flight save's `finally` will re-trigger.
			pendingSave = true;
			return;
		}
		busy = true;
		try {
			const payload = JSON.stringify(buildDocPayload());
			const out = (await postAction('save', { doc: payload })) as {
				saved?: boolean;
				updatedAt?: string;
				error?: string;
				warnings?: UnfilledSlot[];
			};
			if (out.error) {
				lastError = out.error;
			} else {
				lastSavedAt = out.updatedAt ?? new Date().toISOString();
				lastError = '';
				dirty = false;
				if (out.warnings) warnings = out.warnings;
			}
		} catch (e) {
			lastError = e instanceof Error ? e.message : 'Save failed.';
		} finally {
			busy = false;
			if (pendingSave) {
				pendingSave = false;
				if (dirty) void save();
			}
		}
	}

	let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		// Re-running this effect when `dirty` flips true starts/restarts the
		// autosave timer. Mutations bump `dirty` again -> debounce resets.
		if (!dirty) return;
		if (autosaveTimer) clearTimeout(autosaveTimer);
		autosaveTimer = setTimeout(() => {
			autosaveTimer = null;
			void save();
		}, AUTOSAVE_MS);
		return () => {
			if (autosaveTimer) {
				clearTimeout(autosaveTimer);
				autosaveTimer = null;
			}
		};
	});

	function onBeforeUnload(e: BeforeUnloadEvent): void {
		if (!dirty) return;
		e.preventDefault();
		e.returnValue = '';
	}

	onMount(() => {
		window.addEventListener('beforeunload', onBeforeUnload);
		const id = window.setInterval(() => (nowTick = Date.now()), RELATIVE_TICK_MS);
		return () => {
			window.removeEventListener('beforeunload', onBeforeUnload);
			window.clearInterval(id);
			if (autosaveTimer) clearTimeout(autosaveTimer);
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

<svelte:head><title>Invisible Editor — Invisible Wall</title></svelte:head>

{#snippet expandable(key: string, name: string, tag: string)}
	<li class="group" class:open={expanded[key]}>
		<button type="button" class="grouprow" onclick={() => void toggleExpand(key)}>
			<span class="caret">{expanded[key] ? '▾' : '▸'}</span>
			<span class="name">{name}</span>
			<span class="tag">{tag}</span>
		</button>
		{#if expanded[key]}
			{@const set = regionSets[key]}
			{#if set === null}
				<p class="region-note">Loading regions…</p>
			{:else if !set || set.regions.length === 0}
				<p class="region-note">No regions found in this {tag}.</p>
			{:else}
				<div class="region-grid">
					{#each set.regions as r (r.name)}
						{@const ns = regionNaturalSize(r)}
						<div
							class="region"
							draggable="true"
							role="button"
							tabindex="0"
							aria-label={`Drag region ${r.name} (${ns.w}×${ns.h})`}
							title={`${r.name} · ${ns.w}×${ns.h}`}
							ondragstart={(e) => onRegionDragStart(e, set, r)}
						>
							<RegionThumb {set} region={r} size={48} />
							<span class="region-name">{r.name}</span>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	</li>
{/snippet}

<div class="shell">
	<header>
		<div class="brand-wrap">
			<a class="brand" href="/"><Emblem height={18} /> INVISIBLE EDITOR</a>
			<span class="subtitle">Project: <strong>{data.clientKey}/{data.projectKey}</strong></span>
		</div>
		<div class="layout-pills" role="tablist" aria-label="Authoring layoutType">
			{#each layoutTypes as lt (lt)}
				<button
					role="tab"
					aria-selected={currentLayoutType === lt}
					class="pill"
					class:active={currentLayoutType === lt}
					class:override={currentLayoutType === lt && lt !== 'desktop'}
					onclick={() => (currentLayoutType = lt)}
				>
					{lt}
				</button>
			{/each}
		</div>
		<div class="meta">
			<span class="counter">{sceneCount} {sceneCount === 1 ? 'scene' : 'scenes'}</span>
			<span class="dot-sep">·</span>
			<span class="counter">
				{atlasCount} atlases · {spineCount} spines · {sheetCount} sheets
			</span>
			<span class="dot-sep">·</span>
			{#if busy}
				<span class="save-pill busy">Saving…</span>
			{:else if lastError}
				<span class="save-pill error" title={lastError}>Save failed</span>
				<button class="save-btn" type="button" onclick={() => void save()}>Retry</button>
			{:else if dirty}
				<span class="save-pill dirty">Unsaved changes</span>
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
		</div>
	</header>

	<div class="layout">
		<aside class="left">
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
						scene={activeScene}
						template={data.template}
						{selectedId}
						onSelect={(id) => (selectedId = id)}
					/>
				{/if}
			</div>
		</aside>

		<main class="canvas-area">
			<EditorCanvas
				scene={activeScene}
				frameWidth={frameSize.width}
				frameHeight={frameSize.height}
				layoutType={currentLayoutType}
				{onSpawn}
				bind:selectedId
				onDirty={markDirty}
				onDelete={onDeleteNode}
			/>
		</main>

		<aside class="properties">
			<h2>Properties</h2>
			<EditorProperties node={selectedNode} layoutType={currentLayoutType} onDirty={markDirty} />
			<p class="muted hint">
				Active scene: <strong>{activeScene?.name ?? '—'}</strong> ·
				{activeScene?.nodes.length ?? 0} nodes
			</p>
		</aside>
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
		display: grid;
		grid-template-rows: auto 1fr auto;
		height: 100vh;
		color: #e8e8ee;
		background: #0b0b10;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
		padding: 14px 24px;
		border-bottom: 1px solid #1c1c24;
		background: #0f0f14;
	}
	.brand-wrap {
		display: flex;
		align-items: center;
		gap: 18px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: #7ee0c0;
		font-size: 15px;
		text-decoration: none;
	}
	.subtitle {
		font-size: 12px;
		color: #888;
	}
	.subtitle strong {
		color: #c8a3ff;
		font-weight: 600;
	}
	.layout-pills {
		display: flex;
		gap: 4px;
		background: #16161c;
		border: 1px solid #1f1f28;
		border-radius: 999px;
		padding: 3px;
	}
	.pill {
		background: transparent;
		border: none;
		color: #888;
		padding: 4px 12px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		border-radius: 999px;
		cursor: pointer;
		font-family: inherit;
	}
	.pill:hover {
		color: #ccc;
	}
	.pill.active {
		background: #1a1a22;
		color: #7ee0c0;
	}
	.pill.active.override {
		color: #c8a3ff;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 12px;
		color: #888;
	}
	.dot-sep {
		color: #444;
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
	.layout {
		display: grid;
		grid-template-columns: 280px 1fr 320px;
		min-height: 0;
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
		padding: 16px;
		overflow-y: auto;
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
	h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #aaa;
		margin: 14px 0 6px;
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	.count {
		color: #555;
		font-weight: 400;
		font-size: 11px;
	}
	.tab-body section:first-of-type h3 {
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
	li[draggable='true'] {
		cursor: grab;
	}
	li[draggable='true']:hover {
		border-color: #2f3a48;
		background: #1a1a22;
	}
	li[draggable='true']:active {
		cursor: grabbing;
	}
	.name {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		font-size: 10px;
		color: #777;
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}
	.badge {
		font-size: 10px;
		color: #c8a3ff;
		background: #2a2430;
		padding: 1px 6px;
		border-radius: 999px;
	}
	li.muted {
		background: transparent;
		border: 1px dashed #1f1f28;
		color: #666;
		justify-content: center;
		padding: 10px;
	}
	li.group {
		display: block;
		padding: 0;
		background: #16161c;
		border: 1px solid #1f1f28;
		overflow: hidden;
	}
	li.group.open {
		border-color: #2a2a33;
	}
	.grouprow {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 6px 8px;
		background: transparent;
		border: none;
		color: #e8e8ee;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
		font-family: inherit;
	}
	.grouprow:hover {
		background: #1a1a22;
	}
	.caret {
		color: #777;
		width: 10px;
		font-size: 10px;
	}
	.region-note {
		margin: 0;
		padding: 6px 10px 8px 24px;
		color: #666;
		font-size: 11px;
	}
	.region-grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(56px, 1fr));
		gap: 6px;
		padding: 6px 8px 10px;
	}
	.region {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 3px;
		padding: 4px;
		border-radius: 6px;
		border: 1px solid transparent;
		cursor: grab;
	}
	.region:hover {
		border-color: #2f3a48;
		background: #1a1a22;
	}
	.region:active {
		cursor: grabbing;
	}
	.region-name {
		font-size: 9px;
		color: #888;
		max-width: 52px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	.canvas-area {
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
