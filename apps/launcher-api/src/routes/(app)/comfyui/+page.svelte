<script lang="ts">
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>ComfyUI — Invisible Wall</title></svelte:head>

<div class="page">
	<ToolTopBar current="comfyui" tools={data.tools} />

	<main class="body">
		{#if data.comfyUrl}
			<section class="hero">
				<h1>ComfyUI — cloud R&amp;D</h1>
				<p class="lede">
					An interactive ComfyUI running on a RunPod GPU. Build and test generation networks here,
					then export them as blueprints the Invisible Atlas Maker can generate with.
				</p>
				<a class="open" href={data.comfyUrl} target="_blank" rel="noopener noreferrer">
					Open ComfyUI ↗
				</a>
				<p class="hint">
					Opens in a new tab. If it doesn't load, the pod is stopped — start it in the RunPod
					console, then try again.
				</p>

				<ol class="flow">
					<li><strong>Build</strong> your network on the canvas — the pod's GPU, not your machine.</li>
					<li>
						<strong>Export</strong> it: Settings → <em>Save (API Format)</em> to get the workflow JSON.
					</li>
					<li>
						<strong>Publish</strong> it as a blueprint in the
						<a href="/atlas">Atlas Maker</a> (＋ New blueprint → upload the JSON → bind the roles).
					</li>
				</ol>
				<p class="note">
					Any custom node or model your network needs must also live on the shared pipeline backend,
					or the blueprint won't run in the Atlas Maker — check with the team before relying on a
					brand-new node.
				</p>
			</section>
		{:else}
			<section class="hero unset">
				<h1>ComfyUI</h1>
				<p class="lede">No R&amp;D pod is configured yet.</p>
				<p class="hint">
					Set <code>COMFY_RND_URL</code> in the launcher environment to the pod's proxy URL
					(<code>https://&lt;podId&gt;-8188.proxy.runpod.net</code>) once it's running.
				</p>
				<a class="ghost" href="/">‹ Launcher</a>
			</section>
		{/if}
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
		display: flex;
		justify-content: center;
		padding: 8vh 24px 48px;
	}
	.hero {
		max-width: 620px;
		width: 100%;
	}
	h1 {
		margin: 0 0 12px;
		color: #7ee0c0;
		letter-spacing: 0.08em;
		font-size: 26px;
	}
	.lede {
		font-size: 15px;
		line-height: 1.55;
		color: #c3c3cc;
		margin: 0 0 22px;
	}
	.open {
		display: inline-block;
		background: #7ee0c0;
		color: #08120f;
		font-weight: 600;
		padding: 11px 22px;
		border-radius: 10px;
		text-decoration: none;
		transition: filter 0.15s ease;
	}
	.open:hover {
		filter: brightness(1.08);
	}
	.hint {
		font-size: 13px;
		color: #8a8a93;
		margin: 12px 0 0;
	}
	.flow {
		margin: 30px 0 0;
		padding: 20px 20px 20px 40px;
		border: 1px solid #23232c;
		border-radius: 12px;
		background: #14141a;
		line-height: 1.7;
		font-size: 14px;
	}
	.flow li {
		margin-bottom: 6px;
	}
	.flow strong {
		color: #e9e9ef;
	}
	.flow a {
		color: #7ee0c0;
	}
	.note {
		margin: 18px 0 0;
		font-size: 13px;
		color: #b9974e;
		line-height: 1.55;
	}
	code {
		background: #1c1c24;
		padding: 2px 6px;
		border-radius: 4px;
		font-size: 12px;
	}
	.ghost {
		display: inline-block;
		margin-top: 18px;
		border: 1px solid #333;
		color: #aaa;
		padding: 7px 14px;
		border-radius: 8px;
		text-decoration: none;
	}
</style>
