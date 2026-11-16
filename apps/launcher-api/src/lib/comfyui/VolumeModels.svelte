<script lang="ts">
	/**
	 * The models half of /comfyui's "What's installed", for admins, when the Network Volume can be
	 * read through its S3 API: every model file with its size, which blueprints use it, whether
	 * the R2 mirror holds it — plus Delete, Keep and Add. Everything is re-checked by the server
	 * (`/comfyui/volume/*`); this component only asks.
	 */
	import { onDestroy, onMount } from 'svelte';
	import ConfirmDialog from '$lib/ConfirmDialog.svelte';
	import { askText } from '$lib/dialogs.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';
	import InfoTip from '$lib/ui/InfoTip.svelte';
	import {
		NETWORK_VOLUME_USD_PER_GB_MONTH,
		formatBytes,
		monthlyUsd,
		uploadTargetError,
		type FolderGroup,
		type ModelRow,
	} from '$lib/volumeModels';

	interface Props {
		/** Told whether this component is managing the list, so the page hides its pod-read one. */
		onmanaged: (managed: boolean) => void;
	}
	const { onmanaged }: Props = $props();

	interface TransferJob {
		id: string;
		source: string;
		target: string;
		bytes: number;
		total: number | null;
		state: 'running' | 'done' | 'failed' | 'cancelled';
		error: string | null;
		finishedAt: string | null;
	}

	interface View {
		configured: boolean;
		missing: string[];
		label: string;
		readAt: string | null;
		refreshing: boolean;
		error: string | null;
		volume: { name: string; sizeGb: number; dataCenterId: string } | null;
		usedBytes: number;
		folders: FolderGroup[];
		mirrorOnly: {
			key: string;
			folder: string;
			path: string;
			size: number;
			expected: boolean;
			indexed: boolean;
		}[];
		pendingUploads: number;
		activity: { endpointJobs: number | null; runningPods: string[] };
		canCheckRenders: boolean;
		jobs: TransferJob[];
	}

	let view = $state<View | null>(null);
	let loadError = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	async function load(refresh = false) {
		clearTimeout(timer);
		try {
			const res = await fetch(`/comfyui/volume${refresh ? '?refresh=1' : ''}`);
			const body = await res.json();
			if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
			view = body as View;
			loadError = '';
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
		onmanaged(!!view?.configured);
		const busy = view?.refreshing || view?.jobs.some((j) => j.state === 'running');
		if (busy) timer = setTimeout(() => load(), 3000);
	}

	onMount(() => void load());
	onDestroy(() => clearTimeout(timer));

	const billedUsd = $derived(
		view?.volume ? view.volume.sizeGb * NETWORK_VOLUME_USD_PER_GB_MONTH : null,
	);
	const freeBytes = $derived(
		view?.volume ? Math.max(0, view.volume.sizeGb * 1e9 - view.usedBytes) : null,
	);
	const folderNames = $derived((view?.folders ?? []).map((f) => f.folder));

	async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
		const res = await fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body),
		});
		const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		if (!res.ok) throw new Error(typeof out.error === 'string' ? out.error : `HTTP ${res.status}`);
		return out;
	}

	// --- Delete: a first confirmation, and a second naming the blueprints / Keep -------------

	let target = $state<ModelRow | null>(null);
	let step = $state<1 | 2>(1);
	let alsoMirror = $state(false);
	let noRenderRunning = $state(false);
	let deleting = $state(false);
	let deleteError = $state('');
	const needsSecond = $derived(!!target && (target.usedBy.length > 0 || !!target.keep));

	function askDelete(row: ModelRow) {
		target = row;
		step = 1;
		alsoMirror = false;
		noRenderRunning = false;
		deleteError = '';
	}

	function closeDelete() {
		if (deleting) return;
		target = null;
	}

	async function confirmDelete() {
		if (!target) return;
		if (step === 1 && needsSecond) {
			step = 2;
			return;
		}
		if (!view?.canCheckRenders && !noRenderRunning) {
			deleteError = 'Tick that no render is running first — the launcher cannot check.';
			return;
		}
		deleting = true;
		deleteError = '';
		try {
			await post('/comfyui/volume/delete', {
				key: target.key,
				confirmBlueprints: target.usedBy.map((b) => b.id),
				confirmKeep: !!target.keep,
				alsoMirror,
				confirmNoRenderCheck: !view?.canCheckRenders && noRenderRunning,
			});
			target = null;
			await load();
		} catch (e) {
			deleteError = e instanceof Error ? e.message : String(e);
		} finally {
			deleting = false;
		}
	}

	async function toggleKeep(row: ModelRow) {
		let note: string | null = null;
		if (!row.keep) {
			note = await askText({
				title: `Keep ${row.path}`,
				message: 'Why it stays — shown on the row, and asked about again before any delete.',
				label: 'Note',
				value: '',
				confirmLabel: 'Keep',
			});
			if (note === null) return;
		}
		try {
			await post('/comfyui/volume/keep', { key: row.key, note });
			await load();
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	// --- Add: from this computer (via the R2 mirror) or a public URL -------------------------

	let addOpen = $state(false);
	let addFolder = $state('');
	let addName = $state('');
	let addFrom = $state<'file' | 'url'>('file');
	let addUrl = $state('');
	let addMirror = $state(false);
	let addFile = $state<File | null>(null);
	let addBusy = $state(false);
	let addError = $state('');
	let uploadPct = $state<number | null>(null);
	let uploadAbort: AbortController | null = null;

	const addTargetError = $derived(addName ? uploadTargetError(addFolder, addName) : null);

	function pickFile(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null;
		addFile = file;
		if (file && !addName) addName = file.name;
	}

	async function uploadFromComputer(file: File) {
		const start = await post('/comfyui/volume/upload', {
			action: 'start',
			folder: addFolder,
			path: addName,
			size: file.size,
		});
		const uploadId = String(start.uploadId);
		const partSize = Number(start.partSize);
		const parts = Number(start.parts);
		const base = { folder: addFolder, path: addName, uploadId };
		uploadAbort = new AbortController();
		let done = 0;
		try {
			for (let from = 1; from <= parts; from += 50) {
				const batch = await post('/comfyui/volume/upload', {
					...base,
					action: 'urls',
					from,
					count: Math.min(50, parts - from + 1),
				});
				const urls = batch.urls as string[];
				let next = 0;
				const worker = async () => {
					while (next < urls.length) {
						const i = next++;
						const n = from + i;
						const blob = file.slice((n - 1) * partSize, Math.min(file.size, n * partSize));
						const res = await fetch(urls[i], {
							method: 'PUT',
							body: blob,
							signal: uploadAbort?.signal,
						});
						if (!res.ok) throw new Error(`Part ${n} failed (HTTP ${res.status}).`);
						done += blob.size;
						uploadPct = Math.round((done / file.size) * 100);
					}
				};
				await Promise.all([worker(), worker(), worker()]);
			}
			// The server refuses to complete while another transfer runs (it would strand the
			// object unindexed), so wait for that one rather than throwing the upload away.
			for (;;) {
				const res = await fetch('/comfyui/volume/upload', {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ ...base, action: 'complete' }),
				});
				if (res.ok) break;
				const out = (await res.json().catch(() => ({}))) as { error?: string };
				if (res.status !== 409) throw new Error(out.error ?? `HTTP ${res.status}`);
				addError = `${out.error ?? 'Waiting'} (retrying)`;
				await new Promise((r) => setTimeout(r, 10_000));
			}
			addError = '';
		} catch (e) {
			await post('/comfyui/volume/upload', { ...base, action: 'abort' }).catch(() => {});
			throw e;
		} finally {
			uploadAbort = null;
			uploadPct = null;
		}
	}

	async function submitAdd() {
		addError = uploadTargetError(addFolder, addName) ?? '';
		if (addError) return;
		addBusy = true;
		try {
			if (addFrom === 'file') {
				if (!addFile) throw new Error('Choose a file.');
				await uploadFromComputer(addFile);
			} else {
				await post('/comfyui/volume/transfer', {
					source: addUrl,
					folder: addFolder,
					path: addName,
					mirror: addMirror,
				});
			}
			addOpen = false;
			addName = '';
			addUrl = '';
			addFile = null;
			await load();
		} catch (e) {
			addError = e instanceof Error ? e.message : String(e);
		} finally {
			addBusy = false;
		}
	}

	async function copyToVolume(m: View['mirrorOnly'][number]) {
		try {
			await post('/comfyui/volume/transfer', {
				source: m.key,
				folder: m.folder,
				path: m.path,
				mirror: true,
			});
			await load();
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	async function cancelJob(id: string) {
		await fetch(`/comfyui/volume/transfer?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
		await load();
	}

	async function clearPending() {
		try {
			await post('/comfyui/volume/pending', {});
			await load();
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
		}
	}

	function when(iso: string | null): string {
		return iso ? new Date(iso).toLocaleString() : 'never';
	}
</script>

{#if view && !view.configured}
	<p class="hint">
		Set {#each view.missing as name, i (name)}{i ? ' + ' : ''}<code>{name}</code>{/each} on the launcher
		(a RunPod
		<strong>S3 API key</strong>) to see sizes, uses and costs here, and to delete or add models.
	</p>
{:else if view}
	<h3>
		Models
		<span class="sub">
			{formatBytes(view.usedBytes)} on the volume{#if view.volume}
				&nbsp;of {view.volume.sizeGb} GB · billed ${billedUsd?.toFixed(2)}/mo{/if}
		</span>
		<InfoTip label="Cost">
			RunPod bills a Network Volume on its <strong>provisioned</strong> size (${NETWORK_VOLUME_USD_PER_GB_MONTH}/GB/month
			under 1 TB), and a volume can be grown but
			<strong>never shrunk</strong>. Deleting frees room for new models without growing the volume;
			it lowers the bill only once the weights move to a new, smaller volume — one sized to these
			{formatBytes(view.usedBytes)} would cost about ${monthlyUsd(view.usedBytes).toFixed(2)}/mo. (A
			Global Volume was measured and is no cheaper, and 4–7× slower to load from.)
			{#if freeBytes !== null}Free now: {formatBytes(freeBytes)}.{/if}
		</InfoTip>
	</h3>
	<p class="hint">
		{view.label} · read {when(view.readAt)}{#if view.refreshing}
			· <span class="spinner"></span> reading…{/if}
	</p>
	{#if view.error}<p class="err">The last read failed: {view.error}</p>{/if}
	{#if loadError}<p class="err">{loadError}</p>{/if}
	{#if view.activity.endpointJobs}
		<p class="warn">
			{view.activity.endpointJobs} render job(s) running on the serverless endpoint — deletes wait until
			they finish.
		</p>
	{:else if !view.canCheckRenders}
		<p class="warn">
			<code>RUNPOD_ENDPOINT_ID</code> is not set on the launcher, so a delete cannot check for renders
			in flight.
		</p>
	{/if}
	{#if view.activity.runningPods.length}
		<p class="warn">
			Running now: {view.activity.runningPods.join(', ')} — deletes wait until it is stopped.
		</p>
	{/if}

	<ul class="folders">
		{#each view.folders as folder (folder.folder)}
			<li>
				<details>
					<summary>
						<span class="fname">{folder.folder}</span>
						<span class="count">{folder.files.length} · {formatBytes(folder.bytes)}</span>
					</summary>
					<ul class="rows">
						{#each folder.files as row (row.key)}
							<li>
								<span class="path">{row.path}</span>
								{#if row.usedBy.length}
									<span
										class="badge used"
										title={row.usedBy.map((b) => `${b.name} (${b.kind})`).join('\n')}
									>
										used by {row.usedBy.length}
									</span>
								{/if}
								{#if row.keep}<span class="badge keep" title={row.keep.note}>keep</span>{/if}
								{#if row.mirror}
									<span class="badge" title="Also in the R2 mirror — desktops can Sync it">R2</span>
								{:else}
									<span class="badge dim" title="Only on the volume — deleting it loses it">
										volume only
									</span>
								{/if}
								<span class="size">{formatBytes(row.size)}</span>
								<button
									class="link"
									onclick={() => toggleKeep(row)}
									title={row.keep ? 'Stop keeping' : 'Keep — ask again before deleting'}
								>
									{row.keep ? 'unkeep' : 'keep'}
								</button>
								<IconButton
									icon="trash"
									danger
									label="Delete from the volume"
									onclick={() => askDelete(row)}
								/>
							</li>
						{/each}
					</ul>
				</details>
			</li>
		{/each}
	</ul>

	{#if view.mirrorOnly.length}
		<h3>In the R2 mirror, not on the volume</h3>
		<ul class="rows">
			{#each view.mirrorOnly as m (m.key)}
				<li>
					<span class="path">{m.folder}/{m.path}</span>
					{#if !m.indexed}<span
							class="badge used"
							title="In R2 with no manifest entry — an upload whose copy never finished"
							>unindexed</span
						>{/if}
					{#if !m.expected}<span class="badge dim" title="Removed from the volume on purpose"
							>removed</span
						>{/if}
					<span class="size">{formatBytes(m.size)}</span>
					<button class="link" onclick={() => copyToVolume(m)}>copy to volume</button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if view.jobs.length}
		<h3>Transfers</h3>
		<ul class="rows">
			{#each view.jobs as job (job.id)}
				<li>
					<span class="path">{job.target.replace('ComfyUI/models/', '')}</span>
					<span class="badge" class:used={job.state === 'failed'}>{job.state}</span>
					<span class="size">
						{formatBytes(job.bytes)}{#if job.total}&nbsp;/ {formatBytes(job.total)}{/if}
					</span>
					{#if job.state === 'running'}
						<button class="link" onclick={() => cancelJob(job.id)}>cancel</button>
					{/if}
					{#if job.error}<span class="err small">{job.error}</span>{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#if view.pendingUploads > 0}
		<p class="warn">
			{view.pendingUploads} unfinished upload(s) are holding space on the volume.
			<button class="link" onclick={clearPending}>clear them</button>
		</p>
	{/if}

	{#if addOpen}
		<form class="add" onsubmit={(e) => (e.preventDefault(), submitAdd())}>
			<label>
				Folder
				<input list="vm-folders" bind:value={addFolder} placeholder="loras" required />
				<datalist id="vm-folders">
					{#each folderNames as f (f)}<option value={f}></option>{/each}
				</datalist>
			</label>
			<div class="from">
				<label><input type="radio" bind:group={addFrom} value="file" /> From this computer</label>
				<label><input type="radio" bind:group={addFrom} value="url" /> From a URL</label>
				<InfoTip label="How it travels">
					The volume takes no direct browser uploads, so a file from this computer goes into the R2
					mirror first and the launcher copies it onto the volume (it then also reaches desktops
					through Sync models). A URL — a public Hugging Face link — is copied straight onto the
					volume; tick the box to keep a mirror copy too.
				</InfoTip>
			</div>
			{#if addFrom === 'file'}
				<input type="file" onchange={pickFile} />
			{:else}
				<input
					type="url"
					bind:value={addUrl}
					placeholder="https://huggingface.co/…/resolve/main/…"
				/>
				<label class="check">
					<input type="checkbox" bind:checked={addMirror} /> Also keep a copy in the R2 mirror
				</label>
			{/if}
			<label>
				File name
				<input bind:value={addName} placeholder="my-style.safetensors" required />
			</label>
			{#if addTargetError}<p class="err small">{addTargetError}</p>{/if}
			{#if addError}<p class="err small">{addError}</p>{/if}
			<div class="add-actions">
				<button class="secondary" type="submit" disabled={addBusy || !!addTargetError}>
					{#if uploadPct !== null}Uploading {uploadPct}%…{:else if addBusy}Starting…{:else}Add{/if}
				</button>
				<button
					class="link"
					type="button"
					onclick={() => (uploadAbort ? uploadAbort.abort() : (addOpen = false))}
				>
					cancel
				</button>
			</div>
		</form>
	{/if}

	<div class="vm-actions">
		<button class="secondary" onclick={() => load(true)} disabled={view.refreshing}>
			{view.refreshing ? 'Reading…' : 'Re-read the volume'}
		</button>
		{#if !addOpen}
			<button class="secondary" onclick={() => (addOpen = true)}>Add a model</button>
		{/if}
	</div>
{:else if loadError}
	<p class="err">{loadError}</p>
{/if}

<ConfirmDialog
	open={!!target}
	title={step === 1 ? `Delete ${target?.path ?? ''}?` : 'This file is in use'}
	danger
	confirmLabel={step === 1 && needsSecond ? 'Continue' : 'Delete'}
	requireText={step === 2 ? target?.path.split('/').pop() : undefined}
	requireHint="Type the file name to delete it anyway"
	busy={deleting}
	busyLabel="Deleting…"
	error={deleteError}
	onconfirm={confirmDelete}
	oncancel={closeDelete}
>
	{#snippet body()}
		{#if target && step === 1}
			<p>
				{target.folder}/{target.path} — {formatBytes(target.size)} off the volume.
				{#if !target.mirror}It is <strong>not</strong> in the R2 mirror, so this cannot be undone.{/if}
			</p>
			{#if target.mirror}
				<label class="check">
					<input type="checkbox" bind:checked={alsoMirror} />
					Also delete the R2 mirror copy and its manifest entry (desktops stop syncing it). Left unticked,
					it stays in R2 and can be copied back.
				</label>
			{/if}
			{#if !view?.canCheckRenders}
				<p class="warn">
					<code>RUNPOD_ENDPOINT_ID</code> is not set, so the launcher cannot see renders in flight. A
					worker loading this file while it goes fails its render.
				</p>
				<label class="check">
					<input type="checkbox" bind:checked={noRenderRunning} />
					I have checked that no render is running on the serverless endpoint.
				</label>
			{/if}
		{:else if target}
			{#if target.usedBy.length}
				<p>These blueprints name it, and will fail to render without it:</p>
				<ul>
					{#each target.usedBy as b (b.id)}<li>
							<strong>{b.name}</strong> ({b.kind}) — {b.id}
						</li>{/each}
				</ul>
			{/if}
			{#if target.keep}<p>It is marked <strong>Keep</strong>: {target.keep.note}</p>{/if}
		{/if}
	{/snippet}
</ConfirmDialog>

<style>
	h3 {
		margin: 16px 0 8px;
		font-size: 13px;
		letter-spacing: 0.04em;
		text-transform: uppercase;
		color: #a9a9b4;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.sub {
		font-weight: 400;
		font-size: 12px;
		letter-spacing: 0;
		text-transform: none;
		color: #8a8a93;
	}
	.hint {
		font-size: 13px;
		color: #8a8a93;
		margin: 6px 0 0;
	}
	.warn {
		font-size: 13px;
		color: #e0c06a;
		margin: 8px 0 0;
	}
	.err {
		font-size: 13px;
		color: #e0906a;
		margin: 8px 0 0;
	}
	.small {
		font-size: 12px;
		margin: 0;
	}
	.folders {
		list-style: none;
		margin: 8px 0 0;
		padding: 0;
		font-size: 13px;
	}
	.folders > li {
		padding: 7px 0;
		border-bottom: 1px solid #1d1d25;
	}
	summary {
		display: flex;
		align-items: center;
		gap: 10px;
		cursor: pointer;
		list-style: none;
	}
	summary::-webkit-details-marker {
		display: none;
	}
	summary::before {
		content: '›';
		color: #6a6a76;
	}
	details[open] summary::before {
		color: #7ee0c0;
	}
	.fname {
		color: #e2e2ea;
	}
	.count {
		margin-left: auto;
		font-size: 12px;
		color: #8a8a93;
	}
	.rows {
		list-style: none;
		margin: 6px 0 4px 16px;
		padding: 0 0 0 10px;
		border-left: 1px solid #2a2a34;
		font-size: 12px;
	}
	.rows > li {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 8px;
		padding: 3px 0;
		color: #a9a9b4;
	}
	.path {
		word-break: break-all;
		color: #d2d2da;
	}
	.size {
		margin-left: auto;
		color: #8a8a93;
	}
	.badge {
		font-size: 11px;
		padding: 1px 6px;
		border-radius: 6px;
		background: #1f2a26;
		color: #7ee0c0;
	}
	.badge.used {
		background: #2e2216;
		color: #e0a86a;
	}
	.badge.keep {
		background: #1e2433;
		color: #8ab4ff;
	}
	.badge.dim {
		background: #22222a;
		color: #8a8a93;
	}
	.link {
		background: none;
		border: none;
		padding: 0;
		color: #8a8a93;
		font: inherit;
		font-size: 12px;
		text-decoration: underline;
		cursor: pointer;
	}
	.link:hover {
		color: #7ee0c0;
	}
	.add {
		display: grid;
		gap: 8px;
		margin: 14px 0 0;
		padding: 12px;
		border: 1px solid #23232c;
		border-radius: 10px;
		font-size: 13px;
	}
	.add label {
		display: grid;
		gap: 4px;
		color: #a9a9b4;
	}
	.add input:not([type='radio']):not([type='checkbox']) {
		background: #0f0f14;
		border: 1px solid #2a2a34;
		border-radius: 6px;
		color: #e6e6ee;
		padding: 6px 8px;
		font: inherit;
	}
	.from,
	.add-actions {
		display: flex;
		gap: 14px;
		align-items: center;
	}
	.from label,
	label.check {
		display: flex;
		gap: 6px;
		align-items: center;
	}
	.secondary {
		background: transparent;
		border: 1px solid #3a3a46;
		color: #c3c3cc;
		font-weight: 600;
		padding: 8px 14px;
		border-radius: 10px;
		cursor: pointer;
		font-size: 13px;
	}
	.secondary:hover:not(:disabled) {
		border-color: #59596a;
		color: #e8e8ee;
	}
	.secondary:disabled {
		opacity: 0.6;
		cursor: default;
	}
	.vm-actions {
		display: flex;
		gap: 10px;
		margin-top: 14px;
	}
	.spinner {
		display: inline-block;
		width: 10px;
		height: 10px;
		border: 2px solid #3a3a46;
		border-top-color: #7ee0c0;
		border-radius: 50%;
		animation: spin 0.8s linear infinite;
		vertical-align: middle;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
