/**
 * Intent-invoking `command` actions → the game intent they invoke (Phase A). When the flow reacts to
 * a `spin`/`buyBonus` button EVENT and runs one of these actions, the env routes it to the game's
 * `invokeIntent` bridge (the SAME coded body the button press runs) instead of the `flowEffect`
 * registry — so a flow-driven button is byte-identical to the coded one.
 *
 * Plain data, so a headless gate can hold every template vocabulary's actions to what the game backs
 * (this map + the `flowEffect` registry).
 */
export const INTENT_COMMANDS: Record<string, string> = {
	startSpin: 'spin',
	stopSpin: 'spin', // the spin button is bet-or-stop; the coded body decides by state.
	// NB: buy-bonus is NOT an intent command. The buy-BUTTON press routes through the `buyBonus`
	// intent event (which opens the select screen) via `routeActionThroughFlow`; the CONFIRM commit
	// is the `commitBuyBonus` flowEffect (arm the mode + fire the bet), not a host intent — so it
	// lives in the `flowEffect` registry, not here. (Replaces the old miswired `confirmBuyBonus`
	// command, which merely re-opened the modal.)
	// The standard HUD buttons — each routes to the game intent `invokeHostIntent` already bridges.
	increaseBet: 'increase',
	decreaseBet: 'decrease',
	toggleTurbo: 'turbo',
	toggleFullscreen: 'fullscreen',
	openPayTable: 'payTable',
	openGameRules: 'gameRules',
	openSettings: 'settings',
	toggleSound: 'soundToggle',
	autoSpin: 'autoSpin',
};
