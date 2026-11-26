<script lang="ts">
	import type { Scene } from 'engine-layout';
	import {
		LEVEL_OVERLAY_KINDS,
		type ShapedLevels as ArcadeOnlineLevels,
		type LevelOverlayKind,
	} from 'game-config';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import { onDestroy, untrack } from 'svelte';
	import {
		addPiece,
		canGenerate,
		dropEntry,
		loadConfig,
		orphanText,
		regenerate,
		removeGenerated,
		saveLevels,
		togglePinned,
		type GeneratedNode,
		type LevelOrphan,
		type LoadedConfig,
		type OverlayScope,
	} from '$lib/editor/generatedLevel';
	import { MAX_SEED, validSeed } from '$lib/editor/generatedLevelCore';
	import EditorLevelBiomes from './EditorLevelBiomes.svelte';
	import EditorLevelGenerator from './EditorLevelGenerator.svelte';

	/**
	 * A screen's GENERATED LEVEL (`docs/design/salmons-levels.md` §2 c–d): pick a seed and the stage
	 * shows the level a room plays for it, made by the room's own generator with the config's
	 * overlays on top. The level itself is read-only; additions and removals are stored in the
	 * project's Game Config (`arcade.online.levels`), apart from it, and a new seed never clears them.
	 * Below it, every setting of the generator (`EditorLevelGenerator.svelte`) and the biomes
	 * (`EditorLevelBiomes.svelte`), saved with the overlays.
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

	let redraw = 0;
	onDestroy(() => cancelAnimationFrame(redraw));
	/** Take `next` and redraw the stage with it once a frame at most (a slider sends many). */
	function edit(next: ArcadeOnlineLevels): void {
		levels = next;
		dirty = true;
		status = '';
		if (redraw) return;
		redraw = requestAnimationFrame(() => {
			redraw = 0;
			show(seed);
		});
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
		on the column of its cell. A seed's own removals cannot take away an every-level addition. The cards
		below set every number the generator reads and the biomes along the river, for every level, and are
		saved with the overlays.
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
				level (kept, not applied): {orphans.map(orphanText).join('; ')}
			</p>
		{/if}
		{#if status}<p class="note">{status}</p>{/if}
		{#if error}<p class="warn">{error}</p>{/if}
	{/if}
</SectionCard>

{#if usable && loaded}
	<EditorLevelGenerator {levels} disabled={!loaded} onEdit={edit} />
	<EditorLevelBiomes {levels} {seed} disabled={!loaded} onEdit={edit} />
{/if}

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
