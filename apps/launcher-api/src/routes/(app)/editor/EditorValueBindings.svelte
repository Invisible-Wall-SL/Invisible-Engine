<script lang="ts">
	import {
		HOLD_AND_WIN_PARAM_CATALOG,
		PLATFORM_JACKPOT_PARAM_CATALOG,
		VALUE_BINDING_EASES,
		VALUE_BINDING_SOURCE_CATALOG,
		VALUE_SOURCE_CATALOG,
		bindingTargetsForKind,
		defaultBindingOutRange,
		evaluateBinding,
		isLiveBinding,
		type ComponentParam,
		type LayoutNode,
		type ValueBinding,
		type ValueBindingBoneProperty,
		type ValueBindingEase,
		type ValueBindingFillDirection,
		type ValueBindingTarget,
	} from 'engine-layout';

	import type { RigMeta } from './rigRuntime.client';
	import {
		clearNodePreview,
		previewInput,
		previewVersion,
		setPreviewInput,
	} from './valuePreview.client.svelte';

	/**
	 * "Bind to value" (Hold and Win Phase 12b): the node's `valueBindings` — numbers that move,
	 * scale, fade, show, fill, pick a frame of, scrub or pose this node. One row per binding: what it
	 * drives, where the number comes from, how it maps, and a TEST VALUE that previews it on the
	 * canvas (`valuePreview.client.svelte.ts`) without saving anything. Shared by the Scene Editor and
	 * the Component Editor; inside a component a binding can read the component's own params and the
	 * per-instance pot sources (`meter.{meter}.level`).
	 */
	type Props = {
		node: LayoutNode;
		componentMode: boolean;
		componentParams: ComponentParam[];
		/** The rig node's skeleton (bones + animations), for the bone and scrub pickers. */
		rigMeta?: RigMeta;
		onChange: () => void;
	};

	const { node, componentMode, componentParams, rigMeta, onChange }: Props = $props();

	// A test value belongs to the node being edited: deselecting it (or switching document or
	// project) drops its preview, so a stale value never poses a node the author is not looking at.
	$effect(() => {
		const id = node.id;
		return () => clearNodePreview(id);
	});

	const TARGET_LABELS: Record<ValueBindingTarget, string> = {
		x: 'Move x',
		y: 'Move y',
		scale: 'Scale',
		scaleX: 'Scale x',
		scaleY: 'Scale y',
		rotation: 'Rotate',
		alpha: 'Opacity',
		visible: 'Show / hide',
		fill: 'Fill (reveal)',
		frame: 'Clip frame',
		animTime: 'Scrub animation',
		bone: 'Rig bone',
	};
	/** What the OUT range means for a target — the unit the author types. */
	const OUT_UNITS: Record<ValueBindingTarget, string> = {
		x: 'px added',
		y: 'px added (down)',
		scale: '× size',
		scaleX: '× width',
		scaleY: '× height',
		rotation: '° added (clockwise)',
		alpha: '× opacity',
		visible: '',
		fill: 'share shown, 0–1',
		frame: 'frame number (blank top = last)',
		animTime: 'share of the animation, 0–1',
		bone: '',
	};
	const BONE_UNITS: Record<ValueBindingBoneProperty, string> = {
		x: 'px added',
		y: 'px added (down)',
		rotation: '° added (clockwise)',
		scale: '× size',
		scaleX: '× width',
		scaleY: '× height',
	};
	const EASE_LABELS: Record<ValueBindingEase, string> = {
		linear: 'linear',
		easeIn: 'ease in',
		easeOut: 'ease out',
		easeInOut: 'ease in-out',
		backOut: 'overshoot',
		steps: 'steps (5)',
	};
	const FILL_DIRECTIONS: { value: ValueBindingFillDirection; label: string }[] = [
		{ value: 'right', label: 'left → right' },
		{ value: 'left', label: 'right → left' },
		{ value: 'up', label: 'bottom → top' },
		{ value: 'down', label: 'top → bottom' },
	];
	const BONE_PROPERTIES: ValueBindingBoneProperty[] = [
		'scale',
		'scaleX',
		'scaleY',
		'rotation',
		'x',
		'y',
	];

	const targets = $derived(bindingTargetsForKind(node.kind));
	const bindings = $derived(node.valueBindings ?? []);

	// ---- Source options --------------------------------------------------------------------------
	type SourceOption = { value: string; label: string; note?: string };
	type SourceGroup = { label: string; options: SourceOption[] };

	const paramKeys = $derived(componentParams.map((p) => p.key));
	const sourceGroups = $derived.by((): SourceGroup[] => {
		const groups: SourceGroup[] = [];
		if (componentMode) {
			const params = componentParams.filter((p) => p.kind === 'number' || p.kind === 'boolean');
			if (params.length) {
				groups.push({
					label: 'This component’s params',
					options: params.map((p) => ({ value: `param:${p.key}`, label: p.label ?? p.key })),
				});
			}
		}
		const seen: string[] = [];
		for (const entry of VALUE_BINDING_SOURCE_CATALOG) {
			if (entry.needsParam && !(componentMode && paramKeys.includes(entry.needsParam))) continue;
			let group = groups.find((g) => g.label === entry.group);
			if (!group) {
				group = { label: entry.group, options: [] };
				groups.push(group);
			}
			group.options.push({ value: `source:${entry.key}`, label: entry.label, note: entry.note });
			seen.push(entry.key);
		}
		const game = [
			...VALUE_SOURCE_CATALOG,
			...HOLD_AND_WIN_PARAM_CATALOG,
			...PLATFORM_JACKPOT_PARAM_CATALOG,
		].filter((p) => p.kind === 'number' && !seen.includes(p.key));
		groups.push({
			label: 'Game values',
			options: game.map((p) => ({ value: `source:${p.key}`, label: p.label, note: p.note })),
		});
		return groups;
	});
	const knownSources = $derived(
		sourceGroups
			.flatMap((g) => g.options.map((o) => o.value))
			.filter((v) => v.startsWith('source:')),
	);

	/** Rows whose source is typed by hand (a source no picker lists, or "Custom…" just picked). */
	let customRows = $state<Record<number, boolean>>({});

	function sourceChoice(b: ValueBinding, i: number): string {
		if (b.param) return `param:${b.param}`;
		if (customRows[i]) return 'custom';
		if (b.source)
			return knownSources.includes(`source:${b.source}`) ? `source:${b.source}` : 'custom';
		return '';
	}

	// ---- Edits -----------------------------------------------------------------------------------
	function changed(): void {
		onChange();
	}

	function addBinding(target: ValueBindingTarget): void {
		const binding: ValueBinding = { target };
		if (target === 'visible') {
			binding.threshold = 1;
		} else {
			const [outMin, outMax] = defaultBindingOutRange({ target });
			binding.inMin = 0;
			binding.inMax = 1;
			binding.outMin = outMin;
			if (outMax !== undefined) binding.outMax = outMax;
		}
		if (target === 'fill') binding.direction = 'right';
		if (target === 'animTime') {
			binding.animation = rigMeta?.animations[0] ?? '';
		}
		if (target === 'bone') {
			binding.bone = rigMeta?.bones[0] ?? '';
			binding.boneProperty = 'scale';
		}
		node.valueBindings = [...bindings, binding];
		changed();
	}

	function removeBinding(i: number): void {
		const next = bindings.filter((_, j) => j !== i);
		node.valueBindings = next.length ? next : undefined;
		customRows = {};
		clearNodePreview(node.id);
		changed();
	}

	/** Change what a binding drives: its source and input range stay, the output resets to the new
	 *  target's default (a 0..100 px move means nothing as a scale), and the old target's own
	 *  fields go. */
	function setTarget(b: ValueBinding, target: ValueBindingTarget): void {
		b.target = target;
		for (const key of [
			'threshold',
			'below',
			'direction',
			'animation',
			'bone',
			'boneProperty',
		] as const)
			delete b[key];
		if (target === 'visible') {
			b.threshold = 1;
			delete b.outMin;
			delete b.outMax;
		} else {
			const [outMin, outMax] = defaultBindingOutRange({ target });
			b.outMin = outMin;
			if (outMax !== undefined) b.outMax = outMax;
			else delete b.outMax;
		}
		if (target === 'fill') b.direction = 'right';
		if (target === 'animTime') {
			b.animation = rigMeta?.animations[0] ?? '';
		}
		if (target === 'bone') {
			b.bone = rigMeta?.bones[0] ?? '';
			b.boneProperty = 'scale';
		}
		changed();
	}

	function setSource(b: ValueBinding, i: number, choice: string): void {
		if (choice === 'custom') {
			customRows[i] = true;
			if (b.param) {
				delete b.param;
				changed();
			}
			return;
		}
		customRows[i] = false;
		delete b.param;
		delete b.source;
		delete b.of;
		if (choice.startsWith('param:')) b.param = choice.slice('param:'.length);
		else if (choice.startsWith('source:')) {
			const key = choice.slice('source:'.length);
			b.source = key;
			// A source with a known maximum is offered normalised (0..1), which is what a bar, a
			// fill or a scrub wants; clear "divide by" to read the raw number instead.
			const entry = VALUE_BINDING_SOURCE_CATALOG.find((e) => e.key === key);
			if (entry?.of) b.of = entry.of;
		}
		changed();
	}

	function setText(b: ValueBinding, key: 'source' | 'of' | 'animation' | 'bone', value: string) {
		const trimmed = value.trim();
		if (trimmed) b[key] = trimmed;
		else delete b[key];
		changed();
	}

	function setNumber(
		b: ValueBinding,
		key: 'inMin' | 'inMax' | 'outMin' | 'outMax' | 'smooth' | 'threshold',
		value: number,
	): void {
		if (Number.isFinite(value)) b[key] = value;
		else delete b[key];
		changed();
	}

	// ---- Test value (preview) ------------------------------------------------------------------
	/** The scrub's range: the binding's input range, or around the threshold for show / hide. */
	function testRange(b: ValueBinding): { min: number; max: number } {
		if (b.target === 'visible') {
			const threshold = b.threshold ?? 1;
			return { min: Math.min(0, threshold), max: Math.max(1, threshold * 2) };
		}
		const a = b.inMin ?? 0;
		const z = b.inMax ?? 1;
		return a === z ? { min: a - 1, max: a + 1 } : { min: Math.min(a, z), max: Math.max(a, z) };
	}

	/** Reactive read of a test value — the preview store is plain, its version is the signal. */
	function testValue(i: number): number | undefined {
		void previewVersion();
		return previewInput(node.id, i);
	}

	/** The unit a test output reads in, by target (a bone by its channel). */
	const SHORT_UNITS: Record<ValueBindingTarget | ValueBindingBoneProperty, string> = {
		x: 'px',
		y: 'px',
		scale: '×',
		scaleX: '×',
		scaleY: '×',
		rotation: '°',
		alpha: '×',
		visible: '',
		fill: 'shown',
		frame: '(frame)',
		animTime: 'of the animation',
		bone: '',
	};

	function formatOutput(b: ValueBinding, input: number): string {
		const out = evaluateBinding(b, input);
		if (b.target === 'visible') return out >= 0.5 ? 'shown' : 'hidden';
		const unit = SHORT_UNITS[b.target === 'bone' ? (b.boneProperty ?? 'scale') : b.target];
		return `${Math.round(out * 100) / 100} ${unit}`;
	}
</script>

<section class="value-bindings">
	<h3>Bind to value</h3>
	<p class="muted small">
		Let a number drive this node — a pot level growing a bone, respins left draining a bar, a stage
		showing art. Each binding maps its number <em>in → out</em> on top of the authored pose. Drag
		the
		<strong>test value</strong> to preview it here; it is never saved.
	</p>

	{#each bindings as b, i (i)}
		{@const range = testRange(b)}
		{@const test = testValue(i)}
		<div class="binding">
			<div class="row">
				<label class="field">
					<span>drives</span>
					<select
						value={b.target}
						onchange={(e) => setTarget(b, e.currentTarget.value as ValueBindingTarget)}
					>
						{#each targets as target (target)}
							<option value={target}>{TARGET_LABELS[target]}</option>
						{/each}
					</select>
				</label>
				<button class="ghost-sm danger" title="Remove this binding" onclick={() => removeBinding(i)}
					>✕</button
				>
			</div>

			<div class="row">
				<label class="field wide">
					<span>from</span>
					<select
						value={sourceChoice(b, i)}
						onchange={(e) => setSource(b, i, e.currentTarget.value)}
					>
						<option value="">(choose a number)</option>
						{#each sourceGroups as group (group.label)}
							<optgroup label={group.label}>
								{#each group.options as option (option.value)}
									<option value={option.value} title={option.note}>{option.label}</option>
								{/each}
							</optgroup>
						{/each}
						<option value="custom">Custom source…</option>
					</select>
				</label>
			</div>
			{#if sourceChoice(b, i) === 'custom'}
				<div class="row">
					<label class="field wide">
						<span>source name</span>
						<input
							type="text"
							placeholder={componentMode ? 'e.g. meter.{meter}.level' : 'e.g. respinsLeft'}
							value={b.source ?? ''}
							onchange={(e) => setText(b, 'source', e.currentTarget.value)}
						/>
					</label>
				</div>
			{/if}
			{#if b.source}
				<div class="row">
					<label class="field wide">
						<span>divide by (normalise)</span>
						<input
							type="text"
							placeholder="blank = the raw number"
							value={b.of ?? ''}
							onchange={(e) => setText(b, 'of', e.currentTarget.value)}
						/>
					</label>
				</div>
			{/if}

			{#if b.target === 'visible'}
				<div class="row">
					<label class="field">
						<span>threshold</span>
						<input
							type="number"
							step="any"
							value={b.threshold ?? 1}
							oninput={(e) => setNumber(b, 'threshold', e.currentTarget.valueAsNumber)}
						/>
					</label>
					<label class="field check">
						<input
							type="checkbox"
							checked={b.below === true}
							onchange={(e) => {
								if (e.currentTarget.checked) b.below = true;
								else delete b.below;
								changed();
							}}
						/>
						<span>show below instead</span>
					</label>
				</div>
				<p class="bind-hint">
					Shown while the number is {b.below ? 'below' : 'at or above'} the threshold — e.g. pot size
					stage ≥ 2, or pot full ≥ 1.
				</p>
			{:else}
				{#if b.target === 'fill'}
					<div class="row">
						<label class="field wide">
							<span>fills</span>
							<select
								value={b.direction ?? 'right'}
								onchange={(e) => {
									b.direction = e.currentTarget.value as ValueBindingFillDirection;
									changed();
								}}
							>
								{#each FILL_DIRECTIONS as d (d.value)}
									<option value={d.value}>{d.label}</option>
								{/each}
							</select>
						</label>
					</div>
				{:else if b.target === 'animTime'}
					<div class="row">
						<label class="field">
							<span>animation</span>
							{#if rigMeta?.animations.length}
								<select
									value={b.animation ?? ''}
									onchange={(e) => setText(b, 'animation', e.currentTarget.value)}
								>
									{#if b.animation && !rigMeta.animations.includes(b.animation)}
										<option value={b.animation}>{b.animation} (not in this rig)</option>
									{/if}
									{#each rigMeta.animations as name (name)}
										<option value={name}>{name}</option>
									{/each}
								</select>
							{:else}
								<input
									type="text"
									value={b.animation ?? ''}
									onchange={(e) => setText(b, 'animation', e.currentTarget.value)}
								/>
							{/if}
						</label>
					</div>
				{:else if b.target === 'bone'}
					<div class="row">
						<label class="field">
							<span>bone</span>
							{#if rigMeta?.bones.length}
								<select
									value={b.bone ?? ''}
									onchange={(e) => setText(b, 'bone', e.currentTarget.value)}
								>
									{#if b.bone && !rigMeta.bones.includes(b.bone)}
										<option value={b.bone}>{b.bone} (not in this rig)</option>
									{/if}
									{#each rigMeta.bones as name (name)}
										<option value={name}>{name}</option>
									{/each}
								</select>
							{:else}
								<input
									type="text"
									value={b.bone ?? ''}
									onchange={(e) => setText(b, 'bone', e.currentTarget.value)}
								/>
							{/if}
						</label>
						<label class="field">
							<span>channel</span>
							<select
								value={b.boneProperty ?? 'scale'}
								onchange={(e) => {
									b.boneProperty = e.currentTarget.value as ValueBindingBoneProperty;
									const [outMin, outMax] = defaultBindingOutRange(b);
									b.outMin = outMin;
									if (outMax !== undefined) b.outMax = outMax;
									changed();
								}}
							>
								{#each BONE_PROPERTIES as prop (prop)}
									<option value={prop}>{prop}</option>
								{/each}
							</select>
						</label>
					</div>
				{/if}

				<div class="row">
					<label class="field">
						<span>in from</span>
						<input
							type="number"
							step="any"
							value={b.inMin ?? 0}
							oninput={(e) => setNumber(b, 'inMin', e.currentTarget.valueAsNumber)}
						/>
					</label>
					<label class="field">
						<span>in to</span>
						<input
							type="number"
							step="any"
							value={b.inMax ?? 1}
							oninput={(e) => setNumber(b, 'inMax', e.currentTarget.valueAsNumber)}
						/>
					</label>
				</div>
				<div class="row">
					<label class="field">
						<span>out from</span>
						<input
							type="number"
							step="any"
							value={b.outMin ?? ''}
							placeholder={String(defaultBindingOutRange(b)[0])}
							oninput={(e) => setNumber(b, 'outMin', e.currentTarget.valueAsNumber)}
						/>
					</label>
					<label class="field">
						<span>out to</span>
						<input
							type="number"
							step="any"
							value={b.outMax ?? ''}
							placeholder={String(defaultBindingOutRange(b)[1] ?? 'last')}
							oninput={(e) => setNumber(b, 'outMax', e.currentTarget.valueAsNumber)}
						/>
					</label>
				</div>
				<p class="bind-hint">
					Out = {b.target === 'bone' ? BONE_UNITS[b.boneProperty ?? 'scale'] : OUT_UNITS[b.target]}.
				</p>
				<div class="row">
					<label class="field">
						<span>curve</span>
						<select
							value={b.ease ?? 'linear'}
							onchange={(e) => {
								const ease = e.currentTarget.value as ValueBindingEase;
								if (ease === 'linear') delete b.ease;
								else b.ease = ease;
								changed();
							}}
						>
							{#each VALUE_BINDING_EASES as ease (ease)}
								<option value={ease}>{EASE_LABELS[ease]}</option>
							{/each}
						</select>
					</label>
					<label class="field">
						<span>glide (s)</span>
						<input
							type="number"
							min="0"
							step="0.05"
							value={b.smooth ?? ''}
							placeholder="0 = snap"
							oninput={(e) => setNumber(b, 'smooth', e.currentTarget.valueAsNumber)}
						/>
					</label>
				</div>
				<label class="field check">
					<input
						type="checkbox"
						checked={b.clamp !== false}
						onchange={(e) => {
							if (e.currentTarget.checked) delete b.clamp;
							else b.clamp = false;
							changed();
						}}
					/>
					<span>stop at the ends of the in range</span>
				</label>
			{/if}

			{#if !isLiveBinding(b)}
				<p class="bind-hint warn">
					Does nothing yet: {b.param || b.source
						? b.target === 'animTime'
							? 'pick an animation.'
							: 'pick a bone.'
						: 'choose a number in “from”.'}
				</p>
			{/if}

			<div class="test">
				<label class="field wide">
					<span>
						test value {test === undefined
							? '— off'
							: `${Math.round(test * 1000) / 1000} → ${formatOutput(b, test)}`}
					</span>
					<input
						type="range"
						min={range.min}
						max={range.max}
						step={(range.max - range.min) / 100}
						value={test ?? range.min}
						oninput={(e) => setPreviewInput(node.id, i, e.currentTarget.valueAsNumber)}
					/>
				</label>
				{#if test !== undefined}
					<button class="ghost-sm" onclick={() => setPreviewInput(node.id, i, undefined)}>
						Stop preview
					</button>
				{/if}
			</div>
		</div>
	{/each}

	<div class="row">
		<label class="field wide">
			<span>add a binding</span>
			<select
				value=""
				onchange={(e) => {
					const target = e.currentTarget.value as ValueBindingTarget;
					e.currentTarget.value = '';
					if (target) addBinding(target);
				}}
			>
				<option value="">+ drive…</option>
				{#each targets as target (target)}
					<option value={target}>{TARGET_LABELS[target]}</option>
				{/each}
			</select>
		</label>
	</div>
	{#if !componentMode}
		<p class="bind-hint">
			On a screen a binding reads engine values. Inside a component (Component Editor) it can also
			read the component’s params and its own pot (<code>meter.{'{meter}'}.level</code>).
		</p>
	{/if}
</section>

<style>
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
	.binding {
		padding: 8px;
		margin-bottom: 8px;
		border: 1px solid #2a2a33;
		border-radius: 6px;
	}
	.row {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
		align-items: flex-end;
	}
	.field {
		flex: 1;
		display: flex;
		flex-direction: column;
		gap: 3px;
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
	.field select {
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
	.field input:focus,
	.field select:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.field input[type='range'] {
		width: 100%;
		accent-color: #6b5bff;
	}
	.test {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px dashed #2a2a33;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.small {
		font-size: 11px;
	}
	.bind-hint {
		font-size: 10px;
		color: #777;
		line-height: 1.3;
		margin: 0 0 6px;
	}
	.bind-hint.warn {
		color: #d98a3a;
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
	.ghost-sm:hover {
		border-color: #6b5bff;
	}
	.ghost-sm.danger {
		color: #ff9a9a;
		border-color: #4a2a30;
		align-self: flex-end;
	}
</style>
