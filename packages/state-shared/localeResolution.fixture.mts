/**
 * Which language a launch plays in, once an operator's page may declare `locale`.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/state-shared/localeResolution.fixture.mts
 *
 * FOUR claims, against the real shipped list (`config-lingui` `locales`):
 *
 *  1. NOTHING DECLARED, NOTHING CHANGED: `?lang=` reads exactly as it did — `br` is `pt`, any other
 *     value as given, absent or empty is `en`. This ships to every online game.
 *  2. A DECLARED LOCALE THE GAME SHIPS WINS over `?lang=`, however the operator spells it: any case,
 *     `_` or `-`, a region form falling back to its primary language.
 *  3. A DECLARED LOCALE THE GAME DOES NOT SHIP CHANGES NOTHING — it never forces `en` over a `?lang=`.
 *  4. AN EXACT REGIONAL MATCH BEATS ITS PRIMARY, for the day a game ships one.
 */

import assert from 'node:assert/strict';
import { locales } from 'config-lingui';

import { matchShippedLocale, resolveLanguage } from './src/localeResolution.ts';

let passed = 0;
const is = (
	operatorLocale: string | null,
	urlLang: string | null,
	expected: string,
	what: string,
	shipped: readonly string[] = locales,
) => {
	assert.equal(resolveLanguage({ operatorLocale, urlLang, shipped }), expected, what);
	passed++;
	console.log(`  ✓ ${what}: locale=${operatorLocale} ?lang=${urlLang} ⇒ ${expected}`);
};

/** `lang()` as it read before operator locales existed. */
const before = (urlLang: string | null) => (urlLang === 'br' ? 'pt' : urlLang || 'en');

console.log('\n1. Nothing declared ⇒ ?lang= as before');
for (const urlLang of [null, '', 'en', 'de', 'br', 'pt', 'BR', 'xx', 'pt-BR']) {
	is(null, urlLang, before(urlLang), `?lang=${urlLang}`);
}
is(null, null, 'en', 'neither ⇒ en');
is(null, 'br', 'pt', '?lang=br ⇒ pt unchanged');

console.log('\n2. A shipped declared locale wins');
is('de', 'en', 'de', 'declared shipped locale beats ?lang=');
is('lt', null, 'lt', 'declared with no ?lang=');
is('pt_BR', 'en', 'pt', 'region form maps to its primary (underscore)');
is('es-ES', null, 'es', 'region form maps to its primary (hyphen)');
is('PT_br', null, 'pt', 'case-insensitive');
is('zh-Hant-TW', 'en', 'zh', 'multi-subtag form');

console.log('\n3. An unshipped declared locale ⇒ today');
is('gd', 'de', 'de', 'unshipped ⇒ ?lang= stands');
is('gd', null, 'en', 'unshipped, no ?lang= ⇒ en');
is('gd_GB', 'br', 'pt', 'unshipped ⇒ ?lang=br quirk still applies');
is('br', 'de', 'de', "the br→pt quirk is ?lang='s only — `br` (Breton) is not shipped");

console.log('\n4. Exact beats primary');
is('pt_BR', null, 'pt-BR', 'exact regional match', ['en', 'pt', 'pt-BR']);
is('pt_PT', null, 'pt', 'other region ⇒ primary', ['en', 'pt', 'pt-BR']);

assert.equal(matchShippedLocale(null, locales), null);
assert.equal(matchShippedLocale('  ', locales), null);
assert.equal(matchShippedLocale('EN', locales), 'en');
passed += 3;

console.log(`\n${passed} locale assertions passed.`);
