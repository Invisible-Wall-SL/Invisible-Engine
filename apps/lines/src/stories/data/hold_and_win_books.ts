// Recorded from the Hold and Win mock (pots preset) through the real facade; symbols renamed onto
// this app's sample art. Books 1–2: BONUS → S, JACKPOT → W, specials → H1. Books 3–7 (forced specials,
// Phase 4d): BONUS → S, JACKPOT → W, BOOST → H1, MULTI → H2, COLLECT → H3, MYSTERY → H4. BLANK has no
// art and draws nothing.
export default [
	{
		id: 1,
		name: 'chain',
		payoutMultiplier: 38.5,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{ name: 'H1', value: 4 },
						{ name: 'H1', value: 4 },
						{ name: 'S', value: 5 },
						{ name: 'L3' },
						{ name: 'L3' },
					],
					[
						{ name: 'S', value: 2 },
						{ name: 'S', value: 2 },
						{ name: 'L1' },
						{ name: 'S', value: 1 },
						{ name: 'S', value: 1 },
					],
					[{ name: 'H4' }, { name: 'H4' }, { name: 'L4' }, { name: 'L2' }, { name: 'L2' }],
					[
						{ name: 'H1' },
						{ name: 'H1' },
						{ name: 'H1' },
						{ name: 'S', value: 1 },
						{ name: 'S', value: 1 },
					],
					[{ name: 'W' }, { name: 'W' }, { name: 'S', value: 1 }, { name: 'H1' }, { name: 'H1' }],
				],
				paddingPositions: [0, 0, 0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'meterUpdate',
				meter: 'red',
				level: 1,
				max: 12,
				full: false,
				from: [{ reel: 0, row: 0, symbol: { name: 'H1' } }],
			},
			{
				index: 2,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'count',
				payload: {
					cells: [
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
				},
			},
			{
				index: 3,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 1000,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 4,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 5,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 6,
				type: 'coinsLand',
				cells: [{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } }],
			},
			{ index: 7, type: 'respinUpdate', left: 3, played: 1, start: 3, reset: true },
			{
				index: 8,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 1,
					banked: 0,
					total: 1200,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 9,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 10,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 11,
				type: 'coinsLand',
				cells: [{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } }],
			},
			{ index: 12, type: 'respinUpdate', left: 3, played: 2, start: 3, reset: true },
			{
				index: 13,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 2,
					banked: 0,
					total: 1450,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 14,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 15,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 16,
				type: 'coinsLand',
				cells: [{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } }],
			},
			{ index: 17, type: 'respinUpdate', left: 3, played: 3, start: 3, reset: true },
			{
				index: 18,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 3,
					banked: 0,
					total: 1750,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 19,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 20,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 21,
				type: 'coinsLand',
				cells: [{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } }],
			},
			{ index: 22, type: 'respinUpdate', left: 3, played: 4, start: 3, reset: true },
			{
				index: 23,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 4,
					banked: 0,
					total: 2750,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 24,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 25,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 26,
				type: 'coinsLand',
				cells: [{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } }],
			},
			{ index: 27, type: 'respinUpdate', left: 3, played: 5, start: 3, reset: true },
			{
				index: 28,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 5,
					banked: 0,
					total: 2850,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 29,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 30,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 31,
				type: 'coinsLand',
				cells: [{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } }],
			},
			{ index: 32, type: 'respinUpdate', left: 3, played: 6, start: 3, reset: true },
			{
				index: 33,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 6,
					banked: 0,
					total: 3150,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 34,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 35,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 36,
				type: 'coinsLand',
				cells: [{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } }],
			},
			{ index: 37, type: 'respinUpdate', left: 3, played: 7, start: 3, reset: true },
			{
				index: 38,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 7,
					banked: 0,
					total: 3400,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 39,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 40,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
					{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 41,
				type: 'coinsLand',
				cells: [{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } }],
			},
			{ index: 42, type: 'respinUpdate', left: 3, played: 8, start: 3, reset: true },
			{
				index: 43,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
						{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 8,
					banked: 0,
					total: 3700,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 44,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 45,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
					{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{
				index: 46,
				type: 'coinsLand',
				cells: [{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } }],
			},
			{ index: 47, type: 'respinUpdate', left: 3, played: 9, start: 3, reset: true },
			{
				index: 48,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
						{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 9,
					banked: 0,
					total: 3850,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 49,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 50,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
					{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{ index: 51, type: 'respinUpdate', left: 2, played: 10, start: 3, reset: false },
			{
				index: 52,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
						{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 2,
					played: 10,
					banked: 0,
					total: 3850,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 53,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 54,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
					{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{ index: 55, type: 'respinUpdate', left: 1, played: 11, start: 3, reset: false },
			{
				index: 56,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
						{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 1,
					played: 11,
					banked: 0,
					total: 3850,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 57,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{
				index: 58,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
					{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
					{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
					{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } },
					{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 4, row: 2, symbol: { name: 'BLANK' } },
				],
			},
			{ index: 59, type: 'respinUpdate', left: 0, played: 12, start: 3, reset: false },
			{
				index: 60,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 } },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 } },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 } },
						{ reel: 3, row: 1, symbol: { name: 'S', value: 3 } },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 } },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 0,
					played: 12,
					banked: 0,
					total: 3850,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 61,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 3850,
				payload: {
					cells: [
						{ reel: 0, row: 0, symbol: { name: 'S', value: 2 }, amount: 200 },
						{ reel: 0, row: 1, symbol: { name: 'S', value: 5 }, amount: 500 },
						{ reel: 0, row: 2, symbol: { name: 'S', value: 2.5 }, amount: 250 },
						{ reel: 1, row: 0, symbol: { name: 'S', value: 2 }, amount: 200 },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 3 }, amount: 300 },
						{ reel: 1, row: 2, symbol: { name: 'S', value: 1 }, amount: 100 },
						{ reel: 2, row: 0, symbol: { name: 'S', value: 10 }, amount: 1000 },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 }, amount: 100 },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 3 }, amount: 300 },
						{ reel: 3, row: 0, symbol: { name: 'S', value: 2.5 }, amount: 250 },
						{ reel: 3, row: 1, symbol: { name: 'S', value: 3 }, amount: 300 },
						{ reel: 3, row: 2, symbol: { name: 'S', value: 1 }, amount: 100 },
						{ reel: 4, row: 0, symbol: { name: 'S', value: 1.5 }, amount: 150 },
						{ reel: 4, row: 1, symbol: { name: 'S', value: 1 }, amount: 100 },
					],
					banked: 0,
				},
			},
			{ index: 62, type: 'setWin', amount: 3850, winLevel: 7 },
			{ index: 63, type: 'setTotalWin', amount: 3850 },
			{
				index: 64,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 1, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 0, max: 12 },
				],
			},
			{ index: 65, type: 'finalWin', amount: 3850 },
		],
	},
	{
		id: 2,
		name: 'trigger',
		payoutMultiplier: 13,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{ name: 'L1' },
						{ name: 'L1' },
						{ name: 'H1', value: 4 },
						{ name: 'L4' },
						{ name: 'L4' },
					],
					[
						{ name: 'S', value: 8 },
						{ name: 'S', value: 8 },
						{ name: 'S', value: 2 },
						{ name: 'H1', value: 10 },
						{ name: 'H1', value: 10 },
					],
					[
						{ name: 'L3' },
						{ name: 'L3' },
						{ name: 'S', value: 1 },
						{ name: 'S', value: 1 },
						{ name: 'S', value: 1 },
					],
					[{ name: 'H4' }, { name: 'H4' }, { name: 'L1' }, { name: 'W' }, { name: 'W' }],
					[
						{ name: 'H1' },
						{ name: 'H1' },
						{ name: 'H1', value: 2 },
						{ name: 'S', value: 1 },
						{ name: 'S', value: 1 },
					],
				],
				paddingPositions: [0, 0, 0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'meterUpdate',
				meter: 'red',
				level: 2,
				max: 12,
				full: false,
				from: [
					{ reel: 0, row: 1, symbol: { name: 'H1' } },
					{ reel: 1, row: 2, symbol: { name: 'H1' } },
				],
			},
			{
				index: 2,
				type: 'meterUpdate',
				meter: 'green',
				level: 1,
				max: 12,
				full: false,
				from: [{ reel: 4, row: 1, symbol: { name: 'H1' } }],
			},
			{
				index: 3,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'count',
				payload: {
					cells: [
						{ reel: 1, row: 0, symbol: { name: 'S', value: 8 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 2 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 2, symbol: { name: 'S', value: 1 } },
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
				},
			},
			{
				index: 4,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 1, row: 0, symbol: { name: 'S', value: 8 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 2 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 2, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 1300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 5,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 2, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 1, max: 12 },
				],
			},
			{
				index: 6,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 0, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 0, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 8 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 2, symbol: { name: 'S', value: 1 } },
				],
			},
			{ index: 7, type: 'respinUpdate', left: 2, played: 1, start: 3, reset: false },
			{
				index: 8,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 1, row: 0, symbol: { name: 'S', value: 8 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 2 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 2, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 2,
					played: 1,
					banked: 0,
					total: 1300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 9,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 2, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 1, max: 12 },
				],
			},
			{
				index: 10,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 0, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 0, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 8 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 2, symbol: { name: 'S', value: 1 } },
				],
			},
			{ index: 11, type: 'respinUpdate', left: 1, played: 2, start: 3, reset: false },
			{
				index: 12,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 1, row: 0, symbol: { name: 'S', value: 8 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 2 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 2, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 1,
					played: 2,
					banked: 0,
					total: 1300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 13,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 2, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 1, max: 12 },
				],
			},
			{
				index: 14,
				type: 'respinReveal',
				cells: [
					{ reel: 0, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 0, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 0, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 1, row: 0, symbol: { name: 'S', value: 8 } },
					{ reel: 1, row: 1, symbol: { name: 'S', value: 2 } },
					{ reel: 1, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
					{ reel: 2, row: 2, symbol: { name: 'S', value: 1 } },
					{ reel: 3, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 3, row: 2, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 0, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 1, symbol: { name: 'BLANK' } },
					{ reel: 4, row: 2, symbol: { name: 'S', value: 1 } },
				],
			},
			{ index: 15, type: 'respinUpdate', left: 0, played: 3, start: 3, reset: false },
			{
				index: 16,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{ reel: 1, row: 0, symbol: { name: 'S', value: 8 } },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 2 } },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 } },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 1 } },
						{ reel: 4, row: 2, symbol: { name: 'S', value: 1 } },
					],
					start: 3,
					left: 0,
					played: 3,
					banked: 0,
					total: 1300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 17,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 1300,
				payload: {
					cells: [
						{ reel: 1, row: 0, symbol: { name: 'S', value: 8 }, amount: 800 },
						{ reel: 1, row: 1, symbol: { name: 'S', value: 2 }, amount: 200 },
						{ reel: 2, row: 1, symbol: { name: 'S', value: 1 }, amount: 100 },
						{ reel: 2, row: 2, symbol: { name: 'S', value: 1 }, amount: 100 },
						{ reel: 4, row: 2, symbol: { name: 'S', value: 1 }, amount: 100 },
					],
					banked: 0,
				},
			},
			{ index: 18, type: 'setWin', amount: 1300, winLevel: 6 },
			{ index: 19, type: 'setTotalWin', amount: 1300 },
			{
				index: 20,
				type: 'meterLevels',
				meters: [
					{ id: 'red', level: 2, max: 12 },
					{ id: 'blue', level: 0, max: 12 },
					{ id: 'green', level: 1, max: 12 },
				],
			},
			{ index: 21, type: 'finalWin', amount: 1300 },
		],
	},
	{
		id: 3,
		name: 'payer',
		payoutMultiplier: 39.5,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{
							name: 'L2',
						},
						{
							name: 'L2',
						},
						{
							name: 'H3',
						},
						{
							name: 'S',
							value: 8,
						},
						{
							name: 'S',
							value: 8,
						},
					],
					[
						{
							name: 'L3',
						},
						{
							name: 'L3',
						},
						{
							name: 'S',
							value: 2.5,
						},
						{
							name: 'S',
							value: 2,
						},
						{
							name: 'S',
							value: 2,
						},
					],
					[
						{
							name: 'L2',
						},
						{
							name: 'L2',
						},
						{
							name: 'H2',
							value: 2,
						},
						{
							name: 'H2',
						},
						{
							name: 'H2',
						},
					],
					[
						{
							name: 'H4',
						},
						{
							name: 'H4',
						},
						{
							name: 'H1',
							value: 3,
						},
						{
							name: 'H2',
						},
						{
							name: 'H2',
						},
					],
					[
						{
							name: 'H2',
						},
						{
							name: 'H2',
						},
						{
							name: 'L4',
						},
						{
							name: 'H2',
							value: 2,
						},
						{
							name: 'H2',
							value: 2,
						},
					],
				],
				paddingPositions: [0, 0, 0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'meterUpdate',
				meter: 'red',
				level: 1,
				max: 12,
				full: false,
				from: [
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'H1',
						},
					},
				],
			},
			{
				index: 2,
				type: 'meterUpdate',
				meter: 'green',
				level: 2,
				max: 12,
				full: false,
				from: [
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'H2',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'H2',
						},
					},
				],
			},
			{
				index: 3,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'count',
				payload: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 2.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier', 'payer'],
				},
			},
			{
				index: 4,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 2.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 1250,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 5,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 1,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 6,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H1',
							value: 9,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 8,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 2.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 7,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H1',
							value: 9,
						},
					},
				],
			},
			{
				index: 8,
				type: 'coinPay',
				payer: {
					reel: 0,
					row: 0,
					symbol: {
						name: 'H1',
						value: 9,
					},
				},
				value: 9,
				cells: [
					{
						reel: 0,
						row: 2,
						from: 8,
						to: 17,
					},
					{
						reel: 1,
						row: 1,
						from: 2.5,
						to: 11.5,
					},
					{
						reel: 1,
						row: 2,
						from: 2,
						to: 11,
					},
				],
			},
			{
				index: 9,
				type: 'respinUpdate',
				left: 2,
				played: 1,
				start: 3,
				reset: false,
			},
			{
				index: 10,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H1',
								value: 9,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 17,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 11.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 11,
							},
						},
					],
					start: 3,
					left: 2,
					played: 1,
					banked: 0,
					total: 3950,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 11,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 1,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 12,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H1',
							value: 9,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 17,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 11.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 11,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 13,
				type: 'respinUpdate',
				left: 1,
				played: 2,
				start: 3,
				reset: false,
			},
			{
				index: 14,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H1',
								value: 9,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 17,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 11.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 11,
							},
						},
					],
					start: 3,
					left: 1,
					played: 2,
					banked: 0,
					total: 3950,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 15,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 1,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 16,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H1',
							value: 9,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 17,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 11.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 11,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 17,
				type: 'respinUpdate',
				left: 0,
				played: 3,
				start: 3,
				reset: false,
			},
			{
				index: 18,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H1',
								value: 9,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 17,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 11.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 11,
							},
						},
					],
					start: 3,
					left: 0,
					played: 3,
					banked: 0,
					total: 3950,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 19,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 3950,
				payload: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 17,
							},
							amount: 1700,
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 11.5,
							},
							amount: 1150,
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 11,
							},
							amount: 1100,
						},
					],
					banked: 0,
				},
			},
			{
				index: 20,
				type: 'setWin',
				amount: 3950,
				winLevel: 7,
			},
			{
				index: 21,
				type: 'setTotalWin',
				amount: 3950,
			},
			{
				index: 22,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 1,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 23,
				type: 'finalWin',
				amount: 3950,
			},
		],
	},
	{
		id: 4,
		name: 'multiplier',
		payoutMultiplier: 199,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'S',
							value: 2.5,
						},
						{
							name: 'L4',
						},
						{
							name: 'L4',
						},
					],
					[
						{
							name: 'L1',
						},
						{
							name: 'L1',
						},
						{
							name: 'S',
							value: 1.5,
						},
						{
							name: 'H4',
						},
						{
							name: 'H4',
						},
					],
					[
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 3,
						},
						{
							name: 'L2',
						},
						{
							name: 'L2',
						},
					],
					[
						{
							name: 'L3',
						},
						{
							name: 'L3',
						},
						{
							name: 'H1',
						},
						{
							name: 'L2',
						},
						{
							name: 'L2',
						},
					],
					[
						{
							name: 'H2',
						},
						{
							name: 'H2',
						},
						{
							name: 'H2',
							value: 3,
						},
						{
							name: 'S',
							value: 1.5,
						},
						{
							name: 'S',
							value: 1.5,
						},
					],
				],
				paddingPositions: [0, 0, 0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'meterUpdate',
				meter: 'green',
				level: 1,
				max: 12,
				full: false,
				from: [
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'H2',
						},
					},
				],
			},
			{
				index: 2,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'count',
				payload: {
					cells: [
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 2.5,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
				},
			},
			{
				index: 3,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 2.5,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 1350,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 4,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 5,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H2',
							value: 3,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 2.5,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 1.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 5,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 1.5,
						},
					},
				],
			},
			{
				index: 6,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H2',
							value: 3,
						},
					},
				],
			},
			{
				index: 7,
				type: 'coinBoost',
				source: 'special',
				booster: {
					reel: 0,
					row: 0,
					symbol: {
						name: 'H2',
						value: 3,
					},
				},
				multiplier: 3,
				cells: [
					{
						reel: 0,
						row: 1,
						from: 2.5,
						to: 7.5,
					},
					{
						reel: 1,
						row: 1,
						from: 1.5,
						to: 4.5,
					},
					{
						reel: 2,
						row: 0,
						from: 5,
						to: 15,
					},
					{
						reel: 2,
						row: 1,
						from: 3,
						to: 9,
					},
					{
						reel: 4,
						row: 2,
						from: 1.5,
						to: 4.5,
					},
				],
			},
			{
				index: 8,
				type: 'specialBecomesCoin',
				reel: 0,
				row: 0,
				from: 'H2',
				symbol: {
					name: 'S',
					value: 10,
				},
			},
			{
				index: 9,
				type: 'respinUpdate',
				left: 2,
				played: 1,
				start: 3,
				reset: false,
			},
			{
				index: 10,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 10,
							},
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 7.5,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 4.5,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 15,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 9,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 4.5,
							},
						},
					],
					start: 3,
					left: 2,
					played: 1,
					banked: 0,
					total: 5050,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 11,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 12,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 10,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 7.5,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 4.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 15,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 9,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 2.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 4.5,
						},
					},
				],
			},
			{
				index: 13,
				type: 'coinsLand',
				cells: [
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 2.5,
						},
					},
				],
			},
			{
				index: 14,
				type: 'respinUpdate',
				left: 3,
				played: 2,
				start: 3,
				reset: true,
			},
			{
				index: 15,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 10,
							},
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 7.5,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 4.5,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 15,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 9,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 2.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 4.5,
							},
						},
					],
					start: 3,
					left: 3,
					played: 2,
					banked: 0,
					total: 5300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 16,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 17,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 10,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 7.5,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'H4',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 4.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 15,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 9,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'H2',
							value: 3,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 2.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 4.5,
						},
					},
				],
			},
			{
				index: 18,
				type: 'coinsLand',
				cells: [
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'H4',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'H2',
							value: 3,
						},
					},
				],
			},
			{
				index: 19,
				type: 'mysteryReveal',
				cells: [
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINOR',
						},
						becomes: 'jackpot',
					},
				],
				activates: [],
			},
			{
				index: 20,
				type: 'coinBoost',
				source: 'special',
				booster: {
					reel: 2,
					row: 2,
					symbol: {
						name: 'H2',
						value: 3,
					},
				},
				multiplier: 3,
				cells: [
					{
						reel: 0,
						row: 0,
						from: 10,
						to: 30,
					},
					{
						reel: 0,
						row: 1,
						from: 7.5,
						to: 22.5,
					},
					{
						reel: 1,
						row: 1,
						from: 4.5,
						to: 13.5,
					},
					{
						reel: 2,
						row: 0,
						from: 15,
						to: 45,
					},
					{
						reel: 2,
						row: 1,
						from: 9,
						to: 27,
					},
					{
						reel: 4,
						row: 0,
						from: 2.5,
						to: 7.5,
					},
					{
						reel: 4,
						row: 2,
						from: 4.5,
						to: 13.5,
					},
				],
			},
			{
				index: 21,
				type: 'specialBecomesCoin',
				reel: 2,
				row: 2,
				from: 'H2',
				symbol: {
					name: 'S',
					value: 4,
				},
			},
			{
				index: 22,
				type: 'respinUpdate',
				left: 3,
				played: 3,
				start: 3,
				reset: true,
			},
			{
				index: 23,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 30,
							},
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 22.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINOR',
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 45,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 27,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 7.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
					],
					start: 3,
					left: 3,
					played: 3,
					banked: 0,
					total: 19300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 24,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 25,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 30,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 22.5,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINOR',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 45,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 27,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 4,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 7.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
				],
			},
			{
				index: 26,
				type: 'coinsLand',
				cells: [
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
				],
			},
			{
				index: 27,
				type: 'respinUpdate',
				left: 3,
				played: 4,
				start: 3,
				reset: true,
			},
			{
				index: 28,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 30,
							},
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 22.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINOR',
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 45,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 27,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 7.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
					],
					start: 3,
					left: 3,
					played: 4,
					banked: 0,
					total: 19600,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 29,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 30,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 30,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 22.5,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINOR',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 45,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 27,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 4,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 7.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
				],
			},
			{
				index: 31,
				type: 'coinsLand',
				cells: [
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
				],
			},
			{
				index: 32,
				type: 'respinUpdate',
				left: 3,
				played: 5,
				start: 3,
				reset: true,
			},
			{
				index: 33,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 30,
							},
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 22.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINOR',
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 45,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 27,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 7.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
					],
					start: 3,
					left: 3,
					played: 5,
					banked: 0,
					total: 19900,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 34,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 35,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 30,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 22.5,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINOR',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 45,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 27,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 4,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 7.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
				],
			},
			{
				index: 36,
				type: 'respinUpdate',
				left: 2,
				played: 6,
				start: 3,
				reset: false,
			},
			{
				index: 37,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 30,
							},
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 22.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINOR',
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 45,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 27,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 7.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
					],
					start: 3,
					left: 2,
					played: 6,
					banked: 0,
					total: 19900,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 38,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 39,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 30,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 22.5,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINOR',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 45,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 27,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 4,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 7.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
				],
			},
			{
				index: 40,
				type: 'respinUpdate',
				left: 1,
				played: 7,
				start: 3,
				reset: false,
			},
			{
				index: 41,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 30,
							},
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 22.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINOR',
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 45,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 27,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 7.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
					],
					start: 3,
					left: 1,
					played: 7,
					banked: 0,
					total: 19900,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 42,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 43,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 30,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 22.5,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINOR',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 45,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 27,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 4,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 7.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 13.5,
						},
					},
				],
			},
			{
				index: 44,
				type: 'respinUpdate',
				left: 0,
				played: 8,
				start: 3,
				reset: false,
			},
			{
				index: 45,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 30,
							},
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 22.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINOR',
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 45,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 27,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 7.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 13.5,
							},
						},
					],
					start: 3,
					left: 0,
					played: 8,
					banked: 0,
					total: 19900,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 46,
				type: 'jackpotWin',
				tier: 'MINOR',
				amount: 3000,
				source: 'coin',
				banked: false,
				cell: {
					reel: 1,
					row: 0,
				},
			},
			{
				index: 47,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 19900,
				payload: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 30,
							},
							amount: 3000,
						},
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'S',
								value: 22.5,
							},
							amount: 2250,
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINOR',
							},
							amount: 3000,
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 13.5,
							},
							amount: 1350,
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
							},
							amount: 300,
						},
						{
							reel: 2,
							row: 0,
							symbol: {
								name: 'S',
								value: 45,
							},
							amount: 4500,
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 27,
							},
							amount: 2700,
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
							amount: 400,
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 3,
							},
							amount: 300,
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 7.5,
							},
							amount: 750,
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 13.5,
							},
							amount: 1350,
						},
					],
					banked: 0,
				},
			},
			{
				index: 48,
				type: 'setWin',
				amount: 19900,
				winLevel: 10,
			},
			{
				index: 49,
				type: 'setTotalWin',
				amount: 19900,
			},
			{
				index: 50,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 1,
						max: 12,
					},
				],
			},
			{
				index: 51,
				type: 'finalWin',
				amount: 19900,
			},
		],
	},
	{
		id: 5,
		name: 'collector',
		payoutMultiplier: 17,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{
							name: 'H1',
						},
						{
							name: 'H1',
						},
						{
							name: 'L4',
						},
						{
							name: 'L1',
						},
						{
							name: 'L1',
						},
					],
					[
						{
							name: 'S',
							value: 1,
						},
						{
							name: 'S',
							value: 1,
						},
						{
							name: 'S',
							value: 2,
						},
						{
							name: 'S',
							value: 2,
						},
						{
							name: 'S',
							value: 2,
						},
					],
					[
						{
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'W',
						},
						{
							name: 'L3',
						},
						{
							name: 'L3',
						},
					],
					[
						{
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'S',
							value: 1.5,
						},
						{
							name: 'W',
						},
						{
							name: 'W',
						},
					],
					[
						{
							name: 'L1',
						},
						{
							name: 'L1',
						},
						{
							name: 'H1',
						},
						{
							name: 'S',
							value: 2,
						},
						{
							name: 'S',
							value: 2,
						},
					],
				],
				paddingPositions: [0, 0, 0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'meterUpdate',
				meter: 'blue',
				level: 1,
				max: 12,
				full: false,
				from: [
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'H3',
						},
					},
				],
			},
			{
				index: 2,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'count',
				payload: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'collector'],
				},
			},
			{
				index: 3,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 850,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'collector'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 4,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 1,
						max: 12,
					},
					{
						id: 'green',
						level: 0,
						max: 12,
					},
				],
			},
			{
				index: 5,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H3',
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 1.5,
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
				],
			},
			{
				index: 6,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H3',
							value: 0,
						},
					},
				],
			},
			{
				index: 7,
				type: 'coinCollect',
				collector: {
					reel: 0,
					row: 0,
					symbol: {
						name: 'H3',
						value: 8.5,
					},
				},
				level: 1,
				cells: [
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
						},
						amount: 100,
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 2,
						},
						amount: 200,
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
						amount: 200,
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 1.5,
						},
						amount: 150,
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
						amount: 200,
					},
				],
				value: 8.5,
			},
			{
				index: 8,
				type: 'respinUpdate',
				left: 2,
				played: 1,
				start: 3,
				reset: false,
			},
			{
				index: 9,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H3',
								value: 8.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 2,
					played: 1,
					banked: 0,
					total: 1700,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'collector'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 10,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 1,
						max: 12,
					},
					{
						id: 'green',
						level: 0,
						max: 12,
					},
				],
			},
			{
				index: 11,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H3',
							value: 8.5,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 1.5,
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
				],
			},
			{
				index: 12,
				type: 'respinUpdate',
				left: 1,
				played: 2,
				start: 3,
				reset: false,
			},
			{
				index: 13,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H3',
								value: 8.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 1,
					played: 2,
					banked: 0,
					total: 1700,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'collector'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 14,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 1,
						max: 12,
					},
					{
						id: 'green',
						level: 0,
						max: 12,
					},
				],
			},
			{
				index: 15,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H3',
							value: 8.5,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'S',
							value: 1.5,
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
				],
			},
			{
				index: 16,
				type: 'respinUpdate',
				left: 0,
				played: 3,
				start: 3,
				reset: false,
			},
			{
				index: 17,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H3',
								value: 8.5,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 1.5,
							},
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 0,
					played: 3,
					banked: 0,
					total: 1700,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'collector'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 18,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 1700,
				payload: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H3',
								value: 8.5,
							},
							amount: 850,
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 1,
							},
							amount: 100,
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'S',
								value: 2,
							},
							amount: 200,
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
							amount: 200,
						},
						{
							reel: 3,
							row: 1,
							symbol: {
								name: 'S',
								value: 1.5,
							},
							amount: 150,
						},
						{
							reel: 4,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
							amount: 200,
						},
					],
					banked: 0,
				},
			},
			{
				index: 19,
				type: 'setWin',
				amount: 1700,
				winLevel: 6,
			},
			{
				index: 20,
				type: 'setTotalWin',
				amount: 1700,
			},
			{
				index: 21,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 1,
						max: 12,
					},
					{
						id: 'green',
						level: 0,
						max: 12,
					},
				],
			},
			{
				index: 22,
				type: 'finalWin',
				amount: 1700,
			},
		],
	},
	{
		id: 6,
		name: 'mysteryJackpot',
		payoutMultiplier: 33,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{
							name: 'L1',
						},
						{
							name: 'L1',
						},
						{
							name: 'H1',
							value: 10,
						},
						{
							name: 'S',
							value: 1,
						},
						{
							name: 'S',
							value: 1,
						},
					],
					[
						{
							name: 'H2',
							value: 2,
						},
						{
							name: 'H2',
							value: 2,
						},
						{
							name: 'H2',
						},
						{
							name: 'L4',
						},
						{
							name: 'L4',
						},
					],
					[
						{
							name: 'H2',
							value: 2,
						},
						{
							name: 'H2',
							value: 2,
						},
						{
							name: 'L3',
						},
						{
							name: 'W',
						},
						{
							name: 'W',
						},
					],
					[
						{
							name: 'S',
							value: 2,
						},
						{
							name: 'S',
							value: 2,
						},
						{
							name: 'L3',
						},
						{
							name: 'H1',
						},
						{
							name: 'H1',
						},
					],
					[
						{
							name: 'H1',
						},
						{
							name: 'H1',
						},
						{
							name: 'H1',
							value: 7,
						},
						{
							name: 'L2',
						},
						{
							name: 'L2',
						},
					],
				],
				paddingPositions: [0, 0, 0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'meterUpdate',
				meter: 'red',
				level: 2,
				max: 12,
				full: false,
				from: [
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'H1',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'H1',
						},
					},
				],
			},
			{
				index: 2,
				type: 'meterUpdate',
				meter: 'green',
				level: 2,
				max: 12,
				full: false,
				from: [
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'H2',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'H2',
						},
					},
				],
			},
			{
				index: 3,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'count',
				payload: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
				},
			},
			{
				index: 4,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 5,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 2,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 6,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H4',
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 7,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H4',
						},
					},
				],
			},
			{
				index: 8,
				type: 'mysteryReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
						becomes: 'jackpot',
					},
				],
				activates: [],
			},
			{
				index: 9,
				type: 'respinUpdate',
				left: 3,
				played: 1,
				start: 3,
				reset: true,
			},
			{
				index: 10,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 3,
					played: 1,
					banked: 0,
					total: 1800,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 11,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 2,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 12,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 13,
				type: 'coinsLand',
				cells: [
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
				],
			},
			{
				index: 14,
				type: 'respinUpdate',
				left: 3,
				played: 2,
				start: 3,
				reset: true,
			},
			{
				index: 15,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 3,
					played: 2,
					banked: 0,
					total: 3300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 16,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 2,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 17,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 18,
				type: 'respinUpdate',
				left: 2,
				played: 3,
				start: 3,
				reset: false,
			},
			{
				index: 19,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 2,
					played: 3,
					banked: 0,
					total: 3300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 20,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 2,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 21,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 22,
				type: 'respinUpdate',
				left: 1,
				played: 4,
				start: 3,
				reset: false,
			},
			{
				index: 23,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 1,
					played: 4,
					banked: 0,
					total: 3300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 24,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 2,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 25,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 26,
				type: 'respinUpdate',
				left: 0,
				played: 5,
				start: 3,
				reset: false,
			},
			{
				index: 27,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
					],
					start: 3,
					left: 0,
					played: 5,
					banked: 0,
					total: 3300,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer', 'multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 28,
				type: 'jackpotWin',
				tier: 'MINI',
				amount: 1500,
				source: 'coin',
				banked: false,
				cell: {
					reel: 0,
					row: 0,
				},
			},
			{
				index: 29,
				type: 'jackpotWin',
				tier: 'MINI',
				amount: 1500,
				source: 'coin',
				banked: false,
				cell: {
					reel: 1,
					row: 2,
				},
			},
			{
				index: 30,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 3300,
				payload: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
							amount: 1500,
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
							amount: 100,
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
							amount: 1500,
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
							amount: 200,
						},
					],
					banked: 0,
				},
			},
			{
				index: 31,
				type: 'setWin',
				amount: 3300,
				winLevel: 7,
			},
			{
				index: 32,
				type: 'setTotalWin',
				amount: 3300,
			},
			{
				index: 33,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 2,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 2,
						max: 12,
					},
				],
			},
			{
				index: 34,
				type: 'finalWin',
				amount: 3300,
			},
		],
	},
	{
		id: 7,
		name: 'unlockPayer',
		payoutMultiplier: 55.5,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{
							name: 'H2',
						},
						{
							name: 'H2',
						},
						{
							name: 'L3',
						},
						{
							name: 'L4',
						},
						{
							name: 'L4',
						},
					],
					[
						{
							name: 'S',
							value: 3,
						},
						{
							name: 'S',
							value: 3,
						},
						{
							name: 'H1',
						},
						{
							name: 'L3',
						},
						{
							name: 'L3',
						},
					],
					[
						{
							name: 'H4',
						},
						{
							name: 'H4',
						},
						{
							name: 'S',
							value: 2,
						},
						{
							name: 'S',
							value: 1,
						},
						{
							name: 'S',
							value: 1,
						},
					],
					[
						{
							name: 'L4',
						},
						{
							name: 'L4',
						},
						{
							name: 'L4',
						},
						{
							name: 'S',
							value: 10,
						},
						{
							name: 'S',
							value: 10,
						},
					],
					[
						{
							name: 'S',
							value: 2.5,
						},
						{
							name: 'S',
							value: 2.5,
						},
						{
							name: 'S',
							value: 1,
						},
						{
							name: 'L3',
						},
						{
							name: 'L3',
						},
					],
				],
				paddingPositions: [0, 0, 0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'count',
				payload: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 10,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 2.5,
							},
						},
						{
							reel: 4,
							row: 1,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['mystery'],
				},
			},
			{
				index: 2,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 10,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 2.5,
							},
						},
						{
							reel: 4,
							row: 1,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 1950,
					stickiness: 'allCoins',
					activeModifiers: ['mystery'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 3,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 0,
						max: 12,
					},
				],
			},
			{
				index: 4,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H4',
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'S',
							value: 10,
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 2.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 5,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H4',
						},
					},
				],
			},
			{
				index: 6,
				type: 'mysteryReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H1',
							value: 6,
						},
						becomes: 'payer',
					},
				],
				activates: ['payer'],
			},
			{
				index: 7,
				type: 'coinPay',
				payer: {
					reel: 0,
					row: 0,
					symbol: {
						name: 'H1',
						value: 6,
					},
				},
				value: 6,
				cells: [
					{
						reel: 1,
						row: 0,
						from: 3,
						to: 9,
					},
					{
						reel: 2,
						row: 1,
						from: 2,
						to: 8,
					},
					{
						reel: 2,
						row: 2,
						from: 1,
						to: 7,
					},
					{
						reel: 3,
						row: 2,
						from: 10,
						to: 16,
					},
					{
						reel: 4,
						row: 0,
						from: 2.5,
						to: 8.5,
					},
					{
						reel: 4,
						row: 1,
						from: 1,
						to: 7,
					},
				],
			},
			{
				index: 8,
				type: 'respinUpdate',
				left: 2,
				played: 1,
				start: 3,
				reset: false,
			},
			{
				index: 9,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H1',
								value: 6,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 9,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 16,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 8.5,
							},
						},
						{
							reel: 4,
							row: 1,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					start: 3,
					left: 2,
					played: 1,
					banked: 0,
					total: 5550,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 10,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 0,
						max: 12,
					},
				],
			},
			{
				index: 11,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H1',
							value: 6,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 9,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 8,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 7,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'S',
							value: 16,
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 8.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'S',
							value: 7,
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 12,
				type: 'respinUpdate',
				left: 1,
				played: 2,
				start: 3,
				reset: false,
			},
			{
				index: 13,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H1',
								value: 6,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 9,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 16,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 8.5,
							},
						},
						{
							reel: 4,
							row: 1,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					start: 3,
					left: 1,
					played: 2,
					banked: 0,
					total: 5550,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 14,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 0,
						max: 12,
					},
				],
			},
			{
				index: 15,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H1',
							value: 6,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 9,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 8,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 7,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 1,
						symbol: {
							name: 'BLANK',
						},
					},
					{
						reel: 3,
						row: 2,
						symbol: {
							name: 'S',
							value: 16,
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 8.5,
						},
					},
					{
						reel: 4,
						row: 1,
						symbol: {
							name: 'S',
							value: 7,
						},
					},
					{
						reel: 4,
						row: 2,
						symbol: {
							name: 'BLANK',
						},
					},
				],
			},
			{
				index: 16,
				type: 'respinUpdate',
				left: 0,
				played: 3,
				start: 3,
				reset: false,
			},
			{
				index: 17,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H1',
								value: 6,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 9,
							},
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 16,
							},
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 8.5,
							},
						},
						{
							reel: 4,
							row: 1,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					start: 3,
					left: 0,
					played: 3,
					banked: 0,
					total: 5550,
					stickiness: 'allCoins',
					activeModifiers: ['mystery', 'payer'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 18,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 5550,
				payload: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 9,
							},
							amount: 900,
						},
						{
							reel: 2,
							row: 1,
							symbol: {
								name: 'S',
								value: 8,
							},
							amount: 800,
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
							amount: 700,
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 16,
							},
							amount: 1600,
						},
						{
							reel: 4,
							row: 0,
							symbol: {
								name: 'S',
								value: 8.5,
							},
							amount: 850,
						},
						{
							reel: 4,
							row: 1,
							symbol: {
								name: 'S',
								value: 7,
							},
							amount: 700,
						},
					],
					banked: 0,
				},
			},
			{
				index: 19,
				type: 'setWin',
				amount: 5550,
				winLevel: 8,
			},
			{
				index: 20,
				type: 'setTotalWin',
				amount: 5550,
			},
			{
				index: 21,
				type: 'meterLevels',
				meters: [
					{
						id: 'red',
						level: 0,
						max: 12,
					},
					{
						id: 'blue',
						level: 0,
						max: 12,
					},
					{
						id: 'green',
						level: 0,
						max: 12,
					},
				],
			},
			{
				index: 22,
				type: 'finalWin',
				amount: 5550,
			},
		],
	},
];
