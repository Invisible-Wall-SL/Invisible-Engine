import Modals from './src/components/Modals.svelte';
import BuyBonusConfirm from './src/components/BuyBonusConfirm.svelte';
import MessageToast from './src/components/MessageToast.svelte';
import GameVersion from './src/components/GameVersion.svelte';
import GlobalStyle from './src/components/GlobalStyle.svelte';
import DebugMenu from './src/components/DebugMenu.svelte';

import messagesMap from './src/i18n/messagesMap';
import { i18nDerived } from './src/i18n/i18nDerived';

export * from './src/types';
export { registerBuyFeature } from './src/registerBuyFeature.svelte';
export { stateBonus, stateBonusDerived } from './src/stateBonus.svelte';

export {
	messagesMap,
	i18nDerived,
	Modals,
	BuyBonusConfirm,
	MessageToast,
	GameVersion,
	GlobalStyle,
	DebugMenu,
};
