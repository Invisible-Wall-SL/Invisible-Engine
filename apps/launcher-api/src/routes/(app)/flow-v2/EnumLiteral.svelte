<script lang="ts">
	import { enumChoices } from './enumChoices';

	/**
	 * An enum literal's picker: a dropdown for one value, toggle chips for a list. Options come from
	 * `enumChoices`, so a stored value the enum no longer lists (a symbol taken off the reels) stays on
	 * screen, flagged, until the author picks another or removes it. Only a pick or a click commits.
	 */
	let {
		enumName,
		values,
		value,
		list = false,
		unset = false,
		optional = false,
		commit,
	}: {
		enumName: string;
		values: readonly string[];
		value: unknown;
		/** A list of the enum (`SymbolName[]`): chips instead of a dropdown. */
		list?: boolean;
		/** `value` is the phantom default, not a stored value (see the inspector's `dataSourceEditor`). */
		unset?: boolean;
		optional?: boolean;
		commit: (value: string | string[]) => void;
	} = $props();

	const choices = $derived(enumChoices(enumName, values, unset ? undefined : value));
	const selected = $derived(Array.isArray(value) ? value.map(String) : []);
</script>

<div class="enum-literal">
	{#if list}
		<!-- PICKED, not typed: one toggle chip per member. Clicking adds/removes it from the stored array.
	     Empty = the effect default. A flagged chip removes its stale value. -->
		<div class="chips">
			{#each choices.options as v (v)}
				<button
					type="button"
					class="chip"
					class:on={selected.includes(v)}
					onclick={() =>
						commit(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])}
					>{v}</button
				>
			{/each}
			{#each choices.stale as v (v)}
				<button
					type="button"
					class="chip stale"
					title="{v} — {choices.flag}. Click to remove it."
					onclick={() => commit(selected.filter((x) => x !== v))}>{v} — {choices.flag} ✕</button
				>
			{/each}
			{#if choices.options.length === 0 && choices.stale.length === 0}
				<span class="note">no options</span>
			{/if}
		</div>
	{:else}
		<select
			class:stale={choices.stale.length > 0}
			value={unset ? '' : String(value ?? '')}
			onchange={(e) => commit(e.currentTarget.value)}
		>
			{#if unset}
				<!-- Without this, the select shows the first member as though it were chosen, and
			     picking that member fires no change event — so it can never be stored. -->
				<option value="" disabled>{optional ? '— default —' : '— choose —'}</option>
			{/if}
			{#each choices.stale as v (v)}
				<option value={v}>{v} — {choices.flag}</option>
			{/each}
			{#each choices.options as v (v)}
				<option value={v}>{v}</option>
			{/each}
		</select>
	{/if}
	{#if choices.stale.length > 0}
		<span class="note stale-note">{choices.note}</span>
	{/if}
</div>

<style>
	.enum-literal {
		display: flex;
		flex-direction: column;
		gap: 3px;
		flex: 1;
		min-width: 0;
	}
	select {
		box-sizing: border-box;
		background: #14181f;
		border: 1px solid #2a323d;
		border-radius: 6px;
		color: #e2e8f0;
		font-size: 12px;
		padding: 4px 7px;
		width: 100%;
	}
	select:focus {
		outline: none;
		border-color: #2563eb;
	}
	select.stale {
		border-color: #f59e0b;
		color: #fbbf24;
	}
	.note {
		font-size: 10px;
		color: #94a3b8;
		font-style: italic;
	}
	.stale-note {
		color: #fbbf24;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.chip {
		padding: 2px 9px;
		font-size: 12px;
		line-height: 1.5;
		border: 1px solid #2a323d;
		border-radius: 999px;
		background: #14181f;
		color: #cbd5e1;
		cursor: pointer;
	}
	.chip:hover {
		border-color: #3b475a;
	}
	.chip.on {
		background: #2563eb;
		border-color: #2563eb;
		color: #fff;
	}
	.chip.stale {
		border-color: #f59e0b;
		background: #f59e0b1a;
		color: #fbbf24;
	}
</style>
