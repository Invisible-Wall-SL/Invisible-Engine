import {
	docVariables,
	flattenGroups,
	flowGraphs,
	startupShownContainers,
	type FlowDoc,
} from 'engine-flow-v2';

import type { LinesFlowV2 } from './flowV2Runtime.svelte';

/**
 * A FLOW BROUGHT BACK TO ITS START FOR ANOTHER ROOM (`game/online.ts` `showRoom`: a device that
 * left an online room for a new one without loading the page). The game's flow handle is not built
 * again and its doc is not changed: this drives the handle with what it already has. Plain
 * TypeScript with no game import, so `check:room-flow` runs it in Node on a flow of its own.
 *
 * WHAT A PUBLISHED FLOW MUST KEEP for it: an event that ends its start-up screen, and a start
 * that is all in that event's chain. Either a top-level `complete:<container>` handler for a
 * container the `load` (or `tapToStart`) chain shows itself, or a `tapToStart` chain, or a `load`
 * chain that holds its start-up screen (`showContainer{awaitComplete}`), which is then completed
 * as a boot's tap completes it. With such a handler, `load` itself is not run again: whatever it
 * does besides showing the start-up screen (a sound, a write, a timer) is not done for the new
 * room. The restart is made in the base game, so a mode's own start-up handler is not the one run.
 *
 * WHAT IT CANNOT UNDO (the interpreter has no way to cancel a run, `engine-flow-v2` `runtime.ts`):
 * a chain of the old game that is waiting on a Delay, a timer, an awaited cue or a mode's entry
 * goes on when that ends, and what it does then lands on the new room. A chain held on a screen
 * (`awaitComplete`) is released when the screen is hidden; it is given {@link RELEASED_CHAIN_TURNS}
 * turns, up to {@link RELEASE_ROUNDS} times, and what it shows is hidden again.
 */

/** The part of the game's flow handle a restart drives. */
export type RoomFlow = Pick<LinesFlowV2, 'ordered' | 'containers' | 'ownsEvent' | 'dispatch'> & {
	mount: Pick<LinesFlowV2['mount'], 'hide' | 'heldContainers'>;
	state?: Pick<NonNullable<LinesFlowV2['state']>, 'write' | 'stopTimer'>;
};

/** What the game does for a restart, in its order. */
export type RoomFlowGame = {
	/** Take down, now, every screen the flow no longer shows. */
	unmount: () => void;
	/** Put the mode stack back at the base game. */
	resetModes: () => void;
	/** Write the new room's values into the flow's variables. */
	roomValues: () => void;
	/** Complete the screen on top, as a boot's tap or loaded bar does; whether one was. */
	complete: () => Promise<boolean>;
};

/** How many turns of the microtask queue a chain released by its screen's hide is given to run
 *  on before what it showed is taken down again. */
const RELEASED_CHAIN_TURNS = 64;
/** How many times a released chain that holds on another screen is released again. */
const RELEASE_ROUNDS = 8;

/**
 * The event that ends the flow's start-up screen at a boot, `complete:<container>`, or `undefined`
 * when it handles none. A boot completes the screen on top of what `load` showed: so, of the
 * containers the `load` and `tapToStart` chains show THEMSELVES (not those a completion shows
 * later: a second `complete:` handler, for an intro, is not the start-up's), the topmost whose
 * completion the flow handles.
 */
export function startupCue(doc: FlowDoc, flow: Pick<RoomFlow, 'containers' | 'ownsEvent'>) {
	const first = startupShownContainers({
		...doc,
		graph: {
			...doc.graph,
			nodes: doc.graph.nodes.filter(
				(node) => !(node.kind === 'event' && node.ref.startsWith('complete:')),
			),
		},
	});
	const [top] = flow.containers
		.filter(({ id }) => first.has(id) && flow.ownsEvent(`complete:${id}`))
		.sort((a, b) => b.z - a.z);
	return top && `complete:${top.id}`;
}

/**
 * Bring `flow` back to its start and start it for the new room, with no frame between. Every
 * container it shows is hidden. Hiding a container releases a chain held on it (a win screen
 * shown with `awaitComplete`), which then runs on: it is given its turns, and what it showed is
 * hidden too. The game unmounts, the mode stack goes back to the base game, the variables to their
 * initial values, every timer the doc can start stops, and the room's values are written. Then the
 * flow gets the event that ends its start-up screen ({@link startupCue}), else `tapToStart`, else
 * `load` completed as a boot completes it. Returns that run without waiting for it (it may hold
 * for a tap): `chain` rejects if it fails.
 */
export async function restartFlow(
	flow: RoomFlow,
	doc: FlowDoc | undefined,
	game: RoomFlowGame,
): Promise<{ chain: Promise<unknown> }> {
	for (let round = 0; ; round++) {
		const held = flow.mount.heldContainers().length > 0;
		for (const { id } of flow.ordered()) flow.mount.hide(id);
		if (!held || round === RELEASE_ROUNDS) break;
		for (let turn = 0; turn < RELEASED_CHAIN_TURNS; turn++) await Promise.resolve();
	}
	game.unmount();
	game.resetModes();
	if (flow.state && doc) {
		for (const { id, initial } of docVariables(doc)) flow.state.write(id, initial);
		for (const node of flowGraphs(doc).flatMap(({ graph }) => flattenGroups(graph).nodes))
			if (node.kind === 'startTimer') flow.state.stopTimer(node.timer);
	}
	game.roomValues();
	const cue = doc && startupCue(doc, flow);
	if (cue) return { chain: flow.dispatch(cue, {}) };
	if (flow.ownsEvent('tapToStart')) return { chain: flow.dispatch('tapToStart', {}) };
	const load = flow.dispatch('load', {});
	for (let turn = 0; turn < RELEASED_CHAIN_TURNS; turn++) await Promise.resolve();
	return { chain: Promise.all([load, game.complete()]) };
}
