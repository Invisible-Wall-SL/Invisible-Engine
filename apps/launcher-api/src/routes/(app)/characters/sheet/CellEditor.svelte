<script lang="ts">
	/**
	 * ONE CELL of the actions grid of a sheet drawn as frame clips or still images: what the sheet
	 * stores for an action in a facing (`$lib/characters/characterSheetPage` `CellValue`), and what
	 * the game draws there (the grid's own answer, `cell.status`). The only place such a cell's
	 * value is edited: a clip by its id, a still image picked in the project's region picker
	 * (the Scene Editor's `RegionPicker`), or nothing (found by name). A value of another kind is
	 * written over only after the editor showed what is there and Replace was pressed. Mounted per
	 * cell (`{#key}` in `ActionsCard`), so a refusal is shown for the cell it was about and no
	 * other. A rig's cell has its own editor (`RigCellEditor`).
	 */
	import { cellPlays, type GridCell } from '$lib/flipbook/characterSet';
	import {
		cellValueText,
		pickOfValue,
		stillOfPick,
		type CellValue,
	} from '$lib/characters/characterSheetPage';
	import type { CellKind } from '$lib/characters/sheetCore';
	import type { PickSheet } from '$lib/pickSheets';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import RegionPicker from '../../editor/RegionPicker.svelte';

	interface Props {
		cell: GridCell;
		/** What the sheet stores for the cell; `undefined` ⇒ left to the name rule. */
		value: CellValue | undefined;
		/** The kinds of value the sheet's source draws (`sheetCore.ts` `cellKindsRead`). */
		kinds: readonly CellKind[];
		/** Every clip id of the project. */
		clipIds: readonly string[];
		/** The project's atlases and sheets a still image is picked from. */
		sheets: readonly PickSheet[];
		/** Whether a clip's frames are loaded, so the preview can draw it. */
		loaded: (clipId: string) => boolean;
		readOnly: boolean;
		/** Why the CLIP field takes nothing (`cellReadOnly`), or `null`. */
		locked: string | null;
		/** Whether storing a value would write over one of another kind (`needsReplace`). */
		replaces: (value: CellValue) => boolean;
		/** Store a value, or `undefined` to empty the cell; returns why it is refused. */
		onSet: (value: CellValue | undefined, replace?: boolean) => string | null;
	}
	let { cell, value, kinds, clipIds, sheets, loaded, readOnly, locked, replaces, onSet }: Props =
		$props();

	let refused = $state('');
	/** A value waiting for Replace: the cell holds one of another kind. */
	let waiting = $state.raw<CellValue | undefined>(undefined);
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
	function set(next: CellValue | undefined): void {
		if (next && replaces(next)) {
			waiting = next;
			refused = '';
			return;
		}
		waiting = undefined;
		refused = onSet(next) ?? '';
	}
	function replace(): void {
		refused = onSet(waiting, true) ?? '';
		waiting = undefined;
	}
</script>

<div class="cell-editor" data-cell-editor="{cell.state}|{cell.facing}">
	<div class="line">
		<b>{cell.state}</b> facing <b>{cell.facing}</b>
		<span class="dim" data-cell-draws>draws {drawn}</span>
		<span data-cell-holds={value?.kind ?? 'empty'}>
			{value ? cellValueText(value) : 'No value stored'}
		</span>
		<button
			class="btn"
			type="button"
			data-cell-by-name
			disabled={readOnly || !value}
			onclick={() => set(undefined)}>{kinds.includes('clip') ? 'By name' : 'Empty the cell'}</button
		>
	</div>
	{#if kinds.includes('clip')}
		<div class="line">
			{#if locked}
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
							set(clip ? { kind: 'clip', clip } : undefined);
						}}
					/>
					<InfoTip>
						Leave it empty and the game finds the clip by name, <code>prefix_action_facing</code>.
						Name one of the project's clips to draw that clip here instead.
					</InfoTip>
				</label>
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
		</div>
	{/if}
	{#if kinds.includes('still')}
		<div class="line">
			<span class="row">
				Still image
				<InfoTip>
					One image of a project atlas or sheet, drawn as it is in this facing. A facing the view
					mirrors needs none of its own: it draws its twin's.
				</InfoTip>
			</span>
			{#if readOnly}
				<button class="btn" type="button" disabled>Pick image…</button>
			{:else}
				<div class="picker" data-cell-still>
					<RegionPicker
						sheets={[...sheets]}
						value={pickOfValue(value)}
						scoped
						placeholder="Pick image…"
						onSelect={(pick) => set(stillOfPick(pick))}
					/>
				</div>
			{/if}
		</div>
	{/if}
	{#if waiting}
		<div class="line" data-cell-replace>
			<span class="warn-text">
				The cell holds {value ? cellValueText(value) : 'a value'}. Replace it with {cellValueText(
					waiting,
				)}?
			</span>
			<button class="btn" type="button" data-cell-replace-yes disabled={readOnly} onclick={replace}
				>Replace</button
			>
			<button class="btn" type="button" onclick={() => (waiting = undefined)}>Keep it</button>
		</div>
	{/if}
	{#if refused}<span class="err" data-cell-refused>{refused}</span>{/if}
</div>

<style>
	.cell-editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 8px 0;
		padding: 8px 10px;
		border: 1px solid #23232c;
		border-radius: 8px;
		background: #111117;
		font-size: 12px;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
	}
	.row {
		display: inline-flex;
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.row input {
		width: 220px;
	}
	.picker {
		flex: 1;
		min-width: 240px;
		max-width: 520px;
	}
	.dim {
		color: #8b8b98;
	}
	.warn-text {
		color: #d3b483;
	}
</style>
