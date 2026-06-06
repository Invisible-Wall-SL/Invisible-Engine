<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import Emblem from '$lib/Emblem.svelte';
	import {
		findUnfilledRequiredSlots,
		getReferenceLayout,
		hudScenes,
		isHudScene,
		listReferenceLayouts,
		mountAnchor,
		seedScenesFromTemplate,
		STANDARD_MAIN_SIZES_MAP,
	} from 'engine-layout';
	import type {
		GameTemplate,
		LayoutNode,
		LayoutType,
		Scene,
		SlotKind,
		TemplateSlot,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import EditorCanvas from './EditorCanvas.svelte';
	import EditorOutline from './EditorOutline.svelte';
	import EditorProperties from './EditorProperties.svelte';
	import EditorTemplatePanel from './EditorTemplatePanel.svelte';
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
	/** Editor-only: scene ids hidden from the composite canvas (the eye toggles in
	 * the Screens list). NOT persisted — purely an authoring view. The active scene
	 * always renders; others render dimmed unless hidden here. */
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
	/** Built-in placed layouts the picker offers ("Lines — base game", …). */
	const referenceLayouts = listReferenceLayouts();
	/** Hoisted so the properties panel can read the active selection.
	 * `<EditorCanvas>` binds this via `bind:selectedId`. */
	let selectedId = $state<string | null>(null);
	/** Hoisted active layoutType. `'desktop'` is the base; anything else routes edits
	 * into `node.overrides[layoutType]` (override mode). */
	let currentLayoutType = $state<LayoutType>('desktop');
	/** Left sidebar tab: which panel is shown. */
	let leftTab = $state<'library' | 'outline' | 'template'>('library');
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
	/** Template slots of the active scene — offered as the Properties slot dropdown. */
	const activeSceneSlots = $derived(
		activeTemplate?.scenes.find((s) => s.id === activeScene?.id)?.slots ?? [],
	);
	/** HUD scenes author into the fixed standard box (and canvas-space uses it as
	 * the reference window); gameplay scenes use the project's own `mainSizesMap`. */
	const frameSize = $derived(
		activeScene?.space === 'standard' || activeScene?.space === 'canvas'
			? STANDARD_MAIN_SIZES_MAP[currentLayoutType]
			: mainSizesMap[currentLayoutType],
	);
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
		selectedId = null;
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
		selectedId = node.id;
	}

	/** Switch the canvas to a screen (scene) by index — the screen list picker. */
	function selectScene(idx: number): void {
		if (idx < 0 || idx >= scenes.length) return;
		activeSceneIdx = idx;
		selectedId = null;
	}

	/** Set the active scene's coordinate space. `'game'` is the default → omit it
	 * (keeps the doc clean); switching away from `'standard'` drops its `align`. */
	function setSceneSpace(value: string): void {
		const sc = scenes[activeSceneIdx];
		if (!sc) return;
		if (value === 'game') delete sc.space;
		else sc.space = value as NonNullable<Scene['space']>;
		if (sc.space !== 'standard') delete sc.align;
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
		selectedId = null;
		void loadTemplateFor(gameType);
		// A same-type load stays a non-destructive preview (the first edit commits it
		// via autosave). A cross-type load is held back from autosave entirely — only
		// an explicit Save persists it — so it can't clobber the project's saved doc.
		crossTypeLoaded = crossType;
		crossTypeFrom = crossType ? gameType : '';
		loadedPreview = !crossType;
	}

	/** Load the game scene chosen in the scene-bar picker. `ref:<type>` loads a
	 * built-in PLACED layout (sprites positioned + layered); `skel:<type>` loads
	 * that type's blank scenes from its template. */
	async function loadChosen(): Promise<void> {
		const choice = loadChoice;
		if (!choice) return;
		const [kind, gameType] = choice.split(':');
		if (kind === 'ref') {
			const doc = getReferenceLayout(gameType);
			if (doc) adoptScenes(doc, gameType);
		} else if (kind === 'skel') {
			// Resolve the template first (R2 override or built-in) so the skeleton
			// matches the saved template, then seed blank scenes from it.
			const res = await fetch(`/api/editor/template?gameType=${encodeURIComponent(gameType)}`);
			const template = res.ok ? ((await res.json()) as GameTemplate) : undefined;
			adoptScenes({ scenes: seedScenesFromTemplate(template), gameType }, gameType);
		}
		loadChoice = '';
	}

	/** Discard a cross-type loaded layout and reload the project's saved doc. */
	function discardCrossType(): void {
		if (!confirm("Discard the loaded layout and restore your project's saved layout?")) return;
		location.reload();
	}

	/** Whether the HUD scenes (logo/name corners + bottom bar) are present. */
	const hasHud = $derived(scenes.some((s) => s.id === 'hudBar' || s.id === 'hudCorners'));

	/** Add the game HUD as editor scenes (non-destructive — keeps other scenes), or
	 * refresh existing HUD scenes to the latest engine version (e.g. to pick up the
	 * preview chips / positions). Lets a project opt its `<UI>` HUD into editor
	 * control without the clobber-prone "load a game scene" path. */
	function addHudLayer(): void {
		const fresh = hudScenes();
		if (hasHud) {
			if (
				!confirm(
					'Refresh the HUD layer to the latest version? Any position edits you made to the HUD elements will be reset to defaults.',
				)
			) {
				return;
			}
			scenes = [...scenes.filter((s) => s.id !== 'hudBar' && s.id !== 'hudCorners'), ...fresh];
		} else {
			scenes = [...scenes, ...fresh];
		}
		activeSceneIdx = scenes.length - fresh.length; // focus the first HUD screen
		selectedId = null;
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
	let lastError = $state('');
	let lastSavedAt = $state(data.doc.updatedAt || '');
	/** Bumped every `RELATIVE_TICK_MS` so the "Saved Ns ago" label refreshes. */
	let nowTick = $state(Date.now());

	function markDirty(): void {
		dirty = true;
		loadedPreview = false; // a real edit commits the (possibly loaded) layout
		lastError = '';
	}

	function buildDocPayload() {
		return {
			version: data.doc.version,
			projectKey: data.projectKey,
			gameType: authoringGameType,
			mainSizesMap,
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
			};
			if (out.error) {
				lastError = out.error;
			} else {
				lastSavedAt = out.updatedAt ?? new Date().toISOString();
				lastError = '';
				dirty = false;
				loadedPreview = false;
				crossTypeLoaded = false;
				crossTypeFrom = '';
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
		// A cross-type load must never autosave — only an explicit Save persists it.
		if (crossTypeLoaded) return;
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

	// ---------- template authoring (§7.5) ----------

	/** Known game types (mirrors game-spec's GameTypeSchema) — what a saved
	 * template is keyed by in R2. Lets you author e.g. a `bookOf` template even
	 * though a project's resolved game type defaults to `lines` for now. */
	const GAME_TYPES = ['lines', 'ways', 'cluster', 'scatter', 'bookOf'] as const;
	/** The game type the authored template is saved under (§7.5). */
	let authoringGameType = $state<string>(data.template?.gameType ?? 'lines');

	/** Load (and display) the chosen game type's template — R2 override or
	 * built-in fallback, via the GET endpoint. 404 = no template for that type,
	 * so we clear the slot panel. Reseeds slotMeta so `required` flags show. */
	async function loadTemplateFor(gameType: string): Promise<void> {
		try {
			const res = await fetch(`/api/editor/template?gameType=${encodeURIComponent(gameType)}`);
			activeTemplate = res.ok ? ((await res.json()) as GameTemplate) : undefined;
		} catch {
			activeTemplate = undefined;
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

	let templateBusy = $state(false);
	/** Last template save outcome shown via the save-pill styling near the action. */
	let templateStatus = $state<{ kind: 'ok' | 'error'; message: string } | null>(null);

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

	async function saveTemplate(): Promise<void> {
		if (templateBusy) return;
		templateBusy = true;
		templateStatus = null;
		try {
			const res = await fetch('/api/editor/template', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(buildTemplate()),
			});
			if (res.ok) {
				templateStatus = { kind: 'ok', message: 'Template saved' };
			} else {
				// API routes return `{ message }` for thrown `error(...)`; fall back to text.
				let message = 'Template save failed';
				try {
					const body = (await res.json()) as { message?: string };
					if (body?.message) message = body.message;
				} catch {
					/* non-JSON error body */
				}
				templateStatus = { kind: 'error', message };
			}
		} catch (e) {
			templateStatus = {
				kind: 'error',
				message: e instanceof Error ? e.message : 'Template save failed',
			};
		} finally {
			templateBusy = false;
		}
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
			{:else if dirty}
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
			<span class="dot-sep">·</span>
			<button
				type="button"
				class="save-btn"
				class:active-mode={templateMode}
				aria-pressed={templateMode}
				title="Template editor — a separate, advanced mode for defining a game type's slot schema. Not needed to lay out scenes."
				onclick={() => {
					templateMode = !templateMode;
					leftTab = templateMode ? 'template' : 'library';
				}}
			>
				{templateMode ? '✕ Close template editor' : 'Template editor'}
			</button>
			{#if templateMode}
				<label class="gametype" title="Game type the template is saved under">
					<span>type</span>
					<select bind:value={authoringGameType} onchange={() => void onGameTypeChange()}>
						{#each GAME_TYPES as gt (gt)}
							<option value={gt}>{gt}</option>
						{/each}
					</select>
				</label>
				{#if templateBusy}
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
		</div>
	</header>

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
								selectedId = w.nodeId;
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

	<div class="layout">
		<aside class="left">
			<div class="scene-bar">
				<div class="load-row">
					<select class="load-select" bind:value={loadChoice} aria-label="Load a game scene">
						<option value="">＋ Load a game scene…</option>
						{#if referenceLayouts.length > 0}
							<optgroup label="Placed game layouts">
								{#each referenceLayouts as r (r.gameType)}
									<option value={`ref:${r.gameType}`}>{r.name}</option>
								{/each}
							</optgroup>
						{/if}
						<optgroup label="Blank scenes (from template)">
							{#each GAME_TYPES as gt (gt)}
								<option value={`skel:${gt}`}>{gt} — blank scenes</option>
							{/each}
						</optgroup>
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
				<h3 class="screens-h">Screens <span class="count">{sceneCount}</span></h3>
				{#snippet sceneRow(s: (typeof scenes)[number], i: number)}
					{@const hidden = hiddenScenes.has(s.id)}
					<li class="screen-li">
						<button
							type="button"
							class="screen"
							class:active={i === activeSceneIdx}
							class:dimmed={hidden}
							onclick={() => selectScene(i)}
						>
							<span class="screen-name">{s.name || s.id}</span>
							<span class="screen-count" title="nodes in this screen">{s.nodes.length}</span>
						</button>
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
					</li>
				{/snippet}
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

				{#if activeScene}
					<div class="scene-space">
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
						{#if activeScene.space === 'standard'}
							<div class="space-aligns">
								<label class="space-field">
									<span>v-align</span>
									<select
										value={activeScene.align?.vertical ?? ''}
										onchange={(e) => setSceneAlign('vertical', e.currentTarget.value)}
									>
										<option value="">centre</option>
										<option value="center">center</option>
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
										<option value="center">center</option>
										<option value="left">left</option>
										<option value="right">right</option>
									</select>
								</label>
							</div>
						{/if}
					</div>
				{/if}

				<button
					class="add-hud-btn"
					type="button"
					title={hasHud
						? 'Refresh the HUD scenes to the latest version (resets HUD positions)'
						: 'Add the game HUD (logo/name + bottom bar) as editable scenes, without replacing anything'}
					onclick={addHudLayer}
				>
					{hasHud ? '↻ Refresh HUD layer' : '＋ Add HUD layer'}
				</button>
			</div>

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
				{#if templateMode}
					<button
						role="tab"
						aria-selected={leftTab === 'template'}
						class="tab"
						class:active={leftTab === 'template'}
						onclick={() => (leftTab = 'template')}
					>
						Template
					</button>
				{/if}
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
						<h3>
							Spines <span class="count">{spineCount}</span>
							<button
								type="button"
								class="upload-btn"
								disabled={spineUploadBusy}
								title="Pick a folder of Spine bundles to sync to this project (R2)"
								onclick={() => spineFileInput?.click()}
							>
								{spineUploadBusy ? 'Uploading…' : 'Upload spines'}
							</button>
						</h3>
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
				{:else if leftTab === 'template'}
					<EditorTemplatePanel
						template={activeTemplate}
						{scenes}
						activeSceneId={activeScene?.id}
						onPickScene={goToTemplateScene}
						{onFillSlot}
					/>
				{:else}
					<EditorOutline
						scene={activeScene}
						template={activeTemplate}
						{selectedId}
						onSelect={(id) => (selectedId = id)}
						{onFillSlot}
						onAddAnchor={onAddMountAnchor}
					/>
				{/if}
			</div>
		</aside>

		<main class="canvas-area">
			<EditorCanvas
				scene={activeScene}
				{scenes}
				{mainSizesMap}
				frameWidth={frameSize.width}
				frameHeight={frameSize.height}
				layoutType={currentLayoutType}
				assets={data.assets}
				{onSpawn}
				bind:selectedId
				onDirty={markDirty}
				onDelete={onDeleteNode}
				{fillRequest}
				hiddenSceneIds={hiddenScenes}
			/>
		</main>

		<aside class="properties">
			<h2>Properties</h2>
			<EditorProperties
				node={selectedNode}
				layoutType={currentLayoutType}
				onDirty={markDirty}
				{templateMode}
				{slotMeta}
				sceneSlots={activeSceneSlots}
				onSlotRequiredChange={(slotId, required) => {
					slotMeta = { ...slotMeta, [slotId]: { required } };
				}}
			/>
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
		position: relative;
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
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid #1c1c24;
		display: flex;
		flex-direction: column;
		gap: 6px;
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
	.space-field select {
		background: #16131c;
		color: #c8a3ff;
		border: 1px solid #2a2433;
		border-radius: 6px;
		padding: 5px 7px;
		font-size: 12px;
		font-family: inherit;
	}
	.screens-h {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #aaa;
		margin: 0 0 6px;
		display: flex;
		justify-content: space-between;
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
