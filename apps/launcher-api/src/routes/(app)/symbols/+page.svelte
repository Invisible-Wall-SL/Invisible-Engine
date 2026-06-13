<script lang="ts">
	import { onMount } from 'svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import RegionPicker from '../editor/RegionPicker.svelte';
	import {
		fetchRegions,
		type EditorRegion,
		type RegionSet,
	} from '../editor/editorRegions.client';
	import SymbolSpinePreview from './SymbolSpinePreview.svelte';
	import SymbolSpritePreview from './SymbolSpritePreview.svelte';
	import {
		STATE_LABELS,
		SYMBOL_STATES,
		clearOverride,
		docSignature,
		effectiveCell,
		saveSymbolsDoc,
		setOverride,
		type SymbolCell,
		type SymbolState,
		type SymbolsDoc,
	} from './symbols.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const projectLabel = $derived(data.projectName ?? data.projectKey);

	// Symbol rows come from the coded defaults (the source of truth for the set).
	const symbolNames = $derived(Object.keys(data.defaults.symbols));

	// Responsive cell sizing — the grid fills the page WIDTH so it no longer sits tiny
	// in the top-left, and each preview scales with the 6 state columns. Width-driven
	// (with vertical scroll for the symbol rows, like the in-game debug grid) so cells
	// stay large and legible; clamped so they're crisp on small screens and don't blow
	// up on ultra-wide ones. A ResizeObserver on the scroll area tracks window resize +
	// the side panel opening/closing live.
	const LABEL_COL = 92;
	const GRID_GAP = 10;
	const GRID_PAD = 36;
	const MIN_CELL = 72;
	const MAX_CELL = 168;
	let viewW = $state(1280);
	let gridScroll = $state<HTMLElement | null>(null);
	const previewSize = $derived.by(() => {
		const cols = SYMBOL_STATES.length;
		const byWidth = (viewW - LABEL_COL - GRID_GAP * (cols + 1) - GRID_PAD) / cols;
		return Math.round(Math.max(MIN_CELL, Math.min(MAX_CELL, byWidth)));
	});

	onMount(() => {
		if (!gridScroll) return;
		const ro = new ResizeObserver((entries) => {
			const rect = entries[0]?.contentRect;
			if (rect) viewW = rect.width;
		});
		ro.observe(gridScroll);
		return () => ro.disconnect();
	});

	/** Atlases + sheets a sprite frame can be picked from (mirrors the editor). */
	const pickSheets = $derived([
		...data.assets.atlases
			.filter((a) => a.kind === 'atlas-manifest')
			.map((a) => ({ key: a.key, name: a.name })),
		...data.assets.sheets.map((s) => ({ key: s.key, name: s.name })),
	]);

	/** Spine bundles available for spine cells (project + shared). */
	const spineBundles = $derived(data.assets.spines.map((s) => ({ name: s.name, key: s.key })));

	// Frame name → its region, built ONCE for the whole grid by fetching every sheet
	// in PARALLEL. Previously each sprite cell scanned the sheet list itself, and
	// because they all awaited the shared region cache in the same order the fetches
	// serialised (everyone blocked on sheet 1 before requesting sheet 2) — ~N heavy
	// `/api/editor/regions` calls back-to-back. Now it's one parallel burst; cells are
	// O(1) lookups. `null` while the first build is in flight → cells show a loading bar.
	let spriteIndex = $state<Map<string, { set: RegionSet; region: EditorRegion }> | null>(null);
	$effect(() => {
		const list = pickSheets;
		let cancelled = false;
		spriteIndex = null;
		void (async () => {
			const sets = await Promise.all(list.map((s) => fetchRegions(s.key)));
			if (cancelled) return;
			const idx = new Map<string, { set: RegionSet; region: EditorRegion }>();
			for (const set of sets) {
				for (const region of set.regions) {
					if (!idx.has(region.name)) idx.set(region.name, { set, region });
				}
			}
			spriteIndex = idx;
		})();
		return () => {
			cancelled = true;
		};
	});

	// The working doc (sparse overrides). Cloned so edits don't mutate `data`.
	let doc = $state<SymbolsDoc>(structuredClone(data.doc) as SymbolsDoc);
	const savedSig = $state({ value: docSignature(structuredClone(data.doc) as SymbolsDoc) });
	const dirty = $derived(docSignature(doc) !== savedSig.value);

	let saving = $state(false);
	let saveError = $state<string | null>(null);
	let savedAt = $state<string | null>(data.doc.updatedAt ?? null);

	// The focused cell — drives the live spine preview (only ONE spine renders at a
	// time, the heavy bit) and the cell editor panel.
	let focus = $state<{ symbol: string; state: SymbolState } | null>(null);
	const focusCell = $derived(
		focus ? effectiveCell(doc, data.defaults, focus.symbol, focus.state) : null,
	);

	// Draft of the focused cell, edited in the panel before "Apply".
	let draft = $state<SymbolCell | null>(null);
	// Animation names of the draft's spine bundle (filled by the preview load).
	let draftAnimations = $state<string[]>([]);

	function openCell(symbol: string, state: SymbolState): void {
		focus = { symbol, state };
		const eff = effectiveCell(doc, data.defaults, symbol, state);
		draft = eff.cell
			? structuredClone(eff.cell)
			: { type: 'sprite', assetKey: '', sizeRatios: { width: 1, height: 1 } };
		draftAnimations = [];
	}

	function closeCell(): void {
		focus = null;
		draft = null;
		draftAnimations = [];
	}

	function setDraftType(type: 'sprite' | 'spine'): void {
		if (!draft || draft.type === type) return;
		// Switching type clears the asset binding (a frame name ≠ a spine bundle).
		draft = {
			type,
			assetKey: '',
			animationName: type === 'spine' ? '' : undefined,
			sizeRatios: draft.sizeRatios,
		};
		draftAnimations = [];
	}

	function applyDraft(): void {
		if (!focus || !draft) return;
		if (!draft.assetKey) return;
		const cell: SymbolCell = {
			type: draft.type,
			assetKey: draft.assetKey,
			sizeRatios: {
				width: Number(draft.sizeRatios.width) || 0,
				height: Number(draft.sizeRatios.height) || 0,
			},
		};
		if (draft.type === 'spine' && draft.animationName) cell.animationName = draft.animationName;
		doc = setOverride(doc, focus.symbol, focus.state, cell);
		closeCell();
	}

	function resetCell(symbol: string, state: SymbolState): void {
		doc = clearOverride(doc, symbol, state);
		if (focus && focus.symbol === symbol && focus.state === state) closeCell();
	}

	async function save(): Promise<void> {
		if (!dirty || saving) return;
		saving = true;
		saveError = null;
		try {
			const stamped = await saveSymbolsDoc(data.projectKey, doc);
			doc = structuredClone(stamped);
			savedSig.value = docSignature(doc);
			savedAt = stamped.updatedAt ?? new Date().toISOString();
		} catch (e) {
			saveError = e instanceof Error ? e.message : String(e);
		} finally {
			saving = false;
		}
	}

	/** Last path segment of a full spine-bundle R2 prefix, for a readable chip. The
	 *  STORED `assetKey` stays the full prefix (resolution needs it); this is display
	 *  only. Sprite frame keys have no trailing slash, so they pass through unchanged. */
	function displayKey(cell: SymbolCell): string {
		const trimmed = cell.assetKey.replace(/\/$/, '');
		return cell.type === 'spine' ? (trimmed.split('/').pop() ?? trimmed) : trimmed;
	}

	/** Short binding label for a cell chip (`type · assetKey · anim`). */
	function cellLabel(cell: SymbolCell | undefined): string {
		if (!cell) return 'unset';
		const parts = [cell.type, cell.assetKey];
		if (cell.animationName) parts.push(cell.animationName);
		return parts.join(' · ');
	}

	function isFocused(symbol: string, state: SymbolState): boolean {
		return !!focus && focus.symbol === symbol && focus.state === state;
	}
</script>

<div class="shell">
	<header>
		<div class="topbar">
			<ToolTopBar current="symbols" tools={data.tools} />
		</div>
		<div class="meta">
			<span class="project">
				{#if data.clientKey}<span class="client">{data.clientKey}</span> /
				{/if}
				<strong>{projectLabel}</strong>
			</span>
			<div class="save-area">
				{#if saveError}<span class="save-err">{saveError}</span>{/if}
				{#if !dirty && savedAt}<span class="saved">Saved</span>{/if}
				<button class="save" type="button" disabled={!dirty || saving} onclick={save}>
					{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
				</button>
			</div>
		</div>
	</header>

	<div class="body" class:has-panel={!!focus}>
		<div class="grid-scroll" bind:this={gridScroll}>
			{#if symbolNames.length === 0}
				<p class="muted">No symbols defined for this game type.</p>
			{:else}
				<table class="grid" style="--cell: {previewSize}px">
					<thead>
						<tr>
							<th class="corner">Symbol</th>
							{#each SYMBOL_STATES as state (state)}
								<th>{STATE_LABELS[state]}</th>
							{/each}
						</tr>
					</thead>
					<tbody>
						{#each symbolNames as symbol (symbol)}
							<tr>
								<th class="rowhead">{symbol}</th>
								{#each SYMBOL_STATES as state (state)}
									{@const eff = effectiveCell(doc, data.defaults, symbol, state)}
									<td>
										<button
											type="button"
											class="cell"
											class:overridden={eff.overridden}
											class:focused={isFocused(symbol, state)}
											class:empty={!eff.cell}
											onclick={() => openCell(symbol, state)}
											title={cellLabel(eff.cell)}
										>
											<div class="preview">
												{#if !eff.cell}
													<span class="chip">unset</span>
												{:else if eff.cell.type === 'sprite'}
													<SymbolSpritePreview
														frame={eff.cell.assetKey}
														index={spriteIndex}
														size={previewSize}
													/>
												{:else if isFocused(symbol, state)}
													<SymbolSpinePreview
														assetKey={eff.cell.previewKey ?? eff.cell.assetKey}
														animationName={eff.cell.animationName}
														size={previewSize}
													/>
												{:else}
													<span class="chip spine" title={cellLabel(eff.cell)}>
														<span class="chip-key">{displayKey(eff.cell)}</span>
														{#if eff.cell.animationName}
															<span class="chip-anim">{eff.cell.animationName}</span>
														{/if}
													</span>
												{/if}
											</div>
											<div class="cell-foot">
												{#if eff.overridden}<span class="badge">edited</span>{/if}
											</div>
										</button>
										{#if eff.overridden}
											<button
												type="button"
												class="reset"
												title="Reset to default"
												onclick={(e) => {
													e.stopPropagation();
													resetCell(symbol, state);
												}}>↺</button
											>
										{/if}
									</td>
								{/each}
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}
		</div>

		{#if focus && draft}
			<aside class="panel">
				<div class="panel-head">
					<h2>{focus.symbol} · {STATE_LABELS[focus.state]}</h2>
					<button class="x" type="button" onclick={closeCell} title="Close">×</button>
				</div>

				<div class="field">
					<span class="label">Type</span>
					<div class="seg">
						<button
							type="button"
							class:active={draft.type === 'sprite'}
							onclick={() => setDraftType('sprite')}>Sprite</button
						>
						<button
							type="button"
							class:active={draft.type === 'spine'}
							onclick={() => setDraftType('spine')}>Spine</button
						>
					</div>
				</div>

				{#if draft.type === 'sprite'}
					<div class="field">
						<span class="label">Frame</span>
						<RegionPicker
							sheets={pickSheets}
							value={draft.assetKey}
							onSelect={(region) => {
								if (draft) draft.assetKey = region;
							}}
						/>
					</div>
				{:else}
					<div class="field">
						<span class="label">Spine bundle</span>
						<select
							value={draft.assetKey}
							onchange={(e) => {
								if (!draft) return;
								draft.assetKey = e.currentTarget.value;
								// Picking a real R2 bundle prefix supersedes the default's tool-only
								// previewKey, so the preview + the saved override use the chosen bundle.
								draft.previewKey = undefined;
								draft.animationName = '';
								draftAnimations = [];
							}}
						>
							<option value="">Pick a bundle…</option>
							{#each spineBundles as b (b.key)}
								<option value={b.key}>{b.name}</option>
							{/each}
						</select>
					</div>
					{#if draft.assetKey}
						<div class="field">
							<span class="label">Animation</span>
							{#if draftAnimations.length}
								<select
									value={draft.animationName ?? ''}
									onchange={(e) => {
										if (draft) draft.animationName = e.currentTarget.value;
									}}
								>
									<option value="">(first animation)</option>
									{#each draftAnimations as anim (anim)}
										<option value={anim}>{anim}</option>
									{/each}
								</select>
							{:else}
								<input
									type="text"
									placeholder="animation name"
									value={draft.animationName ?? ''}
									oninput={(e) => {
										if (draft) draft.animationName = e.currentTarget.value;
									}}
								/>
							{/if}
						</div>
						<div class="field">
							<span class="label">Preview</span>
							<div class="panel-preview">
								<SymbolSpinePreview
									assetKey={draft.previewKey ?? draft.assetKey}
									animationName={draft.animationName}
									size={120}
									onAnimations={(names) => (draftAnimations = names)}
								/>
							</div>
						</div>
					{/if}
				{/if}

				<div class="field row">
					<label class="num">
						<span class="label">Width ratio</span>
						<input
							type="number"
							step="0.001"
							value={draft.sizeRatios.width}
							oninput={(e) => {
								if (draft) draft.sizeRatios.width = Number(e.currentTarget.value);
							}}
						/>
					</label>
					<label class="num">
						<span class="label">Height ratio</span>
						<input
							type="number"
							step="0.001"
							value={draft.sizeRatios.height}
							oninput={(e) => {
								if (draft) draft.sizeRatios.height = Number(e.currentTarget.value);
							}}
						/>
					</label>
				</div>

				<div class="panel-actions">
					{#if focusCell?.overridden}
						<button
							type="button"
							class="ghost"
							onclick={() => resetCell(focus!.symbol, focus!.state)}>Reset to default</button
						>
					{/if}
					<button type="button" class="apply" disabled={!draft.assetKey} onclick={applyDraft}>
						Apply
					</button>
				</div>
			</aside>
		{/if}
	</div>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		background: #0b0b0f;
		color: #d8d8e0;
	}
	header {
		flex: none;
		border-bottom: 1px solid #1d1d26;
	}
	.topbar {
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 16px 0;
	}
	.meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 8px 16px 10px;
	}
	.project {
		font-size: 13px;
		color: #9a9aa6;
	}
	.project .client {
		color: #6a6a76;
	}
	.save-area {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.save-err {
		color: #d98a8a;
		font-size: 12px;
		max-width: 320px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.saved {
		color: #6fae8e;
		font-size: 12px;
	}
	.save {
		padding: 6px 16px;
		border-radius: 6px;
		border: 1px solid #2c6a52;
		background: #163a2c;
		color: #8fe6c0;
		font-weight: 600;
		cursor: pointer;
	}
	.save:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.body {
		flex: 1;
		display: grid;
		grid-template-columns: 1fr;
		min-height: 0;
	}
	.body.has-panel {
		grid-template-columns: 1fr 320px;
	}
	.grid-scroll {
		overflow: auto;
		padding: 18px;
	}
	.muted {
		color: #777;
	}
	.grid {
		width: 100%;
		table-layout: fixed;
		border-collapse: separate;
		border-spacing: 10px;
	}
	.grid th {
		font-size: 13px;
		font-weight: 600;
		color: #9a9aa6;
		text-align: center;
		padding: 4px 6px;
	}
	.grid th.corner,
	.grid th.rowhead {
		width: 92px;
	}
	.grid th.corner {
		text-align: left;
	}
	.grid th.rowhead {
		text-align: right;
		color: #c8c8d0;
		font-size: 15px;
		font-weight: 700;
		position: sticky;
		left: 0;
		background: #0b0b0f;
	}
	.grid td {
		position: relative;
		padding: 0;
	}
	.cell {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		width: 100%;
		padding: 8px 6px 6px;
		background: #14141a;
		border: 1px solid #24242e;
		border-radius: 8px;
		cursor: pointer;
		color: inherit;
	}
	.cell:hover {
		border-color: #3a3a48;
	}
	.cell.overridden {
		border-color: #4d6bd8;
	}
	.cell.focused {
		border-color: #7ee0c0;
		box-shadow: 0 0 0 1px #7ee0c0 inset;
	}
	.cell.empty {
		opacity: 0.7;
	}
	.preview {
		width: var(--cell, 56px);
		height: var(--cell, 56px);
		display: grid;
		place-items: center;
	}
	.chip {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		width: var(--cell, 56px);
		height: var(--cell, 56px);
		border-radius: 6px;
		background: #1a1a22;
		border: 1px dashed #33333f;
		color: #8a8a96;
		font-size: clamp(9px, calc(var(--cell, 56px) * 0.13), 15px);
		padding: 4px;
		gap: 2px;
	}
	.chip.spine {
		border-style: solid;
		border-color: #2e2e6a;
		background: #15152a;
	}
	.chip-key {
		font-weight: 600;
		color: #b9b9e0;
		max-width: calc(var(--cell, 56px) - 10px);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.chip-anim {
		max-width: calc(var(--cell, 56px) - 10px);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.cell-foot {
		height: 14px;
		display: flex;
		align-items: center;
	}
	.badge {
		font-size: 9px;
		color: #9fb4ff;
		background: #1c2240;
		border-radius: 3px;
		padding: 1px 4px;
	}
	.reset {
		position: absolute;
		top: 2px;
		right: 2px;
		width: 18px;
		height: 18px;
		border-radius: 4px;
		border: 1px solid #33333f;
		background: #14141a;
		color: #b9b9c4;
		font-size: 11px;
		line-height: 1;
		cursor: pointer;
		padding: 0;
	}
	.reset:hover {
		border-color: #5b8cff;
		color: #cfe0ff;
	}

	.panel {
		border-left: 1px solid #1d1d26;
		background: #0e0e13;
		padding: 14px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	.panel-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.panel-head h2 {
		font-size: 14px;
		margin: 0;
		color: #e0e0e8;
	}
	.x {
		width: 24px;
		height: 24px;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		background: transparent;
		color: #9a9aa6;
		cursor: pointer;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.field.row {
		flex-direction: row;
		gap: 10px;
	}
	.label {
		font-size: 11px;
		color: #8a8a96;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.seg {
		display: flex;
		gap: 4px;
	}
	.seg button {
		flex: 1;
		padding: 6px;
		border: 1px solid #2a2a33;
		border-radius: 5px;
		background: #16161c;
		color: #b9b9c4;
		font-size: 12px;
		cursor: pointer;
	}
	.seg button.active {
		border-color: #5b8cff;
		background: #1b2236;
		color: #cfe0ff;
	}
	select,
	input[type='text'],
	input[type='number'] {
		width: 100%;
		padding: 6px 8px;
		background: #16161c;
		border: 1px solid #2a2a33;
		border-radius: 5px;
		color: #d8d8e0;
		font-size: 12px;
	}
	.num {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 5px;
		min-width: 0;
	}
	.panel-preview {
		display: grid;
		place-items: center;
		padding: 8px;
		background: #0b0b10;
		border: 1px solid #1d1d26;
		border-radius: 6px;
	}
	.panel-actions {
		display: flex;
		gap: 8px;
		margin-top: auto;
		padding-top: 8px;
	}
	.apply {
		flex: 1;
		padding: 8px;
		border-radius: 6px;
		border: 1px solid #2c6a52;
		background: #163a2c;
		color: #8fe6c0;
		font-weight: 600;
		cursor: pointer;
	}
	.apply:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.ghost {
		padding: 8px 12px;
		border-radius: 6px;
		border: 1px solid #2a2a33;
		background: transparent;
		color: #b9b9c4;
		cursor: pointer;
	}
</style>
