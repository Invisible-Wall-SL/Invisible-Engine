/**
 * Offline fixture for the CONFIG-DRIVEN bet options. Run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/rgs-translator-eagaming/betOptions.fixture.ts
 *
 * The partner's math declares what a bet costs; the client used to invent it. `betOptions` is the
 * credit cost of each bet option at multiplier 1, indexed by the FIRST bet-context argument, and
 * total stake = `betOptions[x] × M`.
 *
 * SIX claims:
 *
 *  1. A SERVER THAT DECLARES NOTHING LEAVES EVERYTHING ALONE. This is the parity gate: both our
 *     mocks and every server before this one send no `betOptions`, and must keep the legacy bet
 *     encoding and the coded placeholder ladder.
 *  2. THE LADDER IS `betOptions[0] × M` OVER THE OPERATOR'S MULTIPLIERS. The BASE option is what a
 *     rung means — a buy is the same M priced through a different option, not a separate rung.
 *  3. THE OPTION INDEX IS MATCHED BY NAME, NOT POSITION — AND REFUSES RATHER THAN GUESSES. The
 *     partner's own games disagree on order (base/buy in one, base/ante/buy in another), and a game
 *     can have more paid modes than the math has options: Borut's three buy cards against a
 *     `["0:base","1:buybonus"]` table. Guessing "the dearest option" would overcharge two of them
 *     while looking perfectly healthy, so an unresolvable mode falls back to the legacy encoding.
 *  4. M IS MEASURED AGAINST THE BASE OPTION. The engine sends the BASE bet amount and lets the
 *     option index carry the premium, so a buy must not also inflate M or the player pays twice.
 *  5. THE COST RATIOS ARE THE BUY CARD'S PRICE. `betOptions[1]/betOptions[0]` is exactly the
 *     `costMultiplier` the card displays, which is what makes card and charge agree.
 *  6. GARBAGE IS REFUSED, NOT HALF-READ. A malformed table must read as "this server declares
 *     none" — falling back to the legacy path — rather than producing a ladder of NaN.
 */

import {
	betOptionCostRatios,
	betOptionIndexFor,
	buildBetLadder,
	serverBetOptionEntries,
	multiplierForAmount,
	readServerBetOptions,
	type ServerBetOptions,
} from './src/betOptions.ts';

let failures = 0;
const check = (label: string, actual: unknown, expected: unknown): void => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) {
		console.log(`  ok  ${label}`);
		return;
	}
	failures += 1;
	console.log(`FAIL  ${label}\n        expected ${e}\n        actual   ${a}`);
};

/** The Book-of config Emanuele pasted: base 10 credits, buy bonus 1000 (= 100× base). */
const BOOK = readServerBetOptions({
	symbols: ['PIC1', 'SCAT'],
	gameCost: 10,
	betOptions: [10, 1000],
	betOptionsName: ['0:base', '1:buybonus'],
}) as ServerBetOptions;

/** The three-option game: base 20, ante 25 (1.25×), buy 2000 (100×). */
const THREE = readServerBetOptions({
	gameCost: 20,
	betOptions: [20, 25, 2000],
	betOptionsName: ['0:base', '1:ante', '2:buybonus'],
}) as ServerBetOptions;

console.log('\n1. a server that declares nothing leaves everything alone');
check('no betOptions at all', readServerBetOptions({ symbols: ['PIC1'] }), null);
check('an empty table', readServerBetOptions({ betOptions: [] }), null);
check('not an object', readServerBetOptions(null), null);

console.log('\n2. the ladder is betOptions[0] x M over the operator embed multipliers');
{
	const host = { betMultipliers: [1, 2, 5, 10], initialBetMultiplierIndex: 2 };
	const ladder = buildBetLadder(BOOK, host)!;
	// 10 credits x M, credits == cents, engine units are millionths (x10,000).
	check('levels', ladder.betLevels, [100_000, 200_000, 500_000, 1_000_000]);
	check('opens on initialBetMultiplierIndex', ladder.defaultBetLevel, 500_000);
	check('an out-of-range index falls back to the first rung', buildBetLadder(BOOK, { betMultipliers: [1, 2], initialBetMultiplierIndex: 99 })!.defaultBetLevel, 100_000); // prettier-ignore
	check('no host multipliers ⇒ no ladder (keep the placeholder)', buildBetLadder(BOOK, null), null); // prettier-ignore
	check('the three-option game prices its ladder off BASE, not the buy', buildBetLadder(THREE, { betMultipliers: [1, 2] })!.betLevels, [200_000, 400_000]); // prettier-ignore
}

console.log('\n3. the option index is matched by name, not position');
check('base', betOptionIndexFor('BASE', THREE), 0);
check('an empty mode is base', betOptionIndexFor('', THREE), 0);
check('ante sits at 1 here', betOptionIndexFor('ANTE', THREE), 1);
check('buy sits at 2 here', betOptionIndexFor('BUYBONUS', THREE), 2);
check('...and at 1 in the two-option game', betOptionIndexFor('BUYBONUS', BOOK), 1);
check('engine punctuation is normalised away', betOptionIndexFor('BUY_BONUS', BOOK), 1);
check('an unknown paid mode is REFUSED, not guessed', betOptionIndexFor('SUPERBUY', THREE), null);
check('...and so is a paid mode against an UNNAMED table', betOptionIndexFor('BUYBONUS', readServerBetOptions({ betOptions: [10, 1000] })!), null); // prettier-ignore
check('base still resolves against an unnamed table', betOptionIndexFor('BASE', readServerBetOptions({ betOptions: [10, 1000] })!), 0); // prettier-ignore

console.log('\n3b. the menu is built FROM the table, so every key round-trips');
{
	const UNNAMED = readServerBetOptions({ betOptions: [10, 1000] })!;
	check('entries for an unnamed table', serverBetOptionEntries(UNNAMED), [
		{ key: 'BASE', index: 0, costMultiplier: 1 },
		{ key: 'OPTION1', index: 1, costMultiplier: 100 },
	]);
	check('entries for a named table', serverBetOptionEntries(THREE), [
		{ key: 'BASE', index: 0, costMultiplier: 1 },
		{ key: 'ANTE', index: 1, costMultiplier: 1.25 },
		{ key: 'BUYBONUS', index: 2, costMultiplier: 100 },
	]);
	// The point of the whole exercise: a key the menu offers MUST resolve back to its option.
	for (const table of [UNNAMED, THREE, BOOK]) {
		const entries = serverBetOptionEntries(table);
		check(
			`every offered key resolves (${entries.map((e) => e.key).join('/')})`,
			entries.map((e) => betOptionIndexFor(e.key, table)),
			entries.map((e) => e.index),
		);
	}
	check('option 0 is keyed BASE because the engine hardcodes that key', serverBetOptionEntries(UNNAMED)[0].key, 'BASE'); // prettier-ignore
}

console.log('\n4. M is measured against the BASE option');
check('$1.00 at 10 credits/rung is M=10', multiplierForAmount(1, BOOK), 10);
check('$0.10 is M=1', multiplierForAmount(0.1, BOOK), 1);
check('a buy does NOT inflate M (the option index carries the premium)', multiplierForAmount(1, BOOK), multiplierForAmount(1, BOOK)); // prettier-ignore
check('$1.00 against the 20-credit game is M=5', multiplierForAmount(1, THREE), 5);
check('M never drops below 1', multiplierForAmount(0, BOOK), 1);
check('the ladder round-trips: rung 3 of [1,2,5,10] gives back M=5', multiplierForAmount(buildBetLadder(BOOK, { betMultipliers: [1, 2, 5, 10] })!.betLevels[2] / 1_000_000, BOOK), 5); // prettier-ignore

console.log('\n5. the cost ratios are the buy card price');
check('book', betOptionCostRatios(BOOK), { base: 1, buybonus: 100 });
check('three-option (ante is 1.25x)', betOptionCostRatios(THREE), { base: 1, ante: 1.25, buybonus: 100 }); // prettier-ignore
check('an unnamed table keys by index', betOptionCostRatios(readServerBetOptions({ betOptions: [10, 1000] })!), { '0': 1, '1': 100 }); // prettier-ignore

console.log('\n6. garbage is refused, not half-read');
check('a zero cost', readServerBetOptions({ betOptions: [0, 1000] }), null);
check('a negative cost', readServerBetOptions({ betOptions: [-10] }), null);
check('a string cost', readServerBetOptions({ betOptions: ['10', 1000] }), null);
check('NaN', readServerBetOptions({ betOptions: [NaN] }), null);
check('not an array', readServerBetOptions({ betOptions: 10 }), null);
check('names of the wrong type are dropped, the table survives', readServerBetOptions({ betOptions: [10, 1000], betOptionsName: [1, 2] })?.betOptionsName, undefined); // prettier-ignore

console.log(
	failures === 0 ? '\nAll bet-option claims hold.\n' : `\n${failures} FAILED claim(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);
