<svelte:head><title>Pipeline — Invisible Wall</title></svelte:head>

<h1>Pipeline</h1>
<p class="muted">Jobs, assets and game specs across your projects.</p>

<div class="cards">
	<section class="card">
		<h2>Jobs</h2>
		<p class="empty">No jobs yet. Image-processing and build jobs submitted to the pipeline will appear here.</p>
	</section>

	<section class="card">
		<h2>Assets</h2>
		<p class="empty">No assets yet. Shared models and generated assets from the repository will be listed here.</p>
	</section>

	<section class="card">
		<h2>Game specs</h2>
		<p class="empty">No game specs yet. Specs authored with the game-spec CLI will surface here.</p>
	</section>
</div>

<style>
	h1 {
		font-size: 22px;
		margin-bottom: 4px;
	}
	.muted {
		color: #888;
		margin-top: 0;
	}
	.cards {
		display: grid;
		gap: 16px;
		margin-top: 24px;
	}
	.card {
		padding: 20px;
		border-radius: 12px;
		background: #16161c;
		border: 1px solid #222;
	}
	h2 {
		font-size: 14px;
		margin: 0 0 8px;
	}
	.empty {
		color: #6a6a76;
		font-size: 14px;
		margin: 0;
	}
</style>
