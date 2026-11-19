<script lang="ts" module>
	export interface DeletedDoc {
		id: string;
		name: string;
		deletedAt: string;
		versions: number;
	}
</script>

<script lang="ts">
	/**
	 * The project's deleted docs of one kind, newest-deleted first — a deleted doc keeps its
	 * rolling backups (`lib/server/docBackups.ts`), so this is the way back to them. Picking one
	 * hands it to the caller, which opens `DocHistoryModal` on that doc's versions (`deleted`).
	 * Built on the shared `ConfirmDialog`, like the history modal.
	 */
	import ConfirmDialog from './ConfirmDialog.svelte';

	interface Props {
		open: boolean;
		/** The deleted-docs GET — answers `{ deleted: DeletedDoc[] }`, newest-deleted first. */
		listUrl: string;
		/** What the docs are called, plural ("effects"). */
		docsLabel: string;
		onpick: (doc: DeletedDoc) => void;
		onclose: () => void;
	}

	let { open, listUrl, docsLabel, onpick, onclose }: Props = $props();

	let docs = $state<DeletedDoc[] | null>(null);
	let picked = $state<string | null>(null);
	let error = $state('');

	$effect(() => {
		if (open) void load();
	});

	async function load(): Promise<void> {
		docs = null;
		picked = null;
		error = '';
		try {
			const res = await fetch(listUrl);
			if (!res.ok) {
				const out = (await res.json().catch(() => ({}))) as { message?: string };
				error = out.message ?? `Couldn't load the deleted ${docsLabel} (${res.status}).`;
				docs = [];
				return;
			}
			docs = ((await res.json()) as { deleted: DeletedDoc[] }).deleted;
		} catch (e) {
			error = e instanceof Error ? e.message : `Couldn't load the deleted ${docsLabel}.`;
			docs = [];
		}
	}

	function pick(): void {
		const doc = docs?.find((d) => d.id === picked);
		if (doc) onpick(doc);
	}
</script>

<ConfirmDialog
	{open}
	title="Deleted {docsLabel}"
	confirmLabel="Show versions"
	blocked={!picked}
	{error}
	onconfirm={pick}
	oncancel={onclose}
>
	{#snippet body()}
		{#if docs === null}
			<p class="muted">Loading…</p>
		{:else if docs.length === 0 && !error}
			<p class="muted">No deleted {docsLabel} in this project.</p>
		{:else}
			<ul class="list" role="radiogroup" aria-label="Deleted {docsLabel}">
				{#each docs as d (d.id)}
					<li>
						<label class:picked={picked === d.id}>
							<input type="radio" name="deleted-doc" value={d.id} bind:group={picked} />
							<span class="name">{d.name}</span>
							<span class="muted">{new Date(d.deletedAt).toLocaleString()}</span>
							<span class="muted">{d.versions} version{d.versions === 1 ? '' : 's'}</span>
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
	.muted {
		color: #8a8a99;
	}
	.list {
		list-style: none;
		margin: 0;
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
	.name {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
</style>
