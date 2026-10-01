import type { HoldAndWinWheelPrize } from './holdAndWin';

/**
 * THE PRE-FEATURE WHEEL'S GEOMETRY, without a renderer — design §1.2 (Super Hotfire's SUPER WHEEL)
 * and the `holdAndWinWheel {segment, prize}` event. Pure, so `fixtures/holdAndWinWheel.fixture.ts`
 * pins it; `apps/lines` draws the wheel and only times and paints the answer.
 *
 * Angles are radians, clockwise on screen (Pixi's y axis points down). At rotation 0 the CENTRE of
 * segment `i` sits `i × segment` clockwise from the pointer, so segment 0 is under the pointer.
 * Turning the wheel clockwise by `r` moves the segment at `−r` (mod a full turn) under the pointer.
 */

const TURN = Math.PI * 2;

/** One segment's angular width. */
export const wheelSegmentAngle = (count: number): number => TURN / Math.max(1, count);

/** Where segment `index`'s centre sits, relative to the pointer, at rotation 0. */
export const wheelSegmentCentre = (index: number, count: number): number =>
	index * wheelSegmentAngle(count);

const mod = (value: number, by: number) => ((value % by) + by) % by;

/**
 * The rotation the wheel spins to so segment `index` lands centred under the pointer: the smallest
 * rotation at least `turns` full turns past `from`. Deterministic — the same start, index and turns
 * always land the same place, so a replay or a slam (which jumps straight here) agrees with an
 * unslammed spin. An index outside the wheel is taken modulo its segment count.
 */
export const wheelLandingRotation = ({
	count,
	index,
	from = 0,
	turns = 3,
}: {
	count: number;
	index: number;
	from?: number;
	turns?: number;
}): number => {
	const segments = Math.max(1, Math.floor(count));
	const landed = mod(-wheelSegmentCentre(mod(Math.floor(index), segments), segments), TURN);
	const minimum = from + Math.max(0, turns) * TURN;
	const base = minimum - mod(minimum, TURN);
	const candidate = base + landed;
	return candidate >= minimum - 1e-9 ? candidate : candidate + TURN;
};

/** The segment under the pointer at `rotation` — the inverse of {@link wheelLandingRotation}. */
export const wheelSegmentAt = (rotation: number, count: number): number => {
	const segments = Math.max(1, Math.floor(count));
	const seg = wheelSegmentAngle(segments);
	return mod(Math.round(mod(-rotation, TURN) / seg), segments);
};

/**
 * The spin's easing: a quartic ease-out — the wheel leaves at full speed and creeps onto its
 * segment, the way a physical wheel settles. Clamped, so a timer that overshoots lands exactly.
 */
export const wheelEase = (t: number): number => {
	const clamped = Math.min(1, Math.max(0, t));
	return 1 - (1 - clamped) ** 4;
};

/** The coded label of a wheel prize: `COIN BOOST ×2`, `+1 COLLECT`, `GRAND`. */
export const wheelPrizeLabel = (prize: HoldAndWinWheelPrize): string => {
	switch (prize.type) {
		case 'coinBoost':
			return `COIN BOOST ×${prize.multiplier}`;
		case 'extraCollect':
			return `+${prize.count} COLLECT`;
		case 'jackpot':
			return prize.jackpot;
	}
};
