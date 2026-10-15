import type { CinematicNodeSample } from 'engine-cinematic';

import { componentInputs } from './componentInterface';
import {
	SM_ANY_STATE,
	SM_CONDITION_OPS,
	SM_EXIT_STATE,
	type ComponentDef,
	type ComponentInput,
	type ComponentInputKind,
	type ComponentStateMachine,
	type SmCondition,
	type SmLayer,
	type SmState,
	type SmTransition,
} from './types';

/**
 * The COMPONENT STATE MACHINE interpreter (Rive plan §5, Phase 5). Pure and Pixi-free: it is
 * advanced by `dt` and by input changes, and it only SAYS what each layer plays — "timeline X at
 * t, mixing in from timeline Y frozen at u" — so the one module runs in game (per placed
 * instance, `ComponentInstance.svelte` feeding `ComponentTimelinePlayer`) and in the editor's stage
 * preview. Semantics, also recorded in the plan:
 *
 * - **Triggers last one evaluation, unless a transition is only waiting on its exit time.** A
 *   trigger fired between ticks is seen by every layer on the next `advance` and used by at most
 *   one transition per layer (a chain in the same tick cannot re-use it); the transition that
 *   takes it consumes it for that layer; what no transition took is cleared at the end of the
 *   advance (as Rive does). The one exception is the "finish the loop, then play win" idiom: a
 *   layer HOLDS a trigger while a transition leaving its current state (or `any`) reads it and
 *   is blocked by its `exitTime` ALONE — every other condition already holds and the state is
 *   still playing — for THAT transition only (no other transition may take a held trigger), and
 *   drops every held trigger the moment the layer changes state, so a hold never outlasts the
 *   rest of one loop and a stale trigger never fires later. A trigger fired in the same advance
 *   as a state change is held for the new state's exit-time transition, if one reads it.
 * - **`any`-state transitions are checked first**, in authored order, then the current state's.
 *   The first whose conditions all hold (and whose `exitTime` has been reached) fires. An `any`
 *   transition never re-enters the state the layer is already in.
 * - **`exitTime` gates a transition**: a fraction of the leaving state's timeline the playhead must
 *   have reached — or, on a looping state, crossed during this tick.
 * - **Layers run in order**; the player lets a later layer win a node property both key.
 * - **A blend** mixes the target timeline in from the pose being left (the previous timeline
 *   frozen at the moment of leaving) over `blend` ms — {@link blendNodeSamples}.
 * - **No transition loops within one tick**: at most {@link SM_MAX_TRANSITIONS_PER_TICK} fire per
 *   layer per tick; a chain beyond that continues next tick.
 * - A transition taken mid-blend leaves from the pose on screen: the player freezes the half-mixed
 *   pose and mixes the next timeline in from it.
 * - **The cues a leaving state crossed on the tick it was left still fire** (`LayerPlay.left`):
 *   a one-shot's cue at its very end is not lost to the "back to idle" transition on that frame.
 * - **A state with `speed` ≤ 0, or a timeline of duration 0, is at rest**: it shows its pose and
 *   needs no tick (the normalizer refuses such a speed; validation flags it).
 * - **The machine starts when its instance first becomes visible** (as 4b's `enter` fires): the
 *   entry state is entered then, its cues at 0 fire then, and from then on the clock runs whether
 *   or not the instance is shown, like a `playOn` timeline's. The editor's preview, always
 *   visible, shows the entry pose at once.
 * - **`exit` ends the layer**: it drives nothing and takes no transition until {@link reset}.
 * - **A missing timeline never throws**: the state is entered and holds (drives nothing; its exit
 *   gate is open); the ids are listed in {@link ComponentStateMachineRunner.missingTimelines} for
 *   the host to warn once.
 */

export const SM_MAX_TRANSITIONS_PER_TICK = 8;

/** A stretch of a timeline a layer played before leaving it on this step. */
export interface LeftSegment {
	timeline: string;
	prevTime: number;
	time: number;
	wrapped: boolean;
	/** The state was entered on this same step: its cues at 0 count too. */
	entered: boolean;
}

/** What one layer plays after a step. */
export interface LayerPlay {
	layer: string;
	/** The current state id, or `exit`. */
	state: string;
	/** The timeline it plays; absent in `exit` or when the state's timeline is missing. */
	timeline?: string;
	/** Seconds into that timeline. */
	time: number;
	/** The playhead before this step, and whether a loop wrapped between the two — the cues a
	 *  player fires are the ones between them. */
	prevTime: number;
	wrapped: boolean;
	/** True on the step the state was entered (and before the first step): the player (re)starts
	 *  the layer's playback from 0 and fires the cues at 0. */
	entered: boolean;
	/** Mixing in from the pose left behind: its timeline (absent = the authored pose) frozen at
	 *  `time`, `progress` 0..1 through the blend. */
	from?: { timeline?: string; time: number; progress: number };
	/** What the layer played on this step before each transition it took, in order — the player
	 *  fires those cues before restarting on the new state. */
	left?: LeftSegment[];
}

export interface FiredTransition {
	layer: string;
	transition: string;
	from: string;
	to: string;
}

export interface StateMachineStep {
	/** The transitions that fired this step, in order. */
	fired: FiredTransition[];
}

interface LayerRun {
	def: SmLayer;
	state: string;
	stateDef: SmState | undefined;
	/** Seconds into the state's timeline. */
	time: number;
	/** Of the state's timeline; `undefined` when the state has none the host knows. */
	duration: number | undefined;
	/** The playhead before this tick's advance, and whether a loop wrapped — the exit-time gate. */
	prevTime: number;
	wrapped: boolean;
	entered: boolean;
	blend?: { timeline?: string; time: number; elapsed: number; total: number };
	/** Triggers fired since the last advance, for this layer. */
	fresh: Set<string>;
	/** Triggers kept from an earlier advance, each for the transition ids waiting only on their
	 *  exit time to take it — no other transition may. */
	held: Map<string, Set<string>>;
	left: LeftSegment[];
}

const asNumber = (v: unknown, fallback: number): number =>
	typeof v === 'number' && Number.isFinite(v) ? v : fallback;

export class ComponentStateMachineRunner {
	private readonly layers: LayerRun[];
	private readonly durations: ReadonlyMap<string, number>;
	private readonly kinds = new Map<string, ComponentInputKind>();
	private readonly current = new Map<string, number | boolean>();
	private dirty = true;
	private readonly param: ((key: string) => unknown) | undefined;
	private readonly random: () => number;
	/** Timeline ids some state names that the host could not resolve, each once. */
	readonly missingTimelines: string[];

	/**
	 * @param durations the seconds of every timeline the host resolved, by cinematic id; a state
	 *   naming an id not here holds.
	 * @param param the placed instance's param by key — what a condition with `param` compares
	 *   against, and a state's `offsetParam` reads. Absent ⇒ every such condition fails and every
	 *   offset is 0.
	 * @param random a state's `randomStart` source, 0..1 (injectable for the gates).
	 */
	constructor(
		machine: ComponentStateMachine,
		inputs: readonly ComponentInput[],
		durations: ReadonlyMap<string, number>,
		param?: (key: string) => unknown,
		random: () => number = Math.random,
	) {
		this.durations = durations;
		this.param = param;
		this.random = random;
		for (const input of inputs) {
			if (!input.id || this.kinds.has(input.id)) continue;
			this.kinds.set(input.id, input.kind);
			if (input.kind === 'bool') this.current.set(input.id, input.default === true);
			else if (input.kind === 'number') this.current.set(input.id, asNumber(input.default, 0));
		}
		const missing = new Set<string>();
		for (const layer of machine.layers ?? []) {
			for (const state of layer.states ?? []) {
				if (state.timeline && !durations.has(state.timeline)) missing.add(state.timeline);
			}
		}
		this.missingTimelines = [...missing];
		this.layers = (machine.layers ?? []).map((def) => this.enterLayer(def));
	}

	/** Where a state's timeline starts when it is entered: its `offsetParam` plus, with
	 *  `randomStart`, a random point of it — wrapped on a looping state, clamped otherwise. */
	private startTime(state: SmState | undefined, duration: number | undefined): number {
		if (!state || duration === undefined || !(duration > 0)) return 0;
		let at = 0;
		if (state.offsetParam) at = asNumber(this.param?.(state.offsetParam), 0);
		if (state.randomStart) at += this.random() * duration;
		if (state.loop) return ((at % duration) + duration) % duration;
		return Math.min(Math.max(at, 0), duration);
	}

	private enterLayer(def: SmLayer): LayerRun {
		const stateDef = (def.states ?? []).find((s) => s.id === def.entry);
		const duration = stateDef ? this.durations.get(stateDef.timeline) : undefined;
		const time = this.startTime(stateDef, duration);
		return {
			def,
			state: stateDef ? def.entry : SM_EXIT_STATE,
			stateDef,
			time,
			duration,
			prevTime: time,
			wrapped: false,
			entered: true,
			fresh: new Set(),
			held: new Map(),
			left: [],
		};
	}

	/** Back to every layer's entry state, inputs kept, pending triggers dropped. */
	reset(): void {
		for (let i = 0; i < this.layers.length; i++)
			this.layers[i] = this.enterLayer(this.layers[i].def);
		this.dirty = true;
	}

	/** A bool or number input's current value. */
	input(id: string): number | boolean | undefined {
		return this.current.get(id);
	}

	/** Set a bool or number input. True when the value changed; an unknown id or kind is ignored. */
	setInput(id: string, value: number | boolean): boolean {
		const kind = this.kinds.get(id);
		if (kind === 'bool') value = value === true || value === 1;
		else if (kind === 'number') value = asNumber(value, 0);
		else return false;
		if (this.current.get(id) === value) return false;
		this.current.set(id, value);
		this.dirty = true;
		return true;
	}

	/** Fire a trigger input; seen by every layer on the next {@link advance}. */
	fire(id: string): boolean {
		if (this.kinds.get(id) !== 'trigger') return false;
		for (const layer of this.layers) if (layer.state !== SM_EXIT_STATE) layer.fresh.add(id);
		this.dirty = true;
		return true;
	}

	private layerPlaying(layer: LayerRun): boolean {
		if (layer.blend) return true;
		if (!layer.stateDef || layer.duration === undefined) return false;
		if (!(asNumber(layer.stateDef.speed, 1) > 0) || layer.duration <= 0) return false;
		return !!layer.stateDef.loop || layer.time < layer.duration;
	}

	/** Is any layer's timeline still moving, or a blend still mixing? */
	isPlaying(): boolean {
		return this.layers.some((layer) => this.layerPlaying(layer));
	}

	/** Should the host advance this tick: something plays, or an input changed since the last one.
	 *  (A held trigger needs no tick of its own: it waits on a playing state.) */
	needsTick(): boolean {
		return this.dirty || this.isPlaying();
	}

	advance(dtSeconds: number): StateMachineStep {
		const step: StateMachineStep = { fired: [] };
		const dt = asNumber(dtSeconds, 0) > 0 ? dtSeconds : 0;
		for (const layer of this.layers) {
			if (layer.state === SM_EXIT_STATE) {
				// The stretch it left was reported with the step that exited it; not again.
				layer.left = [];
				continue;
			}
			this.advanceLayer(layer, dt);
			const used = new Set<string>();
			let n = 0;
			for (; n < SM_MAX_TRANSITIONS_PER_TICK; n++) {
				const transition = this.pickTransition(layer, used);
				if (!transition) break;
				for (const c of transition.conditions ?? []) {
					if (c.op !== 'fired') continue;
					used.add(c.input);
					layer.fresh.delete(c.input);
				}
				step.fired.push({
					layer: layer.def.id,
					transition: transition.id,
					from: layer.state,
					to: transition.to,
				});
				this.enterState(layer, transition);
				if (layer.state === SM_EXIT_STATE) break;
			}
			// The cap stopped a longer chain: it continues next tick.
			if (n === SM_MAX_TRANSITIONS_PER_TICK) this.dirty = true;
			this.settleTriggers(layer, used);
		}
		this.dirty = false;
		return step;
	}

	/** Is the trigger `id` available to transition `transitionId` right now: fired since the last
	 *  advance, or held for that very transition? */
	private pending(layer: LayerRun, id: string, transitionId: string): boolean {
		return layer.fresh.has(id) || !!layer.held.get(id)?.has(transitionId);
	}

	/**
	 * End of a layer's step: a trigger stays only while a transition leaving the current state (or
	 * `any`) reads it and is blocked by its exit time ALONE — the state still plays, its other
	 * conditions hold, its other triggers are present — and was not taken this step; every other
	 * trigger is cleared.
	 */
	private settleTriggers(layer: LayerRun, used: ReadonlySet<string>): void {
		const fresh = new Set(layer.fresh);
		const held = layer.held;
		layer.fresh = new Set();
		layer.held = new Map();
		if ((!fresh.size && !held.size) || layer.state === SM_EXIT_STATE) return;
		if (!this.layerPlaying(layer)) return;
		for (const t of layer.def.transitions ?? []) {
			const leaves = t.from === layer.state || (t.from === SM_ANY_STATE && t.to !== layer.state);
			if (!leaves || t.exitTime === undefined || this.exitReached(layer, t.exitTime)) continue;
			const conditions = t.conditions ?? [];
			const triggers = conditions.filter((c) => c.op === 'fired').map((c) => c.input);
			if (!triggers.length) continue;
			const present = (id: string): boolean => fresh.has(id) || !!held.get(id)?.has(t.id);
			const waitingOnExitOnly = conditions.every((c) =>
				c.op === 'fired'
					? this.kinds.get(c.input) === 'trigger' && present(c.input) && !used.has(c.input)
					: this.holds(layer, c, used, t.id),
			);
			if (!waitingOnExitOnly) continue;
			for (const id of triggers) {
				const forTransitions = layer.held.get(id) ?? new Set<string>();
				forTransitions.add(t.id);
				layer.held.set(id, forTransitions);
			}
		}
	}

	private advanceLayer(layer: LayerRun, dt: number): void {
		layer.prevTime = layer.time;
		layer.wrapped = false;
		layer.entered = false;
		layer.left = [];
		if (layer.blend) {
			layer.blend.elapsed += dt * 1000;
			if (layer.blend.elapsed >= layer.blend.total) layer.blend = undefined;
		}
		const { stateDef, duration } = layer;
		if (!stateDef || duration === undefined) return;
		const speed = asNumber(stateDef.speed, 1);
		if (!(speed > 0)) return;
		const next = layer.time + dt * speed;
		if (stateDef.loop && duration > 0) {
			layer.wrapped = next >= duration || next < 0;
			layer.time = ((next % duration) + duration) % duration;
		} else {
			// Frame deltas accumulate float error; snap so an `exitTime` of 1 is reached on the frame
			// the playhead lands on the end, not the one after.
			layer.time = duration - next < 1e-6 ? duration : Math.min(Math.max(next, 0), duration);
		}
	}

	/** Has the leaving state's playhead reached (or, looping, crossed this tick) `exitTime`? */
	private exitReached(layer: LayerRun, exitTime: number | undefined): boolean {
		if (exitTime === undefined) return true;
		const { stateDef, duration } = layer;
		if (!stateDef || duration === undefined || duration <= 0) return true;
		const point = Math.min(Math.max(asNumber(exitTime, 0), 0), 1) * duration;
		if (point <= 0) return true;
		if (!stateDef.loop) return layer.time >= point;
		if (layer.wrapped) return point > layer.prevTime || point <= layer.time;
		return point > layer.prevTime && point <= layer.time;
	}

	private holds(
		layer: LayerRun,
		condition: SmCondition,
		used: ReadonlySet<string>,
		transitionId: string,
	): boolean {
		const kind = this.kinds.get(condition.input);
		if (!kind) return false;
		if (condition.op === 'fired') {
			return (
				kind === 'trigger' &&
				this.pending(layer, condition.input, transitionId) &&
				!used.has(condition.input)
			);
		}
		// A text input is never a condition (plan §8): it holds a localization key, not state.
		if (kind === 'trigger' || kind === 'text') return false;
		const value = this.current.get(condition.input);
		if (kind === 'bool') {
			const expected = condition.value === undefined ? true : condition.value === true;
			if (condition.op === '==') return value === expected;
			if (condition.op === '!=') return value !== expected;
			return false;
		}
		let expected = asNumber(condition.value, 0);
		if (condition.param !== undefined) {
			const fromParam = this.param?.(condition.param);
			if (typeof fromParam !== 'number' || !Number.isFinite(fromParam)) return false;
			expected = fromParam;
		}
		const actual = asNumber(value, 0);
		switch (condition.op) {
			case '==':
				return actual === expected;
			case '!=':
				return actual !== expected;
			case '<':
				return actual < expected;
			case '>':
				return actual > expected;
			case '<=':
				return actual <= expected;
			case '>=':
				return actual >= expected;
			default:
				return false;
		}
	}

	private fires(layer: LayerRun, transition: SmTransition, used: ReadonlySet<string>): boolean {
		if (!this.exitReached(layer, transition.exitTime)) return false;
		return (transition.conditions ?? []).every((c) => this.holds(layer, c, used, transition.id));
	}

	/** `used`: the triggers this layer's transitions already took this tick. */
	private pickTransition(layer: LayerRun, used: ReadonlySet<string>): SmTransition | undefined {
		const transitions = layer.def.transitions ?? [];
		for (const t of transitions) {
			if (t.from !== SM_ANY_STATE || t.to === layer.state) continue;
			if (this.fires(layer, t, used)) return t;
		}
		for (const t of transitions) {
			if (t.from !== layer.state) continue;
			if (this.fires(layer, t, used)) return t;
		}
		return undefined;
	}

	private enterState(layer: LayerRun, transition: SmTransition): void {
		const left =
			layer.stateDef && layer.duration !== undefined
				? { timeline: layer.stateDef.timeline, time: layer.time }
				: { time: 0 };
		// A state change drops what was held: a trigger waited for a transition out of the old state.
		layer.held = new Map();
		if (left.timeline) {
			layer.left.push({
				timeline: left.timeline,
				prevTime: layer.prevTime,
				time: layer.time,
				wrapped: layer.wrapped,
				entered: layer.entered,
			});
		}
		if (transition.to === SM_EXIT_STATE) {
			layer.state = SM_EXIT_STATE;
			layer.stateDef = undefined;
			layer.duration = undefined;
			layer.blend = undefined;
			layer.time = 0;
			layer.prevTime = 0;
			layer.wrapped = false;
			layer.entered = false;
			return;
		}
		const stateDef = (layer.def.states ?? []).find((s) => s.id === transition.to);
		layer.state = transition.to;
		layer.stateDef = stateDef;
		layer.duration = stateDef ? this.durations.get(stateDef.timeline) : undefined;
		layer.time = this.startTime(stateDef, layer.duration);
		layer.prevTime = layer.time;
		layer.wrapped = false;
		layer.entered = true;
		const blend = asNumber(transition.blend, 0);
		layer.blend = blend > 0 ? { ...left, elapsed: 0, total: blend } : undefined;
	}

	/** What every layer plays now, in layer order. */
	plays(): LayerPlay[] {
		return this.layers.map((layer) => {
			const play: LayerPlay = {
				layer: layer.def.id,
				state: layer.state,
				time: layer.time,
				prevTime: layer.prevTime,
				wrapped: layer.wrapped,
				entered: layer.entered,
			};
			if (layer.stateDef && layer.duration !== undefined) play.timeline = layer.stateDef.timeline;
			if (layer.blend) {
				play.from = {
					time: layer.blend.time,
					progress: Math.min(layer.blend.elapsed / layer.blend.total, 1),
				};
				if (layer.blend.timeline) play.from.timeline = layer.blend.timeline;
			}
			if (layer.left.length) play.left = layer.left.map((seg) => ({ ...seg }));
			return play;
		});
	}

	/** The current state of `layerId`, or `undefined` for an unknown layer. */
	stateOf(layerId: string): string | undefined {
		return this.layers.find((l) => l.def.id === layerId)?.state;
	}

	/** The values the component reports (plan §6.1): `<layer>.state` → the current state id. */
	values(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const layer of this.layers) out[`${layer.def.id}.state`] = layer.state;
		return out;
	}
}

// ---- blending -----------------------------------------------------------------------------------

const LERP_IDENTITY: Record<string, number> = {
	x: 0,
	y: 0,
	rotation: 0,
	scaleX: 1,
	scaleY: 1,
	alpha: 1,
	fill: 1,
};

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpTint = (a: number, b: number, t: number): number => {
	const ch = (shift: number): number =>
		Math.round(lerp((a >> shift) & 0xff, (b >> shift) & 0xff, t)) << shift;
	return ch(16) | ch(8) | ch(0);
};

/**
 * The pose `progress` (0..1) of the way from `from` to `to`, channel by channel: `x`/`y`/
 * `rotation`/`scaleX`/`scaleY`/`alpha`/`fill` interpolate (a side that lacks the channel counts as
 * the authored pose: 0 for an offset, 1 for a factor); `tint` eases per colour channel when both
 * sides have it; `frame`, `visible` and `text` step over at the half-way point. Only channels some
 * side keys are present, so the player's fold applies exactly what the timelines key.
 */
export function blendNodeSamples(
	from: CinematicNodeSample | undefined,
	to: CinematicNodeSample | undefined,
	progress: number,
): CinematicNodeSample {
	const t = Math.min(Math.max(asNumber(progress, 1), 0), 1);
	const a = (from ?? {}) as Record<string, unknown>;
	const b = (to ?? {}) as Record<string, unknown>;
	const out: Record<string, unknown> = {};
	for (const channel of Object.keys(LERP_IDENTITY)) {
		if (a[channel] === undefined && b[channel] === undefined) continue;
		const identity = LERP_IDENTITY[channel];
		out[channel] = lerp(asNumber(a[channel], identity), asNumber(b[channel], identity), t);
	}
	if (typeof a.tint === 'number' && typeof b.tint === 'number')
		out.tint = lerpTint(a.tint, b.tint, t);
	else if (a.tint !== undefined || b.tint !== undefined) out.tint = t < 0.5 ? a.tint : b.tint;
	for (const channel of ['frame', 'visible', 'text'] as const) {
		const stepped = t < 0.5 ? a[channel] : b[channel];
		if (stepped !== undefined) out[channel] = stepped;
	}
	return out as CinematicNodeSample;
}

// ---- validation ---------------------------------------------------------------------------------

export type StateMachineIssueCode =
	| 'input-duplicate'
	| 'input-kind-unknown'
	| 'layer-duplicate'
	| 'layer-no-entry'
	| 'layer-entry-unknown'
	| 'state-duplicate'
	| 'state-reserved-id'
	| 'state-no-timeline'
	| 'state-speed-invalid'
	| 'state-timeline-missing'
	| 'transition-from-unknown'
	| 'transition-to-unknown'
	| 'condition-input-unknown'
	| 'condition-input-text'
	| 'condition-op-mismatch'
	| 'condition-value-missing'
	| 'exit-time-out-of-range'
	| 'state-unreachable';

export interface StateMachineIssue {
	code: StateMachineIssueCode;
	/** `error` blocks nothing at runtime (the interpreter holds instead) but should be fixed;
	 *  `warning` is advisory. */
	level: 'error' | 'warning';
	message: string;
	layer?: string;
	state?: string;
	transition?: string;
	input?: string;
}

const OP_FOR_KIND: Record<ComponentInputKind, readonly SmCondition['op'][]> = {
	trigger: ['fired'],
	bool: ['==', '!='],
	number: ['==', '!=', '<', '>', '<=', '>='],
	// A text input carries a localization key (plan §8); the machine never conditions on text.
	text: [],
};

/**
 * Everything the editor shows and the gate asserts about a def's state machine: a layer with no
 * (or an unknown) entry, a state naming a missing timeline (`timelineIds` is what the project
 * has), a transition to or from an unknown state, a condition on an unknown input or with an op its
 * kind cannot take, and — as warnings — an exit time outside 0..1 and a state (or `exit`, when
 * some transition targets it) that no path from the entry reaches.
 */
export function validateStateMachine(
	def: Pick<ComponentDef, 'inputs' | 'signals' | 'stateMachine'>,
	timelineIds: Iterable<string>,
): StateMachineIssue[] {
	const issues: StateMachineIssue[] = [];
	const timelines = new Set(timelineIds);
	const kinds = new Map<string, ComponentInputKind>();
	const seenInputs = new Set<string>();
	for (const input of def.inputs ?? []) {
		if (seenInputs.has(input.id)) {
			issues.push({
				code: 'input-duplicate',
				level: 'error',
				input: input.id,
				message: `Input "${input.id}" is declared twice.`,
			});
		}
		seenInputs.add(input.id);
	}
	for (const input of componentInputs(def)) {
		if (!OP_FOR_KIND[input.kind]) {
			issues.push({
				code: 'input-kind-unknown',
				level: 'error',
				input: input.id,
				message: `Input "${input.id}" has an unknown kind "${String(input.kind)}".`,
			});
			continue;
		}
		kinds.set(input.id, input.kind);
	}
	const layerIds = new Set<string>();
	for (const layer of def.stateMachine?.layers ?? []) {
		const name = layer.name || layer.id;
		if (layerIds.has(layer.id)) {
			issues.push({
				code: 'layer-duplicate',
				level: 'error',
				layer: layer.id,
				message: `Layer id "${layer.id}" is used twice.`,
			});
		}
		layerIds.add(layer.id);
		const stateIds = new Set<string>();
		for (const state of layer.states ?? []) {
			if (state.id === SM_ANY_STATE || state.id === SM_EXIT_STATE) {
				issues.push({
					code: 'state-reserved-id',
					level: 'error',
					layer: layer.id,
					state: state.id,
					message: `Layer "${name}": "${state.id}" is a reserved state id.`,
				});
			}
			if (stateIds.has(state.id)) {
				issues.push({
					code: 'state-duplicate',
					level: 'error',
					layer: layer.id,
					state: state.id,
					message: `Layer "${name}": state "${state.id}" is declared twice.`,
				});
			}
			stateIds.add(state.id);
			if (state.speed !== undefined && !(state.speed > 0 && Number.isFinite(state.speed))) {
				issues.push({
					code: 'state-speed-invalid',
					level: 'error',
					layer: layer.id,
					state: state.id,
					message: `Layer "${name}": state "${state.name || state.id}" has speed ${String(state.speed)}; it must be above 0.`,
				});
			}
			if (!state.timeline) {
				issues.push({
					code: 'state-no-timeline',
					level: 'error',
					layer: layer.id,
					state: state.id,
					message: `Layer "${name}": state "${state.name || state.id}" plays no timeline.`,
				});
			} else if (!timelines.has(state.timeline)) {
				issues.push({
					code: 'state-timeline-missing',
					level: 'error',
					layer: layer.id,
					state: state.id,
					message: `Layer "${name}": state "${state.name || state.id}" plays timeline "${state.timeline}", which this component does not have. In game the state holds.`,
				});
			}
		}
		if (!layer.entry) {
			issues.push({
				code: 'layer-no-entry',
				level: 'error',
				layer: layer.id,
				message: `Layer "${name}" has no entry state.`,
			});
		} else if (!stateIds.has(layer.entry)) {
			issues.push({
				code: 'layer-entry-unknown',
				level: 'error',
				layer: layer.id,
				message: `Layer "${name}": its entry state "${layer.entry}" does not exist.`,
			});
		}
		const known = (id: string, exit: boolean): boolean =>
			stateIds.has(id) || (exit ? id === SM_EXIT_STATE : id === SM_ANY_STATE);
		for (const transition of layer.transitions ?? []) {
			if (!known(transition.from, false)) {
				issues.push({
					code: 'transition-from-unknown',
					level: 'error',
					layer: layer.id,
					transition: transition.id,
					message: `Layer "${name}": a transition leaves from "${transition.from}", which does not exist.`,
				});
			}
			if (!known(transition.to, true)) {
				issues.push({
					code: 'transition-to-unknown',
					level: 'error',
					layer: layer.id,
					transition: transition.id,
					message: `Layer "${name}": a transition goes to "${transition.to}", which does not exist.`,
				});
			}
			if (
				transition.exitTime !== undefined &&
				!(transition.exitTime >= 0 && transition.exitTime <= 1)
			) {
				issues.push({
					code: 'exit-time-out-of-range',
					level: 'warning',
					layer: layer.id,
					transition: transition.id,
					message: `Layer "${name}": exit time ${String(transition.exitTime)} is outside 0..1 and is clamped.`,
				});
			}
			for (const condition of transition.conditions ?? []) {
				const kind = kinds.get(condition.input);
				if (!kind) {
					issues.push({
						code: 'condition-input-unknown',
						level: 'error',
						layer: layer.id,
						transition: transition.id,
						input: condition.input,
						message: `Layer "${name}": a condition reads input "${condition.input}", which is not declared.`,
					});
					continue;
				}
				if (kind === 'text') {
					issues.push({
						code: 'condition-input-text',
						level: 'error',
						layer: layer.id,
						transition: transition.id,
						input: condition.input,
						message: `Layer "${name}": a condition reads the text input "${condition.input}"; the state machine never conditions on text (a text input carries a localization key).`,
					});
					continue;
				}
				if (
					kind === 'number' &&
					condition.op !== 'fired' &&
					condition.value === undefined &&
					!condition.param
				) {
					issues.push({
						code: 'condition-value-missing',
						level: 'error',
						layer: layer.id,
						transition: transition.id,
						input: condition.input,
						message: `Layer "${name}": the condition on the number input "${condition.input}" has no value to compare with.`,
					});
				}
				if (!OP_FOR_KIND[kind].includes(condition.op)) {
					issues.push({
						code: 'condition-op-mismatch',
						level: 'error',
						layer: layer.id,
						transition: transition.id,
						input: condition.input,
						message: `Layer "${name}": "${condition.op}" cannot be used on the ${kind} input "${condition.input}" (${SM_CONDITION_OPS.filter((op) => OP_FOR_KIND[kind].includes(op)).join(' ')}).`,
					});
				}
			}
		}
		// Reachability from the entry, with `any` transitions reaching their target once anything is.
		if (layer.entry && stateIds.has(layer.entry)) {
			const reached = new Set<string>([layer.entry]);
			const queue = [layer.entry];
			const anyTargets = (layer.transitions ?? [])
				.filter((t) => t.from === SM_ANY_STATE)
				.map((t) => t.to);
			for (const to of anyTargets) {
				if (reached.has(to)) continue;
				reached.add(to);
				queue.push(to);
			}
			while (queue.length) {
				const from = queue.shift()!;
				for (const t of layer.transitions ?? []) {
					if (t.from !== from || reached.has(t.to)) continue;
					reached.add(t.to);
					queue.push(t.to);
				}
			}
			const exitTargeted = (layer.transitions ?? []).some((t) => t.to === SM_EXIT_STATE);
			for (const id of [...stateIds, ...(exitTargeted ? [SM_EXIT_STATE] : [])]) {
				if (reached.has(id)) continue;
				issues.push({
					code: 'state-unreachable',
					level: 'warning',
					layer: layer.id,
					state: id,
					message: `Layer "${name}": no transition path from the entry reaches "${id}".`,
				});
			}
		}
	}
	return issues;
}
