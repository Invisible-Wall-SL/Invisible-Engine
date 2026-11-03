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
 * SCREENS THEIR TIMELINES DRIVE WITHOUT REMOUNTING THEM. A timeline playing on a screen used to
 * remount it (`<FlowV2Mount>` keyed on the play): every node reads its driver once, at mount. On
 * `overlay-buffaloduel` that rebuilt the Pots screen — 60 component instances, 60 rigs — as each
 * pots timeline started, the Hold and Win bonus's worst frames (~1 s with the CPU slowed 4×).
 *
 * A screen qualifies when every timeline hosted on it only moves its nodes (`IN_PLACE_CHANNELS`): a
 * channel that can change which branch draws a node (a mask, a rig scrub, a text track) needs the
 * node built with it. Each node then takes, for its whole life, the channels any of those timelines
 * keys on it, and samples whichever one drives the screen now — none ⇒ no value ⇒ drawn as
 * authored (`foldBoundTransform`). Each new play changes the restart key, and the screen starts
 * again in place exactly as a remount starts it (`getContextRestart`: rig tracks, component
 * instances and their machines, effects, flipbooks, Element FX, coded parts), in mount order, so
 * even a seeded run draws the same pixels.
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
