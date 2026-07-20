/**
 * A round-scoped SKIP token — the "slam stop" primitive, the presentation-phase sibling of
 * `interruptible.ts` (which only interrupts an already-running promise).
 *
 * `interruptible` can cut short a wait that is IN FLIGHT; a slam stop also has to short-circuit
 * every wait the round has not reached yet (the count-up that mounts a beat later, the transition
 * two book events down). So the token is STICKY: once tripped it stays tripped until `reset()`, and
 * `onSkip` fires immediately for a listener that subscribes after the trip. That is what lets ONE
 * press fast-forward the whole remainder of a round.
 *
 * Skipping must never DROP a beat — every call site is expected to still apply its effect at its
 * FINAL value (count-ups jump to the end total, a win line draws complete, a state write still
 * happens); the token only removes the time spent getting there.
 */
export type SkipToken = {
	/** Whether the current round has been slammed. */
	isSkipped: () => boolean;
	/** Trip the token: resolve every pending `wait`/`race` and notify every `onSkip` listener. */
	skip: () => void;
	/** Re-arm for a new round (or a new skippable segment within one, e.g. a bonus sub-spin). */
	reset: () => void;
	/**
	 * Run `listener` when the token trips — IMMEDIATELY if it is already tripped. Returns an
	 * unsubscribe. Listeners are the "jump to final value" hooks (e.g. finish a count-up).
	 */
	onSkip: (listener: () => void) => () => void;
	/** `waitForTimeout` that resolves at once while skipped. */
	wait: (time: number) => Promise<void>;
	/** Resolve as soon as EITHER `target` settles or the token trips. */
	race: (target: Promise<unknown>) => Promise<void>;
};

export const createSkipToken = (): SkipToken => {
	let skipped = false;
	const listeners = new Set<() => void>();
	const pending = new Set<() => void>();

	const releasePending = () => {
		const waiting = [...pending];
		pending.clear();
		waiting.forEach((resolve) => resolve());
	};

	const skip = () => {
		skipped = true;
		[...listeners].forEach((listener) => listener());
		releasePending();
	};

	// Deliberately clears NEITHER `pending` nor `listeners`. `pending` is already empty unless the
	// round ended without a skip, in which case those waits are live timers that must still resolve
	// on their own schedule — dropping their release closures would strand them. `listeners` are
	// owned by long-lived components (a count-up provider outlives many rounds), so clearing them
	// would silently un-skip the game after its first slam.
	const reset = () => {
		skipped = false;
	};

	const onSkip = (listener: () => void) => {
		listeners.add(listener);
		if (skipped) listener();
		return () => listeners.delete(listener);
	};

	const wait = (time: number) =>
		new Promise<void>((resolve) => {
			if (skipped) {
				resolve();
				return;
			}
			const timeout = setTimeout(() => {
				pending.delete(release);
				resolve();
			}, time);
			const release = () => {
				clearTimeout(timeout);
				resolve();
			};
			pending.add(release);
		});

	// A target that NEVER settles (the common case on a slam — an awaited broadcast whose only
	// resolver was a player tap) keeps this `.then` attached for the life of the target. That is
	// bounded, not a leak: the target is a `broadcastAsync` promise held only by its subscriber's
	// stored resolver, which the next broadcast of the same event overwrites — at which point the
	// whole chain becomes unreachable and is collected. Worst case is one suspended chain per
	// awaited broadcast per round (tens, even skipping a full ten-spin feature), each holding a
	// resolve closure and no retained rendering state.
	const race = (target: Promise<unknown>) =>
		new Promise<void>((resolve) => {
			if (skipped) {
				resolve();
				return;
			}
			const release = () => resolve();
			pending.add(release);
			void target.then(() => {
				pending.delete(release);
				resolve();
			});
		});

	return { isSkipped: () => skipped, skip, reset, onSkip, wait, race };
};

/**
 * THE round token. One per running game (a browser runs one game), so any package — the reels
 * (`utils-slots`), the count-up providers (`components-pixi`), the book-event handlers — can ask
 * whether the player has slammed the current round without threading a parameter through every
 * layer. Tripped by the spin/stop press (`spinStop.ts`), re-armed ONLY by each app's `playBet` —
 * once at the start of the bet and once in its `finally`.
 *
 * Deliberately NOT re-armed per free spin or per `stopButtonEnable`: a bonus book is ONE round, so
 * the trip has to stay sticky across every remaining free spin for a single press to fast-forward
 * the whole feature to its final total instead of costing the player a press per spin.
 */
export const roundSkip = createSkipToken();
