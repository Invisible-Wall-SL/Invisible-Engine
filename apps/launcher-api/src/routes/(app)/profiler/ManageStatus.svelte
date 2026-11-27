<script lang="ts">
	import type { ManagedList } from '$lib/profilerManage.svelte';

	/** What the last archive or delete did, and what a Delete refused with its reasons. */
	const { list }: { list: ManagedList } = $props();
</script>

{#if list.error}<p class="error">{list.error}</p>{/if}
{#if list.note}<p class="note">{list.note}</p>{/if}
{#if list.refusals.length}
	<ul class="refused">
		{#each list.refusals as r (r.id)}<li><code>{r.id.slice(0, 8)}</code> — {r.reason}</li>{/each}
	</ul>
{/if}

<style>
	.error {
		color: #ff7b7b;
	}
	.note {
		color: #8fd6b2;
		margin: 4px 0;
	}
	.refused {
		margin: 0 0 8px;
		padding-left: 18px;
		font-size: 12px;
		color: #e0b072;
	}
</style>
