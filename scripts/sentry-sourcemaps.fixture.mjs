/**
 * `scripts/sentry-sourcemaps.mjs` over a synthetic shell + bundle build, offline: every shipped chunk
 * is staged with its map under the debug ID the chunk carries, a staged map resolves a chunk
 * position to the right ORIGINAL line, and no map or map reference is left in the build.
 *
 * The maps are produced by esbuild (vite's own), not by the code under test, and the expected answer
 * is read off the original source text — so a staging that is wrong in the same way as the decoder
 * cannot pass. The debug IDs are written by `config-vite/debugIds.js`, the build's own plugin code.
 * `sentry-sourcemaps-build.fixture.mjs` runs the same staging over a REAL SvelteKit build.
 *
 *     node scripts/sentry-sourcemaps.fixture.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withDebugId } from '../packages/config-vite/debugIds.js';
import { decodeMappings } from './lib/decodeMappings.mjs';
import { debugIdOf, prepareRuntime, sourceMapLeaks } from './sentry-sourcemaps.mjs';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const SCRIPT = join(ROOT, 'scripts', 'sentry-sourcemaps.mjs');
const fromVite = createRequire(
	createRequire(join(ROOT, 'apps/lines/package.json')).resolve('vite'),
);
const esbuild = fromVite('esbuild');

let failures = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — ${detail}`}`);
	if (!ok) failures += 1;
};

const ORIGINAL = [
	'export function first() {',
	'\treturn "first-token";',
	'}',
	'',
	'export function boom(reason) {',
	'\tif (!reason) return 0;',
	'\tthrow new Error("fixture-boom " + reason);',
	'}',
	'',
	'first();',
	'boom(globalThis.__reason);',
].join('\n');
const LAZY = ['export function later() {', '\treturn "lazy-token";', '}'].join('\n');

/** A minified ES module whose code spans several lines, with a map from esbuild. */
const minify = (code, sourcefile) =>
	esbuild.transformSync(code, {
		loader: 'js',
		format: 'esm',
		minifyWhitespace: true,
		sourcemap: 'external',
		sourcefile,
		lineLimit: 40,
	});
const builtMain = minify(ORIGINAL, '../../../../../../../packages/fixture/src/game.ts');
const builtLazy = minify(LAZY, '../../../../../../../../packages/fixture/src/lazy.ts');
const bundle = withDebugId(builtMain.code);
const lazy = withDebugId(builtLazy.code);
const originalLineOf = (source, text) => source.split('\n').findIndex((l) => l.includes(text));

const makeBuild = ({ debugIds = true } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'ie-sentry-fixture-'));
	const immutable = join(dir, '_app', 'immutable');
	mkdirSync(join(immutable, 'chunks'), { recursive: true });
	mkdirSync(join(immutable, 'assets'), { recursive: true });
	writeFileSync(join(immutable, 'bundle.Fx1.js'), debugIds ? bundle.code : builtMain.code);
	writeFileSync(join(immutable, 'bundle.Fx1.js.map'), builtMain.map);
	writeFileSync(join(immutable, 'chunks', 'Lz1.js'), lazy.code);
	writeFileSync(join(immutable, 'chunks', 'Lz1.js.map'), builtLazy.map);
	writeFileSync(join(immutable, 'assets', 'libktx.Ab1.js'), 'self.LIBKTX = 1;\n');
	writeFileSync(join(immutable, 'assets', 'bundle.Cs1.css.map'), '{}');
	writeFileSync(
		join(dir, 'index.html'),
		'<!doctype html><html><head></head><body><script>import("./_app/immutable/bundle.Fx1.js")' +
			'.then((app) => app.start(document.body));</script></body></html>',
	);
	return dir;
};

/** Where a string sits in a chunk. */
const position = (code, needle) => {
	const lines = code.slice(0, code.indexOf(needle)).split('\n');
	return { line: lines.length - 1, column: lines.at(-1).length };
};

/**
 * Original line of the mapping segment that STARTS at a generated position. Exact, not
 * at-or-before: each probe token starts a segment, and a nearest-before lookup would forgive a
 * column shift smaller than the gap to the previous token.
 */
const resolveAt = (map, { line, column }) => {
	const segments = decodeMappings(map.mappings)[line] ?? [];
	const hit = segments.find((s) => s[0] === column && s.length >= 4);
	return hit ? { source: map.sources[hit[1]], line: hit[2] } : null;
};

// ── 1. every chunk is staged with its map, under the chunk's own debug ID ────────────────────────
{
	const dir = makeBuild();
	const out = mkdtempSync(join(tmpdir(), 'ie-sentry-staged-'));
	const shipped = (rel) => readFileSync(join(dir, rel), 'utf8');
	const staged = prepareRuntime(dir, out, { strict: true });
	const files = staged?.chunks.map((c) => c.file).sort();
	check(
		'the bundle and the lazy chunk are staged outside the build, the KTX2 asset is not',
		JSON.stringify(files) ===
			JSON.stringify(['_app/immutable/bundle.Fx1.js', '_app/immutable/chunks/Lz1.js']) &&
			staged.dir === out,
		JSON.stringify(files),
	);
	if (!staged) {
		console.error('\nnothing staged — the remaining checks have nothing to read');
		process.exit(1);
	}
	check('control: the bundle spans several lines', builtMain.code.trim().split('\n').length > 2);

	for (const [rel, source, tokens] of [
		[
			'_app/immutable/bundle.Fx1.js',
			ORIGINAL,
			['"first-token"', 'function boom', 'throw new Error'],
		],
		['_app/immutable/chunks/Lz1.js', LAZY, ['"lazy-token"']],
	]) {
		const code = shipped(rel);
		const map = JSON.parse(readFileSync(join(out, `${rel}.map`), 'utf8'));
		const stagedCode = readFileSync(join(out, rel), 'utf8');
		for (const token of tokens) {
			const want = originalLineOf(source, token);
			const got = resolveAt(map, position(code, token));
			check(
				`${rel}: ${token} resolves to original line ${want + 1}`,
				got?.line === want,
				JSON.stringify(got),
			);
		}
		const id = debugIdOf(code);
		check(
			`${rel}: the shipped chunk, its staged copy and its map carry one debug ID`,
			!!id &&
				code.includes(`_sentryDebugIds`) &&
				code.includes(`"${id}"`) &&
				debugIdOf(stagedCode.replace(/\/\/# sourceMappingURL=.*\n$/, '')) === id &&
				map.debugId === id &&
				map.debug_id === id,
		);
		check(
			`${rel}: the staged copy is the shipped chunk plus its map reference`,
			stagedCode.startsWith(code) && /\/\/# sourceMappingURL=[\w.-]+\.map\n$/.test(stagedCode),
		);
		check(
			`${rel}: sources are repo-relative, not climbing out of .svelte-kit`,
			map.sources.every((s) => !s.startsWith('../')) &&
				map.sources[0].startsWith('packages/fixture/src/'),
			JSON.stringify(map.sources),
		);
	}
	check(
		'no .map is left in the build',
		sourceMapLeaks(dir).length === 0,
		sourceMapLeaks(dir).join('; '),
	);
	check(
		'no sourceMappingURL in anything served',
		!/sourceMappingURL/.test(shipped('index.html')) &&
			!/sourceMappingURL/.test(shipped('_app/immutable/bundle.Fx1.js')),
	);

	// A re-run (the release job retried) finds no maps, stages nothing and does not fail.
	const again = mkdtempSync(join(tmpdir(), 'ie-sentry-staged-'));
	check('a re-run stages nothing and still passes', prepareRuntime(dir, again) === null);
	rmSync(again, { recursive: true });
	rmSync(dir, { recursive: true });
	rmSync(out, { recursive: true });
}

// ── 2. a chunk built without debug IDs has unreadable frames: a warning, fatal when strict ───────
{
	const dir = makeBuild({ debugIds: false });
	const out = mkdtempSync(join(tmpdir(), 'ie-sentry-staged-'));
	let threw = '';
	try {
		prepareRuntime(dir, out, { strict: true });
	} catch (error) {
		threw = error.message;
	}
	check(
		'strict: a chunk with a map but no debug ID fails',
		/bundle\.Fx1\.js has a map but no debug ID/.test(threw),
		threw,
	);
	check('…after every map was stripped', sourceMapLeaks(dir).length === 0);
	const relaxedDir = makeBuild({ debugIds: false });
	const relaxed = prepareRuntime(relaxedDir, out);
	check(
		'not strict: the chunks that carry one are still staged',
		relaxed?.chunks.length === 1 && relaxed.chunks[0].file === '_app/immutable/chunks/Lz1.js',
		JSON.stringify(relaxed),
	);
	check('…and every map is still stripped', sourceMapLeaks(relaxedDir).length === 0);
	for (const d of [dir, relaxedDir, out]) rmSync(d, { recursive: true });
}

// ── 3. the gate catches each way a map could ship (mutants) ──────────────────────────────────────
{
	const dir = makeBuild();
	for (const f of readdirSync(join(dir, '_app/immutable'), { recursive: true })) {
		if (f.endsWith('.map')) rmSync(join(dir, '_app/immutable', f));
	}
	check('control: a clean build passes the gate', sourceMapLeaks(dir).length === 0);

	writeFileSync(join(dir, 'late.js.map'), '{}');
	check(
		'a planted .map fails the gate',
		sourceMapLeaks(dir).some((l) => l.includes('late.js.map')),
	);
	rmSync(join(dir, 'late.js.map'));

	writeFileSync(join(dir, 'ref.js'), 'x();\n//# sourceMappingURL=ref.js.map\n');
	check(
		'a planted sourceMappingURL fails the gate',
		sourceMapLeaks(dir).some((l) => l.includes('ref.js')),
	);

	const verify = spawnSync(process.execPath, [SCRIPT, 'verify', dir], { encoding: 'utf8' });
	check('`verify` exits non-zero on a leak', verify.status === 1, verify.stdout + verify.stderr);
	rmSync(join(dir, 'ref.js'));
	const clean = spawnSync(process.execPath, [SCRIPT, 'verify', dir], { encoding: 'utf8' });
	check('`verify` exits 0 once clean', clean.status === 0, clean.stdout + clean.stderr);
	rmSync(dir, { recursive: true });
}

// ── 4. no token: the release step succeeds quietly and still strips ──────────────────────────────
{
	const dir = makeBuild();
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith('SENTRY_')),
	);
	const run = spawnSync(process.execPath, [SCRIPT, 'runtime', dir], { encoding: 'utf8', env });
	check('without SENTRY_AUTH_TOKEN the step exits 0', run.status === 0, run.stdout + run.stderr);
	check('…says the upload was skipped', /Source maps not uploaded/.test(run.stdout), run.stdout);
	check('…and left no map in the build', sourceMapLeaks(dir).length === 0);
	rmSync(dir, { recursive: true });
}

// ── 5. launcher: without a token its maps are deleted and the build still passes ─────────────────
{
	const dir = mkdtempSync(join(tmpdir(), 'ie-sentry-launcher-'));
	const chunks = join(dir, 'client', '_app', 'immutable', 'chunks');
	mkdirSync(chunks, { recursive: true });
	mkdirSync(join(dir, 'server'), { recursive: true });
	writeFileSync(join(chunks, 'a.js'), 'export const a = 1;\n');
	writeFileSync(join(chunks, 'a.js.map'), '{}');
	writeFileSync(join(dir, 'server', 'index.js.map'), '{}');
	const env = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith('SENTRY_')),
	);
	const run = spawnSync(process.execPath, [SCRIPT, 'launcher', dir], { encoding: 'utf8', env });
	check('launcher: without a token the step exits 0', run.status === 0, run.stdout + run.stderr);
	check(
		'launcher: client and server maps are deleted',
		sourceMapLeaks(dir).length === 0,
		sourceMapLeaks(dir).join('; '),
	);
	rmSync(dir, { recursive: true });
}

if (failures) {
	console.error(`\n${failures} check(s) failed`);
	process.exit(1);
}
console.log('\nsentry-sourcemaps: all checks passed');
