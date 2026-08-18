import { UI_TEXT } from 'engine-layout';
import { stateI18nDerived, stateUrlDerived } from 'state-shared';

/**
 * The coded captions this package's HUD renders. Every literal comes from the SHARED `UI_TEXT`
 * registry (`engine-layout/uiText.ts`) so `/localization` harvests exactly the strings the game
 * renders — a literal typed here instead would be invisible to the tool and untranslatable.
 */
export const i18nDerived = {
	audio: () => stateI18nDerived.translate(UI_TEXT.audio),
	balance: () => stateI18nDerived.translate(UI_TEXT.balance),
	win: () => stateI18nDerived.translate(UI_TEXT.win),
	// Social builds relabel the spin control; translated too, so the alternate wording localizes
	// instead of being the one caption stuck in English.
	bet: () => stateI18nDerived.translate(stateUrlDerived.social() ? UI_TEXT.spin : UI_TEXT.bet),
	stop: () => stateI18nDerived.translate(UI_TEXT.stop),
	buyBonus: () =>
		stateI18nDerived.translate(stateUrlDerived.social() ? UI_TEXT.playBonus : UI_TEXT.buyBonus),
	disable: () => stateI18nDerived.translate(UI_TEXT.disable),
	freeSpins: () => stateI18nDerived.translate(UI_TEXT.freeSpins),
	//
	decrease: () => stateI18nDerived.translate('-'),
	increase: () => stateI18nDerived.translate('+'),
	menu: () => stateI18nDerived.translate(UI_TEXT.menu),
	turbo: () => stateI18nDerived.translate(UI_TEXT.turbo),
	autoSpin: () => stateI18nDerived.translate(UI_TEXT.autoSpin),
	payTable: () => stateI18nDerived.translate(UI_TEXT.payTable),
	info: () => stateI18nDerived.translate(UI_TEXT.info),
	settings: () => stateI18nDerived.translate(UI_TEXT.settings),
	soundOn: () => stateI18nDerived.translate(UI_TEXT.soundOn),
	soundOff: () => stateI18nDerived.translate(UI_TEXT.soundOff),
	menuExit: () => stateI18nDerived.translate(UI_TEXT.menuExit),
};
