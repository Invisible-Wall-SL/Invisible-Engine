/**
 * Invisible FX — "Bake now" (`invisible-fx.md` §"Baked effects"): render an effect's loop to one
 * sprite sheet in the browser, then hand it to R2 through `/api/fx/bake`.
 *
 * The capture runs in its OWN offscreen Pixi app, never in the preview stage, so the author's view,
 * pan/zoom and backdrop rig are untouched and nothing on the stage leaks into the sheet. Each layer
 * is mounted as `<EffectLayer>` mounts it in the game (the layer's offset as its container, the art
 * and material through the same helpers `FxStage` uses), and stepped by the game's own clock:
 * `emitterDeltaSeconds(1000 / fps)` per captured frame.
 */

import type { Emitter } from '@barvynkoa/particle-emitter';
import {
	EFFECT_BAKE_LIMITS,
	bindArt,
	effectBakeBlend,
	effectBakeBlockers,
	effectBakeFrameCount,
	effectBakeHash,
	effectBakeSeamFrames,
	effectBakeSeamWeight,
	effectBakeWarmup,
	emitterDeltaSeconds,
	normalizeEffectDoc,
	planEffectBakeSheet,
	type EffectBakeResult,
	type EffectBakeSheetPlan,
	type EffectDoc,
} from 'engine-fx';
import {
	particleMaterialSlotsFor,
	type MountedParticleMaterial,
} from 'pixi-svelte/particleMaterial';
import { Application, Container, Rectangle, type TextureSource } from 'pixi.js';
import { framesToTextures, type ResolveArt } from '$lib/fx/effectEmitter.client';
import { layerEmitter, layerMaterialPeak, mountLayerMaterial } from '$lib/fx/layerMaterial.client';

/** Where the capture is, for the progress bar. */
export interface BakeProgress {
	phase: 'warm-up' | 'capture' | 'sheet' | 'upload';
	done: number;
	total: number;
}

/** One captured frame: its pixels (straight alpha) and where they sit in effect pixels. */
interface CapturedFrame {
	image: ImageData | null;
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A finished capture, before upload. */
export interface BakeCapture {
	canvas: HTMLCanvasElement;
	plan: EffectBakeSheetPlan;
	frames: number;
	/** The box every frame covers, effect pixels. */
	bounds: { x: number; y: number; w: number; h: number };
	blendMode: EffectBakeResult['blendMode'];
	fps: number;
	/** `effectBakeHash` of the normalized doc the loop was captured from. */
	hash: string;
}

/**
 * The capture app, made once and kept for the page's life. Never destroyed: Pixi's batches live in a
 * pool shared by every renderer, and destroying a renderer leaves its batches in that pool with their
 * texture lists torn down — the preview stage's next render then picks one up and throws.
 */
let capture: Promise<Application> | undefined;
function captureApp(): Promise<Application> {
	capture ??= (async () => {
		const app = new Application();
		await app.init({
			width: 8,
			height: 8,
			backgroundAlpha: 0,
			antialias: true,
			autoStart: false,
			preference: 'webgl',
		});
		return app;
	})();
	capture.catch(() => (capture = undefined));
	return capture;
}

const yieldToUi = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** WebGL reads premultiplied pixels; a canvas `ImageData` holds straight alpha. */
function straightAlpha(pixels: Uint8ClampedArray, width: number, height: number): ImageData {
	const out = new ImageData(width, height);
	const d = out.data;
	for (let i = 0; i < pixels.length; i += 4) {
		const a = pixels[i + 3];
		if (a === 0) continue;
		const k = 255 / a;
		d[i] = pixels[i] * k;
		d[i + 1] = pixels[i + 1] * k;
		d[i + 2] = pixels[i + 2] * k;
		d[i + 3] = a;
	}
	return out;
}

const toCanvas = (image: ImageData): HTMLCanvasElement => {
	const cv = document.createElement('canvas');
	cv.width = image.width;
	cv.height = image.height;
	cv.getContext('2d')?.putImageData(image, 0, 0);
	return cv;
};

/**
 * Capture `doc`'s loop and lay it out as one sheet. Throws with a readable message when the effect
 * cannot bake, draws nothing, or will not fit one page.
 */
export async function captureEffectBake(options: {
	doc: EffectDoc;
	resolveArt: ResolveArt;
	onProgress?: (p: BakeProgress) => void;
}): Promise<BakeCapture> {
	const doc = normalizeEffectDoc(JSON.parse(JSON.stringify(options.doc)), options.doc.id);
	const blockers = effectBakeBlockers(doc);
	if (blockers.length) throw new Error(blockers.join(' '));
	const bake = doc.bake;
	if (!bake) throw new Error('Turn Bake on first.');
	const hash = effectBakeHash(doc);
	const frames = effectBakeFrameCount(bake);
	const seam = effectBakeSeamFrames(bake, frames);
	const total = frames + seam;
	const dt = emitterDeltaSeconds(1000 / bake.fps);
	const scale = bake.scale;

	const app = await captureApp();
	const root = new Container();
	const live: { emitter: Emitter; material?: MountedParticleMaterial }[] = [];
	try {
		const sourceCache = new Map<string, TextureSource>();
		for (const layer of doc.layers) {
			const textures = await framesToTextures(layer, options.resolveArt, sourceCache);
			// In the game a layer with no resolved art draws nothing a bake can hold.
			if (!textures.length) continue;
			const container = new Container();
			const offset = layer.placement.offset ?? { x: 0, y: 0 };
			container.position.set(offset.x, offset.y);
			root.addChild(container);
			const weights = textures.length === layer.art.frames.length ? layer.art.weights : undefined;
			const config = bindArt(layer.config, textures, layer.art.animated ?? false, weights, {
				framerate: layer.art.framerate,
				loop: layer.art.loop,
			});
			const material = mountLayerMaterial({
				layer,
				host: container,
				textures,
				peak: layerMaterialPeak(layer, undefined),
				slots: particleMaterialSlotsFor(app),
				label: `bake/${layer.key}`,
			});
			const emitter = layerEmitter(container, config, material);
			emitter.emit = true;
			live.push({ emitter, material });
		}
		if (!live.length) throw new Error('No layer has art to bake.');

		const step = (): void => {
			for (const { emitter, material } of live) {
				emitter.update(dt);
				material?.material?.sync(app.renderer);
			}
		};

		const warmSteps = Math.ceil(effectBakeWarmup(doc) / dt);
		for (let i = 0; i < warmSteps; i++) {
			step();
			if (i % 30 === 0) {
				options.onProgress?.({ phase: 'warm-up', done: i, total: warmSteps });
				await yieldToUi();
			}
		}

		const half = EFFECT_BAKE_LIMITS.captureSide / 2;
		const captured: CapturedFrame[] = [];
		for (let i = 0; i < total; i++) {
			step();
			const b = root.getLocalBounds();
			const x0 = Math.floor(Math.max(-half, b.minX));
			const y0 = Math.floor(Math.max(-half, b.minY));
			const x1 = Math.ceil(Math.min(half, b.maxX));
			const y1 = Math.ceil(Math.min(half, b.maxY));
			if (!(x1 > x0 && y1 > y0)) {
				captured.push({ image: null, x: 0, y: 0, w: 0, h: 0 });
			} else {
				const px = app.renderer.extract.pixels({
					target: root,
					frame: new Rectangle(x0, y0, x1 - x0, y1 - y0),
					resolution: scale,
					clearColor: [0, 0, 0, 0],
				});
				captured.push({
					image: straightAlpha(px.pixels as Uint8ClampedArray, px.width, px.height),
					x: x0,
					y: y0,
					w: x1 - x0,
					h: y1 - y0,
				});
			}
			options.onProgress?.({ phase: 'capture', done: i + 1, total });
			if (i % 4 === 0) await yieldToUi();
		}

		const drawn = captured.filter((f) => f.image);
		if (!drawn.length) throw new Error('The effect drew nothing during the loop.');
		const bx = Math.min(...drawn.map((f) => f.x));
		const by = Math.min(...drawn.map((f) => f.y));
		const bw = Math.max(...drawn.map((f) => f.x + f.w)) - bx;
		const bh = Math.max(...drawn.map((f) => f.y + f.h)) - by;
		const plan = planEffectBakeSheet(bw, bh, frames, scale);
		if (!plan)
			throw new Error(
				`A ${bw}×${bh} px effect does not fit ${frames} frames on one ` +
					`${EFFECT_BAKE_LIMITS.sheetSide} px page. Shorten the loop or lower the fps.`,
			);

		options.onProgress?.({ phase: 'sheet', done: 0, total: frames });
		const canvas = document.createElement('canvas');
		canvas.width = plan.width;
		canvas.height = plan.height;
		const ctx = canvas.getContext('2d');
		if (!ctx) throw new Error('This browser cannot compose the sheet (no 2D canvas).');
		ctx.imageSmoothingQuality = 'high';
		/** Capture pixels are at `scale`; the plan may have lowered it to fit the page. */
		const k = plan.scale / scale;
		const cell = document.createElement('canvas');
		cell.width = plan.cellW;
		cell.height = plan.cellH;
		const cellCtx = cell.getContext('2d');
		if (!cellCtx) throw new Error('This browser cannot compose the sheet (no 2D canvas).');
		const drawFrame = (frame: CapturedFrame, alpha: number): void => {
			if (!frame.image || alpha <= 0) return;
			cellCtx.globalAlpha = alpha;
			cellCtx.drawImage(
				toCanvas(frame.image),
				(frame.x - bx) * plan.scale,
				(frame.y - by) * plan.scale,
				frame.image.width * k,
				frame.image.height * k,
			);
		};
		for (let i = 0; i < frames; i++) {
			cellCtx.clearRect(0, 0, plan.cellW, plan.cellH);
			const w = effectBakeSeamWeight(i, seam);
			// A premultiplied lerp: `lighter` adds, so (1−w)·after + w·this is exact.
			cellCtx.globalCompositeOperation = 'source-over';
			if (w < 1) drawFrame(captured[frames + i], 1 - w);
			cellCtx.globalCompositeOperation = 'lighter';
			drawFrame(captured[i], w);
			const col = i % plan.cols;
			const row = Math.floor(i / plan.cols);
			ctx.drawImage(cell, col * (plan.cellW + plan.gap), row * (plan.cellH + plan.gap));
			options.onProgress?.({ phase: 'sheet', done: i + 1, total: frames });
		}

		return {
			canvas,
			plan,
			frames,
			bounds: { x: bx, y: by, w: bw, h: bh },
			blendMode: effectBakeBlend(doc.layers),
			fps: bake.fps,
			hash,
		};
	} finally {
		for (const { emitter, material } of live) {
			emitter.emit = false;
			emitter.destroy();
			material?.release();
		}
		root.destroy({ children: true });
	}
}

/**
 * Upload a capture: the page straight to R2 through a presigned PUT, then the sheet's JSON through
 * `/api/fx/bake`. Answers the `bake.result` to store on the doc.
 */
export async function uploadEffectBake(options: {
	capture: BakeCapture;
	effectId: string;
	projectKey: string;
}): Promise<EffectBakeResult> {
	const { capture, effectId, projectKey } = options;
	const target = { effectId, hash: capture.hash, projectKey };
	const fail = async (res: Response, what: string): Promise<never> => {
		const out = (await res.json().catch(() => ({}))) as { message?: string };
		throw new Error(out.message ?? `${what} failed (HTTP ${res.status}).`);
	};
	const signed = await fetch('/api/fx/bake/upload-url', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(target),
	});
	if (!signed.ok) await fail(signed, 'Signing the upload');
	const { url, contentType } = (await signed.json()) as { url: string; contentType: string };
	const blob = await new Promise<Blob>((resolve, reject) =>
		capture.canvas.toBlob(
			(b) => (b ? resolve(b) : reject(new Error('The sheet could not be encoded.'))),
			'image/png',
		),
	);
	const put = await fetch(url, {
		method: 'PUT',
		headers: { 'content-type': contentType },
		body: blob,
	});
	if (!put.ok) throw new Error(`Uploading the sheet failed (HTTP ${put.status}).`);
	const { cellW, cellH, gap, cols, rows, width, height } = capture.plan;
	const committed = await fetch('/api/fx/bake', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			...target,
			frames: capture.frames,
			plan: { cellW, cellH, gap, cols, rows, width, height },
		}),
	});
	if (!committed.ok) await fail(committed, 'Writing the sheet');
	const out = (await committed.json()) as { assetKey: string; frames: string[] };
	return {
		assetKey: out.assetKey,
		frames: out.frames,
		fps: capture.fps,
		bounds: capture.bounds,
		blendMode: capture.blendMode,
		hash: capture.hash,
		sheet: { w: width, h: height },
	};
}
