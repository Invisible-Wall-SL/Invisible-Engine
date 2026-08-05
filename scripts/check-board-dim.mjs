import { requestBet } from '../packages/rgs-translator-eagaming/stake-facade.ts';

const RGS_URL = `http://localhost:${Number(process.env.PORT ?? 7777)}`;

const r = await requestBet({
	sessionID: 'dim-test', rgsUrl: RGS_URL, currency: 'USD', amount: 10_000_000, mode: 'BASE',
});
const reveal = r.round?.state?.find((e) => e.type === 'reveal');
if (!reveal) { console.error('no reveal'); process.exit(1); }
console.log('reels:', reveal.board.length);
console.log('cells per reel:', reveal.board.map((r) => r.length).join(', '));
console.log('first reel symbols:', reveal.board[0].map((c) => c.name).join(' | '));
console.log('paddingPositions:', JSON.stringify(reveal.paddingPositions));
console.log('gameType:', reveal.gameType);
