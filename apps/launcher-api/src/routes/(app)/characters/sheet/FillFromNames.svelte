<script lang="ts">
	/**
	 * FILL FROM NAMES (`docs/design/character-pipeline.md` §12.4, step C6b): the images of one
	 * project sheet named `<character>_<action>_<facing>` each go to their cell. It is a plan
	 * first (`characterSheetFill.ts` `fillFromNames`, shown as `fillPlanText` says it): what it
	 * fills, what it found no image for, what it would write over, and, when the sheet holds the
	 * images of several characters, which one this is. Nothing is written until Apply, and a cell
	 * that holds something else is written over only with the box ticked.
	 */
	import {
		applyFill,
		fillDoneText,
		fillFromNames,
		fillPlanText,
		fillSourceOf,
		type FillSource,
	} from '$lib/characters/characterSheetFill';
	import { setDrawWidth } from '$lib/characters/characterSheetEdit';
	import type { CharacterSheet } from 'game-config';
	import type { WholeRead } from '../wholeRead.svelte';
	import type { SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		sheet: CharacterSheet | undefined;
		read: WholeRead;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, sheet, read, readOnly, edit }: Props = $props();

	let key = $state('');
	let source = $state.raw<FillSource | undefined>(undefined);
	let reading = $state(false);
	/** The character picked when the sheet's images name several. */
	let prefix = $state<string | undefined>(undefined);
	let overwrite = $state(false);
	let addActions = $state(true);
	let refused = $state('');
	let done = $state('');
	/** A width the plan found for a sheet with none, offered after it is applied. */
	let width = $state<number | undefined>(undefined);
	const plan = $derived(source ? fillFromNames(sheet, source, { prefix }) : undefined);

	async function pick(next: string): Promise<void> {
		key = next;
		source = undefined;
		prefix = undefined;
		overwrite = false;
		refused = '';
		done = '';
		if (!next) return;
		reading = true;
		try {
			const set = await read.regionsOf(next);
			if (key === next) source = fillSourceOf(set);
		} finally {
			reading = false;
		}
	}
	function apply(): void {
		if (!plan) return;
		const planned = plan;
		let out: ReturnType<typeof applyFill> | undefined;
		refused =
			edit((d) => (out = applyFill(d, id, planned, { overwrite, addActions })).refused) ?? '';
		if (refused || !out) return;
		done = fillDoneText(out);
		width = planned.width;
		overwrite = false;
	}
</script>

<div class="fill" data-fill>
	<label class="row">
		Fill from names
		<select
			data-fill-sheet
			aria-label="The sheet whose images fill the cells by their names"
			value={key}
			disabled={readOnly || reading || !read.read}
			onchange={(e) => void pick(e.currentTarget.value)}
		>
			<option value="">Pick a sheet…</option>
			{#each read.sheets as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
		</select>
	</label>
	{#if read.sheetsError}<span class="err">{read.sheetsError}</span>{/if}
	{#if reading}<span class="dim">reading its images…</span>{/if}
	{#if plan}
		<ul class="plan" data-fill-plan data-fill-ambiguous={plan.ambiguous}>
			{#each fillPlanText(plan) as line (line)}<li>{line}</li>{/each}
		</ul>
		{#if plan.ambiguous || prefix !== undefined}
			<div class="btns" data-fill-prefixes>
				{#each plan.prefixes as p (p)}
					<button
						class="btn"
						class:on={p === prefix}
						type="button"
						data-fill-prefix={p}
						aria-pressed={p === prefix}
						disabled={readOnly}
						onclick={() => (prefix = p)}>{p || 'no prefix'}</button
					>
				{/each}
			</div>
		{/if}
		{#if !plan.ambiguous && !plan.refused}
			<div class="btns">
				{#if plan.newActions.length}
					<label class="check">
						<input
							type="checkbox"
							data-fill-add-actions
							bind:checked={addActions}
							disabled={readOnly}
						/>
						Add the action{plan.newActions.length === 1 ? '' : 's'}
						{plan.newActions.join(', ')}
					</label>
				{/if}
				{#if plan.overwrites.length}
					<label class="check">
						<input
							type="checkbox"
							data-fill-overwrite
							bind:checked={overwrite}
							disabled={readOnly}
						/>
						Replace what {plan.overwrites.length === 1
							? 'the 1 cell holds'
							: `the ${plan.overwrites.length} cells hold`}
					</label>
				{/if}
				<button
					class="btn"
					type="button"
					data-fill-apply
					disabled={readOnly || (!plan.fills.length && !plan.overwrites.length)}
					onclick={apply}>Apply</button
				>
			</div>
		{/if}
	{/if}
	{#if refused}<p class="err" data-fill-refused>{refused}</p>{/if}
	{#if done}
		<p class="note" data-fill-done>
			{done}
			{#if width && !sheet?.draw}
				<button
					class="btn"
					type="button"
					data-fill-width
					disabled={readOnly}
					onclick={() => (refused = edit((d) => setDrawWidth(d, id, String(width))) ?? '')}
					>Set the width to {width} px, the widest image</button
				>
			{/if}
		</p>
	{/if}
</div>

<style>
	.fill {
		margin: 12px 0 4px;
		font-size: 12px;
	}
	.row {
		flex-direction: row;
		align-items: center;
		gap: 8px;
	}
	.plan {
		margin: 8px 0;
		padding-left: 18px;
		line-height: 1.6;
		color: #cbd5e1;
	}
	.btn.on {
		border-color: #2563eb;
		color: #dbeafe;
	}
	.dim {
		color: #8b8b98;
	}
</style>
