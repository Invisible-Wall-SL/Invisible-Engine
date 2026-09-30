/**
 * Verify the two-step balance flow:
 *   requestBet      → returns interim (bet debited, win NOT yet credited)
 *   requestEndRound → returns final (win credited)
 *
 * On the first paying round of the mock RGS at PORT — `node scripts/mock-rgs-server.mjs`; `pnpm
 * check:all` starts a seeded one for it — and on a FREE-SPIN round, from a mock started here that
 * forces every spin into the feature. That is the path where the facade plays and collects the
 * whole feature inside `requestBet`, and a plain deal reaches it on one base spin in fifty.
 */
import { createServer } from 'node:http';

import {
	requestAuthenticate,
	requestBet,
	requestEndRound,
} from '../packages/rgs-translator-eagaming/engine-facade.ts';
import { createMockRgs } from './mock-rgs-server.mjs';

const STAKE = 2; // dollars
const STAKE_UNITS = STAKE * 1_000_000; // engine units
/** The engine's BOOK_AMOUNT_MULTIPLIER — a book-event amount of 100 is 1× the stake. */
const BOOK_AMOUNT_MULTIPLIER = 100;

// `process.exitCode`, never `process.exit()`: exiting while undici's keep-alive sockets close aborts
// Node on Windows (`UV_HANDLE_CLOSING`), which reads as a failure of a check that passed.
const fail = (message) => {
	console.error(message);
	process.exitCode = 1;
};

/** Spin until a round pays, then check the two balances the facade reports. Returns its kind. */
async function checkFirstWin(rgsUrl, sid) {
	const auth = await requestAuthenticate({ sessionID: sid, rgsUrl, language: 'en' });
	const startStake = auth.balance.amount;
	console.log(`auth balance (engine units): ${startStake}  (= $${startStake / 1_000_000})`);

	for (let i = 0; i < 200; i++) {
		const bet = await requestBet({
			sessionID: sid,
			rgsUrl,
			currency: 'USD',
			amount: STAKE,
			mode: 'BASE',
		});
		const state = bet.round?.state ?? [];
		// The round's win is its LAST `setTotalWin`: where the engine's win meter ends the round,
		// built from the round's last `gameEnd` — the one the facade settles the balance on. A
		// free-spin round sends one per spin as a running total, the first being the trigger's pay.
		const totalWin = state.findLast((e) => e.type === 'setTotalWin')?.amount ?? 0;
		if (totalWin === 0) continue;

		const kind = state.some((e) => e.type === 'freeSpinTrigger') ? 'free-spin round' : 'base spin';
		const expectedDelta = (totalWin * STAKE_UNITS) / BOOK_AMOUNT_MULTIPLIER;
		// Every round before this one paid nothing, so the wallet is down exactly the stakes. The
		// delta alone cannot see a wrong interim: against an auto-collecting server the facade
		// derives it as final − win.
		const expectedInterim = startStake - (i + 1) * STAKE_UNITS;
		const interimStake = bet.balance.amount;
		console.log(
			`\nspin ${i + 1} (${kind}): bet=$${STAKE}, won ${totalWin / BOOK_AMOUNT_MULTIPLIER}× bet (= $${expectedDelta / 1_000_000})`,
		);
		console.log(
			`  requestBet returned (interim): ${interimStake}  (= $${interimStake / 1_000_000}; expect ${expectedInterim})`,
		);

		const end = await requestEndRound({ sessionID: sid, rgsUrl });
		const finalStake = end.balance.amount;
		console.log(
			`  requestEndRound returned (final): ${finalStake}  (= $${finalStake / 1_000_000})`,
		);

		const actualDelta = finalStake - interimStake;
		console.log(`  delta: ${actualDelta}  (expect ${expectedDelta})`);
		if (interimStake !== expectedInterim)
			fail('  ✗ MISMATCH — requestBet did not return the balance less exactly the stakes');
		if (actualDelta !== expectedDelta)
			fail('  ✗ MISMATCH — requestEndRound did not credit exactly the win');
		if (interimStake === expectedInterim && actualDelta === expectedDelta) {
			console.log(
				`  ✓ count-up will animate from $${interimStake / 1_000_000} to $${finalStake / 1_000_000}`,
			);
		}
		return kind;
	}
	fail('✗ No winning spin in 200 attempts — the balance flow was never exercised.');
	return null;
}

await checkFirstWin(`http://localhost:${process.env.PORT ?? 7777}`, `flow-${Date.now()}`);

console.log('\nA free-spin round, from a mock that forces every spin into the feature:');
const forced = createMockRgs({
	label: 'balance-flow',
	seed: 'balance-flow-feature',
	forceTrigger: true,
	quiet: true,
});
const server = createServer((req, res) => forced.handle(req, res, new URL(req.url, 'http://x')));
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
const kind = await checkFirstWin(
	`http://127.0.0.1:${server.address().port}`,
	`flow-feature-${Date.now()}`,
);
server.close();
server.closeAllConnections();
if (kind && kind !== 'free-spin round')
	fail(`✗ The forced mock paid a ${kind}, not a free-spin round.`);
