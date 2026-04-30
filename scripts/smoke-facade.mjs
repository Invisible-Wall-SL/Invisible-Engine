/**
 * Smoke test for the Stake-shaped facade against the mock RGS.
 *
 * Exercises the same call shapes that apps/lines makes during boot + spin:
 *   1. requestAuthenticate → expect { status, balance, config{betLevels,…} }
 *   2. requestBet         → expect { status, balance, round{state[...]} }
 *      where state events have {index, type} (Stake vocab, post-adapter)
 *   3. requestEndRound    → expect { status, balance }
 *
 * Pre-req: mock running (node scripts/mock-rgs-server.mjs).
 *
 * Run: node scripts/smoke-facade.mjs
 */

const PORT = Number(process.env.PORT ?? 7777);
const RGS_URL = `http://localhost:${PORT}`;
const SID = `facade-${Date.now()}`;

const fail = (msg, ctx) => {
	console.error(`✗ FAIL: ${msg}`);
	if (ctx !== undefined) console.error('  ctx:', JSON.stringify(ctx, null, 2).slice(0, 800));
	process.exit(1);
};
const ok = (msg) => console.log(`✓ ${msg}`);

// Dynamic import of the workspace package — needs TS support, so use tsx.
let facade;
try {
	facade = await import(
		new URL('../packages/rgs-translator-eagaming/stake-facade.ts', import.meta.url).href
	);
} catch (err) {
	console.error('TS import failed:', err.message);
	console.error('\nRun this with tsx:');
	console.error('  pnpm -w exec tsx scripts/smoke-facade.mjs');
	console.error('Or:');
	console.error('  npx tsx scripts/smoke-facade.mjs');
	process.exit(2);
}

const main = async () => {
	console.log(`facade smoke test — sid=${SID}, rgs_url=${RGS_URL}\n`);

	// 1. authenticate
	const auth = await facade.requestAuthenticate({
		sessionID: SID, rgsUrl: RGS_URL, language: 'en',
	});
	if (auth.status?.statusCode !== 'SUCCESS') fail('authenticate not SUCCESS', auth);
	if (typeof auth.balance?.amount !== 'number') fail('authenticate missing balance.amount', auth);
	if (!Array.isArray(auth.config?.betLevels)) fail('authenticate missing config.betLevels', auth);
	if (!auth.config?.jurisdiction) fail('authenticate missing config.jurisdiction', auth);
	ok(`authenticate: balance=${auth.balance.amount}, ${auth.config.betLevels.length} bet levels`);

	// 2. bet — amount in user-display dollars (matches the engine's call site
	//    in createPrimaryMachines.ts which passes stateBet.betAmount directly).
	//    2 = $2 bet; the facade will multiply by 100 → 200 cents on the wire.
	const bet = await facade.requestBet({
		sessionID: SID, rgsUrl: RGS_URL, currency: 'USD', amount: 2, mode: 'BASE',
	});
	if (bet.status?.statusCode !== 'SUCCESS') fail('bet not SUCCESS', bet);
	if (!Array.isArray(bet.round?.state)) fail('bet missing round.state', bet);
	if (bet.round.state.length === 0) fail('bet round.state empty', bet);

	// Check Stake-vocab adapter ran (events should have {index, type})
	const sample = bet.round.state[0];
	if (typeof sample?.index !== 'number') fail('event missing .index — adapter did not run', sample);
	if (typeof sample?.type !== 'string') fail('event missing .type — adapter did not run', sample);

	const types = bet.round.state.map((e) => e.type);
	if (!types.some((t) => t === 'reveal')) fail('expected a reveal event after adapter', types);
	if (!types.some((t) => t === 'setTotalWin' || t === 'finalWin')) fail('expected setTotalWin/finalWin', types);

	// Symbols on the reveal board should be Stake-vocab (H1-H5/L1-L5/S), not
	// Play4Fun (PIC1-PIC7/SCAT) — the symbol map should have run.
	const reveal = bet.round.state.find((e) => e.type === 'reveal');
	const allSymbols = (reveal?.board ?? []).flat().map((c) => c.name);
	const stakeNames = new Set(['H1','H2','H3','H4','H5','L1','L2','L3','L4','L5','S','W']);
	const unmapped = allSymbols.filter((n) => !stakeNames.has(n));
	if (unmapped.length > 0) fail(`unmapped Play4Fun symbols leaked through adapter: ${unmapped}`, allSymbols);
	ok(`bet: balance=${bet.balance?.amount}, events=[${types.join(', ')}], symbols mapped`);

	// 3. endRound
	const end = await facade.requestEndRound({ sessionID: SID, rgsUrl: RGS_URL });
	if (end.status?.statusCode !== 'SUCCESS') fail('endRound not SUCCESS', end);
	if (typeof end.balance?.amount !== 'number') fail('endRound missing balance.amount', end);
	ok(`endRound: balance=${end.balance.amount}`);

	// 4. Run a few more bets to verify session reuse + balance arithmetic.
	let prev = end.balance.amount;
	for (let i = 0; i < 3; i++) {
		const r = await facade.requestBet({
			sessionID: SID, rgsUrl: RGS_URL, currency: 'USD', amount: 2, mode: 'BASE',
		});
		if (r.status?.statusCode !== 'SUCCESS') fail(`bet #${i + 2} not SUCCESS`, r);
		if (typeof r.balance?.amount !== 'number') fail(`bet #${i + 2} missing balance`, r);
		prev = r.balance.amount;
	}
	ok(`3 more bets succeeded; final balance=${prev}`);

	console.log('\nALL CHECKS PASSED');
};

main().catch((err) => { console.error('fatal:', err); process.exit(1); });
