<script lang="ts">
	import {
		cardEditorUrl,
		catalogueState,
		type CatalogueRow,
		type CatalogueView,
	} from '$lib/blueprintCatalogue';
	import Pill from './Pill.svelte';
	import { plural } from './view';

	let {
		view,
		canOpenAtlas,
	}: {
		view: CatalogueView;
		/** The card editor lives in the Atlas Maker, so its links need that tool too. */
		canOpenAtlas: boolean;
	} = $props();

	const offered = $derived(view.rows.filter((r) => r.offered));
	const waiting = $derived(view.rows.filter((r) => !r.offered));
</script>

{#snippet row(r: CatalogueRow)}
	{@const state = catalogueState(r)}
	<li class="row">
		<div class="top">
			<span class="name">{r.name}</span>
			{#if r.name !== r.id}<span class="mono">{r.id}</span>{/if}
			{#if r.builtin}<Pill tone="blue" tag>built-in</Pill>{/if}
			<Pill tone={state.tone}>{state.label}</Pill>
			<span class="spacer"></span>
			{#if canOpenAtlas}
				<!-- The launcher's own /atlas route re-gates and re-launches; a query resolve() cannot carry. -->
				<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
				<a class="edit" href={cardEditorUrl(r.id)}>
					{r.status === 'none' ? '＋ Add to catalogue' : '✎ Edit card'}
				</a>
			{/if}
		</div>
		{#if r.purpose}<p class="purpose">{r.purpose}</p>{/if}
		<p class="why">
			{state.why}
			{#if r.rev !== null}
				<span class="meta">
					· rev {r.rev}{#if r.reviewedBy}
						· reviewed by {r.reviewedBy}{#if r.reviewedAt}&nbsp;at {r.reviewedAt}{/if}{/if}
				</span>
			{/if}
		</p>
		{#if r.problems.length}
			<ul class="problems">
				{#each r.problems as p, i (i)}<li>{p}</li>{/each}
			</ul>
		{/if}
	</li>
{/snippet}

<div class="catalogue">
	<p class="summary">
		<strong>{offered.length}</strong> of {view.rows.length} image {plural(
			view.rows.length,
			'pipeline',
		)}
		offered to agents{#if view.gpu}&nbsp;· endpoint GPU <span class="mono">{view.gpu}</span>{/if}.
	</p>

	<section aria-label="Offered to agents">
		<h2>Offered to agents · {offered.length}</h2>
		{#if offered.length}
			<ul class="rows">
				{#each offered as r (r.id)}{@render row(r)}{/each}
			</ul>
		{:else}
			<p class="note">Nothing yet: review a card below to offer its pipeline.</p>
		{/if}
	</section>

	{#if waiting.length}
		<section aria-label="Not offered">
			<h2>Not offered · {waiting.length}</h2>
			<ul class="rows">
				{#each waiting as r (r.id)}{@render row(r)}{/each}
			</ul>
		</section>
	{/if}

	{#if view.dropped}
		<p class="note warn" role="alert">
			{view.dropped}
			{plural(view.dropped, 'entry', 'entries')} from the Atlas Maker could not be read and
			{view.dropped === 1 ? 'is' : 'are'} not shown.
		</p>
	{/if}

	{#if !canOpenAtlas}
		<p class="note">
			Cards are edited in the Invisible Atlas Maker, which your role cannot open. Ask an admin.
		</p>
	{/if}
</div>

<style>
	.catalogue {
		display: flex;
		flex-direction: column;
		gap: 18px;
		max-width: 980px;
	}
	.summary {
		margin: 0;
		color: #b9b9c4;
	}
	h2 {
		margin: 0 0 8px;
		font-size: 12px;
		font-weight: 700;
		letter-spacing: 0.06em;
		color: #9a9aa6;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.row {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
		background: #14141b;
		border: 1px solid #23232e;
		border-radius: 12px;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}
	.name {
		font-size: 14px;
		font-weight: 700;
		color: #e8e8ee;
		overflow-wrap: anywhere;
	}
	.mono {
		font-family: ui-monospace, 'Cascadia Mono', Consolas, monospace;
		font-size: 12px;
		color: #9a9aa6;
	}
	.spacer {
		flex: 1;
	}
	.edit {
		padding: 4px 10px;
		background: #1b1b22;
		border: 1px solid #2c2c38;
		border-radius: 8px;
		color: #e8e8ee;
		font-size: 12px;
		font-weight: 600;
		text-decoration: none;
		white-space: nowrap;
	}
	.edit:hover {
		background: #23232e;
		border-color: #3a3a48;
	}
	.edit:focus-visible {
		outline: 2px solid #6ea8ff;
		outline-offset: 2px;
	}
	.purpose,
	.why {
		margin: 0;
		line-height: 1.45;
	}
	.purpose {
		color: #d8d8df;
	}
	.why {
		font-size: 12px;
		color: #9a9aa6;
	}
	.meta {
		color: #80808c;
	}
	.problems {
		margin: 0;
		padding-left: 18px;
		font-size: 12px;
		color: #ff9d9d;
	}
	.note {
		margin: 0;
		font-size: 12px;
		line-height: 1.5;
		color: #80808c;
	}
	.note.warn {
		color: #f5b95c;
	}
</style>
