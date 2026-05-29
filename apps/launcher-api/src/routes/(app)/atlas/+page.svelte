<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>Atlas Maker — Invisible Wall</title></svelte:head>

{#if data.toolUrl}
	<iframe title="Atlas Maker" src={data.toolUrl}></iframe>
	<a class="back" href="/" title="Back to launcher">‹ Launcher</a>
{:else}
	<div class="empty">
		<h1>Atlas Maker</h1>
		<p>The Atlas Maker service URL is not configured.</p>
		<p class="muted">Set <code>ATLAS_TOOL_URL</code> in the launcher environment.</p>
		<a class="ghost" href="/">‹ Launcher</a>
	</div>
{/if}

<style>
	iframe {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		border: none;
		background: #1b1d22;
	}
	.back {
		position: fixed;
		top: 10px;
		right: 12px;
		z-index: 10;
		background: rgba(16, 16, 22, 0.85);
		border: 1px solid #363b45;
		color: #9a9aa5;
		padding: 5px 11px;
		border-radius: 8px;
		font:
			12px system-ui,
			sans-serif;
		text-decoration: none;
	}
	.back:hover {
		color: #fff;
		border-color: #5db0ff;
	}
	.empty {
		max-width: 540px;
		margin: 16vh auto 0;
		text-align: center;
		font-family: system-ui, sans-serif;
		color: #cfcfd6;
	}
	.empty h1 {
		color: #7ee0c0;
		letter-spacing: 0.1em;
	}
	.muted {
		color: #888;
		font-size: 13px;
	}
	code {
		background: #1c1c24;
		padding: 2px 6px;
		border-radius: 4px;
	}
	.ghost {
		display: inline-block;
		margin-top: 16px;
		border: 1px solid #333;
		color: #aaa;
		padding: 7px 14px;
		border-radius: 8px;
		text-decoration: none;
	}
</style>
