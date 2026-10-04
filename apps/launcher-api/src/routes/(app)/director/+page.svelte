<script lang="ts">
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const COMING = [
		{
			title: 'New game',
			body: 'Name the project and pick its client, game type and a template game to re-theme. Choose an art preset, upload mockups or describe the style, and set the checkpoints.',
		},
		{
			title: 'Mockup breakdown',
			body: 'The first checkpoint. Each mockup element is mapped to a template region, and anything that clashes with the locked math is flagged. Nothing renders until you confirm.',
		},
		{
			title: 'Live run',
			body: 'Agents work across Atlas Maker, Symbols, Scene Editor and the other tools. You approve or redo each region and can message the coordinator mid-run.',
		},
	];
</script>

<svelte:head><title>Invisible Director — Invisible Wall</title></svelte:head>

<div class="page">
	<ToolTopBar current="director" tools={data.tools} />

	<main class="body">
		<section class="empty">
			<span class="tag">early access</span>
			<h1>Invisible Director is being built</h1>
			<p class="lead">
				Director will make a new game by re-theming a game that already works. Runtime agents do the
				work in the existing tools, and the run stops at checkpoints for you to review. Agents never
				publish and never change the template's math. You publish in Game Maker.
			</p>
			<ol class="coming">
				{#each COMING as step (step.title)}
					<li>
						<strong>{step.title}</strong>
						<span>{step.body}</span>
					</li>
				{/each}
			</ol>
			<p class="note">Nothing on this page does anything yet.</p>
		</section>
	</main>
</div>

<style>
	.page {
		min-height: 100vh;
		background: #0e0e12;
		color: #d8d8df;
		font-family: system-ui, sans-serif;
	}
	.body {
		padding: 32px 24px 48px;
	}
	.empty {
		max-width: 760px;
	}
	.tag {
		display: inline-block;
		padding: 2px 8px;
		border-radius: 999px;
		background: #2d2516;
		color: #f5b95c;
		font-size: 11px;
	}
	h1 {
		margin: 12px 0 8px;
		font-size: 20px;
		color: #eee;
	}
	.lead {
		margin: 0 0 20px;
		color: #a3a3ad;
		line-height: 1.5;
	}
	.coming {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 12px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.coming li {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 16px;
		border-radius: 12px;
		background: #16161c;
		border: 1px solid #222;
	}
	.coming strong {
		font-size: 15px;
		color: #eee;
	}
	.coming span {
		font-size: 13px;
		color: #888;
		line-height: 1.45;
	}
	.note {
		margin: 20px 0 0;
		font-size: 13px;
		color: #777;
	}
</style>
