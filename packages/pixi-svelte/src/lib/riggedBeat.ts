/**
 * Does a fired spine event belong to the BEAT a rig binding was keyed on?
 *
 * A `<RiggedEffect>` / `<RiggedFlipbook>` is one keyframe's binding. The baked manifest carries
 * that keyframe's `animation` + `time` beside the event name, and the runtime listener gets all
 * three off the fire (`entry.animation.name`, `event.time`, `event.data.name`) — so the binding
 * can fire on ITS key only, not on every key that happens to share the name.
 *
 * Absent fields on the binding match anything: a manifest baked before the beat existed keeps the
 * name-only behaviour it always had, and nothing re-baked is required for a game to keep running.
 *
 * Extracted (like `shouldApplySpineAnimation`) so the rule is testable without a renderer:
 * `node --experimental-strip-types packages/pixi-svelte/fixtures/riggedBeat.fixture.ts`.
 */

export type RiggedBeatBinding = {
	event: string;
	animation?: string;
	time?: number;
};

export type FiredSpineEvent = {
	name: string | undefined;
	animation: string | undefined;
	time: number | undefined;
};

/** Keyframe times are authored to 4 decimals in the Rigger and round-trip through JSON, so the
 * two numbers are normally identical; the tolerance only absorbs float noise, never a neighbour
 * key (the Rigger refuses two keys of one event closer than 1e-4). */
const TIME_EPS = 1e-4;

export function riggedBeatMatches(binding: RiggedBeatBinding, fired: FiredSpineEvent): boolean {
	if (!fired.name || fired.name !== binding.event) return false;
	if (binding.animation !== undefined && fired.animation !== binding.animation) return false;
	if (binding.time !== undefined) {
		if (typeof fired.time !== 'number') return false;
		if (Math.abs(fired.time - binding.time) > TIME_EPS) return false;
	}
	return true;
}
