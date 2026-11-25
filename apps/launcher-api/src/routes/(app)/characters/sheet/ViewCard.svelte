<script lang="ts">
	/**
	 * The sheet's VIEW (`docs/design/character-pipeline.md` §12.3, §13): how the character is seen,
	 * in how many facings, whether the west ones are mirrored and whether it turns smoothly between
	 * them, with the character turning as the game draws it (`SheetTurnPreview`). Every edit is one
	 * of `$lib/characters/characterSheetEdit`.
	 */
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import { SHEET_CARD_TITLES, sheetCardId } from '$lib/characters/characterSheetPage';
	import { CELL_KIND_LABELS } from '$lib/characters/sheetCore';
	import SheetTurnPreview from '$lib/characters/SheetTurnPreview.svelte';
	import type { FlipbookClip } from 'engine-flipbook';
	import {
		CHARACTER_TURN_BLEND,
		CHARACTER_TURN_BLEND_MAX,
		CHARACTER_TURN_SPEED,
		CHARACTER_TURN_SPEED_MAX,
		type CharacterSheet,
		type GameConfigIssue,
	} from 'game-config';
	import type { RigRead } from '../rigRead.svelte';
	import IssueList from './IssueList.svelte';
	import { settle, type SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		sheet: CharacterSheet | undefined;
		/** The validator's issues of this card, the screen's warnings among them. */
		issues: GameConfigIssue[];
		/** Every clip id of the project, the ones read in full by id, and what the page has read of
		 *  the rigs: what the turn preview draws from. */
		clipIds: readonly string[];
		clips: Record<string, FlipbookClip>;
		rigs: RigRead;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, sheet, issues, clipIds, clips, rigs, readOnly, edit }: Props = $props();

	const view = $derived(sheet?.view);
	const turn = $derived(view && 'turn' in view ? view.turn : undefined);
	const turnNote = $derived(sheets.turnNote(view));
	const leanMax = $derived(sheets.turnLeanMax(view));
	const leanDefault = $derived(sheets.turnLeanDefault(view));
	const leans = $derived(sheets.turnLeans(view));
	const drawing = $derived(sheets.viewDrawing(view));
	const undrawn = $derived(sheets.undrawnAnimCells(sheet));
	const undrawnClips = $derived(undrawn.filter((c) => c.kind === 'clip').length);
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
			{#if !turnNote}
				<label class="check">
					<input
						type="checkbox"
						data-view-turn
						checked={!!turn}
						disabled={readOnly}
						onchange={(e) => {
							const on = e.currentTarget.checked;
							run((d) => sheets.setViewTurn(d, id, on));
						}}
					/>
					Smooth turn
					<InfoTip>
						On: the character turns through the facings in between, and each picture tilts towards
						where the character is heading, most at the halfway point to the next facing, where the
						next picture takes over in one frame, tilted back. Off: the picture changes at once when
						the facing does.
					</InfoTip>
				</label>
				{#if turn}
					<label
						>Blend (ms)
						<span class="inline">
							<input
								type="number"
								min="0"
								max={CHARACTER_TURN_BLEND_MAX}
								step="10"
								data-view-turn-blend
								value={turn.blend ?? ''}
								placeholder={String(CHARACTER_TURN_BLEND)}
								disabled={readOnly}
								onchange={(e) => {
									const el = e.currentTarget;
									const value = el.value;
									run((d) => sheets.setViewTurnBlend(d, id, value));
									settle(el, turn?.blend);
								}}
							/>
							<InfoTip>
								A cross-fade of the picture left and the one taken when the facing drawn changes, 0
								to {CHARACTER_TURN_BLEND_MAX}. Empty is {CHARACTER_TURN_BLEND}: the picture changes
								in one frame, the walk carried on where it was.
							</InfoTip>
						</span>
					</label>
					<label
						>Turn speed (°/s)
						<span class="inline">
							<input
								type="number"
								min="0"
								max={CHARACTER_TURN_SPEED_MAX}
								step="10"
								data-view-turn-speed
								value={turn.speed ?? ''}
								placeholder={String(CHARACTER_TURN_SPEED)}
								disabled={readOnly}
								onchange={(e) => {
									const el = e.currentTarget;
									const value = el.value;
									run((d) => sheets.setViewTurnSpeed(d, id, value));
									settle(el, turn?.speed);
								}}
							/>
							<InfoTip>
								How fast the drawn heading follows where the character moves, 0 to
								{CHARACTER_TURN_SPEED_MAX}. Empty is {CHARACTER_TURN_SPEED}; 0 turns at once. Try it
								in the Turn preview below.
							</InfoTip>
						</span>
					</label>
					<label
						>Most lean (°)
						<span class="inline">
							<input
								type="number"
								min="0"
								max={leanMax}
								step="0.5"
								data-view-turn-lean
								value={turn.lean ?? ''}
								placeholder={String(leanDefault)}
								disabled={readOnly}
								onchange={(e) => {
									const el = e.currentTarget;
									const value = el.value;
									run((d) => sheets.setViewTurnLean(d, id, value));
									settle(el, turn?.lean);
								}}
							/>
							<InfoTip>
								The tilt on the screen at the halfway point between two facings, 0 to {leanMax}; it
								grows evenly from none at the facing's middle.
								{#if view?.kind === 'isometric'}
									Empty is {leanDefault}, the tilt picked for an upright character; 0 keeps every
									picture upright.
								{:else}
									Empty is {leanDefault} (half the angle between two facings), where the turn has no jump;
									0 keeps every picture upright.
								{/if}
							</InfoTip>
						</span>
					</label>
					<label
						>Lean pivot
						<span class="inline">
							<select
								data-view-turn-pivot
								value={turn.pivot ?? 'middle'}
								disabled={readOnly || !leans}
								onchange={(e) => {
									const pivot = e.currentTarget.value;
									run((d) => sheets.setViewTurnPivot(d, id, pivot));
								}}
							>
								{#each sheets.TURN_PIVOT_OPTIONS as option (option.value)}
									<option value={option.value}>{option.label}</option>
								{/each}
							</select>
							<InfoTip>
								What a lean turns the picture about: its middle, or its feet (the character's
								place). It matters only while Most lean is above 0.
							</InfoTip>
						</span>
					</label>
				{/if}
			{/if}
		</div>
		{#if turnNote}<p class="status" data-view-turn-note>{turnNote}</p>{/if}
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
		{#if sheet && !turnNote}
			<SheetTurnPreview {sheet} {clipIds} {clips} rigs={rigs.facts} load={rigs.load} />
		{/if}
		{#if undrawn.length}
			<p class="note" data-undrawn>
				{undrawn.length} cell{undrawn.length === 1 ? '' : 's'} named for facings this view does not draw
				({undrawn
					.map(
						(c) =>
							`${c.action} ${c.facing}: ${c.kind === 'clip' ? '' : `${CELL_KIND_LABELS[c.kind].toLowerCase()} `}${c.text}`,
					)
					.join(', ')}): kept, and never played.
				{#if undrawnClips}
					<button
						class="btn"
						type="button"
						data-drop-undrawn
						disabled={readOnly}
						onclick={() => {
							let n = 0;
							run((d) => void (n = sheets.dropUndrawnAnimCells(d, id)));
							dropped = `${n} removed.`;
						}}
						>Remove {undrawnClips === undrawn.length
							? undrawnClips === 1
								? 'it'
								: 'them'
							: `the ${undrawnClips} clip${undrawnClips === 1 ? '' : 's'}`}</button
					>
				{/if}
			</p>
		{/if}
		{#if dropped}<p class="note">{dropped}</p>{/if}
	</SectionCard>
</div>
