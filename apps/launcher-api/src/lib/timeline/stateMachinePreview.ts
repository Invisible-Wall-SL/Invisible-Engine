import { sampleNodeActor, type CinematicTrack } from 'engine-cinematic';
import {
	blendNodeSamples,
	keyedNodeChannels,
	nodeActorBindings,
	resolveNodeActors,
	type CinematicDoc,
	type LayerPlay,
	type NodeActorChannel,
	type NodeActorSample,
	type Scene,
} from 'engine-layout';

import type { TimelineNodeDrive } from './screenTimeline';

/**
 * The State Machine panel's STAGE PREVIEW (Rive plan Phase 5b): what every layer plays, as the
 * same per-node drives the Timeline panel pushes into the canvas (`setTimelinePreview`), so the
 * stage shows what the game's player shows. Pure: the interpreter's `plays()` in, drives out.
 *
 * Mirrors `ComponentTimelinePlayer.sample` for the layers' side: layers in order, a later layer
 * winning each property both key, each mixed from the pose it left while its blend runs. (The
 * `playOn` side has no place here — the panel previews the machine alone.)
 */
export function stateMachineDrives(
	plays: readonly LayerPlay[],
	docs: ReadonlyMap<string, CinematicDoc>,
	scene: Scene | undefined,
): Map<string, TimelineNodeDrive> {
	const out = new Map<string, TimelineNodeDrive>();
	if (!scene) return out;
	const samples = new Map<string, NodeActorSample>();
	const channels = new Map<string, Set<NodeActorChannel>>();
	const actorsOf = (id: string | undefined) =>
		id && docs.has(id) ? resolveNodeActors(docs.get(id)!, scene) : undefined;
	for (const play of plays) {
		const to = actorsOf(play.timeline);
		const from = play.from ? actorsOf(play.from.timeline) : undefined;
		if (!to && !from) continue;
		const nodeIds = new Set([...(to?.keys() ?? []), ...(from?.keys() ?? [])]);
		for (const nodeId of nodeIds) {
			const toActor = to?.get(nodeId);
			const fromActor = from?.get(nodeId);
			const toSample = toActor
				? sampleNodeActor(toActor.tracks as unknown as CinematicTrack[], play.time)
				: undefined;
			const sample = play.from
				? blendNodeSamples(
						fromActor
							? sampleNodeActor(fromActor.tracks as unknown as CinematicTrack[], play.from.time)
							: undefined,
						toSample,
						play.from.progress,
					)
				: toSample;
			if (!sample) continue;
			const keyed = channels.get(nodeId) ?? new Set<NodeActorChannel>();
			for (const actor of [toActor, fromActor]) {
				if (actor) for (const c of keyedNodeChannels(actor.tracks)) keyed.add(c);
			}
			channels.set(nodeId, keyed);
			const merged = { ...(samples.get(nodeId) ?? {}) } as Record<string, unknown>;
			for (const [channel, value] of Object.entries(sample)) {
				if (value !== undefined) merged[channel] = value;
			}
			samples.set(nodeId, merged as NodeActorSample);
		}
	}
	for (const [nodeId, sample] of samples) {
		const bindings = nodeActorBindings(channels.get(nodeId) ?? new Set());
		if (bindings.length || sample.tint !== undefined) out.set(nodeId, { bindings, sample });
	}
	return out;
}
