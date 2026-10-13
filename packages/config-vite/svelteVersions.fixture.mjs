/**
 * The Svelte version guard (`svelteVersions.js`) over fake pnpm-shaped installs, plus the real
 * engine install it must let through.
 *
 *     node packages/config-vite/svelteVersions.fixture.mjs
 */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	ALLOW_ENV,
	ENGINE_ROOT,
	assertSvelteVersions,
	engineParserVersions,
	findPackage,
	lockedParserVersions,
} from './svelteVersions.js';

let failures = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — ${detail}`}`);
	if (!ok) failures += 1;
};

const ENGINE = { svelte: '5.57.1', kit: '2.70.3' };
const PARSERS = { esrap: '2.4.0', acorn: '8.18.0', '@sveltejs/acorn-typescript': '1.0.13' };

const LOCKFILE = `lockfileVersion: '9.0'

packages:

  svelte@5.57.1:
    resolution: {integrity: sha512-x}

snapshots:

  '@sveltejs/acorn-typescript@1.0.13(acorn@8.18.0)':
    dependencies:
      acorn: 8.18.0

  svelte@5.57.1(@typescript-eslint/types@8.71.0):
    dependencies:
      '@jridgewell/remapping': 2.3.5
      '@sveltejs/acorn-typescript': 1.0.13(acorn@8.18.0)
      acorn: 8.18.0
      esrap: 2.4.0(@typescript-eslint/types@8.71.0)
      zimmerframe: 1.1.5
    transitivePeerDependencies:
      - '@typescript-eslint/types'

  zimmerframe@1.1.5: {}
`;

const writeJson = (file, value) => {
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, JSON.stringify(value));
};

/**
 * A pnpm-style install: every package lives once in `store/<name>@<version>/node_modules/<name>`,
 * its own dependencies are symlinked beside it, and an importer reaches it through a symlink in
 * its own `node_modules`.
 */
const makeInstall = ({
	rootSvelte = ENGINE.svelte,
	rootKit = ENGINE.kit,
	engineSvelte = ENGINE.svelte,
	compilerSvelte = engineSvelte,
	parsers = PARSERS,
} = {}) => {
	const base = mkdtempSync(join(tmpdir(), 'svelte-pins-'));
	const store = (name, version, deps = []) => {
		const home = join(base, 'store', `${name.replace('/', '+')}@${version}`, 'node_modules');
		const dir = join(home, name);
		writeJson(join(dir, 'package.json'), { name, version });
		for (const dep of deps) {
			mkdirSync(dirname(join(home, dep.name)), { recursive: true });
			try {
				symlinkSync(dep.dir, join(home, dep.name), 'dir');
			} catch (error) {
				if (error.code !== 'EEXIST') throw error;
			}
		}
		return { name, dir };
	};
	const link = (fromDir, pkg) => {
		const at = join(fromDir, 'node_modules', pkg.name);
		mkdirSync(dirname(at), { recursive: true });
		symlinkSync(pkg.dir, at, 'dir');
	};
	const parserPkgs = Object.entries(parsers).map(([name, version]) => store(name, version));
	const svelte = (version) => store('svelte', version, parserPkgs);

	const engineRoot = join(base, 'game', 'engine');
	writeJson(join(engineRoot, 'apps', 'lines', 'package.json'), {
		dependencies: { svelte: ENGINE.svelte, '@sveltejs/kit': ENGINE.kit },
	});
	writeFileSync(join(engineRoot, 'pnpm-lock.yaml'), LOCKFILE);

	const plugin = store('@sveltejs/vite-plugin-svelte', '5.1.0', [svelte(compilerSvelte)]);
	const engineKit = store('@sveltejs/kit', ENGINE.kit, [plugin]);
	const engineFrom = join(engineRoot, 'packages', 'config-vite');
	link(engineFrom, svelte(engineSvelte));
	link(engineFrom, engineKit);

	const projectDir = join(base, 'game');
	link(projectDir, svelte(rootSvelte));
	link(projectDir, rootKit === ENGINE.kit ? engineKit : store('@sveltejs/kit', rootKit));

	return { base, options: { projectDir, engineRoot, engineFrom } };
};

/** Run the guard over a fake install; returns what it threw / warned / returned. */
const guard = (install, env = {}) => {
	const warnings = [];
	let error = null;
	let problems = null;
	try {
		problems = assertSvelteVersions({
			...install.options,
			env,
			warn: (message) => warnings.push(message),
		});
	} catch (e) {
		error = e;
	} finally {
		rmSync(install.base, { recursive: true, force: true });
	}
	return { error, warnings, problems, text: error?.message ?? warnings.join('\n') };
};

const names = (text, ...needles) => needles.filter((n) => !text.includes(n));

console.log('the lockfile parser');
check(
	'reads the parser pins off the svelte snapshot',
	JSON.stringify(lockedParserVersions(LOCKFILE, '5.57.1')) === JSON.stringify(PARSERS),
	JSON.stringify(lockedParserVersions(LOCKFILE, '5.57.1')),
);
check(
	'null for a version the lockfile does not hold',
	lockedParserVersions(LOCKFILE, '5.35.1') === null,
);

console.log('fake installs');
{
	const r = guard(makeInstall());
	check('matching versions → ok, no warning', !r.error && !r.warnings.length, r.text);
}
{
	const r = guard(makeInstall({ rootSvelte: '5.35.1' }));
	const fix = [
		'5.35.1',
		'5.57.1',
		'two Svelte copies',
		`${join('game', 'package.json')}`,
		`"svelte": "5.57.1"`,
		`"@sveltejs/kit": "2.70.3"`,
		`"esrap": "2.4.0"`,
		`"acorn": "8.18.0"`,
		`"@sveltejs/acorn-typescript": "1.0.13"`,
		ALLOW_ENV,
	];
	check(
		'root svelte older → error naming both versions, the file and the pins',
		r.error && names(r.text, ...fix).length === 0,
		r.error ? `missing: ${names(r.text, ...fix).join(', ')}` : 'did not throw',
	);
}
{
	const r = guard(makeInstall({ rootKit: '2.17.3' }));
	check(
		'kit mismatch → error naming both versions',
		r.error && names(r.text, '@sveltejs/kit 2.17.3', '2.70.3').length === 0,
		r.text || 'did not throw',
	);
	check('a kit-only mismatch is not reported as two Svelte copies', !r.text.includes('two Svelte'));
}
{
	const r = guard(makeInstall({ compilerSvelte: '5.56.0' }));
	check(
		'two Svelte copies (root matches the pin, the compiler does not) → error',
		r.error && names(r.text, 'two Svelte copies', '5.56.0 for the compiler').length === 0,
		r.text || 'did not throw',
	);
}
{
	const r = guard(makeInstall({ parsers: { ...PARSERS, esrap: '2.0.1' } }));
	check(
		"stale parser override (esrap 2.0.1) → error naming it and the lockfile's",
		r.error && names(r.text, 'esrap 2.0.1', 'esrap 2.4.0').length === 0,
		r.text || 'did not throw',
	);
}
{
	const r = guard(makeInstall({ rootSvelte: '5.35.1' }), { [ALLOW_ENV]: '1' });
	check(
		`${ALLOW_ENV}=1 → a warning, not an error`,
		!r.error && r.warnings.length === 1 && r.text.includes('5.35.1') && r.problems.length > 0,
		r.error ? r.error.message : `${r.warnings.length} warnings`,
	);
}
{
	const r = guard(makeInstall({ rootSvelte: '5.35.1' }), { [ALLOW_ENV]: 'true' });
	check(`${ALLOW_ENV} other than 1 still fails`, Boolean(r.error));
}

console.log('the real engine install');
const lines = join(ENGINE_ROOT, 'apps', 'lines');
let real = null;
try {
	real = assertSvelteVersions({ projectDir: lines, env: {}, warn: () => {} });
} catch (e) {
	real = e;
}
check('apps/lines passes the guard', Array.isArray(real) && !real.length, String(real?.message));
const locked = engineParserVersions();
const svelteDir = findPackage('svelte', lines)?.dir;
check(
	"the engine lockfile's parser pins are what its svelte resolves",
	locked &&
		svelteDir &&
		Object.entries(locked).every(([n, v]) => findPackage(n, svelteDir)?.version === v),
	JSON.stringify(locked),
);

if (failures) {
	console.error(`\n${failures} check(s) failed.`);
	process.exit(1);
}
console.log('\nPASS');
