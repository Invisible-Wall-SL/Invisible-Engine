/**
 * The Scene Editor's WebGL context budget.
 *
 * A browser keeps about 16 live WebGL contexts per page and silently drops the OLDEST past that —
 * and Chrome paints a dropped context's canvas OPAQUE WHITE, over every surface beneath it. The
 * editor stacks a rig, a text and an FX overlay per screen, per depth segment and per blend group,
 * on both the Screens and the Components side, so one context per overlay crosses that line on an
 * ordinary project: the earliest screens (the background, the board) vanish under a white sheet.
 *
 * So no overlay owns a context. Every rig overlay draws through ONE shared raw WebGL context (the
 * rig runtime's renderer), every text and FX overlay through ONE shared multi-view Pixi renderer,
 * and each copies its frame into a plain 2D canvas of its own. That canvas keeps the overlay's place
 * in the stack and carries its `mix-blend-mode`, so the composite is what it was — at two contexts,
 * however many screens are open.
 */
import { autoDetectRenderer, CanvasSource, Container, type Renderer } from 'pixi.js';

/** The shared rig context: an offscreen canvas, grown to the largest overlay drawn through it. */
export interface SharedRigGl {
	readonly canvas: HTMLCanvasElement;
	readonly gl: WebGLRenderingContext;
}

interface CountedRigGl extends SharedRigGl {
	users: number;
}

let rigGl: CountedRigGl | null = null;
const rigGlUsers = new WeakMap<SharedRigGl, CountedRigGl>();

/**
 * Take a reference to the shared rig context, creating it on first use (or after the last one was
 * lost). `null` when WebGL is unavailable. Pair every call with {@link releaseRigGl}.
 */
export function acquireRigGl(): SharedRigGl | null {
	if (!rigGl || rigGl.gl.isContextLost()) {
		const canvas = document.createElement('canvas');
		const gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true });
		if (!gl) return null;
		rigGl = { canvas, gl, users: 0 };
		rigGlUsers.set(rigGl, rigGl);
	}
	rigGl.users++;
	return rigGl;
}

/** Drop a reference; the last one frees the GPU context. */
export function releaseRigGl(handle: SharedRigGl): void {
	const shared = rigGlUsers.get(handle);
	if (!shared) return;
	shared.users--;
	if (shared.users > 0) return;
	if (rigGl === shared) rigGl = null;
	if (!shared.gl.isContextLost()) shared.gl.getExtension('WEBGL_lose_context')?.loseContext();
}

/**
 * Make room for a `width`×`height` frame and aim the viewport at it. GL counts rows from the
 * bottom, so the frame is the canvas's bottom-left corner — the region {@link presentRigFrame}
 * copies out.
 */
export function beginRigFrame(shared: SharedRigGl, width: number, height: number): void {
	const { canvas, gl } = shared;
	if (canvas.width < width || canvas.height < height) {
		canvas.width = Math.max(canvas.width, width);
		canvas.height = Math.max(canvas.height, height);
	}
	gl.viewport(0, 0, width, height);
}

/** Replace an overlay's 2D canvas with the frame just drawn. Call it in the same task as the draw:
 * the context does not preserve its drawing buffer. */
export function presentRigFrame(
	shared: SharedRigGl,
	target: CanvasRenderingContext2D,
	width: number,
	height: number,
): void {
	target.globalCompositeOperation = 'copy';
	target.drawImage(
		shared.canvas,
		0,
		shared.canvas.height - height,
		width,
		height,
		0,
		0,
		width,
		height,
	);
}

let pixiRenderer: Renderer | null = null;
let pixiPending: Promise<Renderer | null> | null = null;
let pixiUsers = 0;

function pixiLost(renderer: Renderer): boolean {
	return 'gl' in renderer && renderer.gl.isContextLost();
}

/** The live shared Pixi renderer, (re)created when there is none or the last one was lost. */
function obtainPixiRenderer(): Promise<Renderer | null> {
	if (pixiRenderer && !pixiLost(pixiRenderer)) return Promise.resolve(pixiRenderer);
	if (pixiRenderer) {
		const lost = pixiRenderer;
		pixiRenderer = null;
		try {
			lost.destroy();
		} catch {
			/* context already gone */
		}
	}
	pixiPending ??= autoDetectRenderer({
		preference: 'webgl',
		multiView: true,
		backgroundAlpha: 0,
		antialias: true,
		resolution: window.devicePixelRatio || 1,
		width: 1,
		height: 1,
	}).then(
		(renderer) => {
			pixiPending = null;
			if (pixiUsers === 0) {
				renderer.destroy();
				return null;
			}
			pixiRenderer = renderer;
			return renderer;
		},
		() => {
			pixiPending = null;
			return null;
		},
	);
	return pixiPending;
}

function releasePixiRenderer(): void {
	pixiUsers--;
	if (pixiUsers > 0 || !pixiRenderer) return;
	const renderer = pixiRenderer;
	pixiRenderer = null;
	renderer.destroy();
}

/** A Pixi overlay drawn through the shared renderer into a 2D canvas of its own. */
export interface PixiSurface {
	/** What the overlay draws. */
	readonly stage: Container;
	/** Settles `true` once the shared renderer is up, `false` if it never comes (no WebGL, or the
	 * surface was destroyed first). */
	readonly ready: Promise<boolean>;
	/** Draw now, sized to the host. Skipped while the host has no size (a hidden editor side). */
	render(): void;
	/** Draw on the next animation frame, however often it is asked before then. */
	requestRender(): void;
	destroy(): void;
}

/**
 * Mount a {@link PixiSurface} in `host`, its backing store at `resolution` device pixels per CSS
 * pixel. It re-sizes itself when the host does (a side-panel drag resizes the host without a window
 * resize) and draws again after.
 */
export function createPixiSurface(host: HTMLElement, resolution: number): PixiSurface {
	const canvas = document.createElement('canvas');
	canvas.style.position = 'absolute';
	canvas.style.inset = '0';
	canvas.style.width = '100%';
	canvas.style.height = '100%';
	canvas.style.pointerEvents = 'none';
	host.appendChild(canvas);
	const target = new CanvasSource({ resource: canvas, resolution });
	const stage = new Container();
	let destroyed = false;
	let frame = 0;
	pixiUsers++;

	const render = (): void => {
		if (destroyed) return;
		const width = host.clientWidth;
		const height = host.clientHeight;
		if (width === 0 || height === 0) return;
		const renderer = pixiRenderer;
		if (!renderer || pixiLost(renderer)) {
			void obtainPixiRenderer().then((next) => {
				if (next) requestRender();
			});
			return;
		}
		target.resize(width, height, resolution);
		// The multi-view copy draws OVER the canvas, so a transparent pixel would keep last frame's.
		target.context2D.clearRect(0, 0, canvas.width, canvas.height);
		renderer.render({ container: stage, target, clear: true, clearColor: [0, 0, 0, 0] });
	};

	const requestRender = (): void => {
		if (destroyed || frame) return;
		frame = requestAnimationFrame(() => {
			frame = 0;
			render();
		});
	};

	const observer = new ResizeObserver(() => requestRender());
	observer.observe(host);

	const ready = obtainPixiRenderer().then((renderer) => !destroyed && !!renderer);

	return {
		stage,
		ready,
		render,
		requestRender,
		destroy(): void {
			if (destroyed) return;
			destroyed = true;
			if (frame) cancelAnimationFrame(frame);
			observer.disconnect();
			stage.destroy({ children: true });
			target.destroy();
			canvas.remove();
			releasePixiRenderer();
		},
	};
}
