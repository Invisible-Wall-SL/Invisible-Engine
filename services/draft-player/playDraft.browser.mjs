// The draft player against a real runtime and a real browser (ADR-0010 §5's local fixture): the
// harness's stand-in game for lines is the "draft", the locally built `apps/lines` runtime plays it
// in the headless shell, and the report must say what happened:
//   (a) a good draft reaches every expected screen of two scenarios, no console error, no stall;
//   (b) a draft the runtime refuses reports `bootRefused`, and a page that logs an error reports it
//       (here the Typekit kit offers no usable font: the game's own "Web font load inactive");
//   (c) a script whose wait can never hold reports the stall (op, frames, probe state) and lists
//       the screens it never reached.
//   (d) the service: a signed /play with presigned (local http) URLs downloads the draft and the
//       runtime, plays, uploads the report and the shots, and posts the signed callback.
// It is NOT named `*.fixture.mjs`: `pnpm check:all` runs every such file on CI, which has no runtime
// build, and this one builds it. Run by hand; the offline half is `playDraft.fixture.mjs`.
//
//   node --experimental-strip-types --import ./scripts/ts-loader.mjs \
//     services/draft-player/playDraft.browser.mjs [--runtime <dir>] [--chrome <exe>] [--keep]
//
// The runtime defaults to the harness's `.cache/current-games/runtimes/working-tree`, built (about
// 90 s) when it is missing; the stand-in games are written by `scripts/current-games/fixtures.mjs`
// when missing. Everything lives under `.cache/draft-player/`. Reads nothing from R2, writes nothing
// outside the repo's .cache.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { headlessShell } from '../../scripts/playtest/headless-shell.mjs';
import { beacon } from '../../scripts/current-games/lib/typekit.mjs';
import { buildWorkingTree } from '../../scripts/current-games/lib/runtimes.mjs';
import { playDraft } from './src/playDraft.mjs';
import { createDraftPlayer } from './src/server.mjs';
import { SIGNATURE_HEADER, signRequest, verifyRequest } from './src/signing.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const CG = join(ROOT, '.cache/current-games');
const WORK = join(ROOT, '.cache/draft-player');
const { values: opt } = parseArgs({
	options: { runtime: { type: 'string' }, chrome: { type: 'string' }, keep: { type: 'boolean' } },
});
const timings = [];
const timed = async (label, run) => {
	const t = Date.now();
	const value = await run();
	timings.push(`${label}: ${((Date.now() - t) / 1000).toFixed(1)} s`);
	return value;
};

// ---- inputs: the runtime, the stand-in game, a browser ----
const runtimeDir = await timed('runtime', async () => {
	if (opt.runtime) return resolve(opt.runtime);
	const dir = join(CG, 'runtimes/working-tree');
	return existsSync(join(dir, '.current-games-complete')) ? dir : buildWorkingTree(ROOT, CG);
});
const gamesFile = join(CG, 'fixtures/games.json');
if (!existsSync(gamesFile))
	assert.equal(
		spawnSync(
			process.execPath,
			[
				'--experimental-strip-types',
				'--import',
				'./scripts/ts-loader.mjs',
				'scripts/current-games/fixtures.mjs',
			],
			{ cwd: ROOT, stdio: 'inherit' },
		).status,
		0,
		'the stand-in games were written',
	);
const standIn = JSON.parse(readFileSync(gamesFile, 'utf8')).games.find((g) => g.key === 'cg-lines');
const chrome = headlessShell(opt.chrome);

rmSync(WORK, { recursive: true, force: true });
const draftDir = join(WORK, 'drafts/20261027T101530Z-3fa9');
mkdirSync(join(draftDir, 'deploy'), { recursive: true });
cpSync(join(standIn.local.snapshot, 'runtime.json'), join(draftDir, 'runtime.json'));
const draftJson = {
	draftId: '20261027T101530Z-3fa9',
	runtime: { version: 'local', commit: 'working-tree' },
	projectKey: standIn.key,
	name: standIn.name,
	standIn: true,
	assetBase: 'runtime',
};
writeFileSync(join(draftDir, 'draft.json'), JSON.stringify(draftJson));
const contract = standIn.local.manifestEntry;

// The Typekit kit of a sandbox with no route to Adobe: a stylesheet, a script that tells
// WebFontLoader its one face is there, and that face's bytes (any system font stands in for it).
const FONTS = [
	'/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf',
	'/usr/share/fonts/dejavu/DejaVuSerif.ttf',
	'/usr/share/fonts/TTF/DejaVuSerif.ttf',
];
const fontFile = FONTS.find((f) => existsSync(f));
assert.ok(fontFile, `a system font to stand in for the kit's face (looked in ${FONTS.join(', ')})`);
const FONT = readFileSync(fontFile);
const kit = (usable) => (url) => {
	const u = new URL(url);
	if (u.hostname === 'p.typekit.net') return beacon(url);
	if (u.hostname !== 'use.typekit.net') return undefined;
	if (u.pathname.endsWith('.css'))
		return {
			contentType: 'text/css',
			body: Buffer.from(
				usable
					? '@font-face{font-family:"cg-face";src:url("https://use.typekit.net/af/1/l") format("truetype");font-weight:400;font-style:normal;}'
					: '',
			),
		};
	if (u.pathname.startsWith('/af/')) return { contentType: 'font/ttf', body: FONT };
	return {
		contentType: 'text/javascript',
		body: Buffer.from(
			`window.Typekit={config:{fn:${usable ? "['cg-face',['n4']]" : '[]'}},load:function(){}};`,
		),
	};
};
const play = (label, over) =>
	timed(label, () =>
		playDraft({
			draftDir,
			runtimeDir,
			contract,
			kind: 'lines',
			chrome,
			out: join(WORK, `out-${label}`),
			intercept: kit(true),
			...over,
		}),
	);

// ---- (a) a good draft: two scenarios, five screens ----
{
	const r = await play('a-good', { scenarios: ['line-win', 'free-spins'] });
	assert.equal(r.draftId, draftJson.draftId);
	assert.equal(r.kind, 'lines');
	assert.match(r.contractHash, /^[0-9a-f]{16}$/);
	assert.equal(r.bootRefused, null);
	assert.deepEqual(
		r.scenarios.map((s) => s.id),
		['line-win', 'free-spins'],
	);
	for (const s of r.scenarios) {
		assert.deepEqual(s.missing, [], `${s.id}: every expected screen was reached`);
		assert.deepEqual(s.reached, s.expected);
		assert.equal(s.stall, null, `${s.id}: no stall`);
		assert.deepEqual(s.consoleErrors, [], `${s.id}: no console error`);
		assert.equal(s.error, null);
		for (const file of Object.values(s.shots))
			assert.ok(existsSync(join(WORK, 'out-a-good', file)), `${file} was written`);
	}
	assert.deepEqual(r.scenarios[1].expected, ['fs-trigger', 'fs-board', 'fs-spin', 'fs-settled']);
	assert.ok(existsSync(join(WORK, 'out-a-good/report.json')));
}

// ---- (b) a broken draft: the runtime refuses it; a page that logs an error says so ----
{
	const broken = join(WORK, 'drafts/broken');
	cpSync(draftDir, broken, { recursive: true });
	const bundle = JSON.parse(readFileSync(join(broken, 'runtime.json'), 'utf8'));
	bundle.doc.scenes = [];
	writeFileSync(join(broken, 'runtime.json'), JSON.stringify(bundle));
	const r = await play('b-refused', { draftDir: broken, scenarios: ['line-win', 'free-spins'] });
	assert.match(r.bootRefused, /^runtime bundle shape invalid/);
	assert.equal(r.scenarios.length, 2);
	assert.deepEqual(r.scenarios[0].reached, []);
	assert.deepEqual(r.scenarios[0].missing, ['line-win']);
	assert.match(r.scenarios[0].consoleErrors.join('\n'), /boot stopped/);
	assert.equal(r.scenarios[0].stall, null, 'a refused boot is not a stall');
	assert.match(
		r.scenarios[1].error,
		/^not played: the runtime refused/,
		'the rest are not booted again',
	);
	assert.equal(r.scenarios[1].seconds, 0);

	const noisy = await play('b-console', { scenarios: ['line-win'], intercept: kit(false) });
	assert.equal(noisy.bootRefused, null);
	assert.deepEqual(noisy.scenarios[0].missing, [], 'the screen was still reached');
	assert.deepEqual(noisy.scenarios[0].consoleErrors, ['[error] Web font load inactive']);
}

// ---- (c) a stuck state: a wait that can never hold ----
{
	const screens = join(WORK, 'stuck.json');
	writeFileSync(
		screens,
		JSON.stringify({
			gameType: 'lines',
			scenarios: [
				{
					id: 'stuck',
					env: {},
					steps: [
						{ op: 'waitFor', until: { loaded: true, idle: true }, maxFrames: 7200 },
						{ op: 'capture', screen: 'loaded' },
						{ op: 'waitFor', until: { screen: 'no-such-screen' }, maxFrames: 120 },
						{ op: 'capture', screen: 'never' },
					],
				},
			],
		}),
	);
	const r = await play('c-stuck', { screens });
	const s = r.scenarios[0];
	assert.deepEqual(s.reached, ['loaded']);
	assert.deepEqual(s.missing, ['never']);
	assert.equal(s.stall.op, 'waitFor');
	assert.equal(s.stall.step, 3);
	assert.ok(s.stall.frames > 0, 'the frame the wait gave up on');
	assert.ok(Array.isArray(s.stall.probe.screens), 'the probe state at the stall');
	assert.equal(s.error, null);
	console.log(
		`stall: ${JSON.stringify({ ...s.stall, probe: { frame: s.stall.probe.frame, screens: s.stall.probe.screens } })}`,
	);
}

// ---- (d) the service end to end: download, play, upload, callback ----
{
	const SECRET = 'browser-fixture-secret';
	const files = (root) =>
		readdirSync(root, { recursive: true, withFileTypes: true })
			.filter((e) => e.isFile())
			.map((e) => join(e.parentPath ?? e.path, e.name).slice(root.length + 1));
	const received = { puts: {}, callback: null };
	const store = createServer(async (req, res) => {
		const chunks = [];
		for await (const c of req) chunks.push(c);
		const body = Buffer.concat(chunks);
		const [, kind, ...rest] = req.url.split('?')[0].split('/');
		const rel = decodeURIComponent(rest.join('/'));
		if (req.method === 'GET' && (kind === 'draft' || kind === 'runtime')) {
			const file = join(kind === 'draft' ? draftDir : runtimeDir, rel);
			if (!existsSync(file) || !statSync(file).isFile()) return res.writeHead(404).end();
			return res.writeHead(200).end(readFileSync(file));
		}
		if (req.method === 'PUT') received.puts[rel] = body;
		else
			received.callback = {
				auth: req.headers.authorization,
				signed: verifyRequest(
					SECRET,
					'POST',
					req.url,
					body.toString(),
					req.headers[SIGNATURE_HEADER],
				),
				body: JSON.parse(body.toString()),
			};
		res.writeHead(200).end();
	});
	await new Promise((ok) => store.listen(0, '127.0.0.1', ok));
	const base = `http://127.0.0.1:${store.address().port}`;
	const player = createDraftPlayer({
		secret: SECRET,
		workDir: join(WORK, 'service'),
		chrome,
		allowHttp: true,
	});
	const port = await player.listen(0, '127.0.0.1');
	const body = JSON.stringify({
		jobRef: 'dp_00000000000000d1',
		kind: 'lines',
		contract,
		scenarios: ['line-win'],
		draft: { files: files(draftDir).map((path) => ({ path, url: `${base}/draft/${path}` })) },
		runtime: {
			version: 'local',
			commit: 'working-tree',
			files: files(runtimeDir).map((path) => ({ path, url: `${base}/runtime/${path}` })),
		},
		put: {
			report: `${base}/put/report.json`,
			shots: [
				{
					scenario: 'line-win',
					screen: 'line-win',
					key: 'shots/line-win.png',
					url: `${base}/put/shots/line-win.png`,
				},
			],
		},
		callback: { url: `${base}/callback?run=r1`, token: 'v1.9.token' },
	});
	await timed('d-service', async () => {
		const res = await fetch(`http://127.0.0.1:${port}/play`, {
			method: 'POST',
			headers: { [SIGNATURE_HEADER]: signRequest(SECRET, 'POST', '/play', body) },
			body,
		});
		assert.equal(res.status, 202);
		await player.idle();
	});
	await player.close();
	store.close();
	store.closeAllConnections();
	const cb = received.callback;
	assert.ok(cb?.signed, 'the callback is signed');
	assert.equal(cb.auth, 'Bearer v1.9.token');
	assert.equal(cb.body.status, 'finished', cb.body.error);
	const sc = cb.body.report.scenarios[0];
	assert.deepEqual(sc.missing, []);
	assert.deepEqual(sc.shots, { 'line-win': 'shots/line-win.png' });
	assert.equal(received.puts['shots/line-win.png'].subarray(1, 4).toString(), 'PNG');
	assert.equal(JSON.parse(received.puts['report.json']).draftId, draftJson.draftId);
}

if (!opt.keep) rmSync(join(WORK, 'drafts'), { recursive: true, force: true });
console.log(`playDraft.browser: ok\n  ${timings.join('\n  ')}`);
