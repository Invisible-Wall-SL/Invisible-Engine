import {
	ComponentStateMachineRunner,
	ComponentTimelinePlayer,
	nodeActorBindings,
	type CinematicDoc,
	type LayoutNode,
} from 'engine-layout';

import type { TimelineNodeDrive } from './screenTimeline';

/**
 * The State Machine panel's STAGE PREVIEW (Rive plan Phase 5b) runs the GAME's own pieces — the
 * interpreter and the per-instance timeline player — so what the stage shows is what a placed
 * instance plays, blends, interruptions, cues and missing timelines included. These helpers are
 * the pure seams around them, so the gate can drive the same sequences the panel does.
 */

/** The player a preview binds: the states' timelines on the component's nodes, every `playOn`
 *  stripped — the stage previews the machine alone (in game, `instanceTimelineDocs` keeps the
 *  component's own `playOn` timelines playing beside it). */
export function previewPlayer(
	docs: Iterable<CinematicDoc>,
	nodes: LayoutNode[],
): ComponentTimelinePlayer {
	return new ComponentTimelinePlayer(
		[...docs].map((doc) => (doc.playOn ? { ...doc, playOn: undefined } : doc)),
		nodes,
	);
}

/**
 * One preview step after the runner advanced: place every layer's slot (`drive`, as the instance
 * does) and route the cues it crossed — a `signal:` cue fires the trigger of that name on the
 * runner, as it would on the instance's bus; sounds and effects have nowhere to go on the stage.
 * Returns the cues, for the gate.
 */
export function placeLayers(
	runner: ComponentStateMachineRunner,
	player: ComponentTimelinePlayer,
): { cue: string; timeline: string }[] {
	const cues = runner.plays().flatMap((play, i) => player.drive(play.layer, i, play));
	for (const { cue } of cues) if (cue.startsWith('signal:')) runner.fire(cue.slice(7));
	return cues;
}

/** Every node the player drives, as the canvas's drives (`setTimelinePreview`). */
export function playerDrives(player: ComponentTimelinePlayer): Map<string, TimelineNodeDrive> {
	const out = new Map<string, TimelineNodeDrive>();
	for (const [nodeId, channels] of player.drivenNodes()) {
		const sample = player.sample(nodeId);
		if (!sample) continue;
		const bindings = nodeActorBindings(channels);
		if (bindings.length || sample.tint !== undefined) out.set(nodeId, { bindings, sample });
	}
	return out;
}
