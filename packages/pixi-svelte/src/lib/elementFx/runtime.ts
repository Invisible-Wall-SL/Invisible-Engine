/**
 * The Element FX runtime: play an effect ON a container — a placed node, a screen, the reels.
 *
 * One runtime per container composes everything playing on it, the way `cameraEffects` composes the
 * stage: each effect's MOTION is folded into one change of the container's own transform (about the
 * element's centre, or its base, or its top), its FILTERS are stacked after any the container
 * already had, and a BREAK hides it and flies a still of it in pieces. When the last effect ends,
 * the container is put back exactly as it was: its resting transform, alpha, filters and
 * `filterArea`.
 *
 * THE CONTAINER STAYS OWNED BY WHOEVER PLACED IT. Svelte may write its position, scale or alpha
 * while an effect plays (a binding, a timeline, a resize). Each frame the runtime compares the
 * container's values with the ones it wrote last; any that differ were written by the owner and
 * become the new resting value, so a shake on a moving node moves with it and the owner's write is
 * never undone at the end.
 *
 * Zero cost at rest: a container with nothing playing has no runtime, no ticker callback and no
 * filter.
 */

import {
	ELEMENT_FX_LIMITS,
	elementFxSpec,
	resolveElementFxParams,
	type ElementFxKind,
	type ElementFxKindSpec,
	type ElementFxParamValue,
} from 'constants-shared/elementFx';
import {
	Matrix,
	Rectangle,
	type Application,
	type Container,
	type Filter,
	type Renderer,
	type Ticker,
} from 'pixi.js';
import { dustWind, startBreak, type BreakRun } from './breakApart';
import { REST, clamp01, smoothstep, TAU, type FxFrame, type Motion } from './frame';
import { KINDS, type KindImpl } from './kinds';
import { ElementFxFilter } from './shaders';

export interface ElementFxHost {
	/** Steps every effect. The game's app ticker, or a tool's own. */
	ticker: Ticker;
	/** Renders the still a BREAK cuts up. Without one, `crash` and `crumble` fade out instead. */
	renderer?: Renderer;
	/** Presentation speed, read every frame (the game's turbo). Unset ⇒ 1. */
	timeScale?: () => number;
}

/** The host for a Pixi app, or `undefined` before it exists. */
export const elementFxHostFor = (
	app: Application | undefined,
	timeScale?: () => number,
): ElementFxHost | undefined =>
	app?.ticker && app.renderer
		? { ticker: app.ticker, renderer: app.renderer, timeScale }
		: undefined;

export interface ElementFxPlay {
	kind: ElementFxKind;
	durationMs?: number;
	delayMs?: number;
	intensity?: number;
	/** How many plays; 0 = until stopped. Unset ⇒ once. */
	repeat?: number;
	params?: Readonly<Record<string, unknown>>;
	/**
	 * POSE it instead of playing it: read every frame, the effect sits at `progress` (0 = at rest …
	 * 1 = its end) with its strength multiplied by `intensity`, and never ends on its own. A
	 * timeline keying a `keyed` entry drives it this way, so scrubbing scrubs the effect. Nothing
	 * (or a progress of 0) ⇒ at rest.
	 */
	pose?: () => ElementFxPose | undefined;
}

export interface ElementFxPose {
	progress?: number;
	intensity?: number;
}

export interface ElementFxHandle {
	/** Settles when the effect has played out (an exit kind: when it has hidden the element), or is
	 * stopped. Never rejects. */
	readonly done: Promise<void>;
	/** End it now and put the element back at rest. */
	stop(): void;
	/** Still playing, or holding an exit. */
	readonly active: boolean;
}

type Comps = {
	x: number;
	y: number;
	scaleX: number;
	scaleY: number;
	rotation: number;
	skewX: number;
	skewY: number;
	alpha: number;
};

const COMPS = ['x', 'y', 'scaleX', 'scaleY', 'rotation', 'skewX', 'skewY', 'alpha'] as const;

interface Effect {
	kind: ElementFxKind;
	spec: ElementFxKindSpec;
	impl: KindImpl;
	durationMs: number;
	delayMs: number;
	intensity: number;
	/** 0 = until stopped. */
	plays: number;
	params: Record<string, ElementFxParamValue>;
	elapsedMs: number;
	/** Played out; an exit kind keeps posing its last frame. */
	held: boolean;
	filter?: Filter;
	breakRun?: BreakRun;
	/** The break could not start (no renderer, nothing to cut): it fades out instead. */
	breakFallback?: boolean;
	pose?: () => ElementFxPose | undefined;
	resolve: () => void;
}

interface Runtime {
	target: Container;
	host: ElementFxHost;
	effects: Effect[];
	/** The element's box in its own space, taken when the first effect starts. */
	box: Rectangle;
	/** Nothing measured yet (art still loading): measured again each frame until it has a size. */
	boxPending: boolean;
	/** The resting transform while a motion is applied, and what the runtime last wrote. */
	rest?: Comps;
	written?: Comps;
	/** The runtime's filters are on the container. */
	filtersOn: boolean;
	/** Filters that were on the container before (or were added beside) the runtime's own. */
	external: Filter[];
	/** The filter list the runtime last set, to notice an owner replacing it. */
	lastFilters: readonly Filter[];
	/** The container's own `filterArea` (null: it had none and the runtime set its own). */
	priorArea: Rectangle | null;
	area: Rectangle;
	tick: (ticker: Ticker) => void;
}

const runtimes = new WeakMap<Container, Runtime>();

const finite = (v: unknown, fallback: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const clampTo = (v: number, limits: { min: number; max: number }): number =>
	Math.min(limits.max, Math.max(limits.min, v));

const readComps = (c: Container): Comps => ({
	x: c.position.x,
	y: c.position.y,
	scaleX: c.scale.x,
	scaleY: c.scale.y,
	rotation: c.rotation,
	skewX: c.skew.x,
	skewY: c.skew.y,
	alpha: c.alpha,
});

const writeComps = (c: Container, v: Comps): void => {
	c.position.set(v.x, v.y);
	c.scale.set(v.scaleX, v.scaleY);
	c.rotation = v.rotation;
	c.skew.set(v.skewX, v.skewY);
	c.alpha = v.alpha;
};

/** The container's local matrix for `v`, its pivot and origin (Pixi's own formula). */
const restMatrix = (c: Container, v: Comps, out = new Matrix()): Matrix =>
	out.setTransform(
		v.x + c.origin.x,
		v.y + c.origin.y,
		c.pivot.x + c.origin.x,
		c.pivot.y + c.origin.y,
		v.scaleX,
		v.scaleY,
		v.rotation,
		v.skewX,
		v.skewY,
	);

/** `m` back into transform values for `c` (Pixi's `Matrix.decompose`, honouring an origin). */
const decompose = (c: Container, m: Matrix, alpha: number): Comps => {
	const px = c.pivot.x + c.origin.x;
	const py = c.pivot.y + c.origin.y;
	const skewX = -Math.atan2(-m.c, m.d);
	const skewY = Math.atan2(m.b, m.a);
	const delta = Math.abs(skewX + skewY);
	let scaleX = Math.sqrt(m.a * m.a + m.b * m.b);
	let rotation = 0;
	let sx = 0;
	let sy = 0;
	if (delta < 1e-5 || Math.abs(TAU - delta) < 1e-5) {
		rotation = skewY;
	} else if (Math.abs(Math.PI - delta) < 1e-5) {
		rotation = skewY - Math.PI;
		scaleX = -scaleX;
	} else {
		sx = skewX;
		sy = skewY;
	}
	return {
		x: m.tx + (px * m.a + py * m.c) - c.origin.x,
		y: m.ty + (px * m.b + py * m.d) - c.origin.y,
		scaleX,
		scaleY: Math.sqrt(m.c * m.c + m.d * m.d),
		rotation,
		skewX: sx,
		skewY: sy,
		alpha,
	};
};

const NO_FILTERS: readonly Filter[] = Object.freeze([]);

/** The container's box in its own space, or `undefined` while it has no size yet. */
const measure = (target: Container): Rectangle | undefined => {
	const rect = target.getLocalBounds().rectangle;
	return rect.width > 0 && rect.height > 0 && Number.isFinite(rect.width + rect.height)
		? new Rectangle(rect.x, rect.y, rect.width, rect.height)
		: undefined;
};

/** Room around the box the filters may draw into, so an animating rig is not clipped mid-effect. */
const areaFor = (box: Rectangle): Rectangle => {
	const margin = Math.min(256, Math.max(8, 0.25 * Math.max(box.width, box.height)));
	return new Rectangle(
		box.x - margin,
		box.y - margin,
		box.width + 2 * margin,
		box.height + 2 * margin,
	);
};

/** The effect's frame now, or `undefined` while it waits out its delay. */
const frameOf = (runtime: Runtime, effect: Effect): FxFrame | undefined => {
	const runMs = effect.elapsedMs - effect.delayMs;
	if (runMs < 0 && !effect.held) return undefined;
	const played = effect.plays > 0 && runMs >= effect.plays * effect.durationMs;
	const t =
		effect.held || played ? 1 : (Math.max(0, runMs) % effect.durationMs) / effect.durationMs;
	return {
		t,
		seconds: Math.max(0, runMs) / 1000,
		playSeconds: effect.durationMs / 1000,
		intensity: effect.intensity,
		params: effect.params,
		looping: effect.plays === 0,
		width: runtime.box.width,
		height: runtime.box.height,
	};
};

/** An `enter` kind keeps the element hidden while it waits out its delay. */
const delayFrame = (runtime: Runtime, effect: Effect): FxFrame | undefined =>
	effect.spec.phase === 'enter'
		? {
				t: 0,
				seconds: 0,
				playSeconds: effect.durationMs / 1000,
				intensity: effect.intensity,
				params: effect.params,
				looping: false,
				width: runtime.box.width,
				height: runtime.box.height,
			}
		: undefined;

/** A posed effect's frame now, or `undefined` while it is at rest. A bad read is at rest. */
const poseFrame = (runtime: Runtime, effect: Effect): FxFrame | undefined => {
	let pose: ElementFxPose | undefined;
	try {
		pose = effect.pose?.();
	} catch {
		return undefined;
	}
	const progress = clamp01(finite(pose?.progress, 0));
	if (!(progress > 0)) return undefined;
	return {
		t: progress,
		seconds: progress * (effect.durationMs / 1000),
		playSeconds: effect.durationMs / 1000,
		intensity: clampTo(
			effect.intensity * Math.max(0, finite(pose?.intensity, 1)),
			ELEMENT_FX_LIMITS.intensity,
		),
		params: effect.params,
		looping: false,
		width: runtime.box.width,
		height: runtime.box.height,
	};
};

/** How far through its break `effect` is: a reversed break (an entrance) runs its pieces back from
 *  the end, so they fly in and become the element. */
const breakProgress = (effect: Effect, frame: FxFrame): number =>
	effect.impl.reversed ? 1 - frame.t : frame.t;

/** A break that could not cut the element still leaves: it fades away (a crumble sinking, dust
 *  drifting on its wind), or, reversed, drifts back in. */
const breakFallbackMotion = (effect: Effect, frame: FxFrame): Partial<Motion> => {
	const t = breakProgress(effect, frame);
	const fade = 1 - smoothstep(0.15, 1, t);
	if (effect.kind === 'crumble') {
		return { alpha: fade, y: t * t * 0.3 * frame.height };
	}
	if (effect.impl.breaks === 'dust') {
		const [wx, wy] = dustWind(effect.params);
		const drift = t * t * 0.25 * Math.max(frame.width, frame.height);
		return { alpha: fade, x: wx * drift, y: wy * drift };
	}
	const shake = (1 - clamp01(frame.t / 0.3)) * 0.03 * Math.max(frame.width, frame.height);
	return { alpha: fade, x: shake * Math.sin(frame.seconds * 90) };
};

const motionMatrix = (runtime: Runtime, m: Motion, out: Matrix): Matrix => {
	const { box } = runtime;
	const px = box.x + m.pivotX * box.width;
	const py = box.y + m.pivotY * box.height;
	return out.setTransform(
		px + m.x,
		py + m.y,
		px,
		py,
		m.scaleX,
		m.scaleY,
		m.rotation,
		m.skewX,
		m.skewY,
	);
};

const scratch = new Matrix();
const restScratch = new Matrix();

/** Fold every effect's motion into the container's transform, or put it back at rest. */
const applyMotion = (runtime: Runtime, frames: Map<Effect, FxFrame>): void => {
	const { target } = runtime;
	const total = new Matrix();
	let alpha = 1;
	let moving = false;
	for (const effect of runtime.effects) {
		const frame = frames.get(effect);
		if (!frame) continue;
		let part: Partial<Motion> | undefined;
		if (effect.impl.breaks) {
			part = effect.breakFallback ? breakFallbackMotion(effect, frame) : { alpha: 0 };
		} else if (effect.impl.motion) {
			part = effect.impl.motion(frame);
		}
		if (!part) continue;
		const m: Motion = { ...REST, ...part };
		moving = true;
		alpha *= finite(m.alpha, 1);
		total.append(motionMatrix(runtime, m, scratch));
	}

	const current = readComps(target);
	if (!moving) {
		if (runtime.written && runtime.rest) {
			const back = { ...current };
			for (const k of COMPS) {
				if (current[k] === runtime.written[k]) back[k] = runtime.rest[k];
			}
			writeComps(target, back);
		}
		runtime.rest = undefined;
		runtime.written = undefined;
		return;
	}

	const rest = runtime.rest ?? { ...current };
	if (runtime.written) {
		for (const k of COMPS) {
			if (current[k] !== runtime.written[k]) rest[k] = current[k];
		}
	}
	runtime.rest = rest;
	const finalMatrix = restMatrix(target, rest, restScratch).append(total);
	const next = decompose(target, finalMatrix, rest.alpha * alpha);
	for (const k of COMPS) {
		if (!Number.isFinite(next[k])) next[k] = rest[k];
	}
	writeComps(target, next);
	runtime.written = readComps(target);
};

const screenScale = (target: Container): { x: number; y: number } => {
	const m = target.worldTransform;
	return { x: Math.hypot(m.a, m.b) || 1, y: Math.hypot(m.c, m.d) || 1 };
};

/** Take the runtime's filters off and give the container back its own list and filter area. */
const releaseFilters = (runtime: Runtime): void => {
	if (!runtime.filtersOn) return;
	const { target } = runtime;
	target.filters = runtime.external.length ? [...runtime.external] : null;
	target.filterArea = runtime.priorArea ?? undefined;
	runtime.filtersOn = false;
	runtime.lastFilters = NO_FILTERS;
};

/** Keep the runtime's filters on the container, after its own, and feed each one its frame. */
const applyFilters = (runtime: Runtime, frames: Map<Effect, FxFrame>): void => {
	const { target } = runtime;
	const ours = runtime.effects.filter((e) => e.filter && frames.has(e));
	const current = target.filters ?? NO_FILTERS;
	if (runtime.filtersOn && current !== runtime.lastFilters) {
		const mine = new Set(runtime.effects.map((e) => e.filter).filter(Boolean));
		runtime.external = current.filter((f) => !mine.has(f));
	}
	// Nothing measured yet means nothing drawn yet: a filter bounded to a 1-px box would hide the
	// art for the frames it takes to load.
	if (!ours.length || runtime.boxPending) {
		releaseFilters(runtime);
		return;
	}
	if (!runtime.filtersOn) {
		runtime.external = [...current];
		runtime.priorArea = target.filterArea ?? null;
		runtime.filtersOn = true;
	}
	runtime.area = runtime.priorArea ? runtime.priorArea.clone() : areaFor(runtime.box);
	if (!runtime.priorArea) target.filterArea = runtime.area;

	const scale = screenScale(target);
	const view = {
		screenWidth: runtime.box.width * scale.x,
		screenHeight: runtime.box.height * scale.y,
	};
	for (const effect of ours) {
		const frame = frames.get(effect) as FxFrame;
		const filter = effect.filter as Filter;
		effect.impl.filter?.update(filter, frame, view);
		const padding = effect.impl.filter?.padding?.(frame, view);
		if (padding !== undefined) filter.padding = Math.max(0, Math.ceil(padding));
	}

	const stack = [...runtime.external, ...ours.map((e) => e.filter as Filter)];
	const same =
		runtime.lastFilters.length === stack.length &&
		stack.every((f, i) => runtime.lastFilters[i] === f);
	if (!same) {
		target.filters = stack;
		runtime.lastFilters = target.filters ?? NO_FILTERS;
	}

	const { area, box } = runtime;
	const pad = stack.reduce((sum, f) => sum + (f.enabled ? f.padding : 0), 0) | 0;
	for (const effect of ours) {
		if (!(effect.filter instanceof ElementFxFilter)) continue;
		effect.filter.set(
			'uElement',
			(box.x - area.x) / area.width,
			(box.y - area.y) / area.height,
			box.width / area.width,
			box.height / area.height,
		);
		effect.filter.set('uPad', pad);
	}
};

const finish = (runtime: Runtime, effect: Effect): void => {
	effect.breakRun?.destroy();
	effect.breakRun = undefined;
	effect.resolve();
};

/** Take `effect` off the container. Its filter leaves the stack before it is destroyed. */
const removeEffect = (runtime: Runtime, effect: Effect): void => {
	const index = runtime.effects.indexOf(effect);
	if (index < 0) return;
	runtime.effects.splice(index, 1);
	finish(runtime, effect);
	if (effect.filter) {
		const { target } = runtime;
		if (runtime.filtersOn && !target.destroyed) {
			const left = (target.filters ?? NO_FILTERS).filter((f) => f !== effect.filter);
			target.filters = left.length ? left : null;
			runtime.lastFilters = target.filters ?? NO_FILTERS;
		}
		effect.filter.destroy();
		effect.filter = undefined;
	}
	if (!runtime.effects.length) {
		if (!runtime.target.destroyed) settle(runtime);
		detach(runtime);
	}
};

/** Put the container back at rest: its own transform, alpha, filters and filter area. */
const settle = (runtime: Runtime): void => {
	applyMotion(runtime, new Map());
	releaseFilters(runtime);
};

const detach = (runtime: Runtime): void => {
	runtime.host.ticker.remove(runtime.tick);
	runtimes.delete(runtime.target);
};

const timeScaleOf = (host: ElementFxHost): number => {
	try {
		const v = host.timeScale?.();
		return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
	} catch {
		return 1;
	}
};

/** Snapshot and cut the element for a break, or mark it to fade instead. */
const startEffectBreak = (runtime: Runtime, effect: Effect): void => {
	const { target } = runtime;
	const renderer = runtime.boxPending ? undefined : runtime.host.renderer;
	effect.breakRun =
		renderer && effect.impl.breaks
			? startBreak({
					style: effect.impl.breaks,
					target,
					renderer,
					box: runtime.box,
					rest: restMatrix(target, runtime.rest ?? readComps(target)),
					intensity: effect.intensity,
					params: effect.params,
					playSeconds: effect.durationMs / 1000,
				})
			: undefined;
	if (!effect.breakRun) effect.breakFallback = true;
};

const step = (runtime: Runtime, deltaMs: number): void => {
	const { target } = runtime;
	if (target.destroyed) {
		for (const effect of [...runtime.effects]) {
			finish(runtime, effect);
			effect.filter?.destroy();
		}
		runtime.effects = [];
		detach(runtime);
		return;
	}

	if (runtime.boxPending) {
		const box = measure(target);
		if (box) {
			runtime.box = box;
			runtime.boxPending = false;
		}
	}

	const frames = new Map<Effect, FxFrame>();
	for (const effect of [...runtime.effects]) {
		if (effect.pose) {
			const frame = poseFrame(runtime, effect);
			if (!frame) {
				// Back at rest: the next pose past 0 cuts a fresh still.
				effect.breakRun?.destroy();
				effect.breakRun = undefined;
				effect.breakFallback = false;
				continue;
			}
			frames.set(effect, frame);
			if (effect.impl.filter && !effect.filter) effect.filter = effect.impl.filter.create(frame);
			if (effect.impl.breaks && !effect.breakRun && !effect.breakFallback) {
				startEffectBreak(runtime, effect);
			}
			effect.breakRun?.update(breakProgress(effect, frame));
			continue;
		}
		if (!effect.held) effect.elapsedMs += deltaMs;
		const runMs = effect.elapsedMs - effect.delayMs;
		if (!effect.held && effect.plays > 0 && runMs >= effect.plays * effect.durationMs) {
			if (effect.spec.phase === 'exit') {
				effect.held = true;
				effect.breakRun?.destroy();
				effect.breakRun = undefined;
				effect.resolve();
			} else {
				removeEffect(runtime, effect);
				continue;
			}
		}
		const frame = frameOf(runtime, effect) ?? delayFrame(runtime, effect);
		if (!frame) continue;
		frames.set(effect, frame);
		if (effect.impl.filter && !effect.filter) effect.filter = effect.impl.filter.create(frame);
		if (effect.impl.breaks && !effect.held && !effect.breakRun && !effect.breakFallback) {
			startEffectBreak(runtime, effect);
		}
		effect.breakRun?.update(breakProgress(effect, frame));
	}
	if (!runtime.effects.length) return;
	applyMotion(runtime, frames);
	applyFilters(runtime, frames);
};

const runtimeFor = (target: Container, host: ElementFxHost): Runtime => {
	const existing = runtimes.get(target);
	if (existing) return existing;
	const box = measure(target);
	const runtime: Runtime = {
		target,
		host,
		effects: [],
		box: box ?? new Rectangle(0, 0, 1, 1),
		boxPending: !box,
		filtersOn: false,
		external: [],
		lastFilters: NO_FILTERS,
		priorArea: null,
		area: new Rectangle(),
		tick: () => {},
	};
	runtime.tick = (ticker) => step(runtime, ticker.deltaMS * timeScaleOf(runtime.host));
	host.ticker.add(runtime.tick);
	runtimes.set(target, runtime);
	return runtime;
};

const NOOP_HANDLE: ElementFxHandle = { done: Promise.resolve(), stop: () => {}, active: false };

/**
 * Play `play` on `target`. An `enter` kind first releases any exit the element is holding (a
 * dissolve-out then a dissolve-in brings it back). Plays alongside whatever else is on the element.
 */
export function playElementFx(
	target: Container | undefined | null,
	play: ElementFxPlay,
	host: ElementFxHost | undefined,
): ElementFxHandle {
	if (!target || target.destroyed || !host || !(play.kind in KINDS)) return NOOP_HANDLE;
	const spec = elementFxSpec(play.kind);
	const runtime = runtimeFor(target, host);
	if (spec.phase === 'enter' && !play.pose) {
		for (const held of runtime.effects.filter((e) => e.held)) removeEffect(runtime, held);
	}
	const live = runtimes.get(target) === runtime ? runtime : runtimeFor(target, host);

	let resolve = () => {};
	const done = new Promise<void>((r) => (resolve = r));
	const effect: Effect = {
		kind: play.kind,
		spec,
		impl: KINDS[play.kind],
		durationMs: clampTo(finite(play.durationMs, spec.durationMs), ELEMENT_FX_LIMITS.durationMs),
		delayMs: clampTo(finite(play.delayMs, 0), ELEMENT_FX_LIMITS.delayMs),
		intensity: clampTo(finite(play.intensity, 1), ELEMENT_FX_LIMITS.intensity),
		plays: Math.round(clampTo(finite(play.repeat, 1), ELEMENT_FX_LIMITS.repeat)),
		params: resolveElementFxParams(play.kind, play.params),
		elapsedMs: 0,
		held: false,
		pose: play.pose,
		resolve: () => {
			resolve();
			resolve = () => {};
		},
	};
	live.effects.push(effect);
	step(live, 0);

	return {
		done,
		stop: () => {
			const owner = runtimes.get(target);
			if (owner) removeEffect(owner, effect);
			else effect.resolve();
		},
		get active() {
			return runtimes.get(target)?.effects.includes(effect) ?? false;
		},
	};
}

/** Stop everything playing (or held) on `target` and put it back at rest. */
export function stopElementFx(target: Container | undefined | null): void {
	if (!target) return;
	const runtime = runtimes.get(target);
	if (!runtime) return;
	for (const effect of [...runtime.effects]) removeEffect(runtime, effect);
}

/** How many effects are on `target` (playing or holding an exit). */
export function elementFxCount(target: Container): number {
	return runtimes.get(target)?.effects.length ?? 0;
}
