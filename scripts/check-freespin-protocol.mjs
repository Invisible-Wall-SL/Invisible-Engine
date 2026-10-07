// End-to-end check of the SCAT free-spin feature in the shared (non-book) mock RGS: boot a real
// mock instance over HTTP, drive it exactly the way `engineFacade` does, and assert the round
// lifecycle a client actually receives.
//
//   node scripts/check-freespin-protocol.mjs
//
// Why over HTTP rather than calling the handler: the part that silently breaks is the ROUND, not
// the board. `gameEnd` emitted one spin early closes the feature mid-way; `gameEnd` never emitted
// hangs the facade's drive loop forever (it keeps POSTing `play` until it sees one). Neither is
// visible from a single response — only from playing the round to its end.

import { createServer, request } from 'node:http';

import { createMockRgs } from './mock-rgs-server.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};

/** One booted mock behind a real HTTP server, plus the `post` the facade would make. */
const boot = async (opts) => {
	const mock = createMockRgs({ label: 'fs-check', seed: 'freespin-protocol-check', ...opts });
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url, 'http://127.0.0.1')),
	);
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	// node:http rather than fetch: undici's keep-alive pool trips a libuv assert at teardown on
	// Windows, which prints "Assertion failed" after a PASSING run and reads as a crash.
	const post = (path, body) =>
		new Promise((resolve, reject) => {
			const payload = JSON.stringify(body);
			const req = request(
				{
					host: '127.0.0.1',
					port: server.address().port,
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
					res.on('end', () => {
						try {
							resolve(JSON.parse(text));
						} catch {
							resolve(null);
						}
					});
				},
			);
			req.on('error', reject);
			req.end(payload);
		});
	return { post, close: () => new Promise((r) => server.close(r)) };
};

const names = (resp) => (resp?.events ?? []).map((e) => e.event);
const ev = (resp, name) => (resp?.events ?? []).find((e) => e.event === name);

/**
 * Play one round to completion the way the facade does: `bet`+`play` opens it, then `play` again
 * for as long as the round stays open, then `collect`. `seq` is a POSITION in the round's stored
 * action array (see docs/reference/play4fun-protocol.md), so it advances by the number of stored
 * actions posted — two for the opening request, one per free spin.
 */
const playRound = async (post, sid) => {
	const spins = [];
	let seq = 0;
	let resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}`, [
		{ action: 'bet', context: [20, 1] },
		{ action: 'play', context: null },
	]);
	seq += 2;
	spins.push(resp);
	const gid = resp?.platform?.gameRound?.id;
	let guard = 0;
	while (!ev(resp, 'gameEnd') && guard++ < 200) {
		// Exactly what `engineFacade`'s drive loop posts — a bare `play` with NO context. Worth
		// mirroring: a bare context is the AUTO-COLLECT signal in the base game, so a free spin that
		// fell through to the base path would close the round here rather than continue the feature.
		resp = await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'play' }]);
		seq += 1;
		spins.push(resp);
	}
	const hung = guard >= 200;
	const collect = ev(resp, 'gameRoundOver')
		? resp
		: await post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]);
	return { spins, collect, hung };
};

console.log('\n§1 — a forced trigger opens the feature and runs it to the end');
{
	const { post, close } = await boot({ forceTrigger: true, startBalance: 1_000_000 });
	const auth = await post('/wallet/authenticate', { sessionID: 'demo' });
	const sid = auth?.sid ?? 'demo';
	const { spins, collect, hung } = await playRound(post, sid);

	check(!hung, 'the round terminates (a `gameEnd` arrives)');
	const trigger = spins[0];
	check(!!ev(trigger, 'spinTrigger'), 'the trigger spin emits `spinTrigger`');
	check(!!ev(trigger, 'enterBonus'), 'the trigger spin emits `enterBonus`');
	check(!ev(trigger, 'gameEnd'), 'the trigger spin does NOT end the round');
	check(!ev(trigger, 'gameRoundOver'), 'the trigger spin does NOT close the round');
	check(
		!spins.some((s) => ev(s, 'pickRandomly')),
		'no `pickRandomly` — this is not a book-of game, there is no expanding special',
	);

	const counters = spins.map((s) => ev(s, 'playedBonusSpin')?.context).filter(Boolean);
	check(counters.length === 10, 'ten free spins play', ` (${counters.length})`);
	const last = counters.at(-1);
	check(
		last?.played === 10 && last?.left === 0,
		'the counter ends played=10 left=0',
		` (${JSON.stringify({ played: last?.played, left: last?.left })})`,
	);
	check(
		counters.every((c, i) => c.played === i + 1 && c.left === 10 - (i + 1)),
		'the counter decrements by exactly one per spin',
	);
	check(
		spins.filter((s) => ev(s, 'gameEnd')).length === 1,
		'exactly ONE `gameEnd` in the whole round',
	);
	check(!!ev(spins.at(-1), 'playedBonusSpins'), 'the last free spin emits `playedBonusSpins`');

	const roundWin = ev(spins.at(-1), 'gameEnd')?.context?.win ?? 0;
	const over = ev(collect, 'gameRoundOver');
	check(!!over, 'the collect closes the round');
	check(
		over?.context?.win === roundWin,
		'the collect pays the accumulated round win',
		` (${roundWin})`,
	);
	const paid = spins.reduce(
		(sum, s) =>
			sum +
			(s.events ?? []).filter((e) => e.event === 'spinWin').reduce((a, e) => a + e.context.pay, 0),
		0,
	);
	check(
		paid === roundWin,
		'the round win equals the sum of every `spinWin`',
		` (${paid} vs ${roundWin})`,
	);
	check(
		spins.slice(1).every((s) => names(s).includes('bonusWin') === names(s).includes('spinWin')),
		'every free-spin win is mirrored by a `bonusWin`',
	);
	await close();
}

console.log('\n§2 — a retrigger extends the round, it does not restart it');
{
	// FORCE_TRIGGER only forces the BASE spin, so free spins deal normally and retrigger by chance.
	// Play rounds until one retriggers; the seed makes this deterministic.
	const { post, close } = await boot({ forceTrigger: true, startBalance: 100_000_000 });
	const auth = await post('/wallet/authenticate', { sessionID: 'demo' });
	const sid = auth?.sid ?? 'demo';
	let found = null;
	let rounds = 0;
	for (let i = 0; i < 40 && !found; i++) {
		rounds++;
		const round = await playRound(post, sid);
		if (round.spins.some((s) => ev(s, 'retrigger'))) found = round;
		if (round.hung) break;
	}
	check(!!found, 'a retrigger occurs within 40 forced rounds', ` (took ${rounds})`);
	if (found) {
		const retriggers = found.spins.filter((s) => ev(s, 'retrigger')).length;
		const counters = found.spins.map((s) => ev(s, 'playedBonusSpin')?.context).filter(Boolean);
		check(
			counters.length === 10 + 5 * retriggers,
			'each retrigger adds exactly five spins',
			` (${retriggers} retrigger(s) ⇒ ${counters.length} spins)`,
		);
		check(counters.at(-1)?.left === 0, 'the extended round still runs down to left=0');
		check(found.spins.filter((s) => ev(s, 'gameEnd')).length === 1, 'still exactly ONE `gameEnd`');
		const retrigger = found.spins.map((s) => ev(s, 'retrigger')).find(Boolean)?.context;
		check(
			retrigger?.total ===
				retrigger?.left + counters.findIndex((c) => c.left === retrigger?.left) + 1,
			'the retrigger reports a total consistent with played+left',
			` (total=${retrigger?.total} left=${retrigger?.left})`,
		);
	}
	await close();
}

console.log('\n§3 — parity: an unforced game still closes a non-triggering round in one request');
{
	const { post, close } = await boot({ startBalance: 10_000_000 });
	const auth = await post('/wallet/authenticate', { sessionID: 'demo' });
	const sid = auth?.sid ?? 'demo';
	let triggered = 0;
	let malformed = 0;
	let rounds = 0;
	for (let i = 0; i < 80; i++) {
		rounds++;
		const round = await playRound(post, sid);
		if (round.hung) malformed++;
		const opened = round.spins.some((s) => ev(s, 'spinTrigger'));
		if (opened) triggered++;
		// Every round, triggering or not, must end with exactly one gameEnd and a closed round.
		if (round.spins.filter((s) => ev(s, 'gameEnd')).length !== 1) malformed++;
		if (!ev(round.collect, 'gameRoundOver')) malformed++;
		if (!opened && round.spins.length !== 1) malformed++;
	}
	check(malformed === 0, 'no malformed round in 80 plays', ` (${malformed})`);
	check(triggered > 0, 'the feature triggers naturally too', ` (${triggered}/${rounds} rounds)`);
	await close();
}

console.log('\n§4 — a project with no SCAT in play never enters the feature');
{
	// The feature is self-gating on the project's own symbol set: `scatterEnabled` is false when a
	// restricted pool omits SCAT, so the deal never produces one and the count is always 0. This is
	// what keeps a game that has no scatter from suddenly growing free spins.
	const { post, close } = await boot({
		startBalance: 10_000_000,
		symbols: ['PIC1', 'PIC2', 'PIC3', 'PIC4'],
	});
	const auth = await post('/wallet/authenticate', { sessionID: 'demo' });
	const sid = auth?.sid ?? 'demo';
	let triggered = 0;
	let scatCells = 0;
	for (let i = 0; i < 60; i++) {
		const round = await playRound(post, sid);
		if (round.spins.some((s) => ev(s, 'spinTrigger'))) triggered++;
		for (const s of round.spins) {
			const board = ev(s, 'playedSpin')?.context ?? [];
			scatCells += board.flat().filter((c) => c === 'SCAT').length;
		}
	}
	check(scatCells === 0, 'no SCAT is ever dealt', ` (${scatCells})`);
	check(triggered === 0, 'the feature never opens', ` (${triggered})`);
	await close();
}

console.log('\n§5 — a free spin is scored by the GAME’s win model, not by paylines');
{
	// The failure this pins: a free-spin path that reaches for `evaluatePaylines` directly instead of
	// going through `evaluatePayWins` → `payoutBaseFor` (#405). On a `ways` game — which authors NO
	// paylines, so the mock declares none — that mistake scores every free spin against an empty
	// line set and pays NOTHING but the SCAT. The round still settles perfectly: `finalWin` and
	// `payoutMultiplier` both derive from `gameEnd.win`, so `check:stake` stays green while the
	// feature quietly pays a fraction of what the game owes. Only counting the wins catches it.
	const { post, close } = await boot({
		forceTrigger: true,
		startBalance: 100_000_000,
		winModel: 'ways',
		reels: 5,
		rows: 3,
		paylines: [],
	});
	const auth = await post('/wallet/authenticate', { sessionID: 'demo' });
	const sid = auth?.sid ?? 'demo';
	let waysWins = 0;
	let freeSpins = 0;
	for (let i = 0; i < 10; i++) {
		const { spins } = await playRound(post, sid);
		// Free spins only — the base/trigger spin is scored by the same path either way.
		for (const s of spins.slice(1)) {
			if (!ev(s, 'playedBonusSpin')) continue;
			freeSpins++;
			waysWins += (s.events ?? []).filter(
				(e) => e.event === 'spinWin' && e.context?.mode === 'ways',
			).length;
		}
	}
	check(freeSpins >= 100, 'the ten forced rounds played their free spins', ` (${freeSpins})`);
	check(waysWins > 0, 'free spins pay the model’s OWN wins, not zero', ` (${waysWins} ways wins)`);
	await close();
}

/** The base board a round was dealt (its first `playedSpin`), and how many of `symbol` it holds. */
const baseBoard = (round) => ev(round.spins[0], 'playedSpin')?.context ?? [];
const countOn = (board, symbol) => board.flat().filter((cell) => cell === symbol).length;

console.log('\n§6 — free spins OFF: scatters land and pay, the feature never opens');
{
	// The project's Game Config turned free spins off (`freeSpins: false`). FORCE_TRIGGER is on too,
	// because it is the strongest push toward the feature this mock has: if it cannot open the
	// feature, nothing can.
	const { post, close } = await boot({
		forceTrigger: true,
		freeSpins: false,
		startBalance: 100_000_000,
		quiet: true,
	});
	const sid = (await post('/wallet/authenticate', { sessionID: 'demo' }))?.sid ?? 'demo';
	let opened = 0;
	let malformed = 0;
	let scatterBoards = 0;
	let unpaidScatterBoards = 0;
	for (let i = 0; i < 300; i++) {
		const round = await playRound(post, sid);
		if (round.spins.some((s) => ev(s, 'spinTrigger') || ev(s, 'enterBonus'))) opened++;
		if (round.hung || round.spins.length !== 1 || !ev(round.spins[0], 'gameEnd')) malformed++;
		if (!ev(round.collect, 'gameRoundOver')) malformed++;
		if (countOn(baseBoard(round), 'SCAT') >= 3) {
			scatterBoards++;
			const paid = (round.spins[0].events ?? []).some(
				(e) => e.event === 'spinWin' && e.context?.what === 'SCAT' && e.context.pay > 0,
			);
			if (!paid) unpaidScatterBoards++;
		}
	}
	check(opened === 0, 'no `spinTrigger` / `enterBonus` in 300 forced rounds', ` (${opened})`);
	check(malformed === 0, 'every round ends in its one request and closes', ` (${malformed})`);
	check(scatterBoards > 0, 'boards with 3+ SCAT still land', ` (${scatterBoards})`);
	check(
		unpaidScatterBoards === 0,
		'…and every one pays its scatter pay',
		` (${unpaidScatterBoards})`,
	);
	await close();
}

console.log('\n§7 — free spins OFF: a bought option is refused, not charged for a base spin');
{
	const { post, close } = await boot({
		freeSpins: false,
		startBalance: 1_000_000,
		quiet: true,
		betModes: [
			{ mode: 'base', cost: 1, kind: 'base' },
			{ mode: 'bonus', cost: 100, kind: 'buy' },
		],
	});
	const sid = (await post('/wallet/authenticate', { sessionID: 'demo' }))?.sid ?? 'demo';
	const config = await post(`/rgs/engine?sid=${sid}&seq=0`, [{ action: 'config' }]);
	const before = config?.platform?.balance;
	check(before === 1_000_000, 'the table game was told its config', ` (${before})`);
	const buy = await post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [1, 1] },
		{ action: 'play', context: null },
	]);
	check(buy?.result === 0 && buy?.errorCode === 101, 'the buy is refused as an invalid bet');
	check(
		buy?.platform?.balance === before,
		'…and nothing is charged',
		` (${buy?.platform?.balance})`,
	);
	const base = await post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [0, 1] },
		{ action: 'play', context: '' },
	]);
	check(!!ev(base, 'gameRoundOver'), 'the base option still plays and closes');
	await close();
}

console.log(
	'\n§8 — a custom trigger: the forced feature opens on THAT symbol, counted to its minimum',
);
{
	for (const [symbol, count] of [
		['PIC1', 4],
		// More than the five reels: the forced trigger has to go round the board again to reach it.
		['PIC2', 7],
	]) {
		const { post, close } = await boot({
			forceTrigger: true,
			freeSpinsTrigger: { symbol, count },
			startBalance: 100_000_000,
			quiet: true,
		});
		const sid = (await post('/wallet/authenticate', { sessionID: 'demo' }))?.sid ?? 'demo';
		let rounds = 0;
		let short = 0;
		let wrongRule = 0;
		for (let i = 0; i < 10; i++) {
			const round = await playRound(post, sid);
			rounds++;
			const trigger = ev(round.spins[0], 'spinTrigger')?.context;
			const entered = ev(round.spins[0], 'enterBonus')?.context;
			if (countOn(baseBoard(round), symbol) < count) short++;
			if (
				trigger?.trigger?.of !== symbol ||
				trigger?.trigger?.occurs?.[0] !== count ||
				trigger?.occurs < count ||
				entered?.trigger?.of !== symbol
			) {
				wrongRule++;
			}
		}
		check(
			short === 0,
			`every forced board holds ${count}+ ${symbol}`,
			` (${short}/${rounds} short)`,
		);
		check(wrongRule === 0, `\`spinTrigger\` / \`enterBonus\` name ${symbol} ×${count}`);
		await close();
	}
}

console.log('\n§9 — a custom trigger: three scatters no longer open the feature, the symbol does');
{
	const symbol = 'PIC1';
	const count = 4;
	const { post, close } = await boot({
		freeSpinsTrigger: { symbol, count },
		startBalance: 100_000_000,
		quiet: true,
	});
	const sid = (await post('/wallet/authenticate', { sessionID: 'demo' }))?.sid ?? 'demo';
	let disagree = 0;
	let scatterOnly = 0;
	let opened = 0;
	let badRetrigger = 0;
	for (let i = 0; i < 400; i++) {
		const round = await playRound(post, sid);
		const board = baseBoard(round);
		const triggered = round.spins.some((s, n) => n === 0 && ev(s, 'spinTrigger'));
		if (triggered) opened++;
		if (triggered !== countOn(board, symbol) >= count) disagree++;
		if (countOn(board, 'SCAT') >= 3 && countOn(board, symbol) < count && !triggered) scatterOnly++;
		for (const s of round.spins.slice(1)) {
			const retrigger = ev(s, 'retrigger');
			if (!retrigger) continue;
			const fsBoard = ev(s, 'playedSpin')?.context ?? [];
			if (retrigger.context.occurs < count || countOn(fsBoard, symbol) < count) badRetrigger++;
		}
	}
	check(disagree === 0, `a round opens exactly when ${count}+ ${symbol} land`, ` (${disagree})`);
	check(opened > 0, 'the feature still opens naturally', ` (${opened}/400)`);
	check(
		scatterOnly > 0,
		'a 3+ SCAT board without the symbol does NOT open it',
		` (${scatterOnly})`,
	);
	check(badRetrigger === 0, `a retrigger also needs ${count}+ ${symbol}`, ` (${badRetrigger})`);
	await close();
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
