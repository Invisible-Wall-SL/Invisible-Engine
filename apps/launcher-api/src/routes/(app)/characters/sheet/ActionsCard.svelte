<script lang="ts">
	/**
	 * The sheet's ACTIONS (`docs/design/character-pipeline.md` §12.5, §12.6): the rows, what starts
	 * each and how it plays, and under them the clips grid (actions down, facings across) and the
	 * Directions preview. Both are Flipbook's own components, fed the LIVE sheet: they resolve
	 * every cell through the resolver the game calls, and this card resolves none. A
	 * cell's value is edited in `CellEditor`.
	 */
	import CanvasModeBar from '$lib/CanvasModeBar.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import * as act from '$lib/characters/characterSheetActions';
	import {
		SHEET_CARD_TITLES,
		cellValueOf,
		setCellValue,
		sheetCardId,
	} from '$lib/characters/characterSheetPage';
	import {
		cellKey,
		characterGrid,
		characterProblems,
		characterVariants,
		gridCounts,
		type GridCell,
	} from '$lib/flipbook/characterSet';
	import CharacterClipsGrid from '$lib/flipbook/CharacterClipsGrid.svelte';
	import CharacterDirections from '$lib/flipbook/CharacterDirections.svelte';
	import type { FlipbookClip } from 'engine-flipbook';
	import {
		characterActionPlay,
		characterActionPriority,
		type CharacterSheet,
		type CharacterTrigger,
		type GameConfigIssue,
	} from 'game-config';
	import CellEditor from './CellEditor.svelte';
	import IssueList from './IssueList.svelte';
	import { settle, type SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		sheet: CharacterSheet | undefined;
		issues: GameConfigIssue[];
		warnings: string[];
		/** Every clip id of the project, and the ones read in full, by id. */
		clipIds: readonly string[];
		clips: Record<string, FlipbookClip>;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, sheet, issues, warnings, clipIds, clips, readOnly, edit }: Props = $props();

	const rows = $derived(act.actionsOf(sheet));
	const variants = $derived(sheet ? characterVariants(sheet) : []);
	let variant = $state<string | false>(false);
	const shown = $derived(variants.some((v) => v.status === variant) ? variant : false);
	const grid = $derived(sheet ? characterGrid(sheet, clipIds, shown) : undefined);
	const counts = $derived(grid ? gridCounts(grid) : undefined);

	let refused = $state('');
	let note = $state('');
	let newAction = $state('');
	let selected = $state('');
	let picked = $state('');
	const selectedCell = $derived(
		grid?.rows.flatMap((row) => row.cells).find((cell) => cellKey(cell) === selected),
	);

	const run = (change: Parameters<SheetEdit>[0]): boolean => {
		refused = edit(change) ?? '';
		note = '';
		return !refused;
	};
	const several = (ids: readonly string[]): string => ids.map((x) => `"${x}"`).join(', ');

	function add(): void {
		let made: string | undefined;
		const ok = run((d) => {
			const out = act.addAction(d, id, newAction.trim() || undefined);
			made = out.id;
			return out.refused;
		});
		if (ok && made) {
			newAction = '';
			picked = made;
		}
	}
	function rename(actionId: string, el: HTMLInputElement): void {
		const next = el.value;
		let out: ReturnType<typeof act.renameAction> | undefined;
		const ok = run((d) => {
			out = act.renameAction(d, id, actionId, next, clipIds);
			return out.refused;
		});
		if (!ok || !out) {
			settle(el, actionId);
			return;
		}
		settle(el, next.trim());
		selected = '';
		note = [
			out.fallbacks.length ? `Stands in for ${several(out.fallbacks)} under its new name.` : '',
			out.lostClips.length
				? `These clips no longer match (they are named for "${actionId}"): ${out.lostClips.join(', ')}.`
				: '',
			out.lostClips.length || out.foundClips.length
				? `${out.foundClips.length} clip${out.foundClips.length === 1 ? '' : 's'} match the new name.`
				: '',
		]
			.filter(Boolean)
			.join(' ');
	}
	function remove(actionId: string): void {
		let cleared: string[] = [];
		const ok = run((d) => {
			const out = act.removeAction(d, id, actionId);
			cleared = out.clearedFallbacks;
			return out.refused;
		});
		if (!ok) return;
		selected = '';
		note = cleared.length
			? `"${actionId}" stood in for ${several(cleared)}: ${cleared.length === 1 ? 'it has' : 'they have'} no fallback now.`
			: '';
	}
	function setTrigger(actionId: string, index: number, trigger: CharacterTrigger): void {
		run((d) => act.setTrigger(d, id, actionId, index, trigger));
	}
	function onCell(cell: GridCell): void {
		selected = cellKey(cell);
		picked = cell.state;
	}
</script>

<div id={sheetCardId('actions')} data-sheet-card="actions">
	<SectionCard scope="characters" id={sheetCardId('actions')} title={SHEET_CARD_TITLES.actions}>
		{#snippet info()}
			<p>
				What the character can be seen doing. An action's id is the middle of its clips' names (<code
					>prefix_action_facing</code
				>). It starts on any of its triggers; with none it only stands in for another action. Of the
				loops whose trigger holds, the highest priority plays, and of two as high the first in the
				list.
			</p>
			<p>
				The grid is the game's own answer per action and facing: ✓ its own clip · ⇋ its twin,
				mirrored · ≈ another clip stands in · — nothing plays. Press a cell to name its clip.
			</p>
		{/snippet}
		{#snippet actions()}
			{#if variants.length}
				<CanvasModeBar
					inline
					options={[
						{ value: '', label: 'base', title: 'A player no status holds for' },
						...variants.map((v) => ({
							value: v.status,
							label: v.prefix,
							title: `A player who is ${v.status}: its own clips first, else the base ones`,
						})),
					]}
					value={shown || ''}
					onChange={(v) => (variant = v || false)}
					ariaLabel="Whose clips"
				/>
			{/if}
		{/snippet}
		<div class="scroll">
			<table class="rows actions-table" data-actions>
				{#if rows.length}
					<thead>
						<tr>
							<th></th>
							<th>Id</th>
							<th>Name</th>
							<th>Starts on</th>
							<th>Plays</th>
							<th>
								Priority
								<InfoTip>
									Empty: the highest of its triggers' (3 an ability or an event, 2 a status, 1
									movement).
								</InfoTip>
							</th>
							<th>
								Cut by
								<InfoTip
									>What may cut it short while it plays once. A loop never cuts a once.</InfoTip
								>
							</th>
							<th>
								Again
								<InfoTip>What happens when it is started again while it plays.</InfoTip>
							</th>
							<th>
								Stands in
								<InfoTip>
									The action drawn in its place when it has no clip in any facing. A facing with no
									clip is first stood in for by its mirror twin, then the nearest facing.
								</InfoTip>
							</th>
							<th></th>
						</tr>
					</thead>
				{/if}
				<tbody>
					{#each rows as action, i (action.id)}
						{@const triggers = act.triggersOf(action)}
						<tr data-action={action.id} class:on={picked === action.id}>
							<td class="order">
								<button
									class="btn"
									type="button"
									title="Earlier: of two loops as high, the first plays"
									disabled={readOnly || i === 0}
									onclick={() => run((d) => act.moveAction(d, id, action.id, -1))}>↑</button
								>
								<button
									class="btn"
									type="button"
									title="Later"
									disabled={readOnly || i === rows.length - 1}
									onclick={() => run((d) => act.moveAction(d, id, action.id, 1))}>↓</button
								>
							</td>
							<td>
								<input
									class="id"
									data-action-id
									value={action.id}
									spellcheck="false"
									disabled={readOnly}
									onchange={(e) => rename(action.id, e.currentTarget)}
								/>
							</td>
							<td>
								<input
									value={action.name ?? ''}
									placeholder={action.id}
									disabled={readOnly}
									onchange={(e) => {
										const name = e.currentTarget.value;
										run((d) => act.setActionName(d, id, action.id, name));
									}}
								/>
							</td>
							<td class="triggers" data-triggers>
								{#each triggers as trigger, t (t)}
									{@const kind = act.triggerKindOf(trigger)}
									<span class="trigger" title={act.triggerText(trigger)}>
										{#if 'motion' in trigger}
											<select
												value={trigger.motion}
												disabled={readOnly}
												onchange={(e) =>
													setTrigger(action.id, t, {
														motion: e.currentTarget.value as typeof trigger.motion,
													})}
											>
												{#each act.MOTION_OPTIONS as o (o.value)}
													<option value={o.value}>{o.label}</option>
												{/each}
											</select>
										{:else if 'ability' in trigger}
											<select
												value={trigger.ability}
												disabled={readOnly}
												onchange={(e) =>
													setTrigger(action.id, t, {
														ability: e.currentTarget.value as typeof trigger.ability,
													})}
											>
												{#each act.ABILITY_BUTTON_OPTIONS as o (o.value)}
													<option value={o.value}>{o.label}</option>
												{/each}
											</select>
										{:else if 'event' in trigger}
											<span class="dim">{act.TRIGGER_KIND_LABELS[kind]}</span>
											<input
												class="short"
												value={trigger.event}
												list="sheet-events"
												spellcheck="false"
												disabled={readOnly}
												onchange={(e) => {
													const event = e.currentTarget.value;
													setTrigger(action.id, t, {
														event,
														...(trigger.as ? { as: trigger.as } : {}),
													});
													if (refused) settle(e.currentTarget, trigger.event);
												}}
											/>
											<select
												value={trigger.as ?? 'user'}
												disabled={readOnly}
												onchange={(e) =>
													setTrigger(action.id, t, {
														event: trigger.event,
														...(e.currentTarget.value === 'target'
															? { as: 'target' as const }
															: {}),
													})}
											>
												{#each act.EVENT_ROLE_OPTIONS as o (o.value)}
													<option value={o.value}>{o.label}</option>
												{/each}
											</select>
										{:else}
											<span class="dim">While</span>
											<input
												class="short"
												value={trigger.status}
												list="sheet-action-statuses"
												spellcheck="false"
												disabled={readOnly}
												onchange={(e) => {
													const status = e.currentTarget.value;
													setTrigger(action.id, t, { status });
													if (refused) settle(e.currentTarget, trigger.status);
												}}
											/>
										{/if}
										<button
											type="button"
											class="btn x"
											title="Remove this trigger"
											disabled={readOnly}
											onclick={() => run((d) => act.removeTrigger(d, id, action.id, t))}>×</button
										>
									</span>
								{:else}
									<span class="dim">nothing</span>
								{/each}
								<select
									class="add-trigger"
									data-add-trigger
									value=""
									disabled={readOnly}
									onchange={(e) => {
										const kind = act.TRIGGER_KINDS.find((k) => k === e.currentTarget.value);
										e.currentTarget.value = '';
										if (kind) run((d) => act.addTrigger(d, id, action.id, act.newTrigger(kind)));
									}}
								>
									<option value="">＋ Add</option>
									{#each act.TRIGGER_KINDS as k (k)}
										<option value={k}>{act.TRIGGER_KIND_LABELS[k]}</option>
									{/each}
								</select>
							</td>
							<td>
								<select
									value={act.playChoiceOf(action)}
									disabled={readOnly}
									onchange={(e) => {
										const play = e.currentTarget.value as act.PlayChoice;
										run((d) => act.setActionPlay(d, id, action.id, play));
										settle(e.currentTarget, action.play ?? 'default');
									}}
								>
									{#each act.PLAY_OPTIONS as play (play)}
										<option value={play}
											>{play === 'default'
												? `${act.PLAY_LABELS.default} (${characterActionPlay(action)})`
												: act.PLAY_LABELS[play]}</option
										>
									{/each}
								</select>
							</td>
							<td>
								<input
									class="num"
									type="number"
									value={action.priority ?? ''}
									placeholder={String(characterActionPriority(action))}
									disabled={readOnly}
									onchange={(e) => {
										const value = e.currentTarget.value;
										if (!run((d) => act.setActionPriority(d, id, action.id, value)))
											settle(e.currentTarget, action.priority);
									}}
								/>
							</td>
							<td>
								<select
									value={action.interrupt ?? 'default'}
									disabled={readOnly}
									onchange={(e) => {
										const interrupt = e.currentTarget.value as act.InterruptChoice;
										run((d) => act.setActionInterrupt(d, id, action.id, interrupt));
									}}
								>
									{#each act.INTERRUPT_OPTIONS as o (o)}
										<option value={o}>{act.INTERRUPT_LABELS[o]}</option>
									{/each}
								</select>
							</td>
							<td>
								<select
									value={action.again ?? 'default'}
									disabled={readOnly}
									onchange={(e) => {
										const again = e.currentTarget.value as act.AgainChoice;
										run((d) => act.setActionAgain(d, id, action.id, again));
									}}
								>
									{#each act.AGAIN_OPTIONS as o (o)}
										<option value={o}>{act.AGAIN_LABELS[o]}</option>
									{/each}
								</select>
							</td>
							<td>
								<select
									value={action.fallback ?? ''}
									disabled={readOnly}
									onchange={(e) => {
										const fallback = e.currentTarget.value;
										if (!run((d) => act.setActionFallback(d, id, action.id, fallback)))
											settle(e.currentTarget, action.fallback);
									}}
								>
									<option value="">none</option>
									{#each rows.filter((a) => a.id !== action.id) as other (other.id)}
										<option value={other.id}>{other.id}</option>
									{/each}
								</select>
							</td>
							<td>
								<IconButton
									icon="trash"
									label={`Remove the action "${action.id}"`}
									danger
									disabled={readOnly}
									onclick={() => remove(action.id)}
								/>
							</td>
						</tr>
					{/each}
					<tr>
						<td></td>
						<td>
							<input
								class="id"
								data-new-action
								bind:value={newAction}
								placeholder="roar"
								spellcheck="false"
								disabled={readOnly}
								onkeydown={(e) => e.key === 'Enter' && add()}
							/>
						</td>
						<td colspan="8">
							<button class="btn" type="button" data-add-action disabled={readOnly} onclick={add}
								>Add action</button
							>
						</td>
					</tr>
				</tbody>
			</table>
		</div>
		<datalist id="sheet-events">
			{#each act.EVENT_SUGGESTIONS as event (event)}<option value={event}></option>{/each}
		</datalist>
		<datalist id="sheet-action-statuses">
			{#each act.STATUS_SUGGESTIONS as status (status)}<option value={status}></option>{/each}
		</datalist>
		{#if refused}<p class="err" data-actions-refused>{refused}</p>{/if}
		{#if note}<p class="note" data-actions-note>{note}</p>{/if}
		<IssueList {issues} {warnings} />

		{#if sheet && grid && counts && rows.length}
			<p class="status" data-grid-counts>
				{counts.made} of {counts.needed} clips made{counts.empty
					? ` · ${counts.empty} cell${counts.empty === 1 ? ' draws' : 's draw'} nothing`
					: ''}
			</p>
			<CharacterClipsGrid
				{sheet}
				{grid}
				{clips}
				problems={characterProblems(sheet, Object.values(clips))}
				{onCell}
				{selected}
			/>
			{#if selectedCell}
				{@const cell = selectedCell}
				<CellEditor
					{cell}
					value={cellValueOf(sheet, cell.state, cell.facing)}
					{clipIds}
					loaded={(clipId) => Object.hasOwn(clips, clipId)}
					{readOnly}
					onSet={(value) => edit((d) => setCellValue(d, id, cell.state, cell.facing, value))}
				/>
			{/if}
			<CharacterDirections {sheet} {grid} {clips} bind:picked {onCell} {selected} />
		{/if}
	</SectionCard>
</div>

<style>
	.scroll {
		overflow-x: auto;
	}
	.actions-table input.id {
		width: 96px;
	}
	.actions-table input.num {
		width: 56px;
	}
	.actions-table input.short {
		width: 84px;
	}
	.actions-table tr.on td {
		background: #14181f;
	}
	.order {
		white-space: nowrap;
	}
	.triggers {
		min-width: 220px;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin: 0 6px 4px 0;
		padding: 2px 4px;
		border: 1px solid #23232c;
		border-radius: 6px;
	}
	.x {
		padding: 0 6px;
	}
	.add-trigger {
		width: 84px;
	}
	.dim {
		color: #8b8b98;
	}
	.status {
		margin: 12px 0 8px;
		color: #8b8b98;
		font-size: 12px;
	}
</style>
