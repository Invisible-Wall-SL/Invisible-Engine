import { onMount } from 'svelte';
import type { BeforeNavigate } from '@sveltejs/kit';
import { beforeNavigate, goto } from '$app/navigation';
import { askConfirm, type ConfirmOptions } from './dialogs.svelte';
import { createLeaveGuard } from './unsavedGuardCore';

const leaveGuard = createLeaveGuard({
	ask: askConfirm,
	// `svelte/no-navigation-without-resolve` wants `resolve()`, which SvelteKit 2.17 does not
	// export yet — and `to` is the URL SvelteKit itself resolved for the navigation the guard
	// cancelled, so it needs no resolving.
	// eslint-disable-next-line svelte/no-navigation-without-resolve
	goto: (to) => goto(to),
	historyGo: (delta) => history.go(delta),
});

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
 * The re-issued navigation carries a one-shot ticket: it runs every guard's hook again and must
 * pass through all of them. It is spent once they have run, and also cleared if the `goto`
 * resolves without the hooks having fired (a same-URL navigation), so a stale ticket can never
 * let a LATER navigation past unasked. Every guard on the page shares that ticket and, for one
 * navigation, ONE question (`unsavedGuardCore.ts` says why) — `/editor` holds several.
 *
 * `willUnload` navigations (a real unload — refresh, tab close, an off-app link, the top bar's
 * project switch) skip the dialog: cancelling one only re-triggers the browser's own prompt.
 * They are covered by the `beforeunload` listener registered alongside, which asks the browser's
 * native "Leave site?" instead — `beforeunload` never fires for a client-side navigation, and
 * `beforeNavigate` cannot hold a real unload, so a page needs both and gets both from this call.
 *
 * Call it at component init, like `onMount` — it registers lifecycle hooks.
 *
 * @param cost Read at navigation time: the question to ask, or `null` when nothing is at risk.
 * @param handledElsewhere A navigation the page itself cancels and applies in place, asking on its
 *   own (`/editor` opening its Components side): this guard stands down, so nobody asks twice.
 */
export function guardUnsavedWork(
	cost: () => ConfirmOptions | null,
	handledElsewhere?: (navigation: BeforeNavigate) => boolean,
): void {
	onMount(() => {
		const onBeforeUnload = (e: BeforeUnloadEvent): void => {
			if (!cost()) return;
			e.preventDefault();
			e.returnValue = '';
		};
		window.addEventListener('beforeunload', onBeforeUnload);
		return () => window.removeEventListener('beforeunload', onBeforeUnload);
	});

	beforeNavigate((navigation) => leaveGuard(navigation, cost, handledElsewhere));
}
