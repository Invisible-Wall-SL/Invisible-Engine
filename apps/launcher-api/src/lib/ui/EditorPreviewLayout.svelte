<script lang="ts">
	import type { Snippet } from 'svelte';

	import InfoTip from './InfoTip.svelte';

	/**
	 * The launcher's "settings + live preview" arrangement (the Symbols Flights block is the
	 * reference): an optional list of what is being edited, a framed panel of fields, and a preview
	 * column — a label above, the preview, and what the preview shows in an InfoTip below. A wrapping
	 * row, so a narrow window stacks the three. The preview column sticks to the top of the scroll
	 * area while a long panel scrolls past it.
	 */
	interface Props {
		/** A leading list (e.g. one row per kind), laid out as a 200 px column. */
		list?: Snippet;
		/** The fields, drawn inside the framed panel. */
		editor: Snippet;
		/** The live preview itself. */
		preview: Snippet;
		/** What the preview shows — rendered in the InfoTip under it. */
		about?: Snippet;
		previewLabel?: string;
		aboutLabel?: string;
	}
	const {
		list,
		editor,
		preview,
		about,
		previewLabel = 'Preview',
		aboutLabel = 'About the preview',
	}: Props = $props();
</script>

<div class="ep-body">
	{#if list}<div class="ep-list">{@render list()}</div>{/if}
	<div class="ep-editor">{@render editor()}</div>
	<div class="ep-preview">
		<span class="ep-label">{previewLabel}</span>
		{@render preview()}
		{#if about}<InfoTip label={aboutLabel}>{@render about()}</InfoTip>{/if}
	</div>
</div>

<style>
	.ep-body {
		display: flex;
		gap: 16px;
		margin-top: 14px;
		flex-wrap: wrap;
		align-items: flex-start;
	}
	.ep-list {
		flex: 0 0 200px;
		min-width: 0;
	}
	.ep-editor {
		flex: 1 1 340px;
		min-width: 300px;
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 14px;
		background: #0d0d14;
		border: 1px solid #1d1d26;
		border-radius: 8px;
	}
	.ep-preview {
		position: sticky;
		top: 12px;
		display: flex;
		flex-direction: column;
		gap: 6px;
		max-width: 100%;
	}
	.ep-label {
		font-size: 11px;
		color: #8a8a96;
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}
</style>
