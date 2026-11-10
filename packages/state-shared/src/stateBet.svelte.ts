import type { BaseBet } from 'rgs-requests';
import { stateMeta, stateMetaDerived } from './stateMeta.svelte';

export type Currency = string;
export type BetToResume = BaseBet | null;
export type BetModeKey = string;

export const stateBet = $state({
	currency: 'USD' as Currency,
	balanceAmount: 0,
	betAmount: 1,
	wageredBetAmount: 1,
	betToResume: null as BetToResume,
	activeBetModeKey: 'BASE' as BetModeKey,
	// Captured at bet-submit time: was the in-flight round bought via a `buy`-type
	// mode? A bought bonus is one-shot — this drives the reset back to BASE at round
	// end, independent of whether the live betModeMeta lookup still resolves to 'buy'.
	pendingRoundIsBuy: false,
	// The stake a buy replaced when the player bought it, so the bought round can hand it back
	// (`endBuy`). Null when no buy is armed, and for a buy the client did not arm (a resumed round).
	stakeBeforeBuy: null as BetModeKey | null,
	winBookEventAmount: 0,
	autoSpinsLoss: 0,
	autoSpinsCounter: 0,
	autoSpinsLossLimitAmount: Infinity,
	autoSpinsSingleWinLimitAmount: Infinity,
	// Hold-to-spin is on — Space OR a held spin button (owned by `utils-shared/spinHold`).
	isSpaceHold: false,
	isTurbo: false,
});

const correctBetAmount = (value: number) => {
	if (value <= 0) return 0;
	const costMultiplier = betCostMultiplier();
	if (costMultiplier === 0) return 0;
	const max = stateBet.balanceAmount / costMultiplier;
	if (value >= max) return max;
	return value;
};

const setBetAmount = (value: number) => {
	stateBet.betAmount = correctBetAmount(value);
};

const updateBetAmount = (update: (value: number) => number) => {
	stateBet.betAmount = correctBetAmount(update(stateBet.betAmount));
};

let isTurboLocked = false;
let isTurboForbidden = false;

const updateIsTurbo = (value: boolean, options: { persistent: boolean }) => {
	const { persistent } = options;

	if (value && isTurboForbidden) return;
	if (!persistent && isTurboLocked) return;
	if (persistent) isTurboLocked = value;

	stateBet.isTurbo = value;
};

/** The turbo last set persistently — the player's own choice, not a temporary slam speed-up. */
const isTurboPersistent = () => isTurboLocked;

/** A licence that forbids turbo forbids every route to it — the button is hidden by the feature
 *  flag, but holding Space and the flow's turbo action set it through {@link updateIsTurbo} too. */
const forbidTurbo = (forbidden: boolean) => {
	isTurboForbidden = forbidden;
	if (forbidden) stateBet.isTurbo = false;
};

const activeBetMode = () =>
	stateMeta.betModeMeta?.[stateBet.activeBetModeKey.toUpperCase()] ??
	stateMeta.betModeMeta?.[stateBet.activeBetModeKey.toLowerCase()] ??
	null;

/** Make the picked mode the stake. A `buy` first notes the stake it replaces, so its round can hand
 *  it back. */
const armBetMode = (key: BetModeKey) => {
	const picked = stateMeta.betModeMeta?.[key.toUpperCase()];
	if (picked?.type === 'buy' && activeBetMode()?.type !== 'buy') {
		stateBet.stakeBeforeBuy = stateBet.activeBetModeKey;
	}
	stateBet.activeBetModeKey = key;
};

/**
 * The stake a bought round hands back: the HUD's ante switch when it was on before the buy and the
 * session still offers it (an operator may have switched it off since), else BASE. An ante armed
 * from the buy MENU is not handed back — a buy replaces it, as it always has.
 */
const stakeAfterBuy = (): BetModeKey => {
	const ante = stateMetaDerived.anteToggleMode();
	const before = stateBet.stakeBeforeBuy?.toUpperCase();
	return ante && before === ante.mode ? ante.mode : 'BASE';
};

/** A buy is one-shot: once its round is over (or it never started), the stake returns. */
const endBuy = () => {
	stateBet.activeBetModeKey = stakeAfterBuy();
	stateBet.stakeBeforeBuy = null;
};

/** The HUD ante switch reads on while the ante is the stake, and through a buy bought over it. */
const isAnteArmed = (): boolean => {
	const ante = stateMetaDerived.anteToggleMode();
	if (!ante) return false;
	if (stateBet.activeBetModeKey.toUpperCase() === ante.mode) return true;
	return activeBetMode()?.type === 'buy' && stakeAfterBuy() === ante.mode;
};

const isContinuousBet = () => stateBet.autoSpinsCounter > 1 || stateBet.isSpaceHold;
const timeScale = () => (stateBet.isTurbo ? 2 : 1);
const betCostMultiplier = () =>
	stateBetDerived.activeBetMode().type === 'activate'
		? stateBetDerived.activeBetMode().costMultiplier
		: 1;
const betCost = () => stateBet.betAmount * betCostMultiplier();
const isBetCostAvailable = () => betCost() > 0 && betCost() <= stateBet.balanceAmount;
const hasAutoBetCounter = () => stateBet.autoSpinsCounter !== 0;

export const stateBetDerived = {
	setBetAmount,
	updateBetAmount,
	updateIsTurbo,
	isTurboPersistent,
	forbidTurbo,
	activeBetMode,
	armBetMode,
	stakeAfterBuy,
	endBuy,
	isAnteArmed,
	isContinuousBet,
	timeScale,
	betCost,
	isBetCostAvailable,
	hasAutoBetCounter,
};
