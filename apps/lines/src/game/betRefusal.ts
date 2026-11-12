import { UI_TEXT } from 'engine-layout';
import {
	refuseBetMode,
	showMessage,
	stateBet,
	stateBetDerived,
	stateI18nDerived,
} from 'state-shared';

/**
 * The Play4Fun code for a bet the server will not take. It is the same code as a malformed bet, so
 * it reads as "this option is switched off" only for a mode the game marked `refusable`: an operator
 * may turn such an ante or buy off, and says so only by refusing it.
 */
const REFUSED_STATUS = 'ERR_110';

const statusCodeOf = (error: unknown): string | undefined => {
	if (typeof error !== 'object' || error === null) return undefined;
	const status = (error as { status?: { statusCode?: unknown } }).status;
	return typeof status?.statusCode === 'string' ? status.statusCode : undefined;
};

/**
 * A refused `refusable` ante or buy: drop that option from the menu for the session (its card or
 * switch goes with it), fall back to the stake it replaced (BASE, or the ante switch under a buy), and tell the player in a toast rather than the
 * error modal. Nothing was charged and no round began, so the game is simply idle again. Anything
 * else — a mode not marked `refusable`, a refused BASE bet — goes to the error modal as before.
 */
export const handleBetOptionRefused = (error: unknown): boolean => {
	if (statusCodeOf(error) !== REFUSED_STATUS) return false;
	const mode = stateBetDerived.activeBetMode();
	if (!mode || mode.type === 'default' || !mode.refusable) return false;
	refuseBetMode(mode.mode);
	// A refused buy hands back the stake it replaced (the ante stays on); a refused ante is BASE.
	if (mode.type === 'buy') stateBetDerived.endBuy();
	else stateBet.activeBetModeKey = 'BASE';
	stateBet.pendingRoundIsBuy = false;
	showMessage(stateI18nDerived.translate(UI_TEXT.betOptionUnavailable), {
		kind: 'warn',
		durationMs: 4000,
	});
	return true;
};
