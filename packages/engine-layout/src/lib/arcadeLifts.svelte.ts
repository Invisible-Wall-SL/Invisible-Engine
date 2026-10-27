/**
 * THE LIVE HOP LIFTS the game draws by (P10.13): how high each hopping character is above the
 * ground plane, and its shadow's width. The arcade runtime writes them once a frame after its loop
 * steps; `<SpawnLayer>` draws such an instance raised by its height over an ellipse shadow on the
 * ground. Generic: engine-layout knows only that some spawned instances are lifted.
 *
 * Nothing turns it on in a game with no hopping character, so every other spawn layer renders as
 * before.
 */

import { SvelteMap } from 'svelte/reactivity';

const state = $state({ on: false });
const lifts = new SvelteMap<string, { z: number; shadow: number }>();

/** Whether any instance is drawn lifted (a config with a hopping character). */
export const liftsOn = (): boolean => state.on;

/** An instance's lift, or `undefined` when it is not a hopping character. */
export const liftOf = (id: string): { z: number; shadow: number } | undefined => lifts.get(id);

/** Publish the lifts after a frame (only the changes); the first publish turns lifting on. */
export const setLifts = (next: ReadonlyMap<string, { z: number; shadow: number }>): void => {
	if (!state.on) state.on = true;
	for (const id of lifts.keys()) if (!next.has(id)) lifts.delete(id);
	for (const [id, lift] of next) {
		const was = lifts.get(id);
		if (!was || was.z !== lift.z || was.shadow !== lift.shadow) lifts.set(id, lift);
	}
};
