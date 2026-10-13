import { getContext, setContext } from 'svelte';

import type { CinematicNodeSample, CinematicTrack } from 'engine-cinematic';

import type { NodeActorChannel } from './cinematicNodes';

/**
 * How a playing `<Cinematic>` reaches the nodes of its SCREEN host (Rive plan §3.1): it provides a
 * lookup by node id, and each top-level `<LayoutNodeView>` asks it once, at init, whether a node
 * actor drives it. Absent context (every scene not mounted by a node-actor cinematic) ⇒ `undefined`
 * ⇒ the node renders exactly as before.
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

export function setCinematicNodeDriver(driver: CinematicNodeDriver): void {
	setContext(KEY, driver);
}

export function getCinematicNodeDriver(): CinematicNodeDriver | undefined {
	return getContext<CinematicNodeDriver | undefined>(KEY);
}
