<script lang="ts">
	import type { ManagedList } from '$lib/profilerManage.svelte';
	import IconButton from '$lib/ui/IconButton.svelte';

	/**
	 * A list's header controls for archiving and deleting (readings and builds): what the ticked rows
	 * can do, "Archive all before…", and Show archived. Icon buttons and tooltips only (the guide
	 * says what each does); the table's checkboxes and the status line share `list`.
	 */
	interface Props {
		list: ManagedList;
		/** How many are archived, for the toggle's label. */
		archivedCount: number;
		showArchived: boolean;
		onShowArchived: (next: boolean) => void;
		/** Readings: the probe version "before perf N" archives (the one before the newest). */
		perf?: number;
		/** Builds: a ready-made cutoff, e.g. the first perf 10 reading's day. */
		since?: { label: string; iso: string } | null;
	}
	const { list, archivedCount, showArchived, onShowArchived, perf, since }: Props = $props();

	let before = $state(false);
	let day = $state('');

	const ticked = $derived(list.ticked);
	const live = $derived(ticked.filter((r) => !r.archived));
	const shelved = $derived(ticked.filter((r) => r.archived));

	/** The start of the picked day, where the person is. */
	const startOf = (value: string) => {
		const [y, m, d] = value.split('-').map(Number);
		return new Date(y, m - 1, d).toISOString();
	};

	function archiveDay(value: string): void {
		before = false;
		void list.archiveBefore({ before: startOf(value) }, `before ${value}`);
	}
</script>

<svelte:window onkeydown={(e) => e.key === 'Escape' && (before = false)} />

<span class="manage">
	{#if ticked.length}
		<span class="count">{ticked.length} selected</span>
		{#if live.length}
			<IconButton
				icon="archive"
				label="Archive selected ({live.length})"
				disabled={list.busy}
				onclick={() => list.archive(live.map((r) => r.id))}
			/>
		{/if}
		{#if shelved.length}
			<IconButton
				icon="unarchive"
				label="Unarchive selected ({shelved.length})"
				disabled={list.busy}
				onclick={() => list.unarchive(shelved.map((r) => r.id))}
			/>
		{/if}
		<IconButton
			icon="trash"
			danger
			label="Delete selected ({ticked.length})"
			disabled={list.busy}
			onclick={() => list.remove(ticked.map((r) => r.id))}
		/>
		<IconButton icon="reset" label="Clear the selection" onclick={() => list.clear()} />
	{/if}
	<span class="before">
		<IconButton
			icon="history"
			label="Archive all before…"
			disabled={list.busy}
			onclick={() => (before = !before)}
		/>
		{#if before}
			<div class="pop" role="group" aria-label="Archive all before">
				{#if perf}
					<button
						type="button"
						onclick={() => {
							before = false;
							void list.archiveBefore({ perfBefore: perf }, `taken before perf ${perf}`);
						}}>Before perf {perf}</button
					>
				{/if}
				{#if since}
					<button
						type="button"
						onclick={() => {
							before = false;
							void list.archiveBefore({ before: since.iso }, since.label.toLowerCase());
						}}>{since.label}</button
					>
				{/if}
				<label>
					Before this day
					<input type="date" bind:value={day} />
				</label>
				<button type="button" disabled={!day} onclick={() => archiveDay(day)}>Archive</button>
			</div>
		{/if}
	</span>
	<label class="toggle" title="Archived rows are left out of every list, verdict and finding">
		<input
			type="checkbox"
			checked={showArchived}
			onchange={(e) => onShowArchived(e.currentTarget.checked)}
		/>
		Show archived{archivedCount ? ` (${archivedCount})` : ''}
	</label>
</span>

<style>
	.manage {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		position: relative;
	}
	.count {
		font-size: 12px;
		color: #a9a9b8;
		margin-right: 2px;
	}
	.toggle {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 12px;
		color: #a9a9b8;
		margin-left: 6px;
		cursor: pointer;
	}
	.before {
		position: relative;
	}
	.pop {
		position: absolute;
		right: 0;
		top: 28px;
		z-index: 5;
		display: flex;
		flex-direction: column;
		gap: 6px;
		min-width: 190px;
		padding: 8px;
		background: #16161e;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.4);
		font-size: 12px;
		color: #c8c8d4;
	}
	.pop label {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.pop input,
	.pop button {
		background: #1c1c26;
		color: #e8e8ee;
		border: 1px solid #2c2c38;
		border-radius: 6px;
		padding: 4px 6px;
		font: inherit;
		font-size: 12px;
	}
	.pop button {
		cursor: pointer;
		text-align: left;
	}
	.pop button:disabled {
		opacity: 0.4;
		cursor: default;
	}
</style>
