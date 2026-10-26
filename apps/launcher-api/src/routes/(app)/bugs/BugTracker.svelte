<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import {
		BUG_STATUSES,
		BUG_TOOL,
		bugAreaName,
		bugRef,
		type BugKind,
		type BugStatus,
	} from '$lib/bugReports';
	import { TOOLS, roleLabel, type Role, type ToolDef } from '$lib/roles';
	import type { BugDetail, BugList, BugSummary, LinkSync } from '$lib/server/bugReports';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import Pill from '../pipeline/Pill.svelte';
	import { apiErrorText, timeAgo } from '../pipeline/view';
	import BugPanel from './BugPanel.svelte';
	import ReportForm from './ReportForm.svelte';
	import {
		DEFAULT_FILTERS,
		PRIORITY_FILTERS,
		SORT_LABELS,
		addressQuery,
		asSentFilter,
		asSortKey,
		filterBugs,
		filtersFromQuery,
		isDefaultFilters,
		linkTone,
		priorityFilterLabel,
		priorityLabel,
		priorityTone,
		sortBugs,
		statusCounts,
		statusLabel,
		statusTone,
		syncText,
		type BugFilters,
		type PriorityFilter,
	} from './view';

	type ProjectOption = { key: string; name: string; clientName: string | null };

	/**
	 * One bug list, either of the two tools on the same modules: `pipeline` (`/bugs`, every pipeline
	 * bug) or `game` (`/game-bugs`, the bugs of the one project `scope` names). Renders the whole page.
	 */
	let {
		kind,
		tools,
		user,
		projects,
		canTriage,
		selected: asked,
		report,
		areas,
		scope,
	}: {
		kind: BugKind;
		tools: ToolDef[];
		user: { name: string | null; email: string; role: Role };
		projects: ProjectOption[];
		canTriage: boolean;
		/** The bug a shared link opens. */
		selected: number | null;
		/** The report form a link opens, with what it already knows. */
		report: { area: string; pageUrl: string } | null;
		areas: { id: string; name: string }[];
		/** A game list's project, which is also the top bar's scope; null for the pipeline list. */
		scope: { clientKey: string; projectKey: string } | null;
	} = $props();

	const REFRESH_MS = 60_000;
	const game = untrack(() => kind === 'game');
	const toolName = TOOLS[BUG_TOOL[untrack(() => kind)]].name;
	const basePath = game ? '/game-bugs' : '/bugs';
	const projectKey = untrack(() => scope?.projectKey ?? null);

	let bugs = $state<BugSummary[] | null>(null);
	let sync = $state<LinkSync | null>(null);
	let listError = $state<string | null>(null);
	let listLoading = $state(true);
	let refreshing = $state(false);
	let now = $state(Date.now());

	let filters = $state<BugFilters>(
		filtersFromQuery(
			untrack(() => page.url.searchParams),
			untrack(() => kind),
		),
	);
	const initialSelected = untrack(() => asked);
	const initialReport = untrack(() => report);
	let selected = $state<number | null>(initialSelected);
	let reporting = $state(initialReport !== null);
	let detail = $state<BugDetail | null>(null);
	let detailError = $state<string | null>(null);
	let detailLoading = $state(initialSelected !== null && initialReport === null);
	let notice = $state<string | null>(null);
	let listSeq = 0;
	let detailSeq = 0;

	const who = $derived(user.name?.trim() || user.email.split('@')[0]);
	const shown = $derived(bugs ? sortBugs(filterBugs(bugs, filters), filters.sort) : []);
	const counts = $derived(bugs ? statusCounts(bugs) : null);
	const reporters = $derived(
		bugs ? [...new Set(bugs.map((b) => b.reporter))].sort((a, b) => a.localeCompare(b)) : [],
	);
	const projectsSeen = $derived(
		bugs
			? [...new Set(bugs.map((b) => b.projectKey).filter((k): k is string => k !== null))].sort()
			: [],
	);
	const areasSeen = $derived(
		areas.filter((a) => bugs?.some((b) => b.area === a.id) || a.id === filters.area),
	);
	const canOpenPipeline = $derived(tools.some((t) => t.id === 'pipelineChanges'));
	const syncLine = $derived(syncText(sync));

	const projectLabel = (key: string): string => {
		const p = projects.find((x) => x.key === key);
		return p ? (p.clientName ? `${p.clientName} · ${p.name}` : p.name) : key;
	};
	const listUrl = game
		? `/api/bugs?kind=game&project=${encodeURIComponent(projectKey ?? '')}`
		: '/api/bugs?kind=pipeline';

	async function getJson<T>(url: string): Promise<T> {
		const res = await fetch(url);
		const body: unknown = await res.json().catch(() => null);
		if (!res.ok) throw new Error(apiErrorText(res.status, body));
		return body as T;
	}

	const errorText = (err: unknown): string => (err instanceof Error ? err.message : String(err));

	async function loadList(): Promise<void> {
		const seq = ++listSeq;
		try {
			const next = await getJson<BugList>(listUrl);
			if (seq !== listSeq) return;
			bugs = next.bugs;
			sync = next.sync;
			listError = null;
		} catch (err) {
			if (seq === listSeq) listError = errorText(err);
		} finally {
			if (seq === listSeq) {
				listLoading = false;
				now = Date.now();
			}
		}
	}

	/** `quiet` keeps what is shown while the answer is awaited (a refresh, not a new selection). */
	async function loadDetail(number: number, quiet: boolean): Promise<void> {
		const seq = ++detailSeq;
		if (!quiet) {
			detail = null;
			detailError = null;
			detailLoading = true;
		}
		try {
			const next = await getJson<BugDetail>(`/api/bugs/${number}`);
			if (seq !== detailSeq) return;
			detail = next;
			detailError = null;
		} catch (err) {
			if (seq === detailSeq) detailError = errorText(err);
		} finally {
			if (seq === detailSeq) {
				detailLoading = false;
				now = Date.now();
			}
		}
	}

	async function refreshAll(): Promise<void> {
		if (refreshing) return;
		refreshing = true;
		try {
			await Promise.all([
				loadList(),
				selected === null || reporting ? Promise.resolve() : loadDetail(selected, detail !== null),
			]);
		} finally {
			refreshing = false;
		}
	}

	/** The address carries the filters and the open bug, so either is a link to share. */
	function writeAddress(): void {
		const search = addressQuery(filters, kind, projectKey, reporting ? null : selected);
		// A query on this same route: `resolve()` cannot carry one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(search ? `${basePath}?${search}` : basePath, {});
	}

	function select(number: number): void {
		notice = null;
		reporting = false;
		if (number === selected && detail) return writeAddress();
		selected = number;
		writeAddress();
		void loadDetail(number, false);
	}

	function startReport(): void {
		notice = null;
		reporting = true;
		writeAddress();
	}

	function cancelReport(): void {
		reporting = false;
		writeAddress();
		if (selected !== null && !detail) void loadDetail(selected, false);
	}

	function onCreated(bug: BugDetail, failed: string[]): void {
		reporting = false;
		selected = bug.number;
		detail = bug;
		detailError = null;
		notice = failed.length
			? `${bugRef(bug.number)} is reported, but not every screenshot uploaded: ${failed.join(' · ')}. Add them again below.`
			: `${bugRef(bug.number)} is reported. Thank you.`;
		writeAddress();
		void loadList();
	}

	/** An action in the panel answered the bug as it now stands: show it, and its list card. */
	function onChanged(next: BugDetail): void {
		if (next.number !== selected) return;
		detail = next;
		if (bugs) bugs = bugs.map((b) => (b.number === next.number ? next : b));
	}

	function setFilters(patch: Partial<BugFilters>): void {
		filters = { ...filters, ...patch };
		writeAddress();
	}

	function toggleStatus(s: BugStatus): void {
		const on = filters.status.includes(s);
		setFilters({ status: on ? filters.status.filter((x) => x !== s) : [...filters.status, s] });
	}

	function togglePriority(p: PriorityFilter): void {
		const on = filters.priority.includes(p);
		setFilters({
			priority: on ? filters.priority.filter((x) => x !== p) : [...filters.priority, p],
		});
	}

	onMount(() => {
		void loadList();
		if (selected !== null && !reporting) void loadDetail(selected, false);
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void refreshAll();
		}, REFRESH_MS);
		return () => clearInterval(timer);
	});
</script>

<svelte:head>
	<title>{toolName}{projectKey ? ` — ${projectKey}` : ''} — Invisible Wall</title>
</svelte:head>

{#snippet card(b: BugSummary)}
	<button
		type="button"
		class="bug"
		class:on={selected === b.number && !reporting}
		aria-pressed={selected === b.number && !reporting}
		onclick={() => select(b.number)}
	>
		<span class="bug-top">
			<span class="mono">{bugRef(b.number)}</span>
			<span class="tags">
				<Pill tone={priorityTone(b.priority)}>{priorityLabel(b.priority)}</Pill>
				<Pill tone={statusTone(b.status)}>{statusLabel(b.status)}</Pill>
			</span>
		</span>
		<span class="bug-title">{b.title}</span>
		<span class="bug-meta">
			{bugAreaName(b.kind, b.area)}{b.projectKey && !game ? ` · ${projectLabel(b.projectKey)}` : ''}
		</span>
		<span class="bug-meta">
			{b.reporter}{b.mine ? ' (you)' : ''} · {timeAgo(b.createdAt, now)}
			{#if b.screenshots}· {b.screenshots} screenshot{b.screenshots === 1 ? '' : 's'}{/if}
		</span>
		{#if b.sentAt || b.links.length}
			<span class="tags">
				{#if b.sentAt}<Pill tone="amber" tag>in Pipeline Changes</Pill>{/if}
				{#each b.links as l (l.number)}
					<Pill tone={linkTone(l.state)} tag>
						#{l.number}
						{l.state}
					</Pill>
				{/each}
			</span>
		{/if}
	</button>
{/snippet}

<div class="page">
	<ToolTopBar
		current={BUG_TOOL[kind]}
		{tools}
		clientKey={scope?.clientKey}
		projectKey={scope?.projectKey}
	>
		{#snippet meta()}
			<span class="who">
				{who} · <span class="role">{roleLabel(user.role)}</span> ·
				{canTriage ? 'can triage' : 'can report'}
			</span>
			<button type="button" class="refresh" disabled={refreshing} onclick={refreshAll}>
				Refresh
			</button>
		{/snippet}
	</ToolTopBar>

	<main class="body">
		<div class="heading">
			<div>
				{#if game}
					<h1>Game bugs · {projectLabel(projectKey ?? '')}</h1>
					<p>
						This project's own bug list: what is wrong in this game, with screenshots. Triage sets
						its priority and status; the fix brief asks for a fix in this project alone. A bug in
						the engine or a tool is a pipeline bug — report it in Pipeline Bug Reports.
					</p>
				{:else}
					<h1>Pipeline bugs</h1>
					<p>
						Report what is broken in a tool, the engine or the launcher, with screenshots. Triage
						sets its priority and status and sends it to Pipeline Changes to be fixed; a pull
						request that names its <span class="mono">BUG-</span> number moves it to Working on and, once
						merged, to Resolved. A problem in one game goes in that project's Game Bug Reports.
					</p>
				{/if}
			</div>
			<button type="button" class="btn primary large" onclick={startReport}>Report a bug</button>
		</div>

		<section class="filters" aria-label="Filters">
			<div class="chips" role="group" aria-label="Status">
				{#each BUG_STATUSES as s (s)}
					<button
						type="button"
						class="chip {statusTone(s)}"
						class:on={filters.status.includes(s)}
						aria-pressed={filters.status.includes(s)}
						onclick={() => toggleStatus(s)}
					>
						{statusLabel(s)}{counts ? ` · ${counts[s]}` : ''}
					</button>
				{/each}
			</div>
			<div class="chips" role="group" aria-label="Priority">
				{#each PRIORITY_FILTERS as p (p)}
					<button
						type="button"
						class="chip"
						class:on={filters.priority.includes(p)}
						aria-pressed={filters.priority.includes(p)}
						onclick={() => togglePriority(p)}
					>
						{priorityFilterLabel(p)}
					</button>
				{/each}
			</div>
			<div class="controls">
				<input
					class="search"
					type="search"
					placeholder="Search title, description, BUG-12, #1234…"
					aria-label="Search"
					value={filters.q}
					oninput={(e) => setFilters({ q: e.currentTarget.value })}
				/>
				<select
					aria-label={game ? 'Part of the game' : 'Tool or area'}
					value={filters.area}
					onchange={(e) => setFilters({ area: e.currentTarget.value })}
				>
					<option value="">{game ? 'Every part of the game' : 'Every tool and area'}</option>
					{#each areasSeen as a (a.id)}<option value={a.id}>{a.name}</option>{/each}
				</select>
				{#if !game}
					<select
						aria-label="Project"
						value={filters.project}
						onchange={(e) => setFilters({ project: e.currentTarget.value })}
					>
						<option value="">Every project</option>
						{#each projectsSeen as k (k)}<option value={k}>{projectLabel(k)}</option>{/each}
					</select>
				{/if}
				<select
					aria-label="Reported by"
					value={filters.reporter}
					onchange={(e) => setFilters({ reporter: e.currentTarget.value })}
				>
					<option value="">Anyone</option>
					{#each reporters as r (r)}<option value={r}>{r}</option>{/each}
				</select>
				{#if !game}
					<select
						aria-label="Pipeline Changes"
						value={filters.sent}
						onchange={(e) => setFilters({ sent: asSentFilter(e.currentTarget.value) })}
					>
						<option value="all">Sent or not</option>
						<option value="sent">In Pipeline Changes</option>
						<option value="notSent">Not sent</option>
					</select>
				{/if}
				<select
					aria-label="Sort"
					value={filters.sort}
					onchange={(e) => setFilters({ sort: asSortKey(e.currentTarget.value) })}
				>
					{#each Object.entries(SORT_LABELS) as [k, label] (k)}<option value={k}>{label}</option
						>{/each}
				</select>
				<label class="check">
					<input
						type="checkbox"
						checked={filters.mine}
						onchange={(e) => setFilters({ mine: e.currentTarget.checked })}
					/>
					Reported by me
				</label>
				{#if !isDefaultFilters(filters)}
					<button type="button" class="btn" onclick={() => setFilters({ ...DEFAULT_FILTERS })}>
						Reset filters
					</button>
				{/if}
			</div>
		</section>

		<div class="cols">
			<section class="list" aria-label="Bugs">
				{#if listError}<div class="error" role="alert">{listError}</div>{/if}
				{#if syncLine}<p class="note warn">{syncLine}</p>{/if}
				{#if listLoading && !bugs}
					<p class="loading" aria-busy="true">Loading bugs…</p>
				{:else if bugs}
					<p class="note">
						Showing {shown.length} of {bugs.length} bug{bugs.length === 1 ? '' : 's'}.
					</p>
					{#if !bugs.length}
						<div class="empty">
							<strong>No bugs reported {game ? 'in this game' : ''} yet.</strong>
							<p>Found one? Report it — it lands here for triage.</p>
						</div>
					{:else if !shown.length}
						<div class="empty">
							<strong>No bug matches these filters.</strong>
						</div>
					{/if}
					{#each shown as b (b.number)}
						{@render card(b)}
					{/each}
				{/if}
			</section>

			<section class="detail" aria-label="Bug details">
				{#if notice}<p class="notice" role="status">{notice}</p>{/if}
				{#if reporting}
					<ReportForm
						{kind}
						{areas}
						{projects}
						project={projectKey}
						initial={initialReport ?? { area: '', pageUrl: '' }}
						oncreated={onCreated}
						oncancel={cancelReport}
					/>
				{:else}
					{#if detailError}<div class="error" role="alert">{detailError}</div>{/if}
					{#if detail}
						{#key detail.number}
							<BugPanel
								{detail}
								{canTriage}
								{canOpenPipeline}
								{areas}
								{projects}
								{sync}
								{now}
								onchanged={onChanged}
								onreload={() => selected !== null && loadDetail(selected, true)}
							/>
						{/key}
					{:else if detailLoading}
						<div class="loading card" aria-busy="true">Loading {bugRef(selected ?? 0)}…</div>
					{:else if !detailError}
						<div class="empty">
							<strong>Select a bug</strong>
							<p>Its screenshots, triage, linked pull requests and activity appear here.</p>
						</div>
					{/if}
				{/if}
			</section>
		</div>
	</main>
</div>

<style>
	.page {
		min-height: 100vh;
		background: #0e0e12;
		color: #d8d8df;
		font-family: system-ui, sans-serif;
		font-size: 13px;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 16px;
		padding: 24px 24px 56px;
	}
	.who {
		color: #b9b9c4;
	}
	.role {
		color: #a99bff;
	}
	.refresh {
		min-height: 28px;
		padding: 0 12px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.refresh:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.heading {
		display: flex;
		flex-wrap: wrap;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}
	.heading > div {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1 1 480px;
	}
	h1 {
		margin: 0;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #b9b9c4;
	}
	.heading p {
		margin: 0;
		max-width: 900px;
		font-size: 13px;
		line-height: 1.5;
		color: #9a9aa6;
	}
	.filters {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		background: #121218;
		border: 1px solid #222;
		border-radius: 12px;
	}
	.chips,
	.controls {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.chip {
		min-height: 28px;
		padding: 0 12px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 999px;
		color: #9a9aa6;
		font-family: inherit;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
	}
	.chip:hover {
		color: #e8e8ee;
	}
	.chip.on {
		background: #23232e;
		border-color: #6b5bff;
		color: #e8e8ee;
	}
	.chip.on.blue {
		border-color: #6ea8ff;
	}
	.chip.on.amber {
		border-color: #f5b95c;
	}
	.chip.on.green {
		border-color: #7ee0c0;
	}
	.search {
		flex: 1 1 240px;
		min-width: 180px;
	}
	.check {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		color: #b9b9c4;
	}
	.cols {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-start;
	}
	.list {
		flex: 1 1 320px;
		max-width: 420px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.detail {
		flex: 1 1 560px;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	@media (max-width: 900px) {
		.list {
			flex-basis: 100%;
			max-width: none;
		}
		.detail {
			flex-basis: 100%;
		}
	}
	.bug {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 5px;
		padding: 14px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 13px;
		text-align: left;
		cursor: pointer;
	}
	.bug:hover {
		border-color: #3a3a48;
	}
	.bug.on {
		padding: 13px;
		border: 2px solid #7ee0c0;
	}
	.bug-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.bug-title {
		font-size: 14px;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.bug-meta {
		font-size: 12px;
		color: #9a9aa6;
		overflow-wrap: anywhere;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.note {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: #80808c;
	}
	.note.warn {
		color: #f5b95c;
	}
	.notice {
		margin: 0;
		padding: 10px 14px;
		background: #1a2320;
		border: 1px solid #2b5546;
		border-radius: 10px;
		color: #9fd9c2;
	}
	.loading {
		margin: 0;
		color: #9a9aa6;
	}
	.loading.card {
		padding: 20px;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		padding: 40px 24px;
		border: 1px dashed #2a2a33;
		border-radius: 12px;
		background: #121218;
		text-align: center;
	}
	.empty strong {
		color: #eee;
		font-size: 15px;
	}
	.empty p {
		margin: 0;
		max-width: 620px;
		color: #888;
		font-size: 13px;
		line-height: 1.5;
	}
	.bug:focus-visible,
	.chip:focus-visible,
	.refresh:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}

	/* Shared by the panel, the report form and the drop zone (each is a child of this page). */
	.page :global(.mono) {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 12px;
		color: #c9c9d1;
		overflow-wrap: anywhere;
	}
	.page :global(.card) {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
	}
	.page :global(.card-head) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}
	.page :global(h2) {
		margin: 0;
		font-size: 18px;
		font-weight: 700;
		color: #e8e8ee;
		overflow-wrap: anywhere;
	}
	.page :global(h3) {
		margin: 0;
		font-size: 15px;
		font-weight: 700;
		color: #e8e8ee;
	}
	.page :global(.muted) {
		margin: 0;
		color: #9a9aa6;
		line-height: 1.5;
	}
	.page :global(.field) {
		display: flex;
		flex-direction: column;
		gap: 4px;
		min-width: 0;
	}
	.page :global(.field > span) {
		font-size: 11px;
		font-weight: 700;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #9a9aa6;
	}
	.page :global(input[type='text']),
	.page :global(input[type='url']),
	.page :global(input[type='search']),
	.page :global(select),
	.page :global(textarea) {
		min-height: 32px;
		padding: 6px 10px;
		background: #0e0e12;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-family: inherit;
		font-size: 13px;
	}
	.page :global(textarea) {
		resize: vertical;
		line-height: 1.5;
	}
	.page :global(input:focus-visible),
	.page :global(select:focus-visible),
	.page :global(textarea:focus-visible),
	.page :global(.btn:focus-visible) {
		outline: 2px solid #6ea8ff;
		outline-offset: 1px;
	}
	.page :global(.btn) {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
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
	.page :global(.btn:hover:not(:disabled)) {
		background: #23232e;
		border-color: #3a3a48;
	}
	.page :global(.btn:disabled) {
		opacity: 0.55;
		cursor: default;
	}
	.page :global(.btn.primary) {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	.page :global(.btn.primary:hover:not(:disabled)) {
		background: #26846a;
	}
	.page :global(.btn.large) {
		min-height: 36px;
		padding: 0 16px;
		font-size: 13px;
	}
	.page :global(.btn.small) {
		min-height: 26px;
		padding: 0 10px;
		font-size: 11px;
	}
	.page :global(.error) {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 12px 14px;
		background: #2a1416;
		border: 1px solid #6b2f33;
		border-radius: 10px;
		color: #ff9d9d;
		font-size: 13px;
	}
</style>
