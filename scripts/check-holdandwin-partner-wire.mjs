// The partner-wire Hold and Win mock (`mock-rgs-server-holdandwin-partner.mjs`, Phase 14 slice 14d),
// proven against the capture it copies: docs/reference/play4fun-collector-respin-capture.md. Seeded
// rounds of every bet option are played over HTTP the way a client plays them, and every answer is
// re-derived from its events alone — event order and shapes, `seq` as a position, the money (every
// collector takes a coin's full value; the collects and line wins sum to `gameRoundOver.win`), the
// bonus id, the rows, the counter, coins never sticking, and boost and multiply only on a cash coin
// that landed that respin. Then every forced beat and every transport refusal.
//
// The rules the partner's REAL round shows (their server log, 2026-11-13,
// `packages/rgs-translator-eagaming/collectorRespinRealRound.ts`) each have a check here: a surprise
// trigger tops up a dealt board that would not trigger (`surpriseTrigger {state}`; the added coins
// and collector are not on `playWindow`, and the collector has no `bonusSymbol`); `collect.pay` is
// the collector's NEW total; a respin's collected coins stay on its `collectWindow` and `playedSpin`;
// a respin where nothing lands sends no `collectWindow`, `bonusWin` or `retrigger`; the bonus board
// numbers the rows Expand opens FIRST; `enterBonus` / `playedBonusSpin` carry their shapes
// (`bonusTriggers` an object, `state: "main"`, …); the bonus's `spinStart.reels` are filtered
// display strips.
//
//   pnpm check:holdandwin-partner

import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';

import {
	createMockRgs,
	ENHANCEMENT_BITS,
	flagsOf,
	FORCE_FIVE_BITS,
	PARTNER_GAME as G,
} from './mock-rgs-server-holdandwin-partner.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	if (!ok || process.env.VERBOSE)
		console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ` — ${extra}` : ''}`);
	if (!ok) failed++;
	return ok;
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

const boot = async (opts = {}) => {
	const mock = createMockRgs({ quiet: true, seed: 'partner-wire', ...opts });
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url, 'http://127.0.0.1')),
	);
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	// node:http, not fetch: undici's keep-alive pool trips a libuv assert at teardown on Windows.
	const send = (method, path, body) =>
		new Promise((resolve, reject) => {
			const payload = body === undefined ? '' : JSON.stringify(body);
			const req = request(
				{
					host: '127.0.0.1',
					port: server.address().port,
					path,
					method,
					headers: {
						'content-type': 'text/plain',
						'content-length': Buffer.byteLength(payload),
						connection: 'close',
					},
				},
				(res) => {
					let text = '';
					res.setEncoding('utf8');
					res.on('data', (c) => (text += c));
					res.on('end', () => resolve(text ? JSON.parse(text) : null));
				},
			);
			req.on('error', reject);
			req.end(payload);
		});
	const engine = (sid, seq, actions, gid) =>
		send('POST', `/rgs/engine?sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`, actions);
	return {
		mock,
		engine,
		force: (sid, beat) => send('POST', `/force?sid=${sid}&beat=${encodeURIComponent(beat)}`),
		close: () => new Promise((r) => server.close(r)),
	};
};

// ---------- the capture's shapes ----------

const CELL = /^(PIC[1-9]|BLANK|COLLECT(_[1-9]\d*)?|COIN_([1-9]\d*|MINI|MINOR|MAJOR|GRAND))$/;
const TIERS = Object.keys(G.jackpots);
const isTier = (v) => TIERS.includes(v);
const keyOf = (c) => `${c.reel}:${c.row}`;
const names = (events) => events.map((e) => e.event);
const ctxs = (events, name) => events.filter((e) => e.event === name).map((e) => e.context);
const boardOk = (board, rows) =>
	Array.isArray(board) &&
	board.length === G.reels &&
	board.every((reel) => reel.length === rows && reel.every((c) => CELL.test(c)));

/** The base spin's order (the capture's buy round); every event name the answer has, in this order. */
const BASE_ORDER = [
	'jackpots',
	'spinStart',
	'bonusSymbol',
	'playWindow',
	'spinWin',
	'surpriseTrigger',
	'bonusSymbol',
	'cellPayAmount',
	'collect',
	'bonusWin',
	'collectWindow',
	'boostsAwarded',
	'spinTrigger',
	'playedSpin',
	'enterBonus',
	'gameEnd',
	'gameRoundOver',
];
const RESPIN_ORDER = [
	'jackpots',
	'spinStart',
	'boostsEnabled',
	'bonusSymbol',
	'playWindow',
	'cellPayAmount',
	'boost',
	'multiplier',
	'collect',
	'bonusWin',
	'collectWindow',
	'retrigger',
	'playedSpin',
	'playedBonusSpin',
	'playedBonusSpins',
	'gameEnd',
];
const inOrder = (events, order) => {
	let at = 0;
	for (const n of names(events)) {
		const i = order.indexOf(n, at);
		if (i < 0) return n;
		at = i;
	}
	return null;
};

/** The coins a spin's events name: `bonusSymbol` + `cellPayAmount`, matched by cell (their real
 *  round sends the two in different orders). */
const coinsOf = (events, base, where) => {
	const landed = ctxs(events, 'bonusSymbol');
	const pays = ctxs(events, 'cellPayAmount');
	check(landed.length === pays.length, `${where}: one cellPayAmount per bonusSymbol`);
	return landed.map((b) => {
		const p = pays.find((x) => keyOf(x) === keyOf(b)) ?? {};
		check(keyOf(b) === keyOf(p), `${where}: every bonusSymbol cell has its cellPayAmount`);
		check(b.symbol === `COIN_${p.original}`, `${where}: bonusSymbol is COIN_<original>`, b.symbol);
		if (isTier(p.original)) {
			check(
				p.value === p.original && b.win === p.original && p.pay === G.jackpots[p.original] * base,
				`${where}: a jackpot coin pays its tier × the base bet`,
				JSON.stringify(p),
			);
		} else {
			check(
				Number.isInteger(p.value) && p.pay === p.value * base && b.win === p.original * base,
				`${where}: a cash coin pays its value × the base bet, in cents`,
				JSON.stringify(p),
			);
		}
		return { ...p, jackpot: isTier(p.original) };
	});
};

/**
 * Each collector in view takes every coin's full value: one `collect` per collector, all on reel 3,
 * each `pay` the collector's NEW total (`totals`: each one's total before; their real round). Returns
 * what the spin paid: every coin once per collector.
 */
const checkCollects = (events, coins, collectorsInView, totals, where) => {
	const collects = ctxs(events, 'collect');
	const gathered = coins.reduce((s, c) => s + c.pay, 0);
	if (!gathered || !collectorsInView.length) {
		check(!collects.length, `${where}: no collect without a coin and a collector`);
		return 0;
	}
	check(
		collects.length === collectorsInView.length,
		`${where}: one collect per collector in view`,
		`${collects.length} vs ${collectorsInView.length}`,
	);
	for (const c of collects) {
		check(c.reel === G.collectorReel, `${where}: collectors only on reel 3`);
		check(
			c.pay === (totals.get(keyOf(c)) ?? 0) + gathered,
			`${where}: collect.pay is the collector's new total (every coin's full value added)`,
			`${c.pay} vs ${(totals.get(keyOf(c)) ?? 0) + gathered}`,
		);
	}
	const sum = gathered * collects.length;
	const bonusWin = ctxs(events, 'bonusWin');
	check(
		bonusWin.length === 1 && bonusWin[0].pay === sum && bonusWin[0].isSpinWin === false,
		`${where}: bonusWin pays every coin once per collector`,
	);
	return sum;
};

/** The longest run of adjacent reels each showing a coin or a collector. */
const runOn = (board) => {
	let best = 0;
	let cur = 0;
	for (const reel of board) {
		cur = reel.some((c) => c.startsWith('COIN') || c.startsWith('COLLECT')) ? cur + 1 : 0;
		best = Math.max(best, cur);
	}
	return best;
};
const special = (c) => c.startsWith('COIN') || c.startsWith('COLLECT');
/** `enterBonus.bonusTriggers` is `{"<bits>": 1}` (their real round). */
const bonusIdOf = (enter) => Object.keys(enter?.bonusTriggers ?? {})[0];

const collectorsOn = (board) =>
	board[G.collectorReel]
		.map((c, row) => (c.startsWith('COLLECT') ? { reel: G.collectorReel, row, cell: c } : null))
		.filter(Boolean);
/** The board's coin cells, in place: what a collect must leave where it found them. */
const coinsOn = (board) =>
	JSON.stringify(board.map((reel) => reel.map((c) => (c.startsWith('COIN') ? c : null))));
/** Where the coins are, whatever they now read (a boost or multiply raises a coin's value). */
const coinCells = (board) =>
	JSON.stringify(board.map((reel) => reel.map((c) => c.startsWith('COIN'))));
const totalOf = (cell) => (cell === 'COLLECT' ? 0 : Number(cell.slice('COLLECT_'.length)));

// ---------- one round, played as a client plays it ----------

const stats = {
	rounds: 0,
	bonuses: 0,
	supers: 0,
	expand: 0,
	boostHits: 0,
	boostMisses: 0,
	multiplyHits: 0,
	multiplyMisses: 0,
	retriggers: 0,
	twoCollectorCollects: 0,
	baseCollects: 0,
	surprises: 0,
	quietRespins: 0,
	jackpotCoinsInBonus: 0,
	byOption: [0, 0, 0, 0],
	openWins: 0,
	closedLosses: 0,
};

/**
 * Plays one round from `bet` to its close and re-derives it. Returns `{ digest-able answers, info }`.
 */
const playRound = async (srv, sid, option, betPerLine, play = '', where = `round`) => {
	const answers = [];
	const before = (await srv.engine(sid, 0, [])).platform.balance;
	const first = await srv.engine(sid, 0, [
		{ action: 'bet', context: [option, betPerLine] },
		{ action: 'play', context: play },
	]);
	answers.push(first);
	if (!check(!first.error, `${where}: [bet, play] accepted`, first.error)) return { answers };
	const ev = first.events;
	const base = G.gameCost * betPerLine;
	const total = G.betOptions[option] * betPerLine;
	const gid = first.platform.gameRound?.id;
	check(Boolean(gid), `${where}: the answer names its round (platform.gameRound.id)`);

	const [bet, gameStart] = ev;
	check(
		bet.event === 'bet' &&
			bet.context.total === total &&
			bet.context.betPerLine === betPerLine &&
			bet.context.paylines.length === 5,
		`${where}: bet {total = betOptions[i] × betPerLine, betPerLine, paylines[5]}`,
		JSON.stringify(bet.context),
	);
	check(
		gameStart.event === 'gameStart' && gameStart.context.totalBet === total,
		`${where}: gameStart {totalBet, betPerLine}`,
	);
	const spin = ev.slice(2);
	const bad = inOrder(spin, BASE_ORDER);
	check(!bad, `${where}: base spin events in the capture's order`, bad ?? '');
	const jp = ctxs(spin, 'jackpots')[0];
	check(
		JSON.stringify(jp) === JSON.stringify(G.jackpots),
		`${where}: jackpots as base-bet multiples`,
	);
	const ss = ctxs(spin, 'spinStart')[0];
	check(
		ss?.gameCost === 10 &&
			JSON.stringify(ss.betOptions) === '[10,50,500,1000]' &&
			JSON.stringify(ss.betOptionNames) === '["Base","Powerup","BuyCenterCoin","goldStrike"]',
		`${where}: spinStart carries the bet options`,
	);
	const board = ctxs(spin, 'playWindow')[0];
	check(boardOk(board, G.rows), `${where}: a whole 5×3 reel-major board`);
	const played = ctxs(spin, 'playedSpin')[0];
	// The partner's rule: playedSpin is the board after everything the spin did, so after a collect
	// it is collectWindow (the coins stay beside COLLECT_<total>); with nothing done, playWindow.
	const endBoard = ctxs(spin, 'collectWindow')[0] ?? board;
	const surprise = ctxs(spin, 'surpriseTrigger')[0];
	check(
		JSON.stringify(played) === JSON.stringify(endBoard),
		`${where}: playedSpin is the board after the spin`,
	);
	if (!surprise)
		check(
			JSON.stringify(ctxs(spin, 'collectWindow')[0] ?? played) === JSON.stringify(played) &&
				board.every((reel, r) => reel.every((c, row) => special(c) === special(played[r][row]))),
			`${where}: with no surprise trigger, nothing is added after playWindow`,
		);
	if (surprise) {
		stats.surprises++;
		check(Number.isInteger(surprise.state), `${where}: surpriseTrigger {state}`);
		check(
			runOn(board) < 3,
			`${where}: a surprise trigger tops up a dealt board that would not trigger`,
		);
		const added = played.flatMap((reel, r) =>
			reel.flatMap((c, row) =>
				special(c) && !special(board[r][row]) ? [{ reel: r, row, cell: c }] : [],
			),
		);
		check(
			added.some((c) => c.cell.startsWith('COIN')),
			`${where}: the surprise adds coins playWindow does not show`,
		);
		const at = names(spin).indexOf('surpriseTrigger');
		const after = spin.slice(at).filter((e) => e.event === 'bonusSymbol');
		const addedCoins = added.filter((c) => c.cell.startsWith('COIN'));
		check(
			after.length === addedCoins.length &&
				addedCoins.every((c) => after.some((b) => keyOf(b.context) === keyOf(c))),
			`${where}: each added coin's bonusSymbol follows surpriseTrigger`,
		);
		check(
			!ctxs(spin, 'bonusSymbol').some((b) => played[b.reel][b.row].startsWith('COLLECT')),
			`${where}: an added collector has no bonusSymbol`,
		);
		check(
			collectorsOn(played).length > 0 && runOn(played) >= 3,
			`${where}: the topped-up board triggers with a collector`,
		);
		check(
			ctxs(spin, 'spinTrigger')[0]?.trigger.from === '',
			`${where}: a surprise trigger's spinTrigger.trigger.from is ""`,
		);
	}
	for (let reel = 0; reel < G.reels; reel++) {
		for (const c of played[reel]) {
			if (c.startsWith('COIN'))
				check(G.coinReels.includes(reel), `${where}: coins only on reels 1, 2, 4, 5`);
			if (c.startsWith('COLLECT'))
				check(reel === G.collectorReel, `${where}: collectors only on reel 3`);
		}
	}
	const name = G.betOptionNames[option];
	if (name === 'Powerup' || name === 'BuyCenterCoin')
		check(
			board.flat().every((c) => !c.startsWith('PIC')),
			`${where}: the ante deals coins, collectors and blanks only`,
		);
	if (name === 'BuyCenterCoin')
		check(collectorsOn(board).length > 0, `${where}: Center Coin guarantees a collector on reel 3`);

	// Money of the base spin.
	const coins = coinsOf(spin, base, where);
	for (const c of coins)
		check(c.value === c.original, `${where}: no modifier touches a base-game coin`);
	const lineWins = ctxs(spin, 'spinWin').reduce((s, w) => s + w.pay, 0);
	for (const w of ctxs(spin, 'spinWin'))
		check(
			w.pay === G.paytable[w.what][w.occurs - 3] * betPerLine,
			`${where}: a line pays its paytable × the bet per line`,
		);
	const inView = collectorsOn(played);
	const basePaid = checkCollects(spin, coins, inView, new Map(), where);
	if (basePaid) {
		stats.baseCollects++;
		const name = ctxs(spin, 'enterBonus').length ? 'initialspin' : 'winWithoutTrigger';
		check(
			ctxs(spin, 'bonusWin')[0].bonus === name,
			`${where}: the base collect is bonusWin "${name}"`,
			ctxs(spin, 'bonusWin')[0].bonus,
		);
	}
	let collected = basePaid;
	let totals = new Map(inView.map((c) => [keyOf(c), basePaid / Math.max(1, inView.length)]));
	if (basePaid) {
		const cw = ctxs(spin, 'collectWindow')[0];
		check(boardOk(cw, G.rows), `${where}: collectWindow is a whole board`);
		check(
			coinsOn(cw) === coinsOn(played) && coins.every((c) => cw[c.reel][c.row].startsWith('COIN')),
			`${where}: the collected coins stay on collectWindow`,
		);
		for (const c of collectorsOn(cw))
			check(totalOf(c.cell) === totals.get(keyOf(c)), `${where}: COLLECT_<cents> = its total`);
	}

	let position = 2;
	let win = lineWins + basePaid;
	const enter = ctxs(spin, 'enterBonus')[0];
	if (name === 'goldStrike') check(Boolean(enter), `${where}: the bonus buy always triggers`);
	if (enter) {
		stats.bonuses++;
		const awarded = ctxs(spin, 'boostsAwarded')[0];
		const trigger = ctxs(spin, 'spinTrigger')[0];
		check(
			awarded && ENHANCEMENT_BITS.every((b) => awarded[b] === 0 || awarded[b] === 1),
			`${where}: boostsAwarded is five 0/1 flags`,
		);
		const bits = ENHANCEMENT_BITS.map((b) => String(awarded[b])).join('');
		check(
			trigger.bonus === bits &&
				JSON.stringify(enter.bonusTriggers) === JSON.stringify({ [bits]: 1 }),
			`${where}: spinTrigger.bonus = the five bits; enterBonus.bonusTriggers = {"<bits>": 1}`,
			`${trigger.bonus} ${JSON.stringify(enter.bonusTriggers)} ${bits}`,
		);
		check(
			enter.prob === 1 &&
				enter.additionalPrice === 0 &&
				enter.triggers === 1 &&
				enter.played === 0 &&
				JSON.stringify(enter.multiplier) === '{}' &&
				JSON.stringify(enter.bonusPlayed) === '{}' &&
				enter.spins.length === 1 &&
				enter.spins[0].bonus === bits &&
				enter.spins[0].spins === enter.left &&
				enter.triggering?.bonus === bits &&
				JSON.stringify(enter.triggering.trigger) === JSON.stringify(enter.spins[0].trigger) &&
				!('window' in enter),
			`${where}: enterBonus in the real round's shape (prob, multiplier {}, spins, triggering {})`,
			JSON.stringify(enter),
		);
		const flags = flagsOf(bits);
		if (flags.powerFive) {
			stats.supers++;
			check(bits === FORCE_FIVE_BITS, `${where}: Force 5 is its own set, ${FORCE_FIVE_BITS}`);
		} else
			check(
				flags.expand + flags.boost + flags.multiply + flags.respin >= 1,
				`${where}: the bonus has at least one enhancement`,
			);
		if (flags.expand) stats.expand++;
		const rows = G.rows + (flags.powerFive ? 2 : flags.expand ? 1 : 0);
		const start = flags.powerFive ? 5 : flags.respin ? 4 : 3;
		check(enter.left === start, `${where}: the counter starts at ${start}`, `left ${enter.left}`);
		check(
			trigger.spins[0].spins === start && trigger.trigger.occurs.join() === '3,4,5',
			`${where}: spinTrigger {spins, occurs, bonus, trigger {occurs: [3,4,5], from}}`,
		);
		check(
			collectorsOn(played).length > 0,
			`${where}: every bonus opens with a collector (any run of 3 crosses reel 3)`,
		);
		check(
			!ev.some((e) => e.event === 'gameRoundOver'),
			`${where}: a feature round stays open after the base spin`,
		);

		// The bonus board numbers the rows Expand (or Force 5) opens FIRST: each base row moves down by
		// the opened rows (their real round: the collector at row 0 of 3 is at row 1 of 4).
		const opened = rows - G.rows;
		const entryTotals = new Map(collectorsOn(played).map((c) => [keyOf(c), totalOf(c.cell)]));
		totals = new Map(
			[...entryTotals].map(([k, v]) => {
				const [reel, row] = k.split(':').map(Number);
				return [`${reel}:${row + opened}`, v];
			}),
		);
		let firstRespin = true;
		let left = start;
		let ended = false;
		for (let guard = 0; guard < 500 && !ended; guard++) {
			const at = `${where} respin ${guard + 1}`;
			const r = await srv.engine(sid, position, [{ action: 'play' }], gid);
			answers.push(r);
			if (!check(!r.error, `${at}: accepted at seq ${position}`, r.error)) return { answers };
			position += 1;
			const e = r.events;
			const badR = inOrder(e, RESPIN_ORDER);
			check(!badR, `${at}: events in the capture's order`, badR ?? '');
			check(
				JSON.stringify(ctxs(e, 'boostsEnabled')[0]) === JSON.stringify(awarded),
				`${at}: boostsEnabled repeats the set`,
			);
			const rb = ctxs(e, 'playWindow')[0];
			check(boardOk(rb, rows), `${at}: a whole board of ${rows} rows`, `${rb?.[0]?.length}`);
			if (firstRespin) {
				check(
					[...totals.keys()].every((k) => {
						const [reel, row] = k.split(':').map(Number);
						return rb[reel][row].startsWith('COLLECT');
					}),
					`${at}: each entry collector sits ${opened} row(s) lower (the opened rows come first)`,
				);
				firstRespin = false;
			}
			const ss = ctxs(e, 'spinStart')[0];
			check(
				JSON.stringify(ss?.ranges) === '[15,15,30,15,15]' &&
					Array.isArray(ss.reels) &&
					ss.reels.every(
						(strip, r) =>
							strip.length === ss.ranges[r] &&
							strip.filter((c) => c !== 'BLANK').join() ===
								(r === G.collectorReel ? 'COLLECT' : 'COIN'),
					),
				`${at}: spinStart.reels are filtered display strips (one coin or collector each)`,
			);
			check(
				JSON.stringify(ctxs(e, 'playedSpin')[0]) ===
					JSON.stringify(ctxs(e, 'collectWindow')[0] ?? rb),
				`${at}: playedSpin is the board after the respin (collectWindow, else playWindow)`,
			);
			const rc = coinsOf(e, base, at);
			const fresh = new Set(rc.map(keyOf));
			// Coins do not stick: every coin on the board landed now.
			const onBoard = rb.flatMap((reel, r2) =>
				reel.map((c, row) => (c.startsWith('COIN') ? `${r2}:${row}` : null)).filter(Boolean),
			);
			check(
				onBoard.length === fresh.size && onBoard.every((k) => fresh.has(k)),
				`${at}: coins do not stick — every coin in view landed this respin`,
			);
			for (const c of rc) if (c.jackpot) stats.jackpotCoinsInBonus++;
			// Collectors stay, with their totals.
			const cols = collectorsOn(rb);
			for (const c of cols)
				if (totals.has(keyOf(c)))
					check(
						totalOf(c.cell) === totals.get(keyOf(c)),
						`${at}: a collector keeps its total (COLLECT_<cents>)`,
						`${c.cell} vs ${totals.get(keyOf(c))}`,
					);
			for (const k of totals.keys())
				check(
					cols.some((c) => keyOf(c) === k),
					`${at}: a collector never leaves`,
				);
			// Boost and multiply: a hit names a fresh cash coin; a miss is "X".
			const mods = new Map();
			for (const [ev2, field, on] of [
				['boost', 'boost', flags.boost || flags.powerFive],
				['multiplier', 'multiplier', flags.multiply || flags.powerFive],
			]) {
				const got = ctxs(e, ev2);
				if (!on) {
					check(!got.length, `${at}: no ${ev2} event with its bit off`);
					continue;
				}
				check(got.length === 1, `${at}: one ${ev2} event with its bit on`);
				const x = got[0];
				if (!Array.isArray(x)) {
					check(x[field] === 'X', `${at}: a ${ev2} miss is {${field}: "X"}`);
					stats[ev2 === 'boost' ? 'boostMisses' : 'multiplyMisses']++;
					continue;
				}
				stats[ev2 === 'boost' ? 'boostHits' : 'multiplyHits']++;
				for (const h of x) {
					const coin = rc.find((c) => keyOf(c) === keyOf(h));
					check(
						Boolean(coin) && !coin.jackpot,
						`${at}: ${ev2} hits only a cash coin that landed this respin`,
						keyOf(h),
					);
					if (ev2 === 'boost') {
						check(
							h.boost % base === 0 && h.boost >= base,
							`${at}: a boost adds whole base bets, in cents`,
						);
						mods.set(keyOf(h), { ...mods.get(keyOf(h)), boost: h, startingPay: h.startingPay });
					} else {
						check(Number.isInteger(h.multiplier) && h.multiplier >= 2, `${at}: a whole factor`);
						mods.set(keyOf(h), { ...mods.get(keyOf(h)), multiply: h });
					}
				}
			}
			for (const c of rc) {
				const m = mods.get(keyOf(c));
				let pay = (c.jackpot ? G.jackpots[c.original] : c.original) * base;
				if (m?.boost) {
					check(m.boost.startingPay === pay, `${at}: boost.startingPay is the coin's pay`);
					pay += m.boost.boost;
				}
				if (m?.multiply) {
					check(m.multiply.startingPay === pay, `${at}: multiplier.startingPay follows the boost`);
					pay *= m.multiply.multiplier;
				}
				check(c.pay === pay, `${at}: cellPayAmount.pay = original, boosted, then multiplied`);
			}
			// Collect: every collector in view (new ones included) takes every coin's full value.
			const newCollectors = cols.filter((c) => !totals.has(keyOf(c)));
			for (const c of newCollectors)
				check(c.cell === 'COLLECT', `${at}: a collector lands bare (COLLECT)`, c.cell);
			const paid = checkCollects(e, rc, cols, totals, at);
			if (!rc.length && !newCollectors.length) {
				stats.quietRespins++;
				check(
					!['collectWindow', 'bonusWin', 'retrigger', 'collect'].some((n) => names(e).includes(n)),
					`${at}: a respin where nothing lands sends no collectWindow, bonusWin or retrigger`,
				);
			}
			if (paid && cols.length > 1) stats.twoCollectorCollects++;
			win += paid;
			collected += paid;
			const after = new Map(
				cols.map((c) => [keyOf(c), (totals.get(keyOf(c)) ?? 0) + paid / cols.length]),
			);
			totals = after;
			const cw = ctxs(e, 'collectWindow')[0];
			check(Boolean(cw) === paid > 0, `${at}: collectWindow exactly when a collect happened`);
			if (cw) {
				check(
					boardOk(cw, rows) && coinCells(cw) === coinCells(rb),
					`${at}: the collected coins stay on collectWindow (and playedSpin)`,
				);
				for (const c of collectorsOn(cw))
					check(totalOf(c.cell) === totals.get(keyOf(c)), `${at}: collectWindow shows each total`);
			}
			// The counter.
			left -= 1;
			const re = ctxs(e, 'retrigger')[0];
			check(
				Boolean(re) === rc.length + newCollectors.length > 0,
				`${at}: retrigger exactly when a coin or a collector lands`,
			);
			if (re) {
				check(re.games === start - left, `${at}: retrigger {games} brings the counter back`);
				stats.retriggers++;
				left = start;
			}
			const pb = ctxs(e, 'playedBonusSpin')[0];
			check(
				pb?.left === left,
				`${at}: playedBonusSpin.left is the counter`,
				`${pb?.left} vs ${left}`,
			);
			check(
				pb?.state === 'main' &&
					pb.playing === bits &&
					pb.prob === 1 &&
					JSON.stringify(pb.multiplier) === '{}' &&
					JSON.stringify(pb.bonusTriggers) === JSON.stringify({ [bits]: 1 }) &&
					pb.bonusPlayed?.[bits]?.count === pb.played &&
					JSON.stringify(pb.bonusPlayed[bits].base) === '{"count":0,"multiplierCount":0}' &&
					(left > 0
						? pb.spins.length === 1 && pb.spins[0].spins === left && pb.spins[0].state === 'main'
						: pb.spins.length === 0),
				`${at}: playedBonusSpin in the real round's shape (state "main", bonusPlayed, spins left)`,
				JSON.stringify(pb),
			);
			ended = names(e).includes('gameEnd');
			check(ended === (left === 0), `${at}: the feature ends exactly when the counter runs out`);
			if (ended) {
				check(
					names(e).includes('playedBonusSpins'),
					`${at}: the last respin adds playedBonusSpins`,
				);
				check(ctxs(e, 'gameEnd')[0].win === win, `${at}: gameEnd.win is the round's total`);
				const final = [...totals.values()].reduce((s, t) => s + t, 0);
				check(
					final === collected,
					`${at}: the collectors' totals are everything collected`,
					`${final} vs ${collected}`,
				);
			}
		}
		check(ended, `${where}: the feature ends`);
		const early = await srv.engine(sid, position, [{ action: 'play' }], gid);
		check(early.errorCode === 110, `${where}: a play after the feature's gameEnd is refused`);
	} else {
		check(ctxs(spin, 'gameEnd')[0]?.win === win, `${where}: gameEnd.win is the round's total`);
	}

	const closedInBatch = names(ev).includes('gameRoundOver');
	let roundOver;
	if (!enter && win === 0) {
		stats.closedLosses++;
		check(closedInBatch, `${where}: a losing round closes in its own batch`);
		roundOver = ctxs(ev, 'gameRoundOver')[0];
	} else {
		if (!enter) stats.openWins++;
		check(!closedInBatch, `${where}: a round that paid waits for the client's collect`);
		const busy = await srv.engine(sid, 0, [
			{ action: 'bet', context: [0, betPerLine] },
			{ action: 'play' },
		]);
		check(busy.errorCode === 110, `${where}: a bet while the round is open is refused`);
		const closed = await srv.engine(sid, position, [{ action: 'collect' }], gid);
		answers.push(closed);
		check(!closed.error, `${where}: collect at seq ${position} closes it`, closed.error);
		check(closed.platform?.gameRound?.id === gid, `${where}: the closing answer names the round`);
		roundOver = ctxs(closed.events, 'gameRoundOver')[0];
		// Replay: the same collect at the same seq and gid answers the same events.
		const again = await srv.engine(sid, position, [{ action: 'collect' }], gid);
		check(
			JSON.stringify(again.events) === JSON.stringify(closed.events),
			`${where}: a resend at the same seq replays`,
		);
	}
	check(
		roundOver?.win === win,
		`${where}: Σ collects + line wins = gameRoundOver.win`,
		`${roundOver?.win} vs ${win}`,
	);
	const after = (await srv.engine(sid, 0, [])).platform;
	check(after.balance === before - total + win, `${where}: balance = before − stake + win`);
	check(!after.gameRound, `${where}: nothing is left open`);
	stats.rounds++;
	stats.byOption[option]++;
	return { answers, enter, events: ev };
};

// ---------- run ----------

const configured = async (srv, sid) => {
	const r = await srv.engine(sid, 0, [{ action: 'config' }]);
	return r;
};

console.log('partner collector-respin wire (mock-rgs-server-holdandwin-partner.mjs):');

// Transport.
{
	const srv = await boot();
	const early = await srv.engine('t1', 0, [{ action: 'bet', context: [0, 4] }, { action: 'play' }]);
	check(early.errorCode === 110, 'a bet before config is refused with errorCode 110');
	const cfg = await configured(srv, 't1');
	check(
		JSON.stringify(names(cfg.events)) === '["jackpots","config"]',
		'config answers jackpots and config',
	);
	const c = cfg.events[1].context;
	check(
		c.gameCost === 10 &&
			JSON.stringify(c.betOptions) === '[10,50,500,1000]' &&
			c.window.reels === 5 &&
			c.window.rows === 3 &&
			c.availablePayLines.length === 5 &&
			c.paytable.every((p) => p.on.mode === 'line' && p.pay.length === 3) &&
			['symbols', 'symbolsPay', 'wildSymbols', 'lineAlign', 'lineCoinciding', 'maxWinMp'].every(
				(k) => k in c,
			),
		'config {symbols, symbolsPay, wildSymbols, lineAlign, lineCoinciding, gameCost, betOptions, …}',
	);
	check(
		!['strips', 'weights', 'rtp', 'pacing'].some((k) => k in c),
		'config sends no odds (they stay on the server)',
	);
	const badSeq = await srv.engine('t1', 1, [{ action: 'bet', context: [0, 4] }]);
	check(badSeq.errorCode === 110, 'a bet not at position 0 is refused');
	const badOpt = await srv.engine('t1', 0, [{ action: 'bet', context: [4, 4] }]);
	check(
		badOpt.errorCode === 110 && /unexpected args for action bet/.test(badOpt.error),
		'an unknown bet option is "unexpected args for action bet"',
	);
	const hb = await srv.engine('t1', 0, []);
	check(hb.events.length === 0 && hb.platform.balance === 1_000_000, 'the heartbeat moves nothing');
	// seq is a position: [bet, play] stores two; a respin one; collect the next.
	const r = await srv.engine('t1', 0, [
		{ action: 'bet', context: [3, 4] },
		{ action: 'play', context: 'force:trigger' },
	]);
	const gid = r.platform.gameRound.id;
	const skip = await srv.engine('t1', 3, [{ action: 'play' }], gid);
	check(skip.errorCode === 110, 'a respin that skips a position is refused');
	const one = await srv.engine('t1', 2, [{ action: 'play' }], gid);
	const replay = await srv.engine('t1', 2, [{ action: 'play' }], gid);
	check(
		!one.error && JSON.stringify(one.events) === JSON.stringify(replay.events),
		'a respin resent at the same seq and gid is a replay',
	);
	const resume = await configured(srv, 't1');
	check(
		resume.events[1].resume === true &&
			JSON.stringify(resume.events[1].actions.map((a) => a.action)) === '["bet","play","play"]',
		'config on an open round resumes it with its stored actions',
	);
	const tooSoon = await srv.engine('t1', 3, [{ action: 'collect' }], gid);
	check(tooSoon.errorCode === 110, 'collect before the feature ends is refused');
	await srv.close();

	const off = await boot({ disabledOptions: [1, 2, 3] });
	await configured(off, 'o1');
	const ante = await off.engine('o1', 0, [{ action: 'bet', context: [1, 4] }]);
	check(ante.errorCode === 110, 'an option the operator switched off is refused (errorCode 110)');
	await off.close();

	const player = await boot({ allowForce: false });
	await configured(player, 'p1');
	const f = await player.engine('p1', 0, [
		{ action: 'bet', context: [0, 4] },
		{ action: 'play', context: 'force:trigger' },
	]);
	check(f.errorCode === 101, "a player's mock refuses a force");
	await player.close();
}

// Seeded rounds of every option.
const ROUNDS = Number(process.env.ROUNDS ?? 400);
const digest = async (seed, rounds) => {
	const srv = await boot({ seed });
	const sid = `seeded-${seed}`;
	await configured(srv, sid);
	const hash = createHash('sha256');
	for (let i = 0; i < rounds; i++) {
		// Mostly base spins, then the ante and both buys.
		const option = i % 10 < 6 ? 0 : i % 10 < 8 ? 1 : i % 10 === 8 ? 2 : 3;
		const { answers } = await playRound(
			srv,
			sid,
			option,
			4,
			'',
			`${seed} #${i} ${G.betOptionNames[option]}`,
		);
		for (const a of answers) hash.update(JSON.stringify(a.events ?? a));
	}
	await srv.close();
	return hash.digest('hex').slice(0, 16);
};
await digest('partner-a', ROUNDS);
pass(
	`${ROUNDS} seeded rounds (Base, Powerup, BuyCenterCoin, goldStrike) re-derived from their events`,
);
const a2 = await digest('partner-a', 40);
const b = await digest('partner-b', 40);
check(a2 !== b, 'another seed deals another game');
const a3 = await digest('partner-a', 40);
check(a2 === a3, 'one seed deals one game', `${a2} vs ${a3}`);

// Forced beats.
{
	const srv = await boot({ seed: 'partner-forces' });
	await configured(srv, 'f');
	const forced = async (spec, option = 0) => {
		const before = { ...stats };
		const r = await playRound(srv, 'f', option, 4, `force:${spec}`, `force:${spec}`);
		return { r, before };
	};
	for (const bits of ['10000', '01000', '00010', '00001', '11010', '01011', FORCE_FIVE_BITS]) {
		const { r } = await forced(`enhancements:${bits}`, bits === FORCE_FIVE_BITS ? 0 : 3);
		check(bonusIdOf(r.enter) === bits, `force:enhancements:${bits} deals that set`);
	}
	{
		const { r } = await forced('superBonus');
		const first = ctxs(r.answers[1]?.events ?? [], 'playWindow')[0];
		check(
			bonusIdOf(r.enter) === FORCE_FIVE_BITS && first?.every((reel) => reel.length === 5),
			'force:superBonus starts Force 5 on a 5×5 board',
		);
	}
	{
		const { r, before } = await forced('surprise');
		check(
			stats.surprises > before.surprises && Boolean(r.enter),
			'force:surprise tops up a dealt board with nothing on it into the bonus',
		);
		const dealt = ctxs(r.events, 'playWindow')[0];
		check(
			dealt.flat().every((c) => !special(c)),
			'force:surprise deals no coin and no collector (their real round)',
		);
	}
	{
		const { r, before } = await forced('surprise,enhancements:10000');
		check(
			stats.surprises > before.surprises && bonusIdOf(r.enter) === '10000',
			'force:surprise,enhancements:10000 is their real round: a surprise into Expand',
		);
	}
	{
		const { before } = await forced('boostHit');
		check(stats.boostHits > before.boostHits, 'force:boostHit lands a boost on a fresh cash coin');
	}
	{
		const { before } = await forced('multiplyHit');
		check(
			stats.multiplyHits > before.multiplyHits,
			'force:multiplyHit multiplies a fresh cash coin',
		);
	}
	{
		const { r } = await forced('twoCollectors,enhancements:00001');
		const cols = collectorsOn(ctxs(r.events, 'playWindow')[0]);
		check(cols.length >= 2, 'force:twoCollectors deals two collectors on reel 3');
		check(
			ctxs(r.events, 'collect').length === cols.length,
			'each of the two collectors takes the coins in view',
		);
	}
	{
		const { r } = await forced('trigger,jackpot:GRAND');
		check(
			Boolean(r.enter) && JSON.stringify(ctxs(r.events, 'playWindow')[0]).includes('"COIN_GRAND"'),
			'force:jackpot:GRAND lands a GRAND coin on the trigger board',
		);
	}
	{
		const { r, before } = await forced('baseCollect');
		check(
			!r.enter && stats.baseCollects > before.baseCollects && stats.openWins > before.openWins,
			'force:baseCollect pays a base-game collect that waits for the client collect',
		);
	}
	{
		const { r } = await forced('baseCollect,twoCollectors');
		const cols = collectorsOn(ctxs(r.events, 'playWindow')[0]);
		check(
			!r.enter && cols.length === 2 && ctxs(r.events, 'collect').length === 2,
			'force:baseCollect,twoCollectors: both base collectors take the coin, no bonus',
		);
	}
	for (const bad of [
		'enhancements:11111',
		'enhancements:10100',
		'enhancements:00000',
		'enhancements:1',
		'nope',
		'boostHit,enhancements:00010',
		'baseCollect,trigger',
		'jackpot:HUGE',
		'baseCollect,jackpot:MINI',
	]) {
		const r = await srv.engine('f', 0, [
			{ action: 'bet', context: [0, 4] },
			{ action: 'play', context: `force:${bad}` },
		]);
		check(r.errorCode === 101, `force:${bad} is refused`, r.error);
	}
	const held = await srv.force('f', 'enhancements:00011');
	check(held.ok === true, '…/force holds a beat for the next round');
	const { enter } = await playRound(srv, 'f', 0, 4, '', 'held force');
	check(bonusIdOf(enter) === '00011', 'the held beat deals the next round');
	await srv.close();
}

// Coverage: the seeded run and the forces reached every beat the capture shows.
for (const [k, min] of Object.entries({
	bonuses: 20,
	supers: 1,
	expand: 3,
	boostHits: 3,
	boostMisses: 3,
	multiplyHits: 3,
	multiplyMisses: 3,
	retriggers: 10,
	twoCollectorCollects: 1,
	baseCollects: 10,
	surprises: 3,
	quietRespins: 20,
	jackpotCoinsInBonus: 1,
	openWins: 10,
	closedLosses: 10,
}))
	check(stats[k] >= min, `coverage: ${k} ≥ ${min}`, `${stats[k]}`);
check(
	stats.byOption.every((n) => n > 0),
	'coverage: every bet option played',
	stats.byOption.join(),
);

if (failed) {
	console.log(`\n✗ ${failed} check(s) failed`);
	process.exit(1);
}
console.log(
	`\n✓ partner wire: ${stats.rounds} rounds, ${stats.bonuses} bonuses (${stats.supers} Force 5)`,
);
