/**
 * The RGS transport's connection state, as the game's HTML chrome sees it.
 *
 * The transport and the overlay live in packages that must not depend on each other (the
 * transport is a leaf the game aliases in at build time), so they meet on the page instead: the
 * latest state on a window global — read on mount, since a retry can start before any UI exists —
 * plus a window event on every change. This file is dependency-free so either side can import it.
 */

export const RGS_CONNECTION_EVENT = 'ie-rgs-connection';
export const RGS_CONNECTION_GLOBAL = '__IE_RGS_CONNECTION__';

export type RgsConnectionStatus = 'connected' | 'reconnecting' | 'failed';

export type RgsConnectionState = {
	state: RgsConnectionStatus;
	/** 1-based retry number while `reconnecting`. */
	attempt?: number;
	/** Diagnostic only — never shown to the player. */
	reason?: string;
};

declare global {
	interface Window {
		[RGS_CONNECTION_GLOBAL]?: RgsConnectionState;
	}
}

const CONNECTED: RgsConnectionState = { state: 'connected' };

export function publishRgsConnection(state: RgsConnectionState): void {
	if (typeof window === 'undefined') return;
	window[RGS_CONNECTION_GLOBAL] = state;
	window.dispatchEvent(new CustomEvent(RGS_CONNECTION_EVENT, { detail: state }));
}

/** The latest published state; an unset global means nothing has gone wrong. */
export function readRgsConnection(): RgsConnectionState {
	if (typeof window === 'undefined') return CONNECTED;
	return window[RGS_CONNECTION_GLOBAL] ?? CONNECTED;
}

/** Calls `listener` on every published change; returns the unsubscribe. */
export function onRgsConnection(listener: (state: RgsConnectionState) => void): () => void {
	if (typeof window === 'undefined') return () => {};
	const handler = (event: Event) =>
		listener((event as CustomEvent<RgsConnectionState>).detail ?? CONNECTED);
	window.addEventListener(RGS_CONNECTION_EVENT, handler);
	return () => window.removeEventListener(RGS_CONNECTION_EVENT, handler);
}
