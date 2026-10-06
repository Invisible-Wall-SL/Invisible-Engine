<script lang="ts">
	import { askConfirm, askText } from '$lib/dialogs.svelte';
	import type { PipelineApproval } from '$lib/server/pipelineApprovals';
	import type { ApproveResult, ChangeDetail } from '$lib/server/pipelineChanges';
	import type { MergeResult } from '$lib/server/pipelineMerge';
	import Pill from './Pill.svelte';
	import ScreenCompare from './ScreenCompare.svelte';
	import {
		MERGE_RETRY_TEXT,
		NO_CHECKS_TEXT,
		apiErrorText,
		approvalBlocker,
		approvalState,
		blockedReason,
		check1Summary,
		check2Summary,
		imagesArtifactId,
		jobWord,
		lapsedApprovals,
		mergeBar,
		mergeConfirmMessage,
		mergedText,
		plural,
		reportImageUrl,
		rowCells,
		safeHref,
		statusPill,
		timeAgo,
	} from './view';

	let {
		detail,
		canMerge,
		now,
		onchanged,
	}: {
		detail: ChangeDetail;
		canMerge: boolean;
		now: number;
		/** Re-reads the detail; resolves whether it did. */
		onchanged: () => Promise<boolean>;
	} = $props();

	const GAMES_SHOWN = 5;
	const FILES_SHOWN = 40;
	const IMAGES_GONE =
		'The screen images are gone (GitHub keeps them 3 days); the report still lists the difference.';

	let showAllGames = $state(false);
	let showAllFiles = $state(false);
	let busy = $state<string | null>(null);
	let failures = $state<Record<string, string>>({});
	let notice = $state<{ tone: 'amber' | 'green'; text: string } | null>(null);
	/** Approvals made on this page, shown until a re-read brings the server's own. */
	let approvedHere = $state<Record<string, PipelineApproval>>({});
	/** The confirmed merge, kept while its answer is unknown: Try again resends the same request id
	 *  and head, and the server answers a resend with the merge it already made. */
	let mergeRequest = $state<{ requestId: string; headSha: string } | null>(null);
	let mergeError = $state<{ text: string; retry: boolean } | null>(null);
	let merged = $state<MergeResult | null>(null);

	const harness = $derived({
		...detail.harness,
		diffs: detail.harness.diffs.map((d) => ({
			...d,
			approval: d.approval ?? approvedHere[d.id] ?? null,
		})),
	});
	const pill = $derived(statusPill(detail.status));
	const blocked = $derived(blockedReason(detail));
	const c1 = $derived(check1Summary(detail.checks));
	const c1Tone = $derived(
		c1.kind === 'pass'
			? 'green'
			: c1.kind === 'fail'
				? 'red'
				: c1.kind === 'pending'
					? 'blue'
					: 'muted',
	);
	const c2 = $derived(check2Summary(harness));
	const approvals = $derived(approvalState(harness));
	const blocker = $derived(approvalBlocker(harness));
	const imagesId = $derived(imagesArtifactId(harness));
	const ready = $derived(harness.report.state === 'ready' ? harness.report : null);
	const notReady = $derived(harness.report.state !== 'ready' ? harness.report : null);
	const rows = $derived(ready ? ready.report.games : []);
	const visibleRows = $derived(showAllGames ? rows : rows.slice(0, GAMES_SHOWN));
	const visibleFiles = $derived(showAllFiles ? detail.files : detail.files.slice(0, FILES_SHOWN));
	const open = $derived(detail.state === 'open');
	const canApprove = $derived(canMerge && open && harness.unapprovable === null);
	const prUrl = $derived(safeHref(detail.url));
	const diffUrl = $derived(safeHref(detail.diffUrl));
	const runUrl = $derived(safeHref(harness.run?.url));
	const statusUrl = $derived(safeHref(harness.status?.url));
	const bar = $derived(mergeBar(detail, canMerge, blocker?.byHand ?? false));

	const groupWord = (state: string): string =>
		state === 'fail' ? 'failed' : state === 'pending' ? 'running' : state;

	async function postApproval(diffId: string, note: string | null): Promise<ApproveResult> {
		const res = await fetch(`/api/pipeline/changes/${detail.number}/approvals`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(note ? { diffId, note } : { diffId }),
		});
		const body: unknown = await res.json().catch(() => null);
		if (!res.ok) throw new Error(apiErrorText(res.status, body));
		return body as ApproveResult;
	}

	async function reread(): Promise<void> {
		if (await onchanged()) approvedHere = {};
	}

	function report(result: ApproveResult): void {
		if (result.withheld) notice = { tone: 'amber', text: result.withheld };
		else if (result.statusPosted) {
			notice = {
				tone: 'green',
				text: `All ${result.of} changed ${plural(result.of, 'screen')} approved. current-games was posted as success.`,
			};
		}
	}

	async function approve(diffId: string, game: string, screen: string): Promise<void> {
		if (busy) return;
		const note = await askText({
			title: 'Approve this changed screen',
			message: `${game} · ${screen}\nThe difference is intended and the change may merge with it.`,
			label: 'Note (optional)',
			placeholder: 'Why the difference is intended',
			allowEmpty: true,
			confirmLabel: 'Approve',
		});
		if (note === null) return;
		busy = diffId;
		notice = null;
		failures = { ...failures, [diffId]: '' };
		try {
			const result = await postApproval(diffId, note.trim() || null);
			approvedHere = { ...approvedHere, [diffId]: result.approval };
			report(result);
			await reread();
		} catch (err) {
			failures = { ...failures, [diffId]: err instanceof Error ? err.message : String(err) };
		} finally {
			busy = null;
		}
	}

	async function merge(): Promise<void> {
		if (busy) return;
		const confirmed = await askConfirm({
			title: `Merge #${detail.number} into main`,
			message: mergeConfirmMessage(detail),
			confirmLabel: 'Merge',
		});
		if (!confirmed) return;
		mergeRequest = { requestId: crypto.randomUUID(), headSha: detail.headSha };
		await sendMerge();
	}

	async function sendMerge(): Promise<void> {
		const request = mergeRequest;
		if (busy || !request) return;
		busy = 'merge';
		mergeError = null;
		try {
			const res = await fetch(`/api/pipeline/changes/${detail.number}/merge`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(request),
			});
			const body: unknown = await res.json().catch(() => null);
			if (!res.ok) {
				const retry = res.status >= 500;
				mergeError = { text: apiErrorText(res.status, body), retry };
				if (!retry) mergeRequest = null;
				// A refusal means the change is not what this page shows (the head moved, it closed).
				if (res.status === 409) await reread();
				return;
			}
			merged = body as MergeResult;
			mergeRequest = null;
			await reread();
		} catch (err) {
			mergeError = { text: err instanceof Error ? err.message : String(err), retry: true };
		} finally {
			busy = null;
		}
	}

	async function postAgain(): Promise<void> {
		const first = harness.diffs[0];
		if (busy || !first) return;
		busy = 'repost';
		notice = null;
		failures = { ...failures, repost: '' };
		try {
			report(await postApproval(first.id, null));
			await reread();
		} catch (err) {
			failures = { ...failures, repost: err instanceof Error ? err.message : String(err) };
		} finally {
			busy = null;
		}
	}
</script>

<div class="panel">
	{#if blocked}
		<div class="callout red" role="alert">
			{blocked.text}
			{#if blocked.url}<a href={blocked.url} target="_blank" rel="external noopener">Details ↗</a
				>{/if}
		</div>
	{/if}

	<section class="card" aria-label="Change summary">
		<div class="head">
			<div class="titles">
				<span class="branch">{detail.branch}</span>
				<h2>{detail.title}</h2>
			</div>
			<span class="badges">
				<Pill tone={pill.tone} dot={pill.dot} large>{pill.label}</Pill>
				{#if detail.draft}<Pill tone="amber" tag>draft</Pill>{/if}
				{#if detail.agentDefinition}<Pill tone="amber" tag>agent definition</Pill>{/if}
			</span>
		</div>
		<p class="byline">
			Opened by {detail.author || 'unknown'} · {timeAgo(detail.openedAt, now)} ·
			{#if prUrl}
				<a href={prUrl} target="_blank" rel="external noopener">#{detail.number} ↗</a>
			{:else}
				#{detail.number}
			{/if}
		</p>
		{#if !open}<p class="byline">This pull request is {detail.state}.</p>{/if}

		<div class="why">
			<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
				<circle cx="8" cy="8" r="6"></circle>
				<path d="M8 7.5v4M8 5v.01"></path>
			</svg>
			{#if detail.why}
				<p><strong>Why:</strong> <span class="why-text">{detail.why}</span></p>
			{:else}
				<p class="dim">No reason given in the pull request.</p>
			{/if}
		</div>

		<div class="files">
			<span class="label">Files · {detail.files.length} changed</span>
			{#each visibleFiles as f (f.path)}
				{@const fileUrl = safeHref(f.url)}
				<div class="file">
					<span class="path">
						{#if f.previousPath}<span class="dim">{f.previousPath} →</span>{/if}
						{#if fileUrl}
							<a class="plain" href={fileUrl} target="_blank" rel="external noopener">{f.path}</a>
						{:else}
							{f.path}
						{/if}
						{#if f.previousPath}<Pill tone="muted" tag>{f.status}</Pill>{/if}
					</span>
					<span class="delta">
						{#if f.status === 'removed'}
							<span class="del">−{f.deletions}</span> <span class="dim">deleted</span>
						{:else if f.status === 'added'}
							<span class="add">+{f.additions}</span> <span class="dim">new</span>
						{:else}
							<span class="add">+{f.additions}</span> <span class="del">−{f.deletions}</span>
						{/if}
					</span>
				</div>
			{/each}
			{#if detail.files.length > FILES_SHOWN}
				<div class="row-actions">
					<button type="button" class="btn" onclick={() => (showAllFiles = !showAllFiles)}>
						{showAllFiles ? 'Show fewer files' : `Show all ${detail.files.length} files`}
					</button>
				</div>
			{/if}
			{#if detail.filesTruncated}
				<p class="dim note">GitHub lists only the first 3000 files of this change.</p>
			{/if}
		</div>
		{#if diffUrl}
			<div>
				<a class="btn" href={diffUrl} target="_blank" rel="external noopener">View diff</a>
			</div>
		{/if}
	</section>

	<section class="card" aria-labelledby="check1">
		<div class="card-head">
			<h3 id="check1">Check 1 · Pipeline tests</h3>
			<Pill tone={c1Tone} large>{c1.label}</Pill>
		</div>
		{#if !detail.checks.length}
			<p class="dim">{NO_CHECKS_TEXT}</p>
		{:else}
			<div class="tiles">
				{#each detail.checks as g (g.workflow)}
					{@const groupUrl = safeHref(g.url)}
					{#if groupUrl}
						<a class="tile {g.state}" href={groupUrl} target="_blank" rel="external noopener">
							<span class="t-name">{g.workflow}</span>
							<span class="t-val">{g.passed} / {g.total}</span>
							{#if g.state !== 'pass'}<span class="t-state">{groupWord(g.state)}</span>{/if}
						</a>
					{:else}
						<div class="tile {g.state}">
							<span class="t-name">{g.workflow}</span>
							<span class="t-val">{g.passed} / {g.total}</span>
							{#if g.state !== 'pass'}<span class="t-state">{groupWord(g.state)}</span>{/if}
						</div>
					{/if}
				{/each}
			</div>
			<details class="jobs">
				<summary>Jobs</summary>
				{#each detail.checks as g (g.workflow)}
					<h4>{g.workflow}</h4>
					<ul>
						{#each g.jobs as job, i (`${job.name}:${i}`)}
							{@const jobUrl = safeHref(job.url)}
							<li>
								<span class="job-state {job.state}">{jobWord(job)}</span>
								{#if jobUrl}
									<a href={jobUrl} target="_blank" rel="external noopener">{job.name}</a>
								{:else}
									{job.name}
								{/if}
							</li>
						{/each}
					</ul>
				{/each}
			</details>
		{/if}
	</section>

	<section class="card" aria-labelledby="check2">
		<div class="card-head">
			<h3 id="check2">Check 2 · Current games</h3>
			<Pill tone={c2.tone} large>{c2.label}</Pill>
		</div>
		<p class="dim">
			Every game in Game Maker is rebuilt with this branch, its tests run, and its key screens are
			compared with main.
		</p>

		{#if blocker}
			<div class="callout amber" role="status">
				{#if blocker.byHand}<strong>Merge by hand after review:</strong>{/if}
				{blocker.text}
			</div>
		{/if}

		{#if notReady}
			<p class="detail">
				{notReady.detail}
				{#if runUrl}<a href={runUrl} target="_blank" rel="external noopener">View the run ↗</a>{/if}
				{#if statusUrl}
					<a href={statusUrl} target="_blank" rel="external noopener">current-games status ↗</a>
				{/if}
			</p>
		{/if}

		{#if ready}
			<div class="scroll">
				<table>
					<thead>
						<tr>
							<th scope="col" class="first">Game</th>
							<th scope="col">Build</th>
							<th scope="col">Game tests</th>
							<th scope="col">Looks the same</th>
						</tr>
					</thead>
					<tbody>
						{#each visibleRows as row (`${row.key}@${row.variant ?? 'published'}`)}
							{@const cells = rowCells(row)}
							<tr>
								<td class="first">
									<span class="game">
										{row.name}{#if row.variant === 'republished'}
											<span class="dim variant">(as republished)</span>{/if}
									</span>
									<span class="sub">{row.projectKey ?? row.key}</span>
								</td>
								<td class={cells.build.tone}>{cells.build.text}</td>
								<td class={cells.tests.tone}>{cells.tests.text}</td>
								<td class={cells.looks.tone}>{cells.looks.text}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
			<div class="table-foot">
				{#if rows.length > GAMES_SHOWN}
					<button type="button" class="btn" onclick={() => (showAllGames = !showAllGames)}>
						{showAllGames ? 'Show fewer' : `Show all ${rows.length}`}
					</button>
				{:else}
					<span></span>
				{/if}
				<span class="dim">Any visible difference blocks the merge until you approve it.</span>
			</div>
			<p class="dim line">{ready.report.summary.line}</p>
		{/if}

		{#if harness.diffs.length}
			<div class="changed">
				<span class="label">Changed screens · {harness.diffs.length}</span>

				{#if approvals === 'complete'}
					<div class="callout green" role="status">
						All {harness.diffs.length} changed {plural(harness.diffs.length, 'screen')} approved · current-games
						was posted as success{harness.status?.description
							? ` (${harness.status.description})`
							: ''}
					</div>
				{:else if approvals === 'complete-unposted'}
					<div class="callout amber" role="status">
						<span
							>Every changed screen is approved, but a re-run reset current-games on this head.</span
						>
						{#if canMerge && open}
							<button type="button" class="btn" disabled={busy !== null} onclick={postAgain}>
								{busy === 'repost' ? 'Posting…' : 'Post approval again'}
							</button>
						{/if}
						{#if failures.repost}<span class="err" role="alert">{failures.repost}</span>{/if}
					</div>
				{/if}
				{#if notice && !(notice.tone === 'green' && approvals === 'complete')}
					<div class="callout {notice.tone}" role="status">{notice.text}</div>
				{/if}

				{#each harness.diffs as d (d.id)}
					{@const lapsed = lapsedApprovals(harness, d.id)}
					<div class="diff">
						<div class="diff-head">
							<strong>
								{d.game}{d.variant === 'republished' ? ' (as republished)' : ''} · {d.screen}
							</strong>
							<span class="dim">{d.scenario}</span>
							{#if d.reason}<span class="dim">{d.reason}</span>{/if}
						</div>

						{#if imagesId === null}
							<p class="dim">{IMAGES_GONE}</p>
						{:else if d.images && (d.images.before || d.images.after || d.images.diff)}
							<ScreenCompare
								alt={`${d.game} · ${d.screen}`}
								before={d.images.before
									? reportImageUrl(detail.number, imagesId, d.images.before)
									: undefined}
								after={d.images.after
									? reportImageUrl(detail.number, imagesId, d.images.after)
									: undefined}
								diff={d.images.diff
									? reportImageUrl(detail.number, imagesId, d.images.diff)
									: undefined}
							/>
						{:else}
							<p class="dim">The report has no images for this screen.</p>
						{/if}

						<div class="approval">
							{#if d.approval}
								<span class="ok">
									<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
										<path d="M3 8.5l3.2 3L13 4.5"></path>
									</svg>
									Approved by {d.approval.approver} · {timeAgo(d.approval.at, now)}
								</span>
								{#if d.approval.note}<span class="note-text">“{d.approval.note}”</span>{/if}
							{:else}
								<span class="dim">Not approved</span>
							{/if}
						</div>
						{#each lapsed as a (a.id)}
							<p class="lapsed">
								{a.approver}'s approval no longer counts: they no longer hold Merge pipeline
								changes.
							</p>
						{/each}
						{#if canApprove && !d.approval}
							<div>
								<button
									type="button"
									class="btn primary"
									disabled={busy !== null}
									onclick={() => approve(d.id, d.game, d.screen)}
								>
									{busy === d.id ? 'Approving…' : 'Approve'}
								</button>
							</div>
						{/if}
						{#if failures[d.id]}<p class="err" role="alert">{failures[d.id]}</p>{/if}
					</div>
				{/each}

				{#if !canMerge && !blocker?.byHand}
					<p class="dim">Approving needs the Merge pipeline changes capability.</p>
				{/if}
			</div>
		{/if}
	</section>

	{#if merged}
		<div class="bar green" role="status">
			<div class="bar-text">
				<span class="bar-title">{mergedText(merged, now)}</span>
				<span class="bar-sub">You can roll back from History.</span>
			</div>
		</div>
	{:else if open && detail.status.kind === 'ready'}
		<div class="bar green">
			<div class="bar-text">
				<span class="bar-title">All checks passed</span>
				<span class="bar-sub">{bar.text}</span>
			</div>
			{#if bar.action}
				<button
					type="button"
					class="btn primary large"
					disabled={bar.action === 'draft' || busy !== null}
					onclick={merge}
				>
					<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="4.5" cy="3.5" r="1.5"></circle>
						<circle cx="4.5" cy="12.5" r="1.5"></circle>
						<circle cx="11.5" cy="8.5" r="1.5"></circle>
						<path d="M4.5 5v6M4.5 5c0 2.5 2.5 3.5 5.5 3.5"></path>
					</svg>
					{busy === 'merge' ? 'Merging…' : 'Merge into main'}
				</button>
			{/if}
		</div>
	{:else if open && detail.status.kind === 'testing'}
		<div class="bar blue">
			<span class="bar-title">Still testing · {detail.status.done} of {detail.status.total}</span>
		</div>
	{/if}
	{#if mergeError}
		<div class="callout red" role="alert">
			<span>{mergeError.text}</span>
			{#if mergeError.retry && mergeRequest}
				<span>{MERGE_RETRY_TEXT}</span>
				<button type="button" class="btn" disabled={busy !== null} onclick={sendMerge}>
					{busy === 'merge' ? 'Merging…' : 'Try again'}
				</button>
			{/if}
		</div>
	{/if}
</div>

<style>
	.panel {
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-width: 0;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
	}
	.head,
	.card-head {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 10px;
	}
	.card-head {
		align-items: center;
	}
	.titles {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.branch,
	.path,
	.file,
	.delta {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
	}
	.branch {
		font-size: 12px;
		color: #8a8a96;
		overflow-wrap: anywhere;
	}
	h2 {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
		color: #e8e8ee;
		overflow-wrap: anywhere;
	}
	h3 {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		color: #e8e8ee;
	}
	h4 {
		margin: 10px 0 4px;
		font-size: 11px;
		font-weight: 700;
		color: #9a9aa6;
	}
	p {
		margin: 0;
		font-size: 13px;
		color: #c9c9d1;
	}
	.badges {
		display: inline-flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.byline {
		color: #9a9aa6;
		font-size: 12px;
	}
	.dim {
		color: #9a9aa6;
	}
	.variant {
		margin-left: 0.35em;
		font-weight: 400;
	}
	a {
		color: #7ee0c0;
	}
	a:hover {
		color: #a8f0d8;
	}
	a.plain {
		color: inherit;
		text-decoration: none;
	}
	a.plain:hover {
		text-decoration: underline;
	}
	a:focus-visible,
	button:focus-visible,
	summary:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}

	.callout {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 8px;
		padding: 10px 14px;
		border: 1px solid;
		border-radius: 10px;
		font-size: 13px;
	}
	.callout.red {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	.callout.red a {
		color: #ffc2c2;
	}
	.callout.amber {
		background: #2d2516;
		border-color: #5a4620;
		color: #f5b95c;
	}
	.callout.green {
		background: #1a2320;
		border-color: #2b5546;
		color: #9fd9c2;
	}

	.why {
		display: flex;
		align-items: flex-start;
		gap: 10px;
		padding: 10px 12px;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 8px;
	}
	.why svg {
		flex: none;
		margin-top: 2px;
		fill: none;
		stroke: #9a9aa6;
		stroke-width: 1.4;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.why strong {
		color: #e8e8ee;
	}
	.why-text {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}

	.label {
		padding-bottom: 6px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
	}
	.files {
		display: flex;
		flex-direction: column;
	}
	.file {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 10px;
		padding: 7px 0;
		border-top: 1px solid #1d1d24;
		font-size: 12px;
	}
	.path {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		min-width: 0;
		color: #c9c9d1;
		overflow-wrap: anywhere;
	}
	.add {
		color: #7ee787;
	}
	.del {
		color: #ff9d9d;
	}
	.note {
		padding-top: 6px;
		font-size: 12px;
	}
	.row-actions {
		padding-top: 8px;
	}

	.btn {
		display: inline-flex;
		align-items: center;
		min-height: 32px;
		padding: 0 14px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
		cursor: pointer;
	}
	.btn:hover {
		background: #23232e;
		border-color: #3a3a48;
		color: #e8e8ee;
	}
	.btn:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.btn.primary {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	.btn.primary:hover:not(:disabled) {
		background: #26846a;
	}
	.btn.large {
		gap: 6px;
		min-height: 36px;
		padding: 0 16px;
		font-size: 13px;
	}
	.btn svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
	}

	.tiles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
		gap: 8px;
	}
	.tile {
		display: flex;
		flex-direction: column;
		padding: 8px 10px;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 8px;
		color: inherit;
		text-decoration: none;
	}
	a.tile:hover {
		border-color: #3a3a48;
		color: inherit;
	}
	.tile.fail {
		background: #2a1416;
		border-color: #6b2f33;
	}
	.tile.pending {
		background: #17212a;
		border-color: #27404f;
	}
	.t-name {
		font-size: 11px;
		color: #9a9aa6;
	}
	.t-val {
		font-size: 13px;
		font-weight: 700;
		color: #e8e8ee;
	}
	.t-state {
		font-size: 11px;
		color: #9a9aa6;
	}
	.tile.fail .t-state {
		color: #ff9d9d;
	}
	.tile.pending .t-state {
		color: #a9cfe4;
	}
	.jobs summary {
		cursor: pointer;
		font-size: 12px;
		font-weight: 600;
		color: #b9b9c4;
	}
	.jobs ul {
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 12px;
	}
	.jobs li {
		display: flex;
		gap: 8px;
		padding: 3px 0;
		color: #c9c9d1;
	}
	.job-state {
		flex: none;
		min-width: 60px;
		color: #9a9aa6;
	}
	.job-state.pass {
		color: #7ee787;
	}
	.job-state.fail {
		color: #ff9d9d;
	}
	.job-state.pending {
		color: #a9cfe4;
	}

	.detail {
		color: #c9c9d1;
	}
	.detail a {
		margin-left: 6px;
	}
	.scroll {
		overflow-x: auto;
	}
	table {
		width: 100%;
		min-width: 520px;
		border-collapse: collapse;
		font-size: 13px;
	}
	th {
		padding: 6px 8px;
		border-bottom: 1px solid #23232e;
		text-align: left;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #80808c;
	}
	td {
		padding: 9px 8px;
		border-bottom: 1px solid #1d1d24;
		vertical-align: top;
	}
	th.first,
	td.first {
		padding-left: 0;
	}
	tbody tr:last-child td {
		border-bottom: 0;
	}
	.game {
		display: block;
		font-weight: 700;
	}
	.sub {
		display: block;
		font-size: 11px;
		color: #9a9aa6;
	}
	td.green {
		color: #7ee787;
	}
	td.red {
		color: #ff9d9d;
	}
	td.muted {
		color: #9a9aa6;
	}
	.table-foot {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		font-size: 12px;
	}
	.line {
		font-size: 12px;
	}

	.changed {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding-top: 4px;
		border-top: 1px solid #1d1d24;
	}
	.changed .label {
		padding: 10px 0 0;
	}
	.changed .callout {
		margin: 0;
	}
	.diff {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		background: #0d0d12;
		border: 1px solid #23232e;
		border-radius: 10px;
	}
	.diff-head {
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 12px;
	}
	.diff-head strong {
		font-size: 13px;
		color: #e8e8ee;
	}
	.approval {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 4px 10px;
		font-size: 12px;
	}
	.ok {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: #7ee787;
	}
	.ok svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.8;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.note-text {
		color: #c9c9d1;
		font-style: italic;
		overflow-wrap: anywhere;
	}
	.lapsed {
		font-size: 12px;
		color: #f5b95c;
	}
	.err {
		font-size: 12px;
		color: #ff9d9d;
	}

	.bar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 14px;
		padding: 18px 20px;
		border: 1px solid;
		border-radius: 12px;
	}
	.bar-text {
		display: flex;
		flex-direction: column;
		gap: 3px;
		min-width: 0;
	}
	.bar.green {
		background: #121f1a;
		border-color: #2b5546;
	}
	.bar.blue {
		background: #17212a;
		border-color: #27404f;
	}
	.bar-title {
		font-size: 15px;
		font-weight: 700;
		color: #e8e8ee;
	}
	.bar.green .bar-sub {
		font-size: 12px;
		color: #9fd9c2;
	}
</style>
