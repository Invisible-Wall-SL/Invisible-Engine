// Offline fixture: a build pulls only the deploy/ art the game can load.
//
//   node apps/launcher-api/scripts/check-pull-reachability.mjs
//
// WHY. `pull-project-assets.mjs` mirrored ALL of `<client>/<project>/deploy/` into the build and
// pruned stale copies only inside the export-generated subtrees. Anything the Atlas Maker's Deploy
// button had written to `sprites/`, `spines/`, … shipped whether the game loaded it or not, and
// never left a checkout once pulled — Test6's publish stopped at the portal's 32 MB file limit on a
// `sprites/S_Background/S_Background.webp` no code names. The first fix still shipped it: Test6's
// repo COMMITS a 377 MB snapshot of `static/assets/`, including a 77 MB `S_Background.png` that
// 🗜 Optimize turned into that WebP, and committed files were only reported. Claims:
//
//   1. The scanner: a literal `assets/<folder>/<name>/…` path is reachable with its siblings; a
//      runtime-built `assets/<folder>/${x}` keeps that folder; a comment keeps nothing; a bare
//      `assets/` base keeps nothing; a data file's prefix-less rel counts.
//   2. On the REAL engine source, every literal asset path the game names is reachable, and
//      `sprites/S_Background/` is not.
//   3. The prune decision: a generated file converges on the listing; an unloaded file is
//      deleted in a game repo even when committed; in the engine's own apps a committed one is
//      only reported, as is any file when git cannot tell.
//   4. End to end against a fake /api/deploy, in a standalone game checkout: unloaded deploy
//      folders are not pulled, a chain through a kept descriptor is followed, stale generated
//      files, stale unloaded copies AND committed unloaded files are deleted (and named in the
//      log), and `--no-prune` still mirrors everything.

import { spawn, spawnSync } from 'node:child_process';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	collectRefs,
	emptyRefs,
	foundGameRefs,
	isReachable,
	pruneDecision,
	scanSources,
} from './lib/assetReachability.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENGINE = join(HERE, '..', '..', '..');
const PULL = join(HERE, 'pull-project-assets.mjs');

let checks = 0;
const ok = (label, cond, detail = '') => {
	if (!cond) {
		console.error(`\n✗ ${label}${detail ? ` — ${detail}` : ''}\n`);
		process.exit(1);
	}
	checks++;
	console.log(`  ok ${label}`);
};

console.log('1. the scanner');
{
	const refs = collectRefs(
		emptyRefs(),
		[
			"const a = new URL('../../assets/sprites/reelsFrame/reels_frame.json', import.meta.url);",
			'const b = `assets/spines/${name}/skeleton.json`;',
			'// the old sheet lived at assets/sprites/Old/old.webp',
			'/* every sheet under `static/assets/sprites/` */',
			"const base = 'assets/';",
			"const url = 'https://cdn.example/x'; const c = 'assets/audio/sounds.json';",
		].join('\n'),
	);
	ok('a literal path is reachable', isReachable('sprites/reelsFrame/reels_frame.json', refs));
	ok(
		'  and so are its siblings (the page)',
		isReachable('sprites/reelsFrame/reels_frame.webp', refs),
	);
	ok(
		'  but not a neighbouring folder',
		!isReachable('sprites/S_Background/S_Background.webp', refs),
	);
	ok('a runtime-built path keeps its folder', isReachable('spines/anything/a.atlas', refs));
	ok('a comment keeps nothing', !isReachable('sprites/Old/old.webp', refs));
	ok('a bare assets/ base keeps nothing', !isReachable('fonts/x/x.fnt', refs));
	ok('a `//` inside a string is not a comment', isReachable('audio/sounds.mp3', refs));
	ok('generated subtrees are always reachable', isReachable('_pages/abc.webp', refs));

	const data = collectRefs(
		emptyRefs(),
		JSON.stringify({ json: 'sprites/fromData/a.json', key: 'acme/game/spines/R_Wins/' }),
		{ json: true, tops: ['sprites', 'spines'] },
	);
	ok("a data file's prefix-less rel counts", isReachable('sprites/fromData/a.webp', data));
	ok('  and an R2 key naming a folder counts', isReachable('spines/R_Wins/R_Wins.json', data));
	ok('  but an unnamed folder does not', !isReachable('sprites/S_Background/x.webp', data));
}

console.log('2. the real engine source');
{
	const packages = readdirSync(join(ENGINE, 'packages')).map((p) =>
		join(ENGINE, 'packages', p, 'src'),
	);
	const { refs, scanned } = await scanSources(
		[join(ENGINE, 'apps/lines/src'), ...packages],
		['sprites', 'spines', 'fonts', 'audio'],
	);
	ok(`the scan reads the game (${scanned} files)`, scanned > 100 && foundGameRefs(refs));
	for (const rel of [
		'sprites/symbolsStatic/symbolsStatic.json',
		'sprites/reelsFrame/reels_frame.json',
		'spines/symbols/h1.json',
		'fonts/goldFont/mm_gold.xml',
		'audio/sounds.json',
	])
		ok(`  ${rel} is reachable`, isReachable(rel, refs));
	ok(
		'  sprites/S_Background/ is not',
		!isReachable('sprites/S_Background/S_Background.webp', refs),
	);
}

console.log('3. the prune decision');
{
	const refs = collectRefs(emptyRefs(), "'assets/sprites/reelsFrame/reels_frame.json'");
	const listed = new Set(['_pages/live.webp']);
	const tracked = new Set(['sprites/S_Background/S_Background.png']);
	const game = { listed, refs, tracked: null, standalone: true };
	const engine = { listed, refs, tracked, standalone: false };
	const unused = 'sprites/S_Background/S_Background.png';
	ok('a listed generated page stays', pruneDecision('_pages/live.webp', game) === 'keep');
	ok('an unlisted generated page goes', pruneDecision('_pages/old.webp', engine) === 'delete');
	ok('loaded art stays', pruneDecision('sprites/reelsFrame/reels_frame.png', game) === 'keep');
	ok(
		'a game repo deletes unloaded art even when committed',
		pruneDecision(unused, game) === 'delete',
	);
	ok('an engine app only reports its committed art', pruneDecision(unused, engine) === 'report');
	ok(
		'  but deletes an uncommitted copy',
		pruneDecision('sprites/Old/old.webp', engine) === 'delete',
	);
	ok(
		'  and reports when git cannot tell',
		pruneDecision('sprites/Old/old.webp', { ...engine, tracked: null }) === 'report',
	);
	ok(
		'no game code found keeps everything outside the generated subtrees',
		pruneDecision(unused, { ...game, refs: null }) === 'keep',
	);
}

console.log('4. end to end');
{
	const TOKEN = 'fixture-token';
	const deploy = {
		'sprites/symbolsStatic/symbolsStatic.json': JSON.stringify({
			meta: { image: 'symbolsStatic.webp', related: 'spines/chained/c.json' },
		}),
		'sprites/symbolsStatic/symbolsStatic.webp': 'page',
		'spines/chained/c.json': '{}',
		'sprites/S_Background/S_Background.webp': 'x'.repeat(4096),
		'editor-art/a/a.json': '{}',
		'_pages/p.webp': 'p',
	};
	const server = createServer((req, res) => {
		const url = new URL(req.url, 'http://x');
		if (url.searchParams.get('k') !== TOKEN) return res.writeHead(401).end();
		const rel = url.searchParams.get('rel');
		if (rel === null) {
			res.writeHead(200, { 'content-type': 'application/json' });
			return res.end(
				JSON.stringify({
					files: Object.entries(deploy).map(([r, b]) => ({ rel: r, size: b.length })),
				}),
			);
		}
		if (!(rel in deploy)) return res.writeHead(404).end();
		res.writeHead(200).end(deploy[rel]);
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;

	const game = mkdtempSync(join(tmpdir(), 'pull-reach-'));
	const assets = join(game, 'static', 'assets');
	const put = (rel, body = 'x') => {
		mkdirSync(dirname(join(assets, rel)), { recursive: true });
		writeFileSync(join(assets, rel), body);
	};
	const git = (...a) => spawnSync('git', a, { cwd: game, encoding: 'utf8' });
	git('init', '-q');
	put('sprites/Committed/c.png', 'y'.repeat(2 * 1048576));
	git('add', '.');
	git('-c', 'user.email=f@x', '-c', 'user.name=f', 'commit', '-qm', 'seed');
	put('sprites/OldPull/old.webp');
	put('_pages/stale.webp');

	const reportDir = mkdtempSync(join(tmpdir(), 'pull-report-'));
	const pullReport = () => JSON.parse(readFileSync(join(reportDir, 'pull.json'), 'utf8'));
	const run = (...extra) =>
		new Promise((resolveRun) => {
			const child = spawn(
				process.execPath,
				[
					PULL,
					'--project',
					'acme/game',
					'--dest',
					assets,
					'--base',
					base,
					'--token',
					TOKEN,
					...extra,
				],
				{
					cwd: game,
					env: { ...process.env, IE_OPTIMIZE_ASSETS: '', IE_BUILD_REPORT_DIR: reportDir },
				},
			);
			let out = '';
			child.stdout.on('data', (d) => (out += d));
			child.stderr.on('data', (d) => (out += d));
			child.on('close', (code) => resolveRun({ code, out }));
		});
	const has = (rel) => existsSync(join(assets, rel));

	try {
		const first = await run();
		ok('the pull succeeds', first.code === 0, first.out);
		ok('code-named art is pulled', has('sprites/symbolsStatic/symbolsStatic.json'));
		ok('generated art is pulled', has('editor-art/a/a.json') && has('_pages/p.webp'));
		ok('a folder only a kept descriptor names is followed', has('spines/chained/c.json'));
		ok('an unloaded deploy folder is NOT pulled', !has('sprites/S_Background/S_Background.webp'));
		ok('  and the log names it', first.out.includes('sprites/S_Background'), first.out);
		ok('a stale unloaded copy from an earlier pull is deleted', !has('sprites/OldPull/old.webp'));
		ok('  with its now-empty folder', !has('sprites/OldPull'));
		ok('a stale generated page is deleted', !has('_pages/stale.webp'));
		ok('a committed unloaded file is deleted too (a game repo)', !has('sprites/Committed/c.png'));
		ok(
			'  and the log names it with its size',
			/Removed[^]*sprites\/Committed {2}\(1 file\(s\), 2\.0 MB\)/.test(first.out),
			first.out,
		);

		const report = pullReport();
		ok(
			'the build report lists what was not pulled, with its size',
			report.notPulled.some(
				(f) => f.rel === 'sprites/S_Background/S_Background.webp' && f.bytes === 4096,
			),
			JSON.stringify(report.notPulled),
		);
		ok(
			'  and what was removed, sized before it was deleted',
			report.removed.some((f) => f.rel === 'sprites/Committed/c.png' && f.bytes === 2 * 1048576),
			JSON.stringify(report.removed),
		);
		ok('  and no optimize section without 🗜', report.optimize === null);

		put('sprites/symbolsStatic/symbolsStatic.png', 'z'.repeat(777));
		const trimmed = await run('--optimize');
		const twins = pullReport().optimize?.imagesDeleted ?? [];
		ok(
			'🗜: the dropped image twin is in the report with its size',
			trimmed.code === 0 &&
				twins.some((f) => f.rel === 'sprites/symbolsStatic/symbolsStatic.png' && f.bytes === 777),
			JSON.stringify(twins),
		);

		const all = await run('--no-prune');
		ok(
			'--no-prune mirrors everything',
			all.code === 0 && has('sprites/S_Background/S_Background.webp'),
		);
	} finally {
		server.close();
		rmSync(game, { recursive: true, force: true });
		rmSync(reportDir, { recursive: true, force: true });
	}
}

console.log(`\nPASS — ${checks} checks.`);
