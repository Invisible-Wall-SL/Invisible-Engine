/**
 * Invisible Rigger — motion import (rig templates T5 + T7b, docs/design/rig-templates.md §5.3).
 *
 * A standalone IIFE bundle the raw-WebGL Rigger `view.html` lazy-loads like `rigger-text.js`,
 * exposing `window.RiggerMotion`. It reads a Flipbook clip's frames or a local video file in the
 * browser, tracks them with MediaPipe's Face Landmarker or Pose Landmarker (Apache-2.0 models, run
 * on the CPU), and solves the track into the template's channel keys (`$lib/rigMotion`). Nothing
 * leaves the browser: a video is read from the file the author picked, never uploaded.
 *
 * The runtime and the models are served same-origin from `/rigger/vendor/mediapipe/`: the WASM is
 * copied from the pinned npm package at build (`scripts/copy-mediapipe-wasm.mjs`), the two `.task`
 * models are committed there.
 */

import { FaceLandmarker, PoseLandmarker, type ImageSource } from '@mediapipe/tasks-vision';
import { solveMotion, type MotionFrame, type MotionTrack } from '../lib/rigMotion';

const BASE = '/rigger/vendor/mediapipe/';
const FILESET: Parameters<typeof FaceLandmarker.createFromOptions>[0] = {
	wasmLoaderPath: `${BASE}vision_wasm_internal.js`,
	wasmBinaryPath: `${BASE}vision_wasm_internal.wasm`,
};
/** Longest side a frame is tracked at: plenty for the landmark models, and keeps the CPU fast. */
const MAX_SIDE = 640;
/** A video is read for at most this long. */
const MAX_VIDEO_SECONDS = 30;
const MAX_FRAMES = 900;

export type MotionKind = 'face' | 'body';

export interface MotionFrameSource {
	width: number;
	height: number;
	/** Frames in order, each with its time in seconds. */
	frames: AsyncIterable<{ t: number; image: ImageSource }>;
}

export interface ClipLike {
	assetKey: string;
	frames: string[];
	fps?: number;
}

let face: Promise<FaceLandmarker> | null = null;
let pose: Promise<PoseLandmarker> | null = null;
/** VIDEO mode needs a rising timestamp across every call a landmarker ever gets. */
let clock = 0;

function landmarker(kind: MotionKind): Promise<FaceLandmarker | PoseLandmarker> {
	if (kind === 'face')
		return (face ??= FaceLandmarker.createFromOptions(FILESET, {
			baseOptions: { modelAssetPath: `${BASE}face_landmarker.task`, delegate: 'CPU' },
			runningMode: 'VIDEO',
			numFaces: 1,
			outputFaceBlendshapes: true,
		}));
	return (pose ??= PoseLandmarker.createFromOptions(FILESET, {
		baseOptions: { modelAssetPath: `${BASE}pose_landmarker_full.task`, delegate: 'CPU' },
		runningMode: 'VIDEO',
		numPoses: 1,
	}));
}

/** Track every frame; `onProgress(done)` after each. */
async function track(
	kind: MotionKind,
	src: MotionFrameSource,
	onProgress?: (done: number) => void,
): Promise<MotionTrack> {
	const lm = await landmarker(kind);
	const frames: MotionFrame[] = [];
	for await (const { t, image } of src.frames) {
		clock += 1000 / 30;
		if (kind === 'face') {
			const r = (lm as FaceLandmarker).detectForVideo(image, clock);
			const pts = r.faceLandmarks[0];
			frames.push({
				t,
				face: pts
					? {
							landmarks: pts.map((p) => [p.x, p.y] as [number, number]),
							blend: Object.fromEntries(
								(r.faceBlendshapes[0]?.categories ?? []).map((c) => [c.categoryName, c.score]),
							),
						}
					: null,
			});
		} else {
			const r = (lm as PoseLandmarker).detectForVideo(image, clock);
			const pts = r.landmarks[0];
			frames.push({
				t,
				pose: pts
					? { landmarks: pts.map((p) => [p.x, p.y, p.visibility ?? 1] as [number, number, number]) }
					: null,
			});
		}
		onProgress?.(frames.length);
	}
	return { width: src.width, height: src.height, frames };
}

function fitCanvas(w: number, h: number): HTMLCanvasElement {
	const k = Math.min(1, MAX_SIDE / Math.max(w, h));
	const c = document.createElement('canvas');
	c.width = Math.max(1, Math.round(w * k));
	c.height = Math.max(1, Math.round(h * k));
	return c;
}

interface SheetRegion {
	name: string;
	x: number;
	y: number;
	w: number;
	h: number;
	rotated?: boolean;
	offX?: number;
	offY?: number;
	origW?: number;
	origH?: number;
}

/**
 * A Flipbook clip's frames, each drawn at its UNTRIMMED size and place, so a packer's trim does
 * not move the face between frames. A frame is `<assetKey>::<region>` or a bare region name of the
 * clip's own sheet.
 */
async function clipFrames(clip: ClipLike): Promise<MotionFrameSource & { count: number }> {
	const sheets = new Map<
		string,
		Promise<{ page: ImageBitmap; regions: Map<string, SheetRegion> }>
	>();
	const sheet = (key: string) => {
		let p = sheets.get(key);
		if (!p) {
			p = (async () => {
				const r = await fetch(`/api/editor/regions?sheet=${encodeURIComponent(key)}`);
				if (!r.ok) throw new Error(`could not read the sheet ${key} (${r.status})`);
				const set = (await r.json()) as {
					pageKey: string;
					pageVersion?: string;
					regions: SheetRegion[];
				};
				if (!set.pageKey) throw new Error(`the sheet ${key} has no page image`);
				const v = set.pageVersion ? `&v=${encodeURIComponent(set.pageVersion)}` : '';
				const img = await fetch(`/api/editor/asset?key=${encodeURIComponent(set.pageKey)}${v}`);
				if (!img.ok) throw new Error(`could not load the sheet image (${img.status})`);
				return {
					page: await createImageBitmap(await img.blob()),
					regions: new Map(set.regions.map((x) => [x.name, x])),
				};
			})();
			sheets.set(key, p);
		}
		return p;
	};
	const refs = clip.frames.map((f) => {
		const at = f.indexOf('::');
		return at > 0
			? { key: f.slice(0, at), name: f.slice(at + 2) }
			: { key: clip.assetKey, name: f };
	});
	const resolved: { page: ImageBitmap; r: SheetRegion }[] = [];
	for (const ref of refs) {
		const s = await sheet(ref.key);
		const r = s.regions.get(ref.name);
		if (!r) throw new Error(`the clip's frame "${ref.name}" is not in its sheet`);
		resolved.push({ page: s.page, r });
	}
	if (!resolved.length) throw new Error('the clip has no frames');
	const fullW = Math.max(...resolved.map(({ r }) => r.origW ?? r.w));
	const fullH = Math.max(...resolved.map(({ r }) => r.origH ?? r.h));
	const canvas = fitCanvas(fullW, fullH);
	const k = canvas.width / fullW;
	const g = canvas.getContext('2d')!;
	const fps = clip.fps && clip.fps > 0 ? clip.fps : 24;
	async function* frames() {
		for (const [i, { page, r }] of resolved.entries()) {
			g.clearRect(0, 0, canvas.width, canvas.height);
			g.fillStyle = '#808080';
			g.fillRect(0, 0, canvas.width, canvas.height);
			const dx = (r.offX ?? 0) * k;
			const dy = (r.offY ?? 0) * k;
			if (r.rotated) {
				// Packed turned 90° clockwise: the page holds an h × w box.
				g.save();
				g.translate(dx, dy + r.h * k);
				g.rotate(-Math.PI / 2);
				g.drawImage(page, r.x, r.y, r.h, r.w, 0, 0, r.h * k, r.w * k);
				g.restore();
			} else g.drawImage(page, r.x, r.y, r.w, r.h, dx, dy, r.w * k, r.h * k);
			yield { t: i / fps, image: canvas };
		}
	}
	return { width: canvas.width, height: canvas.height, frames: frames(), count: resolved.length };
}

/** A local video file's frames at `fps`, up to {@link MAX_VIDEO_SECONDS}. Never uploaded. */
async function videoFrames(
	file: Blob,
	fps: number,
): Promise<MotionFrameSource & { count: number; seconds: number }> {
	const video = document.createElement('video');
	video.muted = true;
	video.playsInline = true;
	video.preload = 'auto';
	const url = URL.createObjectURL(file);
	video.src = url;
	await new Promise<void>((ok, fail) => {
		video.onloadeddata = () => ok();
		video.onerror = () => fail(new Error('this browser cannot read that video'));
	});
	// A seek that never lands (a broken file) fails the import instead of hanging it.
	const seek = (t: number) =>
		new Promise<void>((ok, fail) => {
			const timer = setTimeout(() => fail(new Error('the video stopped answering seeks')), 10_000);
			video.onseeked = () => {
				clearTimeout(timer);
				ok();
			};
			video.currentTime = t;
		});
	// A recorded WebM often carries no duration (Infinity) until it is seeked to its end.
	if (!Number.isFinite(video.duration)) await seek(1e7).catch(() => undefined);
	const length = Number.isFinite(video.duration) ? video.duration : 0;
	const seconds = Math.min(length, MAX_VIDEO_SECONDS);
	if (!(seconds > 0)) {
		URL.revokeObjectURL(url);
		throw new Error('the video has no length');
	}
	const count = Math.min(MAX_FRAMES, Math.max(1, Math.floor(seconds * fps)));
	const canvas = fitCanvas(video.videoWidth, video.videoHeight);
	const g = canvas.getContext('2d')!;
	async function* frames() {
		try {
			for (let i = 0; i < count; i++) {
				const t = i / fps;
				await seek(Math.min(t, Math.max(0, length - 1e-3)));
				g.drawImage(video, 0, 0, canvas.width, canvas.height);
				yield { t, image: canvas };
			}
		} finally {
			URL.revokeObjectURL(url);
		}
	}
	return { width: canvas.width, height: canvas.height, frames: frames(), count, seconds };
}

const api = { track, clipFrames, videoFrames, solve: solveMotion, MAX_VIDEO_SECONDS };
export type RiggerMotionApi = typeof api;

declare global {
	interface Window {
		RiggerMotion: RiggerMotionApi;
	}
}

if (typeof window !== 'undefined') window.RiggerMotion = api;

export default api;
