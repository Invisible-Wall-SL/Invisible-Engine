// End-to-end check of the `ways` mock RGS protocol (Phase D of
// docs/design/game-type-templates.md): boot a real mock instance over HTTP, play rounds, and assert
// the wire shape a ways client actually receives.
//
//   node scripts/check-ways-protocol.mjs
//
// Why over HTTP rather than calling the evaluator: the evaluator is unit-checked separately by
// check-ways-evaluator.mjs. What this covers is the part that silently breaks — that the win
// survives the round lifecycle and reaches the wire in the shape `engineFacade.winPositions` can
// read. A ways win whose positions arrive as an object instead of an array still PAYS and lights
// up nothing, which looks like an art bug rather than a protocol one.

import { createServer, request } from 'node:http';

import { createMockRgs } from './mock-rgs-server.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failed++;
};

const mock = createMockRgs({ label: 'ways-check', winModel: 'ways', seed: 'ways-protocol-check' });
// `handle` takes the PARSED url as a third argument (the test server mounts it the same way).
const server = createServer((req, res) =>
	mock.handle(req, res, new URL(req.url, `http://127.0.0.1`)),
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

const auth = await post('/wallet/authenticate', { sessionID: 'demo' });
check(!!auth, 'authenticate responds');

// Play enough rounds to see a ways win; the board is random per spin.
let waysWin = null;
let rounds = 0;
for (let i = 0; i < 60 && !waysWin; i++) {
	rounds++;
	const sid = auth?.sid ?? 'demo';
	const bet = await post(`/rgs/engine?sid=${sid}&seq=0`, [
		{ action: 'bet', context: [20, 1] },
		{ action: 'play', context: '' },
	]);
	const events = bet?.events ?? [];
	waysWin =
		events.find((e) => e.event === 'spinWin' && e.context?.mode === 'ways')?.context ?? null;
}

check(!!waysWin, `a ways win occurs within 60 rounds`, ` (took ${rounds})`);
if (waysWin) {
	check(Array.isArray(waysWin.context), 'positions arrive as a BARE ARRAY (facade-readable)');
	check(
		waysWin.context.every((p) => Number.isInteger(p.reel) && Number.isInteger(p.row)),
		'every position is an integer {reel,row}',
	);
	check(waysWin.occurs >= 3, 'occurs is a real run length', ` (${waysWin.occurs})`);
	check(waysWin.pay > 0, 'the win pays', ` (${waysWin.pay})`);
	const reels = new Set(waysWin.context.map((p) => p.reel));
	check(
		reels.size === waysWin.occurs,
		'positions span exactly `occurs` reels',
		` (${reels.size} reels, occurs ${waysWin.occurs})`,
	);
	check(Math.min(...reels) === 0, 'the run starts at the LEFTMOST reel (ways pays left to right)');
}

server.close();
console.log(failed ? `\n${failed} check(s) FAILED` : '\nways protocol OK');
process.exit(failed ? 1 : 0);
