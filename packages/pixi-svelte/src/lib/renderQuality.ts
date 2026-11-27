/**
 * RENDER QUALITY: how many pixels a frame draws and which effects it draws, lowered only on a
 * device that measurably cannot hold its frame rate, and only as far as that helps (the model is
 * Babylon's SceneOptimizer and drei's PerformanceMonitor). Every device starts at the full level
 * (`renderTier.ts`).
 *
 * THE LADDER ({@link qualityLadder}): the pixel ratio up to 2, then 1.75, then 1.5, then 1.5
 * without MSAA, then 1.25 and 1 (still without MSAA); never below 1. Its last level is 1 with the
 * effects lowered: the stage's post FX left out (`setStagePostFxSuppressed`) and the particle
 * budget capped at {@link LOW_EFFECTS_PARTICLES} (`capParticleBudget`), both given back when the
 * level rises. Both are handed in by whoever installs it ({@link RenderQualityEffects}), so this
 * module stays free of Pixi values. A level the device's pixel ratio makes equal to the one above
 * is left out, so a pixel ratio of 1.5 has five levels where the MSAA can switch and four where it
 * cannot. The MSAA step exists only where the back buffer carries the MSAA, which can change
 * between frames ({@link backBufferMsaa}).
 *
 * WHAT IS MEASURED ({@link createRenderQualityController}): the interval of each frame while a
 * round plays and the page is visible, except the 30 frames after the page is shown or the level
 * changes.
 * Idle frames never count, and an interval over 250 ms (a resumed tab, a load hitch) is not a
 * frame. 120 counted frames make a window. A frame is slow past 21 ms, later than 1.25× a 60 Hz
 * frame: the target is 60 fps on every display, so a 120 Hz phone running at 60 is fine. A window
 * is slow when more than 10% of its frames are. A window whose intervals sit at a 30 fps rhythm
 * (10th percentile ≥ 30 ms, median ≤ 36 ms, as `perfStats.ts` `capped30` reads it) is a browser's
 * cap (iOS Low Power Mode) and is ignored, unless the browser drew any frame, idle ones included,
 * faster than 25 ms in the last 30 s: Low Power Mode caps every frame, so a device that idles at 60
 * and plays its rounds at 30 is judged. A device slower than 30 fps is always judged.
 *
 * HOW IT MOVES: two slow windows in a row step down one level, at the next moment the game has been
 * quiet for 20 frames, so a switch never lands while the reels move. Quiet is the game's to say:
 * idle in manual play; in autoplay, the moments of a round when no reel is rolling. That starts a
 * trial: after two windows at the new level it is kept only if the slow share fell to half or less,
 * or the mean frame interval fell by 20% or more (14 → 30 fps still has every frame slow).
 * Dipping under the 10% that started it is not enough: a device just over the line (the Nothing
 * Phone (1), 13% at 17.8 ms, 2026-11-10) dips under it by chance and kept 1.75 at 18.4 ms.
 * Otherwise the old level comes back at the next quiet moment. A kept level that is still slow may
 * step down again.
 *
 * THE SECOND CHANCE: one step down that did not help is not the end. Four slow windows in a row
 * after the revert (twice the evidence a first step needs) take it: past the level that did not
 * help, two levels down, never past the last level, the effects one (so from a level already at
 * resolution 1 it lands there, with no rule of its own). It is a walk judged against those four windows: a level that helps is kept, one
 * that does not steps one more level down (`steppedOn` in its verdict), and at the last level that
 * does not help the walk goes back to where it started and stepping down stops for the session.
 * So a device slow at every resolution (a Mali-G57 phone, BUG-20) still reaches the effects level,
 * while one just over the line stops at the first level that helps and keeps its effects. Fifteen
 * windows in a row under 1% slow while it waits give it back unused: a device that recovered
 * starts a later slow spell from a first step again. If the step that did not help was already to
 * the last level, stepping down stops. One second chance a session, and until it is taken the
 * last two switches of the cap are its own: ordinary steps down and up leave them, a walk that
 * would not fit jumps straight to the effects level, and when no ordinary step fits four slow
 * windows take the second chance there and then. So earlier spells never keep a device slow at
 * every resolution from the effects level. The game's controller has it
 * ({@link installRenderQuality}); `engine-3d`, which walks its own ladder with this controller,
 * does not ({@link RenderQualityOptions}): there the first step down that does not help stops
 * stepping down.
 *
 * Thirty good windows in a row (under 1% slow) below the top level try one level up; if that goes
 * slow within two windows it steps back, and that level is never tried again. At most 12 switches a
 * session (6 without the second chance), and a step that starts a trial is taken only while its
 * revert still fits. Every trial's verdict, with what started it and what the level measured, is
 * kept for the readout.
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
	/** A window is a browser's 30 fps cap when its 10th-percentile interval is at least this… */
	capP10Ms: 30,
	/** …and its median at most this (`perfStats.ts` `capped30`). */
	capP50Ms: 36,
	/** A frame faster than this shows the browser is not capping at 30 fps… */
	uncappedFrameMs: 25,
	/** …for this long after it (in ms of visible frames). */
	uncappedMemoryMs: 30_000,
	/** An interval over this is a resumed tab or a load hitch, not a frame. */
	outlierMs: 250,
	/** Frames not counted after the page is shown or the level changes. */
	settleFrames: 30,
	/** Quiet frames in a row a switch waits for. */
	quietFrames: 20,
	/** Slow windows in a row that step down. */
	slowWindows: 2,
	/** Slow windows in a row, after a step down that did not help, that take the second chance. */
	retrySlowWindows: 4,
	/** Windows in a row under `goodWindowShare` slow that give a waiting second chance back unused
	 *  (the device recovered). */
	retryGoodWindows: 15,
	/** Windows a trial runs before its verdict. */
	trialWindows: 2,
	/** A step down is also kept when the mean frame interval fell by at least this share. */
	trialIntervalGain: 0.2,
	/** A window with less than this share of slow frames is good. */
	goodWindowShare: 0.01,
	/** Good windows in a row that try one level up. */
	goodWindows: 30,
	/** Switches in a session, with the second chance (the game's ladder); until it is taken, two
	 *  of them are held for it. */
	maxSwitches: 12,
	/** Switches in a session without it (`engine-3d`'s ladder walks this controller too). */
	maxSwitchesSingleTry: 6,
} as const;

/** The particle budget's cap at the last level (`particleBudget.ts`, floor 0.25). */
export const LOW_EFFECTS_PARTICLES = 0.5;

export interface QualityLevel {
	resolution: number;
	msaa: boolean;
	/** The stage's post FX are drawn (false: left out of the stage's filters). Absent: drawn. */
	postFx?: boolean;
	/** The particle budget's cap at this level: 1 leaves it to the tier and the budget. Absent: 1. */
	particleCap?: number;
}

export type RenderQualityMode = 'adaptive' | RenderTier;

/** `slow` steps down, `second chance` is a step of the walk after a step down that did not help,
 *  `no gain` reverts a step down, `headroom` steps up, `slow again` reverts the step up. */
export type QualitySwitchReason = 'slow' | 'second chance' | 'no gain' | 'headroom' | 'slow again';

/** Where the session's one second chance is: not needed (again), waiting for its slow windows, or
 *  taken. */
export type QualitySecondChance = 'unused' | 'waiting' | 'taken';

/** A window's slow share (to 0.01) and mean frame interval (ms to 0.1), as the readout shows them. */
export interface QualityMeasure {
	slowShare: number;
	frameMs: number;
}

/** A switch, with the measure it was decided on. */
export interface QualitySwitch extends QualityMeasure {
	/** Seconds since measuring started. */
	at: number;
	from: number;
	to: number;
	reason: QualitySwitchReason;
}

/** A trial's verdict on the level it tried: what started it, what the level measured, kept or not. */
export interface QualityTrial {
	/** Seconds since measuring started. */
	at: number;
	level: number;
	up: boolean;
	before: QualityMeasure;
	after: QualityMeasure;
	kept: boolean;
	/** A second-chance level that did not help and stepped on down the walk (not reverted). */
	steppedOn: boolean;
}

export interface RenderQualitySnapshot {
	mode: RenderQualityMode;
	level: { index: number } & QualityLevel;
	levels: number;
	/**
	 * No more steps down this session: steps down that did not help used up the second chance, or,
	 * where the controller has none (`engine-3d`'s single try), one step down did not help.
	 */
	downStopped: boolean;
	/** Absent where the controller has none (a fixed level, `engine-3d`). */
	secondChance?: QualitySecondChance;
	history: QualitySwitch[];
	trials: QualityTrial[];
}

/** One frame as the game sees it. */
export interface QualityFrame {
	/** A round is playing: only these frames are measured. */
	measuring: boolean;
	/** A switch may land now: idle, or an autoplay round with no reel rolling. */
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
	const lowMsaa = msaa && !msaaSwitchable;
	const full = { postFx: true, particleCap: 1 };
	const steps: QualityLevel[] = [
		{ resolution: Math.min(ratio, 2), msaa, ...full },
		{ resolution: Math.min(ratio, 1.75), msaa, ...full },
		{ resolution: Math.min(ratio, 1.5), msaa, ...full },
		{ resolution: Math.min(ratio, 1.5), msaa: lowMsaa, ...full },
		{ resolution: Math.min(ratio, 1.25), msaa: lowMsaa, ...full },
		{ resolution: 1, msaa: lowMsaa, ...full },
		{ resolution: 1, msaa: lowMsaa, postFx: false, particleCap: LOW_EFFECTS_PARTICLES },
	];
	return steps.filter(
		(level, i) =>
			i === 0 ||
			level.resolution !== steps[i - 1].resolution ||
			level.msaa !== steps[i - 1].msaa ||
			level.postFx !== steps[i - 1].postFx ||
			level.particleCap !== steps[i - 1].particleCap,
	);
}

/** A window's share of slow frames and its mean frame interval. */
type WindowStats = { share: number; meanMs: number };
/** `walk`: a second-chance step on from a level that did not help, with the walk's start and
 *  baseline. */
type Pending = {
	to: number;
	reason: QualitySwitchReason;
	stats: WindowStats;
	walk?: { from: number; baseline: WindowStats };
};
type Trial = {
	up: boolean;
	/** A second-chance walk: a level that does not help steps on instead of reverting. */
	walk: boolean;
	from: number;
	baseline: WindowStats;
	windows: WindowStats[];
};

const mean = (values: readonly number[]): number =>
	values.reduce((sum, value) => sum + value, 0) / values.length;
const meanStats = (windows: readonly WindowStats[]): WindowStats => ({
	share: mean(windows.map((w) => w.share)),
	meanMs: mean(windows.map((w) => w.meanMs)),
});
const quantile = (sorted: readonly number[], q: number): number =>
	sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

export interface RenderQualityOptions {
	/**
	 * A step down that did not help leaves one more try, a walk down the ladder (THE SECOND
	 * CHANCE), and the session may switch {@link QUALITY_RULES}`.maxSwitches` times. Without it the
	 * first step down that does not help stops stepping down, within `maxSwitchesSingleTry`.
	 */
	secondChance?: boolean;
}

export function createRenderQualityController(
	ladder: readonly QualityLevel[],
	{ secondChance: retries = false }: RenderQualityOptions = {},
): RenderQualityController {
	const rules = QUALITY_RULES;
	const maxSwitches = retries ? rules.maxSwitches : rules.maxSwitchesSingleTry;
	let level = 0;
	let elapsedMs = 0;
	let settle = 0;
	let quietRun = 0;
	let intervals: number[] = [];
	let slowRun: WindowStats[] = [];
	let goodRun = 0;
	let downStopped = false;
	let secondChance: QualitySecondChance = 'unused';
	const last = ladder.length - 1;
	let lastUncappedMs = -Infinity;
	const upFailed = new Set<number>();
	let trial: Trial | undefined;
	let pending: Pending | undefined;
	const history: QualitySwitch[] = [];
	const trials: QualityTrial[] = [];
	const seconds = () => Math.round(elapsedMs / 100) / 10;
	const measure = (stats: WindowStats): QualityMeasure => ({
		slowShare: Math.round(stats.share * 100) / 100,
		frameMs: Math.round(stats.meanMs * 10) / 10,
	});

	const room = (switches: number) => history.length + switches <= maxSwitches;
	/** Switches held back for the second chance's step to the effects level and its revert, until
	 *  it is taken: ordinary steps down and up never spend them. */
	const reserve = () => (retries && secondChance !== 'taken' ? 2 : 0);
	/**
	 * Where the second chance steps from `at`, `skip` levels down, never past the effects level:
	 * that level at once when only that step and its revert still fit. Undefined when nothing fits.
	 * Resolution 1 needs no rule of its own: every level at 1 is the one above the effects level,
	 * except a DPR-1 screen's top level, whose second chance starts two down, at the effects level.
	 */
	const chanceStep = (at: number, skip: number): number | undefined => {
		if (!room(2)) return undefined;
		return room(3) ? Math.min(at + skip, last) : last;
	};

	const verdict = (current: Trial, after: WindowStats, kept: boolean, steppedOn = false) => {
		trials.push({
			at: seconds(),
			level,
			up: current.up,
			before: measure(current.baseline),
			after: measure(after),
			kept,
			steppedOn,
		});
		trial = undefined;
	};

	const judgeTrial = (current: Trial, stats: WindowStats, slow: boolean) => {
		current.windows.push(stats);
		if (current.up) {
			if (slow) {
				upFailed.add(level);
				if (room(1)) pending = { to: current.from, reason: 'slow again', stats };
				verdict(current, stats, false);
			} else if (current.windows.length >= rules.trialWindows)
				verdict(current, meanStats(current.windows), true);
			return;
		}
		if (current.windows.length < rules.trialWindows) return;
		const after = meanStats(current.windows);
		const helped =
			after.share <= current.baseline.share / 2 ||
			after.meanMs <= current.baseline.meanMs * (1 - rules.trialIntervalGain);
		const onward = !helped && current.walk && level < last ? chanceStep(level, 1) : undefined;
		if (onward !== undefined) {
			pending = {
				to: onward,
				reason: 'second chance',
				stats: after,
				walk: { from: current.from, baseline: current.baseline },
			};
		} else if (!helped) {
			// A first step that left the last level untried leaves the second chance waiting.
			if (retries && secondChance === 'unused' && level < last) secondChance = 'waiting';
			else downStopped = true;
			if (room(1)) pending = { to: current.from, reason: 'no gain', stats: after };
		}
		verdict(current, after, helped, onward !== undefined);
	};

	const judge = (stats: WindowStats) => {
		if (pending) return;
		const slow = stats.share > rules.slowWindowShare;
		if (trial) return judgeTrial(trial, stats, slow);
		if (slow) {
			goodRun = 0;
			// Waiting, or no room left for an ordinary step and its revert outside the reserve.
			const waiting = secondChance === 'waiting';
			const retry = waiting || (retries && secondChance === 'unused' && !room(2 + reserve()));
			const needed = retry ? rules.retrySlowWindows : rules.slowWindows;
			slowRun = [...slowRun, stats].slice(-needed);
			if (slowRun.length < needed || downStopped || level >= last) return;
			// Waiting follows a step to `level + 1` that did not help: the walk starts below it.
			const to = retry ? chanceStep(level, waiting ? 2 : 1) : level + 1;
			if (to === undefined || (!retry && !room(2 + reserve()))) return;
			pending = { to, reason: retry ? 'second chance' : 'slow', stats: meanStats(slowRun) };
			if (retry) secondChance = 'taken';
			return;
		}
		slowRun = [];
		goodRun = stats.share < rules.goodWindowShare ? goodRun + 1 : 0;
		if (secondChance === 'waiting' && goodRun >= rules.retryGoodWindows) secondChance = 'unused';
		if (
			goodRun >= rules.goodWindows &&
			level > 0 &&
			!upFailed.has(level - 1) &&
			room(2 + reserve())
		)
			pending = { to: level - 1, reason: 'headroom', stats };
	};

	const count = (intervalMs: number) => {
		intervals.push(intervalMs);
		if (intervals.length < rules.windowFrames) return;
		const sorted = intervals.sort((a, b) => a - b);
		intervals = [];
		const capped =
			elapsedMs - lastUncappedMs > rules.uncappedMemoryMs &&
			quantile(sorted, 0.1) >= rules.capP10Ms &&
			quantile(sorted, 0.5) <= rules.capP50Ms;
		if (capped) return;
		judge({
			share: sorted.filter((ms) => ms > rules.slowFrameMs).length / sorted.length,
			meanMs: mean(sorted),
		});
	};

	const apply = ({ to, reason, stats, walk }: Pending): QualityLevel => {
		pending = undefined;
		history.push({
			at: seconds(),
			from: level,
			to,
			reason,
			...measure(stats),
		});
		trial =
			reason === 'slow' || reason === 'second chance' || reason === 'headroom'
				? {
						up: reason === 'headroom',
						walk: reason === 'second chance',
						from: walk?.from ?? level,
						baseline: walk?.baseline ?? stats,
						windows: [],
					}
				: undefined;
		level = to;
		intervals = [];
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
			if (intervalMs < rules.uncappedFrameMs) lastUncappedMs = elapsedMs;
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
			...(retries ? { secondChance } : {}),
			history: history.map((entry) => ({ ...entry })),
			trials: trials.map((entry) => ({
				...entry,
				before: { ...entry.before },
				after: { ...entry.after },
			})),
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
 * texture, which the next frame does when there is none
 * (`GlBackBufferSystem._getBackBufferTexture`, pixi 8.23). So a switch destroys that texture with
 * its source, whose `destroy` deletes its GL texture and the MSAA renderbuffer that texture owns
 * and, through `RenderTargetSystem`, its framebuffers. Undefined without a back buffer or without those internals
 * (WebGPU, another Pixi); `scripts/pixi-back-buffer.fixture.mjs` pins the installed Pixi's side.
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
 * The effects the last level lowers, handed in by whoever installs the ladder, so this module never
 * imports a Pixi value (`engine-3d` pins it in Node). `<InitialiseApplication>` passes the stage's
 * `setStagePostFxSuppressed` and `capParticleBudget`.
 */
export interface RenderQualityEffects {
	/** Leave the stage's post FX out (`true`) or put them back (`false`). */
	suppressPostFx: (suppressed: boolean) => void;
	/** Cap the particle budget at `cap`, or lift the cap with 1. */
	capParticles: (cap: number) => void;
}

/**
 * Start measuring `app` as the game configured it. `<InitialiseApplication>` calls it once the
 * renderer exists, with the tier and MSAA it created the renderer with and the effects the last
 * level lowers (without them that level draws as the one above). Returns the teardown.
 */
export function installRenderQuality(
	app: Application,
	{
		tier,
		msaa,
		effects: lower,
	}: { tier: RenderTier; msaa: boolean; effects?: RenderQualityEffects },
): () => void {
	const settings = config;
	if (!settings) return () => {};
	const renderer = app.renderer;
	const msaaSwitch = backBufferMsaa(renderer);
	const start: QualityLevel = {
		resolution: renderer.resolution,
		msaa: msaaSwitch ? msaaSwitch.on() : msaa,
		postFx: true,
		particleCap: 1,
	};
	let snapshot: () => RenderQualitySnapshot;
	let release = () => {};
	if (settings.adaptive) {
		const controller = createRenderQualityController(
			qualityLadder(start.resolution, { msaa: start.msaa, msaaSwitchable: !!msaaSwitch }),
			{ secondChance: true },
		);
		const { measuring, quiet } = settings;
		// The effects as the levels so far left them: full until a level lowers them.
		let effects = { postFx: true, particleCap: 1 };
		const setEffects = (next: QualityLevel) => {
			const postFx = next.postFx !== false;
			const particleCap = next.particleCap ?? 1;
			if (postFx !== effects.postFx) lower?.suppressPostFx(!postFx);
			if (particleCap !== effects.particleCap) lower?.capParticles(particleCap);
			effects = { postFx, particleCap };
		};
		const onTick = (ticker: Ticker) => {
			const next = controller.frame(ticker.elapsedMS, {
				measuring: measuring(),
				quiet: quiet(),
				visible: document.visibilityState === 'visible',
			});
			if (!next) return;
			if (renderer.resolution !== next.resolution) renderer.resolution = next.resolution;
			if (msaaSwitch && msaaSwitch.on() !== next.msaa) msaaSwitch.set(next.msaa);
			setEffects(next);
		};
		const onVisibility = () => controller.visibilityChanged();
		app.ticker.add(onTick);
		document.addEventListener('visibilitychange', onVisibility);
		snapshot = controller.snapshot;
		release = () => {
			app.ticker?.remove(onTick);
			document.removeEventListener('visibilitychange', onVisibility);
			setEffects({ ...start, postFx: true, particleCap: 1 });
		};
	} else {
		const fixed: RenderQualitySnapshot = {
			mode: tier,
			level: { index: 0, ...start },
			levels: 1,
			downStopped: false,
			history: [],
			trials: [],
		};
		snapshot = () => ({ ...fixed, level: { ...fixed.level } });
	}
	readout = snapshot;
	return () => {
		release();
		if (readout === snapshot) readout = undefined;
	};
}
