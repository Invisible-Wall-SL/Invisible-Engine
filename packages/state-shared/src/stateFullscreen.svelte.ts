/**
 * Fullscreen — a BROWSER capability the engine owns itself.
 *
 * The upstream SDK ships the `jurisdiction.disabledFullscreen` PERMISSION flag but never
 * implemented the mechanic: on the host casino the wrapper owned the fullscreen button in
 * its own chrome, so the game only needed to know whether it was allowed. A standalone
 * game has no wrapper, hence this module.
 *
 * (Not to be confused with `OnPressFullScreen` in `components-layout` — that is a
 * canvas-sized transparent PRESS TARGET, unrelated to fullscreen mode.)
 */

/** The vendor-prefixed surface Safari still exposes instead of the standard API. */
type FullscreenDocument = Document & {
	webkitFullscreenElement?: Element | null;
	webkitExitFullscreen?: () => Promise<void> | void;
	webkitFullscreenEnabled?: boolean;
};
type FullscreenElement = HTMLElement & {
	webkitRequestFullscreen?: () => Promise<void> | void;
};

const doc = (): FullscreenDocument | undefined =>
	typeof document === 'undefined' ? undefined : (document as FullscreenDocument);

/** Swallow a rejected request (denied permission / not allowed here) — it is an expected
 * outcome, not a crash, and an unhandled rejection would noise up the console. */
const settle = (result: Promise<void> | void): void => {
	if (result && typeof (result as Promise<void>).catch === 'function')
		void (result as Promise<void>).catch(() => {});
};

const readActive = (): boolean => {
	const d = doc();
	return !!d && !!(d.fullscreenElement || d.webkitFullscreenElement);
};

/**
 * Live fullscreen flag. Driven ONLY by the `fullscreenchange` event, never by the
 * toggle — the user can leave fullscreen with Esc or the browser's own chrome without
 * touching our button, so a locally-flipped boolean would desync and the button would
 * show the wrong icon.
 */
export const stateFullscreen = $state({ active: readActive() });

/**
 * True when fullscreen is both IMPLEMENTED and PERMITTED here — a fullscreen button must
 * disable rather than fail silently on press. Two independent reasons it can be false:
 *
 *  - no API: iPhone Safari has no element Fullscreen API (iPad does).
 *  - permission: `fullscreenEnabled` is false when a Permissions-Policy forbids it — most
 *    importantly an `<iframe>` without `allow="fullscreen"`, which is exactly how a casino
 *    embeds the game. Without this check the button looks live and the request throws
 *    `TypeError: Permissions check failed`.
 */
export const isFullscreenSupported = (): boolean => {
	const d = doc();
	if (!d) return false;
	const el = d.documentElement as FullscreenElement;
	if (!el.requestFullscreen && !el.webkitRequestFullscreen) return false;
	// Undefined on engines that predate the property ⇒ don't treat absence as "forbidden".
	const enabled = d.fullscreenEnabled ?? d.webkitFullscreenEnabled;
	return enabled !== false;
};

/**
 * Toggle fullscreen on the document element.
 *
 * MUST be called SYNCHRONOUSLY from a user gesture — browsers reject `requestFullscreen`
 * outside a trusted event handler. Every caller in the press path (coded `onpress`, and
 * the flow's `toggleFullscreen` intent command) reaches this inside the click's call
 * stack; do not introduce an `await` (or a flow `delay`) ahead of it.
 */
export const toggleFullscreen = (): void => {
	const d = doc();
	if (!d) return;
	if (readActive()) settle(d.exitFullscreen?.() ?? d.webkitExitFullscreen?.());
	else {
		const el = d.documentElement as FullscreenElement;
		settle(el.requestFullscreen?.() ?? el.webkitRequestFullscreen?.());
	}
};

// Track real fullscreen state from the browser. Module-scope + guarded so the flag is
// correct as soon as anything imports it (no init call to forget); the guard keeps SSR /
// prerender inert, and the client re-evaluates the module and attaches for real.
if (typeof document !== 'undefined') {
	const sync = (): void => {
		stateFullscreen.active = readActive();
	};
	document.addEventListener('fullscreenchange', sync);
	document.addEventListener('webkitfullscreenchange', sync);
}
