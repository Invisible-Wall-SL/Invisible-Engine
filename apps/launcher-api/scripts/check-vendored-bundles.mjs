// The static Rigger and Rig Viewer pages load COMMITTED builds of launcher/engine source, not the
// source itself. A source change therefore reaches every Svelte stage and silently skips these
// pages until someone rebuilds the bundle — which is how the FX forces shipped to /fx, the Scene
// Editor and the Symbols stage while the Rigger kept playing without them. A "remember to rebuild"
// note had been written for this bundle at least five times and still decayed, so this gate
// rebuilds every vendored bundle into a temp dir and fails if any differs from the committed file.
//
// Run: pnpm --filter launcher-api check:vendored-bundles
// Fix: pnpm --filter launcher-api build:<name> (named in the failure), then commit the bundle.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LAUNCHER = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Every `vite.<name>.config.ts` that writes a committed bundle, and where that bundle lives. */
const BUNDLES = [
	{ name: 'rigger-fx', committed: 'static/rigger/vendor/rigger-fx.js' },
	{ name: 'rigger-text', committed: 'static/rigger/vendor/rigger-text.js' },
	{ name: 'invisible-rig', committed: 'static/rig-viewer/vendor/invisible-rig.js' },
];

const stale = [];
for (const { name, committed } of BUNDLES) {
	const out = mkdtempSync(join(tmpdir(), `${name}-`));
	try {
		const build = spawnSync(
			'pnpm',
			[
				'exec',
				'vite',
				'build',
				'--config',
				`vite.${name}.config.ts`,
				'--outDir',
				out,
				'--logLevel',
				'error',
			],
			{ cwd: LAUNCHER, stdio: 'inherit' },
		);
		if (build.status !== 0) {
			console.error(`vendored bundles: building ${name} failed`);
			process.exit(1);
		}
		const fresh = readFileSync(join(out, `${name}.js`));
		if (fresh.equals(readFileSync(join(LAUNCHER, committed)))) console.log(`  ✓ ${committed}`);
		else stale.push({ name, committed });
	} finally {
		rmSync(out, { recursive: true, force: true });
	}
}

if (stale.length > 0) {
	for (const { name, committed } of stale)
		console.error(
			`  ✗ ${committed} is stale — the page that loads it is running old code.\n` +
				`    Rebuild: pnpm --filter launcher-api build:${name}, then commit it.`,
		);
	process.exit(1);
}
console.log('vendored bundles: every committed bundle matches its source');
