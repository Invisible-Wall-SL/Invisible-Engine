<script lang="ts">
	import { onMount } from 'svelte';
	import ColorField from '$lib/ColorField.svelte';
	import {
		BUILTIN_SHEETS,
		builtinSheetKey,
		builtinSpineMeta,
		parseScopedFrameRef,
		scopedFrameRef,
	} from 'engine-layout';
	import { SOUND_EFFECT_NAMES } from 'engine-flow-v2';
	import { invalidateAll } from '$app/navigation';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { SaveState } from '$lib/saveState.svelte';
	import { LeaseState } from '$lib/leaseState.svelte';
	import PresenceBanner from '$lib/PresenceBanner.svelte';
	import { pickSheetsFrom } from '$lib/pickSheets';
	import RegionPicker from '../editor/RegionPicker.svelte';
	import {
		clearRegionCache,
		fetchRegions,
		frameStem,
		type EditorRegion,
		type RegionSet,
	} from '../editor/editorRegions.client';
	import { builtinSpineKey, hasBuiltinSpine } from '../editor/editorSpine.client';
	import SymbolFxPreview from './SymbolFxPreview.svelte';
	import SymbolSpinePreview from './SymbolSpinePreview.svelte';
	import SymbolSpineStage from './SymbolSpineStage.svelte';
	import SymbolSpritePreview from './SymbolSpritePreview.svelte';
	import {
		STATE_HINTS,
		STATE_LABELS,
		visibleStatesFor,
		anticipationFieldValue,
		clearAnticipation,
		clearBoardGlow,
		clearBookVfxLayer,
		clearHighlight,
		clearOverride,
		clearWinLineStyle,
		docSignature,
		effectiveCell,
		effectiveHighlight,
		saveSymbolsDoc,
		SymbolsConflictError,
		setAnticipationActivationSound,
		setAnticipationAnimationSet,
		setAnticipationOverlayCells,
		setAnticipationLoopSound,
		setAnticipationSpineKey,
		setAnticipationTierFx,
		setBoardGlow,
		setBookVfxLayer,
		setHighlight,
		setOverride,
		setSymbolName,
		setWinCycleDelay,
		setWinCycleDimNonWinning,
		setWinCycleEnabled,
		setWinCycleHoldAfterBigWin,
		setWinCycleShowLine,
		setWinCycleShowMessage,
		setWinCycleShowText,
		setWinLineEnabled,
		setWinLineLine,
		setWinLineText,
		setStackedPicturesEnabled,
		setStackedFullHeightOnly,
		setStackedEdgeCutoffs,
		stackedPicturesEnabled,
		stackedSymbols,
		addStackedSymbol,
		removeStackedSymbol,
		setStackedSymbolHeight,
		setStackedSymbolArt,
		winCycleDimNonWinning,
		winCycleEnabled,
		winCycleHoldAfterBigWin,
		winCycleShowLine,
		winCycleShowMessage,
		winCycleShowText,
		winLineEnabled,
		WIN_CYCLE_DELAY_DEFAULT,
		SYMBOL_CELL_TYPES,
		SYMBOL_CELL_TYPE_LABELS,
		BOOK_VFX_KINDS,
		BOOK_VFX_KIND_LABELS,
		type AnticipationTier,
		type AnticipationTierFx,
		type BoardGlowConfig,
		type HighlightCell,
		type HighlightTintMode,
		type BookVfxKind,
		type BookVfxLayer,
		type BookVfxSlot,
		type SymbolCell,
		type SymbolCellType,
		type SymbolState,
		type SymbolsDoc,
	} from './symbols.client';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Symbol rows come from the coded defaults (the source of truth for the set).
	const symbolNames = $derived(Object.keys(data.defaults.symbols));
	/**
	 * Symbols this project never deals — in the grid only because the template it was seeded from
	 * baked them in, and the server union never removes a baked symbol (so a symbol mid-authoring
	 * cannot vanish). Authoring one is harmless and completely wasted, which is worth saying on
	 * screen rather than leaving the page to contradict /config in silence.
	 *
	 * Empty when the project has no Game Config to compare against — unknown, so nothing is badged.
	 */
	const inPlaySet = $derived(data.inPlaySymbols ? new Set(data.inPlaySymbols) : null);
	const isUnused = (name: string) => !!inPlaySet && !inPlaySet.has(name);
	const unusedCount = $derived(symbolNames.filter(isUnused).length);

	// Whether stacked-picture authoring is on for this project — a per-project master toggle (default
	// OFF) that both shows the "Stacked pictures" config block below and gates whether the stacked config
	// bakes. The tall art + height + which-symbols are authored in that block, NOT as a grid column.
	const stackedOn = $derived(stackedPicturesEnabled(doc));
	// The global "tall picture only at full height" flag (default off ⇒ partial runs crop the picture).
	const stackedFullHeightOnly = $derived(doc.stackedPictures?.fullHeightOnly ?? false);
	// The global "edge cut-offs" flag (independent of full-height only): a partial stack at the board's
	// top/bottom edge renders a cut-off tall picture. Default off.
	const stackedEdgeCutoffs = $derived(doc.stackedPictures?.edgeCutoffs ?? false);
	// The authored stacked symbols + a fast membership set for the multi-select.
	const stackedList = $derived(stackedSymbols(doc));
	const stackedSet = $derived(new Set(stackedList.map((s) => s.name)));

	// The state columns the grid renders: the base 6, plus the two book-only states
	// (`bookIntro`/`bookIdle`) ONLY for a book game, plus `tumbleExplosion` ONLY for a project that
	// cascades. The `stacked` state is never a grid column — its tall art lives in the "Stacked
	// pictures" section. Both gates come from the server: `gameType` for the book states, the
	// `resolveCascade`d answer for the tumble one (so /config's cascade switch drives it, not the
	// game kind).
	const visibleStates = $derived(visibleStatesFor(data.gameType, data.cascade));

	// Symbols whose EFFECTIVE binding is a SPINE with no animation. A spine plays an animation, so with
	// none selected it draws only its (usually empty) setup pose ⇒ a BLANK cell in-game. Flag it here so
	// an authored-but-invisible symbol is caught in the tool, not discovered live (the R_spinbutton/W
	// case). Grouped by symbol, each with the affected state labels.
	const spineNoAnimWarnings = $derived.by(() => {
		const out: { symbol: string; states: string[] }[] = [];
		for (const symbol of symbolNames) {
			const states: string[] = [];
			for (const state of visibleStates) {
				const { cell } = effectiveCell(doc, data.defaults, symbol, state);
				if (cell?.type === 'spine' && cell.assetKey && !cell.animationName) {
					states.push(STATE_LABELS[state] ?? state);
				}
			}
			if (states.length) out.push({ symbol, states });
		}
		return out;
	});

	// Responsive cell sizing — the grid fills the page WIDTH so it no longer sits tiny
	// in the top-left, and each preview scales with the 6 state columns. Width-driven
	// (with vertical scroll for the symbol rows, like the in-game debug grid) so cells
	// stay large and legible; clamped so they're crisp on small screens and don't blow
	// up on ultra-wide ones. A ResizeObserver on the scroll area tracks window resize +
	// the side panel opening/closing live.
	// Wide enough for the row head's display-name boxes, not just the id — the grid's cell sizing
	// divides what's left, so this must match the `th.rowhead` width in the stylesheet.
	const LABEL_COL = 148;
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
		void lease.start();
		const onUnload = () => lease.release();
		window.addEventListener('pagehide', onUnload);
		const ro = gridScroll
			? new ResizeObserver((entries) => {
					const rect = entries[0]?.contentRect;
					if (rect) viewW = rect.width;
				})
			: null;
		if (ro && gridScroll) ro.observe(gridScroll);
		return () => {
			window.removeEventListener('pagehide', onUnload);
			ro?.disconnect();
			lease.release();
		};
	});

	/** Atlases + sheets a sprite frame can be picked from (mirrors the editor). */
	const pickSheets = $derived(pickSheetsFrom(data.assets));

	/** The engine's BUILT-IN sheets, which carry the coded-default symbol art (`w.png`,
	 * `s.png`, `explodedW.png`, the h1-h5 / l1-l4 frames) — engine art every game bundles +
	 * registers (so it renders in-game) but that lives in NO project atlas. Vendored under the
	 * launcher's `/builtin/sheets/`; folded into the preview index only (not the author's source
	 * picker) so a coded-default sprite cell resolves. Mirrors the editor canvas' fallback. */
	const builtinSheets = Object.keys(BUILTIN_SHEETS).map((id) => ({
		key: builtinSheetKey(id),
		name: id,
	}));

	/** Spine bundles available for spine cells (project + shared). */
	const spineBundles = $derived(data.assets.spines.map((s) => ({ name: s.name, key: s.key })));

	/** Invisible Flipbook clips available for flipbook cells. Empty for a project that has
	 *  never authored one — the Flipbook option then shows disabled with a pointer at /flipbook
	 *  rather than an empty select the author can't act on. */
	const clips = $derived(data.clips);
	const clipsById = $derived(new Map(clips.map((c) => [c.id, c])));

	/**
	 * The frame a flipbook cell previews — its clip's FIRST frame, returned as an
	 * `<assetKey>::<region>` SCOPED ref so it hits the clip's own sheet (mirroring the runtime's
	 * scoped-then-bare precedence). A frame may itself be scoped (a clip can span several sheets);
	 * its embedded sheet wins, falling back to the clip's primary `assetKey`. `spriteIndex` carries
	 * both a scoped and a bare entry per region, so the returned ref resolves without collision.
	 */
	function clipFirstFrame(clipId: string | undefined): string {
		if (!clipId) return '';
		const clip = clipsById.get(clipId);
		if (!clip?.firstFrame) return '';
		const parsed = parseScopedFrameRef(clip.firstFrame);
		return scopedFrameRef(parsed.assetKey ?? clip.assetKey, parsed.region);
	}

	/** A clip's author-facing label with its frame count, for the picker + cell chips. */
	function clipLabel(clipId: string | undefined): string {
		if (!clipId) return 'no clip';
		const clip = clipsById.get(clipId);
		// A clip deleted in /flipbook after being bound here leaves a dangling id — say so
		// loudly instead of rendering a blank option the author reads as "fine".
		if (!clip) return `${clipId} (missing)`;
		return `${clip.name} · ${clip.frames} frame${clip.frames === 1 ? '' : 's'}`;
	}

	/**
	 * The bundle used to PREVIEW a coded default (the board glow, the win frame). Prefers a real R2
	 * bundle matching the key, so a project carrying its own copy previews THAT; otherwise falls back
	 * to the engine spine vendored into the launcher's `static/builtin/`. The coded defaults ship as
	 * local game assets and are not in R2, so before that fallback they could only ever render a
	 * "not in R2, can't be previewed" placeholder — the tool documented a default it couldn't show.
	 */
	function resolveBuiltinBundle(assetKey: string): { key: string; name: string } | undefined {
		const fromR2 = spineBundles.find(
			(b) => b.name === assetKey || b.key === assetKey || b.key.split('/').includes(assetKey),
		);
		if (fromR2) return fromR2;
		return hasBuiltinSpine(assetKey)
			? { key: builtinSpineKey(assetKey), name: assetKey }
			: undefined;
	}

	// Frame name → its region, built ONCE for the whole grid by fetching every sheet
	// in PARALLEL. Previously each sprite cell scanned the sheet list itself, and
	// because they all awaited the shared region cache in the same order the fetches
	// serialised (everyone blocked on sheet 1 before requesting sheet 2) — ~N heavy
	// `/api/editor/regions` calls back-to-back. Now it's one parallel burst; cells are
	// O(1) lookups. `null` while the first build is in flight → cells show a loading bar.
	let spriteIndex = $state<Map<string, { set: RegionSet; region: EditorRegion }> | null>(null);
	$effect(() => {
		// Project sheets FIRST, built-ins appended — the `!idx.has` first-wins guards then let a
		// project atlas packing the same name override the engine default, matching EditorCanvas.
		const list = [...pickSheets, ...builtinSheets];
		let cancelled = false;
		spriteIndex = null;
		void (async () => {
			const sets = await Promise.all(list.map((s) => fetchRegions(s.key)));
			if (cancelled) return;
			const idx = new Map<string, { set: RegionSet; region: EditorRegion }>();
			list.forEach((s, i) => {
				const set = sets[i];
				// Stems that are UNIQUE within THIS sheet. A stem shared by two regions
				// (e.g. `w.png` + `w.webp`) is ambiguous, so its key is skipped below rather
				// than risk previewing the wrong frame.
				const stemCount = new Map<string, number>();
				for (const region of set.regions) {
					const st = frameStem(region.name);
					stemCount.set(st, (stemCount.get(st) ?? 0) + 1);
				}
				for (const region of set.regions) {
					// Key by the resolved MANIFEST (`set.assetKey`, a `.json`), the picker's SOURCE key
					// (`s.key` — a `.json` manifest OR a Sheet-Maker prefix `.../sheets/S_Lotus/`, which
					// is exactly what a picked sprite cell stored), and the bare region. So a cell
					// resolves whether it stored a manifest-scoped, sheet-prefix-scoped, or bare ref —
					// no more blank preview for a sheet-prefix source.
					const byManifest = scopedFrameRef(set.assetKey, region.name);
					const bySource = scopedFrameRef(s.key, region.name);
					if (!idx.has(byManifest)) idx.set(byManifest, { set, region });
					if (!idx.has(bySource)) idx.set(bySource, { set, region });
					if (!idx.has(region.name)) idx.set(region.name, { set, region });
					// Extension/case-insensitive fallback so a coded default (`w.png`, `explodedW.png`,
					// `H1`) resolves against a region synced under a different extension or casing
					// (`w.webp`, `h1.png`). Only for stems unique in this sheet; first sheet wins across
					// sheets, mirroring the bare-name rule above.
					const st = frameStem(region.name);
					if (stemCount.get(st) === 1 && !idx.has(st)) idx.set(st, { set, region });
				}
			});
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

	let savedAt = $state<string | null>(data.doc.updatedAt ?? null);

	/**
	 * Save-state machine (multi-user-concurrency Phase 2a). Manual save; the transport calls
	 * `saveSymbolsDoc` (which owns the CAS + create encoding via the `null` etag) and adopts the
	 * server's normalized doc + new etag together, so the next save CASes against what was just
	 * written. A `SymbolsConflictError` maps to `reason:'conflict'`, surfaced by the wrapper's
	 * `confirm()`; `force` overwrites.
	 */
	/**
	 * Soft edit lease (multi-user-concurrency Phase 2c) over this project's symbols doc
	 * (`docKey:'symbols'`). When another author holds it, `lease.readOnly` gates the doc
	 * `saveState` (its `blockWhen`) so a not-held tab can't save, the Save button hides behind
	 * `<PresenceBanner>`, and Take over is always reachable. The `If-Match` CAS stays the floor.
	 */
	const lease = new LeaseState({
		toolId: 'symbols',
		clientKey: data.clientKey,
		projectKey: data.projectKey,
		docKey: 'symbols',
		enabled: data.projectKey.length > 0,
	});

	const saveState = new SaveState({
		initialEtag: data.docEtag,
		blockWhen: () => lease.readOnly,
		save: async ({ baseEtag, force }) => {
			try {
				const out = await saveSymbolsDoc(data.projectKey, doc, baseEtag, force);
				doc = structuredClone(out.doc);
				savedSig.value = docSignature(doc);
				savedAt = out.doc.updatedAt ?? new Date().toISOString();
				return { ok: true, etag: out.etag };
			} catch (e) {
				if (e instanceof SymbolsConflictError) {
					return { ok: false, reason: 'conflict', message: e.message };
				}
				return { ok: false, reason: 'error', message: e instanceof Error ? e.message : String(e) };
			}
		},
	});

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
		// Drop the module-level region cache (keyed by sheet key, survives `invalidateAll`)
		// so the sprite-cell rects + page keys re-resolve from R2 — otherwise a re-authored
		// sheet stays stale on the sprite path until a hard page reload. The spine path is
		// busted by `reloadToken`; the server self-heals the frozen bundle geometry.
		clearRegionCache();
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
		stackedEdit = null; // the grid cell and the stacked art share the panel — one at a time
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

	function setDraftType(type: SymbolCellType): void {
		if (!draft || draft.type === type) return;
		// Switching kind clears the asset binding (a frame name ≠ a spine bundle ≠ a clip's
		// sheet) AND every field that no longer applies. That last part is load-bearing: the
		// server schema is `.strict()` with a `.refine()` rejecting a flipbook cell without a
		// `clipId`, so a leftover `animationName` (or a stale `clipId` on a sprite cell) would
		// 400 a save the author has every reason to think is valid.
		draft = {
			type,
			assetKey: '',
			animationName: type === 'spine' ? '' : undefined,
			clipId: undefined,
			sizeRatios: draft.sizeRatios,
		};
		draftAnimations = [];
	}

	/** Bind the draft to a clip: the clip supplies BOTH the `clipId` and the `assetKey` (its
	 *  primary sheet), so a flipbook cell is never assetless and every consumer reading
	 *  `assetKey` keeps working. */
	function setDraftClip(clipId: string): void {
		if (!draft) return;
		const clip = clipsById.get(clipId);
		draft.clipId = clipId || undefined;
		draft.assetKey = clip?.assetKey ?? '';
	}

	/** A draft is bindable once it has an asset — and, for a flipbook, a clip (the server
	 *  `.refine()` rejects a clip-less flipbook cell, so the button gates on it too). */
	const draftBindable = $derived(
		!!draft?.assetKey && (draft.type !== 'flipbook' || !!draft.clipId),
	);

	function applyDraft(): void {
		if (!focus || !draft || !draftBindable) return;
		// Rebuilt field-by-field rather than spread: the schema is `.strict()`, so this is the
		// whitelist that keeps tool-only state (`previewKey`) and stale kind-specific fields out
		// of the saved doc.
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
		if (draft.type === 'flipbook' && draft.clipId) cell.clipId = draft.clipId;
		doc = setOverride(doc, focus.symbol, focus.state, cell);
		closeCell();
	}

	function resetCell(symbol: string, state: SymbolState): void {
		doc = clearOverride(doc, symbol, state);
		if (focus && focus.symbol === symbol && focus.state === state) closeCell();
	}

	/**
	 * Persist the overrides. `force` is the author answering the conflict prompt with
	 * "overwrite theirs" — the only way past the guard, and always a deliberate choice.
	 */
	async function save(force = false): Promise<void> {
		if ((!dirty && !force) || saveState.busy) return;
		await saveState.save({ force });
		// Never discard the local doc — ask. Declining leaves the edits on screen and `dirty`
		// true, so nothing is lost by saying no; the sticky conflict re-prompts on the next Save.
		if (!force && saveState.status === 'conflict') {
			if (confirm(`${saveState.message}\n\nOverwrite their version with yours?`)) await save(true);
		}
	}

	/** Last path segment of a full spine-bundle R2 prefix, for a readable chip. The
	 *  STORED `assetKey` stays the full prefix (resolution needs it); this is display
	 *  only. Sprite frame keys have no trailing slash, so they pass through unchanged. */
	function displayKey(cell: SymbolCell): string {
		const trimmed = cell.assetKey.replace(/\/$/, '');
		return cell.type === 'spine' ? (trimmed.split('/').pop() ?? trimmed) : trimmed;
	}

	/** Short binding label for a cell chip (`type · assetKey · anim|clip`). */
	function cellLabel(cell: SymbolCell | undefined): string {
		if (!cell) return 'unset';
		const parts = [cell.type, cell.assetKey];
		if (cell.animationName) parts.push(cell.animationName);
		if (cell.type === 'flipbook') parts.push(clipLabel(cell.clipId));
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
		highlight.overridden ? undefined : resolveBuiltinBundle(BUILTIN_FRAME.assetKey),
	);
	let highlightEditing = $state(false);
	let highlightDraft = $state<HighlightCell | null>(null);
	let highlightAnimations = $state<string[]>([]);

	/** The highlight tint MODE the draft's radio group binds to. `'none'` is the UI-only absence of a
	 *  tint — it maps to `tintMode: undefined` on the saved cell (kept sparse). */
	type HighlightTintChoice = 'none' | HighlightTintMode;
	const HIGHLIGHT_TINT_CHOICES: { value: HighlightTintChoice; label: string }[] = [
		{ value: 'none', label: 'No tint' },
		{ value: 'fixed', label: 'Fixed colour' },
		{ value: 'winLine', label: 'Win-line colour' },
	];
	/** The default swatch shown when the author first switches to Fixed with no colour yet. */
	const HIGHLIGHT_TINT_DEFAULT_COLOR = '#ffffff';

	function openHighlight(): void {
		// Seed the draft from an existing override, else a blank spine cell (we never
		// seed from the local default — it isn't an R2 bundle the picker can resolve).
		// `$state.snapshot` (NOT `structuredClone`): `doc.highlight` is a `$state` proxy and
		// `structuredClone` throws `DataCloneError` on a proxy (same bug as `openCell`).
		highlightDraft = doc.highlight
			? ($state.snapshot(doc.highlight) as HighlightCell)
			: { type: 'spine', assetKey: '', animationName: '', sizeRatios: { width: 1, height: 1 } };
		highlightAnimations = [];
		highlightEditing = true;
	}

	/** Switch the draft's tint mode. Fixed seeds a colour so the picker never opens on an empty
	 *  value; None/Win-line drop the fixed colour so a reset stays sparse. */
	function setHighlightTintChoice(choice: HighlightTintChoice): void {
		if (!highlightDraft) return;
		if (choice === 'none') {
			highlightDraft.tintMode = undefined;
			highlightDraft.tintColor = undefined;
		} else if (choice === 'fixed') {
			highlightDraft.tintMode = 'fixed';
			highlightDraft.tintColor = highlightDraft.tintColor || HIGHLIGHT_TINT_DEFAULT_COLOR;
		} else {
			highlightDraft.tintMode = 'winLine';
			highlightDraft.tintColor = undefined;
		}
	}

	function closeHighlight(): void {
		highlightEditing = false;
		highlightDraft = null;
		highlightAnimations = [];
	}

	function applyHighlight(): void {
		if (!highlightDraft || !highlightDraft.assetKey) return;
		const sr = highlightDraft.sizeRatios ?? { width: 1, height: 1 };
		const cell: HighlightCell = {
			type: 'spine',
			assetKey: highlightDraft.assetKey,
			sizeRatios: {
				width: Number(sr.width) || 0,
				height: Number(sr.height) || 0,
			},
		};
		if (highlightDraft.animationName) cell.animationName = highlightDraft.animationName;
		// Carry the tint choice, kept sparse: only a chosen mode persists, and `tintColor` only rides
		// the `fixed` mode (`winLine` reads its colour from the config at win time).
		if (highlightDraft.tintMode === 'fixed') {
			cell.tintMode = 'fixed';
			cell.tintColor = highlightDraft.tintColor || HIGHLIGHT_TINT_DEFAULT_COLOR;
		} else if (highlightDraft.tintMode === 'winLine') {
			cell.tintMode = 'winLine';
		}
		doc = setHighlight(doc, cell);
		closeHighlight();
	}

	function resetHighlight(): void {
		doc = clearHighlight(doc);
		closeHighlight();
	}

	// ── Free-spin board glow ──────────────────────────────────────────────────
	// The reel-house backdrop spine BEHIND the reels during free spins. The game's built-in
	// default is the coded `reelhouse` glow (BoardFrame.svelte), which plays a fixed
	// start→idle→exit chain. That key ships as a LOCAL game asset, so — exactly like the
	// highlight's payframe — we can only preview it when a matching R2 bundle happens to exist.
	// An override swaps the ART (any R2 spine bundle, Rigger `.irig` rigs included) and may
	// rename the three tracks; the ENGINE still owns the chaining.
	const BUILTIN_GLOW = {
		assetKey: 'reelhouse',
		animations: {
			start: 'reelhouse_glow_start',
			idle: 'reelhouse_glow_idle',
			exit: 'reelhouse_glow_exit',
		},
	};
	const GLOW_TRACKS = [
		{ track: 'start', label: 'Start animation' },
		{ track: 'idle', label: 'Idle (loop)' },
		{ track: 'exit', label: 'Exit animation' },
	] as const;
	const defaultGlowBundle = $derived(
		doc.boardGlow ? undefined : resolveBuiltinBundle(BUILTIN_GLOW.assetKey),
	);
	let glowEditing = $state(false);
	let glowDraft = $state<BoardGlowConfig | null>(null);
	let glowAnimations = $state<string[]>([]);

	function openGlow(): void {
		// `$state.snapshot` (NOT `structuredClone`) — `doc.boardGlow` is a `$state` proxy and
		// `structuredClone` throws `DataCloneError` on one (same trap as `openCell`/`openHighlight`).
		glowDraft = doc.boardGlow
			? ($state.snapshot(doc.boardGlow) as BoardGlowConfig)
			: { type: 'spine', assetKey: '', animations: {} };
		glowAnimations = [];
		glowEditing = true;
	}

	function closeGlow(): void {
		glowEditing = false;
		glowDraft = null;
		glowAnimations = [];
	}

	/** Keep the doc SPARSE: only write a track the author actually named, and drop `animations`
	 *  entirely when none are set, so an art-only swap ships `{ type, assetKey }` and every
	 *  animation still falls through to its coded `reelhouse_glow_*` name. */
	function applyGlow(): void {
		if (!glowDraft || !glowDraft.assetKey) return;
		const animations: NonNullable<BoardGlowConfig['animations']> = {};
		if (glowDraft.animations?.start) animations.start = glowDraft.animations.start;
		if (glowDraft.animations?.idle) animations.idle = glowDraft.animations.idle;
		if (glowDraft.animations?.exit) animations.exit = glowDraft.animations.exit;
		const glow: BoardGlowConfig = { type: 'spine', assetKey: glowDraft.assetKey };
		if (Object.keys(animations).length) glow.animations = animations;
		const sr = glowDraft.sizeRatios;
		if (sr && Number(sr.width) > 0 && Number(sr.height) > 0) {
			glow.sizeRatios = { width: Number(sr.width), height: Number(sr.height) };
		}
		doc = setBoardGlow(doc, glow);
		closeGlow();
	}

	function resetGlow(): void {
		doc = clearBoardGlow(doc);
		closeGlow();
	}

	/** Set one sparse animation track on the draft. */
	function setGlowTrack(track: 'start' | 'idle' | 'exit', value: string): void {
		if (!glowDraft) return;
		glowDraft.animations = { ...(glowDraft.animations ?? {}), [track]: value };
	}

	// ── Book-symbol VFX (background + foreground layers) ───────────────────────
	// Two authored presentation layers the game draws BEHIND / IN FRONT OF the book symbol during
	// free spins. Each layer is one of four kinds (sprite / spine / flipbook / fx) and REUSES the
	// pickers already on this page — RegionPicker (sprite), the spine-bundle select + animation
	// (spine), the clip select (flipbook), plus a plain effect select (fx). Sparse: an unset slot
	// writes nothing; each layer carries only its kind's fields (the server `.refine()` enforces it).
	const BOOK_VFX_SLOT_META: { slot: BookVfxSlot; label: string; sub: string }[] = [
		{ slot: 'background', label: 'Background', sub: 'Drawn BEHIND the book symbol.' },
		{ slot: 'foreground', label: 'Foreground', sub: 'Drawn IN FRONT of the book symbol.' },
	];

	/** The project's Invisible FX effects, for the fx-kind picker. */
	const effects = $derived(data.effects);

	/** A short chip label for an authored Book-VFX layer. */
	function bookVfxLabel(layer: BookVfxLayer): string {
		switch (layer.kind) {
			case 'spine':
				return `${displayKey({ type: 'spine', assetKey: layer.assetKey ?? '' })}${
					layer.animationName ? ` · ${layer.animationName}` : ''
				}`;
			case 'flipbook':
				return clipLabel(layer.clipId);
			case 'fx':
				return effects.find((e) => e.id === layer.effectId)?.name ?? layer.effectId ?? 'no effect';
			default:
				return layer.assetKey ?? 'unset';
		}
	}

	let bookVfxEditing = $state<BookVfxSlot | null>(null);
	let bookVfxDraft = $state<BookVfxLayer | null>(null);
	let bookVfxAnimations = $state<string[]>([]);

	function openBookVfx(slot: BookVfxSlot): void {
		// `$state.snapshot` (NOT `structuredClone`) — `doc.bookVfx` is a `$state` proxy (same trap as
		// `openCell`/`openHighlight`/`openGlow`).
		const existing = doc.bookVfx?.[slot];
		bookVfxDraft = existing ? ($state.snapshot(existing) as BookVfxLayer) : { kind: 'sprite' };
		bookVfxAnimations = [];
		bookVfxEditing = slot;
	}

	function closeBookVfx(): void {
		bookVfxEditing = null;
		bookVfxDraft = null;
		bookVfxAnimations = [];
	}

	/** Switch the draft's kind, dropping every field the new kind doesn't use (keeping the optional
	 *  size/offset hints) so a stale `animationName`/`clipId`/`effectId` can't 400 the save. */
	function setBookVfxKind(kind: BookVfxKind): void {
		if (!bookVfxDraft || bookVfxDraft.kind === kind) return;
		bookVfxDraft = { kind, sizeRatios: bookVfxDraft.sizeRatios, offset: bookVfxDraft.offset };
		bookVfxAnimations = [];
	}

	/** Bind the draft to a clip: the clip supplies both `clipId` and its primary sheet `assetKey`. */
	function setBookVfxClip(clipId: string): void {
		if (!bookVfxDraft) return;
		const clip = clipsById.get(clipId);
		bookVfxDraft.clipId = clipId || undefined;
		bookVfxDraft.assetKey = clip?.assetKey ?? undefined;
	}

	/** A draft is bindable once it has the field its kind requires (mirrors the server `.refine()`). */
	const bookVfxBindable = $derived.by(() => {
		const l = bookVfxDraft;
		if (!l) return false;
		switch (l.kind) {
			case 'sprite':
				return !!l.assetKey;
			case 'spine':
				return !!l.assetKey && !!l.animationName;
			case 'flipbook':
				return !!l.clipId;
			case 'fx':
				return !!l.effectId;
			default:
				return false;
		}
	});

	/** Rebuild the layer field-by-field (a whitelist, like `applyDraft`): only the kind's own fields
	 *  plus the optional size/offset hints reach the saved doc. */
	function applyBookVfx(): void {
		if (!bookVfxEditing || !bookVfxDraft || !bookVfxBindable) return;
		const l = bookVfxDraft;
		const layer: BookVfxLayer = { kind: l.kind };
		if (l.kind === 'sprite') {
			layer.assetKey = l.assetKey;
		} else if (l.kind === 'spine') {
			layer.assetKey = l.assetKey;
			layer.animationName = l.animationName;
		} else if (l.kind === 'flipbook') {
			layer.clipId = l.clipId;
			if (l.assetKey) layer.assetKey = l.assetKey;
		} else if (l.kind === 'fx') {
			layer.effectId = l.effectId;
		}
		const sr = l.sizeRatios;
		if (sr && Number(sr.width) > 0 && Number(sr.height) > 0) {
			layer.sizeRatios = { width: Number(sr.width), height: Number(sr.height) };
		}
		const off = l.offset;
		if (off && (Number(off.x) || Number(off.y))) {
			layer.offset = { x: Number(off.x) || 0, y: Number(off.y) || 0 };
		}
		doc = setBookVfxLayer(doc, bookVfxEditing, layer);
		closeBookVfx();
	}

	function resetBookVfx(slot: BookVfxSlot): void {
		doc = clearBookVfxLayer(doc, slot);
		if (bookVfxEditing === slot) closeBookVfx();
	}

	/** Set one axis of the draft's optional × cell size hint. Blank ⇒ clear (falls back to unset). */
	function setBookVfxSize(axis: 'width' | 'height', value: string): void {
		if (!bookVfxDraft) return;
		const cur = bookVfxDraft.sizeRatios ?? { width: 0, height: 0 };
		const next = { ...cur, [axis]: value === '' ? 0 : Number(value) };
		bookVfxDraft.sizeRatios = next.width || next.height ? next : undefined;
	}

	/** Set one axis of the draft's optional × cell offset hint. Blank/zero both ⇒ clear. */
	function setBookVfxOffset(axis: 'x' | 'y', value: string): void {
		if (!bookVfxDraft) return;
		const cur = bookVfxDraft.offset ?? { x: 0, y: 0 };
		const next = { ...cur, [axis]: value === '' ? 0 : Number(value) };
		bookVfxDraft.offset = next.x || next.y ? next : undefined;
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
		fullPayline: false,
		fullPaylineColor: '#4a90d9',
		useConfigColor: true,
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

	// ── Stacked pictures (master toggle + per-symbol tall art + height) ────────
	// The master toggle shows this block AND gates whether the stacked config bakes; the block is where
	// ALL stacked config lives now (which symbols, how tall, the tall picture). Sparse like the win-line
	// switch: ON persists `{ enabled: true }`, OFF drops the flag while PRESERVING authored symbols.
	function toggleStackedPictures(enabled: boolean): void {
		doc = setStackedPicturesEnabled(doc, enabled);
	}

	// Global "full-height only" flag: sparse — persist `true`, drop the key when off. Reassign `doc`
	// via the setter (like every sibling stacked control) so the change is tracked by `docSignature`
	// and survives `withStackedPictures`; an in-place mutation would leave Save disabled and get
	// stripped by the next stacked edit.
	function toggleStackedFullHeightOnly(value: boolean): void {
		doc = setStackedFullHeightOnly(doc, value);
	}

	// Global "edge cut-offs" flag: sparse, tracked via the setter like every sibling stacked control.
	// Independent of full-height only — a partial stack at the top/bottom edge renders a cut-off picture.
	function toggleStackedEdgeCutoffs(value: boolean): void {
		doc = setStackedEdgeCutoffs(doc, value);
	}

	/** Seed a new stacked symbol's tall art from the symbol's effective binding (its win/static art), so
	 *  the picker opens on the real symbol instead of a blank cell — and, crucially, so the entry is never
	 *  created assetless (the schema's `art.assetKey` is required; a blank one would 400 the save). */
	function seedStackedArt(symbol: string): SymbolCell {
		for (const state of ['win', 'static', 'land', 'spin'] as SymbolState[]) {
			const eff = effectiveCell(doc, data.defaults, symbol, state);
			if (eff.cell?.assetKey) {
				const c = $state.snapshot(eff.cell) as SymbolCell;
				const art: SymbolCell = { type: c.type, assetKey: c.assetKey };
				if (c.animationName) art.animationName = c.animationName;
				if (c.clipId) art.clipId = c.clipId;
				return art;
			}
		}
		return { type: 'sprite', assetKey: '' };
	}

	/** Toggle a symbol in/out of the stacked set (the multi-select). Adding seeds its tall art; removing
	 *  drops it and closes its art editor if open. */
	function toggleStackedSymbol(symbol: string): void {
		if (stackedSet.has(symbol)) {
			doc = removeStackedSymbol(doc, symbol);
			if (stackedEdit?.symbol === symbol) closeStackedArt();
		} else {
			doc = addStackedSymbol(doc, symbol, seedStackedArt(symbol));
		}
	}

	function setStackedHeight(symbol: string, value: string): void {
		doc = setStackedSymbolHeight(doc, symbol, Number(value) || 1);
	}

	// The tall-art editor reuses the SAME side panel + `draft` machinery as a grid cell (a stacked art is
	// just a `SymbolCell`), but Apply writes to the stacked symbol instead of a grid override.
	let stackedEdit = $state<{ symbol: string } | null>(null);

	function openStackedArt(symbol: string): void {
		closeCell(); // a grid cell and the stacked art share the panel — only one is open at a time
		const existing = doc.stackedPictures?.symbols?.find((s) => s.name === symbol)?.art;
		// `$state.snapshot` (NOT `structuredClone`): the doc is a `$state` proxy and clone throws on it
		// (same trap as `openCell`/`openHighlight`).
		draft = existing ? ($state.snapshot(existing) as SymbolCell) : seedStackedArt(symbol);
		draftAnimations = [];
		stackedEdit = { symbol };
	}

	function closeStackedArt(): void {
		stackedEdit = null;
		draft = null;
		draftAnimations = [];
	}

	function applyStackedArt(): void {
		if (!stackedEdit || !draft || !draftBindable) return;
		// Rebuilt field-by-field (a whitelist, like `applyDraft`): only the kind's own fields, and never
		// a per-cell `sizeRatios` — stacked art is sized by `height` (cells), not a ratio.
		const art: SymbolCell = { type: draft.type, assetKey: draft.assetKey };
		if (draft.type === 'spine' && draft.animationName) art.animationName = draft.animationName;
		if (draft.type === 'flipbook' && draft.clipId) art.clipId = draft.clipId;
		doc = setStackedSymbolArt(doc, stackedEdit.symbol, art);
		closeStackedArt();
	}

	// ── Winning-symbol replay (the game's win-symbol cycle) ───────────────────
	// Its OWN section, not part of the win-line block: the replay re-animates the winning
	// symbols only — it never redraws the line or its stamped amount — so it stays available
	// with win lines switched off.
	const wcOn = $derived(winCycleEnabled(doc));
	const wcDelay = $derived(doc.winCycle?.delay ?? WIN_CYCLE_DELAY_DEFAULT);
	const wcShowLine = $derived(winCycleShowLine(doc));
	const wcShowText = $derived(winCycleShowText(doc));
	const wcShowMessage = $derived(winCycleShowMessage(doc));
	const wcDim = $derived(winCycleDimNonWinning(doc));
	const wcHold = $derived(winCycleHoldAfterBigWin(doc));

	function resetWinLineStyle(): void {
		doc = clearWinLineStyle(doc);
	}

	// ── Reel anticipation (the escalating tease mode's presentation FX) ────────
	// A game-level panel (not per-symbol): ONE FX column per configured BIG-win tier (`/config`), keyed
	// by the tier's alias, the client-computed anticipation mode plays as the reachable win climbs. The
	// editable twin of the engine's coded `codedTierFx` ramp; every field falls through to the ramp
	// default for that tier's rank when unset, so the doc stays sparse and an un-authored project is
	// byte-identical. The mode itself is turned on/off from Flow — this only styles it. The columns
	// mirror the config big tiers, so they grow/shrink with `/config` (a note shows when there are none).
	const bigTiers = $derived(data.bigTiers);
	const anticipationOverridden = $derived(!!doc.anticipation);

	/** The overlay spine bundles the author can swap in — the same R2 spine list the highlight /
	 *  board-glow pickers use. Empty picks the coded `anticipation` spine. */
	const anticipationSpineBundles = $derived(spineBundles);

	/** The animation names of the RESOLVED overlay spine — the coded `anticipation` spine's built-in
	 *  meta (`builtinSpineMeta`, a pure static read, NO WebGL context: an always-mounted preview would
	 *  fight the page's other previews for the browser's ~16-context cap and lose). A swapped R2 `spineKey`
	 *  isn't in the builtin meta, so it resolves to `[]` ⇒ the field falls back to a free-text base input
	 *  (the swapped rig's animation names are author-known). */
	const anticipationSpineKey = $derived(doc.anticipation?.spineKey || 'anticipation');
	const anticipationAnimations = $derived(builtinSpineMeta(anticipationSpineKey)?.animations ?? []);
	/** The COMPLETE animation SETS the resolved spine exposes — a base whose `_intro`/`_loop`/`_out` all
	 *  exist (the engine chains all three). The unnumbered `anticipation` base is KEPT and listed
	 *  explicitly (it sorts first) — selecting it clears the override (= the coded default), so the author
	 *  can pick it by name instead of guessing it hides behind a "Default" label. Empty (spine not
	 *  enumerated) ⇒ the field falls back to a free-text base input. */
	const anticipationSets = $derived.by(() => {
		const names = new Set(anticipationAnimations);
		const bases = new Set<string>();
		for (const name of anticipationAnimations) {
			if (!name.endsWith('_intro')) continue;
			const base = name.slice(0, -'_intro'.length);
			if (names.has(`${base}_loop`) && names.has(`${base}_out`)) bases.add(base);
		}
		return [...bases].sort();
	});

	function patchAnticipationTier(tier: AnticipationTier, patch: Partial<AnticipationTierFx>): void {
		doc = setAnticipationTierFx(doc, tier, patch);
	}

	function setAnticipationSpine(key: string): void {
		doc = setAnticipationSpineKey(doc, key || undefined);
	}

	function setAnticipationAnimation(base: string): void {
		doc = setAnticipationAnimationSet(doc, base || undefined);
	}

	function setAnticipationOverlaySize(axis: 'width' | 'height', raw: string): void {
		const n = parseFloat(raw);
		doc = setAnticipationOverlayCells(doc, axis, Number.isFinite(n) && n > 0 ? n : undefined);
	}

	function setAnticipationActivation(name: string): void {
		doc = setAnticipationActivationSound(doc, name || undefined);
	}

	function setAnticipationLoop(name: string): void {
		doc = setAnticipationLoopSound(doc, name || undefined);
	}

	function resetAnticipation(): void {
		doc = clearAnticipation(doc);
	}

	/** Rename a symbol for the PLAYER (the id never changes — bindings, book events and every
	 *  other tool keep referring to `H1`). Feeds Invisible Win Text's `{symbolName}`. */
	function setName(symbol: string, form: 'singular' | 'plural', value: string): void {
		doc = setSymbolName(doc, symbol, form, value);
	}
</script>

<div class="shell">
	<ToolTopBar
		current="symbols"
		tools={data.tools}
		clientKey={data.clientKey}
		projectKey={data.projectKey}
	>
		{#snippet meta()}
			<div class="save-area">
				{#if lease.readOnly}
					<!-- Another author (or your own other tab) holds the edit lease → read-only here.
					     The doc saveState refuses to save (its blockWhen); Take over is always offered. -->
					<PresenceBanner {lease} />
				{:else}
					{#if saveState.status === 'error' || saveState.status === 'conflict'}<span
							class="save-err">{saveState.message}</span
						>{/if}
					{#if !dirty && savedAt}<span class="saved">Saved</span>{/if}
				{/if}
				<button
					class="reload"
					type="button"
					disabled={reloading}
					title="Re-fetch spine bundles + previews from R2 (after re-exporting art)"
					onclick={reloadFromR2}
				>
					{reloading ? 'Reloading…' : '↻ Reload from R2'}
				</button>
				<!-- `onclick={save}` passes the click EVENT as `force` (truthy): a manual Save has
				     always FORCE-overwritten here — preserved verbatim. Pre-existing latent bug (the
				     conflict `confirm()` is effectively dead on this path); flagged for the owner. -->
				<button
					class="save"
					type="button"
					disabled={lease.readOnly || !dirty || saveState.busy}
					onclick={save}
				>
					{saveState.busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}
				</button>
			</div>
		{/snippet}
	</ToolTopBar>

	<div class="body" class:has-panel={!!focus}>
		<div class="grid-area">
			<div class="grid-scroll" bind:this={gridScroll}>
				{#if spineNoAnimWarnings.length}
					<div class="anim-warn">
						<strong>⚠ Spine art with no animation</strong> — a spine plays an animation, so with
						none picked it renders a <strong>blank</strong> cell in-game. Pick an animation for
						these (or switch them to a sprite/flipbook):
						<ul>
							{#each spineNoAnimWarnings as w (w.symbol)}
								<li><code>{w.symbol}</code> — {w.states.join(', ')}</li>
							{/each}
						</ul>
					</div>
				{/if}
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
									{#if highlight.cell.tintMode === 'winLine'}
										<span class="hl-anim">tint: win-line colour</span>
									{:else if highlight.cell.tintMode === 'fixed'}
										<span class="hl-anim">
											tint:
											<span
												class="hl-swatch"
												style={`background:${highlight.cell.tintColor ?? '#ffffff'}`}
											></span>
											{highlight.cell.tintColor}
										</span>
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
										The coded default ships with the game and still renders in-game; the launcher
										just has no copy to preview. Pick an R2 spine to override it.
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
									<div class="field">
										<span class="label">Tint</span>
										<select
											value={highlightDraft.tintMode ?? 'none'}
											onchange={(e) =>
												setHighlightTintChoice(e.currentTarget.value as HighlightTintChoice)}
										>
											{#each HIGHLIGHT_TINT_CHOICES as choice (choice.value)}
												<option value={choice.value}>{choice.label}</option>
											{/each}
										</select>
										<span class="hl-note">
											Multiplies the win frame's colour over the winning symbols. "Win-line colour"
											uses each paying line's colour from the game config; "Fixed colour" uses the
											swatch below.
										</span>
									</div>
									{#if highlightDraft.tintMode === 'fixed'}
										<div class="field">
											<span class="label">Tint colour</span>
											<ColorField
												value={highlightDraft.tintColor ?? HIGHLIGHT_TINT_DEFAULT_COLOR}
												oninput={(hex) => {
													if (highlightDraft) highlightDraft.tintColor = hex;
												}}
											/>
										</div>
									{/if}
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

				<section class="highlight" class:editing={glowEditing}>
					<div class="hl-head">
						<div class="hl-title">
							<h2>Free-spin board glow</h2>
							<p class="hl-sub">
								The glow behind the reels during free spins. Swap the art for any R2 spine bundle (a
								Rigger rig included); the game still plays it start → idle → exit.
							</p>
						</div>
						<div class="hl-actions">
							{#if doc.boardGlow}<span class="badge">overridden</span>{/if}
							{#if glowEditing}
								<button type="button" class="ghost" onclick={closeGlow}>Cancel</button>
							{:else}
								<button type="button" class="hl-change" onclick={openGlow}>Change</button>
								{#if doc.boardGlow}
									<button type="button" class="ghost" onclick={resetGlow}>Reset to default</button>
								{/if}
							{/if}
						</div>
					</div>

					<div class="hl-body">
						<div class="hl-current">
							{#if doc.boardGlow}
								<div class="hl-preview">
									<SymbolSpinePreview
										assetKey={doc.boardGlow.assetKey}
										animationName={doc.boardGlow.animations?.idle ??
											doc.boardGlow.animations?.start}
										size={96}
										{reloadToken}
									/>
								</div>
								<div class="hl-meta">
									<span class="hl-label">Override</span>
									<span class="hl-chip">
										{doc.boardGlow.assetKey.split('/').filter(Boolean).pop()}
									</span>
									{#if doc.boardGlow.animations?.idle}
										<span class="hl-anim">{doc.boardGlow.animations.idle}</span>
									{/if}
								</div>
							{:else if defaultGlowBundle}
								<div class="hl-preview">
									<SymbolSpinePreview
										assetKey={defaultGlowBundle.key}
										animationName={BUILTIN_GLOW.animations.idle}
										size={96}
										{reloadToken}
									/>
								</div>
								<div class="hl-meta">
									<span class="hl-label">Default (reelhouse)</span>
									<span class="hl-chip">{defaultGlowBundle.name}</span>
									<span class="hl-anim">{BUILTIN_GLOW.animations.idle}</span>
								</div>
							{:else}
								<div class="hl-preview default">
									<span class="hl-default-mark">reelhouse</span>
								</div>
								<div class="hl-meta">
									<span class="hl-label">Default (reelhouse)</span>
									<span class="hl-note">
										The coded default ships with the game and still renders in-game; the launcher
										just has no copy to preview. Pick an R2 spine to override it.
									</span>
								</div>
							{/if}
						</div>

						{#if glowEditing && glowDraft}
							<div class="hl-editor">
								<div class="field">
									<span class="label">Spine bundle</span>
									<select
										value={glowDraft.assetKey}
										onchange={(e) => {
											if (!glowDraft) return;
											glowDraft.assetKey = e.currentTarget.value;
											glowDraft.animations = {};
											glowAnimations = [];
										}}
									>
										<option value="">Pick a bundle…</option>
										{#each spineBundles as b (b.key)}
											<option value={b.key}>{b.name}</option>
										{/each}
									</select>
								</div>
								{#if glowDraft.assetKey}
									<!-- Three sparse tracks — each left blank keeps its coded `reelhouse_glow_*`
											 name, so a rig that only renames its loop needs one field. -->
									{#each GLOW_TRACKS as row (row.track)}
										<div class="field">
											<span class="label">{row.label}</span>
											{#if glowAnimations.length}
												<select
													value={glowDraft.animations?.[row.track] ?? ''}
													onchange={(e) => setGlowTrack(row.track, e.currentTarget.value)}
												>
													<option value="">(coded default)</option>
													{#each glowAnimations as anim (anim)}
														<option value={anim}>{anim}</option>
													{/each}
												</select>
											{:else}
												<input
													type="text"
													placeholder={BUILTIN_GLOW.animations[row.track]}
													value={glowDraft.animations?.[row.track] ?? ''}
													oninput={(e) => setGlowTrack(row.track, e.currentTarget.value)}
												/>
											{/if}
										</div>
									{/each}
									<div class="field">
										<span class="label">Preview</span>
										<div class="hl-preview">
											<SymbolSpinePreview
												assetKey={glowDraft.assetKey}
												animationName={glowDraft.animations?.idle ?? glowDraft.animations?.start}
												size={96}
												{reloadToken}
												onAnimations={(names) => (glowAnimations = names)}
											/>
										</div>
									</div>
								{/if}
								<button
									type="button"
									class="apply"
									disabled={!glowDraft.assetKey}
									onclick={applyGlow}
								>
									Apply board glow
								</button>
							</div>
						{/if}
					</div>
				</section>

				<section class="bookvfx">
					<div class="hl-head">
						<div class="hl-title">
							<h2>Book symbol VFX</h2>
							<p class="hl-sub">
								Two layers drawn behind and in front of the book symbol during free spins. Each can
								be a sprite frame, a spine animation, an Invisible Flipbook clip, or an Invisible FX
								effect. Leave a layer unset to draw nothing.
							</p>
						</div>
					</div>

					{#snippet bookVfxThumb(layer: BookVfxLayer, size: number)}
						{#if layer.kind === 'sprite' && layer.assetKey}
							<SymbolSpritePreview frame={layer.assetKey} index={spriteIndex} {size} />
						{:else if layer.kind === 'spine' && layer.assetKey}
							<SymbolSpinePreview
								assetKey={layer.assetKey}
								animationName={layer.animationName}
								{size}
								{reloadToken}
							/>
						{:else if layer.kind === 'flipbook' && layer.clipId}
							{@const frame = clipFirstFrame(layer.clipId)}
							{#if frame}<SymbolSpritePreview {frame} index={spriteIndex} {size} />{/if}
						{:else if layer.kind === 'fx' && layer.effectId}
							<SymbolFxPreview effectId={layer.effectId} {size} />
						{/if}
					{/snippet}

					<div class="bv-slots">
						{#each BOOK_VFX_SLOT_META as meta (meta.slot)}
							{@const layer = doc.bookVfx?.[meta.slot]}
							{@const editing = bookVfxEditing === meta.slot}
							<div class="bv-slot" class:editing>
								<div class="bv-slot-head">
									<div class="bv-slot-title">
										<h3>{meta.label}</h3>
										<p class="bv-sub">{meta.sub}</p>
									</div>
									<div class="hl-actions">
										{#if layer}<span class="badge">set</span>{/if}
										{#if editing}
											<button type="button" class="ghost" onclick={closeBookVfx}>Cancel</button>
										{:else}
											<button
												type="button"
												class="hl-change"
												onclick={() => openBookVfx(meta.slot)}
											>
												{layer ? 'Change' : 'Add'}
											</button>
											{#if layer}
												<button type="button" class="ghost" onclick={() => resetBookVfx(meta.slot)}>
													↺ Clear
												</button>
											{/if}
										{/if}
									</div>
								</div>

								<div class="bv-current">
									{#if layer}
										<div class="bv-thumb">{@render bookVfxThumb(layer, 72)}</div>
										<div class="bv-meta">
											<span class="hl-label">{BOOK_VFX_KIND_LABELS[layer.kind]}</span>
											<span class="hl-chip">{bookVfxLabel(layer)}</span>
										</div>
									{:else}
										<span class="hl-note">No layer — the game draws nothing here.</span>
									{/if}
								</div>

								{#if editing && bookVfxDraft}
									<div class="bv-editor">
										<div class="field">
											<span class="label">Type</span>
											<div class="seg">
												{#each BOOK_VFX_KINDS as kind (kind)}
													{@const noClips = kind === 'flipbook' && clips.length === 0}
													{@const noFx = kind === 'fx' && effects.length === 0}
													<button
														type="button"
														class:active={bookVfxDraft.kind === kind}
														disabled={noClips || noFx}
														title={noClips
															? 'This project has no Flipbook clips yet'
															: noFx
																? 'This project has no FX effects yet'
																: ''}
														onclick={() => setBookVfxKind(kind)}
														>{BOOK_VFX_KIND_LABELS[kind]}</button
													>
												{/each}
											</div>
										</div>

										{#if bookVfxDraft.kind === 'sprite'}
											<div class="field">
												<span class="label">Frame</span>
												<RegionPicker
													scoped
													sheets={pickSheets}
													value={bookVfxDraft.assetKey ?? ''}
													onSelect={(region) => {
														if (bookVfxDraft) bookVfxDraft.assetKey = region;
													}}
												/>
											</div>
											{#if bookVfxDraft.assetKey}
												<div class="field">
													<span class="label">Preview</span>
													<div class="panel-preview">
														<SymbolSpritePreview
															frame={bookVfxDraft.assetKey}
															index={spriteIndex}
															size={110}
														/>
													</div>
												</div>
											{/if}
										{:else if bookVfxDraft.kind === 'spine'}
											<div class="field">
												<span class="label">Spine bundle</span>
												<select
													value={bookVfxDraft.assetKey ?? ''}
													onchange={(e) => {
														if (!bookVfxDraft) return;
														bookVfxDraft.assetKey = e.currentTarget.value || undefined;
														bookVfxDraft.animationName = undefined;
														bookVfxAnimations = [];
													}}
												>
													<option value="">Pick a bundle…</option>
													{#each spineBundles as b (b.key)}
														<option value={b.key}>{b.name}</option>
													{/each}
												</select>
											</div>
											{#if bookVfxDraft.assetKey}
												<div class="field">
													<span class="label">Animation</span>
													{#if bookVfxAnimations.length}
														<select
															value={bookVfxDraft.animationName ?? ''}
															onchange={(e) => {
																if (bookVfxDraft)
																	bookVfxDraft.animationName = e.currentTarget.value || undefined;
															}}
														>
															<option value="">Pick an animation…</option>
															{#each bookVfxAnimations as anim (anim)}
																<option value={anim}>{anim}</option>
															{/each}
														</select>
													{:else}
														<input
															type="text"
															placeholder="animation name"
															value={bookVfxDraft.animationName ?? ''}
															oninput={(e) => {
																if (bookVfxDraft)
																	bookVfxDraft.animationName = e.currentTarget.value || undefined;
															}}
														/>
													{/if}
												</div>
												<div class="field">
													<span class="label">Preview</span>
													<div class="panel-preview">
														<SymbolSpinePreview
															assetKey={bookVfxDraft.assetKey}
															animationName={bookVfxDraft.animationName}
															size={110}
															{reloadToken}
															onAnimations={(names) => (bookVfxAnimations = names)}
														/>
													</div>
												</div>
											{/if}
										{:else if bookVfxDraft.kind === 'flipbook'}
											<div class="field">
												<span class="label">Clip</span>
												<select
													value={bookVfxDraft.clipId ?? ''}
													onchange={(e) => setBookVfxClip(e.currentTarget.value)}
												>
													<option value="">Pick a clip…</option>
													{#each clips as c (c.id)}
														<option value={c.id}>{clipLabel(c.id)}</option>
													{/each}
												</select>
											</div>
											{#if bookVfxDraft.clipId}
												{@const frame = clipFirstFrame(bookVfxDraft.clipId)}
												<div class="field">
													<span class="label">Preview</span>
													<div class="panel-preview">
														{#if frame}
															<SymbolSpritePreview {frame} index={spriteIndex} size={110} />
														{:else}
															<span class="chip">no frames</span>
														{/if}
													</div>
												</div>
											{/if}
										{:else}
											<div class="field">
												<span class="label">Effect</span>
												<select
													value={bookVfxDraft.effectId ?? ''}
													onchange={(e) => {
														if (bookVfxDraft)
															bookVfxDraft.effectId = e.currentTarget.value || undefined;
													}}
												>
													<option value="">Pick an effect…</option>
													{#each effects as fx (fx.id)}
														<option value={fx.id}>{fx.name}</option>
													{/each}
												</select>
												<p class="hint">
													The effect plays from Invisible FX — open <a href="/fx">Invisible FX</a>
													to edit it. For an FX layer, <strong>Size</strong> below is a scale multiplier
													on the effect's authored size (1 = as authored), not a cell fit — so 10 is
													10× (huge); dial it down (e.g. 0.5) to fit the cell.
												</p>
											</div>
											{#if bookVfxDraft.effectId}
												<div class="field">
													<span class="label">Preview</span>
													<div class="panel-preview">
														<SymbolFxPreview effectId={bookVfxDraft.effectId} size={140} />
													</div>
												</div>
											{/if}
										{/if}

										<div class="bv-fit">
											<div class="field">
												<span class="label">Size × cell (w × h)</span>
												<div class="bv-pair">
													<input
														type="number"
														step="0.05"
														min="0"
														placeholder="auto"
														value={bookVfxDraft.sizeRatios?.width ?? ''}
														oninput={(e) => setBookVfxSize('width', e.currentTarget.value)}
													/>
													<input
														type="number"
														step="0.05"
														min="0"
														placeholder="auto"
														value={bookVfxDraft.sizeRatios?.height ?? ''}
														oninput={(e) => setBookVfxSize('height', e.currentTarget.value)}
													/>
												</div>
											</div>
											<div class="field">
												<span class="label">Offset × cell (x, y)</span>
												<div class="bv-pair">
													<input
														type="number"
														step="0.05"
														placeholder="0"
														value={bookVfxDraft.offset?.x ?? ''}
														oninput={(e) => setBookVfxOffset('x', e.currentTarget.value)}
													/>
													<input
														type="number"
														step="0.05"
														placeholder="0"
														value={bookVfxDraft.offset?.y ?? ''}
														oninput={(e) => setBookVfxOffset('y', e.currentTarget.value)}
													/>
												</div>
											</div>
										</div>

										<button
											type="button"
											class="apply"
											disabled={!bookVfxBindable}
											onclick={applyBookVfx}
										>
											Apply {meta.label.toLowerCase()}
										</button>
									</div>
								{/if}
							</div>
						{/each}
					</div>
				</section>

				{#snippet stackedArtPreview(art: SymbolCell | undefined, size: number)}
					{#if !art?.assetKey}
						<span class="chip">unset</span>
					{:else if art.type === 'sprite'}
						<SymbolSpritePreview frame={art.assetKey} index={spriteIndex} {size} />
					{:else if art.type === 'flipbook'}
						{@const frame = clipFirstFrame(art.clipId)}
						{#if frame}
							<SymbolSpritePreview {frame} index={spriteIndex} {size} />
						{:else}
							<span class="chip">no frames</span>
						{/if}
					{:else}
						<SymbolSpinePreview
							assetKey={art.assetKey}
							animationName={art.animationName}
							{size}
							{reloadToken}
						/>
					{/if}
				{/snippet}

				<section class="winline" class:expanded={stackedOn}>
					<div class="wl-head">
						<div class="wl-text">
							<h2>Stacked pictures</h2>
							<p class="wl-sub">
								Turn a symbol into a single <strong>tall picture</strong> that fills several cells
								for the stacked-picture reel mode. Pick which symbols are stacked, how many cells
								tall each is, and the tall picture itself — that picture is the <em>only</em> thing a
								stacked symbol shows. Off by default.
							</p>
						</div>
						<label class="switch" class:on={stackedOn}>
							<input
								type="checkbox"
								checked={stackedOn}
								onchange={(e) => toggleStackedPictures(e.currentTarget.checked)}
							/>
							<span class="track"><span class="knob"></span></span>
							<span class="switch-label">{stackedOn ? 'On' : 'Off'}</span>
						</label>
					</div>

					{#if stackedOn}
						<div class="wl-config">
							<div class="wl-group">
								<label class="switch" class:on={stackedFullHeightOnly}>
									<input
										type="checkbox"
										checked={stackedFullHeightOnly}
										onchange={(e) => toggleStackedFullHeightOnly(e.currentTarget.checked)}
									/>
									<span class="track"><span class="knob"></span></span>
									<span class="switch-label">Show the tall picture only at full height</span>
								</label>
								<p class="hint">
									On: a landed stack shorter than the symbol's height shows the normal single
									symbols instead of a cropped tall picture. Off: a partial stack shows the top of
									the picture.
								</p>
							</div>
							<div class="wl-group">
								<label class="switch" class:on={stackedEdgeCutoffs}>
									<input
										type="checkbox"
										checked={stackedEdgeCutoffs}
										onchange={(e) => toggleStackedEdgeCutoffs(e.currentTarget.checked)}
									/>
									<span class="track"><span class="knob"></span></span>
									<span class="switch-label">Cut-off tall pictures at the board edges</span>
								</label>
								<p class="hint">
									On: a stacked symbol touching the TOP or BOTTOM edge draws a cut-off tall picture
									— the visible slice of a symbol scrolled partly off-screen (top edge shows the
									bottom of the picture, bottom edge the top), for any run length. This overrides
									"full-height only" at the edges. Off: edge stacks follow the setting above.
								</p>
							</div>
							<div class="wl-group">
								<h3>Stacked symbols</h3>
								{#if symbolNames.length === 0}
									<p class="hint">No symbols defined for this game type.</p>
								{:else}
									<div class="stacked-pick">
										{#each symbolNames as name (name)}
											<button
												type="button"
												class="stacked-chip"
												class:unused={isUnused(name)}
												class:on={stackedSet.has(name)}
												onclick={() => toggleStackedSymbol(name)}
												title={stackedSet.has(name)
													? 'Stacked — click to un-stack'
													: 'Make stacked'}
											>
												{name}
											</button>
										{/each}
									</div>
								{/if}
							</div>

							{#each stackedList as s (s.name)}
								<div class="wl-group stacked-row">
									<div class="stacked-art-preview">
										{@render stackedArtPreview(s.art, 96)}
									</div>
									<div class="stacked-controls">
										<h3>{s.name}</h3>
										<label class="field">
											<span class="label">Height (cells tall)</span>
											<input
												type="number"
												min="1"
												step="1"
												value={s.height}
												oninput={(e) => setStackedHeight(s.name, e.currentTarget.value)}
											/>
										</label>
										<div class="stacked-art-actions">
											<button
												type="button"
												class="apply"
												class:editing={stackedEdit?.symbol === s.name}
												onclick={() => openStackedArt(s.name)}
											>
												{stackedEdit?.symbol === s.name
													? 'Editing tall picture…'
													: 'Edit tall picture'}
											</button>
											<button
												type="button"
												class="ghost"
												onclick={() => toggleStackedSymbol(s.name)}
											>
												Remove
											</button>
										</div>
										<p class="hint mono">{cellLabel(s.art)}</p>
									</div>
								</div>
							{/each}
						</div>
					{/if}
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
									<div class="field wl-span">
										<span class="label">Use payline colour from config</span>
										<label
											class="switch sm"
											class:on={wlLine.useConfigColor ?? WL_DEFAULTS.useConfigColor}
										>
											<input
												type="checkbox"
												checked={wlLine.useConfigColor ?? WL_DEFAULTS.useConfigColor}
												onchange={(e) =>
													patchWinLineLine({ useConfigColor: e.currentTarget.checked })}
											/>
											<span class="track"><span class="knob"></span></span>
											<span class="switch-label"
												>{(wlLine.useConfigColor ?? WL_DEFAULTS.useConfigColor)
													? 'On'
													: 'Off'}</span
											>
										</label>
										<span class="hint">
											When on (default), each winning line draws in that payline's colour from the
											Invisible Game Config, falling back to the swatch below. Turn off to make the
											swatch authoritative and ignore the config colour.
										</span>
									</div>
									<label
										class="field"
										class:disabled={wlLine.useConfigColor ?? WL_DEFAULTS.useConfigColor}
									>
										<span class="label">Colour</span>
										<ColorField
											disabled={wlLine.useConfigColor ?? WL_DEFAULTS.useConfigColor}
											value={wlLine.color ?? WL_DEFAULTS.color}
											oninput={(hex) => patchWinLineLine({ color: hex })}
										/>
										{#if wlLine.useConfigColor ?? WL_DEFAULTS.useConfigColor}
											<span class="hint">Overridden by the config payline colour.</span>
										{/if}
									</label>
									<label class="field">
										<span class="label"
											>Thickness {(wlLine.width ?? WL_DEFAULTS.width).toFixed(3)}</span
										>
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
											<span class="switch-label"
												>{(wlLine.glow ?? WL_DEFAULTS.glow) ? 'On' : 'Off'}</span
											>
										</label>
									</div>
									<label class="field" class:disabled={!(wlLine.glow ?? WL_DEFAULTS.glow)}>
										<span class="label">Glow colour</span>
										<ColorField
											disabled={!(wlLine.glow ?? WL_DEFAULTS.glow)}
											value={wlLine.glowColor ?? wlLine.color ?? WL_DEFAULTS.glowColor}
											oninput={(hex) => patchWinLineLine({ glowColor: hex })}
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
										<span class="label"
											>Speed ×{(wlLine.speed ?? WL_DEFAULTS.speed).toFixed(2)}</span
										>
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
									<div class="field">
										<span class="label">Show full payline</span>
										<label
											class="switch sm"
											class:on={wlLine.fullPayline ?? WL_DEFAULTS.fullPayline}
										>
											<input
												type="checkbox"
												checked={wlLine.fullPayline ?? WL_DEFAULTS.fullPayline}
												onchange={(e) => patchWinLineLine({ fullPayline: e.currentTarget.checked })}
											/>
											<span class="track"><span class="knob"></span></span>
											<span class="switch-label"
												>{(wlLine.fullPayline ?? WL_DEFAULTS.fullPayline) ? 'On' : 'Off'}</span
											>
										</label>
									</div>
									<label
										class="field"
										class:disabled={!(wlLine.fullPayline ?? WL_DEFAULTS.fullPayline)}
									>
										<span class="label">Full payline colour</span>
										<ColorField
											disabled={!(wlLine.fullPayline ?? WL_DEFAULTS.fullPayline)}
											value={wlLine.fullPaylineColor ?? WL_DEFAULTS.fullPaylineColor}
											oninput={(hex) => patchWinLineLine({ fullPaylineColor: hex })}
										/>
									</label>
								</div>
								<p class="wl-note">
									Off (the default), the line traces only the winning symbols, up to where the
									amount is stamped. On, the WHOLE payline is drawn across all reels in the colour
									above, with the winning segment on top.
								</p>
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
										<ColorField
											value={wlText.color ?? WL_DEFAULTS.textColor}
											oninput={(hex) => patchWinLineText({ color: hex })}
										/>
									</label>
								</div>
								<p class="wl-note">
									The amount uses a bitmap font, so the colour tints it — clean on a light font, but
									tinting an already-coloured font (e.g. gold) just darkens it. To recolour cleanly,
									pick a differently-coloured font.
								</p>
							</div>

							<button type="button" class="ghost wl-reset" onclick={resetWinLineStyle}>
								Reset win-line style
							</button>
						</div>
					{/if}
				</section>

				<section class="winline" class:expanded={wcOn}>
					<div class="wl-head">
						<div class="wl-text">
							<h2>Winning symbols after the spin</h2>
							<p class="wl-sub">
								Keep the round's winning symbols animating on the resting board until the player
								spins again, instead of freezing on their post-win frame. A spin that paid several
								lines steps through them one line at a time, in the order the round paid them, then
								starts over. Autoplay and space-hold skip it, since the next spin is already on its
								way.
							</p>
						</div>
						<label class="switch" class:on={wcOn}>
							<input
								type="checkbox"
								checked={wcOn}
								onchange={(e) => (doc = setWinCycleEnabled(doc, e.currentTarget.checked))}
							/>
							<span class="track"><span class="knob"></span></span>
							<span class="switch-label">{wcOn ? 'On' : 'Off'}</span>
						</label>
					</div>

					<div class="wl-config">
						<div class="wl-group">
							<div class="wl-fields">
								<div class="field">
									<span class="label">Darken the non-winning symbols</span>
									<label class="switch sm" class:on={wcDim}>
										<input
											type="checkbox"
											checked={wcDim}
											onchange={(e) =>
												(doc = setWinCycleDimNonWinning(doc, e.currentTarget.checked))}
										/>
										<span class="track"><span class="knob"></span></span>
										<span class="switch-label">{wcDim ? 'On' : 'Off'}</span>
									</label>
								</div>
							</div>
							<p class="wl-note">
								While the win is celebrated — and until the player spins again — every symbol that
								is not part of a paying line is drawn darkened, so the winning line stands out. This
								is independent of the replay above: it applies even with "Winning symbols after the
								spin" off. A losing spin leaves the whole board at full brightness.
							</p>
						</div>

						<div class="wl-group">
							<div class="wl-fields">
								<div class="field">
									<span class="label">Wait for a spin press after a big win (free spins)</span>
									<label class="switch sm" class:on={wcHold}>
										<input
											type="checkbox"
											checked={wcHold}
											onchange={(e) =>
												(doc = setWinCycleHoldAfterBigWin(doc, e.currentTarget.checked))}
										/>
										<span class="track"><span class="knob"></span></span>
										<span class="switch-label">{wcHold ? 'On' : 'Off'}</span>
									</label>
								</div>
							</div>
							<p class="wl-note">
								Free spins normally run one after another on their own, so closing a big win in the
								middle of a feature hands straight over to the next spin and the reels start rolling
								before the player has read the board. Turn this on and the feature rests on the
								winning board instead — with the replay above narrating its paying lines — and the
								next free spin only starts when the player presses spin. The button stays live and
								reads SPIN for as long as the game waits. The last free spin's big win is not held
								(the free-spin outro follows it, and that already waits for a press), and autoplay
								or space-hold skips the wait, since the player has asked for hands-off play.
							</p>
						</div>
					</div>

					{#if wcOn}
						<div class="wl-config">
							<div class="wl-group">
								<div class="wl-fields">
									<label class="field">
										<span class="label">Gap between lines {wcDelay.toFixed(2)}s</span>
										<input
											type="range"
											min="0"
											max="3"
											step="0.05"
											value={wcDelay}
											oninput={(e) => (doc = setWinCycleDelay(doc, Number(e.currentTarget.value)))}
										/>
									</label>
									<div class="field">
										<span class="label">Replay the win line too</span>
										<label class="switch sm" class:on={wcShowLine}>
											<input
												type="checkbox"
												checked={wcShowLine}
												onchange={(e) => (doc = setWinCycleShowLine(doc, e.currentTarget.checked))}
											/>
											<span class="track"><span class="knob"></span></span>
											<span class="switch-label">{wcShowLine ? 'On' : 'Off'}</span>
										</label>
									</div>
									<div class="field" class:disabled={!wcShowLine}>
										<span class="label">Replay the win text too</span>
										<label class="switch sm" class:on={wcShowText && wcShowLine}>
											<input
												type="checkbox"
												disabled={!wcShowLine}
												checked={wcShowText}
												onchange={(e) => (doc = setWinCycleShowText(doc, e.currentTarget.checked))}
											/>
											<span class="track"><span class="knob"></span></span>
											<span class="switch-label">{wcShowText ? 'On' : 'Off'}</span>
										</label>
									</div>
									<div class="field">
										<span class="label">Replay the win message too</span>
										<label class="switch sm" class:on={wcShowMessage}>
											<input
												type="checkbox"
												checked={wcShowMessage}
												onchange={(e) =>
													(doc = setWinCycleShowMessage(doc, e.currentTarget.checked))}
											/>
											<span class="track"><span class="knob"></span></span>
											<span class="switch-label">{wcShowMessage ? 'On' : 'Off'}</span>
										</label>
									</div>
								</div>
								<p class="wl-note">
									On (the default), each pass also draws that line and stamps its amount — the full
									per-win narration on repeat. Off, the replay re-animates the winning symbols only
									and leaves the board's line as the spin left it. "Replay the win text too" gates
									just the stamped amount, so you can keep the line replaying without the number.
									The Win lines section above still has the final say: with the overlay off, nothing
									is drawn either way, and a scatter win never draws a line but still lights its
									symbols. "Replay the win message too" is independent of the line and defaults OFF:
									turn it on to re-show that win's info toast ("You win $X with N Bananas") on every
									pass, otherwise the message only shows once when the round first presents.
								</p>
							</div>
						</div>
					{/if}
				</section>

				<section class="winline anticipation" class:expanded={true}>
					<div class="wl-head">
						<div class="wl-text">
							<h2>Reel anticipation</h2>
							<p class="wl-sub">
								The escalating tease the game plays while a big win is still reachable on the reels
								yet to stop. Pick the activation STING and the sustained LOOP sounds once for the
								whole mode; then, per configured big-win tier, style the intensity (the camera zoom,
								the overlay spine's scale / opacity / tint, and the loop + sting volumes), climbing
								as the reachable win crosses each tier. The mode itself is turned on and off from
								Flow; this only styles it. Leave a field at its default to keep the game's coded
								value.
							</p>
						</div>
						{#if anticipationOverridden}
							<div class="hl-actions">
								<span class="badge">overridden</span>
								<button type="button" class="ghost" onclick={resetAnticipation}>
									Reset to default
								</button>
							</div>
						{/if}
					</div>

					<div class="wl-config">
						<div class="wl-group">
							<div class="field">
								<span class="label">Overlay spine</span>
								<select
									value={doc.anticipation?.spineKey ?? ''}
									onchange={(e) => setAnticipationSpine(e.currentTarget.value)}
								>
									<option value="">Default (coded anticipation spine)</option>
									{#each anticipationSpineBundles as b (b.key)}
										<option value={b.key}>{b.name}</option>
									{/each}
								</select>
								<span class="wl-note">
									The per-reel overlay skeleton. The default is the game's built-in
									<code>anticipation</code> spine; a swapped bundle must expose the
									<code>anticipation_intro / _loop / _out</code> animations (the game still owns the
									intro → loop → out chaining).
								</span>
							</div>

							<div class="field">
								<span class="label">Overlay animation</span>
								{#if anticipationAnimations.length}
									<select
										value={doc.anticipation?.animationSet ?? 'anticipation'}
										onchange={(e) =>
											setAnticipationAnimation(
												e.currentTarget.value === 'anticipation' ? '' : e.currentTarget.value,
											)}
									>
										{#each anticipationSets as base (base)}
											<option value={base}>
												{base}{base === 'anticipation' ? ' (unnumbered — default)' : ''}
											</option>
										{/each}
									</select>
								{:else}
									<input
										type="text"
										placeholder="anticipation"
										value={doc.anticipation?.animationSet ?? ''}
										oninput={(e) => setAnticipationAnimation(e.currentTarget.value)}
									/>
								{/if}
								<span class="wl-note">
									Which animation SET the overlay plays — a spine's differently-sized anticipations.
									The game appends <code>_intro / _loop / _out</code>, so this is the base name
									(e.g. <code>anticipation3</code> → <code>anticipation3_intro</code>). The
									unnumbered
									<code>anticipation</code> is the game's default.
								</span>
							</div>

							<div class="field">
								<span class="label">Overlay size (cells)</span>
								<div class="ant-size">
									<label>
										<span>Width</span>
										<input
											type="number"
											min="0.1"
											step="0.1"
											placeholder="0.56"
											value={doc.anticipation?.overlayWidthCells ?? ''}
											oninput={(e) => setAnticipationOverlaySize('width', e.currentTarget.value)}
										/>
									</label>
									<label>
										<span>Height</span>
										<input
											type="number"
											min="0.1"
											step="0.1"
											placeholder="1.6"
											value={doc.anticipation?.overlayHeightCells ?? ''}
											oninput={(e) => setAnticipationOverlaySize('height', e.currentTarget.value)}
										/>
									</label>
								</div>
								<span class="wl-note">
									The overlay box the animation is scaled to fit, in cells (1 = one symbol). The
									coded default is a narrow beam (<code>0.56 × 1.6</code>); for a full-column
									anticipation set the height to your reel's row count (e.g. <code>5</code>) and the
									width to about <code>1</code>. Leave blank to keep the coded beam.
								</span>
							</div>

							<div class="field">
								<span class="label">Activation sound</span>
								<select
									value={doc.anticipation?.activationSound ?? ''}
									onchange={(e) => setAnticipationActivation(e.currentTarget.value)}
								>
									<option value="">Default (coded sfx_anticipation_start)</option>
									{#each SOUND_EFFECT_NAMES as name (name)}
										<option value={name}>{name}</option>
									{/each}
								</select>
								<span class="wl-note">
									The one-shot STING fired the moment a reel arms the tease. Its volume escalates
									per tier below (Sting volume). Leave on Default to keep the coded
									<code>sfx_anticipation_start</code>.
								</span>
							</div>

							<div class="field">
								<span class="label">Loop sound</span>
								<select
									value={doc.anticipation?.loopSound ?? ''}
									onchange={(e) => setAnticipationLoop(e.currentTarget.value)}
								>
									<option value="">Default (coded sfx_anticipation)</option>
									{#each SOUND_EFFECT_NAMES as name (name)}
										<option value={name}>{name}</option>
									{/each}
								</select>
								<span class="wl-note">
									The sustained LOOP that fades in while a reel is still anticipating. Its target
									volume escalates per tier below (Loop volume). Leave on Default to keep the coded
									<code>sfx_anticipation</code>.
								</span>
							</div>

							{#if bigTiers.length === 0}
								<p class="wl-note">
									This project has no big-win tiers yet, so there's nothing to style. Add big-win
									tiers in <strong>Invisible Game Config</strong> (<code>/config</code> → “Big win tiers”)
									first — one anticipation FX column then appears here per big tier.
								</p>
							{:else}
								<div class="ant-tiers">
									{#each bigTiers as tier, rank (tier.alias)}
										{@const count = bigTiers.length}
										<div class="ant-tier">
											<h3>{tier.name}</h3>
											<label class="field">
												<span class="label">
													Zoom ×{anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'zoom',
													).toFixed(2)}
												</span>
												<input
													type="range"
													min="1"
													max="1.6"
													step="0.01"
													value={anticipationFieldValue(doc, tier.alias, rank, count, 'zoom')}
													oninput={(e) =>
														patchAnticipationTier(tier.alias, {
															zoom: Number(e.currentTarget.value),
														})}
												/>
											</label>
											<label class="field">
												<span class="label">
													Overlay scale ×{anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'overlayScale',
													).toFixed(2)}
												</span>
												<input
													type="range"
													min="0.5"
													max="2"
													step="0.01"
													value={anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'overlayScale',
													)}
													oninput={(e) =>
														patchAnticipationTier(tier.alias, {
															overlayScale: Number(e.currentTarget.value),
														})}
												/>
											</label>
											<label class="field">
												<span class="label">
													Overlay opacity {anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'overlayAlpha',
													).toFixed(2)}
												</span>
												<input
													type="range"
													min="0"
													max="1"
													step="0.01"
													value={anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'overlayAlpha',
													)}
													oninput={(e) =>
														patchAnticipationTier(tier.alias, {
															overlayAlpha: Number(e.currentTarget.value),
														})}
												/>
											</label>
											<label class="field">
												<span class="label">Overlay tint</span>
												<ColorField
													value={anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'overlayTint',
													)}
													oninput={(hex) =>
														patchAnticipationTier(tier.alias, {
															overlayTint: hex,
														})}
												/>
											</label>
											<label class="field">
												<span class="label">
													Loop volume {anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'soundVolume',
													).toFixed(2)}
												</span>
												<input
													type="range"
													min="0"
													max="1"
													step="0.05"
													value={anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'soundVolume',
													)}
													oninput={(e) =>
														patchAnticipationTier(tier.alias, {
															soundVolume: Number(e.currentTarget.value),
														})}
												/>
											</label>
											<label class="field">
												<span class="label">
													Sting volume {anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'stingVolume',
													).toFixed(2)}
												</span>
												<input
													type="range"
													min="0"
													max="1"
													step="0.05"
													value={anticipationFieldValue(
														doc,
														tier.alias,
														rank,
														count,
														'stingVolume',
													)}
													oninput={(e) =>
														patchAnticipationTier(tier.alias, {
															stingVolume: Number(e.currentTarget.value),
														})}
												/>
											</label>
										</div>
									{/each}
								</div>
								<p class="wl-note">
									A white tint (<code>#ffffff</code>) leaves the overlay's own colours; a hotter
									tint multiplies over them — the coded defaults ramp white → hot orange as the
									tiers climb. The reel-tease mode is armed from Flow (enable / disable
									anticipation); with it off, none of this renders.
								</p>
							{/if}
						</div>
					</div>
				</section>

				{#if symbolNames.length === 0}
					<p class="muted">No symbols defined for this game type.</p>
				{:else}
					{#if unusedCount > 0}
						<p class="hint">
							{unusedCount}
							{unusedCount === 1 ? 'symbol is' : 'symbols are'}
							marked <strong>not dealt</strong> — they are on no reel strip in
							<strong>Invisible Game Config</strong>, and came from the template this project
							was seeded from. Art authored for them never renders.
						</p>
					{/if}
					<table class="grid" style="--cell: {previewSize}px">
						<thead>
							<tr>
								<th class="corner">Symbol</th>
								{#each visibleStates as state (state)}
									<th title={STATE_HINTS[state]}>{STATE_LABELS[state]}</th>
								{/each}
							</tr>
						</thead>
						<tbody>
							{#each symbolNames as symbol (symbol)}
								{@const named = doc.names?.[symbol]}
								<tr class:unused-row={isUnused(symbol)}>
									<th class="rowhead">
										<span class="sym-id">{symbol}</span>
										{#if isUnused(symbol)}
											<span
												class="sym-unused"
												title="This project never deals {symbol} — it is on no reel strip in Invisible Game Config. It appears here because the template this project was seeded from included it. Authoring art for it has no effect; remove it in /config to stop seeing it."
												>not dealt</span
											>
										{/if}
										<!-- The DISPLAY NAME: what the game calls this symbol out loud. Invisible Win
										     Text prints it as {symbolName}, so a win says "4 Bananas" instead of the
										     unspeakable id — or "4 of a kind", which is what it had to say before a
										     symbol had a word. Both forms are typed because "{count} {symbolName}"
										     always reads with a number in front of it and guessed plurals are wrong
										     ("Cherrys"); plural left blank just reuses the singular. -->
										<input
											class="sym-name"
											value={named?.singular ?? ''}
											placeholder="Name"
											title="What the game calls {symbol} in win messages (singular)"
											oninput={(e) => setName(symbol, 'singular', e.currentTarget.value)}
										/>
										<input
											class="sym-name plural"
											value={named?.plural ?? ''}
											placeholder={named?.singular ? `${named.singular} (plural)` : 'Plural'}
											title="The plural form, used whenever the count isn't 1. Blank reuses the name."
											oninput={(e) => setName(symbol, 'plural', e.currentTarget.value)}
										/>
									</th>
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
													{:else if eff.cell.type === 'flipbook'}
														<!-- A STILL first frame, not a player. Grid spine cells animate (via the
														     shared <SymbolSpineStage> WebGL surface); a flipbook deliberately does
														     not: N cells each running their own ticker would cost far more than the
														     one spine stage, and the thing the grid has to answer is "which clip is
														     bound here", which a first frame + the clip's name answers. Scrub
														     playback lives in /flipbook, which owns the clip. -->
														{@const frame = clipFirstFrame(eff.cell.clipId)}
														<div class="flipbook-cell">
															{#if frame}
																<SymbolSpritePreview
																	{frame}
																	index={spriteIndex}
																	size={previewSize}
																/>
															{:else}
																<span class="chip" title={cellLabel(eff.cell)}>no frames</span>
															{/if}
															<span class="chip flip" title={cellLabel(eff.cell)}>
																{clipLabel(eff.cell.clipId)}
															</span>
														</div>
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

		{#if (focus || stackedEdit) && draft}
			<aside class="panel">
				<div class="panel-head">
					<h2>
						{#if stackedEdit}
							{stackedEdit.symbol} · Tall picture
						{:else if focus}
							{focus.symbol} · {STATE_LABELS[focus.state]}
						{/if}
					</h2>
					<button
						class="x"
						type="button"
						onclick={stackedEdit ? closeStackedArt : closeCell}
						title="Close">×</button
					>
				</div>

				<div class="field">
					<span class="label">Type</span>
					<div class="seg">
						{#each SYMBOL_CELL_TYPES as kind (kind)}
							{@const noClips = kind === 'flipbook' && clips.length === 0}
							<button
								type="button"
								class:active={draft.type === kind}
								disabled={noClips}
								title={noClips ? 'This project has no Flipbook clips yet' : ''}
								onclick={() => setDraftType(kind)}>{SYMBOL_CELL_TYPE_LABELS[kind]}</button
							>
						{/each}
					</div>
					{#if clips.length === 0}
						<p class="hint">
							No Flipbook clips in this project yet — author one in
							<a href="/flipbook">Invisible Flipbook</a>, then it appears here.
						</p>
					{/if}
				</div>

				{#if draft.type === 'sprite'}
					<div class="field">
						<span class="label">Frame</span>
						<!-- `scoped`: store `<manifest>::<region>` so a region name packed by several
						     atlases stays unambiguous. A bare name would collapse every symbol that reused
						     it (e.g. `frame_0000`) onto one shared texture in the game's flat cache. -->
						<RegionPicker
							scoped
							sheets={pickSheets}
							value={draft.assetKey}
							onSelect={(region) => {
								if (draft) draft.assetKey = region;
							}}
						/>
					</div>
				{:else if draft.type === 'flipbook'}
					<div class="field">
						<span class="label">Clip</span>
						<select
							value={draft.clipId ?? ''}
							onchange={(e) => setDraftClip(e.currentTarget.value)}
						>
							<option value="">Pick a clip…</option>
							{#each clips as c (c.id)}
								<option value={c.id}>{clipLabel(c.id)}</option>
							{/each}
						</select>
					</div>
					{#if draft.clipId}
						{@const frame = clipFirstFrame(draft.clipId)}
						<div class="field">
							<span class="label">Preview</span>
							<div class="panel-preview">
								<!-- First frame only — a still is fine and preferable here. The panel's SPINE
								     preview is live because a spine cell's binding is (bundle, animation) and you
								     cannot tell those apart without playing them; a clip's identity is its name +
								     frame count, both shown above. /flipbook owns scrub playback. -->
								{#if frame}
									<SymbolSpritePreview {frame} index={spriteIndex} size={120} />
								{:else}
									<span class="chip">no frames</span>
								{/if}
							</div>
						</div>
						<p class="hint">
							Sheet: <code>{draft.assetKey || '—'}</code> — the clip's primary sheet, stored as this
							cell's asset key.
						</p>
					{/if}
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
					{#if !stackedEdit && focus && focusCell?.overridden}
						<button
							type="button"
							class="ghost"
							onclick={() => resetCell(focus!.symbol, focus!.state)}>Reset to default</button
						>
					{/if}
					<button
						type="button"
						class="apply"
						disabled={!draftBindable}
						onclick={stackedEdit ? applyStackedArt : applyDraft}
					>
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
	/* Warns that a symbol's spine binding has no animation ⇒ it renders blank in-game. */
	.anim-warn {
		margin: 0 0 12px;
		padding: 10px 14px;
		border: 1px solid #6b4b1a;
		background: #2a1e0d;
		color: #e0b877;
		border-radius: 6px;
		font-size: 13px;
		line-height: 1.4;
	}
	.anim-warn ul {
		margin: 6px 0 0;
		padding-left: 18px;
	}
	.anim-warn code {
		color: #f0d9a8;
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
		width: 148px;
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
	.sym-id {
		display: block;
		margin-bottom: 4px;
	}
	/* A symbol the project never deals: present because the template baked it in, kept because the
	   server union is deliberately additive. Muted rather than hidden — the row stays fully usable. */
	.sym-unused {
		display: inline-block;
		margin-bottom: 4px;
		padding: 1px 6px;
		font-size: 10px;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #b08a5a;
		background: #2a2118;
		border: 1px solid #4a3a26;
		border-radius: 999px;
		cursor: help;
	}
	.unused-row .sym-id {
		opacity: 0.6;
	}
	.sym-name {
		display: block;
		width: 100%;
		margin-top: 3px;
		padding: 4px 6px;
		border-radius: 5px;
		border: 1px solid #24242e;
		background: #0e0e13;
		color: #e8e8ee;
		font-size: 11px;
		font-weight: 500;
		text-align: right;
	}
	.sym-name.plural {
		color: #b9b9c4;
	}
	.sym-name::placeholder {
		color: #4d4d5a;
		font-style: italic;
	}
	.sym-name:focus {
		outline: none;
		border-color: #7ee0c0;
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
	/* A flipbook cell = the clip's first frame with the clip name captioned over its foot, so
	   the grid reads "which clip is bound" at a glance without a per-cell player. */
	.flipbook-cell {
		position: relative;
		display: grid;
		place-items: center;
	}
	.chip.flip {
		position: absolute;
		inset: auto 0 0 0;
		width: auto;
		height: auto;
		flex-direction: row;
		border-style: solid;
		border-color: #2a5a46;
		background: #0f2018e6;
		color: #9fd8c0;
		padding: 1px 4px;
		border-radius: 0 0 6px 6px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: clamp(8px, calc(var(--cell, 56px) * 0.1), 12px);
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
	.seg button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	.hint {
		margin: 6px 0 0;
		font-size: 11px;
		line-height: 1.4;
		color: #7a7a88;
	}
	.hint code {
		color: #b9b9c4;
	}
	.hint a {
		color: #8fb0ff;
	}
	select,
	input[type='text'] {
		width: 100%;
		padding: 6px 8px;
		background: #16161c;
		border: 1px solid #2a2a33;
		border-radius: 5px;
		color: #d8d8e0;
		font-size: 12px;
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
	.hl-swatch {
		display: inline-block;
		width: 11px;
		height: 11px;
		border-radius: 3px;
		border: 1px solid #4a4a58;
		vertical-align: middle;
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

	.bookvfx {
		margin-bottom: 16px;
		padding: 14px 16px;
		background: #101018;
		border: 1px solid #24242e;
		border-radius: 10px;
	}
	.bookvfx .badge {
		font-size: 9px;
		color: #9fb4ff;
		background: #1c2240;
		border-radius: 3px;
		padding: 2px 6px;
		align-self: center;
	}
	.bv-slots {
		display: flex;
		gap: 16px;
		margin-top: 14px;
		flex-wrap: wrap;
	}
	.bv-slot {
		flex: 1 1 300px;
		min-width: 280px;
		padding: 12px 14px;
		background: #0d0d14;
		border: 1px solid #1d1d26;
		border-radius: 8px;
	}
	.bv-slot.editing {
		border-color: #4d6bd8;
	}
	.bv-slot-head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.bv-slot-title h3 {
		margin: 0;
		font-size: 13px;
		color: #e0e0e8;
	}
	.bv-sub {
		margin: 2px 0 0;
		font-size: 11px;
		color: #8a8a96;
	}
	.bv-current {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-top: 10px;
		flex-wrap: wrap;
	}
	/* At-a-glance thumbnail of the SET layer, shown without opening the editor. */
	.bv-thumb {
		display: grid;
		place-items: center;
		width: 72px;
		height: 72px;
		flex: none;
		padding: 4px;
		background: #0b0b10;
		border: 1px solid #1d1d26;
		border-radius: 6px;
		overflow: hidden;
	}
	.bv-meta {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.bv-editor {
		display: flex;
		flex-direction: column;
		gap: 10px;
		margin-top: 12px;
		padding-top: 12px;
		border-top: 1px solid #1d1d26;
	}
	.bv-fit {
		display: flex;
		gap: 12px;
		flex-wrap: wrap;
	}
	.bv-pair {
		display: flex;
		gap: 6px;
	}
	.bv-pair input {
		width: 72px;
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
	/* ── Stacked-pictures config block ── */
	.stacked-pick {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
	}
	.stacked-chip {
		padding: 6px 12px;
		font-size: 12px;
		font-weight: 600;
		color: #c7c7d2;
		background: #16161c;
		border: 1px solid #2a2a33;
		border-radius: 999px;
		cursor: pointer;
	}
	.stacked-chip:hover {
		border-color: #3a3a46;
	}
	.stacked-chip.on {
		color: #0b0b0f;
		background: #7fb2ff;
		border-color: #7fb2ff;
	}
	/* Same provenance signal on the stacked-picture picker, which reads the same symbol list. */
	.stacked-chip.unused:not(.on) {
		color: #7a7a86;
		border-style: dashed;
	}
	.stacked-row {
		display: flex;
		gap: 16px;
		align-items: flex-start;
		padding: 12px;
		background: #121218;
		border: 1px solid #24242e;
		border-radius: 8px;
	}
	.stacked-art-preview {
		flex: 0 0 auto;
		width: 96px;
		height: 96px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: #0b0b0f;
		border: 1px solid #24242e;
		border-radius: 6px;
		overflow: hidden;
	}
	.stacked-controls {
		display: flex;
		flex-direction: column;
		gap: 8px;
		min-width: 0;
	}
	.stacked-controls h3 {
		margin: 0;
	}
	.stacked-controls .field {
		max-width: 180px;
	}
	.stacked-art-actions {
		display: flex;
		gap: 8px;
	}
	.stacked-art-actions .apply.editing {
		outline: 2px solid #7fb2ff;
	}
	.hint.mono {
		font-family: ui-monospace, monospace;
		word-break: break-all;
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
	.wl-fields .field.wl-span {
		flex: 1 1 100%;
		min-width: 0;
		max-width: none;
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
	/* Overlay size: two compact labelled number inputs side by side. */
	.ant-size {
		display: flex;
		gap: 12px;
	}
	.ant-size label {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: var(--muted, #8a8f98);
	}
	.ant-size input {
		width: 90px;
	}

	/* Reel-anticipation tiers: one side-by-side column per configured big-win tier (auto-fit). */
	.ant-tiers {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 16px;
		margin-top: 14px;
	}
	.ant-tier {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 14px;
		background: #16161c;
		border: 1px solid #2a2a33;
		border-radius: 8px;
	}
	.ant-tier h3 {
		margin: 0 0 2px;
		font-size: 12px;
		font-weight: 700;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9a9aa6;
	}
	.ant-tier input[type='color'] {
		width: 100%;
		height: 30px;
		padding: 2px;
		background: #1d1d24;
		border: 1px solid #2a2a33;
		border-radius: 5px;
		cursor: pointer;
	}
	.ant-tier input[type='range'] {
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
