/**
 * Smoke test: drive the mock RGS through a full round lifecycle and report
 * pass/fail on the protocol invariants we care about.
 *
 * Pre-req: mock-rgs-server.mjs running locally.
 *
 * Usage:
 *   node scripts/smoke-mock.mjs                # default port 7777
 *   PORT=7778 node scripts/smoke-mock.mjs      # if mock runs elsewhere
 */

const PORT = Number(process.env.PORT ?? 7777);
const BASE = `http://localhost:${PORT}`;
const SID = `smoke-${Date.now()}`;

const fail = (msg, ctx) => {
	console.error(`✗ FAIL: ${msg}`);
	if (ctx !== undefined) console.error('  ctx:', ctx);
	process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

const post = async (label, query, body) => {
	const url = `${BASE}/rgs/engine?${query}`;
	const res = await fetch(url, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
	const text = await res.text();
	const json = text ? JSON.parse(text) : null;
	console.log(`\n[${label}]`);
	console.log(`  POST ${url}`);
	console.log(`  body: ${JSON.stringify(body)}`);
	console.log(`  status: ${res.status}`);
	console.log(`  events: ${(json?.events ?? []).map((e) => e.event).join(', ') || '(none)'}`);
	console.log(`  balance: ${json?.platform?.balance}`);
	if (json?.platform?.gameRound) console.log(`  gid: ${json.platform.gameRound.id}`);
	return { status: res.status, json };
};

const ev = (resp, name) => resp.json.events.find((e) => e.event === name);

const main = async () => {
	console.log(`smoke test against ${BASE}, sid=${SID}\n`);

	// Sanity: server up
	const health = await fetch(`${BASE}/healthz`).then((r) => r.json()).catch((e) => fail('mock not reachable', e));
	if (!health.ok) fail('healthz did not return ok', health);
	ok('mock reachable');

	// 1. heartbeat
	const r1 = await post('heartbeat', `sid=${SID}&seq=0`, []);
	if (r1.status !== 200) fail('heartbeat status', r1.status);
	if (r1.json.events.length !== 0) fail('heartbeat should return no events', r1.json.events);
	if (typeof r1.json.platform.balance !== 'number') fail('heartbeat missing balance', r1.json.platform);
	const startingBalance = r1.json.platform.balance;
	ok(`heartbeat returned balance=${startingBalance}`);

	// 2. bet+play (manual collect: play.context = null)
	const r2 = await post('bet+play (manual)', `sid=${SID}&seq=0`, [
		{ action: 'bet', context: [5, 2] },
		{ action: 'play', context: null },
	]);
	if (r2.status !== 200) fail('bet+play status', r2.status);
	if (!ev(r2, 'bet')) fail('missing bet event', r2.json.events);
	if (!ev(r2, 'gameStart')) fail('missing gameStart event');
	if (!ev(r2, 'spinStart')) fail('missing spinStart event');
	if (!ev(r2, 'playedSpin')) fail('missing playedSpin event');
	if (!ev(r2, 'gameEnd')) fail('missing gameEnd event');
	if (ev(r2, 'gameRoundOver')) fail('manual collect should NOT include gameRoundOver yet');

	const gid = r2.json.platform.gameRound?.id;
	if (!gid) fail('manual collect should return gameRound.id', r2.json.platform);

	const balanceAfterBet = r2.json.platform.balance;
	const expectedBet = ev(r2, 'bet').context.total;
	if (startingBalance - balanceAfterBet !== expectedBet) {
		fail(`balance debit mismatch: ${startingBalance} - ${balanceAfterBet} != ${expectedBet}`);
	}
	const win = ev(r2, 'gameEnd').context.win;
	ok(`round opened: gid=${gid}, total=${expectedBet}, win=${win}, balance=${balanceAfterBet}`);

	// 3. heartbeat mid-round — balance should still be debited, no win credited
	const r3 = await post('heartbeat (mid-round)', `sid=${SID}&seq=1&gid=${gid}`, []);
	if (r3.json.platform.balance !== balanceAfterBet) {
		fail(`mid-round heartbeat balance changed unexpectedly`, r3.json.platform);
	}
	ok('mid-round heartbeat preserves balance');

	// 4. collect
	const r4 = await post('collect', `sid=${SID}&seq=2&gid=${gid}`, [{ action: 'collect' }]);
	if (r4.status !== 200) fail('collect status', r4.status);
	const over = ev(r4, 'gameRoundOver');
	if (!over) fail('collect should emit gameRoundOver', r4.json.events);
	if (over.context.win !== win) fail(`collect win mismatch: ${over.context.win} vs ${win}`);
	const finalBalance = r4.json.platform.balance;
	if (finalBalance !== balanceAfterBet + win) {
		fail(`final balance mismatch: ${balanceAfterBet} + ${win} != ${finalBalance}`);
	}
	ok(`collect credited win=${win}, final balance=${finalBalance}`);

	// 5. another bet+play but auto-collect this time (play.context = '')
	const r5 = await post('bet+play (auto-collect)', `sid=${SID}&seq=0`, [
		{ action: 'bet', context: [5, 2] },
		{ action: 'play', context: '' },
	]);
	if (!ev(r5, 'gameRoundOver')) fail('auto-collect should embed gameRoundOver');
	const autoWin = ev(r5, 'gameEnd').context.win;
	const expectedAfterAuto = finalBalance - 10 + autoWin;
	if (r5.json.platform.balance !== expectedAfterAuto) {
		fail(`auto-collect balance: ${finalBalance} - 10 + ${autoWin} != ${r5.json.platform.balance}`);
	}
	ok(`auto-collect: win=${autoWin}, balance=${r5.json.platform.balance}`);

	console.log('\nALL CHECKS PASSED');
};

main().catch((err) => {
	console.error('\nfatal:', err);
	process.exit(1);
});
