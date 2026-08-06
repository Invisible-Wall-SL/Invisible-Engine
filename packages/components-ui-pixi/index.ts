import UI from './src/components/UI.svelte';
import UiGameName from './src/components/UiGameName.svelte';
import HudGameName from './src/components/HudGameName.svelte';
import HudLogo from './src/components/HudLogo.svelte';
import InfoOverlay from './src/components/InfoOverlay.svelte';
import HudReadout from './src/components/HudReadout.svelte';
import HudTicker from './src/components/HudTicker.svelte';
import HudCaption from './src/components/HudCaption.svelte';
import HudValue from './src/components/HudValue.svelte';
import ButtonFrame from './src/components/ButtonFrame.svelte';
import ButtonLabel from './src/components/ButtonLabel.svelte';
import LoadingBar from './src/components/LoadingBar.svelte';

import messagesMap from './src/i18n/messagesMap';
import { i18nDerived } from './src/i18n/i18nDerived';

export * from './src/types';

export {
	messagesMap,
	i18nDerived,
	UI,
	UiGameName,
	HudGameName,
	HudLogo,
	InfoOverlay,
	HudReadout,
	HudTicker,
	HudCaption,
	HudValue,
	ButtonFrame,
	ButtonLabel,
	LoadingBar,
};
