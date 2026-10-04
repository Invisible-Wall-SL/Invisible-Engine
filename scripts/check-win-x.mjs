// The test-only `WIN_X` force (`parseWinX` / `boardPayingAtLeast` in mock-rgs-server.mjs) that the
// current-games harness uses to reach each big-win tier: the n-th base spin pays at least
// `WIN_X[n]` × the stake, never triggers the feature, and spins past the list deal normally.
//
//   node scripts/check-win-x.mjs

import { createServer, request } from 'node:http';

import { createMockRgs as createBookMock } from './mock-rgs-server-book.mjs';
import { createMockRgs, parseWinX } from './mock-rgs-server.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};

const boot = async (mock) => {
	const server = createServer((req, res) =>
		mock.handle(req, res, new URL(req.url, 'http://127.0.0.1')),
	);
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
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
					res.on('end', () => resolve(JSON.parse(text)));
				},
			);
			req.on('error', reject);
			req.end(payload);
		});
	return { post, close: () => new Promise((r) => server.close(r)) };
};

const events = (resp, name) => (resp?.events ?? []).filter((e) => e.event === name);

/** One auto-collected base round: its stake, its win and whether it triggered the feature. */
const spin = async (post, sid, n, bet = [10, 1]) => {
	const resp = await post(`/rgs/engine?sid=${sid}&seq=${n * 2}`, [
		{ action: 'bet', context: bet },
		{ action: 'play', context: '' },
	]);
	const stake = events(resp, 'gameStart')[0]?.context?.totalBet ?? 0;
	const win = events(resp, 'spinWin').reduce((sum, e) => sum + e.context.pay, 0);
	return { stake, win, triggered: events(resp, 'spinTrigger').length > 0 };
};

console.log('\n§1 — parseWinX');
check(JSON.stringify(parseWinX('10, 20,40')) === '[10,20,40]', 'reads a comma list');
check(parseWinX(undefined).length === 0, 'absent ⇒ no forcing');
check(JSON.stringify(parseWinX('10,x,-3,,5')) === '[10,5]', 'drops malformed entries');

const TARGETS = [10, 20, 40, 70, 120];
const MOCKS = {
	lines: (o) => createMockRgs({ ...o, winModel: 'lines' }),
	ways: (o) => createMockRgs({ ...o, winModel: 'ways' }),
	cluster: (o) => createMockRgs({ ...o, winModel: 'cluster', cascade: false }),
	scatter: (o) => createMockRgs({ ...o, winModel: 'scatter', cascade: false }),
	book: (o) => createBookMock({ ...o, autoCollect: true }),
};

for (const [name, make] of Object.entries(MOCKS)) {
	console.log(`\n§ ${name} — WIN_X=${TARGETS.join(',')}`);
	const mock = make({ label: `win-x-${name}`, seed: 'win-x', quiet: true, winX: TARGETS });
	const { post, close } = await boot(mock);
	const multiples = [];
	for (const [n, target] of TARGETS.entries()) {
		// The book mock is a table game: its first bet argument is the option index.
		const bet = name === 'book' ? [0, 1] : undefined;
		const { stake, win, triggered } = await spin(post, `wx-${name}`, n, bet);
		const x = stake ? win / stake : 0;
		multiples.push(x.toFixed(1));
		check(x >= target && !triggered, `spin ${n + 1} pays ≥ ${target}× and does not trigger`);
	}
	console.log(`    multiples: ${multiples.join(', ')}`);
	await close();
}

console.log('\n§ unforced — the same seed deals the same board with and without an exhausted list');
{
	const plain = await boot(createMockRgs({ seed: 'win-x', quiet: true }));
	const forced = await boot(createMockRgs({ seed: 'win-x', quiet: true, winX: [10] }));
	await forced.post('/rgs/engine?sid=f&seq=0', [
		{ action: 'bet', context: [10, 1] },
		{ action: 'play', context: '' },
	]);
	await plain.post('/rgs/engine?sid=p&seq=0', [
		{ action: 'bet', context: [10, 1] },
		{ action: 'play', context: '' },
	]);
	const a = await spin(plain.post, 'p', 1);
	const b = await spin(forced.post, 'f', 1);
	check(a.win === b.win, 'the spin after the list deals as an unforced mock would');
	await plain.close();
	await forced.close();
}

console.log(failed ? `\nFAIL — ${failed} check(s)` : '\nPASS');
process.exit(failed ? 1 : 0);
