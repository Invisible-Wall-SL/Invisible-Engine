import { SWAP_STYLES, type GameConfigDoc, type ReelBehaviour, type SwapStyle } from './types';

/**
 * The largest per-column stagger a config may store, in milliseconds.
 *
 * The delay is paid ONCE PER COLUMN, so it multiplies by the grid width: on a 6-reel board a 400 ms
 * stagger means the last column only starts its swap 2 s after the first. Past a whole column the
 * sweep is already strictly sequential — the slowest reading the knob has — so there is nothing
 * above this that buys a different picture, only a slower one. An author who typed an extra zero
 * gets a slow board, not a game that looks hung.
 */
export const REEL_BEHAVIOUR_MAX_COLUMN_STAGGER_MS = 2000;

/**
 * The behaviour with every default already applied — the ONE shape the runtime consumes.
 *
 * `columnStaggerMs` stays `number | undefined` rather than being defaulted to a number, and that is
 * deliberate: the number is a TIMING, and every other cascade timing (the beat cap, the slide
 * duration) lives with the presentation that spends it. `0` is a legal authored value meaning "every
 * column at once", so it must survive the `??` at the call site — which it cannot if absent has
 * already been turned into a number here.
 */
export type ResolvedReelBehaviour = {
	swapInPlace: boolean;
	swapStyle: SwapStyle;
	columnStaggerMs: number | undefined;
	clearBoard: boolean;
};

const isSwapStyle = (value: unknown): value is SwapStyle =>
	SWAP_STYLES.includes(value as SwapStyle);

/**
 * Every default in one place, and they are all "what the engine did before this block existed": the
 * reels roll, a swap drops the whole board in at once, and nothing clears first.
 *
 * `clearBoard` is ANDed with its two preconditions here rather than at the consumer. It only has a
 * meaning inside the drop-in reveal — a rolling round never reaches a swap presentation, and a
 * `columnCascade` already empties each column by DRAINING it, so a clear there would be two clears
 * for one round. Resolving it honestly and re-gating it at the call site would be the same rule
 * written twice, which is how one of the two eventually gets it wrong. The stored doc keeps whatever
 * the author ticked (see {@link normalizeReelBehaviour}), so changing style or mode is lossless.
 *
 * `swapStyle` is matched against the RECOGNISED literals rather than passed through, for the same
 * reason `swapInPlace` is compared to `true`: the block is authored data, so a doc written against a
 * future (or mistyped) vocabulary must resolve to the shipped drop-in instead of naming a
 * presentation branch that does not exist.
 */
export function resolveReelBehaviour(
	doc: Pick<GameConfigDoc, 'reelBehaviour'> | undefined,
): ResolvedReelBehaviour {
	const authored = doc?.reelBehaviour;
	const swapInPlace = authored?.swapInPlace === true;
	const swapStyle = isSwapStyle(authored?.swapStyle) ? authored.swapStyle : 'dropIn';
	const stagger = authored?.columnStaggerMs;
	return {
		swapInPlace,
		swapStyle,
		columnStaggerMs:
			typeof stagger === 'number' && Number.isFinite(stagger) && stagger >= 0
				? Math.min(stagger, REEL_BEHAVIOUR_MAX_COLUMN_STAGGER_MS)
				: undefined,
		clearBoard: swapInPlace && swapStyle === 'dropIn' && authored?.clearBoard === true,
	};
}

/**
 * Normalize an authored block, or `undefined` when there is nothing worth storing.
 *
 * Same invariant as the rest of this schema — store only what DEPARTS from the default — so a config
 * that leaves every switch alone normalizes byte-identically to one written before the block
 * existed, and no stored doc is rewritten by this field arriving. `'dropIn'` is therefore dropped
 * rather than stored: it IS the default.
 *
 * `clearBoard` is kept even when the mode or the style makes it inert, and that is the one
 * deliberate exception to "only what departs": it is a SETTING the author ticked, and silently
 * dropping it on save would mean a round-trip through the tool quietly undid their work the moment
 * they switched style to compare. {@link resolveReelBehaviour} is what makes it inert; the validator
 * says so out loud.
 */
export function normalizeReelBehaviour(raw: unknown): ReelBehaviour | undefined {
	if (typeof raw !== 'object' || raw === null) return undefined;
	const input = raw as Partial<ReelBehaviour>;
	const out: ReelBehaviour = {};
	if (input.swapInPlace === true) out.swapInPlace = true;
	if (input.swapStyle === 'columnCascade') out.swapStyle = 'columnCascade';
	if (input.clearBoard === true) out.clearBoard = true;
	const stagger = input.columnStaggerMs;
	if (typeof stagger === 'number' && Number.isFinite(stagger) && stagger >= 0) {
		out.columnStaggerMs = Math.round(Math.min(stagger, REEL_BEHAVIOUR_MAX_COLUMN_STAGGER_MS));
	}
	return Object.keys(out).length ? out : undefined;
}
