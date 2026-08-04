export default {
	updateFreeSpin: {
		type: 'updateFreeSpin',
		amount: 1,
		total: 3,
	},
	reveal: {
		type: 'reveal',
		board: [
			[
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
			],
			[
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
			],
			[
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
			],
			[
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
			],
			[
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
				{
					name: 'X',
				},
			],
		],
		paddingPositions: [8, 32, 15, 63, 57],
		gameType: 'superspin',
	},
	newStickySymbols: {
		type: 'newStickySymbols',
		newPrizes: [
			{
				reel: 4,
				row: 4,
				prize: 100,
			},
		],
	},
	prizeWinInfo: {
		type: 'prizeWinInfo',
		totalWin: 1300,
		wins: [
			{
				reel: 0,
				row: 1,
				prize: 100,
			},
			{
				reel: 0,
				row: 3,
				prize: 100,
			},
			{
				reel: 1,
				row: 1,
				prize: 100,
			},
			{
				reel: 1,
				row: 3,
				prize: 100,
			},
			{
				reel: 1,
				row: 4,
				prize: 100,
			},
			{
				reel: 2,
				row: 0,
				prize: 200,
			},
			{
				reel: 2,
				row: 1,
				prize: 100,
			},
			{
				reel: 3,
				row: 4,
				prize: 100,
			},
			{
				reel: 4,
				row: 1,
				prize: 100,
			},
			{
				reel: 4,
				row: 2,
				prize: 100,
			},
			{
				reel: 4,
				row: 3,
				prize: 100,
			},
			{
				reel: 4,
				row: 4,
				prize: 100,
			},
		],
	},
	setWin: {
		type: 'setWin',
		amount: 1300,
		winLevel: 5,
	},
	setTotalWin: {
		type: 'setTotalWin',
		amount: 1300,
	},
	finalWin: {
		type: 'finalWin',
		amount: 1300,
	},
};
