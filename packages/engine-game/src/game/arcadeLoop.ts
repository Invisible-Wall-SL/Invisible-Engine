import {
	aabbOf,
	createCamera,
	createFixedStep,
	createRng,
	createStaticIndex,
	followWith,
	moveCameraTo,
	outsideEdge,
	overlaps,
	shakeCamera,
	step,
	stepCamera,
	viewRect,
	zonesOf,
	type Aabb,
	type Body,
	type BodyEdges,
	type Camera,
	type CameraSpec,
	type Edge,
	type Field,
	type Rng,
	type StaticIndex,
} from 'engine-mechanics';
import type { SpawnedInstance } from 'engine-flow-v2';
import type { ArcadeBody, ArcadeZone } from 'game-config';

/**
 * THE ARCADE LOOP (`docs/design/game-families.md` §4.2, P10.8): one per arcade game, ticked once a
 * frame by the game (`<ArcadeStage />`) or by a headless gate, with the same code.
 *
 * Every spawned instance is a body: the shape, tags and edges its component is given in the config
 * (`GameConfigDoc.arcade.bodies`), else a point that moves and touches nothing. A frame runs, at the
 * fixed rate and as many times as the frame's time holds (`createFixedStep`): `step` → the edges
 * (`leaveBounds`) → `overlaps` by tag pair (`collide`) → the zones (`enterZone` / `leaveZone`). Only
 * then are the bodies' new places written to the live set, and the queued Flow signals raised, in
 * the order they happened — Flow is never inside the integration step.
 *
 * Every signal is an EDGE: `collide` when a pair starts touching, not while it stays touching;
 * `leaveBounds` once a `pass` body that was on the field is wholly off it (one spawned off the
 * field, to come in, has not left it); a zone on the step a body enters or leaves it.
 *
 * Flow moves bodies through the actions in {@link ArcadeLoop.effects} (`setVelocity`, `moveTo`,
 * `setTag`), each aimed at one instance or at every body carrying a tag, and reads the seeded
 * `$engine.random` / `randomX` and the field's size through {@link ArcadeLoop.value}.
 *
 * THE CAMERA (§4.4, P10.12), only when the play field's screen declares a world or a camera
 * ({@link ArcadeLoopOptions.camera}): after the zones each step moves the camera
 * (`engine-mechanics` `camera.js`), raises `enterView` / `leaveView` as a body's box starts or
 * stops meeting the view, and despawns a body of a layer with `despawnOutsideView` once it has
 * been within the margin of the view and is wholly beyond it (never the body it follows). Flow
 * steers the camera with `cameraFollow`, `cameraMoveTo`, `cameraShake` and `cameraSetAutoScroll`,
 * and reads `cameraX` / `cameraY` (the view's top-left) and `viewWidth` / `viewHeight`. Without
 * one, none of it runs. Bodies are in the play field's space, so its spawn layers sit at the
 * world's origin (a spawn layer takes no parallax).
 */

/** The live set the loop moves: `engine-flow-v2`'s spawn store, or any store shaped like it. */
export interface ArcadeLiveSet {
	live(layer: string): SpawnedInstance[];
	get(id: string): SpawnedInstance | undefined;
	subscribe(layer: string, listener: (live: SpawnedInstance[]) => void): () => void;
	move(moves: readonly { id: string; x: number; y: number }[]): void;
	layer(id: string): { despawnOutsideView?: { margin: number } } | undefined;
	despawn(id: string): unknown;
}

/** The play field's world camera: its screen's `camera` block and `world`, and the view's size. */
export interface ArcadeCameraOptions {
	spec?: CameraSpec;
	/** The world the camera is held inside (absent ⇒ unbounded). */
	world?: Field;
	/** The view's size: the screen's design size, read each step (a rotated device). */
	view(): Field;
}

/** The config's arcade block, with its defaults applied (`game-config` `resolveArcade`). */
export interface ArcadeRules {
	fixedHz: number;
	bodies: Record<string, ArcadeBody>;
	pairs: [string, string][];
	zones: ArcadeZone[];
}

export interface ArcadeLoopOptions {
	rules: ArcadeRules;
	/** The play field: the config's `field`, else the current layout's design size. Read again
	 *  each step and each value read, so a layout change (a rotated device) moves the edges. */
	field(): Field;
	/** The spawn layers whose instances are bodies, read again each frame: a layer declared after the
	 *  loop started (its screen's flow built later) is watched from then on. */
	layers(): readonly string[];
	live: ArcadeLiveSet;
	/** Raise one Flow signal. Not awaited: the signals of a frame start in order. */
	signal(name: string, payload: Record<string, unknown>): void;
	/** Seeds `$engine.random` (and, on a stream of its own, the camera's shake). */
	seed: string | number;
	/** The world camera, when the play field's screen declares one. Absent ⇒ none (as P10.8). */
	camera?: ArcadeCameraOptions;
}

/** Past the view, px, where an instance is still drawn: the art may be larger than its body. */
export const ARCADE_CULL_MARGIN = 256;

/** Where the camera is after the last step. */
export interface ArcadeCameraState {
	x: number;
	y: number;
	shakeX: number;
	shakeY: number;
	view: Field;
}

/** A body the loop moves, beside the instance it is. */
type LoopBody = Body & { componentId: string; layer: string };

export interface ArcadeLoop {
	/** Run a frame of `dtMs`. Returns the steps it ran. */
	frame(dtMs: number): number;
	/** The Flow actions the loop backs. */
	readonly effects: Readonly<Record<string, (payload: Record<string, unknown>) => void>>;
	/** The `$engine` values the loop answers, or `undefined` for a key it does not. */
	value(key: string): unknown;
	/** Steps run so far. */
	readonly steps: number;
	/** Give the loop its world camera, once: the layout may load after the loop starts. A loop that
	 *  has one keeps it. */
	attachCamera(options: ArcadeCameraOptions): void;
	/** The camera after the last step, or `undefined` without one. */
	camera(): ArcadeCameraState | undefined;
	/** The bodies out of view by more than {@link ARCADE_CULL_MARGIN} (none without a camera). */
	culled(): ReadonlySet<string>;
	/** Where each body is, for the probe and the gates. */
	bodies(): { id: string; x: number; y: number; vx: number; vy: number; tags: string[] }[];
	/** Stop watching the live set; a frame after it runs nothing. */
	dispose(): void;
}

/** The arcade signals, in the vocabulary's names (`ARCADE_VOCAB`). */
export const ARCADE_SIGNALS = {
	collide: 'collide',
	enterZone: 'enterZone',
	leaveZone: 'leaveZone',
	leaveBounds: 'leaveBounds',
	enterView: 'enterView',
	leaveView: 'leaveView',
} as const;

/** The `$engine` values an arcade game reads. */
export const ARCADE_VALUES = {
	random: 'random',
	randomX: 'randomX',
	fieldWidth: 'fieldWidth',
	fieldHeight: 'fieldHeight',
	cameraX: 'cameraX',
	cameraY: 'cameraY',
	viewWidth: 'viewWidth',
	viewHeight: 'viewHeight',
} as const;

const num = (v: unknown): number | undefined =>
	typeof v === 'number' && Number.isFinite(v) ? v : undefined;
const str = (v: unknown): string | undefined =>
	typeof v === 'string' && v.trim() ? v.trim() : undefined;

function bodyFor(instance: SpawnedInstance, rules: ArcadeRules): LoopBody {
	const spec = rules.bodies[instance.componentId];
	const base = {
		id: instance.id,
		componentId: instance.componentId,
		layer: instance.layer,
		x: instance.x,
		y: instance.y,
		vx: 0,
		vy: 0,
		tags: [...(spec?.tags ?? [])],
		...(spec?.edges ? { edges: spec.edges as BodyEdges } : {}),
	};
	if (spec?.shape === 'box') return { ...base, shape: 'box', w: spec.w, h: spec.h };
	if (spec?.shape === 'circle') return { ...base, shape: 'circle', r: spec.r };
	return { ...base, shape: 'point' };
}

export function createArcadeLoop(options: ArcadeLoopOptions): ArcadeLoop {
	const { rules, live, signal, field } = options;
	const clock = createFixedStep({ hz: rules.fixedHz });
	const rng: Rng = createRng(options.seed);
	const zoneIndex: StaticIndex<ArcadeZone> = createStaticIndex(rules.zones);
	/** Bodies in spawn order: the order a step moves them and `overlaps` reports them. */
	const bodies = new Map<string, LoopBody>();
	/** The pairs touching after the last step, keyed by pair, with the two body ids each holds. */
	const touching = new Map<string, readonly [string, string]>();
	const outside = new Map<string, Edge>();
	const inZones = new Map<string, string[]>();
	const moved = new Set<string>();
	let cameraOptions: ArcadeCameraOptions | undefined;
	let camera: Camera | undefined;
	const attachCamera = (opts: ArcadeCameraOptions) => {
		if (camera || disposed) return;
		cameraOptions = opts;
		camera = createCamera(opts.spec, createRng(`${options.seed}:camera`));
	};
	/** Bodies whose box meets the view, and those that have been within their layer's margin. */
	const inView = new Set<string>();
	const seen = new Set<string>();
	let culled = new Set<string>();
	const queue: { name: string; payload: Record<string, unknown> }[] = [];
	let disposed = false;
	if (options.camera) attachCamera(options.camera);

	const forget = (id: string) => {
		bodies.delete(id);
		outside.delete(id);
		inZones.delete(id);
		moved.delete(id);
		inView.delete(id);
		seen.delete(id);
		culled.delete(id);
		for (const [key, pair] of [...touching]) if (pair.includes(id)) touching.delete(key);
	};
	const watched = new Map<string, Set<string>>();
	const unsubscribe: (() => void)[] = [];
	const watch = (layer: string) =>
		live.subscribe(layer, (now) => {
			const before = watched.get(layer) ?? new Set<string>();
			const ids = new Set(now.map((i) => i.id));
			for (const id of before) if (!ids.has(id)) forget(id);
			for (const instance of now) {
				if (bodies.has(instance.id)) continue;
				const body = bodyFor(instance, rules);
				bodies.set(instance.id, body);
				// One spawned off the field (above it, to fall in) has not left it.
				const edge = outsideEdge(body, field());
				if (edge) outside.set(body.id, edge);
			}
			watched.set(layer, ids);
		});
	const watchNewLayers = () => {
		if (disposed) return;
		for (const layer of options.layers()) {
			if (watched.has(layer)) continue;
			watched.set(layer, new Set());
			unsubscribe.push(watch(layer));
		}
	};
	watchNewLayers();

	/** A handle at the body's place now: what a signal carries. */
	const handle = (body: LoopBody): SpawnedInstance => {
		const stored = live.get(body.id);
		return Object.freeze({
			...(stored ?? { id: body.id, layer: '', componentId: body.componentId }),
			x: body.x,
			y: body.y,
		});
	};

	const runStep = () => {
		const list = [...bodies.values()];
		for (const body of list) if (body.vx || body.vy) moved.add(body.id);
		const area = field();
		step(list, clock.dt, area);
		for (const body of list) {
			if ((body.edges ?? 'clamp') !== 'pass') continue;
			const edge = outsideEdge(body, area);
			if (edge && !outside.has(body.id)) {
				outside.set(body.id, edge);
				queue.push({ name: ARCADE_SIGNALS.leaveBounds, payload: { instance: handle(body), edge } });
			} else if (!edge) outside.delete(body.id);
		}
		const now = new Map<string, readonly [string, string]>();
		for (const hit of overlaps(list, rules.pairs)) {
			const key = JSON.stringify([hit.a.id, hit.b.id, hit.tagA, hit.tagB]);
			now.set(key, [hit.a.id, hit.b.id]);
			if (touching.has(key)) continue;
			queue.push({
				name: ARCADE_SIGNALS.collide,
				payload: { a: handle(hit.a), b: handle(hit.b), tagA: hit.tagA, tagB: hit.tagB },
			});
		}
		touching.clear();
		for (const [key, pair] of now) touching.set(key, pair);
		if (rules.zones.length) {
			for (const body of list) {
				const was = inZones.get(body.id) ?? [];
				const is = zonesOf(body, zoneIndex);
				for (const zone of is)
					if (!was.includes(zone))
						queue.push({
							name: ARCADE_SIGNALS.enterZone,
							payload: { instance: handle(body), zone },
						});
				for (const zone of was)
					if (!is.includes(zone))
						queue.push({
							name: ARCADE_SIGNALS.leaveZone,
							payload: { instance: handle(body), zone },
						});
				inZones.set(body.id, is);
			}
		}
		if (camera && cameraOptions) stepView(camera, cameraOptions, list);
	};

	const meets = (a: Aabb, b: Aabb, margin = 0) =>
		a.x0 <= b.x1 + margin &&
		a.x1 >= b.x0 - margin &&
		a.y0 <= b.y1 + margin &&
		a.y1 >= b.y0 - margin;

	const followed = (target: Camera['follow']): LoopBody | undefined => {
		if (!target) return undefined;
		if ('id' in target) return bodies.get(target.id);
		for (const body of bodies.values()) if (body.tags.includes(target.tag)) return body;
		return undefined;
	};

	const stepView = (cam: Camera, opts: ArcadeCameraOptions, list: LoopBody[]) => {
		const view = opts.view();
		const target = followed(cam.follow);
		stepCamera(cam, clock.dt, { view, world: opts.world, target });
		const rect = viewRect(cam, view);
		const gone: string[] = [];
		for (const body of list) {
			if (!bodies.has(body.id)) continue;
			const box = aabbOf(body);
			const meetsView = meets(box, rect);
			if (meetsView && !inView.has(body.id)) {
				inView.add(body.id);
				queue.push({ name: ARCADE_SIGNALS.enterView, payload: { instance: handle(body) } });
			} else if (!meetsView && inView.has(body.id)) {
				inView.delete(body.id);
				queue.push({ name: ARCADE_SIGNALS.leaveView, payload: { instance: handle(body) } });
			}
			const margin = live.layer(body.layer)?.despawnOutsideView?.margin;
			if (margin === undefined) continue;
			if (meets(box, rect, margin)) seen.add(body.id);
			// The body the camera follows is never left behind (moved ahead of the camera).
			else if (seen.has(body.id) && body !== target) gone.push(body.id);
		}
		for (const id of gone) {
			live.despawn(id);
			forget(id);
		}
	};

	const cullNow = () => {
		if (!camera || !cameraOptions) return;
		const rect = viewRect(camera, cameraOptions.view());
		const next = new Set<string>();
		for (const body of bodies.values())
			if (!meets(aabbOf(body), rect, ARCADE_CULL_MARGIN)) next.add(body.id);
		culled = next;
	};

	/** The bodies an action aims at: its instance, else every body carrying its tag. */
	const targets = (payload: Record<string, unknown>): LoopBody[] => {
		// A spawn into a layer declared since the last frame is a body before it is aimed at.
		watchNewLayers();
		const instance = payload.instance as { id?: unknown } | undefined;
		const id = typeof instance?.id === 'string' ? instance.id : undefined;
		if (id) {
			const body = bodies.get(id);
			return body ? [body] : [];
		}
		const tag = str(payload.tagged);
		return tag ? [...bodies.values()].filter((b) => b.tags.includes(tag)) : [];
	};

	const effects: ArcadeLoop['effects'] = Object.freeze({
		setVelocity: (payload) => {
			const vx = num(payload.vx);
			const vy = num(payload.vy);
			for (const body of targets(payload)) {
				if (vx !== undefined) body.vx = vx;
				if (vy !== undefined) body.vy = vy;
			}
		},
		moveTo: (payload) => {
			const x = num(payload.x);
			const y = num(payload.y);
			for (const body of targets(payload)) {
				if (x !== undefined) body.x = x;
				if (y !== undefined) body.y = y;
				moved.add(body.id);
			}
		},
		cameraFollow: (payload) => {
			if (!camera) return;
			const instance = payload.instance as { id?: unknown } | undefined;
			const id = typeof instance?.id === 'string' ? instance.id : undefined;
			const tag = str(payload.tagged);
			followWith(camera, id ? { id } : tag ? { tag } : undefined, payload.snap === true);
		},
		cameraMoveTo: (payload) => {
			if (!camera) return;
			const x = num(payload.x);
			const y = num(payload.y);
			if (x === undefined || y === undefined) return;
			moveCameraTo(camera, x, y, payload.snap === true);
		},
		cameraShake: (payload) => {
			if (!camera) return;
			shakeCamera(camera, num(payload.strength) ?? 0, num(payload.duration) ?? 0);
		},
		cameraSetAutoScroll: (payload) => {
			if (!camera) return;
			const x = num(payload.x);
			const y = num(payload.y);
			if (x !== undefined) camera.autoScroll.x = x;
			if (y !== undefined) camera.autoScroll.y = y;
		},
		setTag: (payload) => {
			const tag = str(payload.tag);
			if (!tag) return;
			const on = payload.on !== false;
			for (const body of targets(payload)) {
				const has = body.tags.includes(tag);
				if (on && !has) body.tags.push(tag);
				if (!on && has) body.tags = body.tags.filter((t) => t !== tag);
			}
		},
	});

	return {
		frame(dtMs) {
			if (disposed) return 0;
			watchNewLayers();
			const ran = clock.advance(dtMs, runStep);
			if (moved.size) {
				live.move(
					[...moved].flatMap((id) => {
						const body = bodies.get(id);
						return body ? [{ id, x: body.x, y: body.y }] : [];
					}),
				);
				moved.clear();
			}
			cullNow();
			const due = queue.splice(0);
			for (const { name, payload } of due) signal(name, payload);
			return ran;
		},
		effects,
		value(key) {
			if (key === ARCADE_VALUES.random) return rng();
			if (key === ARCADE_VALUES.randomX) return rng() * field().w;
			if (key === ARCADE_VALUES.fieldWidth) return field().w;
			if (key === ARCADE_VALUES.fieldHeight) return field().h;
			if (!camera || !cameraOptions) return undefined;
			if (key === ARCADE_VALUES.cameraX) return camera.x;
			if (key === ARCADE_VALUES.cameraY) return camera.y;
			if (key === ARCADE_VALUES.viewWidth) return cameraOptions.view().w;
			if (key === ARCADE_VALUES.viewHeight) return cameraOptions.view().h;
			return undefined;
		},
		attachCamera,
		camera: () =>
			camera && cameraOptions
				? {
						x: camera.x,
						y: camera.y,
						shakeX: camera.offsetX,
						shakeY: camera.offsetY,
						view: cameraOptions.view(),
					}
				: undefined,
		culled: () => culled,
		get steps() {
			return clock.steps;
		},
		bodies: () =>
			[...bodies.values()].map((b) => ({
				id: b.id,
				x: b.x,
				y: b.y,
				vx: b.vx,
				vy: b.vy,
				tags: [...b.tags],
			})),
		dispose() {
			disposed = true;
			for (const off of unsubscribe.splice(0)) off();
			for (const state of [bodies, touching, outside, inZones, moved, watched, inView, seen])
				state.clear();
			culled = new Set();
			queue.length = 0;
		},
	};
}
