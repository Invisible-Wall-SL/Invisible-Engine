<script lang="ts">
	import type { FixRunView } from '$lib/bugFixRuns';
	import { fixBanner } from './fixView';

	/**
	 * The one line that says what the newest fix run did (ADR-0014 §4), on the bug page and, with
	 * `compact`, on the Bugs tab card. The run's summary is its own words: text, never markup.
	 */
	let { runs, compact = false }: { runs: FixRunView[]; compact?: boolean } = $props();

	const banner = $derived(fixBanner(runs));
</script>

{#if banner}
	<div class="banner {banner.tone}" class:compact role="status">
		<strong>
			{#if banner.href}
				<!-- A query on another route: `resolve()` cannot carry one. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a href={banner.href}>{banner.text}</a>
			{:else}
				{banner.text}
			{/if}
		</strong>
		{#if banner.summary && !compact}<p class="summary">{banner.summary}</p>{/if}
	</div>
{/if}

<style>
	.banner {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid;
		border-radius: 10px;
		font-size: 13px;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.banner.compact {
		padding: 6px 10px;
		font-size: 12px;
	}
	.banner.blue {
		background: #12202b;
		border-color: #2b5575;
		color: #a9cfe4;
	}
	.banner.green {
		background: #112219;
		border-color: #2b8d6f;
		color: #a6f0cf;
	}
	.banner.amber {
		background: #2a2312;
		border-color: #77621f;
		color: #f0d98a;
	}
	.banner.red {
		background: #2a1416;
		border-color: #6b2f33;
		color: #ff9d9d;
	}
	.banner.muted {
		background: #1b1b22;
		border-color: #2c2c38;
		color: #c9c9d1;
	}
	.summary {
		margin: 0;
		color: #e8e8ee;
		font-size: 13px;
		font-weight: 400;
		white-space: pre-wrap;
	}
	a {
		color: inherit;
	}
	a:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
</style>
