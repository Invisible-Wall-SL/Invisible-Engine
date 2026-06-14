<script lang="ts">
	import type { PageData } from './$types';
	import Emblem from '$lib/Emblem.svelte';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head><title>{data.title} guide — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<div class="brand"><Emblem height={18} /> INVISIBLE WALL</div>
		<a class="ghost" href="/onboarding">‹ Back</a>
	</header>

	<article class="doc">
		<!-- Trusted in-repo markdown, rendered to HTML at build time. -->
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html data.html}
	</article>
</div>

<style>
	.shell {
		max-width: 880px;
		margin: 0 auto;
		padding: 32px 24px 64px;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 28px;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 9px;
		font-weight: 700;
		letter-spacing: 0.14em;
		color: #7ee0c0;
		font-size: 15px;
	}
	.ghost {
		border: 1px solid #333;
		color: #aaa;
		padding: 6px 12px;
		border-radius: 8px;
		text-decoration: none;
		font-size: 13px;
	}
	.doc {
		color: #cfcfd6;
		font-size: 15px;
		line-height: 1.7;
	}
	.doc :global(h1) {
		font-size: 26px;
		margin: 0 0 12px;
		color: #f0f0f4;
	}
	.doc :global(h2) {
		font-size: 19px;
		margin: 32px 0 10px;
		padding-top: 8px;
		border-top: 1px solid #1c1c24;
		color: #f0f0f4;
	}
	.doc :global(h3) {
		font-size: 16px;
		margin: 22px 0 8px;
		color: #e8e8ee;
	}
	.doc :global(p) {
		margin: 0 0 14px;
	}
	.doc :global(a) {
		color: #5db0ff;
	}
	.doc :global(ul),
	.doc :global(ol) {
		margin: 0 0 14px;
		padding-left: 22px;
		line-height: 1.7;
	}
	.doc :global(li) {
		margin: 2px 0;
	}
	.doc :global(strong) {
		color: #e8e8ee;
	}
	.doc :global(code) {
		background: #1c1c24;
		padding: 1px 6px;
		border-radius: 4px;
		font-size: 0.88em;
		font-family: ui-monospace, monospace;
	}
	.doc :global(pre) {
		background: #0f0f14;
		border: 1px solid #222;
		border-radius: 10px;
		padding: 14px 16px;
		overflow-x: auto;
		margin: 0 0 16px;
	}
	.doc :global(pre code) {
		background: none;
		padding: 0;
		font-size: 13px;
	}
	.doc :global(blockquote) {
		margin: 0 0 16px;
		padding: 4px 16px;
		border-left: 3px solid #6b5bff;
		color: #b8b8c0;
		background: #14141a;
		border-radius: 0 8px 8px 0;
	}
	.doc :global(table) {
		border-collapse: collapse;
		margin: 0 0 16px;
		font-size: 14px;
	}
	.doc :global(th),
	.doc :global(td) {
		border: 1px solid #2a2a33;
		padding: 6px 12px;
		text-align: left;
	}
	.doc :global(th) {
		background: #16161c;
	}
	.doc :global(hr) {
		border: none;
		border-top: 1px solid #1c1c24;
		margin: 28px 0;
	}
	.doc :global(img) {
		max-width: 100%;
		border-radius: 8px;
	}
</style>
