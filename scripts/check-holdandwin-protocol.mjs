// The Hold and Win mock RGS, proven from its WIRE: every preset (pots / classic / collector) is
// played over HTTP the way the facade plays a round, and every answer is re-derived from the events
// alone — the board rebuilt cell by cell and compared with the server's own snapshot after every
// respin, the counter, the stickiness, the order specials apply in, every payout sum, the persistent
// meters, and `seq`/`gid` as docs/reference/play4fun-protocol.md defines them. Then every forced
// beat (docs/reference/hold-and-win-wire.md, "Forcing a beat") is fired and its signature checked.
//
//   pnpm check:holdandwin
//
// Why re-derive rather than trust the snapshot: the wire is a swap seam the engine will be built
// against, so an event that does not tell the whole story of its respin is a bug the client inherits.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer, request } from 'node:http';

import {
	HOLD_AND_WIN_PRESET_IDS,
	HOLD_AND_WIN_PRESETS,
	HOLD_AND_WIN_TEST_FIXTURES,
	holdAndWinMockInputs,
	jackpotLadder,
	normalizeGameConfigDoc,
	validateGameConfigDoc,
} from '../packages/game-config/index.ts';
import { createMockRgs } from './mock-rgs-server-holdandwin.mjs';
import { carrySession } from './mock-rgs-server.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	if (!ok || process.env.VERBOSE)
		console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ` — ${extra}` : ''}`);
	if (!ok) failed++;
	return ok;
};
const pass = (msg) => console.log(`  ✓ ${msg}`);

const tidy = (n) => Number(n.toFixed(4));
const key = (c) => `${c.reel}:${c.row}`;

// ---------- a preset as the launcher hands it over (mockContract.ts) ----------

/** A preset id, a test fixture id (`pots-extra`), or a raw config (a fixture variant). */
const rawConfig = (preset) =>
	typeof preset === 'string'
		? (HOLD_AND_WIN_PRESETS[preset] ?? HOLD_AND_WIN_TEST_FIXTURES[preset])
		: preset;

const contractFor = (preset) => {
	const doc = normalizeGameConfigDoc(rawConfig(preset));
	const modes = Object.entries(doc.betModes);
	return {
		doc,
		opts: {
			reels: doc.numReels,
			rows: Math.max(...doc.numRows),
			paylines: Object.values(doc.paylines),
			...(modes.length > 1
				? {
						betModes: modes.map(([mode, m]) => ({
							mode,
							cost: m.cost,
							kind: m.buyBonus ? 'buy' : 'base',
						})),
					}
				: {}),
			holdAndWin: holdAndWinMockInputs(doc),
		},
	};
};

const boot = async (preset, extra = {}) => {
	const { doc, opts } = contractFor(preset);
	const name = typeof preset === 'string' ? preset : preset.gameID;
	const mock = createMockRgs({
		label: `hnw-${name}`,
		quiet: true,
		seed: `hnw-${name}`,
		...opts,
		...extra,
	});
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
						'content-type': 'application/json',
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
	const block = doc.holdAndWin;
	const roles = opts.holdAndWin.symbols;
	return {
		doc,
		block,
		mock,
		post: (path, body) => send('POST', path, body),
		get: (path) => send('GET', path),
		close: () => new Promise((r) => server.close(r)),
		port: server.address().port,
		table: Boolean(opts.betModes),
		lines: opts.paylines.length,
		jackpots: Object.fromEntries(block.jackpots.map((j) => [j.name, j.multiplier])),
		ladder: jackpotLadder(block),
		rolesOf: (symbol) => roles[symbol]?.roles ?? [],
	};
};

// ---------- the wire's cells ----------

/** `BONUS:1.5` → {symbol, value}; `JACKPOT:MINI*2` → {symbol, jackpot, factor}. */
const parseCell = (text) => {
	const colon = text.indexOf(':');
	if (colon < 0) return { symbol: text };
	const symbol = text.slice(0, colon);
	const rest = text.slice(colon + 1);
	if (/^-?\d+(\.\d+)?$/.test(rest)) return { symbol, value: Number(rest) };
	const [jackpot, factor] = rest.split('*');
	return { symbol, jackpot, ...(factor ? { factor: Number(factor) } : {}) };
};
/** One canonical text per cell, so a snapshot and a rebuilt board compare as strings. */
const canon = (c) =>
	c.jackpot
		? `${c.symbol}:${c.jackpot}${c.factor > 1 ? `*${c.factor}` : ''}`
		: c.value
			? `${c.symbol}:${c.value}`
			: c.symbol;
const snapshotMap = (cells) => new Map(cells.map((c) => [key(c), canon(c)]));
const trackedMap = (tracked) => new Map([...tracked].map(([k, c]) => [k, canon(c)]));
const sameMap = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);
const showMap = (m) =>
	[...m]
		.sort()
		.map(([k, v]) => `${k}=${v}`)
		.join(' ');

// ---------- playing a round the facade's way ----------

/**
 * `[bet, play]` at seq 0 with no gid, then — while the round is open and in its feature — one
 * context-less `play` per respin at the next position under the round's gid, then `collect`.
 */
const playRound = async (g, sid, { bet, force, context = null } = {}) => {
	const requests = [];
	const responses = [];
	const call = async (seq, gid, body) => {
		requests.push({ seq, gid, body });
		const resp = await g.post(`/rgs/engine?sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`, body);
		responses.push(resp);
		return resp;
	};
	const before = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const stakeBet = bet ?? (g.table ? [0, 4] : [g.lines, 4]);
	let resp = await call(0, null, [
		{ action: 'bet', context: stakeBet },
		{ action: 'play', context: force ? `force:${force}` : context },
	]);
	if (resp.error) return { error: resp.error, requests, responses };
	const gid = resp.platform.gameRound?.id ?? null;
	let seq = 2;
	const inFeature = () => responses.some((r) => r.events.some((e) => e.event === 'enterBonus'));
	const ended = () => responses.some((r) => r.events.some((e) => e.event === 'gameEnd'));
	let guard = 0;
	while (gid && inFeature() && !ended() && guard++ < 300)
		resp = await call(seq++, gid, [{ action: 'play' }]);
	if (gid && !responses.some((r) => r.events.some((e) => e.event === 'gameRoundOver'))) {
		resp = await call(seq++, gid, [{ action: 'collect' }]);
	}
	return {
		gid,
		requests,
		responses,
		config: before.events.find((e) => e.event === 'config')?.context,
		balanceBefore: before.platform.balance,
		balanceAfter: resp.platform.balance,
	};
};

const eventsOf = (round) => round.responses.flatMap((r) => r.events);
const first = (round, name) => eventsOf(round).find((e) => e.event === name)?.context;
const all = (round, name) =>
	eventsOf(round)
		.filter((e) => e.event === name)
		.map((e) => e.context);

// ---------- the round, re-derived from its events ----------

/** Every invariant one round must satisfy. `meters` is the running per-session expectation. */
const verifyRound = (g, round, label, meters) => {
	const problems = roundProblems(g, round, meters);
	if (problems.length) {
		check(false, label, problems.slice(0, 6).join(' | '));
		return false;
	}
	return true;
};

/** What {@link verifyRound} finds wrong with a round, without reporting it. */
const roundProblems = (g, round, meters) => {
	const problems = [];
	const fail = (msg) => problems.push(msg);
	const { block } = g;
	const start = block.respins.start;
	const streak = block.stickiness === 'collectorsOnly';
	const bet = first(round, 'bet');
	const baseTotal = g.table ? bet.betPerLine * g.lines : bet.total;
	const credits = (worth) => Math.round(worth * baseTotal);
	const isCash = (c) => !c.jackpot && g.rolesOf(c.symbol).includes('coin');
	const worth = (c) =>
		c.jackpot
			? (g.jackpots[c.jackpot] ?? 0) * (c.factor ?? 1)
			: g.rolesOf(c.symbol).some((r) => r === 'coin' || r === 'collector')
				? (c.value ?? 0)
				: 0;

	// seq / gid, as the partner's client numbers them.
	const [open, ...rest] = round.requests;
	if (open.seq !== 0 || open.gid) fail(`the round opened at seq ${open.seq} gid ${open.gid}`);
	rest.forEach((r, i) => {
		if (r.seq !== 2 + i) fail(`request ${i + 1} at seq ${r.seq}, expected ${2 + i}`);
		if (r.gid !== round.gid) fail(`request ${i + 1} under gid ${r.gid}, not ${round.gid}`);
	});
	round.responses.slice(0, -1).forEach((resp, i) => {
		if (resp.platform.gameRound?.id !== round.gid) fail(`answer ${i} does not name the open round`);
	});

	// Meters: what the base spin filled, and what a trigger consumed.
	for (const u of all(round, 'meterUpdate')) {
		const expected = Math.min(u.max, (meters[u.meter] ?? 0) + u.from.length);
		if (u.level !== expected && !u.forced)
			fail(`meter ${u.meter} at ${u.level}, expected ${expected}`);
		if (u.full !== u.level >= u.max) fail(`meter ${u.meter} full flag wrong`);
		meters[u.meter] = u.level;
	}
	const trig = first(round, 'holdAndWinTrigger');
	for (const id of trig?.meters ?? []) meters[id] = 0;
	const levels = all(round, 'meterLevels').at(-1);
	if (block.meters?.length) {
		for (const m of levels?.meters ?? []) {
			if (m.level !== meters[m.id]) fail(`meterLevels ${m.id}=${m.level}, tracked ${meters[m.id]}`);
		}
	}

	// Base win: lines + an instant collect.
	const lineWin = all(round, 'spinWin').reduce((s, w) => s + w.pay, 0);
	const instant = first(round, 'coinInstantCollect');
	if (instant) {
		const expected = instant.times * instant.cells.reduce((s, c) => s + c.amount, 0);
		if (instant.amount !== expected)
			fail(`instant collect ${instant.amount}, cells say ${expected}`);
		for (const c of instant.cells) {
			if (c.amount !== credits(worth(c))) fail(`instant cell ${key(c)} amount ${c.amount}`);
		}
	}

	let featureTotal = 0;
	if (trig) {
		// Replay the feature cell by cell.
		const tracked = new Map(trig.cells.map((c) => [key(c), { ...c }]));
		const banked = { jackpots: 0, columns: 0 };
		const applyOrder = block.applyOrder;
		const kindOf = (e) =>
			e.event === 'mysteryReveal'
				? 'mystery'
				: e.event === 'coinPay'
					? 'payer'
					: e.event === 'coinBoost' && e.context.source === 'special'
						? 'multiplier'
						: e.event === 'coinCollect'
							? 'collector'
							: e.event === 'respinsAdded'
								? 'addRespins'
								: e.event === 'coinUpgrade'
									? 'upgrade'
									: null;
		const coins = () => [...tracked].filter(([, c]) => isCash(c) || (streak && c.jackpot));
		// The counter and its cap (what a reset fills to), as the events say they move.
		let left = start;
		let cap = start;
		const tier = (c) => g.ladder.indexOf(c.jackpot);

		const apply = (e) => {
			const c = e.context;
			switch (e.event) {
				case 'coinBoost': {
					const expectKeys = [...tracked]
						.filter(
							([, t]) =>
								isCash(t) ||
								(c.source === 'special' &&
									t.jackpot &&
									block.specials.multiplier?.multipliesJackpots),
						)
						.map(([k]) => k)
						.sort();
					const got = c.cells.map(key).sort();
					if (got.join() !== expectKeys.join())
						fail(`coinBoost touched ${got}, expected ${expectKeys}`);
					for (const cell of c.cells) {
						const t = tracked.get(key(cell));
						const now = cell.jackpot ? (t.factor ?? 1) : t.value;
						if (now !== cell.from)
							fail(`coinBoost ${key(cell)} from ${cell.from}, board says ${now}`);
						if (cell.to !== tidy(cell.from * c.multiplier))
							fail(`coinBoost ${key(cell)} ${cell.from}×${c.multiplier}≠${cell.to}`);
						if (cell.jackpot) t.factor = cell.to;
						else t.value = cell.to;
					}
					break;
				}
				case 'coinPay': {
					const expectKeys = [...tracked]
						.filter(([, t]) => isCash(t))
						.map(([k]) => k)
						.sort();
					const got = c.cells.map(key).sort();
					if (got.join() !== expectKeys.join())
						fail(`coinPay touched ${got}, expected ${expectKeys}`);
					for (const cell of c.cells) {
						const t = tracked.get(key(cell));
						if (t.value !== cell.from)
							fail(`coinPay ${key(cell)} from ${cell.from}, board ${t.value}`);
						if (cell.to !== tidy(cell.from + c.value))
							fail(`coinPay ${key(cell)} +${c.value}≠${cell.to}`);
						t.value = cell.to;
					}
					break;
				}
				case 'mysteryReveal':
					for (const cell of c.cells) {
						const info = { ...cell };
						delete info.becomes;
						tracked.set(key(cell), info);
					}
					break;
				case 'specialBecomesCoin':
					tracked.set(key(c), { reel: c.reel, row: c.row, symbol: c.symbol, value: c.value });
					break;
				case 'coinCollect': {
					const got = c.cells.map(key).sort();
					const expected = coins()
						.map(([k]) => k)
						.sort();
					if (got.join() !== expected.join())
						fail(`coinCollect took ${got}, board has ${expected}`);
					const collector = tracked.get(key(c.collector));
					const gathered = c.cells.reduce((s, cell) => s + worth(cell), 0);
					const value = tidy((collector.value ?? 0) + c.level * gathered);
					if (c.value !== value)
						fail(`collector ${key(c.collector)} at ${c.value}, expected ${value}`);
					collector.value = c.value;
					break;
				}
				case 'respinsAdded': {
					const t = tracked.get(key(c.cell));
					if (!t || !g.rolesOf(t.symbol).includes('addRespins'))
						fail(`respinsAdded from ${key(c.cell)}, which holds no add-respins`);
					else if (c.added !== t.value) fail(`respinsAdded +${c.added}, its cell says ${t.value}`);
					if (c.left !== left + c.added)
						fail(`respinsAdded left ${c.left}, expected ${left} + ${c.added}`);
					const raised = block.specials.addRespins?.raisesCap ? cap + c.added : cap;
					if (c.total !== raised) fail(`respinsAdded total ${c.total}, expected ${raised}`);
					left = c.left;
					cap = c.total;
					break;
				}
				case 'coinUpgrade': {
					const t = tracked.get(key(c.upgrader));
					if (!t || !g.rolesOf(t.symbol).includes('upgrade'))
						fail(`coinUpgrade from ${key(c.upgrader)}, which holds no upgrade`);
					if (!block.specials.upgrade?.targets.some((x) => x.target === c.target))
						fail(`coinUpgrade under ${c.target}, which the upgrade does not have`);
					if (c.target === 'jackpotTier') {
						if (c.step !== 0) fail(`a tier upgrade with step ${c.step}`);
						const want = [...tracked.values()]
							.filter((x) => x.jackpot && tier(x) >= 0 && tier(x) < g.ladder.length - 1)
							.sort((a, b) => tier(a) - tier(b) || a.reel - b.reel || a.row - b.row)[0];
						const got = c.cells[0];
						if (!want) {
							if (c.cells.length)
								fail(`a tier upgrade with nothing below the top moved ${key(got)}`);
						} else if (c.cells.length !== 1 || key(got) !== key(want)) {
							fail(`tier upgrade took ${c.cells.map(key)}, the lowest tier is ${key(want)}`);
						} else if (
							got.fromJackpot !== want.jackpot ||
							got.jackpot !== g.ladder[tier(want) + 1]
						) {
							fail(`tier upgrade ${got.fromJackpot}→${got.jackpot}, board has ${want.jackpot}`);
						} else want.jackpot = got.jackpot;
						break;
					}
					if (c.step !== (t?.value ?? 0)) fail(`upgrade step ${c.step}, its cell says ${t?.value}`);
					const near = (x) =>
						Math.abs(x.reel - c.upgrader.reel) <= 1 &&
						Math.abs(x.row - c.upgrader.row) <= 1 &&
						key(x) !== key(c.upgrader);
					const expectKeys = [...tracked]
						.filter(([, x]) => isCash(x) && (c.target === 'all' || near(x)))
						.map(([k]) => k)
						.sort();
					const got = c.cells.map(key).sort();
					if (got.join() !== expectKeys.join())
						fail(`${c.target} upgrade touched ${got}, expected ${expectKeys}`);
					for (const cell of c.cells) {
						const x = tracked.get(key(cell));
						if (x?.value !== cell.from)
							fail(`upgrade ${key(cell)} from ${cell.from}, board ${x?.value}`);
						if (cell.to !== tidy(cell.from + c.step))
							fail(`upgrade ${key(cell)} +${c.step}≠${cell.to}`);
						if (x) x.value = cell.to;
					}
					break;
				}
				case 'cellsCleared':
					for (const cell of c.cells) {
						if (c.reason === 'applied') {
							const t = tracked.get(key(cell));
							if (!t || !g.rolesOf(t.symbol).includes('addRespins'))
								fail(`${key(cell)} cleared as applied, but it holds no add-respins`);
							if (block.specials.addRespins?.sticky) fail(`a sticky add-respins left ${key(cell)}`);
						} else if (c.reason !== 'collected') fail(`cellsCleared reason ${c.reason}`);
						tracked.delete(key(cell));
					}
					break;
				case 'columnComplete': {
					const column = [...tracked].filter(([, t]) => t.reel === c.reel);
					const rows = g.doc.numRows[c.reel];
					if (column.length !== rows)
						fail(`column ${c.reel} complete with ${column.length}/${rows}`);
					const amount = column.reduce((s, [, t]) => s + credits(worth(t)), 0);
					if (c.cleared) {
						if (c.amount !== amount) fail(`column ${c.reel} banked ${c.amount}, cells ${amount}`);
						banked.columns += c.amount;
						for (const [k] of column) tracked.delete(k);
					}
					break;
				}
				case 'jackpotWin':
					if (c.amount !== credits(g.jackpots[c.tier] * (c.banked ? 1 : 1) * 1) && c.banked) {
						fail(`${c.tier} jackpot pays ${c.amount}`);
					}
					if (c.banked) banked.jackpots += c.amount;
					break;
				default:
			}
		};
		/** Everything an answer says about the feature, from `from` on, in order. */
		const applyAll = (events) => {
			let lastKind = -1;
			for (const e of events) {
				const kind = kindOf(e);
				if (kind) {
					const at = applyOrder.indexOf(kind);
					if (at < lastKind && !(streak && kind === 'collector'))
						fail(`${e.event} after a later special`);
					lastKind = Math.max(lastKind, at);
				}
				apply(e);
			}
		};
		const compare = (snapshot, what) => {
			const want = snapshotMap(snapshot.holdAndWin.cells);
			const have = trackedMap(tracked);
			if (!sameMap(want, have)) fail(`${what}: server ${showMap(want)} ≠ rebuilt ${showMap(have)}`);
		};

		// Entry: the base answer from the trigger to `enterBonus`.
		const baseEvents = round.responses[0].events;
		const from = baseEvents.findIndex((e) => e.event === 'holdAndWinTrigger');
		const enter = baseEvents.findIndex((e) => e.event === 'enterBonus');
		applyAll(baseEvents.slice(from + 1, enter));
		compare(baseEvents[enter].context, 'entry');
		left = baseEvents[enter].context.left;
		if (left !== start) fail(`the feature opens with ${left} respins, not ${start}`);
		if (baseEvents[enter].context.holdAndWin.start !== start)
			fail(`the feature opens with a cap of ${baseEvents[enter].context.holdAndWin.start}`);
		applyAll(baseEvents.slice(enter + 1));

		// Each respin.
		let played = 0;
		for (const resp of round.responses.slice(1)) {
			const events = resp.events;
			const board = events.find((e) => e.event === 'playedSpin')?.context;
			if (!board) continue;
			played++;
			const heldBefore = new Map(tracked);
			// The board as it lands: every held cell where it was, new ones exactly where `coinsLand` says.
			const landed = events.find((e) => e.event === 'coinsLand')?.context.cells ?? [];
			const landedKeys = new Set(landed.map(key));
			board.forEach((column, reel) =>
				column.forEach((text, row) => {
					const k = `${reel}:${row}`;
					const cell = parseCell(text);
					const held = tracked.get(k);
					if (held) {
						if (canon(cell) !== canon(held))
							fail(`respin ${played}: held ${k} ${canon(held)} landed as ${text}`);
					} else if (landedKeys.has(k)) {
						const info = landed.find((c) => key(c) === k);
						if (canon(cell) !== canon(info))
							fail(`respin ${played}: ${k} ${text} ≠ coinsLand ${canon(info)}`);
						tracked.set(k, { ...info });
					} else if (!g.rolesOf(cell.symbol).includes('blank') && cell.symbol !== 'BLANK') {
						fail(`respin ${played}: ${k} ${text} landed but coinsLand does not say so`);
					}
				}),
			);
			applyAll(events.filter((e) => !['playedSpin', 'coinsLand'].includes(e.event)).slice());

			// The counter.
			const update = events.find((e) => e.event === 'respinUpdate')?.context;
			const reveals = events.find((e) => e.event === 'mysteryReveal')?.context.cells ?? [];
			const newCoin =
				landed.some((c) => c.jackpot || g.rolesOf(c.symbol).includes('coin')) ||
				reveals.some((c) => c.becomes === 'coin' || c.becomes === 'jackpot');
			const snap = events.find((e) => e.event === 'playedBonusSpin').context;
			const endedHere = events.some((e) => e.event === 'holdAndWinEnd');
			// The respin that ends the feature never resets: it says 0 left, like its snapshot.
			const reset =
				!endedHere && (block.respins.reset === 'anySpecial' ? landed.length > 0 : newCoin);
			if (update.reset !== reset)
				fail(`respin ${played}: reset ${update.reset}, expected ${reset}`);
			// `left` already counts what an add-respins added this respin; a reset never throws it away.
			const expectedLeft = endedHere ? 0 : reset ? Math.max(cap, left) : left - 1;
			if (update.left !== expectedLeft)
				fail(`respin ${played}: ${update.left} left, expected ${expectedLeft}`);
			if (snap.left !== update.left) fail(`respin ${played}: snapshot left ${snap.left}`);
			if (update.start !== cap || snap.holdAndWin.start !== cap)
				fail(`respin ${played}: cap ${update.start}/${snap.holdAndWin.start}, expected ${cap}`);
			if (update.played !== played || snap.played !== played)
				fail(`respin ${played}: played ${update.played}`);
			left = update.left;
			compare(snap, `respin ${played}`);

			// Stickiness.
			if (streak) {
				const stray = [...tracked].filter(([, c]) => !g.rolesOf(c.symbol).includes('collector'));
				if (stray.length) fail(`respin ${played}: a streak kept ${stray.map(([k]) => k)}`);
			} else {
				const cleared = new Set(
					events
						.filter(
							(e) =>
								(e.event === 'columnComplete' && e.context.cleared) ||
								(e.event === 'cellsCleared' && e.context.reason === 'applied'),
						)
						.flatMap((e) => e.context.cells.map(key)),
				);
				for (const [k] of heldBefore) {
					if (!tracked.has(k) && !cleared.has(k))
						fail(`respin ${played}: sticky ${k} left the board`);
				}
			}
			if (!endedHere && left <= 0)
				fail(`respin ${played}: no respins left but the feature goes on`);
		}

		// The end tally.
		const end = first(round, 'holdAndWinEnd');
		if (!end) fail('the feature never ended');
		else {
			const want = [...tracked]
				.filter(([, c]) => worth(c) > 0)
				.map(([k]) => k)
				.sort();
			const got = end.cells.map(key).sort();
			if (got.join() !== want.join()) fail(`tally ${got}, board ${want}`);
			for (const c of end.cells) {
				if (c.amount !== credits(worth(c)))
					fail(`tally ${key(c)} ${c.amount} ≠ ${credits(worth(c))}`);
			}
			const bankedTotal = banked.jackpots + banked.columns;
			if (end.banked !== bankedTotal) fail(`banked ${end.banked}, events say ${bankedTotal}`);
			const total = end.banked + end.cells.reduce((s, c) => s + c.amount, 0);
			if (end.total !== total) fail(`feature total ${end.total}, parts say ${total}`);
			featureTotal = end.total;
			if (block.respins.cap !== undefined && played > block.respins.cap)
				fail('played past the cap');
		}
	}

	const gameEnd = all(round, 'gameEnd').at(-1);
	const win = lineWin + (instant?.amount ?? 0) + featureTotal;
	if (gameEnd.win !== win)
		fail(
			`gameEnd ${gameEnd.win}, lines ${lineWin} + instant ${instant?.amount ?? 0} + feature ${featureTotal}`,
		);
	const over = all(round, 'gameRoundOver').at(-1);
	if (!over || over.win !== win) fail('the round never closed on its win');
	const stake = bet.total;
	if (round.balanceAfter !== round.balanceBefore - stake + win) {
		fail(`balance ${round.balanceBefore}→${round.balanceAfter}, stake ${stake}, win ${win}`);
	}
	return problems;
};

// ---------- 1. natural and forced-trigger rounds, every invariant ----------

const meterStart = (config) =>
	Object.fromEntries((config?.holdAndWin.meters ?? []).map((m) => [m.id, m.level]));

for (const preset of [...HOLD_AND_WIN_PRESET_IDS, 'pots-extra']) {
	const g = await boot(preset);
	console.log(`${preset}: rounds re-derived from the wire`);
	const sid = `nat-${preset}`;
	const probe = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const meters = meterStart(probe.events.find((e) => e.event === 'config').context);
	let ok = 0;
	let features = 0;
	const ROUNDS = 240;
	for (let i = 0; i < ROUNDS; i++) {
		const round = await playRound(g, sid, i % 6 === 0 ? { force: 'trigger' } : {});
		if (round.error) {
			check(false, `round ${i}`, round.error);
			continue;
		}
		if (first(round, 'holdAndWinTrigger')) features++;
		if (verifyRound(g, round, `${preset} round ${i}`, meters)) ok++;
	}
	check(ok === ROUNDS, `${ok}/${ROUNDS} rounds consistent (${features} features)`);
	if (ok === ROUNDS)
		pass(
			`${ROUNDS} rounds, ${features} features: board, counter, stickiness, order, sums, seq/gid`,
		);
	await g.close();
}

// ---------- 2. every beat on demand ----------

/** Play one forced round on a fresh session and verify it; returns the round. */
const forced = async (g, force, opts = {}) => {
	const sid = `f-${force}-${Math.random().toString(36).slice(2, 7)}`;
	const probe = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const round = await playRound(g, sid, { force, ...opts });
	if (round.error) {
		check(false, `force ${force}`, round.error);
		return null;
	}
	verifyRound(
		g,
		round,
		`force ${force}`,
		meterStart(probe.events.find((e) => e.event === 'config')?.context),
	);
	return round;
};
const beat = async (g, force, test, what, opts) => {
	const round = await forced(g, force, opts);
	if (round && check(test(round), `${force}: ${what}`)) pass(`${force} — ${what}`);
};
const cause = (r) => first(r, 'holdAndWinTrigger')?.cause;
const inRespin = (r, n, name) =>
	(r.responses[n]?.events ?? []).filter((e) => e.event === name).map((e) => e.context);
const endCells = (r) => first(r, 'holdAndWinEnd')?.cells ?? [];
/** The respin that ends the feature says 0 left and no reset, like its closing snapshot. */
const closesAtZero = (r) => {
	const last = all(r, 'respinUpdate').at(-1);
	return last?.left === 0 && last.reset === false;
};
const jackpotsWon = (r, source) =>
	all(r, 'jackpotWin').filter((j) => !source || j.source === source);

{
	const g = await boot('pots');
	console.log('pots (3 Pots of Egypt): forced beats');
	await beat(g, 'trigger:count', (r) => cause(r) === 'count', 'enters by count');
	await beat(
		g,
		'lucky',
		(r) => first(r, 'luckySpin') && cause(r) === 'luckySpin',
		'a Lucky Spin announced and entered',
	);
	for (const m of g.block.meters) {
		await beat(
			g,
			`meter:${m.id}`,
			(r) =>
				cause(r) === 'meter' &&
				first(r, 'holdAndWinTrigger').meters.includes(m.id) &&
				first(r, 'holdAndWinTrigger').activeModifiers.includes(m.activates) &&
				all(r, 'meterUpdate').some((u) => u.meter === m.id && u.full) &&
				all(r, 'meterLevels')
					.at(-1)
					.meters.find((x) => x.id === m.id).level === 0,
			`a full ${m.id} pot enters with the ${m.activates} active, and empties`,
		);
	}
	await beat(
		g,
		'special:payer',
		(r) => inRespin(r, 1, 'coinPay').length > 0,
		'the payer adds to every coin',
	);
	await beat(
		g,
		'special:multiplier',
		(r) =>
			inRespin(r, 1, 'coinBoost').length > 0 && inRespin(r, 1, 'specialBecomesCoin').length > 0,
		'the multiplier multiplies, then becomes a coin',
	);
	await beat(
		g,
		'special:collector',
		(r) => inRespin(r, 1, 'coinCollect').length > 0,
		'the collector collects',
	);
	await beat(
		g,
		'special:mystery',
		(r) => inRespin(r, 1, 'mysteryReveal').length > 0,
		'a mystery reveals',
	);
	await beat(
		g,
		'mystery:coin',
		(r) => inRespin(r, 1, 'mysteryReveal')[0]?.cells[0].becomes === 'coin',
		'a mystery reveals a coin',
	);
	for (const tier of ['MINI', 'MINOR', 'MAJOR']) {
		await beat(
			g,
			`mystery:jackpot:${tier}`,
			(r) => inRespin(r, 1, 'mysteryReveal')[0]?.cells[0].jackpot === tier,
			`a mystery reveals ${tier}`,
		);
	}
	for (const special of ['payer', 'collector', 'multiplier']) {
		await beat(
			g,
			`unlock:${special}`,
			(r) =>
				!first(r, 'holdAndWinTrigger').activeModifiers.includes(special) &&
				inRespin(r, 1, 'mysteryReveal')[0]?.activates.includes(special) &&
				first(r, 'playedBonusSpin').holdAndWin.activeModifiers.includes(special),
			`a mystery unlocks the inactive ${special}`,
		);
	}
	for (const tier of ['MINI', 'MINOR', 'MAJOR']) {
		await beat(
			g,
			`jackpot:${tier}`,
			(r) =>
				endCells(r).some((c) => c.jackpot === tier) &&
				jackpotsWon(r, 'coin').some((j) => j.tier === tier),
			`a ${tier} coin lands and pays`,
		);
	}
	await beat(
		g,
		'fullBoard',
		(r) =>
			jackpotsWon(r, 'fullBoard')[0]?.tier === 'GRAND' &&
			first(r, 'holdAndWinEnd').banked >= jackpotsWon(r, 'fullBoard')[0].amount &&
			closesAtZero(r),
		'a full board pays GRAND, its respin closing at 0 left without a reset',
	);
	{
		// Planted bug: the respin that fills the board reports a reset (counter back to the start)
		// while its snapshot says 0 — what the mock sent before. The verifier must refuse it.
		const round = await forced(g, 'fullBoard');
		if (round) {
			const planted = structuredClone(round);
			const update = planted.responses
				.flatMap((resp) => resp.events)
				.filter((e) => e.event === 'respinUpdate')
				.at(-1).context;
			update.left = g.block.respins.start;
			update.reset = true;
			const problems = roundProblems(g, planted, meterStart(round.config));
			if (
				check(
					problems.some((p) => /reset true|left/.test(p)),
					'a feature-ending respin that reports a reset is flagged',
					problems.join(' | ') || 'not flagged',
				)
			)
				pass('planted: a reset on the full-board respin is caught');
		}
	}
	await beat(
		g,
		'chain',
		(r) => {
			const updates = all(r, 'respinUpdate');
			const empties = 15 - first(r, 'holdAndWinTrigger').cells.length;
			return (
				updates.length === empties - 1 + g.block.respins.start &&
				updates.slice(0, empties - 1).every((u) => u.reset)
			);
		},
		'the longest reset chain (a coin every respin until one cell is left)',
	);
	await beat(
		g,
		'queuedMode',
		(r) => {
			const names = (resp) => resp.events.map((e) => e.event);
			const opening = names(r.responses[0]);
			const closing = r.responses.find((resp) => names(resp).includes('holdAndWinEnd'));
			const enter = first(r, 'modeEnter');
			const exit = first(r, 'modeExit');
			return (
				opening.indexOf('modeEnter') > opening.indexOf('holdAndWinTrigger') &&
				enter?.mode === 'queuedFixture' &&
				enter.policy === 'queue' &&
				enter.cause === 'forced' &&
				names(closing).indexOf('modeExit') > names(closing).indexOf('holdAndWinEnd') &&
				names(closing).indexOf('modeExit') < names(closing).indexOf('gameEnd') &&
				exit?.mode === 'queuedFixture' &&
				exit.total === 0 &&
				all(r, 'modeEnter').length === 1 &&
				all(r, 'modeExit').length === 1
			);
		},
		'a second mode queued behind the feature: modeEnter after the trigger, modeExit after the end',
	);
	await beat(
		g,
		'dead',
		(r) => all(r, 'respinUpdate').length === g.block.respins.start,
		'nothing lands: three respins',
	);
	for (const spec of [
		'letter',
		'wheel:0',
		'trigger:pattern',
		'instant',
		'bogus',
		'jackpot:GIANT',
		'queuedMode:holdAndWin',
	]) {
		const round = await playRound(g, `bad-${spec}`, { force: spec });
		check(Boolean(round.error), `force ${spec} is refused on pots`, round.error ?? 'dealt');
	}
	pass('forces this game cannot deal are refused, not dealt as a normal round');
	await g.close();
}

{
	const g = await boot('classic');
	console.log('classic (Grand): forced beats');
	await beat(g, 'trigger:count', (r) => cause(r) === 'count', 'enters by count');
	await beat(
		g,
		'trigger:randomMetre',
		(r) => cause(r) === 'randomMetre' && first(r, 'randomMetreTrigger')?.name === 'Diamond Metre',
		'the Diamond Metre enters',
	);
	await beat(
		g,
		'trigger',
		(r) => cause(r) === 'buy' && first(r, 'bet').total === 70 * 5 * 4,
		'the 70× buy enters, charged 70× the base stake',
		{ bet: [1, 4] },
	);
	await beat(
		g,
		'trigger',
		(r) =>
			cause(r) === 'buy' &&
			first(r, 'bet').total === 300 * 5 * 4 &&
			[1, 2].every((n) => inRespin(r, n, 'coinsLand')[0]?.cells.some((c) => c.symbol === 'BOOST')),
		'the 300× Super Buy lands its two guaranteed boosts',
		{ bet: [2, 4] },
	);
	await beat(
		g,
		'special:multiplier,jackpot:MAJOR',
		(r) =>
			inRespin(r, 1, 'coinBoost')[0]?.cells.some((c) => c.jackpot === 'MAJOR' && c.to > c.from),
		'the boost multiplies jackpot coins too',
	);
	await beat(
		g,
		'letter',
		(r) => all(r, 'columnComplete').some((c) => c.newlyLit && c.cleared && c.amount > 0),
		'a full column lights its letter and sweeps into the total',
	);
	await beat(
		g,
		'letters',
		(r) => jackpotsWon(r, 'letters')[0]?.tier === 'GRAND' && closesAtZero(r),
		'G-R-A-N-D pays GRAND, its respin closing at 0 left without a reset',
	);
	for (const tier of ['MINI', 'MINOR', 'MAJOR']) {
		await beat(
			g,
			`jackpot:${tier}`,
			(r) => jackpotsWon(r).some((j) => j.tier === tier),
			`a ${tier} coin pays`,
		);
	}
	await beat(
		g,
		'instant',
		(r) => first(r, 'coinInstantCollect')?.amount > 0 && !first(r, 'holdAndWinTrigger'),
		'a base-game BOOST collects its coins at once',
	);
	await beat(
		g,
		'chain',
		(r) => all(r, 'respinUpdate').filter((u) => u.reset).length >= 10,
		'a long reset chain on a board that sweeps its columns',
	);
	await g.close();
}

{
	const g = await boot('collector');
	console.log('collector (Super Hotfire Diamonds): forced beats');
	await beat(g, 'trigger:pattern', (r) => cause(r) === 'pattern', 'coin–collector–coin enters');
	await beat(
		g,
		'trigger:randomMetre',
		(r) => cause(r) === 'randomMetre',
		'the Extra Bonus Game metre enters',
	);
	g.block.wheel.prizes.forEach(() => {});
	for (const [i, prize] of g.block.wheel.prizes.entries()) {
		await beat(
			g,
			`wheel:${i}`,
			(r) => {
				const w = first(r, 'holdAndWinWheel');
				if (w?.index !== i || w.prize.type !== prize.type) return false;
				if (prize.type === 'coinBoost')
					return all(r, 'coinBoost').some((b) => b.source === 'wheel');
				if (prize.type === 'extraCollect') {
					return first(r, 'enterBonus').holdAndWin.collectorLevel === Math.min(3, 1 + prize.count);
				}
				return jackpotsWon(r, 'wheel')[0]?.tier === prize.jackpot;
			},
			`the wheel pays ${prize.type}${prize.count ? ` +${prize.count}` : ''}${prize.jackpot ? ` ${prize.jackpot}` : ''}`,
		);
	}
	await beat(
		g,
		'jackpot:GRAND',
		(r) => jackpotsWon(r, 'collect').some((j) => j.tier === 'GRAND'),
		'a GRAND coin is collected (GRAND is a coin here)',
	);
	await beat(
		g,
		'instant',
		(r) => first(r, 'coinInstantCollect')?.amount > 0 && !first(r, 'holdAndWinTrigger'),
		'a base-game COLLECT + coin pays at once, without the feature',
	);
	await beat(
		g,
		'chain',
		(r) =>
			all(r, 'coinCollect').length >= 10 &&
			all(r, 'respinUpdate').filter((u) => u.reset).length >= 10,
		'the streak: a coin every respin, collected and cleared',
	);
	await g.close();
}

// ---------- 2b. add-respins + upgrade (Phase 11a) on the pots-extra test fixture ----------

/** pots-extra with an edit — a variant the gate deals from, which must still validate clean. */
const variant = (id, edit) => {
	const raw = structuredClone(HOLD_AND_WIN_TEST_FIXTURES['pots-extra']);
	raw.gameID = `pots_extra_${id}`;
	edit(raw.holdAndWin);
	const errors = validateGameConfigDoc(normalizeGameConfigDoc(raw)).filter(
		(i) => i.severity === 'error',
	);
	check(!errors.length, `the ${id} variant validates`, errors.map((i) => i.message).join(' | '));
	return raw;
};
const respinUpdateAt = (r, n) => inRespin(r, n, 'respinUpdate')[0];
const snapshotAt = (r, n) => inRespin(r, n, 'playedBonusSpin')[0]?.holdAndWin;
const heldAt = (r, n, cell) => snapshotAt(r, n)?.cells.some((c) => key(c) === key(cell));
const applied = (r, n) =>
	inRespin(r, n, 'cellsCleared')
		.filter((c) => c.reason === 'applied')
		.flatMap((c) => c.cells.map(key));

/**
 * Break after respin 1 (the beat), reload, replay every stored position, and play on: the replay
 * must hand back the same answers, its last snapshot (and the server's own state) must hold the
 * board, `left` and `start` the beat left behind, and the round must still add up.
 */
const resumeAfter = async (g, force) => {
	const sid = `resume-${force}-${Math.random().toString(36).slice(2, 7)}`;
	const booted = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const meters = meterStart(booted.events.find((e) => e.event === 'config').context);
	const opening = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [25, 4] },
		{ action: 'play', context: `force:${force}` },
	]);
	const gid = opening.platform.gameRound?.id;
	const r2 = gid && (await g.post(`/rgs/engine?sid=${sid}&seq=2&gid=${gid}`, [{ action: 'play' }]));
	if (!r2 || r2.events.some((e) => e.event === 'gameEnd')) {
		return check(false, `resume after ${force}`, 'the feature did not stay open past respin 1');
	}
	const live = r2.events.find((e) => e.event === 'playedBonusSpin').context.holdAndWin;
	const config = (await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }])).events.find(
		(e) => e.event === 'config',
	);
	const again0 = await g.post(
		`/rgs/engine?sid=${sid}&seq=0&gid=${gid}`,
		config.actions.slice(0, 2),
	);
	const again2 = await g.post(`/rgs/engine?sid=${sid}&seq=2&gid=${gid}`, [config.actions[2]]);
	const replayed = again2.events.find((e) => e.event === 'playedBonusSpin')?.context.holdAndWin;
	const state = (await g.get(`/state?sid=${sid}`)).round.feature;
	const picture = (s) =>
		JSON.stringify([showMap(snapshotMap(s?.cells ?? [])), s?.left, s?.start, s?.banked]);
	const round = {
		gid,
		requests: [
			{ seq: 0, gid: null },
			{ seq: 2, gid },
		],
		responses: [opening, r2],
		balanceBefore: 10_000,
	};
	let seq = 3;
	let resp = r2;
	while (!resp.events.some((e) => e.event === 'gameEnd') && seq < 300) {
		resp = await g.post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'play' }]);
		round.requests.push({ seq: seq++, gid });
		round.responses.push(resp);
	}
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
	round.requests.push({ seq, gid });
	round.responses.push(resp);
	round.balanceAfter = resp.platform.balance;
	const ok =
		config.resume === true &&
		JSON.stringify(again0.events) === JSON.stringify(opening.events) &&
		JSON.stringify(again2.events) === JSON.stringify(r2.events) &&
		picture(replayed) === picture(live) &&
		picture(state) === picture(live) &&
		verifyRound(g, round, `the round resumed after ${force}`, meters);
	if (
		check(ok, `resume after ${force}: replay, snapshot and server state rebuild board/left/start`)
	)
		pass(`resume after ${force} — replay, snapshot and server state agree; the round adds up`);
};

{
	const g = await boot('pots-extra');
	console.log('pots-extra (3 Pots + add-respins + upgrade): forced beats');
	await beat(
		g,
		'special:addRespins',
		(r) => {
			const add = inRespin(r, 1, 'respinsAdded')[0];
			return (
				add?.added >= 1 &&
				add.left === g.block.respins.start + add.added &&
				add.total === g.block.respins.start &&
				// Nothing else landed, so no reset: one off the added-to counter.
				respinUpdateAt(r, 1).left === add.left - 1 &&
				respinUpdateAt(r, 1).start === g.block.respins.start &&
				applied(r, 1).includes(key(add.cell)) &&
				!heldAt(r, 1, add.cell)
			);
		},
		'adds its respins to the counter (cap unchanged), then clears as applied',
	);
	await beat(
		g,
		'special:addRespins,chain',
		(r) => {
			const add = inRespin(r, 1, 'respinsAdded')[0];
			const second = respinUpdateAt(r, 2);
			return (
				Boolean(add) &&
				second.reset &&
				second.left === Math.max(g.block.respins.start, respinUpdateAt(r, 1).left)
			);
		},
		'a later reset fills to max(cap, left) — never throws the added respins away',
	);
	for (const rule of ['all', 'adjacent']) {
		await beat(
			g,
			`special:upgrade:${rule}`,
			(r) => {
				const up = inRespin(r, 1, 'coinUpgrade')[0];
				return (
					up?.target === rule &&
					up.step > 0 &&
					up.cells.length > 0 &&
					up.cells.every((c) => c.to === tidy(c.from + up.step)) &&
					heldAt(r, 1, up.upgrader) &&
					!endCells(r).some((c) => key(c) === key(up.upgrader))
				);
			},
			`the ${rule} rule raises the cash coins by its step, and the upgrade stays, worth nothing`,
		);
	}
	await beat(
		g,
		'special:upgrade:jackpotTier',
		(r) => {
			const up = inRespin(r, 1, 'coinUpgrade')[0];
			const [cell] = up?.cells ?? [];
			return (
				up?.step === 0 &&
				up.cells.length === 1 &&
				cell.fromJackpot === g.ladder[0] &&
				cell.jackpot === g.ladder[1] &&
				snapshotAt(r, 1).cells.some((c) => key(c) === key(cell) && c.jackpot === g.ladder[1])
			);
		},
		'the jackpotTier rule lands the lowest tier and steps it one tier up',
	);
	await beat(
		g,
		'special:upgrade',
		(r) => inRespin(r, 1, 'coinUpgrade').length === 1,
		'an upgrade with no rule forced draws one',
	);
	for (const kind of ['addRespins', 'upgrade']) {
		const event = kind === 'addRespins' ? 'respinsAdded' : 'coinUpgrade';
		await beat(
			g,
			`mystery:${kind}`,
			(r) => {
				const revealed = inRespin(r, 1, 'mysteryReveal')[0]?.cells[0];
				const names = r.responses[1].events.map((e) => e.event);
				return (
					revealed?.becomes === kind &&
					names.indexOf(event) > names.indexOf('mysteryReveal') &&
					key(inRespin(r, 1, event)[0]?.[kind === 'upgrade' ? 'upgrader' : 'cell'] ?? {}) ===
						key(revealed)
				);
			},
			`a mystery reveals the ${kind}, which applies in the same respin (it comes after mystery)`,
		);
	}
	await beat(
		g,
		'unlock:upgrade',
		(r) =>
			!first(r, 'holdAndWinTrigger').activeModifiers.includes('upgrade') &&
			inRespin(r, 1, 'mysteryReveal')[0]?.activates.includes('upgrade') &&
			inRespin(r, 1, 'coinUpgrade').length === 1,
		'a mystery unlocks the inactive upgrade',
	);
	for (const force of [
		'special:addRespins',
		'special:upgrade:all',
		'special:upgrade:adjacent',
		'special:upgrade:jackpotTier',
		'mystery:addRespins',
		'mystery:upgrade',
	]) {
		await resumeAfter(g, force);
	}
	for (const spec of ['special:upgrade:bogus', 'special:upgrade:']) {
		const round = await playRound(g, `bad-${spec}`, { force: spec });
		check(Boolean(round.error), `force ${spec} is refused on pots-extra`, round.error ?? 'dealt');
	}
	// How often the natural deal reaches them — the round re-derivation in section 1 checks each one.
	let natural = { respinsAdded: 0, coinUpgrade: 0 };
	const meters = Object.fromEntries(g.block.meters.map((m) => [m.id, 0]));
	for (let i = 0; i < 60; i++) {
		const round = await playRound(g, 'natural-extra', { force: 'trigger' });
		verifyRound(g, round, `pots-extra natural round ${i}`, meters);
		natural = {
			respinsAdded: natural.respinsAdded + all(round, 'respinsAdded').length,
			coinUpgrade: natural.coinUpgrade + all(round, 'coinUpgrade').length,
		};
	}
	if (
		check(
			natural.respinsAdded > 0 && natural.coinUpgrade > 0,
			'both specials land in natural respins',
			JSON.stringify(natural),
		)
	)
		pass(
			`60 natural features: ${natural.respinsAdded} add-respins, ${natural.coinUpgrade} upgrades`,
		);
	await g.close();
}

{
	const pots = await boot('pots');
	for (const spec of [
		'special:addRespins',
		'special:upgrade',
		'mystery:upgrade',
		'unlock:addRespins',
	]) {
		const round = await playRound(pots, `bad-${spec}`, { force: spec });
		check(Boolean(round.error), `force ${spec} is refused on pots`, round.error ?? 'dealt');
	}
	pass('pots (no add-respins, no upgrade) refuses their beats');
	await pots.close();
}

{
	console.log('pots-extra variants: raisesCap, sticky, a tier-only upgrade');
	const raises = await boot(variant('raises', (b) => (b.specials.addRespins.raisesCap = true)));
	await beat(
		raises,
		'special:addRespins,chain',
		(r) => {
			const add = inRespin(r, 1, 'respinsAdded')[0];
			const cap = raises.block.respins.start + add?.added;
			return (
				add?.total === cap &&
				respinUpdateAt(r, 1).start === cap &&
				snapshotAt(r, 1).start === cap &&
				respinUpdateAt(r, 2).reset &&
				respinUpdateAt(r, 2).left === cap &&
				respinUpdateAt(r, 2).start === cap
			);
		},
		'raisesCap: the cap rises by the added respins, and a later reset fills to it',
	);
	await resumeAfter(raises, 'special:addRespins');
	await raises.close();

	const sticky = await boot(variant('sticky', (b) => (b.specials.addRespins.sticky = true)));
	await beat(
		sticky,
		'special:addRespins',
		(r) => {
			const add = inRespin(r, 1, 'respinsAdded')[0];
			return (
				Boolean(add) &&
				applied(r, 1).length === 0 &&
				!all(r, 'cellsCleared').some((c) => c.reason === 'applied') &&
				heldAt(r, 1, add.cell) &&
				!endCells(r).some((c) => key(c) === key(add.cell))
			);
		},
		'sticky: it stays on the board after applying, worth nothing',
	);
	await resumeAfter(sticky, 'special:addRespins');
	await sticky.close();

	const allOnly = await boot(
		variant('allonly', (b) => (b.specials.upgrade.targets = [{ target: 'all', weight: 1 }])),
	);
	const refused = await playRound(allOnly, 'bad-tier', { force: 'special:upgrade:jackpotTier' });
	check(
		Boolean(refused.error),
		'a rule the upgrade does not have is refused',
		refused.error ?? 'dealt',
	);
	await allOnly.close();

	// Two tiers, only the top one on the coin table, and an upgrade that only climbs tiers (so its
	// cell carries no step): the forced MINI climbs to GRAND, a GRAND never moves, and an upgrade with
	// nothing below the top changes nothing.
	const tierOnly = await boot(
		variant('tieronly', (b) => {
			b.jackpots = [
				{ name: 'MINI', multiplier: 15, fixed: true },
				{ name: 'GRAND', multiplier: 2000, fixed: true },
			];
			b.coins = b.coins
				.filter((c) => c.kind === 'cash')
				.concat({ kind: 'jackpot', jackpot: 'GRAND', weight: 2 });
			b.specials.mystery.reveals = b.specials.mystery.reveals.filter((r) => r.type !== 'jackpot');
			b.specials.upgrade = {
				targets: [{ target: 'jackpotTier', weight: 1 }],
				values: [],
				landsInBaseGame: false,
			};
		}),
	);
	await beat(
		tierOnly,
		'jackpot:GRAND,special:upgrade:jackpotTier',
		(r) => {
			const up = inRespin(r, 1, 'coinUpgrade')[0];
			const board = r.responses[1].events.find((e) => e.event === 'playedSpin').context.flat();
			return (
				board.includes('UPG') &&
				up?.upgrader.value === undefined &&
				up.cells.length === 1 &&
				up.cells[0].fromJackpot === 'MINI' &&
				up.cells[0].jackpot === 'GRAND' &&
				!all(r, 'coinUpgrade').some((u) => u.cells.some((c) => c.fromJackpot === 'GRAND'))
			);
		},
		'a step-less upgrade (`UPG`) climbs MINI to the top tier, and never past it',
	);
	let idle = 0;
	const meters = Object.fromEntries(tierOnly.block.meters.map((m) => [m.id, 0]));
	for (let i = 0; i < 40; i++) {
		const round = await playRound(tierOnly, 'tier-natural', { force: 'trigger' });
		verifyRound(tierOnly, round, `tier-only natural round ${i}`, meters);
		idle += all(round, 'coinUpgrade').filter((u) => !u.cells.length).length;
	}
	if (check(idle > 0, 'an upgrade with no tier below the top changes nothing', `${idle} seen`))
		pass(`tier-only: ${idle} upgrades found nothing below the top and changed nothing`);
	await tierOnly.close();
}

// ---------- 2c. parity: the presets deal exactly what main dealt ----------

{
	console.log('parity: the presets deal byte-identical rounds to main for fixed seeds');
	// Each digest hashes every answer (events, balance, refusal) of 400 seeded rounds (every 5th
	// forced to trigger) plus one round per forced beat the preset accepts and its buys. The pinned
	// values were computed by the SAME routine against a pristine `git show
	// origin/main:scripts/mock-rgs-server-holdandwin.mjs` (2026-10-02, before Phase 11a); a mock
	// change that draws the RNG once more on a path these games take, or emits one byte differently,
	// moves them.
	const MAIN_DIGESTS = {
		pots: '6d06e0f666b40a72',
		classic: '7865bdb92b8da0ba',
		collector: 'ac54abed6d4e6066',
	};
	const SPECS = [
		'trigger',
		'special:payer',
		'special:multiplier',
		'special:collector',
		'special:mystery',
		'mystery:coin',
		'mystery:jackpot:MINI',
		'unlock:payer',
		'unlock:multiplier',
		'jackpot:MINI',
		'jackpot:MAJOR',
		'jackpot:GRAND',
		'fullBoard',
		'letter',
		'letters',
		'chain',
		'dead',
		'lucky',
		'meter:red',
		'meter:blue',
		'trigger:randomMetre',
		'trigger:pattern',
		'instant',
		'wheel:0',
		'wheel:1',
		'wheel:2',
		'wheel:3',
		'wheel:6',
		'queuedMode',
		'special:multiplier,jackpot:MAJOR',
	];
	const digest = async (preset, seed, rounds) => {
		const { opts } = contractFor(preset);
		const mock = createMockRgs({ quiet: true, seed, ...opts });
		const hash = createHash('sha256');
		const call = (sid, seq, gid, body) =>
			new Promise((resolve) => {
				const text = JSON.stringify(body);
				const req = {
					method: 'POST',
					headers: {},
					on(ev, fn) {
						if (ev === 'data') fn(Buffer.from(text));
						if (ev === 'end') fn();
					},
				};
				const out = { writeHead() {}, end: (t) => resolve(JSON.parse(t)) };
				const query = `sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`;
				mock.handle(req, out, new URL(`http://x/rgs/engine?${query}`));
			});
		const record = (resp) =>
			hash.update(JSON.stringify([resp.events, resp.platform?.balance, resp.error ?? null]));
		const round = async (sid, bet, context) => {
			let resp = await call(sid, 0, null, [
				{ action: 'bet', context: bet },
				{ action: 'play', context },
			]);
			record(resp);
			const gid = resp.platform?.gameRound?.id;
			if (!gid) return;
			let seq = 2;
			const seen = (name) => resp.events.some((e) => e.event === name);
			const feature = seen('enterBonus');
			while (feature && !seen('gameEnd') && seq < 300) {
				resp = await call(sid, seq++, gid, [{ action: 'play' }]);
				record(resp);
			}
			if (!seen('gameRoundOver')) record(await call(sid, seq, gid, [{ action: 'collect' }]));
		};
		const base = opts.betModes ? [0, 4] : [opts.paylines.length, 4];
		record(await call('nat', 0, null, [{ action: 'config' }]));
		for (let i = 0; i < rounds; i++) await round('nat', base, i % 5 === 0 ? 'force:trigger' : null);
		for (const spec of SPECS) {
			if (mock.parseForce(spec).errors) continue;
			const sid = `beat-${spec}`;
			record(await call(sid, 0, null, [{ action: 'config' }]));
			await round(sid, base, `force:${spec}`);
		}
		if (opts.betModes) {
			for (const option of [1, 2]) {
				record(await call(`buy-${option}`, 0, null, [{ action: 'config' }]));
				await round(`buy-${option}`, [option, 4], null);
			}
		}
		return hash.digest('hex').slice(0, 16);
	};
	let same = 0;
	for (const preset of HOLD_AND_WIN_PRESET_IDS) {
		const got = await digest(preset, `parity-${preset}`, 400);
		if (check(got === MAIN_DIGESTS[preset], `${preset}: dealt as main dealt`, `digest ${got}`))
			same++;
	}
	// The digest must be able to fail: another seed deals another game.
	check(
		(await digest('pots', 'parity-other', 400)) !== MAIN_DIGESTS.pots,
		'the parity digest moves with the deal',
	);
	if (same === HOLD_AND_WIN_PRESET_IDS.length)
		pass('pots / classic / collector: 400 seeded rounds + every beat, byte-identical to main');
}

// ---------- 3. persistent meters ----------

{
	const g = await boot('pots');
	console.log('pots: meters persist per session');
	const sid = 'meters';
	let resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const boot0 = resp.events.find((e) => e.event === 'config').context.holdAndWin.meters;
	check(
		boot0.every((m) => m.level === 0),
		'a new session boots with empty meters',
	);
	const meters = meterStart(resp.events.find((e) => e.event === 'config').context);
	let fills = 0;
	for (let i = 0; i < 60; i++) {
		const round = await playRound(g, sid, {});
		fills += all(round, 'meterUpdate').length;
		verifyRound(g, round, `meters round ${i}`, meters);
	}
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const rebooted = resp.events.find((e) => e.event === 'config').context.holdAndWin.meters;
	check(fills > 0, 'meters filled over 60 rounds', `${fills} updates`);
	check(
		rebooted.every((m) => m.level === meters[m.id]),
		'a reboot is told the levels the rounds left',
		JSON.stringify(rebooted.map((m) => m.level)),
	);
	const other = await g.post(`/rgs/engine?sid=someone-else&seq=0`, [{ action: 'config' }]);
	check(
		other.events
			.find((e) => e.event === 'config')
			.context.holdAndWin.meters.every((m) => m.level === 0),
		'another session has its own meters',
	);
	// A contract swap carries the session (services/test-server `swapMock` → `carrySession`).
	const { opts } = contractFor('pots');
	const next = createMockRgs({ quiet: true, seed: 'swap', ...opts });
	for (const [id, session] of g.mock.sessions)
		next.sessions.set(id, carrySession(session, { keepBetShape: true }));
	check(
		g.block.meters.every((m) => next.sessions.get(sid).meters[m.id] === meters[m.id]),
		'meters survive a contract swap',
	);
	if (!failed)
		pass('meters fill, persist across rounds and reboots, stay per session, survive a swap');
	await g.close();
}

// ---------- 3b. progressive jackpot pools (design §7 11c) ----------

{
	const g = await boot('pots-progressive');
	console.log('pots-progressive: pools grow per bet, pay the pool, reset, stay per session');
	const tiers = g.block.jackpots.filter((j) => !j.fixed);
	const sid = 'pools';
	const levelsOf = (events) =>
		events.findLast((e) => e.event === 'jackpotLevels')?.context.jackpots ?? null;
	let resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const meters = meterStart(resp.events.find((e) => e.event === 'config').context);
	const bootTiers = resp.events.find((e) => e.event === 'config').context.holdAndWin.jackpots;
	check(
		tiers.every((t) =>
			bootTiers.some((b) => b.name === t.name && b.progressive && b.value === t.progressive.seed),
		) && bootTiers.filter((b) => b.progressive).length === tiers.length,
		'the boot config names each progressive tier with its pool at the seed',
		JSON.stringify(bootTiers),
	);
	const pools = Object.fromEntries(tiers.map((t) => [t.name, t.progressive.seed]));
	const grow = () => {
		for (const t of tiers) {
			const cap = t.progressive.cap ?? Infinity;
			pools[t.name] = tidy(Math.min(cap, pools[t.name] + t.progressive.contribution));
		}
	};
	let grew = true;
	for (let i = 0; i < 30; i++) {
		grow();
		g.jackpots = { ...g.jackpots, ...pools };
		const round = await playRound(g, sid, {});
		verifyRound(g, round, `pools round ${i}`, meters);
		const levels = levelsOf(eventsOf(round));
		if (!levels || levels.some((l) => l.value !== pools[l.name])) grew = false;
	}
	check(
		grew,
		'every play reports each pool grown by its contribution, capped',
		JSON.stringify(pools),
	);
	const opening = await playRound(g, 'pools-order', {});
	const firstLevels = eventsOf(opening).findIndex((e) => e.event === 'jackpotLevels');
	check(
		firstLevels > eventsOf(opening).findIndex((e) => e.event === 'bet') &&
			firstLevels < eventsOf(opening).findIndex((e) => e.event === 'playedSpin'),
		'the bet reports the pools it grew before the play is dealt',
	);
	check(pools.MINOR === 40, 'MINOR stops at its 40× cap', String(pools.MINOR));
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, []);
	check(
		levelsOf(resp.events)?.every((l) => l.value === pools[l.name]),
		'the balance heartbeat restates the pools',
		JSON.stringify(levelsOf(resp.events)),
	);

	grow();
	g.jackpots = { ...g.jackpots, ...pools };
	const hit = await playRound(g, sid, { force: 'jackpot:GRAND' });
	verifyRound(g, hit, 'forced GRAND on a grown pool', meters);
	const bet = first(hit, 'bet');
	const paid = all(hit, 'jackpotWin').find((j) => j.tier === 'GRAND');
	check(
		paid?.amount === Math.round(pools.GRAND * bet.total),
		'a forced GRAND pays the grown pool, not the 2000× seed',
		`${paid?.amount} for a pool of ${pools.GRAND}× on ${bet.total}`,
	);
	const after = levelsOf(eventsOf(hit));
	check(
		after?.find((l) => l.name === 'GRAND')?.value === 2000 &&
			after.find((l) => l.name === 'MAJOR')?.value === pools.MAJOR,
		'the won pool goes back to its seed; the others keep growing',
		JSON.stringify(after),
	);
	pools.GRAND = 2000;
	const other = await g.post(`/rgs/engine?sid=someone-else&seq=0`, [{ action: 'config' }]);
	check(
		other.events
			.find((e) => e.event === 'config')
			.context.holdAndWin.jackpots.filter((j) => j.progressive)
			.every((j) => j.value === tiers.find((t) => t.name === j.name).progressive.seed),
		'another session has its own pools',
	);
	const { opts } = contractFor('pots-progressive');
	const next = createMockRgs({ quiet: true, seed: 'swap', ...opts });
	for (const [id, session] of g.mock.sessions)
		next.sessions.set(id, carrySession(session, { keepBetShape: true }));
	check(
		tiers.every((t) => next.sessions.get(sid).jackpots[t.name] === pools[t.name]),
		'pools survive a contract swap',
	);
	// Two players at once: A's request is open (its body not yet sent) while B's whole round plays.
	// Each must be dealt and paid from its OWN pools.
	{
		const port = g.port;
		const send = (path, body, holdMs) =>
			new Promise((resolve, reject) => {
				const payload = JSON.stringify(body);
				const req = request(
					{
						host: '127.0.0.1',
						port,
						path,
						method: 'POST',
						headers: {
							'content-type': 'application/json',
							'content-length': Buffer.byteLength(payload),
							connection: 'close',
						},
					},
					(res) => {
						let text = '';
						res.setEncoding('utf8');
						res.on('data', (c) => (text += c));
						res.on('end', () => resolve(JSON.parse(text)));
					},
				);
				req.on('error', reject);
				req.flushHeaders();
				setTimeout(() => req.end(payload), holdMs);
			});
		await g.post(`/rgs/engine?sid=race-b&seq=0`, [{ action: 'config' }]);
		for (let i = 0; i < 5; i++) await playRound(g, 'race-b', {});
		await g.post(`/rgs/engine?sid=race-a&seq=0`, [{ action: 'config' }]);
		const open = await g.post(`/rgs/engine?sid=race-a&seq=0`, [
			{ action: 'bet', context: [g.lines, 4] },
			{ action: 'play', context: 'force:jackpot:GRAND' },
		]);
		const gid = open.platform.gameRound?.id;
		const answers = [open];
		for (let seq = 2; gid && seq < 60; seq++) {
			const late = send(`/rgs/engine?sid=race-a&seq=${seq}&gid=${gid}`, [{ action: 'play' }], 60);
			await g.post(`/rgs/engine?sid=race-b&seq=0`, []);
			const answer = await late;
			answers.push(answer);
			if ((answer.events ?? []).some((e) => e.event === 'gameEnd')) break;
		}
		const raced = answers.flatMap((r) => r.events ?? []);
		const stake = raced.find((e) => e.event === 'bet')?.context.total;
		const paid = raced.find((e) => e.event === 'jackpotWin' && e.context.tier === 'GRAND')?.context
			.amount;
		check(
			paid === Math.round(2001 * stake),
			"a request open while another player's arrives is paid from its own pool",
			`${paid} for a 2001× pool on ${stake}`,
		);
	}
	await g.close();

	const fixed = await boot('pots');
	resp = await fixed.post(`/rgs/engine?sid=fixed&seq=0`, [{ action: 'config' }]);
	const plain = await playRound(fixed, 'fixed', {});
	check(
		!resp.events
			.find((e) => e.event === 'config')
			.context.holdAndWin.jackpots.some((j) => 'progressive' in j || 'value' in j) &&
			!eventsOf(plain).some((e) => e.event === 'jackpotLevels'),
		'a game without a progressive tier sends no pools (parity)',
	);
	await fixed.close();
	if (!failed) pass('pools grow, cap, refresh on the heartbeat, pay when hit, reset, persist');
}

// ---------- 4. resume + replay ----------

{
	const g = await boot('pots');
	console.log('pots: resume and replay an open feature');
	const sid = 'resume';
	await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const opening = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [25, 4] },
		{ action: 'play', context: 'force:chain' },
	]);
	const gid = opening.platform.gameRound.id;
	const r2 = await g.post(`/rgs/engine?sid=${sid}&seq=2&gid=${gid}`, [{ action: 'play' }]);
	const r3 = await g.post(`/rgs/engine?sid=${sid}&seq=3&gid=${gid}`, [{ action: 'play' }]);
	const balance = r3.platform.balance;

	// A reload: the balance probe names the open round, the boot config carries the stored actions.
	const probe = await g.post(`/rgs/engine?sid=${sid}&seq=0`, []);
	check(
		probe.platform.gameRound?.id === gid && probe.platform.gameRound.updating,
		'the probe names the open round',
	);
	const config = (await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }])).events.find(
		(e) => e.event === 'config',
	);
	check(config.resume === true, 'the boot config says resume');
	check(
		JSON.stringify(config.actions.map((a) => a.action)) ===
			JSON.stringify(['bet', 'play', 'play', 'play']),
		'…with the stored actions',
		JSON.stringify(config.actions.map((a) => a.action)),
	);
	// Replayed position by position, grouped the way they were sent: nothing is re-dealt or re-charged.
	const again0 = await g.post(
		`/rgs/engine?sid=${sid}&seq=0&gid=${gid}`,
		config.actions.slice(0, 2),
	);
	const again2 = await g.post(`/rgs/engine?sid=${sid}&seq=2&gid=${gid}`, [config.actions[2]]);
	const again3 = await g.post(`/rgs/engine?sid=${sid}&seq=3&gid=${gid}`, [config.actions[3]]);
	check(
		JSON.stringify(again0.events) === JSON.stringify(opening.events),
		'seq 0 replays the dealt base spin',
	);
	check(JSON.stringify(again2.events) === JSON.stringify(r2.events), 'seq 2 replays respin 1');
	check(JSON.stringify(again3.events) === JSON.stringify(r3.events), 'seq 3 replays respin 2');
	check(
		again3.platform.balance === balance,
		'no stake taken twice',
		`${balance} → ${again3.platform.balance}`,
	);
	// A mismatched replay is refused, never dealt.
	const wrong = await g.post(`/rgs/engine?sid=${sid}&seq=2&gid=${gid}`, [{ action: 'collect' }]);
	check(Boolean(wrong.error), 'a different action at an occupied position is refused');

	// …then played on live from the next free position and collected, and the whole round adds up.
	const round = {
		gid,
		requests: [{ seq: 0, gid: null }],
		responses: [opening, r2, r3],
		balanceBefore: 10_000,
	};
	round.requests.push({ seq: 2, gid }, { seq: 3, gid });
	let seq = 4;
	let resp = r3;
	while (!resp.events.some((e) => e.event === 'gameEnd')) {
		resp = await g.post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'play' }]);
		round.requests.push({ seq: seq++, gid });
		round.responses.push(resp);
	}
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
	round.requests.push({ seq, gid });
	round.responses.push(resp);
	round.balanceAfter = resp.platform.balance;
	verifyRound(g, round, 'the resumed round', { red: 0, blue: 0, green: 0 });
	const closedReplay = await g.post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [
		{ action: 'collect' },
	]);
	check(
		closedReplay.events.some((e) => e.event === 'gameRoundOver') &&
			closedReplay.platform.balance === resp.platform.balance,
		'a lost collect answer replays into the closed round without a second credit',
	);
	if (!failed)
		pass(
			'probe → resume config → replay 0/2/3 unchanged → live from 4 → collect; closed round replays',
		);
	await g.close();
}

// ---------- 5. round closing rules ----------

{
	const g = await boot('pots');
	console.log('pots: base rounds close like every mock');
	let closedLosing = false;
	let openWinning = false;
	for (let i = 0; i < 80 && !(closedLosing && openWinning); i++) {
		const sid = `close-${i}`;
		const resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
			{ action: 'bet', context: [25, 1] },
			{ action: 'play', context: null },
		]);
		const names = resp.events.map((e) => e.event);
		if (names.includes('enterBonus')) continue;
		const win = resp.events.find((e) => e.event === 'gameEnd').context.win;
		if (win === 0) closedLosing ||= names.includes('gameRoundOver') && !resp.platform.gameRound;
		else openWinning ||= !names.includes('gameRoundOver') && Boolean(resp.platform.gameRound);
	}
	check(closedLosing, 'a losing base spin closes itself');
	check(openWinning, 'a winning base spin (play: null) waits for its collect');
	const abandon = await g.post('/rgs/engine?sid=abandon&seq=0', [
		{ action: 'bet', context: [25, 1] },
		{ action: 'play', context: 'force:chain' },
	]);
	const again = await g.post('/rgs/engine?sid=abandon&seq=0', [
		{ action: 'bet', context: [25, 1] },
		{ action: 'play', context: null },
	]);
	check(
		!again.error && again.platform.balance > abandon.platform.balance - 25,
		'a bet over an open feature opens a new round; the old one is played out and credited',
	);
	if (!failed)
		pass('losing rounds close, winning ones wait for collect, an abandoned feature is settled');
	await g.close();
}

// ---------- 6. a refusal stores nothing; positions and rounds are policed ----------

{
	const g = await boot('classic');
	console.log('classic: refusals are atomic, seq/gid are policed');
	const sid = 'atomic';
	await g.post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const balance = async () => (await g.post(`/rgs/engine?sid=${sid}&seq=0`, [])).platform;
	const start = (await balance()).balance;

	let resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [0, 4] },
		{ action: 'play', context: 'force:bogus' },
	]);
	let after = await balance();
	check(
		Boolean(resp.error) && after.balance === start && !after.gameRound,
		'a refused play takes no stake and opens no round',
	);

	await g.get(`/force?sid=${sid}&beat=instant`);
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [1, 1] },
		{ action: 'play', context: null },
	]);
	after = await balance();
	check(
		Boolean(resp.error) && after.balance === start,
		'an instant force on a buy is refused without a charge',
	);
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [0, 4] },
		{ action: 'play', context: null },
	]);
	check(
		Boolean(first({ responses: [resp] }, 'coinInstantCollect')),
		'…and the held force survives the refusal',
	);
	if (resp.platform.gameRound) {
		await g.post(`/rgs/engine?sid=${sid}&seq=2&gid=${resp.platform.gameRound.id}`, [
			{ action: 'collect' },
		]);
	}

	// An open feature, then a bet the wallet cannot cover: the open round is untouched.
	const open = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [0, 4] },
		{ action: 'play', context: 'force:chain' },
	]);
	const gid = open.platform.gameRound.id;
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [2, 100_000] },
		{ action: 'play', context: null },
	]);
	after = await balance();
	check(
		Boolean(resp.error) && after.gameRound?.id === gid && after.balance === open.platform.balance,
		'a refused bet over an open feature leaves it open and unsettled',
	);

	// `config` inside a replayed batch takes no position.
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=0&gid=${gid}`, [
		{ action: 'config' },
		{ action: 'bet', context: [0, 4] },
		{ action: 'play', context: null },
	]);
	check(
		!resp.error &&
			resp.events.some((e) => e.event === 'config') &&
			resp.events.some((e) => e.event === 'enterBonus'),
		'[config, bet, play] under the gid replays the dealt spin',
	);

	resp = await g.post(`/rgs/engine?sid=${sid}&seq=7&gid=${gid}`, [{ action: 'play' }]);
	check(Boolean(resp.error), 'a respin past the next free position is refused');
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=2`, [{ action: 'play' }]);
	check(Boolean(resp.error), 'a respin with no gid is refused');
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=2&gid=Gstale`, [{ action: 'play' }]);
	check(Boolean(resp.error), "a respin under another round's gid is refused");
	resp = await g.post(`/rgs/engine?sid=${sid}&seq=2&gid=${gid}`, [{ action: 'play' }]);
	check(
		!resp.error && resp.events.some((e) => e.event === 'respinUpdate'),
		'the right position under the right gid plays',
	);

	// A bet table pinned by the LINES mock (a contract swap) names no modes; a buy still prices and
	// finds its tier by option index.
	const session = g.mock.sessions.get(sid);
	session.round = null;
	session.betTable = {
		options: session.betTable.options,
		names: session.betTable.names,
		buys: session.betTable.buys,
	};
	const buy = await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [2, 1] },
		{ action: 'play', context: null },
	]);
	check(
		!buy.error && first({ responses: [buy] }, 'holdAndWinTrigger')?.cause === 'buy',
		'a buy under a pinned table without mode names still enters as a buy',
		buy.error,
	);
	if (!failed)
		pass('refusals store nothing; config takes no position; gaps and stale gids are refused');
	await g.close();
}

{
	console.log('forcing can be switched off, and a malformed block never throws mid-spin');
	const g = await boot('pots', { allowForce: false });
	const resp = await g.post('/rgs/engine?sid=off&seq=0', [
		{ action: 'bet', context: [25, 1] },
		{ action: 'play', context: 'force:trigger' },
	]);
	const held = await g.get('/force?sid=off&beat=trigger');
	check(Boolean(resp.error) && held?.ok === false, 'a mock with forcing off refuses both routes');
	await g.close();

	const { opts } = contractFor('classic');
	const broken = structuredClone(opts.holdAndWin);
	broken.block.trigger = { count: { min: 6 }, pattern: 'nope' };
	broken.block.boardEnd = {
		type: 'columnLetters',
		letters: 7,
		jackpot: 'GRAND',
		clearOnComplete: true,
	};
	const mock = createMockRgs({ quiet: true, seed: 'broken', ...opts, holdAndWin: broken });
	let threw = null;
	for (let i = 0; i < 40 && !threw; i++) {
		const res = await new Promise((resolve) => {
			const body = JSON.stringify([
				{ action: 'bet', context: [5, 1] },
				{ action: 'play', context: i % 2 ? 'force:trigger' : null },
			]);
			const req = {
				method: 'POST',
				headers: {},
				on(ev, fn) {
					if (ev === 'data') fn(Buffer.from(body));
					if (ev === 'end') fn();
				},
			};
			const out = {
				status: 0,
				writeHead: (s) => (out.status = s),
				end: (t) => resolve({ status: out.status, body: JSON.parse(t) }),
			};
			mock.sessions.set(`b${i}`, {
				balance: 10_000,
				round: null,
				configSent: true,
				betTable: null,
			});
			mock.handle(req, out, new URL(`http://x/rgs/engine?sid=b${i}&seq=0`));
		});
		if (res.status === 500) threw = res.body.error?.message;
	}
	check(!threw, 'a malformed trigger and letters deal without a 500', threw);
	if (!failed) pass('forcing off is refused on both routes; a malformed block still deals');
}

// ---------- 7. the test-server image ships what it imports ----------

{
	console.log('the test-server image carries this mock');
	// No other check builds the Docker image, and every check runs from the repo tree — so a module
	// server.mjs imports but the Dockerfile does not COPY crash-loops the deployed server and nothing
	// local notices. The static imports of the mocks it ships must all be in the image.
	const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
	const copied = new Set(
		read('services/test-server/Dockerfile')
			.split('\n')
			.filter((line) => line.startsWith('COPY scripts/'))
			.flatMap((line) => line.split(/\s+/).slice(1, -1)),
	);
	const shipped = [
		...read('services/test-server/server.mjs').matchAll(/from '\.\.\/\.\.\/(scripts\/[^']+)'/g),
	].map((m) => m[1]);
	const mockImports = [
		...read('scripts/mock-rgs-server-holdandwin.mjs').matchAll(/^import .* from '\.\/([^']+)'/gm),
	].map((m) => `scripts/${m[1]}`);
	const missing = [...shipped, ...mockImports].filter((rel) => !copied.has(rel));
	check(
		shipped.includes('scripts/mock-rgs-server-holdandwin.mjs'),
		'server.mjs imports the Hold and Win mock',
	);
	if (
		check(
			!missing.length,
			'every scripts/ module the server and the mock import is COPY’d',
			missing.join(', '),
		)
	) {
		pass('the Dockerfile copies every mock module the test server imports');
	}
}

console.log(
	failed
		? `\n✗ ${failed} Hold and Win protocol check(s) failed`
		: '\n✓ Hold and Win protocol checks passed',
);
process.exit(failed ? 1 : 0);
