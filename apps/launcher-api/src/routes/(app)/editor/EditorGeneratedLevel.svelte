<script lang="ts">
	import type { Scene } from 'engine-layout';
	import {
		LEVELS_RIVER_DEFAULTS,
		LEVELS_SHAPE_LIMITS,
		LEVEL_OVERLAY_KINDS,
		type ShapedLevels as ArcadeOnlineLevels,
		type LevelOverlayKind,
		type LevelsRiver,
		type LevelsWaterfalls,
	} from 'game-config';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import { untrack } from 'svelte';
	import {
		MAX_SEED,
		addPiece,
		canGenerate,
		dropEntry,
		loadConfig,
		regenerate,
		removeGenerated,
		saveLevels,
		setRiver,
		setWaterfalls,
		togglePinned,
		validSeed,
		type GeneratedNode,
		type LevelOrphan,
		type LoadedConfig,
		type OverlayScope,
	} from '$lib/editor/generatedLevel';

	/**
	 * A screen's GENERATED LEVEL (`docs/design/salmons-levels.md` §2 c–d): pick a seed and the stage
	 * shows the level a room plays for it, made by the room's own generator with the config's
	 * overlays on top. The level itself is read-only; additions and removals are stored in the
	 * project's Game Config (`arcade.online.levels`), apart from it, and a new seed never clears them.
	 */
	type Props = {
		scene: Scene;
		node: GeneratedNode;
		projectKey: string;
		/** The node was redrawn: an edit of the screen (its seed and drawing are saved with it). */
		onChange: () => void;
	};
	const { scene, node, projectKey, onChange }: Props = $props();

	let config = $state<LoadedConfig | undefined>(undefined);
	let levels = $state<ArcadeOnlineLevels | undefined>(undefined);
	let status = $state('');
	let error = $state('');
	let dirty = $state(false);
	let orphans = $state<LevelOrphan[]>([]);
	let seedText = $state<number | null>(null);
	let scope = $state<OverlayScope>('');
	let kind = $state<LevelOverlayKind>('rock');
	let gx = $state(0);
	let gy = $state(0);
	let height = $state(1);

	const usable = $derived(canGenerate(node));
	const seed = $derived(node.generated.seed);
	const loaded = $derived(config !== undefined);
	const pinned = $derived(levels?.seeds ?? []);
	const overlay = $derived(levels?.overlays?.[scope]);

	// Follow the node's seed (an undo, another screen's node): the field and the overlay shown.
	$effect.pre(() => {
		const current = seed;
		untrack(() => {
			seedText = current;
			if (scope !== '*') scope = String(current);
		});
	});

	/** Redraw the node as `next` makes it; an edit only when the drawing changed. */
	function show(next: number): void {
		if (!validSeed(next) || !usable) return;
		const before = JSON.stringify([node.generated, node.children]);
		orphans = regenerate(scene, node, next, levels);
		if (JSON.stringify([node.generated, node.children]) !== before) onChange();
	}

	async function load(): Promise<void> {
		error = '';
		try {
			config = await loadConfig(projectKey);
			levels = config.levels;
			show(seed);
		} catch (e) {
			error = `Could not read the config's levels: ${e instanceof Error ? e.message : String(e)}`;
		}
	}
	$effect(() => {
		if (projectKey && usable && !untrack(() => loaded)) void load();
	});

	function step(by: number): void {
		const list = pinned;
		if (!list.length) return;
		const at = list.indexOf(seed);
		show(at < 0 ? list[by > 0 ? 0 : list.length - 1] : list[(at + by + list.length) % list.length]);
	}

	function edit(next: ArcadeOnlineLevels): void {
		levels = next;
		dirty = true;
		status = '';
		show(seed);
	}

	async function save(): Promise<void> {
		if (!config) return;
		error = '';
		status = 'Saving…';
		try {
			config = await saveLevels(projectKey, config, levels ?? {});
			levels = config.levels;
			dirty = false;
			status = 'Saved to the Game Config';
		} catch (e) {
			status = '';
			error = e instanceof Error ? e.message : String(e);
		}
	}

	const L = LEVELS_SHAPE_LIMITS;
	const river = $derived(levels?.river);
	const falls = $derived(levels?.waterfalls);
	/** A typed number as a setting, held to its limits (and whole, for a count or a height) and
	 *  written back to the field, so the field never shows a value the level does not play.
	 *  Nothing typed leaves the setting out (its default plays). */
	const typed = (e: Event, [least, most]: readonly [number, number], whole = false) => {
		const field = e.currentTarget as HTMLInputElement;
		if (field.value === '' || Number.isNaN(Number(field.value))) {
			field.value = '';
			return undefined;
		}
		const held = Math.min(most, Math.max(least, Number(field.value)));
		const value = whole ? Math.round(held) : held;
		field.value = String(value);
		return value;
	};
	const editRiver = (patch: LevelsRiver) => edit(setRiver(levels, { ...river, ...patch }));
	const editFalls = (patch: LevelsWaterfalls) =>
		edit(setWaterfalls(levels, { ...falls, ...patch }));
	/** A waterfall's cliff as drawn, px, for a height in cells (`engine-layout` `salmonsElevation`). */
	const cliffPx = (cells: number) => (32 + 16 * cells) * 1.5;

	const scopeLabel = (s: string) => (s === '*' ? 'every level' : `seed ${s}`);
	const cellText = (c: [number, number]) => `${c[0]}, ${c[1]}`;
</script>

<SectionCard scope="editor" id="generated-level" title="Generated level">
	{#snippet info()}
		This screen's {node.generated.generator} level is made from a seed by the same generator a room runs,
		so the stage shows exactly the level a room with that seed plays. It is read-only: what you add or
		remove goes in the Game Config's level overlays, laid on top of the generated level in every room
		and here, and kept when you pick another seed. Cells are the generator's grid: gx down the river from
		the source, gy across it. A waterfall is a whole column: removing, re-heighting or adding one acts
		on the column of its cell. A seed's own removals cannot take away an every-level addition. The river's
		shape and its waterfalls are settings of every level, saved with the overlays.
	{/snippet}
	{#if !usable}
		<p class="warn">No generator called "{node.generated.generator}" is known to the editor.</p>
	{:else}
		<div class="row">
			<label>
				Seed
				<input
					type="number"
					min="0"
					max={MAX_SEED}
					step="1"
					bind:value={seedText}
					onchange={() => {
						if (seedText !== null) show(seedText);
					}}
				/>
			</label>
			<button
				type="button"
				title="A new random seed"
				onclick={() => show(Math.floor(Math.random() * 0x7fffffff))}>⟳</button
			>
			<button
				type="button"
				title="Previous pinned seed"
				disabled={!pinned.length}
				onclick={() => step(-1)}>◀</button
			>
			<button
				type="button"
				title="Next pinned seed"
				disabled={!pinned.length}
				onclick={() => step(1)}>▶</button
			>
			<label class="check">
				<input
					type="checkbox"
					checked={pinned.includes(seed)}
					disabled={!loaded}
					onchange={() => edit(togglePinned(levels, seed))}
				/>
				Pinned
				<InfoTip>
					Pinned seeds are the levels rooms play, each new room taking the next. With none pinned,
					every room gets a new random level, as the original game did.
				</InfoTip>
			</label>
		</div>
		<p class="note">
			{pinned.length
				? `${pinned.length} pinned: ${pinned.join(', ')}`
				: 'No seed pinned: a random level per room'}
		</p>

		<div class="row">
			<label class="check">
				<input
					type="checkbox"
					checked={!!river}
					disabled={!loaded}
					onchange={(e) => edit(setRiver(levels, e.currentTarget.checked ? {} : undefined))}
				/>
				Winding river
				<InfoTip>
					Off: the generator's own river, a gentle meander that always runs the same way across the
					screen. On: the river bends from side to side, so some reaches run the other way across
					the screen, with a straight run at the source, each side of a waterfall and through the
					delta. It applies to every level, in every room, once the config is published; a config
					saved without it keeps the river it has.
				</InfoTip>
			</label>
		</div>
		{#if river}
			<div class="row">
				<label>
					Winding
					<InfoTip>
						The share of reaches that bend, {L.winding[0]} to {L.winding[1]}; the others run nearly
						straight. Default {LEVELS_RIVER_DEFAULTS.winding}.
					</InfoTip>
					<input
						type="number"
						min={L.winding[0]}
						max={L.winding[1]}
						step="0.05"
						placeholder={String(LEVELS_RIVER_DEFAULTS.winding)}
						value={river.winding ?? ''}
						onchange={(e) => editRiver({ winding: typed(e, L.winding) })}
					/>
				</label>
				<label>
					Sharpest turn (°)
					<InfoTip>
						The most a bend turns the river, {L.sharpestTurn[0]} to {L.sharpestTurn[1]} degrees. Past
						90 the reaches either side of a bend run opposite ways across the screen. Default
						{LEVELS_RIVER_DEFAULTS.sharpestTurn}.
					</InfoTip>
					<input
						type="number"
						min={L.sharpestTurn[0]}
						max={L.sharpestTurn[1]}
						step="5"
						placeholder={String(LEVELS_RIVER_DEFAULTS.sharpestTurn)}
						value={river.sharpestTurn ?? ''}
						onchange={(e) => editRiver({ sharpestTurn: typed(e, L.sharpestTurn) })}
					/>
				</label>
				<label>
					Towards the source
					<InfoTip>
						How much of the sharpness is kept for the source, {L.sourceBias[0]} to {L
							.sourceBias[1]}. 0: bends are as sharp all the way down. 1: the sharp bends are round
						the source and the river straightens towards the sea. Default {LEVELS_RIVER_DEFAULTS.sourceBias}.
					</InfoTip>
					<input
						type="number"
						min={L.sourceBias[0]}
						max={L.sourceBias[1]}
						step="0.05"
						placeholder={String(LEVELS_RIVER_DEFAULTS.sourceBias)}
						value={river.sourceBias ?? ''}
						onchange={(e) => editRiver({ sourceBias: typed(e, L.sourceBias) })}
					/>
				</label>
			</div>
		{/if}
		<div class="row">
			<label>
				Waterfalls
				<InfoTip>
					How many waterfalls a level has, {L.waterfallCount[0]} to {L.waterfallCount[1]}, spread
					evenly above the delta. Empty: the generator's own six.
				</InfoTip>
				<input
					type="number"
					min={L.waterfallCount[0]}
					max={L.waterfallCount[1]}
					step="1"
					placeholder="6"
					disabled={!loaded}
					value={falls?.count ?? ''}
					onchange={(e) => editFalls({ count: typed(e, L.waterfallCount, true) })}
				/>
			</label>
			<label>
				Lowest (cells)
				<InfoTip>
					Every waterfall is a whole number of cells high between Lowest and Highest,
					{L.waterfallHeight[0]} to {L.waterfallHeight[1]}; a salmon climbs it a tap at a time. A
					waterfall of 1 is a {cliffPx(1)} px cliff, of 8 {cliffPx(8)} px, of 16 {cliffPx(16)} px. Both
					empty: the generator's own heights, 1 to 8 and lowest towards the sea.
				</InfoTip>
				<input
					type="number"
					min={L.waterfallHeight[0]}
					max={L.waterfallHeight[1]}
					step="1"
					disabled={!loaded}
					value={falls?.heightMin ?? ''}
					onchange={(e) => editFalls({ heightMin: typed(e, L.waterfallHeight, true) })}
				/>
			</label>
			<label>
				Highest (cells)
				<input
					type="number"
					min={L.waterfallHeight[0]}
					max={L.waterfallHeight[1]}
					step="1"
					disabled={!loaded}
					value={falls?.heightMax ?? ''}
					onchange={(e) => editFalls({ heightMax: typed(e, L.waterfallHeight, true) })}
				/>
			</label>
		</div>
		{#if falls?.heightMin !== undefined && falls.heightMax !== undefined && falls.heightMin > falls.heightMax}
			<p class="warn">
				Lowest is above Highest: a level plays them the other way round, {falls.heightMax} to
				{falls.heightMin} cells.
			</p>
		{/if}

		<div class="row">
			<label>
				Overlay
				<select bind:value={scope}>
					<option value={String(seed)}>this seed ({seed})</option>
					<option value="*">every level</option>
				</select>
			</label>
		</div>
		{#if overlay}
			<ul class="entries">
				{#each overlay.add ?? [] as a, i (i)}
					<li>
						<span>+ {a.kind} at {cellText(a.cell)}{a.height ? ` (height ${a.height})` : ''}</span>
						<IconButton
							icon="trash"
							label="Drop this addition"
							danger
							onclick={() => edit(dropEntry(levels, scope, 'add', i))}
						/>
					</li>
				{/each}
				{#each overlay.remove ?? [] as c, i (i)}
					<li>
						<span>− generated piece at {cellText(c)}</span>
						<IconButton
							icon="trash"
							label="Drop this removal"
							danger
							onclick={() => edit(dropEntry(levels, scope, 'remove', i))}
						/>
					</li>
				{/each}
				{#each overlay.set ?? [] as s, i (i)}
					<li>
						<span>waterfall at {cellText(s.cell)} height {s.height}</span>
						<IconButton
							icon="trash"
							label="Drop this change"
							danger
							onclick={() => edit(dropEntry(levels, scope, 'set', i))}
						/>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="note">Nothing authored for {scopeLabel(scope)}.</p>
		{/if}
		<div class="row">
			<label>gx <input type="number" step="1" bind:value={gx} /></label>
			<label>gy <input type="number" step="1" bind:value={gy} /></label>
			<select bind:value={kind} aria-label="Piece">
				{#each LEVEL_OVERLAY_KINDS as k (k)}<option value={k}>{k}</option>{/each}
			</select>
			{#if kind === 'waterfall'}
				<label>height <input type="number" min="1" step="1" bind:value={height} /></label>
			{/if}
		</div>
		<div class="row">
			<button
				type="button"
				disabled={!loaded}
				onclick={() => edit(addPiece(levels, scope, kind, [gx, gy], height))}>Add piece</button
			>
			<button
				type="button"
				disabled={!loaded}
				onclick={() => edit(removeGenerated(levels, scope, [gx, gy]))}
				>Remove generated piece</button
			>
			<button type="button" class="primary" disabled={!loaded || !dirty} onclick={save}
				>Save levels</button
			>
		</div>
		{#if orphans.length}
			<p class="warn">
				{orphans.length} authored {orphans.length === 1 ? 'entry has' : 'entries have'} no place in this
				level (kept, not applied): {orphans
					.map((o) => `${o.op} ${o.kind ?? ''} ${cellText(o.cell)}`.replace(/\s+/g, ' '))
					.join('; ')}
			</p>
		{/if}
		{#if status}<p class="note">{status}</p>{/if}
		{#if error}<p class="warn">{error}</p>{/if}
	{/if}
</SectionCard>

<style>
	.row {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		align-items: center;
		margin: 4px 0;
	}
	input[type='number'] {
		width: 7em;
	}
	.check {
		display: inline-flex;
		gap: 4px;
		align-items: center;
	}
	.entries {
		list-style: none;
		margin: 4px 0;
		padding: 0;
	}
	.entries li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 6px;
	}
	.note {
		margin: 2px 0;
		opacity: 0.75;
		font-size: 0.9em;
	}
	.warn {
		margin: 2px 0;
		color: #f0c878;
		font-size: 0.9em;
	}
	.primary {
		font-weight: 600;
	}
</style>
