<svelte:head><title>Spine Viewer — Invisible Wall</title></svelte:head>

<iframe title="Spine Viewer" src="/spine/view.html"></iframe>
<a class="back" href="/" title="Back to launcher">‹ Launcher</a>

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
</style>
