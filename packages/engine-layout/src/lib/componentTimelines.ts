import {
	cuesCrossed,
	sampleNodeActor,
	type CinematicNodeSample,
	type CinematicTrack,
} from 'engine-cinematic';

import { keyedNodeChannels, resolveNodeActors, type NodeActorChannel } from './cinematicNodes';
import { BUILTIN_TIMELINES } from './builtinTimelines';
import { blendNodeSamples, type LayerPlay, type LeftSegment } from './stateMachine';
import type { CinematicDoc, ComponentStateMachine, LayoutNode } from './types';

/**
 * COMPONENT TIMELINES at runtime (Rive plan Phase 4, `docs/design/rive-style-editor.md` §3.3):
 * a timeline hosted on a component (`host: {kind:'component', componentId}`) plays on every placed
 * instance of that component, started by the instance signal it names (`playOn`). Svelte-free: the
 * registry and the per-instance player live here, `ComponentInstance.svelte` only wires the
 * instance's signals and the ticker to a player, and the gates drive a player directly.
 */

let byComponent = new Map<string, CinematicDoc[]>();
let byId = new Map<string, CinematicDoc>();

/**
 * Register the game's timelines (the baked cinematics). Every component-hosted one is kept by id
 * (a state machine names its timelines that way — Phase 5); those with a `playOn` are also indexed
 * by every component they play on: the host, plus `playOnComponents`. Replaces the previous
 * registration. Nothing registered ⇒ every instance plays nothing (parity).
 */
export function registerComponentTimelines(docs: readonly CinematicDoc[]): void {
	const next = new Map<string, CinematicDoc[]>();
	const nextById = new Map<string, CinematicDoc>();
	// One doc per id, the LAST registered winning: a project timeline shadows a built-in one of the
	// same id (`BUILTIN_TIMELINES` register first) instead of playing beside it. Baked ids are
	// storage keys, so a baked bundle never carries two docs of one id and loses nothing here.
	const winnerById = new Map<string, CinematicDoc>();
	for (const doc of docs) if (doc.host?.kind === 'component' && doc.id) winnerById.set(doc.id, doc);
	for (const doc of docs) {
		if (doc.host?.kind !== 'component') continue;
		if (doc.id) {
			if (winnerById.get(doc.id) !== doc) continue;
			nextById.set(doc.id, doc);
		}
		if (!doc.playOn) continue;
		const ids = new Set([doc.host.componentId, ...(doc.playOnComponents ?? [])]);
		for (const id of ids) {
			if (!id) continue;
			const list = next.get(id) ?? [];
			list.push(doc);
			next.set(id, list);
		}
	}
	byComponent = next;
	byId = nextById;
}

/**
 * What a game registers at boot: the engine's built-in timelines first (Rive plan Phase 8a), then
 * the timelines it GENERATED for this boot (Phase 8b: the authored win's per-tier docs, built from
 * the active tiers and the loaded skeleton once assets are in — the game calls this again then),
 * then the project's baked cinematics, so a project timeline shadows a built-in or generated id —
 * on a boot with no bundle and no baked doc the built-ins alone, so a built-in def the fallback doc
 * places still has its timeline. One call for both boot paths.
 */
export function registerGameTimelines(
	baked: readonly CinematicDoc[] | undefined,
	generated: readonly CinematicDoc[] = [],
): void {
	registerComponentTimelines([...BUILTIN_TIMELINES, ...generated, ...(baked ?? [])]);
}

/** The timelines an instance of `componentId` plays on a signal, in registration order. */
export function componentTimelinesFor(componentId: string): CinematicDoc[] {
	return byComponent.get(componentId) ?? [];
}

/**
 * Everything a placed instance's player binds: the component's `playOn` timelines, then the
 * timelines its state machine plays that are not already among them — with their `playOn`
 * stripped, since a state timeline reused from another component must not also play here as a
 * free timeline on that component's signal. `durations` is what the runner is handed.
 */
export function instanceTimelineDocs(
	componentId: string,
	machine: ComponentStateMachine | undefined,
): { docs: CinematicDoc[]; durations: Map<string, number> } {
	const docs = [...componentTimelinesFor(componentId)];
	const { docs: stateDocs, durations } = stateMachineTimelines(machine);
	for (const doc of stateDocs) {
		if (docs.some((d) => d.id === doc.id)) continue;
		docs.push(doc.playOn ? { ...doc, playOn: undefined } : doc);
	}
	return { docs, durations };
}

/**
 * The registered timelines a state machine's states play, each once, and their durations by id —
 * what a {@link ComponentTimelinePlayer} binds and a `ComponentStateMachineRunner` is handed. An
 * id nothing registered is simply absent (the runner lists it as missing and holds).
 */
export function stateMachineTimelines(machine: ComponentStateMachine | undefined): {
	docs: CinematicDoc[];
	durations: Map<string, number>;
} {
	const docs: CinematicDoc[] = [];
	const durations = new Map<string, number>();
	for (const layer of machine?.layers ?? []) {
		for (const state of layer.states ?? []) {
			if (!state.timeline || durations.has(state.timeline)) continue;
			const doc = byId.get(state.timeline);
			if (!doc) continue;
			docs.push(doc);
			durations.set(doc.id, Math.max(doc.duration || 0, 0));
		}
	}
	return { docs, durations };
}

interface Bound {
	doc: CinematicDoc;
	/** Node id → that node's tracks in this timeline. */
	actors: Map<string, CinematicTrack[]>;
	/** Node id → the channels this timeline keys on it. */
	channels: Map<string, Set<NodeActorChannel>>;
	cueKeys: { time: number; cue: string }[];
}

interface Running {
	bound: Bound;
	time: number;
	done: boolean;
	/** Start order: the most recently started timeline wins a node two of them drive. */
	order: number;
	/** Set on a state-machine layer's playback (`drive`): its playhead is placed, never advanced. */
	layer?: number;
	/** The pose a layer is still mixing in from (`blendNodeSamples`). */
	from?: Mix;
}

/**
 * The pose being mixed FROM — a flat snapshot of every driven node's on-screen values at the
 * moment the layer left it (a blend interrupted by another transition leaves from the mix that
 * was on screen; nothing nests) — and how far (0..1) the new timeline has mixed in over it.
 */
interface Mix {
	snapshot: Map<string, CinematicNodeSample>;
	progress: number;
}

const EPSILON = 1e-9;

/** A zero-length timeline never "ends" in a step the player can report; it holds nothing. */
const isZeroLength = (doc: CinematicDoc): boolean => !(Math.max(doc.duration || 0, 0) > 0);

/** What one {@link ComponentTimelinePlayer.advance} step crossed. */
export interface TimelineStep {
	/** Cues the playheads crossed, in order, each with the id of the timeline that crossed it. */
	cues: { cue: string; timeline: string }[];
	/** Ids of the timelines that reached their end on this step. */
	completed: string[];
}

/**
 * One placed instance's timeline playback. Each instance owns its own player, so two placements
 * of one component play independently: a signal heard by one never moves the other's playhead.
 *
 * - `trigger(signal)` (re)starts every timeline whose `playOn` is `signal`, from 0.
 * - `advance(dt)` moves every running playhead; a timeline that reaches its end HOLDS its last
 *   frame, so a "pop in" stays popped in.
 * - `sample(nodeId)` is the node's channels from the most recently started timeline driving it, or
 *   `undefined` before any has started (the node renders as authored).
 *
 * A STATE MACHINE (Phase 5) plays through the same player: each layer owns a slot that `drive`
 * places on a timeline at a time (the interpreter's `LayerPlay`) or empties (an exited layer, a
 * missing timeline). The
 * player then samples a node like this: a `playOn` timeline that is still PLAYING and started
 * after every layer driving the node wins it (a pop-in started after the machine's idle shows);
 * once it ends, or the machine changes state, the layers take the node back (a pop-in then idle
 * needs no transition). When the layers win, every layer driving the node applies in layer order,
 * a later layer winning each property both key, each mixed in from the pose it left while its
 * blend runs. A node no layer drives keeps 4b's rule: the most recently started `playOn` timeline
 * holds it, finished or not.
 */
export class ComponentTimelinePlayer {
	private readonly bound: Bound[];
	private readonly boundById = new Map<string, Bound>();
	private readonly running = new Map<string, Running>();
	private readonly driven = new Map<string, Running>();
	private started = 0;
	/**
	 * The speed every running `playOn` timeline advances at (Rive plan Phase 8b): `advance(dt)`
	 * moves the playheads by `dt × playRate`. The authored twin of the rig `timeScale` ramp the coded
	 * big-win walk applied while the player held to speed up; the owning instance sets it from the
	 * game's `componentPlayRate` each tick. 1 ⇒ exactly the step handed in (parity).
	 */
	playRate = 1;

	constructor(docs: readonly CinematicDoc[], nodes: LayoutNode[]) {
		const scene = { id: '', name: '', nodes };
		this.bound = docs.map((doc) => {
			const actors = new Map<string, CinematicTrack[]>();
			const channels = new Map<string, Set<NodeActorChannel>>();
			for (const [nodeId, actor] of resolveNodeActors(doc, scene)) {
				actors.set(nodeId, actor.tracks as unknown as CinematicTrack[]);
				channels.set(nodeId, keyedNodeChannels(actor.tracks));
			}
			const cue = doc.tracks.find((t) => t.kind === 'cue') as
				{ keys?: { time: number; cue: string }[] } | undefined;
			return { doc, actors, channels, cueKeys: cue?.keys ?? [] };
		});
		for (const b of this.bound) this.boundById.set(b.doc.id, b);
	}

	/** The signals that start at least one of this instance's timelines. */
	signals(): string[] {
		return [...new Set(this.bound.map((b) => b.doc.playOn).filter((s): s is string => !!s))];
	}

	/**
	 * The timelines `signal` starts that HOLD the cue (`holdsCue`, Rive plan Phase 8a): an awaited
	 * fire of that signal waits for each to reach its end. A zero-length timeline never reports an
	 * end, so it is left out; a timeline without the field, or a state-machine one (no `playOn`),
	 * holds nothing.
	 */
	holdsOn(signal: string): string[] {
		return this.bound
			.filter((b) => b.doc.playOn === signal && b.doc.holdsCue === true && !isZeroLength(b.doc))
			.map((b) => b.doc.id);
	}

	/** Nodes some timeline drives, with the union of the channels they key — fixed for life. */
	drivenNodes(): Map<string, Set<NodeActorChannel>> {
		const out = new Map<string, Set<NodeActorChannel>>();
		for (const b of this.bound) {
			for (const [nodeId, keyed] of b.channels) {
				const set = out.get(nodeId) ?? new Set<NodeActorChannel>();
				for (const c of keyed) set.add(c);
				out.set(nodeId, set);
			}
		}
		return out;
	}

	/** The first text track a timeline keys on `nodeId` (the node's text drive is fixed at init). */
	textTrack(nodeId: string): CinematicTrack | undefined {
		for (const b of this.bound) {
			const track = b.actors
				.get(nodeId)
				?.filter((t) => t.kind === 'text')
				.pop();
			if (track) return track;
		}
		return undefined;
	}

	/**
	 * (Re)start every timeline that plays on `signal`. True when one did. `except` is the timeline
	 * whose own `signal:` cue fired it: a timeline never restarts itself from its own cue, which
	 * would loop it forever from that cue's time.
	 */
	trigger(signal: string, except?: string): boolean {
		let any = false;
		for (const b of this.bound) {
			if (b.doc.playOn !== signal || b.doc.id === except) continue;
			this.running.set(b.doc.id, { bound: b, time: 0, done: false, order: ++this.started });
			any = true;
		}
		return any;
	}

	/** Is any timeline still moving (not finished and not merely holding its last frame)? */
	isPlaying(): boolean {
		for (const r of this.running.values()) if (!r.done) return true;
		return false;
	}

	/** Seconds into `id`'s playback, or `undefined` when it has not started. */
	timeOf(id: string): number | undefined {
		return this.running.get(id)?.time;
	}

	advance(dtSeconds: number): TimelineStep {
		const step: TimelineStep = { cues: [], completed: [] };
		const dt = dtSeconds * this.playRate;
		if (!(dt > 0)) return step;
		for (const r of this.running.values()) {
			if (r.done) continue;
			const duration = Math.max(r.bound.doc.duration || 0, 0);
			const prev = r.time;
			// Frame deltas accumulate float error: 802 steps of 1/60 fall 1e-15 short of 13.3667, and
			// a strip that ends on the frame after would hold its awaited cue a frame late (the win
			// walk's tier boundary). Snap to the end once within a microsecond, as the state-machine
			// runner does.
			const stepped = prev + dt;
			const next = duration - stepped < 1e-6 ? duration : Math.min(stepped, duration);
			for (const k of cuesCrossed(r.bound.cueKeys, prev, next)) {
				step.cues.push({ cue: k.cue, timeline: r.bound.doc.id });
			}
			r.time = next;
			if (next >= duration) {
				r.done = true;
				step.completed.push(r.bound.doc.id);
			}
		}
		return step;
	}

	/**
	 * Place a state-machine layer's slot on what it plays now. Returns the cues crossed since the
	 * slot's last placement: entering a state crosses its cues from 0 (so a cue at 0 fires), a loop
	 * that wrapped crosses the end of the timeline and then the start. A timeline this player did
	 * not bind empties the slot (the state holds, as the interpreter said it would).
	 */
	drive(slot: string, layer: number, play: LayerPlay): { cue: string; timeline: string }[] {
		const cues: { cue: string; timeline: string }[] = [];
		// A slot never seeks, so every step is a real stretch of playback: no step-size guard.
		const crossed = (on: Bound, prev: number, next: number): void => {
			for (const k of cuesCrossed(on.cueKeys, prev, next, Infinity)) {
				cues.push({ cue: k.cue, timeline: on.doc.id });
			}
		};
		const segment = (on: Bound, seg: LeftSegment | LayerPlay): void => {
			if (seg.entered) crossed(on, -EPSILON, seg.time);
			else if (seg.wrapped) {
				crossed(on, seg.prevTime, Math.max(on.doc.duration || 0, 0));
				crossed(on, -EPSILON, seg.time);
			} else crossed(on, seg.prevTime, seg.time);
		};
		for (const left of play.left ?? []) {
			const on = this.boundById.get(left.timeline);
			if (on) segment(on, left);
		}
		const bound = play.timeline ? this.boundById.get(play.timeline) : undefined;
		if (!bound) {
			this.driven.delete(slot);
			return cues;
		}
		let r = this.driven.get(slot);
		if (!r || r.bound !== bound || play.entered) {
			const previous = r;
			r = { bound, time: play.time, done: true, order: ++this.started, layer };
			this.driven.set(slot, r);
			crossed(bound, -EPSILON, play.time);
			if (play.from) {
				// Leave from the pose that was on screen: every node the previous slot drove, sampled
				// as it was (its own blend included) and frozen flat, so interrupting a blend never
				// jumps and a chain of interruptions never nests.
				const snapshot = new Map<string, CinematicNodeSample>();
				if (previous) {
					const nodeIds = new Set([
						...previous.bound.actors.keys(),
						...(previous.from?.snapshot.keys() ?? []),
					]);
					for (const nodeId of nodeIds) {
						const sample = this.sampleOf(previous, nodeId);
						if (sample) snapshot.set(nodeId, sample);
					}
				}
				r.from = { snapshot, progress: 0 };
			}
		} else {
			segment(bound, play);
			r.time = play.time;
			r.layer = layer;
		}
		if (r.from && play.from) r.from.progress = play.from.progress;
		else if (!play.from) r.from = undefined;
		return cues;
	}

	/** What a state-machine slot plays, for the gates. */
	drivenSlot(slot: string): { timeline: string; time: number } | undefined {
		const r = this.driven.get(slot);
		return r ? { timeline: r.bound.doc.id, time: r.time } : undefined;
	}

	private sampleOf(r: Running, nodeId: string): CinematicNodeSample | undefined {
		const tracks = r.bound.actors.get(nodeId);
		const to = tracks ? sampleNodeActor(tracks, r.time) : undefined;
		if (!r.from) return to;
		return blendNodeSamples(r.from.snapshot.get(nodeId), to, r.from.progress);
	}

	sample(nodeId: string): CinematicNodeSample | undefined {
		let best: Running | undefined;
		for (const r of this.running.values()) {
			if (!r.bound.actors.has(nodeId)) continue;
			if (!best || r.order > best.order) best = r;
		}
		const layers: Running[] = [];
		for (const r of this.driven.values()) {
			if (r.bound.actors.has(nodeId) || r.from?.snapshot.has(nodeId)) layers.push(r);
		}
		if (!layers.length) return best ? this.sampleOf(best, nodeId) : undefined;
		const latest = Math.max(...layers.map((r) => r.order));
		if (best && !best.done && best.order > latest) return this.sampleOf(best, nodeId);
		layers.sort((a, b) => (a.layer ?? 0) - (b.layer ?? 0));
		const out: Record<string, unknown> = {};
		for (const r of layers) {
			const sample = this.sampleOf(r, nodeId) as Record<string, unknown> | undefined;
			for (const [channel, value] of Object.entries(sample ?? {})) {
				if (value !== undefined) out[channel] = value;
			}
		}
		return out as CinematicNodeSample;
	}
}
