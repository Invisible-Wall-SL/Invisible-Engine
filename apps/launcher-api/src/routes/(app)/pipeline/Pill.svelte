<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { PillTone } from './view';

	let {
		tone,
		dot = false,
		tag = false,
		large = false,
		children,
	}: {
		tone: PillTone;
		dot?: boolean;
		/** The rounded "early access" tag shape instead of the status pill's. */
		tag?: boolean;
		large?: boolean;
		children: Snippet;
	} = $props();
</script>

<span class="pill {tone}" class:tag class:large>
	{#if dot}<span class="dot" aria-hidden="true"></span>{/if}
	{@render children()}
</span>

<style>
	.pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 1px 7px;
		border: 1px solid;
		border-radius: 6px;
		font-size: 11px;
		line-height: 1.45;
		white-space: nowrap;
	}
	.pill.large {
		padding: 2px 8px;
	}
	.pill.tag {
		border-radius: 999px;
		padding: 2px 8px;
	}
	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: #6ea8ff;
	}
	.green {
		background: #1a2320;
		border-color: #2b5546;
		color: #9fd9c2;
	}
	.blue {
		background: #17212a;
		border-color: #27404f;
		color: #a9cfe4;
	}
	.red {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	.amber {
		background: #2d2516;
		border-color: #5a4620;
		color: #f5b95c;
	}
	.muted {
		background: #1b1b22;
		border-color: #2c2c38;
		color: #9a9aa6;
	}
</style>
