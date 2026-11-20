<script lang="ts">
	/**
	 * The body of a STILL IMAGES source (`docs/design/character-pipeline.md` §12.4): nothing is
	 * found by name, so every action and facing names its image on the Actions card. Two ways to
	 * fill many at once start here: a whole sheet of images named `<character>_<action>_<facing>`
	 * (`characterSheetFill.ts` `startStillsCharacter`: the actions, the view and the width with
	 * them), and one image for every action (`useOneStill`). What the sheet still needs to be
	 * drawn is listed (`stillMissing`). The images are made in Atlas Maker or Sheet Maker.
	 */
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import {
		fillSourceOf,
		oneStillText,
		sheetReadFailed,
		startStillsCharacter,
		startStillsText,
		stillMissing,
		useOneStill,
		type FillSource,
	} from '$lib/characters/characterSheetFill';
	import { stillOfPick } from '$lib/characters/characterSheetPage';
	import type { CharacterSheet } from 'game-config';
	import RegionPicker from '../../editor/RegionPicker.svelte';
	import type { WholeRead } from '../wholeRead.svelte';
	import type { SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		sheet: CharacterSheet | undefined;
		read: WholeRead;
		onDraw: () => void;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, sheet, read, onDraw, readOnly, edit }: Props = $props();

	const missing = $derived(stillMissing(sheet));
	let refused = $state('');
	let note = $state('');
	let busy = $state(false);
	/** The sheet picked for *Images from a sheet*, and the characters its frames name when they
	 *  name several. */
	let fromKey = $state('');
	let from = $state.raw<FillSource | undefined>(undefined);
	let prefixes = $state.raw<string[]>([]);

	function start(prefix?: string): void {
		if (!from) return;
		const source = from;
		let out: ReturnType<typeof startStillsCharacter> | undefined;
		refused = edit((d) => (out = startStillsCharacter(d, id, source, { prefix })).refused) ?? '';
		prefixes = out?.plan.ambiguous ? out.plan.prefixes : [];
		note = out && !refused ? startStillsText(out) : '';
		if (!refused) {
			fromKey = '';
			from = undefined;
		}
	}
	async function pickSheet(key: string): Promise<void> {
		fromKey = key;
		from = undefined;
		prefixes = [];
		refused = '';
		note = '';
		if (!key) return;
		busy = true;
		try {
			from = fillSourceOf(await read.regionsOf(key));
		} catch (e) {
			fromKey = '';
			refused = sheetReadFailed(e);
			return;
		} finally {
			busy = false;
		}
		if (fromKey === key) start();
	}
	async function oneImage(pick: string): Promise<void> {
		const still = stillOfPick(pick);
		if (!still) return;
		busy = true;
		try {
			const width = fillSourceOf(await read.regionsOf(still.assetKey)).sizes?.[still.region]?.w;
			let out: ReturnType<typeof useOneStill> | undefined;
			refused = edit((d) => (out = useOneStill(d, id, still, { width })).refused) ?? '';
			note = out && !refused ? oneStillText(out) : '';
		} catch (e) {
			refused = sheetReadFailed(e);
			note = '';
		} finally {
			busy = false;
		}
	}
</script>

<div class="stills" data-source-stills>
	<div class="fields">
		<label>
			<span class="inline">
				Images from a sheet
				<InfoTip>
					Pick a sheet whose images are named <code>character_action_facing</code>
					(<code>bear_idle_ne</code>): each goes to its cell, the actions they name are added, and a
					sheet with no view or width yet is given the smallest view that has every facing named and
					the widest image's width. Nothing a cell already holds is replaced.
				</InfoTip>
			</span>
			<select
				data-stills-sheet
				aria-label="The sheet whose images become this character"
				value={fromKey}
				disabled={readOnly || busy || !read.read}
				onchange={(e) => void pickSheet(e.currentTarget.value)}
			>
				<option value="">Pick a sheet…</option>
				{#each read.sheets as s (s.key)}<option value={s.key}>{s.name}</option>{/each}
			</select>
		</label>
		<div class="one">
			<span class="inline">
				One image for everything
				<InfoTip>
					Pick one image: the action the character stands still in draws it, in every facing, and
					every other action falls back to it until it has art of its own.
				</InfoTip>
			</span>
			{#if readOnly || busy}
				<button class="btn" type="button" disabled>Pick the image…</button>
			{:else}
				<div data-one-still>
					<RegionPicker
						sheets={read.sheets}
						value=""
						scoped
						placeholder="Pick the image…"
						onSelect={(pick) => void oneImage(pick)}
					/>
				</div>
			{/if}
		</div>
	</div>
	{#if read.sheetsError}<p class="err" data-sheets-error>{read.sheetsError}</p>{/if}
	{#if prefixes.length}
		<p class="note" data-stills-ambiguous>
			{refused}
			{#each prefixes as prefix (prefix)}
				<button
					class="btn"
					type="button"
					data-stills-prefix={prefix}
					disabled={readOnly}
					onclick={() => start(prefix)}>{prefix || 'no prefix'}</button
				>
			{/each}
		</p>
	{:else if refused}
		<p class="err" data-stills-refused>{refused}</p>
	{/if}
	{#if note}<p class="note" data-stills-note>{note}</p>{/if}
	{#if missing.length && !note}
		<ul class="missing" data-still-missing>
			{#each missing as line (line)}<li>{line}</li>{/each}
		</ul>
	{/if}
	{#if missing.length}
		<div class="btns">
			<button class="btn" type="button" data-go-draw onclick={onDraw}>Draw box and points ↓</button>
		</div>
	{/if}
</div>

<style>
	.stills {
		margin-top: 12px;
	}
	.one {
		display: flex;
		flex-direction: column;
		gap: 4px;
		font-size: 12px;
		color: #b9b9c4;
		min-width: 0;
	}
	.missing {
		margin: 10px 0 0;
		padding-left: 18px;
		font-size: 12px;
		line-height: 1.6;
		color: #d3b483;
	}
</style>
