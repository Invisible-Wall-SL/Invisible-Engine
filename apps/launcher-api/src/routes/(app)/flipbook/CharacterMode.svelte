<script lang="ts">
	/**
	 * Invisible Flipbook's CHARACTERS mode: an arcade character plays one clip per state and
	 * facing, found by its name (`<prefix>_<state>_<facing>`, `engine-layout` `characterClips.ts`),
	 * and this mode is where a character's whole set is seen and made at once. The Clips mode
	 * beside it still authors each clip.
	 *
	 * This file is the shell: which characters the project has (read once from
	 * `/api/flipbook/characters`, and again after every write) and the one picked. Everything
	 * about a character is `CharacterPanel`.
	 */
	import { onMount } from 'svelte';
	import { askConfirm } from '$lib/dialogs.svelte';
	import {
		facingsProblem,
		writeCharacterFacings,
		type CharacterFacings,
	} from '$lib/flipbook/characterFacings';
	import {
		characterGrid,
		characterProblems,
		gridCounts,
		strayClips,
	} from '$lib/flipbook/characterSet';
	import type { CharacterWritten } from '$lib/flipbook/characterWrites';
	import { leaseOnce } from '$lib/flipbook/leaseOnce';
	import type { ProjectCharacter } from '$lib/flipbook/projectCharacters';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import type { FlipbookClip } from 'engine-flipbook';
	import type { ComponentDef } from 'engine-layout';
	import CharacterPanel from './CharacterPanel.svelte';

	interface Props {
		clientKey: string;
		projectKey: string;
		atlases: { manifestKey: string; label: string; regions: string[] }[];
		/** The author also holds the Scene Editor, whose endpoint saves a component. */
		canEditComponents: boolean;
		openClip: () => { id: string; dirty: boolean; heldBy: string | null };
		onWritten: (written: CharacterWritten) => Promise<void>;
		onOpen: (id: string) => void;
		/** Re-read the project's sheets (the page's ↻ Refresh from R2). */
		onRefreshArt: () => Promise<void>;
	}
	let {
		clientKey,
		projectKey,
		atlases,
		canEditComponents,
		openClip,
		onWritten,
		onOpen,
		onRefreshArt,
	}: Props = $props();

	let loading = $state(true);
	let loadError = $state('');
	let characters = $state<ProjectCharacter[]>([]);
	let clipIds = $state<string[]>([]);
	let clips = $state<FlipbookClip[]>([]);
	let pickedKey = $state('');

	async function load(): Promise<void> {
		loading = true;
		loadError = '';
		try {
			const tab = projectKey ? `?${new URLSearchParams({ projectKey })}` : '';
			const res = await fetch(`/api/flipbook/characters${tab}`);
			if (!res.ok) {
				const out = (await res.json().catch(() => ({}))) as { message?: string };
				loadError = out.message ?? `Could not read the characters (HTTP ${res.status}).`;
				return;
			}
			const out = (await res.json()) as {
				characters: ProjectCharacter[];
				clipIds: string[];
				clips: FlipbookClip[];
			};
			characters = out.characters;
			clipIds = out.clipIds;
			clips = out.clips;
			if (!characters.some((c) => c.key === pickedKey)) pickedKey = characters[0]?.key ?? '';
		} catch {
			loadError = 'Could not read the characters (network error).';
		} finally {
			loading = false;
		}
	}
	onMount(() => void load());

	/** Counts the refreshes: the panel is mounted afresh after one, so no sheet it had read stays. */
	let artVersion = $state(0);
	async function refresh(): Promise<void> {
		await onRefreshArt();
		await load();
		artVersion += 1;
	}

	async function written(change: CharacterWritten): Promise<void> {
		await load();
		await onWritten(change);
	}

	const character = $derived(characters.find((c) => c.key === pickedKey));
	const others = $derived(characters.filter((c) => c.key !== pickedKey).map((c) => c.look));

	/** A character's line in the list: how much of it is made, and how many things want a look. */
	function summary(c: ProjectCharacter): { made: number; needed: number; flags: number } {
		const rest = characters.filter((o) => o.key !== c.key).map((o) => o.look);
		const { made, needed } = gridCounts(characterGrid(c.look, clipIds));
		const misnamed = strayClips(c.look, clipIds, rest).filter((s) => s.kind === 'misnamed');
		return { made, needed, flags: misnamed.length + characterProblems(c.look, clips).length };
	}

	const FACINGS_FROM: Record<ProjectCharacter['facingsFrom'], string> = {
		component: 'set on its component',
		game: 'the game’s own',
		default: 'the default',
	};

	let savingFacings = $state(false);
	let facingsNote = $state('');
	/**
	 * Save a character's `facings` into its component (`characterFacings.ts`): the editor's own
	 * conditional component save, under the component's edit lease.
	 */
	async function setFacings(c: ProjectCharacter, facings: CharacterFacings): Promise<void> {
		const component = c.component;
		if (!component || savingFacings) return;
		facingsNote = '';
		const confirmed = await askConfirm({
			title: `Give ${c.label} ${facings === 8 ? 'eight' : 'four'} facings?`,
			message:
				(facings === 8
					? 'It will be drawn in n, ne, e, se and s, and the game mirrors the other three.'
					: 'Only its four diagonals will play: clips of n, e, s and w are no longer looked for.') +
				`\n\nThis saves the component "${component.name}" as a new version. ` +
				'The game takes it at the next publish.',
			confirmLabel: 'Save the component',
		});
		if (!confirmed) return;
		savingFacings = true;
		try {
			const result = await writeCharacterFacings(component.id, facings, {
				read: async (id) => {
					const qs = new URLSearchParams({ id, project: projectKey, stored: 'project' });
					const res = await fetch(`/api/editor/component?${qs}`);
					if (!res.ok) return { status: res.status };
					const body = (await res.json()) as { def: ComponentDef; etag?: string | null };
					return { def: body.def, etag: body.etag ?? null };
				},
				save: async (def, baseEtag) => {
					const res = await fetch('/api/editor/component', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ ...def, project: projectKey, baseEtag }),
					});
					if (!res.ok) {
						const body = (await res.json().catch(() => ({}))) as { message?: unknown };
						const said = typeof body.message === 'string' && body.message;
						return {
							status: res.status,
							message: said || `Component save failed (${res.status}).`,
						};
					}
					const out = (await res.json()) as { version: number; etag?: string | null };
					return { version: out.version, etag: out.etag ?? null };
				},
				lease: (id) => leaseOnce({ toolId: 'componentEditor', clientKey, projectKey, docKey: id }),
			});
			facingsNote =
				'problem' in result
					? `Not saved: ${result.problem}`
					: result.version === null
						? `It already had ${result.facings} facings.`
						: `Saved: ${result.facings} facings (component v${result.version}).`;
			await load();
		} finally {
			savingFacings = false;
		}
	}
</script>

<div class="body">
	<aside class="rail">
		<div class="head">
			<h3>
				Characters
				<InfoTip>
					A character plays one clip per state and facing, found by its name:
					<code>prefix_state_facing</code>. The ones listed are the components of this project that
					carry a clip block, and the game's own characters for a Salmons project.
				</InfoTip>
			</h3>
			<button
				class="refresh"
				disabled={loading}
				title="Read the project's characters, clips and sheets again"
				onclick={() => void refresh()}
			>
				{loading ? 'Reading…' : '↻ Refresh'}
			</button>
		</div>
		{#if loadError}<p class="err">{loadError}</p>{/if}
		<ul class="list">
			{#each characters as c (c.key)}
				{@const s = summary(c)}
				<li>
					<button
						class:active={c.key === pickedKey}
						data-character={c.key}
						onclick={() => {
							pickedKey = c.key;
							facingsNote = '';
						}}
					>
						<span class="nm">{c.label}</span>
						<span class="ct" title="Drawn clips made, of the ones it needs"
							>{s.made}/{s.needed}</span
						>
						{#if s.flags}
							<span class="flag" title="Misnamed or broken clips">{s.flags}</span>
						{/if}
					</button>
				</li>
			{:else}
				{#if !loading && !loadError}
					<li class="empty">No character of this project plays clips.</li>
				{/if}
			{/each}
		</ul>

		{#if character}
			{@const problem = facingsProblem(character, canEditComponents)}
			{@const facings = character.look.facings === 8 ? 8 : 4}
			<dl class="facts">
				<dt>Clips</dt>
				<dd>
					<code>{character.look.prefixes.base}_…</code>
					{#if character.look.prefixes.marked}
						<code>{character.look.prefixes.marked}_…</code>
					{/if}
				</dd>
				<dt>Drawn</dt>
				<dd>{character.look.displayWidth} px wide</dd>
				<dt>Block</dt>
				<dd>
					{character.source === 'game'
						? 'the game’s own'
						: `component ${character.component?.name ?? ''}`}
				</dd>
				<dt>Facings</dt>
				<dd>
					<select
						aria-label="Facings"
						value={facings}
						disabled={problem !== null || savingFacings}
						title={problem ?? 'How many facings its clips are drawn in. Saved into its component.'}
						onchange={(e) => {
							const next = Number(e.currentTarget.value) === 8 ? 8 : 4;
							// The list shows the saved value until the save lands; a cancel leaves it there.
							e.currentTarget.value = String(facings);
							if (next !== facings) void setFacings(character, next);
						}}
					>
						<option value={4}>4, the diagonals</option>
						<option value={8}>8</option>
					</select>
					<span class="from">{FACINGS_FROM[character.facingsFrom]}</span>
				</dd>
			</dl>
			{#if facingsNote}<p class="note">{facingsNote}</p>{/if}
			{#if !character.inConfig}
				<p class="note warn">This game's config lists no character drawn as it yet.</p>
			{/if}
		{/if}
	</aside>

	{#if character}
		{#key `${character.key}|${artVersion}`}
			<CharacterPanel
				{clientKey}
				{projectKey}
				{character}
				{others}
				{clipIds}
				{clips}
				{atlases}
				{openClip}
				onWritten={written}
				{onOpen}
			/>
		{/key}
	{:else}
		<div class="none">
			{#if loading}
				Reading the project's characters…
			{:else if !loadError}
				A character plays clips once its component carries a clip block (<code>characterClips</code
				>), or when the project's Game Config uses a Salmons generator.
			{/if}
		</div>
	{/if}
</div>

<style>
	.body {
		flex: 1;
		min-height: 0;
		display: flex;
	}
	.rail {
		width: 230px;
		flex: none;
		display: flex;
		flex-direction: column;
		border-right: 1px solid #1f2937;
		padding: 12px;
		min-height: 0;
		overflow-y: auto;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 8px;
	}
	h3 {
		margin: 0;
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #94a3b8;
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
	.refresh {
		flex: none;
		padding: 3px 8px;
		white-space: nowrap;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.list button {
		display: flex;
		width: 100%;
		align-items: center;
		gap: 6px;
		padding: 6px 8px;
		border-color: transparent;
		background: #10161e;
		text-align: left;
		margin-bottom: 4px;
	}
	.list button.active {
		border-color: #2563eb;
		color: #bfdbfe;
	}
	.nm {
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.ct {
		color: #64748b;
		font-size: 11px;
		font-variant-numeric: tabular-nums;
	}
	.flag {
		min-width: 16px;
		padding: 0 5px;
		border-radius: 999px;
		background: #7f1d1d;
		color: #fecaca;
		font-size: 10px;
		text-align: center;
	}
	.empty {
		color: #64748b;
		font-size: 12px;
		padding: 6px 2px;
	}
	.err {
		margin: 0 0 8px;
		padding: 5px 7px;
		border-radius: 5px;
		border: 1px solid #7f2d2d;
		background: #23100f;
		color: #fca5a5;
		font-size: 11px;
	}
	.facts {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 5px 10px;
		margin: 12px 0 0;
		padding-top: 10px;
		border-top: 1px solid #1f2937;
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
		gap: 4px 6px;
		color: #cbd5e1;
		min-width: 0;
	}
	code {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: #e2e8f0;
	}
	select {
		padding: 3px 6px;
		border-radius: 6px;
		border: 1px solid #2a323d;
		background: #0e131a;
		color: #e2e8f0;
		font-size: 12px;
	}
	select:disabled {
		opacity: 0.6;
	}
	.from {
		font-size: 11px;
		color: #64748b;
	}
	.note {
		margin: 8px 0 0;
		font-size: 11px;
		color: #7dd3fc;
	}
	.note.warn {
		color: #fbbf24;
	}
	.none {
		flex: 1;
		display: grid;
		place-items: center;
		padding: 24px;
		color: #64748b;
		font-size: 13px;
		text-align: center;
	}
</style>
