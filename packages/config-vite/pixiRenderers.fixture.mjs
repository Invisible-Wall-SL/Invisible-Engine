/**
 * The WebGPU stub (`pixiRenderers.js`) against the INSTALLED pixi.js: the file it keys on is where
 * it expects, still makes each import it swaps, and the plugin swaps exactly those, only for that
 * file. A Pixi upgrade that moves or rewrites `autoDetectRenderer` fails here rather than quietly
 * putting WebGPU back in the bundle, or breaking the boot.
 *
 *     node packages/config-vite/pixiRenderers.fixture.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTO_DETECT_RENDERER, STUBBED_IMPORTS, noWebGpuRenderer } from './pixiRenderers.js';

let failures = 0;
const check = (name, ok, detail = '') => {
	console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `  — ${detail}`}`);
	if (!ok) failures += 1;
};

const here = dirname(fileURLToPath(import.meta.url));
const fromPixiSvelte = createRequire(join(here, '../pixi-svelte/package.json'));
const pixiRootOf = (file) =>
	existsSync(join(file, 'package.json')) &&
	JSON.parse(readFileSync(join(file, 'package.json'), 'utf8')).name === 'pixi.js'
		? file
		: pixiRootOf(dirname(file));
const pixiRoot = pixiRootOf(dirname(fromPixiSvelte.resolve('pixi.js')));
const pixiVersion = JSON.parse(readFileSync(join(pixiRoot, 'package.json'), 'utf8')).version;
const autoDetect = join(pixiRoot, 'lib/rendering/renderers/autoDetectRenderer.mjs');

let source = '';
try {
	source = readFileSync(autoDetect, 'utf8');
} catch {
	/* reported below */
}
check(`pixi.js ${pixiVersion} has lib/rendering/renderers/autoDetectRenderer.mjs`, source !== '');
check('the stub keys on that path', AUTO_DETECT_RENDERER.test(autoDetect), autoDetect);
for (const spec of Object.keys(STUBBED_IMPORTS)) {
	check(`autoDetectRenderer still imports '${spec}'`, source.includes(`'${spec}'`));
}
check(
	'autoDetectRenderer still has the canvas fallback',
	source.includes("'./canvas/CanvasRenderer.mjs'") && source.includes("'./gl/WebGLRenderer.mjs'"),
);

const plugin = noWebGpuRenderer();
plugin.buildStart();
for (const [spec, code] of Object.entries(STUBBED_IMPORTS)) {
	const id = plugin.resolveId(spec, autoDetect);
	check(`'${spec}' resolves to a stub`, typeof id === 'string' && id.startsWith('\0'), String(id));
	check(`'${spec}' loads its stub`, plugin.load(id) === code);
}
check(
	'the WebGL renderer import is left alone',
	plugin.resolveId('./gl/WebGLRenderer.mjs', autoDetect) === null,
);
check(
	'the same import from another file is left alone',
	plugin.resolveId(
		'./gpu/WebGPURenderer.mjs',
		join(pixiRoot, 'lib/rendering/renderers/someOther.mjs'),
	) === null,
);

const errors = [];
plugin.error = (message) => errors.push(message);
plugin.buildEnd();
check('a build that stubbed both passes buildEnd', errors.length === 0, errors.join('; '));

const partial = noWebGpuRenderer();
partial.error = (message) => errors.push(message);
partial.buildStart();
partial.resolveId('./gpu/WebGPURenderer.mjs', autoDetect);
partial.buildEnd();
check('a build where autoDetectRenderer skipped an import fails', errors.length === 1);

const untouched = noWebGpuRenderer();
untouched.error = (message) => errors.push(message);
untouched.buildStart();
untouched.buildEnd();
check('a build without Pixi (SSR) passes', errors.length === 1);

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log('\nall pixi renderer stub checks passed');
