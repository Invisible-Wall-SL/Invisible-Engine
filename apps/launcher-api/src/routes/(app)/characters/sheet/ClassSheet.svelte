<script lang="ts">
	/**
	 * An ONLINE CLASS WITH NO CHARACTER (Salmons' `salmon`): no `arcade.characters` entry is drawn
	 * as its body, so it has nowhere to keep a sheet. *Make this a sheet* writes the clip block it
	 * plays as the sheet of a new character of that look, and names it on the class.
	 */
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import * as edits from '$lib/characters/characterEdit';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import { castOf, classBlock } from '$lib/characters/characterSheetPage';
	import { afterReread } from '$lib/characters/singleFlight';
	import { characterDraw, characterPrefixes } from '$lib/flipbook/characterSet';
	import type { ProjectCharacter } from '$lib/flipbook/projectCharacters';
	import type { GameConfigDoc } from 'game-config';
	import type { WholeRead } from '../wholeRead.svelte';
	import type { SheetEdit } from './sheetEdit';

	interface Props {
		classId: string;
		config: GameConfigDoc;
		cast: ProjectCharacter[];
		read: WholeRead;
		readOnly: boolean;
		edit: SheetEdit;
		/** A character was made for the class: open it. */
		onMade: (characterId: string) => void;
	}
	let { classId, config, cast, read, readOnly, edit, onMade }: Props = $props();

	const cls = $derived(sheets.findClass(config, classId));
	const block = $derived(read.read ? classBlock(cast, classId) : undefined);
	let refused = $state('');
	let making = $state(false);

	/** The components are saved under another lease, so the block is read again before it is
	 *  copied: the sheet is made from what the class plays now, not when the page loaded. */
	async function make(): Promise<void> {
		if (making) return;
		making = true;
		try {
			const fresh = await afterReread(read, () =>
				classBlock(castOf(read.components, config), classId),
			);
			if (fresh.refused !== null) {
				refused = fresh.refused;
				return;
			}
			const look = fresh.value;
			if (!look) {
				refused = `"${classId}" plays no clip block any more: there is nothing to make a sheet from.`;
				return;
			}
			let made: string | undefined;
			refused =
				edit((d) => {
					const out = sheets.makeClassSheet(d, classId, look);
					made = out.characterId;
					return out.refused;
				}) ?? '';
			if (!refused && made) onMade(made);
		} finally {
			making = false;
		}
	}
	function addCharacter(): void {
		const body = cls?.body;
		if (!body) return;
		let made: string | undefined;
		refused = edit((d) => void (made = edits.addCharacter(d, body))) ?? '';
		if (made) onMade(made);
	}
</script>

<div data-class-sheet={classId}>
	<SectionCard scope="characters" id="sheet-class" title={`Online class ${classId}`}>
		{#snippet info()}
			<p>
				A class of the room that no character of the config is drawn as, so it has no character
				sheet and nowhere to keep one. Making it a sheet adds a character of its look to hold it.
			</p>
		{/snippet}
		{#if cls}
			<dl class="facts">
				<dt>Body</dt>
				<dd><code>{cls.body}</code></dd>
				<dt>Plays</dt>
				<dd data-class-plays>
					{#if !read.read}
						reading the project's clips…
					{:else if block}
						a clip block: <code>{characterPrefixes(block).join(', ')}</code>, drawn
						{characterDraw(block).width} px wide
					{:else}
						no clip block
					{/if}
				</dd>
			</dl>
			<div class="btns">
				<button
					class="btn"
					type="button"
					data-make-class-sheet
					disabled={readOnly || !block || making}
					onclick={() => void make()}>{making ? 'Reading…' : 'Make this a sheet'}</button
				>
				<InfoTip>
					Adds a character drawn as <code>{cls.body}</code>, writes the clip block this class plays
					as its sheet, row for row, and names it on the class. Nothing is saved until you press
					Save.
				</InfoTip>
				<button
					class="btn"
					type="button"
					data-add-class-character
					disabled={readOnly}
					onclick={addCharacter}>Add a character with no sheet</button
				>
			</div>
		{/if}
		{#if refused}<p class="err">{refused}</p>{/if}
	</SectionCard>
</div>
