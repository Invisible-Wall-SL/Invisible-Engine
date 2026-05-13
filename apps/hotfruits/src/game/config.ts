export default {
	providerName: 'play4fun',
	gameName: 'hotfruits',
	gameID: '0_0_hotfruits',
	// rtp matches the value the Play4Fun server declares in its `config` event.
	// Confirm against a real session capture before going to production.
	rtp: 0.97,
	numReels: 5,
	numRows: [3, 3, 3, 3, 3],
	// Hot Fruits has only a base bet mode — no buy-bonus. The Play4Fun
	// server's config does not declare a freegame structure either. Future
	// games on this engine can re-add a `bonus` mode with the same shape:
	//   bonus: { cost: 100, feature: false, buyBonus: true, rtp, max_win }
	betModes: {
		base: {
			cost: 1.0,
			feature: true,
			buyBonus: false,
			rtp: 0.97,
			max_win: 5000.0,
		},
	},
	// Hot Fruits has 5 active paylines, declared by the Play4Fun server.
	// IDs match the server's array index (0 → '1'). Two pyramid patterns
	// (down + up) plus the three horizontal rows. The other 15 patterns from
	// the original Stake `lines` config are intentionally not included — they
	// would highlight wins on shapes Hot Fruits never pays.
	paylines: {
		'1': [1, 1, 1, 1, 1], // middle row
		'2': [0, 0, 0, 0, 0], // top row
		'3': [2, 2, 2, 2, 2], // bottom row
		'4': [0, 1, 2, 1, 0], // inverted V — ▽
		'5': [2, 1, 0, 1, 2], // V — △
	},
	symbols: {
		// Paytable values are per-line-bet multipliers (Stake convention):
		// landed-count × paytable entry × betPerLine = cents payout.
		// Values match the Play4Fun server's paytable for Hot Fruits
		// (verified spinWin: PIC4 × 3 × bet 2 = pay 40 → entry = 20). PIC1
		// maps here to H1 as top payer; descending by symbol rank.
		// L1 ← PIC5 (5th payer)
		L1: {
			paytable: [
				{ '5': 200 },
				{ '4': 75 },
				{ '3': 15 },
			],
		},
		// H4 ← PIC4 (4th payer)
		H4: {
			paytable: [
				{ '5': 500 },
				{ '4': 100 },
				{ '3': 20 },
			],
		},
		// L4: NOT mapped from any Play4Fun symbol — server never sends it.
		// Kept as a valid engine symbol with low payouts so reel-strip flicker
		// during spin animations still renders correctly.
		L4: {
			paytable: [
				{ '5': 2 },
				{ '4': 0.5 },
				{ '3': 0.2 },
			],
		},
		S: {
			special_properties: ['scatter'],
		},
		// H2 ← PIC2 (2nd payer)
		H2: {
			paytable: [
				{ '5': 2500 },
				{ '4': 500 },
				{ '3': 100 },
			],
		},
		// L5 ← PIC7 (lowest payer; the only Hot Fruits symbol that pays
		// 2-of-a-kind. Server occurs array: [2, 3, 4, 5]).
		L5: {
			paytable: [
				{ '5': 50 },
				{ '4': 25 },
				{ '3': 5 },
				{ '2': 5 },
			],
		},
		// L3: NOT mapped from any Play4Fun symbol (see L4 note).
		L3: {
			paytable: [
				{ '5': 3 },
				{ '4': 0.7 },
				{ '3': 0.3 },
			],
		},
		// W: DEFANGED. Hot Fruits' server declares `wildSymbols: []` — no
		// wild substitution in this game. We keep the symbol entry (so the
		// engine type system + any defensive lookups stay happy and so the
		// art assets are still loadable), but strip `special_properties:
		// ['wild', 'multiplier']` to switch off wild + multiplier code paths.
		// Reel strips below also scrub W → H1 so it never lands on the board.
		// Engine plumbing (utils-* / state-shared wild handlers) is left
		// intact for use by future games that re-declare wilds in their own
		// config.
		W: {
			paytable: [
				{ '5': 20 },
				{ '4': 10 },
				{ '3': 5 },
			],
		},
		// H3 ← PIC3 (3rd payer)
		H3: {
			paytable: [
				{ '5': 1000 },
				{ '4': 250 },
				{ '3': 75 },
			],
		},
		// L2 ← PIC6 (6th payer)
		L2: {
			paytable: [
				{ '5': 100 },
				{ '4': 40 },
				{ '3': 10 },
			],
		},
		// H1 ← PIC1 (top payer; 5-of-a-kind hits the max-win cap exactly)
		H1: {
			paytable: [
				{ '5': 5000 },
				{ '4': 1000 },
				{ '3': 200 },
			],
		},
	},
	paddingReels: {
		basegame: [
			[
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
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
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'S',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
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
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
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
					name: 'S',
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
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
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
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
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
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'S',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
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
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
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
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
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
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
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
					name: 'H2',
				},
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
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H2',
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
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
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
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
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
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
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
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
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
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'S',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
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
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
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
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
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
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'S',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
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
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'S',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
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
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
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
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
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
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
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
					name: 'H3',
				},
				{
					name: 'H3',
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
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
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
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
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
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
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
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
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
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
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
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
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
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
			],
			[
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'S',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
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
					name: 'L1',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
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
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'S',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
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
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
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
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
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
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'S',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
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
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
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
					name: 'L2',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
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
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
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
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
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
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
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
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
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
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
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
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
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
					name: 'L4',
				},
				{
					name: 'L3',
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
					name: 'L2',
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
				{
					name: 'S',
				},
				{
					name: 'H2',
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
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
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
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
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
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
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
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'S',
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
			],
			[
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'S',
				},
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
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
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
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
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
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
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
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
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
					name: 'L5',
				},
				{
					name: 'H1',
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
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
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
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
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
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
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
					name: 'L1',
				},
				{
					name: 'L5',
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
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L2',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
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
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
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
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
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
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
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
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
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
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
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
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
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
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
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
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
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
				{
					name: 'H4',
				},
				{
					name: 'H2',
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
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
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
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'S',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L1',
				},
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
					name: 'L2',
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
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
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
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'S',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
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
					name: 'L5',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
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
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
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
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
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
					name: 'L2',
				},
				{
					name: 'L5',
				},
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
					name: 'L1',
				},
				{
					name: 'L1',
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
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
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
					name: 'L5',
				},
				{
					name: 'H4',
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
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
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
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
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
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
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
				{
					name: 'H3',
				},
				{
					name: 'S',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
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
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'S',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
			],
		],
		freegame: [
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
					name: 'H3',
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
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
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
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
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
					name: 'L2',
				},
				{
					name: 'H2',
				},
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
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
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
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
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
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
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
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
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
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
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
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
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
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
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
					name: 'H2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
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
					name: 'L4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
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
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
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
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H3',
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
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
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
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
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
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
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
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
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
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
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
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
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
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
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
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'S',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'S',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L1',
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
					name: 'H1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
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
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
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
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'H2',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
			],
			[
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
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
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
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
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
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
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
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
				{
					name: 'L3',
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
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
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
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
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
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'S',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
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
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
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
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
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
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
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
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
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
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
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
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
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
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
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
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H1',
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
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
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
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
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
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
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
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
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
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
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
					name: 'H1',
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
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
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
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
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
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
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
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
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
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
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
					name: 'H4',
				},
				{
					name: 'L3',
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
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
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
					name: 'L5',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
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
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'S',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'S',
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
				{
					name: 'L4',
				},
				{
					name: 'H1',
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
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L2',
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
				{
					name: 'H3',
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
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
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
				{
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'S',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
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
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
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
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
			],
			[
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L3',
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
					name: 'L4',
				},
				{
					name: 'L5',
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
				{
					name: 'H4',
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
				{
					name: 'H2',
				},
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
				{
					name: 'L5',
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
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
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
					name: 'H2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
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
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
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
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L2',
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
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H4',
				},
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
					name: 'L5',
				},
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
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'H4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'L1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H4',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'H2',
				},
				{
					name: 'L1',
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
					name: 'L2',
				},
				{
					name: 'L5',
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
					name: 'L1',
				},
				{
					name: 'H2',
				},
				{
					name: 'L5',
				},
				{
					name: 'L4',
				},
				{
					name: 'L3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L1',
				},
				{
					name: 'H1',
				},
				{
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'L5',
				},
				{
					name: 'L2',
				},
				{
					name: 'L4',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L5',
				},
				{
					name: 'L1',
				},
				{
					name: 'L4',
				},
				{
					name: 'H1',
				},
				{
					name: 'H3',
				},
				{
					name: 'L4',
				},
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
					name: 'L3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H3',
				},
				{
					name: 'H1',
				},
				{
					name: 'H2',
				},
				{
					name: 'H3',
				},
				{
					name: 'H4',
				},
				{
					name: 'L1',
				},
				{
					name: 'L2',
				},
				{
					name: 'L3',
				},
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
					name: 'L3',
				},
				{
					name: 'H1',
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
				{
					name: 'L4',
				},
			],
		],
	},
};
