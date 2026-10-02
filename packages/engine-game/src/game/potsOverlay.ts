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
