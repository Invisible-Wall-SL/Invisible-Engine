<script lang="ts">
	import Emblem from '$lib/Emblem.svelte';
	import type { LayoutNode, Scene } from 'engine-layout';
	import EditorCanvas from './EditorCanvas.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	/** Scenes the canvas renders. Lazily seeded with a `'main'` scene when the
	 * doc has none — only kept in client state (autosave is step 8). */
	let scenes: Scene[] = $state(
		data.doc.scenes.length > 0
			? structuredClone(data.doc.scenes)
			: [{ id: 's_main', name: 'main', nodes: [] }],
	);
	let activeSceneIdx = $state(0);

	const activeScene = $derived(scenes[activeSceneIdx] ?? scenes[0]);
	const frameSize = $derived(data.doc.mainSizesMap.desktop);

	const sceneCount = $derived(scenes.length);
	const atlasCount = $derived(data.assets.atlases.length);
	const spineCount = $derived(data.assets.spines.length);
	const sheetCount = $derived(data.assets.sheets.length);

	function onAssetDragStart(
		e: DragEvent,
		asset: { kind: string; key: string; name: string },
	): void {
		if (!e.dataTransfer) return;
		const payload = { kind: asset.kind, key: asset.key, name: asset.name };
		e.dataTransfer.setData('application/x-iw-asset', JSON.stringify(payload));
		e.dataTransfer.effectAllowed = 'copy';
	}

	function onSpawn(node: LayoutNode): void {
		// Append to active scene; reassign to trigger reactivity.
		const next = scenes.slice();
		const sc = next[activeSceneIdx];
		next[activeSceneIdx] = { ...sc, nodes: [...sc.nodes, node] };
		scenes = next;
	}
</script>

<svelte:head><title>Invisible Editor — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand-wrap">
			<a class="brand" href="/"><Emblem height={18} /> INVISIBLE EDITOR</a>
			<span class="subtitle">Project: <strong>{data.clientKey}/{data.projectKey}</strong></span>
		</div>
		<div class="meta">
			<span class="counter">{sceneCount} {sceneCount === 1 ? 'scene' : 'scenes'}</span>
			<span class="dot-sep">·</span>
			<span class="counter">
				{atlasCount} atlases · {spineCount} spines · {sheetCount} sheets
			</span>
		</div>
	</header>

	<div class="layout">
		<aside class="library">
			<h2>Assets</h2>

			<section>
				<h3>Atlases <span class="count">{atlasCount}</span></h3>
				<ul>
					{#each data.assets.atlases as a (a.key)}
						<li
							draggable="true"
							data-asset-kind={a.kind}
							data-asset-key={a.key}
							data-asset-name={a.name}
							ondragstart={(e) => onAssetDragStart(e, a)}
						>
							<span class="name">{a.name}</span>
							<span class="tag">{a.kind === 'atlas-manifest' ? 'manifest' : 'page'}</span>
						</li>
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
						<li
							draggable="true"
							data-asset-kind={sh.kind}
							data-asset-key={sh.key}
							data-asset-name={sh.name}
							ondragstart={(e) => onAssetDragStart(e, sh)}
						>
							<span class="name">{sh.name}</span>
							<span class="tag">sheet</span>
						</li>
					{:else}
						<li class="muted">No sheets yet.</li>
					{/each}
				</ul>
			</section>
		</aside>

		<main class="canvas-area">
			<EditorCanvas
				scene={activeScene}
				frameWidth={frameSize.width}
				frameHeight={frameSize.height}
				{onSpawn}
			/>
		</main>

		<aside class="properties">
			<h2>Properties</h2>
			<p class="muted">Selection properties will appear here.</p>
			<p class="muted hint">
				Active scene: <strong>{activeScene?.name ?? '—'}</strong> ·
				{activeScene?.nodes.length ?? 0} nodes
			</p>
		</aside>
	</div>

	<footer class="help-strip">
		<span class="muted">
			Doc updatedAt: <code>{data.doc.updatedAt || '—'}</code>
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
	.layout {
		display: grid;
		grid-template-columns: 280px 1fr 320px;
		min-height: 0;
	}
	.library,
	.properties {
		background: #0f0f14;
		border-right: 1px solid #1c1c24;
		padding: 16px;
		overflow-y: auto;
	}
	.properties {
		border-right: none;
		border-left: 1px solid #1c1c24;
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
	.library section:first-of-type h3 {
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
	.muted {
		color: #666;
		font-size: 12px;
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
