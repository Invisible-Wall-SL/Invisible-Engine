<svelte:head><title>Atlas Maker — Invisible Wall</title></svelte:head>

<!-- Shown only when ATLAS_TOOL_URL is unset; otherwise the load fn redirects
	 straight to the full-page tool. -->
<div class="empty">
	<h1>Atlas Maker</h1>
	<p>The Atlas Maker service URL is not configured.</p>
	<p class="muted">Set <code>ATLAS_TOOL_URL</code> in the launcher environment.</p>
	<a class="ghost" href="/">‹ Launcher</a>
</div>

<style>
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
