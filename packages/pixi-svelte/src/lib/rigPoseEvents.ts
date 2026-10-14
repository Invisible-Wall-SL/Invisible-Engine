import type * as RIG from 'engine-rig/pixi';

/**
 * The events a TIMELINE STRIP crosses on a rig. A strip poses the rig through `<RigPose>`
 * (`Animation.apply`), not the rig's `AnimationState`, so its events never reach a state listener.
 * `<RigPose>` reports them here instead, and the content the Rigger bound to them (`<RiggedEffect>`,
 * `<RiggedFlipbook>`) plays on them as it does on a played clip's. Nothing else hears them: the
 * game bus (`rebroadcastEvents`) stays fed by the state alone, so a strip never fires game logic.
 */
export type RigPoseEventListener = (animation: string, event: RIG.Event) => void;

const listeners = new WeakMap<object, Set<RigPoseEventListener>>();

/** Hear the strip events of `rig`; returns the unsubscribe. */
export function onRigPoseEvent(rig: object, listener: RigPoseEventListener): () => void {
	let set = listeners.get(rig);
	if (!set) listeners.set(rig, (set = new Set()));
	set.add(listener);
	return () => set.delete(listener);
}

export function emitRigPoseEvent(rig: object, animation: string, event: RIG.Event): void {
	for (const listener of listeners.get(rig) ?? []) listener(animation, event);
}
