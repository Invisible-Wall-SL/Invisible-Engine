<script lang="ts">
	/**
	 * The tools' small square icon button — the fold chevron and the remove bin on section and
	 * panel headers, so header controls sit quietly beside the title instead of as text
	 * buttons. `label` is both the tooltip and the accessible name.
	 */
	interface Props {
		icon: 'chevron' | 'trash';
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
