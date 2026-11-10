import type { Renderer, TextureSource } from 'pixi.js';

/** Which of the two {@link trimBackBufferPasses} leaves out (the URL switches turn each off). */
export interface BackBufferPassOptions {
	resolveOncePerFrame: boolean;
	discardDepthStencil: boolean;
}

type GpuRenderTarget = {
	framebuffer?: WebGLFramebuffer | null;
	depthStencilRenderBuffer?: WebGLRenderbuffer | null;
};

/**
 * Two things Pixi spends on the multisampled back buffer that change no pixel, left out. Both
 * matter on a tiled GPU (Apple's), where a render pass ends by storing its attachments to memory.
 *
 * **One resolve a frame.** Pixi's WebGL filter system ends every filter draw with
 * `renderTarget.finishRenderPass()` (`FilterSystem._setupBindGroupsAndRender`, pixi 8.22). On a
 * multisampled target that is a `blitFramebuffer` resolve of the WHOLE target, so with the back
 * buffer on, every Element FX pass, stage filter or glow drawn into it resolved the full screen,
 * and on a tiled GPU also stored and reloaded its four samples a pixel around that blit. Measured on
 * `overlay-buffaloduel` spinning at an iPhone's 780×1398: up to eight full-screen resolves in one
 * frame, all but one from filter draws. Nothing reads the back buffer's resolved texture until the
 * frame is presented (`GlBackBufferSystem._presentBackBuffer`, which resolves first) or a blend
 * filter copies the backdrop (`copyToTexture`, which resolves first), so the resolves in between
 * are thrown away. Only the back buffer is skipped: a filter drawing into any other multisampled
 * texture (a nested filter's input, which the parent samples next) still resolves.
 * `?lazyresolve=0` keeps Pixi's.
 *
 * **No depth/stencil store at the end of the frame.** Once a mask has used the stencil, the back
 * buffer carries a multisampled depth/stencil attachment, and the pass that ends at the present's
 * resolve stores it (four samples a pixel, 4 bytes each). The next frame clears it before anything
 * reads it (the frame starts with `CLEAR.ALL`, and Pixi never narrows `stencilMask`), so it is
 * invalidated just before that resolve and the driver may drop the store. Only at the present: a
 * pass ended mid-frame (a filter) keeps its stencil, which the masks drawn after it still need.
 * `?invalidate=0` keeps the store.
 *
 * Installed by `<InitialiseApplication>` when the renderer has a back buffer. A renderer whose
 * systems lack what this hooks (a future Pixi) is left untouched; `scripts/pixi-filter-resolve
 * .fixture.mjs` pins the installed Pixi's side.
 */
export function trimBackBufferPasses(
	renderer: Renderer,
	{ resolveOncePerFrame, discardDepthStencil }: BackBufferPassOptions,
): () => void {
	const backBuffer = (
		renderer as unknown as {
			backBuffer?: {
				useBackBuffer?: boolean;
				_backBufferTexture?: { source: TextureSource };
				renderEnd?: () => void;
			};
		}
	).backBuffer;
	const filters = renderer.filter as unknown as {
		_setupBindGroupsAndRender?: (...args: unknown[]) => unknown;
	};
	const setup = filters._setupBindGroupsAndRender;
	const renderEnd = backBuffer?.renderEnd;
	if (
		!backBuffer?.useBackBuffer ||
		typeof setup !== 'function' ||
		typeof renderEnd !== 'function' ||
		!(resolveOncePerFrame || discardDepthStencil)
	)
		return () => {};
	const gl = (renderer as unknown as { gl?: WebGL2RenderingContext }).gl;
	const targets = renderer.renderTarget;
	const system = targets as unknown as {
		getGpuRenderTarget?: (target: unknown) => GpuRenderTarget | undefined;
		adaptor?: { bindFramebuffer?: (framebuffer: WebGLFramebuffer) => void };
	};
	const canDiscard =
		discardDepthStencil &&
		typeof gl?.invalidateFramebuffer === 'function' &&
		typeof system.getGpuRenderTarget === 'function' &&
		typeof system.adaptor?.bindFramebuffer === 'function';
	const finish = targets.finishRenderPass;
	let inFilterDraw = false;
	let presenting = false;
	filters._setupBindGroupsAndRender = function (this: unknown, ...args: unknown[]) {
		inFilterDraw = true;
		try {
			return setup.apply(this, args);
		} finally {
			inFilterDraw = false;
		}
	};
	backBuffer.renderEnd = function (this: unknown) {
		presenting = true;
		try {
			return renderEnd.call(this);
		} finally {
			presenting = false;
		}
	};
	targets.finishRenderPass = function (this: typeof targets) {
		const onBackBuffer = this.renderTarget?.colorTexture === backBuffer._backBufferTexture?.source;
		if (onBackBuffer && inFilterDraw && resolveOncePerFrame) return;
		if (onBackBuffer && presenting && canDiscard && gl) {
			const gpu = system.getGpuRenderTarget?.(this.renderTarget);
			if (gpu?.framebuffer && gpu.depthStencilRenderBuffer) {
				system.adaptor?.bindFramebuffer?.(gpu.framebuffer);
				gl.invalidateFramebuffer(gl.FRAMEBUFFER, [gl.DEPTH_STENCIL_ATTACHMENT]);
			}
		}
		return finish.call(this);
	};
	return () => {
		filters._setupBindGroupsAndRender = setup;
		backBuffer.renderEnd = renderEnd;
		targets.finishRenderPass = finish;
	};
}
