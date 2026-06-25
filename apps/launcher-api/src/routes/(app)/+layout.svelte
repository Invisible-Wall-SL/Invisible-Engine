<script lang="ts">
	import type { Snippet } from 'svelte';
	import { navigating } from '$app/state';
	import Emblem from '$lib/Emblem.svelte';

	let {
		children,
		data,
	}: {
		children: Snippet;
		data?: { tools?: { name: string; url: string }[] };
	} = $props();

	// Heavy tool routes (FX, Flow, Editor…) ship large JS chunks (PixiJS, Spine,
	// particle-emitter) that download AFTER the click but BEFORE the page renders —
	// so the launcher looks frozen for a few seconds. `navigating.to` is set for that
	// whole window, so a branded overlay gives immediate feedback. The CSS fade-in is
	// delayed ~250ms, so quick routes (home, login) finish first and never flash it.
	const targetName = $derived(
		navigating.to
			? (data?.tools?.find((t) => t.url === navigating.to?.url.pathname)?.name ?? null)
			: null,
	);
</script>

{@render children()}

{#if navigating.to}
	<div class="nav-loading" role="status" aria-live="polite">
		<div class="card">
			<Emblem height={44} />
			<div class="spinner" aria-hidden="true"></div>
			<p>Opening {targetName ?? 'tool'}…</p>
		</div>
	</div>
{/if}

<style>
	:global(body) {
		margin: 0;
		background: #0b0b0f;
		color: #eee;
		font-family: system-ui, sans-serif;
	}

	.nav-loading {
		position: fixed;
		inset: 0;
		z-index: 9999;
		display: grid;
		place-items: center;
		background: rgba(11, 11, 15, 0.82);
		backdrop-filter: blur(3px);
		/* Stay invisible until the navigation has clearly stalled, so fast routes
		   never flash. Only slow chunk loads (FX/Flow/Editor) cross the threshold. */
		opacity: 0;
		animation: nav-fade-in 0.2s ease 0.25s forwards;
	}

	.card {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		color: #7ee0c0;
	}

	.spinner {
		width: 32px;
		height: 32px;
		border: 3px solid rgba(126, 224, 192, 0.25);
		border-top-color: #7ee0c0;
		border-radius: 50%;
		animation: nav-spin 0.8s linear infinite;
	}

	.card p {
		margin: 0;
		color: #cbd5e1;
		font-size: 13px;
		letter-spacing: 0.02em;
	}

	@keyframes nav-spin {
		to {
			transform: rotate(360deg);
		}
	}

	@keyframes nav-fade-in {
		to {
			opacity: 1;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 1.6s;
		}
		.nav-loading {
			animation-delay: 0.1s;
		}
	}
</style>
