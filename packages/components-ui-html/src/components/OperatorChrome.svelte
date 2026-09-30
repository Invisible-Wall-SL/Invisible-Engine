<script lang="ts">
	import { onMount } from 'svelte';
	import { zIndex } from 'constants-shared/zIndex';
	import { UI_TEXT } from 'engine-layout';
	import { stateI18n } from 'state-shared';

	import { i18nDerived } from '../i18n/i18nDerived';
	import { registerOperatorChrome } from '../registerOperatorChrome.svelte';

	/**
	 * The operator's chrome when the authored HUD does not draw it: a thin strip on the top edge with
	 * whatever the operator's page declared — clock, session time, HOME, HISTORY — and nothing else.
	 * Declared nothing ⇒ no element at all. An item the HUD already binds (a text box on `clock`, a
	 * button on `home` or gated by `homeShow`, …) drops out of the strip, so the player never sees
	 * two clocks. The feeds, and how "already binds" is known: `registerOperatorChrome.svelte.ts`.
	 */
	const chrome = registerOperatorChrome();

	type Caption = 'home' | 'history' | 'sessionTime';

	// Lingui's active locale is not reactive state, and the operator's page is adopted before
	// <LoadI18n> activates one — so follow its `change` event, or the strip keeps its first,
	// untranslated captions. Before activation Lingui throws, so the source literal is shown.
	let locale = $state(stateI18n.i18n.locale);
	onMount(() => stateI18n.i18n.on('change', () => (locale = stateI18n.i18n.locale)));
	const caption = (key: Caption) => (locale ? i18nDerived[key]() : UI_TEXT[key]);

	const showClock = $derived(chrome.shows('clock'));
	const showSessionTime = $derived(chrome.shows('sessionTime'));
	const showHome = $derived(chrome.shows('home'));
	const showHistory = $derived(chrome.shows('history'));

	// The strip's reads go through the uncounted tickers — counting itself would hide it.
	let clockText = $state('');
	let sessionText = $state('');
	$effect(() => {
		if (!showClock) return;
		return chrome.clock.subscribe((value) => (clockText = value));
	});
	$effect(() => {
		if (!showSessionTime) return;
		return chrome.sessionTime.subscribe((value) => (sessionText = value));
	});

	// The game spins on Space from a window listener. A focused strip button owns its own keys, and
	// a MOUSE press must not leave it focused, or the player's next Space presses HISTORY again.
	const keepKeys = (event: KeyboardEvent) => {
		if (event.key === ' ' || event.key === 'Enter') event.stopPropagation();
	};
	const press = (event: MouseEvent, go: () => void) => {
		if (event.detail > 0 && event.currentTarget instanceof HTMLElement) event.currentTarget.blur();
		go();
	};
</script>

{#if showClock || showSessionTime || showHome || showHistory}
	<div class="operator-chrome" style="z-index: {zIndex.chrome}">
		{#if showClock}
			<span class="item value">{clockText}</span>
		{/if}
		{#if showSessionTime}
			<span class="item">
				<span class="caption">{caption('sessionTime')}</span>
				<span class="value">{sessionText}</span>
			</span>
		{/if}
		{#if showHome}
			<button
				type="button"
				class="link"
				aria-label={caption('home')}
				onkeydown={keepKeys}
				onkeyup={keepKeys}
				onclick={(event) => press(event, chrome.home)}
			>
				{caption('home')}
			</button>
		{/if}
		{#if showHistory}
			<button
				type="button"
				class="link"
				aria-label={caption('history')}
				onkeydown={keepKeys}
				onkeyup={keepKeys}
				onclick={(event) => press(event, chrome.history)}
			>
				{caption('history')}
			</button>
		{/if}
	</div>
{/if}

<style lang="scss">
	.operator-chrome {
		position: fixed;
		top: 0;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		align-items: center;
		gap: 4px 12px;
		max-width: calc(100vw - 16px);
		box-sizing: border-box;
		padding: calc(4px + env(safe-area-inset-top, 0px)) 12px 4px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		border-top: none;
		border-radius: 0 0 10px 10px;
		background: rgba(16, 16, 24, 0.72);
		color: #fff;
		font-size: 13px;
		line-height: 1.2;
		white-space: nowrap;
		user-select: none;
		pointer-events: none;
	}

	.item {
		display: inline-flex;
		align-items: baseline;
		gap: 6px;
	}

	.value {
		font-weight: 700;
		font-variant-numeric: tabular-nums;
	}

	.caption {
		font-size: 11px;
		letter-spacing: 0.04em;
		opacity: 0.75;
	}

	.link {
		min-height: 28px;
		padding: 4px 10px;
		border: 1px solid rgba(255, 255, 255, 0.35);
		border-radius: 6px;
		background: transparent;
		color: #fff;
		font: inherit;
		font-weight: 700;
		letter-spacing: 0.04em;
		cursor: pointer;
		pointer-events: auto;
		touch-action: manipulation;

		&:hover {
			background: rgba(255, 255, 255, 0.12);
		}

		&:focus-visible {
			outline: 2px solid #fff;
			outline-offset: 2px;
		}
	}

	@media (pointer: coarse) {
		.link {
			min-height: 32px;
		}
	}
</style>
