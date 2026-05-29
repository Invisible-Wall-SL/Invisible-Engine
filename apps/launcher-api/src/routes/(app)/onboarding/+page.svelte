<script lang="ts">
	import type { PageData } from './$types';
	import Emblem from '$lib/Emblem.svelte';

	let { data }: { data: PageData } = $props();

	const online = $derived(data.tools.filter((t) => t.kind === 'online'));
	const local = $derived(data.tools.filter((t) => t.kind === 'local'));

	const roleBlurb: Record<string, string> = {
		admin: 'You have access to everything — all online tools and local tools.',
		developer: 'You build the engine and games, and use the pipeline tools.',
		artist: 'You create and refine game art with the Atlas tools and ComfyUI.',
		animator: 'You work on Spine skeletons and animations.',
	};
</script>

<svelte:head><title>Getting started — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand"><Emblem height={18} /> INVISIBLE WALL</div>
		<a class="ghost" href="/">‹ Launcher</a>
	</header>

	<h1>Welcome{data.user.name ? `, ${data.user.name}` : ''} 👋</h1>
	<p class="lead">
		You're signed in as <span class="role">{data.user.role}</span>.
		{roleBlurb[data.user.role] ?? ''}
	</p>

	<section>
		<h2>How it works</h2>
		<ul class="how">
			<li>Open a tool from the <a href="/">launcher</a> — it fills the whole window, no extra windows or installs.</li>
			<li>Your work is saved to the shared cloud automatically, so it's there next time and visible to the team.</li>
			<li>Heavy image generation runs on the studio GPU behind the scenes — just click Generate and wait.</li>
		</ul>
	</section>

	{#if online.length}
		<section>
			<h2>Your online tools</h2>
			<div class="grid">
				{#each online as tool (tool.id)}
					<a class="tool" href={tool.url}>
						<strong>{tool.name}</strong>
						<span class="muted">{tool.description}</span>
						<span class="cta">Open →</span>
					</a>
				{/each}
			</div>
		</section>
	{/if}

	{#if local.length}
		<section>
			<h2>Tools you install on your computer</h2>
			<p class="muted small">These run on your own machine. Ask an admin for the installer if you don't have them yet.</p>
			<div class="grid">
				{#each local as tool (tool.id)}
					<div class="tool static">
						<strong>{tool.name}</strong>
						<span class="muted">{tool.description}</span>
						<span class="tag">install</span>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section class="dev-note">
		<h2>Developers</h2>
		<p class="muted">
			Setup, architecture and the current roadmap live in the repository under
			<code>docs/</code> (<code>ONBOARDING.md</code>, <code>INFRA.md</code>, <code>STATUS.md</code>).
		</p>
	</section>
</div>

<style>
	.shell {
		max-width: 880px;
		margin: 0 auto;
		padding: 32px 24px 64px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 28px;
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
	.ghost {
		border: 1px solid #333;
		color: #aaa;
		padding: 6px 12px;
		border-radius: 8px;
		text-decoration: none;
		font-size: 13px;
	}
	h1 {
		font-size: 26px;
		margin: 0 0 6px;
	}
	.lead {
		color: #b8b8c0;
		margin: 0 0 8px;
		font-size: 15px;
	}
	.role {
		color: #6b5bff;
		text-transform: capitalize;
		font-weight: 600;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin: 28px 0 12px;
	}
	.how {
		margin: 0;
		padding-left: 18px;
		color: #cfcfd6;
		line-height: 1.7;
		font-size: 14px;
	}
	.how a,
	.dev-note a {
		color: #5db0ff;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
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
	a.tool:hover {
		border-color: #6b5bff;
	}
	.tool strong {
		font-size: 15px;
	}
	.muted {
		color: #888;
		font-size: 13px;
	}
	.small {
		font-size: 12px;
		margin-top: -4px;
	}
	.cta {
		color: #7ee0c0;
		font-size: 13px;
		margin-top: 4px;
	}
	.tag {
		position: absolute;
		top: 14px;
		right: 14px;
		font-size: 11px;
		padding: 2px 8px;
		border-radius: 999px;
		background: #2a2430;
		color: #c8a3ff;
	}
	code {
		background: #1c1c24;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 12px;
	}
	.dev-note {
		margin-top: 12px;
		padding-top: 8px;
	}
</style>
