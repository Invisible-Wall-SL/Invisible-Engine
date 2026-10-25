import {
	createFixedStep,
	createRng,
	createStaticIndex,
	outsideEdge,
	overlaps,
	step,
	zonesOf,
	type Body,
	type BodyEdges,
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
 * `$engine.random` and the field's size through {@link ArcadeLoop.values}.
 */

/** The live set the loop moves: `engine-flow-v2`'s spawn store, or any store shaped like it. */
export interface ArcadeLiveSet {
	live(layer: string): SpawnedInstance[];
	get(id: string): SpawnedInstance | undefined;
	subscribe(layer: string, listener: (live: SpawnedInstance[]) => void): () => void;
	move(moves: readonly { id: string; x: number; y: number }[]): void;
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
	/** The play field: the config's `field`, else the screen's design size. */
	field: Field;
	/** The spawn layers whose instances are bodies. */
	layers: readonly string[];
	live: ArcadeLiveSet;
	/** Raise one Flow signal. Not awaited: the signals of a frame start in order. */
	signal(name: string, payload: Record<string, unknown>): void;
	/** Seeds `$engine.random`. */
	seed: string | number;
}

/** A body the loop moves, beside the instance it is. */
type LoopBody = Body & { componentId: string };

export interface ArcadeLoop {
	/** Run a frame of `dtMs`. Returns the steps it ran. */
	frame(dtMs: number): number;
	/** The Flow actions the loop backs. */
	readonly effects: Readonly<Record<string, (payload: Record<string, unknown>) => void>>;
	/** The `$engine` values the loop answers, or `undefined` for a key it does not. */
	value(key: string): unknown;
	/** Steps run so far. */
	readonly steps: number;
	/** Where each body is, for the probe and the gates. */
	bodies(): { id: string; x: number; y: number; vx: number; vy: number; tags: string[] }[];
	/** Stop watching the live set. */
	dispose(): void;
}

/** The arcade signals, in the vocabulary's names (`ARCADE_VOCAB`). */
export const ARCADE_SIGNALS = {
	collide: 'collide',
	enterZone: 'enterZone',
	leaveZone: 'leaveZone',
	leaveBounds: 'leaveBounds',
} as const;

/** The `$engine` values an arcade game reads. */
export const ARCADE_VALUES = {
	random: 'random',
	fieldWidth: 'fieldWidth',
	fieldHeight: 'fieldHeight',
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
	const { rules, field, live, signal } = options;
	const clock = createFixedStep({ hz: rules.fixedHz });
	const rng: Rng = createRng(options.seed);
	const zoneIndex: StaticIndex<ArcadeZone> = createStaticIndex(rules.zones);
	/** Bodies in spawn order: the order a step moves them and `overlaps` reports them. */
	const bodies = new Map<string, LoopBody>();
	const touching = new Set<string>();
	const outside = new Map<string, Edge>();
	const inZones = new Map<string, string[]>();
	const moved = new Set<string>();
	const queue: { name: string; payload: Record<string, unknown> }[] = [];

	const forget = (id: string) => {
		bodies.delete(id);
		outside.delete(id);
		inZones.delete(id);
		moved.delete(id);
		for (const key of [...touching]) if (key.split('|').includes(id)) touching.delete(key);
	};
	const watched = new Map<string, Set<string>>();
	const unsubscribe = options.layers.map((layer) =>
		live.subscribe(layer, (now) => {
			const before = watched.get(layer) ?? new Set<string>();
			const ids = new Set(now.map((i) => i.id));
			for (const id of before) if (!ids.has(id)) forget(id);
			for (const instance of now) {
				if (bodies.has(instance.id)) continue;
				const body = bodyFor(instance, rules);
				bodies.set(instance.id, body);
				// One spawned off the field (above it, to fall in) has not left it.
				const edge = outsideEdge(body, field);
				if (edge) outside.set(body.id, edge);
			}
			watched.set(layer, ids);
		}),
	);

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
		step(list, clock.dt, field);
		for (const body of list) {
			if ((body.edges ?? 'clamp') !== 'pass') continue;
			const edge = outsideEdge(body, field);
			if (edge && !outside.has(body.id)) {
				outside.set(body.id, edge);
				queue.push({ name: ARCADE_SIGNALS.leaveBounds, payload: { instance: handle(body), edge } });
			} else if (!edge) outside.delete(body.id);
		}
		const now = new Set<string>();
		for (const hit of overlaps(list, rules.pairs)) {
			const key = `${hit.a.id}|${hit.b.id}|${hit.tagA}|${hit.tagB}`;
			now.add(key);
			if (touching.has(key)) continue;
			queue.push({
				name: ARCADE_SIGNALS.collide,
				payload: { a: handle(hit.a), b: handle(hit.b), tagA: hit.tagA, tagB: hit.tagB },
			});
		}
		touching.clear();
		for (const key of now) touching.add(key);
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
	};

	/** The bodies an action aims at: its instance, else every body carrying its tag. */
	const targets = (payload: Record<string, unknown>): LoopBody[] => {
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
			const due = queue.splice(0);
			for (const { name, payload } of due) signal(name, payload);
			return ran;
		},
		effects,
		value(key) {
			if (key === ARCADE_VALUES.random) return rng();
			if (key === ARCADE_VALUES.fieldWidth) return field.w;
			if (key === ARCADE_VALUES.fieldHeight) return field.h;
			return undefined;
		},
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
			for (const off of unsubscribe) off();
			bodies.clear();
		},
	};
}
