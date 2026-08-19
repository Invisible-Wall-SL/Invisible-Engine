export default {
	providerName: 'sample_provider',
	gameName: 'sample_lines',
	gameID: '0_0_ways',
	rtp: 0.97,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	betModes: {
		base: {
			cost: 1.0,
			feature: true,
			buyBonus: false,
			rtp: 0.97,
			max_win: 5000,
		},
		bonus: {
			cost: 100.0,
			feature: false,
			buyBonus: true,
			rtp: 0.97,
			max_win: 5000,
		},
	},
	symbols: {
		W: {
			paytable: null,
			special_properties: ['wild'],
		},
		H4: {
			paytable: [
				{
					'5': 3,
				},
				{
					'4': 1,
				},
				{
					'3': 0.5,
				},
			],
		},
		H5: {
			paytable: [
				{
					'5': 2,
				},
				{
					'4': 0.8,
				},
				{
					'3': 0.4,
				},
			],
		},
		S: {
			paytable: null,
			special_properties: ['scatter'],
		},
		L1: {
			paytable: [
				{
					'5': 2,
				},
				{
					'4': 0.8,
				},
				{
					'3': 0.4,
				},
			],
		},
		L2: {
			paytable: [
				{
					'5': 1.5,
				},
				{
					'4': 0.5,
				},
				{
					'3': 0.2,
				},
			],
		},
		L3: {
			paytable: [
				{
					'5': 1.5,
				},
				{
					'4': 0.5,
				},
				{
					'3': 0.2,
				},
			],
		},
		L4: {
			paytable: [
				{
					'5': 1,
				},
				{
					'4': 0.3,
				},
				{
					'3': 0.1,
				},
			],
		},
		H3: {
			paytable: [
				{
					'5': 5,
				},
				{
					'4': 2,
				},
				{
					'3': 1,
				},
			],
		},
		H2: {
			paytable: [
				{
					'5': 8,
				},
				{
					'4': 4,
				},
				{
					'3': 2,
				},
			],
		},
		H1: {
			paytable: [
				{
					'5': 10,
				},
				{
					'4': 5,
				},
				{
					'3': 3,
				},
			],
		},
	},
	// COSMETIC padding reels — the spinning blur, the initial board, and the in-play GATE
	// (which symbols this game can show). NOT weighted math strips: `lines` and `scatter` ship
	// 200+ cell strips from Stake's math export where the frequencies ARE the hit rate, and
	// inventing those here would be fabricating game math. The client never computes wins — the
	// RGS does — and the engine synthesizes exactly this kind of plain rotation itself when the
	// RGS is authoritative (`serverPaddingReels`, "the real weighted strips never reach the
	// client"). Every dealt symbol appears equally often (45 each), shuffled deterministically per
	// reel so no column shows a short repeating cycle. A real math export replaces this wholesale.
	//
	// `W` is deliberately absent, matching `lines`: no RGS the engine talks to deals a wild, so a
	// wild on the strips would roll past and never land. Its paytable is null, so no payout is
	// advertised either way.
	paddingReels: {
		basegame: [
			[{ name: 'L1' }, { name: 'L4' }, { name: 'H3' }, { name: 'H1' }, { name: 'L2' }, { name: 'H1' }, { name: 'S' }, { name: 'L1' }, { name: 'H2' }, { name: 'H5' }, { name: 'L3' }, { name: 'L1' }, { name: 'H3' }, { name: 'H5' }, { name: 'L3' }, { name: 'H2' }, { name: 'H4' }, { name: 'L4' }, { name: 'L2' }, { name: 'H4' }, { name: 'H1' }, { name: 'H2' }, { name: 'L4' }, { name: 'H4' }, { name: 'H3' }, { name: 'L3' }, { name: 'S' }, { name: 'H5' }, { name: 'S' }, { name: 'L2' }],
			[{ name: 'S' }, { name: 'H5' }, { name: 'H5' }, { name: 'S' }, { name: 'H3' }, { name: 'H4' }, { name: 'L4' }, { name: 'L4' }, { name: 'L1' }, { name: 'H4' }, { name: 'L3' }, { name: 'H2' }, { name: 'H3' }, { name: 'H1' }, { name: 'L2' }, { name: 'L1' }, { name: 'H4' }, { name: 'H3' }, { name: 'H2' }, { name: 'L3' }, { name: 'H1' }, { name: 'L3' }, { name: 'L1' }, { name: 'L4' }, { name: 'S' }, { name: 'H5' }, { name: 'L2' }, { name: 'H2' }, { name: 'H1' }, { name: 'L2' }],
			[{ name: 'L3' }, { name: 'H1' }, { name: 'H4' }, { name: 'L1' }, { name: 'L3' }, { name: 'L4' }, { name: 'H1' }, { name: 'L1' }, { name: 'S' }, { name: 'H4' }, { name: 'H5' }, { name: 'H3' }, { name: 'S' }, { name: 'H1' }, { name: 'L2' }, { name: 'H5' }, { name: 'H4' }, { name: 'H3' }, { name: 'L1' }, { name: 'H3' }, { name: 'H2' }, { name: 'L3' }, { name: 'H5' }, { name: 'H2' }, { name: 'L4' }, { name: 'S' }, { name: 'L2' }, { name: 'L4' }, { name: 'H2' }, { name: 'L2' }],
			[{ name: 'H2' }, { name: 'L4' }, { name: 'L4' }, { name: 'H3' }, { name: 'H1' }, { name: 'H5' }, { name: 'H1' }, { name: 'H2' }, { name: 'S' }, { name: 'H3' }, { name: 'L4' }, { name: 'H4' }, { name: 'L2' }, { name: 'L2' }, { name: 'L1' }, { name: 'H1' }, { name: 'H4' }, { name: 'S' }, { name: 'H4' }, { name: 'L1' }, { name: 'H2' }, { name: 'L3' }, { name: 'H5' }, { name: 'S' }, { name: 'H5' }, { name: 'L3' }, { name: 'L3' }, { name: 'L1' }, { name: 'H3' }, { name: 'L2' }],
			[{ name: 'H1' }, { name: 'L4' }, { name: 'H4' }, { name: 'H5' }, { name: 'H2' }, { name: 'L1' }, { name: 'H4' }, { name: 'L3' }, { name: 'S' }, { name: 'L1' }, { name: 'L4' }, { name: 'H1' }, { name: 'H5' }, { name: 'L1' }, { name: 'S' }, { name: 'H2' }, { name: 'L4' }, { name: 'L2' }, { name: 'L2' }, { name: 'H3' }, { name: 'L3' }, { name: 'H2' }, { name: 'S' }, { name: 'H1' }, { name: 'H3' }, { name: 'H5' }, { name: 'L3' }, { name: 'H3' }, { name: 'H4' }, { name: 'L2' }],
		],
		freegame: [
			[{ name: 'H5' }, { name: 'H5' }, { name: 'H2' }, { name: 'L3' }, { name: 'L4' }, { name: 'H3' }, { name: 'L4' }, { name: 'H3' }, { name: 'H2' }, { name: 'H3' }, { name: 'S' }, { name: 'L3' }, { name: 'L2' }, { name: 'L2' }, { name: 'H2' }, { name: 'S' }, { name: 'L1' }, { name: 'L3' }, { name: 'H1' }, { name: 'L1' }, { name: 'L1' }, { name: 'L4' }, { name: 'H4' }, { name: 'H4' }, { name: 'H1' }, { name: 'H5' }, { name: 'H4' }, { name: 'S' }, { name: 'H1' }, { name: 'L2' }],
			[{ name: 'H2' }, { name: 'L3' }, { name: 'H5' }, { name: 'H4' }, { name: 'H2' }, { name: 'L1' }, { name: 'H3' }, { name: 'L2' }, { name: 'L4' }, { name: 'L2' }, { name: 'L1' }, { name: 'H1' }, { name: 'H1' }, { name: 'L4' }, { name: 'H4' }, { name: 'S' }, { name: 'H5' }, { name: 'H1' }, { name: 'L3' }, { name: 'H3' }, { name: 'L1' }, { name: 'H5' }, { name: 'H3' }, { name: 'L4' }, { name: 'L3' }, { name: 'S' }, { name: 'H4' }, { name: 'S' }, { name: 'H2' }, { name: 'L2' }],
			[{ name: 'H2' }, { name: 'H2' }, { name: 'H4' }, { name: 'S' }, { name: 'L4' }, { name: 'L4' }, { name: 'S' }, { name: 'L3' }, { name: 'L2' }, { name: 'H1' }, { name: 'L1' }, { name: 'L3' }, { name: 'H1' }, { name: 'S' }, { name: 'L1' }, { name: 'H4' }, { name: 'H5' }, { name: 'L4' }, { name: 'H3' }, { name: 'L1' }, { name: 'L2' }, { name: 'H1' }, { name: 'H2' }, { name: 'H3' }, { name: 'H5' }, { name: 'L3' }, { name: 'H5' }, { name: 'H4' }, { name: 'H3' }, { name: 'L2' }],
			[{ name: 'H5' }, { name: 'L1' }, { name: 'H2' }, { name: 'H1' }, { name: 'H3' }, { name: 'H4' }, { name: 'H1' }, { name: 'L2' }, { name: 'L3' }, { name: 'H3' }, { name: 'H4' }, { name: 'L1' }, { name: 'L1' }, { name: 'L4' }, { name: 'S' }, { name: 'L3' }, { name: 'L4' }, { name: 'L3' }, { name: 'S' }, { name: 'H2' }, { name: 'S' }, { name: 'L4' }, { name: 'H2' }, { name: 'L2' }, { name: 'H3' }, { name: 'H5' }, { name: 'H5' }, { name: 'H1' }, { name: 'H4' }, { name: 'L2' }],
			[{ name: 'H4' }, { name: 'L3' }, { name: 'S' }, { name: 'H3' }, { name: 'H5' }, { name: 'H2' }, { name: 'H4' }, { name: 'L3' }, { name: 'H3' }, { name: 'L4' }, { name: 'H3' }, { name: 'S' }, { name: 'L2' }, { name: 'L1' }, { name: 'L1' }, { name: 'H4' }, { name: 'L1' }, { name: 'L3' }, { name: 'S' }, { name: 'L4' }, { name: 'H1' }, { name: 'L4' }, { name: 'H1' }, { name: 'H2' }, { name: 'H1' }, { name: 'H2' }, { name: 'H5' }, { name: 'L2' }, { name: 'H5' }, { name: 'L2' }],
		],
		superspingame: [
			[{ name: 'L1' }, { name: 'H2' }, { name: 'L4' }, { name: 'L3' }, { name: 'S' }, { name: 'L3' }, { name: 'L4' }, { name: 'L2' }, { name: 'L2' }, { name: 'H4' }, { name: 'L2' }, { name: 'H3' }, { name: 'H3' }, { name: 'H5' }, { name: 'H3' }, { name: 'L1' }, { name: 'H1' }, { name: 'L1' }, { name: 'H4' }, { name: 'H2' }, { name: 'H4' }, { name: 'L4' }, { name: 'H1' }, { name: 'H5' }, { name: 'S' }, { name: 'S' }, { name: 'H1' }, { name: 'H5' }, { name: 'H2' }, { name: 'L3' }],
			[{ name: 'H1' }, { name: 'H5' }, { name: 'S' }, { name: 'L4' }, { name: 'H3' }, { name: 'L1' }, { name: 'L3' }, { name: 'H1' }, { name: 'L1' }, { name: 'H2' }, { name: 'L2' }, { name: 'H4' }, { name: 'H3' }, { name: 'H4' }, { name: 'S' }, { name: 'L2' }, { name: 'L3' }, { name: 'L2' }, { name: 'L4' }, { name: 'H5' }, { name: 'H5' }, { name: 'H4' }, { name: 'L4' }, { name: 'H1' }, { name: 'L1' }, { name: 'S' }, { name: 'H2' }, { name: 'H2' }, { name: 'H3' }, { name: 'L3' }],
			[{ name: 'H2' }, { name: 'L4' }, { name: 'S' }, { name: 'L4' }, { name: 'H1' }, { name: 'L4' }, { name: 'L2' }, { name: 'S' }, { name: 'H1' }, { name: 'H1' }, { name: 'H3' }, { name: 'L3' }, { name: 'L1' }, { name: 'L1' }, { name: 'H4' }, { name: 'H3' }, { name: 'L2' }, { name: 'H5' }, { name: 'L1' }, { name: 'H2' }, { name: 'H5' }, { name: 'S' }, { name: 'L2' }, { name: 'H4' }, { name: 'H4' }, { name: 'H5' }, { name: 'H2' }, { name: 'L3' }, { name: 'H3' }, { name: 'L3' }],
			[{ name: 'H1' }, { name: 'L4' }, { name: 'L2' }, { name: 'L1' }, { name: 'S' }, { name: 'H1' }, { name: 'L3' }, { name: 'H3' }, { name: 'L4' }, { name: 'H4' }, { name: 'H2' }, { name: 'H3' }, { name: 'H3' }, { name: 'H5' }, { name: 'L4' }, { name: 'L2' }, { name: 'L1' }, { name: 'L2' }, { name: 'L3' }, { name: 'H5' }, { name: 'S' }, { name: 'H4' }, { name: 'L1' }, { name: 'S' }, { name: 'H1' }, { name: 'H2' }, { name: 'H2' }, { name: 'H5' }, { name: 'H4' }, { name: 'L3' }],
			[{ name: 'H4' }, { name: 'L4' }, { name: 'L4' }, { name: 'H4' }, { name: 'H3' }, { name: 'H5' }, { name: 'L2' }, { name: 'H1' }, { name: 'L1' }, { name: 'S' }, { name: 'H2' }, { name: 'L2' }, { name: 'L3' }, { name: 'L2' }, { name: 'H4' }, { name: 'L1' }, { name: 'S' }, { name: 'H5' }, { name: 'H2' }, { name: 'H1' }, { name: 'L3' }, { name: 'H1' }, { name: 'L1' }, { name: 'H3' }, { name: 'L4' }, { name: 'S' }, { name: 'H3' }, { name: 'H2' }, { name: 'H5' }, { name: 'L3' }],
		],
	},
};
