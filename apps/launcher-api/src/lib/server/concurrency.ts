/**
 * Bounded-concurrency `map` for the export paths.
 *
 * WHY THIS EXISTS. The runtime assemble is dominated by R2 LATENCY, not compute, and its exporters
 * walk their work in plain `for…await` loops — one item, several sequential round-trips, next item.
 * Profiled 2026-09-21 on `test6` (93.3s assemble): `art` alone was 90.2s, of which `art:manifests`
 * spent 50.3s on 41 sheets (~1.2s each, ~4-5 round-trips apiece) and `art:spines` 14.1s on 9
 * bundles. Nothing there is CPU-bound — it is the same request waiting on the network 200 times in
 * a row. Overlapping those waits is the whole win.
 *
 * WHY BOUNDED rather than `Promise.all`. The launcher is memory-tight (it already OOMs mid-bake),
 * and each art task can hold a full atlas page in memory and may KTX2-encode it. An unbounded fan
 * out over 41 pages trades a slow assemble for a dead container. The limit is the knob that keeps
 * this a latency win and not a memory experiment.
 *
 * ORDERING. The RETURNED array is in INPUT order regardless of completion order. ⚠️ That only buys
 * a caller determinism if it actually USES the return value: a task that `push`es its result into a
 * shared array as a side effect still lands in COMPLETION order, and this helper cannot help it.
 * The art export does exactly that, and had to sort its index by key to get byte-stable output —
 * which is not cosmetic, because a payload that is never byte-equal to itself defeats any content
 * fingerprint over it. If you fan out with this, either consume the result or impose a canonical
 * order at the end.
 *
 * FAILURE. Rejects with the first error, like `Promise.all` — callers here are exporters whose
 * partial output would be a silently smaller (i.e. broken) bundle, so failing loudly is correct.
 * In-flight tasks are allowed to settle; no new ones start.
 */
/**
 * Collapse CONCURRENT calls for the same key onto one run. Each module makes its own.
 *
 * WHY. The runtime assemble fans its exporters out with `Promise.all`, and several of them
 * independently load the same thing: profiled 2026-09-21 on `test6`, `art:clips:walk` (10.3s) and
 * `flipbooks:reachability` + `flipbooks:doc` (14.1s) were computing the same clip reachability and
 * the same flipbook doc at the same time, in two exporters running side by side. That is not a
 * caching problem — nothing was stale — it is the same work started twice because neither caller
 * knew about the other.
 *
 * NOT A CACHE, deliberately. The entry is dropped as soon as it settles, so this only ever dedupes
 * calls that genuinely overlap. A later assemble recomputes from scratch, which is what keeps the
 * 10s bundle TTL meaningful and avoids the false-HIT class of bug `runtimeBundleCache` warns about
 * at length: there is no window in which a saved value can go stale, because nothing is saved.
 *
 * ⚠️ CALLERS THAT JOIN MUST AGREE ON THE ANSWER. Whoever arrives first runs, and everyone else gets
 * that result — so two callers passing different inputs under one key would make the outcome depend
 * on a race. Either key on the inputs, or make the callers pass the same ones.
 */
export function createSingleFlight(): <T>(key: string, run: () => Promise<T>) => Promise<T> {
	const inflight = new Map<string, Promise<unknown>>();
	return <T>(key: string, run: () => Promise<T>): Promise<T> => {
		const pending = inflight.get(key) as Promise<T> | undefined;
		if (pending) return pending;
		const started = run().finally(() => inflight.delete(key));
		inflight.set(key, started);
		return started;
	};
}

export async function mapWithConcurrency<T, R>(
	items: readonly T[],
	limit: number,
	run: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
	if (items.length === 0) return [];
	const width = Math.max(1, Math.min(limit, items.length));
	const results = new Array<R>(items.length);
	let next = 0;
	const worker = async (): Promise<void> => {
		for (;;) {
			const index = next++;
			if (index >= items.length) return;
			results[index] = await run(items[index], index);
		}
	};
	await Promise.all(Array.from({ length: width }, worker));
	return results;
}

/**
 * A counting semaphore: at most `limit` runs at once, the rest queue in arrival order.
 *
 * Used to cap how many runtime assembles the launcher runs in parallel ACROSS projects. Each one
 * holds atlas pages in memory and may KTX2-encode them, and the container has OOM'd mid-bake — so
 * N authors previewing N different games must not mean N concurrent assembles.
 */
export function createLimiter(limit: number): <T>(run: () => Promise<T>) => Promise<T> {
	let active = 0;
	const waiting: (() => void)[] = [];
	return async <T>(run: () => Promise<T>): Promise<T> => {
		// A released slot is handed to the next waiter without being freed, so `active` never dips
		// and a caller arriving in between cannot take it too.
		if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
		else active++;
		try {
			return await run();
		} finally {
			const next = waiting.shift();
			if (next) next();
			else active--;
		}
	};
}

/**
 * A per-key mutex: runs for the same key execute one after another, different keys in parallel.
 *
 * Unlike {@link createSingleFlight}, a later caller does NOT join the earlier run — it waits for it
 * and then runs its own, because the callers here want different things (a publish copying
 * `deploy/`, an authoring boot rewriting it). A failed run releases the key like a successful one.
 */
export function createKeyedMutex(): <T>(key: string, run: () => Promise<T>) => Promise<T> {
	const tails = new Map<string, Promise<unknown>>();
	return <T>(key: string, run: () => Promise<T>): Promise<T> => {
		const prev = tails.get(key) ?? Promise.resolve();
		const result = prev.then(run, run);
		const tail = result.catch(() => undefined);
		tails.set(key, tail);
		void tail.then(() => {
			if (tails.get(key) === tail) tails.delete(key);
		});
		return result;
	};
}
