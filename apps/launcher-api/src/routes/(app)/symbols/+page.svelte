<script lang="ts">
	import { onMount } from 'svelte';
	import { invalidateAll } from '$app/navigation';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import RegionPicker from '../editor/RegionPicker.svelte';
	import { fetchRegions, type EditorRegion, type RegionSet } from '../editor/editorRegions.client';
	import SymbolSpinePreview from './SymbolSpinePreview.svelte';
	import SymbolSpineStage from './SymbolSpineStage.svelte';
	import SymbolSpritePreview from './SymbolSpritePreview.svelte';
	import {
		STATE_LABELS,
		visibleStatesFor,
		clearHighlight,
		clearOverride,
		clearWinLineStyle,
		docSignature,
		effectiveCell,
		effectiveHighlight,
		saveSymbolsDoc,
		setHighlight,
		setOverride,
		setWinLineEnabled,
		setWinLineLine,
		setWinLineText,
		winLineEnabled,
		type SymbolCell,
		type SymbolState,
		type SymbolsDoc,
	} from './symbols.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const projectLabel = $derived(data.projectName ?? data.projectKey);

	// Symbol rows come from the coded defaults (the source of truth for the set).
	const symbolNames = $derived(Object.keys(data.defaults.symbols));

	// The state columns the grid renders: the base 6, plus the two book-only states
	// (`bookIntro`/`bookIdle`) ONLY for a book game. Gated on the server-provided
	// `gameType`, so non-book games keep the original 6 columns unchanged.
	const visibleStates = $derived(visibleStatesFor(data.gameType));

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
		const cols = visibleStates.length;
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

	// "Reload from R2": after re-exporting/replacing a spine in R2 (e.g. from the
	// Rigger), the previews + picker would otherwise keep the cached bundle — the
	// skeleton/page fetches are HTTP-cached and the bundle list comes from the server
	// `load`. Bumping `reloadToken` drops the in-session spine caches and re-fetches
	// with a fresh `?v=`; `invalidateAll()` re-runs `load` so a brand-new bundle
	// (and refreshed animation names) shows up too. Local doc edits survive — `doc`
	// is its own `$state`, not derived from `data`.
	let reloadToken = $state(0);
	let reloading = $state(false);
	async function reloadFromR2(): Promise<void> {
		if (reloading) return;
		reloading = true;
		reloadToken++;
		try {
			await invalidateAll();
		} finally {
			reloading = false;
		}
	}

	// The focused cell — opens the cell editor panel (with its single live spine
	// preview). Grid spine cells animate via the shared <SymbolSpineStage>, not focus.
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
		// `$state.snapshot` (NOT `structuredClone`): an OVERRIDDEN cell is read from the `doc`
		// `$state` proxy, and `structuredClone` throws `DataCloneError` on a proxy — which left the
		// panel blank for any cell with a non-default binding. Default cells (plain page data) were
		// unaffected, which is why only edited cells broke. A brand-new override inherits the global
		// size by default (no `sizeRatios`).
		draft = eff.cell ? ($state.snapshot(eff.cell) as SymbolCell) : { type: 'sprite', assetKey: '' };
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
		};
		// Only persist a per-cell size when the author opted out of the global (sparse:
		// an absent `sizeRatios` = inherit `defaultSizeRatios`).
		if (draft.sizeRatios) {
			cell.sizeRatios = {
				width: Number(draft.sizeRatios.width) || 0,
				height: Number(draft.sizeRatios.height) || 0,
			};
		}
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

	// ── Global highlight (win frame) ──────────────────────────────────────────
	// A single spine that loops over winning symbols. The game's built-in default is the
	// engine's coded frame (`anticipation`/`payframe`, see SymbolSpine.svelte). That key
	// ships as a LOCAL game asset, but most projects ALSO have the bundle in R2 — so when a
	// matching R2 bundle exists we preview the real default; otherwise we fall back to a
	// "Default (payframe)" label. The user can still OVERRIDE with any R2 spine.
	const BUILTIN_FRAME = { assetKey: 'anticipation', animationName: 'payframe' };
	const highlight = $derived(effectiveHighlight(doc, data.defaults));
	// The project's R2 bundle that matches the built-in default frame, if any (matched by
	// name/key so we don't depend on the exact prefix). Used to preview the default.
	const defaultFrameBundle = $derived(
		highlight.overridden
			? undefined
			: spineBundles.find(
					(b) =>
						b.name === BUILTIN_FRAME.assetKey ||
						b.key === BUILTIN_FRAME.assetKey ||
						b.key.split('/').includes(BUILTIN_FRAME.assetKey),
				),
	);
	let highlightEditing = $state(false);
	let highlightDraft = $state<SymbolCell | null>(null);
	let highlightAnimations = $state<string[]>([]);

	function openHighlight(): void {
		// Seed the draft from an existing override, else a blank spine cell (we never
		// seed from the local default — it isn't an R2 bundle the picker can resolve).
		// `$state.snapshot` (NOT `structuredClone`): `doc.highlight` is a `$state` proxy and
		// `structuredClone` throws `DataCloneError` on a proxy (same bug as `openCell`).
		highlightDraft = doc.highlight
			? ($state.snapshot(doc.highlight) as SymbolCell)
			: { type: 'spine', assetKey: '', animationName: '', sizeRatios: { width: 1, height: 1 } };
		highlightAnimations = [];
		highlightEditing = true;
	}

	function closeHighlight(): void {
		highlightEditing = false;
		highlightDraft = null;
		highlightAnimations = [];
	}

	function applyHighlight(): void {
		if (!highlightDraft || !highlightDraft.assetKey) return;
		const sr = highlightDraft.sizeRatios ?? { width: 1, height: 1 };
		const cell: SymbolCell = {
			type: 'spine',
			assetKey: highlightDraft.assetKey,
			sizeRatios: {
				width: Number(sr.width) || 0,
				height: Number(sr.height) || 0,
			},
		};
		if (highlightDraft.animationName) cell.animationName = highlightDraft.animationName;
		doc = setHighlight(doc, cell);
		closeHighlight();
	}

	function resetHighlight(): void {
		doc = clearHighlight(doc);
		closeHighlight();
	}

	// ── Global win-line overlay (on/off + style) ──────────────────────────────
	// A plain on/off plus line + win-amount-text styling for the in-game winning-payline
	// overlay (pure config, no asset). Effective on/off defaults to ON when the doc has no
	// `winLine`; every style field falls through to the coded defaults below when unset, so
	// the doc stays sparse (only authored, non-default fields persist).
	const winLineOn = $derived(winLineEnabled(doc));

	// The game's coded win-line defaults (mirror Book of Borut's WinLine.svelte). Shown as
	// the input values when the author hasn't overridden a field.
	const WL_DEFAULTS = {
		color: '#ffcc00',
		width: 0.03,
		glow: false,
		glowColor: '#ffcc00',
		animated: false,
		speed: 1,
		font: 'gold',
		size: 0.5,
		textColor: '#ffffff',
	} as const;

	// Engine builtin bitmap fonts (declared in each game's Game.svelte, not in the R2
	// catalog) unioned with the project's Font-Maker fonts for the text font dropdown.
	const BUILTIN_FONTS = ['gold', 'goldblur', 'silver', 'purple'];
	const fontOptions = $derived.by(() => {
		const names = new Set(BUILTIN_FONTS);
		for (const f of data.fonts) names.add(f.name);
		return [...names];
	});

	const wlLine = $derived(doc.winLine?.line ?? {});
	const wlText = $derived(doc.winLine?.text ?? {});

	function patchWinLineLine(patch: Partial<NonNullable<SymbolsDoc['winLine']>['line']>): void {
		doc = setWinLineLine(doc, patch ?? {});
	}
	function patchWinLineText(patch: Partial<NonNullable<SymbolsDoc['winLine']>['text']>): void {
		doc = setWinLineText(doc, patch ?? {});
	}

	function toggleWinLine(enabled: boolean): void {
		doc = setWinLineEnabled(doc, enabled);
	}

	function resetWinLineStyle(): void {
		doc = clearWinLineStyle(doc);
	}
</script>

<div class="shell">
	<header>
		<div class="topbar">
			<ToolTopBar
				current="symbols"
				tools={data.tools}
				clientKey={data.clientKey}
				projectKey={data.projectKey}
			/>
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
				<button
					class="reload"
					type="button"
					disabled={reloading}
					title="Re-fetch spine bundles + previews from R2 (after re-exporting art)"
					onclick={reloadFromR2}
				>
					{reloading ? 'Reloading…' : '↻ Reload from R2'}
				</button>
				<button class="save" type="button" disabled={!dirty || saving} onclick={save}>
					{saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
				</button>
			</div>
		</div>
	</header>

	<div class="body" class:has-panel={!!focus}>
		<div class="grid-area">
			<div class="grid-scroll" bind:this={gridScroll}>
				<section class="highlight" class:editing={highlightEditing}>
					<div class="hl-head">
						<div class="hl-title">
							<h2>Highlight (win frame)</h2>
							<p class="hl-sub">
								A single global spine that loops over winning symbols. Shared by every symbol.
							</p>
						</div>
						<div class="hl-actions">
							{#if highlight.overridden}<span class="badge">overridden</span>{/if}
							{#if highlightEditing}
								<button type="button" class="ghost" onclick={closeHighlight}>Cancel</button>
							{:else}
								<button type="button" class="hl-change" onclick={openHighlight}>Change</button>
								{#if highlight.overridden}
									<button type="button" class="ghost" onclick={resetHighlight}>
										Reset to default
									</button>
								{/if}
							{/if}
						</div>
					</div>

					<div class="hl-body">
						<div class="hl-current">
							{#if highlight.overridden && highlight.cell}
								<div class="hl-preview">
									<SymbolSpinePreview
										assetKey={highlight.cell.assetKey}
										animationName={highlight.cell.animationName}
										size={96}
										{reloadToken}
									/>
								</div>
								<div class="hl-meta">
									<span class="hl-label">Override</span>
									<span class="hl-chip">{displayKey(highlight.cell)}</span>
									{#if highlight.cell.animationName}
										<span class="hl-anim">{highlight.cell.animationName}</span>
									{/if}
								</div>
							{:else if defaultFrameBundle}
								<div class="hl-preview">
									<SymbolSpinePreview
										assetKey={defaultFrameBundle.key}
										animationName={BUILTIN_FRAME.animationName}
										size={96}
										{reloadToken}
									/>
								</div>
								<div class="hl-meta">
									<span class="hl-label">Default (payframe)</span>
									<span class="hl-chip">{defaultFrameBundle.name}</span>
									<span class="hl-anim">{BUILTIN_FRAME.animationName}</span>
								</div>
							{:else}
								<div class="hl-preview default">
									<span class="hl-default-mark">payframe</span>
								</div>
								<div class="hl-meta">
									<span class="hl-label">Default (payframe)</span>
									<span class="hl-note">
										Built-in local spine — not in R2, so it can't be previewed here. Pick an R2
										spine to override it.
									</span>
								</div>
							{/if}
						</div>

						{#if highlightEditing && highlightDraft}
							<div class="hl-editor">
								<div class="field">
									<span class="label">Spine bundle</span>
									<select
										value={highlightDraft.assetKey}
										onchange={(e) => {
											if (!highlightDraft) return;
											highlightDraft.assetKey = e.currentTarget.value;
											highlightDraft.animationName = '';
											highlightAnimations = [];
										}}
									>
										<option value="">Pick a bundle…</option>
										{#each spineBundles as b (b.key)}
											<option value={b.key}>{b.name}</option>
										{/each}
									</select>
								</div>
								{#if highlightDraft.assetKey}
									<div class="field">
										<span class="label">Animation</span>
										{#if highlightAnimations.length}
											<select
												value={highlightDraft.animationName ?? ''}
												onchange={(e) => {
													if (highlightDraft) highlightDraft.animationName = e.currentTarget.value;
												}}
											>
												<option value="">(first animation)</option>
												{#each highlightAnimations as anim (anim)}
													<option value={anim}>{anim}</option>
												{/each}
											</select>
										{:else}
											<input
												type="text"
												placeholder="animation name"
												value={highlightDraft.animationName ?? ''}
												oninput={(e) => {
													if (highlightDraft) highlightDraft.animationName = e.currentTarget.value;
												}}
											/>
										{/if}
									</div>
									<div class="field">
										<span class="label">Preview</span>
										<div class="hl-preview">
											<SymbolSpinePreview
												assetKey={highlightDraft.assetKey}
												animationName={highlightDraft.animationName}
												size={96}
												{reloadToken}
												onAnimations={(names) => (highlightAnimations = names)}
											/>
										</div>
									</div>
								{/if}
								<button
									type="button"
									class="apply"
									disabled={!highlightDraft.assetKey}
									onclick={applyHighlight}
								>
									Apply highlight
								</button>
							</div>
						{/if}
					</div>
				</section>

				<section class="winline" class:expanded={winLineOn}>
					<div class="wl-head">
						<div class="wl-text">
							<h2>Win lines</h2>
							<p class="wl-sub">
								The line traced across each winning payline, with the win amount stamped under its
								end. On by default; turn it off to hide the overlay, or style the line and the
								amount text below.
							</p>
						</div>
						<label class="switch" class:on={winLineOn}>
							<input
								type="checkbox"
								checked={winLineOn}
								onchange={(e) => toggleWinLine(e.currentTarget.checked)}
							/>
							<span class="track"><span class="knob"></span></span>
							<span class="switch-label">{winLineOn ? 'On' : 'Off'}</span>
						</label>
					</div>

					{#if winLineOn}
						<div class="wl-config">
							<div class="wl-group">
								<h3>Line</h3>
								<div class="wl-fields">
									<label class="field">
										<span class="label">Colour</span>
										<input
											type="color"
											value={wlLine.color ?? WL_DEFAULTS.color}
											oninput={(e) => patchWinLineLine({ color: e.currentTarget.value })}
										/>
									</label>
									<label class="field">
										<span class="label">Thickness {(wlLine.width ?? WL_DEFAULTS.width).toFixed(3)}</span>
										<input
											type="range"
											min="0.005"
											max="0.12"
											step="0.005"
											value={wlLine.width ?? WL_DEFAULTS.width}
											oninput={(e) => patchWinLineLine({ width: Number(e.currentTarget.value) })}
										/>
									</label>
									<div class="field">
										<span class="label">Glow</span>
										<label class="switch sm" class:on={wlLine.glow ?? WL_DEFAULTS.glow}>
											<input
												type="checkbox"
												checked={wlLine.glow ?? WL_DEFAULTS.glow}
												onchange={(e) => patchWinLineLine({ glow: e.currentTarget.checked })}
											/>
											<span class="track"><span class="knob"></span></span>
											<span class="switch-label">{(wlLine.glow ?? WL_DEFAULTS.glow) ? 'On' : 'Off'}</span>
										</label>
									</div>
									<label class="field" class:disabled={!(wlLine.glow ?? WL_DEFAULTS.glow)}>
										<span class="label">Glow colour</span>
										<input
											type="color"
											disabled={!(wlLine.glow ?? WL_DEFAULTS.glow)}
											value={wlLine.glowColor ?? wlLine.color ?? WL_DEFAULTS.glowColor}
											oninput={(e) => patchWinLineLine({ glowColor: e.currentTarget.value })}
										/>
									</label>
									<div class="field">
										<span class="label">Animated draw</span>
										<label class="switch sm" class:on={wlLine.animated ?? WL_DEFAULTS.animated}>
											<input
												type="checkbox"
												checked={wlLine.animated ?? WL_DEFAULTS.animated}
												onchange={(e) => patchWinLineLine({ animated: e.currentTarget.checked })}
											/>
											<span class="track"><span class="knob"></span></span>
											<span class="switch-label"
												>{(wlLine.animated ?? WL_DEFAULTS.animated) ? 'On' : 'Off'}</span
											>
										</label>
									</div>
									<label class="field" class:disabled={!(wlLine.animated ?? WL_DEFAULTS.animated)}>
										<span class="label">Speed ×{(wlLine.speed ?? WL_DEFAULTS.speed).toFixed(2)}</span>
										<input
											type="range"
											min="0.25"
											max="4"
											step="0.25"
											disabled={!(wlLine.animated ?? WL_DEFAULTS.animated)}
											value={wlLine.speed ?? WL_DEFAULTS.speed}
											oninput={(e) => patchWinLineLine({ speed: Number(e.currentTarget.value) })}
										/>
									</label>
								</div>
							</div>

							<div class="wl-group">
								<h3>Win amount text</h3>
								<div class="wl-fields">
									<label class="field">
										<span class="label">Font</span>
										<select
											value={wlText.font ?? WL_DEFAULTS.font}
											onchange={(e) => patchWinLineText({ font: e.currentTarget.value })}
										>
											{#each fontOptions as name (name)}
												<option value={name}>{name}</option>
											{/each}
										</select>
									</label>
									<label class="field">
										<span class="label">Size {(wlText.size ?? WL_DEFAULTS.size).toFixed(2)}</span>
										<input
											type="range"
											min="0.2"
											max="1.5"
											step="0.05"
											value={wlText.size ?? WL_DEFAULTS.size}
											oninput={(e) => patchWinLineText({ size: Number(e.currentTarget.value) })}
										/>
									</label>
									<label class="field">
										<span class="label">Colour (tint)</span>
										<input
											type="color"
											value={wlText.color ?? WL_DEFAULTS.textColor}
											oninput={(e) => patchWinLineText({ color: e.currentTarget.value })}
										/>
									</label>
								</div>
								<p class="wl-note">
									The amount uses a bitmap font, so the colour tints it — clean on a light font,
									but tinting an already-coloured font (e.g. gold) just darkens it. To recolour
									cleanly, pick a differently-coloured font.
								</p>
							</div>

							<button type="button" class="ghost wl-reset" onclick={resetWinLineStyle}>
								Reset win-line style
							</button>
						</div>
					{/if}
				</section>

				{#if symbolNames.length === 0}
					<p class="muted">No symbols defined for this game type.</p>
				{:else}
					<table class="grid" style="--cell: {previewSize}px">
						<thead>
							<tr>
								<th class="corner">Symbol</th>
								{#each visibleStates as state (state)}
									<th>{STATE_LABELS[state]}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each symbolNames as symbol (symbol)}
								<tr>
									<th class="rowhead">{symbol}</th>
									{#each visibleStates as state (state)}
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
													{:else}
														<div
															class="spine-target"
															data-spine-key={eff.cell.previewKey ?? eff.cell.assetKey}
															data-spine-anim={eff.cell.animationName ?? ''}
														>
															<span class="chip spine" title={cellLabel(eff.cell)}>
																<span class="chip-key">{displayKey(eff.cell)}</span>
																{#if eff.cell.animationName}
																	<span class="chip-anim">{eff.cell.animationName}</span>
																{/if}
															</span>
														</div>
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
			<SymbolSpineStage container={gridScroll} {reloadToken} />
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
									{reloadToken}
									onAnimations={(names) => (draftAnimations = names)}
								/>
							</div>
						</div>
					{/if}
				{/if}

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
	.reload {
		padding: 6px 14px;
		border-radius: 6px;
		border: 1px solid #2a2a33;
		background: #16161c;
		color: #b9b9c4;
		font-weight: 600;
		cursor: pointer;
	}
	.reload:hover:not(:disabled) {
		border-color: #3a3a48;
		color: #d8d8e0;
	}
	.reload:disabled {
		opacity: 0.55;
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
	.grid-area {
		position: relative;
		min-width: 0;
		min-height: 0;
		overflow: hidden;
	}
	.grid-scroll {
		position: absolute;
		inset: 0;
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
	/* Spine cells render a chip placeholder here; the shared <SymbolSpineStage> canvas
	   draws the live animation ON TOP, tracking this box's screen rect as the grid scrolls. */
	.spine-target {
		position: relative;
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

	.highlight {
		margin-bottom: 16px;
		padding: 14px 16px;
		background: #101018;
		border: 1px solid #24242e;
		border-radius: 10px;
	}
	.highlight.editing {
		border-color: #4d6bd8;
	}
	.hl-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 16px;
	}
	.hl-title h2 {
		margin: 0;
		font-size: 15px;
		color: #e0e0e8;
	}
	.hl-sub {
		margin: 2px 0 0;
		font-size: 12px;
		color: #8a8a96;
	}
	.hl-actions {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: none;
	}
	.hl-change {
		padding: 6px 14px;
		border-radius: 6px;
		border: 1px solid #2e3e6a;
		background: #1b2236;
		color: #cfe0ff;
		font-weight: 600;
		cursor: pointer;
	}
	.hl-body {
		display: flex;
		gap: 24px;
		margin-top: 14px;
		flex-wrap: wrap;
	}
	.hl-current {
		display: flex;
		align-items: center;
		gap: 14px;
	}
	.hl-preview {
		width: 96px;
		height: 96px;
		display: grid;
		place-items: center;
		border-radius: 6px;
		background: #0b0b10;
		border: 1px solid #1d1d26;
		flex: none;
	}
	.hl-preview.default {
		border-style: dashed;
		border-color: #33333f;
	}
	.hl-default-mark {
		font-size: 13px;
		color: #8a8a96;
		font-style: italic;
	}
	.hl-meta {
		display: flex;
		flex-direction: column;
		gap: 4px;
		max-width: 260px;
	}
	.hl-label {
		font-size: 11px;
		color: #8a8a96;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
	.hl-chip {
		font-weight: 600;
		color: #b9b9e0;
	}
	.hl-anim {
		font-size: 12px;
		color: #9a9aa6;
	}
	.hl-note {
		font-size: 11px;
		color: #777;
		line-height: 1.4;
	}
	.hl-editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
		min-width: 220px;
		max-width: 280px;
	}
	.hl-editor .apply {
		margin-top: 2px;
	}
	.highlight .badge {
		font-size: 9px;
		color: #9fb4ff;
		background: #1c2240;
		border-radius: 3px;
		padding: 2px 6px;
		align-self: center;
	}

	.winline {
		display: flex;
		flex-direction: column;
		gap: 16px;
		margin-bottom: 16px;
		padding: 14px 16px;
		background: #101018;
		border: 1px solid #24242e;
		border-radius: 10px;
	}
	.winline.expanded {
		border-color: #4d6bd8;
	}
	.wl-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 24px;
	}
	.wl-config {
		display: flex;
		flex-direction: column;
		gap: 16px;
		border-top: 1px solid #24242e;
		padding-top: 16px;
	}
	.wl-group h3 {
		margin: 0 0 10px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9a9aa6;
	}
	.wl-fields {
		display: flex;
		flex-wrap: wrap;
		gap: 14px 20px;
		align-items: flex-end;
	}
	.wl-fields .field {
		min-width: 132px;
		max-width: 200px;
	}
	.wl-fields .field.disabled {
		opacity: 0.4;
	}
	.wl-fields input[type='color'] {
		width: 100%;
		height: 30px;
		padding: 2px;
		background: #16161c;
		border: 1px solid #2a2a33;
		border-radius: 5px;
		cursor: pointer;
	}
	.wl-fields input[type='range'] {
		width: 100%;
		accent-color: #5b8cff;
	}
	.switch.sm .track {
		width: 38px;
		height: 20px;
		border-radius: 10px;
	}
	.switch.sm .knob {
		width: 14px;
		height: 14px;
	}
	.switch.sm.on .knob {
		transform: translateX(18px);
	}
	.wl-note {
		margin: 8px 0 0;
		font-size: 11px;
		color: #777;
		line-height: 1.4;
		max-width: 640px;
	}
	.wl-reset {
		align-self: flex-start;
	}
	.wl-text h2 {
		margin: 0;
		font-size: 15px;
		color: #e0e0e8;
	}
	.wl-sub {
		margin: 2px 0 0;
		font-size: 12px;
		color: #8a8a96;
		max-width: 640px;
	}
	.switch {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
		cursor: pointer;
		user-select: none;
	}
	.switch input {
		position: absolute;
		opacity: 0;
		width: 0;
		height: 0;
	}
	.track {
		position: relative;
		width: 44px;
		height: 24px;
		border-radius: 12px;
		background: #24242e;
		border: 1px solid #33333f;
		transition:
			background 0.15s ease,
			border-color 0.15s ease;
	}
	.switch.on .track {
		background: #163a2c;
		border-color: #2c6a52;
	}
	.knob {
		position: absolute;
		top: 2px;
		left: 2px;
		width: 18px;
		height: 18px;
		border-radius: 50%;
		background: #b9b9c4;
		transition:
			transform 0.15s ease,
			background 0.15s ease;
	}
	.switch.on .knob {
		transform: translateX(20px);
		background: #8fe6c0;
	}
	.switch-label {
		font-size: 12px;
		font-weight: 600;
		color: #9a9aa6;
		min-width: 24px;
	}
	.switch.on .switch-label {
		color: #8fe6c0;
	}
</style>
