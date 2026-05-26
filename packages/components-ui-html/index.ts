import Modals from './src/components/Modals.svelte';
import MessageToast from './src/components/MessageToast.svelte';
import GameVersion from './src/components/GameVersion.svelte';
import GlobalStyle from './src/components/GlobalStyle.svelte';

import messagesMap from './src/i18n/messagesMap';
import { i18nDerived } from './src/i18n/i18nDerived';

export * from './src/types';

export { messagesMap, i18nDerived, Modals, MessageToast, GameVersion, GlobalStyle };
