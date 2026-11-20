<script lang="ts">
	/**
	 * ONE CELL of the actions grid: what the sheet stores for an action in a facing
	 * (`$lib/characters/characterSheetPage` `CellValue`), and what the game draws there (the
	 * grid's own answer, `cell.status`). The only place a cell's value is edited. A frame clip is
	 * the one kind it writes; a still image or a rig's animation (the other members of
	 * `CellValue`) is shown with its kind and no input, and so is any cell the tool does not write
	 * (`locked`: why). Mounted per cell (`{#key}` in `ActionsCard`), so a refusal is
	 * shown for the cell it was about and no other.
	 */
	import { cellPlays, type GridCell } from '$lib/flipbook/characterSet';
	import { cellValueText, type CellValue } from '$lib/characters/characterSheetPage';
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
		/** Why the tool does not write this cell (`cellReadOnly`), or `null`. */
		locked: string | null;
		/** Store a value, or `undefined` for the name rule; returns why it is refused. */
		onSet: (value: CellValue | undefined) => string | null;
	}
	let { cell, value, clipIds, loaded, readOnly, locked, onSet }: Props = $props();

	let refused = $state('');
	const plays = $derived(cellPlays(cell));
	const drawn = $derived(
		cell.holds?.kind === 'still'
			? 'the still image'
			: cell.status.kind === 'made'
				? `its own clip, ${cell.name}`
				: cell.status.kind === 'mirrored'
					? `${cell.status.clipId}, mirrored`
					: cell.status.kind === 'standIn'
						? `${cell.status.clipId}${cell.status.flipX ? ', mirrored' : ''} stands in`
						: 'nothing',
	);
</script>

<div class="cell-editor" data-cell-editor="{cell.state}|{cell.facing}">
	<b>{cell.state}</b> facing <b>{cell.facing}</b>
	<span class="dim" data-cell-draws>draws {drawn}</span>
	{#if locked}
		<span data-cell-readonly={value?.kind ?? 'empty'}>
			{value ? cellValueText(value) : 'No value stored'}
		</span>
		<span class="dim" data-cell-locked>{locked}</span>
	{:else}
		<label class="row">
			Clip
			<input
				data-cell-clip
				aria-label="Clip of {cell.state} facing {cell.facing}"
				list="sheet-clip-ids"
				value={value?.kind === 'clip' ? value.clip : ''}
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
		{#if value?.kind === 'clip' && !clipIds.includes(value.clip)}
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
