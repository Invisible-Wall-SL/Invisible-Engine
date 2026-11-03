/**
 * The WebGPU stub and the eager boot imports (`pixiRenderers.js`) against the INSTALLED pixi.js: the
 * files they key on are where they expect, still make each import they swap, and the plugins swap
 * exactly those, only for those files. A Pixi upgrade that moves or rewrites `autoDetectRenderer` or
 * `browserExt` fails here rather than quietly putting WebGPU back in the bundle, moving the WebGL
 * renderer into a chunk every boot waits on, or breaking the boot.
 *
 *     node packages/config-vite/pixiRenderers.fixture.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	AUTO_DETECT_RENDERER,
	BROWSER_EXT,
	EAGER_IMPORTS,
	STUBBED_IMPORTS,
	eagerPixiBoot,
	noWebGpuRenderer,
} from './pixiRenderers.js';

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

const browserExt = join(pixiRoot, 'lib/environment-browser/browserExt.mjs');
check('the eager boot keys on browserExt.mjs', BROWSER_EXT.test(browserExt), browserExt);
const eager = eagerPixiBoot();
const eagerErrors = [];
eager.error = (message) => {
	eagerErrors.push(message);
	throw new Error(message);
};
for (const file of [autoDetect, browserExt]) {
	const code = existsSync(file) ? readFileSync(file, 'utf8') : '';
	const out = eager.transform(code, file)?.code ?? '';
	for (const { spec } of EAGER_IMPORTS.filter((e) => e.file.test(file))) {
		check(
			`${file.split('/lib/')[1]}: import('${spec}') becomes a static import`,
			code.includes(`import('${spec}')`) &&
				!out.includes(`import('${spec}')`) &&
				out.includes(`from '${spec}';`),
		);
	}
}
check(
	'the canvas fallback stays a dynamic import',
	(eager.transform(source, autoDetect)?.code ?? '').includes(
		"import('./canvas/CanvasRenderer.mjs')",
	),
);
check('another file is left alone', eager.transform(source, '/x/other.mjs') === null);
const ssrEager = eagerPixiBoot();
ssrEager.configResolved({ build: { ssr: true } });
check('the SSR pass is left alone', ssrEager.transform(source, autoDetect) === null);
let threw = false;
try {
	eager.transform('export const browserExt = {};', browserExt);
} catch {
	threw = true;
}
check('a browserExt that no longer imports browserAll fails the build', threw);

if (failures) {
	console.error(`\n${failures} failure(s)`);
	process.exit(1);
}
console.log('\nall pixi renderer stub checks passed');
