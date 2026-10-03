import {
	applyOverlayEvent,
	emptyOverlayState,
	type OverlayDropCell,
	type SymbolState,
} from 'engine-game';

import type { FlightSymbol } from './flights.svelte';

/**
 * The tokens on the base board (`docs/design/pots-overlay.md` §3.4) — what the overlay layer draws.
 * Written only from the book: by {@link recordOverlayEvent} at the play seam, and, under per-reel
 * timing, by {@link showReelTokens} as a reel stops (its board's drop, read ahead). A game whose RGS
 * never drops one keeps the empty picture forever.
 *
 * The record IS the timing: an event is recorded the moment its beat starts. So a drop's tokens
 * appear when `overlayDrop` plays (after the board has stopped), and a fill's tokens are lifted as
 * its `meterUpdate` beat starts — into {@link stateOverlayLeaving}, where each stays until its own
 * flight leaves.
 */
export const stateOverlay = $state(emptyOverlayState());

/**
 * Tokens a pot's fill has lifted whose flight has not left yet. Each stays drawn at rest in its cell
 * until {@link liftToken} takes it off as its own flight starts (the token is that flight's head), so
 * a staggered volley leaves no cell empty while it waits. Cleared by the next event recorded, so a
 * fill nothing flies (a flow that owns `meterUpdate` and presents it another way) leaves none behind.
 */
export const stateOverlayLeaving = $state({ tokens: [] as OverlayDropCell[] });

const samePlace = (a: OverlayDropCell) => (b: OverlayDropCell) =>
	a.reel === b.reel && a.row === b.row;

export const recordOverlayEvent = (event: { type: string }) => {
	const before = $state.snapshot(stateOverlay);
	const next = applyOverlayEvent(before, event);
	const lifted =
		event.type === 'meterUpdate'
			? before.tokens.filter((token) => !next.tokens.some(samePlace(token)))
			: [];
	if (lifted.length || stateOverlayLeaving.tokens.length) stateOverlayLeaving.tokens = lifted;
	// A new board: what its reels showed of the last one is history (the reveal arms its own after).
	if (event.type === 'reveal' || event.type === 'tumbleBoard') forgetReelTokens();
	if (next === before) return;
	// A drop's tokens mount already landing, so no frame shows them at rest first; the beat (or, with
	// a flow owning the drop, the token's own completion) settles them. A token its reel already
	// showed (per-reel timing) keeps the landing it started then.
	if (event.type === 'overlayDrop') {
		reelDrop = [];
		for (const { reel, row } of next.tokens) {
			const key = overlayTokenKey(reel, row);
			if (shownWithReel[key]) continue;
			stateOverlayTokens.state[key] = 'coinLand';
			delete completedEarly[key];
		}
	}
	stateOverlay.tokens = next.tokens;
};

/** The drop the reels are about to show reel by reel (per-reel timing), until each reel stops. Never
 *  read reactively. */
let reelDrop: OverlayDropCell[] = [];
/** Tokens a reel showed as it stopped, ahead of their drop. Never read reactively. */
const shownWithReel: Record<string, true> = {};

const forgetReelTokens = () => {
	reelDrop = [];
	for (const key of Object.keys(shownWithReel)) delete shownWithReel[key];
};

/**
 * PER-REEL TIMING (`potsOverlay.timing: 'perReel'`): the board about to roll will drop `cells` (its
 * `overlayDrop`, read ahead in the book — `boardDropCells`), so each reel shows its own as it stops
 * ({@link showReelTokens}). The drop then finds them down already; any a reel did not show (a board
 * that swaps in place has no reel stop) appear with it, as they do after the stop.
 */
export const armReelTokens = (cells: readonly OverlayDropCell[]) => {
	forgetReelTokens();
	reelDrop = cells.map((cell) => ({ ...cell }));
};

/** A reel stopped: its tokens of the armed drop go down, landing. Returns the tokens shown. */
export const showReelTokens = (reel: number): OverlayDropCell[] => {
	const cells = reelDrop.filter((cell) => cell.reel === reel);
	if (!cells.length) return cells;
	reelDrop = reelDrop.filter((cell) => cell.reel !== reel);
	const leaving = stateOverlayLeaving.tokens.filter((token) => !cells.some(samePlace(token)));
	if (leaving.length !== stateOverlayLeaving.tokens.length) stateOverlayLeaving.tokens = leaving;
	for (const { reel: r, row } of cells) {
		const key = overlayTokenKey(r, row);
		shownWithReel[key] = true;
		stateOverlayTokens.state[key] = 'coinLand';
		delete completedEarly[key];
	}
	stateOverlay.tokens = [
		...stateOverlay.tokens.filter((token) => !cells.some(samePlace(token))),
		...cells,
	];
	return cells;
};

/** The token's reel already showed it — its land beat and sound have played. */
export const shownWithItsReel = (key: string): boolean => !!shownWithReel[key];

/** A new round starts: last round's tokens leave as the reels start rolling, not when the next board
 *  is recorded (they would sit over the spinning reels until then). */
export const clearOverlay = () => {
	if (stateOverlay.tokens.length) stateOverlay.tokens = [];
	if (stateOverlayLeaving.tokens.length) stateOverlayLeaving.tokens = [];
	stateOverlayTokens.state = {};
	for (const key of Object.keys(completedEarly)) delete completedEarly[key];
	forgetReelTokens();
};

/** A token's place, the key its layer and its beat share. */
export const overlayTokenKey = (reel: number, row: number) => `${reel}:${row}`;

/** The token a fill lifted off `{reel, row}` for pot `pot`, still in its cell. */
export const leavingToken = (reel: number, row: number, pot: string) =>
	stateOverlayLeaving.tokens.find(
		(token) => token.reel === reel && token.row === row && token.pot === pot,
	);

/** Take a lifted token off its cell — its flight has left, carrying it as its head. */
export const liftToken = (token: OverlayDropCell) => {
	const remaining = stateOverlayLeaving.tokens.filter(
		(t) => !(samePlace(token)(t) && t.pot === token.pot),
	);
	if (remaining.length !== stateOverlayLeaving.tokens.length)
		stateOverlayLeaving.tokens = remaining;
};

/** The symbol a token draws: its name, and a value coin's value or jackpot. */
export const overlayTokenSymbol = (token: OverlayDropCell): FlightSymbol => ({
	name: token.token,
	...(token.jackpot !== undefined ? { jackpot: token.jackpot } : {}),
	...(token.value !== undefined ? { value: token.value } : {}),
});

/** A token at rest — the state it settles to once its land beat has played. */
export const TOKEN_REST: SymbolState = 'coinIdle';

/** The state each token plays, by {@link overlayTokenKey}; absent ⇒ {@link TOKEN_REST}. */
export const stateOverlayTokens = $state({ state: {} as Record<string, SymbolState> });

/** Pending beats of tokens, resolved by the token's `oncomplete`. Never read reactively. */
const tokenBeats: Record<string, () => void> = {};
/** Tokens that completed before their beat was armed — a static token can report on mount. Never
 *  read reactively. */
const completedEarly: Record<string, true> = {};

/** Arm a token's beat: its next completion resolves `resolve` — at once if it already reported. */
export const armTokenBeat = (key: string, resolve: () => void) => {
	if (completedEarly[key]) {
		delete completedEarly[key];
		resolve();
		return;
	}
	tokenBeats[key] = resolve;
};

/** A token reported its animation complete: it settles to rest, and its beat resolves. */
export const completeTokenBeat = (key: string) => {
	delete stateOverlayTokens.state[key];
	const resolve = tokenBeats[key];
	delete tokenBeats[key];
	if (resolve) resolve();
	else completedEarly[key] = true;
};
