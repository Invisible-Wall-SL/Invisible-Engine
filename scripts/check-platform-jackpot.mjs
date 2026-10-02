// The operator platform jackpot over the mocks (`scripts/mock-platform-jackpot.mjs`, design
// `docs/design/hold-and-win.md` §7 11c), proven from the wire: every answer — the balance heartbeat's
// included — carries `platform.jackpots[]`; bets and time grow the pools; a forced hit pays the pool
// into `platform.gameRound.jackpot` AND the balance and starts the tier again; a held hit waits for
// the feature when asked; forcing obeys `allowForce`; and the wrapper changes nothing else about an
// answer (parity for every game whose operator runs no jackpot).
//
//   node scripts/check-platform-jackpot.mjs

import { createServer, request } from 'node:http';

import { createMockRgs as createBookMock } from './mock-rgs-server-book.mjs';
import { createPlatformJackpot, DEFAULT_PLATFORM_TIERS } from './mock-platform-jackpot.mjs';

let failed = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra ? ` — ${extra}` : ''}`);
	if (!ok) failed++;
};

/** A book mock on its own and the same mock (same seed) wrapped, side by side. */
const boot = async ({ allowForce = true, forceTrigger = false } = {}) => {
	let clock = 1_000_000;
	const bare = createBookMock({ label: 'bare', quiet: true, seed: 'pj', forceTrigger });
	const inner = createBookMock({ label: 'inner', quiet: true, seed: 'pj', forceTrigger });
	const platform = createPlatformJackpot({ allowForce, now: () => clock });
	const serve = (handle) =>
		new Promise((resolve) => {
			const server = createServer((req, res) => handle(req, res, new URL(req.url, 'http://x')));
			server.listen(0, '127.0.0.1', () => resolve(server));
		});
	const bareServer = await serve(bare.handle);
	const wrapped = await serve((req, res, url) => platform.handle(req, res, url, inner.handle));
	const send = (server, method, path, body) =>
		new Promise((resolve, reject) => {
			const payload = body === undefined ? '' : JSON.stringify(body);
			const req = request(
				{
					host: '127.0.0.1',
					port: server.address().port,
					path,
					method,
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
					res.on('end', () => resolve(text ? JSON.parse(text) : null));
				},
			);
			req.on('error', reject);
			req.end(payload);
		});
	return {
		platform,
		bare: (path, body) => send(bareServer, 'POST', path, body),
		post: (path, body) => send(wrapped, 'POST', path, body),
		get: (path) => send(wrapped, 'GET', path),
		tick: (ms) => (clock += ms),
		close: () => Promise.all([bareServer, wrapped].map((s) => new Promise((r) => s.close(r)))),
	};
};

const grand = (answer) => answer.platform.jackpots?.find((j) => j.name === 'Grand');
const seedOf = (name) => DEFAULT_PLATFORM_TIERS.find((t) => t.name === name).seed;
const bet = [{ action: 'bet', context: [0, 10] }];

/** A whole round the facade's way: `[bet, play]`, the feature's plays, then `collect` if owed. */
const playRound = async (g, sid, playContext = null) => {
	const answers = [
		await g.post(`/rgs/engine?sid=${sid}&seq=0`, [
			...bet,
			{ action: 'play', context: playContext },
		]),
	];
	const gid = answers[0].platform.gameRound?.id;
	const names = () => answers.flatMap((a) => (a.events ?? []).map((e) => e.event));
	let seq = 2;
	while (
		gid &&
		names().includes('enterBonus') &&
		!names().slice(names().lastIndexOf('enterBonus')).includes('gameEnd') &&
		seq < 60
	) {
		answers.push(
			await g.post(`/rgs/engine?sid=${sid}&seq=${seq++}&gid=${gid}`, [{ action: 'play' }]),
		);
	}
	if (gid && !names().includes('gameRoundOver')) {
		answers.push(
			await g.post(`/rgs/engine?sid=${sid}&seq=${seq}&gid=${gid}`, [{ action: 'collect' }]),
		);
	}
	return answers;
};

console.log('platform jackpot over the book mock');
{
	const g = await boot();
	const boot0 = await g.post('/rgs/engine?sid=a&seq=0', []);
	check(
		JSON.stringify(
			boot0.platform.jackpots.map((j) => [j.id, j.name, j.value, j.minValue, j.maxValue]),
		) === JSON.stringify(DEFAULT_PLATFORM_TIERS.map((t) => [t.id, t.name, t.seed, t.seed, t.max])),
		'the heartbeat carries every tier {id, name, value, minValue, maxValue}, at its seed',
	);
	g.tick(10_000);
	const later = await g.post('/rgs/engine?sid=a&seq=0', []);
	check(
		grand(later).value === seedOf('Grand') + 100,
		'between rounds the pool drifts (a refresh moves it)',
		String(grand(later).value),
	);

	const round = await playRound(g, 'a');
	const stake = round[0].events.find((e) => e.event === 'bet').context.total;
	check(
		grand(round[0]).value === Math.floor(seedOf('Grand') + 100 + stake * 0.001),
		'a bet grows the pool by its contribution',
		`${grand(round[0]).value} after a ${stake} stake`,
	);
	check(
		round.every((a) => Array.isArray(a.platform.jackpots)),
		'every answer of a round carries the tiers',
	);
	check(!round.some((a) => a.platform.gameRound?.jackpot), 'no hit unless one is forced');

	const before = await g.post('/rgs/engine?sid=a&seq=0', []);
	const pool = grand(before).value;
	const hit = await playRound(g, 'a', 'force:platformJackpot:Grand');
	const opening = hit[0];
	const win = opening.platform.gameRound?.jackpot;
	check(
		win?.winJackpotId === 4 && win.win === Math.floor(pool + stake * 0.001),
		'a forced hit names the tier by id and pays the pool',
		JSON.stringify(win),
	);
	check(grand(opening).value === seedOf('Grand'), 'the tier starts again from its seed');
	const after = await g.post('/rgs/engine?sid=a&seq=0', []);
	const roundWin =
		hit.flatMap((a) => a.events ?? []).find((e) => e.event === 'gameRoundOver')?.context.win ?? 0;
	check(
		after.platform.balance === before.platform.balance - stake + roundWin + win.win,
		'the win is inside every later balance',
		`${before.platform.balance} → ${after.platform.balance}`,
	);
	check(!after.platform.gameRound?.jackpot, 'a later answer carries no hit');

	const refused = await g.post('/rgs/engine?sid=a&seq=0', [
		...bet,
		{ action: 'play', context: 'force:platformJackpot:Diamond' },
	]);
	check(refused.errorCode === 101, 'an unknown tier is refused', JSON.stringify(refused.error));

	const other = await g.post('/rgs/engine?sid=b&seq=0', []);
	check(grand(other).value === seedOf('Grand'), 'another session has its own pools');
	await g.close();
}

console.log('a hit held for the feature lands in a free spin');
{
	const g = await boot({ forceTrigger: true });
	const held = await g.get('/platformJackpot?sid=fs&hit=Major&when=feature');
	check(
		held?.ok === true && held.hit?.inFeature === true,
		'the hit is held for the session',
		JSON.stringify(held?.hit),
	);
	const round = await playRound(g, 'fs');
	const at = round.findIndex((a) => a.platform.gameRound?.jackpot);
	check(
		at > 0,
		'it rides a free-spin play, not the opening one',
		`answer ${at} of ${round.length}`,
	);
	check(round[at]?.platform.gameRound.jackpot.winJackpotId === 3, '…as the held tier');
	await g.close();
}

console.log('forcing off, and parity with the bare mock');
{
	const g = await boot({ allowForce: false });
	const off = await g.post('/rgs/engine?sid=p&seq=0', [
		...bet,
		{ action: 'play', context: 'force:platformJackpot:Grand' },
	]);
	check(off.errorCode === 101, 'a forced hit is refused where forcing is off');
	const endpoint = await g.get('/platformJackpot?sid=p&hit=Grand');
	check(endpoint?.ok === false, 'so is the hold endpoint');

	const strip = (answer) => {
		const { jackpots, ...platform } = answer.platform ?? {};
		return JSON.stringify({ ...answer, platform });
	};
	const a = await g.bare('/rgs/engine?sid=q&seq=0', []);
	const b = await g.post('/rgs/engine?sid=q&seq=0', []);
	check(strip(a) === strip(b), 'a heartbeat is the bare mock answer plus `platform.jackpots`');
	const c = await g.bare('/rgs/engine?sid=q&seq=0', [...bet, { action: 'play', context: null }]);
	const d = await g.post('/rgs/engine?sid=q&seq=0', [...bet, { action: 'play', context: null }]);
	const noIds = (text) => text.replace(/"id":"G[a-z0-9]+"/g, '"id":"G"');
	check(noIds(strip(c)) === noIds(strip(d)), 'so is a spin without a hit');
	await g.close();
}

console.log(
	failed ? `\n✗ ${failed} platform jackpot check(s) failed` : '\n✓ platform jackpot checks passed',
);
process.exit(failed ? 1 : 0);
