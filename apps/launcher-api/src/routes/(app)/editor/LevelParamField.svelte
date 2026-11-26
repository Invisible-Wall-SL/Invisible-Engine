<script lang="ts">
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';

	/**
	 * One number of a generated level (`EditorLevelGenerator.svelte`, `EditorLevelBiomes.svelte`):
	 * its label and help, a slider and a field over its limits, and, once set, a reset back to the
	 * default it otherwise plays (the field's placeholder).
	 */
	type Props = {
		label: string;
		help: string;
		/** The authored value, or none (the default plays). */
		value: number | undefined;
		fallback: number;
		limit: readonly [number, number];
		step: number;
		/** A count, a column or cells: what is typed or slid is rounded to a whole number. */
		whole?: boolean;
		disabled?: boolean;
		/** A value, or `undefined` to go back to the default. */
		onset: (value: number | undefined) => void;
	};
	const {
		label,
		help,
		value,
		fallback,
		limit,
		step,
		whole = false,
		disabled = false,
		onset,
	}: Props = $props();

	const shown = $derived(value ?? fallback);
	/** Held to the limits, whole where it must be, without a slider step's float tail. */
	const held = (v: number) => {
		const within = Math.min(limit[1], Math.max(limit[0], v));
		return whole ? Math.round(within) : Number(within.toFixed(4));
	};
</script>

<div class="param" class:set={value !== undefined}>
	<span class="name">
		{label}
		<InfoTip>{help} Default {fallback}; {limit[0]} to {limit[1]}.</InfoTip>
	</span>
	<input
		type="range"
		min={limit[0]}
		max={limit[1]}
		{step}
		value={shown}
		{disabled}
		aria-label={label}
		oninput={(e) => onset(held(e.currentTarget.valueAsNumber))}
	/>
	<input
		type="number"
		min={limit[0]}
		max={limit[1]}
		{step}
		value={value ?? ''}
		placeholder={String(fallback)}
		{disabled}
		aria-label="{label} (number)"
		onchange={(e) => {
			const field = e.currentTarget;
			if (field.value === '' || Number.isNaN(field.valueAsNumber)) return onset(undefined);
			const v = held(field.valueAsNumber);
			field.value = String(v);
			onset(v);
		}}
	/>
	<span class="reset">
		{#if value !== undefined}
			<IconButton
				icon="reset"
				label="Back to {fallback}"
				{disabled}
				onclick={() => onset(undefined)}
			/>
		{/if}
	</span>
</div>

<style>
	.param {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 76px 54px 22px;
		align-items: center;
		gap: 6px;
		margin: 3px 0;
		font-size: 12px;
	}
	.name {
		min-width: 0;
		line-height: 1.25;
		color: #b8b8c4;
	}
	.set .name {
		color: #e6e6ee;
	}
	input[type='range'] {
		width: 100%;
		min-width: 0;
		margin: 0;
		accent-color: #7ee0c0;
	}
	input[type='number'] {
		width: 100%;
		min-width: 0;
		box-sizing: border-box;
	}
	.reset {
		display: inline-flex;
		width: 22px;
	}
</style>
