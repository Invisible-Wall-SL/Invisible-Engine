<script lang="ts">
	import { onMount } from 'svelte';
	import ToolTopBar from '$lib/ToolTopBar.svelte';
	import { deleteFont, fetchFontCatalog, type CatalogFont, type FontTarget } from './fonts.client';
	import FontPreview from './FontPreview.svelte';
	import FontImport from './FontImport.svelte';
	import FontGenerate from './FontGenerate.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Tab = 'view' | 'import' | 'generate';
	let tab = $state<Tab>('view');

	// View-mode state.
	let fonts = $state<CatalogFont[]>([]);
	/** Which target the loaded catalog resolved from (a delete hits this target). */
	let source = $state<FontTarget>('project');
	let loading = $state(true);
	let sample = $state('Aa Bb 0123 $9,999.00');
	let size = $state(48);

	// Delete flow: the id pending confirmation + in-flight / error state.
	let confirmingId = $state<string | null>(null);
	let deletingId = $state<string | null>(null);
	let deleteError = $state<string | null>(null);

	const projectLabel = $derived(data.projectName ?? data.projectKey);

	/** A shared-library font can only be deleted by a holder of `fontPublish`. */
	const canDelete = $derived(source === 'project' || data.canPublishShared);

	/** First page-image URL for a bitmap font (the thumbnail). */
	function thumbUrl(font: CatalogFont): string | null {
		return font.pages?.[0]?.url ?? null;
	}

	async function loadCatalog(): Promise<void> {
		loading = true;
		const res = await fetchFontCatalog();
		fonts = res.fonts;
		source = res.source;
		loading = false;
	}

	async function confirmDelete(id: string): Promise<void> {
		deletingId = id;
		deleteError = null;
		try {
			await deleteFont(id, source);
			confirmingId = null;
			await loadCatalog();
		} catch (e) {
			deleteError = e instanceof Error ? e.message : String(e);
		} finally {
			deletingId = null;
		}
	}

	/** After an import saves, refresh the View catalog and switch to it. */
	function onImported(): void {
		void loadCatalog();
		tab = 'view';
	}

	onMount(() => {
		void loadCatalog();
	});
</script>

<svelte:head><title>Invisible Font Maker — Invisible Wall</title></svelte:head>

<div class="shell">
	<header>
		<ToolTopBar current="fontMaker" tools={data.tools} />
		<div class="meta">
			<span class="project">
				{#if data.clientKey}<span class="client">{data.clientKey}</span> / {/if}
				<strong>{projectLabel}</strong>
			</span>
		</div>
	</header>

	<nav class="tabs">
		<button class:active={tab === 'view'} onclick={() => (tab = 'view')}>View</button>
		<button class:active={tab === 'import'} onclick={() => (tab = 'import')}>Import</button>
		<button class:active={tab === 'generate'} onclick={() => (tab = 'generate')}>Generate</button>
	</nav>

	{#if tab !== 'import'}
		<div class="controls">
			<label class="sample-field">
				Sample text
				<input bind:value={sample} spellcheck="false" placeholder="Type a sample…" />
			</label>
			<label class="size-field">
				Size {size}px
				<input type="range" min="12" max="160" step="1" bind:value={size} />
			</label>
		</div>
	{/if}

	{#if tab === 'view'}
		<section class="view">
			{#if loading}
				<p class="muted">Loading fonts…</p>
			{:else if fonts.length === 0}
				<div class="empty">
					<p class="empty-title">No fonts in this project yet.</p>
					<p class="muted">
						Use <button class="link" onclick={() => (tab = 'import')}>Import</button> to bring in an
						existing BMFont, or
						<button class="link" onclick={() => (tab = 'generate')}>Generate</button> to bake one from
						a TTF/OTF.
					</p>
				</div>
			{:else}
				<ul class="font-list">
					{#each fonts as font (font.id)}
						<li class="font-card">
							<div class="font-head">
								<span class="font-name">{font.name}</span>
								<span class="badge {font.kind}">{font.kind}</span>
								{#if source === 'shared'}<span class="badge shared">shared</span>{/if}
								{#if canDelete}
									<div class="card-actions">
										{#if confirmingId === font.id}
											<span class="confirm-q">Delete?</span>
											<button
												class="del confirm"
												type="button"
												disabled={deletingId === font.id}
												onclick={() => confirmDelete(font.id)}
											>
												{deletingId === font.id ? 'Deleting…' : 'Yes, delete'}
											</button>
											<button
												class="del cancel"
												type="button"
												disabled={deletingId === font.id}
												onclick={() => (confirmingId = null)}
											>
												Cancel
											</button>
										{:else}
											<button
												class="del"
												type="button"
												onclick={() => {
													confirmingId = font.id;
													deleteError = null;
												}}
											>
												Delete
											</button>
										{/if}
									</div>
								{/if}
							</div>
							<div class="font-id">{font.id}</div>
							{#if confirmingId === font.id && deleteError}
								<p class="del-error">{deleteError}</p>
							{/if}
							<div class="font-body">
								{#if thumbUrl(font)}
									<img class="thumb" src={thumbUrl(font)} alt="{font.name} page" loading="lazy" />
								{/if}
								<div class="live">
									<FontPreview {font} {sample} {size} />
								</div>
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</section>
	{:else if tab === 'import'}
		<FontImport {sample} {size} canPublishShared={data.canPublishShared} onsaved={onImported} />
	{:else}
		<FontGenerate {sample} {size} canPublishShared={data.canPublishShared} onsaved={onImported} />
	{/if}
</div>

<style>
	.shell {
		max-width: 1400px;
		margin: 0 auto;
		padding: 24px;
		color: #e8e8ee;
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 18px;
	}
	.meta {
		font-size: 13px;
		color: #888;
	}
	.project strong {
		color: #c8a3ff;
	}
	.client {
		color: #888;
	}
	.tabs {
		display: flex;
		gap: 4px;
		border-bottom: 1px solid #222;
		margin-bottom: 20px;
	}
	.tabs button {
		border: none;
		background: transparent;
		color: #999;
		padding: 10px 16px;
		cursor: pointer;
		font-size: 13px;
		border-bottom: 2px solid transparent;
		margin-bottom: -1px;
	}
	.tabs button:hover {
		color: #ddd;
	}
	.tabs button.active {
		color: #7ee0c0;
		border-bottom-color: #7ee0c0;
	}
	h2 {
		font-size: 13px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #888;
		margin: 0 0 12px;
	}
	.muted {
		color: #888;
		font-size: 13px;
		line-height: 1.6;
	}
	.controls {
		display: flex;
		gap: 24px;
		flex-wrap: wrap;
		align-items: flex-end;
		background: #16161c;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 16px 18px;
		margin-bottom: 20px;
	}
	label {
		display: flex;
		flex-direction: column;
		gap: 6px;
		font-size: 12px;
		color: #999;
	}
	.sample-field {
		flex: 1 1 280px;
	}
	.size-field {
		min-width: 200px;
	}
	.sample-field input {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
		font-size: 13px;
		font-family: inherit;
	}
	.sample-field input:focus {
		outline: none;
		border-color: #6b5bff;
	}
	input[type='range'] {
		accent-color: #6b5bff;
	}
	.font-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: 1fr;
		gap: 14px;
	}
	.font-card {
		background: #16161c;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 16px 18px;
	}
	.font-head {
		display: flex;
		align-items: center;
		gap: 10px;
	}
	.card-actions {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.confirm-q {
		font-size: 12px;
		color: #e0b050;
	}
	.del {
		background: transparent;
		border: 1px solid #333;
		border-radius: 6px;
		padding: 4px 10px;
		color: #bbb;
		font-size: 12px;
		cursor: pointer;
	}
	.del:hover {
		border-color: #5a2f2f;
		color: #e06b6b;
	}
	.del.confirm {
		border-color: #5a2f2f;
		background: #2a1a1a;
		color: #e06b6b;
	}
	.del.confirm:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
	.del.cancel {
		color: #999;
	}
	.del-error {
		color: #e06b6b;
		font-size: 12px;
		margin: 0 0 8px;
	}
	.badge.shared {
		background: #2a2430;
		border-color: #44345a;
		color: #c8a3ff;
	}
	.font-name {
		font-weight: 600;
		font-size: 15px;
		color: #e8e8ee;
	}
	.badge {
		font-size: 10px;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		padding: 2px 7px;
		border-radius: 999px;
		border: 1px solid #333;
		color: #aaa;
	}
	.badge.bitmap {
		background: #1f2d23;
		border-color: #2f5340;
		color: #7ee787;
	}
	.badge.web {
		background: #2a2430;
		border-color: #44345a;
		color: #c8a3ff;
	}
	.font-id {
		font-family: ui-monospace, monospace;
		font-size: 11px;
		color: #777;
		margin: 4px 0 12px;
	}
	.font-body {
		display: flex;
		gap: 16px;
		align-items: center;
		flex-wrap: wrap;
	}
	.thumb {
		max-width: 120px;
		max-height: 90px;
		border: 1px solid #2a2a33;
		border-radius: 6px;
		background:
			repeating-conic-gradient(#1a1a20 0% 25%, #14141a 0% 50%) 50% / 16px 16px;
		image-rendering: pixelated;
	}
	.live {
		flex: 1 1 320px;
		min-width: 0;
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 10px 12px;
	}
	.empty {
		background: #16161c;
		border: 1px dashed #333;
		border-radius: 12px;
		padding: 28px;
		text-align: center;
	}
	.empty-title {
		color: #ccc;
		font-size: 15px;
		margin: 0 0 6px;
	}
	.link {
		background: transparent;
		border: none;
		color: #7ee0c0;
		cursor: pointer;
		padding: 0;
		font-size: inherit;
		text-decoration: underline;
	}
	.soon {
		background: #16161c;
		border: 1px solid #222;
		border-radius: 12px;
		padding: 28px;
		max-width: 640px;
	}
	code {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 4px;
		padding: 1px 5px;
		font-size: 12px;
		color: #c8a3ff;
	}
</style>
