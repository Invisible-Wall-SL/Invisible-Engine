<script lang="ts">
	import type { Snippet } from 'svelte';

	/**
	 * Field-level help: an ⓘ (with an optional short `label`) whose explanation shows as a tooltip on
	 * hover or keyboard focus — the in-section counterpart of `SectionCard`'s `info` (pipeline UI
	 * rule: no walls of text in a tool). The text stays in the DOM, so SSR and the fixtures read it.
	 *
	 * The tip is `position: fixed`, placed against the viewport when it opens: an ⓘ inside a
	 * scrolling side panel would otherwise have its tip clipped by the panel. It opens below the ⓘ,
	 * flips above when there is no room, and is kept inside the window.
	 */
	interface Props {
		/** A few words naming what the tip explains; empty = icon only. */
		label?: string;
		/** Line the tip up with the ⓘ's right edge instead of its left (right-hand panels). */
		alignEnd?: boolean;
		children: Snippet;
	}
	const { label = '', alignEnd = false, children }: Props = $props();
	const id = $props.id();

	const GAP = 6;
	const MARGIN = 8;
	let trigger = $state<HTMLButtonElement>();
	let tip = $state<HTMLSpanElement>();
	let top = $state(0);
	let left = $state(0);

	function place() {
		if (!trigger || !tip) return;
		const at = trigger.getBoundingClientRect();
		const { width, height } = tip.getBoundingClientRect();
		const below = at.bottom + GAP;
		const above = at.top - GAP - height;
		top = below + height > innerHeight - MARGIN && above >= MARGIN ? above : below;
		const from = alignEnd ? at.right - width : at.left;
		left = Math.max(MARGIN, Math.min(from, innerWidth - width - MARGIN));
	}
</script>

<span class="info-tip" role="presentation" onmouseenter={place}>
	<button
		bind:this={trigger}
		type="button"
		class="trigger"
		aria-label={label || 'More about this'}
		aria-describedby={id}
		onfocus={place}
	>
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<circle cx="8" cy="8" r="6.25" />
			<path d="M8 7.25v4M8 4.9v.1" />
		</svg>
		{#if label}<span class="label">{label}</span>{/if}
	</button>
	<span bind:this={tip} class="tip" role="tooltip" {id} style:top="{top}px" style:left="{left}px"
		>{@render children()}</span
	>
</span>

<style>
	.info-tip {
		display: inline-flex;
		vertical-align: middle;
	}
	.trigger {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 4px 2px 0;
		border: none;
		background: none;
		font: inherit;
		font-size: 11px;
		color: #6f6f7d;
		cursor: help;
	}
	.info-tip:hover .trigger,
	.info-tip:focus-within .trigger {
		color: #b8b8c4;
	}
	.trigger:focus-visible {
		outline: 1px solid #7ee0c0;
		outline-offset: 1px;
	}
	svg {
		flex: none;
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.4;
		stroke-linecap: round;
	}
	.tip {
		position: fixed;
		z-index: 1000;
		display: block;
		width: max-content;
		max-width: min(520px, 80vw);
		padding: 10px 12px;
		border: 1px solid #2e2e3a;
		border-radius: 8px;
		background: #1a1a22;
		box-shadow: 0 8px 24px rgb(0 0 0 / 0.45);
		font-size: 12px;
		font-weight: 400;
		line-height: 1.55;
		color: #b8b8c4;
		text-align: left;
		text-transform: none;
		letter-spacing: normal;
		white-space: normal;
		visibility: hidden;
		opacity: 0;
		transition:
			opacity 0.12s ease,
			visibility 0s linear 0.12s;
	}
	.info-tip:hover .tip,
	.info-tip:focus-within .tip {
		visibility: visible;
		opacity: 1;
		transition-delay: 0.25s, 0.25s;
	}
</style>
