/**
 * Full-screen camera effects — the implementation behind the flow's `cameraEffect` action.
 *
 * Every kind drives the one transform ABOVE the whole game: the PixiJS `Application.stage`
 * (`InitialiseParent`). `<App>`'s children are flat, z-banded siblings (background, board, HUD,
 * overlays, the flow mount), so the stage is the only node that moves all of them together — a
 * shake applied any lower would shake the board out from under a still HUD. The cost of that is
 * honest: anything parented to the stage moves, `<DebugStage>` included.
 *
 * Effects COMPOSE. Each active effect contributes a per-frame sample and a single compositor
 * applies the accumulated result once, so an overlapping shake and zoom punch can't fight over
 * `stage.position` — the classic bug where whichever effect ends last resets the stage and parks
 * the other one's offset permanently. The stage's resting transform is captured up front and
 * restored exactly when the last effect drains.
 *
 * `intensity` is NORMALISED, not pixels: `1` = the kind's `REFERENCE` strength below. That keeps
 * an authored value meaningful across kinds (px for a shake, a scale factor for a punch, an alpha
 * for a flash) and stable across screen sizes.
 *
 * Zero cost at rest: the ticker callback is attached on the first effect and removed when the last
 * one ends.
 */

import * as PIXI from 'pixi.js';
import { RGBSplitFilter } from 'pixi-filters';
import { CAMERA_EFFECT_KINDS, type CameraEffectKind } from 'constants-shared/camera';

export { CAMERA_EFFECT_KINDS, type CameraEffectKind };

export type CameraEffectOptions = {
	kind: CameraEffectKind;
	/** How long the effect runs. Unset ⇒ the kind's `DEFAULT_DURATION_MS`. */
	durationMs?: number;
	/** Normalised strength; 1 = the kind's reference strength. Unset ⇒ 1. Clamped to 0…4. */
	intensity?: number;
};

/** Each kind's strength at `intensity: 1` — the reference an authored intensity scales. */
const REFERENCE = {
	/** Peak shake displacement, in screen px. */
	shakePx: 24,
	/** Peak zoom-punch scale delta (0.08 = an 8% push in). */
	zoom: 0.08,
	/** Peak flash opacity. Deliberately under 1 — a full white-out reads as a dropped frame. */
	flashAlpha: 0.85,
	/** Peak per-channel RGB split, in screen px. */
	chromaPx: 12,
} as const;

/** How long each kind runs when the author leaves `durationMs` unset. */
const DEFAULT_DURATION_MS: Record<CameraEffectKind, number> = {
	shake: 400,
	flash: 220,
	zoomPunch: 320,
	chromaticWobble: 500,
};

/** An authored intensity above this is almost certainly a mistake (px confused for a multiplier). */
const MAX_INTENSITY = 4;

const TWO_PI = Math.PI * 2;

/** Oscillations per second. The shake's Y axis runs at a deliberately non-integer multiple of X so
 *  the two axes never re-align into a repeating orbit — that reads as a rattle, not a circle. */
const SHAKE_HZ = 13;
const SHAKE_HZ_Y_RATIO = 1.37;
const SHAKE_Y_PHASE = 1.1;
const CHROMA_HZ = 9;

/** Above every authored layer band, so the flash covers the game rather than landing mid-stack. */
const FLASH_Z_INDEX = 1_000_000;

/** How far past the viewport the flash quad extends, so a concurrent shake/zoom can't drag an edge
 *  into view. */
const FLASH_OVERSCAN = 2;

/** One frame's contribution from one effect; summed across effects, then applied once. */
type CameraSample = {
	offsetX: number;
	offsetY: number;
	zoom: number;
	flash: number;
	chroma: number;
};

const NO_CONTRIBUTION: CameraSample = { offsetX: 0, offsetY: 0, zoom: 0, flash: 0, chroma: 0 };

type ActiveEffect = {
	kind: CameraEffectKind;
	durationMs: number;
	intensity: number;
	elapsedMs: number;
	resolve: () => void;
};

type CameraRuntime = {
	app: PIXI.Application;
	effects: Set<ActiveEffect>;
	/** The stage's resting transform, captured before the first effect touches it. */
	base: { x: number; y: number; scaleX: number; scaleY: number };
	flashSprite?: PIXI.Sprite;
	chromaFilter?: RGBSplitFilter;
	/** The stage-local rect the chroma pass is bounded to; recomputed per frame. */
	filterArea?: PIXI.Rectangle;
	/** Whatever was on the stage before the chroma filter displaced it, restored on release. */
	priorFilters?: PIXI.Filter | PIXI.Filter[];
	priorFilterArea?: PIXI.Rectangle;
	tick: () => void;
};

const runtimes = new WeakMap<PIXI.Application, CameraRuntime>();

const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

/** A punch envelope: snap to full over the first `rise` of the run, then ease back to rest. The
 *  asymmetry is the point — an impact arrives instantly and recovers slowly. */
const punch = (t: number, rise: number): number =>
	t < rise ? t / rise : 1 - easeOutQuad((t - rise) / (1 - rise));

/** This effect's contribution for the current frame. Exhaustive over `CameraEffectKind`, so adding
 *  a kind to `CAMERA_EFFECT_KINDS` fails the type check here until it is implemented. */
const sampleCameraEffect = (effect: ActiveEffect): CameraSample => {
	const t = Math.min(1, effect.elapsedMs / effect.durationMs);
	const seconds = effect.elapsedMs / 1000;
	const amount = effect.intensity;

	switch (effect.kind) {
		case 'shake': {
			const decayed = (1 - t) * amount * REFERENCE.shakePx;
			return {
				...NO_CONTRIBUTION,
				offsetX: decayed * Math.sin(TWO_PI * SHAKE_HZ * seconds),
				offsetY: decayed * Math.sin(TWO_PI * SHAKE_HZ * SHAKE_HZ_Y_RATIO * seconds + SHAKE_Y_PHASE),
			};
		}
		case 'zoomPunch':
			return { ...NO_CONTRIBUTION, zoom: amount * REFERENCE.zoom * punch(t, 0.18) };
		case 'flash':
			return { ...NO_CONTRIBUTION, flash: amount * REFERENCE.flashAlpha * punch(t, 0.08) };
		case 'chromaticWobble':
			return {
				...NO_CONTRIBUTION,
				chroma: (1 - t) * amount * REFERENCE.chromaPx * Math.sin(TWO_PI * CHROMA_HZ * seconds),
			};
	}
};

const ensureFlashSprite = (runtime: CameraRuntime): PIXI.Sprite => {
	if (runtime.flashSprite) return runtime.flashSprite;
	const sprite = new PIXI.Sprite(PIXI.Texture.WHITE);
	sprite.anchor.set(0.5);
	sprite.zIndex = FLASH_Z_INDEX;
	sprite.eventMode = 'none';
	sprite.alpha = 0;
	// `addChild` already flags the parent sort-dirty for a non-zero zIndex, so no `sortChildren()`.
	runtime.app.stage.addChild(sprite);
	runtime.flashSprite = sprite;
	return sprite;
};

const releaseFlashSprite = (runtime: CameraRuntime): void => {
	if (!runtime.flashSprite) return;
	runtime.flashSprite.destroy();
	runtime.flashSprite = undefined;
};

const ensureChromaFilter = (runtime: CameraRuntime): RGBSplitFilter => {
	if (runtime.chromaFilter) return runtime.chromaFilter;
	const stage = runtime.app.stage;
	const filter = new RGBSplitFilter({
		red: { x: 0, y: 0 },
		green: { x: 0, y: 0 },
		blue: { x: 0, y: 0 },
	});
	// Remember what was on the stage so detach RESTORES it rather than assuming we were the only
	// filter. Nothing else filters the stage today, but silently eating a future global colour grade
	// the first time an author fires a wobble is not a trade worth making.
	runtime.priorFilters = stage.filters;
	runtime.priorFilterArea = stage.filterArea;
	// Bound the filter pass to the viewport rather than letting Pixi derive it from the stage's
	// children (slower, and larger than the screen — padding reels sit outside it). `filterArea` is
	// LOCAL: `FilterSystem` multiplies it by the container's worldTransform, and this module is what
	// writes that transform — so it is recomputed per frame in `applyCameraSample`, never set to
	// `app.screen`. Pinned to a rect we own, since Pixi mutates `app.screen` on resize.
	runtime.filterArea = new PIXI.Rectangle();
	stage.filterArea = runtime.filterArea;
	stage.filters = [filter];
	runtime.chromaFilter = filter;
	return filter;
};

const releaseChromaFilter = (runtime: CameraRuntime): void => {
	if (!runtime.chromaFilter) return;
	const stage = runtime.app.stage;
	if (stage && !stage.destroyed) {
		stage.filters = runtime.priorFilters ?? [];
		stage.filterArea = runtime.priorFilterArea;
	}
	runtime.chromaFilter.destroy();
	runtime.chromaFilter = undefined;
	runtime.filterArea = undefined;
	runtime.priorFilters = undefined;
	runtime.priorFilterArea = undefined;
};

/** Apply the accumulated frame to the stage. `zoom` scales about the VIEWPORT centre rather than
 *  the stage origin — children self-centre off `canvasSizes`, so scaling about (0,0) would slide
 *  the game toward the top-left instead of pushing in. */
const applyCameraSample = (runtime: CameraRuntime, total: CameraSample): void => {
	const { app, base } = runtime;
	const stage = app.stage;
	const zoom = 1 + total.zoom;
	const centreX = app.screen.width / 2;
	const centreY = app.screen.height / 2;

	stage.scale.set(base.scaleX * zoom, base.scaleY * zoom);
	stage.position.set(
		base.x * zoom + centreX * (1 - zoom) + total.offsetX,
		base.y * zoom + centreY * (1 - zoom) + total.offsetY,
	);

	if (runtime.flashSprite) {
		const sprite = runtime.flashSprite;
		sprite.alpha = total.flash;
		sprite.visible = total.flash > 0;
		// The sprite is a stage CHILD, so it lives in stage-LOCAL space — invert the transform we
		// just wrote, or the flash would ride the very shake it is meant to blanket.
		sprite.position.set(
			(centreX - stage.position.x) / stage.scale.x,
			(centreY - stage.position.y) / stage.scale.y,
		);
		const cover =
			(Math.max(app.screen.width, app.screen.height) * FLASH_OVERSCAN) /
			Math.min(stage.scale.x, stage.scale.y);
		sprite.width = cover;
		sprite.height = cover;
	}

	if (runtime.chromaFilter && runtime.filterArea) {
		runtime.chromaFilter.redX = total.chroma;
		runtime.chromaFilter.blueX = -total.chroma;
		// `filterArea` is stage-LOCAL and gets multiplied by the transform written above, so a rect
		// of `app.screen` would RIDE a concurrent shake and clip a blank strip off the screen edge.
		// Invert the transform so the filtered region stays exactly the viewport.
		runtime.filterArea.x = -stage.position.x / stage.scale.x;
		runtime.filterArea.y = -stage.position.y / stage.scale.y;
		runtime.filterArea.width = app.screen.width / stage.scale.x;
		runtime.filterArea.height = app.screen.height / stage.scale.y;
	}
};

/** Drop every frame-cost surface and forget the runtime — the state we want at rest. */
const detachRuntime = (runtime: CameraRuntime): void => {
	runtime.app.ticker?.remove(runtime.tick);
	runtimes.delete(runtime.app);
	releaseFlashSprite(runtime);
	releaseChromaFilter(runtime);
};

const createRuntime = (app: PIXI.Application): CameraRuntime => {
	const runtime: CameraRuntime = {
		app,
		effects: new Set<ActiveEffect>(),
		base: {
			x: app.stage.position.x,
			y: app.stage.position.y,
			scaleX: app.stage.scale.x,
			scaleY: app.stage.scale.y,
		},
		tick: () => {},
	};

	runtime.tick = () => {
		const deltaMS = app.ticker.deltaMS;
		const total = { ...NO_CONTRIBUTION };
		const finished: ActiveEffect[] = [];

		for (const effect of runtime.effects) {
			effect.elapsedMs += deltaMS;
			const sample = sampleCameraEffect(effect);
			total.offsetX += sample.offsetX;
			total.offsetY += sample.offsetY;
			total.zoom += sample.zoom;
			// Two flashes at once are ONE brighter flash, not a summed white-out.
			total.flash = Math.max(total.flash, sample.flash);
			total.chroma += sample.chroma;
			if (effect.elapsedMs >= effect.durationMs) finished.push(effect);
		}

		const draining = finished.length === runtime.effects.size;
		// Restore the resting transform on the frame the last effect ends, so the game can never be
		// left parked at a shake's final offset.
		applyCameraSample(runtime, draining ? NO_CONTRIBUTION : total);

		finished.forEach((effect) => {
			runtime.effects.delete(effect);
			effect.resolve();
		});

		if (!runtime.effects.size) {
			detachRuntime(runtime);
			return;
		}
		// Drop each surface as soon as ITS OWN kind is done, not when the last effect drains — a
		// finished wobble would otherwise make a still-running shake pay for a full-screen
		// render-texture round-trip at zero split.
		const remaining = [...runtime.effects];
		if (!remaining.some((effect) => effect.kind === 'flash')) releaseFlashSprite(runtime);
		if (!remaining.some((effect) => effect.kind === 'chromaticWobble')) {
			releaseChromaFilter(runtime);
		}
	};

	runtimes.set(app, runtime);
	app.ticker.add(runtime.tick);
	return runtime;
};

/** A finite number, or the fallback. Guards the whole module against a `NaN` reaching
 *  `stage.position.set` — which blanks the entire game until the effect drains. The values arrive
 *  from an authored FlowDoc through an `unknown` payload, so "it's typed `number`" is not a fact
 *  here, it's a hope. */
const finiteOr = (value: number | undefined, fallback: number): number =>
	typeof value === 'number' && Number.isFinite(value) ? value : fallback;

/**
 * Play a full-screen camera effect. Resolves when it finishes, so a caller that wants the effect to
 * BLOCK can await it and one that wants it to play under following work can ignore the promise.
 *
 * A missing/uninitialised app is a no-op rather than a throw: the flow fires effects at boot-ish
 * moments, and a camera flourish is never worth crashing a round over.
 */
export const runCameraEffect = (
	app: PIXI.Application | undefined,
	{ kind, durationMs, intensity }: CameraEffectOptions,
): Promise<void> => {
	if (!app?.stage || app.stage.destroyed) return Promise.resolve();

	const resolvedDuration = finiteOr(durationMs, DEFAULT_DURATION_MS[kind]);
	if (!(resolvedDuration > 0)) return Promise.resolve();

	const runtime = runtimes.get(app) ?? createRuntime(app);
	if (kind === 'flash') ensureFlashSprite(runtime);
	if (kind === 'chromaticWobble') ensureChromaFilter(runtime);

	return new Promise<void>((resolve) => {
		runtime.effects.add({
			kind,
			durationMs: resolvedDuration,
			intensity: Math.min(MAX_INTENSITY, Math.max(0, finiteOr(intensity, 1))),
			elapsedMs: 0,
			resolve,
		});
	});
};

/**
 * Tear the camera down for an app that is going away, resolving anything still in flight.
 *
 * This needs an explicit call because the effects can't notice the teardown themselves: Pixi's
 * `Application.destroy` kills the ticker plugin BEFORE the stage, so a ticker-driven guard would
 * never run — the callback is already gone. Without this, tearing down mid-effect (navigation, HMR)
 * leaves a `blocking: true` flow chain awaiting a promise nothing will ever settle.
 */
export const disposeCameraEffects = (app: PIXI.Application | undefined): void => {
	if (!app) return;
	const runtime = runtimes.get(app);
	if (!runtime) return;
	const pending = [...runtime.effects];
	runtime.effects.clear();
	detachRuntime(runtime);
	pending.forEach((effect) => effect.resolve());
};
