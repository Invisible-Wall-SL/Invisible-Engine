<script lang="ts">
	import Emblem from '$lib/Emblem.svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Invisible Storybook — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<ToolTopBar current="storybook" tools={data.tools} />
		<div class="meta">
			<span class="counter">
				{data.entries.length}
				{data.entries.length === 1 ? 'storybook' : 'storybooks'}
			</span>
		</div>
	</header>

	{#if data.entries.length === 0}
		<div class="empty">
			<Emblem height={48} />
			<h2>Invisible Storybook</h2>
			<p>
				No published storybooks yet. Publish one from a game repo with
				<code>pnpm publish:storybook</code>, or the engine reference with
				<code>node apps/launcher-api/scripts/publish-storybook.mjs --shared</code>.
			</p>
		</div>
	{:else}
		<ul class="grid">
			{#each data.entries as entry (entry.id)}
				<li>
					<!-- The build is a static site outside the SvelteKit router. -->
					<a class="card" href={entry.href} data-sveltekit-reload>
						<span class="name">{entry.name}</span>
						<span class="detail">{entry.detail}</span>
						{#if entry.shared}<span class="badge">shared</span>{/if}
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>

<style>
	.shell {
		width: 100%;
		box-sizing: border-box;
		padding: 24px clamp(20px, 3vw, 40px);
		color: #e8e8ee;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 24px;
	}
	.meta {
		flex: none;
		font-size: 13px;
		color: #888;
	}
	.grid {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
		gap: 14px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		position: relative;
		background: #16161c;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 18px;
		text-decoration: none;
		color: inherit;
		transition: border-color 0.15s;
	}
	.card:hover {
		border-color: #6b5bff;
	}
	.name {
		font-size: 15px;
		font-weight: 600;
	}
	.detail {
		font-size: 12px;
		color: #888;
	}
	.badge {
		position: absolute;
		top: 14px;
		right: 14px;
		font-size: 11px;
		color: #c8a3ff;
		background: #2a2430;
		border-radius: 999px;
		padding: 2px 9px;
	}
	.empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		text-align: center;
		padding: 80px 24px;
		color: #888;
	}
	.empty h2 {
		margin: 0;
		font-size: 16px;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: #e8e8ee;
	}
	.empty p {
		max-width: 540px;
		margin: 0;
		font-size: 13px;
		line-height: 1.6;
	}
	.empty code {
		color: #7ee0c0;
		background: #16161c;
		border: 1px solid #222;
		border-radius: 6px;
		padding: 1px 6px;
		font-size: 12px;
	}
</style>
