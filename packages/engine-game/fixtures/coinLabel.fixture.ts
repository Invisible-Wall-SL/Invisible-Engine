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

if (failures) throw new Error(`${failures} coin label check(s) failed`);
console.log('\ncoin labels ok');
