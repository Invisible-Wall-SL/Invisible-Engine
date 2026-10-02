import type { HoldAndWinMeterLevel } from './holdAndWin';
import { modeEntryMeters, modeOpOf } from './modeEvents';
import type { Position, SymbolName } from './types';

/**
 * THE POTS OVERLAY BOOK-EVENT CONTRACT — design §3.2 of `docs/design/pots-overlay.md`. The pots
 * themselves reuse the Hold and Win meter events (`meterUpdate`, `meterLevels`, in `holdAndWin.ts`);
 * this adds the one thing a host game has no event for: a token dropped ON TOP of a cell, over
 * whatever symbol the host dealt there. The facade builds it from our wire
 * (`docs/reference/hold-and-win-wire.md` "Pots overlay"); nothing here knows that wire.
 *
 * Units as in `holdAndWin.ts`: a position is the VISIBLE 0-based `{reel, row}` (no padding row), and
 * a value coin's `value` is × the base total bet.
 */

/** One dropped token. `pot` names the pot it fills; a value coin carries `value` or `jackpot`
 *  instead and fills no pot. The symbol under it is untouched — the token is drawn over it. */
export type OverlayDropCell = Position & {
	token: SymbolName;
	pot?: string;
	value?: number;
	jackpot?: string;
};

/** Every pots-overlay book event's fields, keyed by type (the `HoldAndWinEventFields` pattern). */
export type PotsOverlayEventFields = {
	/** Tokens appear on these cells. After the board's `reveal`, before its wins. */
	overlayDrop: { cells: OverlayDropCell[] };
};

/**
 * Why a mode was entered and which full pots started it — the optional fields every mode entry
 * (`modeEnter`, `freeSpinTrigger`, `holdAndWinTrigger`) may carry. `cause: 'meter'` with the pots in
 * `meters` is a full pot starting its bonus; the mode layer keeps `cause` on the entry and `meters`
 * in its payload ({@link modeEntryMeters}).
 */
export type ModeEntryCause = { cause?: string; meters?: string[] };

/**
 * The client's picture of the tokens on the base board — what the overlay layer draws. Written ONLY
 * at the play seam, from the book (`applyOverlayEvent`); the server stays the source of truth, so
 * nothing here deals or computes a token.
 */
export type OverlayState = { tokens: OverlayDropCell[] };

export const emptyOverlayState = (): OverlayState => ({ tokens: [] });

type LooseEvent = { type: string } & Record<string, unknown>;

const samePosition = (a: Position) => (b: Position) => a.reel === b.reel && a.row === b.row;

/**
 * What one book event does to the token picture — state only, no presentation:
 * - a base board's `reveal` clears it: a new board drops its own tokens, and a token that did not
 *   fly (a value coin below the trigger count) is gone by the next spin;
 * - `overlayDrop` puts its tokens down;
 * - `meterUpdate` lifts the tokens that filled the pot (its `from` cells) — they fly to it;
 * - `holdAndWinTrigger` clears it: the dropped coins are held on the respin board now, and the base
 *   board comes back with the host's own symbols when the feature ends.
 * Every other event leaves it as it is.
 */
export const applyOverlayEvent = (
	state: OverlayState,
	bookEvent: { type: string },
): OverlayState => {
	const event = bookEvent as LooseEvent;
	switch (event.type) {
		case 'reveal':
		case 'holdAndWinTrigger':
			return state.tokens.length ? emptyOverlayState() : state;
		case 'overlayDrop':
			return {
				tokens: ((event.cells as OverlayDropCell[] | undefined) ?? []).map((c) => ({ ...c })),
			};
		case 'meterUpdate': {
			const from = (event.from as Position[] | undefined) ?? [];
			const lifted = (token: OverlayDropCell) =>
				token.pot === event.meter && from.some(samePosition(token));
			return state.tokens.some(lifted)
				? { tokens: state.tokens.filter((token) => !lifted(token)) }
				: state;
		}
		default:
			return state;
	}
};

/**
 * The full pots a mode entry DRAINS: any entry with `cause: 'meter'` (a pot started it) names them,
 * and the server emptied them as it started the mode. `holdAndWinTrigger` is left out: the Hold and
 * Win reducer already empties its pots (`applyHoldAndWinEvent`). `[]` for every other event.
 */
export const drainedMeters = (bookEvent: { type: string }): string[] => {
	if (bookEvent.type === 'holdAndWinTrigger') return [];
	const op = modeOpOf(bookEvent);
	return op?.op === 'enter' && op.cause === 'meter' ? modeEntryMeters(op) : [];
};

/** The meters with `ids` emptied — what the pots read once their bonus has started. */
export const drainMeters = (
	meters: HoldAndWinMeterLevel[],
	ids: readonly string[],
): HoldAndWinMeterLevel[] =>
	ids.length
		? meters.map((meter) => (ids.includes(meter.id) ? { ...meter, level: 0 } : meter))
		: meters;
