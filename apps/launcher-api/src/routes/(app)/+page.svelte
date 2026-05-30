<script lang="ts">
	import { enhance } from '$app/forms';
	import { tick } from 'svelte';
	import type { PageData, ActionData } from './$types';
	import Emblem from '$lib/Emblem.svelte';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	const online = $derived(data.tools.filter((t) => t.kind === 'online'));
	const local = $derived(data.tools.filter((t) => t.kind === 'local'));

	// Games launch against their configured URL (managed in /admin; games live on a
	// future dedicated server). The active project rides along as `?project=<key>`.
	// Shown to every authed user for now — could be gated by a `games` capability later.
	const projectKey = $derived(data.activeProjectKey ?? 'cloud');
	const gameUrl = (url: string) => {
		const sep = url.includes('?') ? '&' : '?';
		let out = `${url}${sep}project=${encodeURIComponent(projectKey)}`;
		// Layout-doc read token, so the game can fetch its editor scenes at boot.
		if (data.editorDocSecret) out += `&k=${encodeURIComponent(data.editorDocSecret)}`;
		return out;
	};

	type SelectorProject = (typeof data.projects)[number];

	// Sentinel for "projects with no owning client" — the Client step always has
	// an entry to reach unassigned projects (e.g. the default `cloud`).
	const UNASSIGNED = '__unassigned__';

	// Distinct clients (alphabetical) plus the Unassigned bucket when any
	// accessible project has no client. Built from the projects the user can see.
	const clientOptions = $derived.by(() => {
		const byKey = new Map<string, string>();
		let hasUnassigned = false;
		for (const p of data.projects) {
			if (!p.clientKey) {
				hasUnassigned = true;
				continue;
			}
			byKey.set(p.clientKey, p.clientName ?? p.clientKey);
		}
		const clients = [...byKey.entries()]
			.map(([key, name]) => ({ key, name }))
			.sort((a, b) => a.name.localeCompare(b.name));
		if (hasUnassigned) clients.unshift({ key: UNASSIGNED, name: 'Unassigned' });
		return clients;
	});

	// Two-step selection state. The active project (from the session) seeds both
	// the Client and Project steps; user edits then submit `selectedProject`.
	const activeProject = $derived(
		data.projects.find((p) => p.key === data.activeProjectKey) ?? null,
	);
	let selectedClient = $state('');
	let selectedProject = $state('');
	$effect(() => {
		selectedClient = activeProject?.clientKey ?? UNASSIGNED;
		selectedProject = data.activeProjectKey ?? '';
	});

	// Projects shown in the second step: those owned by the selected client (or
	// the unassigned bucket), alphabetical.
	const clientProjects = $derived.by(() => {
		const wantUnassigned = selectedClient === UNASSIGNED;
		return data.projects
			.filter((p) => (wantUnassigned ? !p.clientKey : p.clientKey === selectedClient))
			.sort((a, b) => a.name.localeCompare(b.name));
	});

	// Switching client re-points the active project to that client's first
	// project (so the forwarded `&project=` stays valid for the new client) and
	// submits when it actually changes.
	async function onClientChange(form: HTMLFormElement | null, next: string) {
		selectedClient = next;
		const wantUnassigned = next === UNASSIGNED;
		const first = data.projects.find((p) =>
			wantUnassigned ? !p.clientKey : p.clientKey === next,
		);
		if (!first) return;
		selectedProject = first.key;
		// Wait for the project <select> (value + the new client's options) to
		// flush to the DOM before submitting — otherwise requestSubmit() reads
		// the stale `projectKey` and the active project snaps back.
		await tick();
		if (first.key !== data.activeProjectKey) form?.requestSubmit();
	}

	async function onProjectChange(form: HTMLFormElement | null, next: string) {
		selectedProject = next;
		await tick();
		if (next !== data.activeProjectKey) form?.requestSubmit();
	}
</script>

{#snippet projectSelector()}
	<form method="POST" action="?/setProject" use:enhance class="project">
		<div class="field">
			<label for="active-client">Client</label>
			<select
				id="active-client"
				value={selectedClient}
				onchange={(e) => onClientChange(e.currentTarget.form, e.currentTarget.value)}
			>
				{#each clientOptions as c (c.key)}
					<option value={c.key}>{c.name}</option>
				{/each}
			</select>
		</div>
		<div class="field">
			<label for="active-project">Project</label>
			<select
				id="active-project"
				name="projectKey"
				value={selectedProject}
				onchange={(e) => onProjectChange(e.currentTarget.form, e.currentTarget.value)}
			>
				{#each clientProjects as p (p.key)}
					<option value={p.key}>{p.name}</option>
				{/each}
			</select>
		</div>
	</form>
{/snippet}

<svelte:head><title>Launcher — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand"><Emblem height={18} /> INVISIBLE WALL</div>
		<div class="user">
			{@render projectSelector()}
			<span>{data.user.name ?? data.user.email} · <span class="role">{data.user.role}</span></span>
			{#if data.canAdmin}
				<a class="ghost" href="/admin">Admin</a>
			{/if}
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

	<section>
		<h2>Games</h2>
		<div class="grid">
			{#each data.games as game (game.key)}
				{#if game.url}
					<a class="tool" href={gameUrl(game.url)} target="_blank" rel="noopener">
						<strong>{game.name}</strong>
						<span class="muted">Launch for project '{projectKey}'</span>
						<span class="tag online">launch</span>
					</a>
				{:else}
					<div class="tool disabled">
						<strong>{game.name}</strong>
						<span class="muted">No URL set — configure in Admin.</span>
						<span class="tag online">launch</span>
					</div>
				{/if}
			{:else}
				<p class="muted">No games yet — add them in Admin.</p>
			{/each}
		</div>
	</section>
</div>

<style>
	.shell {
		width: 100%;
		box-sizing: border-box;
		padding: 32px clamp(24px, 4vw, 64px);
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
	.project {
		display: flex;
		align-items: center;
		gap: 12px;
	}
	.project .field {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.project label {
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: #777;
	}
	.project select {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 6px 9px;
		color: #e8e8ee;
		font-size: 13px;
	}
	.project select:focus {
		outline: none;
		border-color: #6b5bff;
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
	.tool.disabled {
		opacity: 0.55;
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
