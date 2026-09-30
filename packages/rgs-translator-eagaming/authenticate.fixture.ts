/**
 * Offline fixture for what `requestAuthenticate` hands the engine. Run it through tsx:
 *   pnpm --filter launcher-api exec tsx ../../packages/rgs-translator-eagaming/authenticate.fixture.ts
 *
 * The answer has two authors that are not us: the SERVER's boot `config` (the bet-option table)
 * and the OPERATOR's embed page (`params.GameSettings.config` — the multiplier ladder and the
 * jurisdiction flags). Drives the REAL facade over a stub transport.
 *
 * FIVE claims:
 *
 *  1. NOTHING STATED, NOTHING CHANGED. A mock that declares no table, opened with no embed page, is
 *     every game we run today: the placeholder ladder, a $1 opening bet, and a jurisdiction that
 *     restricts nothing — including the buy feature, which no one forbade.
 *  2. WHAT THE OPERATOR STATES REACHES THE ENGINE. The flags used to be spread BEFORE the defaults,
 *     so every one of them was overwritten and a licence that forbade turbo got turbo.
 *  3. SILENCE IS NOT "NO". A key the operator did not state keeps the default, and a stated `true`
 *     restricts nothing.
 *  4. THE TABLE SPEAKS FOR THE BUY FEATURE ONLY WHEN IT EXISTS. One option means nothing to buy; two
 *     means a buy exists; an operator's `allowOutcomeBuy: false` still wins over a table that has one.
 *  5. THE LADDER AND THE OPENING RUNG ARE THE OPERATOR'S, priced by the server: `betOptions[0] × M`
 *     over `betMultipliers`, opening on `initialBetMultiplierIndex`.
 *  6. AUTOPLAY HAS TWO SPELLINGS AND EITHER "NO" WINS. `allowAutoplay: false` and the partner
 *     client's `autoplayDisabled: true` both forbid it; a page that says both ways is the stricter;
 *     neither stated is silence.
 *  7. `minNormalBet` / `maxNormalBet` BOUND WHICHEVER LADDER SHIPS — the server-priced one and the
 *     placeholder alike, in credits — and bounds that would empty it are ignored, not obeyed.
 */

import { requestAuthenticate } from './src/engineFacade.ts';

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

type Jurisdiction = Record<string, boolean | number>;
type AuthConfig = { betLevels: number[]; defaultBetLevel: number; jurisdiction: Jurisdiction };

/** The server's boot answer: a balance, plus a `config` event when it declares a bet table. */
const serve = (betOptions: number[] | null) => {
	globalThis.fetch = (async () =>
		new Response(
			JSON.stringify({
				platform: { balance: 100_000 },
				events: [
					{
						event: 'config',
						context: {
							symbols: ['PIC1', 'PIC2', 'SCAT'],
							...(betOptions ? { betOptions } : {}),
						},
					},
				],
			}),
			{ status: 200, headers: { 'content-type': 'application/json' } },
		)) as typeof fetch;
};

/** The operator's embed page, or none. */
const embed = (config: Record<string, unknown> | null) => {
	(globalThis as { window?: unknown }).window = config
		? { params: { GameSettings: { token: 'S-fixture', service: '', config } } }
		: {};
};

let sid = 0;
const authenticate = async (): Promise<AuthConfig> => {
	sid += 1;
	const answer = await requestAuthenticate({
		sessionID: `S-fixture-${sid}`,
		rgsUrl: 'rgs.example',
		language: 'en',
	});
	return (answer as { config: AuthConfig }).config;
};

const RESTRICTING = ['disabledTurbo', 'disabledAutoplay', 'disabledBuyFeature', 'displayRTP'];
const pick = (j: Jurisdiction) => Object.fromEntries(RESTRICTING.map((key) => [key, j[key]]));
const NONE = { disabledTurbo: false, disabledAutoplay: false, disabledBuyFeature: false, displayRTP: false }; // prettier-ignore
const PLACEHOLDER = [100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000, 50_000_000, 100_000_000]; // prettier-ignore

console.log('1. nothing stated, nothing changed');
{
	serve(null);
	embed(null);
	const config = await authenticate();
	check('restricts nothing', pick(config.jurisdiction), NONE);
	check('opens on $1', config.defaultBetLevel, 1_000_000);
	check('the placeholder ladder, rung for rung', config.betLevels, PLACEHOLDER);
}

console.log('\n2. what the operator states reaches the engine');
{
	serve(null);
	embed({ enableTurbo: false, allowAutoplay: false, allowOutcomeBuy: false, showTheoreticalPayback: true }); // prettier-ignore
	check('every stated flag wins', pick((await authenticate()).jurisdiction), {
		disabledTurbo: true,
		disabledAutoplay: true,
		disabledBuyFeature: true,
		displayRTP: true,
	});
}

console.log('\n3. silence is not "no"');
{
	serve(null);
	embed({ enableTurbo: true, allowAutoplay: true, allowOutcomeBuy: true });
	check('stated true restricts nothing', pick((await authenticate()).jurisdiction), NONE);
	embed({ enableTurbo: false });
	check('only the stated key moves', pick((await authenticate()).jurisdiction), { ...NONE, disabledTurbo: true }); // prettier-ignore
}

console.log('\n4. the table speaks for the buy feature only when it exists');
{
	embed(null);
	serve([10]);
	check('one option: nothing to buy', (await authenticate()).jurisdiction.disabledBuyFeature, true);
	serve([10, 1000]);
	check('two options: a buy exists', (await authenticate()).jurisdiction.disabledBuyFeature, false);
	embed({ allowOutcomeBuy: false });
	check('the operator still forbids it', (await authenticate()).jurisdiction.disabledBuyFeature, true); // prettier-ignore
}

console.log("\n5. the ladder and the opening rung are the operator's, priced by the server");
{
	serve([10, 1000]);
	embed({ betMultipliers: [1, 2, 4, 10], initialBetMultiplierIndex: 2 });
	const config = await authenticate();
	check('betOptions[0] x M, in engine units', config.betLevels, [100_000, 200_000, 400_000, 1_000_000]); // prettier-ignore
	check('opens on the stated rung', config.defaultBetLevel, 400_000);
}

console.log('\n6. autoplay has two spellings and either "no" wins');
{
	serve(null);
	const autoplay = async (config: Record<string, unknown>) => {
		embed(config);
		return (await authenticate()).jurisdiction.disabledAutoplay;
	};
	check('autoplayDisabled: true forbids it', await autoplay({ autoplayDisabled: true }), true);
	check('autoplayDisabled: false allows it', await autoplay({ autoplayDisabled: false }), false);
	check('allowed one way, forbidden the other ⇒ forbidden', await autoplay({ allowAutoplay: true, autoplayDisabled: true }), true); // prettier-ignore
	check('...in either direction', await autoplay({ allowAutoplay: false, autoplayDisabled: false }), true); // prettier-ignore
	check('both allowing ⇒ allowed', await autoplay({ allowAutoplay: true, autoplayDisabled: false }), false); // prettier-ignore
	check('a non-boolean is silence, not "no"', await autoplay({ autoplayDisabled: 'true' }), false);
}

console.log('\n7. minNormalBet / maxNormalBet bound whichever ladder ships');
{
	serve(null);
	// The placeholder in credits: 10 20 50 100 200 500 1000 5000 10000, opening on 100.
	embed({ minNormalBet: 50, maxNormalBet: 1000 });
	let config = await authenticate();
	check('placeholder: both ends trimmed', config.betLevels, [500_000, 1_000_000, 2_000_000, 5_000_000, 10_000_000]); // prettier-ignore
	check('placeholder: the $1 opening survives', config.defaultBetLevel, 1_000_000);
	embed({ minNormalBet: 200 });
	check('placeholder: an opening below the min moves up', (await authenticate()).defaultBetLevel, 2_000_000); // prettier-ignore

	serve([10, 1000]);
	embed({ betMultipliers: [1, 2, 4, 10], initialBetMultiplierIndex: 2, maxNormalBet: 20 });
	config = await authenticate();
	check('server ladder: rungs above the max dropped', config.betLevels, [100_000, 200_000]);
	check('server ladder: the opening moves down to the highest left', config.defaultBetLevel, 200_000); // prettier-ignore

	const warn = console.warn;
	let warned = 0;
	console.warn = (...args: unknown[]) => {
		if (args.join(' ').includes('minNormalBet')) warned += 1;
	};
	serve(null);
	embed({ minNormalBet: 1_000_000 });
	config = await authenticate();
	console.warn = warn;
	check('a bound that empties the ladder is ignored', config.betLevels, PLACEHOLDER);
	check('...the opening with it', config.defaultBetLevel, 1_000_000);
	check('...and says so', warned, 1);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
