<script lang="ts">
	import {
		resolveTransform,
		type LayoutNode,
		type LayoutType,
		type NodeOverride,
	} from 'engine-layout';

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
				<label class="field">
					<span>font size</span>
					<input
						type="number"
						step="1"
						value={node.style?.fontSize ?? 24}
						oninput={(e) => {
							if (!node.style) node.style = {};
							node.style.fontSize = e.currentTarget.valueAsNumber;
							markDirty();
						}}
					/>
				</label>
				<label class="field">
					<span>fill</span>
					<input
						type="text"
						placeholder="#ffffff"
						value={hexFrom(node.style?.fill)}
						onchange={(e) => {
							const clean = e.currentTarget.value.trim().replace(/^#/, '');
							if (!/^[0-9a-fA-F]{6}$/.test(clean)) return;
							if (!node.style) node.style = {};
							node.style.fill = parseInt(clean, 16);
							markDirty();
						}}
					/>
				</label>
			</div>
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
