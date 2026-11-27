<script lang="ts">
	/**
	 * The tools' small square icon button — the fold chevron and the remove bin on section and
	 * panel headers, so header controls sit quietly beside the title instead of as text
	 * buttons. `label` is both the tooltip and the accessible name. `reset`: back to a default.
	 * `history`: a doc's saved versions (`DocHistoryModal`). `undelete`: deleted docs, back from
	 * their saved versions (`DeletedDocsModal`). `play` / `pause`: a preview's clock. `reverse`: turn
	 * about. `reroll`: a new random pick (a generated level's seed). `replay`: play a preview again
	 * from its start. `up` / `down`: move an entry of a list one place.
	 */
	interface Props {
		icon:
			| 'chevron'
			| 'trash'
			| 'reset'
			| 'history'
			| 'undelete'
			| 'play'
			| 'pause'
			| 'reverse'
			| 'reroll'
			| 'replay'
			| 'up'
			| 'down';
		label: string;
		onclick: () => void;
		/** For a chevron: points down when expanded, right when folded. */
		expanded?: boolean;
		danger?: boolean;
		disabled?: boolean;
	}
	const { icon, label, onclick, expanded, danger = false, disabled = false }: Props = $props();
</script>

<button
	type="button"
	class="icon-btn"
	class:danger
	class:folded={icon === 'chevron' && expanded === false}
	title={label}
	aria-label={label}
	aria-expanded={icon === 'chevron' ? expanded : undefined}
	{disabled}
	{onclick}
>
	{#if icon === 'chevron'}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
	{:else if icon === 'reset'}
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><path d="M3.5 8a4.5 4.5 0 1 0 1.3-3.2M4.5 2.5v2.5H7" /></svg
		>
	{:else if icon === 'history'}
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5M8 5v3l2 1.5" /></svg
		>
	{:else if icon === 'undelete'}
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M8 11.5V7M6.3 8.7L8 7l1.7 1.7" />
		</svg>
	{:else if icon === 'play'}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5l6.5 4.5-6.5 4.5z" /></svg>
	{:else if icon === 'pause'}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5v9M10.5 3.5v9" /></svg>
	{:else if icon === 'reverse'}
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><path d="M3 5.5h10M10.5 3l2.5 2.5-2.5 2.5M13 10.5H3M5.5 8L3 10.5 5.5 13" /></svg
		>
	{:else if icon === 'replay'}
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><path d="M3 8a5 5 0 1 0 1.5-3.6M3 2.5V5h2.5M7 6l3 2-3 2z" /></svg
		>
	{:else if icon === 'up'}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 10l4-4 4 4" /></svg>
	{:else if icon === 'down'}
		<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" /></svg>
	{:else if icon === 'reroll'}
		<svg viewBox="0 0 16 16" aria-hidden="true"
			><path
				d="M12.5 6A4.5 4.5 0 0 0 4 5M3.5 10A4.5 4.5 0 0 0 12 11M3.5 2.5V5H6M12.5 13.5V11H10"
			/></svg
		>
	{:else}
		<svg viewBox="0 0 16 16" aria-hidden="true">
			<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5M7 7v4M9 7v4" />
		</svg>
	{/if}
</button>

<style>
	.icon-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		flex: none;
		width: 24px;
		height: 24px;
		padding: 0;
		border: 1px solid transparent;
		border-radius: 6px;
		background: transparent;
		color: #7a7a88;
		cursor: pointer;
		transition:
			background 0.12s ease,
			color 0.12s ease,
			border-color 0.12s ease;
	}
	.icon-btn:hover:not(:disabled) {
		background: #1f1f29;
		border-color: #2e2e3a;
		color: #d8d8e2;
	}
	.icon-btn.danger:hover:not(:disabled) {
		background: #2a1618;
		border-color: #4a2328;
		color: #ff8a8a;
	}
	.icon-btn:focus-visible {
		outline: 1px solid #7ee0c0;
		outline-offset: 1px;
	}
	.icon-btn:disabled {
		opacity: 0.35;
		cursor: default;
	}
	svg {
		width: 14px;
		height: 14px;
		fill: none;
		stroke: currentColor;
		stroke-width: 1.5;
		stroke-linecap: round;
		stroke-linejoin: round;
		transition: transform 0.15s ease;
	}
	.folded svg {
		transform: rotate(-90deg);
	}
</style>
