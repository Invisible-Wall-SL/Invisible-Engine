<script lang="ts">
	import {
		REPEATER_COUNT_DEFAULT_MAX,
		REPEATER_COUNT_HARD_MAX,
		REPEATER_COUNT_PARAM,
		REPEATER_INDEX_PARAM,
		repeaterCountCap,
		componentInputs,
		type ComponentDef,
		type CountRepeaterNode,
		type RepeaterVariants,
	} from 'engine-layout';

	import EditorValueSourcePicker from './EditorValueSourcePicker.svelte';
	import { repeaterPreviewCount } from './editorCanvas.helpers';

	/**
	 * Properties of a COUNT-MODE repeater (a segmented counter): which component each segment is
	 * (with optional first / middle / last variants), how many there are (a fixed preview count, or a
	 * game value), the layout, and what every segment's number inputs follow — each with a test
	 * value the canvas previews the segments at (`previewInputs`, editor-only).
	 */
	type Props = {
		node: CountRepeaterNode;
		componentDefs: { id: string; name: string }[];
		/** The def of `node.componentId`, for its number inputs and params. */
		segmentDef: ComponentDef | null;
		componentMode: boolean;
		/** The enclosing component's param keys (which `{param}` source templates it can fill). */
		paramKeys: readonly string[];
		onChange: () => void;
	};
	const { node, componentDefs, segmentDef, componentMode, paramKeys, onChange }: Props = $props();

	const VARIANTS: { key: keyof RepeaterVariants; label: string }[] = [
		{ key: 'first', label: 'first' },
		{ key: 'middle', label: 'middle' },
		{ key: 'last', label: 'last' },
	];
	const RESERVED = [REPEATER_INDEX_PARAM, REPEATER_COUNT_PARAM];

	const cap = $derived(repeaterCountCap(node.count));
	const shown = $derived(repeaterPreviewCount(node));
	const numberInputs = $derived(
		componentInputs(segmentDef).filter((input) => input.kind === 'number'),
	);
	const passable = $derived(numberInputs.filter((input) => !RESERVED.includes(input.id)));
	/** `index` / `count` where the segment declares them (a param or a number input). */
	const given = $derived(
		RESERVED.filter(
			(id) =>
				numberInputs.some((i) => i.id === id) ||
				(segmentDef?.params ?? []).some((p) => p.key === id),
		),
	);
	const lightsByIndex = $derived(
		!segmentDef ||
			(segmentDef.params ?? []).some((p) => p.key === REPEATER_INDEX_PARAM) ||
			numberInputs.some((i) => i.id === REPEATER_INDEX_PARAM),
	);
	const nameOf = (id: string) => componentDefs.find((c) => c.id === id)?.name ?? id;

	function setVariant(key: keyof RepeaterVariants, id: string): void {
		const next: RepeaterVariants = { ...(node.variants ?? {}) };
		if (id) next[key] = id;
		else delete next[key];
		if (Object.keys(next).length) node.variants = next;
		else delete node.variants;
		onChange();
	}
	function setPass(id: string, source: string | undefined): void {
		const next = { ...(node.passInputs ?? {}) };
		if (source) next[id] = source;
		else delete next[id];
		if (Object.keys(next).length) node.passInputs = next;
		else delete node.passInputs;
		onChange();
	}
	function setTest(id: string, value: number | undefined): void {
		const next = { ...(node.previewInputs ?? {}) };
		if (value !== undefined && Number.isFinite(value)) next[id] = value;
		else delete next[id];
		if (Object.keys(next).length) node.previewInputs = next;
		else delete node.previewInputs;
		onChange();
	}
	function testValue(id: string): number {
		const own = node.previewInputs?.[id];
		if (typeof own === 'number') return own;
		const input = numberInputs.find((i) => i.id === id);
		return typeof input?.default === 'number' ? input.default : 0;
	}
</script>

<section>
	<h3>Repeat (count)</h3>
	<p class="muted small">
		Draws the segment component once per count — a segmented counter. Each copy gets its position as
		the param <code>{REPEATER_INDEX_PARAM}</code> (1, 2, 3…) and the total as
		<code>{REPEATER_COUNT_PARAM}</code>; its state machine lights it, e.g. Lit when
		<code>{`value >= {${REPEATER_INDEX_PARAM}}`}</code>.
	</p>
	<div class="row">
		<label class="field wide">
			<span>segment</span>
			<select
				value={node.componentId}
				onchange={(e) => {
					node.componentId = e.currentTarget.value;
					onChange();
				}}
			>
				{#if !componentDefs.some((c) => c.id === node.componentId)}
					<option value={node.componentId}>{node.componentId || '— pick one —'} (missing)</option>
				{/if}
				{#each componentDefs as c (c.id)}
					<option value={c.id}>{c.name}</option>
				{/each}
			</select>
		</label>
	</div>
	{#if !lightsByIndex}
		<p class="muted small warn">
			⚠ {nameOf(node.componentId)} declares no number param <code>{REPEATER_INDEX_PARAM}</code>, so
			its state machine cannot compare a value with its position. Add the param to it.
		</p>
	{/if}
	<div class="row">
		{#each VARIANTS as v (v.key)}
			<label class="field">
				<span>{v.label}</span>
				<select
					value={node.variants?.[v.key] ?? ''}
					onchange={(e) => setVariant(v.key, e.currentTarget.value)}
				>
					<option value="">{v.key === 'middle' ? 'same as segment' : 'same as middle'}</option>
					{#if node.variants?.[v.key] && !componentDefs.some((c) => c.id === node.variants?.[v.key])}
						<option value={node.variants[v.key]}>{node.variants[v.key]} (missing)</option>
					{/if}
					{#each componentDefs as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</select>
			</label>
		{/each}
	</div>
	<p class="muted small">
		End caps with their own art: the first and last segment can use another component (unset ⇒ the
		middle one). A single segment is the first.
	</p>

	<span class="sub-label">Count</span>
	<div class="row">
		<label class="field">
			<span>preview count</span>
			<input
				type="number"
				step="1"
				min="0"
				max={cap}
				value={node.count.preview}
				oninput={(e) => {
					const v = e.currentTarget.valueAsNumber;
					if (Number.isFinite(v)) {
						node.count.preview = Math.max(0, Math.round(v));
						onChange();
					}
				}}
			/>
		</label>
		<label class="field">
			<span>max</span>
			<input
				type="number"
				step="1"
				min="1"
				max={REPEATER_COUNT_HARD_MAX}
				placeholder={String(REPEATER_COUNT_DEFAULT_MAX)}
				value={node.count.max ?? ''}
				oninput={(e) => {
					const v = e.currentTarget.valueAsNumber;
					if (Number.isFinite(v))
						node.count.max = Math.min(Math.max(1, Math.round(v)), REPEATER_COUNT_HARD_MAX);
					else delete node.count.max;
					onChange();
				}}
			/>
		</label>
	</div>
	<EditorValueSourcePicker
		label="count from"
		value={node.count.source}
		{componentMode}
		{paramKeys}
		noneLabel="— fixed: the preview count —"
		onChange={(source) => {
			if (source) node.count.source = source;
			else delete node.count.source;
			onChange();
		}}
	/>
	<p class="muted small">
		{node.count.source
			? `In game the count follows ${node.count.source}; the editor draws the preview count (${shown}).`
			: `Always ${shown} segment${shown === 1 ? '' : 's'}.`}
		Never more than <strong>max</strong> ({cap}); {REPEATER_COUNT_HARD_MAX} at most.
	</p>

	<span class="sub-label">Layout</span>
	<div class="row">
		<label class="field">
			<span>direction</span>
			<select
				value={node.layout.direction}
				onchange={(e) => {
					const v = e.currentTarget.value;
					const dir = v === 'grid' || v === 'column' ? v : 'row';
					node.layout.direction = dir;
					if (dir === 'grid' && (node.layout.columns ?? 0) < 1) node.layout.columns = 3;
					onChange();
				}}
			>
				<option value="row">row</option>
				<option value="column">column</option>
				<option value="grid">grid</option>
			</select>
		</label>
		<label class="field">
			<span>gap</span>
			<input
				type="number"
				step="1"
				min="0"
				value={node.layout.gap}
				oninput={(e) => {
					const v = e.currentTarget.valueAsNumber;
					if (Number.isFinite(v)) {
						node.layout.gap = Math.max(0, v);
						onChange();
					}
				}}
			/>
		</label>
		{#if node.layout.direction === 'grid'}
			<label class="field">
				<span>columns</span>
				<input
					type="number"
					step="1"
					min="1"
					value={node.layout.columns ?? ''}
					placeholder="3"
					oninput={(e) => {
						const v = e.currentTarget.valueAsNumber;
						node.layout.columns = Number.isFinite(v) && v >= 1 ? Math.round(v) : undefined;
						onChange();
					}}
				/>
			</label>
		{/if}
	</div>

	<span class="sub-label">Pass to each segment</span>
	{#if !segmentDef}
		<p class="muted small">Pick a segment component to pass values to its inputs.</p>
	{:else}
		{#each given as id (id)}
			<p class="small given">
				<code>{id}</code>
				<span class="muted"
					>— given by the repeater ({id === REPEATER_INDEX_PARAM
						? 'the segment’s position, 1…N'
						: 'how many segments'})</span
				>
			</p>
		{/each}
		{#each passable as input (input.id)}
			<div class="pass">
				<p class="small"><code>{input.id}</code> <span class="muted">←</span></p>
				<EditorValueSourcePicker
					label="from value"
					value={node.passInputs?.[input.id]}
					{componentMode}
					{paramKeys}
					noneLabel="— the segment’s own —"
					onChange={(source) => setPass(input.id, source)}
				/>
				<div class="row">
					<label class="field wide">
						<span>test value</span>
						<input
							type="range"
							min="0"
							max={Math.max(cap, testValue(input.id))}
							step="1"
							value={testValue(input.id)}
							oninput={(e) => setTest(input.id, e.currentTarget.valueAsNumber)}
						/>
					</label>
					<label class="field">
						<span>&nbsp;</span>
						<input
							type="number"
							step="1"
							value={testValue(input.id)}
							oninput={(e) => setTest(input.id, e.currentTarget.valueAsNumber)}
						/>
					</label>
					{#if node.previewInputs?.[input.id] !== undefined}
						<button
							type="button"
							class="ghost-sm"
							title="Preview at the input's own default"
							onclick={() => setTest(input.id, undefined)}>✕</button
						>
					{/if}
				</div>
			</div>
		{:else}
			<p class="muted small">
				{segmentDef.name} has no number inputs to pass. Add one (e.g. <code>value</code>) in its
				state machine's Inputs to hand every segment a live value.
			</p>
		{/each}
		{#if passable.length}
			<p class="muted small">
				Test values only preview the segments here; the game reads the values picked above.
			</p>
		{/if}
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
	.sub-label {
		display: block;
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #9a9aa6;
		margin: 10px 0 6px;
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
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.field input[type='number'],
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
	.pass {
		padding: 8px;
		margin-bottom: 8px;
		border: 1px solid #2a2a33;
		border-radius: 6px;
	}
	.given {
		margin: 0 0 6px;
	}
	.pass p {
		margin: 0 0 6px;
	}
	.muted {
		color: #666;
		font-size: 12px;
	}
	.small {
		font-size: 11px;
	}
	.warn {
		color: #d9a441;
	}
	.ghost-sm {
		background: transparent;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		color: #aaa;
		font-size: 11px;
		padding: 4px 8px;
		cursor: pointer;
	}
</style>
