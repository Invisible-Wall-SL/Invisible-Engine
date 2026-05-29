<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import Emblem from '$lib/Emblem.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const online = $derived(data.tools.filter((t) => t.kind === 'online'));
	const local = $derived(data.tools.filter((t) => t.kind === 'local'));
</script>

<svelte:head><title>Launcher — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand"><Emblem height={18} /> INVISIBLE WALL</div>
		<div class="user">
			<span>{data.user.name ?? data.user.email} · <span class="role">{data.user.role}</span></span>
			<a class="ghost" href="/onboarding">Getting started</a>
			<form method="POST" action="/auth/logout">
				<button class="ghost" type="submit">Sign out</button>
			</form>
		</div>
	</header>

	<section>
		<h2>Online tools</h2>
		<div class="grid">
			{#each online as tool (tool.id)}
				<a class="tool" href={tool.url}>
					<strong>{tool.name}</strong>
					<span class="muted">{tool.description}</span>
					<span class="tag online">open</span>
				</a>
			{:else}
				<p class="muted">No online tools for your role.</p>
			{/each}
		</div>
	</section>

	<section>
		<h2>Local tools</h2>
		<div class="grid wide">
			{#each local as tool (tool.id)}
				<div class="tool">
					<strong>{tool.name}</strong>
					<span class="muted">{tool.description}</span>
					<span class="tag local">install</span>

					{#if tool.install?.download}
						<a class="download" href={tool.install.download} target="_blank" rel="noopener">
							Download installer →
						</a>
					{:else}
						<span class="download todo">Download link coming soon — ask an admin.</span>
					{/if}

					<form method="POST" action="?/saveInstallPath" use:enhance class="path">
						<input type="hidden" name="toolKey" value={tool.id} />
						<label for={`path-${tool.id}`}>Install path on this machine</label>
						<div class="row">
							<input
								id={`path-${tool.id}`}
								name="installPath"
								type="text"
								placeholder="e.g. C:\Tools\{tool.install?.package ?? tool.id}"
								value={data.installPaths[tool.id] ?? ''}
								autocomplete="off"
								spellcheck="false"
							/>
							<button type="submit">Save</button>
						</div>
						{#if form?.saved === tool.id}
							<span class="saved">Saved.</span>
						{/if}
					</form>
				</div>
			{:else}
				<p class="muted">No local tools for your role.</p>
			{/each}
		</div>
	</section>
</div>

<style>
	.shell {
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 24px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 32px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: #7ee0c0;
		font-size: 15px;
	}
	.user {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 13px;
		color: #888;
	}
	.role {
		color: #6b5bff;
		text-transform: capitalize;
	}
	.ghost {
		background: transparent;
		border: 1px solid #333;
		color: #aaa;
		padding: 7px 13px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
		text-decoration: none;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin-top: 28px;
	}
	.muted {
		color: #888;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
	}
	.grid.wide {
		grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
	}
	.tool {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px;
		border-radius: 12px;
		background: #16161c;
		border: 1px solid #222;
		text-decoration: none;
		color: inherit;
		position: relative;
	}
	a.tool:hover {
		border-color: #6b5bff;
	}
	.tool strong {
		font-size: 15px;
	}
	.tool .muted {
		font-size: 13px;
	}
	.tag {
		position: absolute;
		top: 14px;
		right: 14px;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
	}
	.tag.online {
		background: #1f2d23;
		color: #7ee787;
	}
	.tag.local {
		background: #2a2430;
		color: #c8a3ff;
	}
	.download {
		margin-top: 4px;
		font-size: 13px;
		color: #5db0ff;
		text-decoration: none;
	}
	.download.todo {
		color: #777;
	}
	.path {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 8px;
	}
	.path label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
	}
	.path .row {
		display: flex;
		gap: 8px;
	}
	.path input {
		flex: 1;
		min-width: 0;
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
		font-size: 13px;
		font-family: ui-monospace, monospace;
	}
	.path input:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.path button {
		background: #6b5bff;
		border: none;
		border-radius: 8px;
		padding: 8px 14px;
		color: #fff;
		font-size: 13px;
		cursor: pointer;
	}
	.saved {
		font-size: 12px;
		color: #7ee0c0;
	}
</style>
