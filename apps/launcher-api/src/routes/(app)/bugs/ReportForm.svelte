<script lang="ts">
	import { onDestroy, untrack } from 'svelte';
	import {
		BUG_PRIORITIES,
		BUG_PRIORITY_LABELS,
		MAX_DESCRIPTION,
		MAX_SCREENSHOTS,
		MAX_TITLE,
		type BugKind,
	} from '$lib/bugReports';
	import type { BugDetail } from '$lib/server/bugReports';
	import { apiErrorText } from '../pipeline/view';
	import ShotDrop from './ShotDrop.svelte';
	import { formatBytes } from './view';

	let {
		kind,
		areas,
		projects,
		project: fixedProject,
		initial,
		oncreated,
		oncancel,
	}: {
		kind: BugKind;
		areas: { id: string; name: string }[];
		projects: { key: string; name: string; clientName: string | null }[];
		/** A game bug's project: fixed, as the list is that project's. */
		project: string | null;
		initial: { area: string; pageUrl: string };
		/** The bug is reported; `failed` names each screenshot that did not upload, with why. */
		oncreated: (bug: BugDetail, failed: string[]) => void;
		oncancel: () => void;
	} = $props();

	const PIPELINE_PLACEHOLDER =
		'What happened?\nWhat did you expect?\nSteps to make it happen again:\n1. …';
	const GAME_PLACEHOLDER =
		'What happened in the game?\nOn which screen, bet and mode (base game, free spins, bonus)?\n' +
		'What did you expect?\nSteps to make it happen again:\n1. …';

	// The form starts from what the link asked for, then is the reporter's.
	const start = untrack(() => initial);
	let title = $state('');
	let area = $state(start.area);
	const game = untrack(() => kind === 'game');
	let project = $state(untrack(() => fixedProject) ?? '');
	const projectName = (key: string): string => {
		const p = projects.find((x) => x.key === key);
		return p ? (p.clientName ? `${p.clientName} · ${p.name}` : p.name) : key;
	};
	let pageUrl = $state(start.pageUrl);
	let priority = $state('');
	let description = $state('');
	let shots = $state<{ file: File; url: string }[]>([]);
	let formEl = $state<HTMLFormElement | null>(null);
	let busy = $state<string | null>(null);
	let failure = $state<string | null>(null);

	const ready = $derived(title.trim().length > 0 && area !== '' && busy === null);

	function addShots(files: File[]): void {
		shots = [...shots, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))];
	}

	function dropShot(i: number): void {
		URL.revokeObjectURL(shots[i].url);
		shots = shots.filter((_, j) => j !== i);
	}

	onDestroy(() => shots.forEach((s) => URL.revokeObjectURL(s.url)));

	async function submit(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!ready) return;
		failure = null;
		busy = 'Reporting…';
		try {
			const res = await fetch('/api/bugs', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					kind,
					title,
					description,
					area,
					project: project || null,
					pageUrl: pageUrl.trim() || null,
					priority: priority || null,
				}),
			});
			const body: unknown = await res.json().catch(() => null);
			if (!res.ok) throw new Error(apiErrorText(res.status, body));
			let bug = body as BugDetail;
			const failed: string[] = [];
			for (const [i, s] of shots.entries()) {
				busy = `Uploading screenshot ${i + 1} of ${shots.length}…`;
				const form = new FormData();
				form.append('file', s.file);
				// The bug exists now: a failed upload is named, never a reason to report it again.
				try {
					const up = await fetch(`/api/bugs/${bug.number}/screenshots`, {
						method: 'POST',
						body: form,
					});
					const upBody: unknown = await up.json().catch(() => null);
					if (up.ok) bug = upBody as BugDetail;
					else failed.push(`${s.file.name}: ${apiErrorText(up.status, upBody)}`);
				} catch (err) {
					failed.push(`${s.file.name}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
			oncreated(bug, failed);
		} catch (err) {
			failure = err instanceof Error ? err.message : String(err);
		} finally {
			busy = null;
		}
	}
</script>

<form class="card" onsubmit={submit} bind:this={formEl}>
	<div class="card-head">
		<h2>{game ? `Report a bug in ${projectName(project)}` : 'Report a pipeline bug'}</h2>
		<button type="button" class="btn" disabled={busy !== null} onclick={oncancel}>Cancel</button>
	</div>
	<p class="hint">
		{#if game}
			Something wrong in this game: a win, a screen, a sound, a text. You are recorded as the
			reporter. Say what happened, on which screen and bet, what you expected, and how to make it
			happen again; a screenshot is worth a paragraph.
		{:else}
			Something wrong in a tool, the engine or the launcher. You are recorded as the reporter. Say
			what happened, what you expected, and how to make it happen again; a screenshot is worth a
			paragraph.
		{/if}
	</p>

	<label class="field">
		<span>Title</span>
		<input
			type="text"
			bind:value={title}
			maxlength={MAX_TITLE}
			placeholder={game
				? 'The free spins counter shows 0 after the third spin'
				: 'The Rigger freezes when I delete a bone'}
			required
		/>
	</label>

	<div class="row">
		<label class="field">
			<span>{game ? 'Part of the game' : 'Tool or area'}</span>
			<select bind:value={area} required>
				<option value="" disabled>Pick one…</option>
				{#each areas as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
			</select>
		</label>
		{#if !game}
			<label class="field">
				<span>Project <em>(optional)</em></span>
				<select bind:value={project}>
					<option value="">Not about one project</option>
					{#each projects as p (p.key)}
						<option value={p.key}>{projectName(p.key)}</option>
					{/each}
				</select>
			</label>
		{/if}
		<label class="field">
			<span>Priority <em>(optional)</em></span>
			<select bind:value={priority}>
				<option value="">Let triage decide</option>
				{#each BUG_PRIORITIES as p (p)}<option value={p}>{BUG_PRIORITY_LABELS[p]}</option>{/each}
			</select>
		</label>
	</div>

	<label class="field">
		<span>
			Where it happened
			<em>({game ? 'optional: the game’s address' : 'optional page address'})</em>
		</span>
		<input
			type="url"
			bind:value={pageUrl}
			placeholder={game ? 'https://…/play/…' : 'https://app.invisiblewall.org/rigger?…'}
		/>
	</label>

	<label class="field">
		<span>Description</span>
		<textarea
			bind:value={description}
			maxlength={MAX_DESCRIPTION}
			rows="8"
			placeholder={game ? GAME_PLACEHOLDER : PIPELINE_PLACEHOLDER}
		></textarea>
	</label>

	<div class="field">
		<span>Screenshots <em>({shots.length} of {MAX_SCREENSHOTS})</em></span>
		{#if shots.length}
			<ul class="thumbs">
				{#each shots as s, i (s.url)}
					<li>
						<img src={s.url} alt={s.file.name} />
						<span class="thumb-meta">{formatBytes(s.file.size)}</span>
						<button
							type="button"
							class="btn small"
							disabled={busy !== null}
							onclick={() => dropShot(i)}
							aria-label={`Remove ${s.file.name}`}>Remove</button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<ShotDrop
			onfiles={addShots}
			disabled={busy !== null}
			room={MAX_SCREENSHOTS - shots.length}
			within={formEl}
		/>
	</div>

	{#if failure}<div class="error" role="alert">{failure}</div>{/if}

	<div class="actions">
		<button type="submit" class="btn primary large" disabled={!ready}>
			{busy ?? 'Report bug'}
		</button>
	</div>
</form>

<style>
	.hint {
		margin: 0;
		color: #9a9aa6;
		font-size: 13px;
		line-height: 1.5;
	}
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
		gap: 12px;
	}
	em {
		font-style: normal;
		color: #80808c;
	}
	.thumbs {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
		gap: 8px;
		margin: 0 0 8px;
		padding: 0;
		list-style: none;
	}
	.thumbs li {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 6px;
		border: 1px solid #23232e;
		border-radius: 8px;
		background: #121218;
	}
	.thumbs img {
		width: 100%;
		height: 90px;
		object-fit: cover;
		border-radius: 6px;
	}
	.thumb-meta {
		font-size: 11px;
		color: #9a9aa6;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
	}
</style>
