import { beforeNavigate, goto } from '$app/navigation';
import { askConfirm, type ConfirmOptions } from './dialogs.svelte';

/**
 * "You have unsaved changes — leave anyway?" for a CLIENT-SIDE navigation, asked through the
 * app's own dialog.
 *
 * `beforeNavigate` is synchronous: the only way to stop a navigation is to call
 * `navigation.cancel()` before the hook returns, and `<ConfirmDialog>` cannot answer by then.
 * So the guard does not ask-then-cancel — it **cancels first, always**, and re-issues the
 * navigation itself if the author says leave. Cancelling is the safe default: the worst case
 * of a bug here is a navigation that needs a second click, never work discarded silently.
 * (Asking first and cancelling after would be the opposite: the page would already be gone.)
 *
 * Re-issuing has to be faithful to what the author actually did, which is why the two kinds
 * are handled apart:
 *   - link / `goto` → `goto(to)`, the same forward navigation.
 *   - popstate (Back/Forward) → `history.go(delta)`, NOT `goto`. SvelteKit counteracts a
 *     cancelled popstate with its own `history.go`, so the entry is still there; replaying it
 *     with `goto` would push a NEW entry instead of moving within history, quietly turning
 *     Back into Forward. `delta` is on the navigation for exactly this.
 *
 * `approved` is the one-shot re-entry ticket: the re-issued navigation runs this hook again
 * and must pass through. It is consumed by the hook, and also cleared if the `goto` resolves
 * without the hook having fired (a same-URL navigation), so a stale ticket can never let a
 * LATER navigation past unasked.
 *
 * `willUnload` navigations (a real unload — refresh, tab close, an off-app link) are NOT
 * handled here: cancelling one only re-triggers the browser's own dialog, so the page keeps
 * its `beforeunload` listener for those and they are left alone.
 *
 * Call it at component init, like `onMount` — it registers a lifecycle hook.
 *
 * @param cost Read at navigation time: the question to ask, or `null` when nothing is at risk.
 */
export function guardUnsavedWork(cost: () => ConfirmOptions | null): void {
	let approved = false;

	beforeNavigate((navigation) => {
		if (approved) {
			approved = false;
			return;
		}
		if (navigation.willUnload) return;
		const question = cost();
		if (!question) return;

		const to = navigation.to?.url;
		const { delta } = navigation;
		navigation.cancel();

		void (async () => {
			if (!(await askConfirm(question))) return;
			approved = true;
			if (typeof delta === 'number') {
				// Redoes the exact history move SvelteKit just undid; the hook above eats the ticket.
				history.go(delta);
				return;
			}
			if (!to) {
				approved = false;
				return;
			}
			try {
				// `svelte/no-navigation-without-resolve` wants `resolve()`, which SvelteKit 2.17
				// does not export yet — and `to` is the URL SvelteKit itself resolved for the
				// navigation we just cancelled, so it needs no resolving.
				// eslint-disable-next-line svelte/no-navigation-without-resolve
				await goto(to);
			} finally {
				approved = false;
			}
		})();
	});
}
