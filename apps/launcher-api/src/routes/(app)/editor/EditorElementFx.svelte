<script lang="ts">
	import ColorField from '$lib/ColorField.svelte';
	import {
		ELEMENT_FX,
		ELEMENT_FX_CATEGORIES,
		ELEMENT_FX_LIMITS,
		ELEMENT_FX_TRIGGERS,
		elementFxIntensityChannel,
		elementFxProgressChannel,
		elementFxSpec,
		isElementFxKind,
		readElementFxEntry,
		readElementFxParam,
		type ElementFxEntry,
		type ElementFxKind,
		type ElementFxParamSpec,
		type ElementFxParamValue,
		type ElementFxTrigger,
	} from 'constants-shared/elementFx';
	import { SvelteSet } from 'svelte/reactivity';

	/**
	 * "Element FX": the effects that play ON a node or on a whole screen — a shake, a 3D flip, a
	 * wave, a glow, a crumble — looping while it is shown, playing when it appears, or playing on a
	 * cue. The catalog (kinds, params, limits) and the reader the game plays through are
	 * `constants-shared/elementFx`; this section writes the doc's `elementFx` list, sparsely: a value
	 * equal to its default is never stored, nor an empty name, and an empty list drops the field. An
	 * entry this build cannot read (a kind from a newer build) is kept as saved. ▶ plays one entry on
	 * the stage (`elementFxPreview.client.svelte.ts`).
	 */
	interface Props {
		/** The stored list, as saved: an entry in it may be one this build cannot read. */
		entries: ElementFxEntry[] | undefined;
		/** The next list; `undefined` ⇒ delete the field. */
		onChange: (next: ElementFxEntry[] | undefined) => void;
		/** Play one entry on the stage; false when nothing on the stage shows the element. */
		preview: (entry: ElementFxEntry) => boolean | void;
		/** Read-only (Inspect): every control but ▶ is off. */
		disabled?: boolean;
		/** The `<datalist>` the cue fields suggest from. */
		cueListId?: string;
		/** A timeline can pose this element (a node the game draws itself). False for a screen and the
		 *  reel grid: nothing poses them in the game, so `keyed` is not offered there. */
		keyable?: boolean;
	}

	const {
		entries,
		onChange,
		preview,
		disabled = false,
		cueListId,
		keyable = true,
	}: Props = $props();
	const triggers = $derived(ELEMENT_FX_TRIGGERS.filter((t) => keyable || t !== 'keyed'));

	const TRIGGER_LABELS: Record<ElementFxTrigger, string> = {
		always: 'Always (loops while shown)',
		enter: 'When shown',
		cue: 'On cue',
		keyed: 'Keyed on a timeline',
	};
	const KIND_GROUPS = ELEMENT_FX_CATEGORIES.map((category) => ({
		...category,
		kinds: ELEMENT_FX.filter((spec) => spec.category === category.id),
	}));
	const CATEGORY_LABELS = new Map(ELEMENT_FX_CATEGORIES.map((c) => [c.id, c.label]));

	const rows = $derived((entries ?? []).map((raw) => ({ raw, entry: readElementFxEntry(raw) })));
	/** Expanded rows, by entry id. */
	const open = new SvelteSet<string>();
	/** The entry whose ▶ found nothing on the stage to play on. */
	let missed = $state<string | null>(null);

	/** A new entry's trigger: a loop runs always, an entrance on show, anything else on a cue. */
	function defaultTrigger(kind: ElementFxKind): ElementFxTrigger {
		const phase = elementFxSpec(kind).phase;
		return phase === 'loop' ? 'always' : phase === 'enter' ? 'enter' : 'cue';
	}

	/** A number param's slider step: its own, or whole units over a wide range. */
	function numberStep(spec: Extract<ElementFxParamSpec, { kind: 'number' }>): number {
		return spec.step ?? (spec.max - spec.min >= 10 ? 1 : 0.01);
	}

	/** `value` on `step`'s grid, without the float noise of the multiply. */
	function snap(value: number, step: number): number {
		const decimals = (String(step).split('.')[1] ?? '').length;
		return Number((Math.round(value / step) * step).toFixed(decimals));
	}

	/** A choice option as words: `bottomRight` → `bottom right`. */
	const optionLabel = (option: string): string => option.replace(/([A-Z])/g, ' $1').toLowerCase();

	/** What an entry this build cannot read says it is. */
	function unreadableName(raw: unknown): string {
		const kind = raw && typeof raw === 'object' ? (raw as { kind?: unknown }).kind : undefined;
		return typeof kind === 'string' && kind ? kind : 'unknown';
	}

	function commit(next: ElementFxEntry[]): void {
		onChange(next.length ? next : undefined);
	}

	/** Rewrite entry `index` on a copy (a field this build does not know is kept). */
	function edit(index: number, change: (entry: ElementFxEntry) => void): void {
		const list = [...(entries ?? [])];
		const raw = list[index];
		if (!raw) return;
		const next: ElementFxEntry = { ...raw };
		if (raw.params) next.params = { ...raw.params };
		change(next);
		if (next.params && !Object.keys(next.params).length) delete next.params;
		list[index] = next;
		commit(list);
	}

	function add(kind: ElementFxKind): void {
		const taken = new Set((entries ?? []).map((e) => e.id));
		let n = 1;
		while (taken.has(`efx${n}`)) n++;
		const id = `efx${n}`;
		commit([...(entries ?? []), { id, kind, trigger: defaultTrigger(kind) }]);
		open.add(id);
	}

	function remove(index: number): void {
		commit((entries ?? []).filter((_, i) => i !== index));
	}

	function move(index: number, by: -1 | 1): void {
		const list = [...(entries ?? [])];
		const to = index + by;
		if (to < 0 || to >= list.length) return;
		[list[index], list[to]] = [list[to], list[index]];
		commit(list);
	}

	function setEnabled(index: number, on: boolean): void {
		edit(index, (e) => {
			if (on) delete e.disabled;
			else e.disabled = true;
		});
	}

	/** A new kind keeps the params it also declares (read against its own ranges); the rest go. */
	function setKind(index: number, kind: ElementFxKind): void {
		edit(index, (e) => {
			const spec = elementFxSpec(kind);
			const params: Record<string, ElementFxParamValue> = {};
			for (const p of spec.params) {
				const value = readElementFxParam(p, e.params?.[p.id]);
				if (value !== undefined && value !== p.default) params[p.id] = value;
			}
			e.kind = kind;
			e.params = params;
			if (e.durationMs === spec.durationMs) delete e.durationMs;
		});
	}

	/** Leaving `cue` drops the cue, `always` / `keyed` the play count, and `keyed` the delay: none
	 *  means anything there (a timeline places a keyed effect itself). */
	function setTrigger(index: number, trigger: ElementFxTrigger): void {
		edit(index, (e) => {
			e.trigger = trigger;
			if (trigger !== 'cue') delete e.cue;
			if (!counted(trigger)) delete e.repeat;
			if (trigger === 'keyed') delete e.delayMs;
		});
	}

	/** A trigger that plays a set number of times (`always` loops, a timeline poses `keyed`). */
	const counted = (trigger: ElementFxTrigger): boolean => trigger === 'enter' || trigger === 'cue';

	function setName(index: number, field: 'cue' | 'stopCue', value: string): void {
		edit(index, (e) => {
			const name = value.trim();
			if (name) e[field] = name;
			else delete e[field];
		});
	}

	/** A whole-number field, clamped to its limits; blank or `fallback` (its default) is unset. */
	function setCount(
		index: number,
		field: 'durationMs' | 'delayMs' | 'repeat',
		value: number,
		fallback: number,
	): void {
		edit(index, (e) => {
			const { min, max } = ELEMENT_FX_LIMITS[field];
			const v = Number.isFinite(value) ? Math.round(Math.min(max, Math.max(min, value))) : fallback;
			if (v === fallback) delete e[field];
			else e[field] = v;
		});
	}

	function setIntensity(index: number, value: number): void {
		edit(index, (e) => {
			const { min, max } = ELEMENT_FX_LIMITS.intensity;
			const v = Number.isFinite(value) ? snap(Math.min(max, Math.max(min, value)), 0.01) : 1;
			if (v === 1) delete e.intensity;
			else e.intensity = v;
		});
	}

	/** One param, read against its spec; `undefined`, unreadable or its default ⇒ unset. */
	function setParam(
		index: number,
		spec: ElementFxParamSpec,
		value: ElementFxParamValue | undefined,
	): void {
		edit(index, (e) => {
			const params = { ...e.params };
			const given =
				spec.kind === 'number' && typeof value === 'number' ? snap(value, numberStep(spec)) : value;
			const read = given === undefined ? undefined : readElementFxParam(spec, given);
			if (read === undefined || read === spec.default) delete params[spec.id];
			else params[spec.id] = read;
			e.params = params;
		});
	}

	function play(entry: ElementFxEntry): void {
		missed = preview(entry) === false ? entry.id : null;
	}

	function toggle(id: string): void {
		if (open.has(id)) open.delete(id);
		else open.add(id);
	}
</script>

{#snippet kindOptions()}
	{#each KIND_GROUPS as group (group.id)}
		<optgroup label={group.label}>
			{#each group.kinds as spec (spec.kind)}
				<option value={spec.kind}>{spec.label}</option>
			{/each}
		</optgroup>
	{/each}
{/snippet}

{#snippet when(entry: ElementFxEntry)}
	{#if entry.trigger === 'always'}
		always, looping
	{:else if entry.trigger === 'keyed'}
		keyed on a timeline
	{:else}
		{#if entry.trigger === 'enter'}
			when shown
		{:else if entry.cue}
			on cue <code>{entry.cue}</code>
		{:else}
			on cue <em>(none yet)</em>
		{/if}
		{#if entry.repeat === 0}
			· until stopped
		{:else if entry.repeat && entry.repeat > 1}
			· ×{entry.repeat}
		{/if}
	{/if}
{/snippet}

<section class="element-fx">
	<h3>Element FX</h3>
	{#if !rows.length}
		<p class="muted small">
			Effects that play on it: a shake, a 3D flip, a wave, a glow, a crumble — looping while it is
			shown, when it appears, or on a cue.
		</p>
	{/if}

	{#each rows as row, index (index)}
		{@const entry = row.entry}
		{#if !entry}
			<div class="fx-row">
				<div class="fx-head">
					<span class="fx-unreadable">⚠ {unreadableName(row.raw)}</span>
					<span class="fx-actions">
						{@render reorder(index)}
					</span>
				</div>
				<p class="hint warn">
					This build cannot read or play this effect (an unknown kind, or no id or trigger). It is
					kept as saved.
				</p>
			</div>
		{:else}
			{@const spec = elementFxSpec(entry.kind)}
			{@const expanded = open.has(entry.id)}
			<div class="fx-row" class:off={entry.disabled}>
				<div class="fx-head">
					<input
						type="checkbox"
						checked={!entry.disabled}
						{disabled}
						title={entry.disabled ? 'Off: it never plays. Tick to turn it on.' : 'On'}
						aria-label="Effect on"
						onchange={(e) => setEnabled(index, e.currentTarget.checked)}
					/>
					<button
						type="button"
						class="fx-toggle"
						aria-expanded={expanded}
						onclick={() => toggle(entry.id)}
					>
						<span class="fx-title">
							<span class="caret">{expanded ? '▾' : '▸'}</span>
							<strong>{spec.label}</strong>
							<span class="fx-cat">{CATEGORY_LABELS.get(spec.category)}</span>
						</span>
						<span class="fx-when">{@render when(entry)}</span>
					</button>
					<span class="fx-actions">
						<button
							type="button"
							class="icon play"
							title="Preview on the stage (Esc stops it)"
							aria-label="Preview"
							onclick={() => play(entry)}>▶</button
						>
						{@render reorder(index)}
					</span>
				</div>
				{#if missed === entry.id}
					<p class="hint warn">
						Nothing on the stage to play it on: show the element and its screen first.
					</p>
				{/if}
				{#if expanded}
					<div class="fx-body">
						<div class="row">
							<label class="field wide">
								<span>Kind</span>
								<select
									value={entry.kind}
									{disabled}
									onchange={(e) => {
										const kind = e.currentTarget.value;
										if (isElementFxKind(kind)) setKind(index, kind);
									}}
								>
									{@render kindOptions()}
								</select>
							</label>
						</div>
						<p class="hint">{spec.description}</p>
						<div class="row">
							<label class="field wide">
								<span>Trigger</span>
								<select
									value={entry.trigger}
									{disabled}
									onchange={(e) => setTrigger(index, e.currentTarget.value as ElementFxTrigger)}
								>
									{#each triggers as trigger (trigger)}
										<option value={trigger}>{TRIGGER_LABELS[trigger]}</option>
									{/each}
									{#if !triggers.includes(entry.trigger)}
										<option value={entry.trigger}>{TRIGGER_LABELS[entry.trigger]}</option>
									{/if}
								</select>
							</label>
						</div>
						{#if entry.trigger === 'cue'}
							<div class="row">
								<label class="field wide">
									<span>Cue</span>
									<input
										type="text"
										list={cueListId}
										value={entry.cue ?? ''}
										placeholder="e.g. bigWin"
										{disabled}
										onchange={(e) => setName(index, 'cue', e.currentTarget.value)}
									/>
								</label>
							</div>
							{#if !entry.cue}
								<p class="hint warn">
									Does nothing yet: name the cue that plays it (a Flow Fire Cue, a component
									signal).
								</p>
							{/if}
						{/if}
						<div class="row">
							<label class="field wide">
								<span>Stop cue</span>
								<input
									type="text"
									list={cueListId}
									value={entry.stopCue ?? ''}
									placeholder="optional: stops it and puts it back at rest"
									{disabled}
									onchange={(e) => setName(index, 'stopCue', e.currentTarget.value)}
								/>
							</label>
						</div>
						<div class="row">
							<label class="field">
								<span>Duration ms</span>
								<input
									type="number"
									min={ELEMENT_FX_LIMITS.durationMs.min}
									max={ELEMENT_FX_LIMITS.durationMs.max}
									step="10"
									value={entry.durationMs ?? ''}
									placeholder={String(spec.durationMs)}
									{disabled}
									onchange={(e) =>
										setCount(index, 'durationMs', e.currentTarget.valueAsNumber, spec.durationMs)}
								/>
							</label>
							{#if entry.trigger !== 'keyed'}
								<label class="field">
									<span>Delay ms</span>
									<input
										type="number"
										min={ELEMENT_FX_LIMITS.delayMs.min}
										max={ELEMENT_FX_LIMITS.delayMs.max}
										step="10"
										value={entry.delayMs ?? ''}
										placeholder="0"
										{disabled}
										onchange={(e) => setCount(index, 'delayMs', e.currentTarget.valueAsNumber, 0)}
									/>
								</label>
							{/if}
						</div>
						<div class="row">
							<div class="field wide">
								<span>Intensity</span>
								<div class="value">
									<input
										type="range"
										min={ELEMENT_FX_LIMITS.intensity.min}
										max={ELEMENT_FX_LIMITS.intensity.max}
										step="0.05"
										value={entry.intensity ?? 1}
										{disabled}
										aria-label="Intensity"
										oninput={(e) => setIntensity(index, e.currentTarget.valueAsNumber)}
									/>
									<input
										type="number"
										min={ELEMENT_FX_LIMITS.intensity.min}
										max={ELEMENT_FX_LIMITS.intensity.max}
										step="0.05"
										value={entry.intensity ?? 1}
										{disabled}
										aria-label="Intensity"
										onchange={(e) => setIntensity(index, e.currentTarget.valueAsNumber)}
									/>
									{#if entry.intensity !== undefined}
										<button
											type="button"
											class="reset"
											{disabled}
											title="Back to 1, the kind's reference strength"
											onclick={() => setIntensity(index, 1)}>×</button
										>
									{/if}
								</div>
							</div>
						</div>
						{#if entry.trigger === 'keyed' && !keyable}
							<p class="hint">
								Nothing poses a screen or the reels in the game: a keyed entry here stays at rest.
								Use <strong>On cue</strong> instead.
							</p>
						{:else if entry.trigger === 'keyed'}
							<p class="hint">
								Never plays on its own: a timeline (or a state machine state) poses it. In Animate,
								key its <strong>✦ {spec.label}</strong> rows —
								<code>{elementFxProgressChannel(entry.id)}</code> (0 at rest … 1 at its end) and its
								strength <code>{elementFxIntensityChannel(entry.id)}</code> (× its intensity). ▶ plays
								it once from rest to its end.
							</p>
						{/if}
						{#if counted(entry.trigger)}
							<div class="row">
								<label class="field">
									<span>Plays (0 = until stopped)</span>
									<input
										type="number"
										min={ELEMENT_FX_LIMITS.repeat.min}
										max={ELEMENT_FX_LIMITS.repeat.max}
										step="1"
										value={entry.repeat ?? ''}
										placeholder="1"
										{disabled}
										onchange={(e) => setCount(index, 'repeat', e.currentTarget.valueAsNumber, 1)}
									/>
								</label>
							</div>
						{/if}
						{#if spec.phase === 'exit'}
							<p class="hint">
								Ends hidden — stays hidden until its stop cue or an entering effect.
							</p>
						{:else if spec.phase === 'loop' && counted(entry.trigger)}
							<p class="hint">
								A looping effect: played a set number of times, it fades in and out.
							</p>
						{/if}

						{#if spec.params.length}
							<h4 class="sub-h">Parameters</h4>
							{#each spec.params as p (p.id)}
								{@const stored = entry.params?.[p.id]}
								{@const value = stored ?? p.default}
								<div class="row">
									<div class="field wide">
										<span>{p.label}</span>
										<div class="value">
											{#if p.kind === 'number'}
												<input
													type="range"
													min={p.min}
													max={p.max}
													step={numberStep(p)}
													value={value as number}
													{disabled}
													aria-label={p.label}
													oninput={(e) => setParam(index, p, e.currentTarget.valueAsNumber)}
												/>
												<input
													type="number"
													min={p.min}
													max={p.max}
													step={numberStep(p)}
													value={value as number}
													{disabled}
													aria-label={p.label}
													onchange={(e) => setParam(index, p, e.currentTarget.valueAsNumber)}
												/>
												{#if p.unit}<span class="unit">{p.unit}</span>{/if}
											{:else if p.kind === 'color'}
												<ColorField
													value={value as string}
													{disabled}
													title={p.label}
													oninput={(hex) => setParam(index, p, hex)}
												/>
											{:else if p.kind === 'bool'}
												<input
													type="checkbox"
													checked={value === true}
													{disabled}
													aria-label={p.label}
													onchange={(e) => setParam(index, p, e.currentTarget.checked)}
												/>
											{:else}
												<select
													value={value as string}
													{disabled}
													aria-label={p.label}
													onchange={(e) => setParam(index, p, e.currentTarget.value)}
												>
													{#each p.options as option (option)}
														<option value={option}>{optionLabel(option)}</option>
													{/each}
												</select>
											{/if}
											{#if stored !== undefined}
												<button
													type="button"
													class="reset"
													{disabled}
													title="Back to the default ({String(p.default)})"
													onclick={() => setParam(index, p, undefined)}>×</button
												>
											{/if}
										</div>
									</div>
								</div>
								{#if p.note}
									<p class="hint">{p.note}</p>
								{/if}
							{/each}
						{/if}
					</div>
				{/if}
			</div>
		{/if}
	{/each}

	<div class="row">
		<label class="field wide">
			<span>Add an effect</span>
			<select
				value=""
				{disabled}
				onchange={(e) => {
					const kind = e.currentTarget.value;
					e.currentTarget.value = '';
					if (isElementFxKind(kind)) add(kind);
				}}
			>
				<option value="">+ Add effect…</option>
				{@render kindOptions()}
			</select>
		</label>
	</div>
	{#if rows.length}
		<p class="hint">
			Preview plays on a still of the element; in the game it plays on the live one.
		</p>
	{/if}
</section>

{#snippet reorder(index: number)}
	<button
		type="button"
		class="icon"
		title="Move up (plays earlier)"
		aria-label="Move up"
		disabled={disabled || index === 0}
		onclick={() => move(index, -1)}>▲</button
	>
	<button
		type="button"
		class="icon"
		title="Move down"
		aria-label="Move down"
		disabled={disabled || index === rows.length - 1}
		onclick={() => move(index, 1)}>▼</button
	>
	<button
		type="button"
		class="icon danger"
		title="Remove this effect"
		aria-label="Remove"
		{disabled}
		onclick={() => remove(index)}>✕</button
	>
{/snippet}

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
	.sub-h {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #888;
		margin: 8px 0 4px;
	}
	.fx-row {
		padding: 6px 8px;
		margin-bottom: 8px;
		border: 1px solid #2a2a33;
		border-radius: 6px;
	}
	.fx-head {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.fx-head input[type='checkbox'] {
		flex: 0 0 auto;
		accent-color: #6b5bff;
	}
	.fx-toggle {
		flex: 1 1 auto;
		min-width: 0;
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 2px;
		background: transparent;
		border: none;
		padding: 2px 0;
		color: #e8e8ee;
		font: inherit;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}
	.fx-title {
		display: flex;
		align-items: center;
		gap: 6px;
		max-width: 100%;
	}
	.fx-title strong {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.caret {
		color: #777;
		font-size: 10px;
	}
	.fx-cat {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
		padding: 1px 6px;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		white-space: nowrap;
	}
	.fx-when {
		font-size: 11px;
		color: #888;
		max-width: 100%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.fx-when code {
		color: #c8a3ff;
	}
	.fx-row.off .fx-toggle {
		opacity: 0.5;
	}
	.fx-unreadable {
		flex: 1 1 auto;
		min-width: 0;
		color: #d98a3a;
		font-size: 12px;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.fx-actions {
		flex: 0 0 auto;
		display: flex;
		gap: 2px;
	}
	.icon {
		background: transparent;
		border: 1px solid #2a2a33;
		color: #ccc;
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 4px;
		font-size: 10px;
		line-height: 1;
		cursor: pointer;
	}
	.icon:hover:not(:disabled) {
		border-color: #6b5bff;
	}
	.icon:disabled {
		opacity: 0.35;
		cursor: default;
	}
	.icon.play {
		color: #7ee0c0;
	}
	.icon.danger {
		color: #ff9a9a;
		border-color: #4a2a30;
	}
	.fx-body {
		margin-top: 8px;
		padding-top: 8px;
		border-top: 1px dashed #2a2a33;
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
		min-width: 0;
	}
	.field.wide {
		flex: 1 1 100%;
	}
	.field > span {
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
		accent-color: #6b5bff;
	}
	.value {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.value input[type='range'] {
		flex: 1 1 auto;
		min-width: 0;
	}
	.value input[type='number'] {
		flex: 0 0 5.5em;
		width: 5.5em;
	}
	.value select {
		flex: 1 1 auto;
	}
	.unit {
		font-size: 11px;
		color: #777;
		white-space: nowrap;
	}
	.reset {
		flex: 0 0 auto;
		background: transparent;
		border: none;
		color: #c8a3ff;
		cursor: pointer;
		font-size: 14px;
		line-height: 1;
		padding: 2px 4px;
	}
	.reset:hover:not(:disabled) {
		color: #fff;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.small {
		font-size: 11px;
	}
	.hint {
		font-size: 10px;
		color: #777;
		line-height: 1.3;
		margin: 0 0 6px;
	}
	.hint.warn {
		color: #d98a3a;
	}
</style>
