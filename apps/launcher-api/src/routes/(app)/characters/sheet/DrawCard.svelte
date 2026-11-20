<script lang="ts">
	/**
	 * The sheet's DRAW BOX AND POINTS (`docs/design/character-pipeline.md` §12.7): how wide the
	 * art's Bounds box is drawn, where the ground is down it, its named points, and for a rig the
	 * bone each point follows. Numbers only: the box itself is set where the art is made
	 * (Flipbook's One Bounds box, the Rigger's Bounds), and the Actions card's preview shows it
	 * (its Box switch).
	 */
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import * as sheets from '$lib/characters/characterSheetEdit';
	import { SHEET_CARD_TITLES, sheetCardId } from '$lib/characters/characterSheetPage';
	import { BONE_TIP, bonePointRows, sheetBones } from '$lib/characters/characterSheetRigCard';
	import { rigSourceOfSheet } from '$lib/characters/characterSheetSources';
	import type { RigFactsByName } from '$lib/characters/rigFacts';
	import type { CharacterSheet, GameConfigIssue } from 'game-config';
	import IssueList from './IssueList.svelte';
	import { settle, type SheetEdit } from './sheetEdit';

	interface Props {
		id: string;
		sheet: CharacterSheet | undefined;
		issues: GameConfigIssue[];
		/** The tool's own warnings of this card (`sheetWarnings`). */
		warnings: string[];
		/** The rigs the page has read: their bones are what a point can follow. */
		rigs: RigFactsByName;
		readOnly: boolean;
		edit: SheetEdit;
	}
	let { id, sheet, issues, warnings, rigs, readOnly, edit }: Props = $props();

	const draw = $derived(sheet?.draw);
	const points = $derived(sheets.pointsOf(sheet));
	const bones = $derived(sheets.bonesOf(sheet));
	const isRig = $derived(!!rigSourceOfSheet(sheet));
	const boneRows = $derived(bonePointRows(sheet));
	const rigBones = $derived(sheetBones(sheet, rigs));
	let refused = $state('');
	let newPoint = $state('');
	const run = (change: Parameters<SheetEdit>[0]): boolean => {
		refused = edit(change) ?? '';
		return !refused;
	};
</script>

<div id={sheetCardId('draw')} data-sheet-card="draw">
	<SectionCard scope="characters" id={sheetCardId('draw')} title={SHEET_CARD_TITLES.draw}>
		{#snippet info()}
			<p>
				How big the character is drawn and where it stands. The width is the world size of its art's
				Bounds box; the box itself is set where the art is made (Flipbook's One Bounds box). The
				preview on the Actions card shows it: switch its Box on.
			</p>
		{/snippet}
		{#snippet actions()}
			{#if draw}
				<IconButton
					icon="trash"
					label="Take the draw box away, with its feet, its points and the bones they follow"
					danger
					disabled={readOnly}
					onclick={() => run((d) => sheets.clearDraw(d, id))}
				/>
			{/if}
		{/snippet}
		<div class="fields">
			<label
				>Width (world px)
				<input
					type="number"
					min="1"
					data-draw-width
					value={draw?.width ?? ''}
					disabled={readOnly}
					onchange={(e) => {
						const value = e.currentTarget.value;
						const ok = run((d) => sheets.setDrawWidth(d, id, value));
						settle(e.currentTarget, ok ? Number(value) : draw?.width);
					}}
				/>
			</label>
			{#if draw}
				<label
					>Feet
					<span class="inline">
						<input
							type="number"
							min="0"
							max="1"
							step="0.01"
							data-draw-feet
							value={draw.feet ?? ''}
							placeholder="1"
							disabled={readOnly}
							onchange={(e) => {
								const value = e.currentTarget.value;
								if (!run((d) => sheets.setDrawFeet(d, id, value)))
									settle(e.currentTarget, draw?.feet);
							}}
						/>
						<InfoTip>
							Where the ground is down the box: 0 is its top, 1 its bottom (the default). The
							character stands on that line.
						</InfoTip>
					</span>
				</label>
			{/if}
		</div>
		{#if draw}
			<h3>
				Points
				<InfoTip>
					A named place on the box the game can attach to (<code>hand</code>: where a carried thing
					is held). Across and down the box, 0 to 1; mirrored with the art.
				</InfoTip>
			</h3>
			<table class="rows" data-points>
				<thead><tr><th>Name</th><th>Across</th><th>Down</th><th></th></tr></thead>
				<tbody>
					{#each points as point (point.name)}
						<tr data-point={point.name}>
							<td>
								<input
									aria-label={`Name of the point "${point.name}"`}
									value={point.name}
									spellcheck="false"
									disabled={readOnly}
									onchange={(e) => {
										const next = e.currentTarget.value;
										if (!run((d) => sheets.renamePoint(d, id, point.name, next)))
											settle(e.currentTarget, point.name);
									}}
								/>
							</td>
							{#each ['x', 'y'] as const as axis (axis)}
								<td>
									<input
										type="number"
										step="0.01"
										data-point-axis={axis}
										aria-label={`${axis === 'x' ? 'Across' : 'Down'} of the point "${point.name}"`}
										value={point[axis]}
										disabled={readOnly}
										onchange={(e) => {
											const value = e.currentTarget.value;
											if (!run((d) => sheets.setPoint(d, id, point.name, axis, value)))
												settle(e.currentTarget, point[axis]);
										}}
									/>
								</td>
							{/each}
							<td>
								<IconButton
									icon="trash"
									label={`Remove the point "${point.name}"`}
									danger
									disabled={readOnly}
									onclick={() => run((d) => sheets.removePoint(d, id, point.name))}
								/>
							</td>
						</tr>
					{/each}
					<tr>
						<td>
							<input
								bind:value={newPoint}
								data-new-point
								aria-label="Name of a new point"
								placeholder="hand"
								spellcheck="false"
								disabled={readOnly}
							/>
						</td>
						<td colspan="3">
							<button
								class="btn"
								type="button"
								data-add-point
								disabled={readOnly || !newPoint.trim()}
								onclick={() => {
									if (run((d) => sheets.addPoint(d, id, newPoint))) newPoint = '';
								}}>Add point</button
							>
						</td>
					</tr>
				</tbody>
			</table>
		{/if}
		{#if draw && isRig}
			<h3>
				Bones
				<InfoTip>{BONE_TIP}</InfoTip>
			</h3>
			<table class="rows" data-bones>
				<thead><tr><th>Point</th><th>Follows the bone</th><th></th></tr></thead>
				<tbody>
					{#each boneRows as row (row.point)}
						<tr data-bone-point={row.point}>
							<th scope="row"><code>{row.point}</code></th>
							<td>
								<select
									data-point-bone
									aria-label={`The bone the point "${row.point}" follows`}
									value={row.bone ?? ''}
									disabled={readOnly}
									onchange={(e) => {
										const bone = e.currentTarget.value;
										if (!run((d) => sheets.setPointBone(d, id, row.point, bone)))
											settle(e.currentTarget, row.bone);
									}}
								>
									<option value="">{row.onBox ? 'none: its place on the box' : 'none'}</option>
									{#if row.bone && !rigBones.includes(row.bone)}
										<option value={row.bone}>{row.bone} (not read in the rig)</option>
									{/if}
									{#each rigBones as bone (bone)}<option value={bone}>{bone}</option>{/each}
								</select>
							</td>
							<td class="dim">{row.read ? 'read by the game' : 'not read by the game yet'}</td>
						</tr>
					{/each}
				</tbody>
			</table>
		{:else if bones.length}
			<p class="note" data-draw-bones>
				Kept for a rig source, and not read under this one:
				{bones.map(([point, bone]) => `${point} → ${bone}`).join(', ')}
			</p>
		{/if}
		{#if refused}<p class="err">{refused}</p>{/if}
		<IssueList {issues} {warnings} />
	</SectionCard>
</div>

<style>
	.dim {
		color: #8b8b98;
	}
</style>
