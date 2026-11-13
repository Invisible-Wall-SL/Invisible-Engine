/**
 * THE FEATURE END'S TALLY RUNS TO THE END (`presentHoldAndWinEnd`, apps/lines holdAndWinPresentation.ts).
 *
 *   pnpm check:holdandwin-end
 *
 * The shipped `presentHoldAndWinEnd` is sliced from its source and run with the REAL
 * `coinBoardTallyPlan` and `tallyCountUp`; everything that draws or waits is a recording stub. Each
 * held coin lands (in reverse order, as flights may finish), then a banked part joins the bar as its
 * own step. That step is no coin, so it must play no coin's collect sound and read nothing past the
 * coins: #1443 had it call `playCoinCollectSound(order[order.length].symbol.name)`, which threw on
 * every feature ending with a banked jackpot (letters, full board, wheel, an expansion's row) and
 * aborted the beat before the board came down.
 *
 *  1. Coins and a banked jackpot: every coin steps the bar and sounds once, the banked step lands
 *     the bar on `start + total` with no sound, and the beat runs on to `hideRespinBoard`.
 *  2. Nothing banked: one step per coin, no extra step.
 *  3. A banked part the feature already counted into the bar (swept columns): no extra step.
 *  4. Only a banked part, no coin to fly: one step, no sound.
 *  5. A `lineFill` coin board with a banked part: the runs' coins, then the banked step.
 */

import { readFileSync } from 'node:fs';

import { coinBoardTallyPlan } from '../packages/engine-game/src/game/coinBoardTally.ts';
import type { HoldAndWinTally } from '../packages/engine-game/src/game/holdAndWin.ts';
import { tallyCountUp } from '../packages/engine-game/src/game/respinCount.ts';
import { compileSlice, stripSliceTypes } from './lib/compile-slice.mjs';
import { assertStubSetIsComplete } from './lib/stub-set-guard.mjs';

const FIXTURE = 'check-holdandwin-end-tally';
const SOURCE = 'apps/lines/src/game/holdAndWinPresentation.ts';
const text = readFileSync(new URL(`../${SOURCE}`, import.meta.url), 'utf8').replaceAll(
	'\r\n',
	'\n',
);
const FROM = 'export const presentHoldAndWinEnd = async (';
const start = text.indexOf(FROM);
if (start < 0) throw new Error(`${FIXTURE}: could not find "${FROM}" in ${SOURCE}`);
const end = text.indexOf('\n};\n', start);
if (end < 0) throw new Error(`${FIXTURE}: could not find the end of presentHoldAndWinEnd`);
const slice = stripSliceTypes(
	`${SOURCE}#presentHoldAndWinEnd`,
	text.slice(start, end + 4).replace('export const', 'const'),
);

type Tally = { type: 'respinTallyStep'; index: number; amount: number; total: number };
type Recorder = { steps: Tally[]; sounds: string[]; broadcasts: string[]; calls: string[] };

const stubsFor = (rec: Recorder, stateBet: { winBookEventAmount: number }) => {
	const call = (name: string) => () => {
		rec.calls.push(name);
	};
	return {
		stateRespinBoard: { shown: true, dimmed: [] as string[] },
		stateBet,
		eventEmitter: {
			broadcast: (event: { type: string } & Partial<Tally>) => {
				rec.broadcasts.push(event.type);
				if (event.type === 'respinTallyStep') rec.steps.push(event as Tally);
			},
		},
		playCoinCollectSound: (name: string) => {
			rec.sounds.push(name);
		},
		coinBoardTallyPlan,
		tallyCountUp,
		waitPresentation: async () => {},
		END_HOLD_MS: 0,
		TALLY_LAND_MS: 0,
		TALLY_HOLD_MS: 0,
		BANKED_BEAT_MS: 0,
		FEATURE_LINE_MS: 0,
		respinCellKey: (reel: number, row: number) => `${reel}:${row}`,
		showLineMultiples: async () => {},
		// As the real one: the step's cells in column order, each landing on its own — here LAST first.
		flyCoinsToTotal: async (
			cells: { reel: number; row: number }[],
			onLand?: (index: number) => void,
		) => {
			const order = [...cells].sort((a, b) => a.reel - b.reel || a.row - b.row);
			for (let index = order.length - 1; index >= 0; index--) {
				await Promise.resolve();
				onLand?.(index);
			}
		},
		presentLineRun: async (_run: unknown, flights: Promise<void>) => {
			await flights;
		},
		bookEventAmountToCurrencyString: (amount: number) => String(amount),
		featureTotalText: (amount: string) => `TOTAL ${amount}`,
		featureOutroText: () => '',
		announceFeatureLine: () => ({}),
		hideHoldAndWinBanner: () => {},
		holdAndWinIsOverlayBonus: () => false,
		getActiveGameConfig: () => ({}),
		isPrimaryRespinMode: () => true,
		isCoinBoard: () => false,
		settleReelsOnHeldCells: call('settleReelsOnHeldCells'),
		hideRespinBoard: call('hideRespinBoard'),
		closeEnhancements: call('closeEnhancements'),
	};
};

const STUB_NAMES = Object.keys(
	stubsFor({ steps: [], sounds: [], broadcasts: [], calls: [] }, { winBookEventAmount: 0 }),
);
// `featureCountedIntoBar` is the module's own `let`, which the beat reads and resets.
const BODY = `let featureCountedIntoBar = countedIntoBar;\n${slice}\nreturn presentHoldAndWinEnd;`;
const NAMES = [...STUB_NAMES, 'countedIntoBar'];
assertStubSetIsComplete({ what: FIXTURE, body: BODY, stubNames: NAMES });
const compiled = compileSlice({
	what: `${FIXTURE}: ${SOURCE}#presentHoldAndWinEnd`,
	names: NAMES,
	body: BODY,
});

const run = async ({
	start,
	total,
	payload,
	countedIntoBar = 0,
}: {
	start: number;
	total: number;
	payload: HoldAndWinTally;
	countedIntoBar?: number;
}) => {
	const rec: Recorder = { steps: [], sounds: [], broadcasts: [], calls: [] };
	const stateBet = { winBookEventAmount: start };
	const stubs = stubsFor(rec, stateBet);
	const present = compiled(
		...STUB_NAMES.map((name) => stubs[name as keyof typeof stubs]),
		countedIntoBar,
	);
	let error: unknown;
	try {
		await present({ type: 'holdAndWinEnd', mode: 'holdAndWin', total, payload });
	} catch (caught) {
		error = caught;
	}
	return { ...rec, bar: stateBet.winBookEventAmount, error };
};

let failures = 0;
const check = (name: string, actual: unknown, expected: unknown) => {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (!ok) failures++;
	console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`);
	if (!ok)
		console.log(
			`       expected ${JSON.stringify(expected)}\n       actual   ${JSON.stringify(actual)}`,
		);
};

const coin = (reel: number, row: number, amount: number, name = 'COIN') => ({
	reel,
	row,
	amount,
	symbol: { name },
});

// 1. Coins and a banked jackpot (an expansion's row jackpot, `pots-expansion-fullrow`).
{
	const r = await run({
		start: 100,
		total: 1000 + 60,
		payload: {
			cells: [coin(0, 0, 20, 'COIN_A'), coin(1, 2, 30, 'COIN_B'), coin(2, 1, 10, 'COIN_C')],
			banked: 1000,
		},
	});
	check(
		'1. the beat does not throw',
		r.error === undefined ? 'no error' : String(r.error),
		'no error',
	);
	check(
		'1. each coin steps the bar as it lands, then the banked step',
		r.steps.map(({ index, amount, total }) => [index, amount, total]),
		[
			[2, 10, 110],
			[1, 30, 140],
			[0, 20, 160],
			[3, 1000, 1160],
		],
	);
	check('1. every coin sounds once, the banked step not at all', r.sounds, [
		'COIN_C',
		'COIN_B',
		'COIN_A',
	]);
	check('1. the bar lands on start + total', r.bar, 1160);
	check('1. the beat runs on to the board coming down', r.calls, [
		'settleReelsOnHeldCells',
		'hideRespinBoard',
		'closeEnhancements',
	]);
	check('1. the trigger wins are forgotten', r.broadcasts.includes('winPresentationForget'), true);
}

// 2. Nothing banked.
{
	const r = await run({
		start: 0,
		total: 50,
		payload: { cells: [coin(0, 0, 20), coin(0, 1, 30)], banked: 0 },
	});
	check('2. no error', r.error === undefined, true);
	check(
		'2. one step per coin, no extra step',
		r.steps.map(({ index }) => index),
		[1, 0],
	);
	check('2. the bar lands on start + total', r.bar, 50);
}

// 3. Banked, but already counted into the bar by the column sweeps' own beats.
{
	const r = await run({
		start: 400,
		total: 300 + 50,
		countedIntoBar: 300,
		payload: { cells: [coin(0, 0, 20), coin(0, 1, 30)], banked: 300 },
	});
	check('3. no error', r.error === undefined, true);
	check(
		'3. one step per coin, no extra step',
		r.steps.map(({ index }) => index),
		[1, 0],
	);
	check('3. the bar lands on start + total less what it already counted', r.bar, 450);
}

// 4. Only a banked part: no coin is left to fly.
{
	const r = await run({ start: 10, total: 500, payload: { cells: [], banked: 500 } });
	check('4. no error', r.error === undefined ? 'no error' : String(r.error), 'no error');
	check(
		'4. one banked step, no sound',
		[r.steps.map(({ index, amount, total }) => [index, amount, total]), r.sounds],
		[[[0, 500, 510]], []],
	);
}

// 5. A lineFill coin board with a banked part.
{
	const r = await run({
		start: 0,
		total: 200 + 50,
		payload: {
			payRule: 'lineFill',
			cells: [coin(0, 0, 20), coin(1, 0, 30), coin(2, 1, 0)],
			runs: [
				{
					id: 'L1',
					cells: [
						{ reel: 0, row: 0 },
						{ reel: 1, row: 0 },
					],
					total: 50,
				},
			],
			banked: 200,
		},
	});
	check('5. no error', r.error === undefined ? 'no error' : String(r.error), 'no error');
	check(
		"5. the run's coins, then the banked step",
		r.steps.map(({ index, total }) => [index, total]),
		[
			[1, 30],
			[0, 50],
			[2, 250],
		],
	);
	check('5. only the flown coins sound', r.sounds.length, 2);
}

if (failures) {
	console.error(`\n${FIXTURE}: ${failures} check(s) failed`);
	process.exit(1);
}
console.log(`\n${FIXTURE}: all checks pass`);
