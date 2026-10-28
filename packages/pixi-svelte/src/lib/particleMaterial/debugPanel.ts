/**
 * The on-screen readout of `?fxdebug=1` for particle materials (Invisible Shader Graph step 8d.8,
 * the owner's phone check in `docs/playtest/particle-material.md`): a phone shows no console, so
 * the page's size, its frame times, and each app's GPU and material layers' latest `?fxdebug=1`
 * lines are written as text in its top-left corner. A page opened with `?fxdebug=1` gets it while
 * it has a material layer mounted; it takes no input and draws nothing on a canvas. When the last
 * layer is released the box and its frame clock go, and come back with the next layer.
 *
 * Lines are kept per app (each Pixi app's slot count, `particleMaterialSlotsFor`), numbered in the
 * order they first mounted a layer, so two stages on one page showing `embers/main` keep a line each.
 */

/** The element's id, so a harness can read it or hide it from a screenshot. */
export const FX_DEBUG_PANEL_ID = 'fxdebug-materials';

/** Frames a frame-time readout covers. */
const FRAME_WINDOW = 120;
/** A frame this long or longer counts as long (under 20 fps). */
const LONG_FRAME_MS = 50;
/** A gap this long is the page hidden or paused, not a frame: left out of the readout. */
const GAP_MS = 1000;

interface AppSection {
	readonly index: number;
	layers: number;
	gpu: string;
	readonly lines: Map<string, string>;
}

interface Panel {
	readonly element: HTMLPreElement;
	readonly apps: Map<object, AppSection>;
	frames: string;
	frame: number;
}

let panel: Panel | undefined;
const appIndexes = new WeakMap<object, number>();
let appsSeen = 0;

const nth = (sorted: readonly number[], q: number): number =>
	sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** A Pixi renderer's WebGL version and GPU; a renderer with no `gl` is not WebGL. */
function gpuText(renderer: object): string {
	const { gl, context } = renderer as {
		gl?: WebGLRenderingContext;
		context?: { webGLVersion?: number };
	};
	if (!gl) return 'not WebGL';
	const info = gl.getExtension('WEBGL_debug_renderer_info');
	const gpu = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
	return `WebGL${context?.webGLVersion ?? '?'} · ${gpu}`;
}

/** Redraw `p`; the page's size is read each time, so a turned phone shows its new size. */
function draw(p: Panel): void {
	const rows = [
		`fxdebug · particle materials · ${innerWidth}×${innerHeight} css px @${devicePixelRatio}x`,
		p.frames,
	];
	for (const app of p.apps.values()) {
		rows.push(`app ${app.index} · ${app.gpu}`);
		for (const [label, line] of app.lines) rows.push(`  ${label}: ${line}`);
	}
	p.element.textContent = rows.join('\n');
}

/** Time the page's frames, one readout every {@link FRAME_WINDOW}, while `p` is the panel. */
function timeFrames(p: Panel): void {
	const deltas: number[] = [];
	let last: number | undefined;
	const fxDebugFrame = (now: number): void => {
		if (panel !== p) return;
		const delta = last === undefined ? undefined : now - last;
		last = now;
		if (delta !== undefined && delta < GAP_MS) deltas.push(delta);
		if (deltas.length >= FRAME_WINDOW) {
			const sorted = [...deltas].sort((a, b) => a - b);
			const median = nth(sorted, 0.5);
			const long = deltas.filter((d) => d >= LONG_FRAME_MS).length;
			p.frames = `frames (last ${FRAME_WINDOW}, gaps over 1 s left out): ${median.toFixed(1)} ms median, ${nth(sorted, 0.95).toFixed(1)} p95, ${sorted[sorted.length - 1].toFixed(0)} max, ${long} of ${LONG_FRAME_MS} ms or more · ${(1000 / median).toFixed(0)} fps`;
			deltas.length = 0;
			draw(p);
		}
		p.frame = requestAnimationFrame(fxDebugFrame);
	};
	p.frame = requestAnimationFrame(fxDebugFrame);
}

/**
 * A material layer of `app` mounted: the panel shows (made with the first). Returns its release,
 * which takes the layer's count back (once); the app's lines go with its last layer, and the panel
 * and its frame clock with the page's last.
 */
export function fxDebugLayerMounted(app: object): () => void {
	if (typeof document === 'undefined' || !document.body) return () => {};
	if (!panel) {
		const element = document.createElement('pre');
		element.id = FX_DEBUG_PANEL_ID;
		element.style.cssText =
			'position:fixed;left:4px;top:4px;z-index:2147483647;margin:0;padding:4px 6px;' +
			'max-width:calc(100vw - 8px);max-height:50vh;overflow:hidden;' +
			'font:11px/1.35 monospace;color:#fff;background:rgba(0,0,0,0.72);' +
			'white-space:pre-wrap;pointer-events:none;';
		document.body.appendChild(element);
		panel = { element, apps: new Map(), frames: 'frames: measuring…', frame: 0 };
		timeFrames(panel);
	}
	const p = panel;
	let index = appIndexes.get(app);
	if (index === undefined) appIndexes.set(app, (index = ++appsSeen));
	let section = p.apps.get(app);
	if (!section) {
		section = { index, layers: 0, gpu: 'GPU not seen yet', lines: new Map() };
		p.apps.set(app, section);
	}
	const held = section;
	held.layers++;
	draw(p);
	let released = false;
	return () => {
		if (released || panel !== p) return;
		released = true;
		if (--held.layers > 0) return;
		p.apps.delete(app);
		if (p.apps.size) return draw(p);
		cancelAnimationFrame(p.frame);
		p.element.remove();
		panel = undefined;
	};
}

/** Show `line` as `app`'s layer `label`'s latest state (an app with a layer mounted). */
export function showFxDebugLine(app: object, label: string, line: string): void {
	const section = panel?.apps.get(app);
	if (!panel || !section) return;
	section.lines.set(label, line);
	draw(panel);
}

/** The renderer `app` draws with, for its GPU line. */
export function showFxDebugRenderer(app: object, renderer: object): void {
	const section = panel?.apps.get(app);
	if (!panel || !section) return;
	section.gpu = gpuText(renderer);
	draw(panel);
}
