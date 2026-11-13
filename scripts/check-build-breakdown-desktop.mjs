// Contract check for the desktop build breakdown — the report the Invisible Launcher opens after
// ☁ Publish / 📦 Deliver:
//   node scripts/check-build-breakdown-desktop.mjs
//
// Lays out a small finished build plus the notes its steps leave (pull.json, bake.json, the
// launcher's images.json), runs the REAL `scripts/build-breakdown.mjs` on it, and pins what a
// publisher relies on: categories and sizes, reference counts from the bundle, the code and other
// files, asset uses, the left-out ledger, the checks, and a page that opens with no network.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeDesktopBuild } from './lib/build-breakdown.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let checks = 0;
let failures = 0;
function check(label, actual, expected) {
	checks++;
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a === e) return;
	failures++;
	console.error(`FAIL  ${label}\n        expected ${e}\n        got      ${a}`);
}

const tmp = mkdtempSync(join(tmpdir(), 'ie-breakdown-'));
const build = join(tmp, 'build');
const report = join(tmp, 'report');
const put = (rel, body) => {
	const abs = join(build, ...rel.split('/'));
	mkdirSync(dirname(abs), { recursive: true });
	writeFileSync(abs, body);
};
const note = (name, data) => {
	mkdirSync(report, { recursive: true });
	writeFileSync(join(report, name), JSON.stringify(data));
};

try {
	const bundle = {
		doc: {
			gameType: 'lines',
			scenes: [
				{
					id: 'base',
					name: 'Base',
					nodes: [
						{ kind: 'sprite', assetKey: 'iw/demo/manifests/ui.json', region: 'a' },
						{ kind: 'sprite', assetKey: 'iw/demo/manifests/ui.json', region: 'b' },
						{ kind: 'spine', assetKey: 'R_Spin' },
						{ kind: 'sprite', assetKey: 'glow' },
						{ kind: 'sprite', region: 'iw/demo/manifests/hud.json::btn' },
						{ kind: 'text', style: { fontFamily: 'Fancy' } },
					],
				},
			],
		},
		cinematics: [{ id: 'intro', keys: [{ time: 0, cue: 'sfx:boom' }] }],
		componentDefs: {},
		editorArt: {
			sheets: [
				{ key: 'iw/demo/manifests/ui.json', json: 'editor-art/ui/ui.json', frames: 2 },
				{
					key: 'iw/demo/manifests/fx.json',
					json: 'editor-art/fx/fx.json',
					frames: 2,
					names: ['spark', 'glow'],
				},
				{
					key: 'iw/demo/manifests/hud.json',
					json: 'editor-art/hud/hud.json',
					frames: 1,
					names: ['btn'],
				},
				{
					key: 'iw/demo/manifests/unused.json',
					json: 'editor-art/unused/unused.json',
					frames: 1,
					names: ['nobody'],
				},
			],
			images: [],
			spines: [
				{
					key: 'iw/demo/rigs/R_Spin',
					atlas: 'editor-art/R_Spin/R_Spin.atlas',
					skeleton: 'editor-art/R_Spin/R_Spin.json',
					scale: 1,
				},
			],
			spinesMissing: [],
			collisions: [],
			missing: [],
			clipMissing: [],
		},
		fonts: {
			catalog: {
				prefix: 'editor-fonts',
				fonts: [
					{
						id: 'Fancy',
						name: 'Fancy',
						kind: 'bitmap',
						folder: 'Fancy',
						descriptorFile: 'Fancy.xml',
						pageFiles: ['Fancy.png'],
						ktx2DescriptorFile: 'Fancy.ktx2.xml',
					},
				],
			},
		},
		sounds: {
			catalog: {
				prefix: 'sounds',
				sounds: [
					{ name: 'win', file: 'win.mp3', durationMs: 1 },
					{ name: 'boom', file: 'boom.mp3', durationMs: 1 },
				],
				bindings: { spinStart: 'win' },
			},
		},
		localization: { sourceLang: 'en', messages: { en: { a: 'A' } } },
		symbols: {
			map: {},
			index: { sheets: [], images: [], spines: [], collisions: [], missing: [], spinesMissing: [] },
		},
	};
	const bundlePath = join(tmp, 'baked-editor-bundle.json');
	writeFileSync(bundlePath, JSON.stringify(bundle));

	put(
		'index.html',
		'<link rel="icon" href="./favicon.svg">' +
			'<script type="module" src="./_app/immutable/entry/start.js"></script>',
	);
	put(
		'_app/immutable/entry/start.js',
		'import("./chunk.js"); fetch("assets/sprites/coded.png"); fetch("assets/audio/sounds.json");' +
			'new URL("../assets/logo.png", import.meta.url);',
	);
	put('_app/immutable/entry/chunk.js', 'export const x = 1;');
	put('build-info.json', JSON.stringify({ version: '42', engineSha: 'abcdef1234567' }));
	put(
		'assets/editor-art/ui/ui.json',
		JSON.stringify({ meta: { image: '../../_pages/p1.webp', size: { w: 8192, h: 512 } } }),
	);
	put('assets/editor-art/R_Spin/R_Spin.atlas', '../../_pages/p1.webp\nsize: 8192,512\n');
	put('assets/editor-art/R_Spin/R_Spin.json', '{}');
	put('assets/editor-art/fx/fx.json', JSON.stringify({ meta: { image: 'fx.webp' } }));
	put('assets/editor-art/fx/fx.webp', 'f'.repeat(50));
	put('assets/editor-art/hud/hud.json', JSON.stringify({ meta: { image: 'hud.webp' } }));
	put('assets/editor-art/hud/hud.webp', 'h'.repeat(60));
	// Two rigs packed into the same page: their atlas texts match, and each reads its own.
	put('assets/editor-art/R_Twin/R_Twin.atlas', '../../_pages/p1.webp\nsize: 8192,512\n');
	put('assets/sounds/boom.mp3', 'b'.repeat(70));
	put('assets/editor-fonts/Fancy/Fancy.xml', '<page id="0" file="Fancy.png"/>');
	put('assets/editor-fonts/Fancy/Fancy.png', 'p'.repeat(10));
	put('assets/editor-fonts/Fancy/Fancy.ktx2.xml', '<page id="0" file="Fancy.pm.ktx2"/>');
	put('assets/editor-fonts/Fancy/Fancy.pm.ktx2', 'k'.repeat(12));
	put('assets/clips/win.json', '{"frames":["spark"]}');
	// Two empty indexes: the same two bytes, which is no duplicate download worth naming.
	put('assets/editor-shaders/_index.json', '[]');
	put('assets/effects/index.json', '[]');
	put('favicon.svg', '<svg/>');
	put('_app/immutable/assets/logo.png', 'l'.repeat(20));
	put('assets/_pages/p1.webp', 'x'.repeat(1000));
	put('assets/sounds/win.mp3', 's'.repeat(300));
	put('assets/sprites/coded.png', 'c'.repeat(200));
	put('assets/sprites/stray.png', 'x'.repeat(1000));
	// An audiosprite names its media from the SITE ROOT, and the loading splash's index names its rig
	// from `static/assets/` — neither from beside itself, which is all a sheet or atlas uses.
	put('assets/audio/sounds.json', JSON.stringify({ src: ['./assets/audio/sounds.mp3'] }));
	put('assets/audio/sounds.mp3', 'm'.repeat(400));
	put('assets/_boot/boot.json', JSON.stringify({ engine: { atlas: '_boot/engine/R_E.atlas' } }));
	put('assets/_boot/engine/R_E.atlas', 'S_E.webp\nsize: 4,4\n');
	put('assets/_boot/engine/S_E.webp', 'e'.repeat(30));
	// The splash's KTX2 twin, which its index never names: its page is reached only through it.
	put('assets/_boot/engine/R_E.ktx2.atlas', 'S_E.pm.ktx2\nsize: 4,4\n');
	put('assets/_boot/engine/S_E.pm.ktx2', 'k'.repeat(40));

	note('bake.json', { project: 'demo', bundle: bundlePath });
	note('pull.json', {
		project: 'iw/demo',
		pulled: [],
		notPulled: [{ rel: 'old/unused.png', bytes: 5000 }],
		removed: [{ rel: 'sprites/renamed.png', bytes: 700 }],
		byproducts: [{ rel: '_pages/p1.pm.ktx2.meta.json', bytes: 90 }],
		keptUnloaded: [],
		optimize: {
			audioFormats: ['mp3'],
			imagesDeleted: [{ rel: 'editor-art/ui/ui.png', bytes: 2000 }],
			audioDeleted: [{ rel: 'sounds/win.ogg', bytes: 250 }],
			manifestsRewritten: [],
			unreferenced: [],
			bytesSaved: 2250,
		},
	});
	note('stock.json', {
		sounds: {
			skipped: ['bgm_main'],
			keptAllBecause: null,
			removed: [{ rel: 'assets/audio/stock/bgm_main.mp3', bytes: 300 }],
		},
		skipped: ['bigwin'],
		keptAllBecause: null,
		removed: [
			{ rel: 'assets/spines/bigwin/big_wins.webp', bytes: 900 },
			{ rel: 'assets/spines/bigwin/mm_bigwin.json', bytes: 100 },
		],
		art: {
			skipped: ['editorArt/editor-art/unused/unused.json'],
			removed: [
				{ rel: 'assets/editor-art/unused/unused.json', bytes: 300 },
				{ rel: 'assets/_pages/unused.webp', bytes: 4000 },
			],
		},
	});
	note('images.json', {
		converted: [
			{ from: 'assets/_pages/p1.png', to: 'assets/_pages/p1.webp', before: 4000, after: 1000 },
		],
		recompressed: [],
		audioDropped: [],
	});

	const resultPath = join(tmp, 'result.json');
	const run = spawnSync(
		process.execPath,
		[
			join(ROOT, 'scripts/build-breakdown.mjs'),
			'--build',
			build,
			'--report-dir',
			report,
			'--kind',
			'publish',
			'--optimize',
			'--json',
			resultPath,
		],
		{ encoding: 'utf8' },
	);
	check('the script exits cleanly', [run.status, run.stderr.trim()], [0, '']);
	const result = JSON.parse(readFileSync(resultPath, 'utf8'));
	check(
		'result: ok, with both files',
		[result.ok, !!result.html, !!result.json],
		[true, true, true],
	);
	const b = JSON.parse(readFileSync(join(report, 'build-breakdown.json'), 'utf8'));
	const file = (rel) => b.files.find((f) => f.rel === rel);
	const asset = (id) => b.assets.find((a) => a.id === id);
	const issue = (title) => b.issues.find((i) => i.title === title)?.items ?? [];
	const removed = (id) => b.removed.find((r) => r.id === id);

	check('every shipped file is listed', b.files.length, 33);
	check(
		"font: the catalog's KTX2 twin descriptor reaches its page",
		[file('assets/editor-fonts/Fancy/Fancy.pm.ktx2')?.refs, asset('font:Fancy')?.files],
		[
			1,
			[
				'assets/editor-fonts/Fancy/Fancy.ktx2.xml',
				'assets/editor-fonts/Fancy/Fancy.pm.ktx2',
				'assets/editor-fonts/Fancy/Fancy.png',
				'assets/editor-fonts/Fancy/Fancy.xml',
			],
		],
	);
	check(
		"a site-root path in data: the sound sprite's media",
		file('assets/audio/sounds.mp3')?.refs,
		1,
	);
	check(
		'a static/assets path in data: the splash rig',
		file('assets/_boot/engine/R_E.atlas')?.refs,
		1,
	);
	check('  and through it, its page', file('assets/_boot/engine/S_E.webp')?.refs, 1);
	check('code: the chunks', file('_app/immutable/entry/chunk.js')?.category, 'code');
	check('code: referenced by the entry', file('_app/immutable/entry/chunk.js')?.refs, 1);
	check('coded art: named by the code', file('assets/sprites/coded.png')?.refs, 1);
	check('coded art: its category', file('assets/sprites/coded.png')?.category, 'coded');
	check(
		'categories: a clip is game data, a root favicon the shell, an imported image coded art',
		[
			file('assets/clips/win.json')?.category,
			file('favicon.svg')?.category,
			file('_app/immutable/assets/logo.png')?.category,
		],
		['data', 'other', 'coded'],
	);
	check(
		'uses: a bare frame and a scoped ref name their sheets; a cue names its sound',
		[
			asset('sheet:iw/demo/manifests/fx.json')?.uses,
			asset('sheet:iw/demo/manifests/hud.json')?.uses,
			asset('sound:boom')?.uses,
		],
		[1, 1, 1],
	);
	check('page: shared by the sheet and both rig atlases', file('assets/_pages/p1.webp')?.refs, 3);
	check('page: its pixel size', file('assets/_pages/p1.webp')?.dims, { w: 8192, h: 512 });
	check('sound: through the catalog', file('assets/sounds/win.mp3')?.refs, 1);
	check('sheet: two placements', asset('sheet:iw/demo/manifests/ui.json')?.uses, 2);
	check('sheet: pulls in its page', asset('sheet:iw/demo/manifests/ui.json')?.files, [
		'assets/_pages/p1.webp',
		'assets/editor-art/ui/ui.json',
	]);
	check('rig: placed by its bare name', asset('rig:iw/demo/rigs/R_Spin')?.uses, 1);
	check('sound: bound once', asset('sound:win')?.uses, 1);
	check('build info: version and project', [b.build.version, b.build.project], ['42', 'iw/demo']);

	check('left out: not pulled', removed('notPulled')?.bytes, 5000);
	check('left out: pruned', removed('pruned')?.bytes, 700);
	check('left out: image twins', removed('imageTwins')?.bytes, 2000);
	check('left out: audio formats', removed('audioFormats')?.bytes, 250);
	check('left out: stock sounds', removed('stockSounds')?.bytes, 300);
	check(
		'left out: stock sounds names its banks',
		removed('stockSounds')?.detail.includes('(bgm_main)'),
		true,
	);
	check('left out: stock sample art', removed('stockArt')?.bytes, 1000);
	check(
		'left out: stock sample art names its keys',
		removed('stockArt')?.detail.includes('(bigwin)'),
		true,
	);
	check('left out: exported art the boot never loads', removed('editorArt')?.bytes, 4300);
	check(
		'left out: the art step names its keys',
		removed('editorArt')?.detail.includes('editorArt/editor-art/unused/unused.json'),
		true,
	);
	check('left out: export by-products', removed('byproducts')?.bytes, 90);
	check('left out: total', b.totals.removedBytes, 13640);
	check('re-encoded: saving', b.totals.reencodedBytes, 3000);

	check(
		'check: the dead files, and a page reached only through one',
		issue('Shipped but never loaded'),
		[
			'assets/_boot/engine/R_E.ktx2.atlas (22 B)',
			'assets/_boot/engine/S_E.pm.ktx2 (40 B)',
			'assets/editor-art/R_Twin/R_Twin.atlas (36 B)',
			'assets/sprites/stray.png (1000 B)',
		],
	);
	check(
		'files: each row says whether the game loads it',
		[file('assets/_boot/engine/S_E.pm.ktx2')?.loaded, file('assets/_pages/p1.webp')?.loaded],
		[false, true],
	);
	check('check: oversized page', issue('Textures over 4096 px'), [
		'assets/_pages/p1.webp — 8192×512',
	]);
	check('check: same bytes twice', issue('Same bytes shipped twice'), [
		'assets/sprites/stray.png = assets/_pages/p1.webp (1000 B)',
	]);
	check(
		'check: a matching small descriptor or empty index is not a duplicate',
		issue('Identical small descriptors'),
		[
			'assets/editor-art/R_Twin/R_Twin.atlas = assets/editor-art/R_Spin/R_Spin.atlas (36 B)',
			'assets/effects/index.json = assets/editor-shaders/_index.json (2 B)',
		],
	);
	check(
		'check: nothing referenced is missing, art the build left out included',
		issue('Referenced but not shipped'),
		[],
	);
	check(
		'check: left-out art is no asset of the build',
		asset('sheet:iw/demo/manifests/unused.json'),
		undefined,
	);
	check('check: assets the data never names', issue('Assets the game data never names'), []);

	const html = readFileSync(join(report, 'build-breakdown.html'), 'utf8');
	check(
		'page: self-contained (no external script or stylesheet)',
		/<(script|link)[^>]+(src|href)=/i.test(html),
		false,
	);
	check('page: embeds the data safely', html.includes('window.__BREAKDOWN__ = {'), true);
	check(
		'page: the Files filter lists what is never loaded',
		html.includes('Never loaded only'),
		true,
	);
	check('page: no raw closing tag inside the data', (html.match(/<\/script>/g) ?? []).length, 2);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

// A bundle with an inlined data URI: matching the reference pattern across a long base64 run
// backtracked quadratically, and a few MB of it held a desktop publish on "Writing the build
// breakdown…" for an hour. The run is skipped as a whole; the real reference beside it still counts.
{
	const blob = Buffer.alloc(2 * 1024 * 1024, 7).toString('base64');
	const code = `const bg="data:image/png;base64,${blob}";load("assets/ui/frame.png");`;
	const started = Date.now();
	const b = analyzeDesktopBuild({
		files: [
			{ rel: '_app/app.js', bytes: code.length },
			{ rel: 'assets/ui/frame.png', bytes: 10 },
		],
		texts: new Map([['_app/app.js', code]]),
		bundle: null,
		assetsPrefix: 'assets/',
		pull: null,
		images: null,
		buildInfo: null,
	});
	check('data URI: the scan finishes in under 2 s', Date.now() - started < 2000, true);
	check(
		'data URI: the real reference beside it still counts',
		b.files.find((f) => f.rel === 'assets/ui/frame.png')?.refs,
		1,
	);
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
