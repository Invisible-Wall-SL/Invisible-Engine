// Run every offline check in the repo — fixtures, verify/check scripts, package tests, headless
// spikes and codegen `--check`s — and fail if any of them fails.
//
//   pnpm check:all                      # everything, in parallel
//   pnpm check:all --list               # what would run (and what is skipped, and why)
//   pnpm check:all --only flow-spike    # substring filter on the check id
//   pnpm check:all --shard 2/3          # the CI split (deterministic, by id)
//   pnpm check:all --exclude a,b        # drop ids a CI job already runs elsewhere
//
// WHY THIS EXISTS: the repo grew ~400 of these, each with a `Run:` line in its header, and CI ran a
// handful. The rest decayed silently — six flow spikes and an engine-layout test sat red on `main`
// as "known reds" until nobody could tell a new failure from an old one. A check nobody runs is not
// a check.
//
// DISCOVERED, not listed: a new file matching one of the patterns below is run without anyone
// editing this file. The ONLY hand-maintained list is SKIP, and every entry carries its reason — a
// check that needs the network, R2, a GPU, a live server or input arguments has no place in an
// offline gate, and saying so here is what stops it looking forgotten.
//
// HOW EACH ONE RUNS: if a package.json script in the file's own package (or the root) names the
// file, that script is used — it carries the flags the author found were needed (`--tsconfig`,
// `--experimental-test-module-mocks`, a `pre` hook). Otherwise by extension: `.ts`/`.mts` through
// tsx, `.mjs` through node with type-stripping and the repo's extension-resolving loader. A check
// that reads `process.env.PORT ?? 7777` talks to the mock RGS, so it gets a private one.

import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { availableParallelism } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LAUNCHER = join(ROOT, 'apps', 'launcher-api');
const TIMEOUT_MS = 5 * 60_000;

/** id → why it is not run here. An id is a repo-relative path, or `<package dir>:<script>`. */
const SKIP = {
	// Not checks: tooling that the gates themselves use.
	'scripts/check-commit-scope.mjs': 'commit-msg hook — takes the message file as its argument',
	'scripts/check-secrets.mjs': 'pre-commit hook — scans the staged diff (its test runs below)',
	'scripts/check-engine-game-fixtures.mjs': 'meta-runner — its fixtures are discovered directly',
	'scripts/check-all.mjs': 'this file',
	// Need the network, R2 or a deployed service.
	'apps/launcher-api/scripts/check-deployed-page.mjs': 'probes a deployed page over HTTP',
	'apps/launcher-api/scripts/verify-runtime-live.mjs': 'reads R2 and the live launcher',
};

/** Extra arguments for a check that needs an input to have anything to check. */
const ARGS = {
	// The config inspector refuses a config that would not save — pointed at the shipped one.
	'tools/game-config-spike:inspect': ['../../apps/lines/src/game/config.ts'],
};

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name) => {
	const i = argv.indexOf(name);
	return i >= 0 ? argv[i + 1] : undefined;
};

// Tracked plus untracked-but-not-ignored, so a fixture is gated from the moment it is written.
const trackedFiles = spawnSync('git', ['ls-files', '-z', '-co', '--exclude-standard'], {
	cwd: ROOT,
	encoding: 'utf8',
})
	.stdout.split('\0')
	.filter(Boolean);

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

/** Nearest directory at or above `rel`'s dir that has a package.json, repo-relative. */
function packageDirOf(rel) {
	let dir = dirname(rel);
	while (dir !== '.' && !existsSync(join(ROOT, dir, 'package.json'))) dir = dirname(dir);
	return dir;
}

const scriptsCache = new Map();
function scriptsOf(pkgDir) {
	if (!scriptsCache.has(pkgDir)) {
		const path = join(ROOT, pkgDir, 'package.json');
		scriptsCache.set(pkgDir, existsSync(path) ? (readJson(path).scripts ?? {}) : {});
	}
	return scriptsCache.get(pkgDir);
}

/** A package script whose command runs exactly this file (and no `&&` chain of others). */
function scriptFor(rel) {
	for (const pkgDir of [...new Set([packageDirOf(rel), '.'])]) {
		const local = relative(join(ROOT, pkgDir), join(ROOT, rel)).split(sep).join('/');
		for (const [name, cmd] of Object.entries(scriptsOf(pkgDir))) {
			if (name.startsWith('pre') || name.startsWith('post') || cmd.includes('&&')) continue;
			const tokens = cmd.split(/\s+/);
			if (tokens.includes(local) || tokens.includes(`./${local}`)) return { pkgDir, name };
		}
	}
	return null;
}

const nodeBin = process.execPath;
const tsxCli = createRequire(join(LAUNCHER, 'package.json')).resolve('tsx/cli');
const TS_NODE = ['--experimental-strip-types', '--no-warnings', '--import', './scripts/ts-loader.mjs'];

/** How to run a discovered file: [cwd, argv[]] with argv[0] = executable. */
function commandFor(rel) {
	const script = scriptFor(rel);
	if (script) return { cwd: join(ROOT, script.pkgDir), cmd: ['pnpm', 'run', '--silent', script.name] };
	if (/\.m?ts$/.test(rel)) {
		// The launcher's own sources import `$lib` / `$env`; its scripts tsconfig maps both.
		if (rel.startsWith('apps/launcher-api/'))
			return {
				cwd: LAUNCHER,
				cmd: [nodeBin, tsxCli, '--tsconfig', 'tsconfig.scripts.json', join(ROOT, rel)],
			};
		return { cwd: ROOT, cmd: [nodeBin, tsxCli, rel] };
	}
	// Package-local test scripts document `node scripts/test-x.mjs` from their package dir.
	if (/^packages\/[^/]+\/scripts\//.test(rel)) {
		const pkg = packageDirOf(rel);
		return { cwd: join(ROOT, pkg), cmd: [nodeBin, relative(join(ROOT, pkg), join(ROOT, rel))] };
	}
	return { cwd: ROOT, cmd: [nodeBin, ...TS_NODE, rel] };
}

const FILE_PATTERNS = [
	/\.fixture\.(ts|mts|mjs)$/,
	/^scripts\/(check|verify)-[^/]+\.(mjs|mts)$/,
	/^scripts\/[^/]+\.test\.mjs$/,
	/^scripts\/smoke-[^/]+\.mjs$/,
	/^apps\/[^/]+\/scripts\/(check|verify)-[^/]+\.(ts|mjs|mts)$/,
	/^packages\/[^/]+\/scripts\/test-[^/]+\.mjs$/,
];

/** A check that talks to the mock RGS reads its port this way; the runner starts one for it. */
const MOCK_RGS_CLIENT = /process\.env\.PORT \?\? 7777/;

/** Codegen whose committed output must match a fresh generation. */
const CODEGEN_CHECKS = trackedFiles.filter(
	(rel) =>
		/^scripts\/(gen|sync)-[^/]+\.mjs$/.test(rel) &&
		readFileSync(join(ROOT, rel), 'utf8').includes("process.argv.includes('--check')"),
);

function discover() {
	const checks = [];
	const seenScripts = new Set();
	for (const rel of trackedFiles) {
		if (!FILE_PATTERNS.some((re) => re.test(rel))) continue;
		const run = commandFor(rel);
		const key = run.cmd.join(' ') + run.cwd;
		if (seenScripts.has(key)) continue;
		seenScripts.add(key);
		checks.push({ id: rel, ...run, mockRgs: MOCK_RGS_CLIENT.test(readFileSync(join(ROOT, rel), 'utf8')) });
	}
	for (const rel of CODEGEN_CHECKS)
		checks.push({ id: `${rel} --check`, cwd: ROOT, cmd: [nodeBin, rel, '--check'] });

	// Launcher `check:*` scripts that do not point at a discovered file (e.g. a `--check` codegen).
	for (const [name, cmd] of Object.entries(scriptsOf('apps/launcher-api'))) {
		if (!name.startsWith('check:')) continue;
		if (checks.some((c) => c.cwd === LAUNCHER && c.cmd.at(-1) === name)) continue;
		const target = cmd.split(/\s+/).find((t) => /\.(ts|mts|mjs)$/.test(t));
		if (target && trackedFiles.includes(`apps/launcher-api/${target}`) && FILE_PATTERNS.some((re) => re.test(`apps/launcher-api/${target}`)))
			continue;
		checks.push({ id: `apps/launcher-api:${name}`, cwd: LAUNCHER, cmd: ['pnpm', 'run', '--silent', name] });
	}

	// Headless spikes: every script of every `tools/*-spike` package.
	for (const rel of trackedFiles) {
		const m = /^(tools\/[^/]+-spike)\/package\.json$/.exec(rel);
		if (!m) continue;
		for (const name of Object.keys(scriptsOf(m[1])))
			checks.push({ id: `${m[1]}:${name}`, cwd: join(ROOT, m[1]), cmd: ['pnpm', 'run', '--silent', name] });
	}
	return checks.sort((a, b) => a.id.localeCompare(b.id));
}

function skipReason(id) {
	return SKIP[id] ?? null;
}

const all = discover();
const stale = [...Object.keys(SKIP), ...Object.keys(ARGS)].filter(
	(id) => !all.some((c) => c.id === id) && !existsSync(join(ROOT, id)),
);
if (stale.length > 0) {
	console.error(`SKIP/ARGS name checks that no longer exist — delete them:\n  ${stale.join('\n  ')}`);
	process.exit(1);
}

let selected = all.filter((c) => !skipReason(c.id));
const only = opt('--only');
if (only) selected = selected.filter((c) => only.split(',').some((o) => c.id.includes(o)));
const exclude = opt('--exclude');
if (exclude) selected = selected.filter((c) => !exclude.split(',').includes(c.id));
const shard = opt('--shard');
if (shard) {
	const [i, n] = shard.split('/').map(Number);
	selected = selected.filter((_, idx) => idx % n === i - 1);
}

if (flag('--list')) {
	for (const c of selected) console.log(`  ${c.id}\n      (${relative(ROOT, c.cwd) || '.'}) ${c.cmd.map((a) => (a === nodeBin ? 'node' : a === tsxCli ? 'tsx' : a)).join(' ')}`);
	console.log(`\n${selected.length} to run. Skipped:`);
	for (const c of all) if (skipReason(c.id)) console.log(`  ${c.id} — ${skipReason(c.id)}`);
	process.exit(0);
}

if (selected.length === 0) {
	console.error('No checks selected — refusing to pass vacuously.');
	process.exit(1);
}

// One-off setup that several checks' `pre` hooks would otherwise race on in parallel.
// Through pnpm so the launcher's `node_modules/.bin` (where `svelte-kit` lives) is on PATH.
const setup = spawnSync('pnpm exec node scripts/ensure-svelte-kit.mjs', {
	cwd: LAUNCHER,
	stdio: 'inherit',
	shell: true,
});
if (setup.status !== 0) {
	console.error('`svelte-kit sync` for apps/launcher-api failed — the launcher checks cannot run.');
	process.exit(1);
}

function freePort() {
	return new Promise((done, fail) => {
		const server = createServer();
		server.on('error', fail);
		server.listen(0, '127.0.0.1', () => {
			const { port } = server.address();
			server.close(() => done(port));
		});
	});
}

/** A private mock RGS per check, so no two checks share a wallet or a round. */
async function startMockRgs() {
	const port = await freePort();
	const mock = spawn(nodeBin, ['scripts/mock-rgs-server.mjs'], {
		cwd: ROOT,
		env: { ...process.env, PORT: String(port) },
	});
	let log = '';
	await new Promise((ready, fail) => {
		const timer = setTimeout(() => fail(new Error(`mock RGS did not start:
${log}`)), 20_000);
		const onData = (d) => {
			log += d;
			if (log.includes('listening')) {
				clearTimeout(timer);
				ready();
			}
		};
		mock.stdout.on('data', onData);
		mock.stderr.on('data', (d) => (log += d));
		mock.on('exit', () => fail(new Error(`mock RGS exited:
${log}`)));
	});
	return { port, stop: () => mock.kill() };
}

async function runOne(check) {
	const started = Date.now();
	let mock;
	try {
		mock = check.mockRgs ? await startMockRgs() : undefined;
	} catch (err) {
		return { check, ok: false, ms: Date.now() - started, out: String(err) };
	}
	const result = await new Promise((done) => {
		const [exe, ...args] = [...check.cmd, ...(ARGS[check.id] ?? [])];
		const env = { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' };
		if (mock) env.PORT = String(mock.port);
		// pnpm is a `.cmd` shim on Windows, so it needs a shell — given as ONE string, because a
		// shell with an argv array is deprecated (DEP0190). Its arguments here are script names/paths.
		const child =
			exe === 'pnpm'
				? spawn([exe, ...args].join(' '), { cwd: check.cwd, shell: true, env })
				: spawn(exe, args, { cwd: check.cwd, env });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.stderr.on('data', (d) => (out += d));
		const timer = setTimeout(() => {
			out += `\n… timed out after ${TIMEOUT_MS / 1000}s`;
			child.kill('SIGKILL');
		}, TIMEOUT_MS);
		child.on('close', (code) => {
			clearTimeout(timer);
			done({ check, ok: code === 0, ms: Date.now() - started, out });
		});
	});
	mock?.stop();
	return result;
}

const jobs = Number(opt('--jobs')) || Math.max(2, Math.floor(availableParallelism() / 2));
const results = [];
let next = 0;
async function worker() {
	while (next < selected.length) {
		const result = await runOne(selected[next++]);
		results.push(result);
		const secs = (result.ms / 1000).toFixed(1);
		console.log(`${result.ok ? '✓' : '✗'} ${result.check.id} (${secs}s)`);
	}
}
const started = Date.now();
await Promise.all(Array.from({ length: jobs }, worker));

const failed = results.filter((r) => !r.ok);
for (const r of failed) {
	const tail = r.out
		.trimEnd()
		.split('\n')
		.slice(-40)
		.map((line) => (line.length > 300 ? `${line.slice(0, 300)} …` : line))
		.join('\n');
	console.log(`\n──── ✗ ${r.check.id}\n(${relative(ROOT, r.check.cwd) || '.'}) ${r.check.cmd.join(' ')}\n${tail}`);
}
const total = ((Date.now() - started) / 1000).toFixed(0);
console.log(`\n${results.length - failed.length}/${results.length} checks passed in ${total}s.`);
if (failed.length > 0) {
	console.error(`FAILED:\n${failed.map((r) => `  ${r.check.id}`).join('\n')}`);
	process.exit(1);
}
