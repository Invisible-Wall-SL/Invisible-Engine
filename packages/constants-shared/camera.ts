/**
 * The full-screen camera-effect vocabulary — the ONE list of kinds the whole chain agrees on.
 *
 * It lives here, in the dependency-free constants package, because two packages that must never
 * disagree both read it: `engine-flow-v2`'s template vocabulary (which turns it into the
 * `CameraEffectKind` enum → the editor's `kind` dropdown) and `pixi-svelte`'s `cameraEffects`
 * (which implements each kind against the stage). Declaring the list twice would let the editor
 * offer a kind the runtime silently no-ops.
 *
 * Adding a kind = one entry here + one `case` in `sampleCameraEffect` (`pixi-svelte`). The editor
 * picks it up with no further edits.
 */

export const CAMERA_EFFECT_KINDS = ['shake', 'flash', 'zoomPunch', 'chromaticWobble'] as const;

export type CameraEffectKind = (typeof CAMERA_EFFECT_KINDS)[number];

export const isCameraEffectKind = (value: unknown): value is CameraEffectKind =>
	typeof value === 'string' && (CAMERA_EFFECT_KINDS as readonly string[]).includes(value);
