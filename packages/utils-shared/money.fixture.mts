/**
 * The operator's money declaration (`currencySymbol` / `currencyFormat`) and what `formatMoney`
 * prints from it.
 *
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/utils-shared/money.fixture.mts
 *
 * FOUR claims:
 *
 *  1. NOTHING DECLARED, NOTHING CHANGED. Against the formatter money went through before this —
 *     copied below verbatim and run through the REAL Lingui `i18n.number` — every string is
 *     byte-identical. This ships to every online game.
 *  2. A SYMBOL ALONE SWAPS ONLY THE GLYPH: the locale keeps its position, spacing, grouping and
 *     decimals.
 *  3. A PATTERN PLACES THE DIGITS: `{0}` is the symbol, a `,` groups, the placeholders after `.` are
 *     the decimals, literal text stays — and an amount with cents under a no-decimal pattern still
 *     reads as what it is.
 *  4. SOCIAL COINS KEEP THEIR OWN FORM whatever the operator declares.
 */

import assert from 'node:assert/strict';
import { setupI18n } from '@lingui/core';

import { formatMoney, moneyFractionDigits, parseMoneyPattern } from './money.ts';

// ── The formatter as it was, verbatim but for the state reads (now parameters). ───────────────
const NO_LOCALISATION_CURRENCY_MAP: Record<string, string> = { XGC: 'GC', XSC: 'SC' };
const narrowSymbolOf = (locale: string, currency: string): string | undefined => {
	try {
		return new Intl.NumberFormat(locale, {
			style: 'currency',
			currency,
			currencyDisplay: 'narrowSymbol',
		})
			.formatToParts(0)
			.find((part) => part.type === 'currency')?.value;
	} catch {
		return undefined;
	}
};
const narrowSymbolIsUnique = (locale: string, currency: string): boolean => {
	const supportedValuesOf = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] })
		.supportedValuesOf;
	const target = narrowSymbolOf(locale, currency);
	const all = typeof supportedValuesOf === 'function' ? supportedValuesOf('currency') : [];
	return (
		!!target &&
		all.length > 0 &&
		!all.some((other) => other !== currency && narrowSymbolOf(locale, other) === target)
	);
};
const today = (value: number, locale: string, currency: string) => {
	if (currency in NO_LOCALISATION_CURRENCY_MAP) {
		return `${NO_LOCALISATION_CURRENCY_MAP[currency]} ${Number.parseFloat(`${value}`).toFixed(2)}`;
	}
	const i18n = setupI18n({ locale, messages: { [locale]: {} } });
	return i18n.number(value, {
		minimumFractionDigits: 2,
		maximumFractionDigits: 2,
		style: 'currency',
		currency,
		...(narrowSymbolIsUnique(locale, currency) ? { currencyDisplay: 'narrowSymbol' as const } : {}),
	});
};
// ───────────────────────────────────────────────────────────────────────────────────────────────

let passed = 0;
const is = (actual: string, expected: string, what: string) => {
	assert.equal(actual, expected, what);
	passed++;
	console.log(`  ✓ ${what}: ${JSON.stringify(actual)}`);
};

// Intl separates some currencies from digits with U+00A0 / U+202F; compare the glyphs readably.
const plain = (s: string) => s.replace(/[\u00a0\u202f]/g, ' ');

console.log('\n1. Nothing declared ⇒ the formatter as it was');
const AMOUNTS = [0, 0.1, 0.5, 1, 1234.5, 1234567.891, -42.25, 1e9];
const CASES: [string, string][] = [
	['en-US', 'USD'],
	['en', 'USD'],
	['de-DE', 'EUR'],
	['de', 'EUR'],
	['it-IT', 'USD'],
	['it', 'EUR'],
	['ja-JP', 'JPY'],
	['pt', 'BRL'],
	['pl', 'PLN'],
	['xx', 'USD'],
	['en', 'XGC'],
	['de', 'XSC'],
];
for (const [locale, currency] of CASES) {
	for (const value of AMOUNTS) {
		for (const declared of [{}, { symbol: null, pattern: null }, { symbol: '', pattern: '' }]) {
			assert.equal(
				formatMoney(value, { locale, currency, ...declared }),
				today(value, locale, currency),
				`${locale} ${currency} ${value} ${JSON.stringify(declared)}`,
			);
			passed++;
		}
	}
	console.log(
		`  ✓ ${locale} ${currency}: ${JSON.stringify(formatMoney(1234.5, { locale, currency }))}`,
	);
}
// And pinned literally, so a formatter change on BOTH sides still shows up.
is(formatMoney(1234.5, { locale: 'en-US', currency: 'USD' }), '$1,234.50', 'en-US USD literal');
is(
	plain(formatMoney(1234.5, { locale: 'de-DE', currency: 'EUR' })),
	'1.234,50 €',
	'de-DE EUR literal',
);
is(
	plain(formatMoney(1234.5, { locale: 'it-IT', currency: 'USD' })),
	'1234,50 USD',
	'it-IT USD literal',
);
is(formatMoney(1234.5, { locale: 'ja-JP', currency: 'JPY' }), '￥1,234.50', 'ja-JP JPY literal');

console.log('\n2. Symbol only ⇒ the glyph swapped, the locale kept');
is(
	formatMoney(1234.5, { locale: 'en-US', currency: 'USD', symbol: '€' }),
	'€1,234.50',
	'en symbol leads',
);
is(
	plain(formatMoney(1234.5, { locale: 'de-DE', currency: 'USD', symbol: '€' })),
	'1.234,50 €',
	'de symbol trails with its space',
);
is(
	plain(formatMoney(1234.5, { locale: 'it-IT', currency: 'USD', symbol: '$' })),
	'1234,50 $',
	'it code slot takes the glyph',
);
is(
	formatMoney(-42.25, { locale: 'en-US', currency: 'USD', symbol: 'Kr' }),
	'-Kr42.25',
	'negative keeps its sign',
);
is(
	formatMoney(1234567.891, { locale: 'en-US', currency: 'USD', symbol: 'R$' }),
	'R$1,234,567.89',
	'large amount',
);

console.log('\n3. Pattern ⇒ digits placed per the pattern');
is(
	formatMoney(1234.5, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0} #,#.#0' }),
	'€ 1,234.50',
	"the partner default '{0} #,#.#0'",
);
is(
	formatMoney(1234.5, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '#,#.00 {0}' }),
	'1,234.50 €',
	'symbol after',
);
is(
	formatMoney(1234.5, { locale: 'de', currency: 'EUR', symbol: '€', pattern: '#,#.00 {0}' }),
	'1.234,50 €',
	'the locale still picks the separators',
);
is(
	formatMoney(1234.5, { locale: 'en-US', currency: 'USD', pattern: '{0} #,#.00' }),
	'$ 1,234.50',
	'no declared symbol ⇒ the one the currency implies',
);
is(
	plain(formatMoney(1234567.5, { locale: 'it-IT', currency: 'USD', pattern: '#,#.00 {0}' })),
	'1.234.567,50 USD',
	'…including a code where the locale prints one',
);
is(
	formatMoney(1234.5, { locale: 'it-IT', currency: 'EUR', symbol: '€', pattern: '#,#.00 {0}' }),
	'1234,50 €',
	"grouping on is the LOCALE's grouping (Italian leaves 4 digits whole)",
);
is(
	formatMoney(1234, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '#,#' }),
	'1,234',
	"'#,#' no {0} ⇒ no symbol",
);
is(
	formatMoney(1234, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0}#,#' }),
	'€1,234',
	"'{0}#,#' whole amount ⇒ no decimals",
);
is(
	formatMoney(0.5, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0}#,#' }),
	'€0.50',
	'…but cents are never rounded away',
);
is(
	formatMoney(1234.5, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0}#,#.0' }),
	'€1,234.5',
	'one decimal stated, one needed',
);
is(
	formatMoney(1234.25, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0}#,#.0' }),
	'€1,234.25',
	'one decimal stated, two needed',
);
is(
	formatMoney(1234.5, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0} 0.00' }),
	'€ 1234.50',
	'grouping off',
);
is(
	formatMoney(1234567.891, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0} #,#.00' }),
	'€ 1,234,567.89',
	'large amount',
);
is(
	formatMoney(-42.25, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0} #,#.00' }),
	'-€ 42.25',
	'negative: the sign leads the symbol',
);
is(
	formatMoney(-42.25, { locale: 'de', currency: 'EUR', symbol: '€', pattern: '#,#.00 {0}' }),
	'-42,25 €',
	'negative, symbol after',
);
is(
	formatMoney(-0.001, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '{0} #,#.00' }),
	'€ 0.00',
	'an amount that rounds to zero carries no sign',
);
is(
	formatMoney(5, { locale: 'en', currency: 'EUR', symbol: '€', pattern: 'EUR {0} #,#.00 total' }),
	'EUR € 5.00 total',
	'literal text is kept',
);
is(
	formatMoney(5, { locale: 'en', currency: 'EUR', symbol: '€', pattern: '#,#.000000000 {0}' }),
	'5.0000 €',
	'absurd decimals are capped, not thrown',
);

assert.deepEqual(parseMoneyPattern('{0} #,#.#0'), {
	before: '{0} ',
	after: '',
	grouping: true,
	decimals: 2,
});
assert.deepEqual(parseMoneyPattern('#,#'), { before: '', after: '', grouping: true, decimals: 0 });
assert.deepEqual(parseMoneyPattern('{0}{0}'), null);
assert.equal(moneyFractionDigits(3, 0), 0);
assert.equal(moneyFractionDigits(3.1, 0), 2);
assert.equal(moneyFractionDigits(3.1, 1), 1);
assert.equal(moneyFractionDigits(3, 3), 3);
passed += 7;

console.log('\n4. Social coins keep their own form');
is(formatMoney(1234.5, { locale: 'en', currency: 'XGC' }), 'GC 1234.50', 'XGC');
is(
	formatMoney(1234.5, { locale: 'de', currency: 'XSC', symbol: '€', pattern: '{0} #,#' }),
	'SC 1234.50',
	'XSC ignores the declaration',
);

console.log(`\n${passed} money assertions passed.`);
