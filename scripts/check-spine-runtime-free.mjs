// License gate: nothing that ships may depend on Esoteric's Spine runtimes. The engine, the games
// and every tool read and draw skeletons with our own runtime (`packages/engine-rig`), so no
// Spine license is needed to use them. Run: `node scripts/check-spine-runtime-free.mjs`.
//
// Fails on any `@esotericsoftware/*` declared by a tracked package.json or resolved in the lockfile,
// any tracked source that imports one, and any vendored copy of an Esoteric runtime script.
// `tools/rig-parity` is the one exception: it downloads the reference runtime at run time to prove
// ours matches it, and never installs it into the workspace.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLF } from './lib/read-lf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const SOURCE = /\.(ts|mts|js|mjs|cjs|svelte|html)$/;
const EXEMPT = /^(tools\/rig-parity\/|scripts\/check-spine-runtime-free\.mjs$)/;
const IMPORT = /(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]@esotericsoftware\//;
const VENDORED = /(^|\/)spine-(webgl|canvas|player|core|pixi[\w-]*)[\w.-]*\.js$/;

const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
	.stdout.split('\0')
	.filter(Boolean);
if (!tracked.includes('package.json'))
	throw new Error('check-spine-runtime-free: git ls-files found nothing');

const problems = [];
for (const rel of tracked) {
	if (EXEMPT.test(rel)) continue;
	if (rel === 'package.json' || rel.endsWith('/package.json')) {
		const pkg = JSON.parse(readLF(join(ROOT, rel)));
		const maps = [...FIELDS.map((f) => [f, pkg[f]]), ['pnpm.overrides', pkg.pnpm?.overrides]];
		for (const [field, deps] of maps)
			for (const name of Object.keys(deps ?? {}))
				if (name.startsWith('@esotericsoftware/')) problems.push(`${rel} ${field}: ${name}`);
		continue;
	}
	if (VENDORED.test(rel)) problems.push(`${rel}: vendored Esoteric runtime`);
	if (SOURCE.test(rel) && IMPORT.test(readLF(join(ROOT, rel))))
		problems.push(`${rel}: imports @esotericsoftware/*`);
}
const lock = readLF(join(ROOT, 'pnpm-lock.yaml'));
for (const [, name] of lock.matchAll(/^ {2}'?@esotericsoftware\/([\w-]+)@/gm))
	problems.push(`pnpm-lock.yaml: @esotericsoftware/${name}`);

if (problems.length) {
	console.error('✗ Esoteric Spine runtime found (use packages/engine-rig instead):');
	for (const p of [...new Set(problems)]) console.error('  ' + p);
	process.exit(1);
}
console.log('✓ no Esoteric Spine runtime in the workspace');
