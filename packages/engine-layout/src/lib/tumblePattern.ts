/**
 * THE CASCADE EXPLOSION PATTERN — the order the winning seats pop in, and the gap between them.
 *
 * The cascade has always blown the whole board up in ONE frame: `tumbleBoardExplode` set every
 * winning cell to `clearReel` inside a single `Promise.all` and waited for the last one. That
 * is one legitimate look out of many, and it was the only one available — a game that wanted the
 * board to come apart column by column had no way to say so, because the order lived in a `.map()`
 * rather than in a doc.
 *
 * This module is that order, as data: a named pattern plus a step in milliseconds. It is PURE and
 * dependency-free so both halves can share one source of truth — the Invisible Symbols State
 * Machine (which authors it) and the game's `TumbleBoard` (which plays it) — the same reason
 * {@link ./symbolStates} lives in this package.
 *
 * It is PRESENTATION ONLY. Nothing here changes which seats explode, what they pay, or the order
 * the refills arrive in; the step's own contract is untouched (it still ends when the LAST seat
 * reports), so a pattern lengthens the beat by exactly `(waves - 1) × stepMs` and nothing else.
 *
 * It moves nothing downstream either — notably NOT the Symbol-SM Transition, whose bridge rides its
 * own seat's pop (`scheduleTransition` in `TumbleBoard.svelte`) and so simply sweeps along with the
 * waves. That was tried the other way round once: because the intro a bridge leads into is one
 * board-wide beat, every bridge was pulled onto the LAST wave, which left an early seat's cover
 * arriving long after the symbol it covers had finished popping. See that function for the whole
 * account.
 *
 * See `docs/design/invisible-symbols-state-machine.md` § "Explosion pattern".
 */

/**
 * The authorable patterns. `all` is the default and IS today's behaviour — every seat at zero
 * delay — so a project that never picks one is byte-identical to before this existed.
 *
 * A VALUE array, not a bare union: the launcher transpiles TS without checking it, so a list only
 * a type guards can be silently missed (the same reasoning as `SYMBOL_CELL_TYPES`).
 */
export const TUMBLE_PATTERNS = [
	'all',
	'columnsLeft',
	'columnsRight',
	'columnsOut',
	'columnsIn',
	'rowsTop',
	'rowsBottom',
	'diagonalTopLeft',
	'diagonalTopRight',
	'radial',
	'random',
	'sequential',
] as const;

export type TumblePatternName = (typeof TUMBLE_PATTERNS)[number];

/** Human labels — the Symbols tool's dropdown. */
export const TUMBLE_PATTERN_LABELS: Record<TumblePatternName, string> = {
	all: 'All at once',
	columnsLeft: 'Columns · left to right',
	columnsRight: 'Columns · right to left',
	columnsOut: 'Columns · centre outwards',
	columnsIn: 'Columns · edges inwards',
	rowsTop: 'Rows · top to bottom',
	rowsBottom: 'Rows · bottom to top',
	diagonalTopLeft: 'Diagonal · from the top-left',
	diagonalTopRight: 'Diagonal · from the top-right',
	radial: 'Radial · centre outwards',
	random: 'Random · one at a time',
	sequential: 'One at a time · reading order',
};

/** One line each, shown under the dropdown so the pick is made without playing a spin. */
export const TUMBLE_PATTERN_HINTS: Record<TumblePatternName, string> = {
	all: 'Every winning symbol explodes in the same frame — the original behaviour.',
	columnsLeft: 'The leftmost winning column pops first, then the next one, and so on rightwards.',
	columnsRight: 'The rightmost winning column pops first, sweeping leftwards.',
	columnsOut: 'The middle column pops first and the wave spreads out to both edges together.',
	columnsIn: 'The outer columns pop first and the wave closes in on the middle.',
	rowsTop: 'The top winning row pops first, then each row below it.',
	rowsBottom: 'The bottom winning row pops first, sweeping upwards.',
	diagonalTopLeft: 'A diagonal wave running from the top-left corner to the bottom-right.',
	diagonalTopRight: 'A diagonal wave running from the top-right corner to the bottom-left.',
	radial: 'Rings spreading out from the middle of the board, nearest symbols first.',
	random: 'One symbol at a time in a shuffled order, re-rolled on every step.',
	sequential: 'One symbol at a time, left to right and top to bottom.',
};

/**
 * A pattern that pops ONE seat per wave rather than a whole line of them, so its cost scales with
 * the size of the win instead of with the board. Worth saying out loud in the tool: a 15-symbol
 * cluster on `sequential` at 80 ms is well over a second of extra step.
 */
export const TUMBLE_PATTERNS_PER_SEAT: readonly TumblePatternName[] = ['random', 'sequential'];

/** The gap between two waves when the doc does not name one. Sized so a 5-reel sweep reads as a
 *  sweep (4 × 80 = 320 ms) without noticeably lengthening the round. */
export const TUMBLE_STEP_MS_DEFAULT = 80;

/** The per-WAVE ceiling the tool's slider and the doc schema both enforce. */
export const TUMBLE_STEP_MS_MAX = 500;

/**
 * The ceiling on the WHOLE spread — first wave to last — and the one that actually bounds the round.
 *
 * {@link TUMBLE_STEP_MS_MAX} only bounds one gap, which is no bound at all for a pattern whose wave
 * count grows with the win: `sequential` pops ONE seat per wave, so a 15-symbol cluster at 500 ms
 * spreads over 7 seconds. That is not a hypothetical — a swap-in-place board with "clear the board"
 * ticked explodes the WHOLE board on EVERY spin (`clearOutgoingSymbols`), and the explode step is
 * not raced against the round-skip token, so those 7 seconds would be unskippable dead air on every
 * single spin.
 *
 * When the spread would exceed this, the STEP is scaled down to fit and the pattern's shape is kept
 * intact — every seat keeps its wave, the waves just come faster. A guard, not a shaper: 2 s is
 * above anything a pattern plausibly wants (a 5-column sweep at the maximum gap is exactly 2 s, and
 * `sequential` at the default gap over a 15-symbol win is 1.12 s), so a real authored pace is never
 * touched and only the runaway combination is.
 */
export const TUMBLE_SPREAD_MS_MAX = 2_000;

export type TumblePatternConfig = {
	pattern?: TumblePatternName;
	/** Gap between two waves, ms. Absent ⇒ {@link TUMBLE_STEP_MS_DEFAULT}. */
	stepMs?: number;
};

/** The two coordinates a pattern reads. Structurally satisfied by the engine's `Position`, so
 *  callers pass their own seats through untouched. */
type Seat = { reel: number; row: number };

/**
 * The board the centre-relative patterns measure against. Absent ⇒ measured against the exploding
 * seats' own extents, which is right for a full-board cascade and only matters for `columnsOut` /
 * `columnsIn` / `radial` (every other pattern is monotonic, so the origin cancels out in the
 * dense-ranking below).
 *
 * `rankAgainstBoard` switches OFF the dense ranking, and exists for the one caller that cannot
 * dense-rank correctly: the swap-in-place board CLEAR, which is fanned out ONE COLUMN PER CALL
 * (`clearOutgoingSymbols(reelIndex)` in `apps/lines/src/game/flowEffects.ts`, driven concurrently by
 * `emergeRevealBoard` / `columnCascadeRevealBoard`). Dense ranking asks "where do these seats sit
 * among THEMSELVES", and one column's seats all share a column key — so every column answered "wave
 * 0" and a column pattern collapsed to no stagger at all on the very beat that shows the whole board
 * blowing up. Ranking against the BOARD asks "where does this column sit among all six", which is
 * the question a per-column call has to answer.
 *
 * Dense ranking stays the default because it is right for the cascade, where the caller passes the
 * whole winning set at once and a win on reels 2-4 must not wait through two empty waves.
 */
export type TumbleBoardBounds = { reels: number; rows: number; rankAgainstBoard?: boolean };

export function isTumblePattern(value: unknown): value is TumblePatternName {
	return typeof value === 'string' && (TUMBLE_PATTERNS as readonly string[]).includes(value);
}

/**
 * Rank each seat into a WAVE, then turn the wave into a delay.
 *
 * The ranking is DENSE over the seats actually exploding, not over the board: a win that only
 * touches reels 2–4 pops on waves 0,1,2, never on 2,3,4 with two empty waves of dead air in front
 * of it. That is what keeps a pattern reading the same on a three-symbol line as on a full board,
 * and it is why the monotonic patterns can use a raw coordinate as their key without caring where
 * the board's edge is.
 *
 * Returns delays PARALLEL to `seats` (same length, same order) so a caller can zip them onto its
 * own list without a lookup. Ties share a wave — that is the point of a row/column pattern.
 */
export function tumbleExplosionDelays(
	seats: readonly Seat[],
	config?: TumblePatternConfig,
	bounds?: TumbleBoardBounds,
	/** Injected so a test can seed `random`; production passes nothing. */
	random: () => number = Math.random,
): number[] {
	const pattern = config?.pattern;
	// UNKNOWN ⇒ the un-authored single frame, never a throw. The Zod enum stops an unknown name at
	// SAVE, so this is not about a malformed doc — it is about VERSION SKEW, which this repo ships by
	// design: the launcher deploys from `main` on its own cadence while a shipped game vendors the
	// engine as a submodule pinned to an older commit. Add a thirteenth pattern, author it online,
	// and a game on an older pin would receive a name its `switch` has no case for. Reaching the
	// `.map` below with `undefined` would throw INSIDE `tumbleBoardExplode`, whose rejection takes
	// `broadcastAsync` → the `tumbleBoard` book event → the round with it, on the one step every
	// cascading spin runs. Degrading to "explodes in one frame" is the only acceptable answer.
	if (pattern === undefined || pattern === 'all' || !isTumblePattern(pattern)) {
		return seats.map(() => 0);
	}
	if (seats.length === 0) return [];

	const stepMs = clampStep(config?.stepMs);
	// A pattern with no gap between its waves IS `all` — resolve it here rather than paying a sort
	// and a map to arrive at the same array of zeroes.
	if (stepMs === 0) return seats.map(() => 0);

	// BOARD-RANKED (the per-column clear) vs DENSE (everything else) — see `rankAgainstBoard`. The
	// board form keys EVERY seat of the board once and looks this call's seats up in that map, rather
	// than re-deriving their keys: `random` would otherwise draw a second, different shuffle and the
	// columns of one clear would disagree about the order they are in.
	const boardRanked = bounds?.rankAgainstBoard === true;
	const ranked = boardRanked ? everySeatOf(bounds) : seats;
	const rankedKeys = patternKeys(pattern, ranked, bounds, random);
	const keys = boardRanked ? lookUpKeys(seats, ranked, rankedKeys) : rankedKeys;
	const ordered = [...new Set(rankedKeys)].sort((a, b) => a - b);
	const wave = new Map(ordered.map((key, index) => [key, index]));
	// The whole spread, bounded — see {@link TUMBLE_SPREAD_MS_MAX}. Scaling the STEP keeps every seat
	// on the wave the pattern gave it; only the pace tightens. `lastWave` is 0 for a one-wave step
	// (a single-column win on a column pattern), where there is no spread to bound and no divisor.
	const lastWave = ordered.length - 1;
	// NOTE the cap is measured over the RANKED set, so a board-ranked call bounds the spread of the
	// whole clear rather than of the one column it was handed — otherwise six columns would each
	// think they had the whole 2 s budget.
	const step =
		lastWave > 0 && lastWave * stepMs > TUMBLE_SPREAD_MS_MAX
			? Math.floor(TUMBLE_SPREAD_MS_MAX / lastWave)
			: stepMs;
	return keys.map((key) => (wave.get(key) ?? 0) * step);
}

/** The wave a pattern sorts by, one number per seat. Lower goes first; the caller dense-ranks. */
function patternKeys(
	pattern: Exclude<TumblePatternName, 'all'>,
	seats: readonly Seat[],
	bounds: TumbleBoardBounds | undefined,
	random: () => number,
): number[] {
	// The centre the three centre-relative patterns measure from — the BOARD's when the caller knows
	// it, otherwise the exploding set's own middle. Halved extents, so a 5-reel board centres on
	// reel 2 and a 4-reel board centres between reels 1 and 2 (both edges then tie, which is exactly
	// the symmetric wave those patterns want).
	const reelCentre = ((bounds?.reels ?? extent(seats, (s) => s.reel)) - 1) / 2;
	const rowCentre = ((bounds?.rows ?? extent(seats, (s) => s.row)) - 1) / 2;

	switch (pattern) {
		case 'columnsLeft':
			return seats.map((s) => s.reel);
		case 'columnsRight':
			return seats.map((s) => -s.reel);
		case 'columnsOut':
			return seats.map((s) => Math.abs(s.reel - reelCentre));
		case 'columnsIn':
			return seats.map((s) => -Math.abs(s.reel - reelCentre));
		case 'rowsTop':
			return seats.map((s) => s.row);
		case 'rowsBottom':
			return seats.map((s) => -s.row);
		case 'diagonalTopLeft':
			return seats.map((s) => s.reel + s.row);
		case 'diagonalTopRight':
			return seats.map((s) => s.row - s.reel);
		case 'radial':
			// SQUARED distance, never a `Math.sqrt`: the ranking only compares, and squaring keeps the
			// key an exact sum of two halves-of-integers rather than an irrational one that two seats
			// the same distance out could fail to tie on.
			return seats.map((s) => (s.reel - reelCentre) ** 2 + (s.row - rowCentre) ** 2);
		case 'random':
			// A SHUFFLE, not a random key per seat: two seats drawing the same number would share a
			// wave and quietly stop this being one-at-a-time. Fisher–Yates over the indices gives every
			// seat a distinct rank by construction.
			return shuffledRanks(seats.length, random);
		case 'sequential':
			// Reading order, and distinct by construction for the same reason `random` is: no two seats
			// share a (row, reel), so no two share a key.
			return seats.map((s) => s.row * COLUMN_STRIDE + s.reel);
	}
}

/** Wider than any board a reel grid can express, so `row * stride + reel` can never collide across
 *  two rows. Not a board dimension — purely the packing base for the reading-order key. */
const COLUMN_STRIDE = 1_000;

/** Every seat of the board, reading order — the ranking universe for a board-ranked call. */
function everySeatOf(bounds: TumbleBoardBounds): Seat[] {
	const seats: Seat[] = [];
	for (let row = 0; row < bounds.rows; row += 1) {
		for (let reel = 0; reel < bounds.reels; reel += 1) seats.push({ reel, row });
	}
	return seats;
}

/** This call's seats, keyed by their position in the board-wide ranking. A seat outside the bounds
 *  (a padded buffer row, a mis-sized board) falls back to the first wave rather than throwing. */
function lookUpKeys(
	seats: readonly Seat[],
	ranked: readonly Seat[],
	rankedKeys: number[],
): number[] {
	const bySeat = new Map(
		ranked.map((seat, index) => [`${seat.reel}:${seat.row}`, rankedKeys[index]!]),
	);
	const first = rankedKeys.length ? Math.min(...rankedKeys) : 0;
	return seats.map((seat) => bySeat.get(`${seat.reel}:${seat.row}`) ?? first);
}

const extent = (seats: readonly Seat[], pick: (seat: Seat) => number) =>
	seats.reduce((max, seat) => Math.max(max, pick(seat) + 1), 1);

function shuffledRanks(count: number, random: () => number): number[] {
	const ranks = Array.from({ length: count }, (_, index) => index);
	for (let i = count - 1; i > 0; i -= 1) {
		const j = Math.floor(random() * (i + 1));
		[ranks[i], ranks[j]] = [ranks[j]!, ranks[i]!];
	}
	return ranks;
}

/** Absent ⇒ the default; anything else is clamped into `0 … TUMBLE_STEP_MS_MAX` and floored, so a
 *  hand-edited doc cannot smuggle a fractional millisecond into a timer. This bounds ONE GAP only —
 *  what bounds the round is {@link TUMBLE_SPREAD_MS_MAX}, applied to the whole spread above. */
export function clampStep(stepMs: number | undefined): number {
	if (stepMs === undefined || !Number.isFinite(stepMs)) return TUMBLE_STEP_MS_DEFAULT;
	return Math.min(Math.max(Math.floor(stepMs), 0), TUMBLE_STEP_MS_MAX);
}
