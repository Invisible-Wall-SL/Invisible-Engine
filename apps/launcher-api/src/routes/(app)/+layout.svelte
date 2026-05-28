<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

{@render children()}

<style>
	:global(body) {
		margin: 0;
		background: #0b0b0f;
		color: #eee;
		font-family: system-ui, sans-serif;
	}
</style>
