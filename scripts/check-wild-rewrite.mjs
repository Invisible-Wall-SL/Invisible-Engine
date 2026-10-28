// EXPANDING and GROWING WILDS on the lines mock and the facade
// (`docs/design/expanding-and-growing-wilds.md` §2–§3, §6): the mock lands, expands, grows and
// counts in that order and pays only the final board; the facade turns the wire into `expandWild` /
// `growWild` after the board and before its wins, and the money and the win lines agree.
//
//   pnpm check:wild-rewrite            (part of check:rgs)
//
// A config without the blocks is held byte-identical by `check:lines-parity`.

import { createServer } from 'node:http';

import { createMockRgs, evaluatePaylines } from './mock-rgs-server.mjs';
import { createWildRewrite, growCells as mockGrowCells } from './mock-wild-rewrite.mjs';

const facade = await import('../packages/rgs-translator-eagaming/engine-facade.ts');
const { growCells } = await import('../packages/game-config/src/growingWild.ts');
const { GROWING_WILD_PATTERNS } = await import('../packages/game-config/src/types.ts');

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};
const silently = async (run) => {
	const [log, warn] = [console.log, console.warn];
	console.log = console.warn = () => {};
	try {
		return await run();
	} finally {
		[console.log, console.warn] = [log, warn];
	}
};

/** One in-process request: the mock's own `handle` with a minimal request and response. */
const call = (mock, body, url) =>
	new Promise((done) => {
		const req = {
			method: 'POST',
			headers: {},
			on(event, cb) {
				if (event === 'data') cb(Buffer.from(JSON.stringify(body)));
				if (event === 'end') cb();
				return this;
			},
		};
		const res = { writeHead() {}, end: (text) => done(JSON.parse(text)) };
		mock.handle(req, res, new URL(url, 'http://mock'));
	});

/** Every response's events of one round, base play first, then each free spin. */
const playRound = async (mock, sid) => {
	const first = await call(
		mock,
		[
			{ action: 'bet', context: [10, 1] },
			{ action: 'play', context: null },
		],
		`/rgs/engine?sid=${sid}&seq=0`,
	);
	const plays = [first.events];
	const gid = first.platform?.gameRound?.id;
	let last = first;
	for (let seq = 2; gid && !last.events.some((e) => e.event === 'gameEnd'); seq++) {
		last = await call(mock, [{ action: 'play' }], `/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`);
		plays.push(last.events);
	}
	if (gid && !last.events.some((e) => e.event === 'gameRoundOver'))
		await call(mock, [{ action: 'collect' }], `/rgs/engine?sid=${sid}&seq=99&gid=${gid}`);
	return plays;
};

const FAIRY = { symbol: 'WILD', reels: [1, 2, 3] };
const CLOVER = { symbol: 'CLOVER', reels: [2], freeSpinReels: [1, 2, 3] };
const ROWS = 4;
const mockOf = (opts = {}) =>
	createMockRgs({
		label: 'wilds',
		quiet: true,
		startBalance: 1e12,
		seed: 'wilds',
		rows: ROWS,
		expandingWilds: { symbols: [FAIRY] },
		growingWild: CLOVER,
		...opts,
	});

/** Each spin of `plays`: its landed board, its rewrite events and its wins, in wire order. */
const spinsOf = (plays) =>
	plays.flatMap((events) => {
		const spins = [];
		let spin = null;
		for (const e of events) {
			if (e.event === 'spinStart')
				spins.push((spin = { order: [], sets: [], wins: [], parents: [] }));
			if (!spin) continue;
			spin.order.push(e.event);
			if (e.event === 'playedSpin') spin.landed = e.context;
			if (e.event === 'spinWin') spin.wins.push(e.context);
			if (e.event === 'expandedWild' || e.event === 'growingWild')
				spin.parents.push({ ...e, sets: [] });
			if (e.event === 'symbolSetInMatrix') spin.parents.at(-1)?.sets.push(e.context);
		}
		return spins;
	});
const finalBoard = (spin) => {
	const board = spin.landed.map((reel) => [...reel]);
	for (const p of spin.parents) for (const s of p.sets) board[s.reel][s.row] = s.symbol;
	return board;
};

// ---------------------------------------------------------------------------------------------
console.log('\n1. the grow pattern: the mock and game-config agree, at every cell');
{
	const boards = [
		[5, 5, 5, 5, 5],
		[4, 4, 4, 4, 4],
		[3, 4, 5, 4, 3],
	];
	let cells = 0;
	const differ = [];
	for (const rows of boards)
		for (const pattern of GROWING_WILD_PATTERNS)
			rows.forEach((height, reel) => {
				for (let row = 0; row < height; row++) {
					const a = JSON.stringify(growCells({ reel, row }, pattern, rows));
					const b = JSON.stringify(mockGrowCells({ reel, row }, pattern, rows));
					cells++;
					if (a !== b) differ.push(`${pattern} ${reel}:${row}`);
				}
			});
	check(differ.length === 0, `equal on ${cells} origins`, differ.length ? ` (${differ[0]})` : '');
}

// ---------------------------------------------------------------------------------------------
console.log('\n2. the mock: land → expand → grow → count');
{
	const mock = mockOf({ forceWilds: true });
	const spins = [];
	for (let r = 0; r < 150; r++) spins.push(...spinsOf(await playRound(mock, 's')));
	const has = (spin, name) => spin.order.includes(name);
	const missing = spins.filter((s) => !has(s, 'expandedWild') || !has(s, 'growingWild'));
	check(missing.length === 0, 'forced: every spin expands and grows', ` (${spins.length} spins)`);
	const ordered = spins.every((s) => {
		const at = (name) => s.order.indexOf(name);
		const lastRewrite = Math.max(
			...['expandedWild', 'growingWild', 'symbolSetInMatrix'].map((n) => s.order.lastIndexOf(n)),
		);
		const firstWin = at('spinWin');
		return (
			at('expandedWild') < at('growingWild') &&
			s.order.lastIndexOf('expandedWild') < at('growingWild') &&
			(firstWin < 0 || lastRewrite < firstWin)
		);
	});
	check(ordered, 'expansions first, then the grow, all before any win');
	const fullReels = spins.every((s) =>
		s.parents
			.filter((p) => p.event === 'expandedWild')
			.every((p) => {
				const reel = s.landed[p.context.reel];
				const rows = p.sets.map((c) => c.row).join();
				const expected = reel
					.flatMap((cell, row) => (cell === 'SCAT' || cell === 'CLOVER' ? [] : [row]))
					.join();
				return (
					FAIRY.reels.includes(p.context.reel) &&
					rows === expected &&
					p.sets.every((c) => c.reel === p.context.reel && c.symbol === 'WILD') &&
					p.sets.find((c) => c.row === p.context.row)?.oldSymbol === 'WILD'
				);
			}),
	);
	check(
		fullReels,
		'each expansion sets every cell of its reel but a scatter or a clover, the origin included',
	);
	const grows = spins.every((s) => {
		const board = s.landed.map((reel) => [...reel]);
		for (const p of s.parents) {
			if (p.event === 'growingWild') {
				const { reel, row } = p.context;
				const allowed = growCells(
					{ reel, row },
					'plus',
					s.landed.map((c) => c.length),
				).map((c) => `${c.reel}:${c.row}`);
				const ok = p.sets.every(
					(c) =>
						allowed.includes(`${c.reel}:${c.row}`) &&
						c.oldSymbol === board[c.reel][c.row] &&
						c.oldSymbol !== 'SCAT' &&
						c.oldSymbol !== 'CLOVER',
				);
				if (!ok || !CLOVER.reels.concat(CLOVER.freeSpinReels).includes(reel)) return false;
			}
			for (const c of p.sets) board[c.reel][c.row] = c.symbol;
		}
		return true;
	});
	check(grows, 'each grow sets only plus cells on the board, never a scatter or a clover');
	const overwritesFairy = spins.some((s) =>
		s.parents.some((p) => p.event === 'growingWild' && p.sets.some((c) => c.oldSymbol === 'WILD')),
	);
	check(overwritesFairy, 'a grow overwrites an expanded fairy');
	const scatters = spins.every(
		(s) =>
			finalBoard(s)
				.flat()
				.filter((c) => c === 'SCAT').length === s.landed.flat().filter((c) => c === 'SCAT').length,
	);
	check(scatters, 'no scatter is ever overwritten');
	const paylines = (await call(mock, [], '/rgs/engine?sid=p&seq=0')).events.find(
		(e) => e.event === 'config',
	).context.paylines;
	const priced = spins.every((s) => {
		const expected = evaluatePaylines(finalBoard(s), 1, paylines, null, {
			landingWilds: ['WILD', 'CLOVER'],
		}).map((w) => `${w.context.paylineId}:${w.what}:${w.occurs}`);
		const paid = s.wins
			.filter((w) => w.mode === 'line')
			.map((w) => `${w.context.paylineId}:${w.what}:${w.occurs}`);
		return JSON.stringify(expected) === JSON.stringify(paid);
	});
	check(priced, 'the line wins are exactly those of the final board');
	const landed = spins.every((s) =>
		s.landed.every((reel, i) => reel.every((c) => c !== 'WILD' || FAIRY.reels.includes(i))),
	);
	check(landed, 'the fairy lands only on its reels');
}

// ---------------------------------------------------------------------------------------------
console.log('\n3. the mock: rates, free spins, and onlyOnWin');
{
	const mock = mockOf();
	let spins = 0;
	let expansions = 0;
	let grows = 0;
	for (let r = 0; r < 1500; r++) {
		for (const s of spinsOf(await playRound(mock, 'rate'))) {
			spins++;
			expansions += s.parents.some((p) => p.event === 'expandedWild') ? 1 : 0;
			grows += s.parents.some((p) => p.event === 'growingWild') ? 1 : 0;
		}
	}
	const pct = (n) => (100 * n) / spins;
	console.log(`      ${spins} spins: fairy on ${pct(expansions).toFixed(1)}%, clover on ${pct(grows).toFixed(1)}%`); // prettier-ignore
	check(pct(expansions) > 5 && pct(expansions) < 14, 'the fairy expands on about 9% of spins');
	check(pct(grows) > 8 && pct(grows) < 16, 'the clover grows on about 12% of spins');

	const fs = mockOf({ forceWilds: true, forceTrigger: true });
	const fsSpins = spinsOf((await playRound(fs, 'fs')).slice(1));
	const fsReels = new Set(
		fsSpins.flatMap((s) =>
			s.parents.filter((p) => p.event === 'growingWild').map((p) => p.context.reel),
		),
	);
	check(
		fsSpins.length > 0 &&
			[...fsReels].every((r) => CLOVER.freeSpinReels.includes(r)) &&
			fsReels.size > 1,
		'in free spins the clover lands on its free-spin reels',
		` (${[...fsReels].sort()})`,
	);

	const won = mockOf({ forceWilds: true, expandingWilds: { symbols: [FAIRY], onlyOnWin: true } });
	let kept = 0;
	let skipped = 0;
	let wrong = 0;
	const config = (await call(won, [], '/rgs/engine?sid=c&seq=0')).events[0].context;
	for (let r = 0; r < 200; r++) {
		for (const s of spinsOf(await playRound(won, 'won'))) {
			const expanded = new Set(
				s.parents.filter((p) => p.event === 'expandedWild').map((p) => p.context.reel),
			);
			const paid = new Set(
				evaluatePaylines(s.landed, 1, config.paylines, null, {
					landingWilds: ['WILD', 'CLOVER'],
				}).flatMap((w) =>
					w.context.payline.slice(0, w.occurs).map((row, reel) => `${reel}:${row}`),
				),
			);
			s.landed.forEach((reel, i) => {
				const onWin = reel.some((c, row) => c === 'WILD' && paid.has(`${i}:${row}`));
				if (!reel.includes('WILD')) return;
				if (onWin !== expanded.has(i)) wrong++;
				else if (onWin) kept++;
				else skipped++;
			});
		}
	}
	check(wrong === 0 && kept > 0 && skipped > 0, 'onlyOnWin: a fairy expands exactly when it is on a winning line of the landed board', ` (${kept} expanded, ${skipped} not)`); // prettier-ignore
}

// ---------------------------------------------------------------------------------------------
console.log('\n4. the rewrite is null without the blocks: no extra draw');
{
	let draws = 0;
	const rewrite = createWildRewrite({
		rowHeights: [3, 3, 3],
		rand: () => (draws++, 0.5),
		pick: () => 'X',
		protect: () => false,
	});
	check(rewrite === null && draws === 0, 'no block ⇒ null');
	check(
		createWildRewrite({
			expandingWilds: { symbols: [{ symbol: 'W', reels: [9] }] },
			rowHeights: [3, 3, 3],
			rand: () => 0,
			pick: () => 'X',
			protect: () => false,
		}) === null,
		'a wild with no reel on the board ⇒ null',
	);
}

// ---------------------------------------------------------------------------------------------
console.log('\n5. the facade: expandWild / growWild between the board and its wins');
const presented = async (make, label, rounds) => {
	const mock = make();
	const server = createServer((req, res) => mock.handle(req, res, new URL(req.url, 'http://x')));
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const rgsUrl = `http://127.0.0.1:${server.address().port}`;
	const out = [];
	await silently(async () => {
		await facade.requestAuthenticate({ rgsUrl, sessionID: label, language: 'en' });
		for (let r = 0; r < rounds; r++) {
			const bet = await facade.requestBet({
				rgsUrl,
				sessionID: label,
				currency: 'USD',
				mode: 'BASE',
				amount: 1,
			});
			out.push({ state: bet.round?.state ?? [], raw: bet._raw?.events ?? [] });
			await facade.requestEndRound({ rgsUrl, sessionID: label });
		}
	});
	server.close();
	return out;
};
{
	const rounds = await presented(() => mockOf({ forceWilds: true, seed: 'facade' }), 'f-wilds', 60);
	const bad = [];
	let expands = 0;
	let growsSeen = 0;
	let wins = 0;
	for (const { state, raw } of rounds) {
		// Engine order per spin: reveal, then its expandWilds, then at most one growWild, then wins.
		const types = state.map((e) => e.type).join(' ');
		if (!/^(reveal( expandWild)+( growWild)?( winInfo)*)/.test(types)) bad.push(types);
		let board = [];
		let firstBoard = null;
		for (const e of state) {
			if (e.type === 'reveal') board = e.board.map((reel) => reel.map((c) => c.name));
			if (e.type === 'expandWild') {
				expands++;
				if (e.symbol !== 'W' || board[e.reel][e.row] !== 'W')
					bad.push(`expand origin ${JSON.stringify(e)}`);
				for (const c of e.cells) board[c.reel][c.row] = e.symbol;
			}
			if (e.type === 'growWild') {
				growsSeen++;
				if (e.symbol !== 'CLOVER' || board[e.origin.reel][e.origin.row] !== 'CLOVER')
					bad.push(`grow origin ${JSON.stringify(e)}`);
				for (const c of e.cells) board[c.reel][c.row] = e.symbol;
			}
			if (e.type === 'winInfo') {
				firstBoard ??= board;
				for (const w of e.wins.filter((x) => x.symbol !== 'S')) {
					wins++;
					const cells = w.positions.slice(0, w.kind).map((p) => board[p.reel][p.row]);
					if (!cells.every((c) => c === w.symbol || c === 'W' || c === 'CLOVER'))
						bad.push(`win ${w.symbol}×${w.kind} on ${cells}`);
				}
			}
		}
		// The engine's final board is the server's.
		const served = finalBoard(spinsOf([raw])[0]);
		const engine = (firstBoard ?? board).map((reel) =>
			reel.slice(1, -1).map((c) => (c === 'W' ? 'WILD' : c)),
		);
		const mapped = served.map((reel) =>
			reel.map((c) => (c === 'WILD' || c === 'CLOVER' || c === 'SCAT' ? c : 'x')),
		);
		const mine = engine.map((reel) =>
			reel.map((c) =>
				c === 'WILD' || c === 'CLOVER' || c === 'S' ? (c === 'S' ? 'SCAT' : c) : 'x',
			),
		);
		const oneSpin = state.filter((e) => e.type === 'reveal').length === 1;
		if (oneSpin && JSON.stringify(mapped) !== JSON.stringify(mine)) bad.push('final board differs');
		// The money: the round's win in book amount is the server's.
		const bet = raw.find((e) => e.event === 'bet').context;
		const end = raw.find((e) => e.event === 'gameEnd').context.win;
		const final = state.findLast((e) => e.type === 'setTotalWin' || e.type === 'finalWin');
		const sumWins = state.filter((e) => e.type === 'winInfo').at(-1)?.totalWin ?? 0;
		const expected = Math.round((end / (bet.betPerLine * bet.paylines.length)) * 100);
		if (final && final.amount !== expected) bad.push(`money ${final.amount} vs ${expected}`);
		if (Math.abs(sumWins - expected) > state.filter((e) => e.type === 'winInfo').length)
			bad.push(`wins ${sumWins} vs ${expected}`);
	}
	check(bad.length === 0, 'order, origins, final board, win cells and money all agree', bad.length ? `\n      ${bad.slice(0, 3).join('\n      ')}` : ''); // prettier-ignore
	check(expands > 0 && growsSeen > 0 && wins > 0, 'with expansions, grows and wins to check', ` (${expands} / ${growsSeen} / ${wins})`); // prettier-ignore

	const plain = await presented(
		() => createMockRgs({ label: 'plain', quiet: true, seed: 'wilds', startBalance: 1e12 }),
		'f-plain',
		30,
	);
	check(
		plain.every((r) => !r.state.some((e) => e.type === 'expandWild' || e.type === 'growWild')),
		'a game without the blocks gets neither event',
	);
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
