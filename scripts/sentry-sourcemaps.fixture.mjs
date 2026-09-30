/**
 * `scripts/sentry-sourcemaps.mjs` over a synthetic inlined build, offline: the staged map resolves a
 * page position to the right ORIGINAL line, and no map or map reference is left in the build.
 *
 * The map is produced by esbuild (vite's own), not by the code under test, and the expected answer
 * is read off the original source text — so a re-base that is wrong in the same way as the decoder
 * cannot pass. The page puts the bundle mid-line after CRLF lines, as SvelteKit's inline template
 * does, so both the line and the first-line column shift are exercised.
 *
 *     node scripts/sentry-sourcemaps.fixture.mjs
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeMappings, prepareRuntime, sourceMapLeaks } from './sentry-sourcemaps.mjs';

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

/** A minified bundle whose code spans several lines, with a map from esbuild. */
const built = esbuild.transformSync(ORIGINAL, {
	loader: 'js',
	format: 'iife',
	minifyWhitespace: true,
	sourcemap: 'external',
	sourcefile: '../../../../../../../packages/fixture/src/game.ts',
	lineLimit: 40,
});
const bundle = built.code;
const originalLineOf = (text) => ORIGINAL.split('\n').findIndex((l) => l.includes(text));

const makeBuild = ({ inline = true } = {}) => {
	const dir = mkdtempSync(join(tmpdir(), 'ie-sentry-fixture-'));
	mkdirSync(join(dir, '_app', 'immutable'), { recursive: true });
	writeFileSync(join(dir, '_app', 'immutable', 'bundle.Fx1.js'), bundle);
	writeFileSync(join(dir, '_app', 'immutable', 'bundle.Fx1.js.map'), built.map);
	writeFileSync(join(dir, '_app', 'immutable', 'assets.css.map'), '{}');
	const body = inline ? `<script>\n\t\t\t\t{\n\t\t\t\t\t${bundle}\n\t\t\t\t}\n\t\t\t</script>` : '';
	writeFileSync(
		join(dir, 'index.html'),
		`<!doctype html>\r\n<html>\r\n\t<head>\r\n\t\t<meta charset="utf-8" />\r\n\t</head>\r\n\t<body>\r\n\t\t<div>${body}</div>\r\n\t</body>\r\n</html>\r\n`,
	);
	return dir;
};

/** Where a string sits in the page, counted independently of the script (CRLF = one line). */
const pagePosition = (html, needle) => {
	const at = html.indexOf(needle);
	const lines = html.slice(0, at).split(/\r\n|\r|\n/);
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

// ── 1. the staged map resolves page positions to the original source ─────────────────────────────
{
	const dir = makeBuild();
	const out = mkdtempSync(join(tmpdir(), 'ie-sentry-staged-'));
	const staged = prepareRuntime(dir, out);
	check('the bundle map is staged outside the build', !!staged && staged.dir === out);
	if (!staged) {
		console.error('\nnothing staged — the remaining checks have nothing to read');
		process.exit(1);
	}
	const html = readFileSync(join(dir, 'index.html'), 'utf8');
	const map = JSON.parse(readFileSync(join(out, 'index.html.js.map'), 'utf8'));
	const page = readFileSync(join(out, 'index.html.js'), 'utf8');

	check('control: the bundle spans several lines', bundle.trim().split('\n').length > 2);

	// `function boom` sits on the bundle's FIRST line, so it is also shifted by the column offset.
	for (const token of ['"first-token"', 'function boom', 'throw new Error']) {
		const want = originalLineOf(token);
		const got = resolveAt(map, pagePosition(html, token));
		check(
			`page position of ${token} resolves to original line ${want + 1}`,
			got?.line === want,
			JSON.stringify(got),
		);
	}
	check(
		'control: the bundle starts mid-line in the page, and `function boom` is on its first line',
		pagePosition(html, bundle).column > 0 && bundle.split('\n')[0].includes('function boom'),
	);
	check(
		'sources are repo-relative, not climbing out of .svelte-kit',
		map.sources.every((s) => !s.startsWith('../')) &&
			map.sources[0] === 'packages/fixture/src/game.ts',
		JSON.stringify(map.sources),
	);
	check(
		'page, staged source and map carry one debug ID',
		html.includes(`"${staged.debugId}"`) &&
			page.includes(`//# debugId=${staged.debugId}`) &&
			map.debugId === staged.debugId &&
			map.debug_id === staged.debugId,
	);
	check(
		'no .map is left in the build',
		sourceMapLeaks(dir).length === 0,
		sourceMapLeaks(dir).join('; '),
	);
	check(
		'no sourceMappingURL in anything served',
		!/sourceMappingURL/.test(html) &&
			!/sourceMappingURL/.test(readFileSync(join(dir, '_app/immutable/bundle.Fx1.js'), 'utf8')),
	);

	// A re-run (the release job retried) must not add a second snippet or fail.
	prepareRuntime(dir, out);
	const again = readFileSync(join(dir, 'index.html'), 'utf8');
	check('a re-run adds no second debug-ID snippet', again.split(staged.debugId).length === 2);
	rmSync(dir, { recursive: true });
	rmSync(out, { recursive: true });
}

// ── 2. a bundle that is not inlined is not uploaded, but its maps still go ───────────────────────
{
	const dir = makeBuild({ inline: false });
	const out = mkdtempSync(join(tmpdir(), 'ie-sentry-staged-'));
	const staged = prepareRuntime(dir, out);
	check('a non-inlined bundle stages nothing', staged === null && readdirSync(out).length === 0);
	check('…and its maps are still stripped', sourceMapLeaks(dir).length === 0);
	rmSync(dir, { recursive: true });
	rmSync(out, { recursive: true });
}

// ── 3. the gate catches each way a map could ship (mutants) ──────────────────────────────────────
{
	const dir = makeBuild();
	for (const f of readdirSync(join(dir, '_app/immutable'))) {
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
