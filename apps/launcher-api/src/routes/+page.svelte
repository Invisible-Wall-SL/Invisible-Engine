<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const online = $derived(data.tools.filter((t) => t.kind === 'online'));
	const local = $derived(data.tools.filter((t) => t.kind === 'local'));
</script>

<svelte:head><title>Launcher — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div>
			<h1>Invisible Wall</h1>
			<p class="muted">{data.user.name ?? data.user.email} · <span class="role">{data.user.role}</span></p>
		</div>
		<form method="POST" action="/auth/logout">
			<button class="ghost" type="submit">Sign out</button>
		</form>
	</header>

	<section>
		<h2>Online tools</h2>
		<div class="grid">
			{#each online as tool (tool.id)}
				<a class="tool" href={tool.url} target="_blank" rel="noreferrer">
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
		<div class="grid">
			{#each local as tool (tool.id)}
				<div class="tool">
					<strong>{tool.name}</strong>
					<span class="muted">{tool.description}</span>
					<span class="tag local">install</span>
				</div>
			{:else}
				<p class="muted">No local tools for your role.</p>
			{/each}
		</div>
	</section>
</div>

<style>
	:global(body) {
		margin: 0;
		background: #0b0b0f;
	}
	.shell {
		max-width: 880px;
		margin: 0 auto;
		padding: 40px 24px;
		color: #eee;
		font-family: system-ui, sans-serif;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		margin-bottom: 32px;
	}
	h1 {
		margin: 0;
		font-size: 22px;
	}
	h2 {
		font-size: 15px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
	}
	.muted {
		color: #888;
	}
	.role {
		color: #6b5bff;
		text-transform: capitalize;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
		margin-bottom: 16px;
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
	.ghost {
		background: transparent;
		border: 1px solid #333;
		color: #aaa;
		padding: 8px 14px;
		border-radius: 8px;
		cursor: pointer;
	}
</style>
