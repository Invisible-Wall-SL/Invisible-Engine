/**
 * The on-screen readout of `?fxdebug=1` for particle materials (Invisible Shader Graph step 8d.8,
 * the owner's phone check in `docs/playtest/particle-material.md`): a phone shows no console, so
 * the page's GPU, its frame times and each material layer's latest `?fxdebug=1` line are written as
 * text in its top-left corner. Only a page opened with `?fxdebug=1` that mounts a material layer
 * gets it; it takes no input and draws nothing on the canvas.
 */

/** The element's id, so a harness can read it or hide it from a screenshot. */
export const FX_DEBUG_PANEL_ID = 'fxdebug-materials';

/** Frames a frame-time readout covers. */
const FRAME_WINDOW = 120;
/** A frame this long or longer counts as long (under 20 fps). */
const LONG_FRAME_MS = 50;

interface Panel {
	readonly element: HTMLPreElement;
	readonly layers: Map<string, string>;
	device: string;
	frames: string;
}

let panel: Panel | undefined;

const nth = (sorted: readonly number[], q: number): number =>
	sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** The page's renderer, as the game exposes it for the Pixi devtools (`EnablePixiExtension`). */
function deviceText(): string {
	const screen = `${innerWidth}×${innerHeight} css px @${devicePixelRatio}x`;
	const renderer = (
		globalThis as {
			__PIXI_APP__?: {
				renderer?: { gl?: WebGLRenderingContext; context?: { webGLVersion?: number } };
			};
		}
	).__PIXI_APP__?.renderer;
	const gl = renderer?.gl;
	if (!gl) return screen;
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
	return `WebGL${renderer.context?.webGLVersion ?? '?'} · ${gpu} · ${screen}`;
}

function draw(p: Panel): void {
	p.element.textContent = [
		'fxdebug · particle materials',
		p.device,
		p.frames,
		...[...p.layers].map(([label, line]) => `${label}: ${line}`),
	].join('\n');
}

/** Time the page's frames, one readout every {@link FRAME_WINDOW}. */
function timeFrames(p: Panel): void {
	const deltas: number[] = [];
	let last: number | undefined;
	const tick = (now: number): void => {
		if (last !== undefined) deltas.push(now - last);
		last = now;
		if (deltas.length >= FRAME_WINDOW) {
			const sorted = [...deltas].sort((a, b) => a - b);
			const median = nth(sorted, 0.5);
			const long = deltas.filter((d) => d >= LONG_FRAME_MS).length;
			p.frames = `frames (last ${FRAME_WINDOW}): ${median.toFixed(1)} ms median, ${nth(sorted, 0.95).toFixed(1)} p95, ${sorted[sorted.length - 1].toFixed(0)} max, ${long} of ${LONG_FRAME_MS} ms or more · ${(1000 / median).toFixed(0)} fps`;
			if (!p.device.startsWith('WebGL')) p.device = deviceText();
			deltas.length = 0;
			draw(p);
		}
		requestAnimationFrame(tick);
	};
	requestAnimationFrame(tick);
}

/** Show `line` as layer `label`'s latest state (the panel is made on the first). */
export function showFxDebugLine(label: string, line: string): void {
	if (typeof document === 'undefined' || !document.body) return;
	if (!panel) {
		const element = document.createElement('pre');
		element.id = FX_DEBUG_PANEL_ID;
		element.style.cssText =
			'position:fixed;left:4px;top:4px;z-index:2147483647;margin:0;padding:4px 6px;' +
			'max-width:calc(100vw - 8px);font:11px/1.35 monospace;color:#fff;' +
			'background:rgba(0,0,0,0.72);white-space:pre-wrap;pointer-events:none;';
		document.body.appendChild(element);
		panel = { element, layers: new Map(), device: deviceText(), frames: 'frames: measuring…' };
		timeFrames(panel);
	}
	panel.layers.set(label, line);
	draw(panel);
}
