// The draft-player service (`src/server.mjs`), offline: signed requests only, plays one at a time,
// downloads the presigned files, uploads the report and shots, posts the signed callback, answers
// /progress and /cancel. The play itself is replaced by a stand-in that writes screenshots; the real
// one runs in `playDraft.browser.mjs`. A local http server stands in for storage and the launcher.
//
//   node services/draft-player/server.fixture.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDraftPlayer } from './src/server.mjs';
import { SIGNATURE_HEADER, signRequest, verifyRequest } from './src/signing.mjs';

const SECRET = 'fixture-secret-0123456789';
const work = mkdtempSync(join(tmpdir(), 'draft-player-server-'));

// ---- signing ----
{
	const sig = signRequest(SECRET, 'POST', '/play', '{"a":1}', 1_000_000_000_000);
	const ok = (over = {}) =>
		verifyRequest(
			SECRET,
			over.method ?? 'POST',
			over.target ?? '/play',
			over.body ?? '{"a":1}',
			'sig' in over ? over.sig : sig,
			over.now ?? 1_000_000_000_000,
		);
	assert.ok(ok());
	assert.ok(!ok({ body: '{"a":2}' }), 'another body');
	assert.ok(!ok({ target: '/cancel' }), 'another path: a signature is not replayable');
	assert.ok(!ok({ method: 'GET' }));
	assert.ok(!ok({ now: 1_000_000_400_000 }), 'older than 300 s');
	assert.ok(!verifyRequest('other', 'POST', '/play', '{"a":1}', sig, 1_000_000_000_000));
	assert.ok(!ok({ sig: null }));
}

// ---- the launcher + storage stand-in ----
const store = { gets: [], puts: {}, callbacks: [] };
const launcher = createServer(async (req, res) => {
	const chunks = [];
	for await (const c of req) chunks.push(c);
	const body = Buffer.concat(chunks);
	if (req.method === 'GET') {
		store.gets.push(req.url);
		res.writeHead(200);
		return res.end(`file:${req.url}`);
	}
	if (req.method === 'PUT') {
		store.puts[req.url] = body;
		res.writeHead(200);
		return res.end();
	}
	store.callbacks.push({
		url: req.url,
		auth: req.headers.authorization,
		signed: verifyRequest(SECRET, 'POST', req.url, body.toString(), req.headers[SIGNATURE_HEADER]),
		body: JSON.parse(body.toString()),
	});
	res.writeHead(200);
	res.end();
});
await new Promise((ok) => launcher.listen(0, '127.0.0.1', ok));
const base = `http://127.0.0.1:${launcher.address().port}`;

// ---- the service, with a stand-in play ----
const played = [];
let release;
const play = async ({ draftDir, runtimeDir, contract, kind, scenarios, signal, out }) => {
	played.push({ at: Date.now(), kind, scenarios, contract });
	assert.equal(readFileSync(join(draftDir, 'runtime.json'), 'utf8'), 'file:/d/runtime.json');
	assert.ok(existsSync(join(draftDir, 'deploy/a/b.png')), 'nested draft files are written');
	assert.ok(existsSync(join(runtimeDir, 'index.html')));
	if (contract.hold)
		await new Promise((r) => {
			release = r;
			if (signal.aborted) r();
			signal.addEventListener('abort', r);
		});
	mkdirSync(join(out, 'units/u'), { recursive: true });
	writeFileSync(join(out, 'units/u/loaded.png'), 'PNG-loaded');
	writeFileSync(join(out, 'units/u/idle.png'), 'PNG-idle');
	return {
		draftId: 'd1',
		kind,
		scenarios: [
			{
				id: 'base',
				expected: ['loaded', 'idle'],
				reached: ['loaded', 'idle'],
				missing: [],
				stall: null,
				consoleErrors: [],
				shots: { loaded: 'units/u/loaded.png', idle: 'units/u/idle.png' },
			},
		],
	};
};
const player = createDraftPlayer({
	secret: SECRET,
	workDir: join(work, 'w'),
	play,
	chrome: '/bin/true',
	allowHttp: true,
});
const port = await player.listen(0, '127.0.0.1');
const origin = `http://127.0.0.1:${port}`;

const call = async (method, target, body, { secret = SECRET, sig } = {}) => {
	const raw = body === undefined ? '' : JSON.stringify(body);
	const res = await fetch(origin + target, {
		method,
		headers: { [SIGNATURE_HEADER]: sig ?? signRequest(secret, method, target, raw) },
		body: method === 'GET' ? undefined : raw,
	});
	return { status: res.status, body: await res.json() };
};
const request = (n, over = {}) => ({
	jobRef: `dp_${String(n).padStart(16, '0')}`,
	kind: 'lines',
	contract: { protocol: 'lines' },
	scenarios: ['base'],
	draft: {
		files: ['runtime.json', 'draft.json', 'deploy/a/b.png'].map((path) => ({
			path,
			url: `${base}/d/${path}`,
		})),
	},
	runtime: {
		version: '1.2.3',
		commit: 'abc',
		files: [{ path: 'index.html', url: `${base}/r/index.html` }],
	},
	put: {
		report: `${base}/put/${n}/report.json`,
		shots: [
			{
				scenario: 'base',
				screen: 'loaded',
				key: `k${n}/loaded.png`,
				url: `${base}/put/${n}/loaded.png`,
			},
			{ scenario: 'base', screen: 'idle', key: `k${n}/idle.png`, url: `${base}/put/${n}/idle.png` },
		],
	},
	callback: { url: `${base}/api/director/drafts/callback?run=r${n}`, token: `v1.9.tok${n}` },
	...over,
});
const until = async (test) => {
	for (let i = 0; i < 400; i++) {
		if (await test()) return;
		await new Promise((r) => setTimeout(r, 25));
	}
	throw new Error('timed out');
};
const status = async (ref) => (await call('GET', `/progress?jobRef=${ref}`)).body;

// refused: no / wrong / stale signature, a body that is not ours
assert.equal((await fetch(`${origin}/play`, { method: 'POST', body: '{}' })).status, 401);
assert.equal((await call('POST', '/play', request(1), { secret: 'wrong' })).status, 401);
assert.equal(
	(
		await call('POST', '/play', request(1), {
			sig: signRequest(SECRET, 'POST', '/play', JSON.stringify(request(1)), Date.now() - 600_000),
		})
	).status,
	401,
);
assert.equal((await call('POST', '/play', request(1, { jobRef: 'nope' }))).status, 400);
assert.equal(
	(
		await call(
			'POST',
			'/play',
			request(1, {
				draft: {
					files: [
						{ path: '../x', url: `${base}/x` },
						{ path: 'runtime.json', url: `${base}/y` },
						{ path: 'draft.json', url: `${base}/z` },
					],
				},
			}),
		)
	).status,
	400,
);
assert.equal(
	(await call('POST', '/play', request(1, { put: { report: 'x', shots: [] } }))).status,
	400,
);
assert.equal(played.length, 0, 'nothing refused was played');
assert.equal((await fetch(`${origin}/health`)).status, 200);
assert.deepEqual(await status('dp_ffffffffffffffff'), {
	jobRef: 'dp_ffffffffffffffff',
	status: 'unknown',
});

// a production instance refuses plain http and private hosts, whatever the signature says
{
	const strict = createDraftPlayer({
		secret: SECRET,
		workDir: join(work, 's'),
		play,
		chrome: '/bin/true',
	});
	const p = await strict.listen(0, '127.0.0.1');
	const raw = JSON.stringify(request(9));
	const res = await fetch(`http://127.0.0.1:${p}/play`, {
		method: 'POST',
		headers: { [SIGNATURE_HEADER]: signRequest(SECRET, 'POST', '/play', raw) },
		body: raw,
	});
	assert.equal(res.status, 400);
	assert.match((await res.json()).error, /presigned https/);
	await strict.close();
}

// a good play: 202 at once, then finished, uploaded, called back signed
{
	const r = await call('POST', '/play', request(1));
	assert.deepEqual(r, { status: 202, body: { jobRef: 'dp_0000000000000001', status: 'queued' } });
	await until(async () => (await status('dp_0000000000000001')).status === 'finished');
	await player.idle();
	const done = await status('dp_0000000000000001');
	assert.deepEqual(done.report.scenarios[0].shots, {
		loaded: 'k1/loaded.png',
		idle: 'k1/idle.png',
	});
	assert.equal(store.puts['/put/1/loaded.png'].toString(), 'PNG-loaded');
	assert.equal(JSON.parse(store.puts['/put/1/report.json']).scenarios[0].shots.idle, 'k1/idle.png');
	assert.equal(store.callbacks.length, 1);
	const cb = store.callbacks[0];
	assert.ok(cb.signed, 'the callback is signed over its own path');
	assert.equal(cb.auth, 'Bearer v1.9.tok1');
	assert.equal(cb.url, '/api/director/drafts/callback?run=r1');
	assert.equal(cb.body.status, 'finished');
	assert.equal(cb.body.jobRef, 'dp_0000000000000001');
	// a replay of the same jobRef is not played again
	assert.equal((await call('POST', '/play', request(1))).body.status, 'finished');
	assert.equal(played.length, 1);
}

// one at a time, in order; a queued play can be cancelled; the runtime is downloaded once
{
	const a = await call('POST', '/play', request(2, { contract: { hold: true } }));
	const b = await call('POST', '/play', request(3));
	const c = await call('POST', '/play', request(4));
	assert.equal(a.status, 202);
	await until(async () => (await status('dp_0000000000000002')).status === 'running');
	assert.equal((await status('dp_0000000000000003')).status, 'queued');
	assert.equal((await (await fetch(`${origin}/health`)).json()).queued, 2);
	assert.equal(
		(await call('POST', '/cancel', { jobRef: 'dp_0000000000000003' })).body.status,
		'failed',
	);
	release();
	await until(async () => (await status('dp_0000000000000004')).status === 'finished');
	await player.idle();
	assert.equal((await status('dp_0000000000000003')).error, 'cancelled');
	assert.deepEqual(
		played.map((p) => p.contract.hold ?? false),
		[false, true, false],
		'the cancelled play never ran',
	);
	assert.equal(
		store.gets.filter((g) => g === '/r/index.html').length,
		1,
		'the runtime is cached by version',
	);
	assert.deepEqual(
		store.callbacks.map((cb) => cb.body.jobRef),
		['dp_0000000000000001', 'dp_0000000000000002', 'dp_0000000000000004'],
	);
	void b;
	void c;
}

// a running play stops when cancelled, and a failure is a callback too
{
	await call('POST', '/play', request(5, { contract: { hold: true } }));
	await until(async () => (await status('dp_0000000000000005')).status === 'running');
	await call('POST', '/cancel', { jobRef: 'dp_0000000000000005' });
	await player.idle();
	assert.equal((await status('dp_0000000000000005')).error, 'cancelled');
	assert.equal(store.callbacks.at(-1).body.status, 'failed');
	await call(
		'POST',
		'/play',
		request(6, {
			draft: {
				files: [
					{ path: 'runtime.json', url: `${base}/d/runtime.json` },
					{ path: 'draft.json', url: `${base}/d/draft.json` },
					{ path: 'deploy/a/b.png', url: `http://127.0.0.1:1/gone` },
				],
			},
		}),
	);
	await player.idle();
	assert.equal((await status('dp_0000000000000006')).status, 'failed');
	assert.equal(store.callbacks.at(-1).body.status, 'failed');
}

await player.close();
launcher.close();
launcher.closeAllConnections();
rmSync(work, { recursive: true, force: true });
console.log('server.fixture: ok');
