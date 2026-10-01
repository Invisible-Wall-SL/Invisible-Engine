import type { HoldAndWinMeterLevel } from 'engine-game';
import type { HoldAndWinMeter } from 'game-config';
import { Tween } from 'svelte/motion';

import { getActiveGameConfig } from './gameConfig';
import { recordHoldAndWinEvent, stateHoldAndWin } from './stateHoldAndWin.svelte';

/**
 * THE PERSISTENT METERS (pots) as this game shows them — design §1.3 "Persistent meters".
 *
 * A level is SERVER state: it arrives at boot (the facade's `__IE_HOLD_AND_WIN_METERS__`, seeded by
 * {@link seedHoldAndWinMeters}), changes only by `meterUpdate`, and is restated by `meterLevels`
 * after every play — all recorded into `stateHoldAndWin.meters` at the play seam. The client never
 * computes one. What a pot DRAWS can lag the recorded level for the length of a beat (a special in
 * flight, a full meter emptying): {@link holdMeterDisplay} pins the drawn level and lets go when the
 * beat ends, exactly as the respin board's labels do (`stateRespinBoard.heldDisplay`).
 *
 * Which pots exist, their size stages and what a full one activates come from the Game Config
 * (`holdAndWin.meters`); a game with none draws nothing and registers nothing.
 */

/** The meters the Game Config declares — what the coded pots draw, in order. */
export const configuredMeters = (): HoldAndWinMeter[] =>
	getActiveGameConfig().holdAndWin?.meters ?? [];

export const stateMeterDisplay = $state({
	/** A pot's drawn level while a beat runs, by meter id. */
	pinned: {} as Record<string, Tween<number>>,
	/** Bumped when a meter fills, so its pot pulses. */
	pulses: {} as Record<string, number>,
});

const recorded = (id: string): HoldAndWinMeterLevel | undefined =>
	stateHoldAndWin.meters.find((meter) => meter.id === id);

/** The level a pot shows now — a beat's pinned value, else the server's. Fractional mid-tween. */
export const meterLevelShown = (id: string): number =>
	stateMeterDisplay.pinned[id]?.current ?? recorded(id)?.level ?? 0;

/** A meter's maximum — the server's, else the config's. */
export const meterMax = (id: string): number =>
	recorded(id)?.max ?? configuredMeters().find((meter) => meter.id === id)?.maxLevel ?? 0;

/** What an authored pot drawing meter `id` counts itself in as (`trackComponentMount`). */
export const potMeterMountKey = (id: string): string => `potMeter:${id}`;

/** The flight target a meter's pot anchors (`<Anchor name>`), and the kind its specials fly as. */
export const meterAnchor = (id: string): string => `meter:${id}`;
export const meterFlight = (id: string): string => `toMeter:${id}`;

/** Pin a pot's drawn level at `level` for the length of a beat; returns the tween that moves it. */
export const holdMeterDisplay = (id: string, level: number): Tween<number> => {
	const tween = new Tween(level);
	stateMeterDisplay.pinned[id] = tween;
	return tween;
};

/** Let the pot read the server's level again — only if `tween` is still the one pinned there. */
export const releaseMeterDisplay = (id: string, tween: Tween<number>): void => {
	if (stateMeterDisplay.pinned[id] === tween) delete stateMeterDisplay.pinned[id];
};

export const pulseMeter = (id: string): void => {
	stateMeterDisplay.pulses[id] = (stateMeterDisplay.pulses[id] ?? 0) + 1;
};

/**
 * Seed the meters from the levels the facade captured at boot, once, at game start — no book event
 * carries them before the first play. Through the reducer (as a `meterLevels`), so the picture keeps
 * one writer. A no-op without the global (every non-Hold-and-Win server), and when a book event has
 * already recorded meters (a resume replaying its `meterLevels` first): the server's later word wins.
 */
export const seedHoldAndWinMeters = (): void => {
	if (stateHoldAndWin.meters.length > 0) return;
	const meters = (globalThis as { __IE_HOLD_AND_WIN_METERS__?: HoldAndWinMeterLevel[] })
		.__IE_HOLD_AND_WIN_METERS__;
	if (!Array.isArray(meters) || meters.length === 0) return;
	recordHoldAndWinEvent({ type: 'meterLevels', meters });
};
