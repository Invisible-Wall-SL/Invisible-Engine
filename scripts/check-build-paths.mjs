// check:build-paths — a game build does not depend on the folder the engine is checked out in.
//
// Svelte names a component by its path relative to `rootDir`, and hashes that name into the
// component's scoped-CSS class (`svelte-<hash>`). `rootDir` defaults to the build's cwd
// (`apps/lines`), so a component under `packages/*`, outside it, kept its ABSOLUTE path: one commit
// built at /home/user/… and at CI's /home/runner/work/… gave different classes, a different CSS
// file, bundle and chunk hashes, and `check:runtime-bytes` could only be recorded at CI's own path.
// `config-svelte` sets `rootDir` to the engine's root. This compiles components with Svelte's real
// compiler and checks the class depends on the engine-relative path only. (Building every runtime
// in two checkouts is the end-to-end proof, ~20 minutes; the PR that added this gate ran it.)
//
// Run: pnpm check:build-paths

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = join(ROOT, 'packages/config-svelte');
const require = createRequire(join(pkg, 'package.json'));
const svelteCompiler = await import(pathToFileURL(require.resolve('svelte/compiler')).href);
const compile = svelteCompiler.compile ?? svelteCompiler.default.compile;
const config = await import(pathToFileURL(join(pkg, 'index.js')).href);

let passed = 0;
const check = (name, fn) => {
	fn();
	passed += 1;
	console.log(`  ok  ${name}`);
};

const SOURCE = '<p class="x">hi</p>\n<style>.x { color: red; }</style>\n';
/** The scoped class Svelte gives `filename` under `rootDir` (absent: Svelte's default, the cwd). */
const classOf = (filename, rootDir) => {
	const { css } = compile(SOURCE, { filename, css: 'external', ...(rootDir ? { rootDir } : {}) });
	return /\.x\.(svelte-[a-z0-9]+)/.exec(css.code)?.[1];
};

const inPackages = 'packages/pixi-svelte/src/lib/components/Example.svelte';
const inApp = 'apps/lines/src/components/Example.svelte';
const elsewhere = '/srv/elsewhere/Invisible-Engine';

check('the shared config names components from the engine root', () => {
	assert.equal(config.default().compilerOptions?.rootDir, ROOT);
});

check('the bug: from the app folder, a package component kept its absolute path', () => {
	const cwd = process.cwd();
	process.chdir(join(ROOT, 'apps/lines'));
	try {
		assert.notEqual(classOf(join(ROOT, inPackages)), classOf(join(elsewhere, inPackages)));
	} finally {
		process.chdir(cwd);
	}
});

check('under the engine root, a package component gets one class in any checkout', () => {
	assert.equal(
		classOf(join(ROOT, inPackages), ROOT),
		classOf(join(elsewhere, inPackages), elsewhere),
	);
});

check('…and so does an app component', () => {
	assert.equal(classOf(join(ROOT, inApp), ROOT), classOf(join(elsewhere, inApp), elsewhere));
});

check('two components still get two classes', () => {
	assert.notEqual(classOf(join(ROOT, inPackages), ROOT), classOf(join(ROOT, inApp), ROOT));
});

console.log(`check:build-paths — ${passed} checks passed`);
