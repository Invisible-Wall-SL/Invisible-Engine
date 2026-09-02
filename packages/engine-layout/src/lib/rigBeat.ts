/**
 * The BEAT a rig binding fires on — which animation, and which keyframe time within it.
 *
 * A spine event carries its name, its keyframe `time`, and (through the track entry) the animation
 * it belongs to. The baked rig→FX / rig→clip manifests used to carry only the NAME, so every binding
 * sharing a name fired on every keyframe of that name: a flipbook keyed at 0.01s and an effect
 * keyed at 1s (both on the default `event` name) played together at 0.01s, and the first key's
 * overrides won for both. Carrying the beat makes each keyframe its own binding — it plays at ITS
 * time, with ITS settings.
 *
 * Both fields are optional so a manifest baked before they existed still registers and resolves:
 * an absent field matches ANY value, which is exactly the old name-only behaviour.
 */
export type RigBeat = {
	/** Animation the keyframe belongs to. Absent ⇒ any animation. */
	animation?: string;
	/** Keyframe time in seconds. Absent ⇒ any time. */
	time?: number;
};

/** Read a beat off a raw binding / baked entry. Malformed values are DROPPED, never coerced — a
 * dropped `time` widens the match back to "any", it never pins a binding to a wrong beat. */
export function readRigBeat(raw: unknown): RigBeat {
	const out: RigBeat = {};
	if (!raw || typeof raw !== 'object') return out;
	const src = raw as Record<string, unknown>;
	if (typeof src.animation === 'string' && src.animation) out.animation = src.animation;
	if (typeof src.time === 'number' && Number.isFinite(src.time) && src.time >= 0) {
		out.time = src.time;
	}
	return out;
}

/** The `{#each}` key prefix for a rigged binding mount — the beat plus the event name, so two keys
 * of one event name get two mounts (each listening for its own beat), and a re-bake that moves a
 * key re-mounts it clean. Append the binding's own identity (effect/clip, bone, slot). */
export function rigBeatKey(b: RigBeat & { event: string }): string {
	return `${b.event}@${b.animation ?? ''}@${b.time ?? ''}:`;
}
