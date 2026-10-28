<script lang="ts">
	import {
		BUG_PRIORITIES,
		BUG_PRIORITY_LABELS,
		BUG_STATUSES,
		MAX_COMMENT,
		MAX_DESCRIPTION,
		MAX_SCREENSHOTS,
		MAX_TITLE,
		NO_PRIORITY_LABEL,
		bugAreaName,
		bugBrief,
		bugPath,
		bugRef,
		bugTriageName,
	} from '$lib/bugReports';
	import type { BugDetail, LinkSync } from '$lib/server/bugReports';
	import { resolve } from '$app/paths';
	import Pill from '../pipeline/Pill.svelte';
	import { apiErrorText, timeAgo } from '../pipeline/view';
	import RepairCard from './RepairCard.svelte';
	import ShotDrop from './ShotDrop.svelte';
	import {
		LINK_STATE_LABELS,
		NO_REPAIR,
		eventNote,
		eventText,
		formatBytes,
		linkTone,
		priorityLabel,
		priorityTone,
		statusLabel,
		statusTone,
		syncText,
		type RepairFacts,
	} from './view';

	let {
		detail,
		canTriage,
		canOpenPipeline,
		canOpenPipelineBugs = false,
		canOpenGameBugs = false,
		repair = NO_REPAIR,
		pipelineAreas = [],
		areas,
		projects,
		sync,
		now,
		onchanged,
		onreload,
	}: {
		detail: BugDetail;
		canTriage: boolean;
		/** The viewer has Invisible Pipeline Changes, so its Bugs tab can be linked. */
		canOpenPipeline: boolean;
		/** The viewer has Invisible Pipeline Bug Reports / Game Bug Reports, so the other list can be linked. */
		canOpenPipelineBugs?: boolean;
		canOpenGameBugs?: boolean;
		repair?: RepairFacts;
		pipelineAreas?: { id: string; name: string }[];
		areas: { id: string; name: string }[];
		projects: { key: string; name: string; clientName: string | null }[];
		sync: LinkSync | null;
		now: number;
		/** The bug as the server now answers it, after an action here. */
		onchanged: (next: BugDetail) => void;
		/** Read the bug again (after a refusal that says it moved on). */
		onreload: () => void;
	} = $props();

	const ref = $derived(bugRef(detail.number));
	const game = $derived(detail.kind === 'game');
	const areaLabel = $derived(game ? 'Part of the game' : 'Tool or area');
	const shotUrl = (id: string) => `/api/bugs/${detail.number}/screenshots/${id}`;
	const projectName = (key: string | null) => {
		if (!key) return null;
		const p = projects.find((x) => x.key === key);
		return p ? (p.clientName ? `${p.clientName} · ${p.name}` : p.name) : key;
	};
	const pageHref = $derived(
		detail.pageUrl && /^https?:\/\//.test(detail.pageUrl) ? detail.pageUrl : null,
	);
	const syncLine = $derived(syncText(sync));
	/** The game bug a pipeline bug was escalated from (ADR-0012 §3). */
	const escalatedFrom = $derived.by(() => {
		const e = detail.events.find((x) => x.kind === 'escalated' && typeof x.data.from === 'number');
		return e ? Number(e.data.from) : null;
	});

	let busy = $state<string | null>(null);
	let failure = $state<{ text: string; reload: boolean } | null>(null);
	let notice = $state<string | null>(null);

	async function send(body: Record<string, unknown>, what: string): Promise<boolean> {
		busy = what;
		failure = null;
		notice = null;
		try {
			const res = await fetch(`/api/bugs/${detail.number}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
			});
			const answer: unknown = await res.json().catch(() => null);
			if (!res.ok) {
				failure = { text: apiErrorText(res.status, answer), reload: res.status === 409 };
				return false;
			}
			onchanged(answer as BugDetail);
			return true;
		} catch (err) {
			failure = { text: err instanceof Error ? err.message : String(err), reload: false };
			return false;
		} finally {
			busy = null;
		}
	}

	// ── Editing the text ──────────────────────────────────────────────────────
	let editing = $state(false);
	let draft = $state({ title: '', description: '', area: '', project: '', pageUrl: '' });
	let draftRevision = 0;

	function startEdit(): void {
		draft = {
			title: detail.title,
			description: detail.description,
			area: detail.area,
			project: detail.projectKey ?? '',
			pageUrl: detail.pageUrl ?? '',
		};
		draftRevision = detail.revision;
		editing = true;
	}

	async function saveEdit(): Promise<void> {
		const ok = await send(
			{
				action: 'edit',
				revision: draftRevision,
				title: draft.title,
				description: draft.description,
				area: draft.area,
				// A game bug stays in its project's list.
				...(game ? {} : { project: draft.project || null }),
				pageUrl: draft.pageUrl.trim() || null,
			},
			'Saving…',
		);
		if (ok) editing = false;
	}

	/** After a conflict: leave the editor and show the bug as it now stands, to edit again from. */
	function reloadTheirs(): void {
		editing = false;
		failure = null;
		onreload();
	}

	/** A refused change puts the control back on what the bug still says. */
	async function setPriority(select: HTMLSelectElement): Promise<void> {
		const ok = await send({ action: 'priority', priority: select.value || null }, 'Saving…');
		if (!ok) select.value = detail.priority ?? '';
	}

	// ── Comments ──────────────────────────────────────────────────────────────
	let comment = $state('');
	async function postComment(): Promise<void> {
		if (await send({ action: 'comment', text: comment }, 'Posting…')) comment = '';
	}

	// ── Screenshots ───────────────────────────────────────────────────────────
	async function upload(files: File[]): Promise<void> {
		failure = null;
		const failed: string[] = [];
		for (const [i, file] of files.entries()) {
			busy = `Uploading ${i + 1} of ${files.length}…`;
			const form = new FormData();
			form.append('file', file);
			try {
				const res = await fetch(`/api/bugs/${detail.number}/screenshots`, {
					method: 'POST',
					body: form,
				});
				const answer: unknown = await res.json().catch(() => null);
				if (res.ok) onchanged(answer as BugDetail);
				else failed.push(`${file.name}: ${apiErrorText(res.status, answer)}`);
			} catch (err) {
				failed.push(`${file.name}: ${err instanceof Error ? err.message : String(err)}`);
			}
		}
		busy = null;
		if (failed.length) failure = { text: failed.join(' · '), reload: false };
	}

	async function removeShot(id: string): Promise<void> {
		busy = 'Removing…';
		failure = null;
		try {
			const res = await fetch(shotUrl(id), { method: 'DELETE' });
			const answer: unknown = await res.json().catch(() => null);
			if (res.ok) onchanged(answer as BugDetail);
			else failure = { text: apiErrorText(res.status, answer), reload: false };
		} catch (err) {
			failure = { text: err instanceof Error ? err.message : String(err), reload: false };
		} finally {
			busy = null;
		}
	}

	let panelEl = $state<HTMLElement | null>(null);
	let lightbox = $state<HTMLDialogElement | null>(null);
	let lightboxSrc = $state('');
	function openShot(id: string): void {
		lightboxSrc = shotUrl(id);
		lightbox?.showModal();
	}

	// ── Copying ───────────────────────────────────────────────────────────────
	async function copy(text: string, done: string): Promise<void> {
		try {
			await navigator.clipboard.writeText(text);
			notice = done;
		} catch {
			failure = { text: 'The browser did not allow copying to the clipboard.', reload: false };
		}
	}
	const copyLink = () =>
		copy(`${window.location.origin}${bugPath(detail)}`, `Link to ${ref} copied.`);
	const copyBrief = () =>
		copy(
			bugBrief(detail, window.location.origin),
			'Fix brief copied: paste it where the fix starts (an issue, a Claude Code session).',
		);
</script>

<article class="panel" aria-busy={busy !== null} bind:this={panelEl}>
	<section class="card">
		<div class="head">
			<div class="titles">
				<span class="mono ref">{ref}</span>
				{#if editing}
					<input
						class="title-input"
						type="text"
						bind:value={draft.title}
						maxlength={MAX_TITLE}
						aria-label="Title"
					/>
				{:else}
					<h2>{detail.title}</h2>
				{/if}
				<span class="pills">
					<Pill tone={statusTone(detail.status)} large>{statusLabel(detail.status)}</Pill>
					<Pill tone={priorityTone(detail.priority)} large>
						{detail.priority ? `Priority · ${priorityLabel(detail.priority)}` : NO_PRIORITY_LABEL}
					</Pill>
					{#if detail.sentAt}<Pill tone="amber" tag>in Pipeline Changes</Pill>{/if}
				</span>
			</div>
			<div class="head-actions">
				<button type="button" class="btn" onclick={copyLink}>Copy link</button>
				{#if detail.canEdit && !editing}
					<button type="button" class="btn" disabled={busy !== null} onclick={startEdit}
						>Edit</button
					>
				{/if}
			</div>
		</div>

		{#if editing}
			<div class="row">
				<label class="field">
					<span>{areaLabel}</span>
					<select bind:value={draft.area}>
						{#each areas as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
					</select>
				</label>
				{#if !game}
					<label class="field">
						<span>Project</span>
						<select bind:value={draft.project}>
							<option value="">Not about one project</option>
							{#each projects as p (p.key)}
								<option value={p.key}
									>{p.clientName ? `${p.clientName} · ${p.name}` : p.name}</option
								>
							{/each}
							{#if detail.projectKey && !projects.some((p) => p.key === detail.projectKey)}
								<option value={detail.projectKey}>{detail.projectKey}</option>
							{/if}
						</select>
					</label>
				{/if}
			</div>
			<label class="field">
				<span>Where it happened</span>
				<input type="url" bind:value={draft.pageUrl} placeholder="https://…" />
			</label>
			<label class="field">
				<span>Description</span>
				<textarea bind:value={draft.description} maxlength={MAX_DESCRIPTION} rows="10"></textarea>
			</label>
			<div class="actions">
				<button type="button" class="btn" disabled={busy !== null} onclick={() => (editing = false)}
					>Cancel</button
				>
				<button
					type="button"
					class="btn primary"
					disabled={busy !== null || !draft.title.trim()}
					onclick={saveEdit}>{busy ?? 'Save'}</button
				>
			</div>
		{:else}
			<dl class="meta">
				<div>
					<dt>Reported by</dt>
					<dd>{detail.reporter} · {timeAgo(detail.createdAt, now)}</dd>
				</div>
				<div>
					<dt>{areaLabel}</dt>
					<dd>{bugAreaName(detail.kind, detail.area)}</dd>
				</div>
				<div>
					<dt>{game ? 'Game' : 'Project'}</dt>
					<dd>{projectName(detail.projectKey) ?? '—'}</dd>
				</div>
				{#if detail.pageUrl}
					<div>
						<dt>Where</dt>
						<dd>
							{#if pageHref}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
								<a href={pageHref} target="_blank" rel="noopener noreferrer">{detail.pageUrl}</a>
							{:else}{detail.pageUrl}{/if}
						</dd>
					</div>
				{/if}
				{#if detail.statusBy && detail.statusAt}
					<div>
						<dt>Status set</dt>
						<dd>
							{detail.statusAuto ? `by ${detail.statusBy} (automatic)` : `by ${detail.statusBy}`} ·
							{timeAgo(detail.statusAt, now)}
						</dd>
					</div>
				{/if}
			</dl>
			{#if detail.description}
				<p class="description">{detail.description}</p>
			{:else}
				<p class="muted">No description.</p>
			{/if}
		{/if}

		{#if failure}
			<div class="error" role="alert">
				{failure.text}
				{#if failure.reload}<button type="button" class="btn small" onclick={reloadTheirs}
						>Reload</button
					>{/if}
			</div>
		{/if}
		{#if notice}<p class="notice" role="status">{notice}</p>{/if}
	</section>

	<section class="card" aria-labelledby="triage-h">
		<div class="card-head">
			<h3 id="triage-h">Triage</h3>
			{#if !canTriage}<span class="muted small"
					>Read-only: needs “{bugTriageName(detail.kind)}”.</span
				>{/if}
		</div>
		<div class="triage">
			<label class="field">
				<span>Priority</span>
				<select
					value={detail.priority ?? ''}
					disabled={!canTriage || busy !== null}
					onchange={(e) => setPriority(e.currentTarget)}
				>
					<option value="">{NO_PRIORITY_LABEL}</option>
					{#each BUG_PRIORITIES as p (p)}<option value={p}>{BUG_PRIORITY_LABELS[p]}</option>{/each}
				</select>
			</label>
			<div class="field">
				<span id="status-label">Status</span>
				<div class="segmented" role="group" aria-labelledby="status-label">
					{#each BUG_STATUSES as s (s)}
						<button
							type="button"
							class="seg {statusTone(s)}"
							class:on={detail.status === s}
							aria-pressed={detail.status === s}
							disabled={!canTriage || busy !== null}
							onclick={() => send({ action: 'status', status: s }, 'Saving…')}
						>
							{statusLabel(s)}
						</button>
					{/each}
				</div>
			</div>
		</div>

		<div class="pipeline">
			{#if game}
				<p class="muted">
					A game bug is fixed in this project's own content, not through Pipeline Changes. The fix
					brief asks for exactly that; if the cause turns out to be in the engine or a tool,
					escalate it to the pipeline.
				</p>
				<div class="actions">
					<button type="button" class="btn" onclick={copyBrief}>Copy fix brief</button>
				</div>
			{:else if detail.sentAt}
				<p>
					In <strong>Pipeline Changes</strong> since {timeAgo(detail.sentAt, now)}{detail.sentBy
						? `, sent by ${detail.sentBy}`
						: ''}.
				</p>
				<div class="actions">
					{#if canOpenPipeline}
						<!-- A query on another route: `resolve()` cannot carry one. -->
						<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
						<a class="btn" href="/pipeline?tab=bugs">Open in Pipeline Changes</a>
					{/if}
					<button type="button" class="btn" onclick={copyBrief}>Copy fix brief</button>
					{#if canTriage}
						<button
							type="button"
							class="btn"
							disabled={busy !== null}
							onclick={() => send({ action: 'unsend' }, 'Taking back…')}>Take back</button
						>
					{/if}
				</div>
			{:else}
				<p class="muted">
					Not sent to Pipeline Changes. Sending it puts it on the Bugs tab there, where whoever
					fixes it picks it up; the fix is a pipeline change like any other.
				</p>
				<div class="actions">
					{#if canTriage}
						<button
							type="button"
							class="btn primary"
							disabled={busy !== null}
							onclick={() => send({ action: 'send' }, 'Sending…')}
						>
							Send to Pipeline Changes
						</button>
					{/if}
					<button type="button" class="btn" onclick={copyBrief}>Copy fix brief</button>
				</div>
			{/if}
		</div>
	</section>

	{#if game}
		<RepairCard {detail} {repair} {pipelineAreas} {canOpenPipelineBugs} {now} {onchanged} />
	{:else if escalatedFrom !== null}
		<section class="card" aria-labelledby="escalated-h">
			<div class="card-head">
				<h3 id="escalated-h">Escalated from a game bug</h3>
			</div>
			<p>
				Filed from game bug <span class="mono">{bugRef(escalatedFrom)}</span>.
				{#if canOpenGameBugs && detail.projectKey}
					<a
						href="{resolve('/game-bugs')}?project={encodeURIComponent(
							detail.projectKey,
						)}&bug={escalatedFrom}">Open it there</a
					>
				{/if}
			</p>
		</section>
	{/if}

	<section class="card" aria-labelledby="shots-h">
		<div class="card-head">
			<h3 id="shots-h">Screenshots · {detail.screenshotList.length}</h3>
		</div>
		{#if detail.screenshotList.length}
			<ul class="shots">
				{#each detail.screenshotList as s (s.id)}
					<li>
						<button
							type="button"
							class="shot"
							onclick={() => openShot(s.id)}
							aria-label="Open screenshot"
						>
							<img src={shotUrl(s.id)} alt={`Screenshot added by ${s.uploadedBy}`} loading="lazy" />
						</button>
						<span class="shot-meta">{s.uploadedBy} · {formatBytes(s.bytes)}</span>
						{#if s.canRemove}
							<button
								type="button"
								class="btn small"
								disabled={busy !== null}
								onclick={() => removeShot(s.id)}>Remove</button
							>
						{/if}
					</li>
				{/each}
			</ul>
		{:else}
			<p class="muted">No screenshots yet.</p>
		{/if}
		{#if detail.screenshotList.length < MAX_SCREENSHOTS}
			<ShotDrop
				onfiles={upload}
				within={panelEl}
				disabled={busy !== null || editing}
				room={MAX_SCREENSHOTS - detail.screenshotList.length}
			/>
		{/if}
	</section>

	{#if !game}
		<section class="card" aria-labelledby="links-h">
			<div class="card-head">
				<h3 id="links-h">Pull requests · {detail.links.length}</h3>
			</div>
			<p class="muted">
				A pull request into main that names <span class="mono">{ref}</span> in its title, branch or description
				is linked here by itself. While one is open an Open bug shows Working on; when one merges, the
				bug is Resolved. A status set by hand stays until a linked pull request changes again.
			</p>
			{#if syncLine}<p class="warn">{syncLine}</p>{/if}
			{#if detail.links.length}
				<ul class="links">
					{#each detail.links as l (l.number)}
						<li>
							<Pill tone={linkTone(l.state)}>{LINK_STATE_LABELS[l.state]}</Pill>
							{#if l.url}
								<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
								<a href={l.url} target="_blank" rel="noopener noreferrer">#{l.number} {l.title} ↗</a
								>
							{:else}
								<span>#{l.number} {l.title}</span>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{/if}

	<section class="card" aria-labelledby="activity-h">
		<div class="card-head">
			<h3 id="activity-h">Activity</h3>
		</div>
		<ol class="events">
			{#each detail.events as e (e.id)}
				<li class:auto={e.auto}>
					<span class="event-line">
						<strong>{e.actor}</strong>
						{eventText(e)}
						<span class="when" title={e.at}>{timeAgo(e.at, now)}</span>
					</span>
					{#if eventNote(e)}
						<p class="comment">{eventNote(e)}</p>
					{/if}
				</li>
			{/each}
		</ol>
		<label class="field">
			<span>Add a comment</span>
			<textarea bind:value={comment} maxlength={MAX_COMMENT} rows="3"></textarea>
		</label>
		<div class="actions">
			<button
				type="button"
				class="btn"
				disabled={busy !== null || !comment.trim()}
				onclick={postComment}>Comment</button
			>
		</div>
	</section>
</article>

<dialog
	class="lightbox"
	bind:this={lightbox}
	aria-label="Screenshot"
	onclick={() => lightbox?.close()}
>
	{#if lightboxSrc}
		<figure>
			<img src={lightboxSrc} alt="Screenshot" />
			<figcaption>{ref} · click or press Escape to close</figcaption>
		</figure>
	{/if}
</dialog>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}
	.titles {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
		flex: 1 1 300px;
	}
	.ref {
		color: #8a8a96;
	}
	.title-input {
		font-size: 16px;
		font-weight: 700;
	}
	.pills,
	.head-actions,
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.actions {
		justify-content: flex-end;
	}
	.row {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
		gap: 12px;
	}
	.meta {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
		gap: 8px 16px;
		margin: 0;
	}
	.meta div {
		min-width: 0;
	}
	dt {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #80808c;
	}
	dd {
		margin: 2px 0 0;
		color: #d8d8df;
		overflow-wrap: anywhere;
	}
	.description,
	.comment {
		margin: 0;
		white-space: pre-wrap;
		overflow-wrap: anywhere;
		line-height: 1.55;
		color: #d8d8df;
	}
	.comment {
		padding: 8px 10px;
		border-left: 2px solid #2c2c38;
		background: #121218;
		border-radius: 0 6px 6px 0;
	}
	.notice {
		margin: 0;
		font-size: 12px;
		color: #9fd9c2;
	}
	.warn {
		margin: 0;
		font-size: 12px;
		color: #f5b95c;
	}
	.small {
		font-size: 12px;
	}
	.triage {
		display: grid;
		grid-template-columns: minmax(160px, 220px) 1fr;
		gap: 12px;
		align-items: end;
	}
	@media (max-width: 700px) {
		.triage {
			grid-template-columns: 1fr;
		}
	}
	.segmented {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
	}
	.seg {
		min-height: 32px;
		padding: 0 12px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #b9b9c4;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.seg:disabled {
		cursor: default;
	}
	.seg:hover:not(:disabled) {
		border-color: #3a3a48;
		color: #e8e8ee;
	}
	.seg.on.blue {
		background: #17212a;
		border-color: #6ea8ff;
		color: #a9cfe4;
	}
	.seg.on.amber {
		background: #2d2516;
		border-color: #f5b95c;
		color: #f5b95c;
	}
	.seg.on.green {
		background: #1a2320;
		border-color: #7ee0c0;
		color: #9fd9c2;
	}
	.seg.on.muted {
		background: #23232e;
		border-color: #9a9aa6;
		color: #e8e8ee;
	}
	.seg:focus-visible,
	.shot:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.pipeline {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 12px;
		border-top: 1px solid #23232e;
	}
	.pipeline p {
		margin: 0;
	}
	.shots {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
		gap: 10px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.shots li {
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 0;
	}
	.shot {
		padding: 0;
		border: 1px solid #23232e;
		border-radius: 8px;
		background: #121218;
		cursor: zoom-in;
		overflow: hidden;
	}
	.shot img {
		display: block;
		width: 100%;
		height: 110px;
		object-fit: cover;
	}
	.shot-meta {
		font-size: 11px;
		color: #9a9aa6;
		overflow-wrap: anywhere;
	}
	.links,
	.events {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.links li {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.events li {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.event-line {
		color: #c9c9d1;
	}
	.events li.auto .event-line strong {
		color: #f778ba;
	}
	.when {
		margin-left: 6px;
		font-size: 12px;
		color: #80808c;
	}
	a {
		color: #a9cfe4;
	}
	.lightbox {
		max-width: min(96vw, 1400px);
		max-height: 96vh;
		padding: 0;
		border: 1px solid #2c2c38;
		border-radius: 12px;
		background: #0b0b0f;
		color: #e8e8ee;
		cursor: zoom-out;
	}
	.lightbox::backdrop {
		background: rgba(0, 0, 0, 0.75);
	}
	.lightbox figure {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
	}
	.lightbox img {
		display: block;
		max-width: 92vw;
		max-height: 84vh;
		object-fit: contain;
		border-radius: 8px;
	}
	.lightbox figcaption {
		font-size: 12px;
		color: #9a9aa6;
		text-align: center;
	}
</style>
