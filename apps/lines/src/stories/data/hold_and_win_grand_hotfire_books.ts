// Recorded from the Hold and Win mock through the real facade (Phase 4 step 10): the CLASSIC preset
// (Grand) forced with `letter`, `letters`, `special:multiplier` (a boost that doubles a MINI) and
// `instant`; the COLLECTOR preset (Super Hotfire) forced with `trigger`, `chain`,
// `wheel:extraCollect`, `wheel:coinBoost` and `wheel:jackpot:GRAND`. Seeds picked for a short book
// with no base-game line win. Symbols renamed onto this app's sample art: BONUS -> S, JACKPOT -> W,
// BOOST -> H2, COLLECT -> H4. BLANK has no art and draws nothing.
export default [
	{
		id: 1,
		name: 'classicLetter',
		payoutMultiplier: 34,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{
							name: 'W',
						},
						{
							name: 'W',
						},
						{
							name: 'W',
							jackpot: 'MINI',
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
							value: 1,
						},
						{
							name: 'S',
							value: 1,
						},
						{
							name: 'S',
							value: 6,
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
							name: 'L1',
						},
						{
							name: 'L1',
						},
						{
							name: 'L3',
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
							name: 'H3',
						},
						{
							name: 'S',
							value: 7,
						},
						{
							name: 'S',
							value: 7,
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
						},
						{
							name: 'H2',
						},
						{
							name: 'H2',
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
							reel: 0,
							row: 1,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
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
								value: 6,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
				},
			},
			{
				index: 2,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 1,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
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
								value: 6,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'S',
								value: 1,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 3200,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 3,
				type: 'columnComplete',
				reel: 1,
				letter: 'R',
				newlyLit: true,
				cleared: true,
				value: 8,
				amount: 800,
				cells: [
					{
						reel: 1,
						row: 0,
					},
					{
						reel: 1,
						row: 1,
					},
					{
						reel: 1,
						row: 2,
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
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 0,
						row: 1,
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
							name: 'S',
							value: 2,
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
							value: 7,
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
				index: 5,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
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
				],
			},
			{
				index: 6,
				type: 'respinUpdate',
				left: 3,
				played: 1,
				start: 3,
				reset: true,
			},
			{
				index: 7,
				type: 'columnComplete',
				reel: 0,
				letter: 'G',
				newlyLit: true,
				cleared: true,
				value: 17,
				amount: 1700,
				cells: [
					{
						reel: 0,
						row: 0,
					},
					{
						reel: 0,
						row: 1,
					},
					{
						reel: 0,
						row: 2,
					},
				],
			},
			{
				index: 8,
				type: 'jackpotWin',
				tier: 'MINI',
				amount: 1500,
				source: 'column',
				banked: false,
				cell: {
					reel: 0,
					row: 1,
				},
			},
			{
				index: 9,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					start: 3,
					left: 3,
					played: 1,
					banked: 2500,
					total: 3400,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [0, 1],
				},
			},
			{
				index: 10,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'S',
							value: 2,
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
							value: 7,
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
				index: 11,
				type: 'respinUpdate',
				left: 2,
				played: 2,
				start: 3,
				reset: false,
			},
			{
				index: 12,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					start: 3,
					left: 2,
					played: 2,
					banked: 2500,
					total: 3400,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [0, 1],
				},
			},
			{
				index: 13,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'S',
							value: 2,
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
							value: 7,
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
				index: 14,
				type: 'respinUpdate',
				left: 1,
				played: 3,
				start: 3,
				reset: false,
			},
			{
				index: 15,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					start: 3,
					left: 1,
					played: 3,
					banked: 2500,
					total: 3400,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [0, 1],
				},
			},
			{
				index: 16,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'S',
							value: 2,
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
							value: 7,
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
				played: 4,
				start: 3,
				reset: false,
			},
			{
				index: 18,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
					],
					start: 3,
					left: 0,
					played: 4,
					banked: 2500,
					total: 3400,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [0, 1],
				},
			},
			{
				index: 19,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 3400,
				payload: {
					cells: [
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 2,
							},
							amount: 200,
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 7,
							},
							amount: 700,
						},
					],
					banked: 2500,
				},
			},
			{
				index: 20,
				type: 'setWin',
				amount: 3400,
				winLevel: 7,
			},
			{
				index: 21,
				type: 'setTotalWin',
				amount: 3400,
			},
			{
				index: 22,
				type: 'finalWin',
				amount: 3400,
			},
		],
	},
	{
		id: 2,
		name: 'classicLetters',
		payoutMultiplier: 1039,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
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
							name: 'H2',
							value: 2,
						},
						{
							name: 'S',
							value: 4,
						},
						{
							name: 'S',
							value: 4,
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
							name: 'L4',
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
							name: 'L3',
						},
						{
							name: 'S',
							value: 3,
						},
						{
							name: 'S',
							value: 3,
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
							name: 'W',
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
							name: 'L1',
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
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'count',
				payload: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 1,
							row: 0,
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
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
				},
			},
			{
				index: 2,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 1,
							row: 0,
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
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 1300,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 3,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 4,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 1,
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
							name: 'S',
							value: 4,
						},
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
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
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
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
							name: 'S',
							value: 1,
						},
					},
				],
			},
			{
				index: 4,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 1,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
					{
						reel: 2,
						row: 0,
						symbol: {
							name: 'S',
							value: 4,
						},
					},
					{
						reel: 2,
						row: 1,
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
							value: 3,
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
							name: 'S',
							value: 3,
						},
					},
					{
						reel: 4,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
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
							name: 'S',
							value: 1,
						},
					},
				],
			},
			{
				index: 5,
				type: 'respinUpdate',
				left: 3,
				played: 1,
				start: 3,
				reset: true,
			},
			{
				index: 6,
				type: 'columnComplete',
				reel: 0,
				letter: 'G',
				newlyLit: true,
				cleared: true,
				value: 8,
				amount: 800,
				cells: [
					{
						reel: 0,
						row: 0,
					},
					{
						reel: 0,
						row: 1,
					},
					{
						reel: 0,
						row: 2,
					},
				],
			},
			{
				index: 7,
				type: 'columnComplete',
				reel: 1,
				letter: 'R',
				newlyLit: true,
				cleared: true,
				value: 5,
				amount: 500,
				cells: [
					{
						reel: 1,
						row: 0,
					},
					{
						reel: 1,
						row: 1,
					},
					{
						reel: 1,
						row: 2,
					},
				],
			},
			{
				index: 8,
				type: 'columnComplete',
				reel: 2,
				letter: 'A',
				newlyLit: true,
				cleared: true,
				value: 8,
				amount: 800,
				cells: [
					{
						reel: 2,
						row: 0,
					},
					{
						reel: 2,
						row: 1,
					},
					{
						reel: 2,
						row: 2,
					},
				],
			},
			{
				index: 9,
				type: 'columnComplete',
				reel: 3,
				letter: 'N',
				newlyLit: true,
				cleared: true,
				value: 9,
				amount: 900,
				cells: [
					{
						reel: 3,
						row: 0,
					},
					{
						reel: 3,
						row: 1,
					},
					{
						reel: 3,
						row: 2,
					},
				],
			},
			{
				index: 10,
				type: 'columnComplete',
				reel: 4,
				letter: 'D',
				newlyLit: true,
				cleared: true,
				value: 9,
				amount: 900,
				cells: [
					{
						reel: 4,
						row: 0,
					},
					{
						reel: 4,
						row: 1,
					},
					{
						reel: 4,
						row: 2,
					},
				],
			},
			{
				index: 11,
				type: 'jackpotWin',
				tier: 'GRAND',
				amount: 100000,
				source: 'letters',
				banked: true,
			},
			{
				index: 12,
				type: 'holdAndWinState',
				snapshot: {
					cells: [],
					start: 3,
					left: 0,
					played: 1,
					banked: 103900,
					total: 103900,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [0, 1, 2, 3, 4],
				},
			},
			{
				index: 13,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 103900,
				payload: {
					cells: [],
					banked: 103900,
				},
			},
			{
				index: 14,
				type: 'setWin',
				amount: 103900,
				winLevel: 10,
			},
			{
				index: 15,
				type: 'setTotalWin',
				amount: 103900,
			},
			{
				index: 16,
				type: 'finalWin',
				amount: 103900,
			},
		],
	},
	{
		id: 3,
		name: 'classicMultiplierJackpot',
		payoutMultiplier: 62,
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
							name: 'H2',
						},
						{
							name: 'W',
							jackpot: 'MINI',
						},
						{
							name: 'W',
							jackpot: 'MINI',
						},
					],
					[
						{
							name: 'S',
							value: 7,
						},
						{
							name: 'S',
							value: 7,
						},
						{
							name: 'H2',
						},
						{
							name: 'H2',
							value: 3,
						},
						{
							name: 'H2',
							value: 3,
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
							name: 'L1',
						},
						{
							name: 'S',
							value: 3,
						},
						{
							name: 'S',
							value: 3,
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
							name: 'W',
						},
						{
							name: 'S',
							value: 4,
						},
						{
							name: 'S',
							value: 4,
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
							name: 'L4',
						},
						{
							name: 'H3',
						},
						{
							name: 'H3',
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
							reel: 0,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
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
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
					],
					respins: 3,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
				},
			},
			{
				index: 2,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 7,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 3,
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
							row: 2,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 3100,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 3,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H2',
							value: 2,
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
							name: 'W',
							jackpot: 'MINI',
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 7,
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
							name: 'S',
							value: 3,
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
							name: 'S',
							value: 4,
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
				index: 4,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H2',
							value: 2,
						},
					},
				],
			},
			{
				index: 5,
				type: 'coinBoost',
				source: 'special',
				booster: {
					reel: 0,
					row: 0,
					symbol: {
						name: 'H2',
						value: 2,
					},
				},
				multiplier: 2,
				cells: [
					{
						reel: 0,
						row: 2,
						jackpot: 'MINI',
						from: 1,
						to: 2,
					},
					{
						reel: 1,
						row: 0,
						from: 7,
						to: 14,
					},
					{
						reel: 2,
						row: 2,
						from: 3,
						to: 6,
					},
					{
						reel: 3,
						row: 0,
						from: 2,
						to: 4,
					},
					{
						reel: 3,
						row: 2,
						from: 4,
						to: 8,
					},
				],
			},
			{
				index: 6,
				type: 'respinUpdate',
				left: 3,
				played: 1,
				start: 3,
				reset: true,
			},
			{
				index: 7,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H2',
								value: 2,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
								factor: 2,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 14,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 6,
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
					],
					start: 3,
					left: 3,
					played: 1,
					banked: 0,
					total: 6200,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 8,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H2',
							value: 2,
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
							name: 'W',
							jackpot: 'MINI',
							factor: 2,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 14,
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
							name: 'S',
							value: 6,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 4,
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
							value: 8,
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
				index: 9,
				type: 'respinUpdate',
				left: 2,
				played: 2,
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
								name: 'H2',
								value: 2,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
								factor: 2,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 14,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 6,
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
					],
					start: 3,
					left: 2,
					played: 2,
					banked: 0,
					total: 6200,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 11,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H2',
							value: 2,
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
							name: 'W',
							jackpot: 'MINI',
							factor: 2,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 14,
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
							name: 'S',
							value: 6,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 4,
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
							value: 8,
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
				index: 12,
				type: 'respinUpdate',
				left: 1,
				played: 3,
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
								name: 'H2',
								value: 2,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
								factor: 2,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 14,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 6,
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
					],
					start: 3,
					left: 1,
					played: 3,
					banked: 0,
					total: 6200,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 14,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H2',
							value: 2,
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
							name: 'W',
							jackpot: 'MINI',
							factor: 2,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'S',
							value: 14,
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
							name: 'S',
							value: 6,
						},
					},
					{
						reel: 3,
						row: 0,
						symbol: {
							name: 'S',
							value: 4,
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
							value: 8,
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
				index: 15,
				type: 'respinUpdate',
				left: 0,
				played: 4,
				start: 3,
				reset: false,
			},
			{
				index: 16,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'H2',
								value: 2,
							},
						},
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
								factor: 2,
							},
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 14,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 6,
							},
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 4,
							},
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 8,
							},
						},
					],
					start: 3,
					left: 0,
					played: 4,
					banked: 0,
					total: 6200,
					stickiness: 'allCoins',
					activeModifiers: ['multiplier'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 17,
				type: 'jackpotWin',
				tier: 'MINI',
				amount: 3000,
				source: 'coin',
				banked: false,
				cell: {
					reel: 0,
					row: 2,
				},
			},
			{
				index: 18,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 6200,
				payload: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'W',
								jackpot: 'MINI',
								factor: 2,
							},
							amount: 3000,
						},
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'S',
								value: 14,
							},
							amount: 1400,
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 6,
							},
							amount: 600,
						},
						{
							reel: 3,
							row: 0,
							symbol: {
								name: 'S',
								value: 4,
							},
							amount: 400,
						},
						{
							reel: 3,
							row: 2,
							symbol: {
								name: 'S',
								value: 8,
							},
							amount: 800,
						},
					],
					banked: 0,
				},
			},
			{
				index: 19,
				type: 'setWin',
				amount: 6200,
				winLevel: 8,
			},
			{
				index: 20,
				type: 'setTotalWin',
				amount: 6200,
			},
			{
				index: 21,
				type: 'finalWin',
				amount: 6200,
			},
		],
	},
	{
		id: 4,
		name: 'classicInstant',
		payoutMultiplier: 12,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
					[
						{
							name: 'H2',
							value: 3,
						},
						{
							name: 'H2',
							value: 3,
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
							name: 'L4',
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
							value: 3,
						},
						{
							name: 'S',
							value: 3,
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
							name: 'L4',
						},
						{
							name: 'L4',
						},
						{
							name: 'W',
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
							name: 'L1',
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
				type: 'coinInstantCollect',
				specials: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'H2',
							value: 3,
						},
					},
				],
				multiplier: 3,
				times: 1,
				cells: [
					{
						reel: 1,
						row: 0,
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
							value: 9,
						},
						amount: 900,
					},
				],
				amount: 1200,
			},
			{
				index: 2,
				type: 'setWin',
				amount: 1200,
				winLevel: 6,
			},
			{
				index: 3,
				type: 'setTotalWin',
				amount: 1200,
			},
			{
				index: 4,
				type: 'finalWin',
				amount: 1200,
			},
		],
	},
	{
		id: 5,
		name: 'collectorTrigger',
		payoutMultiplier: 46,
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
							name: 'W',
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
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'H4',
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
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'H2',
						},
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 5,
						},
					],
				],
				paddingPositions: [0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'pattern',
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
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 0,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
					],
					respins: 3,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
				},
			},
			{
				index: 0,
				type: 'holdAndWinWheel',
				prize: {
					type: 'coinBoost',
					multiplier: 2,
				},
			},
			{
				index: 3,
				type: 'coinBoost',
				source: 'wheel',
				multiplier: 2,
				cells: [
					{
						reel: 0,
						row: 2,
						from: 1,
						to: 2,
					},
					{
						reel: 2,
						row: 2,
						from: 5,
						to: 10,
					},
				],
			},
			{
				index: 4,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 1,
					symbol: {
						name: 'H4',
						value: 12,
					},
				},
				level: 1,
				cells: [
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 2,
						},
						amount: 200,
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 10,
						},
						amount: 1000,
					},
				],
				value: 12,
			},
			{
				index: 5,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 2,
					},
					{
						reel: 2,
						row: 2,
					},
				],
			},
			{
				index: 6,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 12,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 1200,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 7,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'H4',
							value: 12,
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
							name: 'S',
							value: 6,
						},
					},
				],
			},
			{
				index: 8,
				type: 'coinsLand',
				cells: [
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 6,
						},
					},
				],
			},
			{
				index: 9,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 1,
					symbol: {
						name: 'H4',
						value: 18,
					},
				},
				level: 1,
				cells: [
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 6,
						},
						amount: 600,
					},
				],
				value: 18,
			},
			{
				index: 10,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 2,
						row: 2,
					},
				],
			},
			{
				index: 11,
				type: 'respinUpdate',
				left: 3,
				played: 1,
				start: 3,
				reset: true,
			},
			{
				index: 12,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 18,
							},
						},
					],
					start: 3,
					left: 3,
					played: 1,
					banked: 0,
					total: 1800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 13,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'H4',
							value: 18,
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
				],
			},
			{
				index: 14,
				type: 'respinUpdate',
				left: 2,
				played: 2,
				start: 3,
				reset: false,
			},
			{
				index: 15,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 18,
							},
						},
					],
					start: 3,
					left: 2,
					played: 2,
					banked: 0,
					total: 1800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 16,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'BLANK',
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'H4',
							value: 18,
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
				],
			},
			{
				index: 17,
				type: 'respinUpdate',
				left: 1,
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
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 18,
							},
						},
					],
					start: 3,
					left: 1,
					played: 3,
					banked: 0,
					total: 1800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 19,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							value: 14,
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
							name: 'H4',
							value: 18,
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
				],
			},
			{
				index: 20,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 14,
						},
					},
					{
						reel: 1,
						row: 0,
						symbol: {
							name: 'H4',
							value: 0,
						},
					},
				],
			},
			{
				index: 21,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 0,
					symbol: {
						name: 'H4',
						value: 14,
					},
				},
				level: 1,
				cells: [
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 14,
						},
						amount: 1400,
					},
				],
				value: 14,
			},
			{
				index: 22,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 1,
					symbol: {
						name: 'H4',
						value: 32,
					},
				},
				level: 1,
				cells: [
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 14,
						},
						amount: 1400,
					},
				],
				value: 32,
			},
			{
				index: 23,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 2,
					},
				],
			},
			{
				index: 24,
				type: 'respinUpdate',
				left: 3,
				played: 4,
				start: 3,
				reset: true,
			},
			{
				index: 25,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'H4',
								value: 14,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 32,
							},
						},
					],
					start: 3,
					left: 3,
					played: 4,
					banked: 0,
					total: 4600,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 26,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 14,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'H4',
							value: 32,
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
				],
			},
			{
				index: 27,
				type: 'respinUpdate',
				left: 2,
				played: 5,
				start: 3,
				reset: false,
			},
			{
				index: 28,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'H4',
								value: 14,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 32,
							},
						},
					],
					start: 3,
					left: 2,
					played: 5,
					banked: 0,
					total: 4600,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 29,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 14,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'H4',
							value: 32,
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
				],
			},
			{
				index: 30,
				type: 'respinUpdate',
				left: 1,
				played: 6,
				start: 3,
				reset: false,
			},
			{
				index: 31,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'H4',
								value: 14,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 32,
							},
						},
					],
					start: 3,
					left: 1,
					played: 6,
					banked: 0,
					total: 4600,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 32,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 14,
						},
					},
					{
						reel: 1,
						row: 1,
						symbol: {
							name: 'H4',
							value: 32,
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
				],
			},
			{
				index: 33,
				type: 'respinUpdate',
				left: 0,
				played: 7,
				start: 3,
				reset: false,
			},
			{
				index: 34,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'H4',
								value: 14,
							},
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 32,
							},
						},
					],
					start: 3,
					left: 0,
					played: 7,
					banked: 0,
					total: 4600,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 35,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 4600,
				payload: {
					cells: [
						{
							reel: 1,
							row: 0,
							symbol: {
								name: 'H4',
								value: 14,
							},
							amount: 1400,
						},
						{
							reel: 1,
							row: 1,
							symbol: {
								name: 'H4',
								value: 32,
							},
							amount: 3200,
						},
					],
					banked: 0,
				},
			},
			{
				index: 36,
				type: 'setWin',
				amount: 4600,
				winLevel: 8,
			},
			{
				index: 37,
				type: 'setTotalWin',
				amount: 4600,
			},
			{
				index: 38,
				type: 'finalWin',
				amount: 4600,
			},
		],
	},
	{
		id: 6,
		name: 'collectorChain',
		payoutMultiplier: 88,
		events: [
			{
				index: 0,
				type: 'reveal',
				board: [
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
							name: 'H1',
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
							name: 'L1',
						},
						{
							name: 'L1',
						},
						{
							name: 'L1',
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
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'S',
							value: 3,
						},
						{
							name: 'H3',
						},
						{
							name: 'H3',
						},
					],
				],
				paddingPositions: [0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'pattern',
				payload: {
					cells: [
						{
							reel: 0,
							row: 0,
							symbol: {
								name: 'S',
								value: 2,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 0,
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
					],
					respins: 3,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
				},
			},
			{
				index: 1,
				type: 'holdAndWinWheel',
				prize: {
					type: 'extraCollect',
					count: 1,
				},
			},
			{
				index: 3,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 10,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
						amount: 200,
					},
					{
						reel: 2,
						row: 1,
						symbol: {
							name: 'S',
							value: 3,
						},
						amount: 300,
					},
				],
				value: 10,
			},
			{
				index: 4,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
					{
						reel: 2,
						row: 1,
					},
				],
			},
			{
				index: 5,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 10,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 1000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 6,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 5,
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
							name: 'H4',
							value: 10,
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
							name: 'S',
							value: 5,
						},
					},
				],
			},
			{
				index: 8,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 20,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 5,
						},
						amount: 500,
					},
				],
				value: 20,
			},
			{
				index: 9,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 10,
				type: 'respinUpdate',
				left: 3,
				played: 1,
				start: 3,
				reset: true,
			},
			{
				index: 11,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 3,
					played: 1,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
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
							value: 3,
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
							name: 'H4',
							value: 20,
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
				],
			},
			{
				index: 13,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
				],
			},
			{
				index: 14,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 26,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
						amount: 300,
					},
				],
				value: 26,
			},
			{
				index: 15,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 16,
				type: 'respinUpdate',
				left: 3,
				played: 2,
				start: 3,
				reset: true,
			},
			{
				index: 17,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 26,
							},
						},
					],
					start: 3,
					left: 3,
					played: 2,
					banked: 0,
					total: 2600,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 18,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
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
							name: 'H4',
							value: 26,
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
				],
			},
			{
				index: 19,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
				],
			},
			{
				index: 20,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 32,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
						amount: 300,
					},
				],
				value: 32,
			},
			{
				index: 21,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
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
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 32,
							},
						},
					],
					start: 3,
					left: 3,
					played: 3,
					banked: 0,
					total: 3200,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 24,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 7,
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
							name: 'H4',
							value: 32,
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
				],
			},
			{
				index: 25,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 7,
						},
					},
				],
			},
			{
				index: 26,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 46,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 7,
						},
						amount: 700,
					},
				],
				value: 46,
			},
			{
				index: 27,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 28,
				type: 'respinUpdate',
				left: 3,
				played: 4,
				start: 3,
				reset: true,
			},
			{
				index: 29,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 46,
							},
						},
					],
					start: 3,
					left: 3,
					played: 4,
					banked: 0,
					total: 4600,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
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
							value: 1,
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
							name: 'H4',
							value: 46,
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
				],
			},
			{
				index: 31,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
						},
					},
				],
			},
			{
				index: 32,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 48,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 1,
						},
						amount: 100,
					},
				],
				value: 48,
			},
			{
				index: 33,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 34,
				type: 'respinUpdate',
				left: 3,
				played: 5,
				start: 3,
				reset: true,
			},
			{
				index: 35,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 48,
							},
						},
					],
					start: 3,
					left: 3,
					played: 5,
					banked: 0,
					total: 4800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 36,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 5,
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
							name: 'H4',
							value: 48,
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
				],
			},
			{
				index: 37,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 5,
						},
					},
				],
			},
			{
				index: 38,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 58,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 5,
						},
						amount: 500,
					},
				],
				value: 58,
			},
			{
				index: 39,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 40,
				type: 'respinUpdate',
				left: 3,
				played: 6,
				start: 3,
				reset: true,
			},
			{
				index: 41,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 58,
							},
						},
					],
					start: 3,
					left: 3,
					played: 6,
					banked: 0,
					total: 5800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 42,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
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
							name: 'H4',
							value: 58,
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
				],
			},
			{
				index: 43,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
					},
				],
			},
			{
				index: 44,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 62,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 2,
						},
						amount: 200,
					},
				],
				value: 62,
			},
			{
				index: 45,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 46,
				type: 'respinUpdate',
				left: 3,
				played: 7,
				start: 3,
				reset: true,
			},
			{
				index: 47,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 62,
							},
						},
					],
					start: 3,
					left: 3,
					played: 7,
					banked: 0,
					total: 6200,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 48,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 7,
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
							name: 'H4',
							value: 62,
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
				],
			},
			{
				index: 49,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 7,
						},
					},
				],
			},
			{
				index: 50,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 76,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 7,
						},
						amount: 700,
					},
				],
				value: 76,
			},
			{
				index: 51,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 52,
				type: 'respinUpdate',
				left: 3,
				played: 8,
				start: 3,
				reset: true,
			},
			{
				index: 53,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 76,
							},
						},
					],
					start: 3,
					left: 3,
					played: 8,
					banked: 0,
					total: 7600,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 54,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
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
							name: 'H4',
							value: 76,
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
				],
			},
			{
				index: 55,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
				],
			},
			{
				index: 56,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 82,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
						amount: 300,
					},
				],
				value: 82,
			},
			{
				index: 57,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 58,
				type: 'respinUpdate',
				left: 3,
				played: 9,
				start: 3,
				reset: true,
			},
			{
				index: 59,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 82,
							},
						},
					],
					start: 3,
					left: 3,
					played: 9,
					banked: 0,
					total: 8200,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 60,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
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
							name: 'H4',
							value: 82,
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
				],
			},
			{
				index: 61,
				type: 'coinsLand',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
					},
				],
			},
			{
				index: 62,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 88,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'S',
							value: 3,
						},
						amount: 300,
					},
				],
				value: 88,
			},
			{
				index: 63,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 0,
					},
				],
			},
			{
				index: 64,
				type: 'respinUpdate',
				left: 3,
				played: 10,
				start: 3,
				reset: true,
			},
			{
				index: 65,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 88,
							},
						},
					],
					start: 3,
					left: 3,
					played: 10,
					banked: 0,
					total: 8800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 66,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 88,
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
				],
			},
			{
				index: 67,
				type: 'respinUpdate',
				left: 2,
				played: 11,
				start: 3,
				reset: false,
			},
			{
				index: 68,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 88,
							},
						},
					],
					start: 3,
					left: 2,
					played: 11,
					banked: 0,
					total: 8800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 69,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 88,
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
				],
			},
			{
				index: 70,
				type: 'respinUpdate',
				left: 1,
				played: 12,
				start: 3,
				reset: false,
			},
			{
				index: 71,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 88,
							},
						},
					],
					start: 3,
					left: 1,
					played: 12,
					banked: 0,
					total: 8800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 72,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 88,
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
				],
			},
			{
				index: 73,
				type: 'respinUpdate',
				left: 0,
				played: 13,
				start: 3,
				reset: false,
			},
			{
				index: 74,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 88,
							},
						},
					],
					start: 3,
					left: 0,
					played: 13,
					banked: 0,
					total: 8800,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 75,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 8800,
				payload: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 88,
							},
							amount: 8800,
						},
					],
					banked: 0,
				},
			},
			{
				index: 76,
				type: 'setWin',
				amount: 8800,
				winLevel: 9,
			},
			{
				index: 77,
				type: 'setTotalWin',
				amount: 8800,
			},
			{
				index: 78,
				type: 'finalWin',
				amount: 8800,
			},
		],
	},
	{
		id: 7,
		name: 'collectorWheelExtraCollect',
		payoutMultiplier: 20,
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
							name: 'L1',
						},
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 5,
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
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'L3',
						},
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 5,
						},
					],
				],
				paddingPositions: [0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'pattern',
				payload: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 0,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
					],
					respins: 3,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
				},
			},
			{
				index: 1,
				type: 'holdAndWinWheel',
				prize: {
					type: 'extraCollect',
					count: 1,
				},
			},
			{
				index: 3,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 20,
					},
				},
				level: 2,
				cells: [
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 5,
						},
						amount: 500,
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 5,
						},
						amount: 500,
					},
				],
				value: 20,
			},
			{
				index: 4,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 2,
					},
					{
						reel: 2,
						row: 2,
					},
				],
			},
			{
				index: 5,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 6,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 20,
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
				],
			},
			{
				index: 7,
				type: 'respinUpdate',
				left: 2,
				played: 1,
				start: 3,
				reset: false,
			},
			{
				index: 8,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 2,
					played: 1,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 9,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 20,
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
				],
			},
			{
				index: 10,
				type: 'respinUpdate',
				left: 1,
				played: 2,
				start: 3,
				reset: false,
			},
			{
				index: 11,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 1,
					played: 2,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 12,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 20,
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
				],
			},
			{
				index: 13,
				type: 'respinUpdate',
				left: 0,
				played: 3,
				start: 3,
				reset: false,
			},
			{
				index: 14,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 0,
					played: 3,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 2,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 15,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 2000,
				payload: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
							amount: 2000,
						},
					],
					banked: 0,
				},
			},
			{
				index: 16,
				type: 'setWin',
				amount: 2000,
				winLevel: 7,
			},
			{
				index: 17,
				type: 'setTotalWin',
				amount: 2000,
			},
			{
				index: 18,
				type: 'finalWin',
				amount: 2000,
			},
		],
	},
	{
		id: 8,
		name: 'collectorWheelCoinBoost',
		payoutMultiplier: 20,
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
							name: 'L1',
						},
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 5,
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
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'L3',
						},
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 5,
						},
					],
				],
				paddingPositions: [0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'pattern',
				payload: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 0,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
					],
					respins: 3,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
				},
			},
			{
				index: 0,
				type: 'holdAndWinWheel',
				prize: {
					type: 'coinBoost',
					multiplier: 2,
				},
			},
			{
				index: 3,
				type: 'coinBoost',
				source: 'wheel',
				multiplier: 2,
				cells: [
					{
						reel: 0,
						row: 2,
						from: 5,
						to: 10,
					},
					{
						reel: 2,
						row: 2,
						from: 5,
						to: 10,
					},
				],
			},
			{
				index: 4,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 20,
					},
				},
				level: 1,
				cells: [
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 10,
						},
						amount: 1000,
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 10,
						},
						amount: 1000,
					},
				],
				value: 20,
			},
			{
				index: 5,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 2,
					},
					{
						reel: 2,
						row: 2,
					},
				],
			},
			{
				index: 6,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 7,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 20,
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
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 2,
					played: 1,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 10,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 20,
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
				],
			},
			{
				index: 11,
				type: 'respinUpdate',
				left: 1,
				played: 2,
				start: 3,
				reset: false,
			},
			{
				index: 12,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 1,
					played: 2,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 13,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 20,
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
				],
			},
			{
				index: 14,
				type: 'respinUpdate',
				left: 0,
				played: 3,
				start: 3,
				reset: false,
			},
			{
				index: 15,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
						},
					],
					start: 3,
					left: 0,
					played: 3,
					banked: 0,
					total: 2000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 2,
					lettersLit: [],
				},
			},
			{
				index: 16,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 2000,
				payload: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 20,
							},
							amount: 2000,
						},
					],
					banked: 0,
				},
			},
			{
				index: 17,
				type: 'setWin',
				amount: 2000,
				winLevel: 7,
			},
			{
				index: 18,
				type: 'setTotalWin',
				amount: 2000,
			},
			{
				index: 19,
				type: 'finalWin',
				amount: 2000,
			},
		],
	},
	{
		id: 9,
		name: 'collectorWheelJackpotGrand',
		payoutMultiplier: 1010,
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
							name: 'L1',
						},
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 5,
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
							name: 'H3',
						},
						{
							name: 'H3',
						},
						{
							name: 'L3',
						},
						{
							name: 'S',
							value: 5,
						},
						{
							name: 'S',
							value: 5,
						},
					],
				],
				paddingPositions: [0, 0, 0],
				gameType: 'basegame',
			},
			{
				index: 1,
				type: 'holdAndWinTrigger',
				mode: 'holdAndWin',
				cause: 'pattern',
				payload: {
					cells: [
						{
							reel: 0,
							row: 2,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 0,
							},
						},
						{
							reel: 2,
							row: 2,
							symbol: {
								name: 'S',
								value: 5,
							},
						},
					],
					respins: 3,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
				},
			},
			{
				index: 6,
				type: 'holdAndWinWheel',
				prize: {
					type: 'jackpot',
					jackpot: 'GRAND',
				},
			},
			{
				index: 3,
				type: 'jackpotWin',
				tier: 'GRAND',
				amount: 100000,
				source: 'wheel',
				banked: true,
			},
			{
				index: 4,
				type: 'coinCollect',
				collector: {
					reel: 1,
					row: 2,
					symbol: {
						name: 'H4',
						value: 10,
					},
				},
				level: 1,
				cells: [
					{
						reel: 0,
						row: 2,
						symbol: {
							name: 'S',
							value: 5,
						},
						amount: 500,
					},
					{
						reel: 2,
						row: 2,
						symbol: {
							name: 'S',
							value: 5,
						},
						amount: 500,
					},
				],
				value: 10,
			},
			{
				index: 5,
				type: 'cellsCleared',
				reason: 'collected',
				cells: [
					{
						reel: 0,
						row: 2,
					},
					{
						reel: 2,
						row: 2,
					},
				],
			},
			{
				index: 6,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 10,
							},
						},
					],
					start: 3,
					left: 3,
					played: 0,
					banked: 100000,
					total: 101000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 7,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 10,
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
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 10,
							},
						},
					],
					start: 3,
					left: 2,
					played: 1,
					banked: 100000,
					total: 101000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 10,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 10,
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
				],
			},
			{
				index: 11,
				type: 'respinUpdate',
				left: 1,
				played: 2,
				start: 3,
				reset: false,
			},
			{
				index: 12,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 10,
							},
						},
					],
					start: 3,
					left: 1,
					played: 2,
					banked: 100000,
					total: 101000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 13,
				type: 'respinReveal',
				cells: [
					{
						reel: 0,
						row: 0,
						symbol: {
							name: 'BLANK',
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
							name: 'H4',
							value: 10,
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
				],
			},
			{
				index: 14,
				type: 'respinUpdate',
				left: 0,
				played: 3,
				start: 3,
				reset: false,
			},
			{
				index: 15,
				type: 'holdAndWinState',
				snapshot: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 10,
							},
						},
					],
					start: 3,
					left: 0,
					played: 3,
					banked: 100000,
					total: 101000,
					stickiness: 'collectorsOnly',
					activeModifiers: ['collector'],
					collectorLevel: 1,
					coinBoost: 1,
					lettersLit: [],
				},
			},
			{
				index: 16,
				type: 'holdAndWinEnd',
				mode: 'holdAndWin',
				total: 101000,
				payload: {
					cells: [
						{
							reel: 1,
							row: 2,
							symbol: {
								name: 'H4',
								value: 10,
							},
							amount: 1000,
						},
					],
					banked: 100000,
				},
			},
			{
				index: 17,
				type: 'setWin',
				amount: 101000,
				winLevel: 10,
			},
			{
				index: 18,
				type: 'setTotalWin',
				amount: 101000,
			},
			{
				index: 19,
				type: 'finalWin',
				amount: 101000,
			},
		],
	},
];
