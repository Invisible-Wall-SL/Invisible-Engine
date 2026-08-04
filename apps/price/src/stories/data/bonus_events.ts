export default {
	reveal: {
		type: 'reveal',
		board: [
			[
				{
					name: 'H3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'S',
					scatter: true,
				},
				{
					name: 'H2',
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
					name: 'H3',
				},
				{
					name: 'L5',
				},
			],
			[
				{
					name: 'H2',
				},
				{
					name: 'S',
					scatter: true,
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
			],
			[
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'S',
					scatter: true,
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
			],
			[
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'S',
					scatter: true,
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
			],
		],
		paddingPositions: [279, 622, 216, 11, 71],
		gameType: 'freegame',
	},
	setTotalWin: {
		type: 'setTotalWin',
		amount: 0,
	},
	freeSpinTrigger: {
		type: 'freeSpinTrigger',
		totalFs: 12,
		positions: [
			{
				reel: 0,
				row: 4,
			},
			{
				reel: 2,
				row: 1,
			},
			{
				reel: 3,
				row: 4,
			},
			{
				reel: 4,
				row: 4,
			},
		],
	},
	updateFreeSpin: {
		type: 'updateFreeSpin',
		amount: 1,
		total: 12,
	},
	newExpandingWilds: {
		type: 'newExpandingWilds',
		newWilds: [
			{
				reel: 2,
				row: 1,
				mult: 3,
			},
			{
				reel: 0,
				row: 4,
				mult: 3,
			},
		],
	},
	updateExpandingWilds: {
		type: 'updateExpandingWilds',
		existingWilds: [
			{
				reel: 0,
				row: 1,
				mult: 10,
			},
			{
				reel: 2,
				row: 1,
				mult: 5,
			},
		],
	},
	winInfo: {
		type: 'winInfo',
		totalWin: 36890,
		wins: [
			{
				symbol: 'H2',
				kind: 3,
				win: 1500,
				positions: [
					{
						reel: 0,
						row: 1,
					},
					{
						reel: 1,
						row: 1,
					},
					{
						reel: 2,
						row: 1,
					},
				],
				meta: {
					lineIndex: 1,
					multiplier: 5,
					winWithoutMult: 3,
					globalMult: 1,
					lineMultiplier: 5,
				},
			},
			{
				symbol: 'H1',
				kind: 3,
				win: 3500,
				positions: [
					{
						reel: 0,
						row: 2,
					},
					{
						reel: 1,
						row: 2,
					},
					{
						reel: 2,
						row: 2,
					},
				],
				meta: {
					lineIndex: 2,
					multiplier: 7,
					winWithoutMult: 5,
					globalMult: 1,
					lineMultiplier: 7,
				},
			},
			{
				symbol: 'H1',
				kind: 3,
				win: 4500,
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
					multiplier: 9,
					winWithoutMult: 5,
					globalMult: 1,
					lineMultiplier: 9,
				},
			},
			{
				symbol: 'L3',
				kind: 3,
				win: 180,
				positions: [
					{
						reel: 0,
						row: 4,
					},
					{
						reel: 1,
						row: 4,
					},
					{
						reel: 2,
						row: 4,
					},
				],
				meta: {
					lineIndex: 4,
					multiplier: 6,
					winWithoutMult: 0.3,
					globalMult: 1,
					lineMultiplier: 6,
				},
			},
			{
				symbol: 'H4',
				kind: 3,
				win: 1300,
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
					multiplier: 13,
					winWithoutMult: 1,
					globalMult: 1,
					lineMultiplier: 13,
				},
			},
			{
				symbol: 'H1',
				kind: 3,
				win: 2500,
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
				],
				meta: {
					lineIndex: 6,
					multiplier: 5,
					winWithoutMult: 5,
					globalMult: 1,
					lineMultiplier: 5,
				},
			},
			{
				symbol: 'H1',
				kind: 3,
				win: 3500,
				positions: [
					{
						reel: 0,
						row: 2,
					},
					{
						reel: 1,
						row: 3,
					},
					{
						reel: 2,
						row: 2,
					},
				],
				meta: {
					lineIndex: 7,
					multiplier: 7,
					winWithoutMult: 5,
					globalMult: 1,
					lineMultiplier: 7,
				},
			},
			{
				symbol: 'L3',
				kind: 3,
				win: 270,
				positions: [
					{
						reel: 0,
						row: 3,
					},
					{
						reel: 1,
						row: 4,
					},
					{
						reel: 2,
						row: 3,
					},
				],
				meta: {
					lineIndex: 8,
					multiplier: 9,
					winWithoutMult: 0.3,
					globalMult: 1,
					lineMultiplier: 9,
				},
			},
			{
				symbol: 'H4',
				kind: 3,
				win: 600,
				positions: [
					{
						reel: 0,
						row: 4,
					},
					{
						reel: 1,
						row: 5,
					},
					{
						reel: 2,
						row: 4,
					},
				],
				meta: {
					lineIndex: 9,
					multiplier: 6,
					winWithoutMult: 1,
					globalMult: 1,
					lineMultiplier: 6,
				},
			},
			{
				symbol: 'H2',
				kind: 3,
				win: 2100,
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
					multiplier: 7,
					winWithoutMult: 3,
					globalMult: 1,
					lineMultiplier: 7,
				},
			},
			{
				symbol: 'H1',
				kind: 3,
				win: 4500,
				positions: [
					{
						reel: 0,
						row: 3,
					},
					{
						reel: 1,
						row: 2,
					},
					{
						reel: 2,
						row: 3,
					},
				],
				meta: {
					lineIndex: 11,
					multiplier: 9,
					winWithoutMult: 5,
					globalMult: 1,
					lineMultiplier: 9,
				},
			},
			{
				symbol: 'H1',
				kind: 3,
				win: 3000,
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
					multiplier: 6,
					winWithoutMult: 5,
					globalMult: 1,
					lineMultiplier: 6,
				},
			},
			{
				symbol: 'L3',
				kind: 3,
				win: 390,
				positions: [
					{
						reel: 0,
						row: 5,
					},
					{
						reel: 1,
						row: 4,
					},
					{
						reel: 2,
						row: 5,
					},
				],
				meta: {
					lineIndex: 13,
					multiplier: 13,
					winWithoutMult: 0.3,
					globalMult: 1,
					lineMultiplier: 13,
				},
			},
			{
				symbol: 'H1',
				kind: 4,
				win: 8000,
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
						row: 3,
					},
					{
						reel: 3,
						row: 4,
					},
				],
				meta: {
					lineIndex: 14,
					multiplier: 8,
					winWithoutMult: 10,
					globalMult: 1,
					lineMultiplier: 8,
				},
			},
			{
				symbol: 'L3',
				kind: 4,
				win: 1050,
				positions: [
					{
						reel: 0,
						row: 5,
					},
					{
						reel: 1,
						row: 4,
					},
					{
						reel: 2,
						row: 3,
					},
					{
						reel: 3,
						row: 2,
					},
				],
				meta: {
					lineIndex: 15,
					multiplier: 15,
					winWithoutMult: 0.7,
					globalMult: 1,
					lineMultiplier: 15,
				},
			},
		],
	},
	setWin: {
		type: 'setWin',
		amount: 36890,
		winLevel: 9,
	},
	winCap: {
		type: 'winCap',
		amount: 500000,
	},
	freeSpinEnd: {
		type: 'freeSpinEnd',
		amount: 500000,
		winLevel: 10,
	},
	finalWin: {
		type: 'finalWin',
		amount: 500000,
	},
};
