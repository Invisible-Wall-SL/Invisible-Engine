/**
 * Offline fixture for the back-buffer work left out (`backBufferPasses.ts`) — run with:
 *   node --experimental-strip-types packages/pixi-svelte/fixtures/backBufferPasses.fixture.ts
 *
 * Pins, on a stand-in renderer: a filter draw into the back buffer skips Pixi's resolve; a filter
 * draw into any other target still resolves; the present resolves, after invalidating the back
 * buffer's depth/stencil (bound through Pixi's adaptor) and only there; a filter draw never
 * invalidates (the masks drawn after it need the stencil); a back buffer without depth/stencil, or
 * a render to a texture, invalidates nothing; each switch turns off only its own half; a draw that
 * throws leaves no state behind; nothing is installed without a back buffer or a hook point;
 * releasing restores every method. The installed pixi.js's side of the contract is pinned by
 * `scripts/pixi-filter-resolve.fixture.mjs`.
 */

import type { Renderer } from 'pixi.js';

import { trimBackBufferPasses, type BackBufferPassOptions } from '../src/lib/backBufferPasses.ts';

let failures = 0;
const check = (label: string, ok: boolean, detail = ''): void => {
	if (ok) console.log(`  ok  ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`);
	}
};

type Source = { name: string };
type Target = {
	colorTexture: Source;
	gpu: { framebuffer: string; depthStencilRenderBuffer?: string };
};
const backBufferSource: Source = { name: 'back buffer' };
const otherSource: Source = { name: 'filter input' };

const standIn = (
	opts: { useBackBuffer?: boolean; withSetup?: boolean; stencil?: boolean } = {},
) => {
	const log: string[] = [];
	const backBufferTarget: Target = {
		colorTexture: backBufferSource,
		gpu: {
			framebuffer: 'msaa fb',
			...(opts.stencil === false ? {} : { depthStencilRenderBuffer: 'ds' }),
		},
	};
	const otherTarget: Target = { colorTexture: otherSource, gpu: { framebuffer: 'other fb' } };
	const targets: {
		renderTarget: Target;
		finishRenderPass(): void;
		getGpuRenderTarget(t: Target): Target['gpu'];
		adaptor: { bindFramebuffer(fb: string): void };
	} = {
		renderTarget: backBufferTarget,
		finishRenderPass() {
			log.push(`resolve ${this.renderTarget.colorTexture.name}`);
		},
		getGpuRenderTarget: (t) => t.gpu,
		adaptor: { bindFramebuffer: (fb) => log.push(`bind ${fb}`) },
	};
	const filter: { _setupBindGroupsAndRender?: (fail?: boolean) => void } = {};
	if (opts.withSetup !== false)
		filter._setupBindGroupsAndRender = (fail?: boolean) => {
			if (fail) throw new Error('draw failed');
			targets.finishRenderPass();
		};
	const backBuffer = {
		useBackBuffer: opts.useBackBuffer !== false,
		_backBufferTexture: { source: backBufferSource },
		renderEnd() {
			targets.finishRenderPass();
		},
	};
	const gl = {
		FRAMEBUFFER: 36160,
		DEPTH_STENCIL_ATTACHMENT: 33306,
		invalidateFramebuffer: (target: number, attachments: number[]) =>
			log.push(`invalidate ${target}:${attachments.join()}`),
	};
	const renderer = { backBuffer, filter, renderTarget: targets, gl };
	const install = (o: BackBufferPassOptions) =>
		trimBackBufferPasses(renderer as unknown as Renderer, o);
	return { log, targets, filter, backBuffer, backBufferTarget, otherTarget, install };
};
const both = { resolveOncePerFrame: true, discardDepthStencil: true };
const INVALIDATE = 'invalidate 36160:33306';

{
	const s = standIn();
	const original = [
		s.targets.finishRenderPass,
		s.filter._setupBindGroupsAndRender,
		s.backBuffer.renderEnd,
	];
	const release = s.install(both);
	s.filter._setupBindGroupsAndRender?.();
	check(
		'a filter draw into the back buffer neither resolves nor invalidates',
		s.log.length === 0,
		s.log.join(),
	);
	s.targets.renderTarget = s.otherTarget;
	s.filter._setupBindGroupsAndRender?.();
	check(
		'a filter draw into another texture still resolves',
		s.log.join() === 'resolve filter input',
		s.log.join(),
	);
	s.log.length = 0;
	s.targets.renderTarget = s.backBufferTarget;
	s.backBuffer.renderEnd();
	check(
		'the present binds the back buffer, invalidates its depth/stencil, then resolves',
		s.log.join() === `bind msaa fb,${INVALIDATE},resolve back buffer`,
		s.log.join(),
	);
	s.log.length = 0;
	s.targets.finishRenderPass();
	check(
		'a resolve outside the present does not invalidate',
		s.log.join() === 'resolve back buffer',
		s.log.join(),
	);
	s.log.length = 0;
	s.targets.renderTarget = s.otherTarget;
	s.backBuffer.renderEnd();
	check(
		'a render to a texture invalidates nothing',
		s.log.join() === 'resolve filter input',
		s.log.join(),
	);
	s.log.length = 0;
	s.targets.renderTarget = s.backBufferTarget;
	try {
		s.filter._setupBindGroupsAndRender?.(true);
	} catch {
		// the draw's own failure
	}
	s.targets.finishRenderPass();
	check(
		'a failed draw leaves no filter state behind',
		s.log.join() === 'resolve back buffer',
		s.log.join(),
	);
	release();
	check(
		'release restores every method',
		s.targets.finishRenderPass === original[0] &&
			s.filter._setupBindGroupsAndRender === original[1] &&
			s.backBuffer.renderEnd === original[2],
	);
}

{
	const s = standIn({ stencil: false });
	s.install(both);
	s.backBuffer.renderEnd();
	check(
		'no depth/stencil yet: the present only resolves',
		s.log.join() === 'resolve back buffer',
		s.log.join(),
	);
}

{
	const s = standIn();
	s.install({ resolveOncePerFrame: false, discardDepthStencil: true });
	s.filter._setupBindGroupsAndRender?.();
	s.backBuffer.renderEnd();
	check(
		'?lazyresolve=0: filter draws resolve again, the present still invalidates',
		s.log.join() === `resolve back buffer,bind msaa fb,${INVALIDATE},resolve back buffer`,
		s.log.join(),
	);
}

{
	const s = standIn();
	s.install({ resolveOncePerFrame: true, discardDepthStencil: false });
	s.filter._setupBindGroupsAndRender?.();
	s.backBuffer.renderEnd();
	check(
		'?invalidate=0: the present only resolves',
		s.log.join() === 'resolve back buffer',
		s.log.join(),
	);
}

{
	const s = standIn({ useBackBuffer: false });
	const finish = s.targets.finishRenderPass;
	s.install(both);
	check('no back buffer: nothing installed', s.targets.finishRenderPass === finish);
}

{
	const s = standIn({ withSetup: false });
	const finish = s.targets.finishRenderPass;
	s.install(both);
	check('no hook point: nothing installed', s.targets.finishRenderPass === finish);
}

{
	const s = standIn();
	const finish = s.targets.finishRenderPass;
	s.install({ resolveOncePerFrame: false, discardDepthStencil: false });
	check('both switches off: nothing installed', s.targets.finishRenderPass === finish);
}

if (failures) throw new Error(`backBufferPasses fixture: ${failures} check(s) FAILED`);
console.log('\nbackBufferPasses fixture: ok');
