<script lang="ts">
	import { engineSourceGroups } from './valueSourceOptions';

	/**
	 * One engine number source, picked as "Bind to value" picks one: the grouped catalog, then
	 * "Custom source…" for a name no catalog lists (a `{param}` template such as `meter.{meter}.level`).
	 * Empty ⇒ `undefined` (no source).
	 */
	type Props = {
		label: string;
		value: string | undefined;
		componentMode: boolean;
		/** The enclosing component's param keys — which `{param}` templates it can fill. */
		paramKeys: readonly string[];
		/** What the empty choice means here. */
		noneLabel: string;
		onChange: (value: string | undefined) => void;
	};
	const { label, value, componentMode, paramKeys, noneLabel, onChange }: Props = $props();

	const groups = $derived(engineSourceGroups(componentMode, paramKeys));
	const known = $derived(groups.flatMap((g) => g.options.map((o) => o.value)));
	let custom = $state(false);
	const choice = $derived(
		custom || (value && !known.includes(`source:${value}`))
			? 'custom'
			: value
				? `source:${value}`
				: '',
	);

	function pick(next: string): void {
		custom = next === 'custom';
		if (next === 'custom') return;
		onChange(next.startsWith('source:') ? next.slice('source:'.length) : undefined);
	}
</script>

<div class="row">
	<label class="field">
		<span>{label}</span>
		<select value={choice} onchange={(e) => pick(e.currentTarget.value)}>
			<option value="">{noneLabel}</option>
			{#each groups as group (group.label)}
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
{#if choice === 'custom'}
	<div class="row">
		<label class="field">
			<span>source name</span>
			<input
				type="text"
				placeholder={componentMode ? 'e.g. meter.{meter}.level' : 'e.g. respinsLeft'}
				value={value ?? ''}
				onchange={(e) => {
					const next = e.currentTarget.value.trim();
					custom = !next;
					onChange(next || undefined);
				}}
			/>
		</label>
	</div>
{/if}

<style>
	.row {
		display: flex;
		gap: 6px;
		margin-bottom: 6px;
		align-items: flex-end;
	}
	.field {
		flex: 1 1 100%;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.field span {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.04em;
		color: #777;
	}
	.field input,
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
</style>
