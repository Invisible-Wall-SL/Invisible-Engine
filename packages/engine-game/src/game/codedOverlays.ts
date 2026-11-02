/**
 * The coded overlays a game has RETIRED for this boot. A retired coded part renders nothing and
 * subscribes to nothing. Set by the game once its layout doc has loaded, before any instance of the
 * doc mounts; never set ⇒ every coded part behaves exactly as before (parity).
 */

/** `transition` silences `Transition.svelte` while the `transition` cue plays a screen transition
 *  (Invisible Shader Graph 8e), so a project that also placed the hybrid `transition` twin (whose
 *  bound child is the coded part) plays no wipe. */
export type CodedOverlay = 'transition';

const retired = new Set<CodedOverlay>();

export function retireCodedOverlay(overlay: CodedOverlay, on = true): void {
	if (on) retired.add(overlay);
	else retired.delete(overlay);
}

export function isCodedOverlayRetired(overlay: CodedOverlay): boolean {
	return retired.has(overlay);
}
