import { UPDATE_PRIORITY, type Renderer, type TextureSource, type Ticker } from 'pixi.js';

import {
	emptyChurnCounts,
	frameChurn,
	observeDomChurn,
	probeTextRenders,
	type ChurnCounts,
} from './churnProbe';
import { urlTail } from './ktx2Transcoder';
import {
	SCENE_EVERY,
	sampleScene,
	type SceneCost,
	type SceneNode,
	type SceneSample,
} from './sceneProbe';
import {
	currentFrameAt,
	frameJsMs,
	setPerfProbe,
	takePerfProbeCounts,
	type PerfProbeCounts,
} from './perfProbe';

/**
 * Per-frame counts of what the renderer asks the GPU for, for the `?perf=1` readout. Installed only
 * there (`instrumentRenderer`): it replaces every method of the one WebGL context with a counting
 * wrapper, which costs a function call per GL call, so a normal boot never has it.
 *
 * What each count is FOR, on a phone's tiled GPU (Apple's above all):
 * - `passes`: runs of draws into one framebuffer. Each new pass makes the GPU store the tiles of the
 *   last target and load the next one: on a 4× multisampled target, four samples a pixel each way.
 * - `targetSwitches`: framebuffer binds that changed the draw target (every filter does two).
 * - `resolves`: `blitFramebuffer`, i.e. MSAA resolves (the back buffer's, once a frame).
 * - `invalidations`: `invalidateFramebuffer`, attachments a pass may drop instead of storing.
 * - `filterPasses` / `filterGroups`: Pixi filter applications, and the containers they ran on.
 * - `textureUploads` / `uploadBytes` / `bufferBytes`: data sent to the GPU while playing.
 * - `compiles`: `compileShader` and `linkProgram` calls, i.e. a program built on its first use.
 * - `roundTrips`: calls that wait for an answer (`get*`, `readPixels`, `finish`,
 *   `checkFramebufferStatus`, `clientWaitSync`). Safari runs WebGL in its GPU process, so each is a
 *   synchronous message there.
 */
export interface GpuFrameCounts {
	calls: number;
	draws: number;
	/** Vertices (or indices) drawn. */
	vertices: number;
	passes: number;
	targetSwitches: number;
	resolves: number;
	invalidations: number;
	clears: number;
	copies: number;
	programs: number;
	filterGroups: number;
	filterPasses: number;
	textureUploads: number;
	/** Texture bytes uploaded: the data's size, or a source's pixels × 4. */
	uploadBytes: number;
	compiles: number;
	bufferUploads: number;
	bufferBytes: number;
	roundTrips: number;
	/** Milliseconds inside `renderer.render` (the CPU side: building and submitting the frame). */
	renderMs: number;
}

export const emptyGpuFrame = (): GpuFrameCounts => ({
	calls: 0,
	draws: 0,
	vertices: 0,
	passes: 0,
	targetSwitches: 0,
	resolves: 0,
	invalidations: 0,
	clears: 0,
	copies: 0,
	programs: 0,
	filterGroups: 0,
	filterPasses: 0,
	textureUploads: 0,
	uploadBytes: 0,
	compiles: 0,
	bufferUploads: 0,
	bufferBytes: 0,
	roundTrips: 0,
	renderMs: 0,
});

export interface RendererInfo {
	webgl: number;
	/** `WEBGL_debug_renderer_info`'s unmasked strings ("Apple GPU" on an iPhone), or the masked. */
	gpu: string;
	vendor: string;
	attributes: WebGLContextAttributes | null;
	backBuffer: boolean;
	backBufferMsaa: boolean;
	resolution: number;
	maxTextureSize: number;
	/** Compressed-texture families the context offers. */
	compressed: string[];
}

export interface TextureFormatSummary {
	format: string;
	count: number;
	/** Approximate GPU memory, MB (rounded to 0.1). */
	mb: number;
}

/** One texture the renderer holds: where it came from and its GPU size. */
export interface TextureListEntry {
	/** The file it was loaded from (its last two path segments, so no token rides along), or
	 *  Pixi's label for one made at runtime (`texturePool_3`: a text or a render target). */
	src: string;
	/** `compressed` (a KTX2 page), `image` (a WebP/PNG page), `canvas` (text drawn at runtime) or
	 *  `target` (a render target, or a pooled texture holding nothing). */
	kind: 'compressed' | 'image' | 'canvas' | 'target';
	width: number;
	height: number;
	format: string;
	/** Approximate GPU memory, MB (rounded to 0.01). */
	mb: number;
}

const UPLOADS = new Set([
	'texImage2D',
	'texSubImage2D',
	'compressedTexImage2D',
	'compressedTexSubImage2D',
	'texImage3D',
	'texSubImage3D',
	'compressedTexImage3D',
	'compressedTexSubImage3D',
]);
/** Each draw call, with the index of its vertex-count argument. */
const DRAWS = new Map([
	['drawElements', 1],
	['drawElementsInstanced', 1],
	['drawArrays', 2],
	['drawArraysInstanced', 2],
	['drawRangeElements', 3],
]);
const ROUND_TRIPS = new Set(['readPixels', 'finish', 'checkFramebufferStatus', 'clientWaitSync']);
const COMPILES = new Set(['compileShader', 'linkProgram']);

interface SizedSource {
	width?: number;
	height?: number;
	naturalWidth?: number;
	naturalHeight?: number;
	videoWidth?: number;
	videoHeight?: number;
	displayWidth?: number;
	displayHeight?: number;
}

/**
 * Approximate bytes an upload call sends. Every form of every upload call has its data after its
 * fifth argument, and nothing before it is an object: typed data counts its length, an image, a
 * canvas, a bitmap or a video frame its pixels × 4. `null` data (an allocation) and a pixel-buffer
 * offset count nothing.
 */
const uploadBytes = (args: unknown[]): number => {
	for (let i = 5; i < args.length; i++) {
		const data = args[i];
		if (!data || typeof data !== 'object') continue;
		if (ArrayBuffer.isView(data)) return data.byteLength;
		const s = data as SizedSource;
		const width = s.naturalWidth || s.videoWidth || s.displayWidth || s.width || 0;
		const height = s.naturalHeight || s.videoHeight || s.displayHeight || s.height || 0;
		return width * height * 4;
	}
	return 0;
};

/** Bytes per pixel for a Pixi texture format, by family; uncompressed RGBA otherwise. */
const bytesPerPixel = (format: string): number => {
	if (/^(bc1|bc4|etc2-rgb8|eac-r11|etc1)/.test(format)) return 0.5;
	if (/^(astc-4x4|bc[2357]|bc6|etc2-rgba8|etc2-rgb8a1|eac-rg11)/.test(format)) return 1;
	if (/^astc-(\d+)x(\d+)/.test(format)) {
		const [, w, h] = /^astc-(\d+)x(\d+)/.exec(format) as RegExpExecArray;
		return 16 / (Number(w) * Number(h));
	}
	if (/16float|rg32|rgba16/.test(format)) return 8;
	if (/32float/.test(format)) return 16;
	return 4;
};

/**
 * The textures the renderer holds, grouped by GPU format, largest first. Pixi's list keeps a `null`
 * where a texture it held was unloaded or destroyed (`GCManagedHash.remove`); those are skipped.
 */
export function textureFormats(
	sources: readonly (TextureSource | null | undefined)[],
): TextureFormatSummary[] {
	const by = new Map<string, { count: number; bytes: number }>();
	for (const source of sources) {
		if (!source) continue;
		const format = String(source.format);
		const entry = by.get(format) ?? { count: 0, bytes: 0 };
		entry.count++;
		entry.bytes += source.pixelWidth * source.pixelHeight * bytesPerPixel(format);
		by.set(format, entry);
	}
	return [...by.entries()]
		.map(([format, { count, bytes }]) => ({
			format,
			count,
			mb: Math.round(bytes / 1e5) / 10,
		}))
		.sort((a, b) => b.mb - a.mb);
}

/** A texture's source as the Copy names it: a URL's last two path segments, else its label. */
const textureSrc = (label: string): string =>
	label.startsWith('data:') ? 'data:' : /^(https?|blob|file):/.test(label) ? urlTail(label) : label;

/**
 * Every texture the renderer holds, largest first: what `?perf=1`'s Copy lists so a device reading
 * says which pages a phone holds uncompressed, not only how many.
 */
export function textureList(
	sources: readonly (TextureSource | null | undefined)[],
): TextureListEntry[] {
	const out: TextureListEntry[] = [];
	for (const source of sources) {
		if (!source) continue;
		const format = String(source.format);
		const resource: unknown = source.resource;
		const kind =
			source.uploadMethodId === 'compressed'
				? 'compressed'
				: resource == null
					? 'target'
					: /^texturePool_/.test(source.label ?? '') ||
						  (typeof HTMLCanvasElement !== 'undefined' && resource instanceof HTMLCanvasElement) ||
						  (typeof OffscreenCanvas !== 'undefined' && resource instanceof OffscreenCanvas)
						? 'canvas'
						: 'image';
		out.push({
			src: textureSrc(source.label ?? ''),
			kind,
			width: source.pixelWidth,
			height: source.pixelHeight,
			format,
			mb: Math.round((source.pixelWidth * source.pixelHeight * bytesPerPixel(format)) / 1e4) / 100,
		});
	}
	return out.sort((a, b) => b.mb - a.mb);
}

type GlMethod = (...args: unknown[]) => unknown;

interface FilterSystemInternals {
	push: GlMethod;
	applyFilter: GlMethod;
	_filterStack?: { skip?: boolean }[];
	_filterStackIndex?: number;
}

interface BackBufferInternals {
	useBackBuffer?: boolean;
	_antialias?: boolean;
}

/**
 * One frame's work: its GL counts, the CPU time of the Pixi tick that drew it, what the main thread
 * did around that tick, what its particles and rigs did (`perfProbe.ts`) and what it built and
 * threw away (`churnProbe.ts`). Its counts run from the start of its tick to the start of the next,
 * so what runs after the tick (the rigs' own ticker, Svelte's effects) is the frame's; its churn,
 * like `jsMs`, from its first frame callback to the next frame's (so the Svelte flush before its
 * tick is its own). It is handed over as the next tick starts.
 */
export interface FrameWork extends GpuFrameCounts, PerfProbeCounts, ChurnCounts {
	/** Milliseconds from the tick's first callback to the end of its render. */
	tickMs: number;
	/**
	 * From the frame's timestamp to the start of its tick: the frame callbacks that ran first, or
	 * the main thread still busy when the frame began.
	 */
	lateMs: number;
	/**
	 * From the end of the tick until the main thread was next free (a message posted then was
	 * handled): the frame callbacks after it (the rigs' ticker), Svelte's effects, the page's style,
	 * layout and paint, the frame's commit (which waits while the GPU is behind), any task first.
	 */
	afterMs: number;
	/**
	 * JS the frame ran in its animation-frame callbacks (the Pixi tick, the rigs' ticker, Svelte's
	 * tweens), each with the microtasks it queued (Svelte's effects). What else of `lateMs` +
	 * `tickMs` + `afterMs` the main thread did was the browser's, or another task's.
	 */
	jsMs: number;
	/**
	 * `?perfgpu=1` only: how long the GPU still had to work after the render was submitted (a
	 * 1-pixel `readPixels` waits for it). It stalls the pipeline, so it is never measured otherwise.
	 */
	gpuWaitMs?: number;
	/** Where the browser reports it (Chrome's `performance.memory`): the JS heap, MB, at the end. */
	heapMb?: number;
	/** Every {@link SCENE_EVERY} frames when the probe was asked for it: where the scene's cost sits. */
	scene?: SceneSample;
}

interface HeapMemory {
	usedJSHeapSize?: number;
}

export interface RendererProbe {
	/**
	 * `on` when the browser offers `EXT_disjoint_timer_query_webgl2` and the probe times each tick's
	 * GPU work with it (`onGpuTime`), else `n/a`.
	 */
	gpuTimer(): 'on' | 'n/a';
	info(): RendererInfo;
	textures(): TextureFormatSummary[];
	textureList(): TextureListEntry[];
	dispose(): void;
}

export interface InstrumentOptions {
	/** Called once a frame, as the next tick starts, with that frame's work. */
	onFrame: (work: FrameWork) => void;
	waitForGpu?: boolean;
	/**
	 * Called with the GPU time of a tick, ms, a few frames after it (a timer query is read only once
	 * it is ready, so it never stalls). Without the extension it is never called.
	 */
	onGpuTime?: (ms: number) => void;
	/** Sample the display tree every {@link SCENE_EVERY} frames (`sceneProbe.ts`). */
	scene?: boolean;
}

/** The parts of Pixi's render-group pipe the scene sample reads. */
interface RenderGroupPipeInternals {
	execute: GlMethod;
}
interface RenderPipesInternals {
	renderGroup?: RenderGroupPipeInternals;
}

interface TimerQueryExt {
	TIME_ELAPSED_EXT: number;
	GPU_DISJOINT_EXT: number;
}
/** Timer queries read back at most this many ticks late; older ones are dropped unread. */
const GPU_QUERIES_KEPT = 8;

/**
 * Count every GL call `app`'s renderer makes and its filter passes, time each tick and what the
 * main thread did around it, turn the particle, rig and display-object probe on (`perfProbe.ts`),
 * and count the text textures the renderer draws and the DOM nodes Svelte inserts beside the
 * canvas (`churnProbe.ts`).
 */
export function instrumentApp(
	app: { renderer: Renderer; ticker: Ticker; stage?: unknown },
	{ onFrame, waitForGpu = false, onGpuTime, scene = false }: InstrumentOptions,
): RendererProbe {
	const { renderer, ticker } = app;
	const stage = scene ? (app.stage as SceneNode | undefined) : undefined;
	const gl = (renderer as unknown as { gl: WebGL2RenderingContext }).gl;
	// WebGL's texture system; the type is the union of every renderer's.
	const managedTextures = () =>
		(renderer.texture as unknown as { managedTextures: (TextureSource | null)[] }).managedTextures;
	const native = Object.getPrototypeOf(gl) as WebGL2RenderingContext;
	let frame = emptyGpuFrame();
	const own = gl as unknown as Record<string, GlMethod>;
	const wrapped: string[] = [];
	let bound: WebGLFramebuffer | null = null;
	let passTarget: WebGLFramebuffer | null | undefined;
	const markPass = () => {
		if (passTarget === bound) return;
		passTarget = bound;
		frame.passes++;
	};
	const names = new Set<string>();
	for (let p: object | null = native; p && p !== Object.prototype; p = Object.getPrototypeOf(p))
		for (const name of Object.getOwnPropertyNames(p)) names.add(name);
	for (const name of names) {
		if (name === 'constructor') continue;
		const descriptor = Object.getOwnPropertyDescriptor(native, name);
		if (!descriptor || typeof descriptor.value !== 'function') continue;
		const fn = descriptor.value as GlMethod;
		const countArg = DRAWS.get(name);
		const upload = UPLOADS.has(name);
		const compile = COMPILES.has(name);
		const roundTrip = ROUND_TRIPS.has(name) || name.startsWith('get');
		own[name] = function (this: unknown, ...args: unknown[]) {
			frame.calls++;
			if (countArg !== undefined) {
				markPass();
				frame.draws++;
				frame.vertices += Number(args[countArg]) || 0;
			} else if (upload) {
				frame.textureUploads++;
				frame.uploadBytes += uploadBytes(args);
			} else if (compile) frame.compiles++;
			else if (roundTrip) frame.roundTrips++;
			else if (name === 'clear') {
				markPass();
				frame.clears++;
			} else if (name === 'bindFramebuffer') {
				if (args[0] !== gl.READ_FRAMEBUFFER && args[1] !== bound) {
					frame.targetSwitches++;
					bound = (args[1] as WebGLFramebuffer | null) ?? null;
				}
			} else if (name === 'blitFramebuffer') frame.resolves++;
			else if (name === 'invalidateFramebuffer') frame.invalidations++;
			else if (name === 'copyTexSubImage2D' || name === 'copyTexImage2D') frame.copies++;
			else if (name === 'useProgram') frame.programs++;
			else if (name === 'bufferData' || name === 'bufferSubData') {
				frame.bufferUploads++;
				const data = args[1];
				frame.bufferBytes +=
					typeof data === 'number' ? data : ((data as ArrayBufferView | null)?.byteLength ?? 0);
			}
			return fn.apply(this, args);
		};
		wrapped.push(name);
	}

	const filters = renderer.filter as unknown as FilterSystemInternals;
	const push = filters.push;
	const applyFilter = filters.applyFilter;
	filters.push = function (this: unknown, ...args: unknown[]) {
		const out = push.apply(this, args);
		const stack = filters._filterStack;
		const top =
			stack && filters._filterStackIndex ? stack[filters._filterStackIndex - 1] : undefined;
		if (!top?.skip) frame.filterGroups++;
		return out;
	};
	filters.applyFilter = function (this: unknown, ...args: unknown[]) {
		frame.filterPasses++;
		return applyFilter.apply(this, args);
	};

	const render = renderer.render;
	const timedRender = function (this: unknown, ...args: unknown[]) {
		const start = performance.now();
		try {
			return (render as GlMethod).apply(this, args);
		} finally {
			frame.renderMs += performance.now() - start;
		}
	};
	(renderer as unknown as { render: GlMethod }).render = timedRender;

	// Scene sample: what each top-level layer that is a render group cost in the sampled frame.
	let sampling = false;
	let ticks = 0;
	let layerCosts = new Map<SceneNode, SceneCost>();
	const groupPipe = (renderer as unknown as { renderPipes?: RenderPipesInternals }).renderPipes
		?.renderGroup;
	const groupExecute = groupPipe?.execute;
	const layerOf = (root: SceneNode | undefined): SceneNode | undefined => {
		let node = root as (SceneNode & { parent?: SceneNode | null }) | undefined;
		while (node?.parent && node.parent !== stage) node = node.parent as typeof node;
		return node?.parent === stage ? node : undefined;
	};
	const costNow = (): SceneCost => ({
		draws: frame.draws,
		passes: frame.passes,
		filterPasses: frame.filterPasses,
		targetSwitches: frame.targetSwitches,
	});
	let groupDepth = 0;
	if (stage && groupPipe && groupExecute) {
		groupPipe.execute = function (this: unknown, ...args: unknown[]) {
			if (!sampling) return groupExecute.apply(this, args);
			const top = groupDepth++ === 0;
			const before = top ? costNow() : undefined;
			try {
				return groupExecute.apply(this, args);
			} finally {
				groupDepth--;
				if (before) {
					const layer = layerOf((args[0] as { root?: SceneNode } | undefined)?.root);
					if (layer) {
						const after = costNow();
						const sum = layerCosts.get(layer) ?? {
							draws: 0,
							passes: 0,
							filterPasses: 0,
							targetSwitches: 0,
						};
						sum.draws += after.draws - before.draws;
						sum.passes += after.passes - before.passes;
						sum.filterPasses += after.filterPasses - before.filterPasses;
						sum.targetSwitches += after.targetSwitches - before.targetSwitches;
						layerCosts.set(layer, sum);
					}
				}
			}
		};
	}

	// GPU time: one timer query round each tick, read back when ready (never waited for).
	const timer = (
		!waitForGpu && onGpuTime ? gl.getExtension('EXT_disjoint_timer_query_webgl2') : null
	) as TimerQueryExt | null;
	const queries: WebGLQuery[] = [];
	let timing: WebGLQuery | undefined;
	const readTimers = () => {
		if (!timer) return;
		while (queries.length) {
			const q = queries[0];
			const ready = (native.getQueryParameter as GlMethod).call(gl, q, gl.QUERY_RESULT_AVAILABLE);
			if (!ready) break;
			queries.shift();
			const disjoint = (native.getParameter as GlMethod).call(gl, timer.GPU_DISJOINT_EXT);
			const ns = (native.getQueryParameter as GlMethod).call(gl, q, gl.QUERY_RESULT) as number;
			(native.deleteQuery as GlMethod).call(gl, q);
			if (!disjoint) onGpuTime?.(ns / 1e6);
		}
		while (queries.length > GPU_QUERIES_KEPT)
			(native.deleteQuery as GlMethod).call(gl, queries.shift());
	};
	const beginTimer = () => {
		if (!timer || timing) return;
		const q = (native.createQuery as GlMethod).call(gl) as WebGLQuery | null;
		if (!q) return;
		(native.beginQuery as GlMethod).call(gl, timer.TIME_ELAPSED_EXT, q);
		timing = q;
	};
	const endTimer = () => {
		if (!timer || !timing) return;
		(native.endQuery as GlMethod).call(gl, timer.TIME_ELAPSED_EXT);
		queries.push(timing);
		timing = undefined;
	};

	const memory = (performance as unknown as { memory?: HeapMemory }).memory;
	const heapMb = (): number | undefined =>
		typeof memory?.usedJSHeapSize === 'number' ? memory.usedJSHeapSize / 1e6 : undefined;
	// The main thread is free again when a message posted at the end of a tick is handled: a task,
	// so it waits for the rest of the frame's callbacks, its microtasks, style, layout and paint.
	const channel = new MessageChannel();
	let posted = 0;
	let freeAt: number | undefined;
	channel.port1.onmessage = (event: MessageEvent<number>) => {
		if (event.data === posted) freeAt = performance.now();
	};

	const undoText = probeTextRenders(renderer);
	// The canvas joins its host `<div>` once the app is initialised; until then, looked for each tick.
	let undoDom: (() => void) | undefined;
	const watchDom = () => {
		const host = renderer.canvas.parentElement;
		if (host) undoDom = observeDomChurn(host);
	};
	watchDom();

	const pixel = new Uint8Array(4);
	type TickTimes = Pick<FrameWork, 'tickMs' | 'lateMs' | 'gpuWaitMs' | 'scene'>;
	let ended: TickTimes | undefined;
	let tickStart = 0;
	let tickEnd = 0;
	let lateMs = 0;
	let frameAt = Number.NaN;
	setPerfProbe(true);
	const onTickStart = (t: Ticker) => {
		const now = performance.now();
		const counts = frame;
		const probed = takePerfProbeCounts();
		frame = emptyGpuFrame();
		passTarget = undefined;
		if (!undoDom) watchDom();
		if (ended) {
			const work: FrameWork = {
				...counts,
				...probed,
				...(frameChurn(frameAt) ?? emptyChurnCounts()),
				...ended,
				afterMs: (freeAt ?? now) - tickEnd,
				jsMs: frameJsMs(frameAt) ?? 0,
			};
			const heap = heapMb();
			if (heap !== undefined) work.heapMb = heap;
			ended = undefined;
			onFrame(work);
		}
		tickStart = now;
		readTimers();
		beginTimer();
		sampling = !!stage && ticks++ % SCENE_EVERY === 0;
		layerCosts = new Map();
		frameAt = currentFrameAt();
		// Inside a listener `lastTime` is still the previous frame's (`frameClock.ts`).
		lateMs = Math.max(0, now - (t.lastTime + t.elapsedMS));
	};
	const onTickEnd = () => {
		ended = { tickMs: performance.now() - tickStart, lateMs };
		endTimer();
		if (sampling && stage) {
			sampling = false;
			// After the tick's time is taken, and before `tickEnd`: the walk is not the frame's busy time.
			ended.scene = sampleScene(stage, layerCosts, costNow());
		}
		if (waitForGpu) {
			const start = performance.now();
			// The context's own method, so the wait is not counted as the next frame's work.
			(native.readPixels as GlMethod).call(gl, 0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
			ended.gpuWaitMs = performance.now() - start;
		}
		tickEnd = performance.now();
		freeAt = undefined;
		channel.port2.postMessage(++posted);
	};
	// First and last of every tick: the app renders at LOW, after every game callback.
	ticker.add(onTickStart, undefined, UPDATE_PRIORITY.INTERACTION);
	ticker.add(onTickEnd, undefined, UPDATE_PRIORITY.UTILITY);

	return {
		gpuTimer: () => (timer ? 'on' : 'n/a'),
		info() {
			const debug = gl.getExtension('WEBGL_debug_renderer_info');
			const backBuffer = (renderer as unknown as { backBuffer?: BackBufferInternals }).backBuffer;
			const compressed = [
				['astc', 'WEBGL_compressed_texture_astc'],
				['etc', 'WEBGL_compressed_texture_etc'],
				['bptc', 'EXT_texture_compression_bptc'],
				['s3tc', 'WEBGL_compressed_texture_s3tc'],
				['pvrtc', 'WEBGL_compressed_texture_pvrtc'],
			]
				.filter(([, ext]) => gl.getSupportedExtensions()?.includes(ext))
				.map(([family]) => family);
			return {
				webgl:
					typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext
						? 2
						: 1,
				gpu: String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)),
				vendor: String(gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR)),
				attributes: gl.getContextAttributes(),
				backBuffer: !!backBuffer?.useBackBuffer,
				backBufferMsaa: !!backBuffer?.useBackBuffer && !!backBuffer._antialias,
				resolution: renderer.resolution,
				maxTextureSize: Number(gl.getParameter(gl.MAX_TEXTURE_SIZE)),
				compressed,
			};
		},
		textures() {
			return textureFormats(managedTextures());
		},
		textureList() {
			return textureList(managedTextures());
		},
		dispose() {
			ticker.remove(onTickStart);
			ticker.remove(onTickEnd);
			channel.port1.close();
			undoText();
			undoDom?.();
			setPerfProbe(false);
			for (const name of wrapped) delete own[name];
			filters.push = push;
			filters.applyFilter = applyFilter;
			if (groupPipe && groupExecute) groupPipe.execute = groupExecute;
			for (const q of queries) (native.deleteQuery as GlMethod).call(gl, q);
			if (timing) {
				(native.endQuery as GlMethod).call(gl, timer?.TIME_ELAPSED_EXT);
				(native.deleteQuery as GlMethod).call(gl, timing);
			}
			if ((renderer as unknown as { render: GlMethod }).render === timedRender)
				(renderer as unknown as { render: typeof render }).render = render;
		},
	};
}
