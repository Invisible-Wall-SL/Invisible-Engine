// Offline fixture: a build pinned to one art tier ships only that tier.
//
//   node apps/launcher-api/scripts/check-art-tier-pin.mjs
//
// WHY. A project that publishes resolution tiers (`docs/design/arcade-4k-builds.md` Phase 3) ships
// every page twice, and a build for one kind of screen only ever loads one copy. `IE_ART_TIER`
// pins it: `config-vite` compiles the tier into the game, the pull leaves the other copy out.
// Claims:
//
//   1. The tier list the pin accepts is `engine-layout` `RESOLUTION_TIERS` plus `full`, and a bad
//      value throws; `config-vite` compiles the pin (or `''`) as `__IE_ART_TIER__`.
//   2. The drop rule, on names: `full` drops every `@half` copy; `half` drops each full file that
//      has a half copy, and nothing else. A file a kept sheet or atlas names stays; an export's
//      `index.json`, which names every tier and is never loaded, does not count.
//   3. End to end against a fake /api/deploy: pinned `half`, no full copy that has a half one
//      lands, a full page a half atlas still names does, and the report sizes what was left out;
//      pinned `full`, a half copy an earlier pull left is deleted; unpinned, everything ships; a
//      bad value refuses before anything is fetched.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RESOLUTION_TIERS } from '../../../packages/engine-layout/src/lib/resolutionTiers.ts';
import { artTierDefine, PINNABLE_TIERS } from '../../../packages/config-vite/artTierPin.js';
import { artTierDrop, fullSiblingOf, parseArtTierPin } from './lib/artTierPin.mjs';

const PULL = join(dirname(fileURLToPath(import.meta.url)), 'pull-project-assets.mjs');

let checks = 0;
const ok = (name, cond, detail = '') => {
	checks++;
	if (!cond) {
		console.error(`FAIL ${name}${detail ? `\n${detail}` : ''}`);
		process.exit(1);
	}
	console.log(`ok   ${name}`);
};
const throws = (fn) => {
	try {
		fn();
		return false;
	} catch {
		return true;
	}
};

console.log('1. the tier list and the compiled pin');
{
	ok(
		'the pinnable tiers are RESOLUTION_TIERS plus full',
		JSON.stringify([...PINNABLE_TIERS].sort()) ===
			JSON.stringify(['full', ...Object.keys(RESOLUTION_TIERS)].sort()),
		JSON.stringify(PINNABLE_TIERS),
	);
	ok('unset is no pin', parseArtTierPin(undefined) === null && parseArtTierPin(' ') === null);
	ok(
		'half and full parse',
		parseArtTierPin('half') === 'half' && parseArtTierPin('full') === 'full',
	);
	ok(
		'a typo throws',
		throws(() => parseArtTierPin('hlaf')),
	);
	const define = (value) => {
		const saved = process.env.IE_ART_TIER;
		if (value === undefined) delete process.env.IE_ART_TIER;
		else process.env.IE_ART_TIER = value;
		try {
			return artTierDefine().__IE_ART_TIER__;
		} finally {
			if (saved === undefined) delete process.env.IE_ART_TIER;
			else process.env.IE_ART_TIER = saved;
		}
	};
	ok('an unpinned build compiles an empty pin', define(undefined) === '""');
	ok('a pinned build compiles its tier', define('half') === '"half"');
	ok(
		'a build with a bad pin does not compile',
		throws(() => define('quarter')),
	);
}

console.log('2. the drop rule');
{
	ok(
		'a tier file names its full copy',
		fullSiblingOf('_pages/abc@half.pm.ktx2')?.full === '_pages/abc.pm.ktx2' &&
			fullSiblingOf('editor-art/s/s.3@half.ktx2.json')?.full === 'editor-art/s/s.3.ktx2.json' &&
			fullSiblingOf('_pages/abc.webp') === null &&
			fullSiblingOf('sprites/me@halfway.webp') === null,
	);
	const rels = [
		'_pages/a.webp',
		'_pages/a@half.webp',
		'_pages/b.webp',
		'_pages/c.webp',
		'_pages/c@half.webp',
		'editor-art/s/s.1.json',
		'editor-art/s/s.1@half.json',
		'editor-art/index.json',
	];
	const texts = {
		'editor-art/s/s.1.json': '{"meta":{"image":"../../_pages/a.webp"}}',
		'editor-art/s/s.1@half.json': '{"meta":{"image":"../../_pages/a@half.webp"}}',
		'editor-art/index.json': '["a.webp","a@half.webp","c.webp","c@half.webp","s.1.json"]',
	};
	const textOf = async (rel) => texts[rel] ?? '';
	const half = await artTierDrop(rels, 'half', textOf);
	ok(
		'half drops each full file that has a half copy',
		JSON.stringify(half.drop) ===
			JSON.stringify(['_pages/a.webp', '_pages/c.webp', 'editor-art/s/s.1.json']),
		JSON.stringify(half.drop),
	);
	ok('  and keeps a page with no half copy', !half.drop.includes('_pages/b.webp'));
	ok('  and the index.json naming them all did not keep them', half.named.length === 0);
	const full = await artTierDrop(rels, 'full', textOf);
	ok(
		'full drops every half copy',
		JSON.stringify(full.drop) ===
			JSON.stringify(['_pages/a@half.webp', '_pages/c@half.webp', 'editor-art/s/s.1@half.json']),
		JSON.stringify(full.drop),
	);
	const atlasNamesC = await artTierDrop(rels, 'half', async (rel) =>
		rel === 'editor-art/s/s.1@half.json' ? 'c.webp\nsize: 4,4\n' : await textOf(rel),
	);
	ok(
		'a dropped file a kept descriptor names stays',
		!atlasNamesC.drop.includes('_pages/c.webp') &&
			atlasNamesC.named.some((n) => n.rel === '_pages/c.webp'),
		JSON.stringify(atlasNamesC),
	);
}

console.log('3. end to end');
{
	const TOKEN = 'fixture-token';
	const deploy = {
		'_pages/full.webp': 'F'.repeat(4000),
		'_pages/full@half.webp': 'h'.repeat(1000),
		'_pages/only.webp': 'o',
		'editor-art/s/s.1.json': JSON.stringify({ meta: { image: '../../_pages/full.webp' } }),
		'editor-art/s/s.1@half.json': JSON.stringify({
			meta: { image: '../../_pages/full@half.webp' },
		}),
		'editor-art/index.json': JSON.stringify(['full.webp', 'full@half.webp', 'only.webp']),
		'spines/r/r.atlas': 'only.webp\nsize: 2,2\n',
		'spines/r/r@half.atlas': 'only.webp\nsize: 2,2\n',
	};
	// The rig keeps its only page on both tiers: a half atlas names a FULL page.
	deploy['_pages/only@half.webp'] = 'oh';
	deploy['editor-art/r.1@half.atlas'] = 'only.webp\n';
	deploy['editor-art/r.1.atlas'] = 'only.webp\n';
	let fetched = 0;
	const fetchedRels = [];
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
		fetched++;
		fetchedRels.push(rel);
		if (!(rel in deploy)) return res.writeHead(404).end();
		res.writeHead(200).end(deploy[rel]);
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', r));
	const base = `http://127.0.0.1:${server.address().port}`;

	const game = mkdtempSync(join(tmpdir(), 'art-tier-pin-'));
	const assets = join(game, 'static', 'assets');
	mkdirSync(assets, { recursive: true });
	const reportDir = mkdtempSync(join(tmpdir(), 'art-tier-report-'));
	const run = (tier, ...extra) =>
		new Promise((resolveRun) => {
			const env = { ...process.env, IE_OPTIMIZE_ASSETS: '', IE_BUILD_REPORT_DIR: reportDir };
			delete env.IE_ART_TIER;
			if (tier !== undefined) env.IE_ART_TIER = tier;
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
				{ cwd: game, env },
			);
			let out = '';
			child.stdout.on('data', (d) => (out += d));
			child.stderr.on('data', (d) => (out += d));
			child.on('close', (code) => resolveRun({ code, out }));
		});
	const has = (rel) => existsSync(join(assets, rel));
	const report = () => JSON.parse(readFileSync(join(reportDir, 'pull.json'), 'utf8'));

	try {
		const all = await run(undefined, '--no-prune');
		ok(
			'unpinned, both tiers ship',
			all.code === 0 && has('_pages/full.webp') && has('_pages/full@half.webp'),
			all.out,
		);
		ok('  and the report carries no pin', report().artTier === null);

		fetchedRels.length = 0;
		const half = await run('half');
		ok('pinned half, the pull succeeds', half.code === 0, half.out);
		ok(
			'  the full sheet and its page are gone',
			!has('_pages/full.webp') && !has('editor-art/s/s.1.json'),
			half.out,
		);
		ok(
			'  and were never downloaded',
			!fetchedRels.includes('_pages/full.webp') && !fetchedRels.includes('editor-art/s/s.1.json'),
			JSON.stringify(fetchedRels),
		);
		ok(
			'  the half copies are there',
			has('_pages/full@half.webp') && has('editor-art/s/s.1@half.json'),
		);
		ok(
			'  a full page a half atlas still names is kept',
			has('_pages/only.webp') && /keep _pages\/only\.webp/.test(half.out),
			half.out,
		);
		ok('  the index still ships (the game never loads it)', has('editor-art/index.json'));
		const left = report().artTier;
		ok(
			'  the report sizes what was left out',
			left?.tier === 'half' &&
				left.notPulled.some((f) => f.rel === '_pages/full.webp' && f.bytes === 4000),
			JSON.stringify(left),
		);
		ok(
			'  and the log says how much',
			/other art tier \(--art-tier half\): \d+ file\(s\)/.test(half.out),
			half.out,
		);

		writeFileSync(join(assets, '_pages', 'full@half.webp'), 'stale');
		const full = await run('full');
		ok('pinned full, the pull succeeds', full.code === 0, full.out);
		ok(
			'  no half copy is left, even one an earlier pull wrote',
			!has('_pages/full@half.webp') && !has('editor-art/s/s.1@half.json'),
			full.out,
		);
		ok('  the full copies are there', has('_pages/full.webp') && has('editor-art/s/s.1.json'));

		const before = fetched;
		const bad = await run('quarter');
		ok('a bad pin refuses', bad.code !== 0 && /IE_ART_TIER must be one of/.test(bad.out), bad.out);
		ok('  before fetching anything', fetched === before);
	} finally {
		server.close();
		rmSync(game, { recursive: true, force: true });
		rmSync(reportDir, { recursive: true, force: true });
	}
}

console.log(`\nPASS — ${checks} checks.`);
