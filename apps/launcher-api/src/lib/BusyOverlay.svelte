<!--
	The in-tool loading overlay — a dimmed veil + card over a tool that is ALREADY
	up, while it loads or updates a part of itself (assets, a document, a publish).

	It is the counterpart to `<BootSplash>`: the CRT screen is what a tool shows
	while it is OPENING (nothing usable on screen yet); this overlay is what it
	shows once it is open. Don't use it for a tool boot — see docs/ui-inventory.md §12.

	Extracted from the Editor canvas' asset-load card, which is its reference use.
-->
<script lang="ts">
	let {
		label = 'Loading…',
		/** Right-hand counter next to the label, e.g. `3 / 12`. */
		detail = '',
		/** 0–100 progress bar; omit for an indeterminate spinner only. */
		progress = null,
		/** `absolute` covers the nearest positioned ancestor (a canvas); `fixed` covers the page. */
		position = 'absolute',
	}: {
		label?: string;
		detail?: string;
		progress?: number | null;
		position?: 'absolute' | 'fixed';
	} = $props();
</script>

<div class="veil" class:fixed={position === 'fixed'} role="status" aria-live="polite">
	<div class="card">
		<div class="spinner" aria-hidden="true"></div>
		<div class="text">
			<span class="title">{label}</span>
			{#if detail}<span class="detail">{detail}</span>{/if}
		</div>
		{#if progress !== null}
			<div class="bar">
				<div class="fill" style="width:{Math.max(0, Math.min(100, progress))}%"></div>
			</div>
		{/if}
	</div>
</div>

<style>
	.veil {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		pointer-events: none;
		background: rgba(11, 11, 16, 0.55);
		backdrop-filter: blur(1px);
	}
	.veil.fixed {
		position: fixed;
		z-index: 9998;
	}
	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		padding: 22px 28px;
		min-width: 220px;
		background: #14141c;
		border: 1px solid #2a2430;
		border-radius: 12px;
		box-shadow: 0 8px 28px rgba(0, 0, 0, 0.45);
	}
	.spinner {
		width: 28px;
		height: 28px;
		border-radius: 50%;
		border: 3px solid #2a2a36;
		border-top-color: #7ee0c0;
		animation: iw-busy-spin 0.8s linear infinite;
	}
	@keyframes iw-busy-spin {
		to {
			transform: rotate(360deg);
		}
	}
	.text {
		display: flex;
		align-items: baseline;
		gap: 10px;
	}
	.title {
		color: #e8e8ee;
		font-size: 13px;
		letter-spacing: 0.02em;
	}
	.detail {
		color: #888;
		font-size: 12px;
		font-family: ui-monospace, monospace;
	}
	.bar {
		width: 100%;
		height: 4px;
		border-radius: 999px;
		background: #2a2a36;
		overflow: hidden;
	}
	.fill {
		height: 100%;
		background: #7ee0c0;
		border-radius: 999px;
		transition: width 0.2s ease;
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.6s;
		}
	}
</style>
