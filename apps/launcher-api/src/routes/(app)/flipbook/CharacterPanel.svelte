<script lang="ts">
	/**
	 * One character of Invisible Flipbook's Characters mode: the clips it needs, what is misnamed
	 * or broken, the clips a sheet would make, its one Bounds box and its directions.
	 *
	 * Everything shown is decided in `$lib/flipbook/characterSet.ts` over the game's own rule; this
	 * file lays it out and sends the writes (`characterWrites.ts`: ordinary clip saves, each
	 * conditional). Mounted per character (`{#key}` in `CharacterMode`), so picking another one
	 * starts every choice here afresh.
	 */
	import { untrack } from 'svelte';
	import CanvasModeBar from '$lib/CanvasModeBar.svelte';
	import CharacterClipsGrid, { drawsWrongly } from '$lib/flipbook/CharacterClipsGrid.svelte';
	import CharacterDirections from '$lib/flipbook/CharacterDirections.svelte';
	import {
		boundsDiffer,
		characterBounds,
		characterClipNames,
		characterGrid,
		characterProblems,
		defaultStateSettings,
		detectClipRuns,
		feetOf,
		gridCounts,
		hasMarkedClips,
		lookedForClipIds,
		planCharacterClips,
		plannedClip,
		strayClips,
		type BoundsField,
		type ClipProblem,
		type NearWhy,
		type PlanRow,
		type StateSettings,
		type StrayClip,
	} from '$lib/flipbook/characterSet';
	import {
		applyBoundsToClips,
		copyClipAs,
		createClips,
		fetchClipWrites,
		type CharacterWritten,
		type ClipLease,
		type ClipWriteResult,
		type ClipWrites,
	} from '$lib/flipbook/characterWrites';
	import type { ProjectCharacter } from '$lib/flipbook/projectCharacters';
	import { leaseOnce } from '$lib/flipbook/leaseOnce';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import {
		clipSheetKeys,
		fitClipBounds,
		parseFrameRef,
		type FlipbookBounds,
		type FlipbookClip,
		type FlipbookFrameBox,
	} from 'engine-flipbook';
	import type { CharacterClips } from 'engine-layout';
	import { fetchRegions, type RegionSet } from '../editor/editorRegions.client';
	import RegionThumb from '../editor/RegionThumb.svelte';

	interface Props {
		clientKey: string;
		projectKey: string;
		character: ProjectCharacter;
		/** The project's other characters' blocks. */
		others: CharacterClips[];
		/** Every clip id of the project. */
		clipIds: string[];
		/** The clips under a character's prefix, in full. */
		clips: FlipbookClip[];
		atlases: { manifestKey: string; label: string; regions: string[] }[];
		/** The clip open in Clips mode ('' for none), whether it has edits not yet saved, and who
		 *  else holds its lease. */
		openClip: () => { id: string; dirty: boolean; heldBy: string | null };
		onWritten: (written: CharacterWritten) => Promise<void>;
		onOpen: (id: string) => void;
	}
	let {
		clientKey,
		projectKey,
		character,
		others,
		clipIds,
		clips,
		atlases,
		openClip,
		onWritten,
		onOpen,
	}: Props = $props();

	const look = $derived(character.look);
	const clipById = $derived(Object.fromEntries(clips.map((c) => [c.id, c])));
	const have = $derived(new Set(clipIds));

	// --- the grid -------------------------------------------------------------------------------
	let marked = $state(false);
	const grid = $derived(characterGrid(look, clipIds, marked));
	const counts = $derived(gridCounts(grid));

	// --- misnamed and broken --------------------------------------------------------------------
	const names = $derived(characterClipNames(look));
	const strays = $derived(strayClips(look, clipIds, others));
	const misnamed = $derived(strays.filter((s) => s.kind === 'misnamed'));
	const standInOnly = $derived(strays.filter((s) => s.kind === 'standInOnly'));

	const WHY: Record<NearWhy, string> = {
		spelling: 'case or separators',
		suffix: 'something after the name',
		facing: 'the facing is spelt out',
		typo: 'a letter or two off',
		guess: 'no name is close',
	};

	let targets = $state<Record<string, string>>({});
	const targetOf = (stray: StrayClip): string => targets[stray.id] ?? stray.nearest ?? '';
	let copying = $state('');
	let copied = $state<Record<string, ClipWriteResult>>({});

	async function copy(stray: StrayClip): Promise<void> {
		const name = targetOf(stray);
		if (!name || copying) return;
		copying = stray.id;
		try {
			const result = await copyClipAs(stray.id, name, io);
			copied = { ...copied, [stray.id]: result };
			if (result.outcome === 'created')
				await onWritten({
					created: [{ id: name, name, frames: clipById[stray.id]?.frames.length ?? 0 }],
					updated: [],
				});
		} finally {
			copying = '';
		}
	}

	// --- the character's box --------------------------------------------------------------------
	const lookedFor = $derived(lookedForClipIds(look));
	/** The clips the game can play for this character: the ones its box goes on. */
	const played = $derived(clips.filter((c) => lookedFor.has(c.id)));
	const boxes = $derived(characterBounds(played));
	/** The author's own choice; until there is one, the box most clips carry. */
	let chosen = $state<FlipbookBounds | undefined>(undefined);
	const box = $derived(chosen ?? boxes.reference);
	let previewBox = $state(false);
	const problems = $derived(characterProblems(look, clips, box));
	const toBox = $derived(
		box ? played.filter((c) => !c.bounds || boundsDiffer(c.bounds, box).length > 0) : [],
	);

	const round = (n: number): number => Math.round(n * 100) / 100;
	function choose(b: FlipbookBounds): void {
		chosen = {
			x: round(b.x),
			y: round(b.y),
			w: round(Math.max(1, b.w)),
			h: round(Math.max(1, b.h)),
		};
	}
	function setField(field: BoundsField, value: number): void {
		const from = box ?? { x: 0, y: 0, w: 1, h: 1 };
		choose({ ...from, [field]: value });
	}
	const boxIndex = $derived(
		box ? boxes.boxes.findIndex((b) => boundsDiffer(b.bounds, box).length === 0) : -1,
	);
	const boxLabel = (b: FlipbookBounds): string => `${b.w} × ${b.h} at ${b.x}, ${b.y}`;

	const frameBox = (r: RegionSet['regions'][number]): FlipbookFrameBox => ({
		origW: r.origW ?? r.w,
		origH: r.origH ?? r.h,
		offX: r.offX ?? 0,
		offY: r.offY ?? 0,
		artW: r.w,
		artH: r.h,
	});

	let fitting = $state(false);
	let fitNote = $state('');
	/** A box that just holds every frame of every clip of the character: a place to start from. */
	async function fitEveryFrame(): Promise<void> {
		fitting = true;
		fitNote = '';
		try {
			const keys = [...new Set(played.flatMap((c) => clipSheetKeys(c)))];
			const sets = new Map(
				await Promise.all(keys.map(async (key) => [key, await fetchRegions(key)] as const)),
			);
			const all: FlipbookFrameBox[] = [];
			for (const clip of played)
				for (const entry of clip.frames) {
					const ref = parseFrameRef(entry);
					const record = sets
						.get(ref.assetKey ?? clip.assetKey)
						?.regions.find((r) => r.name === ref.region);
					if (record) all.push(frameBox(record));
				}
			const fit = fitClipBounds(all);
			if (fit) choose(fit);
			else fitNote = 'No frame of its clips could be read.';
		} finally {
			fitting = false;
		}
	}

	let applying = $state(false);
	let applyDone = $state(0);
	let applied = $state<ClipWriteResult[]>([]);
	async function applyBox(): Promise<void> {
		if (!box || applying) return;
		const ids = toBox.map((c) => c.id);
		applying = true;
		applyDone = 0;
		applied = [];
		try {
			applied = await applyBoundsToClips(ids, box, io, {
				leaveAlone: (id) => {
					const open = openClip();
					return open.id === id && open.dirty
						? 'It is open in Clips with changes not saved yet. Save or discard them first.'
						: undefined;
				},
				step: (done) => (applyDone = done),
			});
		} finally {
			applying = false;
		}
		await onWritten({
			created: [],
			updated: applied.filter((r) => r.outcome === 'updated').map((r) => r.id),
		});
	}

	// --- make clips from a sheet ----------------------------------------------------------------
	let sheet = $state('');
	const runs = $derived(
		detectClipRuns(
			atlases
				.filter((a) => !sheet || a.manifestKey === sheet)
				.map((a) => ({ assetKey: a.manifestKey, regions: a.regions })),
		),
	);
	const plan = $derived(planCharacterClips(look, runs, clipIds, others));
	let settings = $state<Record<string, StateSettings>>(
		untrack(() => defaultStateSettings(character.look)),
	);
	const settingsOf = (state: string): StateSettings =>
		settings[state] ?? defaultStateSettings(look)[state];
	function setSetting(state: string, change: Partial<StateSettings>): void {
		settings = { ...settings, [state]: { ...settingsOf(state), ...change } };
	}

	const rowKey = (row: PlanRow): string => `${row.name}|${row.run.primary}|${row.run.frames[0]}`;
	/** Only a run named exactly is ticked for the author. A misspelt run and a still are a reading
	 *  of the name, and a clip made here is drawn in the game at the next publish. */
	let ticks = $state<Record<string, boolean>>({});
	const ticked = (row: PlanRow): boolean => ticks[rowKey(row)] ?? row.match === 'exact';
	const toMake = $derived(plan.rows.filter((r) => r.action === 'create' && ticked(r)));
	const sheetLabel = (key: string): string =>
		atlases.find((a) => a.manifestKey === key)?.label ?? key.split('/').pop() ?? key;

	let regionSets = $state<Record<string, RegionSet>>({});
	$effect(() => {
		for (const { run } of plan.rows) {
			const key = run.primary;
			if (untrack(() => regionSets[key])) continue;
			void fetchRegions(key).then((set) => {
				if (set) regionSets = { ...regionSets, [key]: set };
			});
		}
	});
	function firstFrame(row: PlanRow) {
		const set = regionSets[row.run.primary];
		const region = set?.regions.find((r) => r.name === parseFrameRef(row.run.frames[0]).region);
		return set && region ? { set, region } : undefined;
	}

	let making = $state(false);
	let makeDone = $state(0);
	let made = $state<ClipWriteResult[]>([]);
	async function makeClips(): Promise<void> {
		if (making || !toMake.length) return;
		const rows = toMake;
		const docs = rows.map((row) => plannedClip(row, settingsOf(row.state), box));
		making = true;
		makeDone = 0;
		made = [];
		try {
			made = await createClips(docs, io, (done) => (makeDone = done));
		} finally {
			making = false;
		}
		const created = new Set(made.filter((r) => r.outcome === 'created').map((r) => r.id));
		await onWritten({
			created: docs
				.filter((c) => created.has(c.id))
				.map((c) => ({ id: c.id, name: c.name, frames: c.frames.length })),
			updated: [],
		});
	}

	// --- the writes -----------------------------------------------------------------------------
	/**
	 * A saved clip's edit lease, for one write. The clip open in Clips mode is already under this
	 * tab's own lease: it is neither taken again nor given back here. A lease that cannot be read
	 * leaves the write to its ETag, as everywhere.
	 */
	async function leaseClip(id: string): Promise<ClipLease> {
		const open = openClip();
		if (open.id === id)
			return open.heldBy ? { held: false, by: open.heldBy } : { held: true, release: () => {} };
		return leaseOnce({ toolId: 'flipbook', clientKey, projectKey, docKey: id });
	}
	const io: ClipWrites = {
		...fetchClipWrites(
			(input, init) => fetch(input, init),
			untrack(() => projectKey),
		),
		lease: leaseClip,
	};

	const OUTCOME: Record<ClipWriteResult['outcome'], string> = {
		created: 'made',
		exists: 'there already, left alone',
		updated: 'box set',
		unchanged: 'had it already',
		refused: 'not written',
	};
	const tally = (results: ClipWriteResult[]): string =>
		(Object.keys(OUTCOME) as ClipWriteResult['outcome'][])
			.map((outcome) => [outcome, results.filter((r) => r.outcome === outcome).length] as const)
			.filter(([, n]) => n > 0)
			.map(([outcome, n]) => `${n} ${OUTCOME[outcome]}`)
			.join(' · ');

	function problemText(p: ClipProblem): string {
		if (p.kind === 'noBounds')
			return 'No Bounds box: the game sizes it by its first frame, so its scale is its own.';
		if (p.kind === 'boundsDiffer') {
			const does = [
				p.differs.includes('w') ? 'it is drawn at another size' : '',
				p.differs.includes('y') || p.differs.includes('h')
					? 'its feet can sit on another line'
					: '',
				p.differs.includes('x') ? 'its centre can shift' : '',
			].filter(Boolean);
			return `Its box differs from the character's in ${p.differs.join(', ')}: ${does.join(', ')}.`;
		}
		if (p.kind === 'mirrorX')
			return (
				'Saved with Mirror X on a facing the game mirrors: in game it is mirrored where it ' +
				'should be as made, and as made where it should be mirrored.'
			);
		if (p.kind === 'savedAsLoop')
			return `Saved as a loop. The game plays ${p.state} once whatever the clip says; anywhere else the clip loops.`;
		return `Saved to play once. The game loops ${p.state} whatever the clip says; anywhere else the clip stops.`;
	}
</script>

{#snippet results(list: ClipWriteResult[])}
	{#if list.length}
		<div class="results" role="status" data-results>
			<p class="tally">{tally(list)}</p>
			<ul>
				{#each list.filter((r) => r.outcome !== 'created' && r.outcome !== 'updated') as r (r.id)}
					<li class={r.outcome}>
						<code>{r.id}</code>
						<span>{OUTCOME[r.outcome]}{r.note ? `: ${r.note}` : ''}</span>
					</li>
				{/each}
			</ul>
		</div>
	{/if}
{/snippet}

<div class="panel">
	<div class="cards">
		<SectionCard scope="flipbook" id="character-clips" title="Clips">
			{#snippet info()}
				<p>
					One cell per clip the game looks for, named <code>prefix_state_facing</code>. The first
					columns are the facings you draw; the game mirrors them for the others.
				</p>
				<p>
					✓ its own clip · ⇋ its twin, drawn mirrored · ≈ another clip stands in · — nothing plays.
					Click a cell to open its clip.
				</p>
			{/snippet}
			{#snippet actions()}
				{#if hasMarkedClips(look)}
					<CanvasModeBar
						inline
						options={[
							{ value: 'base', label: look.prefixes.base, title: 'An unmarked player' },
							{
								value: 'marked',
								label: look.prefixes.marked ?? '',
								title: 'A player the room marks: its own clips first, else the base ones',
							},
						]}
						value={marked ? 'marked' : 'base'}
						onChange={(v) => (marked = v === 'marked')}
						ariaLabel="Whose clips"
					/>
				{/if}
			{/snippet}
			<p class="status" class:warn={counts.empty > 0}>
				{counts.made} of {counts.needed} made{counts.empty
					? ` · ${counts.empty} cell${counts.empty === 1 ? '' : 's'} with nothing to play`
					: ''}
			</p>
			<CharacterClipsGrid {look} {grid} clips={clipById} {problems} {onOpen} />
		</SectionCard>

		<SectionCard scope="flipbook" id="character-problems" title="Misnamed and broken">
			{#snippet info()}
				<p>
					Clips under this character's prefix that the game never asks for, each with the nearest
					name it does. A clip's name is fixed at its first save, so the fix is a copy under the
					right name; deleting the old one is yours to do in Clips.
				</p>
				<p>
					Below them: saved clips that would draw the character wrongly (no Bounds box, a box unlike
					the character's, a saved Mirror X), and clips whose Loop is not what the game does with
					their state.
				</p>
			{/snippet}
			{#if !misnamed.length && !standInOnly.length && !problems.length}
				<p class="status">Nothing misnamed, nothing broken.</p>
			{/if}
			{#if misnamed.length}
				<ul class="rows" aria-label="Misnamed clips">
					{#each misnamed as stray (stray.id)}
						{@const target = targetOf(stray)}
						{@const result = copied[stray.id]}
						<li data-stray={stray.id}>
							<button class="link" title="Open in Clips" onclick={() => onOpen(stray.id)}>
								{stray.id}
							</button>
							<span class="chip bad">not a name the game looks for</span>
							{#if stray.why}<span class="hint">{WHY[stray.why]}</span>{/if}
							<span class="grow"></span>
							<select
								aria-label="The name to copy it under"
								value={target}
								onchange={(e) => (targets = { ...targets, [stray.id]: e.currentTarget.value })}
							>
								{#each names as name (name.id)}
									<option value={name.id}>{name.id}{have.has(name.id) ? ' (there)' : ''}</option>
								{/each}
							</select>
							<button
								disabled={!target || have.has(target) || !clipById[stray.id] || copying !== ''}
								title={have.has(target)
									? `${target} is there already`
									: `Save a copy of ${stray.id} as ${target}. ${stray.id} is left as it is.`}
								onclick={() => void copy(stray)}
							>
								{copying === stray.id ? 'Copying…' : '⧉ Save a copy'}
							</button>
							{#if result}
								<span class="res {result.outcome}">
									{OUTCOME[result.outcome]}{result.note ? `: ${result.note}` : ''}
								</span>
							{:else if have.has(target)}
								<span class="hint">{target} is there already</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{#if standInOnly.length}
				<ul class="rows" aria-label="Clips that only stand in">
					{#each standInOnly as stray (stray.id)}
						<li>
							<button class="link" title="Open in Clips" onclick={() => onOpen(stray.id)}>
								{stray.id}
							</button>
							<span class="chip">only a stand-in</span>
							<span class="hint">not one of its states: plays only when another has no clip</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if problems.length}
				<ul class="rows" aria-label="Broken clips">
					{#each problems as problem (`${problem.clipId}|${problem.kind}`)}
						<li data-problem={problem.kind}>
							<button class="link" title="Open in Clips" onclick={() => onOpen(problem.clipId)}>
								{problem.clipId}
							</button>
							<span class="chip" class:bad={drawsWrongly(problem)}>
								{drawsWrongly(problem) ? 'draws wrongly' : 'note'}
							</span>
							<span class="say">{problemText(problem)}</span>
						</li>
					{/each}
				</ul>
			{/if}
		</SectionCard>

		<SectionCard scope="flipbook" id="character-make" title="Make clips from a sheet">
			{#snippet info()}
				<p>
					Each run of numbered regions (<code>bear_walk_e_00</code>, <code>_01</code>, …) whose name
					is one of this character's becomes that clip. A run of one or two frames counts, and so
					does a single region with no number; a region named <code>prefix_facing</code> is that facing's
					still and makes its one-frame idle clip.
				</p>
				<p>
					A clip that is already there is never written over. A misspelt run and a still are offered
					unticked. New clips take the character's Bounds box when it has one.
				</p>
			{/snippet}
			<div class="controls">
				<label class="field">
					<span>Sheet</span>
					<select bind:value={sheet}>
						<option value="">All sheets</option>
						{#each atlases as atlas (atlas.manifestKey)}
							<option value={atlas.manifestKey}>{atlas.label}</option>
						{/each}
					</select>
				</label>
				{#each grid.rows as row (row.state)}
					{@const s = settingsOf(row.state)}
					<span class="state">
						<b>{row.state}</b>
						<label class="field">
							<span>fps</span>
							<input
								class="num"
								type="number"
								min="1"
								max="120"
								value={s.fps}
								aria-label="{row.state} frames per second"
								onchange={(e) => {
									const v = e.currentTarget.valueAsNumber;
									if (Number.isFinite(v) && v > 0) setSetting(row.state, { fps: v });
								}}
							/>
						</label>
						<label class="check">
							<input
								type="checkbox"
								checked={s.loop}
								onchange={(e) => setSetting(row.state, { loop: e.currentTarget.checked })}
							/>
							<span>Loop</span>
						</label>
						{#if s.loop !== row.loop}
							<InfoTip>
								The game {row.loop ? 'loops' : 'plays'}
								{row.state}{row.loop ? '' : ' once'} whatever the clip says. This only sets how the clip
								plays in Clips mode and anywhere else it is used.
							</InfoTip>
						{/if}
					</span>
				{/each}
			</div>
			{#if plan.rows.length}
				<div class="scroll">
					<table class="plan">
						<thead>
							<tr>
								<th></th>
								<th>Run</th>
								<th>Clip</th>
								<th>Plays</th>
								<th></th>
							</tr>
						</thead>
						<tbody>
							{#each plan.rows as row (rowKey(row))}
								{@const first = firstFrame(row)}
								{@const s = settingsOf(row.state)}
								<tr class={row.action} data-plan={row.name} data-action={row.action}>
									<td>
										<input
											type="checkbox"
											aria-label="Make {row.name}"
											disabled={row.action !== 'create' || making}
											checked={row.action === 'create' && ticked(row)}
											onchange={(e) =>
												(ticks = { ...ticks, [rowKey(row)]: e.currentTarget.checked })}
										/>
									</td>
									<td class="run">
										<span class="thumb">
											{#if first}<RegionThumb
													set={first.set}
													region={first.region}
													size={32}
												/>{/if}
										</span>
										<span>
											<code>{row.run.stem}</code>
											<span class="hint">
												{row.run.frames.length} frame{row.run.frames.length === 1 ? '' : 's'} · {row.run.sheets
													.map(sheetLabel)
													.join(' + ')}
											</span>
										</span>
									</td>
									<td>
										<code>{row.name}</code>
										{#if row.match === 'still'}<span class="chip">still</span>{/if}
										{#if row.match === 'near'}
											<span class="chip warn" title={row.why ? WHY[row.why] : ''}>misspelt</span>
										{/if}
									</td>
									<td class="hint">{s.fps} fps · {s.loop ? 'loop' : 'once'}</td>
									<td>
										{#if row.action === 'exists'}
											<span class="chip">there already, left alone</span>
										{:else if row.action === 'duplicate'}
											<span
												class="chip warn"
												title="A longer or better-named run above already makes this clip. A gap in the numbering splits an animation in two."
											>
												another run makes it
											</span>
										{:else}
											<span class="chip good">will be made</span>
										{/if}
									</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="status">
					No run in {sheet ? 'this sheet' : "this project's sheets"} is named after one of this character's
					clips.
				</p>
			{/if}
			{#if plan.unmatched.length}
				<p class="status warn">
					{plan.unmatched.length === 1 ? '1 run' : `${plan.unmatched.length} runs`} under this prefix
					{plan.unmatched.length === 1 ? 'matches' : 'match'} no name:
					{plan.unmatched.map((r) => `${r.stem} (${r.frames.length})`).join(', ')}
				</p>
			{/if}
			<div class="controls">
				<button
					class="primary"
					disabled={!toMake.length || making}
					onclick={() => void makeClips()}
				>
					{making
						? `Making ${makeDone} / ${toMake.length}…`
						: `＋ Make ${toMake.length} clip${toMake.length === 1 ? '' : 's'}`}
				</button>
				<span class="hint">
					{box ? `with the box ${boxLabel(box)}` : 'with no Bounds box: the character has none yet'}
				</span>
			</div>
			{@render results(made)}
		</SectionCard>

		<SectionCard scope="flipbook" id="character-bounds" title="One Bounds box">
			{#snippet info()}
				<p>
					The game scales a clip so its Bounds box is the character's width, and stands the middle
					of the box's bottom edge on the ground. So every clip of a character needs the same box,
					or it changes size and jumps as it turns.
				</p>
				<p>
					Take the box of one clip, or type one, and apply it to all of the character's clips. Art
					that reaches outside the box is still drawn.
				</p>
			{/snippet}
			<p class="status" class:warn={boxes.boxes.length > 1 || boxes.missing.length > 0}>
				{#if !played.length}
					No clip yet.
				{:else if boxes.boxes.length === 1 && !boxes.missing.length}
					All {played.length} clips carry one box.
				{:else}
					{boxes.boxes.length} different box{boxes.boxes.length === 1 ? '' : 'es'}
					{boxes.missing.length
						? ` · ${boxes.missing.length} clip${boxes.missing.length === 1 ? '' : 's'} with none`
						: ''}
				{/if}
			</p>
			<div class="controls">
				<label class="field">
					<span>Take it from</span>
					<select
						value={boxIndex}
						disabled={!boxes.boxes.length}
						onchange={(e) => {
							const pick = boxes.boxes[Number(e.currentTarget.value)];
							if (pick) choose(pick.bounds);
						}}
					>
						{#if boxIndex < 0}<option value={-1}>{box ? 'the box typed here' : 'no box yet'}</option
							>{/if}
						{#each boxes.boxes as b, i (i)}
							<option value={i}>
								{b.clipIds[0]}{b.clipIds.length > 1 ? ` + ${b.clipIds.length - 1} more` : ''} · {boxLabel(
									b.bounds,
								)}
							</option>
						{/each}
					</select>
				</label>
				<button
					disabled={!played.length || fitting}
					title="A box that just holds every frame of every clip of this character: a place to start from"
					onclick={() => void fitEveryFrame()}
				>
					{fitting ? 'Fitting…' : '⊙ Fit every frame'}
				</button>
				{#each ['x', 'y', 'w', 'h'] as const as field (field)}
					<label class="field">
						<span>{field}</span>
						<input
							class="num"
							type="number"
							step="1"
							value={box?.[field] ?? ''}
							aria-label="Box {field}"
							onchange={(e) => {
								const v = e.currentTarget.valueAsNumber;
								if (Number.isFinite(v)) setField(field, v);
							}}
						/>
					</label>
				{/each}
			</div>
			{#if fitNote}<p class="status warn">{fitNote}</p>{/if}
			<div class="controls">
				{#if box}
					{@const feet = feetOf(look, box)}
					<span class="hint">
						Feet at x {round(feet.x)}, y {round(feet.y)} · drawn {look.displayWidth} px wide,
						{round((look.displayWidth * box.h) / box.w)} px tall
					</span>
				{/if}
				<label class="check">
					<input type="checkbox" bind:checked={previewBox} disabled={!box} />
					<span>Show it on the directions</span>
				</label>
				<span class="grow"></span>
				<button
					class="primary"
					disabled={!box || !toBox.length || applying}
					onclick={() => void applyBox()}
				>
					{applying
						? `Applying ${applyDone} / ${toBox.length}…`
						: `Apply to ${toBox.length} clip${toBox.length === 1 ? '' : 's'}`}
				</button>
			</div>
			{@render results(applied)}
		</SectionCard>
	</div>

	<div class="side">
		<SectionCard scope="flipbook" id="character-directions" title="Directions">
			{#snippet info()}
				<p>
					The character in every facing at once, at the size the game draws it. A mirrored facing is
					drawn mirrored and a facing with no clip is drawn with its stand-in, as in the game.
				</p>
				<p>
					<b>Box and feet</b> shows each clip's Bounds box (dashed grey for a clip with none) and the
					ground line its feet stand on.
				</p>
			{/snippet}
			<CharacterDirections
				{look}
				{grid}
				clips={clipById}
				candidate={previewBox ? box : undefined}
			/>
		</SectionCard>
	</div>
</div>

<style>
	.panel {
		flex: 1;
		min-width: 0;
		display: flex;
		gap: 14px;
		padding: 14px;
		overflow: auto;
		align-items: flex-start;
	}
	.cards {
		flex: 1 1 560px;
		min-width: 0;
	}
	.side {
		flex: 0 1 auto;
		min-width: 300px;
		max-width: 50%;
		position: sticky;
		top: 0;
	}
	@media (max-width: 1100px) {
		.panel {
			flex-direction: column;
			align-items: stretch;
		}
		.side {
			position: static;
			max-width: none;
		}
	}
	.scroll {
		overflow-x: auto;
	}
	.status {
		margin: 0 0 10px;
		font-size: 12px;
		color: #94a3b8;
	}
	.status.warn {
		color: #fbbf24;
	}
	code {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #e2e8f0;
	}
	button {
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		font-size: 12px;
		padding: 5px 10px;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.primary {
		border-color: #2563eb;
		color: #bfdbfe;
	}
	button.link {
		border: none;
		background: none;
		padding: 0;
		font-family: ui-monospace, monospace;
		color: #93c5fd;
	}
	button.link:hover {
		text-decoration: underline;
	}
	select,
	input[type='number'] {
		padding: 4px 6px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	.num {
		width: 64px;
	}
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 10px 14px;
		margin: 0 0 10px;
	}
	.controls:last-child {
		margin-bottom: 0;
	}
	.field,
	.check {
		display: flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: #94a3b8;
	}
	.state {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 3px 8px;
		border: 1px solid #1f2937;
		border-radius: 6px;
	}
	.state b {
		font-size: 12px;
		color: #e2e8f0;
	}
	.grow {
		flex: 1;
	}
	.hint {
		font-size: 11px;
		color: #64748b;
	}
	.chip {
		padding: 1px 7px;
		border-radius: 999px;
		border: 1px solid #2a323d;
		font-size: 10px;
		color: #94a3b8;
		white-space: nowrap;
	}
	.chip.bad {
		border-color: #7f2d2d;
		color: #fca5a5;
	}
	.chip.warn {
		border-color: #7a5a1e;
		color: #fbbf24;
	}
	.chip.good {
		border-color: #2f6b5b;
		color: #7ee0c0;
	}

	/* --- the plan --- */
	table {
		border-collapse: separate;
		border-spacing: 4px;
		font-size: 12px;
	}
	th {
		font-weight: 400;
		color: #94a3b8;
		text-align: left;
		white-space: nowrap;
	}

	/* --- lists --- */
	.rows {
		list-style: none;
		margin: 0 0 10px;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}
	.rows:last-child {
		margin-bottom: 0;
	}
	.rows li {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border: 1px solid #1f2937;
		border-radius: 6px;
		background: #10161e;
	}
	.say {
		flex: 1 1 260px;
		font-size: 12px;
		color: #94a3b8;
	}
	.res {
		font-size: 11px;
		color: #94a3b8;
	}
	.res.created {
		color: #86efac;
	}
	.res.refused {
		color: #fca5a5;
	}
	.plan td {
		padding: 3px 6px;
		vertical-align: middle;
	}
	.plan .run {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.plan .run > span:last-child {
		display: flex;
		flex-direction: column;
	}
	.thumb {
		flex: none;
		display: block;
		width: 32px;
		height: 32px;
		border-radius: 4px;
		background: #0b0b10;
	}
	.plan tr.exists code,
	.plan tr.duplicate code {
		color: #64748b;
	}

	.results {
		margin-top: 10px;
		padding: 8px 10px;
		border: 1px solid #1f2937;
		border-radius: 6px;
		background: #0d1117;
	}
	.tally {
		margin: 0;
		font-size: 12px;
		color: #cbd5e1;
	}
	.results ul {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}
	.results ul:empty {
		display: none;
	}
	.results li {
		display: flex;
		gap: 8px;
		font-size: 11px;
		color: #94a3b8;
	}
	.results li.refused span {
		color: #fca5a5;
	}
</style>
