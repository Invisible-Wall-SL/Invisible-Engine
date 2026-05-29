<script lang="ts">
	import { enhance } from '$app/forms';
	import type { PageData, ActionData } from './$types';
	import type { ToolDef } from '$lib/roles';
	import { toolDocPath } from '$lib/roles';
	import Emblem from '$lib/Emblem.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const online = $derived(data.tools.filter((t) => t.kind === 'online'));
	const local = $derived(data.tools.filter((t) => t.kind === 'local'));

	const roleBlurb: Record<string, string> = {
		admin: 'You have access to everything — all online tools and local tools.',
		developer: 'You build the engine and games, and use the pipeline tools.',
		artist: 'You create and refine game art with the Atlas tools and ComfyUI.',
		animator: 'You work on Spine skeletons and animations.',
	};

	type Step = { n: number; label: string };
	const steps: Step[] = $derived(
		[
			{ n: 1, label: 'How the studio works' },
			online.length ? { n: 2, label: 'Your online tools' } : null,
			local.length ? { n: 3, label: 'Install your local tools' } : null,
			{ n: 4, label: 'Where to get help' },
		].filter((s): s is Step => s !== null),
	);
</script>

{#snippet docLink(tool: ToolDef)}
	<a class="doc" href={`/${toolDocPath(tool.id)}`}>Read the {tool.name} guide</a>
{/snippet}

<svelte:head><title>Getting started — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand"><Emblem height={18} /> INVISIBLE WALL</div>
		<a class="ghost" href="/">‹ Launcher</a>
	</header>

	<h1>Welcome{data.user.name ? `, ${data.user.name}` : ''}</h1>
	<p class="lead">
		You're signed in as <span class="role">{data.user.role}</span>.
		{roleBlurb[data.user.role] ?? ''}
	</p>

	<nav class="toc">
		<span class="toc-label">This walkthrough</span>
		<ol>
			{#each steps as step (step.n)}
				<li><a href={`#step-${step.n}`}>{step.label}</a></li>
			{/each}
		</ol>
	</nav>

	<section id="step-1" class="step">
		<span class="step-no">Step 1</span>
		<h2>How the studio works</h2>
		<ul class="how">
			<li>
				Open any <strong>online</strong> tool from the
				<a href="/">launcher</a> — it fills the whole window, with nothing to install.
			</li>
			<li>
				<strong>Local</strong> tools run on your own computer (they need your GPU or a licence).
				You install them once and tell the launcher where they live.
			</li>
			<li>Your work saves to the shared cloud automatically, so it's there next time and visible to the team.</li>
			<li>Heavy image generation runs on the studio GPU behind the scenes — click Generate and wait.</li>
		</ul>
	</section>

	{#if online.length}
		<section id="step-2" class="step">
			<span class="step-no">Step 2</span>
			<h2>Your online tools</h2>
			<p class="muted">Nothing to install. Click to open — they run inside this portal.</p>
			<div class="cards">
				{#each online as tool (tool.id)}
					<div class="card">
						<strong>{tool.name}</strong>
						<span class="muted">{tool.description}</span>
						<div class="actions">
							<a class="open" href={tool.url}>Open →</a>
							{@render docLink(tool)}
						</div>
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if local.length}
		<section id="step-3" class="step">
			<span class="step-no">Step 3</span>
			<h2>Install your local tools</h2>
			<p class="muted">
				Download each one, install it on this machine, then save the install path so the launcher can find it.
			</p>
			<div class="cards">
				{#each local as tool (tool.id)}
					<div class="card">
						<strong>{tool.name}</strong>
						<span class="muted">{tool.description}</span>

						<ol class="install-steps">
							{#each tool.install?.steps ?? [] as line, i (i)}
								<li>{line}</li>
							{/each}
						</ol>

						{#if tool.install?.download}
							<a class="download" href={tool.install.download} target="_blank" rel="noopener">
								Download installer →
							</a>
						{:else}
							<span class="download todo">Download link coming soon — ask an admin.</span>
						{/if}

						<form method="POST" action="?/saveInstallPath" use:enhance class="path">
							<input type="hidden" name="toolKey" value={tool.id} />
							<label for={`ob-path-${tool.id}`}>Install path on this machine</label>
							<div class="row">
								<input
									id={`ob-path-${tool.id}`}
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

						{@render docLink(tool)}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	<section id="step-4" class="step">
		<span class="step-no">Step 4</span>
		<h2>Where to get help</h2>
		<p class="muted">
			Each tool has its own guide under <code>docs/tools/</code>. Engine setup, architecture and the
			roadmap live in the repository under <code>docs/</code>
			(<code>ONBOARDING.md</code>, <code>INFRA.md</code>, <code>STATUS.md</code>). Stuck on an
			install or a download link that isn't live yet? Ask an admin.
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
	.toc {
		margin: 24px 0 8px;
		padding: 14px 18px;
		border: 1px solid #222;
		border-radius: 12px;
		background: #14141a;
	}
	.toc-label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #777;
	}
	.toc ol {
		margin: 8px 0 0;
		padding-left: 20px;
		color: #cfcfd6;
		line-height: 1.7;
		font-size: 14px;
	}
	.toc a {
		color: #5db0ff;
		text-decoration: none;
	}
	.step {
		margin-top: 36px;
		padding-top: 8px;
		border-top: 1px solid #1c1c24;
	}
	.step-no {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		color: #6b5bff;
		font-weight: 700;
	}
	h2 {
		font-size: 18px;
		margin: 4px 0 10px;
	}
	.how {
		margin: 0;
		padding-left: 18px;
		color: #cfcfd6;
		line-height: 1.7;
		font-size: 14px;
	}
	.how a {
		color: #5db0ff;
	}
	.muted {
		color: #888;
		font-size: 13px;
	}
	.cards {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
		gap: 12px;
		margin-top: 12px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px;
		border-radius: 12px;
		background: #16161c;
		border: 1px solid #222;
	}
	.card strong {
		font-size: 15px;
	}
	.install-steps {
		margin: 4px 0;
		padding-left: 18px;
		color: #cfcfd6;
		font-size: 13px;
		line-height: 1.6;
	}
	.actions {
		display: flex;
		gap: 14px;
		align-items: center;
		margin-top: 4px;
	}
	.open {
		color: #7ee0c0;
		font-size: 13px;
		text-decoration: none;
	}
	.download {
		margin-top: 2px;
		font-size: 13px;
		color: #5db0ff;
		text-decoration: none;
	}
	.download.todo {
		color: #777;
	}
	.doc {
		font-size: 13px;
		color: #c8a3ff;
		text-decoration: none;
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
	code {
		background: #1c1c24;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 12px;
	}
</style>
