import { mergeMessagesMaps } from 'utils-shared/i18n';
import { messagesMap as messagesMapUiPixi } from 'components-ui-pixi';
import { messagesMap as messagesMapUiHtml } from 'components-ui-html';

import { bakedLocalizationMessagesMap } from '../../editor-scenes';
import en from './en';
import zh from './zh';

const messagesMapGame = {
	en,
	zh,
};

// Baked Localization-tool strings merge LAST so a project's reviewed strings
// override the code catalogs on key clash (empty when un-baked — parity).
const messagesMap = mergeMessagesMaps([
	messagesMapGame,
	messagesMapUiPixi,
	messagesMapUiHtml,
	bakedLocalizationMessagesMap(),
]);

export default messagesMap;
