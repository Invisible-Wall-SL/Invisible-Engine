<script lang="ts">
	import { page } from '$app/state';
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();

	const navTools = $derived(data.tools.filter((t) => t.kind === 'online'));
</script>

<div class="app">
	<header>
		<nav>
			<a class="brand" href="/">Invisible Wall</a>
			<a class:active={page.url.pathname === '/'} href="/">Home</a>
			{#each navTools as tool (tool.id)}
				<a class:active={page.url.pathname === tool.url} href={tool.url}>{tool.name}</a>
			{/each}
		</nav>
		<div class="user">
			<span>{data.user.name ?? data.user.email} · <span class="role">{data.user.role}</span></span>
			<form method="POST" action="/auth/logout">
				<button type="submit">Sign out</button>
			</form>
		</div>
	</header>

	<main>
		{@render children()}
	</main>
</div>

<style>
	:global(body) {
		margin: 0;
		background: #0b0b0f;
		color: #eee;
		font-family: system-ui, sans-serif;
	}
	.app {
		min-height: 100vh;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 14px 24px;
		border-bottom: 1px solid #1c1c24;
		background: #101016;
		position: sticky;
		top: 0;
	}
	nav {
		display: flex;
		align-items: center;
		gap: 18px;
	}
	.brand {
		font-weight: 700;
		margin-right: 8px;
	}
	nav a {
		color: #9a9aa5;
		text-decoration: none;
		font-size: 14px;
	}
	nav a.active,
	nav a:hover {
		color: #fff;
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
	button {
		background: transparent;
		border: 1px solid #333;
		color: #aaa;
		padding: 6px 12px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 13px;
	}
	main {
		max-width: 960px;
		margin: 0 auto;
		padding: 32px 24px;
	}
</style>
