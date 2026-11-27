// Invisible Profiler lab run (P6, docs/design/invisible-profiler.md §6): plays a PUBLISHED game in
// the headless shell with `?perf=1` (`lab-sequence.mjs`: idle 20 s, 10 spins, a forced feature where
// the mock takes one) and posts the probe's reading to the launcher as a `lab` reading, which the
// Profiler compares with the game's previous lab reading on counts, never on fps.
//
//   node --experimental-strip-types --no-warnings --import ./scripts/ts-loader.mjs \
//     scripts/playtest/lab-run.mjs (--game <key>[,<key>…] | --all) [--out <dir>] [--chrome <exe>] \
//     [--spins 10] [--idle 20] [--no-post]
//
// Env (the current-games harness's own, no new secret): PIPELINE_GAMES_URL
// (https://<launcher>/api/pipeline/games — the launcher is its origin) and PIPELINE_CI_TOKEN, the
// bearer that opens each game's lab session (`POST /api/pipeline/profiler-lab`, a 2-hour capture
// token for that one game). `--all` plays every live online game of a project.
//
// Local, with no launcher: `--local <fixture key> --runtime <built apps/lines>` plays a
// current-games stand-in snapshot (`scripts/current-games/fixtures.mjs`, e.g. `cg-lines`) on the
// real test server, and prints the counts instead of posting them.
//
// The reading is posted from here with the session token, not by the probe: the game URL carries
// no `perfsession`, so the probe never sends on its own (a page hidden as the browser closes would
// leave a second reading). P7 swaps `openLabPage` for a remote Playwright browser; the sequence and
// the post stay as they are.
//
// Output: <out>/<game>.json (the run, the counts, the post outcome) and <out>/<game>.report.json
// (the reading). Exit 1 when any game failed.

import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

import { perfCounts } from '../../apps/launcher-api/src/lib/profilerLab.ts';
import { familyOfKind } from '../../packages/constants-shared/gameKinds.ts';
import { perfSenderTo } from '../../apps/lines/src/game/perfSendCore.ts';
import { openPage } from '../current-games/lib/browser.mjs';
import { listGames } from '../current-games/lib/games.mjs';
import { serveSnapshot, startTestServer, testServerTree } from '../current-games/lib/serve.mjs';
import { headlessShell } from './headless-shell.mjs';
import { LAB_DEFAULTS, LabRunError, playLabSequence } from './lab-sequence.mjs';

const ROOT = resolve(import.meta.dirname, '../..');
const { values: opt } = parseArgs({
	options: {
		game: { type: 'string' },
		all: { type: 'boolean', default: false },
		local: { type: 'string' },
		runtime: { type: 'string' },
		out: { type: 'string', default: join(ROOT, '.cache/lab-run') },
		chrome: { type: 'string' },
		spins: { type: 'string', default: String(LAB_DEFAULTS.spins) },
		idle: { type: 'string', default: String(LAB_DEFAULTS.idleSeconds) },
		'no-post': { type: 'boolean', default: false },
	},
});
if (!opt.game && !opt.all && !opt.local) {
	console.error('--game <key>[,<key>…], --all or --local <fixture key> is required');
	process.exit(2);
}
if (opt.local && !opt.runtime) {
	console.error('--local needs --runtime <built apps/lines>');
	process.exit(2);
}
const out = resolve(opt.out);
mkdirSync(out, { recursive: true });
const CHROME = headlessShell(opt.chrome);
/** The beat a kind's mock forces into a feature (`/force?beat=`), where its mock has one. */
const FEATURE_BEAT = { holdAndWin: 'trigger' };

/**
 * The local browser as the lab sequence drives it: the current-games harness's headless-shell page
 * (`openPage`: 1280×720, DPR 1, focused, real frame clock) behind the Playwright `Page` calls the
 * sequence makes. P7 replaces this with a remote Playwright page.
 */
/** A renderer stuck in a loop never answers CDP: fail the game instead of hanging the job. */
const answered = (promise) =>
	Promise.race([
		promise,
		new Promise((_, reject) =>
			setTimeout(() => reject(new LabRunError('the page stopped answering')), 30_000).unref(),
		),
	]);

async function openLabPage(profile) {
	const page = await openPage(CHROME, profile);
	return {
		goto: async (url) => {
			const { result } = await page.navigate(url);
			if (result?.errorText) throw new LabRunError(`navigate: ${result.errorText}`);
		},
		evaluate: (expression) => answered(page.evaluate(expression)),
		keyboard: {
			press: async (key) => {
				await page.key('keyDown', key);
				await page.key('keyUp', key);
			},
		},
		screenshot: () => answered(page.screenshot()),
		consoleLines: page.consoleLines,
		close: () => page.close(),
	};
}

/** A URL with its query dropped: the card URL carries the project's read token. */
const redact = (url) => url.split('?')[0];
/** Any read token (`k=`) in a line the run keeps: results are uploaded as a CI artifact. */
const scrub = (line) => line.replace(/([?&]k=)[^&\s"']+/g, '$1…');

async function launcherBase() {
	const games = process.env.PIPELINE_GAMES_URL;
	if (!games || !URL.canParse(games)) throw new Error('PIPELINE_GAMES_URL is not set');
	return new URL(games).origin;
}

async function openLabSession(base, game) {
	const res = await fetch(`${base}/api/pipeline/profiler-lab`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${process.env.PIPELINE_CI_TOKEN}`,
			'content-type': 'application/json',
		},
		body: JSON.stringify({
			game,
			label: `lab · ${process.env.GITHUB_ACTIONS ? 'CI' : hostname()}`,
		}),
		signal: AbortSignal.timeout(60_000),
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(`lab session for ${game}: HTTP ${res.status} ${body.error ?? ''}`);
	return body;
}

/** The game URL a lab run opens: the probe on, and a session of its own on the mock. */
function labUrl(cardUrl) {
	const url = new URL(cardUrl);
	url.searchParams.set('perf', '1');
	url.searchParams.set('sessionID', `lab-${randomUUID().slice(0, 8)}`);
	return url;
}

/** Ask the game's mock to force a feature into this session's next round. */
const forcer = (url, kind) => async () => {
	const beat = FEATURE_BEAT[kind];
	const rgs = url.searchParams.get('rgs_url');
	if (!beat || !rgs) return 'no forced feature for this kind';
	const base = /^https?:\/\//.test(rgs) ? rgs : `${url.protocol}//${rgs}`;
	const sid = url.searchParams.get('sessionID');
	const res = await fetch(
		`${base.replace(/\/+$/, '')}/force?sid=${encodeURIComponent(sid)}&beat=${encodeURIComponent(beat)}`,
		{ method: 'POST', signal: AbortSignal.timeout(30_000) },
	).catch((e) => ({ ok: false, status: e.message }));
	return res.ok ? true : `the mock refused the beat (${res.status})`;
};

/** A stand-in snapshot on the real test server: `{ url, close }`. */
async function localGame(key, work) {
	const fixtures = join(work, 'fixtures');
	const made = spawnSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--no-warnings',
			'--import',
			'./scripts/ts-loader.mjs',
			'scripts/current-games/fixtures.mjs',
			'--out',
			fixtures,
		],
		{ cwd: ROOT, stdio: ['ignore', 'ignore', 'inherit'] },
	);
	if (made.status !== 0) throw new Error('the current-games fixtures did not build');
	const game = JSON.parse(readFileSync(join(fixtures, 'games.json'), 'utf8')).games.find(
		(g) => g.key === key,
	);
	if (!game) throw new Error(`no stand-in game ${key}`);
	const tree = testServerTree(
		join(work, 'tree'),
		resolve(opt.runtime),
		game.key,
		game.local.manifestEntry,
	);
	const server = await startTestServer(tree, {});
	const snap = await serveSnapshot({
		dir: game.local.snapshot,
		name: game.key,
		snapshotId: 'lab',
		assetBase: `${server.origin}/${game.key}/`,
	});
	const params = new URLSearchParams({
		runtime: '1',
		project: game.projectKey ?? game.key,
		k: 'lab-run',
		editorDocBase: snap.origin,
		rgs_url: `${server.origin.replace(/^http:\/\//, '')}/api/${game.key}`,
		sessionID: 'demo',
		lang: 'en',
		currency: 'USD',
		device: 'desktop',
	});
	return {
		game,
		url: `${server.origin}/${game.key}/?${params}`,
		close: async () => {
			server.stop();
			await snap.close();
		},
	};
}

async function playOne(key, listedKind, base) {
	let kind = listedKind;
	const work = mkdtempSync(join(tmpdir(), 'lab-run-'));
	const result = { game: key, kind, startedAt: new Date().toISOString(), ok: false };
	let local;
	let page;
	try {
		let session;
		let cardUrl;
		if (opt.local) {
			local = await localGame(key, work);
			cardUrl = local.url;
			kind = local.game.gameType ?? kind;
			result.kind = kind;
		} else {
			session = await openLabSession(base, key);
			cardUrl = session.game.url;
		}
		const url = labUrl(cardUrl);
		console.log(`▶ ${key} (${kind ?? 'kind?'}) ${redact(cardUrl)}`);
		page = await openLabPage(join(work, 'profile'));
		await page.goto(url.toString());
		const { text, run } = await playLabSequence(page, {
			// Only a slot plays rounds; free play (arcade, match-3, card) idles only.
			rounds: familyOfKind(kind) === 'slot',
			spins: Number(opt.spins),
			idleSeconds: Number(opt.idle),
			force: forcer(url, kind),
			log: (line) => console.log(`  ${key}: ${line}`),
		});
		const report = JSON.parse(text);
		result.run = run;
		result.fps = {
			note: 'not comparable: a shared runner swings ~2× run to run',
			...(report.kind === 'arcade'
				? { menu: report.menu?.fps, play: report.play?.fps }
				: { idle: report.idle?.fps, spinning: report.spinning?.fps }),
		};
		result.counts = perfCounts(report);
		writeFileSync(join(out, `${key}.report.json`), text);
		if (session && !opt['no-post']) {
			const sent = await perfSenderTo(base, session.token).send(text);
			result.posted = sent;
			if (!sent.ok) throw new Error(`post: ${sent.error}`);
		}
		result.ok = true;
	} catch (e) {
		result.error = scrub(e instanceof Error ? e.message : String(e));
		if (page) result.console = page.consoleLines.slice(-10).map(scrub);
		if (page)
			writeFileSync(join(out, `${key}.failed.png`), await page.screenshot().catch(() => ''));
	} finally {
		await page?.close().catch(() => undefined);
		await local?.close();
		// Windows can hold the shell's profile a moment after it exits: a leftover temp dir is harmless.
		try {
			rmSync(work, { recursive: true, force: true, maxRetries: 5 });
		} catch {
			console.warn(`  ${key}: could not remove ${work}`);
		}
	}
	result.endedAt = new Date().toISOString();
	writeFileSync(join(out, `${key}.json`), JSON.stringify(result, null, '\t'));
	return result;
}

const base = opt.local ? null : await launcherBase();
let targets;
if (opt.local) targets = [{ key: opt.local, kind: undefined }];
else {
	const live = (await listGames({})).filter((g) => g.projectKey && !g.hasOwnBuiltBundle);
	const kindOf = (key) => live.find((g) => g.key === key)?.gameType;
	targets = opt.all
		? live.map((g) => ({ key: g.key, kind: g.gameType }))
		: opt.game.split(',').map((key) => ({ key: key.trim(), kind: kindOf(key.trim()) }));
}

const results = [];
for (const t of targets) results.push(await playOne(t.key, t.kind, base));

const fmt = (c) =>
	c
		? `draws ${c.draws} · passes ${c.passes} · uploads ${c.textureUploads} · GL calls ${c.calls} · JS ${c.jsMs} ms`
		: '—';
for (const r of results) {
	console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.game}${r.error ? ` — ${r.error}` : ''}`);
	if (r.counts) {
		console.log(`  idle      ${fmt(r.counts.idle)}`);
		console.log(`  spinning  ${fmt(r.counts.spinning)}`);
		console.log(`  texture   ${r.counts.textureMb} MB · run ${JSON.stringify(r.run)}`);
	}
}
writeFileSync(join(out, 'summary.json'), JSON.stringify(results, null, '\t'));
process.exit(results.every((r) => r.ok) ? 0 : 1);
