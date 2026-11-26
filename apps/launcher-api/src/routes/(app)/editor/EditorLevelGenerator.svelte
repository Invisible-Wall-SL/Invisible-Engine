<script lang="ts">
	import {
		LEVELS_GENERATOR_DEFAULTS,
		LEVELS_GENERATOR_LIMITS,
		LEVELS_GENERATOR_WHOLE,
		LEVELS_RIVER_DEFAULTS,
		LEVELS_SHAPE_LIMITS,
		type LevelsRiver,
		type LevelsWaterfalls,
		type ShapedLevels,
	} from 'game-config';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import { setGenerator, setRiver, setWaterfalls } from '$lib/editor/generatedLevel';
	import {
		LEVEL_PARAM_GROUPS,
		withParam,
		withoutGroup,
		type LevelParamGroup,
	} from '$lib/editor/generatedLevelParams';
	import LevelParamField from './LevelParamField.svelte';

	/**
	 * EVERY SETTING OF A GENERATED LEVEL (`docs/design/salmons-levels.md` §6), one card a group
	 * (`generatedLevelParams.ts`): river shape, course, waterfalls, rocks and whirlpools, bridges,
	 * sea and delta, spawns. Each edit is handed up as the levels it makes; the Generated level
	 * card redraws the stage with them and saves them.
	 */
	type Props = {
		levels: ShapedLevels | undefined;
		disabled: boolean;
		onEdit: (next: ShapedLevels) => void;
	};
	const { levels, disabled, onEdit }: Props = $props();

	const L = LEVELS_SHAPE_LIMITS;
	const generator = $derived(levels?.generator);
	const river = $derived(levels?.river);
	const falls = $derived(levels?.waterfalls);
	const touched = (group: LevelParamGroup) =>
		group.params.some((p) => generator?.[p.key] !== undefined);
	const resetGroup = (group: LevelParamGroup) =>
		onEdit(setGenerator(levels, withoutGroup(generator, group)));
	const editRiver = (patch: LevelsRiver) => onEdit(setRiver(levels, { ...river, ...patch }));
	const editFalls = (patch: LevelsWaterfalls) =>
		onEdit(setWaterfalls(levels, { ...falls, ...patch }));
	/** A waterfall's cliff as drawn, px, for a height in cells (`engine-layout` `salmonsElevation`). */
	const cliffPx = (cells: number) => (32 + 16 * cells) * 1.5;
</script>

{#snippet params(group: LevelParamGroup)}
	{#each group.params as param (param.key)}
		<LevelParamField
			label={param.label}
			help={param.help}
			value={generator?.[param.key]}
			fallback={LEVELS_GENERATOR_DEFAULTS[param.key]}
			limit={LEVELS_GENERATOR_LIMITS[param.key]}
			step={param.step}
			whole={LEVELS_GENERATOR_WHOLE.includes(param.key)}
			{disabled}
			onset={(v) => onEdit(setGenerator(levels, withParam(generator, param.key, v)))}
		/>
	{/each}
{/snippet}

{#snippet reset(group: LevelParamGroup)}
	{#if touched(group)}
		<IconButton
			icon="reset"
			label="Every {group.title.toLowerCase()} setting back to its default"
			{disabled}
			onclick={() => resetGroup(group)}
		/>
	{/if}
{/snippet}

{#each LEVEL_PARAM_GROUPS as group (group.id)}
	<SectionCard scope="editor" id={group.id} title={group.title}>
		{#snippet info()}{group.info}{/snippet}
		{#snippet actions()}{@render reset(group)}{/snippet}
		{#if group.id === 'level-river'}
			<label class="tick">
				<input
					type="checkbox"
					checked={!!river}
					{disabled}
					onchange={(e) => onEdit(setRiver(levels, e.currentTarget.checked ? {} : undefined))}
				/>
				Winding river
				<InfoTip>
					Off: the generator's own river, a gentle meander that always runs the same way across the
					screen. On: the river bends from side to side, so some reaches run the other way across
					the screen, with a straight run at the source, each side of a waterfall and through the
					delta.
				</InfoTip>
			</label>
			{#if river}
				<LevelParamField
					label="Winding"
					help="The share of reaches that bend; the others run nearly straight."
					value={river.winding}
					fallback={LEVELS_RIVER_DEFAULTS.winding}
					limit={L.winding}
					step={0.05}
					{disabled}
					onset={(v) => editRiver({ winding: v })}
				/>
				<LevelParamField
					label="Sharpest turn (°)"
					help="The most a bend turns the river. Past 90 the reaches either side of a bend run opposite ways across the screen."
					value={river.sharpestTurn}
					fallback={LEVELS_RIVER_DEFAULTS.sharpestTurn}
					limit={L.sharpestTurn}
					step={5}
					{disabled}
					onset={(v) => editRiver({ sharpestTurn: v })}
				/>
				<LevelParamField
					label="Towards the source"
					help="How much of the sharpness is kept for the source. 0: bends are as sharp all the way down; 1: the sharp bends are round the source."
					value={river.sourceBias}
					fallback={LEVELS_RIVER_DEFAULTS.sourceBias}
					limit={L.sourceBias}
					step={0.05}
					{disabled}
					onset={(v) => editRiver({ sourceBias: v })}
				/>
			{/if}
			<div class="rule"></div>
		{:else if group.id === 'level-course' && !river}
			<p class="note">Read only with Winding river on.</p>
		{:else if group.id === 'level-waterfalls'}
			<LevelParamField
				label="Count"
				help="How many waterfalls a level has, spread evenly above the delta. Empty: the generator's own, every column below."
				value={falls?.count}
				fallback={6}
				limit={L.waterfallCount}
				step={1}
				whole
				{disabled}
				onset={(v) => editFalls({ count: v })}
			/>
			<LevelParamField
				label="Lowest (cells)"
				help="Every waterfall is a whole number of cells high between Lowest and Highest. A waterfall of 1 is a {cliffPx(
					1,
				)} px cliff, of 8 {cliffPx(8)} px, of 16 {cliffPx(
					16,
				)} px. Both empty: the generator's own heights, lowest towards the sea."
				value={falls?.heightMin}
				fallback={1}
				limit={L.waterfallHeight}
				step={1}
				whole
				{disabled}
				onset={(v) => editFalls({ heightMin: v })}
			/>
			<LevelParamField
				label="Highest (cells)"
				help="The highest a waterfall may be."
				value={falls?.heightMax}
				fallback={8}
				limit={L.waterfallHeight}
				step={1}
				whole
				{disabled}
				onset={(v) => editFalls({ heightMax: v })}
			/>
			{#if falls?.heightMin !== undefined && falls.heightMax !== undefined && falls.heightMin > falls.heightMax}
				<p class="warn">Lowest is above Highest: a level plays them the other way round.</p>
			{/if}
			<div class="rule"></div>
		{/if}
		{@render params(group)}
	</SectionCard>
{/each}

<style>
	.tick,
	.note {
		color: #e6e6ee;
	}
	.tick {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		margin: 2px 0 4px;
		font-size: 12px;
	}
	.rule {
		height: 1px;
		margin: 6px 0;
		background: #1d1d26;
	}
	.note {
		margin: 2px 0 6px;
		opacity: 0.75;
		font-size: 0.9em;
	}
	.warn {
		margin: 2px 0;
		color: #f0c878;
		font-size: 0.9em;
	}
</style>
