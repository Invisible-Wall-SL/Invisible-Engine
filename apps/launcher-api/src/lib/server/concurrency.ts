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
 * ORDERING. Results come back in INPUT order regardless of completion order, so a caller that
 * builds an index from them is byte-stable across runs. That is not cosmetic: a nondeterministic
 * order changes shipped filenames or payload bytes between two assembles of an unchanged project.
 *
 * FAILURE. Rejects with the first error, like `Promise.all` — callers here are exporters whose
 * partial output would be a silently smaller (i.e. broken) bundle, so failing loudly is correct.
 * In-flight tasks are allowed to settle; no new ones start.
 */
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
