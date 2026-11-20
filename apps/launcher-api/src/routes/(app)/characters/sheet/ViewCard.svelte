<script lang="ts">
	/**
	 * The sheet's VIEW (`docs/design/character-pipeline.md` §12.3): how the character is seen, in
	 * how many facings, and whether the west ones are mirrored. Every edit is one of
	 * `$lib/characters/characterSheetEdit`.
	 */
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import { SHEET_CARD_TITLES, sheetCardId } from '$lib/characters/characterSheetPage';
	import type { CharacterSheet, GameConfigIssue } from 'game-config';
	import IssueList from './IssueList.svelte';
	import { settle, type SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		sheet: CharacterSheet | undefined;
		/** The validator's issues of this card, the screen's warnings among them. */
		issues: GameConfigIssue[];
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, sheet, issues, readOnly, edit }: Props = $props();

	const view = $derived(sheet?.view);
	const drawing = $derived(sheets.viewDrawing(view));
	const undrawn = $derived(sheets.undrawnAnimCells(sheet));
	let refused = $state('');
	let dropped = $state('');
	const run = (change: Parameters<SheetEdit>[0]): void => {
		refused = edit(change) ?? '';
		dropped = '';
	};
</script>

<div id={sheetCardId('view')} data-sheet-card="view">
	<SectionCard scope="characters" id={sheetCardId('view')} title={SHEET_CARD_TITLES.view}>
		{#snippet info()}
			<p>
				How the game sees this character, which decides the facings it is drawn in: side (east and
				west), top-down or isometric (four or eight). With no view it is drawn in the four isometric
				diagonals, as every character was before the sheet.
			</p>
		{/snippet}
		{#snippet actions()}
			{#if view}
				<IconButton
					icon="reset"
					label="Take the view away (the four isometric diagonals)"
					disabled={readOnly}
					onclick={() => run((d) => sheets.clearView(d, id))}
				/>
			{/if}
		{/snippet}
		<div class="fields">
			<label
				>Kind
				<select
					data-view-kind
					value={view?.kind ?? ''}
					disabled={readOnly}
					onchange={(e) => {
						const kind = e.currentTarget.value;
						run((d) =>
							kind
								? sheets.setViewKind(d, id, kind as sheets.EditableViewKind)
								: sheets.clearView(d, id),
						);
						if (refused) settle(e.currentTarget, view?.kind);
					}}
				>
					<option value="">Not set (isometric, 4)</option>
					{#if view?.kind === '3d'}
						<option value="3d" disabled>{sheets.VIEW_KIND_LABELS['3d']} (stored)</option>
					{/if}
					{#each sheets.VIEW_KIND_OPTIONS as option (option.value)}
						<option value={option.value}>{option.label}</option>
					{/each}
				</select>
			</label>
			{#if sheets.viewTakesFacings(view)}
				<label
					>Facings
					<select
						data-view-facings
						value={String(drawing.facings.length === 8 ? 8 : 4)}
						disabled={readOnly}
						onchange={(e) => {
							const facings = e.currentTarget.value === '8' ? 8 : 4;
							run((d) => sheets.setViewFacings(d, id, facings));
						}}
					>
						{#each sheets.VIEW_FACING_OPTIONS as option (option.value)}
							<option value={String(option.value)}>{option.label}</option>
						{/each}
					</select>
				</label>
			{/if}
			{#if sheets.viewTakesMirror(view)}
				<label class="check">
					<input
						type="checkbox"
						data-view-mirror
						checked={view?.kind !== '3d' && view?.mirror !== false}
						disabled={readOnly}
						onchange={(e) => {
							const on = e.currentTarget.checked;
							run((d) => sheets.setViewMirror(d, id, on));
						}}
					/>
					Mirror the west facings
					<InfoTip>
						On: a west facing is its east twin drawn mirrored, so no art is made for it. Off, for
						art that cannot be flipped (a sword in one hand): every facing is made.
					</InfoTip>
				</label>
			{/if}
		</div>
		{#if refused}<p class="err">{refused}</p>{/if}
		<dl class="facts" data-view-drawing>
			<dt>Draws</dt>
			<dd>{drawing.facings.join(' ') || 'no facing'}</dd>
			<dt>Art is made for</dt>
			<dd>{drawing.made.join(' ') || 'none'}</dd>
			<dt>Mirrored</dt>
			<dd>{drawing.mirrored.join(' ') || 'none'}</dd>
		</dl>
		<IssueList {issues} />
		{#if undrawn.length}
			<p class="note" data-undrawn>
				{undrawn.length} clip{undrawn.length === 1 ? '' : 's'} named for facings this view does not draw
				({undrawn.map((c) => `${c.action} ${c.facing}: ${c.clip}`).join(', ')}): kept, and never
				played.
				<button
					class="btn"
					type="button"
					disabled={readOnly}
					onclick={() => {
						let n = 0;
						run((d) => void (n = sheets.dropUndrawnAnimCells(d, id)));
						dropped = `${n} removed.`;
					}}>Remove {undrawn.length === 1 ? 'it' : 'them'}</button
				>
			</p>
		{/if}
		{#if dropped}<p class="note">{dropped}</p>{/if}
	</SectionCard>
</div>
