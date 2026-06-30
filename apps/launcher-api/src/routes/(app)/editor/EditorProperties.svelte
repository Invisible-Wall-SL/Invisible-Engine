<script lang="ts">
	import {
		backgroundCoverScale,
		backgroundFit,
		BUTTON_STATE_PARAMS,
		defaultHudText,
		ENGINE_ACTION_CATALOG,
		ENGINE_BINDING_PARAMS,
		ENGINE_PARAM_CATALOG,
		ENGINE_SIGNAL_CATALOG,
		fontParamKeysOf,
		VISIBILITY_SOURCE_LABELS,
		getEditableParams,
		isHudButtonBind,
		resolveTransform,
		TAP_TO_CONTINUE_PARAMS,
		type ComponentDef,
		type ComponentParam,
		type ComponentSignal,
		type ContainerNode,
		type AnticipationProfile,
		type ButtonStateAnimations,
		type EditableParam,
		type EngineParamEntry,
		type LayoutNode,
		type LayoutType,
		type NodeOverride,
		type ReelGridNode,
		type ReelSpinProfile,
		type Scene,
		type SpineCue,
		type SpineNode,
		type SpineRestOverride,
		type TextStyle,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import { fetchFontCatalog, type EditorFont } from './fonts.client';
	import RegionPicker from './RegionPicker.svelte';
	import { isParamGroupOpen, setParamGroupOpen } from './groupCollapse.client';
	import type { SpineMeta } from './spineRuntime.client';

	/** Minimal structural view of a project spine bundle (mirrors the server-only
	 * `SpineAsset` — its module can't be imported client-side). `key` is the R2 prefix
	 * the spine `meta` map is keyed by; `name` is the bundle's short name (the value a
	 * `spine`-kind param stores). */
	interface SpineOption {
		name: string;
		key: string;
		shared?: boolean;
	}

	interface Props {
		node: LayoutNode | null;
		layoutType: LayoutType;
		/** Called after any user-driven mutation to the selected node. */
		onDirty?: () => void;
		/** The active scene's `space` (`game` | `standard` | `canvas` | `background`). Only
		 * `canvas` scenes surface the per-node `screenAnchor` control (it's the window-edge
		 * anchor the runtime honours for canvas space; ignored elsewhere). */
		sceneSpace?: Scene['space'];
		/** Template-authoring mode (§7.5): reveal the per-node slot tagging UI. */
		templateMode?: boolean;
		/** Slot metadata not stored on the node (keyed by `slotId`). */
		slotMeta?: Record<string, { required: boolean }>;
		/** Lift a `required` change back to the parent's `slotMeta` map. */
		onSlotRequiredChange?: (slotId: string, required: boolean) => void;
		/** The active scene's template slots — offered as the slot dropdown. */
		sceneSlots?: { slotId: string; name: string; kind: string }[];
		/** Project display name — the HUD game-name default (shown as the placeholder). */
		projectGameName?: string | null;
		/** The selected node is a full-bleed background COVER node (§10.3 step 4) — a
		 * `background`-space sprite/spine, or a `cover`-placement bind anchor. Reveals
		 * the "Background" section (cover scale + fit). Computed by the page (it knows the
		 * active scene's space + can resolve the anchor's preview art). */
		isBackgroundCover?: boolean;
		/** Component-authoring mode (§8.4): reveal the component-level params/signals
		 * declaration UI (component metadata, not per-node). */
		componentMode?: boolean;
		/** The draft component's currently-declared params (component mode). */
		componentParams?: ComponentParam[];
		/** The draft component's currently-declared signals (component mode). */
		componentSignals?: ComponentSignal[];
		/** When the selected node is a `componentInstance`, its resolved def — drives
		 * the author-set param override list (scene mode). */
		instanceComponent?: ComponentDef | null;
		/** Atlas/sheet manifests (`{ key, name }`) whose frames an `image`-kind param
		 * can pick from — feeds the per-instance region picker. */
		pickSheets?: { key: string; name: string }[];
		/** Per-`assetKey` animation + skin + slot name lists for every loaded spine bundle
		 * (from the canvas). A selected `kind:'spine'` node — or a `spine`/`spineAnimation`/
		 * `spineSlot` component param — looks up its key here to offer dropdowns; an unknown
		 * key falls back to free-text. */
		spineMeta?: Map<string, SpineMeta>;
		/** The project's spine bundles (`{ name, key, shared }`) — feeds the `spine`-kind
		 * param dropdown and resolves a selected bundle name to the `assetKey` the
		 * `spineMeta` map is keyed by (for the animation / slot dropdowns). */
		spines?: SpineOption[];
		/** "Edit as component": open the selected container's sub-tree as a component. */
		onEditAsComponent?: (container: ContainerNode) => void;
		/** "Convert to parametric grid": replace the selected reelGrid mount anchor
		 * (a container) with a parametric `reelGrid` node (scene mode). */
		onConvertToReelGrid?: (id: string) => void;
		/** "Convert to parametric button": replace the selected HUD button `bind`
		 * container with a parametric `componentInstance(button)` node (scene mode). */
		onConvertToParametricButton?: (id: string) => void;
		/** Toggle an engine-catalog param on the draft component (component mode). */
		onToggleParam?: (key: string, kind: ComponentParam['kind']) => void;
		/** Toggle a button STATE-IMAGE param (the "Show button params" picker) on the
		 * draft component — adds/removes the full `BUTTON_STATE_PARAMS` entry by key. */
		onToggleStateParam?: (key: string) => void;
		/** Declare a custom (author-defined) param on the draft component (component mode). */
		onAddParam?: (key: string, kind: ComponentParam['kind']) => void;
		/** Remove a custom (author-defined) param from the draft component (component mode). */
		onRemoveParam?: (key: string) => void;
		/** Set a custom param's DEFAULT value (component mode) — the value the component's
		 * preview + every placed instance use until overridden. `undefined` clears it. */
		onSetParamDefault?: (key: string, value: unknown) => void;
		/** Set a custom `string`-kind param's closed enum (component mode) — a placed
		 * instance then renders it as a dropdown of these options (the `paramField`
		 * options branch). An empty list clears it (free-text again). */
		onSetParamOptions?: (key: string, options: string[]) => void;
		/** Param keys that drive a font (bound to a text node's `style.fontFamily`) in the
		 * open component — the "Your params" default editor renders these as a font dropdown.
		 * Component mode only (the parent scans the draft tree). */
		fontParamKeys?: Set<string>;
		/** "Expose as params" for the selected text node: auto-create + bind grouped
		 * text/font/size/colour params so the text is per-instance editable (component mode). */
		onExposeTextParams?: (node: LayoutNode) => void;
		/** "Remove exposed parameters": un-expose the selected text node — drop its
		 * author-param bindings + the params they created, restoring the static values. */
		onUnexposeTextParams?: (node: LayoutNode) => void;
		/** Toggle an engine-catalog signal on the draft component (component mode). */
		onToggleSignal?: (key: string) => void;
		/** Set / clear an author param override on the selected instance (scene mode). */
		onSetInstanceParam?: (key: string, value: unknown) => void;
		/** Set / clear a per-instance button-state spine-animation override for a spine
		 * node (by id) of the selected instance's def (scene mode). Empty `animation`
		 * clears that state's override (it inherits the def). */
		onSetInstanceStateAnim?: (nodeId: string, state: ButtonAnimState, animation: string) => void;
		/** Toggle loop on a per-instance state-animation override (no-op until the state
		 * has an override animation). */
		onSetInstanceStateAnimLoop?: (nodeId: string, state: ButtonAnimState, loop: boolean) => void;
		/** Patch a spine node's per-instance RESTING override (default animation / loop /
		 * skin) for the selected instance (scene mode). Only the fields present in `patch`
		 * change; a field set to `undefined`/`''` clears that override (inherits the def). */
		onSetInstanceSpineRest?: (nodeId: string, patch: Partial<SpineRestOverride>) => void;
		/** Rebind which engine signal drives a spine node's cue for THIS placement
		 * (scene mode). `origSignal` = the cue's def signal; `signal` = the replacement
		 * engine-signal key, or `''`/`undefined` to clear the override (inherit the def). */
		onSetInstanceCueSignal?: (nodeId: string, origSignal: string, signal: string) => void;
		/** "Edit in Component Editor": open the selected instance's def (`componentId`) in
		 * the standalone Component Editor (new tab). Scene mode, componentInstance only. */
		onOpenComponentEditor?: (componentId: string) => void;
		/** Re-pin the selected instance's `componentVersion` to the resolved def's current
		 * version (§8.9 explicit, per-instance "update to latest"). Shown only when the
		 * instance is outdated (its pin < the def's version). The page reconciles params
		 * (keeps still-valid overrides, drops ones the new version removed) + persists. */
		onUpdateInstanceToLatest?: () => void;
	}
	let {
		node,
		layoutType,
		onDirty,
		sceneSpace,
		templateMode = false,
		slotMeta = {},
		onSlotRequiredChange,
		sceneSlots = [],
		projectGameName = null,
		isBackgroundCover = false,
		componentMode = false,
		componentParams = [],
		componentSignals = [],
		instanceComponent = null,
		pickSheets = [],
		spineMeta = new Map(),
		spines = [],
		onEditAsComponent,
		onConvertToReelGrid,
		onConvertToParametricButton,
		onToggleParam,
		onToggleStateParam,
		onAddParam,
		onRemoveParam,
		onSetParamDefault,
		onSetParamOptions,
		fontParamKeys = new Set(),
		onExposeTextParams,
		onUnexposeTextParams,
		onToggleSignal,
		onSetInstanceParam,
		onSetInstanceStateAnim,
		onSetInstanceStateAnimLoop,
		onSetInstanceSpineRest,
		onSetInstanceCueSignal,
		onOpenComponentEditor,
		onUpdateInstanceToLatest,
	}: Props = $props();

	/** Author-settable (non-engineProvided) params an instance may override. */
	const authorParams = $derived((instanceComponent?.params ?? []).filter((p) => !p.engineProvided));

	/** True when the SELECTED INSTANCE's def is an interactive button (declares an
	 * `action` param) — only then do its spine nodes' button-state animations apply,
	 * so only then is the per-instance state-animation override panel meaningful. */
	const instanceInteractive = $derived(
		(instanceComponent?.params ?? []).some((p) => p.key === 'action'),
	);
	/** Spine nodes inside the selected instance's def root — each can carry a
	 * "Plays on button state" map the placement may override per state. */
	const instanceSpineNodes = $derived.by<SpineNode[]>(() => {
		if (!instanceComponent) return [];
		const out: SpineNode[] = [];
		const walk = (n: LayoutNode): void => {
			if (n.kind === 'spine') out.push(n);
			else if (n.kind === 'container') for (const child of n.children) walk(child);
		};
		walk(instanceComponent.root);
		return out;
	});
	/** This instance's override animation for (spine node, state), or undefined. */
	function instanceStateAnimOf(nodeId: string, state: ButtonAnimState) {
		if (node?.kind !== 'componentInstance') return undefined;
		return node.stateAnimationOverrides?.[nodeId]?.[state];
	}
	/** This instance's RESTING override (default animation / loop / skin) for a spine
	 * node, or undefined when the placement inherits the def. */
	function instanceSpineRestOf(nodeId: string): SpineRestOverride | undefined {
		if (node?.kind !== 'componentInstance') return undefined;
		return node.spineRestOverrides?.[nodeId];
	}
	/** This instance's signal-rebind for a spine node's cue (by the cue's def signal),
	 * or undefined when the placement inherits the def signal. */
	function instanceCueSignalOf(nodeId: string, origSignal: string): string | undefined {
		if (node?.kind !== 'componentInstance') return undefined;
		return node.cueSignalOverrides?.[nodeId]?.[origSignal];
	}

	/** True when the selected instance's resolved def is an OVERLAY — only overlays
	 * surface the shared Tap-to-continue toggle (Invisible Flow §6.2). Scene mode only;
	 * the params live on the instance, not the def, so any overlay instance gets them. */
	const isOverlayInstance = $derived(
		!componentMode &&
			node?.kind === 'componentInstance' &&
			instanceComponent?.category === 'overlay',
	);

	/** Universal engine bindings (flow-driven-game §6, requirement 2): the shared
	 * per-instance bindings any `componentInstance` can carry WITHOUT its def declaring
	 * the param — `action` (clickable) + `visibleSource` (lifecycle-gated). Surfaced only
	 * where the def LACKS the param (a `button` def already declares `action`, a
	 * `freeSpinCounter` already declares `visibleSource`) — suppressing it there avoids
	 * double-surfacing, so the def's own param stays the single source. Scene mode only;
	 * the params live on the instance, not the def, so any instance gets them. */
	const engineBindingParams = $derived.by<ComponentParam[]>(() => {
		if (componentMode || node?.kind !== 'componentInstance') return [];
		const declared = new Set((instanceComponent?.params ?? []).map((p) => p.key));
		return ENGINE_BINDING_PARAMS.filter((p) => !declared.has(p.key));
	});

	/** Dropdown options for the universal `visibleSource` binding: the registered
	 * visibility-feed catalog, plus the current value if it's a custom key not in the
	 * catalog (so a hand-set source isn't dropped). */
	function visibleSourceOptions(current: unknown): string[] {
		const opts = ENGINE_BINDING_PARAMS.find((p) => p.key === 'visibleSource')?.options ?? [];
		const v = typeof current === 'string' ? current : '';
		return v && !opts.includes(v) ? [...opts, v] : opts;
	}

	/** The version the selected instance currently renders against (its pin, falling back
	 * to the resolved def's version when the node carries no explicit pin — an un-pinned
	 * instance always tracks the def, so it is never outdated). */
	const instancePinnedVersion = $derived(
		node?.kind === 'componentInstance'
			? (node.componentVersion ?? instanceComponent?.version)
			: undefined,
	);
	/** True when the selected instance pins a version BELOW the resolved def's current
	 * version (§8.9 outdated flag). Reuses the same version data `resolveComponent`
	 * compares — a pin equal to (or, defensively, above) the def shows no flag, so an
	 * up-to-date instance is byte-identical. Only meaningful in scene mode. */
	const instanceOutdated = $derived(
		!componentMode &&
			node?.kind === 'componentInstance' &&
			instanceComponent != null &&
			node.componentVersion !== undefined &&
			node.componentVersion < instanceComponent.version,
	);

	/** Resolve a spine BUNDLE NAME (what a `spine`-kind param stores, e.g. `fsIntroNumber`)
	 * to the `assetKey` the `spineMeta` map is keyed by. The map's key === `SpineAsset.key`
	 * (the R2 prefix, with a trailing slash), set when the canvas resolves a bundle name →
	 * `assets.spines.find((s) => s.name === name).key` (see `resolveAnchorPreviewArt`); so
	 * the lookup is the same `name` match. Returns `''` when no bundle matches. */
	function resolveSpineAssetKey(bundleName: string | undefined): string {
		if (!bundleName) return '';
		return spines.find((s) => s.name === bundleName)?.key ?? '';
	}

	/** The effective spine bundle a `spineAnimation`/`spineSlot` param reads its options
	 * from: the value of its sibling `spineParam` on the selected instance, falling back to
	 * that sibling param's DEFAULT from the def (so the dropdown populates before the spine
	 * param is explicitly set). */
	function effectiveSpineBundle(p: ComponentParam): string | undefined {
		if (!p.spineParam || !node || node.kind !== 'componentInstance') return undefined;
		const override = node.params?.[p.spineParam];
		if (typeof override === 'string' && override) return override;
		const sib = instanceComponent?.params?.find((q) => q.key === p.spineParam);
		return typeof sib?.default === 'string' ? sib.default : undefined;
	}

	/** Per-`assetKey` spine meta read from the skeleton MANIFEST (`/api/editor/spine/meta`)
	 * — the fallback the spine dropdowns use when the canvas hasn't published LIVE meta for a
	 * bundle. Live meta is only emitted once a bundle renders "ready" on the WebGL layer; a
	 * marker-only preview (or a GL render that never settles) never gets there, which used to
	 * drop the panel to a free-text box even though the animation names are knowable. Live
	 * meta always wins; this only fills the gaps. A `SvelteMap` (not a plain `$state` Map,
	 * whose `.set()` is NOT reactive) so a fetched bundle re-renders the dropdowns. */
	const staticSpineMeta = new SvelteMap<string, SpineMeta>();
	/** Bundles already requested (hit OR miss) so the prefetch fires once per assetKey. */
	const requestedSpineMetaKeys = new Set<string>();

	/** Live meta first, then the manifest fallback — the single resolver every spine dropdown
	 * uses so they all populate from whichever source has the names. */
	function spineMetaFor(key: string | undefined): SpineMeta | undefined {
		if (!key) return undefined;
		return spineMeta.get(key) ?? staticSpineMeta.get(key);
	}

	/** assetKeys the selected node's spine panels need names for: a selected spine node, every
	 * spine inside a selected component instance, and each spine its `spineAnimation`/
	 * `spineSlot` params resolve to. */
	const neededSpineKeys = $derived.by<string[]>(() => {
		const keys = new Set<string>();
		if (node?.kind === 'spine' && node.assetKey) keys.add(node.assetKey);
		for (const sp of instanceSpineNodes) if (sp.assetKey) keys.add(sp.assetKey);
		for (const p of componentParams) {
			if (p.kind === 'spineAnimation' || p.kind === 'spineSlot') {
				const k = resolveSpineAssetKey(effectiveSpineBundle(p));
				if (k) keys.add(k);
			}
		}
		return [...keys];
	});

	/** Prefetch manifest meta for any needed bundle the canvas hasn't already covered.
	 * `requestedSpineMetaKeys` dedupes so a re-render never re-requests, and a key that later
	 * gains live meta is simply skipped (the resolver prefers it anyway). */
	$effect(() => {
		for (const key of neededSpineKeys) {
			// Skip only when LIVE meta already has names (the resolver prefers it) — a bundle
			// that rendered "ready" with an empty animation list still needs the manifest.
			if (spineMeta.get(key)?.animations.length || requestedSpineMetaKeys.has(key)) continue;
			requestedSpineMetaKeys.add(key);
			void (async () => {
				try {
					const res = await fetch(`/api/editor/spine/meta?key=${encodeURIComponent(key)}`);
					if (!res.ok) return;
					const body = (await res.json()) as { found?: boolean } & Partial<SpineMeta>;
					if (!body.found) return;
					staticSpineMeta.set(key, {
						animations: body.animations ?? [],
						skins: body.skins ?? [],
						slots: body.slots ?? [],
					});
				} catch {
					/* offline / transient — a later selection retries via a fresh key set */
				}
			})();
		}
	});

	/** Param keys of the instance's def that drive a FONT — rendered as a font dropdown
	 * (like a text node's font field) instead of a free-text box. Covers both bound
	 * `style.fontFamily` params and the engine's canonical `fontFamily` key (a coded
	 * component's font, stored as a plain string). See `fontParamKeysOf`. */
	const instanceFontParamKeys = $derived(fontParamKeysOf(instanceComponent));

	/** Text-style fields the "Expose text as params" flow binds (text content + the three
	 * style knobs). Used to detect whether the selected text node is already exposed. */
	const TEXT_BIND_FIELDS = ['text', 'style.fontFamily', 'style.fontSize', 'style.fill'] as const;
	/** The AUTHOR params (key + the field that binds them) this text node currently exposes —
	 * i.e. its `paramBindings` pointing at author (not engine-provided) component params. */
	const exposedTextBindings = $derived.by(() => {
		if (!node || node.kind !== 'text' || !node.paramBindings) return [];
		const out: { field: string; key: string }[] = [];
		for (const field of TEXT_BIND_FIELDS) {
			const key = node.paramBindings[field];
			if (!key) continue;
			const p = componentParams.find((cp) => cp.key === key);
			if (p?.author) out.push({ field, key });
		}
		return out;
	});
	/** True when the selected text node is exposed (component mode) — the static value
	 * fields + Expose button collapse into a "using exposed parameters" state. */
	const isTextExposed = $derived(componentMode && exposedTextBindings.length > 0);
	/** Flat (ungrouped) author params — rendered above the grouped sections. */
	const ungroupedAuthorParams = $derived(authorParams.filter((p) => !p.group));
	/** Author params bucketed by their `group` (e.g. a text node's name) — each renders
	 * as a collapsible section so a component with several text objects edits each
	 * independently. Insertion order preserved. */
	const authorParamGroups = $derived.by(() => {
		const map = new Map<string, ComponentParam[]>();
		for (const p of authorParams) {
			if (!p.group) continue;
			const arr = map.get(p.group);
			if (arr) arr.push(p);
			else map.set(p.group, [p]);
		}
		return [...map.entries()];
	});
	/** The open component's value-source binding — the `source` param (a value feed picked
	 * from a closed `options` enum, e.g. the readout / free-spin counter). When present the
	 * component is engine-fed THROUGH it, so the literal engine-param checklist is inert and
	 * we show the binding instead. Matched by the canonical `source` key, NOT by "any param
	 * with options" — a button's `action`/`variant` params also carry options but must NOT
	 * collapse the variables panel (that hid the + Add variable picker on buttons). */
	const sourceParam = $derived(
		componentParams.find((p) => p.key === 'source' && (p.options?.length ?? 0) > 0),
	);
	/** The button STATE-IMAGE param keys — managed solely by the "Show button params"
	 * picker (their own checkbox + inline region picker), so they're kept OUT of the
	 * "Your params" list below even though they carry `author: true`. */
	const STATE_PARAM_KEYS = new Set(BUTTON_STATE_PARAMS.map((p) => p.key));
	/** Params the author added here (flagged `author`) — the only ones shown as
	 * removable, so a component's built-in/coded params can't be deleted by mistake.
	 * State images are excluded (the picker owns them). */
	const customParams = $derived(
		componentParams.filter((p) => p.author === true && !STATE_PARAM_KEYS.has(p.key)),
	);
	let newParamKey = $state('');
	let newParamKind = $state<ComponentParam['kind']>('string');
	function paramHas(key: string): boolean {
		return componentParams.some((p) => p.key === key);
	}
	/** A state-image param's current default frame ref (for its inline region picker). */
	function paramDefaultStr(key: string): string {
		const p = componentParams.find((cp) => cp.key === key);
		return typeof p?.default === 'string' ? p.default : '';
	}
	/** True when any button STATE-IMAGE param is already exposed — the "Show button
	 * params" picker auto-opens so a re-opened button reveals its existing states. */
	const hasButtonStateParams = $derived(BUTTON_STATE_PARAMS.some((sp) => paramHas(sp.key)));
	/** `null` = follow `hasButtonStateParams` (collapsed unless states exist); once the
	 * author clicks the toggle it pins to their explicit choice. */
	let showButtonParamsManual = $state<boolean | null>(null);
	const showButtonParams = $derived(showButtonParamsManual ?? hasButtonStateParams);
	function signalHas(key: string): boolean {
		return componentSignals.some((s) => s.key === key);
	}

	// ---- Variables / signals "in use + add picker" presentation (component mode) ----
	// A compact row for a variable currently declared on the component. `origin`
	// distinguishes an engine-catalog value (removed by untick → `onToggleParam`) from
	// a custom author param (removed by delete → `onRemoveParam`); the underlying
	// `ComponentDef.params` mutations are unchanged — only how we surface them differs.
	interface VarRow {
		key: string;
		label: string;
		kind: ComponentParam['kind'];
		origin: 'engine' | 'yours';
		note?: string;
	}
	/** The engine-catalog entry for a key (label/note/kind), or undefined for a custom param. */
	function engineCatalogEntry(key: string) {
		return ENGINE_PARAM_CATALOG.find((p) => p.key === key);
	}
	/** Variables currently declared on the component, as compact rows — engine-catalog
	 * values (ticked) first, then custom author params. State-image params are excluded
	 * (the "Button images" control owns them). */
	const variableRows = $derived.by<VarRow[]>(() => {
		const rows: VarRow[] = [];
		for (const p of componentParams) {
			if (STATE_PARAM_KEYS.has(p.key)) continue;
			const entry = engineCatalogEntry(p.key);
			if (entry && p.engineProvided) {
				rows.push({
					key: p.key,
					label: entry.label,
					kind: entry.kind,
					origin: 'engine',
					note: entry.note,
				});
			} else if (p.author === true) {
				rows.push({
					key: p.key,
					label: p.label ?? p.key,
					kind: p.kind,
					origin: 'yours',
					note: p.group ? `· ${p.group}` : undefined,
				});
			}
		}
		return rows;
	});
	/** Remove a declared variable — untick an engine value, delete a custom param. */
	function removeVariable(row: VarRow): void {
		if (row.origin === 'engine') onToggleParam?.(row.key, row.kind);
		else onRemoveParam?.(row.key);
	}
	/** Signals currently declared on the component, as compact rows. */
	const signalRows = $derived(
		componentSignals.map((s) => {
			const entry = ENGINE_SIGNAL_CATALOG.find((c) => c.key === s.key);
			return { key: s.key, label: entry?.label ?? s.key, note: entry?.note };
		}),
	);

	// Variable picker (popover) — open state + search filter + the custom-input draft.
	let varPickerOpen = $state(false);
	let varSearch = $state('');
	let varAnchorEl = $state<HTMLDivElement | null>(null);
	/** Engine-catalog values matching the search; an in-use one is flagged (disabled row). */
	const varPickerMatches = $derived.by(() => {
		const q = varSearch.trim().toLowerCase();
		return ENGINE_PARAM_CATALOG.filter(
			(p) => !q || p.label.toLowerCase().includes(q) || p.key.toLowerCase().includes(q),
		).map((p) => ({ entry: p, inUse: paramHas(p.key) }));
	});
	function subscribeEngineValue(p: EngineParamEntry): void {
		if (paramHas(p.key)) return;
		onToggleParam?.(p.key, p.kind);
	}
	function addCustomVariable(): void {
		const key = newParamKey.trim();
		if (!key) return;
		onAddParam?.(key, newParamKind);
		newParamKey = '';
		newParamKind = 'string';
		closeVarPicker();
	}
	function closeVarPicker(): void {
		varPickerOpen = false;
		varSearch = '';
	}

	// Signal picker (popover) — open state + search filter.
	let signalPickerOpen = $state(false);
	let signalSearch = $state('');
	let signalAnchorEl = $state<HTMLDivElement | null>(null);
	const signalPickerMatches = $derived.by(() => {
		const q = signalSearch.trim().toLowerCase();
		return ENGINE_SIGNAL_CATALOG.filter(
			(s) => !q || s.label.toLowerCase().includes(q) || s.key.toLowerCase().includes(q),
		).map((s) => ({ entry: s, inUse: signalHas(s.key) }));
	});
	function addSignal(key: string): void {
		if (!signalHas(key)) onToggleSignal?.(key);
	}
	function closeSignalPicker(): void {
		signalPickerOpen = false;
		signalSearch = '';
	}
	/** Dismiss an open picker when the pointer goes down outside its anchor. */
	function onWindowPointerDown(e: PointerEvent): void {
		const target = e.target as Node | null;
		if (varPickerOpen && varAnchorEl && target && !varAnchorEl.contains(target)) closeVarPicker();
		if (signalPickerOpen && signalAnchorEl && target && !signalAnchorEl.contains(target))
			closeSignalPicker();
	}

	function setSlotId(n: LayoutNode, value: string): void {
		const trimmed = value.trim();
		if (trimmed) n.slotId = trimmed;
		else delete n.slotId;
		markDirty();
	}

	function markDirty(): void {
		onDirty?.();
	}

	// Spin-FEEL tuning fields (reelGrid node, advanced). Each maps to a
	// `SpinningReelSpinOptions` key; blank = the game's coded default for that
	// profile. Authored under `node.spin.{normal,fast}`.
	const SPIN_FIELDS: { key: keyof ReelSpinProfile; label: string }[] = [
		{ key: 'reelSpinSpeed', label: 'spin speed' },
		{ key: 'reelPreSpinSpeed', label: 'pre-spin speed' },
		{ key: 'reelSpinSpeedBeforeBounce', label: 'speed before bounce' },
		{ key: 'reelBounceBackSpeed', label: 'bounce-back speed' },
		{ key: 'reelBounceSizeMulti', label: 'bounce size' },
		{ key: 'reelSpinDelay', label: 'reel stagger (ms)' },
		{ key: 'reelPaddingMultiplierNormal', label: 'spin length' },
		{ key: 'reelPaddingMultiplierAnticipated', label: 'anticipation length' },
	];

	function readSpin(n: ReelGridNode, profile: 'normal' | 'fast', key: keyof ReelSpinProfile) {
		return n.spin?.[profile]?.[key] ?? '';
	}

	function writeSpin(
		n: ReelGridNode,
		profile: 'normal' | 'fast',
		key: keyof ReelSpinProfile,
		raw: number,
	): void {
		const spin: NonNullable<ReelGridNode['spin']> = { ...(n.spin ?? {}) };
		const prof: ReelSpinProfile = { ...(spin[profile] ?? {}) };
		if (Number.isFinite(raw)) prof[key] = raw;
		else delete prof[key];
		spin[profile] = Object.keys(prof).length ? prof : undefined;
		// Drop an empty tuning object so an untouched node carries no `spin` (parity).
		n.spin = spin.normal || spin.fast ? spin : undefined;
		markDirty();
	}

	// Free-spin anticipation overlay tuning (reelGrid node, advanced). Blank = the
	// game's coded `ANTICIPATION` default. Authored under `node.anticipation`.
	const ANTICIPATION_NUM_FIELDS: { key: keyof AnticipationProfile; label: string }[] = [
		{ key: 'widthRatio', label: 'width (× cell)' },
		{ key: 'heightRatio', label: 'height (× cell)' },
		{ key: 'yOffsetRatio', label: 'y offset (× cell)' },
	];
	const ANTICIPATION_STR_FIELDS: { key: keyof AnticipationProfile; label: string }[] = [
		{ key: 'spineKey', label: 'spine asset' },
		{ key: 'introAnimation', label: 'intro animation' },
		{ key: 'loopAnimation', label: 'loop animation' },
		{ key: 'outAnimation', label: 'out animation' },
		{ key: 'sound', label: 'sound name' },
	];

	function readAnticipation(n: ReelGridNode, key: keyof AnticipationProfile) {
		return n.anticipation?.[key] ?? '';
	}

	function writeAnticipation(
		n: ReelGridNode,
		key: keyof AnticipationProfile,
		raw: number | string,
	): void {
		const a: AnticipationProfile = { ...(n.anticipation ?? {}) };
		const isEmpty = raw === '' || (typeof raw === 'number' && Number.isNaN(raw));
		if (isEmpty) delete a[key];
		else (a as Record<string, number | string>)[key] = raw;
		// Drop an empty object so an untouched node carries no `anticipation` (parity).
		n.anticipation = Object.keys(a).length ? a : undefined;
		markDirty();
	}

	// The project's font catalog (the same `/api/editor/fonts` the editor canvas
	// renders from), so the font dropdown offers exactly the fonts that will show.
	let fontList = $state<EditorFont[]>([]);
	let fontByName = $state<Map<string, EditorFont>>(new Map());
	onMount(() => {
		void fetchFontCatalog().then((c) => {
			fontList = c.fonts;
			fontByName = c.byName;
		});
	});

	/** The selected text node's font kind from the catalog (`null` = game default
	 * or a family the catalog doesn't list). Bitmap fonts are baked atlases, so the
	 * style controls that don't apply to `<BitmapText>` are gated off below. */
	const selectedFontKind = $derived.by(() => {
		if (!node || node.kind !== 'text') return null;
		const fam = node.style?.fontFamily;
		return fam ? (fontByName.get(fam)?.kind ?? null) : null;
	});
	const isBitmapSelected = $derived(selectedFontKind === 'bitmap');
	/** A non-empty current family the catalog doesn't list — kept as a "(custom)"
	 * option so picking from the dropdown never silently drops an authored family. */
	const customFamily = $derived.by(() => {
		if (!node || node.kind !== 'text') return '';
		const fam = node.style?.fontFamily ?? '';
		return fam && !fontByName.has(fam) ? fam : '';
	});

	// ---- Universal bound-component params (auto-rendered from the engine schema) ----
	// Any `container` bind anchor whose `bind.component` has an editable-param schema
	// (engine `BOUND_COMPONENT_PARAMS`) gets these controls; each writes to the node's
	// `bind.props` (top-level, or nested `style` for `group:'style'`), which flows to
	// the coded component in-game. This subsumes the old bespoke "HUD text" override
	// (font/size/fill/label) and adds button tint — placement/visibility stay on the
	// transform section above (already universal).
	const editableParams = $derived<EditableParam[]>(
		node && node.kind === 'container' && node.bind ? getEditableParams(node.bind.component) : [],
	);
	/** Default label for a HUD text anchor — the LABEL TEXT placeholder, so the empty
	 * field matches what renders (game-name defaults to the project display name). */
	const hudDefaultText = $derived.by(() => {
		if (!node || node.kind !== 'container') return '';
		const component = node.bind?.component;
		if (component === 'HudGameName' && projectGameName) return projectGameName;
		return defaultHudText(component) ?? '';
	});

	function ensureProps(n: LayoutNode): Record<string, unknown> {
		if (n.kind !== 'container' || !n.bind) return {};
		if (!n.bind.props) n.bind.props = {};
		return n.bind.props as Record<string, unknown>;
	}
	function ensureStyle(n: LayoutNode): Record<string, unknown> {
		const props = ensureProps(n);
		if (!props.style || typeof props.style !== 'object') props.style = {};
		return props.style as Record<string, unknown>;
	}
	/** Drop an emptied `style` (and `bind.props`) so the saved doc stays clean. */
	function pruneProps(n: LayoutNode): void {
		if (n.kind !== 'container' || !n.bind?.props) return;
		const props = n.bind.props as Record<string, unknown>;
		const s = props.style as Record<string, unknown> | undefined;
		if (s && Object.keys(s).length === 0) delete props.style;
		if (Object.keys(props).length === 0) delete n.bind.props;
	}
	/** Read a param's current value from `bind.props` (top-level or nested `style`). */
	function readParam(n: LayoutNode | null, p: EditableParam): unknown {
		const props = n?.bind?.props as Record<string, unknown> | undefined;
		if (!props) return undefined;
		if (p.group === 'style') return (props.style as Record<string, unknown> | undefined)?.[p.key];
		return props[p.key];
	}
	/** Write (or clear, when `undefined`) a param value at its `bind.props` location. */
	function writeParam(n: LayoutNode, p: EditableParam, value: unknown): void {
		const bucket = p.group === 'style' ? ensureStyle(n) : ensureProps(n);
		if (value === undefined || value === '') delete bucket[p.key];
		else bucket[p.key] = value;
		pruneProps(n);
		markDirty();
	}
	/** Colour control: empty clears; a malformed hex is a no-op (don't wipe on a half-type). */
	function writeColorParam(n: LayoutNode, p: EditableParam, hex: string): void {
		const trimmed = hex.trim();
		if (!trimmed) return writeParam(n, p, undefined);
		const value = parseHex(trimmed);
		if (value !== undefined) writeParam(n, p, value);
	}
	/** A current font family the catalog doesn't list — kept as a "(custom)" option. */
	function paramFontCustom(n: LayoutNode | null, p: EditableParam): string {
		const fam = readParam(n, p);
		return typeof fam === 'string' && fam && !fontByName.has(fam) ? fam : '';
	}

	const overrideKeys = [
		'x',
		'y',
		'width',
		'height',
		'anchor',
		'scale',
		'rotation',
		'alpha',
		'zIndex',
		'tint',
		'visible',
	] as const satisfies readonly (keyof NodeOverride)[];

	type OverrideKey = (typeof overrideKeys)[number];

	const isOverrideMode = $derived(layoutType !== 'desktop');

	function ensureOverride(n: LayoutNode): NodeOverride {
		if (!n.overrides) n.overrides = {};
		let o = n.overrides[layoutType];
		if (!o) {
			o = {};
			n.overrides[layoutType] = o;
		}
		return o;
	}

	function hasOverrideKey(n: LayoutNode, key: OverrideKey): boolean {
		const o = n.overrides?.[layoutType];
		if (!o) return false;
		return Object.prototype.hasOwnProperty.call(o, key);
	}

	function clearOverrideKey(n: LayoutNode, key: OverrideKey): void {
		const o = n.overrides?.[layoutType];
		if (!o) return;
		delete o[key];
		if (Object.keys(o).length === 0 && n.overrides) {
			delete n.overrides[layoutType];
		}
		markDirty();
	}

	function resetAllOverrides(n: LayoutNode): void {
		if (!n.overrides) return;
		delete n.overrides[layoutType];
		markDirty();
	}

	function setNumber(n: LayoutNode, key: OverrideKey, value: number): void {
		if (Number.isNaN(value)) return;
		if (isOverrideMode) {
			const o = ensureOverride(n);
			(o as Record<string, unknown>)[key] = value;
		} else {
			(n as unknown as Record<string, unknown>)[key] = value;
		}
		markDirty();
	}

	function setBool(n: LayoutNode, key: OverrideKey, value: boolean): void {
		if (isOverrideMode) {
			const o = ensureOverride(n);
			(o as Record<string, unknown>)[key] = value;
		} else {
			(n as unknown as Record<string, unknown>)[key] = value;
		}
		markDirty();
	}

	function setAnchor(n: LayoutNode, axis: 'x' | 'y', value: number): void {
		if (Number.isNaN(value)) return;
		if (isOverrideMode) {
			const o = ensureOverride(n);
			const cur = o.anchor ?? { ...(n.anchor ?? { x: 0.5, y: 0.5 }) };
			cur[axis] = value;
			o.anchor = cur;
		} else {
			const cur = n.anchor ?? { x: 0.5, y: 0.5 };
			n.anchor = { ...cur, [axis]: value };
		}
		markDirty();
	}

	function setScale(n: LayoutNode, axis: 'x' | 'y', value: number): void {
		if (Number.isNaN(value)) return;
		if (isOverrideMode) {
			const o = ensureOverride(n);
			const cur = o.scale ?? { ...(n.scale ?? { x: 1, y: 1 }) };
			cur[axis] = value;
			o.scale = cur;
		} else {
			const cur = n.scale ?? { x: 1, y: 1 };
			n.scale = { ...cur, [axis]: value };
		}
		markDirty();
	}

	function setTintHex(n: LayoutNode, hex: string): void {
		const clean = hex.trim().replace(/^#/, '');
		if (!/^[0-9a-fA-F]{6}$/.test(clean)) return;
		const value = parseInt(clean, 16);
		if (isOverrideMode) {
			ensureOverride(n).tint = value;
		} else if (n.kind === 'sprite') {
			n.tint = value;
		}
		markDirty();
	}

	function setSpriteSize(n: LayoutNode, axis: 'width' | 'height', value: number): void {
		if (Number.isNaN(value)) return;
		if (isOverrideMode) {
			(ensureOverride(n) as Record<string, unknown>)[axis] = value;
		} else if (n.kind === 'sprite' || n.kind === 'spine' || n.kind === 'rect') {
			(n as Record<string, unknown>)[axis] = value;
		}
		markDirty();
	}

	/**
	 * Spine size box. An explicit width/height fits the skeleton to that box (the engine's
	 * `spineSizeScale` + the editor preview both honour it), giving deterministic, WYSIWYG
	 * sizing for a spine whose rig has no authored natural bounds (e.g. a Rigger `.irig`) —
	 * where bare `scale` drifts between the editor and the game. The engine sizes by
	 * `width × scale`, so when a base size is set we reset a non-1 base scale to 1 so the
	 * typed number IS the on-screen size (size is primary, scale stays 1 — the sprite flow).
	 * A blank field clears that dimension, reverting to scale/natural sizing.
	 */
	function setSpineSize(n: LayoutNode, axis: 'width' | 'height', raw: number): void {
		if (n.kind !== 'spine') return;
		const cleared = Number.isNaN(raw);
		if (isOverrideMode) {
			if (cleared) clearOverrideKey(n, axis);
			else setSpriteSize(n, axis, raw);
			return;
		}
		const rec = n as unknown as Record<string, unknown>;
		if (cleared) {
			delete rec[axis];
		} else {
			rec[axis] = raw;
			if (n.scale?.x !== 1 || n.scale?.y !== 1) n.scale = { x: 1, y: 1 };
		}
		markDirty();
	}

	/** The four layoutTypes a node's `visibleFor` gate (BaseNode.visibleFor) can list —
	 * matches the {@link LayoutType} union. A node visible on ALL of them (or absent)
	 * shows everywhere, so we store `undefined` rather than the full array (sparse docs). */
	const LAYOUT_TYPES = ['desktop', 'tablet', 'landscape', 'portrait'] as const;

	/** Whether the node is visible on `lt` per its base-node `visibleFor` gate — absent
	 * (visible everywhere) ⇒ true. This is the BASE-NODE gate, distinct from the per-layout
	 * `visible` override above; it always writes the base node (no override path). */
	function visibleForOn(n: LayoutNode, lt: LayoutType): boolean {
		return !n.visibleFor || n.visibleFor.includes(lt);
	}

	/** Toggle a node's `visibleFor` gate for one layoutType. All-four-on (or none left to
	 * gate) ⇒ clear the field (`undefined`) so it stays sparse and behaves as today. */
	function setVisibleFor(n: LayoutNode, lt: LayoutType, on: boolean): void {
		const cur = new Set<LayoutType>(n.visibleFor ?? LAYOUT_TYPES);
		if (on) cur.add(lt);
		else cur.delete(lt);
		const next = LAYOUT_TYPES.filter((t) => cur.has(t));
		n.visibleFor = next.length === LAYOUT_TYPES.length ? undefined : (next as LayoutType[]);
		markDirty();
	}

	/** Read a node's `screenAnchor` axis (canvas-space window-edge anchor), honouring the
	 * active layout's per-layout override (NodeOverride.screenAnchor) first, then the base
	 * node; absent ⇒ 0 (top/left, today's behaviour). */
	function screenAnchorValue(n: LayoutNode, axis: 'x' | 'y'): number {
		const ov = n.overrides?.[layoutType]?.screenAnchor;
		const base = n.screenAnchor;
		const pt = (isOverrideMode && ov) || base;
		return pt ? pt[axis] : 0;
	}

	/** Set a node's `screenAnchor` axis (0..1 window-edge anchor for canvas-space scenes).
	 * Base node in desktop, the per-layout override otherwise (NodeOverride.screenAnchor) —
	 * same override discipline as the other transform setters. An axis pair that returns to
	 * the default {0,0} clears the field so an untouched node round-trips unchanged. */
	function setScreenAnchor(n: LayoutNode, axis: 'x' | 'y', value: number): void {
		if (Number.isNaN(value)) return;
		const clamped = Math.min(1, Math.max(0, value));
		if (isOverrideMode) {
			const o = ensureOverride(n);
			const cur = o.screenAnchor ?? { ...(n.screenAnchor ?? { x: 0, y: 0 }) };
			cur[axis] = clamped;
			if (cur.x === 0 && cur.y === 0) delete o.screenAnchor;
			else o.screenAnchor = cur;
			if (Object.keys(o).length === 0 && n.overrides) delete n.overrides[layoutType];
		} else {
			const cur = { ...(n.screenAnchor ?? { x: 0, y: 0 }), [axis]: clamped };
			n.screenAnchor = cur.x === 0 && cur.y === 0 ? undefined : cur;
		}
		markDirty();
	}

	/** Set a rect's fill colour (`#rrggbb` → hex int); a malformed hex is a no-op. */
	function setRectColor(n: LayoutNode, hex: string): void {
		if (n.kind !== 'rect') return;
		const value = parseHex(hex);
		if (value === undefined) return;
		n.color = value;
		markDirty();
	}

	function hexFrom(value: number | undefined): string {
		if (value === undefined) return '#ffffff';
		return '#' + value.toString(16).padStart(6, '0');
	}

	function rad2deg(r: number | undefined): number {
		return Math.round((((r ?? 0) * 180) / Math.PI) * 100) / 100;
	}
	function deg2rad(d: number): number {
		return (d * Math.PI) / 180;
	}

	// ---------- text style editing ----------
	// All writes go through `node.style` (created lazily). Setting a control to its
	// "unset" value (empty string / NaN / unchecked-with-no-data) DELETES the key so
	// the saved doc stays clean (no empty objects, no zero-value noise).

	function textStyle(n: LayoutNode): TextStyle {
		if (n.kind !== 'text') return {};
		if (!n.style) n.style = {};
		return n.style;
	}

	/** Set a numeric style field; NaN/empty clears it. */
	function setStyleNumber(n: LayoutNode, key: keyof TextStyle, value: number): void {
		if (n.kind !== 'text') return;
		const s = textStyle(n);
		if (Number.isNaN(value)) delete s[key];
		else (s as Record<string, unknown>)[key] = value;
		markDirty();
	}

	/** Set a string style field; empty string clears it. */
	function setStyleString(n: LayoutNode, key: keyof TextStyle, value: string): void {
		if (n.kind !== 'text') return;
		const s = textStyle(n);
		const trimmed = value.trim();
		if (trimmed) (s as Record<string, unknown>)[key] = trimmed;
		else delete s[key];
		markDirty();
	}

	function setStyleBool(n: LayoutNode, key: keyof TextStyle, value: boolean): void {
		if (n.kind !== 'text') return;
		const s = textStyle(n);
		if (value) (s as Record<string, unknown>)[key] = true;
		else delete s[key];
		markDirty();
	}

	/** Parse a `#rrggbb` hex to a number; returns undefined if malformed. */
	function parseHex(hex: string): number | undefined {
		const clean = hex.trim().replace(/^#/, '');
		if (!/^[0-9a-fA-F]{6}$/.test(clean)) return undefined;
		return parseInt(clean, 16);
	}

	function setFill(n: LayoutNode, hex: string): void {
		const value = parseHex(hex);
		if (value === undefined) return;
		textStyle(n).fill = value;
		markDirty();
	}

	/**
	 * Bind / unbind a node FIELD PATH to a component param (§13.2). An empty `key`
	 * clears the binding; an empty `paramBindings` map collapses back to `undefined`
	 * so an unbound node round-trips byte-identical to today.
	 */
	function setParamBinding(n: LayoutNode, fieldPath: string, key: string): void {
		if (key) {
			n.paramBindings = { ...(n.paramBindings ?? {}), [fieldPath]: key };
		} else if (n.paramBindings) {
			const next = { ...n.paramBindings };
			delete next[fieldPath];
			n.paramBindings = Object.keys(next).length ? next : undefined;
		}
		markDirty();
	}

	/** Component params whose `kind` is one a given field can accept (§13.2). */
	function paramsForKinds(kinds: ComponentParam['kind'][]): ComponentParam[] {
		return componentParams.filter((p) => kinds.includes(p.kind));
	}
	/** Dropdown options for an `action`-keyed param: the catalog of registered HUD
	 * actions, plus the current value if it's a custom key not in the catalog (so a
	 * hand-authored action isn't dropped). */
	function actionOptions(current: unknown): string[] {
		const v = typeof current === 'string' ? current : '';
		return v && !ENGINE_ACTION_CATALOG.includes(v)
			? [...ENGINE_ACTION_CATALOG, v]
			: ENGINE_ACTION_CATALOG;
	}

	function setStrokeColor(n: LayoutNode, hex: string): void {
		if (n.kind !== 'text') return;
		const value = parseHex(hex);
		if (value === undefined) return;
		const s = textStyle(n);
		s.stroke = { color: value, width: s.stroke?.width ?? 1 };
		markDirty();
	}

	function setStrokeWidth(n: LayoutNode, width: number): void {
		if (n.kind !== 'text') return;
		const s = textStyle(n);
		if (Number.isNaN(width) || width <= 0) {
			delete s.stroke;
		} else {
			s.stroke = { color: s.stroke?.color ?? 0x000000, width };
		}
		markDirty();
	}

	function toggleDropShadow(n: LayoutNode, on: boolean): void {
		if (n.kind !== 'text') return;
		const s = textStyle(n);
		if (on) s.dropShadow = s.dropShadow ?? { color: 0x000000, alpha: 0.5, blur: 2, distance: 2 };
		else delete s.dropShadow;
		markDirty();
	}

	function setDropShadowColor(n: LayoutNode, hex: string): void {
		if (n.kind !== 'text' || !n.style?.dropShadow) return;
		const value = parseHex(hex);
		if (value === undefined) return;
		n.style.dropShadow.color = value;
		markDirty();
	}

	function setDropShadowNumber(
		n: LayoutNode,
		key: 'alpha' | 'blur' | 'angle' | 'distance',
		value: number,
	): void {
		if (n.kind !== 'text' || !n.style?.dropShadow) return;
		if (Number.isNaN(value)) delete n.style.dropShadow[key];
		else n.style.dropShadow[key] = value;
		markDirty();
	}

	// ---------- background cover (§10.3 step 4) ----------
	// Cover SCALE is a dedicated UNIFORM zoom on the fitted cover (= `node.coverScale`,
	// 1 = exact edge-to-edge), authored base-only like `fit`. The TRANSFORM panel's
	// SCALE.X/SCALE.Y (= `node.scale`) author the free non-uniform STRETCH on top, so
	// the two are independent. Cover FIT is the canonical fit read by every cover path:
	// `preview.art.fit` for a `bind` preview-art anchor (the field those anchors
	// already round-trip), else the node-level `fit`.
	const coverScaleValue = $derived(node ? backgroundCoverScale(node) : 1);
	const coverFitValue = $derived(node ? backgroundFit(node) : 'cover');
	/** True when the node carries an editor preview-art payload — its fit lives in
	 * `preview.art.fit`; otherwise fit lives in the node-level `fit` field. */
	const usesPreviewArtFit = $derived(!!node?.preview?.art);

	function setCoverScale(n: LayoutNode, value: number): void {
		if (Number.isNaN(value)) return;
		n.coverScale = value;
		markDirty();
	}
	function setCoverFit(n: LayoutNode, value: 'cover' | 'contain'): void {
		if (n.preview?.art) n.preview.art.fit = value;
		else n.fit = value;
		markDirty();
	}

	// ---------- spine signal cues (§8.5, narrowed) ----------
	// When the owning component's named signal fires (the game wires it to a book
	// event via `registerComponentSignals`), this spine plays the chosen animation.
	// Authored as `node.cues`; only meaningful inside a component that has declared
	// signals. Array is reassigned on every edit so Svelte 5 reactivity fires.

	function addCue(n: SpineNode): void {
		const first = componentSignals[0]?.key ?? '';
		n.cues = [...(n.cues ?? []), { signal: first, animation: '', loop: undefined }];
		markDirty();
	}
	function updateCue(n: SpineNode, i: number, patch: Partial<SpineCue>): void {
		const cues = [...(n.cues ?? [])];
		if (!cues[i]) return;
		cues[i] = { ...cues[i], ...patch };
		n.cues = cues;
		markDirty();
	}
	function removeCue(n: SpineNode, i: number): void {
		const cues = (n.cues ?? []).filter((_, idx) => idx !== i);
		n.cues = cues.length ? cues : undefined;
		markDirty();
	}

	// ---------- button-state spine animations ----------
	// The INTERACTION analogue of the per-state IMAGE cascade: map each button state to
	// an animation this spine plays while that state is active (resting = the spine's
	// `defaultAnimation`). Authored as `node.stateAnimations`; only meaningful inside an
	// interactive button component (one declaring an `action` variable). Same cascade as
	// the state images — an unset state falls back to a neighbour (pressed→hover→selected).
	const BUTTON_ANIM_STATES = [
		{ key: 'hover', label: 'hover' },
		{ key: 'pressed', label: 'pressed' },
		{ key: 'selected', label: 'selected' },
		{ key: 'disabled', label: 'downstate' },
		{ key: 'spinning', label: 'spinning' },
	] as const;
	type ButtonAnimState = (typeof BUTTON_ANIM_STATES)[number]['key'];

	/** True when the open component is an interactive button (declares an `action`
	 * variable) — only then do button-state spine animations apply at runtime. */
	const isInteractiveComponent = $derived(componentParams.some((p) => p.key === 'action'));

	function stateAnimOf(n: SpineNode, key: ButtonAnimState) {
		return n.stateAnimations?.[key];
	}
	function setStateAnim(n: SpineNode, key: ButtonAnimState, animation: string): void {
		const map: ButtonStateAnimations = { ...(n.stateAnimations ?? {}) };
		const trimmed = animation.trim();
		if (trimmed) map[key] = { animation: trimmed, loop: map[key]?.loop };
		else delete map[key];
		n.stateAnimations = Object.keys(map).length ? map : undefined;
		markDirty();
	}
	function setStateAnimLoop(n: SpineNode, key: ButtonAnimState, loop: boolean): void {
		const cur = n.stateAnimations?.[key];
		if (!cur) return;
		n.stateAnimations = { ...n.stateAnimations, [key]: { ...cur, loop: loop || undefined } };
		markDirty();
	}
</script>

<!-- Dismiss an open variable/signal picker on an outside pointer-down. The handler
     no-ops unless a picker is open (component mode only). -->
<svelte:window onpointerdown={onWindowPointerDown} />

{#if componentMode}
	<!-- Component-level metadata (§8.4 / §8.5): declare the params the ENGINE feeds +
	     the signals it fires, by picking from the curated catalog. Metadata only —
	     no timeline/behaviour authoring in v1. Shown above any selected-node fields. -->
	<section class="cmp-vars">
		<h3>Component variables</h3>
		<p class="muted small">
			The values the engine feeds (variables) and the moments it fires (signals). These are the <strong
				>declare</strong
			> half — the game wires + supplies them.
		</p>

		<div class="vars-head">
			<h4>Variables in use</h4>
			{#if !sourceParam}
				<div class="picker-anchor" bind:this={varAnchorEl}>
					<button
						type="button"
						class="ghost-sm"
						aria-expanded={varPickerOpen}
						onclick={() => (varPickerOpen ? closeVarPicker() : (varPickerOpen = true))}
					>
						+ Add variable
					</button>
					{#if varPickerOpen}
						<!-- svelte-ignore a11y_no_static_element_interactions -->
						<div class="picker-pop" onkeydown={(e) => e.key === 'Escape' && closeVarPicker()}>
							<input
								class="picker-search"
								type="text"
								placeholder="Search values…"
								bind:value={varSearch}
							/>
							<div class="picker-scroll">
								<p class="picker-group-title">Live game values</p>
								{#if varPickerMatches.length === 0}
									<p class="muted small picker-empty">No matching values.</p>
								{:else}
									{#each varPickerMatches as m (m.entry.key)}
										<button
											type="button"
											class="picker-option"
											disabled={m.inUse}
											title={m.entry.note ?? undefined}
											onclick={() => {
												subscribeEngineValue(m.entry);
												closeVarPicker();
											}}
										>
											<span class="opt-label">{m.entry.label}</span>
											<span class="opt-kind">{m.entry.kind}</span>
											{#if m.inUse}<span class="opt-inuse">in use</span>{/if}
										</button>
									{/each}
								{/if}
								<p class="picker-group-title">Custom input</p>
								<p class="muted small picker-hint">
									Add your own input, then bind a node's field to it under
									<strong>Bind to param</strong>.
								</p>
								<div class="add-param">
									<input
										type="text"
										placeholder="name, e.g. bg"
										bind:value={newParamKey}
										onkeydown={(e) => {
											if (e.key === 'Enter') addCustomVariable();
										}}
									/>
									<select
										value={newParamKind}
										onchange={(e) =>
											(newParamKind = e.currentTarget.value as ComponentParam['kind'])}
									>
										<option value="string">string</option>
										<option value="image">image</option>
										<option value="number">number</option>
										<option value="color">color</option>
										<option value="boolean">boolean</option>
									</select>
									<button type="button" disabled={!newParamKey.trim()} onclick={addCustomVariable}
										>Add</button
									>
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}
		</div>

		{#if sourceParam}
			<!-- Engine-fed readout: the value is bound through a `source` param (a value
			     feed picked from a closed set), NOT by adding literal bet/win/balance — so
			     the variable picker would be inert here. Show the binding instead. -->
			<p class="muted small">
				Engine-fed: this component shows the live <strong>value</strong> of its
				<strong>{sourceParam.key}</strong> — one of
				<em>{sourceParam.options?.join(' · ')}</em>. Set the default source under
				<strong>Defaults</strong>, and pick the source per placement when you drop it in a scene.
			</p>
		{:else if variableRows.length === 0}
			<p class="muted small">
				No variables yet — use <strong>+ Add variable</strong> to subscribe a live game value or create
				a custom input.
			</p>
		{:else}
			<ul class="var-rows">
				{#each variableRows as row (row.key)}
					<li class="var-row">
						<div class="var-row-head">
							<span class="var-icon" aria-hidden="true">{row.origin === 'engine' ? '◆' : '✎'}</span>
							<span class="var-name">{row.label}</span>
							<span class="var-badge" class:engine={row.origin === 'engine'}>{row.origin}</span>
							<span class="var-kind">{row.kind}</span>
							<button
								type="button"
								class="param-remove"
								title={row.origin === 'engine' ? 'Unsubscribe value' : 'Delete custom input'}
								onclick={() => removeVariable(row)}>×</button
							>
						</div>
						{#if row.origin === 'yours'}
							{@const p = customParams.find((cp) => cp.key === row.key)}
							{#if p}
								<label class="param-default">
									<span>default</span>
									{#if p.kind === 'string' && fontParamKeys.has(p.key)}
										{@const cur = typeof p.default === 'string' ? p.default : ''}
										<select
											value={cur}
											onchange={(e) =>
												onSetParamDefault?.(p.key, e.currentTarget.value || undefined)}
										>
											<option value="">(game default)</option>
											{#each fontList as f (f.id)}
												<option value={f.name}>{f.name} [{f.kind}]</option>
											{/each}
											{#if cur && !fontList.some((f) => f.name === cur)}
												<option value={cur}>{cur} (custom)</option>
											{/if}
										</select>
									{:else if p.kind === 'number'}
										<input
											type="number"
											value={typeof p.default === 'number' ? p.default : ''}
											oninput={(e) =>
												onSetParamDefault?.(
													p.key,
													e.currentTarget.value === '' ? undefined : e.currentTarget.valueAsNumber,
												)}
										/>
									{:else if p.kind === 'color'}
										<input
											type="color"
											value={typeof p.default === 'number' ? hexFrom(p.default) : '#ffffff'}
											oninput={(e) => onSetParamDefault?.(p.key, parseHex(e.currentTarget.value))}
										/>
									{:else if p.kind === 'boolean'}
										<input
											type="checkbox"
											checked={p.default === true}
											onchange={(e) => onSetParamDefault?.(p.key, e.currentTarget.checked)}
										/>
									{:else if p.kind === 'image'}
										<RegionPicker
											sheets={pickSheets}
											value={typeof p.default === 'string' ? p.default : ''}
											scoped
											onSelect={(region) => onSetParamDefault?.(p.key, region || undefined)}
										/>
									{:else}
										<input
											type="text"
											value={typeof p.default === 'string' ? p.default : ''}
											oninput={(e) =>
												onSetParamDefault?.(p.key, e.currentTarget.value || undefined)}
										/>
									{/if}
								</label>
								<!-- Closed enum for a string param: a comma-separated list ⇒ the placed
								     instance renders this param as a dropdown (paramField's options branch).
								     Empty ⇒ free text, as today. Only for `string`-kind, non-font params. -->
								{#if p.kind === 'string' && !fontParamKeys.has(p.key)}
									<label class="param-default">
										<span>options</span>
										<input
											type="text"
											placeholder="comma,separated,values"
											value={p.options?.join(', ') ?? ''}
											oninput={(e) =>
												onSetParamOptions?.(
													p.key,
													e.currentTarget.value
														.split(',')
														.map((s) => s.trim())
														.filter(Boolean),
												)}
										/>
									</label>
								{/if}
							{/if}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}

		{#if !sourceParam}
			<h4>Button images</h4>
			<button
				type="button"
				class="ghost-sm"
				onclick={() => (showButtonParamsManual = !showButtonParams)}
			>
				{showButtonParams ? 'Hide button images' : 'Show button images'}
			</button>
			{#if showButtonParams}
				<p class="muted small">
					For a button only. Tick just the interaction states you need — bind your bg sprite's
					<code>region</code> to <strong>normal</strong>, and the engine swaps it on hover / press /
					selected / down. Pick each state's art here, or override it per placement.
				</p>
				<ul class="picker">
					{#each BUTTON_STATE_PARAMS as p (p.key)}
						<li>
							<label class="pick">
								<input
									type="checkbox"
									checked={paramHas(p.key)}
									onchange={() => onToggleStateParam?.(p.key)}
								/>
								<span class="pick-label">{p.label}</span>
								<span class="pick-kind">image</span>
							</label>
							{#if paramHas(p.key)}
								<RegionPicker
									sheets={pickSheets}
									value={paramDefaultStr(p.key)}
									scoped
									onSelect={(region) => onSetParamDefault?.(p.key, region || undefined)}
								/>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		{/if}

		<div class="vars-head">
			<h4>Signals in use</h4>
			<div class="picker-anchor" bind:this={signalAnchorEl}>
				<button
					type="button"
					class="ghost-sm"
					aria-expanded={signalPickerOpen}
					onclick={() => (signalPickerOpen ? closeSignalPicker() : (signalPickerOpen = true))}
				>
					+ Add signal
				</button>
				{#if signalPickerOpen}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div class="picker-pop" onkeydown={(e) => e.key === 'Escape' && closeSignalPicker()}>
						<input
							class="picker-search"
							type="text"
							placeholder="Search signals…"
							bind:value={signalSearch}
						/>
						<div class="picker-scroll">
							{#if signalPickerMatches.length === 0}
								<p class="muted small picker-empty">No matching signals.</p>
							{:else}
								{#each signalPickerMatches as m (m.entry.key)}
									<button
										type="button"
										class="picker-option"
										disabled={m.inUse}
										title={m.entry.note ?? undefined}
										onclick={() => {
											addSignal(m.entry.key);
											closeSignalPicker();
										}}
									>
										<span class="opt-label">{m.entry.label}</span>
										{#if m.entry.note}<span class="opt-note">{m.entry.note}</span>{/if}
										{#if m.inUse}<span class="opt-inuse">in use</span>{/if}
									</button>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
			</div>
		</div>
		{#if signalRows.length === 0}
			<p class="muted small">
				No signals yet — use <strong>+ Add signal</strong> to fire a spine cue on enter / win / big win.
			</p>
		{:else}
			<ul class="var-rows">
				{#each signalRows as s (s.key)}
					<li class="var-row">
						<div class="var-row-head">
							<span class="var-icon" aria-hidden="true">⚡</span>
							<span class="var-name" title={s.note ?? undefined}>{s.label}</span>
							<button
								type="button"
								class="param-remove"
								title="Remove signal"
								onclick={() => onToggleSignal?.(s.key)}>×</button
							>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

{#if !node}
	{#if !componentMode}
		<p class="muted">Select a node to edit its properties.</p>
	{/if}
{:else}
	{@const t = resolveTransform(node, layoutType)}
	{@const o = node.overrides?.[layoutType]}
	<div class="head">
		<div class="title">
			{#if node.kind === 'componentInstance'}
				<strong>{instanceComponent?.name ?? node.componentId}</strong>
				<span class="kind">{node.kind}</span>
				{#if node.label}<span class="kind role">· {node.label}</span>{/if}
			{:else}
				<strong>{node.label ?? node.id}</strong>
				<span class="kind">{node.kind}</span>
			{/if}
			{#if node.locked}<span class="kind locked">locked</span>{/if}
		</div>
		{#if node.kind === 'sprite' && node.region}
			<div class="ctx">
				Region <strong>{node.region}</strong> of <code>{node.assetKey.split('/').pop()}</code>
			</div>
			{#if node.assetKey}
				<a
					class="ghost-sm atlas-link"
					href={`/atlas?atlas=${encodeURIComponent(
						node.assetKey.split('/').pop() ?? '',
					)}&region=${encodeURIComponent(node.region)}`}
					target="_blank"
					rel="noopener"
					title="Open the Invisible Atlas Maker on this sprite's atlas (falls back to the Sheet Maker's Import browser if that atlas has no Atlas Maker recipe)"
				>
					🧩 Open in Atlas Maker
				</a>
			{/if}
		{/if}
		<div class="ctx" class:override={isOverrideMode}>
			{#if isOverrideMode}
				Override: <strong>{layoutType}</strong>
			{:else}
				<span
					title={'These are the BASE values, shared by every layout. ' +
						'“' +
						layoutType +
						' view” is the layout you’re currently viewing — switch the layout tab to add ' +
						'per-layout tweaks, which are stored as an Override.'}
				>
					Base values · <strong>{layoutType}</strong> view
				</span>
			{/if}
		</div>
		{#if isOverrideMode}
			<button
				class="ghost-sm danger"
				disabled={!o}
				onclick={() => resetAllOverrides(node)}
				title="Clear all override fields for this layoutType"
			>
				Reset overrides
			</button>
		{/if}
		{#if !componentMode && node.kind === 'container'}
			<button
				class="ghost-sm"
				onclick={() => onEditAsComponent?.(node as ContainerNode)}
				title="Save this container's sub-tree as a reusable component and open it in the Invisible Component Editor (new tab)"
			>
				◇ Edit as component
			</button>
		{/if}
		{#if !componentMode && onConvertToReelGrid && node.kind === 'container' && (node.slotId === 'reelGrid' || node.bind?.component === 'ReelGrid')}
			<button
				class="ghost-sm"
				onclick={() => onConvertToReelGrid?.(node.id)}
				title="Replace this board mount-anchor with a parametric reel grid (editable reels / rows / cell size / padding; drives the in-game board position + cell size)"
			>
				⊞ Convert to parametric grid
			</button>
		{/if}
		{#if !componentMode && onConvertToParametricButton && node.kind === 'container' && isHudButtonBind(node.bind?.component)}
			<button
				class="ghost-sm"
				onclick={() => onConvertToParametricButton?.(node.id)}
				title="Replace this coded HUD button with an editable parametric button (action + icon + style) at the same position; reversible by reseeding"
			>
				⊞ Convert to parametric button
			</button>
		{/if}
	</div>

	{#if node.kind === 'componentInstance'}
		<section>
			<h3>Component instance</h3>
			<button
				class="ghost-sm"
				onclick={() => onOpenComponentEditor?.(node.componentId)}
				title="Open this component's definition in the Invisible Component Editor (new tab) to edit its layout, params, and signals"
			>
				◇ Edit in Component Editor
			</button>
			{#if instanceComponent}
				<p class="muted small">
					<strong>{instanceComponent.name}</strong> · {instanceComponent.scope} · pinned v{node.componentVersion ??
						instanceComponent.version}
				</p>
				{#if instanceOutdated}
					<div class="outdated">
						<p class="outdated-msg">
							Component v{instanceComponent.version} available (instance pinned v{node.componentVersion})
						</p>
						<button
							class="ghost-sm"
							onclick={() => onUpdateInstanceToLatest?.()}
							title="Re-pin THIS instance to the component's latest version. Keeps your param overrides where the param still exists; drops overrides for params the new version removed. Per-instance only — never affects other instances."
						>
							↑ Update to latest (v{instanceComponent.version})
						</button>
					</div>
				{/if}
				{#snippet paramField(p: ComponentParam)}
					<label class="field wide">
						<span>{p.label ?? `${p.key} (${p.kind})`}</span>
						{#if p.options && p.options.length > 0}
							<select
								value={(node.params?.[p.key] as string) ?? ''}
								onchange={(e) => onSetInstanceParam?.(p.key, e.currentTarget.value || undefined)}
							>
								<option value="">(inherit default)</option>
								{#each p.options as opt (opt)}
									<option value={opt}>{opt}</option>
								{/each}
							</select>
						{:else if p.key === 'action'}
							<select
								value={(node.params?.[p.key] as string) ?? ''}
								onchange={(e) => onSetInstanceParam?.(p.key, e.currentTarget.value || undefined)}
							>
								<option value="">(inherit default)</option>
								{#each actionOptions(node.params?.[p.key]) as a (a)}
									<option value={a}>{a}</option>
								{/each}
							</select>
						{:else if p.kind === 'boolean'}
							<input
								type="checkbox"
								checked={Boolean(node.params?.[p.key])}
								onchange={(e) => onSetInstanceParam?.(p.key, e.currentTarget.checked)}
							/>
						{:else if p.kind === 'number'}
							<input
								type="number"
								value={(node.params?.[p.key] as number) ?? ''}
								oninput={(e) =>
									onSetInstanceParam?.(
										p.key,
										e.currentTarget.value === '' ? undefined : e.currentTarget.valueAsNumber,
									)}
							/>
						{:else if p.kind === 'color'}
							<span class="color-cell">
								<input
									type="color"
									value={typeof node.params?.[p.key] === 'number'
										? hexFrom(node.params[p.key] as number)
										: '#ffffff'}
									oninput={(e) => onSetInstanceParam?.(p.key, parseHex(e.currentTarget.value))}
								/>
								{#if node.params?.[p.key] !== undefined}
									<button
										type="button"
										class="reset"
										title="Inherit default"
										onclick={() => onSetInstanceParam?.(p.key, undefined)}>×</button
									>
								{/if}
							</span>
						{:else if p.kind === 'image'}
							<RegionPicker
								sheets={pickSheets}
								value={(node.params?.[p.key] as string) ?? ''}
								scoped
								onSelect={(region) => onSetInstanceParam?.(p.key, region || undefined)}
							/>
						{:else if p.kind === 'spine'}
							{@const cur = (node.params?.[p.key] as string) ?? ''}
							<select
								value={cur}
								onchange={(e) => onSetInstanceParam?.(p.key, e.currentTarget.value || undefined)}
							>
								<option value=""
									>{typeof p.default === 'string' && p.default
										? `(default: ${p.default})`
										: '(inherit default)'}</option
								>
								{#each spines as s (s.key)}
									<option value={s.name}>{s.name}{s.shared ? ' [shared]' : ''}</option>
								{/each}
								{#if cur && !spines.some((s) => s.name === cur)}
									<option value={cur}>{cur} (custom)</option>
								{/if}
							</select>
						{:else if p.kind === 'spineAnimation' || p.kind === 'spineSlot'}
							{@const cur = (node.params?.[p.key] as string) ?? ''}
							{@const bundle = effectiveSpineBundle(p)}
							{@const meta = spineMetaFor(resolveSpineAssetKey(bundle))}
							{@const opts = p.kind === 'spineSlot' ? meta?.slots : meta?.animations}
							{#if opts && opts.length > 0}
								<select
									value={cur}
									onchange={(e) => onSetInstanceParam?.(p.key, e.currentTarget.value || undefined)}
								>
									<option value=""
										>{typeof p.default === 'string' && p.default
											? `(default: ${p.default})`
											: '(inherit default)'}</option
									>
									{#each opts as o (o)}
										<option value={o}>{o}</option>
									{/each}
									{#if cur && !opts.includes(cur)}
										<option value={cur}>{cur} (custom)</option>
									{/if}
								</select>
							{:else}
								<input
									type="text"
									value={cur}
									placeholder={p.default !== undefined ? String(p.default) : ''}
									oninput={(e) => onSetInstanceParam?.(p.key, e.currentTarget.value)}
								/>
								{#if node.params?.[p.key] !== undefined}
									<button
										type="button"
										class="reset"
										title="Inherit default — clearing the field sets an explicit empty value"
										onclick={() => onSetInstanceParam?.(p.key, undefined)}>×</button
									>
								{/if}
							{/if}
						{:else if p.kind === 'string' && instanceFontParamKeys.has(p.key)}
							{@const cur = (node.params?.[p.key] as string) ?? ''}
							<select
								value={cur}
								onchange={(e) => onSetInstanceParam?.(p.key, e.currentTarget.value || undefined)}
							>
								<option value=""
									>{typeof p.default === 'string' && p.default
										? `(default: ${p.default})`
										: '(inherit default)'}</option
								>
								{#each fontList as f (f.id)}
									<option value={f.name}>{f.name} [{f.kind}]</option>
								{/each}
								{#if cur && !fontList.some((f) => f.name === cur)}
									<option value={cur}>{cur} (custom)</option>
								{/if}
							</select>
						{:else}
							<input
								type="text"
								value={(node.params?.[p.key] as string) ?? ''}
								placeholder={p.default !== undefined ? String(p.default) : ''}
								oninput={(e) => onSetInstanceParam?.(p.key, e.currentTarget.value)}
							/>
							{#if node.params?.[p.key] !== undefined}
								<button
									type="button"
									class="reset"
									title="Inherit default — clearing the field instead sets an explicit empty value (no text)"
									onclick={() => onSetInstanceParam?.(p.key, undefined)}>×</button
								>
							{/if}
						{/if}
					</label>
				{/snippet}
				{#if authorParams.length > 0}
					<h4 class="sub-h">Params</h4>
					{#each ungroupedAuthorParams as p (p.key)}
						<div class="row">{@render paramField(p)}</div>
					{/each}
					{#each authorParamGroups as [groupName, groupParams] (groupName)}
						{@const groupKey = `${instanceComponent?.id ?? ''}:${groupName}`}
						<details
							class="param-group"
							open={isParamGroupOpen(groupKey)}
							ontoggle={(e) => setParamGroupOpen(groupKey, e.currentTarget.open)}
						>
							<summary>{groupName}</summary>
							{#each groupParams as p (p.key)}
								<div class="row">{@render paramField(p)}</div>
							{/each}
						</details>
					{/each}
				{:else}
					<p class="muted small">
						This component declares no author-set params (engine-provided params are fed at
						runtime).
					</p>
				{/if}
				{#if instanceSpineNodes.length > 0}
					<details class="param-group" open>
						<summary>Spine (this placement)</summary>
						<p class="muted small">
							Override what THIS placement's spine plays — its resting animation / loop / skin and,
							for an interactive button, the per-state animations. Leave a field on
							<em>(inherit)</em> to keep the component's default, so two copies can look different.
						</p>
						{#each instanceSpineNodes as sp (sp.id)}
							{@const meta = spineMetaFor(sp.assetKey)}
							{@const rest = instanceSpineRestOf(sp.id)}
							<div class="state-anim-node">
								<h5 class="sub-h">{sp.label ?? sp.id}</h5>
								<div class="bind-grid cue-row">
									<label class="field">
										<span>resting</span>
										{#if meta?.animations?.length}
											<select
												value={rest?.defaultAnimation ?? ''}
												onchange={(e) =>
													onSetInstanceSpineRest?.(sp.id, {
														defaultAnimation: e.currentTarget.value || undefined,
														...(e.currentTarget.value ? {} : { loop: undefined }),
													})}
											>
												<option value=""
													>{sp.defaultAnimation
														? `(inherit: ${sp.defaultAnimation})`
														: '(inherit)'}</option
												>
												{#each meta.animations as anim (anim)}
													<option value={anim}>{anim}</option>
												{/each}
											</select>
										{:else}
											<input
												type="text"
												placeholder={sp.defaultAnimation
													? `inherit: ${sp.defaultAnimation}`
													: 'animation name'}
												value={rest?.defaultAnimation ?? ''}
												oninput={(e) =>
													onSetInstanceSpineRest?.(sp.id, {
														defaultAnimation: e.currentTarget.value || undefined,
													})}
											/>
										{/if}
									</label>
									<label class="field check">
										<input
											type="checkbox"
											checked={rest?.loop ?? false}
											disabled={!rest?.defaultAnimation}
											onchange={(e) =>
												onSetInstanceSpineRest?.(sp.id, { loop: e.currentTarget.checked })}
										/>
										<span>loop</span>
									</label>
								</div>
								{#if meta?.skins?.length}
									<div class="bind-grid cue-row">
										<label class="field">
											<span>skin</span>
											<select
												value={rest?.skin ?? ''}
												onchange={(e) =>
													onSetInstanceSpineRest?.(sp.id, {
														skin: e.currentTarget.value || undefined,
													})}
											>
												<option value="">{sp.skin ? `(inherit: ${sp.skin})` : '(inherit)'}</option>
												{#each meta.skins as sk (sk)}
													<option value={sk}>{sk}</option>
												{/each}
											</select>
										</label>
									</div>
								{/if}
								{#if sp.cues?.length}
									<h6 class="sub-h state-sub">Driven by signal</h6>
									{#each sp.cues as cue (cue.signal)}
										{@const ov = instanceCueSignalOf(sp.id, cue.signal)}
										<div class="bind-grid cue-row">
											<label class="field">
												<span>{cue.animation || cue.signal}</span>
												<select
													value={ov ?? ''}
													onchange={(e) =>
														onSetInstanceCueSignal?.(sp.id, cue.signal, e.currentTarget.value)}
												>
													<option value="">(inherit: {cue.signal})</option>
													{#each ENGINE_SIGNAL_CATALOG as s (s.key)}
														<option value={s.key}>{s.label}</option>
													{/each}
													{#if ov && !ENGINE_SIGNAL_CATALOG.some((s) => s.key === ov)}
														<option value={ov}>{ov} (custom)</option>
													{/if}
												</select>
											</label>
										</div>
									{/each}
								{/if}
								{#if instanceInteractive}
									<h6 class="sub-h state-sub">Plays on button state</h6>
									{#each BUTTON_ANIM_STATES as st (st.key)}
										{@const ov = instanceStateAnimOf(sp.id, st.key)}
										{@const inherit = sp.stateAnimations?.[st.key]?.animation}
										<div class="bind-grid cue-row">
											<label class="field">
												<span>{st.label}</span>
												{#if meta?.animations?.length}
													<select
														value={ov?.animation ?? ''}
														onchange={(e) =>
															onSetInstanceStateAnim?.(sp.id, st.key, e.currentTarget.value)}
													>
														<option value=""
															>{inherit ? `(inherit: ${inherit})` : '(inherit)'}</option
														>
														{#each meta.animations as anim (anim)}
															<option value={anim}>{anim}</option>
														{/each}
													</select>
												{:else}
													<input
														type="text"
														placeholder={inherit ? `inherit: ${inherit}` : 'animation name'}
														value={ov?.animation ?? ''}
														oninput={(e) =>
															onSetInstanceStateAnim?.(sp.id, st.key, e.currentTarget.value)}
													/>
												{/if}
											</label>
											<label class="field check">
												<input
													type="checkbox"
													checked={ov?.loop ?? false}
													disabled={!ov}
													onchange={(e) =>
														onSetInstanceStateAnimLoop?.(sp.id, st.key, e.currentTarget.checked)}
												/>
												<span>loop</span>
											</label>
										</div>
									{/each}
								{/if}
							</div>
						{/each}
					</details>
				{/if}
				{#if engineBindingParams.length > 0}
					<details
						class="param-group"
						open={Boolean(node.params?.action) || Boolean(node.params?.visibleSource)}
					>
						<summary>Engine bindings</summary>
						<p class="muted small">
							Make this instance clickable (Action) or lifecycle-gated (Shows during), regardless of
							what its component declares. The game registers the matching handler/feed; an
							unregistered name simply does nothing. Both blank by default.
						</p>
						{#each engineBindingParams as p (p.key)}
							{#if p.key === 'visibleSource'}
								<label class="field wide">
									<span>{p.label}</span>
									<select
										value={(node.params?.[p.key] as string) ?? ''}
										onchange={(e) =>
											onSetInstanceParam?.(p.key, e.currentTarget.value || undefined)}
									>
										<option value="">(always)</option>
										{#each visibleSourceOptions(node.params?.[p.key]) as k (k)}
											<option value={k}>{VISIBILITY_SOURCE_LABELS[k] ?? k}</option>
										{/each}
									</select>
								</label>
							{:else}
								<div class="row">{@render paramField(p)}</div>
							{/if}
						{/each}
					</details>
				{/if}
				{#if isOverlayInstance}
					<details class="param-group" open={Boolean(node.params?.tapToContinue)}>
						<summary>Tap to continue</summary>
						<p class="muted small">
							Let a tap anywhere (or Space) dismiss this overlay — completes the active flow screen
							and, with a signal set, fires that signal's transition. Off by default.
						</p>
						{#each TAP_TO_CONTINUE_PARAMS as p (p.key)}
							<div class="row">{@render paramField(p)}</div>
						{/each}
					</details>
				{/if}
			{:else}
				<p class="muted small">
					Component <code>{node.componentId}</code> not found in this project. It renders as a placeholder.
				</p>
			{/if}
		</section>
	{/if}

	{#if templateMode}
		<section class="slot-section">
			<h3>Slot</h3>
			<div class="row">
				<label class="field wide">
					<span>fills slot</span>
					<select
						value={node.slotId ?? ''}
						onchange={(e) => setSlotId(node, e.currentTarget.value)}
					>
						<option value="">— none (free scenery) —</option>
						{#each sceneSlots as s (s.slotId)}
							<option value={s.slotId}>{s.name} ({s.kind})</option>
						{/each}
						{#if node.slotId && !sceneSlots.some((s) => s.slotId === node.slotId)}
							<option value={node.slotId}>{node.slotId} (other scene)</option>
						{/if}
					</select>
				</label>
			</div>
			{#if node.slotId}
				<div class="row">
					<label class="field check">
						<input
							type="checkbox"
							checked={slotMeta[node.slotId]?.required ?? false}
							onchange={(e) => onSlotRequiredChange?.(node.slotId!, e.currentTarget.checked)}
						/>
						<span>required</span>
					</label>
				</div>
				<p class="slot-hint">
					{node.bind || node.kind === 'container' ? 'mount' : node.kind} slot
				</p>
			{:else}
				<p class="slot-hint">Untagged — free scenery, not part of the template.</p>
			{/if}
		</section>
	{/if}

	<section>
		<h3>Transform</h3>

		<div class="row">
			<label class="field">
				<span>x</span>
				<input
					type="number"
					step="1"
					value={t.x}
					oninput={(e) => setNumber(node, 'x', e.currentTarget.valueAsNumber)}
				/>
				{#if isOverrideMode && hasOverrideKey(node, 'x')}
					<span class="ovdot" title="Overridden"></span>
					<button class="reset" onclick={() => clearOverrideKey(node, 'x')}>×</button>
				{/if}
			</label>
			<label class="field">
				<span>y</span>
				<input
					type="number"
					step="1"
					value={t.y}
					oninput={(e) => setNumber(node, 'y', e.currentTarget.valueAsNumber)}
				/>
				{#if isOverrideMode && hasOverrideKey(node, 'y')}
					<span class="ovdot" title="Overridden"></span>
					<button class="reset" onclick={() => clearOverrideKey(node, 'y')}>×</button>
				{/if}
			</label>
		</div>

		<div class="row">
			<label class="field">
				<span>scale.x</span>
				<input
					type="number"
					step="0.1"
					value={t.scale?.x ?? 1}
					oninput={(e) => setScale(node, 'x', e.currentTarget.valueAsNumber)}
				/>
				{#if isOverrideMode && hasOverrideKey(node, 'scale')}
					<span class="ovdot" title="Overridden"></span>
					<button class="reset" onclick={() => clearOverrideKey(node, 'scale')}>×</button>
				{/if}
			</label>
			<label class="field">
				<span>scale.y</span>
				<input
					type="number"
					step="0.1"
					value={t.scale?.y ?? 1}
					oninput={(e) => setScale(node, 'y', e.currentTarget.valueAsNumber)}
				/>
			</label>
		</div>

		<div class="row">
			<label class="field wide">
				<span>rotation (°)</span>
				<input
					type="number"
					step="1"
					value={rad2deg(t.rotation)}
					oninput={(e) => setNumber(node, 'rotation', deg2rad(e.currentTarget.valueAsNumber))}
				/>
				{#if isOverrideMode && hasOverrideKey(node, 'rotation')}
					<span class="ovdot" title="Overridden"></span>
					<button class="reset" onclick={() => clearOverrideKey(node, 'rotation')}>×</button>
				{/if}
			</label>
		</div>

		<div class="row">
			<label class="field">
				<span>anchor.x</span>
				<input
					type="number"
					step="0.1"
					value={t.anchor?.x ?? 0.5}
					oninput={(e) => setAnchor(node, 'x', e.currentTarget.valueAsNumber)}
				/>
				{#if isOverrideMode && hasOverrideKey(node, 'anchor')}
					<span class="ovdot" title="Overridden"></span>
					<button class="reset" onclick={() => clearOverrideKey(node, 'anchor')}>×</button>
				{/if}
			</label>
			<label class="field">
				<span>anchor.y</span>
				<input
					type="number"
					step="0.1"
					value={t.anchor?.y ?? 0.5}
					oninput={(e) => setAnchor(node, 'y', e.currentTarget.valueAsNumber)}
				/>
			</label>
		</div>

		<div class="row">
			<label class="field">
				<span>alpha</span>
				<input
					type="number"
					step="0.05"
					min="0"
					max="1"
					value={t.alpha ?? 1}
					oninput={(e) => setNumber(node, 'alpha', e.currentTarget.valueAsNumber)}
				/>
				{#if isOverrideMode && hasOverrideKey(node, 'alpha')}
					<span class="ovdot" title="Overridden"></span>
					<button class="reset" onclick={() => clearOverrideKey(node, 'alpha')}>×</button>
				{/if}
			</label>
			<label class="field">
				<span>zIndex</span>
				<input
					type="number"
					step="1"
					value={t.zIndex ?? 0}
					oninput={(e) => setNumber(node, 'zIndex', e.currentTarget.valueAsNumber)}
				/>
				{#if isOverrideMode && hasOverrideKey(node, 'zIndex')}
					<span class="ovdot" title="Overridden"></span>
					<button class="reset" onclick={() => clearOverrideKey(node, 'zIndex')}>×</button>
				{/if}
			</label>
		</div>

		<div class="row">
			<label class="field check">
				<input
					type="checkbox"
					checked={t.visible}
					onchange={(e) => setBool(node, 'visible', e.currentTarget.checked)}
				/>
				<span>visible</span>
				{#if isOverrideMode && hasOverrideKey(node, 'visible')}
					<span class="ovdot" title="Overridden"></span>
					<button class="reset" onclick={() => clearOverrideKey(node, 'visible')}>×</button>
				{/if}
			</label>
		</div>

		<!-- Per-node layout gate (BaseNode.visibleFor): show this node only on the ticked
		     layouts. All ticked (or none) = visible everywhere — a base-node gate, distinct
		     from the per-layout `visible` override above. -->
		<div class="field wide">
			<span class="sub-label">shows on layouts</span>
			<div class="row visible-for">
				{#each LAYOUT_TYPES as lt (lt)}
					<label class="field check">
						<input
							type="checkbox"
							checked={visibleForOn(node, lt)}
							onchange={(e) => setVisibleFor(node, lt, e.currentTarget.checked)}
						/>
						<span>{lt}</span>
					</label>
				{/each}
			</div>
		</div>

		<!-- Window-edge anchor (BaseNode.screenAnchor) — only meaningful for canvas-space
		     scenes, where x/y become an offset from `screenAnchor × canvasSize` (0 = top/left,
		     0.5 = centre, 1 = bottom/right). Ignored for game/standard/background scenes. -->
		{#if sceneSpace === 'canvas'}
			<div class="row">
				<label class="field">
					<span>screen anchor x</span>
					<input
						type="number"
						step="0.5"
						min="0"
						max="1"
						value={screenAnchorValue(node, 'x')}
						oninput={(e) => setScreenAnchor(node, 'x', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>screen anchor y</span>
					<input
						type="number"
						step="0.5"
						min="0"
						max="1"
						value={screenAnchorValue(node, 'y')}
						oninput={(e) => setScreenAnchor(node, 'y', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>
			<div class="row anchor-presets">
				<span class="sub-label">anchor x</span>
				<button type="button" class="ghost-sm" onclick={() => setScreenAnchor(node, 'x', 0)}>
					left
				</button>
				<button type="button" class="ghost-sm" onclick={() => setScreenAnchor(node, 'x', 0.5)}>
					centre
				</button>
				<button type="button" class="ghost-sm" onclick={() => setScreenAnchor(node, 'x', 1)}>
					right
				</button>
				<span class="sub-label">anchor y</span>
				<button type="button" class="ghost-sm" onclick={() => setScreenAnchor(node, 'y', 0)}>
					top
				</button>
				<button type="button" class="ghost-sm" onclick={() => setScreenAnchor(node, 'y', 0.5)}>
					centre
				</button>
				<button type="button" class="ghost-sm" onclick={() => setScreenAnchor(node, 'y', 1)}>
					bottom
				</button>
			</div>
		{/if}
	</section>

	{#if isBackgroundCover}
		<section class="bg-section">
			<h3>Background</h3>
			<p class="muted small">
				Full-bleed cover of the game window. Edit the cover here — it stays non-draggable.
			</p>
			<div class="row">
				<label class="field">
					<span>cover scale</span>
					<input
						type="number"
						step="0.05"
						min="0.1"
						max="4"
						value={coverScaleValue}
						oninput={(e) => setCoverScale(node, e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>fit</span>
					<select
						value={coverFitValue}
						onchange={(e) => setCoverFit(node, e.currentTarget.value as 'cover' | 'contain')}
					>
						<option value="cover">cover (fill, may crop)</option>
						<option value="contain">contain (fit inside)</option>
					</select>
				</label>
			</div>
			<p class="muted small">
				Uniform zoom on the cover — <strong>1</strong> = exact edge-to-edge. Use
				<strong>scale.x</strong> / <strong>scale.y</strong> in Transform to stretch it (e.g. 1.0 ×
				1.2 = taller).
				{#if usesPreviewArtFit}Fit is stored on the preview art.{/if}
			</p>
		</section>
	{/if}

	{#if editableParams.length > 0}
		<section>
			<h3>{node.label ?? 'Component'} — params</h3>
			<p class="muted small">
				Coded element — edit its appearance here. Placement, scale + visibility are the transform
				above.
			</p>
			{#each editableParams as p (p.key)}
				<div class="row">
					<label class="field wide">
						<span>{p.label}</span>
						{#if p.kind === 'font'}
							{@const custom = paramFontCustom(node, p)}
							<select
								value={(readParam(node, p) as string) ?? ''}
								onchange={(e) => writeParam(node, p, e.currentTarget.value)}
							>
								<option value="">(coded default)</option>
								{#each fontList as f (f.id)}
									<option value={f.name}>{f.name} [{f.kind}]</option>
								{/each}
								{#if custom}
									<option value={custom}>{custom} (custom)</option>
								{/if}
							</select>
						{:else if p.kind === 'number'}
							<input
								type="number"
								step="1"
								placeholder={p.placeholder ?? '(default)'}
								value={(readParam(node, p) as number) ?? ''}
								oninput={(e) =>
									writeParam(
										node,
										p,
										Number.isNaN(e.currentTarget.valueAsNumber)
											? undefined
											: e.currentTarget.valueAsNumber,
									)}
							/>
						{:else if p.kind === 'color'}
							{@const cv = readParam(node, p)}
							<span class="color-cell">
								<input
									type="color"
									value={cv !== undefined ? hexFrom(cv as number) : '#ffffff'}
									oninput={(e) => writeColorParam(node, p, e.currentTarget.value)}
								/>
								{#if cv !== undefined}
									<button
										type="button"
										class="reset"
										title="Clear"
										onclick={() => writeParam(node, p, undefined)}>×</button
									>
								{/if}
							</span>
						{:else if p.kind === 'boolean'}
							<input
								type="checkbox"
								checked={!!readParam(node, p)}
								onchange={(e) => writeParam(node, p, e.currentTarget.checked ? true : undefined)}
							/>
						{:else}
							<input
								type="text"
								placeholder={p.key === 'text'
									? hudDefaultText || '(coded default)'
									: (p.placeholder ?? '')}
								value={(readParam(node, p) as string) ?? ''}
								oninput={(e) => writeParam(node, p, e.currentTarget.value)}
							/>
						{/if}
					</label>
				</div>
			{/each}
			{#if editableParams.some((p) => p.kind === 'font') && fontList.length === 0}
				<p class="muted small">
					No fonts synced for this project — run <code>scripts/r2-sync-fonts.mjs</code> to populate the
					catalog.
				</p>
			{/if}
		</section>
	{/if}

	{#if node.kind === 'sprite'}
		<section>
			<h3>Sprite</h3>
			<div class="row">
				<label class="field">
					<span>width</span>
					<input
						type="number"
						step="1"
						value={t.width ?? ''}
						oninput={(e) => setSpriteSize(node, 'width', e.currentTarget.valueAsNumber)}
					/>
					{#if isOverrideMode && hasOverrideKey(node, 'width')}
						<span class="ovdot" title="Overridden"></span>
						<button class="reset" onclick={() => clearOverrideKey(node, 'width')}>×</button>
					{/if}
				</label>
				<label class="field">
					<span>height</span>
					<input
						type="number"
						step="1"
						value={t.height ?? ''}
						oninput={(e) => setSpriteSize(node, 'height', e.currentTarget.valueAsNumber)}
					/>
					{#if isOverrideMode && hasOverrideKey(node, 'height')}
						<span class="ovdot" title="Overridden"></span>
						<button class="reset" onclick={() => clearOverrideKey(node, 'height')}>×</button>
					{/if}
				</label>
			</div>
			<div class="row">
				<label class="field wide">
					<span>tint</span>
					<input
						type="color"
						value={hexFrom(t.tint)}
						onchange={(e) => setTintHex(node, e.currentTarget.value)}
					/>
					{#if isOverrideMode && hasOverrideKey(node, 'tint')}
						<span class="ovdot" title="Overridden"></span>
						<button class="reset" onclick={() => clearOverrideKey(node, 'tint')}>×</button>
					{/if}
				</label>
			</div>
		</section>
		{#if componentMode && componentParams.length > 0}
			<section>
				<h3>Bind to param</h3>
				<p class="muted small">
					Drive this sprite from a component param, so one prefab renders a different image / colour
					per instance. Pick a param below; leave a field as <em>(none)</em> to keep the static
					value above. Need one? Add it under <strong>Component variables → Your params</strong>.
				</p>
				<div class="bind-grid">
					<!-- The two image fields are mutually exclusive PER PARAM: one param value
					     can't be both a frame name and an R2 asset key, so binding one side to
					     a param the other side already uses clears the other side. -->
					<label class="field wide">
						<span>Image — atlas frame ← param</span>
						<select
							value={node.paramBindings?.['region'] ?? ''}
							onchange={(e) => {
								const key = e.currentTarget.value;
								if (key && node.paramBindings?.['assetKey'] === key)
									setParamBinding(node, 'assetKey', '');
								setParamBinding(node, 'region', key);
							}}
						>
							<option value="">(none)</option>
							{#each paramsForKinds(['string', 'image']) as p (p.key)}
								<option value={p.key}>{p.key}</option>
							{/each}
						</select>
						<span class="bind-hint">A frame name inside an atlas — most packed art uses this.</span>
					</label>
					<label class="field wide">
						<span>Image — whole texture ← param</span>
						<select
							value={node.paramBindings?.['assetKey'] ?? ''}
							onchange={(e) => {
								const key = e.currentTarget.value;
								if (key && node.paramBindings?.['region'] === key)
									setParamBinding(node, 'region', '');
								setParamBinding(node, 'assetKey', key);
							}}
						>
							<option value="">(none)</option>
							{#each paramsForKinds(['string']) as p (p.key)}
								<option value={p.key}>{p.key}</option>
							{/each}
						</select>
						<span class="bind-hint"
							>A standalone image or a different atlas — only if the frame lives elsewhere. Picking
							a param already used by the frame field moves it here.</span
						>
					</label>
					<label class="field wide">
						<span>Tint ← param</span>
						<select
							value={node.paramBindings?.['tint'] ?? ''}
							onchange={(e) => setParamBinding(node, 'tint', e.currentTarget.value)}
						>
							<option value="">(none)</option>
							{#each paramsForKinds(['color', 'number']) as p (p.key)}
								<option value={p.key}>{p.key}</option>
							{/each}
						</select>
						<span class="bind-hint">Colour multiply — needs a color param.</span>
					</label>
				</div>
				{#if node.paramBindings?.['tint'] || node.paramBindings?.['assetKey'] || node.paramBindings?.['region']}
					<p class="muted small">
						Bound fields read their param in each instance; the static value above is ignored.
					</p>
				{/if}
			</section>
		{/if}
	{:else if node.kind === 'spine'}
		{@const meta = spineMetaFor(node.assetKey)}
		<section>
			<h3>Spine</h3>
			<div class="row">
				<label class="field wide">
					<span>default animation</span>
					{#if meta?.animations?.length}
						<select
							value={node.defaultAnimation ?? ''}
							onchange={(e) => {
								node.defaultAnimation = e.currentTarget.value || undefined;
								markDirty();
							}}
						>
							<option value="">(first / default)</option>
							{#each meta.animations as anim (anim)}
								<option value={anim}>{anim}</option>
							{/each}
						</select>
					{:else}
						<input
							type="text"
							value={node.defaultAnimation ?? ''}
							oninput={(e) => {
								node.defaultAnimation = e.currentTarget.value;
								markDirty();
							}}
						/>
					{/if}
				</label>
			</div>
			<div class="row">
				<label class="field wide">
					<span>skin</span>
					{#if meta?.skins?.length}
						<select
							value={node.skin ?? ''}
							onchange={(e) => {
								node.skin = e.currentTarget.value || undefined;
								markDirty();
							}}
						>
							<option value="">(default skin)</option>
							{#each meta.skins as skin (skin)}
								<option value={skin}>{skin}</option>
							{/each}
						</select>
					{:else}
						<input
							type="text"
							value={node.skin ?? ''}
							oninput={(e) => {
								node.skin = e.currentTarget.value || undefined;
								markDirty();
							}}
						/>
					{/if}
				</label>
			</div>
			<div class="row">
				<label class="field check">
					<input
						type="checkbox"
						checked={node.loop ?? false}
						onchange={(e) => {
							node.loop = e.currentTarget.checked;
							markDirty();
						}}
					/>
					<span>loop</span>
				</label>
			</div>
			<div class="row">
				<label class="field">
					<span>width</span>
					<input
						type="number"
						step="1"
						placeholder="(scale)"
						value={t.width ?? ''}
						oninput={(e) => setSpineSize(node, 'width', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>height</span>
					<input
						type="number"
						step="1"
						placeholder="(scale)"
						value={t.height ?? ''}
						oninput={(e) => setSpineSize(node, 'height', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>
			<p class="muted small">
				Set an explicit <strong>width × height</strong> to pin the spine's on-screen size — it fits
				the skeleton to this box so the editor preview matches the game (best for a rig with no
				natural bounds). Leave blank to size by <strong>scale</strong> instead; setting a size resets
				scale to 1 so the number is exact.
			</p>
			{#if componentSignals.length > 0}
				<h4 class="sub-h">Plays on signal</h4>
				<p class="muted small">
					When the component's signal fires (the game wires it to a book event), this spine plays
					the chosen animation.
				</p>
				{#each node.cues ?? [] as cue, i (i)}
					<div class="bind-grid cue-row">
						<label class="field">
							<span>signal</span>
							<select
								value={cue.signal}
								onchange={(e) => updateCue(node as SpineNode, i, { signal: e.currentTarget.value })}
							>
								{#each componentSignals as s (s.key)}
									<option value={s.key} title={s.note ?? undefined}>{s.key}</option>
								{/each}
							</select>
						</label>
						<label class="field">
							<span>animation</span>
							{#if meta?.animations?.length}
								<select
									value={cue.animation}
									onchange={(e) =>
										updateCue(node as SpineNode, i, { animation: e.currentTarget.value })}
								>
									<option value="">(choose animation)</option>
									{#each meta.animations as anim (anim)}
										<option value={anim}>{anim}</option>
									{/each}
								</select>
							{:else}
								<input
									type="text"
									value={cue.animation}
									oninput={(e) =>
										updateCue(node as SpineNode, i, { animation: e.currentTarget.value })}
								/>
							{/if}
						</label>
						<label class="field check">
							<input
								type="checkbox"
								checked={cue.loop ?? false}
								onchange={(e) =>
									updateCue(node as SpineNode, i, {
										loop: e.currentTarget.checked || undefined,
									})}
							/>
							<span>loop</span>
							<button
								type="button"
								class="param-remove"
								title="Remove cue"
								onclick={() => removeCue(node as SpineNode, i)}>×</button
							>
						</label>
					</div>
				{/each}
				<button type="button" class="ghost-sm" onclick={() => addCue(node as SpineNode)}>
					+ add cue
				</button>
			{:else if componentMode}
				<p class="muted small">Declare a signal on this component to add playback cues.</p>
			{/if}
			{#if componentMode}
				<h4 class="sub-h">Plays on button state</h4>
				{#if isInteractiveComponent}
					<p class="muted small">
						Drive this spine by the button's interaction state — pick an animation per state. The
						button plays it while that state is active and returns to the <strong
							>default animation</strong
						> above when none is. Leave a state blank to cascade (pressed → hover → selected).
					</p>
					<p class="muted small">
						<strong>Image at rest, spine on a state?</strong> Leave the
						<strong>default animation</strong>
						(above) blank — the spine then stays HIDDEN at rest (your button image shows) and only appears
						while a mapped state plays. For <strong>during the spin</strong>, map
						<strong>spinning</strong> (not downstate): a spin sets both, and spinning wins.
					</p>
					{#each BUTTON_ANIM_STATES as st (st.key)}
						{@const cur = stateAnimOf(node as SpineNode, st.key)}
						<div class="bind-grid cue-row">
							<label class="field">
								<span>{st.label}</span>
								{#if meta?.animations?.length}
									<select
										value={cur?.animation ?? ''}
										onchange={(e) => setStateAnim(node as SpineNode, st.key, e.currentTarget.value)}
									>
										<option value="">(none)</option>
										{#each meta.animations as anim (anim)}
											<option value={anim}>{anim}</option>
										{/each}
									</select>
								{:else}
									<input
										type="text"
										placeholder="animation name"
										value={cur?.animation ?? ''}
										oninput={(e) => setStateAnim(node as SpineNode, st.key, e.currentTarget.value)}
									/>
								{/if}
							</label>
							<label class="field check">
								<input
									type="checkbox"
									checked={cur?.loop ?? false}
									disabled={!cur}
									onchange={(e) =>
										setStateAnimLoop(node as SpineNode, st.key, e.currentTarget.checked)}
								/>
								<span>loop</span>
							</label>
						</div>
					{/each}
				{:else}
					<p class="muted small">
						Add an <strong>action</strong> variable above (which makes this component an interactive
						button) to drive this spine by hover / press / selected / state.
					</p>
				{/if}
			{/if}
		</section>
	{:else if node.kind === 'reelGrid'}
		<section>
			<h3>Reel grid</h3>
			<p class="muted small">
				Board layout — position, cell size, non-square cell width/height, gaps and reel/row padding
				all drive the LIVE in-game board. Reels/rows are descriptive (the RGS sets the real board
				shape; a mismatch only warns). Symbol art keeps its aspect (Stake sizing); gaps space the
				cells, padding insets the whole grid. Position the grid with the Transform section above.
			</p>
			<div class="row">
				<label class="field">
					<span>reels (cols)</span>
					<input
						type="number"
						step="1"
						min="1"
						value={node.reels}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							if (!Number.isNaN(v)) {
								node.reels = Math.max(1, Math.round(v));
								markDirty();
							}
						}}
					/>
				</label>
				<label class="field">
					<span>rows</span>
					<input
						type="number"
						step="1"
						min="1"
						value={node.rows}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							if (!Number.isNaN(v)) {
								node.rows = Math.max(1, Math.round(v));
								markDirty();
							}
						}}
					/>
				</label>
			</div>
			<div class="row">
				<label class="field">
					<span>cell size</span>
					<input
						type="number"
						step="1"
						min="1"
						value={node.cellSize}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							if (!Number.isNaN(v) && v > 0) {
								node.cellSize = v;
								markDirty();
							}
						}}
					/>
				</label>
			</div>
			<p class="muted small">
				Leave cell width/height blank for a square cell (= cell size). Gaps add empty space BETWEEN
				cells; padding insets the whole grid.
			</p>
			<div class="row">
				<label class="field">
					<span>cell width</span>
					<input
						type="number"
						step="1"
						min="1"
						placeholder={String(node.cellSize)}
						value={node.cellWidth ?? ''}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							node.cellWidth = Number.isFinite(v) && v > 0 ? v : undefined;
							markDirty();
						}}
					/>
				</label>
				<label class="field">
					<span>cell height</span>
					<input
						type="number"
						step="1"
						min="1"
						placeholder={String(node.cellSize)}
						value={node.cellHeight ?? ''}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							node.cellHeight = Number.isFinite(v) && v > 0 ? v : undefined;
							markDirty();
						}}
					/>
				</label>
			</div>
			<p class="muted small">
				Symbol size comes from the art — each symbol fits its cell automatically (crop the art to
				size it). There is no symbol-size number.
			</p>
			<div class="row">
				<label class="field">
					<span>gap X</span>
					<input
						type="number"
						step="1"
						placeholder="0"
						value={node.gapX ?? ''}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							node.gapX = Number.isFinite(v) && v !== 0 ? v : undefined;
							markDirty();
						}}
					/>
				</label>
				<label class="field">
					<span>gap Y</span>
					<input
						type="number"
						step="1"
						placeholder="0"
						value={node.gapY ?? ''}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							node.gapY = Number.isFinite(v) && v !== 0 ? v : undefined;
							markDirty();
						}}
					/>
				</label>
			</div>
			<div class="row">
				<label class="field">
					<span>reel padding</span>
					<input
						type="number"
						step="0.01"
						value={node.reelPadding ?? 0.5}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							if (!Number.isNaN(v)) {
								node.reelPadding = v;
								markDirty();
							}
						}}
					/>
				</label>
				<label class="field">
					<span>row padding</span>
					<input
						type="number"
						step="0.01"
						value={node.rowPadding ?? 0.5}
						oninput={(e) => {
							const v = e.currentTarget.valueAsNumber;
							if (!Number.isNaN(v)) {
								node.rowPadding = v;
								markDirty();
							}
						}}
					/>
				</label>
			</div>
			<details class="spin-tuning">
				<summary>Spin tuning (advanced)</summary>
				<p class="muted small">
					Animation feel, not layout — blank = the game's coded default. Speeds are px/ms; stagger
					is ms per reel; "length" scales how far the reel spins. Two profiles: <strong
						>Normal</strong
					>
					(also drives anticipation) and <strong>Turbo</strong>.
				</p>
				{#each [{ profile: 'normal', title: 'Normal' }, { profile: 'fast', title: 'Turbo' }] as p (p.profile)}
					<h4 class="spin-profile">{p.title}</h4>
					<div class="spin-grid">
						{#each SPIN_FIELDS as f (f.key)}
							<label class="field">
								<span>{f.label}</span>
								<input
									type="number"
									step="0.01"
									value={readSpin(node, p.profile as 'normal' | 'fast', f.key)}
									oninput={(e) =>
										writeSpin(
											node,
											p.profile as 'normal' | 'fast',
											f.key,
											e.currentTarget.valueAsNumber,
										)}
								/>
							</label>
						{/each}
					</div>
				{/each}
			</details>
			<details class="spin-tuning">
				<summary>Anticipation (advanced)</summary>
				<p class="muted small">
					Free-spin "hold" overlay — blank = the game's coded default. Ratios are multiples of one
					cell; the spine asset + animation names are the spine's track names.
				</p>
				<div class="spin-grid">
					{#each ANTICIPATION_NUM_FIELDS as f (f.key)}
						<label class="field">
							<span>{f.label}</span>
							<input
								type="number"
								step="0.01"
								value={readAnticipation(node, f.key)}
								oninput={(e) => writeAnticipation(node, f.key, e.currentTarget.valueAsNumber)}
							/>
						</label>
					{/each}
				</div>
				<div class="spin-grid">
					{#each ANTICIPATION_STR_FIELDS as f (f.key)}
						<label class="field">
							<span>{f.label}</span>
							<input
								type="text"
								value={readAnticipation(node, f.key)}
								oninput={(e) => writeAnticipation(node, f.key, e.currentTarget.value)}
							/>
						</label>
					{/each}
				</div>
			</details>
		</section>
	{:else if node.kind === 'text'}
		<section>
			<h3>Text</h3>
			{#if isTextExposed}
				<p class="muted small">
					Using exposed parameters — this text's content, font, size + colour are set per instance
					via the params grouped under <strong>{node.label || 'Text'}</strong>. Edit their defaults
					in the Component Variables panel.
				</p>
				<button
					type="button"
					class="ghost-sm"
					onclick={() => onUnexposeTextParams?.(node)}
					title="Drop the bindings + the params they created, restoring the static values"
				>
					Remove exposed parameters
				</button>
			{:else}
				<div class="row">
					<label class="field wide">
						<span>text</span>
						<textarea
							value={node.text}
							oninput={(e) => {
								node.text = e.currentTarget.value;
								markDirty();
							}}
						></textarea>
					</label>
				</div>
				{#if node.paramBindings?.['text']}
					<p class="muted small">
						bound to {node.paramBindings['text']} — static value ignored in instances
					</p>
				{/if}

				<div class="row">
					<label class="field wide">
						<span>font family</span>
						<select
							value={node.style?.fontFamily ?? ''}
							onchange={(e) => setStyleString(node, 'fontFamily', e.currentTarget.value)}
						>
							<option value="">(game default)</option>
							{#each fontList as f (f.id)}
								<option value={f.name}>{f.name} [{f.kind}]</option>
							{/each}
							{#if customFamily}
								<option value={customFamily}>{customFamily} (custom)</option>
							{/if}
						</select>
					</label>
				</div>
				{#if node.paramBindings?.['style.fontFamily']}
					<p class="muted small">
						bound to {node.paramBindings['style.fontFamily']} — static value ignored in instances
					</p>
				{/if}
				{#if fontList.length === 0}
					<p class="muted small">
						No fonts synced for this project — run <code>scripts/r2-sync-fonts.mjs</code> to populate
						the catalog.
					</p>
				{/if}
				{#if isBitmapSelected}
					<p class="muted small">
						Bitmap font: tint + size only (size scales the baked atlas — large sizes soften). Weight
						/ style / stroke / shadow don't apply.
					</p>
				{/if}

				<div class="row">
					<label class="field">
						<span>font size</span>
						<input
							type="number"
							step="1"
							value={node.style?.fontSize ?? 24}
							oninput={(e) => setStyleNumber(node, 'fontSize', e.currentTarget.valueAsNumber)}
						/>
					</label>
					<label class="field">
						<span>{isBitmapSelected ? 'tint' : 'fill'}</span>
						<input
							type="color"
							value={hexFrom(node.style?.fill)}
							onchange={(e) => setFill(node, e.currentTarget.value)}
						/>
					</label>
				</div>
				{#if node.paramBindings?.['style.fontSize']}
					<p class="muted small">
						font size bound to {node.paramBindings['style.fontSize']} — static value ignored in instances
					</p>
				{/if}
				{#if node.paramBindings?.['style.fill']}
					<p class="muted small">
						{isBitmapSelected ? 'tint' : 'fill'} bound to {node.paramBindings['style.fill']} — static
						value ignored in instances
					</p>
				{/if}
			{/if}

			{#if componentMode && !isTextExposed}
				<section>
					<button
						type="button"
						class="ghost-sm"
						onclick={() => onExposeTextParams?.(node)}
						title="Create + bind params for this text node's content, font, size and colour"
					>
						✨ Expose text as params (per instance)
					</button>
					<p class="muted small">
						One click — makes this text's content, font, size + colour editable per instance,
						grouped under <strong>{node.label || 'Text'}</strong>.
					</p>
				</section>
			{/if}

			{#if componentMode && componentParams.length > 0 && !isTextExposed}
				<section>
					<h3>Bind to param</h3>
					<p class="muted small">
						Inside a component instance, a bound field reads the resolved param instead of the
						static value above.
					</p>
					<div class="row">
						<label class="field">
							<span>Text ← param</span>
							<select
								value={node.paramBindings?.['text'] ?? ''}
								onchange={(e) => setParamBinding(node, 'text', e.currentTarget.value)}
							>
								<option value="">(none)</option>
								{#each paramsForKinds(['string', 'number']) as p (p.key)}
									<option value={p.key}>{p.key} [{p.kind}]</option>
								{/each}
							</select>
						</label>
						<label class="field">
							<span>Font ← param</span>
							<select
								value={node.paramBindings?.['style.fontFamily'] ?? ''}
								onchange={(e) => setParamBinding(node, 'style.fontFamily', e.currentTarget.value)}
							>
								<option value="">(none)</option>
								{#each paramsForKinds(['string']) as p (p.key)}
									<option value={p.key}>{p.key} [{p.kind}]</option>
								{/each}
							</select>
						</label>
					</div>
					<div class="row">
						<label class="field">
							<span>Font size ← param</span>
							<select
								value={node.paramBindings?.['style.fontSize'] ?? ''}
								onchange={(e) => setParamBinding(node, 'style.fontSize', e.currentTarget.value)}
							>
								<option value="">(none)</option>
								{#each paramsForKinds(['number']) as p (p.key)}
									<option value={p.key}>{p.key} [{p.kind}]</option>
								{/each}
							</select>
						</label>
						<label class="field">
							<span>Colour ← param</span>
							<select
								value={node.paramBindings?.['style.fill'] ?? ''}
								onchange={(e) => setParamBinding(node, 'style.fill', e.currentTarget.value)}
							>
								<option value="">(none)</option>
								{#each paramsForKinds(['color', 'number']) as p (p.key)}
									<option value={p.key}>{p.key} [{p.kind}]</option>
								{/each}
							</select>
						</label>
					</div>
				</section>
			{/if}

			<div class="row">
				<label class="field">
					<span>weight</span>
					<select
						value={node.style?.fontWeight ?? 'normal'}
						onchange={(e) => setStyleString(node, 'fontWeight', e.currentTarget.value)}
					>
						<option value="normal">normal</option>
						<option value="bold">bold</option>
						<option value="100">100</option>
						<option value="200">200</option>
						<option value="300">300</option>
						<option value="400">400</option>
						<option value="500">500</option>
						<option value="600">600</option>
						<option value="700">700</option>
						<option value="800">800</option>
						<option value="900">900</option>
					</select>
				</label>
				<label class="field">
					<span>style</span>
					<select
						value={node.style?.fontStyle ?? 'normal'}
						onchange={(e) => setStyleString(node, 'fontStyle', e.currentTarget.value)}
					>
						<option value="normal">normal</option>
						<option value="italic">italic</option>
						<option value="oblique">oblique</option>
					</select>
				</label>
			</div>

			<div class="row">
				<label class="field">
					<span>align</span>
					<select
						value={node.style?.align ?? 'left'}
						onchange={(e) => setStyleString(node, 'align', e.currentTarget.value)}
					>
						<option value="left">left</option>
						<option value="center">center</option>
						<option value="right">right</option>
						<option value="justify">justify</option>
					</select>
				</label>
				<label class="field">
					<span>line height</span>
					<input
						type="number"
						step="1"
						value={node.style?.lineHeight ?? ''}
						oninput={(e) => setStyleNumber(node, 'lineHeight', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>

			<div class="row">
				<label class="field">
					<span>letter spacing</span>
					<input
						type="number"
						step="0.5"
						value={node.style?.letterSpacing ?? ''}
						oninput={(e) => setStyleNumber(node, 'letterSpacing', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>

			<div class="row">
				<label class="field check">
					<input
						type="checkbox"
						checked={node.style?.wordWrap ?? false}
						onchange={(e) => setStyleBool(node, 'wordWrap', e.currentTarget.checked)}
					/>
					<span>word wrap</span>
				</label>
				<label class="field check">
					<input
						type="checkbox"
						checked={node.style?.breakWords ?? false}
						onchange={(e) => setStyleBool(node, 'breakWords', e.currentTarget.checked)}
					/>
					<span>break words</span>
				</label>
			</div>

			{#if node.style?.wordWrap}
				<div class="row">
					<label class="field wide">
						<span>wrap width (px)</span>
						<input
							type="number"
							step="1"
							value={node.style?.wordWrapWidth ?? ''}
							oninput={(e) => setStyleNumber(node, 'wordWrapWidth', e.currentTarget.valueAsNumber)}
						/>
					</label>
				</div>
			{/if}
		</section>

		{#if !isBitmapSelected}
			<section>
				<h3>Stroke</h3>
				<div class="row">
					<label class="field">
						<span>color</span>
						<input
							type="color"
							value={hexFrom(node.style?.stroke?.color ?? 0x000000)}
							onchange={(e) => setStrokeColor(node, e.currentTarget.value)}
						/>
					</label>
					<label class="field">
						<span>width (0 = off)</span>
						<input
							type="number"
							step="1"
							min="0"
							value={node.style?.stroke?.width ?? ''}
							oninput={(e) => setStrokeWidth(node, e.currentTarget.valueAsNumber)}
						/>
					</label>
				</div>
			</section>

			<section>
				<h3>Drop shadow</h3>
				<div class="row">
					<label class="field check">
						<input
							type="checkbox"
							checked={!!node.style?.dropShadow}
							onchange={(e) => toggleDropShadow(node, e.currentTarget.checked)}
						/>
						<span>enabled</span>
					</label>
				</div>
				{#if node.style?.dropShadow}
					<div class="row">
						<label class="field">
							<span>color</span>
							<input
								type="color"
								value={hexFrom(node.style.dropShadow.color ?? 0x000000)}
								onchange={(e) => setDropShadowColor(node, e.currentTarget.value)}
							/>
						</label>
						<label class="field">
							<span>alpha</span>
							<input
								type="number"
								step="0.05"
								min="0"
								max="1"
								value={node.style.dropShadow.alpha ?? ''}
								oninput={(e) => setDropShadowNumber(node, 'alpha', e.currentTarget.valueAsNumber)}
							/>
						</label>
					</div>
					<div class="row">
						<label class="field">
							<span>blur</span>
							<input
								type="number"
								step="1"
								min="0"
								value={node.style.dropShadow.blur ?? ''}
								oninput={(e) => setDropShadowNumber(node, 'blur', e.currentTarget.valueAsNumber)}
							/>
						</label>
						<label class="field">
							<span>distance</span>
							<input
								type="number"
								step="1"
								value={node.style.dropShadow.distance ?? ''}
								oninput={(e) =>
									setDropShadowNumber(node, 'distance', e.currentTarget.valueAsNumber)}
							/>
						</label>
					</div>
					<div class="row">
						<label class="field wide">
							<span>angle (°)</span>
							<input
								type="number"
								step="1"
								value={rad2deg(node.style.dropShadow.angle)}
								oninput={(e) =>
									setDropShadowNumber(node, 'angle', deg2rad(e.currentTarget.valueAsNumber))}
							/>
						</label>
					</div>
				{/if}
			</section>
		{/if}
	{:else if node.kind === 'rect'}
		<section>
			<h3>Rect</h3>
			<div class="row">
				<label class="field">
					<span>width</span>
					<input
						type="number"
						step="1"
						value={t.width ?? node.width}
						oninput={(e) => setSpriteSize(node, 'width', e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>height</span>
					<input
						type="number"
						step="1"
						value={t.height ?? node.height}
						oninput={(e) => setSpriteSize(node, 'height', e.currentTarget.valueAsNumber)}
					/>
				</label>
			</div>
			<div class="row">
				<label class="field wide">
					<span>colour</span>
					<input
						type="color"
						value={hexFrom(node.color)}
						onchange={(e) => setRectColor(node, e.currentTarget.value)}
					/>
				</label>
			</div>
			<p class="muted small">
				Opacity is the <strong>Transform → alpha</strong> above (0 = transparent, 1 = solid).
			</p>
		</section>
	{/if}
{/if}

<style>
	.head {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-bottom: 14px;
		padding-bottom: 12px;
		border-bottom: 1px solid #1c1c24;
	}
	.title {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.title strong {
		color: #e8e8ee;
		font-size: 13px;
	}
	.kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
		padding: 1px 6px;
		border: 1px solid #2a2a33;
		border-radius: 4px;
	}
	.kind.locked {
		color: #f0c878;
		border-color: #3a3020;
	}
	.outdated {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin: 6px 0 4px;
		padding: 8px;
		border: 1px solid #4a3a1a;
		border-radius: 4px;
		background: #2a2210;
	}
	.outdated-msg {
		margin: 0;
		font-size: 11px;
		color: #f0c878;
	}
	.kind.role {
		text-transform: none;
		letter-spacing: 0;
		color: #c8a3ff;
		border-color: #2a2433;
	}
	.ctx code {
		color: #c8a3ff;
		font-family: ui-monospace, monospace;
		font-size: 11px;
	}
	.ctx {
		font-size: 11px;
		color: #777;
	}
	.ctx.override {
		color: #c8a3ff;
	}
	.ctx strong {
		color: inherit;
	}
	section {
		margin-bottom: 14px;
	}
	h3 {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 0 0 8px;
	}
	.row {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
	}
	.field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
		position: relative;
	}
	.field.wide {
		flex: 1 1 100%;
	}
	.field.check {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.sub-label {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.row.visible-for {
		flex-wrap: wrap;
		gap: 6px 12px;
	}
	.row.anchor-presets {
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 6px;
	}
	.field input[type='number'],
	.field input[type='text'],
	.field select,
	.field textarea {
		background: #0b0b10;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		padding: 6px 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-family: inherit;
		width: 100%;
		box-sizing: border-box;
	}
	.field textarea {
		min-height: 60px;
		resize: vertical;
	}
	.field input:focus,
	.field select:focus,
	.field textarea:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.ovdot {
		position: absolute;
		top: 0;
		right: 18px;
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #c8a3ff;
	}
	.reset {
		position: absolute;
		top: -3px;
		right: 0;
		background: transparent;
		border: none;
		color: #c8a3ff;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 2px 4px;
	}
	.reset:hover {
		color: #fff;
	}
	.field.check .ovdot {
		position: static;
	}
	.field.check .reset {
		position: static;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.spin-tuning {
		margin-top: 8px;
		border-top: 1px solid #2a2433;
		padding-top: 8px;
	}
	.spin-tuning > summary {
		cursor: pointer;
		font-size: 12px;
		color: #9a8fb0;
		user-select: none;
	}
	.spin-profile {
		margin: 8px 0 4px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
	}
	.spin-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 6px;
	}
	.ghost-sm {
		align-self: flex-start;
		background: transparent;
		border: 1px solid #2a2a33;
		color: #ccc;
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 11px;
		cursor: pointer;
	}
	.ghost-sm:hover:not(:disabled) {
		border-color: #6b5bff;
	}
	.ghost-sm:disabled {
		opacity: 0.4;
		cursor: default;
	}
	.ghost-sm.danger {
		color: #ff9a9a;
		border-color: #4a2a30;
	}
	.ghost-sm.atlas-link {
		display: inline-block;
		margin-top: 6px;
		text-decoration: none;
	}
	.slot-section {
		padding: 10px;
		border: 1px solid #2a2433;
		border-radius: 8px;
		background: #16131c;
	}
	.slot-section h3 {
		color: #c8a3ff;
	}
	.bg-section {
		padding: 10px;
		border: 1px solid #243329;
		border-radius: 8px;
		background: #131c16;
	}
	.bg-section h3 {
		color: #7ee0c0;
	}
	.slot-hint {
		margin: 4px 0 0;
		font-size: 11px;
		color: #777;
	}
	.cmp-vars {
		padding: 10px;
		border: 1px solid #2a2433;
		border-radius: 8px;
		background: #16131c;
		margin-bottom: 14px;
	}
	.cmp-vars h3 {
		color: #c8a3ff;
	}
	.cmp-vars h4 {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #999;
		margin: 10px 0 4px;
	}
	.sub-h {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 8px 0 4px;
	}
	.picker {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.picker li {
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.pick {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #c8c8d0;
		cursor: pointer;
	}
	.pick-label {
		flex: 1;
	}
	.pick-kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
	}
	.param-default {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-left: 4px;
	}
	.param-default > span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
		width: 48px;
	}
	.param-default > input[type='text'],
	.param-default > input[type='number'] {
		flex: 1;
		min-width: 0;
	}
	.param-remove {
		margin-left: auto;
		width: 18px;
		height: 18px;
		line-height: 1;
		padding: 0;
		border: 1px solid #444;
		border-radius: 4px;
		background: transparent;
		color: #b06a6a;
		cursor: pointer;
	}
	.param-remove:hover {
		background: #3a2222;
		border-color: #774444;
	}
	.bind-grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.bind-hint {
		font-size: 10px;
		color: #777;
		line-height: 1.3;
	}
	.cue-row {
		gap: 6px;
		padding: 8px;
		margin-bottom: 6px;
		border: 1px solid #2a2a33;
		border-radius: 6px;
	}
	.cue-row .param-remove {
		margin-left: auto;
	}
	.param-group {
		border: 1px solid #2a2a33;
		border-radius: 4px;
		margin: 6px 0;
		padding: 2px 6px 4px;
	}
	.param-group > summary {
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
		color: #c8c8d0;
		padding: 4px 2px;
		list-style: none;
	}
	.param-group > summary::-webkit-details-marker {
		display: none;
	}
	.param-group > summary::before {
		content: '▸ ';
		color: #777;
	}
	.param-group[open] > summary::before {
		content: '▾ ';
	}
	.color-cell {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.color-cell input[type='color'] {
		width: 40px;
		height: 24px;
		padding: 0;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		background: transparent;
		cursor: pointer;
	}
	.add-param {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}
	.add-param input {
		flex: 1;
		min-width: 0;
	}
	.add-param button {
		white-space: nowrap;
	}
	.vars-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin: 12px 0 4px;
	}
	.vars-head h4 {
		margin: 0;
	}
	.picker-anchor {
		position: relative;
	}
	.picker-pop {
		position: absolute;
		top: calc(100% + 4px);
		right: 0;
		z-index: 20;
		width: 240px;
		max-height: 320px;
		display: flex;
		flex-direction: column;
		background: #1b1722;
		border: 1px solid #38314a;
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
		padding: 8px;
	}
	.picker-search {
		width: 100%;
		box-sizing: border-box;
		margin-bottom: 6px;
	}
	.picker-scroll {
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.picker-group-title {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #8a7aa8;
		margin: 6px 0 2px;
	}
	.picker-hint {
		margin: 0 0 4px;
	}
	.picker-empty {
		margin: 2px 0;
	}
	.picker-option {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		text-align: left;
		background: transparent;
		border: 1px solid transparent;
		border-radius: 6px;
		color: #c8c8d0;
		padding: 5px 6px;
		font-size: 12px;
		cursor: pointer;
	}
	.picker-option:hover:not(:disabled) {
		background: #251f33;
		border-color: #4a3f63;
	}
	.picker-option:disabled {
		opacity: 0.45;
		cursor: default;
	}
	.opt-label {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.opt-kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
	}
	.opt-note {
		flex: 2;
		min-width: 0;
		font-size: 10px;
		color: #666;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.opt-inuse {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #7ee0c0;
		border: 1px solid #2a4a3f;
		border-radius: 4px;
		padding: 1px 4px;
	}
	.var-rows {
		list-style: none;
		padding: 0;
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.var-row {
		border: 1px solid #2a2433;
		border-radius: 6px;
		padding: 5px 7px;
		background: #18141f;
	}
	.var-row-head {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #c8c8d0;
	}
	.var-icon {
		color: #8a7aa8;
		font-size: 11px;
		width: 12px;
		text-align: center;
	}
	.var-name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.var-badge {
		font-size: 9px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #9a9aa8;
		border: 1px solid #3a3a46;
		border-radius: 4px;
		padding: 1px 5px;
	}
	.var-badge.engine {
		color: #8fc6ff;
		border-color: #2c4564;
		background: #18222e;
	}
	.var-kind {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
	}
	.var-row .param-default {
		margin-top: 5px;
		padding-left: 20px;
	}
</style>
