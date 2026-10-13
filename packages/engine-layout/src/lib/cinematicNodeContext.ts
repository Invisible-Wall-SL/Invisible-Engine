import { getContext, setContext } from 'svelte';

import type { CinematicNodeSample, CinematicTrack } from 'engine-cinematic';

import type { NodeActorChannel } from './cinematicNodes';

/**
 * How a playing timeline reaches the nodes it drives (Rive plan §3.1): it provides a lookup by
 * node id, and each `<LayoutNodeView>` asks it once, at init, whether a node actor drives it.
 * Absent context (every scene not mounted by a node-actor timeline) ⇒ `undefined` ⇒ the node
 * renders exactly as before.
 *
 * A driver belongs to ONE component nest depth: a screen's `<Cinematic>` drives depth 0 (the
 * screen's own nodes), a placed instance playing its def's timelines drives the depth of its def's
 * nodes (Phase 4). So a screen timeline never reaches into a component, and a component's timeline
 * never reaches into a component nested inside it.
 */
export interface CinematicNodeDrive {
	/** The channels the timeline keys on this node — fixed for the life of the node. */
	channels: ReadonlySet<NodeActorChannel>;
	/** The node's `text` track, when it has one (its mode, `format` and `to`). */
	textTrack?: CinematicTrack;
	/** The node's channels at the cinematic's current time (reactive: reads the playhead). */
	sample(): CinematicNodeSample;
}

export type CinematicNodeDriver = (nodeId: string) => CinematicNodeDrive | undefined;

const KEY = Symbol('engine-layout:cinematicNodes');

interface ScopedDriver {
	driver: CinematicNodeDriver;
	depth: number;
}

export function setCinematicNodeDriver(driver: CinematicNodeDriver, depth = 0): void {
	setContext<ScopedDriver>(KEY, { driver, depth });
}

/** The driver for nodes at component nest `depth`, if the nearest one belongs to that depth. */
export function getCinematicNodeDriver(depth = 0): CinematicNodeDriver | undefined {
	const scoped = getContext<ScopedDriver | undefined>(KEY);
	return scoped && scoped.depth === depth ? scoped.driver : undefined;
}
