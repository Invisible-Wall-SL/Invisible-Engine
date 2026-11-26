<script lang="ts">
	import { SALMONS_BIOME_LOOK, SALMONS_BIOME_PLAY } from 'engine-mechanics';
	import {
		LEVELS_BIOME_LIMITS,
		type LevelsBiome,
		type LevelsBiomeStart,
		type LevelsBiomes,
		type ShapedLevels,
	} from 'game-config';
	import ColorField from '$lib/ColorField.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import { setBiomes } from '$lib/editor/generatedLevel';
	import {
		addBiome,
		biomeName,
		biomesOf,
		builtInBiomes,
		dropStretch,
		grassOf,
		inkOn,
		moveBiome,
		moveStart,
		patchBiome,
		removeBiome,
		sequenceFrom,
		sequenceOf,
		setSequence,
		splitStretch,
		type BiomeScope,
	} from '$lib/editor/generatedLevelBiomes';
	import { paramValue } from '$lib/editor/generatedLevelParams';
	import LevelParamField from './LevelParamField.svelte';

	/**
	 * A GENERATED LEVEL'S BIOMES (`docs/design/salmons-levels.md` §6): the kinds an author defines
	 * (their trees, grass, floor and riverbed, and their rocks', whirlpools', sand's, waterfalls'
	 * and bridges' density) and the sequence they take along the river, by seed or for every level,
	 * on a strip from the source to the sea whose boundaries drag. Each edit is handed up as the
	 * levels it makes; the Generated level card redraws the stage and saves them.
	 */
	type Props = {
		levels: ShapedLevels | undefined;
		seed: number;
		disabled: boolean;
		onEdit: (next: ShapedLevels) => void;
	};
	const { levels, seed, disabled, onEdit }: Props = $props();

	const B = LEVELS_BIOME_LIMITS;
	let scope = $state<BiomeScope>('*');
	let selected = $state<string | undefined>(undefined);
	let picked = $state(0);
	let strip = $state<HTMLDivElement>();
	/** A boundary's sequence while it is dragged: drawn on the strip, handed up on release. */
	let dragging = $state<LevelsBiomeStart[] | undefined>(undefined);

	const biomes = $derived(levels?.biomes);
	const riverLength = $derived(paramValue(levels?.generator, 'riverLength'));
	const sandFrom = $derived(Math.floor(riverLength * paramValue(levels?.generator, 'sandStart')));
	const resolved = $derived(biomesOf(biomes, seed));
	const kinds = $derived(resolved.kinds);
	const kindById = (id: string) => kinds.find((k) => k.id === id) ?? kinds[0];
	const current = $derived(selected ? kinds.find((k) => k.id === selected) : undefined);
	/** The selected kind's authored fields (none: every one at its default). */
	const authoredKind: LevelsBiome = $derived(
		(biomes?.kinds ?? []).find((k) => k.id === selected) ?? { id: selected ?? '' },
	);
	const entries = $derived(dragging ?? (biomes ? sequenceOf(biomes, scope) : undefined));
	/** What the strip shows for the scope: its own sequence, else what plays (for a seed, every
	 *  level's), else the cycle. */
	const shown = $derived.by(() => {
		if (!biomes) return [];
		const own = entries ?? (scope === '*' ? undefined : sequenceOf(biomes, '*'));
		const view: LevelsBiomes = { ...biomes, sequences: own ? { '*': own } : undefined };
		return sequenceFrom(view, seed, riverLength);
	});
	const stretches = $derived(
		shown.map((e, i) => ({
			...e,
			to: shown[i + 1]?.from ?? riverLength,
			kind: kindById(e.biome),
		})),
	);

	const edit = (next: LevelsBiomes | undefined) => onEdit(setBiomes(levels, next));
	const editSequence = (next: LevelsBiomeStart[] | undefined) =>
		biomes && edit(setSequence(biomes, scope, next));
	const patch = (p: Partial<Omit<LevelsBiome, 'id'>>) =>
		biomes && selected && edit(patchBiome(biomes, selected, p));
	const pct = (col: number) => `${(100 * col) / riverLength}%`;

	/** Drag a boundary: the start of entry `i` follows the pointer along the strip. */
	function drag(e: PointerEvent, i: number): void {
		if (!entries || !strip || disabled) return;
		const handle = e.currentTarget as HTMLElement;
		handle.setPointerCapture(e.pointerId);
		const box = strip.getBoundingClientRect();
		dragging = entries;
		const move = (ev: PointerEvent) => {
			const col = ((ev.clientX - box.left) / box.width) * riverLength;
			if (dragging) dragging = moveStart(dragging, i, col, riverLength);
		};
		const up = () => {
			const list = dragging;
			dragging = undefined;
			if (list) editSequence(list);
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			handle.removeEventListener('pointercancel', up);
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
		handle.addEventListener('pointercancel', up);
	}
	/** A boundary nudged by the keyboard, a column (ten with Shift) a press. */
	function nudge(e: KeyboardEvent, i: number): void {
		if (!entries || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
		e.preventDefault();
		const by = (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 10 : 1);
		editSequence(moveStart(entries, i, entries[i].from + by, riverLength));
	}
	const scopeLabel = (s: string) => (s === '*' ? 'every level' : `seed ${s}`);
</script>

{#snippet swatch(kind: (typeof kinds)[number])}
	<span class="swatch" aria-hidden="true">
		<span style:background={grassOf(kind)}></span>
		<span style:background={kind.forestFloor}></span>
		<span style:background={kind.riverbed[0]}></span>
	</span>
{/snippet}

<SectionCard scope="editor" id="level-biomes" title="Biomes">
	{#snippet info()}
		Stretches of the river that each grow their own forest, floor and riverbed, and lay their own
		share of rocks, whirlpools, sand, waterfalls and bridges. The strip runs from the source (left)
		to the sea (right); drag a boundary to move where the next biome starts. Off, the level plays
		the original's six forests in turn every 35 columns, and at densities of 1 a biome changes
		nothing a room plays.
	{/snippet}
	{#snippet actions()}
		{#if biomes}
			<IconButton
				icon="reset"
				label="Back to the original's forests"
				{disabled}
				onclick={() => {
					selected = undefined;
					edit(undefined);
				}}
			/>
		{/if}
	{/snippet}
	<label class="tick">
		<input
			type="checkbox"
			checked={!!biomes}
			{disabled}
			onchange={(e) => edit(e.currentTarget.checked ? builtInBiomes() : undefined)}
		/>
		Authored biomes
		<InfoTip>
			On: start from the original's six biomes, named forest1 to forest6, and change, add or lay
			them out; the level and a room's art stay the original's until you change something (the stage
			marks each stretch's floor). Off: the original's forests.
		</InfoTip>
	</label>

	{#if biomes}
		<div class="row">
			<label>
				Sequence
				<select bind:value={scope} {disabled}>
					<option value="*">every level</option>
					<option value={String(seed)}>this seed ({seed})</option>
				</select>
			</label>
			<span class="spacer"></span>
			{#if entries}
				<IconButton
					icon="trash"
					label="Clear the sequence of {scopeLabel(scope)}"
					danger
					{disabled}
					onclick={() => editSequence(undefined)}
				/>
			{/if}
		</div>

		<div
			class="strip"
			bind:this={strip}
			role="group"
			aria-label="Biomes from the source to the sea"
		>
			{#each stretches as s, i (i)}
				<button
					type="button"
					class="stretch"
					class:picked={entries && picked === i}
					style:left={pct(s.from)}
					style:width={pct(s.to - s.from)}
					title="{biomeName(s.kind)}: columns {s.from}–{s.to - 1}"
					onclick={() => {
						picked = i;
						selected = s.biome;
					}}
				>
					<span class="band" style:background={grassOf(s.kind)}></span>
					<span class="band" style:background={s.kind.forestFloor}></span>
					<span class="band" style:background={s.kind.riverbed[0]}></span>
					<span
						class="chip"
						style:background={s.kind.forestFloor}
						style:color={inkOn(s.kind.forestFloor)}>{biomeName(s.kind)}</span
					>
				</button>
				{#if entries && i > 0}
					<span
						class="handle"
						style:left={pct(s.from)}
						role="slider"
						tabindex="0"
						aria-label="Where {biomeName(s.kind)} starts"
						aria-valuemin={0}
						aria-valuemax={riverLength}
						aria-valuenow={s.from}
						onpointerdown={(e) => drag(e, i)}
						onkeydown={(e) => nudge(e, i)}
					></span>
				{/if}
			{/each}
			<span class="mark" style:left={pct(sandFrom)} title="The sand starts: column {sandFrom}"
			></span>
		</div>
		<div class="ends">
			<span>source</span>
			<span class="at" style:left={pct(sandFrom)}>sand {sandFrom}</span>
			<span>sea {riverLength}</span>
		</div>

		{#if entries}
			{@const at = Math.min(picked, entries.length - 1)}
			<div class="row">
				<label>
					Stretch {at + 1}
					<select
						value={entries[at].biome}
						{disabled}
						onchange={(e) =>
							editSequence(
								entries.map((x, k) => (k === at ? { ...x, biome: e.currentTarget.value } : x)),
							)}
					>
						{#each kinds as k (k.id)}<option value={k.id}>{biomeName(k)}</option>{/each}
					</select>
				</label>
				<label>
					from
					<input
						type="number"
						min="0"
						max={riverLength - 1}
						step="1"
						value={entries[at].from}
						disabled={disabled || at === 0}
						onchange={(e) =>
							editSequence(moveStart(entries, at, e.currentTarget.valueAsNumber, riverLength))}
					/>
				</label>
				<button
					type="button"
					{disabled}
					onclick={() => editSequence(splitStretch(entries, at, riverLength))}>Split</button
				>
				<IconButton
					icon="trash"
					label="Take this stretch out"
					danger
					disabled={disabled || entries.length < 2}
					onclick={() => {
						editSequence(dropStretch(entries, at));
						picked = Math.max(0, at - 1);
					}}
				/>
			</div>
		{:else}
			<div class="row">
				<span class="note">
					{scope !== '*' && sequenceOf(biomes, '*')
						? 'This seed plays every level’s sequence.'
						: `The biomes take turns every ${resolved.cycle} columns.`}
				</span>
				<button
					type="button"
					{disabled}
					onclick={() => editSequence(sequenceFrom(biomes, seed, riverLength))}
					>Lay out {scopeLabel(scope)}</button
				>
			</div>
			{#if scope === '*' || !sequenceOf(biomes, '*')}
				<LevelParamField
					label="Turn every (columns)"
					help="With no sequence, the biomes take turns from the source in the list's order, each this many columns."
					value={biomes.cycle}
					fallback={35}
					limit={B.cycle}
					step={1}
					whole
					{disabled}
					onset={(v) => edit({ ...biomes, cycle: v })}
				/>
			{/if}
		{/if}

		<ul class="kinds">
			{#each kinds as k, i (k.id)}
				<li class:on={selected === k.id}>
					<button type="button" class="pick" onclick={() => (selected = k.id)}>
						{@render swatch(k)}
						<span class="kname">{biomeName(k)}</span>
						{#if k.name}<span class="kid">{k.id}</span>{/if}
					</button>
					<IconButton
						icon="up"
						label="Move up"
						disabled={disabled || i === 0}
						onclick={() => edit(moveBiome(biomes, k.id, -1))}
					/>
					<IconButton
						icon="down"
						label="Move down"
						disabled={disabled || i === kinds.length - 1}
						onclick={() => edit(moveBiome(biomes, k.id, 1))}
					/>
					<IconButton
						icon="trash"
						label="Remove {biomeName(k)}"
						danger
						disabled={disabled || kinds.length < 2}
						onclick={() => {
							if (selected === k.id) selected = undefined;
							edit(removeBiome(biomes, k.id));
						}}
					/>
				</li>
			{/each}
		</ul>
		<div class="row">
			<button
				type="button"
				disabled={disabled || kinds.length >= B.kinds[1]}
				onclick={() => {
					const made = addBiome(biomes);
					selected = made.id;
					edit(made.biomes);
				}}>Add biome</button
			>
		</div>

		{#if current}
			<div class="kind-edit">
				<div class="row">
					<label>
						Name
						<input
							type="text"
							maxlength="40"
							size="16"
							value={current.name ?? ''}
							placeholder={current.id}
							{disabled}
							onchange={(e) => patch({ name: e.currentTarget.value.trim() || undefined })}
						/>
					</label>
				</div>
				<div class="row">
					<span class="lbl">
						Trees
						<InfoTip
							>The tree pictures this biome grows, one picked at random for each tree.</InfoTip
						>
					</span>
					{#each [0, 1, 2, 3, 4, 5] as t (t)}
						<label class="tree">
							<input
								type="checkbox"
								checked={current.trees.includes(t)}
								disabled={disabled || (current.trees.length === 1 && current.trees.includes(t))}
								onchange={(e) =>
									patch({
										trees: e.currentTarget.checked
											? [...current.trees, t].sort()
											: current.trees.filter((x) => x !== t),
									})}
							/>
							{t + 1}
						</label>
					{/each}
				</div>
				<div class="row colours">
					<span class="lbl">Grass tint</span>
					<ColorField
						value={current.grassTint}
						{disabled}
						title="Grass tint (white: the art's own green)"
						onchange={(hex) => patch({ grassTint: hex })}
					/>
					<span class="lbl">Floor</span>
					<ColorField
						value={current.forestFloor}
						{disabled}
						title="The forest floor beyond the trees"
						onchange={(hex) => patch({ forestFloor: hex })}
					/>
				</div>
				<div class="row colours">
					<span class="lbl">
						Riverbed
						<InfoTip>The riverbed's sands under the water, one picked per cell.</InfoTip>
					</span>
					{#each current.riverbed as sand, i (i)}
						<ColorField
							value={sand}
							{disabled}
							title="Sand {i + 1}"
							onchange={(hex) =>
								patch({ riverbed: current.riverbed.map((c, k) => (k === i ? hex : c)) })}
						/>
					{/each}
					{#if current.riverbed.length > B.riverbed[0]}
						<IconButton
							icon="trash"
							label="Drop the last sand"
							{disabled}
							onclick={() => patch({ riverbed: current.riverbed.slice(0, -1) })}
						/>
					{/if}
					{#if current.riverbed.length < B.riverbed[1]}
						<button
							type="button"
							{disabled}
							onclick={() =>
								patch({ riverbed: [...current.riverbed, current.riverbed.at(-1) ?? '#b89968'] })}
							>+ sand</button
						>
					{/if}
				</div>
				<LevelParamField
					label="Lone trees"
					help="A grass cell's chance of a tree of its own."
					value={authoredKind.treeChance}
					fallback={SALMONS_BIOME_LOOK.treeChance}
					limit={B.treeChance}
					step={0.01}
					{disabled}
					onset={(v) => patch({ treeChance: v })}
				/>
				<LevelParamField
					label="Grass (cells)"
					help="Cells of grass past the water before the forest."
					value={authoredKind.grass}
					fallback={SALMONS_BIOME_LOOK.grass}
					limit={B.grass}
					step={1}
					whole
					{disabled}
					onset={(v) => patch({ grass: v })}
				/>
				<LevelParamField
					label="Forest (cells)"
					help="How deep the wall of trees past the grass is."
					value={authoredKind.forest}
					fallback={SALMONS_BIOME_LOOK.forest}
					limit={B.forest}
					step={1}
					whole
					{disabled}
					onset={(v) => patch({ forest: v })}
				/>
				<div class="rule"></div>
				<LevelParamField
					label="Rocks ×"
					help="Rocks over this stretch, as a multiple of the generator's own density."
					value={authoredKind.rocks}
					fallback={SALMONS_BIOME_PLAY.rocks}
					limit={B.rocks}
					step={0.05}
					{disabled}
					onset={(v) => patch({ rocks: v })}
				/>
				<LevelParamField
					label="Whirlpools ×"
					help="Whirlpools over this stretch, as a multiple of the generator's own."
					value={authoredKind.whirlpools}
					fallback={SALMONS_BIOME_PLAY.whirlpools}
					limit={B.whirlpools}
					step={0.05}
					{disabled}
					onset={(v) => patch({ whirlpools: v })}
				/>
				<LevelParamField
					label="Sand ×"
					help="Sand seeded over this stretch of the delta, as a multiple of the generator's own."
					value={authoredKind.sand}
					fallback={SALMONS_BIOME_PLAY.sand}
					limit={B.sand}
					step={0.05}
					{disabled}
					onset={(v) => patch({ sand: v })}
				/>
				<LevelParamField
					label="Waterfalls kept"
					help="The share of this stretch's waterfalls it keeps, spread evenly; 1 keeps every one."
					value={authoredKind.waterfalls}
					fallback={SALMONS_BIOME_PLAY.waterfalls}
					limit={B.waterfalls}
					step={0.05}
					{disabled}
					onset={(v) => patch({ waterfalls: v })}
				/>
				<label class="tick">
					<input
						type="checkbox"
						checked={current.bridges}
						{disabled}
						onchange={(e) => patch({ bridges: e.currentTarget.checked ? undefined : false })}
					/>
					Bridges may cross it
				</label>
			</div>
		{/if}
	{/if}
</SectionCard>

<style>
	.tick,
	.row,
	.kinds,
	.ends,
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
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		margin: 4px 0;
		font-size: 12px;
	}
	.spacer {
		flex: 1;
	}
	.lbl {
		display: inline-flex;
		align-items: center;
		gap: 2px;
		color: #b8b8c4;
	}
	input[type='number'] {
		width: 5.5em;
	}
	.strip {
		position: relative;
		height: 52px;
		margin: 6px 0 2px;
		border: 1px solid #2e2e3a;
		border-radius: 6px;
		overflow: hidden;
		background: #0b0b10;
		touch-action: none;
	}
	.stretch {
		position: absolute;
		top: 0;
		bottom: 0;
		display: flex;
		flex-direction: column;
		padding: 0;
		border: none;
		border-right: 1px solid rgb(0 0 0 / 0.35);
		cursor: pointer;
		overflow: hidden;
	}
	.stretch.picked {
		outline: 2px solid #7ee0c0;
		outline-offset: -2px;
		z-index: 1;
	}
	.band {
		flex: 1;
	}
	.chip {
		position: absolute;
		left: 3px;
		top: 50%;
		transform: translateY(-50%);
		max-width: calc(100% - 6px);
		padding: 1px 5px;
		border-radius: 8px;
		box-shadow: 0 0 0 1px rgb(255 255 255 / 0.35);
		font-size: 10px;
		font-weight: 600;
		line-height: 14px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.handle {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 10px;
		margin-left: -5px;
		z-index: 2;
		cursor: ew-resize;
		background: linear-gradient(
			to right,
			transparent 4px,
			#f0f0f4 4px,
			#f0f0f4 6px,
			transparent 6px
		);
	}
	.handle:focus-visible {
		outline: 1px solid #7ee0c0;
	}
	.mark {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 0;
		border-left: 1px dashed rgb(255 236 180 / 0.8);
		pointer-events: none;
	}
	.ends {
		position: relative;
		display: flex;
		justify-content: space-between;
		font-size: 10px;
		opacity: 0.6;
	}
	.ends .at {
		position: absolute;
		transform: translateX(-50%);
	}
	.kinds {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
	}
	.kinds li {
		display: flex;
		align-items: center;
		gap: 2px;
		border-radius: 6px;
		padding: 1px 2px;
	}
	.kinds li.on {
		background: #1a1a22;
	}
	.pick {
		flex: 1;
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 3px 4px;
		border: none;
		background: none;
		color: inherit;
		font: inherit;
		font-size: 12px;
		text-align: left;
		cursor: pointer;
	}
	.swatch {
		display: inline-flex;
		flex-direction: column;
		width: 22px;
		height: 16px;
		border-radius: 3px;
		overflow: hidden;
		box-shadow: 0 0 0 1px #2e2e3a;
	}
	.swatch span {
		flex: 1;
	}
	.kname {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.kid {
		opacity: 0.5;
		font-size: 10px;
	}
	.kind-edit {
		margin: 6px 0 0;
		padding: 4px 6px;
		border: 1px solid #23232d;
		border-radius: 8px;
		background: #0d0d13;
	}
	.tree {
		display: inline-flex;
		align-items: center;
		gap: 1px;
	}
	.tree input {
		margin: 0 1px 0 0;
	}
	.colours {
		gap: 8px;
	}
	.rule {
		height: 1px;
		margin: 6px 0;
		background: #1d1d26;
	}
	.note {
		margin: 2px 0;
		opacity: 0.75;
		font-size: 0.9em;
	}
</style>
