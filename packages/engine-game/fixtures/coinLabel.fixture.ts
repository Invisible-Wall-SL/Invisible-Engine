/**
 * The Hold and Win symbol label (`coinLabelText`): money from a decimal × bet value, jackpot tiers
 * and factors, and the role that decides between money, a factor and a payer's "+".
 *
 * Run: node --experimental-strip-types packages/engine-game/fixtures/coinLabel.fixture.ts
 */
import { coinLabelText } from '../src/game/coinLabel.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown) => {
	if (actual === expected) return console.log(`  ok  ${label}`);
	failures += 1;
	console.log(
		`FAIL  ${label}\n        expected ${String(expected)}\n        actual   ${String(actual)}`,
	);
};

// A $2 total bet, two decimals — what `bookEventAmountToCurrencyString` prints for it.
const money = (multiple: number) => `$${(multiple * 2).toFixed(2)}`;

check('a decimal cash coin is money', coinLabelText({ value: 1.5 }, ['coin'], money), '$3.00');
check(
	'a collector shows what it holds',
	coinLabelText({ value: 12.5 }, ['collector'], money),
	'$25.00',
);
check(
	'a jackpot coin shows its tier',
	coinLabelText({ jackpot: 'MINI' }, ['jackpot'], money),
	'MINI',
);
check(
	'a multiplied jackpot shows its factor',
	coinLabelText({ jackpot: 'MAJOR', factor: 3 }, ['jackpot'], money),
	'MAJOR ×3',
);
check(
	'a jackpot label wins over a value',
	coinLabelText({ jackpot: 'GRAND', value: 7 }, ['coin'], money),
	'GRAND',
);
check('a multiplier shows a factor', coinLabelText({ value: 3 }, ['coinMultiplier'], money), '×3');
check(
	'a payer shows what it adds',
	coinLabelText({ value: 4 }, ['payer', 'meterSpecial'], money),
	'+$8.00',
);
check(
	'an unrevealed mystery prints nothing',
	coinLabelText({ value: 2 }, ['mystery'], money),
	null,
);
check('a plain symbol prints nothing', coinLabelText({}, [], money), null);

// The AUTHORED label (`doc.coinLabel`). An empty format prints exactly the coded text.
check(
	'an empty format is the coded label',
	coinLabelText({ value: 1.5 }, ['coin'], money, {}),
	'$3.00',
);
check(
	'…and so is a jackpot with no authored text',
	coinLabelText({ jackpot: 'MINI', factor: 2 }, ['jackpot'], money, { jackpots: {} }),
	'MINI ×2',
);
check(
	'a tier prints its authored text',
	coinLabelText({ jackpot: 'GRAND' }, ['jackpot'], money, { jackpots: { GRAND: { text: 'BIG' } } }),
	'BIG',
);
check(
	'…and keeps the factor suffix',
	coinLabelText({ jackpot: 'MAJOR', factor: 3 }, ['jackpot'], money, {
		jackpots: { MAJOR: { text: 'Major' } },
	}),
	'Major ×3',
);
check(
	'a blank authored text falls back to the tier name',
	coinLabelText({ jackpot: 'MINOR' }, ['jackpot'], money, { jackpots: { MINOR: { text: '  ' } } }),
	'MINOR',
);
check(
	'trimZeros drops the whole fraction of a round amount',
	coinLabelText({ value: 1.5 }, ['coin'], money, { cash: { trimZeros: true } }),
	'$3',
);
check(
	'…and only the trailing zeros of another',
	coinLabelText({ value: 0.75 }, ['coin'], money, { cash: { trimZeros: true } }),
	'$1.5',
);
check(
	'decimals keep at least that many digits and never cut a non-zero one',
	coinLabelText({ value: 0.755 }, ['coin'], money, { cash: { decimals: 0 } }),
	'$1.51',
);
{
	const asked: unknown[] = [];
	const spy = (multiple: number, decimals?: number) => {
		asked.push(decimals);
		return `$${(multiple * 2).toFixed(Math.max(2, decimals ?? 2))}`;
	};
	check(
		'more decimals than the currency prints are asked of the money formatter',
		coinLabelText({ value: 1.5 }, ['coin'], spy, { cash: { decimals: 3 } }),
		'$3.000',
	);
	check('…with that count', asked[0], 3);
}
check(
	'a payer keeps its "+" under an authored format',
	coinLabelText({ value: 4 }, ['payer'], money, { cash: { trimZeros: true } }),
	'+$8',
);
check(
	'× bet prints the decimal multiple, trimmed',
	coinLabelText({ value: 1.5 }, ['coin'], money, { cash: { format: 'betMultiple' } }),
	'1.5×',
);
check(
	'× bet with decimals pads to them',
	coinLabelText({ value: 2 }, ['coin'], money, { cash: { format: 'betMultiple', decimals: 2 } }),
	'2.00×',
);
check(
	'a payer in × bet',
	coinLabelText({ value: 0.25 }, ['payer'], money, { cash: { format: 'betMultiple' } }),
	'+0.25×',
);
check(
	'a multiplier is a factor whatever the cash format',
	coinLabelText({ value: 3 }, ['coinMultiplier'], money, { cash: { format: 'betMultiple' } }),
	'×3',
);
check(
	"a locale's decimal comma is trimmed, its grouping dot left alone",
	coinLabelText({ value: 600 }, ['coin'], () => '1.200,00 €', {
		cash: { trimZeros: true },
		decimalSeparator: ',',
	}),
	'1.200 €',
);
check(
	'an amount with no fraction is untouched',
	coinLabelText({ value: 600 }, ['coin'], () => '$1,200', { cash: { trimZeros: true } }),
	'$1,200',
);

if (failures) throw new Error(`${failures} coin label check(s) failed`);
console.log('\ncoin labels ok');
