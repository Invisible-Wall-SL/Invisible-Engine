// The reference Spine runtime the parity gates compare against: Esoteric's 4.2 packages, fetched
// from npm into a cache folder at run time. They are deliberately NOT dependencies of anything in
// the repo — the engine and tools run on engine-rig — so nothing that ships needs a Spine license.
//
//   const { core, pixiEntry, webglScript, nodeModules } = await reference();
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const VERSION = '4.2.120';
const PACKAGES = ['spine-core', 'spine-canvas', 'spine-pixi-v8', 'spine-webgl'];

/** Downloads (once) and unpacks the reference packages under `<cache>/node_modules/@esotericsoftware`. */
export async function reference() {
	const root = join(tmpdir(), `spine-reference-${VERSION}`);
	const scope = join(root, 'node_modules', '@esotericsoftware');
	mkdirSync(scope, { recursive: true });
	for (const name of PACKAGES) {
		const target = join(scope, name);
		if (existsSync(join(target, 'package.json'))) continue;
		const work = join(root, `.pack-${name}`);
		mkdirSync(work, { recursive: true });
		execFileSync(
			'npm',
			['pack', `@esotericsoftware/${name}@${VERSION}`, '--silent', '--pack-destination', work],
			{ stdio: 'ignore' },
		);
		const tarball = readdirSync(work).find((f) => f.endsWith('.tgz'));
		if (!tarball) throw new Error(`npm pack @esotericsoftware/${name}@${VERSION} produced nothing`);
		execFileSync('tar', ['-xzf', join(work, tarball), '-C', work]);
		renameSync(join(work, 'package'), target);
	}
	return {
		/** spine-core's ESM entry, for `import()`. */
		core: pathToFileURL(join(scope, 'spine-core', 'dist', 'index.js')).href,
		/** spine-pixi-v8's package folder, for a bundler alias. */
		pixiEntry: join(scope, 'spine-pixi-v8', 'dist', 'index.js'),
		/** The WebGL runtime as a browser script exposing `window.spine`. */
		webglScript: join(scope, 'spine-webgl', 'dist', 'iife', 'spine-webgl.js'),
		/** Add to a bundler's nodePaths so the packages resolve each other. */
		nodeModules: join(root, 'node_modules'),
	};
}
