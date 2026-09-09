<script lang="ts">
	/**
	 * The launcher's confirmation modal — domain A's shared replacement for the ~15
	 * bare `window.confirm()` calls scattered across the tools, and for destructive
	 * buttons (admin's project Delete) that had no confirmation at all.
	 *
	 * Built on the native `<dialog>` + `showModal()` rather than a hand-rolled overlay,
	 * which buys three things this codebase kept re-solving badly: a real focus trap,
	 * Escape handling, and — the reason it exists — the rest of the page going INERT
	 * while it is open. A misclick on a neighbouring button during a running action is
	 * not possible, because nothing behind the modal can receive a click.
	 *
	 * `requireText` adds the typed guard for genuinely destructive actions: Confirm stays
	 * disabled until the user types the exact key. `busy` keeps the dialog open and
	 * un-dismissable while the action runs, so there is no window in which the page is
	 * live again but the work is not finished.
	 */
	import type { Snippet } from 'svelte';

	interface Props {
		/**
		 * ONE-WAY: the caller owns it. Cancel/Escape/backdrop call `oncancel`, which must
		 * clear whatever drives this — the dialog never closes itself. (An earlier version
		 * wrote to a `$bindable` `open` that no consumer bound, so it closed via a local
		 * override and only re-synced because `oncancel` happened to change the parent
		 * expression; a consumer omitting `oncancel` got a dialog that could never reopen.)
		 */
		open: boolean;
		title: string;
		confirmLabel?: string;
		cancelLabel?: string;
		/** Paints the confirm button with the danger fill. */
		danger?: boolean;
		/** When set, Confirm unlocks only once the user types this string exactly. */
		requireText?: string;
		/** Label above the guard input. Defaults to naming the required text. */
		requireHint?: string;
		/** While true the dialog is modal, un-dismissable, and shows `busyLabel`. */
		busy?: boolean;
		busyLabel?: string;
		/**
		 * Hard-locks Confirm regardless of the typed guard — for a precondition the user
		 * cannot type their way past (e.g. another project shares this one's R2 folder).
		 */
		blocked?: boolean;
		/**
		 * A failed attempt, rendered INSIDE the dialog. The caller keeps `open` true on
		 * failure so the error is read where the action was taken, not behind a dialog
		 * that closed itself.
		 */
		error?: string;
		/** Receives the guard text the user typed, so the server can re-validate it. */
		onconfirm: (typed: string) => void;
		/** REQUIRED — the only thing that can close this dialog. */
		oncancel: () => void;
		/** The explanatory content — what exactly is about to happen. */
		body?: Snippet;
	}

	let {
		open,
		title,
		confirmLabel = 'Confirm',
		cancelLabel = 'Cancel',
		danger = false,
		requireText = '',
		requireHint = '',
		busy = false,
		busyLabel = 'Working…',
		blocked = false,
		error = '',
		onconfirm,
		oncancel,
		body,
	}: Props = $props();

	let el = $state<HTMLDialogElement | null>(null);
	let typed = $state('');

	const unlocked = $derived(!blocked && (requireText === '' || typed === requireText));

	$effect(() => {
		const dialog = el;
		if (!dialog) return;
		if (open && !dialog.open) {
			typed = '';
			dialog.showModal();
		} else if (!open && dialog.open) {
			dialog.close();
		}
	});

	function cancel() {
		if (busy) return;
		oncancel();
	}

	function confirm() {
		if (busy || !unlocked) return;
		onconfirm(typed);
	}

	/**
	 * Backdrop click. `event.target === el` is NOT enough: the dialog has padding, so a
	 * click in that ring is on `el` itself and would dismiss a dialog the user clicked
	 * INSIDE. Compare against the actual box instead.
	 */
	function onBackdrop(event: MouseEvent) {
		if (event.target !== el || !el) return;
		const box = el.getBoundingClientRect();
		const outside =
			event.clientX < box.left ||
			event.clientX > box.right ||
			event.clientY < box.top ||
			event.clientY > box.bottom;
		if (outside) cancel();
	}
</script>

<dialog
	bind:this={el}
	class:danger
	aria-busy={busy}
	onclick={onBackdrop}
	oncancel={(event) => {
		// Escape. Always swallowed: while busy there is nothing to escape to, and
		// otherwise we close through `cancel()` so `open` and the DOM stay in step.
		event.preventDefault();
		cancel();
	}}
>
	<h2>{title}</h2>

	{#if body}
		<div class="body">{@render body()}</div>
	{/if}

	{#if requireText}
		<label class="guard">
			<span>{requireHint || `Type ${requireText} to confirm`}</span>
			<input
				type="text"
				bind:value={typed}
				disabled={busy}
				autocomplete="off"
				autocorrect="off"
				spellcheck="false"
				placeholder={requireText}
			/>
		</label>
	{/if}

	{#if error}
		<p class="error" role="alert">{error}</p>
	{/if}

	<div class="actions">
		{#if busy}
			<span class="busy"><span class="spinner"></span>{busyLabel}</span>
		{/if}
		<button type="button" class="ghost" onclick={cancel} disabled={busy}>{cancelLabel}</button>
		<button
			type="button"
			class={danger ? 'danger' : ''}
			onclick={confirm}
			disabled={busy || !unlocked}
		>
			{confirmLabel}
		</button>
	</div>
</dialog>

<style>
	dialog {
		width: min(520px, calc(100vw - 32px));
		padding: 20px;
		border: 1px solid #2a2a33;
		border-radius: 14px;
		background: #16161d;
		color: #e8e8ee;
		font-size: 13px;
	}
	dialog::backdrop {
		background: rgb(0 0 0 / 0.6);
	}
	dialog.danger {
		border-color: #7a2230;
	}
	h2 {
		margin: 0 0 10px;
		font-size: 15px;
		font-weight: 600;
	}
	.body {
		display: flex;
		flex-direction: column;
		gap: 8px;
		line-height: 1.5;
		color: #b9b9c6;
	}
	.guard {
		display: flex;
		flex-direction: column;
		gap: 6px;
		margin-top: 16px;
	}
	.guard span {
		font-size: 12px;
		color: #b9b9c6;
	}
	.guard input {
		background: #0f0f14;
		border: 1px solid #2a2a33;
		border-radius: 8px;
		padding: 8px 10px;
		color: #e8e8ee;
		font-size: 13px;
		font-family: ui-monospace, monospace;
	}
	.guard input:focus {
		outline: none;
		border-color: #6b5bff;
	}
	.error {
		margin: 14px 0 0;
		padding: 9px 11px;
		border-radius: 8px;
		background: #2c1618;
		color: #ff9d9d;
		line-height: 1.5;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		align-items: center;
		gap: 8px;
		margin-top: 20px;
	}
	.busy {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-right: auto;
		font-size: 12px;
		color: #b9b9c6;
	}
	.spinner {
		width: 12px;
		height: 12px;
		border: 2px solid #3a3a46;
		border-top-color: #6b5bff;
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	button {
		background: #6b5bff;
		border: none;
		border-radius: 8px;
		padding: 9px 14px;
		color: #fff;
		font-size: 13px;
		cursor: pointer;
		white-space: nowrap;
	}
	button.danger {
		background: #7a2230;
	}
	button.ghost {
		background: #23232c;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	@media (prefers-reduced-motion: reduce) {
		.spinner {
			animation-duration: 3s;
		}
	}
</style>
