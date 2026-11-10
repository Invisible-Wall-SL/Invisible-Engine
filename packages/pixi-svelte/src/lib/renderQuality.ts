/**
 * RENDER QUALITY: how many pixels a frame draws, lowered only on a device that measurably cannot
 * hold its frame rate, and only as far as that helps (the model is Babylon's SceneOptimizer and
 * drei's PerformanceMonitor). Every device starts at the full level (`renderTier.ts`).
 *
 * THE LADDER ({@link qualityLadder}): the pixel ratio up to 2, then 1.75, then 1.5, then 1.5
 * without MSAA; never below 1. A level the device's pixel ratio makes equal to the one above is left
 * out, so a pixel ratio of 1.5 has two levels. The MSAA step exists only where the back buffer
 * carries the MSAA, which can change between frames ({@link backBufferMsaa}).
 *
 * WHAT IS MEASURED ({@link createRenderQualityController}): the interval of each frame while a round
 * plays and the page is visible, except the 30 frames after the page is shown or the level changes.
 * Idle frames never count, and an interval over 250 ms (a resumed tab, a load hitch) is not a
 * frame. 120 counted frames make a window. A frame is slow past 21 ms, later than 1.25× a 60 Hz
 * frame: the target is 60 fps on every display, so a 120 Hz phone running at 60 is fine. A window
 * is slow when more than 10% of its frames are. A window with no frame under 28 ms is a browser's
 * 30 fps cap (iOS Low Power Mode) and is ignored.
 *
 * HOW IT MOVES: two slow windows in a row step down one level, at the next moment the game has been
 * quiet (idle) for 20 frames, so a switch never lands mid-round. That starts a trial: after two
 * windows at the new level it is kept if the slow share fell to half or less, or under 10%;
 * otherwise the old level comes back at the next quiet moment and stepping down stops for the
 * session (pixels are not what costs). A kept level that is still slow may step down again. Thirty
 * good windows in a row (under 1% slow) below the top level try one level up; if that goes slow
 * within two windows it steps back, and that level is never tried again. At most 6 switches a
 * session, and a step that starts a trial is taken only while its revert still fits.
 *
 * Configured by the game ({@link configureRenderQuality}); the tools never configure it, so `/fx`,
 * the editors and previews never adapt. A deterministic render and a `?render=` pin never install
 * it. The pure controller is pinned by `fixtures/renderQuality.fixture.ts`; `?perf=1` reads
 * {@link renderQualitySnapshot}.
 */

import type { Application, Renderer, Texture, Ticker } from 'pixi.js';

import type { RenderTier } from './renderTier';

export const QUALITY_RULES = {
	/** Counted frames in a window. */
	windowFrames: 120,
	/** A frame interval over this is slow. */
	slowFrameMs: 21,
	/** A window with more than this share of slow frames is slow. */
	slowWindowShare: 0.1,
	/** A window with no interval under this is a browser's 30 fps cap. */
	capFrameMs: 28,
	/** An interval over this is a resumed tab or a load hitch, not a frame. */
	outlierMs: 250,
	/** Frames not counted after the page is shown or the level changes. */
	settleFrames: 30,
	/** Quiet frames in a row a switch waits for. */
	quietFrames: 20,
	/** Slow windows in a row that step down. */
	slowWindows: 2,
	/** Windows a trial runs before its verdict. */
	trialWindows: 2,
	/** A window with less than this share of slow frames is good. */
	goodWindowShare: 0.01,
	/** Good windows in a row that try one level up. */
	goodWindows: 30,
	/** Switches in a session. */
	maxSwitches: 6,
} as const;

export interface QualityLevel {
	resolution: number;
	msaa: boolean;
}

export type RenderQualityMode = 'adaptive' | RenderTier;

/** `slow` steps down, `no gain` reverts a step down, `headroom` steps up, `slow again` reverts it. */
export type QualitySwitchReason = 'slow' | 'no gain' | 'headroom' | 'slow again';

export interface QualitySwitch {
	/** Seconds since measuring started. */
	at: number;
	from: number;
	to: number;
	reason: QualitySwitchReason;
	/** The share of slow frames the switch was decided on, to 0.01. */
	slowShare: number;
}

export interface RenderQualitySnapshot {
	mode: RenderQualityMode;
	level: { index: number } & QualityLevel;
	levels: number;
	/** A step down did not help and was reverted: no more steps down this session. */
	downStopped: boolean;
	history: QualitySwitch[];
}

/** One frame as the game sees it. */
export interface QualityFrame {
	/** A round is playing: only these frames are measured. */
	measuring: boolean;
	/** A switch may land now (the game is idle). */
	quiet: boolean;
	visible: boolean;
}

export interface RenderQualityController {
	/** One frame's interval in ms; returns the level to draw from this frame on, when it changes. */
	frame(intervalMs: number, state: QualityFrame): QualityLevel | undefined;
	/** The page was hidden or shown. */
	visibilityChanged(): void;
	snapshot(): RenderQualitySnapshot;
}

/** The levels a device can step through, top first. `dpr` is the pixel ratio it started at. */
export function qualityLadder(
	dpr: number,
	{ msaa, msaaSwitchable }: { msaa: boolean; msaaSwitchable: boolean },
): QualityLevel[] {
	const ratio = Math.max(Number.isFinite(dpr) ? dpr : 1, 1);
	const steps: QualityLevel[] = [
		{ resolution: Math.min(ratio, 2), msaa },
		{ resolution: Math.min(ratio, 1.75), msaa },
		{ resolution: Math.min(ratio, 1.5), msaa },
		{ resolution: Math.min(ratio, 1.5), msaa: msaa && !msaaSwitchable },
	];
	return steps.filter(
		(level, i) =>
			i === 0 || level.resolution !== steps[i - 1].resolution || level.msaa !== steps[i - 1].msaa,
	);
}

type Pending = { to: number; reason: QualitySwitchReason; slowShare: number };
type Trial = { up: boolean; from: number; baseline: number; shares: number[] };

const mean = (values: readonly number[]): number =>
	values.reduce((sum, value) => sum + value, 0) / values.length;

export function createRenderQualityController(
	ladder: readonly QualityLevel[],
): RenderQualityController {
	const rules = QUALITY_RULES;
	let level = 0;
	let elapsedMs = 0;
	let settle = 0;
	let quietRun = 0;
	let counted = 0;
	let slowFrames = 0;
	let fastest = Infinity;
	let slowRun: number[] = [];
	let goodRun = 0;
	let downStopped = false;
	const upFailed = new Set<number>();
	let trial: Trial | undefined;
	let pending: Pending | undefined;
	const history: QualitySwitch[] = [];

	const room = (switches: number) => history.length + switches <= rules.maxSwitches;
	const resetWindow = () => {
		counted = 0;
		slowFrames = 0;
		fastest = Infinity;
	};

	const judgeTrial = (current: Trial, share: number, slow: boolean) => {
		current.shares.push(share);
		if (current.up) {
			if (slow) {
				upFailed.add(level);
				if (room(1)) pending = { to: current.from, reason: 'slow again', slowShare: share };
				trial = undefined;
			} else if (current.shares.length >= rules.trialWindows) trial = undefined;
			return;
		}
		if (current.shares.length < rules.trialWindows) return;
		const after = mean(current.shares);
		if (after > current.baseline / 2 && after >= rules.slowWindowShare) {
			downStopped = true;
			if (room(1)) pending = { to: current.from, reason: 'no gain', slowShare: after };
		}
		trial = undefined;
	};

	const judge = (share: number) => {
		if (pending) return;
		const slow = share > rules.slowWindowShare;
		if (trial) return judgeTrial(trial, share, slow);
		if (slow) {
			goodRun = 0;
			slowRun = [...slowRun, share].slice(-rules.slowWindows);
			if (
				slowRun.length === rules.slowWindows &&
				!downStopped &&
				level < ladder.length - 1 &&
				room(2)
			)
				pending = { to: level + 1, reason: 'slow', slowShare: mean(slowRun) };
			return;
		}
		slowRun = [];
		goodRun = share < rules.goodWindowShare ? goodRun + 1 : 0;
		if (goodRun >= rules.goodWindows && level > 0 && !upFailed.has(level - 1) && room(2))
			pending = { to: level - 1, reason: 'headroom', slowShare: share };
	};

	const count = (intervalMs: number) => {
		counted++;
		if (intervalMs > rules.slowFrameMs) slowFrames++;
		fastest = Math.min(fastest, intervalMs);
		if (counted < rules.windowFrames) return;
		const share = slowFrames / counted;
		const capped = fastest >= rules.capFrameMs;
		resetWindow();
		if (!capped) judge(share);
	};

	const apply = ({ to, reason, slowShare }: Pending): QualityLevel => {
		pending = undefined;
		history.push({
			at: Math.round(elapsedMs / 100) / 10,
			from: level,
			to,
			reason,
			slowShare: Math.round(slowShare * 100) / 100,
		});
		trial =
			reason === 'slow' || reason === 'headroom'
				? { up: reason === 'headroom', from: level, baseline: slowShare, shares: [] }
				: undefined;
		level = to;
		resetWindow();
		settle = rules.settleFrames;
		slowRun = [];
		goodRun = 0;
		return ladder[level];
	};

	return {
		frame(intervalMs, { measuring, quiet, visible }) {
			if (!(intervalMs > 0)) return undefined;
			elapsedMs += intervalMs;
			if (!visible) return undefined;
			quietRun = quiet ? quietRun + 1 : 0;
			if (settle > 0) settle--;
			else if (measuring && intervalMs <= rules.outlierMs) count(intervalMs);
			return pending && quietRun >= rules.quietFrames ? apply(pending) : undefined;
		},
		visibilityChanged() {
			settle = rules.settleFrames;
		},
		snapshot: () => ({
			mode: 'adaptive',
			level: { index: level, ...ladder[level] },
			levels: ladder.length,
			downStopped,
			history: history.map((entry) => ({ ...entry })),
		}),
	};
}

type BackBufferInternals = {
	useBackBuffer?: boolean;
	_antialias?: boolean;
	_backBufferTexture?: Texture | null;
	_getBackBufferTexture?: unknown;
};

/**
 * The back buffer's MSAA as a switch. Pixi reads `_antialias` only when it makes the back buffer's
 * texture, which the next frame does when there is none (`GlBackBufferSystem._getBackBufferTexture`,
 * pixi 8.22). So a switch destroys that texture with its source, whose `destroy` deletes its GL
 * texture and, through `RenderTargetSystem`, its framebuffers and MSAA renderbuffers. Undefined
 * without a back buffer or without those internals (WebGPU, another Pixi);
 * `scripts/pixi-back-buffer.fixture.mjs` pins the installed Pixi's side.
 */
function backBufferMsaa(
	renderer: Renderer,
): { on: () => boolean; set: (on: boolean) => void } | undefined {
	const backBuffer = (renderer as unknown as { backBuffer?: BackBufferInternals }).backBuffer;
	if (
		!backBuffer?.useBackBuffer ||
		typeof backBuffer._antialias !== 'boolean' ||
		typeof backBuffer._getBackBufferTexture !== 'function'
	)
		return undefined;
	return {
		on: () => backBuffer._antialias === true,
		set(on) {
			const texture = backBuffer._backBufferTexture;
			backBuffer._antialias = on;
			backBuffer._backBufferTexture = null;
			texture?.destroy(true);
		},
	};
}

type QualityConfig = {
	adaptive: boolean;
	measuring: () => boolean;
	quiet: () => boolean;
};

let config: QualityConfig | undefined;
let readout: (() => RenderQualitySnapshot) | undefined;

/**
 * Turn render quality on for a game, before `<App>` creates its renderer. `adaptive: false` keeps
 * the level the renderer starts at (a deterministic render must not depend on how fast its machine
 * draws; a `?render=` pin is the tester's choice). Returns the undo, for the game's teardown.
 */
export function configureRenderQuality(next: QualityConfig): () => void {
	config = next;
	return () => {
		if (config === next) config = undefined;
	};
}

/** The level now and how it got there, for `?perf=1`; undefined where no game configured it. */
export const renderQualitySnapshot = (): RenderQualitySnapshot | undefined => readout?.();

/**
 * Start measuring `app` as the game configured it. `<InitialiseApplication>` calls it once the
 * renderer exists, with the tier and MSAA it created the renderer with. Returns the teardown.
 */
export function installRenderQuality(
	app: Application,
	{ tier, msaa }: { tier: RenderTier; msaa: boolean },
): () => void {
	const settings = config;
	if (!settings) return () => {};
	const renderer = app.renderer;
	const msaaSwitch = backBufferMsaa(renderer);
	const start: QualityLevel = {
		resolution: renderer.resolution,
		msaa: msaaSwitch ? msaaSwitch.on() : msaa,
	};
	let snapshot: () => RenderQualitySnapshot;
	let release = () => {};
	if (settings.adaptive) {
		const controller = createRenderQualityController(
			qualityLadder(start.resolution, { msaa: start.msaa, msaaSwitchable: !!msaaSwitch }),
		);
		const { measuring, quiet } = settings;
		const onTick = (ticker: Ticker) => {
			const next = controller.frame(ticker.elapsedMS, {
				measuring: measuring(),
				quiet: quiet(),
				visible: document.visibilityState === 'visible',
			});
			if (!next) return;
			if (renderer.resolution !== next.resolution) renderer.resolution = next.resolution;
			if (msaaSwitch && msaaSwitch.on() !== next.msaa) msaaSwitch.set(next.msaa);
		};
		const onVisibility = () => controller.visibilityChanged();
		app.ticker.add(onTick);
		document.addEventListener('visibilitychange', onVisibility);
		snapshot = controller.snapshot;
		release = () => {
			app.ticker?.remove(onTick);
			document.removeEventListener('visibilitychange', onVisibility);
		};
	} else {
		const fixed: RenderQualitySnapshot = {
			mode: tier,
			level: { index: 0, ...start },
			levels: 1,
			downStopped: false,
			history: [],
		};
		snapshot = () => ({ ...fixed, level: { ...fixed.level } });
	}
	readout = snapshot;
	return () => {
		release();
		if (readout === snapshot) readout = undefined;
	};
}
