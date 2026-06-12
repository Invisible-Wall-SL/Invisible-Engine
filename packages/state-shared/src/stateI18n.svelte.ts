import { i18n, type Messages } from '@lingui/core';
import { compileMessage } from '@lingui/message-utils/compileMessage';
import { type Language } from './stateUrl.svelte';

// We ship uncompiled catalogs (plain string maps merged from code + the
// Invisible Localization tool), so register a runtime message compiler.
// Without it Lingui logs "Uncompiled message detected" for every label
// (BET, STOP, …) and skips ICU interpolation/plurals.
i18n.setMessagesCompiler(compileMessage);

export const stateI18n = $state({
	i18n
});

export const stateI18nDerived = {
	init: (lang: Language, messages: Messages) => {
		stateI18n.i18n.load(lang, messages as Messages);
		stateI18n.i18n.activate(lang);
	},
	translate: (value: string) => stateI18n.i18n._(stateI18n.i18n.t(value)),
};