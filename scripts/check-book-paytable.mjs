// The BOOK mock RGS pays the project's AUTHORED line table (`symbolPaytable`, handed over by the
// Invisible Test Server from the project's live mock contract) and declares that same table in its
// boot `config` event — so the info page and the payouts cannot disagree.
//
//   node scripts/check-book-paytable.mjs
//
// Every run below plays the SAME seeded deal (the RNG never depends on the paytable), so two runs
// differ only in what the table changes. The book mock is the live payout math for the published
// Book of Borut remake, whose authored table is exactly the captured one: §1 is that parity.

import { EventEmitter } from 'node:events';

import { createMockRgs } from './mock-rgs-server-book.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};

/** The captured Book of Thermopylae line table — what Borut's `/config` authors today. */
const CAPTURED = {
	PIC1: { 2: 10, 3: 100, 4: 1000, 5: 5000 },
	PIC2: { 2: 10, 3: 30, 4: 400, 5: 2000 },
	PIC3: { 2: 5, 3: 30, 4: 100, 5: 750 },
	PIC4: { 2: 5, 3: 20, 4: 100, 5: 750 },
	ACE: { 3: 5, 4: 50, 5: 150 },
	KING: { 3: 5, 4: 50, 5: 150 },
	QUEEN: { 3: 5, 4: 20, 5: 100 },
	JACK: { 3: 5, 4: 20, 5: 100 },
	TEN: { 3: 5, 4: 20, 5: 100 },
};

/** A table as the manifest/contract delivers it: JSON, so every count key is a STRING. */
const asContract = (table) => JSON.parse(JSON.stringify(table));
const mapRows = (table, fn) =>
	Object.fromEntries(
		Object.entries(table).map(([sym, row]) => [
			sym,
			Object.fromEntries(Object.entries(row).map(([n, v]) => [n, fn(v)])),
		]),
	);

/** The lines mock's rule, restated so the check is independent of the code under test. */
const payCents = (amount) => (amount > 0 ? Math.max(1, Math.round(amount)) : 0);

/** One POST through the mock's own `handle`, with no socket — the handler reads a request stream
 *  and writes one JSON response, which is all a fake needs to provide. */
const post = (mock, path, body) =>
	new Promise((resolve, reject) => {
		const req = Object.assign(new EventEmitter(), { method: 'POST', headers: {} });
		const res = {
			writeHead: () => {},
			end: (text) => resolve(JSON.parse(text)),
		};
		mock.handle(req, res, new URL(path, 'http://mock')).catch(reject);
		setImmediate(() => {
			req.emit('data', Buffer.from(JSON.stringify(body)));
			req.emit('end');
		});
	});

const ev = (resp, name) => (resp?.events ?? []).find((e) => e.event === name);

/** Play one round to its end the way `engineFacade` does (bet+play, `play` until `gameEnd`,
 *  `collect` if still open). `seq` is a stored-action POSITION, hence +2 then +1 per request. */
const playRound = async (mock, sid, betPerLine) => {
	const responses = [];
	let seq = 0;
	let resp = await post(mock, `/rgs/engine?sid=${sid}&seq=${seq}`, [
		{ action: 'bet', context: [0, betPerLine] },
		{ action: 'play', context: null },
	]);
	seq += 2;
	responses.push(resp);
	const gid = resp?.platform?.gameRound?.id;
	for (let guard = 0; !ev(resp, 'gameEnd') && guard < 200; guard++) {
		resp = await post(mock, `/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'play' }]);
		seq += 1;
		responses.push(resp);
	}
	if (!ev(resp, 'gameRoundOver'))
		responses.push(
			await post(mock, `/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]),
		);
	const bet = ev(responses[0], 'bet')?.context;
	const special = ev(responses[0], 'pickRandomly')?.context?.item?.state ?? null;
	return { responses, betPerLine: bet?.betPerLine, total: bet?.total, special };
};

const BETS = [1, 2, 3, 7, 10];

/** The declared config + a seeded batch of base rounds and forced free-spin rounds. */
const play = async (symbolPaytable) => {
	const log = console.log;
	console.log = () => {};
	try {
		const make = (forceTrigger) =>
			createMockRgs({
				label: 'book-paytable-check',
				seed: 'book-paytable-check',
				startBalance: 1_000_000_000,
				forceTrigger,
				bigWin: false,
				autoCollect: true,
				...(symbolPaytable ? { symbolPaytable } : {}),
			});
		const base = make(false);
		const config = ev(await post(base, '/rgs/engine?sid=fx&seq=0', []), 'config')?.context;
		const rounds = [];
		for (let i = 0; i < 400; i++) rounds.push(await playRound(base, 'fx', BETS[i % BETS.length]));
		const fs = make(true);
		for (let i = 0; i < 60; i++) rounds.push(await playRound(fs, 'fx', BETS[i % BETS.length]));
		return { config, rounds };
	} finally {
		console.log = log;
	}
};

/** The declared `paytable.line` back as `{ SYM: { occurs: pay } }`. */
const declaredLine = (config) =>
	Object.fromEntries(
		(config?.paytable?.line ?? []).map(({ on, pay }) => [
			on.of,
			Object.fromEntries(on.occurs.map((n, i) => [n, pay[i]])),
		]),
	);

/** Every paid `spinWin` with the stake it was quoted against, for pricing checks. */
const winsOf = (run) =>
	run.rounds.flatMap((round) =>
		round.responses.flatMap((r) =>
			(r.events ?? [])
				.filter((e) => e.event === 'spinWin')
				.map((e) => ({ ...e.context, betPerLine: round.betPerLine, total: round.total })),
		),
	);

/** The dealt stream with the random round ids removed — the only non-seeded field. */
const stream = (run) =>
	JSON.stringify(
		run.rounds.map((round) => round.responses.map((r) => [r.events, r.platform?.balance])),
	);

/** Does every win price exactly off `table`? Line wins at `× betPerLine`; the expanding special
 *  (a scatter-mode win of a paying symbol) at `× total stake`; the SCAT trigger at zero. */
const priceErrors = (run, table) =>
	winsOf(run).filter((w) => {
		if (w.what === 'SCAT') return w.pay !== 0;
		const base = w.mode === 'line' ? w.betPerLine : w.total;
		return w.pay !== payCents(Number(table[w.what]?.[w.occurs]) * base);
	});

const specialWins = (run) => winsOf(run).filter((w) => w.mode === 'scatter' && w.what !== 'SCAT');
const lineWins = (run) => winsOf(run).filter((w) => w.mode === 'line');

const roundTotalsAgree = (run) =>
	run.rounds.every((round) => {
		const paid = round.responses
			.flatMap((r) => r.events ?? [])
			.filter((e) => e.event === 'spinWin')
			.reduce((a, e) => a + e.context.pay, 0);
		const end = round.responses.map((r) => ev(r, 'gameEnd')).find(Boolean);
		return end?.context?.win === paid;
	});

const none = await play(undefined);

console.log('\n§1 — no authored table, and a table equal to the captured one, deal the SAME game');
{
	check(
		JSON.stringify(declaredLine(none.config)) === JSON.stringify(asContract(CAPTURED)),
		'with no table the declared `paytable.line` is the captured table',
	);
	check(
		JSON.stringify(none.config?.paytable?.scatter) ===
			JSON.stringify([
				{
					on: { occurs: [3, 4, 5], of: 'SCAT', mode: 'scatter' },
					pay: [2, 20, 200],
					trigger: 'feature',
				},
			]),
		'the declared scatter row is untouched',
	);
	check(priceErrors(none, CAPTURED).length === 0, 'every win prices off the captured table');
	check(
		lineWins(none).length > 100 && specialWins(none).length > 5,
		'the run is not vacuous',
		` (${lineWins(none).length} line wins, ${specialWins(none).length} expanding-special wins)`,
	);
	const borut = await play(asContract(CAPTURED));
	check(
		JSON.stringify(borut.config) === JSON.stringify(none.config),
		'an authored table equal to the captured one declares a byte-identical `config`',
	);
	check(stream(borut) === stream(none), 'and deals a byte-identical stream of events and balances');
}

console.log('\n§2 — a changed table is what the mock declares AND what it pays');
{
	// Every price tripled, and PIC2 reshaped so it no longer pays a 2-of-a-kind at all.
	const tripled = mapRows(CAPTURED, (v) => v * 3);
	tripled.PIC2 = { 3: 77, 4: 777, 5: 7777 };
	const changed = await play(asContract(tripled));
	check(
		JSON.stringify(declaredLine(changed.config)) === JSON.stringify(asContract(tripled)),
		'the declared `paytable.line` is the authored table',
	);
	check(
		priceErrors(changed, tripled).length === 0,
		'every line win and expanding-special win prices off it',
		` (${priceErrors(changed, tripled).length} mispriced)`,
	);
	check(
		!lineWins(changed).some((w) => w.what === 'PIC2' && w.occurs === 2),
		'a count the authored row dropped no longer pays',
	);
	check(
		specialWins(changed).length > 5 &&
			specialWins(changed).every((w) => w.pay === payCents(tripled[w.what][w.occurs] * w.total)),
		'the free-spin expanding special pays its authored row × total stake',
		` (${specialWins(changed).length})`,
	);
	check(roundTotalsAgree(changed), 'each round win is the sum of its spin wins');
	check(stream(changed) !== stream(none), 'the payouts actually moved');
}

console.log('\n§3 — fractional multipliers pay whole cents');
{
	const fractional = mapRows(CAPTURED, (v) => v * 0.037);
	const run = await play(asContract(fractional));
	const wins = winsOf(run);
	check(
		wins.every((w) => Number.isInteger(w.pay)),
		'every win is a whole number of cents',
	);
	check(
		wins.filter((w) => w.what !== 'SCAT').every((w) => w.pay >= 1),
		'a priced win never rounds to nothing (one-cent floor)',
	);
	check(
		wins.some((w) => w.mode === 'line' && fractional[w.what][w.occurs] * w.betPerLine < 1),
		'the floor was actually exercised',
	);
	check(
		priceErrors(run, fractional).length === 0,
		'every pay is the authored price rounded to cents',
	);
	check(
		run.rounds.every((round) =>
			round.responses.every((r) => Number.isInteger(r.platform?.balance ?? 0)),
		),
		'the balance stays whole cents',
	);
	check(roundTotalsAgree(run), 'each round win is the sum of its spin wins');
}

console.log(
	'\n§4 — a special whose row prices nothing at its reel count degrades to a natural board',
);
{
	// Only 5-of-a-kind is priced, so a special covering 2–4 reels passes the expand gate with no
	// price — it must not expand, pay NaN or throw; it pays as an ordinary board.
	const fiveOnly = Object.fromEntries(
		Object.entries(CAPTURED).map(([sym, row]) => [sym, { 5: row[5] }]),
	);
	const run = await play(asContract(fiveOnly));
	const wins = winsOf(run);
	check(
		wins.every((w) => Number.isFinite(w.pay)),
		'no NaN pay',
	);
	check(
		specialWins(run).every((w) => w.occurs === 5),
		'the special only pays scatter-style on a count its row prices',
		` (${specialWins(run).length} special wins)`,
	);
	check(priceErrors(run, fiveOnly).length === 0, 'every win prices off the authored table');
	// The free spins where the special passed the expand gate (PIC1 from 2 reels, the rest from 3)
	// on a reel count its row does not price: each must carry no special win at all.
	const unpriced = run.rounds.flatMap((round) =>
		round.special
			? round.responses.slice(1).filter((r) => {
					const board = ev(r, 'playedSpin')?.context ?? [];
					const covered = board.filter((reel) => reel.includes(round.special)).length;
					return covered >= (round.special === 'PIC1' ? 2 : 3) && covered < 5;
				})
			: [],
	);
	check(unpriced.length > 0, 'the case occurs in the run', ` (${unpriced.length} free spins)`);
	check(
		unpriced.every(
			(r) =>
				!(r.events ?? []).some(
					(e) => e.event === 'spinWin' && e.context.mode === 'scatter' && e.context.what !== 'SCAT',
				),
		),
		'none of them pays the special',
	);
}

console.log(failed ? `\n✗ ${failed} check(s) failed` : '\n✓ all checks passed');
process.exit(failed ? 1 : 0);
