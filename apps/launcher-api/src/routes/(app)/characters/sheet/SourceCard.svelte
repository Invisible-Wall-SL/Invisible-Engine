<script lang="ts">
	/**
	 * The sheet's ANIMATION SOURCE (`docs/design/character-pipeline.md` §12.4). One kind so far,
	 * frame clips: a prefix, and a second art set per status (`variants`). The body switches on
	 * `source.kind`, so another kind of source is another branch here.
	 */
	import { resolve } from '$app/paths';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import { STATUS_SUGGESTIONS } from '$lib/characters/characterSheetActions';
	import { SHEET_CARD_TITLES, sheetCardId } from '$lib/characters/characterSheetPage';
	import type { CharacterSheet, GameConfigIssue } from 'game-config';
	import IssueList from './IssueList.svelte';
	import { settle, type SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		sheet: CharacterSheet | undefined;
		issues: GameConfigIssue[];
		/** The tool's own warnings of this card (`sheetWarnings`). */
		warnings: string[];
		/** The query of Flipbook's Characters mode on this character, or `undefined` when it lists
		 *  none. */
		flipbookQuery: string | undefined;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, sheet, issues, warnings, flipbookQuery, readOnly, edit }: Props = $props();

	const source = $derived(sheet?.source);
	/** The kind the body shows: the stored one, else frame clips, the one kind this tool makes. */
	const kind = $derived(source?.kind ?? 'clips');
	const variants = $derived(sheets.variantsOf(sheet));
	let refused = $state('');
	let newStatus = $state('');
	let newPrefix = $state('');
	const run = (change: Parameters<SheetEdit>[0]): boolean => {
		refused = edit(change) ?? '';
		return !refused;
	};
</script>

<div id={sheetCardId('source')} data-sheet-card="source">
	<SectionCard scope="characters" id={sheetCardId('source')} title={SHEET_CARD_TITLES.source}>
		{#snippet info()}
			<p>
				What draws the character. Frame clips: every clip is found by its name,
				<code>prefix_action_facing</code>, among the project's Flipbook clips. Its clips are made in
				Invisible Flipbook, not here.
			</p>
		{/snippet}
		{#snippet actions()}
			{#if flipbookQuery}
				<a class="maker" data-flipbook-link href={resolve(`/flipbook?${flipbookQuery}`)}
					>Flipbook ↗</a
				>
			{/if}
			{#if source}
				<IconButton
					icon="trash"
					label="Take the source away, with its variants"
					danger
					disabled={readOnly}
					onclick={() => run((d) => sheets.clearSource(d, id))}
				/>
			{/if}
		{/snippet}
		{#if kind === 'clips'}
			<div class="fields">
				<label
					>Clip prefix
					<input
						data-source-prefix
						value={source?.prefix ?? ''}
						placeholder="bear"
						spellcheck="false"
						disabled={readOnly}
						onchange={(e) => {
							const value = e.currentTarget.value;
							run((d) => sheets.setSourcePrefix(d, id, value));
							settle(e.currentTarget, refused ? source?.prefix : value.trim());
						}}
					/>
				</label>
			</div>
			{#if source}
				<h3>
					Variants
					<InfoTip>
						A second set of art, drawn first while a status holds (Salmons' golden salmon while it
						is <code>marked</code>): its clips are named with its own prefix, and a clip it lacks
						falls back to the base one.
					</InfoTip>
				</h3>
				<table class="rows" data-variants>
					<thead><tr><th>While</th><th>Prefix</th><th></th></tr></thead>
					<tbody>
						{#each variants as [status, prefix] (status)}
							<tr data-variant={status}>
								<td>
									<input
										value={status}
										list="sheet-statuses"
										spellcheck="false"
										disabled={readOnly}
										onchange={(e) => {
											const next = e.currentTarget.value;
											if (!run((d) => sheets.renameVariant(d, id, status, next)))
												settle(e.currentTarget, status);
										}}
									/>
								</td>
								<td>
									<input
										value={prefix}
										spellcheck="false"
										disabled={readOnly}
										onchange={(e) => {
											const next = e.currentTarget.value;
											if (!run((d) => sheets.setVariantPrefix(d, id, status, next)))
												settle(e.currentTarget, prefix);
										}}
									/>
								</td>
								<td>
									<IconButton
										icon="trash"
										label={`Remove the variant "${status}"`}
										danger
										disabled={readOnly}
										onclick={() => run((d) => sheets.removeVariant(d, id, status))}
									/>
								</td>
							</tr>
						{/each}
						<tr>
							<td>
								<input
									bind:value={newStatus}
									list="sheet-statuses"
									placeholder="marked"
									spellcheck="false"
									disabled={readOnly}
								/>
							</td>
							<td>
								<input
									bind:value={newPrefix}
									placeholder="golden"
									spellcheck="false"
									disabled={readOnly}
								/>
							</td>
							<td>
								<button
									class="btn"
									type="button"
									disabled={readOnly || !newStatus.trim() || !newPrefix.trim()}
									onclick={() => {
										if (run((d) => sheets.addVariant(d, id, newStatus, newPrefix))) {
											newStatus = '';
											newPrefix = '';
										}
									}}>Add variant</button
								>
							</td>
						</tr>
					</tbody>
				</table>
				<datalist id="sheet-statuses">
					{#each STATUS_SUGGESTIONS as status (status)}<option value={status}></option>{/each}
				</datalist>
			{/if}
		{:else}
			<p class="note" data-source-kind={kind}>
				This sheet's source is <code>{kind}</code>, which this tool does not edit yet. It is kept as
				stored.
			</p>
		{/if}
		{#if refused}<p class="err">{refused}</p>{/if}
		<IssueList {issues} {warnings} />
	</SectionCard>
</div>
