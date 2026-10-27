<script lang="ts">
	import ColorField from '$lib/ColorField.svelte';
	import {
		CUSTOM_ELEMENT_FX_PADDING_MAX,
		CUSTOM_ELEMENT_FX_PASS_LIMIT,
		ELEMENT_FX_CURVE_EASES,
		ELEMENT_FX_CURVE_KEY_LIMIT,
		ELEMENT_FX_MOTION_CHANNELS,
		ELEMENT_FX_PASS_KINDS,
		ELEMENT_FX_PHASES,
		elementFxSpec,
		type CustomElementFxPass,
		type CustomElementFxPassValue,
		type ElementFxCurve,
		type ElementFxCurveEase,
		type ElementFxMotionChannel,
		type ElementFxParamSpec,
		type ElementFxPassKind,
	} from 'constants-shared/elementFx';
	import type { ShaderGraphDoc } from 'engine-shadergraph';
	import {
		DURATION_LIMITS,
		MOTION_LIMITS,
		addParam,
		addPass,
		breakPhaseMismatch,
		madeForParticles,
		particleIgnoredNotes,
		phaseName,
		removeParam,
		removePass,
		restCurve,
		setMadeFor,
		setMotionChannel,
		setParam,
		setPass,
		setPhase,
		setPivot,
	} from './shaderEditor';

	// The effect as a whole: what the pickers show (name, description), how it plays (phase,
	// length, padding), the rows an author sets where it is placed (params), the built-in passes
	// drawn after the graph, and the element's own motion. Every change hands the page a new doc.
	// A channel (or the padding) the motion graph drives says so: its curve plays only unwired.
	// A phase the Break Output's break cannot play as says so, with the fix a click away.
	interface Props {
		doc: ShaderGraphDoc;
		/** Doc-level messages (`doc`, `param`, `pass`, `motion` issues). */
		errors: readonly string[];
		/** The Motion Output's wired channels (`drivenChannels`). */
		driven?: readonly string[];
		disabled?: boolean;
		onChange: (doc: ShaderGraphDoc) => void;
	}
	let { doc, errors, driven = [], disabled = false, onChange }: Props = $props();

	const DRIVEN_TITLE =
		'The motion graph’s Output has a wire into this channel, so the graph moves it each frame and its curve here does nothing. Unwire it there and the curve plays again.';

	const PHASE_TEXT: Record<string, string> = {
		loop: 'Loop — plays over and over',
		emphasis: 'Emphasis — plays and returns to rest',
		enter: 'Enter — brings the element in',
		exit: 'Exit — takes the element out',
	};
	const CHANNEL_TEXT: Record<ElementFxMotionChannel, string> = {
		x: 'x (element widths)',
		y: 'y (element heights)',
		scale: 'scale',
		scaleX: 'scale x',
		scaleY: 'scale y',
		rotation: 'rotation (°)',
		alpha: 'alpha',
	};

	const PARAM_KIND_LABELS: Record<ElementFxParamSpec['kind'], string> = {
		number: 'number',
		color: 'colour',
		bool: 'switch',
		choice: 'choice',
	};
	const PARAM_KINDS = Object.keys(PARAM_KIND_LABELS) as ElementFxParamSpec['kind'][];

	const mismatch = $derived(breakPhaseMismatch(doc));
	/** What of the effect does not play on particles, by part, when it is made for them. */
	const ignored = $derived(particleIgnoredNotes(doc));
	const ignoredOf = (...parts: string[]): string[] =>
		ignored.filter((n) => parts.includes(n.part)).map((n) => n.text);

	const set = <K extends keyof ShaderGraphDoc>(key: K, value: ShaderGraphDoc[K]): void =>
		onChange({ ...doc, [key]: value });

	function setNumber(key: 'durationMs' | 'padding', raw: string): void {
		if (raw.trim() === '') {
			if (key === 'durationMs') return;
			const next = { ...doc };
			delete next.padding;
			return onChange(next);
		}
		const n = Number(raw);
		if (Number.isFinite(n)) set(key, n);
	}

	// ── params ──
	function editParam(index: number, change: Partial<ElementFxParamSpec>): void {
		onChange(setParam(doc, index, { ...doc.params[index], ...change } as ElementFxParamSpec));
	}

	// ── passes ──
	function passValue(pass: CustomElementFxPass, id: string): CustomElementFxPassValue | undefined {
		return pass.params?.[id];
	}
	function setPassParam(
		index: number,
		id: string,
		value: CustomElementFxPassValue | undefined,
	): void {
		const pass = doc.passes?.[index];
		if (!pass) return;
		const params = { ...(pass.params ?? {}) };
		if (value === undefined) delete params[id];
		else params[id] = value;
		const next: CustomElementFxPass = { kind: pass.kind };
		if (Object.keys(params).length) next.params = params;
		if (pass.intensity !== undefined) next.intensity = pass.intensity;
		onChange(setPass(doc, index, next));
	}
	const passParams = (kind: ElementFxPassKind) => elementFxSpec(kind).params;

	// ── motion ──
	function editKey(
		channel: ElementFxMotionChannel,
		index: number,
		change: Partial<{ t: number; v: number; ease: ElementFxCurveEase }>,
	): void {
		const curve = [...(doc.motion?.channels[channel] ?? [])];
		curve[index] = { ...curve[index], ...change };
		onChange(setMotionChannel(doc, channel, curve));
	}
	function addKey(channel: ElementFxMotionChannel): void {
		const curve = [...(doc.motion?.channels[channel] ?? [])];
		const last = curve[curve.length - 1];
		const prev = curve[curve.length - 2];
		const t = prev && last ? (prev.t + last.t) / 2 : 1;
		const key = { t: Number(t.toFixed(3)), v: last?.v ?? 0, ease: 'smooth' as const };
		const at = curve.findIndex((k) => k.t > key.t);
		curve.splice(at === -1 ? curve.length : at, 0, key);
		onChange(setMotionChannel(doc, channel, curve));
	}
	function removeKey(channel: ElementFxMotionChannel, index: number): void {
		const curve = (doc.motion?.channels[channel] ?? []).filter((_, i) => i !== index);
		onChange(setMotionChannel(doc, channel, curve.length ? (curve as ElementFxCurve) : undefined));
	}
	const num = (raw: string): number | undefined => {
		const n = Number(raw);
		return raw.trim() !== '' && Number.isFinite(n) ? n : undefined;
	};
</script>

<section class="graph-settings">
	{#each errors as message, i (i)}
		<p class="hint warn">{message}</p>
	{/each}

	<h4>Effect</h4>
	<label class="field">
		<span>Name</span>
		<input
			type="text"
			value={doc.name}
			{disabled}
			onchange={(e) => set('name', e.currentTarget.value)}
		/>
	</label>
	<label class="field">
		<span>Description</span>
		<textarea
			rows="2"
			value={doc.description ?? ''}
			{disabled}
			onchange={(e) => set('description', e.currentTarget.value)}
		></textarea>
	</label>
	<label class="field">
		<span>Plays as</span>
		<select
			value={doc.phase}
			{disabled}
			onchange={(e) => set('phase', e.currentTarget.value as ShaderGraphDoc['phase'])}
		>
			{#each ELEMENT_FX_PHASES as phase (phase)}
				<option value={phase}>{PHASE_TEXT[phase] ?? phase}</option>
			{/each}
		</select>
	</label>
	<label
		class="field"
		title="What the effect is made to draw. It never changes what plays: any effect can go on elements or particles. Particles sets the preview, the cost budget and the notes, and lists the effect first in Invisible FX's Material picker."
	>
		<span>Made for</span>
		<select
			value={madeForParticles(doc) ? 'particles' : 'elements'}
			{disabled}
			aria-label="Made for"
			onchange={(e) => onChange(setMadeFor(doc, e.currentTarget.value === 'particles'))}
		>
			<option value="elements">Elements</option>
			<option value="particles">Particles (a material in Invisible FX)</option>
		</select>
	</label>
	{#each ignoredOf('break') as text (text)}
		<p class="ignored">{text}</p>
	{/each}
	{#if mismatch}
		<p class="hint warn fix">
			{mismatch.message}
			<button type="button" {disabled} onclick={() => onChange(setPhase(doc, mismatch.phase))}
				>Set phase to {phaseName(mismatch.phase)}</button
			>
		</p>
	{/if}
	<label class="field">
		<span>Length (ms)</span>
		<input
			type="number"
			min={DURATION_LIMITS.min}
			max={DURATION_LIMITS.max}
			step="50"
			value={doc.durationMs}
			{disabled}
			onchange={(e) => setNumber('durationMs', e.currentTarget.value)}
		/>
	</label>
	<label
		class="field"
		title="Room the graph draws outside the element, as a share of its larger side."
	>
		<span>Padding</span>
		<input
			type="number"
			min="0"
			max={CUSTOM_ELEMENT_FX_PADDING_MAX}
			step="0.05"
			value={doc.padding ?? ''}
			placeholder="0"
			{disabled}
			onchange={(e) => setNumber('padding', e.currentTarget.value)}
		/>
	</label>
	{#if driven.includes('padding')}
		<p
			class="driven"
			title="The motion graph’s Output has a wire into its padding, so the room past the edge is worked out each frame and this number does nothing. Unwire it there and this number counts again."
		>
			Padding is driven by the motion graph.
		</p>
	{/if}

	<h4>Params <span class="muted">— rows set where the effect is placed</span></h4>
	{#each doc.params as param, index (index)}
		<div class="card">
			<div class="row">
				<input
					class="grow"
					type="text"
					value={param.label}
					aria-label="Param label"
					{disabled}
					onchange={(e) => editParam(index, { label: e.currentTarget.value })}
				/>
				<input
					class="id"
					type="text"
					value={param.id}
					aria-label="Param id"
					title="The id a Param node reads and a saved entry stores"
					{disabled}
					onchange={(e) => editParam(index, { id: e.currentTarget.value.trim() })}
				/>
				<span class="muted">{param.kind}</span>
				<button type="button" class="x" {disabled} onclick={() => onChange(removeParam(doc, index))}
					>✕</button
				>
			</div>
			<div class="row">
				{#if param.kind === 'number'}
					<label
						>default <input
							type="number"
							step="any"
							value={param.default}
							{disabled}
							onchange={(e) => {
								const n = num(e.currentTarget.value);
								if (n !== undefined) editParam(index, { default: n });
							}}
						/></label
					>
					<label
						>min <input
							type="number"
							step="any"
							value={param.min}
							{disabled}
							onchange={(e) => {
								const n = num(e.currentTarget.value);
								if (n !== undefined) editParam(index, { min: n });
							}}
						/></label
					>
					<label
						>max <input
							type="number"
							step="any"
							value={param.max}
							{disabled}
							onchange={(e) => {
								const n = num(e.currentTarget.value);
								if (n !== undefined) editParam(index, { max: n });
							}}
						/></label
					>
				{:else if param.kind === 'color'}
					<span>default</span>
					<ColorField
						value={param.default}
						{disabled}
						onchange={(hex: string) => editParam(index, { default: hex })}
					/>
				{:else if param.kind === 'bool'}
					<label
						><input
							type="checkbox"
							checked={param.default}
							{disabled}
							onchange={(e) => editParam(index, { default: e.currentTarget.checked })}
						/> on by default</label
					>
				{:else if param.kind === 'choice'}
					<label class="grow"
						>options <input
							type="text"
							value={param.options.join(', ')}
							{disabled}
							onchange={(e) =>
								editParam(index, {
									options: e.currentTarget.value
										.split(',')
										.map((o) => o.trim())
										.filter(Boolean),
								})}
						/></label
					>
					<select
						value={param.default}
						aria-label="Default option"
						{disabled}
						onchange={(e) => editParam(index, { default: e.currentTarget.value })}
					>
						{#each param.options as option (option)}
							<option value={option}>{option}</option>
						{/each}
					</select>
				{/if}
			</div>
		</div>
	{/each}
	<div class="row adds">
		{#each PARAM_KINDS as kind (kind)}
			<button type="button" {disabled} onclick={() => onChange(addParam(doc, kind))}
				>+ {PARAM_KIND_LABELS[kind]}</button
			>
		{/each}
	</div>

	<h4>Passes <span class="muted">— built-in effects drawn after the graph</span></h4>
	{#each ignoredOf('passes') as text (text)}
		<p class="ignored">{text}</p>
	{/each}
	{#each doc.passes ?? [] as pass, index (index)}
		<div class="card">
			<div class="row">
				<select
					class="grow"
					value={pass.kind}
					{disabled}
					onchange={(e) =>
						onChange(setPass(doc, index, { kind: e.currentTarget.value as ElementFxPassKind }))}
				>
					{#each ELEMENT_FX_PASS_KINDS as kind (kind)}
						<option value={kind}>{elementFxSpec(kind).label}</option>
					{/each}
				</select>
				<label
					>strength <input
						type="number"
						step="0.1"
						min="0"
						value={pass.intensity ?? ''}
						placeholder="1"
						{disabled}
						onchange={(e) => {
							const n = num(e.currentTarget.value);
							const next: CustomElementFxPass = { kind: pass.kind };
							if (pass.params) next.params = pass.params;
							if (n !== undefined) next.intensity = n;
							onChange(setPass(doc, index, next));
						}}
					/></label
				>
				<button type="button" class="x" {disabled} onclick={() => onChange(removePass(doc, index))}
					>✕</button
				>
			</div>
			{#each passParams(pass.kind) as spec (spec.id)}
				{@const value = passValue(pass, spec.id)}
				{@const tied = typeof value === 'object' && value !== null ? value.param : ''}
				<div class="row">
					<span class="plabel">{spec.label}</span>
					<select
						value={tied}
						aria-label="Tie {spec.label} to a param"
						{disabled}
						onchange={(e) =>
							setPassParam(
								index,
								spec.id,
								e.currentTarget.value ? { param: e.currentTarget.value } : undefined,
							)}
					>
						<option value="">its own value</option>
						{#each doc.params.filter((p) => p.kind === spec.kind) as param (param.id)}
							<option value={param.id}>= {param.label}</option>
						{/each}
					</select>
					{#if !tied}
						{#if spec.kind === 'number'}
							<input
								type="number"
								step="any"
								value={typeof value === 'number' ? value : ''}
								placeholder={String(spec.default)}
								{disabled}
								onchange={(e) => setPassParam(index, spec.id, num(e.currentTarget.value))}
							/>
						{:else if spec.kind === 'color'}
							<ColorField
								value={typeof value === 'string' ? value : spec.default}
								{disabled}
								onchange={(hex: string) => setPassParam(index, spec.id, hex)}
							/>
						{:else if spec.kind === 'bool'}
							<input
								type="checkbox"
								checked={typeof value === 'boolean' ? value : spec.default}
								{disabled}
								onchange={(e) => setPassParam(index, spec.id, e.currentTarget.checked)}
							/>
						{:else if spec.kind === 'choice'}
							<select
								value={typeof value === 'string' ? value : spec.default}
								{disabled}
								onchange={(e) => setPassParam(index, spec.id, e.currentTarget.value)}
							>
								{#each spec.options as option (option)}
									<option value={option}>{option}</option>
								{/each}
							</select>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/each}
	{#if (doc.passes?.length ?? 0) < CUSTOM_ELEMENT_FX_PASS_LIMIT}
		<div class="row adds">
			<button type="button" {disabled} onclick={() => onChange(addPass(doc))}>+ pass</button>
		</div>
	{/if}

	<h4>Motion <span class="muted">— the element's own movement over a play</span></h4>
	{#each ignoredOf('motion', 'padding') as text (text)}
		<p class="ignored">{text}</p>
	{/each}
	{#each ELEMENT_FX_MOTION_CHANNELS as channel (channel)}
		{@const curve = doc.motion?.channels[channel]}
		{@const graphDriven = driven.includes(channel)}
		<div class="card" class:off={!curve} class:overridden={graphDriven}>
			<div class="row">
				<label class="grow"
					><input
						type="checkbox"
						checked={!!curve}
						{disabled}
						onchange={(e) =>
							onChange(
								setMotionChannel(
									doc,
									channel,
									e.currentTarget.checked ? restCurve(channel) : undefined,
								),
							)}
					/>
					{CHANNEL_TEXT[channel]}</label
				>
				{#if graphDriven}
					<span class="driven" title={DRIVEN_TITLE}>driven by the motion graph</span>
				{:else if curve}
					<span class="muted">{MOTION_LIMITS[channel].min}…{MOTION_LIMITS[channel].max}</span>
				{/if}
			</div>
			{#if curve}
				{#each curve as key, k (k)}
					<div class="row key">
						<label
							>t <input
								type="number"
								min="0"
								max="1"
								step="0.05"
								value={key.t}
								{disabled}
								onchange={(e) => {
									const n = num(e.currentTarget.value);
									if (n !== undefined) editKey(channel, k, { t: n });
								}}
							/></label
						>
						<label
							>value <input
								type="number"
								step="any"
								value={key.v}
								{disabled}
								onchange={(e) => {
									const n = num(e.currentTarget.value);
									if (n !== undefined) editKey(channel, k, { v: n });
								}}
							/></label
						>
						{#if k > 0}
							<select
								value={key.ease ?? 'linear'}
								aria-label="Ease into this key"
								{disabled}
								onchange={(e) =>
									editKey(channel, k, { ease: e.currentTarget.value as ElementFxCurveEase })}
							>
								{#each ELEMENT_FX_CURVE_EASES as ease (ease)}
									<option value={ease}>{ease}</option>
								{/each}
							</select>
						{/if}
						<button type="button" class="x" {disabled} onclick={() => removeKey(channel, k)}
							>✕</button
						>
					</div>
				{/each}
				{#if curve.length < ELEMENT_FX_CURVE_KEY_LIMIT}
					<button type="button" class="add-key" {disabled} onclick={() => addKey(channel)}
						>+ key</button
					>
				{/if}
			{/if}
		</div>
	{/each}
	{#if doc.motion}
		<div class="row">
			<span class="plabel">Pivot</span>
			<label
				>x <input
					type="number"
					min="0"
					max="1"
					step="0.05"
					value={doc.motion.pivot?.x ?? 0.5}
					{disabled}
					onchange={(e) => {
						const n = num(e.currentTarget.value);
						if (n !== undefined) onChange(setPivot(doc, { x: n, y: doc.motion?.pivot?.y ?? 0.5 }));
					}}
				/></label
			>
			<label
				>y <input
					type="number"
					min="0"
					max="1"
					step="0.05"
					value={doc.motion.pivot?.y ?? 0.5}
					{disabled}
					onchange={(e) => {
						const n = num(e.currentTarget.value);
						if (n !== undefined) onChange(setPivot(doc, { x: doc.motion?.pivot?.x ?? 0.5, y: n }));
					}}
				/></label
			>
		</div>
	{/if}
</section>

<style>
	.graph-settings {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
	}
	h4 {
		margin: 10px 0 2px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	h4 .muted {
		text-transform: none;
		letter-spacing: 0;
		font-weight: normal;
	}
	.field {
		display: grid;
		grid-template-columns: 90px 1fr;
		align-items: center;
		gap: 8px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding: 6px;
		border: 1px solid #1f2937;
		border-radius: 6px;
		background: #0f141b;
	}
	.card.off {
		padding: 3px 6px;
	}
	.card.overridden .key {
		opacity: 0.5;
	}
	.driven {
		margin: 0;
		font-size: 11px;
		color: #38bdf8;
	}
	.ignored {
		margin: 0;
		font-size: 11px;
		color: #fbbf24;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.row label {
		display: flex;
		align-items: center;
		gap: 4px;
		color: #94a3b8;
	}
	.grow {
		flex: 1;
		min-width: 0;
	}
	input,
	select,
	textarea {
		box-sizing: border-box;
		font-size: 12px;
		font-family: inherit;
		background: #0b0e13;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 4px;
		min-width: 0;
	}
	input[type='number'] {
		width: 64px;
	}
	input[type='checkbox'] {
		width: auto;
	}
	.field input,
	.field select,
	.field textarea {
		width: 100%;
	}
	.id {
		width: 80px;
	}
	.plabel {
		min-width: 70px;
		color: #cbd5e1;
	}
	button {
		font-size: 11px;
		background: #1f2937;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 8px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	.x {
		padding: 1px 6px;
	}
	.add-key {
		align-self: flex-start;
	}
	.hint {
		margin: 0;
	}
	.warn {
		color: #fca5a5;
	}
	.fix {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
	}
	.muted {
		color: #64748b;
	}
</style>
