import { UI_TEXT } from 'engine-layout';
import { stateI18nDerived } from 'state-shared';

/**
 * The coded captions this package's menus/modals render — see the `components-ui-pixi` twin: every
 * literal comes from the SHARED `UI_TEXT` registry so `/localization` can harvest them.
 */
export const i18nDerived = {
	bet: () => stateI18nDerived.translate(UI_TEXT.bet),
	max: () => stateI18nDerived.translate(UI_TEXT.max),
	betMenu: () => stateI18nDerived.translate(UI_TEXT.betMenu),
	selectYourBet: () => stateI18nDerived.translate(UI_TEXT.selectYourBet),
	confirm: () => stateI18nDerived.translate(UI_TEXT.confirm),
	cancel: () => stateI18nDerived.translate(UI_TEXT.cancel),
	masterVolume: () => stateI18nDerived.translate(UI_TEXT.masterVolume),
	musicVolume: () => stateI18nDerived.translate(UI_TEXT.musicVolume),
	soundEffectVolume: () => stateI18nDerived.translate(UI_TEXT.soundEffectVolume),
	autoSpins: () => stateI18nDerived.translate(UI_TEXT.autoSpins),
	numberOfRounds: () => stateI18nDerived.translate(UI_TEXT.numberOfRounds),
	advanced: () => stateI18nDerived.translate(UI_TEXT.advanced),
	singleWinLimit: () => stateI18nDerived.translate(UI_TEXT.singleWinLimit),
	lossLimit: () => stateI18nDerived.translate(UI_TEXT.lossLimit),
	startAutoplay: () => stateI18nDerived.translate(UI_TEXT.startAutoplay),
	notification: () => stateI18nDerived.translate(UI_TEXT.notification),
	autoSpinsStopInfo: () => stateI18nDerived.translate(UI_TEXT.autoSpinsStopInfo),
	insufficientFunds: () => stateI18nDerived.translate(UI_TEXT.insufficientFunds),
	lossLimitReached: () => stateI18nDerived.translate(UI_TEXT.lossLimitReached),
	singleWinLimitReached: () => stateI18nDerived.translate(UI_TEXT.singleWinLimitReached),
	settings: () => stateI18nDerived.translate(UI_TEXT.settings),
};
