<script lang="ts">
	import { onMount } from 'svelte';

	// The local Atlas Maker server (Invisible_Pipeline) serves its UI here and
	// drives the local ComfyUI. The launcher runs it; we only frame it.
	const LOCAL_URL = 'http://localhost:8765';

	let status = $state<'checking' | 'up' | 'down'>('checking');

	async function ping() {
		status = 'checking';
		try {
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 2500);
			await fetch(`${LOCAL_URL}/progress`, { mode: 'no-cors', signal: ctrl.signal });
			clearTimeout(timer);
			status = 'up';
		} catch {
			status = 'down';
		}
	}

	onMount(ping);
</script>

<svelte:head><title>Atlas Maker — Invisible Wall</title></svelte:head>

{#if status === 'up'}
	<iframe title="Atlas Maker" src={LOCAL_URL}></iframe>
	<a class="back" href="/" title="Back to launcher">‹ Launcher</a>
{:else}
	<div class="panel">
		<h1>Atlas Maker</h1>
		{#if status === 'checking'}
			<p class="muted">Looking for the local Atlas Maker…</p>
		{:else}
			<p>The Atlas Maker isn't running on this machine (<code>{LOCAL_URL}</code>).</p>
			<p class="muted">
				Start ComfyUI and the Atlas Maker from the Invisible Launcher, then retry.
			</p>
			<div class="actions">
				<button onclick={ping}>Retry</button>
				<a class="ghost" href={LOCAL_URL} target="_blank" rel="noreferrer">Open directly</a>
				<a class="ghost" href="/">‹ Launcher</a>
			</div>
		{/if}
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
		font: 12px system-ui, sans-serif;
		text-decoration: none;
	}
	.back:hover {
		color: #fff;
		border-color: #5db0ff;
	}
	.panel {
		max-width: 460px;
		margin: 14vh auto;
		padding: 28px;
		border-radius: 14px;
		background: #16161c;
		border: 1px solid #222;
	}
	h1 {
		font-size: 22px;
		margin: 0 0 10px;
	}
	.muted {
		color: #888;
	}
	code {
		background: #0e0e12;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 12px;
	}
	.actions {
		display: flex;
		gap: 10px;
		margin-top: 18px;
		flex-wrap: wrap;
	}
	button {
		background: #6b5bff;
		color: #fff;
		border: none;
		padding: 9px 16px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 14px;
	}
	.ghost {
		background: transparent;
		border: 1px solid #333;
		color: #ccc;
		padding: 9px 16px;
		border-radius: 8px;
		text-decoration: none;
		font-size: 14px;
	}
</style>
