<script lang="ts">
	/**
	 * The sheet's ANIMATION SOURCE (`docs/design/character-pipeline.md` §12.4): the choice of what
	 * draws the character (frame clips, a rig, still images) and the body of the kind chosen. A
	 * kind that names something (a prefix, a rig) is written when that is given; still images are
	 * written when their tile is pressed. A change of kind that would lose what the old source
	 * names asks first, with what (`characterSheetSources.ts` `sourceChangeLoss`); the cells are
	 * kept, and the ones the new source does not draw are listed with one button to remove them.
	 * Every edit is one of `$lib/characters/characterSheetEdit` or `characterSheetSources`.
	 */
	import { resolve } from '$app/paths';
	import { askConfirm } from '$lib/dialogs.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import { STATUS_SUGGESTIONS } from '$lib/characters/characterSheetActions';
	import { SHEET_CARD_TITLES, sheetCardId } from '$lib/characters/characterSheetPage';
	import { setSourceKind, sourceChangeLoss } from '$lib/characters/characterSheetSources';
	import {
		CELL_KIND_LABELS,
		SOURCE_KIND_WORDS,
		type SourceKind,
	} from '$lib/characters/sheetCore';
	import type { CharacterSheet, GameConfigIssue } from 'game-config';
	import type { RigRead } from '../rigRead.svelte';
	import type { WholeRead } from '../wholeRead.svelte';
	import IssueList from './IssueList.svelte';
	import SourceChoice from './SourceChoice.svelte';
	import SourceRig from './SourceRig.svelte';
	import SourceStills from './SourceStills.svelte';
	import { settle, type SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		projectKey: string;
		sheet: CharacterSheet | undefined;
		issues: GameConfigIssue[];
		/** The tool's own warnings of this card (`sheetWarnings`). */
		warnings: string[];
		/** The query of Flipbook's Characters mode on this character, or `undefined` when it lists
		 *  none. */
		flipbookQuery: string | undefined;
		/** The project's rigs and sheets, and what the page has read of the rigs. */
		read: WholeRead;
		rigs: RigRead;
		/** The kind a start tile of the Character sheet card asked for: shown as chosen until the
		 *  sheet stores one. */
		startKind?: SourceKind;
		/** Scroll to the Draw card. */
		onDraw: () => void;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let {
		id,
		projectKey,
		sheet,
		issues,
		warnings,
		flipbookQuery,
		read,
		rigs,
		startKind,
		onDraw,
		readOnly,
		edit,
	}: Props = $props();

	const source = $derived(sheet?.source);
	const clipSource = $derived(sheets.clipSourceOf(sheet));
	/** A kind picked on the tiles that is not stored yet: it needs a prefix or a rig first. */
	let pending = $state<SourceKind | undefined>(startKind);
	$effect(() => {
		if (startKind) pending = startKind;
	});
	const kind = $derived(pending ?? source?.kind);
	const variants = $derived(sheets.variantsOf(sheet));
	const unread = $derived(sheets.unreadCells(sheet));
	let refused = $state('');
	let note = $state('');
	let newStatus = $state('');
	let newPrefix = $state('');
	const run = (change: Parameters<SheetEdit>[0]): boolean => {
		refused = edit(change) ?? '';
		note = '';
		return !refused;
	};

	/** Make the source `kind`, naming what it needs; asks first when the old source loses
	 *  something. Answers whether it was made. */
	async function changeKind(
		next: SourceKind,
		named: { prefix?: string; rig?: string } = {},
	): Promise<boolean> {
		const loss = sourceChangeLoss(sheet, next).text;
		if (loss) {
			const ok = await askConfirm({
				title: `Change the source to ${SOURCE_KIND_WORDS[next]}?`,
				message: `The source loses ${loss}: ${SOURCE_KIND_WORDS[next]} cannot keep them. Every cell of the actions is kept; the ones ${SOURCE_KIND_WORDS[next]} do not draw are listed here afterwards. Nothing is saved until you press Save.`,
				confirmLabel: 'Change the source',
				danger: true,
			});
			if (!ok) return false;
		}
		let lost = '';
		const ok = run((d) => {
			const out = setSourceKind(d, id, next, { ...named, confirmLoss: !!loss });
			lost = out.lost;
			return out.refused;
		});
		if (ok) {
			pending = undefined;
			note = lost ? `The source lost ${lost}.` : '';
		}
		return ok;
	}
	function choose(next: SourceKind): void {
		refused = '';
		if (next === source?.kind) pending = undefined;
		else if (next === 'stills') void changeKind('stills');
		else pending = next;
	}
	async function clear(): Promise<void> {
		const loss = sourceChangeLoss(sheet, undefined).text;
		if (loss) {
			const ok = await askConfirm({
				title: 'Take the source away?',
				message: `It loses ${loss}. The character is drawn by its component's own animation again. Every cell of the actions is kept. Nothing is saved until you press Save.`,
				confirmLabel: 'Take it away',
				danger: true,
			});
			if (!ok) return;
		}
		if (run((d) => sheets.clearSource(d, id))) pending = undefined;
	}
</script>

<div id={sheetCardId('source')} data-sheet-card="source">
	<SectionCard scope="characters" id={sheetCardId('source')} title={SHEET_CARD_TITLES.source}>
		{#snippet info()}
			<p>
				What draws the character: frame clips made in Invisible Flipbook, a rig made in Invisible
				Rigger, or single images of a project sheet. With none chosen it is drawn by its component's
				own animation. The art itself is made in those tools, not here.
			</p>
		{/snippet}
		{#snippet actions()}
			{#if flipbookQuery && source?.kind === 'clips'}
				<a class="maker" data-flipbook-link href={resolve(`/flipbook?${flipbookQuery}`)}
					>Flipbook ↗</a
				>
			{/if}
			{#if source}
				<IconButton
					icon="trash"
					label="Take the source away, with what it names"
					danger
					disabled={readOnly}
					onclick={() => void clear()}
				/>
			{/if}
		{/snippet}
		<SourceChoice value={kind} stored={source?.kind} disabled={readOnly} onChoose={choose} />
		{#if !kind}
			<p class="status" data-source-none>
				None chosen: the character is drawn by its component's own animation.
			</p>
		{:else if pending && pending !== source?.kind}
			<p class="note" data-source-pending={pending}>
				{pending === 'clips' ? 'Type the clips’ prefix' : 'Pick the rig'} to make the source {SOURCE_KIND_WORDS[
					pending
				]}{source ? `; until then it stays ${SOURCE_KIND_WORDS[source.kind]}` : ''}.
			</p>
		{/if}

		{#if kind === 'clips'}
			<div class="fields body">
				<label
					>Clip prefix
					<input
						data-source-prefix
						value={clipSource?.prefix ?? ''}
						placeholder="e.g. bear"
						spellcheck="false"
						disabled={readOnly}
						onchange={async (e) => {
							const el = e.currentTarget;
							const value = el.value;
							const was = clipSource?.prefix;
							const ok = clipSource
								? run((d) => sheets.setSourcePrefix(d, id, value))
								: await changeKind('clips', { prefix: value });
							settle(el, ok ? value.trim() : was);
						}}
					/>
				</label>
			</div>
			{#if clipSource}
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
										aria-label={`Status of the variant "${status}"`}
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
										aria-label={`Prefix of the variant "${status}"`}
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
									data-new-variant-status
									aria-label="Status of a new variant"
									list="sheet-statuses"
									placeholder="marked"
									spellcheck="false"
									disabled={readOnly}
								/>
							</td>
							<td>
								<input
									bind:value={newPrefix}
									data-new-variant-prefix
									aria-label="Prefix of a new variant"
									placeholder="golden"
									spellcheck="false"
									disabled={readOnly}
								/>
							</td>
							<td>
								<button
									class="btn"
									type="button"
									data-add-variant
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
			{/if}
		{:else if kind === 'rig'}
			<SourceRig
				{id}
				{projectKey}
				{sheet}
				{read}
				{rigs}
				{readOnly}
				{edit}
				onFirstRig={(rig) => changeKind('rig', { rig })}
			/>
		{:else if kind === 'stills'}
			<SourceStills {id} {sheet} {read} {onDraw} {readOnly} {edit} />
		{/if}
		<datalist id="sheet-statuses">
			{#each STATUS_SUGGESTIONS as status (status)}<option value={status}></option>{/each}
		</datalist>

		{#if unread.length}
			<p class="note" data-unread>
				{unread.length} cell{unread.length === 1 ? '' : 's'} of the actions hold{unread.length === 1
					? 's'
					: ''} art that {source ? SOURCE_KIND_WORDS[source.kind] : 'this source'}
				{source?.kind === 'rig' ? 'does' : 'do'} not draw ({unread
					.map((c) => `${c.action} ${c.facing}: ${CELL_KIND_LABELS[c.kind].toLowerCase()} ${c.text}`)
					.join(', ')}): kept, and not read.
				<button
					class="btn"
					type="button"
					data-drop-unread
					disabled={readOnly}
					onclick={() => {
						let n = 0;
						if (run((d) => void (n = sheets.dropUnreadCells(d, id)))) note = `${n} removed.`;
					}}>Remove {unread.length === 1 ? 'it' : 'them'}</button
				>
			</p>
		{/if}
		{#if refused}<p class="err" data-source-refused>{refused}</p>{/if}
		{#if note}<p class="note" data-source-note>{note}</p>{/if}
		<IssueList {issues} {warnings} />
	</SectionCard>
</div>

<style>
	.body {
		margin-top: 12px;
	}
</style>
