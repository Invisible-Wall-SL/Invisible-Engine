/**
 * THE BETWEEN-SPINS HOLD — after a big win inside a free-spin feature, park the round on its
 * winning board until the player presses SPIN.
 *
 * A bonus book is ONE round: every free spin is a run of book events inside it, played back to
 * back. So dismissing the big-win cinematic on free spin 4 handed straight over to spin 5's
 * `reveal` and the reels rolled on their own, wiping a board the player had not yet read (owner
 * report 2026-08-17: "the reel start spinning automatically … it would be nice to still see the
 * winning lines playing, and to click spinning to start the reel again").
 *
 * So this holds the book at exactly that seam. The dismissed overlay uncovers the board, the
 * resting win-symbol replay starts on it — the SAME cycle the base game already runs between
 * rounds (`winSymbolCycle.ts`), so the paying lines narrate on a loop — and the next spin waits
 * for a press. The press then clears the presentation and the book resumes, exactly as a base-game
 * spin does.
 *
 * WHY THE BUTTON, not a tap surface. Mid-round the spin button is a live STOP, and a press there
 * SLAMS. The hold re-purposes it instead of laying another full-screen press over the board:
 * `stateUi.spinHoldActive` makes `utils-shared/spinStop` read the button as a live SPIN whose press
 * releases the hold (no bet — the book is paid for — and no slam). One button, one meaning, and the
 * Space hotkey / flow `spin` action / invoked intent inherit it for free.
 *
 * WHERE IT RUNS. At the `playBookEvents` seam in `utils.ts`, AFTER the event's whole presentation
 * has been awaited, on both dispatch branches — so it behaves the same whether the big win was
 * presented by the coded handler, a v1 flow or a v2-authored `bigWin` container.
 *
 * OFF BY DEFAULT (`winCycle.holdAfterBigWin`, Invisible Symbols State Machine): an un-authored
 * project keeps today's uninterrupted feature, byte-identical.
 */

import { armSpinHold, cancelSpinHold, stateBetDerived } from 'state-shared';

import { bakedWinCycleConfig } from '../editor-scenes';
import { activeWinLevelIsBig } from './gameConfig';
import { startWinCycle, clearWinPresentation } from './winSymbolCycle';
import type { BookEvent } from './typesBookEvent';

/**
 * Is `bookEvent` a big win with ANOTHER spin still to come in this book?
 *
 * "Another spin to come" is read from the book itself — a later `reveal` — rather than from
 * `gameType`, because that is the actual condition: a hold is only meaningful when something would
 * otherwise start rolling on its own. It scopes the feature to free spins by construction (a base
 * game round holds exactly one `reveal`, so it never matches) and needs no per-template symbol,
 * which also makes it correct through a retrigger — the extra spins are simply more reveals.
 *
 * The LAST free spin's big win is deliberately excluded: what follows it is `freeSpinEnd`, the
 * outro celebration, which already gates on its own press.
 */
const holdsAfter = (bookEvent: BookEvent, bookEvents: BookEvent[]): boolean => {
	if (bookEvent.type !== 'setWin') return false;
	if (!activeWinLevelIsBig(bookEvent.winLevel)) return false;
	const index = bookEvents.indexOf(bookEvent);
	if (index < 0) return false;
	return bookEvents.slice(index + 1).some((event) => event.type === 'reveal');
};

/**
 * Hold the book after a big win mid-feature, replaying the spin's wins until the player presses
 * SPIN. A no-op — not even a microtask of delay — for every other event, so the hot path of a
 * normal book is untouched.
 *
 * Skipped while the game is betting continuously (autoplay / space-hold): the player has explicitly
 * asked for hands-off play, and a hold there would stall the sequence on a press that is never
 * coming. That is the same guard `startWinCycle` applies to the resting replay, for the same reason.
 */
export const holdAfterBigWin = async (
	bookEvent: BookEvent,
	bookEvents: BookEvent[],
): Promise<void> => {
	if (!bakedWinCycleConfig().holdAfterBigWin) return;
	if (stateBetDerived.isContinuousBet()) return;
	if (!holdsAfter(bookEvent, bookEvents)) return;

	// The round's own wins are already recorded (`recordWinCycleWins` ran on this spin's `winInfo`),
	// so the replay narrates THIS spin. Not awaited — it loops until stopped. Obeys its own
	// `winCycle.enabled` switch: with the replay off the hold still holds, on a static board.
	void startWinCycle();
	try {
		await new Promise<void>((resolve) => armSpinHold(resolve));
	} finally {
		// The press IS the start of the next spin, so end the previous one's presentation on it —
		// the replay is stopped and the line, stamped amount, toast and win-dim all clear in one
		// beat, exactly as `onNewGameStart` does for a base-game spin.
		clearWinPresentation();
	}
};

/** Drop a hold left standing when a round ends early (a handler threw, the game tore down). Without
 *  it a stranded `spinHoldActive` would leave the button reading SPIN with no book to resume. */
export const clearSpinHold = (): void => cancelSpinHold();
