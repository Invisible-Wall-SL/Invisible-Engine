/**
 * GPU WARM-UP: the work a game would otherwise do on the frame it first needs it, done behind the
 * loading screen instead.
 *
 * Pixi uploads a texture the first time it is drawn and compiles a shader program the first time
 * it draws with it. Both block the main thread: a 2k uncompressed page costs tens of ms to upload
 * on a phone, and a program link often costs more. Measured on `commonoverlayproject` (2026-10-27,
 * a Pixel-sized page with the CPU slowed 4×): every program compiled after loading lined up with a
 * frame of 0.8–2.8 s, and the bonus uploaded 35 MB of art mid-play, each upload a stall of up to
 * 1.6 s. Players saw them as the reels or an effect skipping frames.
 *
 * The loader therefore ends with {@link warmGpu}: every texture it loaded is uploaded (and kept
 * resident, below), then every registered warm-up ({@link registerGpuWarmup}) compiles its programs. Both
 * are spread across frames so the loading screen keeps animating.
 *
 * KEPT RESIDENT, except on the `reduced` render tier (`renderTier.ts`), whose low-memory devices
 * keep Pixi's collector. Pixi's GPU garbage collector unloads an image texture that has not been drawn
 * for a minute (`ImageSource.autoGarbageCollect`; compressed pages are never collected), and the
 * next draw uploads it again: a big-win sheet or a bonus intro shown once every few minutes stalls
 * every time it comes back. The game's own art is loaded up front and kept in memory regardless
 * (the decoded bitmap stays on the source after an unload), so it now stays on the GPU too.
 */

import {
	Filter,
	RendererType,
	Texture,
	TextureSource,
	type GlProgram,
	type Renderer,
	type WebGLRenderer,
} from 'pixi.js';

import { programLinks } from './elementFx/shaders';

/** One warm-up: the steps that compile the programs some feature will draw with, one program a
 *  step, so the loader can spread them across frames. Called once per load. */
export type GpuWarmup = (renderer: Renderer) => Iterable<() => void>;

const warmups = new Set<GpuWarmup>();

/** Run `warmup` at the end of every load (once, however often it is registered); returns its
 *  removal. */
export function registerGpuWarmup(warmup: GpuWarmup): () => void {
	warmups.add(warmup);
	return () => warmups.delete(warmup);
}

/** Time spent warming per frame, so the loading screen stays smooth. */
const FRAME_BUDGET_MS = 8;
const FRAME_TIMEOUT_MS = 50;

const sourceOf = (value: unknown): TextureSource | undefined => {
	if (value instanceof TextureSource) return value;
	if (value instanceof Texture) return value.source;
	const source = (value as { source?: unknown } | null)?.source;
	return source instanceof TextureSource ? source : undefined;
};

/**
 * Every texture source a loaded asset holds: a texture, a spritesheet's (`textures`), a rig
 * atlas's or a bitmap font's pages (`pages[].texture`), or a dictionary of any of those (a rig's
 * raw files, a sheet's frames).
 */
export function collectTextureSources(value: unknown, into: Set<TextureSource>, depth = 0): void {
	if (!value || typeof value !== 'object' || ArrayBuffer.isView(value)) return;
	const direct = sourceOf(value);
	if (direct) {
		into.add(direct);
		return;
	}
	if (depth > 2) return;
	const { pages, textures } = value as { pages?: unknown; textures?: unknown };
	if (Array.isArray(pages)) {
		for (const page of pages) {
			const source = sourceOf((page as { texture?: unknown } | null)?.texture);
			if (source) into.add(source);
		}
		return;
	}
	if (textures && typeof textures === 'object') {
		for (const texture of Object.values(textures)) collectTextureSources(texture, into, depth + 1);
		return;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectTextureSources(item, into, depth + 1);
		return;
	}
	if (Object.getPrototypeOf(value) === Object.prototype) {
		for (const item of Object.values(value)) collectTextureSources(item, into, depth + 1);
	}
}

const isWebGL = (renderer: Renderer): renderer is WebGLRenderer =>
	renderer.type === RendererType.WEBGL;

/** Compile `program` now on a WebGL renderer, as Pixi's first draw with it would. */
export function compileProgram(renderer: Renderer, program: GlProgram | undefined): void {
	if (program && isWebGL(renderer)) {
		programLinks(renderer, program);
	}
}

/** Compile a filter's program, and those of the passes it runs inside (a blur's X and Y). */
export function compileFilter(renderer: Renderer, filter: Filter): void {
	compileProgram(renderer, filter.glProgram);
	for (const pass of Object.values(filter)) {
		if (pass instanceof Filter && pass !== filter) compileProgram(renderer, pass.glProgram);
	}
}

/** The next frame, or a short timeout where frames never come (a hidden tab, an offscreen iframe
 *  an operator preloads into), so the load still finishes there as it did before the warm-up. */
const nextFrame = () =>
	new Promise<void>((resolve) => {
		const timeout = setTimeout(resolve, FRAME_TIMEOUT_MS);
		requestAnimationFrame(() => {
			clearTimeout(timeout);
			resolve();
		});
	});

/** Run `steps` in order, yielding a frame whenever one frame's budget is spent. */
async function sliced(steps: Iterable<() => void>): Promise<void> {
	let start = performance.now();
	for (const step of steps) {
		try {
			step();
		} catch (error) {
			console.warn('[gpu-warmup]', error);
		}
		if (performance.now() - start > FRAME_BUDGET_MS) {
			await nextFrame();
			start = performance.now();
		}
	}
}

/**
 * Upload `sources`, then run every registered warm-up. `keepResident` opts the sources out of
 * Pixi's GC; a low-memory device leaves it off, trading the re-upload stall for memory.
 */
export async function warmGpu(
	renderer: Renderer,
	sources: Iterable<TextureSource>,
	{ keepResident }: { keepResident: boolean },
): Promise<void> {
	const uploads = [...sources].filter((source) => !source.destroyed && source.resource);
	await sliced(
		uploads.map((source) => () => {
			if (keepResident) source.autoGarbageCollect = false;
			renderer.texture.initSource(source);
		}),
	);
	await sliced(
		[...warmups].flatMap((warmup) => {
			try {
				return [...warmup(renderer)];
			} catch (error) {
				console.warn('[gpu-warmup]', error);
				return [];
			}
		}),
	);
}
