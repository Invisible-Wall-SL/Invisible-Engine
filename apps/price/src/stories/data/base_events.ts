export default {
	reveal: {
		type: 'reveal',
		board: [
			[
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
			],
			[
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
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
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
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
					name: 'L2',
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
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
			],
			[
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
			],
		],
		paddingPositions: [64, 261, 120, 507, 460],
		gameType: 'basegame',
	},
	setTotalWin: {
		type: 'setTotalWin',
		amount: 0,
	},
	finalWin: {
		type: 'finalWin',
		amount: 0,
	},
	freeSpinTrigger: {
		type: 'freeSpinTrigger',
		totalFs: 15,
		positions: [
			{
				reel: 0,
				row: 5,
			},
			{
				reel: 1,
				row: 1,
			},
			{
				reel: 2,
				row: 5,
			},
			{
				reel: 3,
				row: 2,
			},
			{
				reel: 4,
				row: 1,
			},
		],
	},
	updateFreeSpin: {
		type: 'updateFreeSpin',
		amount: 1,
		total: 15,
	},
	newExpandingWilds: {
		type: 'newExpandingWilds',
		newWilds: [
			{
				reel: 4,
				row: 3,
				mult: 3,
			},
		],
	},
	updateExpandingWilds: {
		type: 'updateExpandingWilds',
		existingWilds: [
			{
				reel: 4,
				row: 1,
				mult: 3,
			},
		],
	},
	winInfo: {
		type: 'winInfo',
		totalWin: 3850,
		wins: [
			{
				symbol: 'L1',
				kind: 3,
				win: 100,
				positions: [
					{
						reel: 0,
						row: 3,
					},
					{
						reel: 1,
						row: 3,
					},
					{
						reel: 2,
						row: 3,
					},
				],
				meta: {
					lineIndex: 3,
					multiplier: 2,
					winWithoutMult: 0.5,
					globalMult: 1,
					lineMultiplier: 2,
				},
			},
			{
				symbol: 'H4',
				kind: 3,
				win: 300,
				positions: [
					{
						reel: 0,
						row: 5,
					},
					{
						reel: 1,
						row: 5,
					},
					{
						reel: 2,
						row: 5,
					},
				],
				meta: {
					lineIndex: 5,
					multiplier: 3,
					winWithoutMult: 1,
					globalMult: 1,
					lineMultiplier: 3,
				},
			},
			{
				symbol: 'L5',
				kind: 5,
				win: 3000,
				positions: [
					{
						reel: 0,
						row: 1,
					},
					{
						reel: 1,
						row: 2,
					},
					{
						reel: 2,
						row: 1,
					},
					{
						reel: 3,
						row: 2,
					},
					{
						reel: 4,
						row: 1,
					},
				],
				meta: {
					lineIndex: 6,
					multiplier: 15,
					winWithoutMult: 2,
					globalMult: 1,
					lineMultiplier: 15,
				},
			},
			{
				symbol: 'H4',
				kind: 3,
				win: 200,
				positions: [
					{
						reel: 0,
						row: 2,
					},
					{
						reel: 1,
						row: 1,
					},
					{
						reel: 2,
						row: 2,
					},
				],
				meta: {
					lineIndex: 10,
					multiplier: 2,
					winWithoutMult: 1,
					globalMult: 1,
					lineMultiplier: 2,
				},
			},
			{
				symbol: 'L1',
				kind: 3,
				win: 250,
				positions: [
					{
						reel: 0,
						row: 4,
					},
					{
						reel: 1,
						row: 3,
					},
					{
						reel: 2,
						row: 4,
					},
				],
				meta: {
					lineIndex: 12,
					multiplier: 5,
					winWithoutMult: 0.5,
					globalMult: 1,
					lineMultiplier: 5,
				},
			},
		],
	},
	setWin: {
		type: 'setWin',
		amount: 3850,
		winLevel: 7,
	},
	freeSpinEnd: {
		type: 'freeSpinEnd',
		amount: 63309,
		winLevel: 9,
	},
	winCap: {
		type: 'winCap',
		amount: 500000,
	},
};
