/**
 * A project switching between the partner's collector game and ours does not carry its tabs' config.
 *
 *   node services/test-server/mockSwitch.fixture.mjs
 *
 * A Hold and Win project that gains or loses `holdAndWin.enhancements` is dealt by the other mock:
 * the partner's wire (`mock-rgs-server-holdandwin-partner.mjs`) or ours. A rebuilt mock carries each
 * session over, and for a game that sells a table (a runtime game) it carried the config the tab
 * booted on too — so a tab told OUR table `[10, 1000]` bet option 1 on the partner's `[10, 50, …]`
 * and was charged 50 for what it priced as the 1000 buy, until it reloaded.
 *
 * Boots the REAL server from a local manifest, with a stub launcher answering its live contract, and
 * claims:
 *  1. A same-wire swap (our table's buy re-priced) keeps the tab's table: its buy is still priced
 *     by the table it was told, with no new `config` — as before.
 *  2. A swap onto the partner's wire keeps the balance but not the config: the tab's next bet is
 *     refused, never priced against the partner's table; once it re-reads `config`, it bets.
 *  3. A partner-wire contract change that stays on the partner's wire keeps the tab's config.
 *  4. The swap back onto ours refuses the partner-booted tab's bet until it re-reads.
 *  5. A `/refresh` whose manifest moves a game onto the partner's wire resets its sessions, so the
 *     stale tab's bet is refused there too.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as createHttpServer, request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const LIVE = 'livegame';
const PUBLISHED = 'refreshgame';
const TOKEN = 'fixture-token';

let failures = 0;
const check = (ok, msg, extra = '') => {
	console.log(`${ok ? '  ✓' : '  ✗'} ${msg}${extra}`);
	if (!ok) failures++;
};

const freePort = () =>
	new Promise((resolve, reject) => {
		const probe = createServer();
		probe.unref();
		probe.on('error', reject);
		probe.listen(0, '127.0.0.1', () => {
			const { port } = probe.address();
			probe.close(() => resolve(port));
		});
	});

/** node:http rather than fetch, for the reason `openRounds.fixture.mjs` gives. */
const call = (port, method, path, body) =>
	new Promise((resolve, reject) => {
		const payload = body === undefined ? '' : JSON.stringify(body);
		const req = request(
			{
				host: '127.0.0.1',
				port,
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

const named = (answer, name) => (answer?.events ?? []).filter((e) => e.event === name);
const tableOf = (answer) => named(answer, 'config')[0]?.context?.betOptions;

/** Our table: a base bet and the 100× buy, `[10, 1000]` at one per line. */
const OURS = JSON.parse(
	readFileSync(
		new URL('../../scripts/lib/book-of-thermopylae-lines-grid.json', import.meta.url),
		'utf8',
	),
);
/** The same game with its buy re-priced: a contract change that stays on our wire. */
const OURS_REPRICED = {
	...OURS,
	betModes: OURS.betModes.map((m) => (m.kind === 'buy' ? { ...m, cost: 200 } : m)),
};
/** The partner's collector game: the marker is all `makeMock` selects on. */
const PARTNER = {
	reels: 5,
	rows: 3,
	paylines: [],
	holdAndWin: { block: { enhancements: true }, lineSymbols: [], symbols: {} },
};
const PARTNER_RESIZED = { ...PARTNER, rows: 4 };

let liveGrid = OURS;
const launcher = createHttpServer((req, res) => {
	const url = new URL(req.url, 'http://x');
	const ok = url.pathname === '/api/game-config/mock' && url.searchParams.get('k') === TOKEN;
	res.writeHead(ok ? 200 : 404, { 'content-type': 'application/json' });
	res.end(JSON.stringify(ok ? { protocol: 'lines', grid: liveGrid } : { error: 'no' }));
});
const launcherPort = await freePort();
await new Promise((resolve) => launcher.listen(launcherPort, '127.0.0.1', resolve));

const dir = mkdtempSync(join(tmpdir(), 'mock-switch-'));
const manifest = (refreshGrid) =>
	writeFileSync(
		join(dir, 'games.json'),
		JSON.stringify({
			games: {
				[LIVE]: {
					protocol: 'lines',
					runtime: 'lines',
					grid: OURS,
					docBase: `http://127.0.0.1:${launcherPort}`,
					readToken: TOKEN,
				},
				[PUBLISHED]: { protocol: 'lines', runtime: 'lines', grid: refreshGrid },
			},
		}),
	);
manifest(OURS);

const port = await freePort();
const server = spawn(process.execPath, [join(here, 'server.mjs')], {
	env: {
		...process.env,
		TEST_SERVER_LOCAL: dir,
		PORT: String(port),
		TEST_SERVER_SECRET: '',
		CONTRACT_TTL_MS: '0',
	},
	stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
server.stdout.on('data', (c) => (serverLog += c));
server.stderr.on('data', (c) => (serverLog += c));

const health = () => call(port, 'GET', '/healthz').catch(() => null);
const refresh = async () => {
	const before = (await health())?.lastHydrate?.at ?? 0;
	await call(port, 'POST', '/refresh');
	for (let i = 0; i < 100; i++) {
		if (((await health())?.lastHydrate?.at ?? 0) > before) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return false;
};

/** One tab: its own sid, playing whole rounds (bet + play, then collect when one stays open). */
const tab = (game, sid) => {
	const post = (actions, gid, seq = 0) =>
		call(
			port,
			'POST',
			`/api/${game}/rgs/engine?sid=${sid}&seq=${seq}${gid ? `&gid=${gid}` : ''}`,
			actions,
		);
	return {
		config: () => post([{ action: 'config' }]),
		/** Bets `[option, 1]` and closes the round; the answer to the bet, or its refusal. */
		bet: async (option) => {
			const answer = await post([
				{ action: 'bet', context: [option, 1] },
				{ action: 'play', context: '' },
			]);
			const gid = answer?.platform?.gameRound?.id;
			if (!answer?.error && gid) await post([{ action: 'collect' }], gid, 2);
			return answer;
		},
		balance: async () => (await post([]))?.platform?.balance,
	};
};
/** What a bet's `bet` event staked. */
const staked = (answer) => named(answer, 'bet')[0]?.context?.total;

try {
	let up = false;
	for (let i = 0; i < 100 && !up; i++) {
		up = Boolean((await health())?.ok);
		if (!up) await new Promise((r) => setTimeout(r, 100));
	}
	check(up, 'the test server boots from a local manifest');
	if (!up) throw new Error('server never came up');

	// 1. Same wire: our buy re-priced.
	const same = tab(LIVE, 'same-wire');
	check(JSON.stringify(tableOf(await same.config())) === '[10,1000]', 'a tab is told our table [10, 1000]'); // prettier-ignore
	liveGrid = OURS_REPRICED;
	const sameBuy = await same.bet(1);
	check(!sameBuy?.error, 'after a same-wire swap its buy is accepted with no new config', sameBuy?.error ? ` — ${sameBuy.error}` : ''); // prettier-ignore
	check(staked(sameBuy) === 1000, '…priced by the table it was told: 1000, not the re-priced 2000', ` (${staked(sameBuy)})`); // prettier-ignore

	// 2. Onto the partner's wire.
	liveGrid = OURS;
	const switched = tab(LIVE, 'wire-switch');
	check(JSON.stringify(tableOf(await switched.config())) === '[10,1000]', 'another tab is told our table'); // prettier-ignore
	const held = await switched.balance();
	liveGrid = PARTNER;
	const stale = await switched.bet(1);
	check(Boolean(stale?.error), 'after the swap onto the partner’s wire its bet is refused, not priced by the partner’s table', stale?.error ? '' : ` — staked ${staked(stale)}`); // prettier-ignore
	check(stale?.platform?.balance === held, '…and its balance is carried, uncharged', ` (${held} → ${stale?.platform?.balance})`); // prettier-ignore
	const partnerTable = tableOf(await switched.config());
	check(JSON.stringify(partnerTable) === '[10,50,500,1000]', 'it re-reads the config: the partner’s table', ` (${JSON.stringify(partnerTable)})`); // prettier-ignore
	const fresh = await switched.bet(1);
	check(!fresh?.error && named(fresh, 'bet').length === 1, '…and then bets', fresh?.error ? ` — ${fresh.error}` : ''); // prettier-ignore

	// 3. The partner's game changes, still on its wire.
	liveGrid = PARTNER_RESIZED;
	const partnerSame = await switched.bet(0);
	check(!partnerSame?.error, 'a partner-wire change keeps the tab’s config: its bet is accepted', partnerSame?.error ? ` — ${partnerSame.error}` : ''); // prettier-ignore

	// 4. Back onto ours.
	liveGrid = OURS;
	const back = await switched.bet(1);
	check(Boolean(back?.error), 'the swap back onto our wire refuses the partner-booted tab’s bet', back?.error ? '' : ` — staked ${staked(back)}`); // prettier-ignore
	check(JSON.stringify(tableOf(await switched.config())) === '[10,1000]', '…until it re-reads our table'); // prettier-ignore
	check(!(await switched.bet(0))?.error, '…and then bets');

	// 5. A refresh that moves a game onto the partner's wire.
	const published = tab(PUBLISHED, 'refresh-switch');
	check(JSON.stringify(tableOf(await published.config())) === '[10,1000]', 'a published game’s tab is told our table'); // prettier-ignore
	manifest(PARTNER);
	check(await refresh(), 'POST /refresh lands with the game on the partner’s wire');
	const refreshed = await published.bet(1);
	check(Boolean(refreshed?.error), 'the stale tab’s bet is refused, not priced by the partner’s table', refreshed?.error ? '' : ` — staked ${staked(refreshed)}`); // prettier-ignore
	check(JSON.stringify(tableOf(await published.config())) === '[10,50,500,1000]', '…until it re-reads the partner’s'); // prettier-ignore
} catch (e) {
	failures++;
	console.log(`  ✗ ${e.message}`);
} finally {
	server.kill();
	launcher.close();
	rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
	console.log(`\n${failures} check(s) failed.\n--- server log ---\n${serverLog.slice(-4000)}`);
	process.exit(1);
}
console.log('\na mock-type switch drops the carried config; a same-type swap keeps it.');
