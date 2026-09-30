/**
 * The operator's MINIMUM SPIN DURATION (`minSpinDuration`), as a clock: when did this spin start, and
 * how long must its result still be held back so it cannot land sooner than the minimum.
 *
 * A spin starts at two different moments. The first reveal of a PAID round starts at the player's
 * press — the reels are already rolling from there (`onNewGameStart`), and the RGS round trip counts
 * toward the minimum, as it does on the partner's own client — so `newGame` marks the press and that
 * reveal consumes the mark. Every later reveal of the same book (a free spin) is a spin of its own
 * and starts when it begins; so does the first reveal of a RESUMED round, which had no press.
 *
 * Deliberately non-reactive and import-free: nothing renders off it, and a fixture drives it with a
 * fake clock (`spinClock.fixture.ts`). Callers read the minimum from `stateOperator` and only touch
 * this clock when it is above zero, so a launch that declares none never reaches it.
 */

export type SpinClock = {
	/** The player pressed SPIN: the next reveal times from now instead of from its own start. */
	markPress: () => void;
	/**
	 * A reveal begins. Returns the instant its result may show — `minMs` after its spin started —
	 * and consumes the press mark, so only the first reveal after a press times from the press.
	 */
	revealDeadline: (minMs: number) => number;
	/** How long is left until `deadline`; 0 once it has passed. */
	remainingUntil: (deadline: number) => number;
};

export const createSpinClock = (now: () => number = () => performance.now()): SpinClock => {
	let pressedAt: number | null = null;

	return {
		markPress: () => {
			pressedAt = now();
		},
		revealDeadline: (minMs) => {
			const startedAt = pressedAt ?? now();
			pressedAt = null;
			return startedAt + Math.max(0, minMs);
		},
		remainingUntil: (deadline) => Math.max(0, deadline - now()),
	};
};

export const spinClock = createSpinClock();
