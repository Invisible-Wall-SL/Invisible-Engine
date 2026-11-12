<script lang="ts" module>
	/**
	 * Which Game Config sections the author folded, by section id — view state only, never saved to
	 * the doc, shared across projects. Default OPEN: a key is stored only while folded.
	 */
	const KEY = 'iw-config-collapsed-sections';

	function loadFolded(): Set<string> {
		try {
			const raw = localStorage.getItem(KEY);
			return new Set(raw ? (JSON.parse(raw) as string[]) : []);
		} catch {
			return new Set();
		}
	}

	function storeFolded(id: string, folded: boolean): void {
		const all = loadFolded();
		if (folded) all.add(id);
		else all.delete(id);
		try {
			localStorage.setItem(KEY, JSON.stringify([...all]));
		} catch {
			/* storage disabled — the fold just does not survive a reload */
		}
	}
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import ConfigIconButton from './ConfigIconButton.svelte';

	/**
	 * One Game Config section: a card with a foldable header. Folding unmounts the body, so a long
	 * config stays light to scroll; the fold survives reloads (restored after mount, since the page
	 * is server-rendered open).
	 */
	interface Props {
		/** Stable persistence key, unique on the page. */
		id: string;
		title: string;
		/** Extra header controls, right-aligned (prefer `ConfigIconButton`). */
		actions?: Snippet;
		children: Snippet;
	}
	const { id, title, actions, children }: Props = $props();

	let open = $state(true);
	onMount(() => {
		open = !loadFolded().has(id);
	});

	function toggle() {
		open = !open;
		storeFolded(id, !open);
	}
</script>

<section class="cfg-sec" class:folded={!open}>
	<header>
		<ConfigIconButton
			icon="chevron"
			label={open ? `Fold ${title}` : `Show ${title}`}
			expanded={open}
			onclick={toggle}
		/>
		<h2><button type="button" class="title" onclick={toggle}>{title}</button></h2>
		{#if actions}<div class="actions">{@render actions()}</div>{/if}
	</header>
	{#if open}
		<div class="body">{@render children()}</div>
	{/if}
</section>

<style>
	.cfg-sec {
		margin: 0 0 14px;
		border: 1px solid #23232d;
		border-radius: 10px;
		background: #101016;
		min-width: 0;
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		padding: 8px 12px 8px 8px;
	}
	.cfg-sec:not(.folded) header {
		border-bottom: 1px solid #1d1d26;
	}
	h2 {
		margin: 0;
		flex: 1;
		min-width: 0;
	}
	.title {
		width: 100%;
		padding: 0 0 2px;
		line-height: 1;
		border: none;
		background: none;
		text-align: left;
		cursor: pointer;
		font: inherit;
		font-size: 13px;
		font-weight: 700;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: #7ee0c0;
	}
	.folded .title {
		color: #5fa891;
	}
	.title:hover {
		color: #a4f0d6;
	}
	.actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.body {
		padding: 12px 16px 6px;
	}
</style>
