/**
 * Offline fixture for the OPERATOR SETTINGS reader. Discovered by `pnpm check:all`; run alone with
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/delivery-profile/operator.fixture.ts
 *
 * The owner's rule: any game may ship under any jurisdiction, so a behaviour is on ONLY because the
 * operator declared it. Three claims per field:
 *
 *  1. ABSENT ⇒ NEUTRAL. No page, an empty config, and a config that simply omits the field all read
 *     as the neutral default: the behaviour off, the surface not shown, never a market's value.
 *  2. PRESENT ⇒ READ, typed on the way out.
 *  3. UNREADABLE ⇒ NEUTRAL, not a guess. A `"true"` string is not `true`; a ladder with one bad
 *     rung is no ladder; a `javascript:` home link is no home link.
 */

import {
	NEUTRAL_OPERATOR_SETTINGS,
	readOperatorSettings,
	readPageOperatorSettings,
	safeLink,
	type OperatorSettings,
} from './src/operator.ts';

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

/** `Infinity` does not survive JSON, so ladders are compared through this. */
const show = (list: number[] | null) => list?.map((n) => (n === Infinity ? '∞' : n)) ?? null;

type Case = {
	field: keyof OperatorSettings;
	/** What the operator wrote, keyed by the WIRE name (which differs for `showTime`). */
	config: Record<string, unknown>;
	expected: unknown;
	/** Values that must read as neutral. */
	garbage: unknown[];
};

const CASES: Case[] = [
	{ field: 'minNormalBet', config: { minNormalBet: 20 }, expected: 20, garbage: [0, -5, '20', NaN] },
	{ field: 'maxNormalBet', config: { maxNormalBet: 10000 }, expected: 10000, garbage: [0, 'x', null] },
	{ field: 'showBetRanges', config: { showBetRanges: true }, expected: true, garbage: ['true', 1] },
	{ field: 'denom', config: { denom: 0.01 }, expected: 0.01, garbage: [0, -1, '0.01', 1e-7, 1.5e-6] },
	{ field: 'showCreditValue', config: { showCreditValue: true }, expected: true, garbage: ['yes'] },
	{ field: 'autoplayDisabled', config: { autoplayDisabled: true }, expected: true, garbage: [1] },
	{ field: 'minSpinDuration', config: { minSpinDuration: 3000 }, expected: 3000, garbage: [-1, '3000'] },
	{ field: 'confirmGameRoundStart', config: { confirmGameRoundStart: true }, expected: true, garbage: ['1'] },
	{ field: 'showBuyBonusPayback', config: { showBuyBonusPayback: true }, expected: true, garbage: [0] },
	{ field: 'showHighChancePayback', config: { showHighChancePayback: true }, expected: true, garbage: [0] },
	{ field: 'currencySymbol', config: { currencySymbol: '€' }, expected: '€', garbage: ['', '   ', 5, 'far too long'] },
	{ field: 'currencyFormat', config: { currencyFormat: '{0} #,#.#0' }, expected: '{0} #,#.#0', garbage: ['{0}', 7] },
	{ field: 'locale', config: { locale: 'pt_BR' }, expected: 'pt_BR', garbage: ['english please', '', 3] },
	{ field: 'home', config: { home: 'https://casino.example/lobby' }, expected: 'https://casino.example/lobby', garbage: ['javascript:alert(1)', '//evil.example', 'ftp://x', 5] },
	{ field: 'clock', config: { clock: true }, expected: true, garbage: ['true'] },
	{ field: 'clock', config: { showTime: true }, expected: true, garbage: [1] },
	{ field: 'elapsedTime', config: { elapsedTime: true }, expected: true, garbage: ['true'] },
	{ field: 'externalHistoryUrl', config: { externalHistoryUrl: '/rgs/history?sid=S1' }, expected: '/rgs/history?sid=S1', garbage: ['data:text/html,x', ''] },
]; // prettier-ignore

const main = () => {
	console.log('\n1. absent ⇒ neutral');
	{
		const g = globalThis as Record<string, unknown>;
		delete g.window;
		check('no page at all', readPageOperatorSettings(), NEUTRAL_OPERATOR_SETTINGS);
		check('a null config', readOperatorSettings(null), NEUTRAL_OPERATOR_SETTINGS);
		check('an empty config', readOperatorSettings({}), NEUTRAL_OPERATOR_SETTINGS);
		check(
			'a config of only fields we do not honour',
			readOperatorSettings({ betMultipliers: [1, 2], jackpot: true, whiteLabel: true }),
			NEUTRAL_OPERATOR_SETTINGS,
		);
		check('the neutral default is frozen', Object.isFrozen(NEUTRAL_OPERATOR_SETTINGS), true);
		check(
			'every neutral boolean is OFF',
			Object.entries(NEUTRAL_OPERATOR_SETTINGS).filter(([, v]) => v === true),
			[],
		);
		check('no minimum spin duration', NEUTRAL_OPERATOR_SETTINGS.minSpinDuration, 0);
	}

	console.log('\n2. present ⇒ read  ·  3. unreadable ⇒ neutral');
	for (const { field, config, expected, garbage } of CASES) {
		const key = Object.keys(config)[0];
		check(`${key}: read`, readOperatorSettings(config)[field], expected);
		for (const value of garbage) {
			check(
				`${key}: ${JSON.stringify(value) ?? String(value)} is neutral`,
				readOperatorSettings({ [key]: value })[field],
				NEUTRAL_OPERATOR_SETTINGS[field],
			);
		}
		const others = readOperatorSettings(config);
		const touched = (Object.keys(others) as (keyof OperatorSettings)[]).filter(
			(k) =>
				k !== field && JSON.stringify(others[k]) !== JSON.stringify(NEUTRAL_OPERATOR_SETTINGS[k]),
		);
		check(`${key}: moves nothing else`, touched, []);
	}

	console.log('\n   the ladders');
	{
		const read = (key: string, value: unknown) =>
			show(readOperatorSettings({ [key]: value })[key as 'autoplaySpins']);
		check('autoplaySpins: -1 is "until stopped"', read('autoplaySpins', [10, 25, 50, 100, 200, 500, -1]), [10, 25, 50, 100, 200, 500, '∞']); // prettier-ignore
		check('autoplaySpins: sorted and de-duplicated', read('autoplaySpins', [50, 10, 10]), [10, 50]);
		check('autoplaySpins: a fractional round count refuses the list', read('autoplaySpins', [10, 2.5]), null); // prettier-ignore
		check('autoplaySpins: one bad rung refuses the list', read('autoplaySpins', [10, 'x']), null);
		check('autoplaySpins: an empty list is no list', read('autoplaySpins', []), null);
		check('autoplaySpins: zero is not a round count', read('autoplaySpins', [0, 10]), null);
		check('lossLimits: multiples may be fractional', read('lossLimits', [0.5, 1, 2, -1]), [0.5, 1, 2, '∞']); // prettier-ignore
		check('singleWinLimits: read', read('singleWinLimits', [5, 10, 100]), [5, 10, 100]);
		check('singleWinLimits: not a list', read('singleWinLimits', 10), null);
		check('a 24-rung ladder is read', read('autoplaySpins', Array.from({ length: 24 }, (_, i) => i + 1))?.length, 24); // prettier-ignore
		check('a 25-rung ladder is no ladder', read('autoplaySpins', Array.from({ length: 25 }, (_, i) => i + 1)), null); // prettier-ignore
	}

	console.log('\n   bounds');
	{
		check('minSpinDuration is capped at a minute', readOperatorSettings({ minSpinDuration: 3_600_000 }).minSpinDuration, 60_000); // prettier-ignore
		check('a millionth is the finest denom', readOperatorSettings({ denom: 0.000001 }).denom, 0.000001); // prettier-ignore
		check('a tenth of a cent is a denom', readOperatorSettings({ denom: 0.001 }).denom, 0.001);
		check('clock and showTime are one surface', readOperatorSettings({ clock: false, showTime: true }).clock, true); // prettier-ignore
		check('a relative home link is kept as a path', safeLink('/lobby'), '/lobby');
		check(
			'an http link is normalised',
			safeLink('http://casino.example'),
			'http://casino.example/',
		);
		check('a link with whitespace is refused', safeLink('https://a.example/x y'), null);
	}

	console.log('\n   the page');
	{
		const g = globalThis as Record<string, unknown>;
		const win: Record<string, unknown> = {
			params: { GameSettings: { token: 'T', config: { minSpinDuration: 2500, clock: true } } },
		};
		win.parent = win;
		g.window = win;
		const read = readPageOperatorSettings();
		check('reads the embed page', [read.minSpinDuration, read.clock], [2500, true]);
		delete g.window;
	}

	console.log(failures ? `\n${failures} FAILED` : '\nall ok');
	if (failures) process.exit(1);
};

main();
