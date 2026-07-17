<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Create form state.
	let key = $state('');
	let name = $state('');
	let clientKey = $state('');
	let gameType = $state(data.gameKinds[0]?.id ?? 'lines');
	let creating = $state(false);
	let createMsg = $state('');
	let createErr = $state('');

	// Per-project publish state, keyed by project key.
	let publishing = $state<Record<string, boolean>>({});
	let publishErr = $state<Record<string, string>>({});
	let copied = $state<string>('');

	// Publish confirmation: the project pending confirmation (null = no dialog).
	let confirmProject = $state<(typeof data.projects)[number] | null>(null);

	// "3 days ago" / "just now" from an epoch-ms timestamp. Null ⇒ never edited.
	function relativeTime(ms: number | null): string {
		if (!ms) return 'never edited';
		const diff = Date.now() - ms;
		if (diff < 60_000) return 'just now';
		const mins = Math.floor(diff / 60_000);
		if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`;
		const hours = Math.floor(mins / 60);
		if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
		const days = Math.floor(hours / 24);
		if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
		const months = Math.floor(days / 30);
		if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
		const years = Math.floor(months / 12);
		return `${years} year${years === 1 ? '' : 's'} ago`;
	}

	// Build a `?project=<key>` launch URL for a tool, so the opened tool binds to
	// THIS project (project-explicit scoping) instead of the hidden session scope.
	function launchUrl(tool: string, projectKey: string): string {
		return `/${tool}?project=${encodeURIComponent(projectKey)}`;
	}

	// Auto-derive a key slug from the typed name until the user edits the key.
	let keyTouched = $state(false);
	function onNameInput(value: string) {
		name = value;
		if (!keyTouched) {
			key = value
				.toLowerCase()
				.replace(/[^a-z0-9]+/g, '-')
				.replace(/^-+|-+$/g, '')
				.slice(0, 64);
		}
	}

	// Open the confirmation dialog naming the project + its scenes' last-edited time
	// before publishing — the decouple makes the wrong project structurally hard, and
	// this makes the RIGHT one obvious (catches a stale publish).
	function requestPublish(project: (typeof data.projects)[number]) {
		publishErr = { ...publishErr, [project.key]: '' };
		confirmProject = project;
	}

	async function confirmPublish() {
		const project = confirmProject;
		confirmProject = null;
		if (project) await publish(project.key);
	}

	async function publish(projectKey: string) {
		publishing = { ...publishing, [projectKey]: true };
		publishErr = { ...publishErr, [projectKey]: '' };
		try {
			const res = await fetch('/api/game-maker/publish', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ project: projectKey }),
			});
			const out = await res.json().catch(() => ({}));
			if (!res.ok) throw new Error(out?.error ?? `Publish failed (${res.status}).`);
			// Reload so the project row shows the new play URL + "published" state.
			await invalidateAll();
		} catch (e) {
			publishErr = {
				...publishErr,
				[projectKey]: e instanceof Error ? e.message : 'Publish failed.',
			};
		} finally {
			publishing = { ...publishing, [projectKey]: false };
		}
	}

	/** The author's own "Play" link: same published URL plus the authoring flag, so a game that
	 *  falls back to stale baked data says so on screen instead of looking healthy. Deliberately
	 *  NOT applied to the copied/displayed URL — that one is for players. */
	const playUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}ie_authoring=1`;

	async function copyUrl(url: string, projectKey: string) {
		try {
			await navigator.clipboard.writeText(url);
			copied = projectKey;
			setTimeout(() => (copied === projectKey ? (copied = '') : null), 1500);
		} catch {
			// clipboard blocked — ignore; the link is still visible.
		}
	}
</script>

<div class="shell">
	<ToolTopBar current="gameMaker" tools={data.tools} />

	<main>
		<section class="card create">
			<h2>Create a game</h2>
			<p class="hint">
				Pick a client and a game type, give it a name — this creates the project and its
				cloud scaffold. Author it with the editor + asset tools, then publish below.
			</p>
			<form
				method="POST"
				action="?/create"
				use:enhance={() => {
					creating = true;
					createMsg = '';
					createErr = '';
					return async ({ result, update }) => {
						creating = false;
						if (result.type === 'success' && result.data?.ok) {
							createMsg = String(result.data.ok);
							key = '';
							name = '';
							keyTouched = false;
							await update({ reset: false });
						} else if (result.type === 'failure') {
							createErr = String(result.data?.error ?? 'Create failed.');
						} else {
							await update();
						}
					};
				}}
			>
				<div class="grid">
					<label>
						Name
						<input
							value={name}
							oninput={(e) => onNameInput(e.currentTarget.value)}
							placeholder="e.g. Book of Borut"
							required
						/>
					</label>
					<label>
						Key
						<input
							bind:value={key}
							oninput={() => (keyTouched = true)}
							placeholder="book-of-borut"
							pattern="[a-z0-9][a-z0-9_\-]{'{'}0,63{'}'}"
							spellcheck="false"
							required
						/>
					</label>
					<label>
						Client
						<select bind:value={clientKey}>
							<option value="">Unassigned</option>
							{#each data.clients as c (c.key)}
								<option value={c.key}>{c.name}</option>
							{/each}
						</select>
					</label>
					<label>
						Game type
						<select bind:value={gameType}>
							{#each data.gameKinds as k (k.id)}
								<option value={k.id}>{k.name}</option>
							{/each}
						</select>
					</label>
				</div>
				<input type="hidden" name="key" value={key} />
				<input type="hidden" name="name" value={name} />
				<input type="hidden" name="clientKey" value={clientKey} />
				<input type="hidden" name="gameType" value={gameType} />
				<div class="actions">
					<button class="primary" type="submit" disabled={creating}>
						{creating ? 'Creating…' : 'Create project'}
					</button>
					{#if createMsg}<span class="ok">{createMsg}</span>{/if}
					{#if createErr}<span class="err">{createErr}</span>{/if}
				</div>
			</form>
		</section>

		<section class="card">
			<h2>Your projects</h2>
			{#if data.projects.length === 0}
				<p class="muted">No projects yet — create one above.</p>
			{:else}
				<ul class="projects">
					{#each data.projects as p (p.key)}
						<li>
							<div class="meta">
								<span class="pname">{p.name}</span>
								<span class="pkey">{p.key}</span>
								{#if p.clientName}<span class="pclient">{p.clientName}</span>{/if}
								<span class="pedited">scenes edited {relativeTime(p.scenesUpdatedAt)}</span>
							</div>
							<div class="launch">
								{#if data.launchTools.editor}
									<a class="tool" href={launchUrl('editor', p.key)}>Edit</a>
								{/if}
								{#if data.launchTools.atlasTool}
									<a class="tool" href={launchUrl('atlas', p.key)}>Atlas</a>
								{/if}
								{#if data.launchTools.fontMaker}
									<a class="tool" href={launchUrl('fonts', p.key)}>Fonts</a>
								{/if}
								{#if data.launchTools.symbols}
									<a class="tool" href={launchUrl('symbols', p.key)}>Symbols</a>
								{/if}
								{#if data.launchTools.localization}
									<a class="tool" href={launchUrl('localization', p.key)}>Localization</a>
								{/if}
							</div>
							<div class="pub">
								<button
									class="primary"
									onclick={() => requestPublish(p)}
									disabled={publishing[p.key]}
								>
									{#if publishing[p.key]}
										Publishing…
									{:else}
										{p.published ? 'Re-publish' : 'Publish'}
									{/if}
								</button>
								{#if p.published && p.url}
									<a class="play" href={playUrl(p.url)} target="_blank" rel="noopener noreferrer">
										Play ↗
									</a>
									<button class="copy" onclick={() => copyUrl(p.url!, p.key)}>
										{copied === p.key ? 'Copied' : 'Copy URL'}
									</button>
								{/if}
								{#if publishErr[p.key]}<span class="err">{publishErr[p.key]}</span>{/if}
							</div>
							{#if p.published && p.url}
								<a class="url" href={p.url} target="_blank" rel="noopener noreferrer">{p.url}</a>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	</main>

	{#if confirmProject}
		<div
			class="modal-backdrop"
			role="presentation"
			onclick={() => (confirmProject = null)}
		>
			<div
				class="modal"
				role="dialog"
				aria-modal="true"
				aria-labelledby="confirm-title"
				onclick={(e) => e.stopPropagation()}
			>
				<h3 id="confirm-title">Publish {confirmProject.name}?</h3>
				<p class="confirm-body">
					You are about to publish <strong>{confirmProject.name}</strong>
					<span class="ckey">({confirmProject.key})</span>.<br />
					Its scenes were last edited <strong>{relativeTime(confirmProject.scenesUpdatedAt)}</strong>.
				</p>
				<p class="confirm-note">
					Publishing builds and deploys this project's current saved scenes — make sure this is
					the project you intend to ship.
				</p>
				<div class="confirm-actions">
					<button onclick={() => (confirmProject = null)}>Cancel</button>
					<button class="primary" onclick={confirmPublish}>
						{confirmProject.published ? 'Re-publish' : 'Publish'}
					</button>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		min-height: 100vh;
		background: #0d0d11;
		color: #e8e8ee;
	}
	main {
		flex: 1;
		padding: 24px;
		max-width: 880px;
		width: 100%;
		margin: 0 auto;
		display: flex;
		flex-direction: column;
		gap: 20px;
	}
	.card {
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
		padding: 20px;
	}
	h2 {
		margin: 0 0 6px;
		font-size: 16px;
		letter-spacing: 0.02em;
	}
	.hint,
	.muted {
		color: #9a9aa6;
		font-size: 13px;
		margin: 0 0 14px;
	}
	.muted {
		margin: 0;
	}
	.grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 5px;
		font-size: 12px;
		font-weight: 600;
		color: #b9b9c4;
	}
	input,
	select {
		background: #0d0d12;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		padding: 8px 10px;
		font-size: 13px;
		font-weight: 400;
	}
	input:focus,
	select:focus {
		outline: none;
		border-color: #3a8f74;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 16px;
	}
	button {
		cursor: pointer;
		border: 1px solid #2c2c38;
		background: #1b1b22;
		color: #e8e8ee;
		border-radius: 8px;
		padding: 7px 14px;
		font-size: 13px;
		font-weight: 600;
	}
	button:hover:not(:disabled) {
		border-color: #3a3a48;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.primary {
		background: #1f6f57;
		border-color: #2b8d6f;
		color: #eafff6;
	}
	.primary:hover:not(:disabled) {
		background: #25826698;
		border-color: #34a784;
	}
	.ok {
		color: #7ee0c0;
		font-size: 13px;
	}
	.err {
		color: #ff8c8c;
		font-size: 13px;
	}
	.projects {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.projects li {
		border: 1px solid #23232e;
		border-radius: 10px;
		padding: 12px 14px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.meta {
		display: flex;
		align-items: baseline;
		gap: 10px;
		flex-wrap: wrap;
	}
	.pname {
		font-weight: 700;
	}
	.pkey {
		font-size: 12px;
		color: #8a8a96;
		font-family: ui-monospace, monospace;
	}
	.pclient {
		font-size: 11px;
		color: #7ee0c0;
		border: 1px solid #2b6f5a;
		border-radius: 999px;
		padding: 1px 8px;
	}
	.pedited {
		font-size: 11px;
		color: #7a7a86;
		margin-left: auto;
	}
	.launch {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}
	.launch .tool {
		display: inline-flex;
		align-items: center;
		padding: 4px 10px;
		border-radius: 7px;
		border: 1px solid #2c2c38;
		background: #16161d;
		color: #b9b9c4;
		text-decoration: none;
		font-size: 12px;
		font-weight: 600;
	}
	.launch .tool:hover {
		border-color: #3a8f74;
		color: #e8e8ee;
	}
	.pub {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 24px;
		z-index: 50;
	}
	.modal {
		background: #14141b;
		border: 1px solid #2b8d6f;
		border-radius: 12px;
		padding: 22px 24px;
		max-width: 440px;
		width: 100%;
	}
	.modal h3 {
		margin: 0 0 12px;
		font-size: 16px;
	}
	.confirm-body {
		margin: 0 0 10px;
		font-size: 14px;
		line-height: 1.5;
		color: #e8e8ee;
	}
	.confirm-body .ckey {
		font-family: ui-monospace, monospace;
		font-size: 12px;
		color: #8a8a96;
	}
	.confirm-note {
		margin: 0 0 18px;
		font-size: 12px;
		color: #9a9aa6;
		line-height: 1.5;
	}
	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 10px;
	}
	.play {
		color: #7ee0c0;
		text-decoration: none;
		font-size: 13px;
		font-weight: 600;
	}
	.play:hover {
		text-decoration: underline;
	}
	.url {
		font-size: 11px;
		color: #6c6c78;
		word-break: break-all;
		font-family: ui-monospace, monospace;
		text-decoration: none;
	}
	.url:hover {
		color: #9a9aa6;
	}
	@media (max-width: 640px) {
		.grid {
			grid-template-columns: 1fr;
		}
	}
</style>
