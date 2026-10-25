<script lang="ts">
	import ColorField from '$lib/ColorField.svelte';
	import {
		breakAtOf,
		breakKindOf,
		breakOutputDef,
		readBreakValue,
		type GraphNode,
		type ShaderGraphDoc,
	} from 'engine-shadergraph';
	import {
		BREAK_CHOICES,
		breakEdgeMs,
		breakParamsOf,
		breakPhaseMismatch,
		breakPortSources,
		breakPortValue,
		categoryColor,
		phaseName,
		setBreakAt,
		setBreakKind,
		setBreakValue,
		setPhase,
	} from './shaderEditor';

	// The selected Break Output: which break plays, where in the play it begins, and each of its
	// params left unwired, edited with a control fit to its kind. A kind change drops the wires into
	// the params the new break lacks, and says so (Undo brings them back). The phase the break needs
	// is one click away, under the node's errors, when the effect plays as another.
	interface Props {
		doc: ShaderGraphDoc;
		node: GraphNode;
		errors: readonly string[];
		disabled?: boolean;
		onChange: (doc: ShaderGraphDoc) => void;
		/** A line for the page's notice bar (the wires a kind change dropped). */
		onNotice: (text: string) => void;
	}
	let { doc, node, errors, disabled = false, onChange, onNotice }: Props = $props();

	const def = $derived(breakOutputDef(node));
	const kind = $derived(breakKindOf(node));
	const choice = $derived(BREAK_CHOICES.find((c) => c.kind === kind));
	const params = $derived(breakParamsOf(node));
	const sources = $derived(breakPortSources(doc, node.id));
	const mismatch = $derived(breakPhaseMismatch(doc));
	/** Where it starts as the break reads it, else (past 0…1) as stored, for the box to show. */
	const at = $derived(breakAtOf(node));
	const atShown = $derived(at ?? (typeof node.values?.at === 'number' ? node.values.at : 0));
	const atText = $derived.by(() => {
		if (!kind || at === undefined) return 'A share of the play, 0…1.';
		const edge = breakEdgeMs(kind, at, doc.durationMs);
		const ms = `${edge} ms of ${doc.durationMs} ms`;
		if (choice?.reversed)
			return at === 0
				? 'Its pieces fly in over the whole play.'
				: `Its pieces fly in until ${ms}; the graph plays alone after.`;
		return at === 0
			? 'It breaks at once: the whole play is the break.'
			: `It breaks at ${ms}; the graph plays alone until then.`;
	});

	function pickKind(next: string): void {
		const picked = BREAK_CHOICES.find((c) => c.kind === next);
		if (!picked) return;
		const { doc: changed, dropped } = setBreakKind(doc, node.id, picked.kind);
		onChange(changed);
		if (dropped.length)
			onNotice(
				`${picked.label} has no ${dropped.join(', ')}: ${dropped.length === 1 ? 'its wire was' : 'their wires were'} dropped. Undo brings ${dropped.length === 1 ? 'it' : 'them'} back.`,
			);
	}

	function setAt(raw: string): void {
		const n = raw.trim() === '' ? undefined : Number(raw);
		if (n === undefined || Number.isFinite(n)) onChange(setBreakAt(doc, node.id, n));
	}
</script>

<section class="break-props">
	<header style="--family:{categoryColor(def.category)}">
		<strong>{def.label}</strong>
		<span class="muted">{node.id}</span>
	</header>
	<p class="hint">{def.description}</p>
	{#each errors as message, i (i)}
		<p class="hint warn">{message}</p>
	{/each}
	{#if mismatch}
		<p class="fix">
			<button
				type="button"
				title={mismatch.message}
				{disabled}
				onclick={() => onChange(setPhase(doc, mismatch.phase))}
				>Set phase to {phaseName(mismatch.phase)}</button
			>
		</p>
	{/if}

	<label class="field" title={choice?.description}>
		<span>Break</span>
		<select value={kind ?? ''} {disabled} onchange={(e) => pickKind(e.currentTarget.value)}>
			{#if !kind}
				<option value="" disabled>{String(node.values?.kind)} (no break)</option>
			{/if}
			{#each BREAK_CHOICES as c (c.kind)}
				<option value={c.kind} title={c.description}>{c.label}</option>
			{/each}
		</select>
	</label>
	{#if choice}
		<p class="hint">
			{choice.description} Plays as {phaseName(choice.phase)}. Picking another break drops the wires
			into the settings it lacks.
		</p>
	{/if}

	<div class="field">
		<span>{choice?.reversed ? 'Graph plays for the last' : 'Starts at'}</span>
		<span class="at">
			<input
				type="range"
				min="0"
				max="1"
				step="0.01"
				value={atShown}
				aria-label={choice?.reversed ? 'Graph plays for the last (slider)' : 'Starts at (slider)'}
				{disabled}
				onchange={(e) => setAt(e.currentTarget.value)}
			/>
			<input
				type="number"
				min="0"
				max="1"
				step="0.01"
				value={node.values?.at ?? ''}
				placeholder={String(atShown)}
				aria-label={choice?.reversed ? 'Graph plays for the last' : 'Starts at'}
				{disabled}
				onchange={(e) => setAt(e.currentTarget.value)}
			/>
		</span>
	</div>
	<p class="hint">{atText}</p>

	{#if params.length}
		<h4>Settings</h4>
		<p class="hint">
			Wire a Param node into a setting and whoever places the effect sets it, on its row in the
			Scene Editor, Symbols or the Flow; a Number or Colour node, or a value here, fixes it.
		</p>
		{#each params as spec (spec.id)}
			{@const value = node.values?.[spec.id]}
			{@const set = value !== undefined}
			<div class="field" title={'note' in spec ? spec.note : undefined}>
				<span>{spec.label}</span>
				{#if sources[spec.id]}
					<span class="muted">wired — {sources[spec.id]}</span>
				{:else}
					<span class="control">
						{#if spec.kind === 'number'}
							<input
								type="number"
								min={spec.min}
								max={spec.max}
								step={spec.step ?? 'any'}
								value={typeof value === 'number' ? value : ''}
								placeholder={String(spec.default)}
								aria-label={spec.label}
								{disabled}
								onchange={(e) => {
									const raw = e.currentTarget.value.trim();
									onChange(
										setBreakValue(doc, node.id, spec.id, raw === '' ? undefined : Number(raw)),
									);
								}}
							/>
							<span class="muted range">{spec.min}…{spec.max}</span>
						{:else if spec.kind === 'color'}
							<ColorField
								value={breakPortValue(spec, value).text}
								{disabled}
								onchange={(hex: string) => onChange(setBreakValue(doc, node.id, spec.id, hex))}
							/>
						{:else if spec.kind === 'bool'}
							<input
								type="checkbox"
								checked={(readBreakValue(spec, value) ?? spec.default) === true}
								aria-label={spec.label}
								{disabled}
								onchange={(e) =>
									onChange(setBreakValue(doc, node.id, spec.id, e.currentTarget.checked))}
							/>
						{:else if spec.kind === 'choice'}
							<select
								value={breakPortValue(spec, value).text}
								aria-label={spec.label}
								{disabled}
								onchange={(e) =>
									onChange(setBreakValue(doc, node.id, spec.id, e.currentTarget.value))}
							>
								{#each spec.options as option (option)}
									<option value={option}>{option}</option>
								{/each}
							</select>
						{/if}
						{#if set && spec.kind !== 'number'}
							<button
								type="button"
								class="x"
								title="Back to the break's default ({String(spec.default)})"
								{disabled}
								onclick={() => onChange(setBreakValue(doc, node.id, spec.id, undefined))}>↺</button
							>
						{/if}
					</span>
				{/if}
			</div>
		{/each}
	{/if}
</section>

<style>
	.break-props {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
	}
	header {
		display: flex;
		align-items: baseline;
		gap: 8px;
		padding-left: 8px;
		border-left: 3px solid var(--family);
	}
	h4 {
		margin: 8px 0 2px;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.field {
		display: grid;
		grid-template-columns: 110px 1fr;
		align-items: center;
		gap: 8px;
	}
	.at,
	.control {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.at input[type='range'] {
		flex: 1;
		min-width: 0;
	}
	input[type='number'],
	select {
		min-width: 0;
		font-size: 12px;
		background: #0b0e13;
		color: #e2e8f0;
		border: 1px solid #2a323d;
		border-radius: 4px;
		padding: 2px 4px;
	}
	input[type='number'] {
		width: 64px;
	}
	.field > select {
		width: 100%;
	}
	.range {
		font-size: 10px;
	}
	.hint {
		margin: 0;
		color: #94a3b8;
	}
	.warn {
		color: #fca5a5;
	}
	.fix {
		margin: 0;
	}
	.muted {
		color: #64748b;
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
</style>
