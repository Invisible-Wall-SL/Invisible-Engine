export default {
	reveal: {
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
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'S',
					scatter: true,
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
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
			],
			[
				{
					name: 'L3',
				},
				{
					name: 'H3',
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
					name: 'L2',
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
					name: 'S',
					scatter: true,
				},
				{
					name: 'L2',
				},
				{
					name: 'H2',
				},
				{
					name: 'H2',
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
					name: 'H1',
				},
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
					name: 'S',
					scatter: true,
				},
				{
					name: 'H3',
				},
				{
					name: 'L1',
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
					name: 'H3',
				},
				{
					name: 'S',
					scatter: true,
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
			],
		],
		paddingPositions: [98, 155, 195, 101, 98, 41],
		gameType: 'basegame',
	},
	setTotalWin: {
		type: 'setTotalWin',
		amount: 1000,
	},
	freeSpinTrigger: {
		type: 'freeSpinTrigger',
		totalFs: 10,
		positions: [
			{
				reel: 0,
				row: 4,
			},
			{
				reel: 3,
				row: 1,
			},
			{
				reel: 4,
				row: 4,
			},
			{
				reel: 5,
				row: 4,
			},
		],
	},
	updateFreeSpin: {
		type: 'updateFreeSpin',
		amount: 5,
		total: 10,
	},
	winInfo: {
		type: 'winInfo',
		totalWin: 120,
		wins: [
			{
				symbol: 'L2',
				win: 120,
				positions: [
					{
						reel: 2,
						row: 3,
					},
					{
						reel: 2,
						row: 4,
					},
					{
						reel: 3,
						row: 1,
					},
					{
						reel: 3,
						row: 5,
					},
					{
						reel: 4,
						row: 1,
					},
					{
						reel: 4,
						row: 3,
					},
					{
						reel: 4,
						row: 5,
					},
					{
						reel: 5,
						row: 2,
					},
					{
						reel: 5,
						row: 3,
					},
				],
				meta: {
					globalMult: 1,
					clusterMult: 1,
					winWithoutMult: 120,
					overlay: {
						reel: 2,
						row: 3,
					},
				},
			},
		],
	},
	updateTumbleWin: {
		type: 'updateTumbleWin',
		amount: 120,
	},
	tumbleBoard: {
		type: 'tumbleBoard',
		newSymbols: [
			[],
			[],
			[
				{
					name: 'L1',
				},
				{
					name: 'L1',
				},
			],
			[
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
			],
			[
				{
					name: 'L2',
				},
				{
					name: 'L1',
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
					name: 'L2',
				},
			],
		],
		explodingSymbols: [
			{
				reel: 2,
				row: 3,
			},
			{
				reel: 2,
				row: 4,
			},
			{
				reel: 3,
				row: 1,
			},
			{
				reel: 3,
				row: 5,
			},
			{
				reel: 4,
				row: 1,
			},
			{
				reel: 4,
				row: 3,
			},
			{
				reel: 4,
				row: 5,
			},
			{
				reel: 5,
				row: 2,
			},
			{
				reel: 5,
				row: 3,
			},
		],
	},
	updateGlobalMult: {
		type: 'updateGlobalMult',
		globalMult: 2,
	},
	boardMultiplierInfo: {
		type: 'boardMultiplierInfo',
		multInfo: {
			positions: [
				{
					reel: 2,
					row: 4,
					multiplier: 3,
				},
			],
		},
		winInfo: {
			tumbleWin: 120,
			boardMult: 3,
			totalWin: 360,
		},
	},
	setWin: {
		type: 'setWin',
		amount: 360,
		winLevel: 4,
	},
	freeSpinEnd: {
		type: 'freeSpinEnd',
		amount: 4380,
		winLevel: 5,
	},
	finalWin: {
		type: 'finalWin',
		amount: 4380,
	},
};
