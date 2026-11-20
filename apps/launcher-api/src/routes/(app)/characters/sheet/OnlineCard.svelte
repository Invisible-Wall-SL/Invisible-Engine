<script lang="ts">
	/**
	 * The ONLINE CLASSES drawn as this character's component (`arcade.online.characters`): which
	 * names this sheet and whether the game plays it, and the class's numbers. The numbers are the
	 * entries Game Config's Online section edits, through Game Config's own setters
	 * (`routes/(app)/config/onlineDoc.ts`), so the two tools cannot store them differently. A
	 * class's id and body are Game Config's, and its abilities are read-only here.
	 */
	import { resolve } from '$app/paths';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import { classIssues, classSheetStatus } from '$lib/characters/characterSheetCheck';
	import { SHEET_CARD_TITLES, sheetCardId } from '$lib/characters/characterSheetPage';
	import {
		ARCADE_POINTER_TAP_BUTTONS,
		type GameConfigDoc,
		type GameConfigIssue,
	} from 'game-config';
	import { pointsText, setOnlineCharacterField, setPointerTap } from '../../config/onlineDoc';
	import IssueList from './IssueList.svelte';
	import { settle, type SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		/** The component the character is drawn as. */
		component: string;
		/** The config as the page holds it. */
		config: GameConfigDoc;
		/** The page's issues, the save's. */
		issues: GameConfigIssue[];
		projectKey: string;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, component, config, issues, projectKey, readOnly, edit }: Props = $props();

	const online = $derived(config.arcade?.online);
	const classIds = $derived(sheets.classesOfComponent(config, component));
	const hasSheet = $derived(sheets.hasSheet(config, id));
	const configQuery = $derived(new URLSearchParams(projectKey ? { project: projectKey } : {}));
	let refused = $state('');
	const run = (change: Parameters<SheetEdit>[0]): boolean => {
		refused = edit(change) ?? '';
		return !refused;
	};
	const ms = (v: number | undefined): string => (v === undefined ? '—' : `${v} ms`);
	const TAP_LABELS: Record<(typeof ARCADE_POINTER_TAP_BUTTONS)[number], string> = {
		jump: 'Jump',
		ability1: 'Ability 1',
		ability2: 'Ability 2',
	};
</script>

<div id={sheetCardId('online')} data-sheet-card="online">
	<SectionCard scope="characters" id={sheetCardId('online')} title={SHEET_CARD_TITLES.online}>
		{#snippet info()}
			<p>
				What a player of a room can be. A class is drawn from this sheet when it names it and is the
				same component. Its speed, places, spawns and tap button are the same entries Invisible Game
				Config's Online section edits; its id, its body and its abilities are set there.
			</p>
		{/snippet}
		{#snippet actions()}
			<a class="maker" data-config-link href={resolve(`/config?${configQuery}`)}
				>Game Config, Online ↗</a
			>
		{/snippet}
		{#if !online}
			<p class="note" data-no-online>This game is not played online, so it has no class.</p>
		{:else if !classIds.length}
			<p class="note" data-no-class>
				No online class is drawn as <code>{component}</code>. Add one in Game Config, Online.
			</p>
		{/if}
		{#each classIds as classId (classId)}
			{@const index = sheets.classIndex(config, classId)}
			{@const cls = online?.characters[index]}
			{@const status = classSheetStatus(config, classId)}
			{@const abilities = (online?.rules?.abilities ?? []).filter((a) => a.character === classId)}
			{#if cls}
				<div class="class" data-class={classId}>
					<h3>
						<code>{classId}</code>
						{#if status.sheet === id && status.inForce}
							<span class="pill ok" data-sheet-status="inForce">drawn from this sheet</span>
						{:else if status.sheet === id}
							<span class="pill warn" data-sheet-status="notInForce"
								>names this sheet, not played</span
							>
						{:else if status.sheet}
							<span class="pill warn" data-sheet-status="other"
								>names the sheet of {status.sheet}</span
							>
						{:else}
							<span class="pill" data-sheet-status="none">names no sheet</span>
						{/if}
						{#if status.sheet === id}
							<button
								class="btn"
								type="button"
								data-unlink
								disabled={readOnly}
								onclick={() => run((d) => sheets.unlinkClassSheet(d, classId))}>Unlink</button
							>
						{:else}
							<button
								class="btn"
								type="button"
								data-link
								disabled={readOnly || !hasSheet}
								title={hasSheet ? '' : 'This character has no sheet yet.'}
								onclick={() => run((d) => sheets.linkClassSheet(d, classId, id))}
								>Draw it from this sheet</button
							>
						{/if}
					</h3>
					{#if status.sheet && !status.inForce}
						<p class="note" data-sheet-why>{status.why}</p>
					{/if}
					<div class="fields">
						<label
							>Speed px/s
							<input
								type="number"
								min="1"
								data-class-speed
								value={cls.speed}
								disabled={readOnly}
								onchange={(e) => {
									const value = e.currentTarget.value;
									run(
										(d) =>
											void setOnlineCharacterField(
												d,
												sheets.classIndex(d, classId),
												'speed',
												value,
											),
									);
									settle(e.currentTarget, sheets.findClass(config, classId)?.speed);
								}}
							/>
						</label>
						<label
							>Places
							<span class="inline">
								<input
									type="number"
									min="1"
									value={cls.max ?? ''}
									placeholder="any"
									disabled={readOnly}
									onchange={(e) => {
										const value = e.currentTarget.value;
										run(
											(d) =>
												void setOnlineCharacterField(
													d,
													sheets.classIndex(d, classId),
													'max',
													value,
												),
										);
									}}
								/>
								<InfoTip>How many players of a room can be this class. Empty: any number.</InfoTip>
							</span>
						</label>
						<label
							>Spawns
							<span class="inline">
								<input
									value={pointsText(cls.spawns)}
									placeholder="room spawn"
									disabled={readOnly}
									onchange={(e) => {
										const value = e.currentTarget.value;
										run(
											(d) =>
												void setOnlineCharacterField(
													d,
													sheets.classIndex(d, classId),
													'spawns',
													value,
												),
										);
									}}
								/>
								<InfoTip>
									Where it joins, as <code>x, y; x, y</code> in world px. Empty: the room's spawn.
								</InfoTip>
							</span>
						</label>
						<label class="check">
							<input
								type="checkbox"
								checked={cls.randomSpawn === true}
								disabled={readOnly || !cls.spawns?.length}
								onchange={(e) => {
									const on = e.currentTarget.checked;
									if (!run((d) => sheets.setClassRandomSpawn(d, classId, on)))
										e.currentTarget.checked = cls.randomSpawn === true;
								}}
							/>
							Spawn at random
							<InfoTip>Off: its spawns are taken in turn. It needs spawns of its own.</InfoTip>
						</label>
						<label
							>A tap presses
							<span class="inline">
								<select
									value={online?.pointer?.taps?.[classId] ?? ''}
									disabled={readOnly || !online?.pointer}
									onchange={(e) => {
										const value = e.currentTarget.value;
										run((d) => void setPointerTap(d, classId, value));
									}}
								>
									<option value="">Nothing (it only steers)</option>
									{#each ARCADE_POINTER_TAP_BUTTONS as button (button)}
										<option value={button}>{TAP_LABELS[button]}</option>
									{/each}
								</select>
								<InfoTip>
									The button a tap or a click presses for this class. It needs pointer steering,
									which is switched on in Game Config, Online.
								</InfoTip>
							</span>
						</label>
					</div>
					<IssueList issues={classIssues(issues, index)} />
					{#if abilities.length}
						<table class="rows abilities" data-class-abilities>
							<thead>
								<tr>
									<th>Button</th><th>Effect</th><th>Reach</th><th>Targets</th><th>Holds</th><th
										>Cooldown</th
									><th>Used</th>
								</tr>
							</thead>
							<tbody>
								{#each abilities as a, i (i)}
									<tr>
										<td>{a.button}</td>
										<td>{a.effect}{a.score ? ` · +${a.score}` : ''}</td>
										<td>{a.reach} px{a.ahead ? `, ${a.ahead} ahead` : ''}</td>
										<td>{a.targets.join(', ')}</td>
										<td>{ms(a.ms)}</td>
										<td>{ms(a.cooldownMs)}</td>
										<td>{a.onPress ? 'once a press' : 'while held'}</td>
									</tr>
								{/each}
							</tbody>
						</table>
					{:else}
						<p class="dim">No ability.</p>
					{/if}
				</div>
			{/if}
		{/each}
		{#if refused}<p class="err" data-online-refused>{refused}</p>{/if}
	</SectionCard>
</div>

<style>
	.class {
		padding: 10px 0;
		border-top: 1px solid #1d1d25;
	}
	.class:first-of-type {
		border-top: 0;
		padding-top: 0;
	}
	.abilities {
		margin-top: 12px;
	}
	.dim {
		margin: 8px 0 0;
		color: #8b8b98;
		font-size: 12px;
	}
</style>
