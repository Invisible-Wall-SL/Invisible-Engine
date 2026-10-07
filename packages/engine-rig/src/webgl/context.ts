/** A WebGL context with the canvas it draws to. Accepts a canvas or an existing context. */
export class ManagedWebGLRenderingContext {
	readonly canvas: HTMLCanvasElement | OffscreenCanvas;
	readonly gl: WebGLRenderingContext;
	private restorables: Array<{ restore(): void }> = [];

	constructor(
		canvasOrContext:
			HTMLCanvasElement | OffscreenCanvas | WebGLRenderingContext | WebGL2RenderingContext,
		contextConfig: WebGLContextAttributes = { alpha: true },
	) {
		if (canvasOrContext instanceof WebGLRenderingContext || isWebGL2(canvasOrContext)) {
			this.gl = canvasOrContext as WebGLRenderingContext;
			this.canvas = this.gl.canvas as HTMLCanvasElement;
		} else {
			const canvas = canvasOrContext as HTMLCanvasElement;
			const gl = (canvas.getContext('webgl2', contextConfig) ??
				canvas.getContext('webgl', contextConfig)) as WebGLRenderingContext | null;
			if (!gl) throw new Error('WebGL is not available.');
			this.gl = gl;
			this.canvas = canvas;
		}
		const canvas = this.canvas as HTMLCanvasElement;
		canvas.addEventListener?.('webglcontextrestored', () => {
			for (const r of this.restorables) r.restore();
		});
	}

	addRestorable(restorable: { restore(): void }): void {
		this.restorables.push(restorable);
	}

	removeRestorable(restorable: { restore(): void }): void {
		const i = this.restorables.indexOf(restorable);
		if (i >= 0) this.restorables.splice(i, 1);
	}
}

function isWebGL2(value: unknown): boolean {
	return typeof WebGL2RenderingContext !== 'undefined' && value instanceof WebGL2RenderingContext;
}

export type ContextLike =
	ManagedWebGLRenderingContext | WebGLRenderingContext | WebGL2RenderingContext;

export function managed(context: ContextLike): ManagedWebGLRenderingContext {
	return context instanceof ManagedWebGLRenderingContext
		? context
		: new ManagedWebGLRenderingContext(context);
}
