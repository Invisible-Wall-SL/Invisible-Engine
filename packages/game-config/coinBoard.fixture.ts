/**
 * Offline fixture for the COIN BOARD block (`docs/design/hold-and-win-coin-board.md` §2, Phase 13a).
 *   pnpm check:all --only coinBoard.fixture
 *
 * Claims:
 *  1. PARITY. Every committed default but the coin board template normalizes with no `coinBoard`,
 *     its base game on the reels and no `coinBoard` in its mock inputs.
 *  2. The block is a normalize fixed point: garbage becomes a fixed board the validator names, a
 *     line-fill run is kept only under `lineFill`, and an overlay needs a colour and an alpha.
 *  3. The paying cells are every cell an active payline passes through: 5 on the middle line, all 15
 *     with the three rows; `player` lines are the first N of the order.
 *  4. The base game resolves to the respin board with the block, whatever an override says, and the
 *     "base game plays on the reels" error stands without it.
 *  5. The validator names every impossible board (lines, choices, order, trigger minimums, run,
 *     overlay) and the neighbours it does not support (no respin mode, dropped tokens, line symbols);
 *     the pots add-on refuses a coin board.
 *  6. The `holdAndWin.coinBoard` default validates clean, deals only role symbols and hands its
 *     block to the mock.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	activePaylineIds,
	coinBoardTriggerMin,
	defaultCoinBoard,
	normalizeCoinBoard,
	payingCellCount,
	payingCells,
	type CoinBoard,
} from './src/coinBoard.ts';
import { addPotsOverlay } from './src/addOns.ts';
import { holdAndWinMockInputs } from './src/holdAndWinMock.ts';
import { gameModeById, resolveGameModes } from './src/modes.ts';
import { normalizeGameConfigDoc } from './src/normalize.ts';
import { validateGameConfigDoc } from './src/validate.ts';
import type { GameConfigDoc } from './src/types.ts';

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

const ROOT = dirname(fileURLToPath(import.meta.url));
const DEFAULTS = join(ROOT, '../../apps/launcher-api/src/lib/data/gameConfig');
const load = (name: string): GameConfigDoc =>
	normalizeGameConfigDoc(JSON.parse(readFileSync(join(DEFAULTS, name), 'utf8')))!;
const COIN_BOARD_DEFAULT = 'holdAndWin.coinBoard.json';

console.log('\n1. parity — no block, no change');
const defaults = readdirSync(DEFAULTS).filter((name: string) => name.endsWith('.json'));
check('the coin board template is committed', defaults.includes(COIN_BOARD_DEFAULT), true);
for (const name of defaults.filter((n: string) => n !== COIN_BOARD_DEFAULT)) {
	const doc = load(name);
	check(`${name} has no coin board`, doc.coinBoard, undefined);
	check(`${name} plays its base game on the reels`, gameModeById(doc, 'basegame')?.board, 'reels');
	check(`${name} raises no coin board issue`, coinBoardIssues(doc), []);
	if (name.startsWith('holdAndWin.')) {
		check(
			`${name}'s mock inputs carry no coin board`,
			holdAndWinMockInputs(doc)?.coinBoard,
			undefined,
		);
	}
}

console.log('\n2. normalize');
const fixed: CoinBoard = {
	lines: { selection: 'fixed', active: ['1'] },
	payRule: 'coinsOnLines',
	triggerMin: { '1': 3 },
};
check('a canonical board is a fixed point', normalizeCoinBoard(fixed), fixed);
check('not an object is no board', normalizeCoinBoard('yes'), undefined);
check('an empty object is a fixed board with no lines', normalizeCoinBoard({}), {
	lines: { selection: 'fixed', active: [] },
	payRule: 'coinsOnLines',
	triggerMin: {},
});
check(
	'player lines keep their choices, default and order; junk entries go',
	normalizeCoinBoard({
		lines: {
			selection: 'player',
			choices: [1, 'x', 3, 2.5],
			default: 3,
			order: ['1', ' 2 ', 7, ''],
		},
		payRule: 'perLine',
		triggerMin: { '1': 3, '3': 'six', '5': 4.5 },
	}),
	{
		lines: { selection: 'player', choices: [1, 3], default: 3, order: ['1', '2'] },
		payRule: 'perLine',
		triggerMin: { '1': 3 },
	},
);
check(
	'a player board with no default takes its first choice',
	normalizeCoinBoard({ lines: { selection: 'player', choices: [3, 5], order: [] } })?.lines,
	{ selection: 'player', choices: [3, 5], default: 3, order: [] },
);
check(
	'an unknown pay rule is coinsOnLines',
	normalizeCoinBoard({ ...fixed, payRule: 'sideways' })?.payRule,
	'coinsOnLines',
);
check(
	'a run length is kept under lineFill',
	normalizeCoinBoard({ ...fixed, payRule: 'lineFill', lineFill: { min: 4 } })?.lineFill,
	{ min: 4 },
);
check(
	'…and dropped under any other rule',
	normalizeCoinBoard({ ...fixed, lineFill: { min: 4 } })?.lineFill,
	undefined,
);
check(
	'the overlay colour is canonicalized',
	normalizeCoinBoard({ ...fixed, inactiveOverlay: { color: '#ABC', alpha: 0.5 } })?.inactiveOverlay,
	{ color: '#aabbcc', alpha: 0.5 },
);
check(
	'an overlay with a bad colour is dropped',
	normalizeCoinBoard({ ...fixed, inactiveOverlay: { color: 'dark', alpha: 0.5 } })?.inactiveOverlay,
	undefined,
);

console.log('\n3. paying cells');
const template = load(COIN_BOARD_DEFAULT);
const { paylines } = template;
const count = (cells: boolean[][]) => cells.flat().filter(Boolean).length;
check('the middle line pays on 5 cells', count(payingCells(paylines, ['1'], template)), 5);
check(
	'…the middle row of every reel',
	payingCells(paylines, ['1'], template).map((reel) => reel.indexOf(true)),
	[1, 1, 1, 1, 1],
);
check('the three rows pay on all 15', count(payingCells(paylines, ['1', '2', '3'], template)), 15);
check('the two Vs pay on 8', count(payingCells(paylines, ['4', '5'], template)), 8);
check('an unknown line pays nowhere', count(payingCells(paylines, ['99'], template)), 0);
check(
	'a fixed board lists its real lines once, in its order',
	activePaylineIds(
		{ ...fixed, lines: { selection: 'fixed', active: ['3', '1', '3', '99'] } },
		paylines,
	),
	['3', '1'],
);
const player: CoinBoard = {
	lines: { selection: 'player', choices: [1, 3, 5], default: 3, order: ['1', '2', '3', '4', '5'] },
	payRule: 'coinsOnLines',
	triggerMin: { '1': 3, '3': 6, '5': 6 },
};
check(
	'player lines default to the first `default` of the order',
	activePaylineIds(player, paylines),
	['1', '2', '3'],
);
check('…or the first N picked', activePaylineIds(player, paylines, 1), ['1']);
check('a fixed board ignores the count', activePaylineIds(fixed, paylines, 5), ['1']);
check(
	'paying cells per choice',
	[1, 3, 5].map((n) => payingCellCount(template, player, n)),
	[5, 15, 15],
);
check('the trigger minimum of the default choice', coinBoardTriggerMin(player), 6);
check('…of a picked choice', coinBoardTriggerMin(player, 1), 3);
check('…of a fixed board, its active count', coinBoardTriggerMin(fixed), 3);
check('…of a count the board states none for', coinBoardTriggerMin(player, 2), undefined);
check('the default board: every line, a reachable minimum', defaultCoinBoard(template), {
	lines: { selection: 'fixed', active: ['1', '2', '3', '4', '5'] },
	payRule: 'coinsOnLines',
	triggerMin: { '5': 6 },
});

console.log('\n4. the base game');
check(
	'the coin board puts the base game on the respin board',
	resolveGameModes(template).map((m) => [m.id, m.board]),
	[
		['basegame', 'respinBoard'],
		['freeSpins', 'reels'],
		['holdAndWin', 'respinBoard'],
	],
);
check(
	'…whatever an override names',
	gameModeById(
		{ ...template, modes: [{ id: 'basegame', board: 'reels', label: 'Coins' }] },
		'basegame',
	),
	{ id: 'basegame', board: 'respinBoard', label: 'Coins' },
);
const plain = load('holdAndWin.plain.json');
check(
	'without the block, a base game off the reels is still refused',
	validateGameConfigDoc({
		...plain,
		modes: [...(plain.modes ?? []), { id: 'basegame', board: 'respinBoard' }],
	})
		.filter((i) => i.path === 'modes.basegame.board')
		.map((i) => i.severity),
	['error'],
);

console.log('\n5. validation');
function coinBoardIssues(doc: GameConfigDoc): string[] {
	return validateGameConfigDoc(doc)
		.filter((i) => i.path.startsWith('coinBoard') || i.path.startsWith('modes'))
		.map((i) => `${i.severity} ${i.path}`);
}
const withBoard = (coinBoard: CoinBoard, extra: Partial<GameConfigDoc> = {}) =>
	coinBoardIssues({ ...template, ...extra, coinBoard });
check('the template is clean', coinBoardIssues(template), []);
check(
	'the middle line with a minimum of 6 can never trigger',
	withBoard({ ...fixed, triggerMin: { '1': 6 } }),
	['error coinBoard.triggerMin.1'],
);
check('…and 5 is reachable', withBoard({ ...fixed, triggerMin: { '1': 5 } }), []);
check(
	'unknown and repeated lines',
	withBoard({
		...fixed,
		lines: { selection: 'fixed', active: ['1', '9', '1'] },
		triggerMin: { '2': 3 },
	}),
	['error coinBoard.lines.active.1', 'error coinBoard.lines.active.2'],
);
check(
	'no active line',
	withBoard({ ...fixed, lines: { selection: 'fixed', active: [] }, triggerMin: { '0': 1 } }),
	['error coinBoard.lines.active', 'error coinBoard.triggerMin.0'],
);
check('the player board is clean', withBoard(player), []);
check(
	'choices out of range, repeated, a default off them, an order too short',
	withBoard({
		...player,
		lines: { selection: 'player', choices: [0, 3, 3, 6], default: 4, order: ['1', '2', '3'] },
		triggerMin: { '0': 1, '3': 6, '6': 6 },
	}),
	[
		'error coinBoard.lines.choices.0',
		'error coinBoard.lines.choices.2',
		'error coinBoard.lines.choices.3',
		'error coinBoard.lines.default',
		'error coinBoard.lines.order',
		'error coinBoard.triggerMin.0',
	],
);
check(
	'a choice with no minimum, and a minimum with no choice',
	withBoard({ ...player, triggerMin: { '1': 3, '3': 6, '4': 6 } }),
	['error coinBoard.triggerMin', 'warning coinBoard.triggerMin.4'],
);
check(
	'a run longer than the reels',
	withBoard({ ...fixed, payRule: 'lineFill', lineFill: { min: 6 } }),
	['error coinBoard.lineFill.min'],
);
check(
	'an overlay alpha above 1',
	withBoard({ ...fixed, inactiveOverlay: { color: '#000000', alpha: 1.5 } }),
	['error coinBoard.inactiveOverlay.alpha'],
);
check(
	'a coin board with no respin mode',
	withBoard(fixed, { modes: undefined, coinOverlay: undefined }).filter(
		(i) => i === 'error coinBoard',
	),
	['error coinBoard'],
);
check(
	'a line symbol on the base strips',
	withBoard(fixed, {
		symbols: { ...template.symbols, H1: { paytable: [{ '3': 1 }] } },
		paddingReels: {
			...template.paddingReels,
			basegame: template.paddingReels.basegame.map((reel) => [...reel, { name: 'H1' }]),
		},
	}),
	['warning coinBoard'],
);
check('a coin board with no paylines', withBoard(fixed, { paylines: {} }), [
	'error coinBoard.lines',
	'error coinBoard.lines.active.0',
	'error coinBoard.triggerMin.1',
]);

check('adding pots to a coin board is refused', addPotsOverlay(template, 'threePots').ok, false);

console.log('\n6. the coin board template');
check(
	'every issue of the template',
	validateGameConfigDoc(template).map((i) => `${i.severity} ${i.path}`),
	[],
);
check('it deals only role symbols', Object.keys(template.symbols).sort(), [
	'BLANK',
	'BONUS',
	'JACKPOT',
]);
const inputs = holdAndWinMockInputs(template);
check('the mock gets its block', inputs?.coinBoard, template.coinBoard);
check('…and no line symbol', inputs?.lineSymbols, []);
check('…and the primary respin rules', inputs?.block.respins, { start: 3, reset: 'anyCoin' });

console.log(failures === 0 ? '\nAll coin board assertions passed.\n' : `\n${failures} FAILED\n`);
process.exit(failures === 0 ? 0 : 1);
