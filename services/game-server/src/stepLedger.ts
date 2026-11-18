/**
 * The fixed steps a room owes the wall clock. Colyseus 0.18's `setFixedTimestep` runs at most five
 * steps a timer tick and then throws the rest of the elapsed time away, so an event-loop stall
 * longer than five steps (~83 ms at 60 Hz) loses room time while every device keeps sending at
 * real time: those inputs then wait in the room's buffer for good, as latency (3D review B finding
 * 10). A room that runs `due()` steps on each of Colyseus' calls follows the wall clock instead:
 * it runs every step it owes, up to `catchUp` at once (a longer stall loses only the rest), and
 * none when the timer fired early.
 */
export type StepLedger = {
	/** The steps to run now: those the wall clock owes, at most `catchUp`. */
	due(): number;
};

export function createStepLedger({
	hz,
	catchUp,
	now = () => performance.now(),
}: {
	hz: number;
	catchUp: number;
	now?: () => number;
}): StepLedger {
	const stepMs = 1000 / hz;
	const start = now();
	let owedSoFar = 0;
	return {
		due() {
			const owed = Math.floor((now() - start) / stepMs) - owedSoFar;
			if (owed <= 0) return 0;
			owedSoFar += owed;
			return Math.min(owed, catchUp);
		},
	};
}
