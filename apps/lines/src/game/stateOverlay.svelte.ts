import { applyOverlayEvent, emptyOverlayState, type SymbolState } from 'engine-game';

/**
 * The tokens on the base board (`docs/design/pots-overlay.md` §3.4) — what the overlay layer draws.
 * Written ONLY by {@link recordOverlayEvent}, from the book, at the play seam; a game whose RGS
 * never drops one keeps the empty picture forever.
 *
 * The record IS the timing: an event is recorded the moment its beat starts. So a drop's tokens
 * appear when `overlayDrop` plays (after the board has stopped), and a fill's tokens leave their
 * cells as its `meterUpdate` beat sends them flying.
 */
export const stateOverlay = $state(emptyOverlayState());

export const recordOverlayEvent = (event: { type: string }) => {
	const before = $state.snapshot(stateOverlay);
	const next = applyOverlayEvent(before, event);
	if (next !== before) stateOverlay.tokens = next.tokens;
};

/** A token's place, the key its layer and its beat share. */
export const overlayTokenKey = (reel: number, row: number) => `${reel}:${row}`;

/** A token at rest — the state it settles to once its land beat has played. */
export const TOKEN_REST: SymbolState = 'coinIdle';

/** The state each token plays, by {@link overlayTokenKey}; absent ⇒ {@link TOKEN_REST}. */
export const stateOverlayTokens = $state({ state: {} as Record<string, SymbolState> });

/** Pending beats of tokens, resolved by the token's `oncomplete`. Never read reactively. */
const tokenBeats: Record<string, () => void> = {};

/** Arm a token's beat: the next completion it reports resolves `resolve`. */
export const armTokenBeat = (key: string, resolve: () => void) => {
	tokenBeats[key] = resolve;
};

/** A token reported its animation complete: it settles to rest, and its beat resolves. */
export const completeTokenBeat = (key: string) => {
	delete stateOverlayTokens.state[key];
	const resolve = tokenBeats[key];
	delete tokenBeats[key];
	resolve?.();
};
