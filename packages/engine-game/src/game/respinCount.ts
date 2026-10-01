/**
 * THE RESPIN BOARD'S COUNT-UPS, without a renderer — how a value that a special changed is shown
 * rising on the board (Phase 4d of `docs/design/hold-and-win.md`). Pure, so
 * `fixtures/respinCount.fixture.ts` pins it; `apps/lines` `holdAndWinPresentation.ts` only times
 * and draws the answer.
 */

/** One leg of a count: the label goes from `from` to `to`. */
export type CountStep = { from: number; to: number };

/**
 * Split one count from `from` to `to` into one leg per weight, each leg's share of the distance
 * proportional to its weight — a collector taking N coins rises by each coin's worth in turn.
 *
 * The legs are contiguous and the last ends EXACTLY on `to`, whatever the weights sum to: the
 * collector's final value is the server's, and a leg built from rounded per-coin amounts must not
 * leave it a cent off. Weights that sum to nothing usable (all zero, negative, not finite) share the
 * distance equally.
 */
export const countSteps = (from: number, to: number, weights: number[]): CountStep[] => {
	if (weights.length === 0) return [];
	const usable = weights.map((weight) => (Number.isFinite(weight) && weight > 0 ? weight : 0));
	const total = usable.reduce((sum, weight) => sum + weight, 0);
	const shares =
		total > 0 ? usable.map((weight) => weight / total) : usable.map(() => 1 / usable.length);
	let reached = 0;
	return shares.map((share, i) => {
		const start = i === 0 ? from : from + (to - from) * reached;
		reached += share;
		const end = i === shares.length - 1 ? to : from + (to - from) * reached;
		return { from: start, to: end };
	});
};

/**
 * When each of `count` staggered items starts, in ms: `i × staggerMs`, the stagger shrunk so the
 * last one starts no later than `maxSpanMs` — a board full of coins counts up together in about the
 * same time as a handful, instead of the beat growing with every coin.
 */
export const staggerDelays = (count: number, staggerMs: number, maxSpanMs: number): number[] => {
	if (count <= 0) return [];
	const step = count > 1 ? Math.min(staggerMs, maxSpanMs / (count - 1)) : 0;
	return Array.from({ length: count }, (_, i) => Math.max(0, i * step));
};
