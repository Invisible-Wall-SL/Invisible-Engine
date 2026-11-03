import {
	keyedNodeChannels,
	resolveNodeActors,
	type CinematicDoc,
	type NodeActorChannel,
	type Scene,
} from 'engine-layout';
import type { ScreenNodeDrive, ScreenSlot } from 'engine-layout/svelte';

/** The channels a screen can take from a timeline without remounting: they only move the node. */
const IN_PLACE_CHANNELS: ReadonlySet<NodeActorChannel> = new Set([
	'x',
	'y',
	'scale',
	'scaleX',
	'scaleY',
	'rotation',
	'alpha',
]);

/**
 * PROTOTYPE (`?screenDrive=keep`): screens their timelines drive WITHOUT remounting them. A screen
 * qualifies when every timeline hosted on it only moves its nodes (`IN_PLACE_CHANNELS`); each node
 * then takes, for its whole life, the channels any of those timelines keys on it, and samples
 * whichever one drives the screen now — none ⇒ no value ⇒ drawn as authored. Each new play changes
 * the restart key, so the screen's rigs and component machines start again as a remount would.
 */
export function createScreenSlots(
	docs: () => readonly CinematicDoc[],
	drive: (sceneId: string) => ScreenNodeDrive | undefined,
): (scene: Scene) => ScreenSlot | undefined {
	const slots = new WeakMap<Scene, ScreenSlot | null>();
	const build = (scene: Scene): ScreenSlot | null => {
		const hosted = docs().filter((d) => d.host?.kind === 'screen' && d.host.sceneId === scene.id);
		if (!hosted.length) return null;
		const channels = new Map<string, Set<NodeActorChannel>>();
		for (const doc of hosted) {
			for (const [nodeId, actor] of resolveNodeActors(doc, scene)) {
				const keyed = keyedNodeChannels(actor.tracks);
				for (const channel of keyed) if (!IN_PLACE_CHANNELS.has(channel)) return null;
				const own = channels.get(nodeId) ?? new Set();
				for (const channel of keyed) own.add(channel);
				channels.set(nodeId, own);
			}
		}
		return {
			driver: (nodeId) => {
				const keyed = channels.get(nodeId);
				if (!keyed?.size) return undefined;
				return { channels: keyed, sample: () => drive(scene.id)?.driver(nodeId)?.sample() ?? {} };
			},
			restart: () => drive(scene.id)?.key,
		};
	};
	return (scene) => {
		let slot = slots.get(scene);
		if (slot === undefined) {
			slot = build(scene);
			slots.set(scene, slot);
		}
		return slot ?? undefined;
	};
}
