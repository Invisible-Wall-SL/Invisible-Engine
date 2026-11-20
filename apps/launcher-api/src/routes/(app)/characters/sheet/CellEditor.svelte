<script lang="ts">
	/**
	 * ONE CELL of the actions grid: what the sheet stores for an action in a facing
	 * (`$lib/characters/characterSheetPage` `CellValue`), and what the game draws there (the
	 * grid's own answer, `cell.status`). The only place a cell's value is edited: it switches on
	 * the value's kind, a frame clip so far, so another kind of value is another branch here.
	 */
	import { cellPlays, type GridCell } from '$lib/flipbook/characterSet';
	import type { CellValue } from '$lib/characters/characterSheetPage';
	import InfoTip from '$lib/ui/InfoTip.svelte';

	interface Props {
		cell: GridCell;
		/** What the sheet stores for the cell; `undefined` ⇒ left to the name rule. */
		value: CellValue | undefined;
		/** Every clip id of the project. */
		clipIds: readonly string[];
		/** Whether a clip's frames are loaded, so the preview can draw it. */
		loaded: (clipId: string) => boolean;
		readOnly: boolean;
		/** Store a value, or `undefined` for the name rule; returns why it is refused. */
		onSet: (value: CellValue | undefined) => string | null;
	}
	let { cell, value, clipIds, loaded, readOnly, onSet }: Props = $props();

	let refused = $state('');
	const plays = $derived(cellPlays(cell));
	const drawn = $derived(
		cell.status.kind === 'made'
			? `its own clip, ${cell.name}`
			: cell.status.kind === 'mirrored'
				? `${cell.status.clipId}, mirrored`
				: cell.status.kind === 'standIn'
					? `${cell.status.clipId}${cell.status.flipX ? ', mirrored' : ''} stands in`
					: 'nothing',
	);
	const kind = $derived(value?.kind ?? 'clip');
</script>

<div class="cell-editor" data-cell-editor="{cell.state}|{cell.facing}">
	<b>{cell.state}</b> facing <b>{cell.facing}</b>
	<span class="dim" data-cell-draws>draws {drawn}</span>
	{#if kind === 'clip'}
		<label class="row">
			Clip
			<input
				data-cell-clip
				list="sheet-clip-ids"
				value={value?.clip ?? ''}
				placeholder={cell.named ? '' : `by name: ${cell.name || 'no prefix yet'}`}
				spellcheck="false"
				disabled={readOnly}
				onchange={(e) => {
					const clip = e.currentTarget.value.trim();
					refused = onSet(clip ? { kind: 'clip', clip } : undefined) ?? '';
				}}
			/>
			<InfoTip>
				Leave it empty and the game finds the clip by name, <code>prefix_action_facing</code>. Name
				one of the project's clips to draw that clip here instead.
			</InfoTip>
		</label>
		<button
			class="btn"
			type="button"
			data-cell-by-name
			disabled={readOnly || !value}
			onclick={() => (refused = onSet(undefined) ?? '')}>By name</button
		>
		<datalist id="sheet-clip-ids">
			{#each clipIds as clipId (clipId)}<option value={clipId}></option>{/each}
		</datalist>
		{#if value && !clipIds.includes(value.clip)}
			<span class="warn-text" data-cell-missing>The project has no clip "{value.clip}".</span>
		{:else if plays && !loaded(plays.clipId)}
			<span class="dim" data-cell-unloaded
				>The preview draws "{plays.clipId}" once the sheet is saved.</span
			>
		{/if}
	{/if}
	{#if refused}<span class="err">{refused}</span>{/if}
</div>

<style>
	.cell-editor {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
		margin: 8px 0;
		padding: 8px 10px;
		border: 1px solid #23232c;
		border-radius: 8px;
		background: #111117;
		font-size: 12px;
	}
	.row {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.row input {
		width: 220px;
	}
	.dim {
		color: #8b8b98;
	}
	.warn-text {
		color: #d3b483;
	}
</style>
