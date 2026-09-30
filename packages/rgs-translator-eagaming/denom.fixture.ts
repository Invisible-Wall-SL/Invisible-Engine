/**
 * The operator's `denom` — what one Play4Fun credit is worth. Discovered by `pnpm check:all`; alone:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/rgs-translator-eagaming/denom.fixture.ts
 *
 * Every amount on the wire is in CREDITS. Until 2026-09-30 the facade priced a credit at a fixed cent
 * (the 2-complex node's `denom: 0.01`), so a brand whose credit is worth 10 cents would have shown the
 * player a tenth of their money and staked a tenth of what they chose.
 *
 *  1. ABSENT ⇒ THE PROTOCOL'S CENT, i.e. exactly the numbers every game has always shown.
 *  2. DECLARED ⇒ EVERY conversion follows it, both ways, and a round trip is lossless.
 *  3. UNREADABLE ⇒ THE CENT, not a guess.
 */

import {
	amountScale,
	DEFAULT_DENOM,
	engineToPlay4Fun,
	play4FunAmountMultiplier,
	play4FunToEngine,
} from './src/amounts.ts';
import { multiplierForAmount } from './src/betOptions.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return void console.log(`  ok  ${label}`);
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

const g = globalThis as Record<string, unknown>;
const page = (config?: Record<string, unknown>) => {
	if (!config) {
		delete g.window;
		return;
	}
	const win: Record<string, unknown> = { params: { GameSettings: { token: 'T', config } } };
	win.parent = win;
	g.window = win;
};

console.log('\n1. absent ⇒ the protocol cent');
page();
check('the default denom', DEFAULT_DENOM, 0.01);
check('10,000 engine units per credit', amountScale(), 10_000);
check('100 credits per unit of money', play4FunAmountMultiplier(), 100);
check('1,000,000 credits (the live node wallet) ⇒ $10,000', play4FunToEngine(1_000_000) / 1_000_000, 10_000); // prettier-ignore
check('$1 engine amount ⇒ 100 credits', engineToPlay4Fun(1_000_000), 100);
check('a $0.40 base spin on betOptions[0]=10 ⇒ M 4', multiplierForAmount(0.4, { betOptions: [10, 1000] }), 4); // prettier-ignore
page({ betMultipliers: [1, 2] });
check('a page that states no denom is the same', amountScale(), 10_000);

console.log('\n2. declared ⇒ every conversion follows it');
page({ denom: 0.1 });
check('10-cent credit: 100,000 engine units per credit', amountScale(), 100_000);
check('…10 credits per unit of money', play4FunAmountMultiplier(), 10);
check('1,000 credits ⇒ 100 in money', play4FunToEngine(1_000) / 1_000_000, 100);
check('$1 ⇒ 10 credits on the wire', engineToPlay4Fun(1_000_000), 10);
check('a $4 base spin on betOptions[0]=10 ⇒ M 4', multiplierForAmount(4, { betOptions: [10, 1000] }), 4); // prettier-ignore
page({ denom: 0.001 });
check('a tenth-of-a-cent credit', [amountScale(), play4FunAmountMultiplier()], [1_000, 1_000]);
for (const denom of [0.01, 0.05, 0.1, 1, 0.001]) {
	page({ denom });
	const credits = 12_345;
	check(`denom ${denom}: credits round-trip`, engineToPlay4Fun(play4FunToEngine(credits)), credits);
}

console.log('\n3. unreadable ⇒ the cent');
for (const denom of [0, -0.01, '0.1', null, 1e-7, 1.5e-6]) {
	page({ denom });
	check(`denom ${JSON.stringify(denom)}`, amountScale(), 10_000);
}
page();

console.log(failures ? `\n${failures} FAILED` : '\nall ok');
process.exit(failures ? 1 : 0);
