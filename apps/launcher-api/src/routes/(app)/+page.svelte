<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const online = $derived(data.tools.filter((t) => t.kind === 'online'));
	const local = $derived(data.tools.filter((t) => t.kind === 'local'));
</script>

<svelte:head><title>Launcher — Invisible Wall</title></svelte:head>

<h1>Welcome, {data.user.name ?? data.user.email}</h1>
<p class="muted">Your tools for the <span class="role">{data.user.role}</span> role.</p>

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

<style>
	h1 {
		font-size: 22px;
		margin-bottom: 4px;
	}
	.muted {
		color: #888;
	}
	.role {
		color: #6b5bff;
		text-transform: capitalize;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin-top: 32px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
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
</style>
