// The house spin feel, measured off land-based cabinet footage (2026-11-05): 20 symbols/s on a
// 120 px row (2.4 px/ms), all reels start together with a ~60 ms ramp and no wind-up, normal stops
// ~316 ms apart (5 × 1.26 rows at 20 rows/s), turbo lands every reel together after ~170 ms, and the
// bounce runs 5% of a row past the seat and back in ~130 ms.
//
// Its own file with no imports, so the Scene Editor can show these as the blank-field defaults
// without pulling the engine's type graph into the launcher.
const SPIN_OPTIONS_SHARED = {
	reelBounceBackSpeed: 0.06,
	reelSpinSpeedBeforeBounce: 2.4,
	reelPaddingMultiplierNormal: 1.26,
	reelPaddingMultiplierAnticipated: 10,
	// Free-spin sequential-stop padding knob (higher = longer gap between reel stops). Only
	// applies when the sequential-stop flag selects the `sequential` spinType, so the base game
	// is unaffected.
	reelPaddingMultiplierSequential: 4,
	// Sequential-cascade spin speed (higher = faster reels, which also shortens the gap between
	// stops for a given `reelPaddingMultiplierSequential`). Matches `reelSpinSpeed` by default.
	reelSpinSpeedSequential: 2.4,
	reelSpinDelay: 0,
	reelPreSpinSpeed: 2.4,
	reelSpinSpeed: 2.4,
	reelBounceSizeMulti: 0.05,
	reelWindUp: 0,
	reelBounceOvershoot: 1,
	reelBounceDuration: 130,
};

export const SPIN_OPTIONS_DEFAULT = {
	...SPIN_OPTIONS_SHARED,
	reelSpinUpDuration: 60,
	reelMinSpinDuration: 0,
	reelPaddingMultiplierFirst: 0,
};

export const SPIN_OPTIONS_FAST = {
	...SPIN_OPTIONS_SHARED,
	reelSpinUpDuration: 30,
	reelMinSpinDuration: 170,
};
