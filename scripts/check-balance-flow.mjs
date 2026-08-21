/**
 * Verify the two-step balance flow:
 *   requestBet      → returns interim (bet debited, win NOT yet credited)
 *   requestEndRound → returns final (win credited)
 */
import { requestAuthenticate, requestBet, requestEndRound } from '../packages/rgs-translator-eagaming/engine-facade.ts';

const url = `http://localhost:${process.env.PORT ?? 7777}`;
const sid = `flow-${Date.now()}`;

const auth = await requestAuthenticate({ sessionID: sid, rgsUrl: url, language: 'en' });
const startStake = auth.balance.amount;
console.log(`auth balance (engine units): ${startStake}  (= $${startStake / 1_000_000})`);

for (let i = 0; i < 80; i++) {
	const bet = await requestBet({
		sessionID: sid,
		rgsUrl: url,
		currency: 'USD',
		amount: 2,
		mode: 'BASE',
	});
	const stw = bet.round?.state?.find((e) => e.type === 'setTotalWin');
	const winMultiplier = (stw?.amount ?? 0) / 100;
	if (winMultiplier === 0) continue;

	const interimStake = bet.balance.amount;
	console.log(`\nspin ${i + 1}: bet=$2, won ${winMultiplier}× bet (= $${winMultiplier * 2})`);
	console.log(`  requestBet returned (interim): ${interimStake}  (= $${interimStake / 1_000_000})`);

	const end = await requestEndRound({ sessionID: sid, rgsUrl: url });
	const finalStake = end.balance.amount;
	console.log(`  requestEndRound returned (final): ${finalStake}  (= $${finalStake / 1_000_000})`);

	const expectedDelta = winMultiplier * 2 * 1_000_000; // win in engine units
	const actualDelta = finalStake - interimStake;
	console.log(`  delta: ${actualDelta}  (expect ${expectedDelta})`);
	if (actualDelta === expectedDelta) console.log(`  ✓ count-up will animate from $${interimStake / 1_000_000} to $${finalStake / 1_000_000}`);
	else console.log(`  ✗ MISMATCH`);
	process.exit(0);
}
console.log('No winning spin in 80 attempts — got unlucky.');
