import { stateBet, stateBetDerived, stateUi } from 'state-shared';

/**
 * HOLD TO SPIN — continuous play while the player holds Space or the spin button. ONE hold shared by
 * every input: each binding (the Space key, every spin button on screen) is a `holder`, and the hold
 * is on while any holder holds it. `stateBet.isSpaceHold` is the flag the round chain reads
 * (`checkSpaceHold` starts the next round, `isContinuousBet`), whichever input set it.
 *
 * While held, turbo is forced on (persistent) and the player's OWN turbo comes back when the last
 * holder lets go, rather than switching turbo off.
 */

/** How long a press must last to become a hold. Shared by the Space key and the button press. */
export const HOLD_TO_SPIN_MS = 400;

const holders = new Set<symbol>();
let turboBeforeHold = false;

/** Whether hold-to-spin is offered at all: the game's `spaceHold` feature, which a `disabledAutoplay`
 *  jurisdiction (and the doc's Game Settings) turn off. */
export const isHoldToSpinEnabled = (): boolean => stateUi.config.features.spaceHold;

/** `holder` starts (or re-asserts) holding. True when this call STARTED the hold. */
export const startSpinHold = (holder: symbol): boolean => {
	const starting = holders.size === 0;
	if (starting) turboBeforeHold = stateBetDerived.isTurboPersistent();
	holders.add(holder);
	stateBet.autoSpinsCounter = 0;
	stateBet.isSpaceHold = true;
	stateBetDerived.updateIsTurbo(true, { persistent: true });
	return starting;
};

/** `holder` lets go. The hold ends — and the player's turbo is restored — with the last holder. */
export const endSpinHold = (holder: symbol): void => {
	if (!holders.delete(holder) || holders.size) return;
	stateBet.isSpaceHold = false;
	stateBetDerived.updateIsTurbo(turboBeforeHold, { persistent: true });
};

// Whether this game offers hold-to-spin on its spin BUTTON (Space always has it). Installed by the
// game from its authored settings; read at each press. Off until a game turns it on.
let readSpinButtonHold = (): boolean => false;

/** The game says whether holding its spin button keeps spinning (a per-project setting). */
export const setSpinButtonHoldSource = (read: () => boolean): void => {
	readSpinButtonHold = read;
};

/**
 * A spin BUTTON's hold (the `PressHold` shape `pixi-svelte`'s `createPressHold` takes): a press held
 * past `HOLD_TO_SPIN_MS` joins the hold as its own holder, then fires the button's own press — the
 * bet, or the slam of a round already rolling — exactly as Space does on its key-down.
 */
export const spinButtonHold = {
	holdMs: HOLD_TO_SPIN_MS,
	enabled: () => readSpinButtonHold() && isHoldToSpinEnabled(),
	start: (owner: symbol) => {
		startSpinHold(owner);
	},
	end: endSpinHold,
};
