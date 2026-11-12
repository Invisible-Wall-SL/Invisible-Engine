<script lang="ts" module>
	/**
	 * Which sections of a tool the user folded, by section id, under `iw-<scope>-collapsed-sections`
	 * — view state only, never saved to a doc, shared across projects. Default OPEN: an id is stored
	 * only while folded.
	 */
	const keyOf = (scope: string) => `iw-${scope}-collapsed-sections`;

	function loadFolded(scope: string): Set<string> {
		try {
			const raw = localStorage.getItem(keyOf(scope));
			return new Set(raw ? (JSON.parse(raw) as string[]) : []);
		} catch {
			return new Set();
		}
	}

	function storeFolded(scope: string, id: string, folded: boolean): void {
		const all = loadFolded(scope);
		if (folded) all.add(id);
		else all.delete(id);
		try {
			localStorage.setItem(keyOf(scope), JSON.stringify([...all]));
		} catch {
			/* storage disabled — the fold just does not survive a reload */
		}
	}
</script>

<script lang="ts">
	import { onMount, type Snippet } from 'svelte';

	import IconButton from './IconButton.svelte';

	/**
	 * One tool section: a card with a foldable header. Folding unmounts the body, so a long
	 * config stays light to scroll; the fold survives reloads (restored after mount, since the page
	 * is server-rendered open).
	 *
	 * What a section IS goes in `info`, shown as a tooltip when the title or the ⓘ is hovered or
	 * focused — never as a paragraph in the body (pipeline UI rule: no walls of text in a tool). The
	 * body keeps only status that changes with the config (a warning, a "cannot use" note).
	 */
	interface Props {
		/** The tool this card belongs to (`config`, `fx`, …) — namespaces the stored folds. */
		scope: string;
		/** Stable persistence key, unique within the tool. */
		id: string;
		title: string;
		/** Extra header controls, right-aligned (prefer `IconButton`). */
		actions?: Snippet;
		/** What this section is for — rendered in the hover tooltip. */
		info?: Snippet;
		children: Snippet;
	}
	const { scope, id, title, actions, info, children }: Props = $props();

	let open = $state(true);
	onMount(() => {
		open = !loadFolded(scope).has(id);
	});

	function toggle() {
		open = !open;
		storeFolded(scope, id, !open);
	}
</script>

<section class="cfg-sec" class:folded={!open}>
	<header>
		<IconButton
			icon="chevron"
			label={open ? `Fold ${title}` : `Show ${title}`}
			expanded={open}
			onclick={toggle}
		/>
		<div class="label">
			<h2><button type="button" class="title" onclick={toggle}>{title}</button></h2>
			{#if info}
				<button
					type="button"
					class="info-btn"
					aria-label="About {title}"
					aria-describedby="{scope}-tip-{id}"
				>
					<svg viewBox="0 0 16 16" aria-hidden="true">
						<circle cx="8" cy="8" r="6.25" />
						<path d="M8 7.25v4M8 4.9v.1" />
					</svg>
				</button>
				<div class="tip" role="tooltip" id="{scope}-tip-{id}">{@render info()}</div>
			{/if}
		</div>
		<span class="spacer"></span>
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
	.label {
		position: relative;
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
	}
	.spacer {
		flex: 1;
	}
	h2 {
		margin: 0;
		min-width: 0;
	}
	.title {
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
	.info-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		padding: 0;
		border: none;
		border-radius: 50%;
		background: none;
		color: #5a5a68;
		cursor: help;
	}
	.label:hover .info-btn,
	.info-btn:focus-visible {
		color: #b8b8c4;
	}
	.info-btn:focus-visible {
		outline: 1px solid #7ee0c0;
	}
	.info-btn svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
	}
	.tip {
		position: absolute;
		top: calc(100% + 8px);
		left: 0;
		z-index: 30;
		width: max-content;
		max-width: min(560px, 80vw);
		padding: 10px 12px;
		border: 1px solid #2e2e3a;
		border-radius: 8px;
		background: #1a1a22;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
		font-size: 12px;
		line-height: 1.55;
		color: #b8b8c4;
		text-transform: none;
		letter-spacing: normal;
		visibility: hidden;
		opacity: 0;
		transition:
			opacity 0.12s ease,
			visibility 0s linear 0.12s;
	}
	.label:hover .tip,
	.info-btn:focus-visible + .tip {
		visibility: visible;
		opacity: 1;
		transition-delay: 0.25s, 0.25s;
	}
	.tip :global(p) {
		margin: 0 0 8px;
	}
	.tip :global(p:last-child) {
		margin-bottom: 0;
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
