import {
	cuesCrossed,
	sampleNodeActor,
	type CinematicNodeSample,
	type CinematicTrack,
} from 'engine-cinematic';

import { keyedNodeChannels, resolveNodeActors, type NodeActorChannel } from './cinematicNodes';
import type { CinematicDoc, LayoutNode } from './types';

/**
 * COMPONENT TIMELINES at runtime (Rive plan Phase 4, `docs/design/rive-style-editor.md` §3.3):
 * a timeline hosted on a component (`host: {kind:'component', componentId}`) plays on every placed
 * instance of that component, started by the instance signal it names (`playOn`). Svelte-free: the
 * registry and the per-instance player live here, `ComponentInstance.svelte` only wires the
 * instance's signals and the ticker to a player, and the gates drive a player directly.
 */

let byComponent = new Map<string, CinematicDoc[]>();

/**
 * Register the game's timelines (the baked cinematics). Only component-hosted ones with a
 * `playOn` are kept, indexed by every component they play on: the host, plus `playOnComponents`.
 * Replaces the previous registration. Nothing registered ⇒ every instance plays nothing (parity).
 */
export function registerComponentTimelines(docs: readonly CinematicDoc[]): void {
	const next = new Map<string, CinematicDoc[]>();
	for (const doc of docs) {
		if (doc.host?.kind !== 'component' || !doc.playOn) continue;
		const ids = new Set([doc.host.componentId, ...(doc.playOnComponents ?? [])]);
		for (const id of ids) {
			if (!id) continue;
			const list = next.get(id) ?? [];
			list.push(doc);
			next.set(id, list);
		}
	}
	byComponent = next;
}

/** The timelines an instance of `componentId` plays, in registration order. */
export function componentTimelinesFor(componentId: string): CinematicDoc[] {
	return byComponent.get(componentId) ?? [];
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
}

/** What one {@link ComponentTimelinePlayer.advance} step crossed. */
export interface TimelineStep {
	/** Cue strings (`signal:x`, `fx:y`, …) the playheads crossed, in order. */
	cues: string[];
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
 */
export class ComponentTimelinePlayer {
	private readonly bound: Bound[];
	private readonly running = new Map<string, Running>();
	private started = 0;

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
	}

	/** The signals that start at least one of this instance's timelines. */
	signals(): string[] {
		return [...new Set(this.bound.map((b) => b.doc.playOn).filter((s): s is string => !!s))];
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

	/** (Re)start every timeline that plays on `signal`. True when one did. */
	trigger(signal: string): boolean {
		let any = false;
		for (const b of this.bound) {
			if (b.doc.playOn !== signal) continue;
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
		if (!(dtSeconds > 0)) return step;
		for (const r of this.running.values()) {
			if (r.done) continue;
			const duration = Math.max(r.bound.doc.duration || 0, 0);
			const prev = r.time;
			const next = Math.min(prev + dtSeconds, duration);
			for (const k of cuesCrossed(r.bound.cueKeys, prev, next)) step.cues.push(k.cue);
			r.time = next;
			if (next >= duration) {
				r.done = true;
				step.completed.push(r.bound.doc.id);
			}
		}
		return step;
	}

	sample(nodeId: string): CinematicNodeSample | undefined {
		let best: Running | undefined;
		for (const r of this.running.values()) {
			if (!r.bound.actors.has(nodeId)) continue;
			if (!best || r.order > best.order) best = r;
		}
		if (!best) return undefined;
		return sampleNodeActor(best.bound.actors.get(nodeId)!, best.time);
	}
}
