<script lang="ts">
	import type { PageData } from './$types';
	import type { AtlasRegion } from '$lib/atlas-types';

	let { data }: { data: PageData } = $props();

	type Variant = { key: string; size: number; lastModified: number };
	type Region = AtlasRegion & { _uid: string };

	let _seq = 0;
	const uid = () => `r${Date.now().toString(36)}_${_seq++}`;

	let regions = $state<Region[]>(
		(data.manifest.regions ?? []).map((r) => ({ ...structuredClone(r), _uid: uid() })),
	);
	let selectedUid = $state<string>(regions[0]?._uid ?? '');
	let search = $state('');
	let busy = $state(false);
	let saving = $state(false);
	let err = $state('');
	let info = $state('');
	let dirty = $state(false);

	// region name -> its variants (lazy-loaded)
	let variantsByRegion = $state<Record<string, Variant[]>>({});
	let loadingVariants = $state(false);

	const filtered = $derived(
		regions.filter((r) => r.name.toLowerCase().includes(search.trim().toLowerCase())),
	);
	const selected = $derived(regions.find((r) => r._uid === selectedUid) ?? null);
	const variants = $derived(selected?.name ? (variantsByRegion[selected.name] ?? []) : []);

	function imgUrl(key: string): string {
		return `/atlas/image?key=${encodeURIComponent(key)}`;
	}

	function markDirty() {
		dirty = true;
		info = '';
	}

	async function selectRegion(u: string) {
		selectedUid = u;
		err = '';
	}

	async function loadVariants(name: string) {
		loadingVariants = true;
		try {
			const res = await fetch(`/atlas/variants?region=${encodeURIComponent(name)}`);
			const body = await res.json();
			if (res.ok) variantsByRegion[name] = body.variants ?? [];
		} catch {
			/* leave empty */
		} finally {
			loadingVariants = false;
		}
	}

	async function generate() {
		if (!selected) return;
		if (!selected.prompt?.trim()) {
			err = 'Enter a prompt first.';
			return;
		}
		busy = true;
		err = '';
		info = '';
		try {
			const res = await fetch('/atlas/generate', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ region: $state.snapshot(selected) }),
			});
			const body = await res.json();
			if (!res.ok) {
				err = body.message ?? 'Generation failed.';
			} else {
				info = `Generated (seed ${body.seed}).`;
				await loadVariants(selected.name);
				// auto-select the freshest variant as the chosen output
				selected.output_key = body.r2_key;
				markDirty();
			}
		} catch (e) {
			err = String(e);
		} finally {
			busy = false;
		}
	}

	function chooseOutput(key: string) {
		if (!selected) return;
		selected.output_key = key;
		markDirty();
	}

	function addRegion() {
		const base = 'new_region';
		let name = base;
		let i = 1;
		while (regions.some((r) => r.name === name)) name = `${base}_${i++}`;
		const r: Region = { name, prompt: '', mode: 'generate', _uid: uid() };
		regions.push(r);
		selectedUid = r._uid;
		markDirty();
	}

	function deleteRegion() {
		if (!selected) return;
		if (!confirm(`Delete region "${selected.name}"?`)) return;
		const u = selected._uid;
		regions = regions.filter((r) => r._uid !== u);
		selectedUid = regions[0]?._uid ?? '';
		markDirty();
	}

	async function saveManifest() {
		saving = true;
		err = '';
		info = '';
		try {
			const cleanRegions = $state.snapshot(regions).map((r) => {
				const { _uid, ...rest } = r;
				void _uid;
				return rest;
			});
			const manifest = {
				...$state.snapshot(data.manifest),
				regions: cleanRegions,
			};
			const res = await fetch('/atlas/manifest', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(manifest),
			});
			const body = await res.json();
			if (!res.ok) err = body.message ?? 'Save failed.';
			else {
				info = `Saved ${body.regions} regions.`;
				dirty = false;
			}
		} catch (e) {
			err = String(e);
		} finally {
			saving = false;
		}
	}

	$effect(() => {
		const name = selected?.name;
		if (name && !(name in variantsByRegion)) loadVariants(name);
	});

	const numFields: { key: keyof AtlasRegion; label: string; step: number }[] = [
		{ key: 'controlnet_strength', label: 'ControlNet strength', step: 0.05 },
		{ key: 'controlnet_end_percent', label: 'ControlNet end %', step: 0.05 },
		{ key: 'ipadapter_weight', label: 'IPAdapter weight', step: 0.05 },
		{ key: 'lora_strength', label: 'LoRA strength', step: 0.05 },
	];
</script>

<svelte:head><title>Atlas Maker — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand">INVISIBLE WALL · ATLAS MAKER</div>
		<div class="head-actions">
			<span class="muted">{regions.length} regions · {data.config.pipeline ?? 'sdxl'}</span>
			<button class="save" class:dirty onclick={saveManifest} disabled={saving || !dirty}>
				{saving ? 'Saving…' : dirty ? 'Save manifest' : 'Saved'}
			</button>
			<a class="ghost" href="/">‹ Launcher</a>
		</div>
	</header>

	{#if data.missing}
		<p class="err">
			No manifest found in R2 at <code>{data.manifestKey}</code>. Create one to begin.
		</p>
	{/if}

	{#if err}<p class="err">{err}</p>{/if}
	{#if info}<p class="ok">{info}</p>{/if}

	<div class="layout">
		<!-- LEFT: region list -->
		<aside class="list">
			<input class="search" placeholder="Filter regions…" bind:value={search} />
			<div class="rows">
				{#each filtered as r (r._uid)}
					<button
						class="row"
						class:active={r._uid === selectedUid}
						onclick={() => selectRegion(r._uid)}
					>
						<span class="thumb">
							{#if r.output_key}
								<img src={imgUrl(r.output_key)} alt="" loading="lazy" />
							{:else}
								<span class="empty-dot"></span>
							{/if}
						</span>
						<span class="rname">{r.name}</span>
						{#if r.skip_unless_explicit}<span class="tag">skip</span>{/if}
					</button>
				{/each}
			</div>
			<button class="add" onclick={addRegion}>+ Add region</button>
		</aside>

		<!-- CENTER: editor -->
		<section class="editor">
			{#if selected}
				<label
					>Name <span class="hint">(also the R2 variant folder)</span>
					<input bind:value={selected.name} oninput={markDirty} />
				</label>

				<label
					>Mode
					<select bind:value={selected.mode} onchange={markDirty}>
						<option value="generate">generate</option>
						<option value="shine">shine</option>
						<option value="glow">glow</option>
						<option value="shadow">shadow</option>
						<option value="colour">colour</option>
					</select>
				</label>

				<label
					>Prompt
					<textarea
						bind:value={selected.prompt}
						oninput={markDirty}
						rows="4"
						placeholder="e.g. a glossy golden gemstone, shiny game icon, isolated subject"
					></textarea>
				</label>

				<div class="two">
					<label
						>Seed (blank = random)
						<input
							type="number"
							value={selected.seed ?? ''}
							oninput={(e) => {
								const v = (e.currentTarget as HTMLInputElement).value;
								selected!.seed = v === '' ? null : Number(v);
								markDirty();
							}}
						/>
					</label>
					<label class="check">
						<input
							type="checkbox"
							bind:checked={selected.skip_unless_explicit}
							onchange={markDirty}
						/>
						Skip in batch
					</label>
				</div>

				<label
					>Style ref (R2 key — blank uses default)
					<input
						bind:value={selected.style_ref}
						oninput={markDirty}
						placeholder={data.defaultStyleRef}
					/>
				</label>
				<label
					>Shape ref (R2 key — optional ControlNet)
					<input bind:value={selected.shape_ref} oninput={markDirty} placeholder="(none)" />
				</label>

				<details class="adv">
					<summary>Advanced overrides</summary>
					<div class="two">
						{#each numFields as f (f.key)}
							<label
								>{f.label}
								<input
									type="number"
									step={f.step}
									value={(selected[f.key] as number | undefined) ?? ''}
									oninput={(e) => {
										const v = (e.currentTarget as HTMLInputElement).value;
										(selected as Record<string, unknown>)[f.key] = v === '' ? undefined : Number(v);
										markDirty();
									}}
									placeholder="inherit"
								/>
							</label>
						{/each}
					</div>
				</details>

				<div class="gen-row">
					<button class="generate" onclick={generate} disabled={busy}>
						{busy ? 'Generating on local GPU…' : 'Generate'}
					</button>
					<button class="danger" onclick={deleteRegion}>Delete</button>
				</div>
			{:else}
				<p class="placeholder">Select or add a region to edit.</p>
			{/if}
		</section>

		<!-- RIGHT: preview + variants -->
		<section class="right">
			<div class="preview">
				{#if busy}
					<div class="placeholder">Generating…</div>
				{:else if selected?.output_key}
					<img src={imgUrl(selected.output_key)} alt="chosen output" />
					<p class="muted">chosen · <code>{selected.output_key.split('/').pop()}</code></p>
				{:else}
					<div class="placeholder">No output chosen yet.</div>
				{/if}
			</div>

			<div class="variants">
				<div class="vhead">
					<span>Variants</span>
					{#if selected}
						<button class="ghost sm" onclick={() => loadVariants(selected!.name)}>↻</button>
					{/if}
				</div>
				{#if loadingVariants}
					<p class="muted">Loading…</p>
				{:else if variants.length === 0}
					<p class="muted">No variants yet. Generate one.</p>
				{:else}
					<div class="vgrid">
						{#each variants as v (v.key)}
							<button
								class="vcell"
								class:chosen={selected?.output_key === v.key}
								onclick={() => chooseOutput(v.key)}
								title={v.key}
							>
								<img src={imgUrl(v.key)} alt="" loading="lazy" />
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</section>
	</div>
</div>

<style>
	.shell {
		max-width: 1500px;
		margin: 0 auto;
		padding: 20px 22px 40px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 16px;
	}
	.brand {
		font-weight: 700;
		letter-spacing: 0.12em;
		color: #7ee0c0;
		font-size: 14px;
	}
	.head-actions {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.ghost {
		border: 1px solid #333;
		color: #aaa;
		padding: 6px 12px;
		border-radius: 8px;
		text-decoration: none;
		font-size: 13px;
		background: none;
		cursor: pointer;
	}
	.ghost.sm {
		padding: 2px 8px;
	}
	.save {
		background: #2a2a32;
		color: #888;
		border: 1px solid #333;
		padding: 7px 14px;
		border-radius: 8px;
		font-size: 13px;
		cursor: default;
	}
	.save.dirty {
		background: #6b5bff;
		color: #fff;
		border-color: #6b5bff;
		cursor: pointer;
	}
	.layout {
		display: grid;
		grid-template-columns: 280px 1fr 360px;
		gap: 16px;
		align-items: start;
	}

	.list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		max-height: 80vh;
	}
	.search {
		background: #0e0e12;
		color: #eee;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 8px 10px;
		font-size: 13px;
	}
	.rows {
		display: flex;
		flex-direction: column;
		gap: 3px;
		overflow-y: auto;
		flex: 1;
		padding-right: 4px;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 9px;
		background: #14141a;
		border: 1px solid transparent;
		border-radius: 8px;
		padding: 5px 8px;
		cursor: pointer;
		text-align: left;
		color: #cfcfd6;
		font-size: 13px;
	}
	.row.active {
		border-color: #6b5bff;
		background: #1b1830;
	}
	.thumb {
		width: 30px;
		height: 30px;
		border-radius: 6px;
		overflow: hidden;
		flex: none;
		background: repeating-conic-gradient(#2a2a32 0% 25%, #20202700 0% 50%) 50% / 12px 12px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.thumb img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}
	.empty-dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #3a3a44;
	}
	.rname {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.tag {
		font-size: 10px;
		color: #888;
		border: 1px solid #333;
		border-radius: 4px;
		padding: 0 4px;
	}
	.add {
		background: none;
		border: 1px dashed #3a3a44;
		color: #9a9aa5;
		border-radius: 8px;
		padding: 8px;
		cursor: pointer;
		font-size: 13px;
	}

	.editor {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		color: #9a9aa5;
	}
	label.check {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}
	input,
	select,
	textarea {
		background: #0e0e12;
		color: #eee;
		border: 1px solid #333;
		border-radius: 8px;
		padding: 9px 10px;
		font-size: 14px;
		font-family: inherit;
		resize: vertical;
	}
	input[type='checkbox'] {
		width: auto;
	}
	.two {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	.adv summary {
		cursor: pointer;
		font-size: 12px;
		color: #9a9aa5;
		padding: 4px 0;
	}
	.adv .two {
		margin-top: 8px;
	}
	.gen-row {
		display: flex;
		gap: 10px;
		margin-top: 4px;
	}
	.generate {
		flex: 1;
		background: #6b5bff;
		color: #fff;
		border: none;
		padding: 12px;
		border-radius: 8px;
		font-size: 15px;
		cursor: pointer;
	}
	.generate:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.danger {
		background: none;
		border: 1px solid #5a2a2a;
		color: #ff7b72;
		border-radius: 8px;
		padding: 0 14px;
		cursor: pointer;
		font-size: 13px;
	}

	.right {
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.preview {
		min-height: 320px;
		border: 1px solid #222;
		border-radius: 12px;
		background: #16161c;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 14px;
	}
	.preview img {
		max-width: 100%;
		max-height: 360px;
		border-radius: 8px;
		background: repeating-conic-gradient(#2a2a32 0% 25%, #20202700 0% 50%) 50% / 20px 20px;
	}
	.variants {
		border: 1px solid #222;
		border-radius: 12px;
		background: #16161c;
		padding: 12px;
	}
	.vhead {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 13px;
		color: #cfcfd6;
		margin-bottom: 8px;
	}
	.vgrid {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.vcell {
		aspect-ratio: 1;
		border: 2px solid transparent;
		border-radius: 8px;
		overflow: hidden;
		padding: 0;
		cursor: pointer;
		background: repeating-conic-gradient(#2a2a32 0% 25%, #20202700 0% 50%) 50% / 14px 14px;
	}
	.vcell.chosen {
		border-color: #7ee0c0;
	}
	.vcell img {
		width: 100%;
		height: 100%;
		object-fit: contain;
	}

	.placeholder {
		color: #6a6a76;
		font-size: 14px;
	}
	.muted {
		color: #888;
		font-size: 12px;
	}
	.hint {
		color: #5a5a64;
		font-size: 10px;
	}
	.err {
		color: #ff7b72;
		font-size: 13px;
	}
	.ok {
		color: #7ee0c0;
		font-size: 13px;
	}
	code {
		background: #1c1c24;
		padding: 1px 5px;
		border-radius: 4px;
		font-size: 11px;
	}
</style>
