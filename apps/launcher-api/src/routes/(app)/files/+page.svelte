<script lang="ts">
	import Emblem from '$lib/Emblem.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	interface FileEntry {
		key: string;
		size: number;
		lastModified: string | null;
	}

	/** Current folder prefix (`''` = root namespace list). */
	let prefix = $state('');
	let folders = $state<string[]>(data.rootFolders);
	let files = $state<FileEntry[]>([]);
	let nextToken = $state<string | null>(null);
	let loading = $state(false);
	let busy = $state(false);
	let errorMsg = $state('');
	let selected = $state<Record<string, boolean>>({});

	let fileInput: HTMLInputElement | null = $state(null);

	const atRoot = $derived(prefix === '');
	const selectedKeys = $derived(Object.keys(selected).filter((k) => selected[k]));

	/** Breadcrumb segments from the current prefix, each with the prefix to jump to. */
	const crumbs = $derived.by(() => {
		if (atRoot) return [] as { label: string; target: string }[];
		const parts = prefix.replace(/\/$/, '').split('/');
		const out: { label: string; target: string }[] = [];
		let acc = '';
		for (const p of parts) {
			acc += p + '/';
			out.push({ label: p, target: acc });
		}
		return out;
	});

	function basename(key: string): string {
		const trimmed = key.replace(/\/$/, '');
		return trimmed.slice(trimmed.lastIndexOf('/') + 1);
	}

	function humanSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		const units = ['KB', 'MB', 'GB', 'TB'];
		let v = bytes / 1024;
		let i = 0;
		while (v >= 1024 && i < units.length - 1) {
			v /= 1024;
			i++;
		}
		return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
	}

	function humanDate(iso: string | null): string {
		if (!iso) return '';
		const d = new Date(iso);
		return Number.isNaN(d.getTime()) ? '' : d.toLocaleString();
	}

	async function load(target: string, append = false): Promise<void> {
		errorMsg = '';
		loading = true;
		try {
			const params = new URLSearchParams();
			if (target) params.set('prefix', target);
			if (append && nextToken) params.set('token', nextToken);
			const res = await fetch(`/api/files/list?${params}`);
			if (!res.ok) throw new Error(await errText(res));
			const body = (await res.json()) as {
				folders: string[];
				files: FileEntry[];
				nextToken: string | null;
			};
			if (append) {
				folders = [...folders, ...body.folders];
				files = [...files, ...body.files];
			} else {
				folders = body.folders;
				files = body.files;
				selected = {};
			}
			nextToken = body.nextToken;
			prefix = target;
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Failed to load.';
		} finally {
			loading = false;
		}
	}

	async function errText(res: Response): Promise<string> {
		try {
			const j = (await res.clone().json()) as { message?: string };
			if (j?.message) return j.message;
		} catch {
			/* fall through to text */
		}
		return (await res.text()) || `${res.status} ${res.statusText}`;
	}

	function refresh(): Promise<void> {
		return load(prefix);
	}

	function openFolder(p: string): void {
		void load(p);
	}

	function downloadUrl(key: string): string {
		return `/api/files/download?key=${encodeURIComponent(key)}`;
	}

	async function uploadFiles(list: FileList | null): Promise<void> {
		if (!list || list.length === 0 || atRoot) return;
		busy = true;
		errorMsg = '';
		try {
			const fd = new FormData();
			fd.set('prefix', prefix);
			for (const f of list) fd.append('file', f);
			const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
			if (!res.ok) throw new Error(await errText(res));
			await refresh();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Upload failed.';
		} finally {
			busy = false;
			if (fileInput) fileInput.value = '';
		}
	}

	async function deleteKeys(keys: string[]): Promise<void> {
		if (keys.length === 0) return;
		const label = keys.length === 1 ? basename(keys[0]) : `${keys.length} files`;
		if (!confirm(`Delete ${label}? This cannot be undone.`)) return;
		await mutate('/api/files/delete', { keys });
	}

	async function deleteFolder(p: string): Promise<void> {
		if (!confirm(`Delete the folder "${basename(p)}" and everything in it? This cannot be undone.`))
			return;
		await mutate('/api/files/delete', { prefix: p });
	}

	async function rename(key: string, isFolder: boolean): Promise<void> {
		const current = key;
		const next = prompt(
			isFolder ? 'New folder path (must end with /):' : 'New full key (path):',
			current,
		);
		if (!next || next === current) return;
		await mutate('/api/files/move', { from: current, to: next });
	}

	async function mutate(path: string, payload: unknown): Promise<void> {
		busy = true;
		errorMsg = '';
		try {
			const res = await fetch(path, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			});
			if (!res.ok) throw new Error(await errText(res));
			await refresh();
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Operation failed.';
		} finally {
			busy = false;
		}
	}
</script>

<svelte:head><title>Invisible FTP Browser — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<a class="brand" href="/"><Emblem height={18} /> INVISIBLE FTP BROWSER</a>
		<div class="meta">
			<span class="project">Project: <strong>{data.clientKey}/{data.projectKey}</strong></span>
			{#if busy || loading}<span class="status">Working…</span>{/if}
		</div>
	</header>

	<nav class="crumbs">
		<button class="crumb" type="button" onclick={() => openFolder('')}>root</button>
		{#each crumbs as c (c.target)}
			<span class="sep">/</span>
			<button class="crumb" type="button" onclick={() => openFolder(c.target)}>{c.label}</button>
		{/each}
	</nav>

	<div class="toolbar">
		{#if !atRoot}
			<input
				type="file"
				multiple
				bind:this={fileInput}
				onchange={(e) => void uploadFiles(e.currentTarget.files)}
				disabled={busy}
			/>
			<button type="button" onclick={() => fileInput?.click()} disabled={busy}>Upload here</button>
			{#if selectedKeys.length > 0}
				<button class="danger" type="button" onclick={() => void deleteKeys(selectedKeys)} disabled={busy}>
					Delete selected ({selectedKeys.length})
				</button>
			{/if}
		{:else}
			<span class="muted">Pick a tool folder to browse this project's files.</span>
		{/if}
		<button class="ghost" type="button" onclick={() => void refresh()} disabled={busy || loading}>
			Refresh
		</button>
	</div>

	{#if errorMsg}<p class="error">{errorMsg}</p>{/if}

	<div class="listing">
		{#if folders.length === 0 && files.length === 0 && !loading}
			<p class="muted empty">This folder is empty.</p>
		{/if}

		{#each folders as f (f)}
			<div class="row folder">
				<span class="cell name">
					<button type="button" class="namebtn" onclick={() => openFolder(f)}>
						📁 {basename(f)}/
					</button>
				</span>
				<span class="cell size"></span>
				<span class="cell date"></span>
				<span class="cell actions">
					{#if !atRoot}
						<button type="button" onclick={() => void rename(f, true)} disabled={busy}>Move</button>
						<button class="danger" type="button" onclick={() => void deleteFolder(f)} disabled={busy}>
							Delete
						</button>
					{/if}
				</span>
			</div>
		{/each}

		{#each files as file (file.key)}
			<div class="row">
				<span class="cell name">
					<input type="checkbox" bind:checked={selected[file.key]} />
					<span class="fname" title={file.key}>{basename(file.key)}</span>
				</span>
				<span class="cell size">{humanSize(file.size)}</span>
				<span class="cell date">{humanDate(file.lastModified)}</span>
				<span class="cell actions">
					<a href={downloadUrl(file.key)}>Download</a>
					<button type="button" onclick={() => void rename(file.key, false)} disabled={busy}>
						Move
					</button>
					<button class="danger" type="button" onclick={() => void deleteKeys([file.key])} disabled={busy}>
						Delete
					</button>
				</span>
			</div>
		{/each}
	</div>

	{#if nextToken}
		<div class="loadmore">
			<button type="button" onclick={() => void load(prefix, true)} disabled={loading}>
				Load more
			</button>
		</div>
	{/if}
</div>

<style>
	.shell {
		width: 100%;
		max-width: 1400px;
		margin: 0 auto;
		padding: clamp(16px, 3vw, 24px);
		color: #e8e8ee;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 18px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: #7ee0c0;
		font-size: 15px;
		text-decoration: none;
	}
	.meta {
		display: flex;
		align-items: center;
		gap: 14px;
		font-size: 13px;
		color: #888;
	}
	.project strong {
		color: #c8a3ff;
	}
	.status {
		color: #7ee0c0;
	}
	.crumbs {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 4px;
		font-size: 13px;
		margin-bottom: 12px;
	}
	.crumb {
		background: transparent;
		border: none;
		color: #7ee0c0;
		cursor: pointer;
		padding: 2px 4px;
		font-size: 13px;
	}
	.crumb:hover {
		text-decoration: underline;
	}
	.sep {
		color: #555;
	}
	.toolbar {
		display: flex;
		align-items: center;
		gap: 10px;
		flex-wrap: wrap;
		margin-bottom: 14px;
	}
	.muted {
		color: #777;
		font-size: 13px;
	}
	.error {
		color: #ff8e8e;
		font-size: 13px;
		margin: 0 0 12px;
	}
	button {
		background: #2a2430;
		color: #e8e8ee;
		border: 1px solid #3a3340;
		border-radius: 8px;
		padding: 6px 12px;
		font-size: 13px;
		font-family: inherit;
		cursor: pointer;
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
	button.ghost {
		background: transparent;
	}
	button.danger {
		border-color: #5a2a2a;
		color: #ff9e9e;
	}
	input[type='file'] {
		display: none;
	}
	.listing {
		border: 1px solid #222;
		border-radius: 12px;
		background: #16161c;
		overflow: hidden;
	}
	.empty {
		padding: 18px;
	}
	.row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) 110px 200px auto;
		align-items: center;
		gap: 12px;
		padding: 8px 14px;
		border-bottom: 1px solid #1f1f26;
		font-size: 13px;
	}
	.row:last-child {
		border-bottom: none;
	}
	.cell.name {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.fname,
	.namebtn {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.namebtn {
		background: transparent;
		border: none;
		color: #cfe9ff;
		cursor: pointer;
		padding: 0;
		font-size: 13px;
		text-align: left;
	}
	.namebtn:hover {
		text-decoration: underline;
	}
	.cell.size,
	.cell.date {
		color: #888;
	}
	.cell.actions {
		display: flex;
		gap: 6px;
		justify-content: flex-end;
	}
	.cell.actions a {
		color: #7ee0c0;
		text-decoration: none;
		align-self: center;
		font-size: 13px;
	}
	.cell.actions a:hover {
		text-decoration: underline;
	}
	.cell.actions button {
		padding: 4px 10px;
	}
	.loadmore {
		margin-top: 14px;
		text-align: center;
	}
</style>
