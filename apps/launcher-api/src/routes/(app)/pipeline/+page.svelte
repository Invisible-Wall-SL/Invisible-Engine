<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { replaceState } from '$app/navigation';
	import { askConfirm } from '$lib/dialogs.svelte';
	import { roleLabel } from '$lib/roles';
	import type { AgentDetail, AgentList, AgentSummary } from '$lib/server/pipelineAgents';
	import type { ChangeDetail, ChangeList, ChangeSummary } from '$lib/server/pipelineChanges';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';
	import AgentPanel from './AgentPanel.svelte';
	import ChangeDetailPanel from './ChangeDetailPanel.svelte';
	import Pill from './Pill.svelte';
	import {
		apiErrorText,
		changedText,
		effortLabel,
		openChangesWord,
		plural,
		shortSha,
		statusPill,
		timeAgo,
		toolsWord,
	} from './view';

	let { data }: { data: PageData } = $props();

	const REFRESH_MS = 60_000;

	const TABS = [
		{ id: 'changes', label: 'Changes' },
		{ id: 'agents', label: 'Agents' },
		{
			id: 'history',
			label: 'History',
			empty: 'Nothing has been merged yet.',
			body: 'Merges, who approved them, and rollbacks will be listed here. Every merge can be rolled back.',
		},
	] as const;

	type TabId = (typeof TABS)[number]['id'];
	const initialAgent = untrack(() => data.agent);
	let tab = $state<TabId>(initialAgent !== null ? 'agents' : 'changes');

	function onTabKeydown(e: KeyboardEvent) {
		const i = TABS.findIndex((t) => t.id === tab);
		let next = i;
		if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = TABS.length - 1;
		else return;
		e.preventDefault();
		showTab(TABS[next].id);
		document.getElementById(`tab-${TABS[next].id}`)?.focus();
	}

	let list = $state<ChangeList | null>(null);
	let listError = $state<string | null>(null);
	let listLoading = $state(true);
	const initialSelected = untrack(() => data.selected);
	let selected = $state<number | null>(initialSelected);
	let detail = $state<ChangeDetail | null>(null);
	let detailError = $state<string | null>(null);
	let detailLoading = $state(initialSelected !== null);
	let agentList = $state<AgentList | null>(null);
	let agentListError = $state<string | null>(null);
	let agentListLoading = $state(false);
	let selectedAgent = $state<string | null>(initialAgent);
	let agentDetail = $state<AgentDetail | null>(null);
	let agentError = $state<string | null>(null);
	let agentLoading = $state(false);
	/** The open editor holds text that is not yet a change. */
	let agentDirty = $state(false);
	let agentsStarted = false;
	let refreshing = $state(false);
	let now = $state(Date.now());
	let listSeq = 0;
	let detailSeq = 0;
	let agentListSeq = 0;
	let agentSeq = 0;

	const who = $derived(data.user.name?.trim() || data.user.email.split('@')[0]);
	const changeCount = $derived(list ? list.changes.length : null);

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
			const next = await getJson<ChangeList>('/api/pipeline/changes');
			if (seq !== listSeq) return;
			list = next;
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
	async function loadDetail(number: number, quiet: boolean): Promise<boolean> {
		const seq = ++detailSeq;
		if (!quiet) {
			detail = null;
			detailError = null;
			detailLoading = true;
		}
		try {
			const next = await getJson<ChangeDetail>(`/api/pipeline/changes/${number}`);
			if (seq !== detailSeq) return false;
			detail = next;
			detailError = null;
			return true;
		} catch (err) {
			if (seq === detailSeq) detailError = errorText(err);
			return false;
		} finally {
			if (seq === detailSeq) {
				detailLoading = false;
				now = Date.now();
			}
		}
	}

	async function loadAgentList(): Promise<void> {
		const seq = ++agentListSeq;
		try {
			const next = await getJson<AgentList>('/api/pipeline/agents');
			if (seq !== agentListSeq) return;
			agentList = next;
			agentListError = null;
		} catch (err) {
			if (seq === agentListSeq) agentListError = errorText(err);
		} finally {
			if (seq === agentListSeq) {
				agentListLoading = false;
				now = Date.now();
			}
		}
	}

	/** Resolves what it read, or `null`; `quiet` keeps what is shown while the answer is awaited. */
	async function loadAgent(name: string, quiet: boolean): Promise<AgentDetail | null> {
		const seq = ++agentSeq;
		if (!quiet) {
			agentDetail = null;
			agentError = null;
			agentLoading = true;
		}
		try {
			const next = await getJson<AgentDetail>(`/api/pipeline/agents/${encodeURIComponent(name)}`);
			if (seq !== agentSeq) return null;
			agentDetail = next;
			agentError = null;
			return next;
		} catch (err) {
			if (seq === agentSeq) agentError = errorText(err);
			return null;
		} finally {
			if (seq === agentSeq) {
				agentLoading = false;
				now = Date.now();
			}
		}
	}

	/** The Agents tab reads nothing until it is first shown. */
	function startAgents(): void {
		if (agentsStarted) return;
		agentsStarted = true;
		agentListLoading = true;
		void loadAgentList();
		if (selectedAgent !== null) void loadAgent(selectedAgent, false);
	}

	async function refreshAll(): Promise<void> {
		if (refreshing) return;
		refreshing = true;
		try {
			const jobs: Promise<unknown>[] = [
				loadList(),
				selected === null ? Promise.resolve(true) : loadDetail(selected, detail !== null),
			];
			if (tab === 'agents') {
				jobs.push(
					loadAgentList(),
					selectedAgent === null
						? Promise.resolve(null)
						: loadAgent(selectedAgent, agentDetail !== null),
				);
			}
			await Promise.all(jobs);
		} finally {
			refreshing = false;
		}
	}

	/** After an approval: the detail the panel shows, and the status the list card carries. */
	function rereadDetail(): Promise<boolean> {
		void loadList();
		return selected === null ? Promise.resolve(false) : loadDetail(selected, true);
	}

	function select(number: number): void {
		if (number === selected) return;
		selected = number;
		// A query on this same route: `resolve()` cannot carry one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`/pipeline?change=${number}`, {});
		void loadDetail(number, false);
	}

	const agentUrl = (name: string): string => `/pipeline?agent=${encodeURIComponent(name)}`;

	/** The address follows the tab that holds a selection; a tab with none leaves it alone. */
	function showTab(id: TabId): void {
		tab = id;
		if (id === 'agents') {
			startAgents();
			if (selectedAgent !== null) {
				// A query on this same route: `resolve()` cannot carry one.
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				replaceState(agentUrl(selectedAgent), {});
			}
		} else if (id === 'changes' && selected !== null) {
			// eslint-disable-next-line svelte/no-navigation-without-resolve
			replaceState(`/pipeline?change=${selected}`, {});
		}
	}

	async function selectAgent(name: string): Promise<void> {
		if (name === selectedAgent) return;
		if (
			agentDirty &&
			!(await askConfirm({
				title: `Discard your edits to ${selectedAgent}?`,
				message:
					'The text you changed is not saved anywhere, and no change has been opened for it.',
				confirmLabel: 'Discard',
				danger: true,
			}))
		) {
			return;
		}
		selectedAgent = name;
		agentDirty = false;
		// A query on this same route: `resolve()` cannot carry one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(agentUrl(name), {});
		void loadAgent(name, false);
	}

	/** After a submit or a reload: the list card's tag and the detail's open changes. */
	function rereadAgent(): Promise<AgentDetail | null> {
		void loadAgentList();
		return selectedAgent === null ? Promise.resolve(null) : loadAgent(selectedAgent, true);
	}

	/** Shows a pull request the Agents tab points at in the Changes tab. */
	function openChange(number: number): void {
		const same = number === selected;
		tab = 'changes';
		selected = number;
		// A query on this same route: `resolve()` cannot carry one.
		// eslint-disable-next-line svelte/no-navigation-without-resolve
		replaceState(`/pipeline?change=${number}`, {});
		void loadList();
		void loadDetail(number, same && detail !== null);
	}

	function tabLabel(t: (typeof TABS)[number]): string {
		return t.id === 'changes' && changeCount !== null ? `Changes · ${changeCount}` : t.label;
	}

	onMount(() => {
		void loadList();
		if (selected !== null) void loadDetail(selected, false);
		if (tab === 'agents') startAgents();
		const timer = setInterval(() => {
			if (document.visibilityState === 'visible') void refreshAll();
		}, REFRESH_MS);
		return () => clearInterval(timer);
	});
</script>

<svelte:head><title>Invisible Pipeline Changes — Invisible Wall</title></svelte:head>

{#snippet card(c: ChangeSummary)}
	{@const pill = statusPill(c.status)}
	<button
		type="button"
		class="change"
		class:on={selected === c.number}
		aria-pressed={selected === c.number}
		onclick={() => select(c.number)}
	>
		<span class="change-top">
			<span class="mono">{c.branch}</span>
			<Pill tone={pill.tone} dot={pill.dot}>{pill.label}</Pill>
		</span>
		<span class="change-title">{c.title}</span>
		{#if c.status.kind === 'blocked'}<span class="change-blocked">{c.status.reason}</span>{/if}
		{#if c.draft || c.agentDefinition}
			<span class="tags">
				{#if c.draft}<Pill tone="amber" tag>draft</Pill>{/if}
				{#if c.agentDefinition}<Pill tone="amber" tag>agent definition</Pill>{/if}
			</span>
		{/if}
		<span class="change-meta">Opened by {c.author || 'unknown'} · {timeAgo(c.openedAt, now)}</span>
	</button>
{/snippet}

{#snippet agentCard(a: AgentSummary)}
	<button
		type="button"
		class="change"
		class:on={selectedAgent === a.name}
		aria-pressed={selectedAgent === a.name}
		onclick={() => selectAgent(a.name)}
	>
		<span class="change-top">
			<span class="mono">{a.name}</span>
			{#if a.openChanges.length || !a.valid}
				<span class="tags">
					{#if a.openChanges.length}
						<Pill tone="amber" tag>{openChangesWord(a.openChanges.length)}</Pill>
					{/if}
					{#if !a.valid}<Pill tone="red" tag>invalid</Pill>{/if}
				</span>
			{/if}
		</span>
		{#if a.valid && a.model}
			<span class="agent-spec">
				<span class="mono">{a.model}</span>
				<span>{effortLabel(a.effort)}</span>
				<span>{toolsWord(a.tools.length)}</span>
			</span>
		{/if}
		<span class="change-meta">{changedText(a.lastChange, now)}</span>
	</button>
{/snippet}

<div class="page">
	<ToolTopBar current="pipelineChanges" tools={data.tools}>
		{#snippet meta()}
			<span class="who">
				{who} · <span class="role">{roleLabel(data.user.role)}</span> ·
				{data.canMerge ? 'can approve' : 'read-only'}
			</span>
			<button type="button" class="refresh" disabled={refreshing} onclick={refreshAll}>
				Refresh
			</button>
		{/snippet}
	</ToolTopBar>

	<main class="body">
		<div
			class="tabs"
			role="tablist"
			aria-label="Pipeline Changes"
			tabindex="-1"
			onkeydown={onTabKeydown}
		>
			{#each TABS as t (t.id)}
				<button
					id={`tab-${t.id}`}
					class="tab"
					class:active={tab === t.id}
					role="tab"
					type="button"
					aria-selected={tab === t.id}
					aria-controls={`panel-${t.id}`}
					tabindex={tab === t.id ? 0 : -1}
					onclick={() => showTab(t.id)}
				>
					{tabLabel(t)}
				</button>
			{/each}
		</div>

		<div
			id="panel-changes"
			role="tabpanel"
			aria-labelledby="tab-changes"
			hidden={tab !== 'changes'}
			tabindex="0"
			class="changes"
		>
			<div class="heading">
				<h1>Changes</h1>
				<p>
					Every change runs on its own branch. It merges into main only when all pipeline tests pass
					and every current game still builds and looks the same. Games made in Director or Game
					Maker don't come through here.
				</p>
			</div>

			<div class="cols">
				<section class="list" aria-label="Open changes">
					{#if listError}<div class="error" role="alert">{listError}</div>{/if}
					{#if listLoading && !list}
						<p class="loading" aria-busy="true">Loading changes…</p>
					{:else if list}
						{#if !list.changes.length}
							<div class="empty"><strong>No open pipeline changes.</strong></div>
						{/if}
						{#each list.changes as c (c.number)}
							{@render card(c)}
						{/each}
						{#if list.dependabot.length}
							<details class="dependabot">
								<summary>Dependabot · {list.dependabot.length}</summary>
								<div class="dependabot-list">
									{#each list.dependabot as c (c.number)}
										{@render card(c)}
									{/each}
								</div>
							</details>
						{/if}
						{#if list.forksSkipped > 0}
							<p class="note">
								{#if list.forksSkipped === 1}
									1 pull request from a fork is not listed: the harness does not run on it. Merge it
									by hand after review.
								{:else}
									{list.forksSkipped} pull {plural(list.forksSkipped, 'request')} from forks are not listed:
									the harness does not run on them. Merge those by hand after review.
								{/if}
							</p>
						{/if}
					{/if}
				</section>

				<section class="detail" aria-label="Change details">
					{#if detailError}<div class="error" role="alert">{detailError}</div>{/if}
					{#if detail}
						{#key detail.number}
							<ChangeDetailPanel {detail} canMerge={data.canMerge} {now} onchanged={rereadDetail} />
						{/key}
					{:else if detailLoading}
						<div class="loading card" aria-busy="true">Loading change #{selected}…</div>
					{:else if selected === null}
						<div class="empty">
							<strong>Select a change</strong>
							<p>Its checks, files and changed screens appear here.</p>
						</div>
					{/if}
				</section>
			</div>
		</div>

		<div
			id="panel-agents"
			role="tabpanel"
			aria-labelledby="tab-agents"
			hidden={tab !== 'agents'}
			tabindex="0"
			class="changes"
		>
			<div class="heading">
				<h1>Agents</h1>
				<p>
					Director's runtime agents, read from main. Editing one opens a pipeline change with a
					before and after evaluation.
				</p>
			</div>

			<div class="cols">
				<section class="list" aria-label="Agents">
					{#if agentListError}<div class="error" role="alert">{agentListError}</div>{/if}
					{#if agentListLoading && !agentList}
						<p class="loading" aria-busy="true">Loading agents…</p>
					{:else if agentList}
						{#if !agentList.agents.length}
							<div class="empty"><strong>No agent definitions on main.</strong></div>
						{/if}
						{#each agentList.agents as a (a.name)}
							{@render agentCard(a)}
						{/each}
						<p class="note">
							Read from main at <span class="mono">{shortSha(agentList.mainSha)}</span>.
						</p>
					{/if}
				</section>

				<section class="detail" aria-label="Agent details">
					{#if agentError}<div class="error" role="alert">{agentError}</div>{/if}
					{#if agentDetail}
						{#key agentDetail.name}
							<AgentPanel
								detail={agentDetail}
								canMerge={data.canMerge}
								{now}
								onreload={rereadAgent}
								onopenchange={openChange}
								bind:dirty={agentDirty}
							/>
						{/key}
					{:else if agentLoading}
						<div class="loading card" aria-busy="true">Loading {selectedAgent}…</div>
					{:else if selectedAgent === null}
						<div class="empty">
							<strong>Select an agent</strong>
							<p>Its definition, open changes and editor appear here.</p>
						</div>
					{/if}
				</section>
			</div>
		</div>

		{#each TABS as t (t.id)}
			{#if 'empty' in t}
				<div
					id={`panel-${t.id}`}
					class="empty wide"
					role="tabpanel"
					aria-labelledby={`tab-${t.id}`}
					hidden={tab !== t.id}
					tabindex="0"
				>
					<strong>{t.empty}</strong>
					<p>{t.body}</p>
				</div>
			{/if}
		{/each}
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
	.refresh:hover:not(:disabled) {
		background: #23232e;
		border-color: #3a3a48;
	}
	.refresh:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.tabs {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		margin-bottom: 20px;
		padding: 4px;
		background: #121218;
		border: 1px solid #222;
		border-radius: 12px;
		width: fit-content;
		max-width: 100%;
	}
	.tab {
		background: transparent;
		border: none;
		color: #999;
		padding: 8px 16px;
		border-radius: 8px;
		font-size: 13px;
		font-weight: 600;
		cursor: pointer;
		letter-spacing: 0.03em;
	}
	.tab:hover {
		color: #ddd;
		background: #181820;
	}
	.tab.active {
		background: #6b5bff;
		color: #fff;
	}
	.tab:focus-visible,
	.refresh:focus-visible,
	.change:focus-visible,
	.dependabot summary:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	[role='tabpanel'][hidden] {
		display: none;
	}

	.changes {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}
	.heading {
		display: flex;
		flex-direction: column;
		gap: 4px;
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
		font-size: 13px;
		line-height: 1.5;
		color: #9a9aa6;
	}
	.cols {
		display: flex;
		flex-wrap: wrap;
		gap: 16px;
		align-items: flex-start;
	}
	.list {
		flex: 1 1 300px;
		max-width: 380px;
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

	.change {
		display: flex;
		flex-direction: column;
		align-items: stretch;
		gap: 6px;
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
	.change:hover {
		border-color: #3a3a48;
	}
	.change.on {
		padding: 13px;
		border: 2px solid #7ee0c0;
	}
	.change-top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 6px;
	}
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 12px;
		color: #c9c9d1;
		overflow-wrap: anywhere;
	}
	.change-title {
		font-size: 14px;
		font-weight: 700;
		overflow-wrap: anywhere;
	}
	.change-blocked {
		font-size: 12px;
		color: #ff9d9d;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.change-meta {
		font-size: 12px;
		color: #9a9aa6;
	}
	.agent-spec {
		display: flex;
		flex-wrap: wrap;
		gap: 2px 10px;
		font-size: 12px;
		color: #b9b9c4;
	}
	.agent-spec .mono {
		font-size: 11px;
		color: #9a9aa6;
	}
	.dependabot summary {
		cursor: pointer;
		padding: 6px 2px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.04em;
		color: #b9b9c4;
	}
	.dependabot-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 6px;
	}
	.note {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: #80808c;
	}

	.loading {
		margin: 0;
		color: #9a9aa6;
	}
	.loading.card {
		padding: 20px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
	}
	.error {
		padding: 12px 14px;
		background: #2a1416;
		border: 1px solid #6b2f33;
		border-radius: 10px;
		color: #ff9d9d;
		font-size: 13px;
	}
	.empty {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 40px 24px;
		border: 1px dashed #2a2a33;
		border-radius: 12px;
		background: #121218;
		text-align: center;
		align-items: center;
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
	.empty.wide[hidden] {
		display: none;
	}
</style>
