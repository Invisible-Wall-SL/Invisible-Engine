// Only `packages/engine-3d` may carry three.js (`docs/design/3d-games.md`): it is the one package
// that declares `three` (pinned), and the `arcade3d` runtime reaches it through a dynamic import, so
// three.js is one lazy chunk of that runtime and absent from the four 2D runtimes. A second package
// declaring it, or a module outside `engine-3d` importing it, would put three.js where nothing
// measures it except `runtime-bytes` — and that check is advisory on `main` (3D review A, N4).
//
// Fails when:
//  - a tracked `package.json` other than `packages/engine-3d`'s declares `three`, `@types/three` or
//    a `three-*` package (any dependency field);
//  - a tracked source module outside `packages/engine-3d` imports `three` or `three/…`.
//
// Run: node scripts/check-three-owner.mjs

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OWNER = 'packages/engine-3d/';
const SELF = 'scripts/check-three-owner.mjs';

const FIELDS = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
const isThreePackage = (name) =>
	name === 'three' || name === '@types/three' || /^three-/.test(name);
/** `from 'three'`, `from "three/addons/…"`, `import('three')`, `require('three')`. */
const IMPORTS_THREE =
	/(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)['"]three(?:\/[^'"]*)?['"]/m;
const SOURCE = /\.(?:[cm]?[jt]s|svelte)$/;

const tracked = spawnSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' });
if (tracked.status !== 0) {
	console.error('check:three-owner — git ls-files failed:', tracked.stderr);
	process.exit(1);
}
const files = tracked.stdout.split('\0').filter(Boolean);

const problems = [];
let ownerDeclares = false;

for (const rel of files.filter((f) => f === 'package.json' || f.endsWith('/package.json'))) {
	const json = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
	for (const field of FIELDS)
		for (const name of Object.keys(json[field] ?? {}))
			if (isThreePackage(name)) {
				if (rel === `${OWNER}package.json`) ownerDeclares ||= name === 'three';
				else
					problems.push(`${rel} declares "${name}" in ${field}: only ${OWNER} may carry three.js`);
			}
}

let scanned = 0;
for (const rel of files.filter((f) => SOURCE.test(f) && !f.startsWith(OWNER) && f !== SELF)) {
	scanned++;
	if (IMPORTS_THREE.test(readFileSync(join(ROOT, rel), 'utf8')))
		problems.push(`${rel} imports three.js: only ${OWNER} may (reach it through engine-3d)`);
}

// The scan must be able to fail: each matcher catches its planted case and passes the near misses.
const planted = [
	["import { Mesh } from 'three';", true],
	['import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";', true],
	["const three = await import('three');", true],
	["import 'three';", true],
	["const { Mesh } = require('three');", true],
	["import { mountWorld3d } from 'engine-3d';", false],
	["import { x } from 'three-stdlib-ish/../threesome';", false],
	['// three.js draws the world', false],
];
for (const [text, hit] of planted)
	if (IMPORTS_THREE.test(text) !== hit)
		problems.push(`the import matcher ${hit ? 'misses' : 'wrongly flags'}: ${text}`);
for (const [name, hit] of [
	['three', true],
	['@types/three', true],
	['three-mesh-bvh', true],
	['threejs-utils', false],
	['engine-3d', false],
])
	if (isThreePackage(name) !== hit)
		problems.push(`the package matcher ${hit ? 'misses' : 'wrongly flags'} "${name}"`);

// Inputs this small mean the scan read the wrong thing, not that everything is fine.
if (!ownerDeclares)
	problems.push(`${OWNER}package.json no longer declares "three": update this gate`);
if (scanned < 500) problems.push(`only ${scanned} source modules scanned: the file list is wrong`);

if (problems.length) {
	console.error(`check:three-owner — ${problems.length} problem(s):`);
	for (const p of problems) console.error(`  ✗ ${p}`);
	process.exit(1);
}
console.log(`check:three-owner — only ${OWNER} carries three.js (${scanned} modules scanned)`);
