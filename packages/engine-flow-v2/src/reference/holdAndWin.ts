/**
 * Invisible Flow v2 — the `holdAndWin` template vocabulary (`docs/design/hold-and-win.md` §5, Flow).
 *
 * A Hold and Win game is the STANDARD shared-runtime vocabulary minus what the kind does not use, plus
 * the respin feature. Transcribed from the runtime's real code, like every other vocabulary:
 *  - **events** — `engine-game` `HoldAndWinEventFields` (`holdAndWin.ts`), field for field. Positions
 *    are VISIBLE 0-based (the respin board has no padding row); a coin's value, jackpot label and
 *    factor ride on its cell's `symbol`; amounts are book-event units, like every other win amount.
 *  - **actions** — the `apps/lines` `flowEffects.ts` Hold and Win effects. Each per-beat effect is the
 *    SAME function the coded handler of its event calls (`holdAndWinPresentation.ts`) and takes the
 *    whole event as `bookEvent` (feed it `$trigger`), so a flow that owns an event presents it exactly
 *    as the coded path does. `flyTo` is the one effect with typed inputs.
 *  - **cues** — `RespinBoard.svelte`'s `EmitterEventRespinBoard` + `engine-game`'s
 *    `EmitterEventFlight`. Each beat broadcasts its own cues, so they are NOTIFICATIONS for authored
 *    sound and FX: firing one does not move the board.
 *  - **values** — `linesEngineReader`'s Hold and Win keys.
 *
 * DROPPED from the standard palette, mirroring `kindCapabilities('holdAndWin')` (engine-layout; this
 * package cannot import it, so `check:flow-publish-gate` pins the two together): the free-spin
 * surfaces (`freeSpins: false` — the feature is the respins) and stacked pictures
 * (`stackedPictures: false`). The Book-of, cascade and multiplier-board entries were never part of
 * the standard vocabulary, so a kind built on it does not have them.
 *
 * NOT DECLARED until the runtime backs them (a declared action with no effect is a validator error
 * and blocks Publish): `lightLetter` / `clearColumn` (Grand's column letters, `columnComplete`) and
 * `spinWheel` (Hotfire's wheel, `holdAndWinWheel`). Their events ARE declared, and an unowned event
 * falls through to the coded path. The design's `activateMeter`, `countUpTotal` and `awardJackpot` are
 * parts of `showRespinBoard` (pots drain at a meter entry), `hideRespinBoard` (the Total Win bar
 * counts up per coin) and `showJackpotWin`; the per-meter `meter.<id>.level` is a HUD value source
 * (`registerComponentValues`), not a flow value, because a vocabulary cannot name a project's meters.
 */

import type { TemplateVocabulary, TypeRef } from '../types';

import { SYMBOL, INT, list, insertAfter, standardVocabulary } from './standardVocab';

const FLOAT: TypeRef = { t: 'float' };
const STRING: TypeRef = { t: 'string' };
const BOOL: TypeRef = { t: 'bool' };
const MS: TypeRef = { t: 'ms' };
const POSITION: TypeRef = { t: 'struct', name: 'Position' };
const CELL: TypeRef = { t: 'struct', name: 'HoldAndWinCell' };
const CELL_AMOUNT: TypeRef = { t: 'struct', name: 'HoldAndWinCellAmount' };
const COIN_CHANGE: TypeRef = { t: 'struct', name: 'HoldAndWinCoinChange' };
const MYSTERY_CELL: TypeRef = { t: 'struct', name: 'HoldAndWinMysteryCell' };
const METER_LEVEL: TypeRef = { t: 'struct', name: 'HoldAndWinMeterLevel' };
const BOOK_EVENT: TypeRef = { t: 'struct', name: 'BookEvent' };
const CAUSE: TypeRef = { t: 'enum', name: 'HoldAndWinCause' };
const SPECIAL: TypeRef = { t: 'enum', name: 'HoldAndWinSpecial' };
const JACKPOT_SOURCE: TypeRef = { t: 'enum', name: 'HoldAndWinJackpotSource' };
const STICKINESS: TypeRef = { t: 'enum', name: 'Stickiness' };

/**
 * The symbols the three presets deal (`game-config` `holdAndWinPresets.ts`): the line symbols, the
 * coin, the jackpot coin, the specials and the blank.
 */
const HOLD_AND_WIN_SYMBOLS = [
	'H1',
	'H2',
	'H3',
	'H4',
	'L1',
	'L2',
	'L3',
	'L4',
	'W',
	'BONUS',
	'JACKPOT',
	'BOOST',
	'COLLECT',
	'MULTI',
	'MYSTERY',
	'BLANK',
] as const;

/** `engine-game` `HoldAndWinCause`. */
export const HOLD_AND_WIN_CAUSES = ['count', 'pattern', 'meter', 'luckySpin', 'randomMetre', 'buy'];
/** `game-config` `HOLD_AND_WIN_SPECIALS`. */
export const HOLD_AND_WIN_SPECIAL_KINDS = ['collector', 'multiplier', 'payer', 'mystery'];
/** `engine-game` `HoldAndWinJackpotSource`. */
export const HOLD_AND_WIN_JACKPOT_SOURCES = [
	'coin',
	'collect',
	'column',
	'instantCollect',
	'wheel',
	'letters',
	'fullBoard',
];
/** `game-config` `STICKINESS`. */
export const HOLD_AND_WIN_STICKINESS = ['allCoins', 'collectorsOnly'];

/** The jackpot tiers every preset names — each a `jackpot.<tier>` value. */
const JACKPOT_TIERS = ['mini', 'minor', 'major', 'grand'] as const;

const cell = (name: string, description: string) => ({ name, type: CELL, description });
const cells = (description: string) => ({ name: 'cells', type: list(CELL), description });

const STRUCTS: TemplateVocabulary['structs'] = [
	{
		name: 'HoldAndWinSymbol',
		fields: [
			{ name: 'name', type: SYMBOL },
			{ name: 'value', type: FLOAT },
			{ name: 'jackpot', type: STRING },
			{ name: 'factor', type: FLOAT },
		],
	},
	{
		name: 'HoldAndWinCell',
		fields: [
			{ name: 'reel', type: INT },
			{ name: 'row', type: INT },
			{ name: 'symbol', type: { t: 'struct', name: 'HoldAndWinSymbol' } },
		],
	},
	{
		name: 'HoldAndWinCellAmount',
		fields: [
			{ name: 'reel', type: INT },
			{ name: 'row', type: INT },
			{ name: 'symbol', type: { t: 'struct', name: 'HoldAndWinSymbol' } },
			{ name: 'amount', type: FLOAT },
		],
	},
	{
		name: 'HoldAndWinCoinChange',
		fields: [
			{ name: 'reel', type: INT },
			{ name: 'row', type: INT },
			{ name: 'from', type: FLOAT },
			{ name: 'to', type: FLOAT },
			{ name: 'jackpot', type: STRING },
		],
	},
	{
		name: 'HoldAndWinMysteryCell',
		fields: [
			{ name: 'reel', type: INT },
			{ name: 'row', type: INT },
			{ name: 'symbol', type: { t: 'struct', name: 'HoldAndWinSymbol' } },
			{ name: 'becomes', type: STRING },
		],
	},
	{
		name: 'HoldAndWinMeterLevel',
		fields: [
			{ name: 'id', type: STRING },
			{ name: 'level', type: INT },
			{ name: 'max', type: INT },
		],
	},
	{
		name: 'HoldAndWinEntry',
		fields: [
			{ name: 'cells', type: list(CELL) },
			{ name: 'respins', type: INT },
			{ name: 'stickiness', type: STICKINESS },
			{ name: 'activeModifiers', type: list(SPECIAL) },
			{ name: 'meters', type: list(STRING) },
		],
	},
	{
		name: 'HoldAndWinTally',
		fields: [
			{ name: 'cells', type: list(CELL_AMOUNT) },
			{ name: 'banked', type: FLOAT },
		],
	},
	{
		name: 'HoldAndWinSnapshot',
		fields: [
			{ name: 'cells', type: list(CELL) },
			{ name: 'start', type: INT },
			{ name: 'left', type: INT },
			{ name: 'played', type: INT },
			{ name: 'banked', type: FLOAT },
			{ name: 'total', type: FLOAT },
			{ name: 'stickiness', type: STICKINESS },
			{ name: 'activeModifiers', type: list(SPECIAL) },
			{ name: 'collectorLevel', type: INT },
			{ name: 'coinBoost', type: FLOAT },
			{ name: 'lettersLit', type: list(INT) },
		],
	},
	{
		name: 'HoldAndWinWheelPrize',
		fields: [
			{ name: 'type', type: STRING },
			{ name: 'multiplier', type: FLOAT },
			{ name: 'count', type: INT },
			{ name: 'jackpot', type: STRING },
		],
	},
	// The whole book event a per-beat action presents — what `$trigger` (no field) carries.
	{ name: 'BookEvent', fields: [{ name: 'type', type: STRING }] },
];

const ENUMS: TemplateVocabulary['enums'] = [
	{ name: 'HoldAndWinCause', values: HOLD_AND_WIN_CAUSES },
	{ name: 'HoldAndWinSpecial', values: HOLD_AND_WIN_SPECIAL_KINDS },
	{ name: 'HoldAndWinJackpotSource', values: HOLD_AND_WIN_JACKPOT_SOURCES },
	{ name: 'Stickiness', values: HOLD_AND_WIN_STICKINESS },
];

/** The base-game Hold and Win events — they ride on a base spin, so they follow `reveal`. */
const BASE_EVENTS: TemplateVocabulary['events'] = [
	{
		name: 'luckySpin',
		payload: [],
		category: 'book',
		description:
			'The server announced a Lucky Spin: the next reveal is guaranteed to trigger the feature. Wire it to the "LUCKY SPIN" intro, which also makes that reveal anticipate on every reel and run unskippable.',
	},
	{
		name: 'meterUpdate',
		payload: [
			{ name: 'meter', type: STRING, description: 'The meter (pot) id.' },
			{ name: 'level', type: INT, description: 'Its level after this spin.' },
			{ name: 'max', type: INT, description: 'The level that fills it.' },
			{ name: 'full', type: BOOL, description: 'This update filled it.' },
			{
				name: 'from',
				type: list(CELL),
				description: 'The specials on the base board that fill it (one level each).',
			},
			{
				name: 'forced',
				type: BOOL,
				optional: true,
				description: 'An authoring force set the level one short first.',
			},
		],
		category: 'book',
		description:
			'Specials landed in the base game and fill a persistent meter (pot). Wire it to fly them into their pot, which ticks a level per arrival and pulses when full.',
	},
	{
		name: 'meterLevels',
		payload: [
			{
				name: 'meters',
				type: list(METER_LEVEL),
				description: 'Every meter, as the server holds it.',
			},
		],
		category: 'book',
		description:
			'The server restating every meter after a play. Recorded automatically; nothing to present.',
	},
	{
		name: 'coinInstantCollect',
		payload: [
			{ name: 'specials', type: list(CELL), description: 'The specials that collect.' },
			{ name: 'multiplier', type: FLOAT, description: 'What each collect multiplies by.' },
			{ name: 'times', type: INT, description: 'How many times the coins are collected.' },
			{ name: 'cells', type: list(CELL_AMOUNT), description: 'The coins collected.' },
			{ name: 'amount', type: FLOAT, description: 'What the collect paid.' },
		],
		category: 'book',
		description:
			'A base-game instant collect: a special collects every coin on the board without the feature.',
	},
	{
		name: 'randomMetreTrigger',
		payload: [
			{ name: 'name', type: STRING, description: 'The random metre that fired.' },
			cells('The coins it dropped onto the board.'),
		],
		category: 'book',
		description: 'A random metre fired on a base spin and dropped coins to start the feature.',
	},
];

/** The feature's own events, in the order a round plays them. */
const FEATURE_EVENTS: TemplateVocabulary['events'] = [
	{
		name: 'holdAndWinTrigger',
		payload: [
			{ name: 'mode', type: STRING, description: 'The mode it opens (`holdAndWin`).' },
			{ name: 'cause', type: CAUSE, description: 'Why the feature started.' },
			{
				name: 'payload',
				type: { t: 'struct', name: 'HoldAndWinEntry' },
				description: 'What sticks, the respins, the stickiness and the active modifiers.',
			},
		],
		category: 'book',
		description:
			'The Hold and Win feature starts. Wire it to swap the reels for the respin board with the triggering coins held (and, for a meter entry, drain the pots that bought it).',
	},
	{
		name: 'holdAndWinWheel',
		payload: [
			{ name: 'index', type: INT, description: 'The wheel segment it stopped on.' },
			{
				name: 'prize',
				type: { t: 'struct', name: 'HoldAndWinWheelPrize' },
				description: 'What the segment awards.',
			},
		],
		category: 'book',
		description: 'The entry wheel stopped on a prize (a coin boost, extra collects or a jackpot).',
	},
	{
		name: 'respinReveal',
		payload: [cells('Every cell after the respin.')],
		category: 'book',
		description:
			'One respin: the free cells spin onto what the server named. Wire it to spin the respin board.',
	},
	{
		name: 'coinsLand',
		payload: [cells('The cells that landed and stick.')],
		category: 'book',
		description: 'New coins (or specials) landed on the respin and stick.',
	},
	{
		name: 'mysteryReveal',
		payload: [
			{
				name: 'cells',
				type: list(MYSTERY_CELL),
				description: 'Each mystery and what it became.',
			},
			{
				name: 'activates',
				type: list(SPECIAL),
				description: 'The modifiers it unlocked for the rest of the feature.',
			},
		],
		category: 'book',
		description: 'Mystery symbols opened into coins, jackpots or specials.',
	},
	{
		name: 'coinPay',
		payload: [
			cell('payer', 'The payer.'),
			{ name: 'value', type: FLOAT, description: 'What it adds to each coin, × total bet.' },
			{ name: 'cells', type: list(COIN_CHANGE), description: 'Every coin it changed.' },
		],
		category: 'book',
		description: 'A payer added its value to every coin on the board.',
	},
	{
		name: 'coinBoost',
		payload: [
			{
				name: 'source',
				type: STRING,
				description: '`special` (a multiplier symbol) or `wheel`.',
			},
			{
				name: 'booster',
				type: CELL,
				optional: true,
				description: 'The multiplier symbol (absent for the wheel).',
			},
			{ name: 'multiplier', type: FLOAT, description: 'The factor applied.' },
			{ name: 'cells', type: list(COIN_CHANGE), description: 'Every coin it changed.' },
		],
		category: 'book',
		description: 'Every coin on the board was multiplied.',
	},
	{
		name: 'specialBecomesCoin',
		payload: [
			{ name: 'reel', type: INT, description: 'The reel (0 = leftmost).' },
			{ name: 'row', type: INT, description: 'The visible row (0 = top).' },
			{
				name: 'symbol',
				type: { t: 'struct', name: 'HoldAndWinSymbol' },
				description: 'The coin it became.',
			},
			{ name: 'from', type: SYMBOL, description: 'The special it was.' },
		],
		category: 'book',
		description: 'A multiplier that applied stays behind as a coin.',
	},
	{
		name: 'coinCollect',
		payload: [
			cell('collector', 'The collector.'),
			{ name: 'level', type: INT, description: 'Its collect level.' },
			{ name: 'cells', type: list(CELL_AMOUNT), description: 'The coins it collected.' },
			{
				name: 'value',
				type: FLOAT,
				description: "The collector's value after collecting, × total bet.",
			},
		],
		category: 'book',
		description: 'A collector took the value of the coins on the board.',
	},
	{
		name: 'cellsCleared',
		payload: [
			{ name: 'reason', type: STRING, description: 'Why they left (`collected`).' },
			{ name: 'cells', type: list(POSITION), description: 'The cells that left the board.' },
		],
		category: 'book',
		description: "A streak collector's collected coins leave the board.",
	},
	{
		name: 'columnComplete',
		payload: [
			{ name: 'reel', type: INT, description: 'The column.' },
			{ name: 'letter', type: STRING, description: 'Its letter.' },
			{ name: 'newlyLit', type: BOOL, description: 'The letter lit on this respin.' },
			{ name: 'cleared', type: BOOL, description: 'The column was swept clear.' },
			{ name: 'value', type: FLOAT, description: 'What the column was worth, × total bet.' },
			{ name: 'amount', type: FLOAT, description: 'The same, in book-event units.' },
			{ name: 'cells', type: list(POSITION), description: 'The column’s cells.' },
		],
		category: 'book',
		description: 'A column filled: its letter lights and, if the game says so, the column clears.',
	},
	{
		name: 'jackpotWin',
		payload: [
			{ name: 'tier', type: STRING, description: 'The tier (`MINI` … `GRAND`).' },
			{ name: 'amount', type: FLOAT, description: 'What it is worth.' },
			{ name: 'source', type: JACKPOT_SOURCE, description: 'Where it came from.' },
			{
				name: 'banked',
				type: BOOL,
				description:
					'It adds money (full board, letters, wheel). Otherwise it presents money already counted.',
			},
			{
				name: 'cell',
				type: POSITION,
				optional: true,
				description: 'The jackpot coin, when there is one.',
			},
		],
		category: 'book',
		description:
			'A jackpot was won. A banked one (full board, letters, wheel) is a celebration; a coin jackpot lights in the tally.',
	},
	{
		name: 'respinUpdate',
		payload: [
			{ name: 'left', type: INT, description: 'Respins left.' },
			{ name: 'played', type: INT, description: 'Respins played.' },
			{ name: 'start', type: INT, description: 'What the counter resets to.' },
			{ name: 'reset', type: BOOL, description: 'A new coin reset the counter.' },
		],
		category: 'book',
		description: 'The respin counter moved. A reset is its own beat.',
	},
	{
		name: 'holdAndWinState',
		payload: [
			{
				name: 'snapshot',
				type: { t: 'struct', name: 'HoldAndWinSnapshot' },
				description: 'The whole open feature.',
			},
		],
		category: 'book',
		description:
			"The server's whole picture of the open feature, after every respin. On a resume it rebuilds the respin board with no intro.",
	},
	{
		name: 'holdAndWinEnd',
		payload: [
			{ name: 'mode', type: STRING, description: 'The mode it closes (`holdAndWin`).' },
			{ name: 'total', type: FLOAT, description: 'What the feature won.' },
			{
				name: 'payload',
				type: { t: 'struct', name: 'HoldAndWinTally' },
				description: 'The per-coin tally and the banked jackpots.',
			},
		],
		category: 'book',
		description:
			'The feature ends. Wire it to hold the final board, fly the coins into the Total Win bar as it counts up, then swap back to the reels.',
	},
];

/** A per-beat effect: the coded presentation of one event, fed the whole event. */
const beat = (name: string): TemplateVocabulary['actions'][number] => ({
	name,
	params: [
		{
			name: 'bookEvent',
			type: BOOK_EVENT,
			description: 'The event this beat presents — wire `$trigger` (the whole payload).',
		},
	],
	category: 'command',
});

const ACTIONS: TemplateVocabulary['actions'] = [
	beat('showRespinBoard'),
	beat('spinRespin'),
	beat('stickCoins'),
	beat('setRespinCounter'),
	beat('restoreRespinBoard'),
	beat('payCoins'),
	beat('boostCoins'),
	beat('turnSpecialIntoCoin'),
	beat('collectCoins'),
	beat('revealMystery'),
	beat('clearRespinCells'),
	beat('showJackpotWin'),
	beat('hideRespinBoard'),
	beat('fillMeter'),
	{ name: 'playLuckySpinIntro', params: [], category: 'command' },
	{
		name: 'flyTo',
		params: [
			{
				name: 'cells',
				type: list(CELL),
				optional: true,
				description: 'The cells each flight leaves from.',
			},
			{ name: 'reel', type: INT, optional: true, description: 'One source cell: its reel.' },
			{ name: 'row', type: INT, optional: true, description: 'One source cell: its row.' },
			{
				name: 'target',
				type: STRING,
				optional: true,
				description: 'A layout node id, or `total` (the win meter; the default).',
			},
			{
				name: 'flight',
				type: STRING,
				optional: true,
				description: 'The kind reported in each `flightArrive` (default `toTotal`).',
			},
			{
				name: 'avoid',
				type: list(POSITION),
				optional: true,
				description: 'Cells the routes bend around.',
			},
			{ name: 'stagger', type: MS, optional: true, description: 'Between two take-offs.' },
			{
				name: 'await',
				type: BOOL,
				optional: true,
				description: 'Hold the flow until the last head lands (default true).',
			},
		],
		category: 'command',
	},
];

const CUES: TemplateVocabulary['cues'] = [
	{ name: 'respinBoardShow', payload: [] },
	{ name: 'respinBoardHide', payload: [] },
	{ name: 'respinBoardSpin', payload: [{ name: 'cells', type: list(CELL) }] },
	{ name: 'respinCoinsLand', payload: [{ name: 'cells', type: list(CELL) }] },
	{
		name: 'respinCounterUpdate',
		payload: [
			{ name: 'left', type: INT },
			{ name: 'start', type: INT },
			{ name: 'reset', type: BOOL },
		],
	},
	{
		name: 'respinCoinPay',
		payload: [
			{ name: 'payer', type: CELL },
			{ name: 'value', type: FLOAT },
			{ name: 'cells', type: list(COIN_CHANGE) },
		],
	},
	{
		name: 'respinCoinBoost',
		payload: [
			{ name: 'source', type: STRING },
			{ name: 'booster', type: CELL, optional: true },
			{ name: 'multiplier', type: FLOAT },
			{ name: 'cells', type: list(COIN_CHANGE) },
		],
	},
	{
		name: 'respinSpecialBecomesCoin',
		payload: [
			{ name: 'cell', type: CELL },
			{ name: 'from', type: STRING },
		],
	},
	{
		name: 'respinCoinCollect',
		payload: [
			{ name: 'collector', type: CELL },
			{ name: 'level', type: INT },
			{ name: 'cells', type: list(CELL_AMOUNT) },
			{ name: 'value', type: FLOAT },
		],
	},
	{
		name: 'respinCollectStep',
		payload: [
			{ name: 'cell', type: CELL },
			{ name: 'collector', type: CELL },
			{ name: 'index', type: INT },
		],
	},
	{
		name: 'respinMysteryReveal',
		payload: [
			{ name: 'cells', type: list(MYSTERY_CELL) },
			{ name: 'activates', type: list(SPECIAL) },
		],
	},
	{ name: 'respinModifierUnlock', payload: [{ name: 'activates', type: list(SPECIAL) }] },
	{ name: 'respinCellsCleared', payload: [{ name: 'cells', type: list(POSITION) }] },
	{
		name: 'respinJackpotWin',
		payload: [
			{ name: 'tier', type: STRING },
			{ name: 'amount', type: FLOAT },
			{ name: 'source', type: JACKPOT_SOURCE },
			{ name: 'banked', type: BOOL },
		],
	},
	{
		name: 'potFill',
		payload: [
			{ name: 'meter', type: STRING },
			{ name: 'level', type: INT },
			{ name: 'max', type: INT },
			{ name: 'full', type: BOOL },
			{ name: 'cells', type: list(CELL) },
		],
	},
	{ name: 'potFull', payload: [{ name: 'meter', type: STRING }] },
	{
		name: 'potsConsume',
		payload: [
			{ name: 'meters', type: list(STRING) },
			{ name: 'activates', type: list(SPECIAL) },
		],
	},
	{ name: 'luckySpinIntro', payload: [] },
	{
		name: 'jackpotCelebration',
		payload: [
			{ name: 'tier', type: STRING },
			{ name: 'amount', type: FLOAT },
			{ name: 'source', type: JACKPOT_SOURCE },
		],
	},
	{
		name: 'respinTallyStep',
		payload: [
			{ name: 'index', type: INT },
			{ name: 'amount', type: FLOAT },
			{ name: 'total', type: FLOAT },
		],
	},
	{
		name: 'flightArrive',
		payload: [
			{ name: 'flight', type: STRING },
			{ name: 'target', type: STRING },
			{ name: 'index', type: INT },
		],
	},
];

const VALUES: TemplateVocabulary['values'] = [
	{ name: 'respinsLeft', type: INT, description: 'Respins left on the counter.' },
	{
		name: 'respinTotal',
		type: INT,
		description: 'What the respin counter resets to when a coin lands.',
	},
	{
		name: 'featureTotal',
		type: FLOAT,
		description:
			'What the open feature is worth so far (banked jackpots + every held cell), in the same units as `win`.',
	},
	{
		name: 'activeModifiers',
		type: list(SPECIAL),
		description: 'The specials active in the feature (payer, multiplier, collector, mystery).',
	},
	...JACKPOT_TIERS.map((tier) => ({
		name: `jackpot.${tier}`,
		type: FLOAT,
		description: `The ${tier.toUpperCase()} jackpot at the current bet, in the same units as \`win\` (0 when the game has none).`,
	})),
];

/** What `kindCapabilities('holdAndWin')` turns off: free spins and stacked pictures. */
const unusedByKind = (name: string): boolean =>
	/freeSpin|FreeSpin|FreeGame|StackedPictures/.test(name);

const standard = standardVocabulary({
	templateId: 'holdAndWin',
	symbolNames: HOLD_AND_WIN_SYMBOLS,
});
const used = <T extends { name: string }>(entries: T[]): T[] =>
	entries.filter((entry) => !unusedByKind(entry.name));

export const HOLD_AND_WIN_VOCAB: TemplateVocabulary = {
	...standard,
	structs: [...standard.structs, ...STRUCTS],
	enums: [...standard.enums, ...ENUMS],
	// The base-game events ride on a spin, so they follow `reveal`; the feature's events close the
	// book-event list, in the order a round plays them.
	events: [...insertAfter(used(standard.events), 'reveal', BASE_EVENTS), ...FEATURE_EVENTS],
	actions: [...used(standard.actions), ...ACTIONS],
	// The feature's cues open the list, as each mechanic's do in its own vocabulary.
	cues: [...CUES, ...used(standard.cues)],
	values: [...used(standard.values), ...VALUES],
};
