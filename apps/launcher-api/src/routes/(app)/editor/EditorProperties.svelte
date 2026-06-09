<script lang="ts">
	import {
		backgroundCoverScale,
		backgroundFit,
		defaultHudText,
		ENGINE_PARAM_CATALOG,
		ENGINE_SIGNAL_CATALOG,
		getEditableParams,
		isHudButtonBind,
		resolveTransform,
		type ComponentDef,
		type ComponentParam,
		type ComponentSignal,
		type ContainerNode,
		type EditableParam,
		type LayoutNode,
		type LayoutType,
		type NodeOverride,
		type TextStyle,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import { fetchFontCatalog, type EditorFont } from './fonts.client';
	import RegionPicker from './RegionPicker.svelte';

	interface Props {
		node: LayoutNode | null;
		layoutType: LayoutType;
		/** Called after any user-driven mutation to the selected node. */
		onDirty?: () => void;
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
		/** Declare a custom (author-defined) param on the draft component (component mode). */
		onAddParam?: (key: string, kind: ComponentParam['kind']) => void;
		/** Remove a custom (author-defined) param from the draft component (component mode). */
		onRemoveParam?: (key: string) => void;
		/** Toggle an engine-catalog signal on the draft component (component mode). */
		onToggleSignal?: (key: string) => void;
		/** Set / clear an author param override on the selected instance (scene mode). */
		onSetInstanceParam?: (key: string, value: unknown) => void;
		/** "Edit in Component Editor": open the selected instance's def (`componentId`) in
		 * the standalone Component Editor (new tab). Scene mode, componentInstance only. */
		onOpenComponentEditor?: (componentId: string) => void;
	}
	let {
		node,
		layoutType,
		onDirty,
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
		onEditAsComponent,
		onConvertToReelGrid,
		onConvertToParametricButton,
		onToggleParam,
		onAddParam,
		onRemoveParam,
		onToggleSignal,
		onSetInstanceParam,
		onOpenComponentEditor,
	}: Props = $props();

	/** Author-settable (non-engineProvided) params an instance may override. */
	const authorParams = $derived((instanceComponent?.params ?? []).filter((p) => !p.engineProvided));
	/** The open component's value-source binding (a param with an `options` enum, e.g.
	 * the readout's `source`). When present the component is engine-fed THROUGH it, so
	 * the literal engine-param checklist is inert — we show the binding instead. */
	const sourceParam = $derived(componentParams.find((p) => (p.options?.length ?? 0) > 0));
	/** Params the author added here (flagged `author`) — the only ones shown as
	 * removable, so a component's built-in/coded params can't be deleted by mistake. */
	const customParams = $derived(componentParams.filter((p) => p.author === true));
	let newParamKey = $state('');
	let newParamKind = $state<ComponentParam['kind']>('string');
	function addCustomParam(): void {
		const key = newParamKey.trim();
		if (!key) return;
		onAddParam?.(key, newParamKind);
		newParamKey = '';
		newParamKind = 'string';
	}
	function paramHas(key: string): boolean {
		return componentParams.some((p) => p.key === key);
	}
	function signalHas(key: string): boolean {
		return componentSignals.some((s) => s.key === key);
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
		} else if (n.kind === 'sprite' || n.kind === 'spine') {
			(n as Record<string, unknown>)[axis] = value;
		}
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
</script>

{#if componentMode}
	<!-- Component-level metadata (§8.4 / §8.5): declare the params the ENGINE feeds +
	     the signals it fires, by picking from the curated catalog. Metadata only —
	     no timeline/behaviour authoring in v1. Shown above any selected-node fields. -->
	<section class="cmp-vars">
		<h3>Component variables</h3>
		<p class="muted small">
			Declare the values the engine feeds (params) and the moments it fires (signals). These are the <strong
				>declare</strong
			> half — the game wires + supplies them.
		</p>
		<h4>Engine params</h4>
		{#if sourceParam}
			<!-- Engine-fed readout: the value is bound through a `source` param (a value
			     feed picked from a closed set), NOT by ticking literal bet/win/balance — so
			     the checklist would be inert here. Show the binding instead. -->
			<p class="muted small">
				Engine-fed: this component shows the live <strong>value</strong> of its
				<strong>{sourceParam.key}</strong> — one of
				<em>{sourceParam.options?.join(' · ')}</em>. Set the default source under
				<strong>Defaults</strong>, and pick the source per placement when you drop it in a scene.
			</p>
		{:else}
			<ul class="picker">
				{#each ENGINE_PARAM_CATALOG as p (p.key)}
					<li>
						<label class="pick">
							<input
								type="checkbox"
								checked={paramHas(p.key)}
								onchange={() => onToggleParam?.(p.key, p.kind)}
							/>
							<span class="pick-label">{p.label}</span>
							<span class="pick-kind">{p.kind}</span>
						</label>
						{#if p.note}<span class="pick-note">{p.note}</span>{/if}
					</li>
				{/each}
			</ul>
		{/if}
		<h4>Your params</h4>
		<p class="muted small">
			Custom inputs you add. Three steps: <strong>1.</strong> add a param here (e.g.
			<code>bg</code>, kind <em>string</em>) → <strong>2.</strong> select a node and, under its
			<strong>Bind to param</strong>, point a field (image / tint / text) at it →
			<strong>3.</strong>
			set its value per instance when you place the component in a scene.
		</p>
		{#if customParams.length > 0}
			<ul class="picker">
				{#each customParams as p (p.key)}
					<li class="author-param">
						<span class="pick-label">{p.key}</span>
						<span class="pick-kind">{p.kind}</span>
						<button
							type="button"
							class="param-remove"
							title="Remove param"
							onclick={() => onRemoveParam?.(p.key)}>×</button
						>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted small">None yet — add one below.</p>
		{/if}
		<div class="add-param">
			<input
				type="text"
				placeholder="param name, e.g. bg"
				bind:value={newParamKey}
				onkeydown={(e) => {
					if (e.key === 'Enter') addCustomParam();
				}}
			/>
			<select
				value={newParamKind}
				onchange={(e) => (newParamKind = e.currentTarget.value as ComponentParam['kind'])}
			>
				<option value="string">string</option>
				<option value="image">image</option>
				<option value="number">number</option>
				<option value="color">color</option>
				<option value="boolean">boolean</option>
			</select>
			<button type="button" disabled={!newParamKey.trim()} onclick={addCustomParam}>Add</button>
		</div>
		<h4>Engine signals</h4>
		<ul class="picker">
			{#each ENGINE_SIGNAL_CATALOG as s (s.key)}
				<li>
					<label class="pick">
						<input
							type="checkbox"
							checked={signalHas(s.key)}
							onchange={() => onToggleSignal?.(s.key)}
						/>
						<span class="pick-label">{s.label}</span>
					</label>
					{#if s.note}<span class="pick-note">{s.note}</span>{/if}
				</li>
			{/each}
		</ul>
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
				{#if authorParams.length > 0}
					<h4 class="sub-h">Params</h4>
					{#each authorParams as p (p.key)}
						<div class="row">
							<label class="field wide">
								<span>{p.key} ({p.kind})</span>
								{#if p.options && p.options.length > 0}
									<select
										value={(node.params?.[p.key] as string) ?? ''}
										onchange={(e) =>
											onSetInstanceParam?.(p.key, e.currentTarget.value || undefined)}
									>
										<option value="">(inherit default)</option>
										{#each p.options as opt (opt)}
											<option value={opt}>{opt}</option>
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
										onSelect={(region) => onSetInstanceParam?.(p.key, region || undefined)}
									/>
								{:else}
									<input
										type="text"
										value={(node.params?.[p.key] as string) ?? ''}
										oninput={(e) =>
											onSetInstanceParam?.(
												p.key,
												e.currentTarget.value === '' ? undefined : e.currentTarget.value,
											)}
									/>
								{/if}
							</label>
						</div>
					{/each}
				{:else}
					<p class="muted small">
						This component declares no author-set params (engine-provided params are fed at
						runtime).
					</p>
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
					<label class="field wide">
						<span>Image — atlas frame ← param</span>
						<select
							value={node.paramBindings?.['region'] ?? ''}
							onchange={(e) => setParamBinding(node, 'region', e.currentTarget.value)}
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
							onchange={(e) => setParamBinding(node, 'assetKey', e.currentTarget.value)}
						>
							<option value="">(none)</option>
							{#each paramsForKinds(['string']) as p (p.key)}
								<option value={p.key}>{p.key}</option>
							{/each}
						</select>
						<span class="bind-hint"
							>A standalone image or a different atlas — only if the frame lives elsewhere.</span
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
		<section>
			<h3>Spine</h3>
			<div class="row">
				<label class="field wide">
					<span>default animation</span>
					<input
						type="text"
						value={node.defaultAnimation ?? ''}
						oninput={(e) => {
							node.defaultAnimation = e.currentTarget.value;
							markDirty();
						}}
					/>
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
		</section>
	{:else if node.kind === 'reelGrid'}
		<section>
			<h3>Reel grid</h3>
			<p class="muted small">
				Board layout params — `SYMBOL_SIZE` / `BOARD_DIMENSIONS` / `REEL_PADDING`. Editor preview
				today; a later pass makes the in-game board read these. Position the grid with the Transform
				section above.
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
			</div>
		</section>
	{:else if node.kind === 'text'}
		<section>
			<h3>Text</h3>
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
					No fonts synced for this project — run <code>scripts/r2-sync-fonts.mjs</code> to populate the
					catalog.
				</p>
			{/if}
			{#if isBitmapSelected}
				<p class="muted small">
					Bitmap font: tint + size only (size scales the baked atlas — large sizes soften). Weight /
					style / stroke / shadow don't apply.
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
					{isBitmapSelected ? 'tint' : 'fill'} bound to {node.paramBindings['style.fill']} — static value
					ignored in instances
				</p>
			{/if}

			{#if componentMode && componentParams.length > 0}
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
	.pick-note {
		font-size: 10px;
		color: #666;
		padding-left: 24px;
		line-height: 1.3;
	}
	.author-param {
		flex-direction: row;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: #c8c8d0;
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
</style>
