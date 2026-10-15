/**
 * The coded overlays a game has RETIRED for this boot in favour of their authored component (Rive
 * plan Phase 8a). A retired coded part renders nothing and subscribes to nothing, so a project that
 * also placed the hybrid `transition` twin (whose bound child is the coded part) plays one wipe,
 * not two. Set by the game once its layout doc has loaded, before any instance of the doc mounts;
 * never set ⇒ every coded part behaves exactly as before (parity).
 */

/** `transition` (8a) silences `Transition.svelte`; `win` (8b) silences `WinVisual` — the drawn half only,
 *  the gate keeps conducting; `freeSpins` (8c) silences `FreeSpinIntroVisual` / `FreeSpinOutroVisual` —
 *  the outro driver keeps counting and holding. */
export type CodedOverlay = 'transition' | 'win' | 'freeSpins';

const retired = new Set<CodedOverlay>();

export function retireCodedOverlay(overlay: CodedOverlay, on = true): void {
	if (on) retired.add(overlay);
	else retired.delete(overlay);
}

export function isCodedOverlayRetired(overlay: CodedOverlay): boolean {
	return retired.has(overlay);
}
