/**
 * Generic scene mounter interface (design doc §8). Today `Game.svelte` mounts scenes by
 * hard-coded id (the deferred §20.1 limitation); the interpreter mounts WHATEVER screen
 * the active state points at. Phase 0 only needs the contract + the fall-through dispatch
 * boundary — the real PixiJS/`LayoutScene` mounting is wired in Phase 4. The mounter must
 * honour MainContainer scaling + overlays (design doc §11.3); that correctness is proven
 * when the live mounter lands, not in this headless slice.
 */
export type SceneMounter = {
	/** Mount the screen with this id as the active base scene; returns once mounted. */
	mount: (screenId: string) => void;
	/** Whether a screen id is known to the mounter (an authored/exported scene exists). */
	has: (screenId: string) => boolean;
};
