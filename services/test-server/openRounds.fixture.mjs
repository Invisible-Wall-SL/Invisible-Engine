/**
 * A free-spin feature survives the Invisible Test Server rebuilding its mock mid-round.
 *
 *   node services/test-server/openRounds.fixture.mjs
 *
 * Boots the REAL server (local manifest, one Book-of game — lines with the Book of Thermopylae
 * contract, dealt by the lines mock), buys the feature, and plays it the way the
 * facade does — one `play` per seq POSITION under the round's gid — while two `POST /refresh` land
 * mid-feature, one before and one after a natural RETRIGGER. A refresh follows every publish of any
 * game, so this is what a live bookofborutremake player meets (2026-10-02: seq 9 refused "play
 * without bet" after a refresh, then the collect refused, the player parked inside the feature).
 *
 * FIVE claims:
 *  1. Every free spin after each refresh is dealt — none refused.
 *  2. The feature plays out in full: played = 10 + 10 per retrigger, and the last spin ends the game.
 *  3. `collect` closes the round and credits exactly the feature's win.
 *  4. A resend of that `collect` (its answer lost) is REPLAYED by the instance that dealt the round,
 *     not refused by the rebuilt one, and credits nothing twice.
 *  5. A refresh between the closing `collect` and the player's next request keeps the balance the
 *     feature left: the next round is dealt by the rebuilt mock on it.
 */

import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMockRgs as createLinesMock } from '../../scripts/mock-rgs-server.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const GAME = 'bookgame';
const SID = 'fixture-sid';
const BUY = [1, 1];
/** The migrated Book-of game's contract: the grid the launcher derives from the preset. */
const GRID = JSON.parse(
	readFileSync(
		new URL('../../scripts/lib/book-of-thermopylae-lines-grid.json', import.meta.url),
		'utf8',
	),
);

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

/** node:http rather than fetch: undici's keep-alive pool trips a libuv assert at teardown on
 *  Windows, which prints "Assertion failed" after a passing run. */
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

/** Feature spin events, by name, in a response. */
const named = (answer, name) => (answer?.events ?? []).filter((e) => e.event === name);

/**
 * A seed whose bought feature retriggers on free spin 3–6, so one refresh lands before the retrigger
 * and one after it. Searched rather than hard-coded: the mock's RNG is the only input, and a
 * change to how it deals must not silently turn this into a no-retrigger run.
 */
const findSeed = async () => {
	for (let n = 0; n < 400; n++) {
		const seed = `open-rounds-${n}`;
		// Built as the test server builds it (`makeMock`), so the seed deals the same rounds.
		const mock = createLinesMock({
			seed,
			label: 'seed-search',
			quiet: true,
			winModel: 'lines',
			cascade: false,
			cascadeDemo: false,
			...GRID,
		});
		/** The mock in-process: it reads only `method` and the body stream off the request. */
		const post = async (seq, gid, actions) => {
			let out = '';
			const res = {
				writeHead() {},
				end(text) {
					out = text;
				},
			};
			const url = new URL(`http://x/rgs/engine?sid=s&seq=${seq}${gid ? `&gid=${gid}` : ''}`);
			const body = Buffer.from(JSON.stringify(actions));
			const req = {
				method: 'POST',
				headers: {},
				on(event, fn) {
					if (event === 'data') fn(body);
					if (event === 'end') fn();
					return req;
				},
			};
			const log = console.log;
			console.log = () => {};
			try {
				await mock.handle(req, res, url);
			} finally {
				console.log = log;
			}
			return JSON.parse(out);
		};
		// A table game prices only a session that asked for its config.
		await post(0, null, [{ action: 'config' }]);
		const first = await post(0, null, [
			{ action: 'bet', context: BUY },
			{ action: 'play', context: '' },
		]);
		const gid = first.platform?.gameRound?.id;
		if (!gid) continue;
		for (let spin = 1, seq = 2; spin <= 10; spin++, seq++) {
			const answer = await post(seq, gid, [{ action: 'play' }]);
			if (named(answer, 'retrigger').length > 0) {
				if (spin >= 3 && spin <= 6) return { seed, retriggerSpin: spin };
				break;
			}
			if (named(answer, 'gameEnd').length > 0) break;
		}
	}
	return null;
};

const found = await findSeed();
check(
	Boolean(found),
	'a seed whose bought feature retriggers on free spin 3–6',
	found ? ` (${found.seed}, spin ${found.retriggerSpin})` : '',
);
if (!found) process.exit(1);

const dir = mkdtempSync(join(tmpdir(), 'open-rounds-'));
// Stamped table-capable, so the test server sells it the bet table its buy needs (`sellableGrid`).
writeFileSync(
	join(dir, 'games.json'),
	JSON.stringify({ games: { [GAME]: { protocol: 'lines', tableCapable: true, grid: GRID } } }),
);
const port = await freePort();
const server = spawn(process.execPath, [join(here, 'server.mjs')], {
	env: {
		...process.env,
		TEST_SERVER_LOCAL: dir,
		PORT: String(port),
		SEED: found.seed,
		TEST_SERVER_SECRET: '',
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

try {
	let up = false;
	for (let i = 0; i < 100 && !up; i++) {
		up = Boolean((await health())?.ok);
		if (!up) await new Promise((r) => setTimeout(r, 100));
	}
	check(up, 'the test server boots from a local manifest');
	if (!up) throw new Error('server never came up');

	const engine = (seq, gid, actions) =>
		call(
			port,
			'POST',
			`/api/${GAME}/rgs/engine?sid=${SID}&seq=${seq}${gid ? `&gid=${gid}` : ''}`,
			actions,
		);

	await engine(0, null, [{ action: 'config' }]);
	const bought = await engine(0, null, [
		{ action: 'bet', context: BUY },
		{ action: 'play', context: '' },
	]);
	const gid = bought.platform?.gameRound?.id;
	check(
		Boolean(gid) && named(bought, 'enterBonus').length === 1,
		'the buy opens a feature round',
		` (gid ${gid})`,
	);

	const refreshBefore = found.retriggerSpin - 1;
	const refreshAfter = found.retriggerSpin + 1;
	let seq = 2;
	let played = 0;
	let retriggers = 0;
	// The trigger spin's own line wins belong to the round as well as every free spin's.
	let featureWin = named(bought, 'spinWin').reduce((sum, e) => sum + e.context.pay, 0);
	let ended = false;
	const refused = [];
	let lastBalance;
	while (!ended && played < 200) {
		if (played === refreshBefore || played === refreshAfter) {
			check(await refresh(), `POST /refresh lands after free spin ${played}`);
		}
		const answer = await engine(seq, gid, [{ action: 'play' }]);
		if (answer?.error) {
			refused.push(`seq ${seq}: ${answer.error}`);
			break;
		}
		seq++;
		played++;
		retriggers += named(answer, 'retrigger').length;
		for (const win of named(answer, 'bonusWin')) featureWin += win.context.pay;
		ended = named(answer, 'gameEnd').length > 0;
		lastBalance = answer.platform?.balance;
	}
	check(
		refused.length === 0,
		'no free spin is refused across the refreshes',
		refused.length ? ` — ${refused.join('; ')}` : '',
	);
	check(retriggers >= 1, 'the feature retriggered', ` (${retriggers})`);
	check(
		ended && played === 10 + 10 * retriggers,
		'the feature plays every free spin and ends',
		` (played ${played})`,
	);

	const collected = await engine(seq, gid, [{ action: 'collect' }]);
	const over = named(collected, 'gameRoundOver')[0];
	check(
		!collected?.error && Boolean(over),
		'collect closes the round',
		collected?.error ? ` — ${collected.error}` : '',
	);
	check(
		over?.context.win === featureWin,
		'the round pays exactly what it dealt',
		` (${over?.context.win} vs ${featureWin})`,
	);
	check(
		collected?.platform?.balance === lastBalance + featureWin,
		'collect credits the win to the balance',
		` (${lastBalance} → ${collected?.platform?.balance})`,
	);

	const resent = await engine(seq, gid, [{ action: 'collect' }]);
	check(
		!resent?.error && named(resent, 'gameRoundOver')[0]?.context.win === featureWin,
		'a resent collect is replayed, not refused',
		resent?.error ? ` — ${resent.error}` : '',
	);
	check(
		resent?.platform?.balance === collected?.platform?.balance,
		'…and credits nothing twice',
		` (${resent?.platform?.balance})`,
	);
	check(await refresh(), 'POST /refresh lands between the collect and the next round');

	// A refresh resets a desktop build's sessions (`carryPins` carries only a runtime game's), so a
	// table game's next bet needs the config again: the player reloads.
	await engine(0, null, [{ action: 'config' }]);
	const next = await engine(0, null, [
		{ action: 'bet', context: [0, 1] },
		{ action: 'play', context: '' },
	]);
	check(
		!next?.error && named(next, 'bet').length === 1,
		'the next round is dealt after the feature',
		next?.error ? ` — ${next.error}` : '',
	);
	const nextWin = named(next, 'spinWin').reduce((sum, e) => sum + e.context.pay, 0);
	check(
		next?.platform?.balance === collected?.platform?.balance - 10 + nextWin,
		'on the balance the feature left',
	);
} catch (e) {
	failures++;
	console.log(`  ✗ ${e.message}`);
} finally {
	server.kill();
	rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
	console.log(`\n${failures} check(s) failed.\n--- server log ---\n${serverLog.slice(-4000)}`);
	process.exit(1);
}
console.log('\nopen rounds survive a mock rebuild.');
