<script lang="ts">
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { EffectDoc, EmitterConfigV3, EmitterLayer } from 'engine-fx';
	import FxStage, { type ResolvedArt } from './FxStage.svelte';
	import {
		emptyEffectDoc,
		listEndpoints,
		newLayer,
		nextLayerKey,
		setCoreParam,
		setListEndpoint,
		setSpawnRadius,
		spawnRadius,
	} from './fxModel.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// The in-memory EffectDoc is the SINGLE source of truth while editing. The live
	// preview rebuilds from it on change. No save endpoint this increment (preview-from-
	// in-memory-doc is the Phase-1-increment-2 goal); save + reopen land with /api/fx/save.
	const initialDoc = emptyEffectDoc();
	let doc = $state<EffectDoc>(initialDoc);
	let selectedKey = $state<string>(initialDoc.layers[0]?.key ?? '');
	let playing = $state(true);

	const selected = $derived(doc.layers.find((l) => l.key === selectedKey));
	const config = $derived(selected?.config);

	let stage = $state<FxStage | null>(null);

	// --- art resolution (reuse the editor's region + asset endpoints) -----------
	// FX rides the `editor` scope (see +page.server.ts), so it reads regions + the page
	// image straight from the existing editor-gated endpoints — no new shared surface.
	const artCache = new Map<string, Promise<ResolvedArt | null>>();

	function resolveArt(assetKey: string): Promise<ResolvedArt | null> {
		const hit = artCache.get(assetKey);
		if (hit) return hit;
		const p = (async (): Promise<ResolvedArt | null> => {
			const res = await fetch(`/api/editor/regions?sheet=${encodeURIComponent(assetKey)}`);
			if (!res.ok) return null;
			const set = (await res.json()) as {
				pageKey: string;
				pageWidth: number;
				pageHeight: number;
				regions: { name: string; x: number; y: number; w: number; h: number; rotated?: boolean }[];
			};
			if (!set.pageKey) return null;
			return {
				pageUrl: `/api/editor/asset?key=${encodeURIComponent(set.pageKey)}`,
				pageWidth: set.pageWidth,
				pageHeight: set.pageHeight,
				regions: set.regions,
			};
		})();
		artCache.set(assetKey, p);
		return p;
	}

	// The chosen atlas's region names (for the region picker checkboxes).
	let pickerAtlasKey = $state<string>('');
	let pickerRegions = $state<string[]>([]);

	$effect(() => {
		const key = selected?.art.assetKey;
		if (key) pickerAtlasKey = key;
	});

	const atlasOptions = $derived(data.atlases);

	async function selectAtlas(manifestKey: string): Promise<void> {
		pickerAtlasKey = manifestKey;
		const a = atlasOptions.find((x) => x.manifestKey === manifestKey);
		pickerRegions = a ? a.regions : [];
		if (selected) {
			// Binding an atlas clears stale frames so the picker drives art.frames cleanly.
			updateSelected((l) => ({ ...l, art: { ...l.art, assetKey: manifestKey, frames: [] } }));
		}
	}

	// Seed the picker region list when a layer with art is selected.
	$effect(() => {
		const key = selected?.art.assetKey;
		const a = key ? atlasOptions.find((x) => x.manifestKey === key) : undefined;
		pickerRegions = a ? a.regions : [];
	});

	function toggleFrame(name: string): void {
		if (!selected) return;
		const have = selected.art.frames.includes(name);
		const frames = have
			? selected.art.frames.filter((f) => f !== name)
			: [...selected.art.frames, name];
		updateSelected((l) => ({
			...l,
			art: { ...l.art, frames, animated: frames.length > 1 ? true : l.art.animated },
		}));
	}

	// --- immutable doc edits ----------------------------------------------------
	function updateSelected(fn: (l: EmitterLayer) => EmitterLayer): void {
		doc = { ...doc, layers: doc.layers.map((l) => (l.key === selectedKey ? fn(l) : l)) };
	}

	function patchConfig(next: EmitterConfigV3): void {
		updateSelected((l) => ({ ...l, config: next }));
	}

	function addLayer(): void {
		const key = nextLayerKey(doc);
		doc = { ...doc, layers: [...doc.layers, newLayer(key)] };
		selectedKey = key;
	}

	function removeLayer(key: string): void {
		const layers = doc.layers.filter((l) => l.key !== key);
		doc = { ...doc, layers };
		if (selectedKey === key) selectedKey = layers[0]?.key ?? '';
	}

	function renameLayer(key: string, name: string): void {
		const clean = name.trim();
		if (!clean || doc.layers.some((l) => l.key === clean)) return;
		doc = { ...doc, layers: doc.layers.map((l) => (l.key === key ? { ...l, key: clean } : l)) };
		if (selectedKey === key) selectedKey = clean;
	}

	// --- inspector readouts (derived from the config) ---------------------------
	const alphaEnds = $derived(config ? listEndpoints(config, 'alpha', 'alpha') : undefined);
	const scaleEnds = $derived(config ? listEndpoints(config, 'scale', 'scale') : undefined);
	const speedEnds = $derived(config ? listEndpoints(config, 'moveSpeed', 'speed') : undefined);
	const radius = $derived(config ? spawnRadius(config) : undefined);

	function num(e: Event): number {
		return Number((e.currentTarget as HTMLInputElement).value);
	}
</script>

<svelte:head><title>Invisible FX</title></svelte:head>

<div class="page">
	<ToolTopBar
		current="editor"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	/>

	<div class="subbar">
		<strong>Invisible FX</strong>
		<span class="tag">emitter preview</span>
		<button onclick={() => (playing = !playing)}>{playing ? '❚❚ Pause' : '▶ Play'}</button>
		<button onclick={() => stage?.resetView()}>Reset view</button>
		<span class="spacer"></span>
		<span class="count">{doc.layers.length} layer{doc.layers.length === 1 ? '' : 's'}</span>
		<span class="preview-note">in-memory preview · save lands next increment</span>
	</div>

	<div class="body">
		<aside class="layers">
			<div class="head">
				<h3>Layers</h3>
				<button class="add" onclick={addLayer}>+ Add</button>
			</div>
			<ul>
				{#each doc.layers as layer (layer.key)}
					<li class:active={layer.key === selectedKey}>
						<button class="pick" onclick={() => (selectedKey = layer.key)}>
							{layer.key}
							<span class="meta">{layer.art.frames.length} frame{layer.art.frames.length === 1 ? '' : 's'}</span>
						</button>
						<button
							class="del"
							title="Remove layer"
							disabled={doc.layers.length === 1}
							onclick={() => removeLayer(layer.key)}>✕</button
						>
					</li>
				{/each}
			</ul>
		</aside>

		<div class="canvas">
			<FxStage bind:this={stage} layers={doc.layers} {playing} {resolveArt} />
		</div>

		<aside class="inspector">
			{#if selected && config}
				<section>
					<h3>Layer</h3>
					<label class="row">
						<span>Name</span>
						<input
							value={selected.key}
							onchange={(e) => renameLayer(selected.key, (e.currentTarget as HTMLInputElement).value)}
						/>
					</label>
				</section>

				<section>
					<h3>Art</h3>
					<label class="row">
						<span>Atlas</span>
						<select
							value={selected.art.assetKey}
							onchange={(e) => selectAtlas((e.currentTarget as HTMLSelectElement).value)}
						>
							<option value="">— pick an atlas —</option>
							{#each atlasOptions as a (a.manifestKey)}
								<option value={a.manifestKey}>{a.label}</option>
							{/each}
						</select>
					</label>
					{#if atlasOptions.length === 0}
						<p class="hint">This project has no usable atlases yet (make one in Atlas/Sheet Maker).</p>
					{/if}
					{#if selected.art.assetKey}
						<div class="frames">
							{#if pickerRegions.length === 0}
								<p class="hint">No regions in this atlas.</p>
							{:else}
								{#each pickerRegions as name (name)}
									<label class="frame">
										<input
											type="checkbox"
											checked={selected.art.frames.includes(name)}
											onchange={() => toggleFrame(name)}
										/>
										{name}
									</label>
								{/each}
							{/if}
						</div>
						{#if selected.art.frames.length > 1}
							<label class="row check">
								<input
									type="checkbox"
									checked={selected.art.animated ?? true}
									onchange={(e) =>
										updateSelected((l) => ({
											...l,
											art: { ...l.art, animated: (e.currentTarget as HTMLInputElement).checked },
										}))}
								/>
								<span>Flipbook (animate frames)</span>
							</label>
						{/if}
					{/if}
				</section>

				<section>
					<h3>Emitter</h3>
					<label class="row">
						<span>Frequency (s)</span>
						<input
							type="number"
							step="0.001"
							min="0.001"
							value={config.frequency}
							onchange={(e) => patchConfig(setCoreParam(config, 'frequency', num(e)))}
						/>
					</label>
					<label class="row">
						<span>Max particles</span>
						<input
							type="number"
							step="10"
							min="1"
							value={config.maxParticles ?? 0}
							onchange={(e) => patchConfig(setCoreParam(config, 'maxParticles', num(e)))}
						/>
					</label>
					<label class="row">
						<span>Lifetime min (s)</span>
						<input
							type="number"
							step="0.05"
							min="0"
							value={config.lifetime.min}
							onchange={(e) => patchConfig(setCoreParam(config, 'lifetimeMin', num(e)))}
						/>
					</label>
					<label class="row">
						<span>Lifetime max (s)</span>
						<input
							type="number"
							step="0.05"
							min="0"
							value={config.lifetime.max}
							onchange={(e) => patchConfig(setCoreParam(config, 'lifetimeMax', num(e)))}
						/>
					</label>
					{#if radius !== undefined}
						<label class="row">
							<span>Spawn radius</span>
							<input
								type="number"
								step="1"
								min="0"
								value={radius}
								onchange={(e) => patchConfig(setSpawnRadius(config, num(e)))}
							/>
						</label>
					{/if}
				</section>

				{#if alphaEnds}
					<section>
						<h3>Alpha</h3>
						<label class="row">
							<span>Start</span>
							<input
								type="number"
								step="0.05"
								min="0"
								max="1"
								value={alphaEnds.start}
								onchange={(e) => patchConfig(setListEndpoint(config, 'alpha', 'alpha', 'start', num(e)))}
							/>
						</label>
						<label class="row">
							<span>End</span>
							<input
								type="number"
								step="0.05"
								min="0"
								max="1"
								value={alphaEnds.end}
								onchange={(e) => patchConfig(setListEndpoint(config, 'alpha', 'alpha', 'end', num(e)))}
							/>
						</label>
					</section>
				{/if}

				{#if scaleEnds}
					<section>
						<h3>Scale</h3>
						<label class="row">
							<span>Start</span>
							<input
								type="number"
								step="0.05"
								min="0"
								value={scaleEnds.start}
								onchange={(e) => patchConfig(setListEndpoint(config, 'scale', 'scale', 'start', num(e)))}
							/>
						</label>
						<label class="row">
							<span>End</span>
							<input
								type="number"
								step="0.05"
								min="0"
								value={scaleEnds.end}
								onchange={(e) => patchConfig(setListEndpoint(config, 'scale', 'scale', 'end', num(e)))}
							/>
						</label>
					</section>
				{/if}

				{#if speedEnds}
					<section>
						<h3>Speed</h3>
						<label class="row">
							<span>Start</span>
							<input
								type="number"
								step="10"
								min="0"
								value={speedEnds.start}
								onchange={(e) =>
									patchConfig(setListEndpoint(config, 'moveSpeed', 'speed', 'start', num(e)))}
							/>
						</label>
						<label class="row">
							<span>End</span>
							<input
								type="number"
								step="10"
								min="0"
								value={speedEnds.end}
								onchange={(e) =>
									patchConfig(setListEndpoint(config, 'moveSpeed', 'speed', 'end', num(e)))}
							/>
						</label>
					</section>
				{/if}
			{:else}
				<p class="hint">No layer selected.</p>
			{/if}
		</aside>
	</div>
</div>

<style>
	.page {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0e13;
	}
	.subbar {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 16px;
		border-bottom: 1px solid #1f2937;
		color: #cbd5e1;
		font-size: 13px;
	}
	.subbar strong {
		color: #e2e8f0;
	}
	.tag {
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		background: #1f2937;
		color: #93c5fd;
	}
	.subbar button {
		font-size: 12px;
		padding: 4px 10px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		cursor: pointer;
	}
	.spacer {
		flex: 1;
	}
	.count {
		color: #94a3b8;
	}
	.preview-note {
		color: #64748b;
		font-size: 11px;
	}
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.layers,
	.inspector {
		flex: none;
		border-color: #1f2937;
		padding: 12px;
		overflow-y: auto;
		color: #cbd5e1;
		font-size: 13px;
	}
	.layers {
		width: 200px;
		border-right: 1px solid #1f2937;
	}
	.inspector {
		width: 280px;
		border-left: 1px solid #1f2937;
	}
	.layers .head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 8px;
	}
	h3 {
		margin: 0 0 8px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.add {
		font-size: 12px;
		padding: 3px 8px;
		border-radius: 6px;
		border: 1px solid #2563eb;
		background: #161b22;
		color: #bfdbfe;
		cursor: pointer;
	}
	.layers ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.layers li {
		display: flex;
		align-items: stretch;
		gap: 4px;
	}
	.layers li.active .pick {
		border-color: #3b82f6;
		background: #182231;
	}
	.pick {
		flex: 1;
		text-align: left;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #14181f;
		color: #e2e8f0;
		cursor: pointer;
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.pick .meta {
		color: #64748b;
		font-size: 10px;
	}
	.del {
		padding: 0 8px;
		border-radius: 6px;
		border: 1px solid #5b2a2a;
		background: #1d1416;
		color: #fca5a5;
		cursor: pointer;
		font-size: 11px;
	}
	.del:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.canvas {
		flex: 1;
		min-width: 0;
	}
	section {
		border-top: 1px solid #1f2937;
		padding-top: 10px;
		margin-bottom: 10px;
	}
	section:first-child {
		border-top: none;
		padding-top: 0;
	}
	.row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
		font-size: 12px;
	}
	.row > span {
		color: #94a3b8;
	}
	.row input,
	.row select {
		width: 130px;
		padding: 3px 6px;
		border-radius: 5px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	.row.check {
		justify-content: flex-start;
	}
	.row.check input {
		width: auto;
	}
	.frames {
		display: flex;
		flex-direction: column;
		gap: 3px;
		max-height: 180px;
		overflow-y: auto;
		margin-bottom: 8px;
		padding: 4px;
		border: 1px solid #1f2937;
		border-radius: 6px;
	}
	.frame {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: #cbd5e1;
	}
	.hint {
		color: #64748b;
		font-size: 11px;
	}
</style>
