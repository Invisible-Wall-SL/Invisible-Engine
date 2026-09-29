/**
 * The two machine-readable contracts the desktop launcher reads off a build, checked over the real
 * modules with no install, no network and no game repo:
 *
 *   1. `packages/config-vite/provenance.js` — what `__IE_BUILD__`, `build-info.json` and a
 *      delivery's `EMBED.md` say about where a build came from.
 *   2. `bake-editor-doc.mjs`'s gate refusals (`IE_BUILD_REFUSAL_JSON`) — driven against a local fake
 *      portal that refuses the flow, then the paytable.
 *
 *     node scripts/check-build-provenance.mjs
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const BAKE = resolve(ROOT, 'apps/launcher-api/scripts/bake-editor-doc.mjs');

let failures = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — ${detail}`}`);
	if (!ok) failures += 1;
};

// ── 1. provenance ────────────────────────────────────────────────────────────────────────────────
// Each case in a fresh process: `buildProvenance` is memoised per process, on purpose.
const provenance = (env) => {
	const code =
		`import { buildProvenance, BUILD_INFO_FILE } from ${JSON.stringify(
			pathToFileURL(resolve(ROOT, 'packages/config-vite/provenance.js')).href,
		)};` +
		`const a = buildProvenance(); const b = buildProvenance();` +
		`console.log(JSON.stringify({ a, same: a === b, file: BUILD_INFO_FILE }));`;
	const clean = Object.fromEntries(
		Object.entries(process.env).filter(([k]) => !k.startsWith('PUBLIC_BUILD_')),
	);
	const out = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
		cwd: ROOT,
		env: { ...clean, ...env },
		encoding: 'utf8',
	});
	return JSON.parse(out.stdout);
};

const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
const lock = createHash('sha256')
	.update(readFileSync(resolve(ROOT, 'pnpm-lock.yaml')))
	.digest('hex');

const asked = provenance({});
check('file name is build-info.json', asked.file === 'build-info.json', asked.file);
check('memoised: one object per process', asked.same === true);
check('engine commit asked of git', asked.a.engineSha === head, asked.a.engineSha);
check('in the monorepo the game commit is the same commit', asked.a.gameSha === head);
check('lockfile hash is sha256 of pnpm-lock.yaml', asked.a.lockfileSha256 === lock);
check(
	'no version / launcher unless told',
	asked.a.version === '' && asked.a.launcherVersion === '',
);
check('builtAt defaults to a real ISO time', !Number.isNaN(Date.parse(asked.a.builtAt)));

const told = provenance({
	PUBLIC_BUILD_VERSION: '42',
	PUBLIC_BUILD_TIME: '2026-09-29T10:00:00.000Z',
	PUBLIC_BUILD_ENGINE_SHA: 'e'.repeat(40),
	PUBLIC_BUILD_GAME_SHA: 'g'.repeat(40),
	PUBLIC_BUILD_LAUNCHER_VERSION: '1.0.56',
});
check(
	'the caller’s version + time win',
	told.a.version === '42' && told.a.builtAt.startsWith('2026-09-29'),
);
check(
	'the caller’s commits win',
	told.a.engineSha === 'e'.repeat(40) && told.a.gameSha === 'g'.repeat(40),
);
check('the launcher version is carried', told.a.launcherVersion === '1.0.56');
check('the lockfile is ALWAYS measured, never taken on trust', told.a.lockfileSha256 === lock);

// ── 2. bake gate refusals ────────────────────────────────────────────────────────────────────────
const fakePortal = (refuse) =>
	new Promise((ready) => {
		const server = createServer((req, res) => {
			const path = req.url.split('?')[0];
			if (path === refuse.path) {
				res.writeHead(409, { 'content-type': 'application/json' });
				return res.end(JSON.stringify(refuse.body));
			}
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(
				path === '/api/editor/doc' ? JSON.stringify({ doc: { scenes: [{ id: 's' }] } }) : '{}',
			);
		});
		server.listen(0, '127.0.0.1', () => ready(server));
	});

const bake = (port, env, dir) =>
	new Promise((done) => {
		const child = spawn(
			process.execPath,
			[
				BAKE,
				'--project',
				'p',
				'--base',
				`http://127.0.0.1:${port}`,
				'--token',
				't',
				'--dest',
				join(dir, 'out.json'),
			],
			{ cwd: ROOT, env: { ...process.env, ...env }, stdio: 'pipe' },
		);
		let log = '';
		child.stdout.on('data', (d) => (log += d));
		child.stderr.on('data', (d) => (log += d));
		child.on('close', (code) => done({ code, log }));
	});

const GATES = [
	{
		gate: 'invalid-flow',
		path: '/api/editor/export-flow',
		flag: '--allow-invalid-flow',
		env: 'ALLOW_INVALID_FLOW',
		body: {
			error: 'The flow has 2 validation errors.',
			details: ['a: exec-out-fanout', 'b: no scene'],
		},
	},
	{
		gate: 'paytable-drift',
		path: '/api/game-config/doc',
		flag: '--allow-paytable-drift',
		env: 'ALLOW_PAYTABLE_DRIFT',
		body: { error: 'The paytable disagrees.', details: ['H1 x5: 50 vs 40'] },
	},
];

const dir = mkdtempSync(join(tmpdir(), 'ie-provenance-'));
try {
	for (const g of GATES) {
		const server = await fakePortal(g);
		const { port } = server.address();
		const target = join(dir, `${g.gate}.json`);

		const { code, log } = await bake(port, { IE_BUILD_REFUSAL_JSON: target }, dir);
		const refusal = existsSync(target) ? JSON.parse(readFileSync(target, 'utf8')) : null;
		check(`${g.gate}: the bake refuses (exit 1)`, code === 1, `exit ${code}`);
		check(
			`${g.gate}: the log still names the override`,
			log.includes(g.flag) && log.includes(`${g.env}=1`),
		);
		check(`${g.gate}: refusal written as data`, refusal?.gate === g.gate, JSON.stringify(refusal));
		check(
			`${g.gate}: reason + every finding carried`,
			refusal?.error === g.body.error &&
				JSON.stringify(refusal?.details) === JSON.stringify(g.body.details),
		);
		check(
			`${g.gate}: override names the flag and env`,
			refusal?.override?.flag === g.flag && refusal?.override?.env === g.env,
		);

		rmSync(target, { force: true });
		const silent = await bake(port, {}, dir);
		check(`${g.gate}: no file unless asked for`, silent.code === 1 && !existsSync(target));
		server.close();
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures) {
	console.error(`\n${failures} check(s) failed.`);
	process.exit(1);
}
console.log('\nAll build provenance + refusal checks passed.');
