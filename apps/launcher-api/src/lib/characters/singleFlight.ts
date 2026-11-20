/**
 * One flight of `run` at a time, and never a dropped call: a call made while a flight is in the
 * air asks for ONE more run when it lands (however many calls were made meanwhile), and its
 * promise settles when that run has. So what a caller awaits was always read after its call.
 *
 * `/characters` reads the project's components and clips with it (`wholeRead.svelte.ts`): a Save
 * that lands during the page's first read still gets its re-read. A run that throws ends the
 * flight for every caller waiting on it.
 */
export function singleFlight(run: () => Promise<void>): () => Promise<void> {
	let flight: Promise<void> | undefined;
	let again = false;
	return () => {
		if (flight) {
			again = true;
			return flight;
		}
		flight = (async () => {
			try {
				do {
					again = false;
					await run();
				} while (again);
			} finally {
				flight = undefined;
			}
		})();
		return flight;
	};
}

/** What a re-read is asked of: `load` reads again, `error` is why the last read failed. */
export interface Rereadable {
	load(): Promise<void>;
	readonly error: string;
}

/**
 * Read again, then answer from the fresh read: `then` runs only after `load` has landed, and not
 * at all when it failed (`refused` then says why). For what must not be decided on a stale read:
 * the components are saved under another lease, so the block *Make this a sheet* copies and the
 * blocks *Compare* reads may have changed since the page loaded.
 */
export async function afterReread<T>(
	read: Rereadable,
	then: () => T,
): Promise<{ refused: string } | { refused: null; value: T }> {
	await read.load();
	if (read.error)
		return { refused: `${read.error} Nothing was changed: the project was not read again.` };
	return { refused: null, value: then() };
}
