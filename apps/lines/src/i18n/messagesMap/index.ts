import { mergeMessagesMaps, type MessagesMap } from 'utils-shared/i18n';
import { messagesMap as messagesMapUiPixi } from 'components-ui-pixi';
import { messagesMap as messagesMapUiHtml } from 'components-ui-html';

import { bakedLocalizationMessagesMap } from '../../editor-scenes';
import en from './en';
import zh from './zh';

const messagesMapGame = {
	en,
	zh,
};

/**
 * The game's merged Lingui catalog.
 *
 * MUST stay a function — merging at module scope is a bug, not a style choice.
 * `bakedLocalizationMessagesMap()` returns the LIVE runtime bundle's strings once one has
 * been fetched, and that fetch is `prepareRuntimeBundle()` in `+layout.ts`'s `load()`,
 * which SvelteKit runs AFTER it has imported the route's modules. A module-level
 * `const messagesMap = mergeMessagesMaps([…, bakedLocalizationMessagesMap()])` therefore
 * always snapshotted the EMPTY baked map, so a project's authored translations were
 * fetched over the wire and then silently dropped: the game localised its numbers (Lingui
 * still gets the right locale) while every string stayed in the source language, in every
 * locale, with no error anywhere.
 *
 * Both callers (`routes/+layout.svelte` → `<LoadI18n>`, `components/Game.svelte` →
 * `registerEditorTextLocalization`) run after `load()` has resolved, so they see the
 * runtime bundle. Deliberately NOT memoised: a cache would re-introduce exactly this
 * class of bug the moment something calls it early.
 *
 * Baked strings merge LAST so a project's reviewed strings override the code catalogs on
 * key clash (empty when un-baked and un-live — parity).
 */
export const getMessagesMap = (): MessagesMap =>
	mergeMessagesMaps([
		messagesMapGame,
		messagesMapUiPixi,
		messagesMapUiHtml,
		bakedLocalizationMessagesMap(),
	]);
