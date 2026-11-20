<script lang="ts">
	/**
	 * ONE CELL of the actions grid of a sheet drawn as a RIG: the animation the sheet names for an
	 * action in a facing, or none (found by name), and optionally another rig than the facing's.
	 * What the cell looks for and what the game draws are the grid's own answer
	 * (`characterSheetRigCard.ts` `rigCellTitle`). A clip or a still image the cell still holds is
	 * shown, and written over only after Replace. Mounted per cell (`{#key}` in `ActionsCard`).
	 */
	import RigSelect from '$lib/characters/RigSelect.svelte';
	import { cellValueText, type CellValue } from '$lib/characters/characterSheetPage';
	import {
		animationLabel,
		rigCellDefault,
		rigCellRig,
		rigCellStored,
		rigCellTitle,
		rigCellValue,
	} from '$lib/characters/characterSheetRigCard';
	import type { RigGridCell } from '$lib/characters/characterSheetRigGrid';
	import type { RigFactsByName } from '$lib/characters/rigFacts';
	import InfoTip from '$lib/ui/InfoTip.svelte';

	interface Props {
		cell: RigGridCell;
		/** What the sheet stores for the cell, of any kind. */
		value: CellValue | undefined;
		/** The project's rigs, and what the page has read of them. */
		rigNames: readonly { name: string; shared: boolean }[];
		rigs: RigFactsByName;
		/** A rig the sheet names is still being read. */
		reading: boolean;
		/** Ask the page to read a rig's facts. */
		onWant: (rig: string) => void;
		readOnly: boolean;
		replaces: (value: CellValue) => boolean;
		onSet: (value: CellValue | undefined, replace?: boolean) => string | null;
	}
	let { cell, value, rigNames, rigs, reading, onWant, readOnly, replaces, onSet }: Props = $props();

	let refused = $state('');
	let waiting = $state.raw<CellValue | undefined>(undefined);
	/** Another rig picked for the cell before its animation is. */
	let otherRig = $state('');
	const stored = $derived(rigCellStored(value));
	const rigName = $derived(rigCellRig(cell, otherRig));
	const facts = $derived(rigName && Object.hasOwn(rigs, rigName) ? rigs[rigName] : undefined);
	const animations = $derived(facts?.animations ?? []);

	function set(next: CellValue | undefined): void {
		if (next && replaces(next)) {
			waiting = next;
			refused = '';
			return;
		}
		waiting = undefined;
		refused = onSet(next) ?? '';
	}
	function replace(): void {
		refused = onSet(waiting, true) ?? '';
		waiting = undefined;
	}
	function pickAnimation(name: string): void {
		set(rigCellValue(name, otherRig || stored?.rig));
	}
	function pickRig(rig: string): void {
		otherRig = rig;
		if (rig) onWant(rig);
		if (stored) set(rigCellValue(stored.animation, rig));
	}
</script>

<div class="cell-editor" data-cell-editor="{cell.state}|{cell.facing}">
	<div class="line">
		<b>{cell.state}</b> facing <b>{cell.facing}</b>
		<span class="dim" data-cell-draws>{rigCellTitle(cell, reading)}</span>
	</div>
	{#if value && !stored}
		<div class="line">
			<span class="warn-text" data-cell-unread>
				The cell holds {cellValueText(value)}, which a rig does not draw.
			</span>
			<button
				class="btn"
				type="button"
				data-cell-by-name
				disabled={readOnly}
				onclick={() => set(undefined)}>Empty the cell</button
			>
		</div>
	{/if}
	<div class="line">
		<label class="row">
			Animation
			<select
				data-cell-animation
				aria-label="Animation of {cell.state} facing {cell.facing}"
				value={stored?.animation ?? ''}
				disabled={readOnly}
				onchange={(e) => {
					const name = e.currentTarget.value;
					pickAnimation(name);
					if (refused || waiting) e.currentTarget.value = stored?.animation ?? '';
				}}
			>
				<option value="">by name{rigCellDefault(cell) ? `: ${rigCellDefault(cell)}` : ''}</option>
				{#if stored && !animations.some((a) => a.name === stored.animation)}
					<option value={stored.animation}>{stored.animation} (not read in {rigName ?? 'a rig'})</option>
				{/if}
				{#each animations as animation (animation.name)}
					<option value={animation.name}>{animationLabel(animation)}</option>
				{/each}
			</select>
			<InfoTip>
				Leave it by name and the game looks for <code>action_facing</code>, then
				<code>action</code>, on the facing's rig. Pick an animation to draw that one here instead.
			</InfoTip>
		</label>
		<label class="row">
			On the rig
			<RigSelect
				rigs={rigNames}
				value={otherRig || stored?.rig || ''}
				blank={`the facing's${cell.looksOn && !stored?.rig ? ` (${cell.looksOn})` : ''}`}
				label="Another rig for {cell.state} facing {cell.facing}"
				disabled={readOnly}
				onPick={pickRig}
			/>
			<InfoTip>
				Another rig than the facing's, for this one cell. It is stored with the animation: pick the
				rig, then one of its animations.
			</InfoTip>
		</label>
		{#if rigName && !facts}<span class="dim" data-cell-reading>reading {rigName}…</span>{/if}
	</div>
	{#if waiting}
		<div class="line" data-cell-replace>
			<span class="warn-text">
				The cell holds {value ? cellValueText(value) : 'a value'}. Replace it with {cellValueText(
					waiting,
				)}?
			</span>
			<button class="btn" type="button" data-cell-replace-yes disabled={readOnly} onclick={replace}
				>Replace</button
			>
			<button class="btn" type="button" onclick={() => (waiting = undefined)}>Keep it</button>
		</div>
	{/if}
	{#if refused}<span class="err" data-cell-refused>{refused}</span>{/if}
</div>

<style>
	.cell-editor {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 8px 0;
		padding: 8px 10px;
		border: 1px solid #23232c;
		border-radius: 8px;
		background: #111117;
		font-size: 12px;
	}
	.line {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 10px;
	}
	.row {
		flex-direction: row;
		align-items: center;
		gap: 6px;
	}
	.dim {
		color: #8b8b98;
	}
	.warn-text {
		color: #d3b483;
	}
</style>
