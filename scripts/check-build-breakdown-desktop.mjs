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
					],
				},
			],
		},
		componentDefs: {},
		editorArt: {
			sheets: [{ key: 'iw/demo/manifests/ui.json', json: 'editor-art/ui/ui.json', frames: 2 }],
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
		fonts: { catalog: { prefix: 'editor-fonts', fonts: [] } },
		sounds: {
			catalog: {
				prefix: 'sounds',
				sounds: [{ name: 'win', file: 'win.mp3', durationMs: 1 }],
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

	put('index.html', '<script type="module" src="./_app/immutable/entry/start.js"></script>');
	put('_app/immutable/entry/start.js', 'import("./chunk.js"); fetch("assets/sprites/coded.png");');
	put('_app/immutable/entry/chunk.js', 'export const x = 1;');
	put('build-info.json', JSON.stringify({ version: '42', engineSha: 'abcdef1234567' }));
	put(
		'assets/editor-art/ui/ui.json',
		JSON.stringify({ meta: { image: '../../_pages/p1.webp', size: { w: 8192, h: 512 } } }),
	);
	put('assets/editor-art/R_Spin/R_Spin.atlas', '../../_pages/p1.webp\nsize: 8192,512\n');
	put('assets/editor-art/R_Spin/R_Spin.json', '{}');
	put('assets/_pages/p1.webp', 'x'.repeat(1000));
	put('assets/sounds/win.mp3', 's'.repeat(300));
	put('assets/sprites/coded.png', 'c'.repeat(200));
	put('assets/sprites/stray.png', 'x'.repeat(1000));

	note('bake.json', { project: 'demo', bundle: bundlePath });
	note('pull.json', {
		project: 'iw/demo',
		pulled: [],
		notPulled: [{ rel: 'old/unused.png', bytes: 5000 }],
		removed: [{ rel: 'sprites/renamed.png', bytes: 700 }],
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

	check('every shipped file is listed', b.files.length, 11);
	check('code: the chunks', file('_app/immutable/entry/chunk.js')?.category, 'code');
	check('code: referenced by the entry', file('_app/immutable/entry/chunk.js')?.refs, 1);
	check('coded art: named by the code', file('assets/sprites/coded.png')?.refs, 1);
	check('coded art: its category', file('assets/sprites/coded.png')?.category, 'coded');
	check('page: shared by the sheet and the rig atlas', file('assets/_pages/p1.webp')?.refs, 2);
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
	check('left out: total', b.totals.removedBytes, 7950);
	check('re-encoded: saving', b.totals.reencodedBytes, 3000);

	check('check: the dead file', issue('Shipped but never loaded'), [
		'assets/sprites/stray.png (1000 B)',
	]);
	check('check: oversized page', issue('Textures over 4096 px'), [
		'assets/_pages/p1.webp — 8192×512',
	]);
	check('check: same bytes twice', issue('Same bytes shipped twice'), [
		'assets/sprites/stray.png = assets/_pages/p1.webp (1000 B)',
	]);
	check('check: nothing referenced is missing', issue('Referenced but not shipped'), []);

	const html = readFileSync(join(report, 'build-breakdown.html'), 'utf8');
	check(
		'page: self-contained (no external script or stylesheet)',
		/<(script|link)[^>]+(src|href)=/i.test(html),
		false,
	);
	check('page: embeds the data safely', html.includes('window.__BREAKDOWN__ = {'), true);
	check('page: no raw closing tag inside the data', (html.match(/<\/script>/g) ?? []).length, 2);
} finally {
	rmSync(tmp, { recursive: true, force: true });
}

console.log(`${checks - failures}/${checks} checks passed`);
if (failures) process.exit(1);
