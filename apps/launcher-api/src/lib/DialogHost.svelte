<script lang="ts">
	/**
	 * The one host for `askConfirm()` / `askMessage()` / `askText()`. Mounted once in the
	 * `(app)` layout, so every authed tool page inherits it without importing anything.
	 *
	 * `{#key top.id}` is load-bearing. `<ConfirmDialog>` seeds its guard/prompt field only
	 * on the false→true edge of `open`; when one queued request settles straight into the
	 * next, `open` never dips, so without a remount the second dialog would open carrying
	 * the first one's typed text.
	 */
	import ConfirmDialog from './ConfirmDialog.svelte';
	import { dialogQueue, settleDialog } from './dialogs.svelte';

	const top = $derived(dialogQueue.current);
</script>

{#if top}
	{#key top.id}
		<ConfirmDialog
			open
			title={top.title}
			message={top.message}
			confirmLabel={top.confirmLabel}
			cancelLabel={top.cancelLabel}
			danger={top.danger}
			requireText={top.requireText}
			requireHint={top.requireHint}
			hideCancel={top.hideCancel}
			input={top.input}
			onconfirm={(typed) => settleDialog(typed)}
			oncancel={() => settleDialog(null)}
		/>
	{/key}
{/if}
