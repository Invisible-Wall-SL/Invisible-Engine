import type { CinematicNodeDrive } from './cinematicNodeContext';
import { keyedNodeChannels, resolveNodeActors, type NodeActorChannel } from './cinematicNodes';
import type { ScreenNodeDrive, ScreenSlot } from './FlowV2Mount.svelte';
import type { CinematicDoc, Scene } from './types';

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
	const slots = new WeakMap<Scene, { docs: readonly CinematicDoc[]; slot: ScreenSlot | null }>();
	const build = (scene: Scene, all: readonly CinematicDoc[]): ScreenSlot | null => {
		const hosted = all.filter((d) => d.host?.kind === 'screen' && d.host.sceneId === scene.id);
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
				// The playing timeline's own drive of this node, asked once per play (as a remount asked it
				// once per mount) — not once a frame.
				let asked: { key: string | undefined; drive: CinematicNodeDrive | undefined } | undefined;
				return {
					channels: keyed,
					sample: () => {
						const current = drive(scene.id);
						if (!asked || asked.key !== current?.key)
							asked = { key: current?.key, drive: current?.driver(nodeId) };
						return asked.drive?.sample() ?? {};
					},
				};
			},
			restart: () => drive(scene.id)?.key,
		};
	};
	// Built once per screen and timeline list: a new list (a live bundle arriving) is read afresh.
	return (scene) => {
		const all = docs();
		let entry = slots.get(scene);
		if (!entry || entry.docs !== all) {
			entry = { docs: all, slot: build(scene, all) };
			slots.set(scene, entry);
		}
		return entry.slot ?? undefined;
	};
}
