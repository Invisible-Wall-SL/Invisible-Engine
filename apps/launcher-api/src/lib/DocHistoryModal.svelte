<script lang="ts">
	/**
	 * Version history for one autosaved doc: lists the rolling server-side backups
	 * (`lib/server/docBackups.ts`, via the doc's `…/backups` GET) and restores the picked one.
	 *
	 * The restore itself is the CALLER's `onRestore`, because only the page holds what a guarded
	 * restore needs — the ETag it loaded, the project it loaded, and its pending autosave to cancel
	 * first. It returns `null` on success (the caller then reloads) or the message to show here.
	 * Built on the shared `ConfirmDialog`, so focus trap, Escape and the inert page come for free.
	 */
	import ConfirmDialog from './ConfirmDialog.svelte';

	interface Backup {
		id: string;
		savedAt: string;
		size: number;
	}

	interface Props {
		open: boolean;
		/** The history GET — answers `{ backups: Backup[] }`, newest first. */
		listUrl: string;
		/** What the doc is called in the copy ("flow", "symbols"). */
		docLabel: string;
		/** Another author holds the edit lease — listing is fine, restoring is not. */
		readOnly?: boolean;
		/** The tab has edits not yet saved; restoring discards them. */
		dirty?: boolean;
		onRestore: (id: string) => Promise<string | null>;
		onclose: () => void;
	}

	let {
		open,
		listUrl,
		docLabel,
		readOnly = false,
		dirty = false,
		onRestore,
		onclose,
	}: Props = $props();

	let backups = $state<Backup[] | null>(null);
	let picked = $state<string | null>(null);
	let busy = $state(false);
	let error = $state('');

	$effect(() => {
		if (open) void load();
	});

	async function load(): Promise<void> {
		backups = null;
		picked = null;
		error = '';
		try {
			const res = await fetch(listUrl);
			if (!res.ok) {
				const out = (await res.json().catch(() => ({}))) as { message?: string };
				error = out.message ?? `Couldn't load version history (${res.status}).`;
				backups = [];
				return;
			}
			backups = ((await res.json()) as { backups: Backup[] }).backups;
		} catch (e) {
			error = e instanceof Error ? e.message : "Couldn't load version history.";
			backups = [];
		}
	}

	async function restore(): Promise<void> {
		if (!picked || busy) return;
		busy = true;
		error = '';
		try {
			const failure = await onRestore(picked);
			if (failure) error = failure;
		} catch (e) {
			error = e instanceof Error ? e.message : 'Restore failed.';
		} finally {
			busy = false;
		}
	}

	const kb = (size: number): string => `${Math.max(1, Math.round(size / 1024))} KB`;
</script>

<ConfirmDialog
	{open}
	title="Version history"
	confirmLabel="Restore"
	danger
	{busy}
	busyLabel="Restoring…"
	blocked={!picked || readOnly}
	{error}
	onconfirm={() => void restore()}
	oncancel={onclose}
>
	{#snippet body()}
		<p>
			Earlier saved versions of this project's {docLabel}, newest first. Restoring saves the current
			version as a new entry first, so a restore can itself be undone from here.
		</p>
		{#if readOnly}
			<p class="note">Another author is editing — take over before restoring.</p>
		{:else if dirty}
			<p class="note">You have unsaved changes; restoring discards them.</p>
		{/if}
		{#if backups === null}
			<p class="muted">Loading…</p>
		{:else if backups.length === 0 && !error}
			<p class="muted">
				No earlier versions yet — one is kept whenever a save replaces the stored {docLabel}.
			</p>
		{:else}
			<ul class="list" role="radiogroup" aria-label="Saved versions">
				{#each backups as b (b.id)}
					<li>
						<label class:picked={picked === b.id}>
							<input type="radio" name="doc-backup" value={b.id} bind:group={picked} />
							<span>{new Date(b.savedAt).toLocaleString()}</span>
							<span class="muted">{kb(b.size)}</span>
						</label>
					</li>
				{/each}
			</ul>
		{/if}
	{/snippet}
</ConfirmDialog>

<style>
	p {
		margin: 0;
	}
	.note {
		color: #f0c36b;
	}
	.muted {
		color: #8a8a99;
	}
	.list {
		list-style: none;
		margin: 4px 0 0;
		padding: 0;
		max-height: 300px;
		overflow-y: auto;
		border: 1px solid #2a2a33;
		border-radius: 8px;
	}
	label {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 7px 10px;
		cursor: pointer;
		color: #e8e8ee;
	}
	label:hover {
		background: #1f1f28;
	}
	label.picked {
		background: #26224a;
	}
	label .muted {
		margin-left: auto;
	}
</style>
