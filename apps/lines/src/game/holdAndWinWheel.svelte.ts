import { Tween } from 'svelte/motion';
import {
	wheelEase,
	wheelLandingRotation,
	wheelPrizeLabel,
	type HoldAndWinWheelPrize,
} from 'engine-game';
import type { WheelPrize } from 'game-config';
import { roundSkip } from 'utils-shared/skipToken';

import { getActiveGameConfig } from './gameConfig';

/**
 * THE PRE-FEATURE WHEEL as this game shows it (design §1.2 Super Hotfire's SUPER WHEEL) — the
 * coded default until Phase 6 authors a `wheel` scene: a segmented circle, one segment per prize the
 * Game Config lists (`holdAndWin.wheel.prizes`), that spins and lands EXACTLY on the server's
 * `segment`. The geometry is `engine-game` `holdAndWinWheel.ts` (pure, fixture-pinned); this module
 * holds what `HoldAndWinWheel.svelte` draws and drives its one rotation.
 *
 * Nothing is mounted until a wheel is up, so a game that never receives `holdAndWinWheel` pays
 * nothing for it.
 */
export type WheelView = {
	id: number;
	prizes: HoldAndWinWheelPrize[];
	/** The segment under the pointer once it has landed; null while it spins. */
	landed: number | null;
};

export const stateWheel = $state({ current: null as WheelView | null });

/** The wheel's rotation, radians clockwise. One wheel is up at a time, so one rotation. */
export const wheelRotation = new Tween(0);

/** Full turns before the wheel creeps onto its segment. */
const WHEEL_TURNS = 4;
const WHEEL_SPIN_MS = 3_200;

let nextId = 1;

/** A config prize as the engine names one (the config's draw weight is the server's business). */
const asEnginePrize = (prize: WheelPrize): HoldAndWinWheelPrize => {
	switch (prize.type) {
		case 'coinBoost':
			return { type: 'coinBoost', multiplier: prize.multiplier };
		case 'extraCollect':
			return { type: 'extraCollect', count: prize.count };
		case 'jackpot':
			return { type: 'jackpot', jackpot: prize.jackpot };
	}
};

const samePrize = (a: HoldAndWinWheelPrize, b: HoldAndWinWheelPrize): boolean =>
	wheelPrizeLabel(a) === wheelPrizeLabel(b) && a.type === b.type;

/**
 * The prizes the wheel shows and the segment the server's `segment` names among them: the config's
 * list when its `segment` holds the prize the server sent; otherwise (a config edited since the
 * server dealt, or none at all) a one-segment wheel of the server's prize — the wheel never lands
 * on a prize the round did not award.
 */
export const wheelSegments = (
	index: number,
	prize: HoldAndWinWheelPrize,
): { prizes: HoldAndWinWheelPrize[]; index: number } => {
	const configured = (getActiveGameConfig().holdAndWin?.wheel?.prizes ?? []).map(asEnginePrize);
	const named = configured[index];
	return named && samePrize(named, prize)
		? { prizes: configured, index }
		: { prizes: [prize], index: 0 };
};

/** Put a wheel up at rest; returns its id. */
export const showWheel = (prizes: HoldAndWinWheelPrize[]): number => {
	const id = nextId++;
	void wheelRotation.set(0, { duration: 0 });
	stateWheel.current = { id, prizes, landed: null };
	return id;
};

/**
 * Spin to land `index` under the pointer. A slam (a press while it turns, or a token already
 * tripped) lands it at once on the very rotation the spin was easing onto — the result is never
 * different, only sooner.
 */
export const spinWheelTo = async (index: number): Promise<void> => {
	const wheel = stateWheel.current;
	if (!wheel) return;
	const final = wheelLandingRotation({
		count: wheel.prizes.length,
		index,
		from: wheelRotation.current,
		turns: WHEEL_TURNS,
	});
	const duration = roundSkip.isSkipped() ? 0 : WHEEL_SPIN_MS;
	await roundSkip.race(wheelRotation.set(final, { duration, easing: wheelEase }));
	if (wheelRotation.current !== final) await wheelRotation.set(final, { duration: 0 });
	if (stateWheel.current?.id === wheel.id) stateWheel.current.landed = index;
};

export const hideWheel = (id: number): void => {
	if (stateWheel.current?.id === id) stateWheel.current = null;
};
