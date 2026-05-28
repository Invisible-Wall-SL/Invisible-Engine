<svelte:head><title>Spine Viewer — Invisible Wall</title></svelte:head>

<div class="head">
	<h1>Spine Viewer</h1>
	<p class="muted">Assets served from the shared repository.</p>
</div>

<iframe title="Spine Viewer" src="/spine/view.html"></iframe>

<style>
	.head h1 {
		font-size: 22px;
		margin-bottom: 4px;
	}
	.muted {
		color: #888;
		margin-top: 0;
	}
	iframe {
		width: 100%;
		height: calc(100vh - 200px);
		min-height: 480px;
		margin-top: 16px;
		border: 1px solid #222;
		border-radius: 12px;
		background: #1b1d22;
	}
</style>
