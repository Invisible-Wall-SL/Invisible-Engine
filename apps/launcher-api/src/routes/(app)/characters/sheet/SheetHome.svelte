<script lang="ts">
	/**
	 * The CHARACTER SHEET card: whether the character has one, *Make this a sheet* and *Compare with
	 * the saved config* (`docs/design/character-pipeline.md` §9, Salmons steps 2 and 3). The one
	 * card a character with no sheet shows: nothing is written until a button here is pressed.
	 */
	import { askConfirm } from '$lib/dialogs.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import { classesNamingSheet } from '$lib/characters/characterEdit';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import {
		SHEET_CARD_TITLES,
		cellDifferenceText,
		compareClass,
		comparedClasses,
		drawingText,
		sheetCardId,
		sheetDifferenceText,
		sheetSourceFor,
	} from '$lib/characters/characterSheetPage';
	import type { ProjectCharacter } from '$lib/flipbook/projectCharacters';
	import type { GameConfigDoc } from 'game-config';
	import type { WholeRead } from '../wholeRead.svelte';
	import type { SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		/** The config as the page holds it, and as it was loaded or last saved. */
		config: GameConfigDoc;
		stored: GameConfigDoc;
		/** The project's characters that play clips, for `config`. */
		cast: ProjectCharacter[];
		read: WholeRead;
		/** The person opened the empty cards to fill a sheet in by hand. */
		byHand: boolean;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, config, stored, cast, read, byHand = $bindable(), readOnly, edit }: Props = $props();

	const has = $derived(sheets.hasSheet(config, id));
	const naming = $derived(classesNamingSheet(config, id));
	const makeFrom = $derived(read.read ? sheetSourceFor(cast, config, id) : undefined);
	let refused = $state('');
	let made = $state('');
	let comparing = $state(false);
	const compared = $derived(
		comparing && read.read
			? comparedClasses(stored, config, id).map((classId) =>
					compareClass(stored, config, read.components, classId, read.clipIds),
				)
			: [],
	);

	function make(): void {
		const from = makeFrom;
		if (!from) return;
		refused =
			edit((d) =>
				from.classId
					? sheets.makeClassSheet(d, from.classId, from.look).refused
					: sheets.makeCharacterSheet(d, id, from.look),
			) ?? '';
		made = refused
			? ''
			: from.classId
				? `Made from the clip block the class "${from.classId}" plays, and "${from.classId}" now names this sheet. Nothing is saved until you press Save.`
				: "Made from its component's clip block. No online class is drawn as it yet. Nothing is saved until you press Save.";
	}
	async function removeSheet(): Promise<void> {
		const ok = await askConfirm({
			title: `Remove the sheet of "${id}"?`,
			message: `Its view, animation source, draw box and actions go.${
				naming.length
					? ` ${naming.map((c) => `"${c}"`).join(', ')} still ${naming.length === 1 ? 'names' : 'name'} it, and ${naming.length === 1 ? 'is' : 'are'} drawn as before the sheet until it has one again.`
					: ''
			} Nothing is saved until you press Save.`,
			confirmLabel: 'Remove',
			danger: true,
		});
		if (!ok) return;
		refused = edit((d) => sheets.clearSheet(d, id)) ?? '';
		made = '';
		byHand = false;
	}
</script>

<div id={sheetCardId('sheet')} data-sheet-card="sheet">
	<SectionCard scope="characters" id={sheetCardId('sheet')} title={SHEET_CARD_TITLES.sheet}>
		{#snippet info()}
			<p>
				A character sheet says, as data, how the character is seen (its view), what draws it (its
				clips' prefix), how big, and what it can be seen doing (its actions). An online class that
				names the sheet is drawn from it; a character with none is drawn as before.
			</p>
		{/snippet}
		{#snippet actions()}
			{#if has}
				<IconButton
					icon="trash"
					label="Remove the sheet (view, source, draw box and actions)"
					danger
					disabled={readOnly}
					onclick={() => void removeSheet()}
				/>
			{/if}
		{/snippet}
		{#if has}
			<p class="status" data-sheet-state="sheet">
				{#if naming.length}
					Played by {naming.map((c) => `"${c}"`).join(', ')}.
				{:else}
					No online class names it yet, so the game draws nothing from it.
				{/if}
			</p>
		{:else}
			<p class="status" data-sheet-state="none">No sheet: it is drawn as it was before sheets.</p>
			<div class="btns">
				<button
					class="btn"
					type="button"
					data-make-sheet
					disabled={readOnly || !makeFrom}
					onclick={make}>Make this a sheet</button
				>
				<InfoTip>
					Writes the clip block this character plays today (its component's, or Salmons' own) as a
					sheet, row for row, with nothing retyped, and names it on its online class. Compare then
					lists what would draw differently: nothing, until you change it.
					{#if read.read && !makeFrom}
						Not offered here: no online class drawn as this character plays a clip block.
					{/if}
				</InfoTip>
				{#if !byHand}
					<button
						class="btn"
						type="button"
						data-start-sheet
						disabled={readOnly}
						onclick={() => (byHand = true)}>Start an empty sheet</button
					>
					<InfoTip>
						Shows the sheet's empty cards. Nothing is written until you set something on one.
					</InfoTip>
				{/if}
			</div>
		{/if}
		{#if refused}<p class="err" data-sheet-refused>{refused}</p>{/if}
		{#if made}<p class="note" data-sheet-made>{made}</p>{/if}

		{#if has || comparing}
			<div class="btns">
				<button
					class="btn"
					type="button"
					data-compare
					aria-expanded={comparing}
					disabled={!read.read}
					onclick={() => (comparing = !comparing)}
					>{comparing ? 'Hide the comparison' : 'Compare with the saved config'}</button
				>
				<InfoTip>
					Lists every action and facing whose clip or mirror would change, and what else the sheet
					says differently, between the saved config (what this page loaded or last saved) and what
					is on the page now. The saved config is not the published game: a game you published
					before your last save may still differ from it.
				</InfoTip>
			</div>
		{/if}
		{#if comparing}
			<div data-compare-result>
				{#each compared as c (c.classId)}
					<div class="compare" data-compare-class={c.classId} data-compare-safe={c.safe}>
						<p>
							<code>{c.classId}</code>: saved, {drawingText(c.before)}; now, {drawingText(c.after)}.
						</p>
						{#if c.safe}
							<p class="ok">
								No difference: with the project's clips, every action in every facing draws the same
								clip, mirrored the same way, and the sheet says nothing else differently. The move
								is safe.
							</p>
						{:else}
							{#if c.cells.length}
								<p class="dim">
									{c.cells.length} drawn difference{c.cells.length === 1 ? '' : 's'}:
								</p>
								<ul data-compare-cells>
									{#each c.cells as d, i (i)}<li>{cellDifferenceText(d)}</li>{/each}
								</ul>
							{/if}
							{#if c.sheets.length}
								<p class="dim">
									{c.sheets.length} difference{c.sheets.length === 1 ? '' : 's'} in what the sheet says:
								</p>
								<ul data-compare-sheets>
									{#each c.sheets as d, i (i)}<li>{sheetDifferenceText(d)}</li>{/each}
								</ul>
							{/if}
						{/if}
					</div>
				{:else}
					<p class="note" data-compare-none>
						No online class is drawn as this character, so the game draws nothing from its sheet:
						there is nothing to compare.
					</p>
				{/each}
			</div>
		{/if}
	</SectionCard>
</div>

<style>
	.compare {
		margin-top: 10px;
		padding: 8px 10px;
		border: 1px solid #23232c;
		border-radius: 8px;
		background: #111117;
		font-size: 12px;
	}
	.compare p {
		margin: 0 0 6px;
	}
	.compare ul {
		margin: 0 0 6px;
		padding-left: 18px;
		max-height: 240px;
		overflow: auto;
		color: #d3b483;
	}
	.ok {
		color: #86efac;
	}
	.dim {
		color: #8b8b98;
	}
</style>
