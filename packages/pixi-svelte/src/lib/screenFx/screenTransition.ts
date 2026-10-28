/**
 * SCREEN TRANSITIONS (Invisible Shader Graph step 8e, `docs/design/shader-graph-screens.md` §6.2–6.4):
 * the game moves from one screen to the next under an effect that can read both.
 *
 * The old screen is frozen ONCE, into a still, on the frame after the call, just before the app
 * draws it, so a Show or Hide made before the call is in it. The caller changes the screen once the
 * still is taken (`captured`), and the transition plays over the live new screen by one of two
 * routes (§5):
 *  - **Out**: a built-in exit kind, or a custom exit graph that does not read the Screens node,
 *    plays on a full-screen sprite of the still through `playElementFx`, with its motion, passes
 *    and break. It ends hidden, revealing the new screen below;
 *  - **In**: every other custom graph runs in the screen shell (`constants-shared/screenShell.ts`)
 *    as the stage's transition filter (`stageFilters.ts`): the live stage is its input, the still
 *    its second texture.
 *
 * ONE AT A TIME: a new transition ends the playing one at its end state first; so does a resize
 * (the still no longer fits) and {@link disposeScreenTransitions}. At its end the sprite or filter
 * goes and the still is destroyed: the stage is the live new screen, exactly.
 *
 * NEVER BLACK (§6.6). A kind that is not registered, not an exit when built in, or whose program the
 * shell refuses or the GPU does not link, plays the built-in Fade out on the still instead (sprite
 * alpha, no program of its own). A still that cannot be taken (no WebGL, a lost context, a failed
 * draw) is a cut: the transition is over at once and the new screen shows.
 *
 * Time runs at the host's speed (the game's turbo), as an Element FX's does.
 */

import {
	ELEMENT_FX_LIMITS,
	customElementFx,
	elementFxParamUniform,
	findElementFxSpec,
	isElementFxKind,
	resolveElementFxParams,
	type CustomElementFx,
	type ElementFxKindId,
} from 'constants-shared/elementFx';
import {
	SCREEN_FROM_TEXTURE,
	SCREEN_REVERSE,
	readsScreens,
	screenShellSource,
} from 'constants-shared/screenShell';
import {
	Container,
	Filter,
	GlProgram,
	Matrix,
	Rectangle,
	RenderTexture,
	RendererType,
	Sprite,
	UniformGroup,
	type Application,
	type Renderer,
	type Ticker,
	type WebGLRenderer,
} from 'pixi.js';
import { playElementFx, stopElementFx, type ElementFxHost, type ElementFxPose } from '../elementFx';
import { VERTEX, programLinks } from '../elementFx/shaders';
import { BEFORE_RENDER, setStageFilters, stageFilters } from './stageFilters';

export const SCREEN_TRANSITION_LIMITS = {
	durationMs: { min: 50, max: 5000 },
} as const;

/** The still's longest side, in pixels (design §10): a desktop at 2560 × 1440 × 2 is scaled to 0.8. */
export const SCREEN_STILL_MAX_PX = 4096;

/** What a transition that cannot play as asked plays instead. */
const FALLBACK_KIND = 'fadeOut';

export interface ScreenTransitionPlay {
	/** A built-in exit kind, or a registered custom effect's `custom:<id>`. */
	kind: ElementFxKindId;
	/** Unset ⇒ the effect's own length. Clamped to {@link SCREEN_TRANSITION_LIMITS}. */
	durationMs?: number;
	/** 0…4, unset ⇒ 1. */
	intensity?: number;
	params?: Readonly<Record<string, unknown>>;
	/** The Screens node's Reverse reads 1. */
	reverse?: boolean;
	/** Where the Out route's still sits among the stage's children (the game's band). */
	zIndex: number;
	/** Read every frame: holds the transition at `progress` (and scales its strength), never ending
	 *  on its own, as `playElementFx`'s pose does. */
	pose?: () => ElementFxPose | undefined;
}

/** How a transition plays: the In or Out route, the fallback fade, or a cut. */
export type ScreenTransitionRoute = 'in' | 'out' | 'fallback' | 'cut';

export interface ScreenTransitionHandle {
	/** Settles once the old screen is frozen (or the transition cut): change the screen then. */
	readonly captured: Promise<void>;
	/** Settles when the transition has played out or was ended. Never rejects. */
	readonly done: Promise<void>;
	/** End it now, at its end state: the live stage shows. */
	end(): void;
	/** How it plays; undefined until the still is taken. */
	readonly route: ScreenTransitionRoute | undefined;
	/** The still's size in pixels, while it is held. */
	readonly still: { width: number; height: number } | undefined;
	readonly active: boolean;
}

/**
 * The route `kind` takes as a transition: Out for a built-in exit kind and a custom exit graph that
 * does not read the Screens node, In for every other custom graph, undefined when it cannot play
 * (the fallback).
 */
export function screenTransitionRoute(kind: string): 'in' | 'out' | undefined {
	if (isElementFxKind(kind)) return findElementFxSpec(kind)?.phase === 'exit' ? 'out' : undefined;
	const effect = customElementFx(kind);
	if (!effect) return undefined;
	return effect.spec.phase === 'exit' && !readsScreens(effect) ? 'out' : 'in';
}

interface Transition {
	app: Application;
	host: ElementFxHost;
	renderer: Renderer;
	play: ScreenTransitionPlay;
	done: Promise<void>;
	durationMs: number;
	intensity: number;
	ended: boolean;
	route?: ScreenTransitionRoute;
	still?: RenderTexture;
	/** The transition filter's frame, in the stage's units: the still covers it. */
	frame: { width: number; height: number };
	stillSize?: { width: number; height: number };
	/** The Out route: the sprite of the still, in a holder that undoes the stage's transform. */
	holder?: Container;
	sprite?: Sprite;
	/** The In route: the screen shell's filter, and what writes its uniforms. */
	filter?: Filter;
	write?: (progress: number, seconds: number, intensity: number) => void;
	elapsedMs: number;
	progress: number;
	poseIntensity: number;
	resolveCaptured: () => void;
	resolveDone: () => void;
	capture: () => void;
	tick: (ticker: Ticker) => void;
	place: () => void;
	onResize: () => void;
}

const playing = new WeakMap<Application, Transition>();
const NO_FILTERS: readonly Filter[] = Object.freeze([]);
const VECTOR_TYPES = { vec2: 2, vec3: 3, vec4: 4 } as const;

const finite = (v: unknown, fallback: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;

const clampTo = (v: number, limits: { min: number; max: number }): number =>
	Math.min(limits.max, Math.max(limits.min, v));

const timeScaleOf = (host: ElementFxHost): number => {
	try {
		const v = host.timeScale?.();
		return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
	} catch {
		return 1;
	}
};

const said = new Set<string>();
const sayOnce = (line: string): void => {
	if (said.has(line)) return;
	said.add(line);
	console.warn(`Screen transition: ${line}`);
};

const contextLost = (renderer: Renderer): boolean =>
	renderer.type === RendererType.WEBGL && (renderer as WebGLRenderer).gl.isContextLost();

/**
 * The old screen: the stage drawn once into a texture of its own whose UV square is the transition
 * filter's frame (the screen shell's contract, `SCREEN_FROM_TEXTURE`): the viewport on whole pixels,
 * rounded out as Pixi rounds a filter's bounds, so the still's pixels are the frame's one for one at
 * any resolution. Past {@link SCREEN_STILL_MAX_PX} a side it is scaled down to fit. Drawn at the
 * stage's resting transform with the stage's filters off, so a camera shake or a post FX is not baked
 * in. Throws when it cannot be drawn. `frame` is the frame's size in the stage's units.
 */
const takeStill = (
	app: Application,
	renderer: Renderer,
): { still: RenderTexture; frame: { width: number; height: number } } => {
	const { width, height } = app.screen;
	if (!(width >= 1 && height >= 1)) throw new Error(`the screen is ${width} × ${height}`);
	const gl = (renderer as WebGLRenderer).gl;
	const maxPx = Math.min(SCREEN_STILL_MAX_PX, finite(gl.getParameter(gl.MAX_TEXTURE_SIZE), 4096));
	const { resolution } = renderer;
	const frameW = Math.ceil(width * resolution);
	const frameH = Math.ceil(height * resolution);
	const fit = Math.min(1, maxPx / frameW, maxPx / frameH);
	const stillResolution = resolution * fit;
	const still = RenderTexture.create({ width: 1, height: 1 });
	// Whole pixels: `resize` rounds them, where the constructor would not.
	still.source.resize(
		Math.min(maxPx, Math.round(frameW * fit)) / stillResolution,
		Math.min(maxPx, Math.round(frameH * fit)) / stillResolution,
		stillResolution,
	);
	const frame = { width: frameW / resolution, height: frameH / resolution };
	const filters = app.stage.filters ?? NO_FILTERS;
	const enabled = filters.map((f) => f.enabled);
	try {
		for (const filter of filters) filter.enabled = false;
		renderer.render({
			container: app.stage,
			target: still,
			clear: true,
			clearColor: renderer.background.colorRgba,
			transform: new Matrix().scale(still.width / frame.width, still.height / frame.height),
		});
	} catch (error) {
		still.destroy(true);
		throw error;
	} finally {
		filters.forEach((filter, i) => (filter.enabled = enabled[i]));
	}
	return { still, frame };
};

/** The screen shell's filter for `effect` over `still`, and what writes its uniforms; or why not. */
const shellFilter = (
	t: Transition,
	effect: CustomElementFx,
	still: RenderTexture,
): Pick<Transition, 'filter' | 'write'> | string => {
	const fragment = screenShellSource(effect);
	if (!fragment) return 'the screen shell refuses its body';
	const program = GlProgram.from({
		vertex: VERTEX,
		fragment,
		name: `screen-${effect.spec.kind.replace(/\W/g, '-')}`,
	});
	if (!programLinks(t.renderer as WebGLRenderer, program))
		return 'its program does not link on this GPU';
	const { uniforms } = effect.shader;
	const group = new UniformGroup({
		[SCREEN_REVERSE]: { value: t.play.reverse ? 1 : 0, type: 'f32' },
		...Object.fromEntries(
			uniforms.map((u) => [
				u.name,
				u.type === 'float'
					? { value: 0, type: 'f32' as const }
					: {
							value: new Float32Array(VECTOR_TYPES[u.type]),
							type: `${u.type}<f32>` as const,
						},
			]),
		),
	});
	const values = group.uniforms as Record<string, number | Float32Array>;
	const set = (name: string, ...numbers: number[]): void => {
		const target = values[name];
		if (target instanceof Float32Array) numbers.forEach((n, i) => (target[i] = n));
		else values[name] = numbers[0];
	};
	const params = resolveElementFxParams(t.play.kind, t.play.params);
	for (const u of uniforms) {
		if (u.source.kind === 'seed') set(u.name, Math.random() * 97);
		if (u.source.kind !== 'param') continue;
		const id = u.source.id;
		const spec = effect.spec.params.find((p) => p.id === id);
		if (spec) set(u.name, ...elementFxParamUniform(spec, params[id]));
	}
	const time = uniforms.find((u) => u.source.kind === 'time');
	const filter = new Filter({
		glProgram: program,
		resources: { screenUniforms: group, [SCREEN_FROM_TEXTURE]: still.source },
		// Bounded to the viewport by the stage filter owner; drawn at the screen's resolution.
		clipToViewport: false,
		resolution: 'inherit',
	});
	return {
		filter,
		write: (progress, seconds, intensity) => {
			if (time) set(time.name, progress, seconds, intensity, 0);
		},
	};
};

/** The still as a full-screen sprite above the game, and `kind` played on it; false if it cannot. */
const playOnStill = (t: Transition, kind: ElementFxKindId, still: RenderTexture): boolean => {
	const { app, frame } = t;
	const sprite = new Sprite(still);
	sprite.scale.set(frame.width / still.width, frame.height / still.height);
	// Its own box and a pixel: the runtime pays no wide margin around a full-screen effect, and a
	// pass reading the edge pixels reads them inside its frame.
	sprite.filterArea = new Rectangle(-1, -1, still.width + 2, still.height + 2);
	const holder = new Container();
	holder.zIndex = t.play.zIndex;
	holder.eventMode = 'none';
	holder.addChild(sprite);
	app.stage.addChild(holder);
	t.holder = holder;
	t.sprite = sprite;
	t.place();
	const handle = playElementFx(
		sprite,
		{
			kind,
			durationMs: t.durationMs,
			intensity: t.intensity,
			params: kind === FALLBACK_KIND ? undefined : t.play.params,
			pose: () => ({ progress: t.progress, intensity: t.poseIntensity }),
		},
		{ ticker: t.host.ticker, renderer: t.renderer },
	);
	if (handle.active) return true;
	holder.destroy({ children: true });
	t.holder = undefined;
	t.sprite = undefined;
	return false;
};

const finish = (t: Transition): void => {
	if (t.ended) return;
	t.ended = true;
	const { app, host } = t;
	host.ticker.remove(t.capture);
	host.ticker.remove(t.tick);
	host.ticker.remove(t.place);
	t.renderer.off('resize', t.onResize);
	if (t.filter) {
		if (stageFilters(app, 'transition').includes(t.filter)) setStageFilters(app, 'transition', []);
		t.filter.destroy();
		t.filter = undefined;
	}
	if (t.sprite) stopElementFx(t.sprite);
	if (t.holder && !t.holder.destroyed) t.holder.destroy({ children: true });
	t.holder = undefined;
	t.sprite = undefined;
	t.still?.destroy(true);
	t.still = undefined;
	t.stillSize = undefined;
	t.route ??= 'cut';
	if (playing.get(app) === t) playing.delete(app);
	t.resolveCaptured();
	t.resolveDone();
};

/** Play the fallback fade on the still, or cut when even that cannot play. */
const fallBack = (t: Transition, still: RenderTexture, why: string): void => {
	sayOnce(`${t.play.kind}: ${why}; a fade out plays instead.`);
	if (playOnStill(t, FALLBACK_KIND, still)) t.route = 'fallback';
	else finish(t);
};

/** The still is taken: route and start. */
const start = (t: Transition, still: RenderTexture): void => {
	t.still = still;
	t.stillSize = { width: still.source.pixelWidth, height: still.source.pixelHeight };
	const route = screenTransitionRoute(t.play.kind);
	if (route === 'in') {
		const made = shellFilter(t, customElementFx(t.play.kind) as CustomElementFx, still);
		if (typeof made === 'string') fallBack(t, still, made);
		else {
			t.route = 'in';
			t.filter = made.filter;
			t.write = made.write;
			t.write?.(
				t.progress,
				(t.progress * t.durationMs) / 1000,
				clampTo(t.intensity * t.poseIntensity, ELEMENT_FX_LIMITS.intensity),
			);
			setStageFilters(t.app, 'transition', [made.filter as Filter]);
		}
	} else if (route === 'out' && playOnStill(t, t.play.kind, still)) t.route = 'out';
	else
		fallBack(
			t,
			still,
			isElementFxKind(t.play.kind) ? 'a built-in that is not an exit' : 'not registered',
		);
	if (t.ended) return;
	t.host.ticker.add(t.tick);
	if (t.holder) t.host.ticker.add(t.place, undefined, BEFORE_RENDER);
	t.resolveCaptured();
};

const NOOP: ScreenTransitionHandle = {
	captured: Promise.resolve(),
	done: Promise.resolve(),
	end: () => {},
	route: 'cut',
	still: undefined,
	active: false,
};

/**
 * Play a screen transition on `app`'s stage. The old screen is frozen on the next frame; change the
 * screen once `captured` settles. Ends any transition already playing, at its end state.
 */
export function playScreenTransition(
	app: Application | undefined,
	play: ScreenTransitionPlay,
	host: ElementFxHost | undefined,
): ScreenTransitionHandle {
	const renderer = host?.renderer ?? app?.renderer;
	if (!app?.stage || app.stage.destroyed || !host || !renderer) return NOOP;
	disposeScreenTransitions(app);

	const spec = findElementFxSpec(play.kind) ?? findElementFxSpec(FALLBACK_KIND);
	let resolveCaptured = () => {};
	let resolveDone = () => {};
	const captured = new Promise<void>((r) => (resolveCaptured = r));
	const done = new Promise<void>((r) => (resolveDone = r));
	const t: Transition = {
		app,
		host,
		renderer,
		play,
		done,
		frame: { width: 0, height: 0 },
		durationMs: clampTo(
			finite(play.durationMs, spec?.durationMs ?? SCREEN_TRANSITION_LIMITS.durationMs.max),
			SCREEN_TRANSITION_LIMITS.durationMs,
		),
		intensity: clampTo(finite(play.intensity, 1), ELEMENT_FX_LIMITS.intensity),
		ended: false,
		elapsedMs: 0,
		progress: 0,
		poseIntensity: 1,
		resolveCaptured: () => {
			resolveCaptured();
			resolveCaptured = () => {};
		},
		resolveDone: () => {
			resolveDone();
			resolveDone = () => {};
		},
		capture: () => {},
		tick: () => {},
		place: () => {},
		onResize: () => finish(t),
	};

	const readPose = (): void => {
		let pose: ElementFxPose | undefined;
		try {
			pose = play.pose?.();
		} catch {
			pose = undefined;
		}
		t.progress = Math.min(1, Math.max(0, finite(pose?.progress, 0)));
		t.poseIntensity = Math.max(0, finite(pose?.intensity, 1));
	};

	t.capture = () => {
		host.ticker.remove(t.capture);
		if (play.pose) readPose();
		let taken: ReturnType<typeof takeStill>;
		try {
			if (renderer.type !== RendererType.WEBGL) throw new Error('the renderer is not WebGL');
			if (contextLost(renderer)) throw new Error('the WebGL context is lost');
			taken = takeStill(app, renderer);
		} catch (error) {
			sayOnce(`the screen could not be frozen (${(error as Error).message}), so it cuts.`);
			finish(t);
			return;
		}
		t.frame = taken.frame;
		start(t, taken.still);
	};

	t.tick = (ticker) => {
		if (app.stage.destroyed || contextLost(renderer)) {
			finish(t);
			return;
		}
		if (play.pose) readPose();
		else {
			t.elapsedMs += ticker.deltaMS * timeScaleOf(host);
			t.progress = Math.min(1, t.elapsedMs / t.durationMs);
			if (t.progress >= 1) {
				finish(t);
				return;
			}
		}
		const intensity = clampTo(t.intensity * t.poseIntensity, ELEMENT_FX_LIMITS.intensity);
		t.write?.(t.progress, (t.progress * t.durationMs) / 1000, intensity);
	};

	// The holder undoes the stage's transform (the camera's), as the camera's flash does, so the
	// still stays on the screen whatever moves the stage.
	t.place = () => {
		const { holder } = t;
		const stage = app.stage;
		if (!holder || stage.destroyed) return;
		holder.scale.set(1 / stage.scale.x, 1 / stage.scale.y);
		holder.position.set(-stage.position.x / stage.scale.x, -stage.position.y / stage.scale.y);
	};

	playing.set(app, t);
	host.ticker.add(t.capture, undefined, BEFORE_RENDER);
	renderer.on('resize', t.onResize);

	return {
		captured,
		done,
		end: () => finish(t),
		get route() {
			return t.route;
		},
		get still() {
			return t.stillSize;
		},
		get active() {
			return !t.ended;
		},
	};
}

/** Settles when no transition is playing on `app`: at once when none is. */
export async function waitForScreenTransition(app: Application | undefined): Promise<void> {
	if (!app) return;
	for (let t = playing.get(app); t; t = playing.get(app)) await t.done;
}

/**
 * End the transition playing on `app`, at its end state, freeing its still. Called when the app goes
 * away: a ticker-driven guard cannot notice (Pixi destroys the ticker first; `disposeCameraEffects`).
 */
export function disposeScreenTransitions(app: Application | undefined): void {
	const t = app && playing.get(app);
	if (t) finish(t);
}
