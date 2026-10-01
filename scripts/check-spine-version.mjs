// Every @esotericsoftware/* (the Spine runtimes) a package declares or the lockfile resolves must be
// 4.2.x. Run: `node scripts/check-spine-version.mjs`.
//
// WHY: a Spine runtime reads one editor version's data, and everything we ship — exported skeletons,
// the Rigger's `.irig` — is Spine 4.2 JSON. semver calls 4.2 → 4.3 a minor, so a grouped Dependabot
// PR once carried spine-pixi-v8 4.3.13 in among 33 harmless bumps; only the Rigger spikes' hard-coded
// store path noticed. `.github/dependabot.yml` now ignores Spine minors; this catches a hand bump.
// A ranged spec (`^4.2.74`) is refused too: it lets a fresh lockfile resolve 4.3.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readLF } from './lib/read-lf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPEC = /^~?4\.2\.\d+$/;
const RESOLVED = /^4\.2\.\d+$/;
const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const HINT = 'the runtime must match the Spine 4.2 data we export — see .github/dependabot.yml';

for (const [spec, want] of [
	['4.2.74', true],
	['~4.2.80', true],
	['^4.2.74', false],
	['4.3.13', false],
	['workspace:*', false],
])
	if (SPEC.test(spec) !== want) throw new Error(`check-spine-version: matcher misjudges "${spec}"`);

const problems = [];
const manifests = spawnSync('git', ['ls-files', '-z', '--', 'package.json', '**/package.json'], {
	cwd: ROOT,
	encoding: 'utf8',
})
	.stdout.split('\0')
	.filter(Boolean);
if (!manifests.includes('package.json'))
	throw new Error('check-spine-version: git ls-files found no manifests');

let declared = 0;
for (const rel of manifests) {
	const pkg = JSON.parse(readLF(join(ROOT, rel)));
	const maps = [...FIELDS.map((f) => [f, pkg[f]]), ['pnpm.overrides', pkg.pnpm?.overrides]];
	for (const [field, deps] of maps)
		for (const [name, spec] of Object.entries(deps ?? {})) {
			if (!name.startsWith('@esotericsoftware/')) continue;
			declared++;
			if (!SPEC.test(spec)) problems.push(`${rel} ${field}: ${name} "${spec}"`);
		}
}

const lock = readLF(join(ROOT, 'pnpm-lock.yaml'));
const resolved = [...lock.matchAll(/^ {2}'?@esotericsoftware\/([\w-]+)@(\d[^(':\s]*)/gm)];
for (const [, name, version] of resolved)
	if (!RESOLVED.test(version))
		problems.push(`pnpm-lock.yaml: @esotericsoftware/${name}@${version}`);

if (!declared || !resolved.length)
	throw new Error('check-spine-version: found no Spine dependency — has the layout changed?');
if (problems.length) {
	console.error(`✗ Spine runtime outside 4.2.x (${HINT}):`);
	for (const p of problems) console.error(`  ${p}`);
	process.exit(1);
}
console.log(
	`✓ Spine runtimes pinned to 4.2.x — ${declared} declarations, ${resolved.length} lockfile entries`,
);
