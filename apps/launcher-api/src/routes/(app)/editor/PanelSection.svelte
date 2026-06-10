<script lang="ts">
	import type { Snippet } from 'svelte';

	import { isSectionOpen, setSectionOpen } from './sectionCollapse.client';

	/**
	 * The SHARED collapsible sidebar section for the editor-family tools (Scene
	 * Editor, Component Editor): a native `<details>` with a chevron summary, a
	 * title, an optional count and optional header actions, persisting its
	 * open/closed state via `sectionCollapse.client.ts` under `id`. One
	 * implementation — header look, chevron, persistence — inherited by every
	 * panel section in every tool, so a change here propagates to all of them.
	 *
	 * The stable `iw-panel-sec` class is the parent's hook for SPACING-only rules
	 * (e.g. `:global(.iw-panel-sec) { margin-top: … }`); everything else stays in
	 * here.
	 */
	interface Props {
		/** Stable persistence key (unique per tool+section, e.g. `lib-atlases`). */
		id: string;
		title: string;
		count?: number | string;
		/** Extra header controls (e.g. an upload button). Clicks inside must
		 * `stopPropagation()` if they should not toggle the section. */
		actions?: Snippet;
		children: Snippet;
	}
	const { id, title, count, actions, children }: Props = $props();
</script>

<details
	class="iw-panel-sec"
	open={isSectionOpen(id)}
	ontoggle={(e) => setSectionOpen(id, e.currentTarget.open)}
>
	<summary class="sec-h">
		<span class="sec-title">{title}</span>
		{#if count !== undefined}<span class="count">{count}</span>{/if}
		{#if actions}{@render actions()}{/if}
	</summary>
	{@render children()}
</details>

<style>
	details {
		margin: 0 0 4px;
	}
	summary.sec-h {
		display: flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		list-style: none;
		user-select: none;
		font-size: 11px;
		text-transform: uppercase;
		letter-spacing: 0.06em;
		color: #aaa;
		margin: 0 0 6px;
	}
	summary.sec-h::-webkit-details-marker {
		display: none;
	}
	summary.sec-h::before {
		content: '▸';
		font-size: 9px;
		color: #667;
		transition: transform 0.12s ease;
	}
	details[open] > summary.sec-h::before {
		transform: rotate(90deg);
	}
	.sec-title {
		font-weight: 600;
	}
	.count {
		color: #555;
		font-weight: 400;
		font-size: 11px;
		margin-left: auto;
	}
</style>
