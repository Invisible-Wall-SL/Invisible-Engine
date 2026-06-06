<script lang="ts">
	import {
		defaultHudText,
		getHudTextOverride,
		resolveTransform,
		type LayoutNode,
		type LayoutType,
		type NodeOverride,
		type TextStyle,
	} from 'engine-layout';
	import { onMount } from 'svelte';
	import { fetchFontCatalog, type EditorFont } from './fonts.client';

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
	}
	let {
		node,
		layoutType,
		onDirty,
		templateMode = false,
		slotMeta = {},
		onSlotRequiredChange,
		sceneSlots = [],
	}: Props = $props();

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

	// ---- HUD text override (coded logo / game-name bind anchors) ----
	// These are `container` bind anchors whose coded snippet renders text; the
	// editor lets you override the font/size/fill + the label string via
	// `bind.props` (read in-game by `<LayoutEditable>` → the snippet). Detected by
	// the `preview.style: 'text'` hint the HUD reference layout tags them with.
	const isHudText = $derived(
		!!node && node.kind === 'container' && !!node.bind && node.preview?.style === 'text',
	);
	const hudOverride = $derived(node ? getHudTextOverride(node) : undefined);
	/** The shared default label for this HUD anchor's component — shown as the LABEL
	 * TEXT placeholder so the empty field matches what renders on the canvas. */
	const hudDefaultText = $derived(
		node && node.kind === 'container' ? (defaultHudText(node.bind?.component) ?? '') : '',
	);
	const isHudBitmap = $derived(
		(hudOverride?.style?.fontFamily &&
			fontByName.get(hudOverride.style.fontFamily)?.kind === 'bitmap') ||
			false,
	);
	const hudCustomFamily = $derived.by(() => {
		const fam = hudOverride?.style?.fontFamily ?? '';
		return fam && !fontByName.has(fam) ? fam : '';
	});

	function ensureHudProps(n: LayoutNode): Record<string, unknown> {
		if (n.kind !== 'container' || !n.bind) return {};
		if (!n.bind.props) n.bind.props = {};
		return n.bind.props as Record<string, unknown>;
	}
	function ensureHudStyle(n: LayoutNode): Record<string, unknown> {
		const props = ensureHudProps(n);
		if (!props.style || typeof props.style !== 'object') props.style = {};
		return props.style as Record<string, unknown>;
	}
	/** Set the override label string; empty clears it (falls back to the coded name). */
	function setHudText(n: LayoutNode, value: string): void {
		const props = ensureHudProps(n);
		const trimmed = value.trim();
		if (trimmed) props.text = trimmed;
		else delete props.text;
		markDirty();
	}
	function setHudFontFamily(n: LayoutNode, value: string): void {
		const s = ensureHudStyle(n);
		const trimmed = value.trim();
		if (trimmed) s.fontFamily = trimmed;
		else delete s.fontFamily;
		pruneHudStyle(n);
		markDirty();
	}
	function setHudFontSize(n: LayoutNode, value: number): void {
		const s = ensureHudStyle(n);
		if (Number.isNaN(value)) delete s.fontSize;
		else s.fontSize = value;
		pruneHudStyle(n);
		markDirty();
	}
	function setHudFill(n: LayoutNode, hex: string): void {
		const value = parseHex(hex);
		if (value === undefined) return;
		ensureHudStyle(n).fill = value;
		markDirty();
	}
	/** Drop an emptied `style` (and `bind.props`) so the saved doc stays clean. */
	function pruneHudStyle(n: LayoutNode): void {
		if (n.kind !== 'container' || !n.bind?.props) return;
		const props = n.bind.props as Record<string, unknown>;
		const s = props.style as Record<string, unknown> | undefined;
		if (s && Object.keys(s).length === 0) delete props.style;
		if (Object.keys(props).length === 0) delete n.bind.props;
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
</script>

{#if !node}
	<p class="muted">Select a node to edit its properties.</p>
{:else}
	{@const t = resolveTransform(node, layoutType)}
	{@const o = node.overrides?.[layoutType]}
	<div class="head">
		<div class="title">
			<strong>{node.label ?? node.id}</strong>
			<span class="kind">{node.kind}</span>
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
				Base (desktop)
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
	</div>

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

	{#if isHudText}
		<section>
			<h3>HUD text</h3>
			<p class="muted small">
				Coded HUD element — override its label + font here (placement is the transform above).
			</p>
			<div class="row">
				<label class="field wide">
					<span>label text</span>
					<input
						type="text"
						placeholder={hudDefaultText || '(coded default)'}
						value={hudOverride?.text ?? ''}
						oninput={(e) => setHudText(node, e.currentTarget.value)}
					/>
				</label>
			</div>
			<div class="row">
				<label class="field wide">
					<span>font family</span>
					<select
						value={hudOverride?.style?.fontFamily ?? ''}
						onchange={(e) => setHudFontFamily(node, e.currentTarget.value)}
					>
						<option value="">(coded default)</option>
						{#each fontList as f (f.id)}
							<option value={f.name}>{f.name} [{f.kind}]</option>
						{/each}
						{#if hudCustomFamily}
							<option value={hudCustomFamily}>{hudCustomFamily} (custom)</option>
						{/if}
					</select>
				</label>
			</div>
			{#if fontList.length === 0}
				<p class="muted small">
					No fonts synced for this project — run <code>scripts/r2-sync-fonts.mjs</code> to populate the
					catalog.
				</p>
			{/if}
			<div class="row">
				<label class="field">
					<span>font size</span>
					<input
						type="number"
						step="1"
						placeholder="(default)"
						value={hudOverride?.style?.fontSize ?? ''}
						oninput={(e) => setHudFontSize(node, e.currentTarget.valueAsNumber)}
					/>
				</label>
				<label class="field">
					<span>{isHudBitmap ? 'tint' : 'fill'}</span>
					<input
						type="text"
						placeholder="#ffffff"
						value={hudOverride?.style?.fill !== undefined ? hexFrom(hudOverride.style.fill) : ''}
						onchange={(e) => setHudFill(node, e.currentTarget.value)}
					/>
				</label>
			</div>
			{#if isHudBitmap}
				<p class="muted small">
					Bitmap font: tint + size only (the baked atlas softens when scaled up).
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
						type="text"
						placeholder="#ffffff"
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
						type="text"
						placeholder="#ffffff"
						value={hexFrom(node.style?.fill)}
						onchange={(e) => setFill(node, e.currentTarget.value)}
					/>
				</label>
			</div>

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
							type="text"
							placeholder="#000000"
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
								type="text"
								placeholder="#000000"
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
	.slot-hint {
		margin: 4px 0 0;
		font-size: 11px;
		color: #777;
	}
</style>
