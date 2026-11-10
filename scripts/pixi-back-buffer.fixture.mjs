/**
 * The pixi.js `pixi-svelte` resolves still works the way `packages/pixi-svelte/src/lib/
 * backBufferPasses.ts` assumes — run with:
 *   node scripts/pixi-back-buffer.fixture.mjs
 *
 * That module wraps three Pixi methods and relies on three facts. A Pixi upgrade that changes any
 * of them fails here, rather than silently bringing back a full-screen resolve per filter draw, or
 * dropping a depth/stencil the next frame still reads:
 *   1. the WebGL filter draw is `FilterSystem._setupBindGroupsAndRender`, and it ends with
 *      `renderer.renderTarget.finishRenderPass()`;
 *   2. the back buffer presents from `GlBackBufferSystem.renderEnd` → `_presentBackBuffer`, which
 *      calls `renderer.renderTarget.finishRenderPass()`;
 *   3. `RenderTargetSystem.getGpuRenderTarget` and `GlRenderTargetAdaptor.bindFramebuffer` exist;
 *   4. a frame starts by clearing its target with `background.clearBeforeRender`, a boolean `true`
 *      clears `CLEAR.ALL` (depth and stencil too), and Pixi never narrows the stencil write mask.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, sep } from 'node:path';

// pixi.js as `pixi-svelte` resolves it (the root does not depend on it).
const require = createRequire(new URL('../packages/pixi-svelte/package.json', import.meta.url));
const main = require.resolve('pixi.js');
const lib = join(main.slice(0, main.lastIndexOf(`${sep}lib${sep}`)), 'lib');
const read = (rel) => readFileSync(join(lib, rel), 'utf8');
const method = (source, name) => {
	const start = source.indexOf(`  ${name}(`);
	return start < 0 ? '' : source.slice(start, source.indexOf('\n  }\n', start));
};

let failures = 0;
const check = (label, ok) => {
	console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
	if (!ok) failures++;
};

const filters = read('filters/FilterSystem.mjs');
check(
	'FilterSystem._setupBindGroupsAndRender ends with renderTarget.finishRenderPass()',
	method(filters, '_setupBindGroupsAndRender').includes('renderer.renderTarget.finishRenderPass()'),
);

const backBuffer = read('rendering/renderers/gl/GlBackBufferSystem.mjs');
check(
	'GlBackBufferSystem.renderEnd presents, and the present calls renderTarget.finishRenderPass()',
	method(backBuffer, 'renderEnd').includes('this._presentBackBuffer()') &&
		method(backBuffer, '_presentBackBuffer').includes('renderer.renderTarget.finishRenderPass()'),
);

check(
	'RenderTargetSystem.getGpuRenderTarget and GlRenderTargetAdaptor.bindFramebuffer exist',
	method(
		read('rendering/renderers/shared/renderTarget/RenderTargetSystem.mjs'),
		'getGpuRenderTarget',
	).length > 0 &&
		method(read('rendering/renderers/gl/renderTarget/GlRenderTargetAdaptor.mjs'), 'bindFramebuffer')
			.length > 0,
);

check(
	'a frame clears with clearBeforeRender, and true clears CLEAR.ALL',
	read('rendering/renderers/shared/system/AbstractRenderer.mjs').includes(
		'options.clear ?? (options.clear = this.background.clearBeforeRender)',
	) &&
		read('rendering/renderers/gl/renderTarget/GlRenderTargetAdaptor.mjs').includes(
			'clear = clear ? CLEAR.ALL : CLEAR.NONE',
		),
);

const walk = (dir) =>
	readdirSync(dir).flatMap((name) => {
		const path = join(dir, name);
		return statSync(path).isDirectory() ? walk(path) : path.endsWith('.mjs') ? [path] : [];
	});
const narrowing = walk(lib).filter((file) => readFileSync(file, 'utf8').includes('.stencilMask('));
check(
	`no pixi.js module narrows the stencil write mask${narrowing.length ? `: ${narrowing.join(', ')}` : ''}`,
	narrowing.length === 0,
);

if (failures) throw new Error(`pixi-back-buffer fixture: ${failures} check(s) FAILED`);
console.log('pixi-back-buffer fixture: ok');
