/**
 * The scatter-triggered FREE-SPIN feature, on the wire.
 *
 *   node scripts/check-free-spins.mjs      (or `pnpm check:freespins`)
 *
 * WHY THIS EXISTS. Until the feature landed, three scatters in a non-book game paid their scatter
 * win and the round closed: only the book-of mock emitted `spinTrigger`/`enterBonus`, so free spins
 * appeared to work in Book of Borut and nowhere else — on an engine whose entire free-spin
 * presentation (intro, the "N OF total" counter, retrigger, outro) had nothing to drive it anywhere
 * else, and therefore no way to be wrong loudly.
 *
 * The assertions are about the ROUND SHAPE, not the maths. A feature round is the one round that
 * spans several `play` posts, and each of these is a way it can silently half-work:
 *
 *   - `gameEnd` must not arrive until the LAST free spin. `engineFacade`'s drive loop keeps posting
 *     `play` until it sees one, so an early `gameEnd` abandons the rest of the feature — which is
 *     exactly what happens if the trigger spin falls through to the base spin's close rules.
 *   - the round stays OPEN across the spins: one `gameRound.id`, one debit, one settlement. The free
 *     spins are FREE.
 *   - a RETRIGGER grows the total BEFORE the counter that reports it, or the panel shows "8 OF 10"
 *     and then jumps to a bigger total a beat later.
 *   - the trigger's scatters ride as positions, or the intro animates nothing.
 *
 * Deliberately RAW-WIRE, with no facade import: the facade consumes this vocabulary generically (it
 * was built for the book mock, and `enterBonus`/`playedBonusSpin`/`retrigger` are the events it
 * already reads), so what needed proving is that this mock now SPEAKS it.
 */

import { createServer } from 'node:http';

import { createMockRgs } from './mock-rgs-server.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};

const startMock = async (opts) => {
	const mock = createMockRgs({ quiet: true, freeSpins: true, startBalance: 100_000_000, ...opts });
	const server = createServer((req, res) => mock.handle(req, res, new URL(req.url, 'http://x')));
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	return { server, rgsUrl: `http://127.0.0.1:${server.address().port}` };
};

const post = async (rgsUrl, sid, seq, body, gid) => {
	const q = `sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`;
	const r = await fetch(`${rgsUrl}/rgs/engine?${q}`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
	});
	return r.json();
};

/**
 * Play one whole round the way the facade does: `bet`+`play`, then keep posting `play` while the
 * round is still open, then `collect`. Returns every event of the round in order.
 *
 * `seq` is a POSITION in the round's stored action array, not a counter — `[bet, play]` advances it
 * by two — so this mirrors the facade rather than inventing its own numbering.
 */
const playRound = async (rgsUrl, sid) => {
	const first = await post(rgsUrl, sid, 0, [
		{ action: 'bet', context: [5, 20] },
		{ action: 'play', context: null },
	]);
	let events = first.events ?? [];
	const gid = first.platform?.gameRound?.id;
	let seq = 2;
	const balances = [first.platform?.balance];
	while (gid && !events.some((e) => e.event === 'gameEnd') && seq < 300) {
		const next = await post(rgsUrl, sid, seq, [{ action: 'play', context: null }], gid);
		events = [...events, ...(next.events ?? [])];
		balances.push(next.platform?.balance);
		seq += 1;
	}
	if (gid && !events.some((e) => e.event === 'gameRoundOver')) {
		const done = await post(rgsUrl, sid, seq, [{ action: 'collect', context: null }], gid);
		events = [...events, ...(done.events ?? [])];
		balances.push(done.platform?.balance);
	}
	return { events, gid, balances, requests: seq - 1 };
};

// ---------------------------------------------------------------------------------------------
// 1. A FORCED trigger. `forceTrigger` enters the feature on every base spin, so this needs one
//    round rather than a hunt.
// ---------------------------------------------------------------------------------------------
console.log('\na forced feature round:');
{
	const { server, rgsUrl } = await startMock({
		label: 'fs',
		seed: 'free-spins-forced',
		forceTrigger: true,
		reels: 5,
		rows: 3,
	});
	const { events, requests } = await playRound(rgsUrl, 'fs-forced');
	server.close();
	const kinds = events.map((e) => e.event);

	check(kinds.includes('spinTrigger'), 'the wire carries a spinTrigger');
	check(kinds.includes('enterBonus'), 'the wire carries an enterBonus');
	check(
		!kinds.includes('pickRandomly'),
		'NO pickRandomly — this game has no expanding special symbol',
	);

	// `gameEnd` is the drive loop's stop signal, so exactly one, and last.
	const gameEnds = kinds.filter((k) => k === 'gameEnd').length;
	check(gameEnds === 1, 'exactly one gameEnd in the whole round', ` (${gameEnds})`);
	check(
		kinds.lastIndexOf('gameEnd') > kinds.lastIndexOf('playedBonusSpin'),
		'gameEnd comes AFTER the last free spin',
	);
	check(kinds.indexOf('gameEnd') > kinds.indexOf('enterBonus'), '...and after the trigger');

	// One debit. The free spins are free.
	const bets = kinds.filter((k) => k === 'bet').length;
	check(bets === 1, 'the round debits exactly once', ` (${bets} bet events)`);
	check(requests > 1, 'the round really did span several requests', ` (${requests} plays)`);

	// Every awarded spin was played, and every one dealt a board.
	const counters = events.filter((e) => e.event === 'playedBonusSpin');
	const boards = kinds.filter((k) => k === 'playedSpin').length;
	check(counters.length >= 10, 'ten or more free spins played', ` (${counters.length})`);
	check(
		boards === counters.length + 1,
		'one board per free spin, plus the trigger board',
		` (${boards} boards, ${counters.length} free spins)`,
	);

	// The counter the panel shows: one per spin, ending on the last of the total.
	check(
		counters.every((c, i) => c.context.played === i + 1),
		'the counter ticks once per spin, in order',
	);
	const last = counters[counters.length - 1]?.context;
	check(!!last && last.left === 0, 'the last spin leaves none', last ? ` (left ${last.left})` : '');
	check(
		counters.every((c, i) => {
			const total = c.context.played + c.context.left;
			const prev = counters[i - 1];
			return i === 0 || total >= prev.context.played + prev.context.left;
		}),
		'the counter total never SHRINKS (a retrigger only grows it)',
	);
	check(kinds.includes('playedBonusSpins'), 'the feature closes with playedBonusSpins');

	// The trigger's scatters must be positions, or the intro animates nothing.
	const trigger = events.find((e) => e.event === 'spinWin' && e.context?.what === 'SCAT');
	check(!!trigger, 'the trigger spin carries a SCAT win');
	check(
		Array.isArray(trigger?.context?.context) && trigger.context.context.length >= 3,
		'the SCAT win carries its cells as a bare array',
		` (${trigger?.context?.context?.length ?? 0})`,
	);

	// The round settles once, for the whole feature.
	const overs = kinds.filter((k) => k === 'gameRoundOver').length;
	check(overs === 1, 'the round settles exactly once', ` (${overs})`);
	const end = events.find((e) => e.event === 'gameEnd')?.context?.win ?? 0;
	const over = events.find((e) => e.event === 'gameRoundOver')?.context?.win ?? 0;
	check(end === over, 'gameEnd and gameRoundOver agree on the round win', ` (${end} vs ${over})`);
}

// ---------------------------------------------------------------------------------------------
// 2. A RETRIGGER grows the total BEFORE the counter that reports it.
// ---------------------------------------------------------------------------------------------
console.log('\na retrigger:');
{
	const { server, rgsUrl } = await startMock({
		label: 'fs-re',
		seed: 'free-spins-retrigger',
		forceTrigger: true,
		reels: 5,
		rows: 3,
	});
	let found = null;
	for (let i = 0; i < 40 && !found; i++) {
		const { events } = await playRound(rgsUrl, `fs-re-${i}`);
		if (events.some((e) => e.event === 'retrigger')) found = events;
	}
	server.close();

	check(!!found, 'a retrigger occurs within 40 forced rounds');
	if (found) {
		const kinds = found.map((e) => e.event);
		const at = kinds.indexOf('retrigger');
		const re = found[at].context;
		check(re.total > 10, 'the retrigger grows the round total past the awarded ten', ` (${re.total})`);
		check(re.spins > 0, 'it awards spins', ` (+${re.spins})`);
		const next = found.slice(at).find((e) => e.event === 'playedBonusSpin');
		check(!!next, 'a counter follows the retrigger');
		check(
			!!next && next.context.played + next.context.left === re.total,
			'that counter already reports the GROWN total',
			next ? ` (${next.context.played} + ${next.context.left} vs ${re.total})` : '',
		);
		const after = kinds.slice(at).filter((k) => k === 'playedBonusSpin').length;
		check(after > 1, 'the extra spins are actually played', ` (${after} after)`);
		check(
			kinds.filter((k) => k === 'gameEnd').length === 1,
			'still exactly one gameEnd, after the retriggered spins',
		);
	}
}

// ---------------------------------------------------------------------------------------------
// 3. PARITY. `freeSpins: false` is the pre-feature mock: a scatter pays and the round closes in one
//    request. Every single-shot harness in the repo relies on that, which is why the switch exists.
// ---------------------------------------------------------------------------------------------
console.log('\nfeature OFF is the old behaviour:');
{
	const { server, rgsUrl } = await startMock({
		label: 'fs-off',
		seed: 'free-spins-off',
		freeSpins: false,
		forceTrigger: true,
		reels: 5,
		rows: 3,
	});
	const d = await post(rgsUrl, 'fs-off', 0, [
		{ action: 'bet', context: [5, 20] },
		{ action: 'play', context: '' },
	]);
	server.close();
	const kinds = (d.events ?? []).map((e) => e.event);
	check(!kinds.includes('spinTrigger'), 'no trigger is emitted');
	check(!kinds.includes('enterBonus'), '...and no bonus is entered');
	check(kinds.includes('gameEnd'), 'the round still ends in the same request');
	check(kinds.includes('gameRoundOver'), '...and still auto-collects');
}

// ---------------------------------------------------------------------------------------------
// 4. A game that took SCAT off its strips has no feature to trigger.
// ---------------------------------------------------------------------------------------------
console.log('\na scatter-less project:');
{
	const { server, rgsUrl } = await startMock({
		label: 'fs-noscat',
		seed: 'free-spins-noscat',
		forceTrigger: true,
		symbols: ['PIC1', 'PIC2', 'PIC3', 'PIC4', 'PIC5'],
		reels: 5,
		rows: 3,
	});
	const d = await post(rgsUrl, 'fs-noscat', 0, [
		{ action: 'bet', context: [5, 20] },
		{ action: 'play', context: '' },
	]);
	server.close();
	const kinds = (d.events ?? []).map((e) => e.event);
	check(!kinds.includes('spinTrigger'), 'no trigger without SCAT in play');
	check(kinds.includes('gameEnd'), 'the round closes normally');
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nfree spins OK');
process.exit(failed ? 1 : 0);
