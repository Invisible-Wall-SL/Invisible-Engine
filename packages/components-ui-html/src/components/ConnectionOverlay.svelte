<script lang="ts">
	import { onMount } from 'svelte';
	import {
		onRgsConnection,
		readRgsConnection,
		type RgsConnectionStatus,
	} from 'constants-shared/rgsConnection';
	import { zIndex } from 'constants-shared/zIndex';
	import { UI_TEXT } from 'engine-layout';
	import { stateI18n } from 'state-shared';

	import { i18nDerived } from '../i18n/i18nDerived';

	type Caption = 'reconnecting' | 'pleaseWait' | 'connectionLost' | 'connectionLostInfo' | 'reload';

	// This can show before `<LoadI18n>` has activated a locale, and Lingui throws when asked to
	// translate without one — the source literal is the only thing to say at that point.
	const caption = (key: Caption) => (stateI18n.i18n.locale ? i18nDerived[key]() : UI_TEXT[key]);

	/** A single quick retry should not flash a full-screen overlay at the player. */
	const RECONNECTING_GRACE_MS = 400;

	let status = $state<RgsConnectionStatus>('connected');
	let graceElapsed = $state(false);
	let overlay = $state<HTMLDivElement>();
	let reloadButton = $state<HTMLButtonElement>();

	const view = $derived(
		status === 'failed'
			? 'failed'
			: status === 'reconnecting' && graceElapsed
				? 'reconnecting'
				: 'hidden',
	);

	onMount(() => {
		// The transport may have started retrying before this mounted.
		status = readRgsConnection().state;
		return onRgsConnection((next) => (status = next.state));
	});

	$effect(() => {
		graceElapsed = false;
		if (status !== 'reconnecting') return;
		const timer = setTimeout(() => (graceElapsed = true), RECONNECTING_GRACE_MS);
		return () => clearTimeout(timer);
	});

	$effect(() => {
		if (view === 'failed') reloadButton?.focus();
	});

	// The game binds keys (space to spin, …) on the window; while the overlay blocks play, keep them
	// from reaching it. Capture on window runs before every other listener.
	$effect(() => {
		if (view === 'hidden') return;
		const block = (event: KeyboardEvent) => {
			if (event.target instanceof Node && overlay?.contains(event.target)) return;
			event.stopImmediatePropagation();
		};
		window.addEventListener('keydown', block, true);
		window.addEventListener('keyup', block, true);
		return () => {
			window.removeEventListener('keydown', block, true);
			window.removeEventListener('keyup', block, true);
		};
	});
</script>

{#if view !== 'hidden'}
	<div
		bind:this={overlay}
		class="connection-overlay"
		style="z-index: {zIndex.connection}"
		role="alertdialog"
		aria-modal="true"
		aria-live="assertive"
		aria-labelledby="ie-connection-title"
		aria-describedby="ie-connection-info"
	>
		<div class="panel">
			{#if view === 'reconnecting'}
				<div class="spinner" aria-hidden="true"></div>
				<p id="ie-connection-title" class="title">{caption('reconnecting')}</p>
				<p id="ie-connection-info" class="info">{caption('pleaseWait')}</p>
			{:else}
				<p id="ie-connection-title" class="title">{caption('connectionLost')}</p>
				<p id="ie-connection-info" class="info">{caption('connectionLostInfo')}</p>
				<button bind:this={reloadButton} class="reload" onclick={() => location.reload()}>
					{caption('reload')}
				</button>
			{/if}
		</div>
	</div>
{/if}

<style lang="scss">
	.connection-overlay {
		position: fixed;
		inset: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 16px;
		box-sizing: border-box;
		background: rgba(0, 0, 0, 0.7);
		pointer-events: auto;
		touch-action: none;
	}

	.panel {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 12px;
		width: min(100%, 360px);
		box-sizing: border-box;
		padding: 24px 20px;
		border-radius: 12px;
		background: rgba(16, 16, 24, 0.92);
		border: 1px solid rgba(255, 255, 255, 0.12);
		color: #fff;
		text-align: center;
	}

	.title {
		margin: 0;
		font-size: 20px;
		font-weight: 700;
	}

	.info {
		margin: 0;
		font-size: 14px;
		opacity: 0.75;
	}

	.spinner {
		width: 40px;
		height: 40px;
		border-radius: 50%;
		border: 4px solid rgba(255, 255, 255, 0.2);
		border-top-color: #fff;
		animation: spin 0.9s linear infinite;
	}

	.reload {
		margin-top: 4px;
		min-width: 140px;
		min-height: 44px;
		padding: 10px 24px;
		border: none;
		border-radius: 8px;
		background: #fff;
		color: #111;
		font: inherit;
		font-size: 16px;
		font-weight: 700;
		cursor: pointer;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 3s;
		}
	}
</style>
