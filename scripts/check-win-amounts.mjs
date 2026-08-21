import { requestBet } from '../packages/rgs-translator-eagaming/engine-facade.ts';

const url = `http://localhost:${process.env.PORT ?? 7777}`;

// Spin until we land a winning round, then dump the bookEvent amounts
// so we can check they're correctly expressed as bet-multipliers.
for (let i = 0; i < 80; i++) {
	const r = await requestBet({
		sessionID: 'win-check',
		rgsUrl: url,
		currency: 'USD',
		amount: 2,
		mode: 'BASE',
	});
	const stw = r.round?.state?.find((e) => e.type === 'setTotalWin');
	const fw = r.round?.state?.find((e) => e.type === 'finalWin');
	const wi = r.round?.state?.filter((e) => e.type === 'winInfo') ?? [];
	const raw = r._raw;
	if (!raw?.events) continue;

	const pays = raw.events.filter((e) => e.event === 'spinWin').map((e) => e.context.pay);
	const totalCents = raw.events.find((e) => e.event === 'gameEnd')?.context?.win ?? 0;
	const betCents = raw.events.find((e) => e.event === 'bet')?.context?.total ?? 0;

	if (totalCents > 0) {
		const expected = Math.round((totalCents / betCents) * 100);
		console.log(`Found a winning spin after ${i + 1} attempts:`);
		console.log(`  bet (cents):        ${betCents}`);
		console.log(`  win total (cents):  ${totalCents}  (= ${(totalCents / betCents).toFixed(2)}× bet)`);
		console.log(`  per-line pays:      ${JSON.stringify(pays)}`);
		console.log(`  setTotalWin.amount: ${stw?.amount}  (expect ${expected})`);
		console.log(`  finalWin.amount:    ${fw?.amount}   (expect ${expected})`);
		console.log(`  winInfo final totalWin: ${wi[wi.length - 1]?.totalWin}  (expect ${expected})`);
		console.log(`  winInfo wins[0].win:    ${wi[0]?.wins[0]?.win}  (expect ≈${Math.round((pays[0] / betCents) * 100)})`);
		console.log(`\nBalance returned (engine API units): ${r.balance?.amount}`);
		console.log(`UI display (÷1,000,000): $${(r.balance?.amount ?? 0) / 1_000_000}`);
		process.exit(0);
	}
}
console.log('No winning spin in 80 attempts — got unlucky, retry.');
