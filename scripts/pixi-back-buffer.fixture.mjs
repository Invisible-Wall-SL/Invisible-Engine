/**
 * The pixi.js `pixi-svelte` resolves still works the way `packages/pixi-svelte/src/lib/
 * backBufferPasses.ts` and `renderQuality.ts` assume — run with:
 *   node scripts/pixi-back-buffer.fixture.mjs
 *
 * `backBufferPasses.ts` wraps three Pixi methods and relies on the facts below. A Pixi upgrade that
 * changes any of them fails here, rather than silently bringing back a full-screen resolve per
 * filter draw, or dropping a depth/stencil the next frame still reads:
 *   1. the WebGL filter draw is `FilterSystem._setupBindGroupsAndRender`, and it ends with
 *      `renderer.renderTarget.finishRenderPass()`;
 *   2. the back buffer presents from `GlBackBufferSystem.renderEnd` → `_presentBackBuffer`, which
 *      calls `renderer.renderTarget.finishRenderPass()`;
 *   3. `RenderTargetSystem.getGpuRenderTarget` and `GlRenderTargetAdaptor.bindFramebuffer` exist;
 *   4. a frame starts by clearing its target with `background.clearBeforeRender`, a boolean `true`
 *      clears `CLEAR.ALL` (depth and stencil too), and Pixi never narrows the stencil write mask.
 *
 * `renderQuality.ts` changes the resolution and the back buffer's MSAA between frames, and relies
 * on these. A change fails here, rather than an MSAA switch that does nothing or leaks the old
 * multisampled buffers, or a pointer that misses after a resolution change:
 *   5. the back buffer reads `_antialias` only where it makes its texture, and makes one only when
 *      it has none;
 *   6. `Texture.destroy(true)` destroys the source, a destroyed source unloads its GPU data, and
 *      the render target system releases a source's framebuffers and renderbuffers on its
 *      `destroy`;
 *   7. setting `renderer.resolution` resizes the canvas at its CSS size and tells the event system.
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

const getBackBufferTexture = method(backBuffer, '_getBackBufferTexture');
const uses = (source) => source.split('this._antialias').length - 1;
check(
	'GlBackBufferSystem makes its texture only when it has none, with _antialias, and reads it nowhere else',
	getBackBufferTexture.includes(
		'this._backBufferTexture = this._backBufferTexture || new Texture',
	) &&
		getBackBufferTexture.includes('antialias: this._antialias') &&
		uses(backBuffer) === uses(method(backBuffer, 'init')) + uses(getBackBufferTexture),
);

const targets = read('rendering/renderers/shared/renderTarget/RenderTargetSystem.mjs');
check(
	'a destroyed texture source unloads its GPU data and releases its render target, framebuffers and renderbuffers',
	method(read('rendering/renderers/shared/texture/Texture.mjs'), 'destroy').includes(
		'if (destroySource) {',
	) &&
		/this\.unload\(\);\s*this\.emit\("destroy", this\);/.test(
			method(read('rendering/renderers/shared/texture/sources/TextureSource.mjs'), 'destroy'),
		) &&
		method(targets, '_initRenderTarget').includes(
			'renderSurface.once("destroy", this._onRenderSurfaceDestroy, this)',
		) &&
		method(targets, '_releaseRenderTarget').includes(
			'this._releaseGpuRenderTarget(renderTarget)',
		) &&
		method(targets, '_releaseGpuRenderTarget').includes(
			'this.adaptor.destroyGpuRenderTarget(gpuRenderTarget)',
		) &&
		['deleteFramebuffer', 'deleteRenderbuffer', 'msaaRenderBuffer.forEach'].every((call) =>
			method(
				read('rendering/renderers/gl/renderTarget/GlRenderTargetAdaptor.mjs'),
				'destroyGpuRenderTarget',
			).includes(call),
		),
);

const view = read('rendering/renderers/shared/view/ViewSystem.mjs');
check(
	'setting renderer.resolution resizes the canvas source and tells the event system',
	/set resolution\(value\) \{\s*this\.view\.resolution = value;\s*this\.runners\.resolutionChange\.emit\(value\);/.test(
		read('rendering/renderers/shared/system/AbstractRenderer.mjs'),
	) &&
		/set resolution\(value\) \{\s*this\.texture\.source\.resize\(/.test(view) &&
		method(
			read('rendering/renderers/shared/texture/sources/CanvasSource.mjs'),
			'resizeCanvas',
		).includes('this.resource.style.width = `${this.width}px`') &&
		method(read('events/EventSystem.mjs'), 'resolutionChange').includes(
			'this.resolution = resolution',
		),
);

if (failures) throw new Error(`pixi-back-buffer fixture: ${failures} check(s) FAILED`);
console.log('pixi-back-buffer fixture: ok');
