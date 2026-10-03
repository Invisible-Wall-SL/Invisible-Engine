/**
 * Offline fixture for the POTS OVERLAY picture (`docs/design/pots-overlay.md` §3.2, §3.4) — run with
 * node:
 *   node --experimental-strip-types --import ./scripts/ts-loader.mjs packages/engine-game/src/game/potsOverlay.fixture.ts
 *
 * Claims:
 *  1. A drop puts its tokens down, one per cell; the next base board or cascade step clears them (a
 *     coin that did not fly is gone).
 *  2. A pot's fill lifts exactly its own tokens at its `from` cells, and nothing else.
 *  3. A Hold and Win feature's END clears the base board's tokens — not its entry, whose drain plays
 *     over the base board with the coins still on it.
 *  4. A mode entry a pot started drains that pot — free spins and a generic mode alike; Hold and
 *     Win's own reducer drains its pots, so it is not drained twice; nothing else drains anything.
 *  5. A resume after free spins that gave way to a pot's bonus does not reopen them; a plain
 *     free-spin round resumes as before.
 *  6. A board's reveal finds its own drop ahead of it (for per-reel timing), never the next board's.
 */

import {
	applyOverlayEvent,
	boardDropCells,
	drainedMeters,
	drainMeters,
	emptyOverlayState,
	freeSpinsGaveWay,
	type OverlayState,
} from './potsOverlay.ts';

type Event = { type: string } & Record<string, unknown>;
/** A book event as the fixture writes it — any fields, the shape the reducers take. */
const ev = (event: Event) => event as { type: string };

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

const fold = (events: Event[], from = emptyOverlayState()) =>
	events.map(ev).reduce<OverlayState>(applyOverlayEvent, from);

const RED = { reel: 0, row: 1, token: 'RED', pot: 'red' };
const RED_2 = { reel: 3, row: 0, token: 'RED', pot: 'red' };
const GREEN = { reel: 1, row: 1, token: 'GREEN', pot: 'green' };
const COIN = { reel: 2, row: 2, token: 'COIN', value: 2 };
const drop = { type: 'overlayDrop', cells: [RED, RED_2, GREEN, COIN] };

console.log('\n1. a drop, then the next board');
const dropped = fold([{ type: 'reveal' }, drop]);
check('the tokens go down as dropped', dropped.tokens, [RED, RED_2, GREEN, COIN]);
check('the next base board clears them', fold([{ type: 'reveal' }], dropped).tokens, []);
check('so does a cascade step', fold([{ type: 'tumbleBoard' }], dropped).tokens, []);
check(
	'one token per cell: the last named wins',
	fold([{ type: 'overlayDrop', cells: [RED, { ...COIN, reel: 0, row: 1 }] }]).tokens,
	[{ ...COIN, reel: 0, row: 1 }],
);
check(
	'an event that touches no token keeps the same picture',
	applyOverlayEvent(dropped, ev({ type: 'winInfo' })) === dropped,
	true,
);

console.log('\n2. a pot fills');
const lifted = applyOverlayEvent(
	dropped,
	ev({
		type: 'meterUpdate',
		meter: 'red',
		from: [
			{ reel: 0, row: 1, symbol: { name: 'RED' } },
			{ reel: 3, row: 0, symbol: { name: 'RED' } },
		],
	}),
);
check('its own tokens lift, the others stay', lifted.tokens, [GREEN, COIN]);
check(
	'a fill naming another pot at a red cell lifts nothing',
	applyOverlayEvent(
		dropped,
		ev({
			type: 'meterUpdate',
			meter: 'green',
			from: [{ reel: 0, row: 1, symbol: { name: 'RED' } }],
		}),
	) === dropped,
	true,
);

console.log('\n3. Hold and Win');
check(
	'its entry keeps the coins on the base board while the pots drain',
	applyOverlayEvent(lifted, ev({ type: 'holdAndWinTrigger', cause: 'meter' })) === lifted,
	true,
);
check(
	'its end clears them: the base board returns with the host’s symbols',
	applyOverlayEvent(lifted, ev({ type: 'holdAndWinEnd', total: 0 })).tokens,
	[],
);

console.log('\n4. a pot-started mode drains its pot');
check(
	'free spins a pot started',
	drainedMeters(ev({ type: 'freeSpinTrigger', totalFs: 10, cause: 'meter', meters: ['green'] })),
	['green'],
);
check(
	'a generic mode a pot started',
	drainedMeters(ev({ type: 'modeEnter', mode: 'pickBonus', cause: 'meter', meters: ['blue'] })),
	['blue'],
);
check(
	'Hold and Win drains in its own reducer, not here',
	drainedMeters(
		ev({
			type: 'holdAndWinTrigger',
			mode: 'holdAndWin',
			cause: 'meter',
			payload: { meters: ['red'] },
		}),
	),
	[],
);
check(
	'scatter-started free spins drain nothing',
	drainedMeters(ev({ type: 'freeSpinTrigger', totalFs: 10, positions: [] })),
	[],
);
check('a non-entry drains nothing', drainedMeters(ev({ type: 'meterUpdate', meter: 'red' })), []);
const levels = [
	{ id: 'red', level: 5, max: 5 },
	{ id: 'green', level: 5, max: 5 },
];
check('the drained pots read empty, the rest keep their level', drainMeters(levels, ['green']), [
	{ id: 'red', level: 5, max: 5 },
	{ id: 'green', level: 0, max: 5 },
]);
check('draining nothing keeps the same list', drainMeters(levels, []) === levels, true);

console.log('\n5. resume');
// The hub's round: a book host's own free spins, then the pot's Hold and Win, cut mid-respins — the
// resume snapshot's events in book order.
const hostThenPot = [
	{ type: 'freeSpinTrigger' },
	{ type: 'updateFreeSpin' },
	{ type: 'setTotalWin' },
	{ type: 'freeSpinEnd' },
	{ type: 'holdAndWinTrigger' },
	{ type: 'meterLevels' },
	{ type: 'holdAndWinState' },
];
check('free spins a pot bonus followed are not reopened', freeSpinsGaveWay(hostThenPot), true);
check(
	'…nor when a stub mode followed them',
	freeSpinsGaveWay([{ type: 'freeSpinTrigger' }, { type: 'freeSpinEnd' }, { type: 'modeEnter' }]),
	true,
);
check(
	'a plain free-spin round cut after its end resumes as it always has',
	freeSpinsGaveWay([
		{ type: 'freeSpinTrigger' },
		{ type: 'updateFreeSpin' },
		{ type: 'freeSpinEnd' },
	]),
	false,
);
check(
	'a round cut mid-free-spins is untouched',
	freeSpinsGaveWay([{ type: 'freeSpinTrigger' }, { type: 'updateFreeSpin' }]),
	false,
);
check(
	'a retrigger after an earlier end counts as playing again',
	freeSpinsGaveWay([
		{ type: 'freeSpinTrigger' },
		{ type: 'freeSpinEnd' },
		{ type: 'holdAndWinTrigger' },
		{ type: 'freeSpinTrigger' },
	]),
	false,
);

console.log('\n6. the drop a reveal shows');
const reveal1 = ev({ type: 'reveal' });
const reveal2 = ev({ type: 'reveal' });
const drop2 = ev({ type: 'overlayDrop', cells: [GREEN] });
check(
	'the drop after a reveal, past its other events',
	boardDropCells([reveal1, ev({ type: 'winInfo' }), ev(drop)], reveal1),
	[RED, RED_2, GREEN, COIN],
);
check(
	'a board with no drop finds none, not the next board’s',
	boardDropCells([reveal1, reveal2, drop2], reveal1),
	[],
);
check('…and the next board finds its own', boardDropCells([reveal1, reveal2, drop2], reveal2), [
	GREEN,
]);
check(
	'a cascade step is a new board too',
	boardDropCells([reveal1, ev({ type: 'tumbleBoard' }), drop2], reveal1),
	[],
);
check(
	'a cell the drop names twice is one token, the last named',
	boardDropCells(
		[reveal1, ev({ type: 'overlayDrop', cells: [RED, { ...COIN, reel: 0, row: 1 }] })],
		reveal1,
	),
	[{ ...COIN, reel: 0, row: 1 }],
);
check('a reveal not in the book finds nothing', boardDropCells([reveal1, drop2], reveal2), []);

if (failures > 0) throw new Error(`${failures} pots-overlay assertion(s) failed.`);
console.log('\nAll pots-overlay assertions passed.');
