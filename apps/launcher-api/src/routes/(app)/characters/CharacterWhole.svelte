<script lang="ts">
	/**
	 * Invisible Characters' WHOLE view (`docs/design/character-pipeline.md` step C1): every character
	 * of the project, from all four homes, one row each, on read-only cards. Everything shown is
	 * decided in `$lib/characters/characterWhole.ts`; the clips grid and the Directions preview are
	 * Flipbook's own components, fed the same answer Flipbook's Characters mode gets. It writes
	 * nothing: each card links to the tool that makes its part, and the Source row links to the
	 * choice of what draws the character (the Animation source card of the Edit view).
	 */
	import { resolve } from '$app/paths';
	import CanvasModeBar from '$lib/CanvasModeBar.svelte';
	import { COMPONENT_PARAM } from '$lib/componentLinks';
	import {
		characterGaps,
		impliedSource,
		impliedView,
		sourceChoiceHint,
		wholeCharacters,
		type ViewKind,
		type WholeCharacter,
		type WholeComponent,
	} from '$lib/characters/characterWhole';
	import {
		characterDraw,
		characterGrid,
		characterProblems,
		characterVariants,
		gridCounts,
	} from '$lib/flipbook/characterSet';
	import { characterArt } from '$lib/flipbook/projectCharacters';
	import CharacterClipsGrid from '$lib/flipbook/CharacterClipsGrid.svelte';
	import CharacterDirections from '$lib/flipbook/CharacterDirections.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import SectionCard from '$lib/ui/SectionCard.svelte';
	import { LOOK_EXPLAINED } from '$lib/characters/characterAdd';
	import { sheetOf } from '$lib/characters/characterSheetEdit';
	import { sheetCardLink, type SheetCard } from '$lib/characters/characterSheetPage';
	import type { GameConfigDoc } from 'game-config';
	import type { WholeRead } from './wholeRead.svelte';

	interface Props {
		projectKey: string;
		/** The config as the page holds it, unsaved edits included. */
		config: GameConfigDoc;
		/** The project's components, clips and screens, read by the page for both its views. */
		read: WholeRead;
		/** Open a config character in the Edit view, on one card of its sheet when named. */
		onEdit: (id: string, card?: SheetCard) => void;
	}
	let { projectKey, config, read, onEdit }: Props = $props();

	let pickedKey = $state('');
	/** Whose clips the grid shows: the base ones (`false`), or a variant's status. */
	let variant = $state<string | false>(false);

	const { components, clipIds, clips, projections, loading, clipById } = $derived(read);
	const loadError = $derived(read.error);
	const cast = $derived(read.read ? wholeCharacters({ components, config }) : []);
	const picked = $derived(cast.find((c) => c.key === pickedKey) ?? cast[0]);

	const VIEW: Record<ViewKind, string> = {
		side: 'Side',
		topDown: 'Top-down',
		isometric: 'Isometric',
		'3d': '3D',
		none: 'Not implied',
	};

	/** What a row is, in short chips. */
	function roles(c: WholeCharacter): string[] {
		return [
			...(c.character ? [c.character.brain ? 'brain' : 'offline'] : []),
			...(c.onlineClass ? ['online'] : []),
			...(c.builtin ? ['built-in'] : []),
			...(c.look3d ? ['3D'] : []),
		];
	}

	const flipbookQuery = (c: WholeCharacter): string =>
		new URLSearchParams({
			mode: 'characters',
			...(projectKey ? { project: projectKey } : {}),
			...(c.clips ? { character: c.clips.key } : {}),
		}).toString();
	const ms = (v: number | undefined): string => (v === undefined ? '—' : `${v} ms`);
</script>

<div class="whole">
	<aside class="rail">
		<div class="head">
			<h2>
				Every character
				<InfoTip>
					One row per character, joined from the config's characters, its online classes, Salmons'
					built-in clips and the 3D looks: by look (the component it is drawn as), else by id.
				</InfoTip>
			</h2>
			<button
				type="button"
				class="refresh"
				disabled={loading}
				title="Read the project's components, clips and screens again"
				onclick={() => void read.load()}>{loading ? 'Reading…' : '↻'}</button
			>
		</div>
		{#if loadError}<p class="err">{loadError}</p>{/if}
		{#each cast as c (c.key)}
			{@const gaps = characterGaps(c, config, clipIds).length}
			<button
				type="button"
				class="row"
				class:on={c.key === picked?.key}
				data-whole={c.key}
				onclick={() => {
					pickedKey = c.key;
					variant = false;
				}}
			>
				<span class="id">{c.label}</span>
				<span class="meta">{roles(c).join(' · ')}</span>
				{#if gaps}<span class="gaps" title="Things missing">{gaps}</span>{/if}
			</button>
		{:else}
			{#if !loading && !loadError}<p class="hint">This project has no character yet.</p>{/if}
		{/each}
	</aside>

	<main class="cards">
		{#if picked}
			{@const view = impliedView(picked, config, projections)}
			{@const source = impliedSource(picked, config)}
			{@const gaps = characterGaps(picked, config, clipIds)}
			<SectionCard scope="characters" id="whole-overview" title={picked.label}>
				{#snippet info()}
					<p>
						What this character is today: its view and its source as its character sheet names them,
						else as its other fields imply them. Read-only; each card links to the tool that makes
						its part.
					</p>
				{/snippet}
				<dl class="facts">
					<dt>Homes</dt>
					<dd class="homes">
						{#if picked.character}<span title="arcade.characters"
								>character <code>{picked.character.id}</code></span
							>{/if}
						{#if picked.onlineClass}<span
								title="arcade.online.characters{picked.joinedBy.class
									? `, joined by ${picked.joinedBy.class}`
									: ''}">online class <code>{picked.onlineClass.id}</code></span
							>{/if}
						{#if picked.builtin}<span
								title="Salmons' built-in clip table{picked.joinedBy.builtin
									? `, joined by ${picked.joinedBy.builtin}`
									: ''}">Salmons' built-in</span
							>{/if}
						{#if picked.look3d}<span
								title="arcade.world3d.looks{picked.joinedBy.look3d
									? `, joined by ${picked.joinedBy.look3d}`
									: ''}">3D look <code>{picked.look3d.id}</code></span
							>{/if}
					</dd>
					<dt>View</dt>
					<dd>
						<b data-view={view.kind}>{VIEW[view.kind]}</b>
						{#if view.drawn.length}
							<span class="muted"
								>drawn {view.drawn.join(' ')}{view.mirrored.length
									? ` · mirrored ${view.mirrored.join(' ')}`
									: ''}</span
							>
						{/if}
						<InfoTip label="Where the view comes from">
							<ul class="tip-list">
								{#each view.from as line (line)}<li>{line}</li>{/each}
							</ul>
						</InfoTip>
					</dd>
					<dt>Source</dt>
					<dd>
						<b data-source={source.kind}>{source.why}</b>
						{#if picked.character}
							{@const cid = picked.character.id}
							{@const hint = sourceChoiceHint(source.kind, !!sheetOf(config, cid)?.source)}
							{#if hint}<span class="muted" data-no-source>{hint}</span>{/if}
							<a
								class="maker"
								data-choose-source={cid}
								href={resolve(sheetCardLink(cid, 'source', projectKey) as '/')}
								onclick={(e) => {
									e.preventDefault();
									onEdit(cid, 'source');
								}}>{sheetOf(config, cid)?.source ? 'Change the source ↗' : 'Choose the source ↗'}</a
							>
						{/if}
					</dd>
				</dl>
				<details class="advanced" data-advanced="look">
					<summary>
						Advanced
						<InfoTip label="Look">{LOOK_EXPLAINED}</InfoTip>
					</summary>
					<dl class="facts">
						<dt>Look</dt>
						<dd>
							{#if picked.look}
								<code>{picked.look.id}</code>
								{#if picked.look.inProject}
									<a
										href={resolve(
											`/editor?${new URLSearchParams({ [COMPONENT_PARAM]: picked.look.id, project: projectKey })}`,
										)}>Component Editor ↗</a
									>
								{/if}
							{:else}—{/if}
						</dd>
					</dl>
				</details>
				{#if gaps.length}
					<ul class="missing" data-gaps>
						{#each gaps as gap (gap)}<li>{gap}</li>{/each}
					</ul>
				{:else}
					<p class="ok">Nothing missing.</p>
				{/if}
			</SectionCard>

			{#if picked.clips}
				{@const pc = picked.clips}
				{@const art = characterArt(pc)}
				{@const sheet = pc.sheet}
				{@const look = sheet ? undefined : pc.look}
				{@const variants = characterVariants(art)}
				{@const shown = variants.some((v) => v.status === variant) ? variant : false}
				{@const grid = characterGrid(art, clipIds, shown)}
				{@const counts = gridCounts(grid)}
				<SectionCard scope="characters" id="whole-clips" title="Clips">
					{#snippet info()}
						<p>
							One cell per clip the game looks for, named <code>prefix_state_facing</code>, states
							(a sheet's actions) down and facings across, as Flipbook's Characters mode shows them.
						</p>
						<p>
							✓ its own clip · ⇋ its twin, mirrored · ≈ another clip stands in · — nothing plays.
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
						{#if pc.sheetId}
							<button
								type="button"
								class="maker"
								data-edit-sheet={pc.sheetId}
								onclick={() => onEdit(pc.sheetId ?? '', 'view')}>Edit the sheet ↗</button
							>
						{/if}
						<a class="maker" href={resolve(`/flipbook?${flipbookQuery(picked)}`)}>Flipbook ↗</a>
					{/snippet}
					<p class="status" data-clips-from={pc.source}>
						{counts.made} of {counts.needed} made · drawn {characterDraw(art).width} px wide ·
						{pc.source === 'sheet'
							? `the character sheet of ${pc.sheetId}`
							: pc.source === 'component'
								? 'its component’s block'
								: 'the game’s own block'}
					</p>
					{#if pc.sheetProblem}<p class="note" data-sheet-problem>{pc.sheetProblem}</p>{/if}
					{#if picked.idleSheet?.sheetProblem && picked.idleSheet.sheetProblem !== pc.sheetProblem}
						<p class="note" data-sheet-problem>{picked.idleSheet.sheetProblem}</p>
					{/if}
					<CharacterClipsGrid
						{look}
						{sheet}
						{grid}
						clips={clipById}
						problems={characterProblems(art, clips)}
					/>
				</SectionCard>

				<SectionCard scope="characters" id="whole-directions" title="Directions">
					{#snippet info()}
						<p>
							The character in every facing at once, at the size the game draws it, in its real art:
							mirrored where the game mirrors, a stand-in where a facing has no clip.
						</p>
					{/snippet}
					<CharacterDirections {look} {sheet} {grid} clips={clipById} />
				</SectionCard>
			{/if}

			{#if picked.onlineClass}
				{@const cls = picked.onlineClass}
				<SectionCard scope="characters" id="whole-online" title="Online class">
					{#snippet info()}
						<p>
							What a player of a room can be (<code>arcade.online.characters</code>), and the
							abilities the room's rules give it. Edited in Invisible Game Config, Online.
						</p>
					{/snippet}
					{#snippet actions()}
						<a class="maker" href={resolve('/config')}>Game Config ↗</a>
					{/snippet}
					<dl class="facts">
						<dt>Speed</dt>
						<dd data-speed>{cls.speed} px/s</dd>
						<dt>Places</dt>
						<dd>{cls.max ?? 'any number'}</dd>
						<dt>Spawns</dt>
						<dd>
							{cls.spawns?.length
								? `${cls.spawns.length}${cls.randomSpawn ? ', at random' : ', in turn'}`
								: 'the room’s'}
						</dd>
						<dt>Bots</dt>
						<dd>
							{#each picked.botBrains as brain (brain)}<code>{brain}</code>{:else}none{/each}
						</dd>
					</dl>
					{#if picked.onlineAbilities.length}
						<table class="abilities">
							<thead>
								<tr>
									<th>Button</th><th>Effect</th><th>Reach</th><th>Targets</th><th>Holds</th><th
										>Cooldown</th
									><th>Used</th>
								</tr>
							</thead>
							<tbody>
								{#each picked.onlineAbilities as a, i (i)}
									<tr data-ability={a.button}>
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
						<p class="muted">No ability.</p>
					{/if}
				</SectionCard>
			{/if}

			{#if picked.character}
				{@const ch = picked.character}
				<SectionCard scope="characters" id="whole-offline" title="Character">
					{#snippet info()}
						<p>
							Its <code>arcade.characters</code> entry: what moves it offline, and the brain a bot plays
							it with online. Edited in this tool's Edit view.
						</p>
					{/snippet}
					{#snippet actions()}
						<button type="button" class="maker" onclick={() => onEdit(ch.id)}>Edit ↗</button>
					{/snippet}
					<dl class="facts">
						<dt>Controller</dt>
						<dd>
							{#if ch.controller}
								{ch.controller.kind}{'speed' in ch.controller && ch.controller.speed
									? ` · ${ch.controller.speed} px/s`
									: ''}{'jump' in ch.controller && ch.controller.jump
									? ` · ${ch.controller.jump.kind} jump`
									: ''}
							{:else}none{/if}
						</dd>
						<dt>Movement</dt>
						<dd>
							{ch.movement?.maxSpeed !== undefined
								? `${ch.movement.maxSpeed} px/s top`
								: 'defaults'}
						</dd>
						<dt>Brain</dt>
						<dd>
							{ch.brain
								? `${ch.brain.states.length} state${ch.brain.states.length === 1 ? '' : 's'}`
								: 'none'}
						</dd>
						<dt>Anim inputs</dt>
						<dd>
							{#each Object.entries(ch.animInputs ?? {}) as [input, from] (input)}
								<code>{input} ← {from}</code>
							{:else}none{/each}
						</dd>
						<dt>Abilities</dt>
						<dd>
							{#each picked.abilities as a, i (i)}
								<code>{a.button}: {a.effect}</code>
							{:else}none offline{/each}
						</dd>
					</dl>
				</SectionCard>
			{/if}

			{#if picked.look3d}
				{@const l3 = picked.look3d}
				<SectionCard scope="characters" id="whole-3d" title="3D look">
					{#snippet info()}
						<p>
							Its <code>arcade.world3d.looks</code> entry: the model, its clip libraries, what is attached
							to its sockets and the animation graph it plays.
						</p>
					{/snippet}
					{#snippet actions()}
						{#if l3.modelId}
							<a
								class="maker"
								href={resolve(`/models?${new URLSearchParams({ model: l3.modelId })}`)}
								>Model Viewer ↗</a
							>
						{/if}
					{/snippet}
					<dl class="facts">
						<dt>Model</dt>
						<dd>
							{#if l3.modelId}<code>{l3.modelId}</code>{:else}—{/if}
						</dd>
						<dt>Clip libraries</dt>
						<dd>
							{#each l3.modelIds as id, i (i)}<code>{id}</code>{:else}none{/each}
						</dd>
						<dt>Attached</dt>
						<dd>
							{#each l3.attach as a, i (i)}<code>{a.socket}: {a.modelId}</code>{:else}nothing{/each}
						</dd>
						<dt>Graph</dt>
						<dd>
							{#if l3.anim}<code>{l3.anim}</code>{:else}—{/if}
						</dd>
						<dt>First person</dt>
						<dd>{l3.viewmodel ? 'has arms' : 'no'}</dd>
					</dl>
				</SectionCard>
			{/if}
		{:else if loading}
			<p class="hint">Reading the project's characters…</p>
		{/if}
	</main>
</div>

<style>
	.whole {
		flex: 1;
		min-height: 0;
		display: flex;
		gap: 14px;
	}
	.rail {
		width: 230px;
		flex: none;
		display: flex;
		flex-direction: column;
		gap: 4px;
		overflow-y: auto;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 4px;
	}
	h2 {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
	}
	.refresh,
	.advanced {
		margin-top: 10px;
		font-size: 12px;
		color: #8b8b98;
	}
	.advanced summary {
		cursor: pointer;
	}
	.maker {
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #161b22;
		color: #cbd5e1;
		font-size: 11px;
		padding: 2px 8px;
		cursor: pointer;
		text-decoration: none;
	}
	.refresh:disabled {
		opacity: 0.5;
	}
	.row {
		display: grid;
		grid-template-columns: 1fr auto;
		gap: 2px 6px;
		text-align: left;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: #10161e;
		color: #cbd5e1;
		cursor: pointer;
		font-size: 12px;
	}
	.row.on {
		border-color: #2563eb;
		color: #bfdbfe;
	}
	.id {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta {
		grid-column: 1;
		color: #64748b;
		font-size: 11px;
	}
	.gaps {
		grid-row: 1 / span 2;
		grid-column: 2;
		align-self: center;
		min-width: 16px;
		padding: 0 5px;
		border-radius: 999px;
		background: #78350f;
		color: #fde68a;
		font-size: 10px;
		text-align: center;
	}
	.cards {
		flex: 1;
		min-width: 0;
		overflow-y: auto;
	}
	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 12px;
		margin: 0;
		font-size: 12px;
	}
	dt {
		color: #64748b;
	}
	dd {
		margin: 0;
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		color: #cbd5e1;
		min-width: 0;
	}
	.homes span {
		padding: 1px 6px;
		border-radius: 999px;
		background: #1e293b;
	}
	code {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: #e2e8f0;
	}
	a {
		color: #93c5fd;
	}
	.muted,
	.status {
		color: #64748b;
		font-size: 12px;
	}
	.status {
		margin: 0 0 8px;
	}
	.note {
		margin: 0 0 8px;
		color: #fbbf24;
		font-size: 12px;
	}
	.missing {
		margin: 10px 0 0;
		padding-left: 18px;
		color: #fbbf24;
		font-size: 12px;
	}
	.ok {
		margin: 10px 0 0;
		color: #86efac;
		font-size: 12px;
	}
	.tip-list {
		margin: 0;
		padding-left: 16px;
	}
	.abilities {
		margin-top: 10px;
		border-collapse: collapse;
		font-size: 12px;
		width: 100%;
	}
	.abilities th,
	.abilities td {
		text-align: left;
		padding: 4px 8px;
		border-bottom: 1px solid #1f2937;
	}
	.abilities th {
		color: #64748b;
		font-weight: 500;
	}
	.err {
		margin: 0;
		color: #fca5a5;
		font-size: 11px;
	}
	.hint {
		color: #64748b;
		font-size: 12px;
	}
</style>
