// The partner-wire Hold and Win mock (`mock-rgs-server-holdandwin-partner.mjs`, Phase 14 slice 14d),
// proven against the capture it copies: docs/reference/play4fun-collector-respin-capture.md. Seeded
// rounds of every bet option are played over HTTP the way a client plays them, and every answer is
// re-derived from its events alone — event order and shapes, `seq` as a position, the money (every
// collector takes a coin's full value; the collects and line wins sum to `gameRoundOver.win`), the
// bonus id, the rows, the counter, coins never sticking, and boost and multiply only on a cash coin
// that landed that respin. Then every forced beat and every transport refusal.
//
//   pnpm check:holdandwin-partner

import { createHash } from 'node:crypto';
import { createServer, request } from 'node:http';

import {
	createMockRgs,
	ENHANCEMENT_BITS,
	flagsOf,
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
	'cellPayAmount',
	'spinWin',
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

/** The coins a spin's events name: `bonusSymbol` + `cellPayAmount`, checked against each other. */
const coinsOf = (events, base, where) => {
	const landed = ctxs(events, 'bonusSymbol');
	const pays = ctxs(events, 'cellPayAmount');
	check(landed.length === pays.length, `${where}: one cellPayAmount per bonusSymbol`);
	return landed.map((b, i) => {
		const p = pays[i];
		check(keyOf(b) === keyOf(p), `${where}: cellPayAmount follows bonusSymbol's cell order`);
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

/** Each collector in view takes every coin's full value: one `collect` per collector, all on reel 3. */
const checkCollects = (events, coins, collectorsInView, where) => {
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
		check(c.pay === gathered, `${where}: a collector takes every coin's full value`);
	}
	const sum = collects.reduce((s, c) => s + c.pay, 0);
	const bonusWin = ctxs(events, 'bonusWin');
	check(
		bonusWin.length === 1 && bonusWin[0].pay === sum && bonusWin[0].isSpinWin === false,
		`${where}: bonusWin pays the collects' sum`,
	);
	return sum;
};

const collectorsOn = (board) =>
	board[G.collectorReel]
		.map((c, row) => (c.startsWith('COLLECT') ? { reel: G.collectorReel, row, cell: c } : null))
		.filter(Boolean);
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
	check(
		JSON.stringify(played) === JSON.stringify(board),
		`${where}: playedSpin is the dealt board`,
	);
	for (let reel = 0; reel < G.reels; reel++) {
		for (const c of board[reel]) {
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
	const inView = collectorsOn(board);
	const basePaid = checkCollects(spin, coins, inView, where);
	if (basePaid) {
		stats.baseCollects++;
		check(
			ctxs(spin, 'bonusWin')[0].bonus === 'initialspin',
			`${where}: the base collect is bonusWin "initialspin"`,
		);
	}
	let collected = basePaid;
	let totals = new Map(inView.map((c) => [keyOf(c), basePaid / Math.max(1, inView.length)]));
	if (basePaid) {
		const cw = ctxs(spin, 'collectWindow')[0];
		check(boardOk(cw, G.rows), `${where}: collectWindow is a whole board`);
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
			trigger.bonus === bits && enter.bonusTriggers === bits,
			`${where}: spinTrigger.bonus = enterBonus.bonusTriggers = the five bits`,
			`${trigger.bonus} ${enter.bonusTriggers} ${bits}`,
		);
		const flags = flagsOf(bits);
		if (flags.powerFive) {
			stats.supers++;
			check(bits === '11111', `${where}: Force 5 has every enhancement`);
		} else
			check(
				flags.expand + flags.boost + flags.multiply + flags.respin >= 1,
				`${where}: the bonus has at least one enhancement`,
			);
		if (flags.expand) stats.expand++;
		const rows = G.rows + (flags.expand ? (flags.powerFive ? 2 : 1) : 0);
		const start = flags.powerFive ? 5 : flags.respin ? 4 : 3;
		check(enter.left === start, `${where}: the counter starts at ${start}`, `left ${enter.left}`);
		check(
			trigger.spins[0].spins === start && trigger.trigger.occurs.join() === '3,4,5',
			`${where}: spinTrigger {spins, occurs, bonus, trigger {occurs: [3,4,5], from}}`,
		);
		check(
			!collectorsOn(board).length === false,
			`${where}: every bonus opens with a collector (any run of 3 crosses reel 3)`,
		);
		check(
			!ev.some((e) => e.event === 'gameRoundOver'),
			`${where}: a feature round stays open after the base spin`,
		);

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
			check(
				JSON.stringify(ctxs(e, 'playedSpin')[0]) === JSON.stringify(rb),
				`${at}: playedSpin is the dealt board`,
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
				['boost', 'boost', flags.boost],
				['multiplier', 'multiplier', flags.multiply],
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
			const paid = checkCollects(e, rc, cols, at);
			if (paid && cols.length > 1) stats.twoCollectorCollects++;
			win += paid;
			collected += paid;
			const after = new Map(
				cols.map((c) => [keyOf(c), (totals.get(keyOf(c)) ?? 0) + paid / cols.length]),
			);
			totals = after;
			const cw = ctxs(e, 'collectWindow')[0];
			check(
				boardOk(cw, rows) && cw.flat().every((c) => !c.startsWith('COIN')),
				`${at}: collectWindow keeps only the collectors`,
			);
			for (const c of collectorsOn(cw))
				check(totalOf(c.cell) === totals.get(keyOf(c)), `${at}: collectWindow shows each total`);
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
	for (const bits of ['10000', '01000', '00010', '00001', '11010', '01011', '11111']) {
		const { r } = await forced(`enhancements:${bits}`, bits === '11111' ? 0 : 3);
		check(r.enter?.bonusTriggers === bits, `force:enhancements:${bits} deals that set`);
	}
	{
		const { r } = await forced('superBonus');
		const board = ctxs(r.events, 'enterBonus')[0];
		check(
			board?.bonusTriggers === '11111' && board.window.rows === 5,
			'force:superBonus starts Force 5 on a 5×5 board',
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
		'enhancements:00100',
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
	check(enter?.bonusTriggers === '00011', 'the held beat deals the next round');
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
