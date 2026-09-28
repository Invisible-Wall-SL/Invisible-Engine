import { stateBetDerived } from './stateBet.svelte';
import { lockUiFeatures } from './stateUi.svelte';

const JURISDICTION_DEFAULT = {
	socialCasino: false,
	disabledFullscreen: false,
	disabledTurbo: false,
	disabledSuperTurbo: false,
	disabledAutoplay: false,
	disabledSlamstop: false,
	disabledSpacebar: false,
	disabledBuyFeature: false,
	displayNetPosition: false,
	displayRTP: false,
	displaySessionTimer: false,
	minimumRoundDuration: 0,
};

export type Jurisdiction = typeof JURISDICTION_DEFAULT;

export const stateConfig = $state({
	jurisdiction: { ...JURISDICTION_DEFAULT },
	betAmountOptions: [1, 5, 25, 50, 75, 100, 200, 500, 800, 1000],
	betMenuOptions: [1, 5, 25, 50, 75, 100, 200, 500, 800, 1000],
});

/**
 * Adopt the jurisdiction the RGS answered `authenticate` with.
 *
 * Merged onto the defaults rather than assigned, because an RGS that omits the block — or a key of
 * it — must not leave `stateConfig.jurisdiction` undefined under every reader. And the speed
 * features the licence forbids are LOCKED off here rather than merely hidden, so a game's own
 * authored settings, which load after this, cannot switch them back on.
 */
export const setJurisdiction = (jurisdiction: Partial<Jurisdiction> | undefined) => {
	stateConfig.jurisdiction = { ...JURISDICTION_DEFAULT, ...jurisdiction };
	lockUiFeatures({
		turbo: stateConfig.jurisdiction.disabledTurbo,
		// Holding Space to bet continuously IS autoplay without the menu, so a licence that forbids
		// one forbids both — the same pairing `UI_FEATURES_UK` makes.
		autoplay: stateConfig.jurisdiction.disabledAutoplay,
		spaceHold: stateConfig.jurisdiction.disabledAutoplay,
	});
	stateBetDerived.forbidTurbo(stateConfig.jurisdiction.disabledTurbo);
};
