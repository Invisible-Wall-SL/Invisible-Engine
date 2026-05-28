<script lang="ts">
	import { onMount } from 'svelte';

	// The local Spine Viewer (Invisible_Pipeline) serves its UI here.
	const LOCAL_URL = 'http://localhost:8767';

	let status = $state<'checking' | 'up' | 'down'>('checking');

	async function ping() {
		status = 'checking';
		try {
			const ctrl = new AbortController();
			const timer = setTimeout(() => ctrl.abort(), 2500);
			// no-cors: we can't read the response, but a resolve means it's reachable.
			await fetch(`${LOCAL_URL}/api/state`, { mode: 'no-cors', signal: ctrl.signal });
			clearTimeout(timer);
			status = 'up';
		} catch {
			status = 'down';
		}
	}

	onMount(ping);
</script>

<svelte:head><title>Spine Viewer — Invisible Wall</title></svelte:head>

<div class="head">
	<div>
		<h1>Spine Viewer</h1>
		<p class="muted">Runs on your machine; framed here behind your login.</p>
	</div>
	<span class="status {status}">
		{status === 'up' ? 'connected' : status === 'checking' ? 'checking…' : 'not running'}
	</span>
</div>

{#if status === 'down'}
	<div class="card">
		<p>The Spine Viewer isn't reachable on this machine (<code>{LOCAL_URL}</code>).</p>
		<p class="muted">
			Start it locally (<code>run_ui.bat</code> in
			<code>Invisible_Pipeline/tools/Invisible Spine Viewer</code>), then retry.
		</p>
		<div class="actions">
			<button onclick={ping}>Retry</button>
			<a class="btn" href={LOCAL_URL} target="_blank" rel="noreferrer">Open directly</a>
		</div>
	</div>
{:else}
	<iframe title="Spine Viewer" src={LOCAL_URL}></iframe>
{/if}

<style>
	.head {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
	}
	h1 {
		font-size: 22px;
		margin-bottom: 4px;
	}
	.muted {
		color: #888;
		margin-top: 0;
	}
	code {
		background: #1c1c24;
		padding: 1px 5px;
		border-radius: 4px;
		font-size: 12px;
	}
	.status {
		font-size: 12px;
		padding: 3px 10px;
		border-radius: 999px;
		white-space: nowrap;
	}
	.status.up {
		background: #1f2d23;
		color: #7ee787;
	}
	.status.checking {
		background: #26262f;
		color: #9a9aa5;
	}
	.status.down {
		background: #3a2326;
		color: #ff9b95;
	}
	.card {
		margin-top: 24px;
		padding: 24px;
		border-radius: 12px;
		background: #16161c;
		border: 1px dashed #2a2a34;
	}
	.card p {
		margin: 0 0 10px;
	}
	.actions {
		display: flex;
		gap: 10px;
		margin-top: 16px;
	}
	button,
	.btn {
		background: #6b5bff;
		color: #fff;
		border: none;
		padding: 9px 16px;
		border-radius: 8px;
		cursor: pointer;
		font-size: 14px;
		text-decoration: none;
		display: inline-block;
	}
	.btn {
		background: transparent;
		border: 1px solid #333;
		color: #ccc;
	}
	iframe {
		width: 100%;
		height: calc(100vh - 220px);
		min-height: 480px;
		margin-top: 20px;
		border: 1px solid #222;
		border-radius: 12px;
		background: #1b1d22;
	}
</style>
