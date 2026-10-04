<script lang="ts">
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const TABS = [
		{
			id: 'changes',
			label: 'Changes',
			empty: 'No pipeline changes yet.',
			body: 'Each open pipeline branch will be listed here with its status: Testing, Ready to merge or Blocked. A change merges only when every pipeline test passes, every current game still builds and looks the same, and someone with the "Merge pipeline changes" capability approves.',
		},
		{
			id: 'agents',
			label: 'Agents',
			empty: 'No agent definitions to show yet.',
			body: "Director's runtime-agent definitions will be shown and edited here. An edit creates a pipeline change, and its check runs a short evaluation on a fixed sample before and after.",
		},
		{
			id: 'history',
			label: 'History',
			empty: 'Nothing has been merged yet.',
			body: 'Merges, who approved them, and rollbacks will be listed here. Every merge can be rolled back.',
		},
	] as const;

	type TabId = (typeof TABS)[number]['id'];
	let tab = $state<TabId>('changes');

	function onTabKeydown(e: KeyboardEvent) {
		const i = TABS.findIndex((t) => t.id === tab);
		let next = i;
		if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
		else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
		else if (e.key === 'Home') next = 0;
		else if (e.key === 'End') next = TABS.length - 1;
		else return;
		e.preventDefault();
		tab = TABS[next].id;
		document.getElementById(`tab-${TABS[next].id}`)?.focus();
	}
</script>

<svelte:head><title>Invisible Pipeline Changes — Invisible Wall</title></svelte:head>

<div class="page">
	<ToolTopBar current="pipelineChanges" tools={data.tools} />

	<main class="body">
		<p class="intro">
			<span class="tag">early access</span>
			Changes to tools, engine, templates, blueprints and agent definitions, each on its own branch. This
			tool is being built: the tabs below are empty for now.
		</p>

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
					onclick={() => (tab = t.id)}
				>
					{t.label}
				</button>
			{/each}
		</div>

		{#each TABS as t (t.id)}
			<div
				id={`panel-${t.id}`}
				class="empty"
				role="tabpanel"
				aria-labelledby={`tab-${t.id}`}
				hidden={tab !== t.id}
				tabindex="0"
			>
				<strong>{t.empty}</strong>
				<p>{t.body}</p>
			</div>
		{/each}
	</main>
</div>

<style>
	.page {
		min-height: 100vh;
		background: #0e0e12;
		color: #d8d8df;
		font-family: system-ui, sans-serif;
	}
	.body {
		padding: 24px 24px 48px;
	}
	.intro {
		margin: 0 0 16px;
		color: #a3a3ad;
		font-size: 13px;
		line-height: 1.5;
	}
	.tag {
		display: inline-block;
		margin-right: 6px;
		padding: 2px 8px;
		border-radius: 999px;
		background: #2d2516;
		color: #f5b95c;
		font-size: 11px;
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
	.tab:focus-visible {
		outline: 2px solid #6b5bff;
		outline-offset: 2px;
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
	.empty[hidden] {
		display: none;
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
</style>
