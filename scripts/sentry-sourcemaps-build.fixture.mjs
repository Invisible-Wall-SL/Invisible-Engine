/**
 * A REAL hidden-source-map game build yields maps `sentry-sourcemaps.mjs runtime` uploads, one per
 * shipped chunk. Offline, no browser, ~20 s: a three-file SvelteKit app is built through the same
 * `config-svelte` + `config-vite` every game build uses, with `IE_SOURCEMAPS=hidden` as the runtime
 * release sets it, then staged exactly as the release stages it.
 *
 * WHY. From 2026-10-01 to 2026-11-03 the release uploaded nothing and said so only as a notice
 * ("nothing to upload"): the SvelteKit 2.70 upgrade made the then-default `inline` strategy delete
 * the emitted bundle AND its map after copying the bundle into `index.html`. The synthetic fixture
 * (`sentry-sourcemaps.fixture.mjs`) writes its own maps, so it could not see a build that stopped
 * leaving them. This one builds, so a SvelteKit, Vite, Rollup or config change that drops a map,
 * a debug ID or a chunk fails here instead of in Sentry months later.
 *
 * The app sits in `apps/lines/node_modules/.cache/` so it resolves the engine's packages and counts
 * as an engine app, not a standalone game repo (`config-svelte/appSrc.js`), and git ignores it.
 *
 *     node scripts/sentry-sourcemaps-build.fixture.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMappings } from './lib/decodeMappings.mjs';
import { debugIdOf, prepareRuntime, sourceMapLeaks } from './sentry-sourcemaps.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const LINES = join(ROOT, 'apps/lines');
const APP = join(LINES, 'node_modules/.cache', `ie-sentry-build-fixture-${process.pid}`);
const viteBin = join(
	dirname(createRequire(join(LINES, 'package.json')).resolve('vite/package.json')),
	'bin/vite.js',
);

let failures = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — ${detail}`}`);
	if (!ok) failures += 1;
};

const BOOM = [
	'export function boom(reason) {',
	'\tif (!reason) return 0;',
	'\tthrow new Error("eager-boom-token " + reason);',
	'}',
].join('\n');
const LAZY = [
	'export function later(reason) {',
	'\tif (!reason) return 0;',
	'\tthrow new Error("lazy-boom-token " + reason);',
	'}',
].join('\n');

const FILES = {
	'svelte.config.js': "import config from 'config-svelte';\nexport default config();\n",
	'vite.config.js': "import config from 'config-vite';\nexport default config();\n",
	'src/app.html':
		'<!doctype html>\n<html>\n<head>%sveltekit.head%</head>\n<body><div>%sveltekit.body%</div></body>\n</html>\n',
	'src/routes/+layout.js': 'export const prerender = true;\nexport const ssr = false;\n',
	'src/routes/+page.svelte': [
		'<script>',
		"\timport { onMount } from 'svelte';",
		"\timport { boom } from '../boom.js';",
		'\tonMount(async () => {',
		"\t\tconst { later } = await import('../lazy.js');",
		'\t\tlater(globalThis.__reason);',
		'\t\tboom(globalThis.__reason);',
		'\t});',
		'</script>',
		'',
		'<p>fixture</p>',
	].join('\n'),
	'src/boom.js': BOOM,
	'src/lazy.js': LAZY,
};

const walkJs = (dir) =>
	(existsSync(dir) ? readdirSync(dir, { recursive: true }) : [])
		.map(String)
		.filter((f) => f.endsWith('.js'))
		.map((f) => f.split('\\').join('/'));

/** The original line + source a generated position maps to (the segment at or before it). */
const originalAt = (map, code, needle) => {
	const before = code.slice(0, code.indexOf(needle)).split('\n');
	const segments = decodeMappings(map.mappings)[before.length - 1] ?? [];
	const column = before.at(-1).length;
	const hit = segments.filter((s) => s[0] <= column && s.length >= 4).at(-1);
	return hit ? { source: map.sources[hit[1]], line: hit[2] } : null;
};

rmSync(APP, { recursive: true, force: true });
try {
	for (const [rel, body] of Object.entries(FILES)) {
		mkdirSync(join(APP, rel, '..'), { recursive: true });
		writeFileSync(join(APP, rel), body);
	}
	const env = Object.fromEntries(
		Object.entries(process.env).filter(
			([k]) => !k.startsWith('PUBLIC_') && k !== 'IE_SOURCEMAPS' && k !== 'NODE_ENV',
		),
	);
	const built = spawnSync(process.execPath, [viteBin, 'build'], {
		cwd: APP,
		env: { ...env, IE_SOURCEMAPS: 'hidden', PUBLIC_IE_FAMILIES: 'slot' },
		encoding: 'utf8',
	});
	if (built.status !== 0) {
		console.error(`${built.stdout}\n${built.stderr}`);
		throw new Error(`the fixture app did not build (exit ${built.status})`);
	}

	const build = join(APP, 'build');
	const immutable = join(build, '_app/immutable');
	const shell = readFileSync(join(build, 'index.html'), 'utf8');
	const bundleName = /import\("\.\/_app\/immutable\/(bundle\.[\w-]+\.js)"\)/.exec(shell)?.[1];
	const chunks = walkJs(immutable);
	const read = (rel) => readFileSync(join(immutable, rel), 'utf8');
	const holding = (token) => chunks.filter((c) => read(c).includes(token));

	check(
		'index.html is a shell that imports _app/immutable/bundle.<hash>.js',
		!!bundleName && existsSync(join(immutable, bundleName)) && !shell.includes('boom-token'),
		bundleName ?? 'no import("./_app/immutable/bundle.*.js") in the shell',
	);
	check(
		'the eager code is in the bundle, the dynamic import is its own chunk',
		holding('eager-boom-token').join() === bundleName &&
			holding('lazy-boom-token').length === 1 &&
			holding('lazy-boom-token')[0].startsWith('chunks/'),
		`eager in ${holding('eager-boom-token')}, lazy in ${holding('lazy-boom-token')}`,
	);
	check(
		'every shipped chunk has its hidden map',
		chunks.length > 0 && chunks.every((c) => existsSync(join(immutable, `${c}.map`))),
		chunks.filter((c) => !existsSync(join(immutable, `${c}.map`))).join(', '),
	);
	check(
		'every shipped chunk carries a debug ID and no sourceMappingURL',
		chunks.every((c) => debugIdOf(read(c)) && !/sourceMappingURL/.test(read(c))),
	);

	const shipped = Object.fromEntries(chunks.map((c) => [c, read(c)]));
	const out = join(APP, 'staged');
	let staged = null;
	try {
		staged = prepareRuntime(build, out, { strict: true });
	} catch (error) {
		check('sentry-sourcemaps stages the build without a problem', false, error.message);
	}
	const stagedFiles = (staged?.chunks ?? []).map((c) => c.file.replace('_app/immutable/', ''));
	check(
		'sentry-sourcemaps would upload exactly the shipped chunks',
		stagedFiles.sort().join() === [...chunks].sort().join(),
		`staged ${stagedFiles.join(', ') || 'nothing'}; shipped ${chunks.join(', ')}`,
	);
	for (const { file, debugId } of staged?.chunks ?? []) {
		const rel = file.replace('_app/immutable/', '');
		const map = JSON.parse(readFileSync(join(out, `${file}.map`), 'utf8'));
		check(
			`${rel}: its map is stamped with the debug ID the shipped chunk carries`,
			debugIdOf(shipped[rel]) === debugId && map.debugId === debugId,
		);
	}
	for (const [token, source, text] of [
		['eager-boom-token', 'boom.js', BOOM],
		['lazy-boom-token', 'lazy.js', LAZY],
	]) {
		const rel = holding(token)[0];
		const map = rel && JSON.parse(readFileSync(join(out, '_app/immutable', `${rel}.map`), 'utf8'));
		const got = map && originalAt(map, shipped[rel], `"${token}`);
		const want = text.split('\n').findIndex((l) => l.includes(token));
		check(
			`a frame at "${token}" maps back to src/${source} line ${want + 1}`,
			!!got && got.source.endsWith(`src/${source}`) && got.line === want,
			JSON.stringify(got),
		);
	}
	check('no map is left in the build', sourceMapLeaks(build).length === 0);
} finally {
	rmSync(APP, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nsentry-sourcemaps-build: all checks passed');
