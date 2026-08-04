<script lang="ts">
	/**
	 * Read-only presence banner (multi-user-concurrency Phase 2c) — shown when another user
	 * (or the caller's own other tab) holds the edit lease, so this tab is read-only. Names
	 * the holder, shows how recently they were active, and offers **Take over** — which is
	 * ALWAYS enabled, because a crashed tab must never be able to permanently wedge a doc
	 * (backend expiry is the backstop, explicit takeover is the plan).
	 *
	 * Driven entirely by a {@link LeaseState}: renders nothing when `!lease.readOnly`. Styled
	 * to sit in the tool chrome next to `SaveStatusBadge` (same pill vocabulary).
	 */
	import type { LeaseState } from './leaseState.svelte';

	interface Props {
		lease: LeaseState;
	}

	let { lease }: Props = $props();

	const heldBy = $derived(lease.heldBy);

	/** Coarse relative-time for the "active N ago" label. */
	function activeAgo(ms: number): string {
		const s = Math.max(0, Math.floor(ms / 1000));
		if (s < 5) return 'just now';
		if (s < 60) return `${s}s ago`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ago`;
		const h = Math.floor(m / 60);
		return `${h}h ago`;
	}

	const who = $derived(heldBy ? heldBy.name || heldBy.email || 'Another user' : '');
</script>

{#if lease.readOnly && heldBy}
	<span class="presence" role="status">
		<span class="dot" aria-hidden="true">●</span>
		{#if heldBy.mine}
			<span class="msg" title="You have this document open in another tab or session."
				>You have this open in another tab — read-only here (active {activeAgo(
					heldBy.activeAgoMs,
				)})</span
			>
		{:else}
			<span class="msg" title={heldBy.email ?? undefined}
				>{who} is editing this — read-only (active {activeAgo(heldBy.activeAgoMs)})</span
			>
		{/if}
		<button
			class="takeover"
			type="button"
			title="Take over editing. The other tab becomes read-only on its next heartbeat. Your unsaved work is kept."
			onclick={() => void lease.takeover()}
		>
			Take over
		</button>
	</span>
{/if}

<style>
	.presence {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-size: 11px;
		padding: 3px 9px;
		border-radius: 999px;
		border: 1px solid #4a3a20;
		background: #1c1710;
		color: #f0c878;
		letter-spacing: 0.02em;
	}
	.dot {
		color: #f0a030;
		font-size: 9px;
	}
	.msg {
		white-space: nowrap;
	}
	.takeover {
		font: inherit;
		cursor: pointer;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid #6a5228;
		background: #2a2113;
		color: #f5d89a;
	}
	.takeover:hover {
		background: #3a2d18;
	}
</style>
